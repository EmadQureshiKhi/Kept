#!/usr/bin/env bash
# Start the Ledger, fetch every route, report what came back, stop it. One shell.
#
# Same lifetime constraint as `live-verify.sh`: a server cannot outlive the call that
# started it in this working environment, so the server and the checks share one
# process group. This exists so the pages can be *verified* even though they cannot be
# left running, and so a broken route is found here rather than by whoever opens the
# browser.
#
# Reads the committed snapshot only. No Kane, no credentials, no network (R13.2).

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-3000}"
BASE="http://localhost:${PORT}"
LOG="${REPO_ROOT}/.kept/diagnostics/ledger-server.log"
START_TIMEOUT_SECONDS=600

mkdir -p "$(dirname "${LOG}")"

server_pid=""
cleanup() {
  if [ -n "${server_pid}" ] && kill -0 "${server_pid}" 2>/dev/null; then
    echo "==> stopping the Ledger (pid ${server_pid})"
    kill "${server_pid}" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "${server_pid}" 2>/dev/null || break
      sleep 1
    done
    kill -9 "${server_pid}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

answering() { curl -sf -m 5 -o /dev/null "${BASE}/"; }

if answering; then
  echo "==> already answering on ${BASE}, leaving it alone"
else
  echo "==> starting the Ledger on ${BASE}"
  # The workspace-root `next`, run by this Node, with the app as cwd. The spelling
  # `scripts/demo.mjs` settled on, and for its reasons: `apps/ledger` has no
  # `package.json`, so there is no `npm run dev -w` to lean on.
  ( cd "${REPO_ROOT}/apps/ledger" \
      && exec node "${REPO_ROOT}/node_modules/next/dist/bin/next" dev -p "${PORT}" ) \
    < /dev/null > "${LOG}" 2>&1 &
  server_pid="$!"
  waited=0
  until answering; do
    if ! kill -0 "${server_pid}" 2>/dev/null; then
      echo "!!  the Ledger exited before it answered:" >&2
      tail -30 "${LOG}" >&2
      exit 1
    fi
    if [ "${waited}" -ge "${START_TIMEOUT_SECONDS}" ]; then
      echo "!!  no answer within ${START_TIMEOUT_SECONDS}s:" >&2
      tail -30 "${LOG}" >&2
      exit 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
  echo "==> answering after ${waited}s"
fi

echo ""
printf '%-22s %-6s %-10s %s\n' ROUTE CODE BYTES NOTE
failed=0
# The real route list, derived once from `apps/ledger/app` rather than guessed. The
# promise graph and the evidence lane are on `/`, not on routes of their own, which a
# first version of this script assumed and got two 404s for.
for route in / /coverage /runs /reviews /amendments /badge.svg; do
  body="$(mktemp)"
  code="$(curl -s -m 60 -o "${body}" -w '%{http_code}' "${BASE}${route}")"
  bytes="$(wc -c < "${body}" | tr -d ' ')"
  note=""
  # A Next error page answers 200 with a recognisable shell, so the code alone is not
  # enough: a route that renders an error is a broken route.
  if grep -qi 'Application error\|Unhandled Runtime Error\|__NEXT_ERROR' "${body}"; then
    note="RENDERED AN ERROR"
    failed=$((failed + 1))
  elif [ "${code}" != "200" ]; then
    note="unexpected status"
    failed=$((failed + 1))
  fi
  printf '%-22s %-6s %-10s %s\n' "${route}" "${code}" "${bytes}" "${note}"
  rm -f "${body}"
done

echo ""
if [ "${failed}" -eq 0 ]; then
  echo "==> every route answered 200 and rendered without an error page"
else
  echo "!!  ${failed} route(s) did not render cleanly" >&2
fi
exit "${failed}"
