#!/usr/bin/env bash
# Kepler Coffee on 3100, the port every designed test drives against.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node node_modules/next/dist/bin/next dev apps/fixture -p 3100
