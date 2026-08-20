---
test_id: T-8
tags: [product, currency, settings]
covers:
  - apps/fixture/lib/currency.ts
  - apps/fixture/app/components/price.tsx
  - apps/fixture/app/product/**
  - apps/fixture/app/settings/**
---

# Product prices render in the currency chosen in Settings

<!-- @verifies apps/fixture/README.md:15 the Product currency claim -->

1. Navigate to http://localhost:3100/settings, wait until the currency options appear and the
   loading message is gone, then choose EUR and confirm the status line reads
   "Showing prices in EUR."
2. Navigate to http://localhost:3100/product/kepler-reserve and wait until the price stops
   showing an em dash and reports itself ready.
3. Assert that the price reads "€22.08" — Kepler Reserve's $24.00 expressed in the currency
   Settings holds — and not "$24.00".

The price is the assertion target and it renders an em dash with `data-ready="false"` until
the chosen currency is known, so step 2 waits for the ready state instead of reading the
figure straight after navigation. Reading it too early would see the dash and the test would
be flaky rather than wrong.
