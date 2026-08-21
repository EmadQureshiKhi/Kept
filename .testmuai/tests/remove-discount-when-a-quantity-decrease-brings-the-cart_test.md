---
assurance:
  id: t-2
  base: sha256:988ba4267c48f2a83967d4b22fbf214c46252337059f6eb5cb9c6f96b0c26d12
---
# Remove discount when a quantity decrease brings the cart subtotal to 49 dollars

> Prove that after a quantity change reduces a previously discounted cart to 50 dollars or less, the 10 percent discount is no longer applied.

## Step 1

Open http://localhost:3100 in a browser session, establish the seeded cart state {{cart_setup_drops_to_49}}, and reach the Cart screen.

## Step 2

On the Cart screen, store the displayed subtotal as baseline_subtotal and store whether a 10 percent discount is shown as baseline_discount_state.

## Step 3

Decrease the quantity of {{cart_line_for_49_threshold_exit}} by 1 so the displayed cart subtotal becomes $49.

## Step 4

Assert the displayed subtotal equals the sum of each displayed cart line price multiplied by its displayed quantity after the quantity change.

## Step 5

Assert the displayed subtotal differs from baseline_subtotal and the discount state changes from baseline_discount_state to no shown 10 percent discount.

## Step 6 — assert @verifies ac-6, ac-2, ac-3, ac-4

Confirm state-transition check: discount not applied (equals) — the stated promise: When a quantity change lowers the displayed subtotal from more than 50 dollars to 50 dollars or less, the cart discount state changes from applied to not applied automatically.
