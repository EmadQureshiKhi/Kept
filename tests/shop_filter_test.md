---
test_id: T-1
tags: [shop, filter, catalog]
covers:
  - apps/fixture/lib/catalog.ts
  - apps/fixture/app/shop/**
---

# Shop lists six coffees and filters them by roast without reloading

<!-- @verifies apps/fixture/README.md:14 the Shop listing and roast filter claim -->

1. Navigate to http://localhost:3100/shop and assert that exactly six coffees are listed and
   that the count line reads "Showing 6 of 6 coffees".
2. Press the "Light roast" filter button and wait until it reports itself as pressed.
3. Assert that the count line now reads "Showing 2 of 6 coffees · Light roast", that exactly
   two coffees are listed, and that both of them are light roasts.
4. Assert that the browser is still on http://localhost:3100/shop and that the page was not
   reloaded — the six coffee cards were replaced in place.

The count line is server-rendered, so step 1 does not wait on hydration. The filter buttons
do need hydration to respond, which is why step 2 waits for the pressed state rather than
asserting the filtered count immediately after the click.
