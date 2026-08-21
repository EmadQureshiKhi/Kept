---
mode: testing
url: http://localhost:3100/settings
tags: [cart, subtotal, breakable]
assurance:
  id: T-3
---

# Cart subtotal updates immediately when a quantity changes

<!-- @verifies apps/fixture/README.md:16 the breakable subtotal claim -->
<!-- @covers apps/fixture/lib/cart.ts, apps/fixture/app/cart/** -->

**Why this is the code-break subject.** The assertion target is the Subtotal figure, and the
Cart screen renders it for every non-empty cart whatever the quantity is. So a disagreement
here is arithmetic, not a missing element: `subtotal` in `apps/fixture/lib/cart.ts` is a
single-expression body that can be made to ignore quantity in one edit, the Subtotal element
still resolves, and the last step reads "$18.00" where it expects "$36.00".

**Why the first two steps exist.** They make the arithmetic deterministic. Step 1 pins the
currency, because the Cart renders every amount in whatever Settings holds and a leftover EUR
would turn "$36.00" into a euro figure. Step 2 empties the cart, because `addItem` merges into
an existing line rather than appending, so a leftover Orion line would make the subtotal
higher than two bags on a perfectly correct app.

Two bags is deliberately under fifty dollars, which keeps this test clear of the discount
claim `tests/cart_discount_test.md` asserts.

**Why every wait is on a state change rather than on time.** `/cart` renders a `role="status"`
"Loading your cart" region before hydration and each price renders an em dash until the chosen
currency is known, so asserting a figure immediately after navigation would race hydration.
Waiting for the loading region to disappear and for the price text to appear removes the race.

## Step 1 — pin the presentation currency to USD

Navigate to http://localhost:3100/settings. Wait until the currency options appear and the
loading message is gone. Choose USD, then confirm the status line reads
"Showing prices in USD."

## Step 2 — empty the cart

Navigate to http://localhost:3100/cart and wait until "Loading your cart" is gone. If any
coffees are listed, use each line's Remove button until the page says "Your cart is empty."

## Step 3 — add one bag of Orion House Blend

Navigate to http://localhost:3100/product/orion-house-blend and wait until the price reads
"$18.00". Leave Quantity at 1 and press "Add to cart".

## Step 4 — assert the cart shows one bag at eighteen dollars

Navigate to http://localhost:3100/cart and wait until "Loading your cart" is gone. Assert that
the quantity for Orion House Blend reads 1 and that the Subtotal reads "$18.00".

## Step 5 — increase the quantity to two without reloading

Press the "Increase quantity of Orion House Blend" button once. Do not reload the page. Assert
the quantity now reads 2.

## Step 6 — assert the subtotal doubled

Assert that the Subtotal now reads "$36.00" and that the Total reads "$36.00".
