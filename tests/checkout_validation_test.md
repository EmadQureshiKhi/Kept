---
test_id: T-4
tags: [checkout, validation]
covers:
  - apps/fixture/app/checkout/**
---

# Checkout refuses an empty email and names the field

<!-- @verifies apps/fixture/README.md:17 the Checkout validation claim -->

1. Navigate to http://localhost:3100/checkout and wait until the Order summary panel stops
   showing "Loading your cart".
2. Fill "Full name" with "Ada Lovelace" and "Delivery address" with "12 Orbit Way, Bristol".
   Leave "Email" empty.
3. Press "Place order".
4. Assert that the alert summarising the refusal appears and contains
   "Email: Email is required.", that the message "Email is required." appears under the Email
   field, that the Email field is marked invalid and has keyboard focus, and that the browser
   is still on http://localhost:3100/checkout with no query string.

Validation runs before the cart is consulted, so this test needs no cart set-up and holds
with an empty cart. Step 1 still waits for the Order summary panel to settle, because the
refusal is produced by the form's own submit handler: pressing the button before hydration
would let the browser submit the form natively and navigate away, and the URL assertion in
step 4 would fail for a reason that has nothing to do with the promise.

Every assertion in step 4 is on something the refusal renders, so a Checkout screen that
stopped naming the offending field would fail on the summary's text rather than on a
selector.
