---
test: ../home_cta_test.md
status: passed
started: 2026-08-21T00:52:25.747Z
duration_s: 88
session_id: 1dcf7a72-fb3c-453a-a0bc-ad1baeaecd45
---

# Home's primary call to action reaches the Shop screen — Result

## Step 1 — assert the hero call to action ✓ passed (22.8s)
md5: e703435c5ce67a32de8cc1f0d53f4446
Navigate to http://localhost:3100/ and assert that the hero shows a link whose name is
"Shop all six coffees".

## Step 2 — activate the link ✓ passed (16.9s)
md5: e6ce0f4a9c85ce2aa8112fb0b80ed358
Activate that link.

## Step 3 — assert the Shop screen was reached ✓ passed (31.1s)
md5: 431cbf01b0048c9fdf6148b7a9e897f0
Assert that the browser is now on http://localhost:3100/shop and that the Shop screen reads
"Showing 6 of 6 coffees".
