#!/usr/bin/env python3
"""
A verifier that reports a clean set is only reassuring if it can still fail.

This plants one of each fault `verify.check` looks for and asserts that each is
found. Both real bugs this file caught were of the same shape — a regex that
parsed less than it appeared to — and neither was visible from the output, because
the output was "ok".

Run it as part of the diagram build, before the report anyone trusts.
"""

from __future__ import annotations

import pathlib
import tempfile

import verify

PLANTED = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" \
width="400" height="300" role="img" aria-labelledby="t d">
<title id="t">planted</title><desc id="d">planted</desc>
<rect width="400" height="300" fill="#ffffff"/>
<rect x="20" y="20" width="120" height="80" fill="#f6f6f6" stroke="#111111" stroke-width="2.0"/>
<rect x="100" y="60" width="120" height="80" fill="#ffffff" stroke="#111111" stroke-width="1.4"/>
<polyline points="20,200 380,200" fill="none" stroke="#111111" stroke-width="1.6"/>
<text x="120" y="204" font-size="11" font-weight="600" fill="#111111">a bare label on the line</text>
<text x="360" y="290" font-size="11" fill="#111111">this label runs off the right edge entirely</text>
<rect x="130" y="10" width="80" height="24" fill="#ffffff" stroke="none" stroke-width="0"/>
</svg>
"""

EXPECTED = {
    "boxes overlap": "two stroked boxes partly overlapping",
    "covers the border": "a white label plate over a box border",
    "outside the canvas": "text past the viewBox",
    "text on a line": "a bare label with nothing opaque beneath it",
}


def main() -> int:
    path = pathlib.Path(tempfile.mkdtemp()) / "kept-planted.svg"
    path.write_text(PLANTED, encoding="utf8")
    findings = verify.check(path)

    print("selftest: planted 4 faults")
    for finding in findings:
        print(f"    · {finding}")

    missed = [
        description
        for needle, description in EXPECTED.items()
        if not any(needle in finding for finding in findings)
    ]
    for description in missed:
        print(f"  ! NOT DETECTED: {description}")

    if missed:
        print(f"selftest: {len(missed)} of {len(EXPECTED)} faults went undetected")
        return 1
    print(f"selftest: all {len(EXPECTED)} planted faults detected")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
