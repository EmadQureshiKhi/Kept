---
mode: testing
url: http://localhost:3100/shop
tags: [shop, filter, catalog]
assurance:
  id: T-1
---

# Shop lists six coffees and filters them by roast without reloading

<!-- @verifies apps/fixture/README.md:14 the Shop listing and roast filter claim -->
<!-- @covers apps/fixture/lib/catalog.ts, apps/fixture/app/shop/** -->

The count line is server-rendered, so step 1 does not wait on hydration. The filter buttons do
need hydration to respond, which is why step 2 waits for the pressed state rather than asserting
the filtered count immediately after the click.

## Step 1 — assert the unfiltered listing

Navigate to http://localhost:3100/shop and assert that exactly six coffees are listed and that
the count line reads "Showing 6 of 6 coffees".

## Step 2 — apply the light roast filter

Press the "Light roast" filter button and wait until it reports itself as pressed.

## Step 3 — assert the filtered listing

Assert that the count line now reads "Showing 2 of 6 coffees · Light roast", that exactly two
coffees are listed, and that both of them are light roasts.

## Step 4 — assert the page was not reloaded

Assert that the browser is still on http://localhost:3100/shop and that the page was not
reloaded — the six coffee cards were replaced in place.
