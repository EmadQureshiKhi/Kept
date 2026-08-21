---
assurance:
  id: t-3
  base: sha256:f39710da213561894282dab8aa43c0c4e66ba594f93b58ff0ec3ade60c720c5d
---
# Keep the discount off when a quantity change sets the cart subtotal to exactly 50 dollars

> Prove the discount boundary is exclusive by showing that a recalculated subtotal of exactly 50 dollars does not trigger the 10 percent discount.

## Step 1

Open http://localhost:3100 in a browser session, establish the seeded cart state {{cart_setup_reaches_exactly_50}}, and reach the Cart screen.

## Step 2

On the Cart screen, store the displayed subtotal as baseline_subtotal.

## Step 3

Change the quantity of {{cart_line_for_exactly_50}} so the displayed cart subtotal becomes exactly $50.

## Step 4

Assert the displayed subtotal equals the sum of each displayed cart line price multiplied by its displayed quantity after the quantity change.

## Step 5

Assert the displayed subtotal differs from baseline_subtotal and no 10 percent discount is shown while the displayed subtotal is $50.

## Step 6 — assert @verifies ac-2, ac-3, ac-4

Confirm 'a 10 percent cart discount while the displayed subtotal is $50 or less' does NOT appear (forbidden-presence) — the stated promise: When the displayed cart subtotal is 50 dollars or less, the 10 percent discount is not applied.
