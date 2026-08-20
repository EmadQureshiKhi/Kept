# Kepler Coffee

A coffee subscription shop, and the fixture application KEPT verifies. Every claim in
the block below is cited by exactly one designed Kane test under `tests/`, so the
ledger can say whether that promise still holds.

Next.js App Router, seven screens, all state in `localStorage` — no backend, no
database, no `fetch`. `npm run dev` serves the shop on http://localhost:3100, which is
the port every designed test navigates to.

## What Kepler Coffee promises

- The Home screen links to the Shop screen from its primary call to action.
- The Shop screen lists exactly six coffees and filters them by roast level without a page reload.
- The Product screen shows the price in the currency selected on the Settings screen.
- The Cart screen shows a running subtotal that updates immediately when a quantity changes.
- The Checkout screen refuses to submit while the email field is empty and names the offending field.
- The Orders screen lists every completed order and still lists them after a full page reload.
- The Settings screen keeps the selected currency after a full page reload.
- The Cart screen applies a 10 percent discount automatically when the subtotal exceeds 50 dollars.

Eight claims, one per line, so a citation line number identifies exactly one claim: line
13 is the Home promise and line 20 the Cart discount promise. Promise identity is keyed
on the file and the claim text, never on the line number, so inserting a paragraph above
this block moves every claim down a line without re-keying a single promise — but a
citation has to name the line its claim sits on today.

## The designed tests

One `@verifies` tag per test, one promise per tag.

| Claim line | Screen | Designed test | Kane id |
|---|---|---|---|
| 13 | Home | `tests/home_cta_test.md` | `T-2` |
| 14 | Shop | `tests/shop_filter_test.md` | `T-1` |
| 15 | Product | `tests/product_currency_test.md` | `T-8` |
| 16 | Cart | `tests/cart_subtotal_test.md` | `T-3` |
| 17 | Checkout | `tests/checkout_validation_test.md` | `T-4` |
| 18 | Orders | `tests/orders_persist_test.md` | `T-5` |
| 19 | Settings | `tests/settings_currency_test.md` | `T-6` |
| 20 | Cart | `tests/cart_discount_test.md` | `T-7` |

The `test_id` column is a convenience for reading the corpus. The authority for the
path-to-identifier mapping is `testrun_plan.members[].test_id`, which Kane reports at
plan time; nothing in KEPT derives an identifier from this table or from frontmatter.
