---
assurance:
  id: t-1
  base: sha256:ed7de987305b5840448e42e570aa19630fe285de85ad8591361546a6c0c74a9a
---
# Apply discount when a quantity increase pushes the cart subtotal above 50 dollars

> Prove that changing a cart quantity so the subtotal exceeds 50 dollars automatically applies the 10 percent discount.

## Step 1

Open http://localhost:3100 in a browser session, establish the seeded cart state {{cart_setup_crosses_to_51}}, and reach the Cart screen.

## Step 2

On the Cart screen, store the displayed subtotal as baseline_subtotal and store whether a 10 percent discount is shown as baseline_discount_state.

## Step 3

Increase the quantity of {{cart_line_for_51_threshold}} by 1 so the displayed cart subtotal becomes $51.

## Step 4

Assert the displayed subtotal equals the sum of each displayed cart line price multiplied by its displayed quantity after the quantity change.

## Step 5

Assert the displayed subtotal differs from baseline_subtotal and the discount state changes from baseline_discount_state to a shown 10 percent discount equal to $5.10.

## Step 6 — assert @verifies ac-5, ac-1, ac-3, ac-4

Confirm state-transition check: discount applied (equals) — the stated promise: When a quantity change raises the displayed subtotal from 50 dollars or less to more than 50 dollars, the cart discount state changes from not applied to applied automatically.
