---
assurance:
  id: t-4
  base: sha256:ce82c727fdff767577bf3b47fde75466e6a2820424d3e271c192f2bdee9fbf04
---
# Recalculate the subtotal correctly after a below-threshold quantity change

> Prove that changing a cart quantity updates the displayed subtotal correctly when the resulting subtotal stays below 50 dollars and no discount is applied.

## Step 1

Open http://localhost:3100 in a browser session, establish the seeded cart state {{cart_setup_stays_below_threshold}}, and reach the Cart screen.

## Step 2

On the Cart screen, store the displayed subtotal as baseline_subtotal.

## Step 3

Change the quantity of {{cart_line_for_below_threshold_recalculation}} so the displayed cart subtotal becomes $49 without crossing above $50.

## Step 4

Assert the displayed subtotal equals the sum of each displayed cart line price multiplied by its displayed quantity after the quantity change.

## Step 5

Assert the displayed subtotal differs from baseline_subtotal and no 10 percent discount is shown while the displayed subtotal remains $49.

## Step 6 — assert @verifies ac-3, ac-2, ac-4

Confirm absolute check: displayed subtotal equals the sum of each displayed cart line price multiplied by its displayed quantity after the quantity change (equals) — the stated promise: After a shopper changes a cart item quantity, the displayed subtotal equals the sum of the displayed cart line prices and quantities.
