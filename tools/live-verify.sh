#!/usr/bin/env bash
# Run one live verification with the fixture application up, inside a single shell.
#
# Why this exists rather than "start the server, then run kept":
#
# The fixture has to be answering on http://localhost:3100 before Kane drives Chrome at
# it, and in this working environment a server cannot outlive the call that started it:
# a backgrounded process is killed with its process group the moment the parent shell
# returns, so `nohup`, `disown` and a detached subshell all die identically. So the
# server and the verification share one process group and one lifetime, which is this
# script. It starts the app, waits for it to actually answer rather than sleeping a
# guessed number of seconds, runs the command it was given, and takes the app down again
# on every exit path including a failure or an interrupt.
#
# Usage: tools/live-verify.sh <kept-args...>
#   tools/live-verify.sh verify --changed apps/fixture/README.md
#   tools/live-verify.sh verify --all
#
# The exit code is the wrapped command's own. `kept` exits 0 for every state of the
# world except mutually exclusive flags, so a non-zero here means the harness failed,
# not that a promise went red.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE_URL="http://localhost:3100"
PROBE_PATH="/shop"
SERVER_LOG="${REPO_ROOT}/.kept/diagnostics/fixture-server.log"
# The fixture is seven client-rendered screens over localStorage, so a production build
# is the same product as a dev one and reads far less from disk. That matters here: this
# tree is on a cloud-synced path where a cold `next dev` can stall past a timeout while
# the file provider materialises placeholders.
# Measured rather than guessed: on this checkout a cold `next start` reported
# "Ready in 2.7min", so a three-minute budget failed on the tick it became ready. The
# app itself is instant once the file provider has materialised what Next reads, which
# is the same latency `vitest.config.ts` and `docs/judge-path.md` both record.
START_TIMEOUT_SECONDS=600

if [ "$#" -eq 0 ]; then
  echo "usage: tools/live-verify.sh <kept-args...>" >&2
  exit 2
fi

mkdir -p "$(dirname "${SERVER_LOG}")"

server_pid=""

cleanup() {
  if [ -n "${server_pid}" ] && kill -0 "${server_pid}" 2>/dev/null; then
    echo "==> stopping the fixture application (pid ${server_pid})"
    kill "${server_pid}" 2>/dev/null || true
    # Give Next a moment to close its listener, then insist.
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
  echo "==> the fixture application is already answering on ${FIXTURE_URL}, leaving it alone"
else
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
      echo "!!  the fixture application exited before it answered. Its output:" >&2
      tail -40 "${SERVER_LOG}" >&2
      exit 1
    fi
    if [ "${waited}" -ge "${START_TIMEOUT_SECONDS}" ]; then
      echo "!!  the fixture application did not answer within ${START_TIMEOUT_SECONDS}s." >&2
      echo "!!  On a cloud-synced checkout this is usually the file provider rather than" >&2
      echo "!!  the app. Its output so far:" >&2
      tail -40 "${SERVER_LOG}" >&2
      exit 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
  echo "==> answering after ${waited}s"
fi

echo "==> kept $*"
node "${REPO_ROOT}/packages/kept-cli/dist/index.js" "$@"
status="$?"
echo "==> kept exited ${status}"
exit "${status}"
