---
mode: testing
url: http://localhost:3100/product/orion-house-blend
tags: [orders, persistence, checkout]
assurance:
  id: T-5
---

# A completed order is listed on Orders and survives a reload

<!-- @verifies apps/fixture/README.md:18 the Orders history claim -->
<!-- @covers apps/fixture/lib/orders.ts, apps/fixture/lib/storage.ts, apps/fixture/app/orders/**, apps/fixture/app/checkout/** -->

The order number is read from the screen rather than written into the test, because `KC-1001` is
only the first order of a fresh browser profile and a profile carrying earlier orders would number
this one differently. What the claim promises is that whatever Orders lists survives a reload, and
that is what the last two steps compare.

Those two steps say **store … as `<name>`** rather than "read", because the first authoring run
of this document proved the difference matters: "read the order count and its order number and its
total" left the values as unresolved template placeholders, the post-reload comparison had nothing
to compare against, and the run stalled at `stuck.ap_stuck` with an `automation_bug` verdict
rather than failing an assertion. The named-store idiom is the one Kane writes for itself, and it
carries the same intent — capture what the screen says, then compare after the reload.

`/orders` renders a `role="status"` "Loading your orders" region before hydration and shows
"No orders yet." when the store really is empty, so both reads wait for the loading region to
disappear. Asserting straight after the reload would race hydration and could see the empty state
on a screen that is about to render the order.

## Step 1 — add one bag of Orion House Blend

Navigate to http://localhost:3100/product/orion-house-blend, wait until the price reads "$18.00",
then press "Add to cart".

## Step 2 — fill in the checkout details

Navigate to http://localhost:3100/checkout, wait until the Order summary panel stops showing
"Loading your cart", then fill "Full name" with "Ada Lovelace", "Email" with "ada@example.com" and
"Delivery address" with "12 Orbit Way, Bristol".

## Step 3 — place the order

Press "Place order" and assert that the browser lands on http://localhost:3100/orders.

## Step 4 — store what Orders lists

Wait until "Loading your orders" is gone. Store the number of orders listed as
baseline_order_count, store the order number shown on the newest order as baseline_order_number,
and store the total shown on that same order as baseline_order_total.

## Step 5 — assert the order survives a full reload

Reload the page fully and wait until "Loading your orders" is gone again. Assert the number of
orders listed equals baseline_order_count, and assert the newest order still shows the order
number baseline_order_number and the total baseline_order_total.
