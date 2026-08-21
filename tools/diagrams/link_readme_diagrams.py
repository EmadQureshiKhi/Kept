#!/usr/bin/env python3
"""
Make every README diagram clickable, opening the SVG at full size.

The canvases are 1740px wide and GitHub's content column is roughly 870, so every
diagram is being downscaled about 2x where it sits in the page. The detail is
still *there* — they are vectors — but a reader has no way to reach it unless the
image is a link to itself.

So each embed becomes:

    [![alt text](Assets/x.svg)](Assets/x.svg)

which opens the file's own page, where the SVG renders standalone and browser zoom
is lossless at any depth. That is as far as a README can go: GitHub strips script
and inline handlers from rendered Markdown, so zoom controls and drag-to-pan are
not available in the page itself at any price.

A short caption goes under each one, because "this image is a link" is not a
convention a reader can be assumed to know, and the whole point is reaching detail
that is invisible at the rendered size.

Idempotent — an already-linked embed is left alone.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
README = REPO / "README.md"

#: A bare image embed: not already preceded by `[`, so a re-run is a no-op.
BARE = re.compile(r"(?<!\[)!\[([\s\S]*?)\]\((Assets/[^)\s]+\.svg)\)")

CAPTION = "<sub>Click the diagram to open it at full size.</sub>"


def main() -> int:
    readme = README.read_text(encoding="utf8")
    linked = 0

    def wrap(match: re.Match[str]) -> str:
        nonlocal linked
        alt, path = match.group(1), match.group(2)
        linked += 1
        return f"[![{alt}]({path})]({path})"

    updated = BARE.sub(wrap, readme)

    # One caption per linked diagram, inserted after the embed's blank line.
    captioned = 0
    lines = updated.split("\n")
    out: list[str] = []
    for i, line in enumerate(lines):
        out.append(line)
        closes_embed = line.rstrip().endswith(".svg)") and "![" in "\n".join(
            lines[max(0, i - 12): i + 1]
        )
        if not closes_embed:
            continue
        following = lines[i + 1: i + 3]
        if any(CAPTION in row for row in following):
            continue
        out.append("")
        out.append(CAPTION)
        captioned += 1

    README.write_text("\n".join(out), encoding="utf8")
    print(f"link_readme_diagrams: {linked} embed(s) linked, {captioned} caption(s) added")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
