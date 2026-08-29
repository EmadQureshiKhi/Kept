#!/usr/bin/env bash
# Production-build both Next applications, the way Vercel will.
#
# A script rather than an inline command for the reason tools/dev-try.sh gives.
set -euo pipefail
cd "$(dirname "$0")/.."
node node_modules/next/dist/bin/next build "apps/$1"
