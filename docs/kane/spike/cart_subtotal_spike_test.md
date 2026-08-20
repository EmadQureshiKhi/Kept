---
mode: testing
url: http://localhost:3100/settings
tags: [cart, subtotal, breakable, verdict-spike]
---

# T-3 cart subtotal — the verdict spike's probe

This is a **Kane-valid transcription of `tests/cart_subtotal_test.md` (T-3)**, authored and
replayed live for the R6.12 verdict spike. It lives here rather than in `tests/` because the
committed corpus cannot be handed to `kane-cli` 0.8.4 as written, and rewriting the corpus is a
design change well outside the spike. Two incompatibilities, both read off the installed CLI's
own parser rather than off any documentation:

1. **Root frontmatter keys are a closed set.** `test_id` and `covers` are both rejected with
   `unknown config key`, before any browser launches, at exit two. Kane's own home for a logical
   identifier is `assurance: {id, base}`; there is no Kane key for `covers` at all.
2. **Steps come only from `## ` headings.** The corpus writes its steps as a numbered prose list
   under an `# H1`, and Kane discards everything before the first `## `, so those documents parse
   to zero steps even once their frontmatter is legal.

So this file carries no `test_id` and no `covers`: it mints no promise, it is not part of the
eight-claim corpus, and nothing in KEPT reads it. It exists to answer one question with real
bytes — whether a **failing cached replay** carries the confirmed-bug result code and an inline
`verdict` object — and the answer is recorded in `docs/kane/verdict-spike.md`.

The steps below are the six steps of T-3, transcribed one per heading, with the same waits and
the same assertions. The claim they verify is line 16 of `apps/fixture/README.md`, the breakable
subtotal promise.

## Pin the presentation currency to USD

Navigate to http://localhost:3100/settings. Wait until the currency options are visible and the
loading message is gone. Choose USD, then confirm the status line reads "Showing prices in USD."

## Empty the cart

Navigate to http://localhost:3100/cart and wait until "Loading your cart" is gone. If any
coffees are listed, use each line's Remove button until the page says "Your cart is empty."

## Add one bag of Orion House Blend

Navigate to http://localhost:3100/product/orion-house-blend and wait until the price reads
"$18.00". Leave Quantity at 1 and press "Add to cart".

## Assert the cart shows one bag at eighteen dollars

Navigate to http://localhost:3100/cart and wait until "Loading your cart" is gone. Assert that
the quantity for Orion House Blend reads 1 and that the Subtotal reads "$18.00".

## Increase the quantity to two without reloading

Press the "Increase quantity of Orion House Blend" button once. Do not reload the page. Assert
the quantity now reads 2.

## Assert the subtotal doubled

Assert that the Subtotal reads "$36.00" and that the Total reads "$36.00".
