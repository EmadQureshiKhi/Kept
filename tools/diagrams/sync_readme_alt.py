#!/usr/bin/env python3
"""
Copy each diagram's own `<desc>` into the README's alt text for that image.

A diagram is never the only representation of what it shows, so it carries a
`<desc>` in prose for a reader who cannot see it — and the README needs the same
thing as alt text. Two hand-maintained copies of the same paragraph is one copy
too many: the SVG is the source, because that is the file the description ships
inside, and this keeps the README's copy identical to it.

Run it after the diagrams build. `readme-front-matter.test.ts` asserts the two
still agree, so a diagram whose description changed and whose alt text did not is
a test failure rather than a discrepancy nobody notices.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
README = REPO / "README.md"
DESC = re.compile(r'<desc id="d">(.*?)</desc>', re.S)
EMBED = re.compile(r"!\[([\s\S]*?)\]\((Assets/[^)\s]+\.svg)\)")


def unescape(text: str) -> str:
    return text.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")


def wrap(text: str, width: int = 96, indent: str = "") -> str:
    words = text.split()
    lines: list[str] = []
    row = ""
    for word in words:
        candidate = f"{row} {word}".strip()
        if len(candidate) > width and row:
            lines.append(row)
            row = word
        else:
            row = candidate
    if row:
        lines.append(row)
    return f"\n{indent}".join(lines)


def main() -> int:
    readme = README.read_text(encoding="utf8")
    changed = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal changed
        path = match.group(2)
        svg = (REPO / path).read_text(encoding="utf8")
        found = DESC.search(svg)
        if found is None:
            print(f"  ! {path} carries no <desc>; alt text left alone")
            return match.group(0)
        desc = unescape(" ".join(found.group(1).split()))
        replacement = f"![{wrap(desc)}]({path})"
        if replacement != match.group(0):
            changed += 1
            print(f"  synced {path}")
        return replacement

    updated = EMBED.sub(replace, readme)
    if changed:
        README.write_text(updated, encoding="utf8")
    print(f"sync_readme_alt: {changed} alt text block(s) updated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
