#!/usr/bin/env bash
# Author one designed test with Kane, with the fixture application up, in one shell.
#
# Same lifetime problem and same solution as `live-verify.sh`: the fixture has to be
# answering before Kane drives Chrome at it, and in this working environment a server
# cannot outlive the call that started it. So the app and the authoring run share one
# process group, and the app is taken down on every exit path.
#
# **This spends credits.** `testmd run` on a document with no recording authors every
# step, and an authored step is a charge. The eight corpus documents cost between 6.713
# (T-3, five of six steps replayed from a recording) and 38.711 (T-5) credits each,
# itemised per step in `docs/kane/credits.md`. The header used to say "between 6.7 and
# 33.5", which named the wrong document as the ceiling: 33.465 is T-1, and T-5 and T-7
# both cost more than it. A replay of an
# already-recorded document is free, which is why this is a separate script from
# `live-verify.sh` rather than a flag on it: the two have different costs and mixing
# them behind one entry point makes it easy to spend money by accident.
#
# Usage: tools/live-author.sh <test-document> <capture-path>
#   tools/live-author.sh tests/shop_filter_persist_test.md docs/kane/loop/t9-author.ndjson
#
# The capture is written whatever happens, because a refused or crashed stream is
# evidence too and is the only record of what the credits bought.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE_URL="http://localhost:3100"
PROBE_PATH="/shop"
SERVER_LOG="${REPO_ROOT}/.kept/diagnostics/fixture-server.log"
START_TIMEOUT_SECONDS=600

if [ "$#" -ne 2 ]; then
  echo "usage: tools/live-author.sh <test-document> <capture-path>" >&2
  exit 2
fi

DOCUMENT="$1"
CAPTURE="$2"

if [ ! -f "${REPO_ROOT}/${DOCUMENT}" ]; then
  echo "!!  ${DOCUMENT} does not exist, so there is nothing to author." >&2
  exit 2
fi

mkdir -p "$(dirname "${SERVER_LOG}")" "$(dirname "${REPO_ROOT}/${CAPTURE}")"

server_pid=""
cleanup() {
  if [ -n "${server_pid}" ] && kill -0 "${server_pid}" 2>/dev/null; then
    echo "==> stopping the fixture application (pid ${server_pid})"
    kill "${server_pid}" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "${server_pid}" 2>/dev/null || break
      sleep 1
    done
    kill -9 "${server_pid}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

answering() {
  curl -sf -m 5 -o /dev/null "${FIXTURE_URL}${PROBE_PATH}"
}

if answering; then
  echo "==> the fixture application is already answering, leaving it alone"
else
  # The same precheck `live-verify.sh` has, and this script needed it more. `next start`
  # with no build under `apps/fixture/.next` fails with "could not find a production
  # build", and it failed here *after* the operator had already decided to spend credits
  # on an authoring run. The header claimed the same lifetime problem and the same
  # solution as `live-verify.sh` while omitting half of the solution.
  if [ ! -f "${REPO_ROOT}/apps/fixture/.next/BUILD_ID" ]; then
    echo "==> no production build under apps/fixture/.next, building one"
    ( cd "${REPO_ROOT}/apps/fixture" && npx next build ) || exit 1
  fi

  echo "==> starting the fixture application on ${FIXTURE_URL}"
  ( cd "${REPO_ROOT}/apps/fixture" && exec npx next start -p 3100 ) \
    < /dev/null > "${SERVER_LOG}" 2>&1 &
  server_pid="$!"
  waited=0
  until answering; do
    if ! kill -0 "${server_pid}" 2>/dev/null; then
      echo "!!  the fixture application exited before it answered:" >&2
      tail -40 "${SERVER_LOG}" >&2
      exit 1
    fi
    if [ "${waited}" -ge "${START_TIMEOUT_SECONDS}" ]; then
      echo "!!  no answer within ${START_TIMEOUT_SECONDS}s:" >&2
      tail -40 "${SERVER_LOG}" >&2
      exit 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
  echo "==> answering after ${waited}s"
fi

# Piped stdout is the NDJSON enabler for this family, which is why the capture is a pipe
# rather than a flag: `--agent` sets the ask policy, and the machine-readable stream
# appears because stdout is not a terminal.
echo "==> kane-cli testmd run ${DOCUMENT} --agent --bug-detection continue"
echo "==> capturing to ${CAPTURE}"
kane-cli testmd run "${DOCUMENT}" --agent --bug-detection continue \
  > "${REPO_ROOT}/${CAPTURE}" 2>"${REPO_ROOT}/${CAPTURE}.stderr"
status="$?"
echo "==> kane-cli exited ${status}, $(wc -l < "${REPO_ROOT}/${CAPTURE}" | tr -d ' ') line(s) captured"
exit "${status}"
