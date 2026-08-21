---
test: ../settings_currency_test.md
status: passed
started: 2026-08-21T01:02:30.034Z
duration_s: 86
session_id: cc2b070f-ebae-4013-b0e5-c814f28c0a92
---

# Settings keeps the selected currency across a reload — Result

## Step 1 — reach a hydrated Settings screen ✓ passed (14.4s)
md5: 0b3e1ed956d5ad0b4122442b397a7666
Navigate to http://localhost:3100/settings and wait until the currency options appear and
"Loading your preferences" is gone.

## Step 2 — choose EUR ✓ passed (27.4s)
md5: ad5dd2a1dc1bdbc5f26531d2a8cb97a2
Choose EUR and assert that the EUR option is now selected and that the status line reads
"Showing prices in EUR. A $18.00 bag reads as €16.56."

## Step 3 — reload the page ✓ passed (16.4s)
md5: 85f561a938d2a494487f0adc0df49304
Reload the page fully.

## Step 4 — assert EUR survived the reload ✓ passed (21.1s)
md5: f0eaaef0b41a463683b02b99fb384b4f
Wait until the currency options appear and "Loading your preferences" is gone, then assert that
EUR is still the selected option and that the status line still reads
"Showing prices in EUR. A $18.00 bag reads as €16.56."
