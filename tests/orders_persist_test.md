---
test_id: T-5
tags: [orders, persistence, checkout]
covers:
  - apps/fixture/lib/orders.ts
  - apps/fixture/lib/storage.ts
  - apps/fixture/app/orders/**
  - apps/fixture/app/checkout/**
---

# A completed order is listed on Orders and survives a reload

<!-- @verifies apps/fixture/README.md:18 the Orders history claim -->

1. Navigate to http://localhost:3100/product/orion-house-blend, wait until the price reads
   "$18.00", then press "Add to cart".
2. Navigate to http://localhost:3100/checkout, wait until the Order summary panel stops
   showing "Loading your cart", then fill "Full name" with "Ada Lovelace", "Email" with
   "ada@example.com" and "Delivery address" with "12 Orbit Way, Bristol".
3. Press "Place order" and assert that the browser lands on http://localhost:3100/orders.
4. Wait until "Loading your orders" is gone, then read the order count and, from the newest
   order shown, its order number and its total.
5. Reload the page fully, wait until "Loading your orders" is gone again, and assert that the
   order count is unchanged and that the same order number and the same total are still
   listed.

The order number is read in step 4 rather than written into the test, because `KC-1001` is
only the first order of a fresh browser profile and a profile carrying earlier orders would
number this one differently. What the claim promises is that whatever Orders lists survives a
reload, and that is what steps 4 and 5 compare.

`/orders` renders a `role="status"` "Loading your orders" region before hydration and shows
"No orders yet." when the store really is empty, so both reads wait for the loading region to
disappear. Asserting straight after the reload would race hydration and could see the empty
state on a screen that is about to render the order.
