#!/usr/bin/env bash
# Run a command with both applications up, in one shell, then take them down.
#
# The generalisation of `live-verify.sh` and `live-author.sh`, and the reason it exists is
# the same: in this working environment a server cannot outlive the call that started it,
# so anything that needs one has to share a process group with it. Those two scripts start
# only the fixture on 3100, which is all a fixture-cited test needs. A test cited to KEPT's
# own README targets the **Ledger** on 3000, and `kept_demo_boot_test.md` asserts both ports
# in one document, so both have to be up at once.
#
# Usage: tools/with-apps.sh <command...>
#   tools/with-apps.sh kane-cli testmd run tests/kept_badge_endpoint_test.md --agent
#   tools/with-apps.sh node bin/kept verify --all --member-debug
#
# The exit code is the wrapped command's own.
#
# **This can spend credits**, because what it wraps may. It is a harness and takes no view;
# the command decides. `testmd run` on a document with no recording authors every step and
# every authored step is a charge, itemised per document in `docs/kane/credits.md`. A replay
# of a recorded document is free.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEXT_BIN="${REPO_ROOT}/node_modules/next/dist/bin/next"
LOG_DIR="${REPO_ROOT}/.kept/diagnostics"
START_TIMEOUT_SECONDS=600

if [ "$#" -eq 0 ]; then
  echo "usage: tools/with-apps.sh <command...>" >&2
  exit 2
fi

if [ ! -f "${NEXT_BIN}" ]; then
  echo "!!  Next is not installed at ${NEXT_BIN}. Run npm ci at the repository root." >&2
  exit 1
fi

mkdir -p "${LOG_DIR}"

# label:directory:port:probe-path
SERVICES=(
  "ledger:apps/ledger:3000:/"
  "fixture:apps/fixture:3100:/shop"
)

pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do
    [ -z "${pid}" ] && continue
    kill -0 "${pid}" 2>/dev/null || continue
    echo >&2 "==> stopping pid ${pid}"
    kill "${pid}" 2>/dev/null || true
  done
  # One grace pass, then insist, so a wedged Next does not hold the ports.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    local_alive=0
    for pid in "${pids[@]:-}"; do
      [ -z "${pid}" ] && continue
      kill -0 "${pid}" 2>/dev/null && local_alive=1
    done
    [ "${local_alive}" -eq 0 ] && break
    sleep 1
  done
  for pid in "${pids[@]:-}"; do
    [ -z "${pid}" ] && continue
    kill -9 "${pid}" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

answering() { curl -sf -m 5 -o /dev/null "http://localhost:$1$2"; }

for service in "${SERVICES[@]}"; do
  IFS=: read -r label directory port probe <<< "${service}"

  if answering "${port}" "${probe}"; then
    echo >&2 "==> ${label} already answering on ${port}, leaving it alone"
    pids+=("")
    continue
  fi

  # A stale listener that answers the readiness probe and then dies mid-request reads as a
  # served page of zero bytes, which cost an hour once. If the port is held but not
  # answering, it is replaced rather than waited on.
  if lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t > /dev/null 2>&1; then
    echo >&2 "==> port ${port} is held but not answering; replacing that process"
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null | xargs kill -9 2>/dev/null || true
    sleep 2
  fi

  echo >&2 "==> starting ${label} on ${port}"
  ( cd "${REPO_ROOT}/${directory}" && exec node "${NEXT_BIN}" dev -p "${port}" ) \
    < /dev/null > "${LOG_DIR}/${label}-server.log" 2>&1 &
  pids+=("$!")
done

for service in "${SERVICES[@]}"; do
  IFS=: read -r label directory port probe <<< "${service}"
  waited=0
  until answering "${port}" "${probe}"; do
    if [ "${waited}" -ge "${START_TIMEOUT_SECONDS}" ]; then
      echo "!!  ${label} did not answer on ${port} within ${START_TIMEOUT_SECONDS}s:" >&2
      tail -30 "${LOG_DIR}/${label}-server.log" >&2
      exit 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
  echo >&2 "==> ${label} answering on ${port} after ${waited}s"
done

echo >&2 "==> $*"
"$@"
status="$?"
echo >&2 "==> exited ${status}"
exit "${status}"
