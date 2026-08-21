---
mode: testing
url: http://localhost:3100/settings
tags: [cart, discount, docs-lie]
assurance:
  id: T-7
---

# Cart applies the 10 percent discount above a 50 dollar subtotal

<!-- @verifies apps/fixture/README.md:20 the never-true discount claim -->
<!-- @covers apps/fixture/lib/cart.ts, apps/fixture/app/cart/** -->

**Why this test fails on a correctly behaving app.** This is the never-true claim
(design §12.7, R12.7). No discount logic exists anywhere in the fixture and none will ever be
added, so the Cart screen shows an undiscounted Total and the last step disagrees with it. The
app is right and the README is wrong, which is the whole point of the test.

That routes to `docs-lie` only if the failure is an **assertion** failure. A selector that does
not resolve triages as `test-drift` and aims the repair at this file instead of at the
documentation, so three rules keep the failure on the assertion:

- **Every element the test touches exists on a correct Cart screen.** The quantity readout, the
  Subtotal figure and the Total figure are all rendered for every non-empty cart —
  `cart-quantity-<slug>`, `cart-subtotal` and `cart-total` in the committed markup. Nothing here
  targets a discount row, a discount badge, a "you saved" line or a percentage-off element,
  because no such element is ever rendered and asking for one would fail at resolution, not at
  comparison.
- **The failing step asserts a value, not the existence of anything.** The last step compares the
  text of the Total figure. The element resolves and reads "$72.00"; the expected text is
  "$64.80".
- **The step before it proves the target is on the page.** It reads the quantity and the Subtotal
  successfully and both match the correct app, so by the time the disagreement happens the Cart
  screen has already been shown to be rendering normally.

Steps 1 to 4 therefore all pass against a correct app. Steps 1 and 2 pin the currency and empty
the cart for the same reasons as in `tests/cart_subtotal_test.md`: without them the figures
depend on leftover browser state. Every wait is on an observable state change — the
"Loading your cart" region disappearing, the price text appearing — because `/cart` renders a
loading region before hydration and prices render an em dash until the currency is known.

The residue is a documentation problem, and the amendment design §12.2 names is
`- The Cart screen shows the order total with no automatic discounts.` at README line 20.

## Step 1 — pin the presentation currency to USD

Navigate to http://localhost:3100/settings. Wait until the currency options appear and the
loading message is gone. Choose USD, then confirm the status line reads
"Showing prices in USD."

## Step 2 — empty the cart

Navigate to http://localhost:3100/cart and wait until "Loading your cart" is gone. If any
coffees are listed, use each line's Remove button until the page says "Your cart is empty."

## Step 3 — add three bags of Kepler Reserve

Navigate to http://localhost:3100/product/kepler-reserve and wait until the price reads
"$24.00". Set Quantity to 3 and press "Add to cart".

## Step 4 — assert the subtotal is over fifty dollars

Navigate to http://localhost:3100/cart and wait until "Loading your cart" is gone. Assert that
the quantity for Kepler Reserve reads 3 and that the Subtotal reads "$72.00", which is over
fifty dollars.

## Step 5 — assert the total is ten percent below the subtotal

Assert that the Total reads "$64.80", ten percent below the Subtotal, because the Cart screen
applies the discount automatically once the subtotal exceeds 50 dollars.
