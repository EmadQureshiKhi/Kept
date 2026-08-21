"""
A very small SVG emitter for the KEPT diagram set.

## Why this exists rather than Mermaid, Graphviz, dagre or elkjs

Auto-layout engines optimise for edge crossings. This diagram set has the
inverted requirement: **every label must sit inside its own box or on its own
edge, no label may cross a line, and every arrow must run through space that
holds nothing else.** An engine that minimises crossings will happily put a
label across a line or overflow a box to get there, because neither is a term in
its objective function. So layout here is explicit hand-chosen coordinates, and
this module is only the drawing surface.

## The build catches its own mistakes

Two mechanisms, and both matter because the failure mode is silent — a diagram
with an overflowing label renders perfectly well and is simply wrong.

1. **Width checking at draw time.** Every text helper takes the space it was
   written for and records a finding when the string will not fit. The estimate
   is `len(text) * size * 0.53`, 0.53 being roughly the average glyph width of a
   humanist sans as a fraction of its point size. It is an estimate, so a finding
   means *look*, not necessarily *fix*.
2. **A separate collision verifier**, in `verify.py`, which parses the finished
   SVG back out and reports overlapping boxes, plates covering borders, and text
   outside the canvas. It runs before any raster export.

Findings accumulate and the build keeps going, so one pass surfaces everything
rather than one problem per run.

## Black on white, deliberately

Weight, dashing and fill tone carry every distinction colour would otherwise
carry, so the diagrams survive being printed, projected, or read by someone who
does not separate hues. There is no palette below because there is no colour.
"""

from __future__ import annotations

import base64
import re
from dataclasses import dataclass, field
from pathlib import Path

# ── the visual system ─────────────────────────────────────────────────────────

INK = "#111111"          # every stroke, and primary text
MUTED = "#4a4a4a"        # secondary text only
GROUP_FILL = "#f6f6f6"   # outer container
CHIP_FILL = "#ffffff"    # inner node
ACCENT_FILL = "#e9e9e9"  # emphasis
BAND_FILL = "#f0f0f0"    # horizontal phase band
CANVAS = "#ffffff"

W_GROUP = 2.0            # the stroke hierarchy, and the only one
W_CHIP = 1.4
W_LINE = 1.6

R_GROUP = 8
R_CHIP = 6
R_PLATE = 4

DASH = "7 5"             # reserved for absent, optional, or not deployed

FONT = "system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif"

#: Average glyph width as a fraction of font size. Used for every width estimate.
GLYPH = 0.53


def escape(text: str) -> str:
    """`&`, `<` and `>` are the three that break an SVG. Order matters."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def room_for(width: float, size: float) -> int:
    """How many characters fit in `width` at `size`."""
    return int(width / (size * GLYPH))


def text_width(text: str, size: float) -> float:
    """Estimated rendered width of `text` at `size`."""
    return len(text) * size * GLYPH


# ── the canvas ────────────────────────────────────────────────────────────────


@dataclass
class Diagram:
    """One self-contained SVG. Nothing is fetched at render time."""

    width: int
    height: int
    title: str
    desc: str
    parts: list[str] = field(default_factory=list)
    findings: list[str] = field(default_factory=list)

    # ── findings ──────────────────────────────────────────────────────────

    def warn(self, message: str) -> None:
        self.findings.append(message)

    def fits(self, text: str, width: float, size: float, where: str) -> None:
        """Record a finding when `text` will not fit the space written for it."""
        room = room_for(width, size)
        if len(text) > room:
            self.warn(f"{where}: {len(text)} chars, room for {room}: {text[:64]}")

    # ── primitives ────────────────────────────────────────────────────────

    def rect(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        *,
        fill: str = "none",
        stroke: str = INK,
        stroke_width: float = W_CHIP,
        radius: float = 0,
        dashed: bool = False,
    ) -> None:
        dash = f' stroke-dasharray="{DASH}"' if dashed else ""
        rx = f' rx="{radius}"' if radius else ""
        self.parts.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" '
            f'stroke="{stroke}" stroke-width="{stroke_width}"{rx}{dash}/>'
        )

    def text(
        self,
        x: float,
        y: float,
        body: str,
        *,
        size: float = 12,
        weight: int = 400,
        fill: str = INK,
        anchor: str = "start",
        mono: bool = False,
    ) -> None:
        anchor_attr = "" if anchor == "start" else f' text-anchor="{anchor}"'
        family = (
            ' font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"'
            if mono
            else ""
        )
        self.parts.append(
            f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill}"{anchor_attr}{family}>{escape(body)}</text>'
        )

    def caption(self, x: float, y: float, body: str, *, width: float | None = None,
                where: str = "caption") -> None:
        if width is not None:
            self.fits(body, width, 11, where)
        self.text(x, y, body, size=11, fill=MUTED)

    def line(
        self,
        points: list[tuple[float, float]],
        *,
        arrow: bool = False,
        dashed: bool = False,
        stroke_width: float = W_LINE,
    ) -> None:
        pts = " ".join(f"{x},{y}" for x, y in points)
        dash = f' stroke-dasharray="{DASH}"' if dashed else ""
        head = ' marker-end="url(#head)"' if arrow else ""
        self.parts.append(
            f'<polyline points="{pts}" fill="none" stroke="{INK}" '
            f'stroke-width="{stroke_width}"{dash}{head}/>'
        )

    def arrow(self, points: list[tuple[float, float]], *, dashed: bool = False) -> None:
        self.line(points, arrow=True, dashed=dashed)

    # ── composites ────────────────────────────────────────────────────────

    def group(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        title: str,
        subtitle: str | None = None,
        *,
        fill: str = GROUP_FILL,
        dashed: bool = False,
    ) -> None:
        self.rect(x, y, w, h, fill=fill, stroke_width=W_GROUP, radius=R_GROUP, dashed=dashed)
        self.fits(title, w - 32, 17, f"group title @{x},{y}")
        self.text(x + 16, y + 30, title, size=17, weight=600)
        if subtitle is not None:
            self.fits(subtitle, w - 32, 11.5, f"group subtitle @{x},{y}")
            self.text(x + 16, y + 50, subtitle, size=11.5, fill=MUTED)

    def chip(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        title: str,
        body: list[str] | None = None,
        *,
        fill: str = CHIP_FILL,
        dashed: bool = False,
        mono_title: bool = False,
        centred: bool = False,
    ) -> None:
        self.rect(x, y, w, h, fill=fill, stroke_width=W_CHIP, radius=R_CHIP, dashed=dashed)
        if centred:
            self.fits(title, w - 24, 13, f"chip title @{x},{y}")
            self.text(
                x + w / 2, y + h / 2 + 13 * 0.36, title,
                size=13, weight=600, anchor="middle", mono=mono_title,
            )
            return
        self.fits(title, w - 24, 13, f"chip title @{x},{y}")
        self.text(x + 12, y + 21, title, size=13, weight=600, mono=mono_title)
        for i, row in enumerate(body or []):
            self.fits(row, w - 24, 11.2, f"chip body @{x},{y} line {i + 1}")
            self.text(x + 12, y + 39 + i * 15.5, row, size=11.2, fill=MUTED)

    def edge_label(
        self,
        x: float,
        y: float,
        lines: list[str],
        *,
        corridor: float = 240,
        below: bool = False,
    ) -> None:
        """
        A label on an opaque plate, so the line it annotates physically cannot
        cross the text. This is the one trick the whole style depends on.
        """
        size = 11
        widest = max((text_width(line, size) for line in lines), default=0)
        plate_w = max(60, min(widest + 16, corridor))
        plate_h = len(lines) * 14 + 10
        for i, line in enumerate(lines):
            self.fits(line, plate_w - 8, size, f"edge label @{x},{y} line {i + 1}")
        top = y + 4 if below else y - plate_h - 4
        self.rect(
            x - plate_w / 2, top, plate_w, plate_h,
            fill=CANVAS, stroke="none", stroke_width=0, radius=R_PLATE,
        )
        for i, line in enumerate(lines):
            self.text(
                x, top + 14 + i * 14, line,
                size=size, weight=600, anchor="middle",
            )

    def table(
        self,
        x: float,
        y: float,
        w: float,
        columns: list[tuple[str, float]],
        rows: list[list[str]],
        *,
        row_h: float = 22,
        size: float = 11.2,
        where: str = "table",
    ) -> float:
        """
        A ruled table. Returns the y the table ends at.

        `columns` is (heading, x-offset) pairs and each cell's room is derived
        from the next offset, so widening one column narrows its neighbour rather
        than silently overrunning it. A cell prefixed `*` is set in ink rather
        than muted, which is how the one value that matters in a row is marked
        without reaching for colour.

        Rows carry an alternating tone band. That is not only banding: the band is
        an opaque fill, so a cell sits *on* something, and the collision verifier
        can tell a table cell apart from a bare label dropped over a line.
        """
        edges = [offset for _, offset in columns] + [w + 12]
        widths = [edges[i + 1] - edges[i] - 12 for i in range(len(columns))]

        for i, (heading, offset) in enumerate(columns):
            self.fits(heading, widths[i], size, f"{where} heading {i + 1}")
            self.text(x + offset, y, heading, size=size, weight=700)
        rule_y = y + 8
        self.line([(x, rule_y), (x + w, rule_y)], stroke_width=1.0)

        for r, row in enumerate(rows):
            top = rule_y + 6 + r * row_h
            if r % 2 == 1:
                self.rect(
                    x, top, w, row_h,
                    fill=BAND_FILL, stroke="none", stroke_width=0, radius=0,
                )
            for i, cell in enumerate(row[: len(columns)]):
                strong = cell.startswith("*")
                body = cell[1:] if strong else cell
                self.fits(body, widths[i], size, f"{where} r{r + 1}c{i + 1}")
                self.text(
                    x + columns[i][1], top + row_h - 7, body,
                    size=size, weight=600 if strong else 400,
                    fill=INK if strong else MUTED,
                )
        end = rule_y + 6 + len(rows) * row_h
        self.line([(x, end), (x + w, end)], stroke_width=1.0)
        return end

    def band(self, x: float, y: float, w: float, h: float, label: str | None = None) -> None:
        self.rect(x, y, w, h, fill=BAND_FILL, stroke="none", stroke_width=0, radius=R_CHIP)
        if label is not None:
            self.fits(label, w - 24, 12, f"band @{x},{y}")
            self.text(x + 12, y + 17, label, size=12, weight=600, fill=MUTED)

    def note(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        title: str,
        body: list[str],
        *,
        dashed: bool = False,
    ) -> None:
        self.chip(x, y, w, h, title, body, fill=ACCENT_FILL, dashed=dashed)

    # ── sequence diagrams ─────────────────────────────────────────────────

    def lifeline(
        self,
        x: float,
        head_y: float,
        w: float,
        head_h: float,
        bottom: float,
        title: str,
        body: list[str] | None = None,
    ) -> float:
        """A chip head with a vertical line beneath it. Returns the line's x."""
        self.chip(x, head_y, w, head_h, title, body)
        centre = x + w / 2
        self.line(
            [(centre, head_y + head_h), (centre, bottom)],
            dashed=True, stroke_width=1.0,
        )
        return centre

    def step(
        self,
        n: int | None,
        y: float,
        x_from: float,
        x_to: float,
        lines: list[str],
        *,
        dashed: bool = False,
        below: bool = False,
    ) -> None:
        """A numbered horizontal step between two lifelines."""
        labelled = list(lines)
        if n is not None and labelled:
            labelled[0] = f"{n}. {labelled[0]}"
        self.arrow([(x_from, y), (x_to, y)], dashed=dashed)
        corridor = abs(x_to - x_from) - 24
        self.edge_label(
            (x_from + x_to) / 2, y, labelled,
            corridor=max(corridor, 80), below=below,
        )

    def self_step(
        self, n: int | None, y: float, x: float, lines: list[str], *, out: float = 46
    ) -> None:
        """A step a lifeline takes against itself."""
        labelled = list(lines)
        if n is not None and labelled:
            labelled[0] = f"{n}. {labelled[0]}"
        self.arrow([(x, y), (x + out, y), (x + out, y + 22), (x, y + 22)])
        for i, line in enumerate(labelled):
            self.fits(line, 460, 11, f"self step @{x},{y} line {i + 1}")
            self.text(x + out + 12, y + 4 + i * 14, line, size=11, weight=600)

    # ── the shared header ─────────────────────────────────────────────────

    def heading(self, title: str, subtitle: str, logo: str | None) -> None:
        """
        The header every diagram carries: the mark, the title, one line of prose.

        `logo` is a complete `<image>` element carrying a base64 data URI, so the
        finished file fetches nothing. That is not only tidiness — an SVG
        rendered through an `<img>` tag, which is what a Markdown image is, does
        not load external subresources at all, so a referenced logo renders on a
        local preview and leaves a hole on the site.
        """
        if logo is not None:
            self.parts.append(logo)
        self.fits(title, self.width - 176, 22, "heading title")
        self.text(136, 52, title, size=22, weight=700)
        self.fits(subtitle, self.width - 176, 13, "heading subtitle")
        self.text(136, 76, subtitle, size=13, fill=MUTED)

    # ── output ────────────────────────────────────────────────────────────

    def render(self) -> str:
        return "\n".join(
            [
                '<svg xmlns="http://www.w3.org/2000/svg" '
                'xmlns:xlink="http://www.w3.org/1999/xlink" '
                f'viewBox="0 0 {self.width} {self.height}" '
                f'width="{self.width}" height="{self.height}" '
                'role="img" aria-labelledby="t d" '
                f'font-family="{FONT}">',
                f"<title id=\"t\">{escape(self.title)}</title>",
                f"<desc id=\"d\">{escape(self.desc)}</desc>",
                "<defs>",
                '<marker id="head" viewBox="0 0 10 10" refX="9" refY="5" '
                'markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
                f'<path d="M 0 0 L 10 5 L 0 10 z" fill="{INK}"/></marker>',
                "</defs>",
                f'<rect width="{self.width}" height="{self.height}" fill="{CANVAS}"/>',
                *self.parts,
                "</svg>",
                "",
            ]
        )

    def write(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(self.render(), encoding="utf8")
        status = "ok" if not self.findings else f"{len(self.findings)} finding(s)"
        print(f"  {path}  {self.width}x{self.height}  {status}")
        for finding in self.findings:
            print(f"    ! {finding}")


# ── the logo plate ────────────────────────────────────────────────────────────

REPO = Path(__file__).resolve().parents[2]


def logo_image(x: float = 40, y: float = 20, height: float = 62) -> str | None:
    """
    The KEPT mark as an `<image>` carrying a base64 data URI.

    The source is a mark on a transparent square with a wide margin — ink at
    (469, 402) measuring 354x401 inside 1254x1254 — so placing the square by its
    own corner gives every header a different-looking pad. The reference method
    hard-codes those ink bounds and offsets the placement by them; this build
    instead pre-trims the PNG to its ink, which is arithmetically the same answer
    with nothing to keep in step. `build_logo.py` writes the trimmed plate.
    """
    plate = Path(__file__).with_name("logo-mark.b64")
    if not plate.exists():
        print("  ! logo-mark.b64 is absent; run build_logo.py. Headers will have no mark.")
        return None
    data = plate.read_text(encoding="utf8").strip()
    meta = Path(__file__).with_name("logo-mark.size").read_text(encoding="utf8").split()
    ink_w, ink_h = int(meta[0]), int(meta[1])
    scale = height / ink_h
    return (
        f'<image x="{x}" y="{y}" width="{ink_w * scale:.2f}" height="{height}" '
        f'xlink:href="data:image/png;base64,{data}" '
        f'href="data:image/png;base64,{data}"/>'
    )


def build_all(diagrams: list[tuple[Diagram, str]]) -> int:
    out = REPO / "Assets"
    total = 0
    for diagram, name in diagrams:
        diagram.write(out / name)
        total += len(diagram.findings)
    return total
