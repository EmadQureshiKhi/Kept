#!/usr/bin/env python3
"""
The collision verifier: parse the finished SVG back out and look for the four
faults that width-checking at draw time cannot see.

Draw-time checks know whether a string fits the box it was *written* for. They
know nothing about where that box ended up. Every fault below shipped at least
once before this file existed:

  * a box partly overlapping another box — a chip nudged out of its group
  * a label plate covering a border — an opaque plate is how a label survives a
    line crossing it, and the same opacity punches a hole in anything else
  * text outside the canvas — a column that grew past the viewBox
  * text sitting on a line — the fault plates exist to prevent, checked for the
    arrows that were drawn without one

Text extents are estimates from `len * size * 0.53`, so a complaint means *look*,
not necessarily *fix*. The exit status is therefore 0 even with findings: this is
a report, and a build that stops on the first one surfaces one fault per run
instead of all of them.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

GLYPH = 0.53
ASSETS = Path(__file__).resolve().parents[2] / "Assets"

#: Attributes are read by name rather than by position.
#:
#: The first version of this matched attributes in the order the emitter happens
#: to write them, with the optional ones as optional groups. That silently never
#: captured `text-anchor`, because a lazy `[^>]*?` in front of an optional group
#: matches nothing, lets the group match empty, and lets the following `[^>]*`
#: swallow the attribute — so every centred label was measured as if it were
#: left-anchored, and the whole set reported its own edge labels as sitting on
#: lines. A verifier that is wrong about the drawing is worse than no verifier.
#: Text and shapes are matched separately, and that is the second bug this file
#: had rather than a stylistic choice. One combined pattern with an optional
#: `(.*?)</text>` tail lets a `<rect>` match that tail — `?` is greedy, so the
#: engine *prefers* to consume everything up to the next `</text>` — and every
#: shape in between is then never seen at all. The verifier reported a clean set
#: because it had parsed almost none of it.
SHAPE = re.compile(r"<(rect|polyline)\b([^>]*)>")
TEXT = re.compile(r"<text\b([^>]*)>(.*?)</text>", re.S)
ATTR = re.compile(r'([\w-]+)="([^"]*)"')
VIEW = re.compile(r'width="(\d+)" height="(\d+)" role="img"')


def attrs(raw: str) -> dict[str, str]:
    return dict(ATTR.findall(raw))


def num(value: str | None, default: float = 0.0) -> float:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class Box:
    x: float
    y: float
    w: float
    h: float
    fill: str
    stroke: str

    @property
    def x2(self) -> float:
        return self.x + self.w

    @property
    def y2(self) -> float:
        return self.y + self.h

    @property
    def stroked(self) -> bool:
        return self.stroke != "none"

    @property
    def is_plate(self) -> bool:
        """An opaque white fill with no stroke is a label plate."""
        return self.stroke == "none" and self.fill.lower() == "#ffffff"

    def intersects(self, other: "Box") -> bool:
        return not (
            self.x2 <= other.x or other.x2 <= self.x
            or self.y2 <= other.y or other.y2 <= self.y
        )

    def contains(self, other: "Box") -> bool:
        return (
            self.x <= other.x and self.y <= other.y
            and self.x2 >= other.x2 and self.y2 >= other.y2
        )


def unescape(text: str) -> str:
    """
    Back to the characters a reader sees.

    The emitter escapes `&`, `<` and `>`, so a label containing one arrives here
    four or five characters longer than it renders. Measuring the escaped form
    over-estimates the width and reported a correctly-plated edge label as
    sitting on a line — the estimate has to be taken over what the renderer draws.
    """
    return text.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")


@dataclass(frozen=True)
class Label:
    x: float
    y: float
    size: float
    anchor: str
    body: str

    @property
    def box(self) -> Box:
        width = len(unescape(self.body)) * self.size * GLYPH
        left = {
            "middle": self.x - width / 2,
            "end": self.x - width,
        }.get(self.anchor, self.x)
        # A baseline sits about 0.78 of the size below the cap top.
        return Box(left, self.y - self.size * 0.78, width, self.size, "none", "none")


def segments(points: str) -> list[tuple[float, float, float, float]]:
    if not points.strip():
        return []
    pts = [tuple(float(v) for v in p.split(",")) for p in points.split()]
    return [
        (pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
        for i in range(len(pts) - 1)
    ]


def crosses(seg: tuple[float, float, float, float], box: Box) -> bool:
    """Whether an axis-aligned segment passes through `box`."""
    x1, y1, x2, y2 = seg
    if abs(y1 - y2) < 0.5:                      # horizontal
        return box.y <= y1 <= box.y2 and min(x1, x2) < box.x2 and max(x1, x2) > box.x
    if abs(x1 - x2) < 0.5:                      # vertical
        return box.x <= x1 <= box.x2 and min(y1, y2) < box.y2 and max(y1, y2) > box.y
    return False                                # diagonals are not used


def check(path: Path) -> list[str]:
    svg = path.read_text(encoding="utf8")
    view = VIEW.search(svg)
    width, height = (int(view.group(1)), int(view.group(2))) if view else (0, 0)

    boxes: list[Box] = []
    labels: list[Label] = []
    lines: list[tuple[float, float, float, float]] = []

    for kind, raw in SHAPE.findall(svg):
        a = attrs(raw)
        if kind == "rect":
            boxes.append(
                Box(
                    num(a.get("x")), num(a.get("y")),
                    num(a.get("width")), num(a.get("height")),
                    a.get("fill", "none"), a.get("stroke", "none"),
                )
            )
        else:
            lines.extend(segments(a.get("points", "")))

    for raw, body in TEXT.findall(svg):
        a = attrs(raw)
        labels.append(
            Label(
                num(a.get("x")), num(a.get("y")), num(a.get("font-size"), 12),
                a.get("text-anchor", "start"), body,
            )
        )

    canvas = next((b for b in boxes if b.w >= width and b.h >= height), None)
    drawn = [b for b in boxes if b is not canvas]
    stroked = [b for b in drawn if b.stroked]
    plates = [b for b in drawn if b.is_plate]

    findings: list[str] = []

    # 1. a box partly overlapping another box
    for i, a in enumerate(stroked):
        for b in stroked[i + 1:]:
            if a.intersects(b) and not a.contains(b) and not b.contains(a):
                findings.append(
                    f"boxes overlap: ({a.x:.0f},{a.y:.0f} {a.w:.0f}x{a.h:.0f}) and "
                    f"({b.x:.0f},{b.y:.0f} {b.w:.0f}x{b.h:.0f})"
                )

    # 2. a label plate covering a border
    for plate in plates:
        for box in stroked:
            if plate.intersects(box) and not plate.contains(box):
                # A plate wholly inside a box is fine — that is a label on a fill.
                if box.contains(plate):
                    continue
                findings.append(
                    f"plate at ({plate.x:.0f},{plate.y:.0f} {plate.w:.0f}x{plate.h:.0f}) "
                    f"covers the border of ({box.x:.0f},{box.y:.0f} {box.w:.0f}x{box.h:.0f})"
                )

    # 3. text outside the canvas
    for label in labels:
        box = label.box
        if box.x < 0 or box.y < 0 or box.x2 > width or box.y2 > height:
            findings.append(
                f"text outside the canvas at ({box.x:.0f},{box.y:.0f}): {label.body[:56]}"
            )

    # 4. text sitting on a line, for text with nothing opaque beneath it.
    #
    # "Beneath" is any filled rect that contains the label, not only a white
    # label plate: a note drawn over a sequence lifeline hides that lifeline with
    # its own fill, and flagging it would report the house style as a fault. What
    # is left is the case worth catching — a bare label crossing a line with
    # nothing behind it.
    backing = [b for b in drawn if b.fill != "none"]
    for label in labels:
        box = label.box
        if any(b.contains(box) for b in backing):
            continue
        for seg in lines:
            if crosses(seg, box):
                findings.append(
                    f"text on a line at ({box.x:.0f},{box.y:.0f}): {label.body[:56]}"
                )
                break

    return findings


def main() -> int:
    total = 0
    for path in sorted(ASSETS.glob("kept-*.svg")):
        findings = check(path)
        total += len(findings)
        status = "ok" if not findings else f"{len(findings)} finding(s)"
        print(f"  {path.name}  {status}")
        for finding in findings:
            print(f"    ! {finding}")
    print(f"verify: {total} finding(s) across the set")
    # Estimates, so a report rather than a gate. See the module docstring.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
