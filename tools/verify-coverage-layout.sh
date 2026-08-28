#!/usr/bin/env bash
# Start the Ledger, prove /coverage is laid out rather than jumbled, stop it. One shell.
#
# The specific check this exists for: the dual-axis ribbon shipped with eight class
# names no stylesheet defined, so its four spans per axis rendered inline and ran
# together into one unreadable line. Content assertions could not see it, because
# `textContent` is identical either way. This asks the two questions that could:
# does the markup carry the classes, and does the CSS the server actually serves
# define them.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-3000}"
BASE="http://localhost:${PORT}"
LOG="${REPO_ROOT}/.kept/diagnostics/ledger-server.log"

mkdir -p "$(dirname "${LOG}")"
server_pid=""
cleanup() {
  if [ -n "${server_pid}" ] && kill -0 "${server_pid}" 2>/dev/null; then
    echo "==> stopping the Ledger (pid ${server_pid})"
    kill "${server_pid}" 2>/dev/null || true
    for _ in 1 2 3 4 5; do kill -0 "${server_pid}" 2>/dev/null || break; sleep 1; done
    kill -9 "${server_pid}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# A fresh listener every time, deliberately. A leftover process from an earlier run
# answered the readiness probe and then died mid-fetch, which read as a served page of
# zero bytes. Reusing a server nobody started in this shell is not worth the ambiguity.
if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN -t > /dev/null 2>&1; then
  echo "==> port ${PORT} was held by an earlier process; replacing it"
  lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN -t 2>/dev/null | xargs kill -9 2>/dev/null || true
  sleep 2
fi

echo "==> starting the Ledger on ${BASE}"
( cd "${REPO_ROOT}/apps/ledger" \
    && exec node "${REPO_ROOT}/node_modules/next/dist/bin/next" dev -p "${PORT}" ) \
  < /dev/null > "${LOG}" 2>&1 &
server_pid="$!"

waited=0
until curl -sf -m 5 -o /dev/null "${BASE}/coverage"; do
  kill -0 "${server_pid}" 2>/dev/null || { echo "!! server exited:" >&2; tail -25 "${LOG}" >&2; exit 1; }
  [ "${waited}" -ge 600 ] && { echo "!! no answer in ${waited}s" >&2; tail -25 "${LOG}" >&2; exit 1; }
  sleep 2; waited=$((waited + 2))
done
echo "==> answering after ${waited}s"

page="$(mktemp)"
curl -s -m 90 -o "${page}" "${BASE}/coverage"
echo "==> /coverage is $(wc -c < "${page}" | tr -d ' ') bytes"

fail=0
echo ""
echo "-- the markup carries the ribbon's classes"
for class in coverage-axes coverage-axis coverage-axis__ratio coverage-axis__detail; do
  if grep -q "${class}" "${page}"; then
    echo "   ok   ${class}"
  else
    echo "   MISS ${class}"; fail=$((fail + 1))
  fi
done

echo ""
echo "-- the served CSS defines them, which is what was missing"
sheets="$(grep -oE '/_next/static/css/[^"]+\.css' "${page}" | sort -u)"
if [ -z "${sheets}" ]; then
  echo "   !! the page links no stylesheet at all"; fail=$((fail + 1))
else
  css="$(mktemp)"
  for sheet in ${sheets}; do curl -s -m 60 "${BASE}${sheet}" >> "${css}"; done
  echo "   $(printf '%s\n' ${sheets} | wc -l | tr -d ' ') sheet(s), $(wc -c < "${css}" | tr -d ' ') bytes"
  for rule in '.coverage-axis' '.coverage-axes' '.coverage-pending' '.promise-node__verdict'; do
    if grep -qF "${rule}" "${css}"; then
      echo "   ok   ${rule} is defined"
    else
      echo "   MISS ${rule} is rendered and undefined"; fail=$((fail + 1))
    fi
  done
  # The declaration that actually un-jumbles it: without a block context the four
  # spans go back to being inline and the line runs together again.
  if grep -qE '\.coverage-axis\{[^}]*display:grid' "${css}" \
    || grep -qE '\.coverage-axis \{[^}]*display: *grid' "${css}"; then
    echo "   ok   .coverage-axis establishes a grid"
  else
    echo "   note could not confirm display:grid in the minified sheet"
  fi
  rm -f "${css}"
fi

echo ""
echo "-- what a reader sees, tags stripped"
sed 's/<[^>]*>/ /g' "${page}" | tr -s ' \n\t' ' ' \
  | grep -oE "designed, acceptance criteria [^%]{0,60}" | head -2
rm -f "${page}"

echo ""
if [ "${fail}" -eq 0 ]; then
  echo "==> /coverage carries the classes and the served CSS defines them"
else
  echo "!!  ${fail} check(s) failed" >&2
fi
exit "${fail}"
