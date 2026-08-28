#!/usr/bin/env bash
# Start the Ledger, pull the figures a reader would see off each page, stop it.
#
# A companion to `check-ledger-routes.sh`: that one asks whether the pages render, this
# one asks what they say. Both exist because a server cannot outlive the call that
# started it in this working environment, so anything to be read off a running page has
# to be read inside the same shell that started it.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-3000}"
BASE="http://localhost:${PORT}"
LOG="${REPO_ROOT}/.kept/diagnostics/ledger-server.log"

mkdir -p "$(dirname "${LOG}")"
server_pid=""
cleanup() {
  if [ -n "${server_pid}" ] && kill -0 "${server_pid}" 2>/dev/null; then
    kill "${server_pid}" 2>/dev/null || true
    for _ in 1 2 3 4 5; do kill -0 "${server_pid}" 2>/dev/null || break; sleep 1; done
    kill -9 "${server_pid}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM
answering() { curl -sf -m 5 -o /dev/null "${BASE}/"; }

if ! answering; then
  ( cd "${REPO_ROOT}/apps/ledger" \
      && exec node "${REPO_ROOT}/node_modules/next/dist/bin/next" dev -p "${PORT}" ) \
    < /dev/null > "${LOG}" 2>&1 &
  server_pid="$!"
  waited=0
  until answering; do
    kill -0 "${server_pid}" 2>/dev/null || { tail -20 "${LOG}" >&2; exit 1; }
    [ "${waited}" -ge 600 ] && { tail -20 "${LOG}" >&2; exit 1; }
    sleep 2; waited=$((waited + 2))
  done
  echo "(started in ${waited}s)"
fi

# Tags stripped and whitespace collapsed, so a grep reads the page as a reader does.
text() { curl -s -m 60 "${BASE}$1" | sed 's/<[^>]*>/ /g' | tr -s ' \n\t' ' '; }

echo ""
echo "=== / (the landing view and the promise graph) ==="
text / | grep -oE '[0-9]+ of [0-9]+ (promises|proven)|[0-9]+% proven|proven [0-9]+%|13 promises|baseline data only' | sort -u | head
echo ""
echo "=== /coverage (the dual-axis ribbon, new since the old recording) ==="
text /coverage | grep -oE '[0-9]+/[0-9]+|[0-9]+% |use cases with scenarios|acceptance criteria[a-z ]*|withheld' | sort -u | head -14
echo ""
echo "=== the use-case caveat, in the words a reader sees ==="
text /coverage | grep -oE "This denominator[^.]*\." | head -1
echo ""
echo "=== /runs ==="
text /runs | grep -oE '[0-9]+ runs?|testrun_done|Assurance|ExecutionTestrun' | sort -u | head -6
echo ""
echo "=== /amendments and /reviews ==="
text /amendments | grep -oE 'pending|am_[0-9a-f]+' | sort -u | head -3
text /reviews | grep -oE 'no held change[a-z ]*|rc_[0-9a-f]+' | sort -u | head -3
echo ""
echo "=== /badge.svg ==="
curl -s -m 30 "${BASE}/badge.svg" | grep -oE '>[^<]*</text>' | head -4
