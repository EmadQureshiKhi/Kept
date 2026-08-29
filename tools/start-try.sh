#!/usr/bin/env bash
# Serve the built try page on 3301, which is what Vercel will run.
#
# Worth checking separately from `next dev`: the client bundle is minified in production, the icon
# routes are emitted rather than generated per request, and a handler's failure paths answer
# differently once React's development warnings are gone.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node node_modules/next/dist/bin/next start apps/try -p 3301
