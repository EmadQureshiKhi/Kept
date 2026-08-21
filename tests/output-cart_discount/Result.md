---
test: ../cart_discount_test.md
status: failed
started: 2026-08-21T02:50:37.050Z
duration_s: 172
session_id: 994d16b7-6a50-4caa-bc09-491ba6663ffc
---

# Cart applies the 10 percent discount above a 50 dollar subtotal — Result

## Step 1 — pin the presentation currency to USD ✓ passed (5.96s)
md5: bce6794326ce4c27e239da288a2b2b4a
Navigate to http://localhost:3100/settings. Wait until the currency options appear and the
loading message is gone. Choose USD, then confirm the status line reads
"Showing prices in USD."

## Step 2 — empty the cart ✓ passed (0.41s)
md5: b4872a307a69acf473220e0e7e540080
Navigate to http://localhost:3100/cart and wait until "Loading your cart" is gone. If any
coffees are listed, use each line's Remove button until the page says "Your cart is empty."

## Step 3 — add three bags of Kepler Reserve ✓ passed (18.6s)
md5: 29c1a4942750dacf78730c560f56e484
Navigate to http://localhost:3100/product/kepler-reserve and wait until the price reads
"$24.00". Set Quantity to 3 and press "Add to cart".

## Step 4 — assert the subtotal is over fifty dollars ✓ passed (21.8s)
md5: 548e3df0ff819b7e28636a9dd219fc10
Navigate to http://localhost:3100/cart and wait until "Loading your cart" is gone. Assert that
the quantity for Kepler Reserve reads 3 and that the Subtotal reads "$72.00", which is over
fifty dollars.

## Step 5 — assert the total is ten percent below the subtotal ✗ failed (118.4s)
md5: 10747d63e0de86528e57dfdcb6c37729
Reason: AP determined agent is stuck — no viable actions remain — bug verdict: Cart total does not apply 10% auto-discount above $50 subtotal [application_issue/ui_data_defect, confidence 0.95]
Assert that the Total reads "$64.80", ten percent below the Subtotal, because the Cart screen
applies the discount automatically once the subtotal exceeds 50 dollars.
