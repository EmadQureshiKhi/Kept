---
test: ../cart_subtotal_spike_test.md
status: passed
started: 2026-08-20T23:07:07.676Z
duration_s: 162
session_id: 91636318-2037-4ef4-ae9b-61afe22b96e7
---

# T-3 cart subtotal — the verdict spike's probe — Result

## Pin the presentation currency to USD ✓ passed (28.3s)
md5: d2d52e438428cb0705e03ba34c366976
Navigate to http://localhost:3100/settings. Wait until the currency options are visible and the
loading message is gone. Choose USD, then confirm the status line reads "Showing prices in USD."

## Empty the cart ✓ passed (36.7s)
md5: b4872a307a69acf473220e0e7e540080
Navigate to http://localhost:3100/cart and wait until "Loading your cart" is gone. If any
coffees are listed, use each line's Remove button until the page says "Your cart is empty."

## Add one bag of Orion House Blend ✓ passed (20.2s)
md5: d8b41347815a4806a88f31c1dbb0a8e1
Navigate to http://localhost:3100/product/orion-house-blend and wait until the price reads
"$18.00". Leave Quantity at 1 and press "Add to cart".

## Assert the cart shows one bag at eighteen dollars ✓ passed (20.3s)
md5: ba50fab2c61b4af3d2375ef1fed6934c
Navigate to http://localhost:3100/cart and wait until "Loading your cart" is gone. Assert that
the quantity for Orion House Blend reads 1 and that the Subtotal reads "$18.00".

## Increase the quantity to two without reloading ✓ passed (26.2s)
md5: dce2c6d95ec7706a8b153a64129aec4c
Press the "Increase quantity of Orion House Blend" button once. Do not reload the page. Assert
the quantity now reads 2.

## Assert the subtotal doubled ✓ passed (20.9s)
md5: 7b301009dea51c9ba1d609a46bbaea35
Assert that the Subtotal reads "$36.00" and that the Total reads "$36.00".
