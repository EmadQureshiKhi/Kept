#!/usr/bin/env python3
"""
The diagram header mark, as a base64 plate `svglib` embeds.

## Why embed rather than reference

An SVG rendered through an `<img>` tag — which is what a Markdown image is —
does not load external subresources. So a diagram whose header referenced
`kept-mark.png` renders correctly in a local preview and comes out with a hole in
it on the site, which is a failure mode that survives every check short of
looking at the published page. Embedding as a data URI makes each diagram one
self-contained file with nothing to fetch.

## Why the ink is trimmed rather than offset

The reference method measures the visible ink inside the transparent square once,
hard-codes those bounds, and places the mark by where its ink starts rather than
where its canvas starts — otherwise every header carries a different mysterious
pad. `tools/logo/build_logo.sh` reaches the same answer by trimming the PNG to
its ink up front, so `Assets/kept-mark.png` *is* the ink and can be placed by its
own corner. Arithmetically identical, with one fewer constant to keep in step.

The size is written beside the plate so `svglib` can scale by the real aspect
ratio instead of assuming a square.
"""

from __future__ import annotations

import base64
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
MARK = REPO / "Assets" / "kept-mark.png"

#: The header renders the mark 62px high, so 124 is 2x and enough for any display
#: anyone will read this on. Measured: 240px costs 36.5 kB of base64 in *every*
#: diagram, 140 costs 16.7 kB and 124 costs 14.4 kB — so the tail of that curve is
#: bytes in five files for detail no reader can resolve.
TARGET_HEIGHT = 124


def main() -> int:
    if not MARK.exists():
        print(f"build_logo: {MARK} is absent — run tools/logo/build_logo.sh first", file=sys.stderr)
        return 1

    source = MARK
    scratch: Path | None = None

    # Downscale when ImageMagick is available, and skip silently when it is not:
    # a heavier file is a much smaller problem than a build that refuses to run.
    if shutil.which("magick") is not None:
        scratch = HERE / ".logo-scratch.png"
        subprocess.run(
            ["magick", str(MARK), "-resize", f"x{TARGET_HEIGHT}", "-strip",
             f"PNG32:{scratch}"],
            check=True,
        )
        source = scratch

    from PIL import Image  # only needed for the measurement

    with Image.open(source) as image:
        width, height = image.size

    data = base64.b64encode(source.read_bytes()).decode("ascii")
    (HERE / "logo-mark.b64").write_text(data, encoding="utf8")
    (HERE / "logo-mark.size").write_text(f"{width} {height}\n", encoding="utf8")

    if scratch is not None:
        scratch.unlink(missing_ok=True)

    print(f"build_logo: mark {width}x{height}, {len(data)} base64 chars")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
