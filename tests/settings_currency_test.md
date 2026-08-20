---
test_id: T-6
tags: [settings, currency, persistence]
covers:
  - apps/fixture/lib/storage.ts
  - apps/fixture/app/providers.tsx
  - apps/fixture/app/settings/**
---

# Settings keeps the selected currency across a reload

<!-- @verifies apps/fixture/README.md:19 the Settings persistence claim -->

1. Navigate to http://localhost:3100/settings and wait until the currency options appear and
   "Loading your preferences" is gone.
2. Choose EUR and assert that the EUR option is now selected and that the status line reads
   "Showing prices in EUR. A $18.00 bag reads as €16.56."
3. Reload the page fully.
4. Wait until the currency options appear and "Loading your preferences" is gone, then assert
   that EUR is still the selected option and that the status line still reads
   "Showing prices in EUR. A $18.00 bag reads as €16.56."

The currency radio group and the status line both render only after hydration — before it the
screen shows a `role="status"` "Loading your preferences" region — so steps 1 and 4 wait for
that region to disappear. Step 4 in particular has to: the whole point of the claim is what
the screen reads once the stored preference has been read back, and asserting during the
loading state would either see nothing or see the default.
