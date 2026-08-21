#!/usr/bin/env bash
#
# Build the logo plates, then every diagram, then verify, then rasterise.
#
# Deliberately **not** `set -e` around the generators. Each one width-checks every
# label it draws and the verifier checks the finished files, and the point of both
# is to surface every finding in one pass — a build that stops on the first one
# reports one fault per run and takes five runs to tell you what it already knew.
# So findings are collected, the run continues, and the exit status at the end
# says whether anything was found.
#
# Vectors are the tracked deliverable the README renders. The rasters exist only
# for upload forms and slide decks that will not take a vector.

set -uo pipefail
cd "$(dirname "$0")/.."

DIAGRAMS=(
  kept-architecture
  kept-three-contracts
  kept-verify-path
  kept-repair-branches
  kept-promise-lifecycle
)

status=0

echo "── logo plates ─────────────────────────────────────────────────────────"
bash tools/logo/build_logo.sh || status=1
python3 tools/diagrams/build_logo.py || status=1

echo
echo "── the verifier can still fail ─────────────────────────────────────────"
( cd tools/diagrams && python3 selftest.py ) || status=1

echo
echo "── diagrams ────────────────────────────────────────────────────────────"
for generator in build_architecture build_contracts build_flows build_analysis; do
  ( cd tools/diagrams && python3 "$generator.py" ) || status=1
done

echo
echo "── collision check, before any raster ──────────────────────────────────"
( cd tools/diagrams && python3 verify.py ) || status=1

echo
echo "── the README's alt text, from each diagram's own <desc> ────────────────"
python3 tools/diagrams/sync_readme_alt.py || status=1
python3 tools/diagrams/link_readme_diagrams.py || status=1

echo
echo "── rasters ─────────────────────────────────────────────────────────────"
if command -v rsvg-convert >/dev/null 2>&1; then
  for name in "${DIAGRAMS[@]}"; do
    rsvg-convert -w 2900 -b white "Assets/$name.svg" -o "Assets/$name.png" || status=1
    chmod 644 "Assets/$name.png"
    printf '  %-34s %s\n' "$name.png" "$(du -h "Assets/$name.png" | cut -f1)"
  done
  # macOS tags anything a script writes; strip the flag rather than prompt later.
  xattr -c Assets/*.png 2>/dev/null || true
else
  echo "  rsvg-convert is absent, so no rasters were written. The SVGs are the"
  echo "  deliverable, so this is a note rather than a failure."
fi

echo
if [[ $status -eq 0 ]]; then
  echo "build-diagrams: clean"
else
  echo "build-diagrams: finished with findings — see above"
fi
exit $status
