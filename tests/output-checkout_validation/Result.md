---
test: ../checkout_validation_test.md
status: passed
started: 2026-08-21T01:04:30.871Z
duration_s: 96
session_id: 2cc57e5d-735a-4f9a-a8c5-1a55030f8899
---

# Checkout refuses an empty email and names the field — Result

## Step 1 — reach a hydrated Checkout screen ✓ passed (26.4s)
md5: 823f4b33355509010676d4a6244becc9
Navigate to http://localhost:3100/checkout and wait until the Order summary panel stops showing
"Loading your cart".

## Step 2 — fill everything except the email ✓ passed (18.5s)
md5: 568d12072a555e99a352ce6eaa8146bf
Fill "Full name" with "Ada Lovelace" and "Delivery address" with "12 Orbit Way, Bristol". Leave
"Email" empty.

## Step 3 — submit the order ✓ passed (14s)
md5: 1fe44dcac4ed63879e2a6ac707ddaa8f
Press "Place order".

## Step 4 — assert the refusal names the email field ✓ passed (30.2s)
md5: 80f9aec880c8ee2dd6ab0737bf959a4d
Assert that the alert summarising the refusal appears and contains "Email: Email is required.",
that the message "Email is required." appears under the Email field, that the Email field is
marked invalid and has keyboard focus, and that the browser is still on
http://localhost:3100/checkout with no query string.
