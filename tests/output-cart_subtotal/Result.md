---
test: ../cart_subtotal_test.md
status: passed
started: 2026-08-21T02:36:06.202Z
duration_s: 34
session_id: 1bcf2ed3-337c-4d9f-9de0-ee16ce08d073
---

# Cart subtotal updates immediately when a quantity changes — Result

## Step 1 — pin the presentation currency to USD ✓ passed (1.24s)
md5: bce6794326ce4c27e239da288a2b2b4a
Navigate to http://localhost:3100/settings. Wait until the currency options appear and the
loading message is gone. Choose USD, then confirm the status line reads
"Showing prices in USD."

## Step 2 — empty the cart ✓ passed (0.44s)
md5: b4872a307a69acf473220e0e7e540080
Navigate to http://localhost:3100/cart and wait until "Loading your cart" is gone. If any
coffees are listed, use each line's Remove button until the page says "Your cart is empty."

## Step 3 — add one bag of Orion House Blend ✓ passed (0.87s)
md5: d8b41347815a4806a88f31c1dbb0a8e1
Navigate to http://localhost:3100/product/orion-house-blend and wait until the price reads
"$18.00". Leave Quantity at 1 and press "Add to cart".

## Step 4 — assert the cart shows one bag at eighteen dollars ✓ passed (0.57s)
md5: ba50fab2c61b4af3d2375ef1fed6934c
Navigate to http://localhost:3100/cart and wait until "Loading your cart" is gone. Assert that
the quantity for Orion House Blend reads 1 and that the Subtotal reads "$18.00".

## Step 5 — increase the quantity to two without reloading ✓ passed (0.72s)
md5: dce2c6d95ec7706a8b153a64129aec4c
Press the "Increase quantity of Orion House Blend" button once. Do not reload the page. Assert
the quantity now reads 2.

## Step 6 — assert the subtotal doubled ✓ passed (19.8s)
md5: 5f7f01dace26cffa9c941982674f80f2
Assert that the Subtotal now reads "$36.00" and that the Total reads "$36.00".
