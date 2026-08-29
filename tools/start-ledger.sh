#!/usr/bin/env bash
# Serve the built Ledger on 3200, which is the port tools/verify-e2e.mjs reads by default.
#
# Production rather than dev on purpose: a non-GET request answers 200 under `next dev` and 405
# under `next start`, and the 405 is the behaviour the deployed artefact has. Verifying the
# read-only claim against a dev server would pass for the wrong reason.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node node_modules/next/dist/bin/next start apps/ledger -p 3200
