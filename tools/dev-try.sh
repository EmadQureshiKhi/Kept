#!/usr/bin/env bash
# Boot apps/try on 3300, clear of the Ledger (3000) and the fixture (3100).
#
# A script rather than an inline command because this repository is on an iCloud-synced Desktop and
# the shell bridge here has been observed dropping the first character of a command it is handed.
# A file cannot lose its first character.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node node_modules/next/dist/bin/next dev apps/try -p 3300
