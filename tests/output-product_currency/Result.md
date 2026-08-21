---
test: ../product_currency_test.md
status: passed
started: 2026-08-21T01:00:58.670Z
duration_s: 68
session_id: 66ccc5d4-9ba5-4cdc-9394-0b1cca38fc28
---

# Product prices render in the currency chosen in Settings — Result

## Step 1 — choose EUR in Settings ✓ passed (26.3s)
md5: c7d0021263546d3269e838ffd339a2a4
Navigate to http://localhost:3100/settings, wait until the currency options appear and the loading
message is gone, then choose EUR and confirm the status line reads "Showing prices in EUR."

## Step 2 — open the Kepler Reserve product screen ✓ passed (11.3s)
md5: da2644635fe4862ed3aada3d546ab825
Navigate to http://localhost:3100/product/kepler-reserve and wait until the price stops showing an
em dash and reports itself ready.

## Step 3 — assert the price is in euros ✓ passed (23.8s)
md5: c6df5cd9b8e840d45f77ec3c80647219
Assert that the price reads "€22.08" — Kepler Reserve's $24.00 expressed in the currency Settings
holds — and not "$24.00".
