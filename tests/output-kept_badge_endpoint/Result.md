---
test: ../kept_badge_endpoint_test.md
status: passed
started: 2026-08-26T06:29:02.121Z
duration_s: 58
session_id: 8073bb3d-fbdf-4d01-9dac-238946eb5ceb
---

# The badge endpoint answers a GET with an SVG carrying a whole-number percentage — Result

## Step 1: request the badge ✓ passed (15.7s)
md5: 128ffae64d2b95c31ae9459e444eb513
Navigate to http://localhost:3000/badge.svg and wait until the image has rendered.

## Step 2: assert the badge carries its label and a percentage ✓ passed (35.5s)
md5: cb383c516864be5676bcf75ad3909c5f
Assert that the rendered image shows the text "promises kept" and that the value beside it
ends with the character "%".
