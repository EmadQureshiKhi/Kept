---
test: ../orders_persist_test.md
status: passed
started: 2026-08-21T01:12:38.396Z
duration_s: 180
session_id: 3ae00a12-06ad-41d4-8a2a-2aca46cf9bf4
---

# A completed order is listed on Orders and survives a reload — Result

## Step 1 — add one bag of Orion House Blend ✓ passed (18.4s)
md5: d8ac5f1ff60ba5fd1a2982c72eaf8b54
Navigate to http://localhost:3100/product/orion-house-blend, wait until the price reads "$18.00",
then press "Add to cart".

## Step 2 — fill in the checkout details ✓ passed (22.8s)
md5: c3f44a4d4b95554832e1c0a9a826ce26
Navigate to http://localhost:3100/checkout, wait until the Order summary panel stops showing
"Loading your cart", then fill "Full name" with "Ada Lovelace", "Email" with "ada@example.com" and
"Delivery address" with "12 Orbit Way, Bristol".

## Step 3 — place the order ✓ passed (18.4s)
md5: 670f48cb2715b0f3bcca1673f7640026
Press "Place order" and assert that the browser lands on http://localhost:3100/orders.

## Step 4 — store what Orders lists ✓ passed (34.8s)
md5: 8bcb320cb6751b6c186c3527e921bf03
Wait until "Loading your orders" is gone. Store the number of orders listed as
baseline_order_count, store the order number shown on the newest order as baseline_order_number,
and store the total shown on that same order as baseline_order_total.

## Step 5 — assert the order survives a full reload ✓ passed (77.7s)
md5: a15f6381793fea12594df67386f5052f
Reload the page fully and wait until "Loading your orders" is gone again. Assert the number of
orders listed equals baseline_order_count, and assert the newest order still shows the order
number baseline_order_number and the total baseline_order_total.
