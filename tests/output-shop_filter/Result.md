---
test: ../shop_filter_test.md
status: passed
started: 2026-08-21T00:57:55.847Z
duration_s: 123
session_id: 909760af-11ff-4cb5-8e6d-07f003ce4f73
---

# Shop lists six coffees and filters them by roast without reloading — Result

## Step 1 — assert the unfiltered listing ✓ passed (28.4s)
md5: 5ec85da832ea0fbe02b0df44097ab9cb
Navigate to http://localhost:3100/shop and assert that exactly six coffees are listed and that
the count line reads "Showing 6 of 6 coffees".

## Step 2 — apply the light roast filter ✓ passed (18.1s)
md5: 703b602a59140d19cf31730145705eea
Press the "Light roast" filter button and wait until it reports itself as pressed.

## Step 3 — assert the filtered listing ✓ passed (39.9s)
md5: 776030d5915b2918d5980f9cac97b791
Assert that the count line now reads "Showing 2 of 6 coffees · Light roast", that exactly two
coffees are listed, and that both of them are light roasts.

## Step 4 — assert the page was not reloaded ✓ passed (29.4s)
md5: 4461f18b35363ab9e9074c7edc486f3c
Assert that the browser is still on http://localhost:3100/shop and that the page was not
reloaded — the six coffee cards were replaced in place.
