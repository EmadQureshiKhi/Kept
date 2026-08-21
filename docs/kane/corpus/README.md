# The authoring corpus

Every `tests/*_test.md` document authored against the running fixture on port 3100,
with its stream captured verbatim: `<slug>-author.ndjson` is stdout, `.stderr.txt` is
stderr, `.exit.txt` is the process exit code. Each run also leaves a replay recording
at `tests/output-<slug>/`, force-added so every later replay is free.

The invocation is the same for all eight:

```
kane-cli testmd run tests/<slug>_test.md --agent --bug-detection continue
```

## Outcomes

Credits are summed from every `run_end.credits_consumed` in the capture, one per step.

| id | document | steps | outcome | credits | discarded attempt |
|---|---|---|---|---|---|
| T-1 | `shop_filter_test.md` | 4/4 passed | authored | 33.465 | — |
| T-2 | `home_cta_test.md` | 3/3 passed | authored | 21.708 | — |
| T-3 | `cart_subtotal_test.md` | 6/6 passed | authored on attempt 2 | 6.713 | 57.888 |
| T-4 | `checkout_validation_test.md` | 4/4 passed | authored | 24.723 | — |
| T-5 | `orders_persist_test.md` | 5/5 passed | authored on attempt 2 | 38.711 | 67.513 |
| T-6 | `settings_currency_test.md` | 4/4 passed | authored | 25.960 | — |
| T-7 | `cart_discount_test.md` | 4 passed, 1 failed | **failure is the deliverable** | 27.373 | 23.179 |
| T-8 | `product_currency_test.md` | 3/3 passed | authored | 20.601 | — |

T-3's second attempt is the cheapest run in the corpus because five of its six steps came
back from the recording and only the last one was re-authored. That is the same economy
stage 15.3 depends on for the whole suite.

## The three kept failures

Failed captures are kept rather than deleted, because each one is the evidence for a
claim made elsewhere in the project.

**`t5-orders_persist-author-attempt1-stuck`** — `stuck.ap_stuck`, result code 330,
verdict `automation_bug/config_issue` at confidence 0.89. "Read the order count and its
number and total" left `{{order_count}}`, `{{order_number}}` and `{{order_total}}` as
unresolved template placeholders, so the post-reload comparison had nothing to compare
against. The fix is the idiom Kane writes for itself: store the value under a name, then
assert against that name.

**`t3-cart_subtotal-author-attempt1-stale-build`** — result code 740, reason
`assertion_error.confirmed_product_bug`, one-liner "The item row updates to $36.00, but
the cart Subtotal and Total still display $18.00 instead of $36.00." That is exactly the
symptom task 6.2's one-line break produces, and `apps/fixture/lib/cart.ts` was correct in
git the whole time. The cause was environmental: the long-lived `next start` on port 3100
was serving a `.next` built while the break sat in the working tree. Both the built
sourcemap and the client chunk the browser downloads carried
`return roundMoney(items[0]?.price ?? 0);`. Deleting `.next`, rebuilding and restarting
put `items.reduce((total, line) => total + line.price * line.qty, 0)` back into the served
bundle, and the re-run passed six steps for 6.7 credits — five replayed from the recording,
only the last re-authored. **A long-lived fixture server is a stale-build hazard for every
[LIVE KANE] task; rebuild before believing a product-bug verdict.**

**`t7-cart_discount-author-attempt1-target-closed`** — result code 510, reason
`infra_error.screenshot_failed`, on `Screenshot failed: TargetClosedError`, with verdict
`automation_bug/state_transition_bug`, `confirmed: false`, confidence 0.79. The browser
page disappeared during step 3, steps 4 and 5 were skipped, and the assertion never ran.
An infrastructure crash, not an outcome — and worth keeping precisely because the router
must not treat it as one.

## T-7, the document that must fail

T-7 asserts the never-true 10-percent-discount claim at `apps/fixture/README.md:20`. The
fixture has no discount logic and will never get any, so the document is designed to fail
on a correct app, and it does — on the **assertion**, which is what routes the residue to
documentation rather than to the test:

```
steps: 5 total, 4 passed, 1 failed
result_code: 740
reason_code: assertion_error.confirmed_product_bug
test_md_bug_verdict: {
  step_index: 5, confirmed: true,
  family: "application_issue", category: "ui_data_defect",
  severity: "major", confidence: 0.95,
  one_liner: "The cart subtotal was over $50, but the page still showed the full
              $72.00 total instead of the discounted $64.80 total."
}
```

Kane blames the application at confidence 0.95. It is wrong, and that is the point: the
subtotal is $72.00 because $72.00 is correct. KEPT's router is what overturns
`application_issue` to `docs-lie`, using the citation the document carries, and stage 15.5
drives that branch from this capture. Nothing here may be weakened to make T-7 pass.

## What the bootstrap changed for `cover`

`cover-after-bootstrap.ndjson` is `kane-cli cover --mode agent` run after the context
store existed and after these packs were sealed. **The refusal is gone.** It had been:

```
error: no context store here (run `kane-cli context ingest <files>` first)
done.status = refused, exit 2  →  degradedReason: assurance-status:refused
```

and it is now `done.status = complete`, `exit_code: 0`, with a `coverage` payload present.
So the acceptance gate of design §5.3 now opens.

The proven axis still does not land. `kept build` reports:

```
degraded  true (coverage-payload-unreadable)
warn enrichment-coverage-unprojectable: The coverage payload projected no usable
  entries (28 objects examined across 6 arrays), so the assurance axes were
  discarded: a visibly baseline-only ledger is better than a silently wrong
  proven figure (§5.3).
```

The payload explains why, and it is not a projection bug. `coverage.depth` — the axis
`cover` describes as "depth proven by an evidence pack" — is `[]`. It is empty for the
newest pack and equally empty for `--from` a pack from a run that **passed**
(`73c1df17-…`, T-3). Everything the payload does carry is on the other axis:
`coverage.completeness` holds thirteen rows — eight `uc-N` rows of kind `zero-scenario`
and five `gap-N` rows, four `incomplete` and one `missing-expected-result` — and neither
ref namespace names anything in our graph. Our
documents carry logical ids in Kane's own `assurance: {id}` — `T-1` … `T-8` — while the
graph speaks in `uc-N` scenario refs, so an authored execution has no scenario to be
proven against.

`degraded: true` is therefore still the honest state, on a different and more advanced
reason than before, and the committed snapshot is left alone: closing the last step needs
the authored documents bound to designed scenario refs, which is a design decision, not a
capture.
