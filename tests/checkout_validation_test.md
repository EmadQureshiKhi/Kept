---
mode: testing
url: http://localhost:3100/checkout
tags: [checkout, validation]
assurance:
  id: T-4
---

# Checkout refuses an empty email and names the field

<!-- @verifies apps/fixture/README.md:17 the Checkout validation claim -->
<!-- @covers apps/fixture/app/checkout/** -->

Validation runs before the cart is consulted, so this test needs no cart set-up and holds with an
empty cart. Step 1 still waits for the Order summary panel to settle, because the refusal is
produced by the form's own submit handler: pressing the button before hydration would let the
browser submit the form natively and navigate away, and the URL assertion in the last step would
fail for a reason that has nothing to do with the promise.

Every assertion in the last step is on something the refusal renders, so a Checkout screen that
stopped naming the offending field would fail on the summary's text rather than on a selector.

## Step 1 — reach a hydrated Checkout screen

Navigate to http://localhost:3100/checkout and wait until the Order summary panel stops showing
"Loading your cart".

## Step 2 — fill everything except the email

Fill "Full name" with "Ada Lovelace" and "Delivery address" with "12 Orbit Way, Bristol". Leave
"Email" empty.

## Step 3 — submit the order

Press "Place order".

## Step 4 — assert the refusal names the email field

Assert that the alert summarising the refusal appears and contains "Email: Email is required.",
that the message "Email is required." appears under the Email field, that the Email field is
marked invalid and has keyboard focus, and that the browser is still on
http://localhost:3100/checkout with no query string.
