---
mode: testing
url: http://localhost:3100/settings
tags: [settings, currency, persistence]
assurance:
  id: T-6
---

# Settings keeps the selected currency across a reload

<!-- @verifies apps/fixture/README.md:19 the Settings persistence claim -->
<!-- @covers apps/fixture/lib/storage.ts, apps/fixture/app/providers.tsx, apps/fixture/app/settings/** -->

The currency radio group and the status line both render only after hydration — before it the
screen shows a `role="status"` "Loading your preferences" region — so the first and the last step
wait for that region to disappear. The last step in particular has to: the whole point of the
claim is what the screen reads once the stored preference has been read back, and asserting during
the loading state would either see nothing or see the default.

## Step 1 — reach a hydrated Settings screen

Navigate to http://localhost:3100/settings and wait until the currency options appear and
"Loading your preferences" is gone.

## Step 2 — choose EUR

Choose EUR and assert that the EUR option is now selected and that the status line reads
"Showing prices in EUR. A $18.00 bag reads as €16.56."

## Step 3 — reload the page

Reload the page fully.

## Step 4 — assert EUR survived the reload

Wait until the currency options appear and "Loading your preferences" is gone, then assert that
EUR is still the selected option and that the status line still reads
"Showing prices in EUR. A $18.00 bag reads as €16.56."
