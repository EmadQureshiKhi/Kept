#!/usr/bin/env bash
# Demo readiness smoke test: every route a judge or a demo will visit, checked for a
# status code AND for content that proves the page actually rendered its own subject.
#
# A status code alone is not enough. Next answers 200 for a page whose body is an error
# boundary, and grepping the HTML for the word "error" gives a false positive on every dev
# build, because the framework bakes its own error strings into the client bundle. So each
# route names a marker that only appears when the real page rendered.
#
# Usage: tools/with-apps.sh bash tools/demo-smoke.sh

set -uo pipefail

LEDGER=http://localhost:3000
FIXTURE=http://localhost:3100

fails=0

# url|expected-status|marker that proves the page rendered its own content
ROUTES=(
  "${LEDGER}/|200|hero-title"
  "${LEDGER}/coverage|200|coverage-axis__ratio"
  "${LEDGER}/runs|200|runs-page"
  "${LEDGER}/reviews|200|reviews"
  "${LEDGER}/amendments|200|amendment"
  "${LEDGER}/badge.svg|200|<svg"
  "${FIXTURE}/|200|Kepler Coffee"
  "${FIXTURE}/shop|200|coffee-card"
  "${FIXTURE}/cart|200|Cart"
  "${FIXTURE}/checkout|200|Checkout"
  "${FIXTURE}/orders|200|Orders"
  "${FIXTURE}/settings|200|Settings"
  "${FIXTURE}/product/orion-house-blend|200|Orion House Blend"
  "${FIXTURE}/product/cassini-ethiopia|200|Cassini Ethiopia"
)

printf '%-52s %-6s %-10s %s\n' ROUTE CODE BYTES CONTENT

for entry in "${ROUTES[@]}"; do
  url="${entry%%|*}"
  rest="${entry#*|}"
  want_status="${rest%%|*}"
  marker="${rest#*|}"
  marker="${marker%%|*}"

  # One request, not two. Two meant the status and the body could come from different
  # renders, and on a cold Turbopack compile the first of them is the one that has not
  # finished, so a page that was fine reported its marker missing.
  curl -sS --max-time 60 -o /tmp/demo-smoke-body -w '%{http_code}' "${url}" > /tmp/demo-smoke-code 2>/dev/null
  code="$(cat /tmp/demo-smoke-code)"
  bytes="$(wc -c < /tmp/demo-smoke-body | tr -d ' ')"

  note=ok
  if [ "${code}" != "${want_status}" ]; then
    note="STATUS want ${want_status}"
    fails=$((fails + 1))
  # Grep the file, never a shell variable. A 145 KB page held in `$(...)` came back
  # without its markers, because command substitution is not safe for arbitrary bytes.
  elif ! grep -qF "${marker}" /tmp/demo-smoke-body; then
    note="MISSING '${marker}'"
    fails=$((fails + 1))
  fi

  printf '%-52s %-6s %-10s %s\n' "${url#http://localhost}" "${code}" "${bytes}" "${note}"
done

echo
# The badge is the one route whose exact payload is a claim in the root README (line 679),
# so it gets a second look: a GET, SVG, and a whole-number percentage.
curl -sS --max-time 30 -o /tmp/demo-badge "${LEDGER}/badge.svg"
ctype="$(curl -sS --max-time 30 -o /dev/null -w '%{content_type}' "${LEDGER}/badge.svg")"
pct="$(grep -oE ">[0-9]+%<" /tmp/demo-badge | head -1)"
echo "badge content-type : ${ctype}"
echo "badge percentage   : ${pct:-NONE}"
case "${ctype}" in *svg*) ;; *) echo "!!  badge is not SVG"; fails=$((fails + 1));; esac
[ -n "${pct}" ] || { echo "!!  badge shows no whole-number percentage"; fails=$((fails + 1)); }

# A non-GET must not be served, which is the deployed-artefact claim at README line 301.
for verb in POST PUT DELETE; do
  code="$(curl -sS --max-time 30 -o /dev/null -w '%{http_code}' -X "${verb}" "${LEDGER}/badge.svg")"
  echo "badge ${verb} -> ${code}"
  case "${code}" in 405|404|400|501) ;; *) echo "!!  ${verb} was accepted"; fails=$((fails + 1));; esac
done

echo
if [ "${fails}" -eq 0 ]; then
  echo "==> demo smoke: every route answered and rendered its own content"
else
  echo "==> demo smoke: ${fails} problem(s)"
fi
exit "${fails}"
