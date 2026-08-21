# The docs-lie branch, driven end to end on T-7

The novel branch, and the one that runs backwards from every other test tool: KEPT
concludes the **documentation** is wrong and proposes to change it, then refuses to
change it until a human says so.

Everything here is a transcript of a real invocation. Nothing is a fixture.

| file | what it is |
|---|---|
| `run-108dbb62.handoff.json` | the run entry the whole-suite replay wrote — `.kept/handoff/` is gitignored, so it is copied here |
| `propose-no-text.{stdout,stderr,exit}.txt` | `kept amend propose --run <id>` with no replacement: the refusal, exit 0, nothing staged |
| `propose.stdout.json` / `propose.exit.txt` | the real proposal, `--json`, exit 0 |
| `am_57fdcb99.json` | the staged amendment, byte-for-byte as `.kept/amendments/` holds it |
| `accept.{stdout,stderr,exit}.txt` | `kept amend accept am_57fdcb99` — see the note on where it was run |
| `accept.readme.diff` | the diff that acceptance produced: **one line** |

## What the router decided, and why it is an override rather than an answer

The failing member is `tests/cart_discount_test.md` (T-7), asserting the never-true
ten-percent-discount claim at `apps/fixture/README.md` line 20. Kane's own judgement
of that failure, on the member event, is:

```
result_code 740, reason_code assertion_error.confirmed_product_bug
verdict { confirmed: true, family: application_issue, confidence: 0.95 }
```

**Kane blames the application, and Kane is wrong.** `$72.00` is the correct total for
three bags at `$24.00`; there is no discount rule anywhere in the fixture and there
never will be. The application is right and the README lies.

So `docs-lie` here is not a verdict Kane hands over — it is an **override of a
confirmed `application_issue`**, and that asymmetry is the point of the branch. The
router that produced it on this run is `failureYamlTriage`, which reached the same
answer by a different road: no readable `failure.yaml` in the resolved pack, so no
positive evidence of a product fault and no positive evidence of a test-mechanics
fault, and the residue is the claim itself (§6.3's last row, R6.9). Either road, the
conclusion is the one no other tool in this space will draw: *the sentence is the
defect*.

`.kept/state.json` and the committed snapshot both carry it:

```
p_45ccecba7aa5  red  apps/fixture/README.md:20  tests/cart_discount_test.md  docs-lie
```

## `propose` will not write the replacement sentence

Run it with no `--text` and it stages nothing:

```
warn amend-replacement-required: apps/fixture/README.md:20 claims "- The Cart screen
  applies a 10 percent discount automatically when the subtotal exceeds 50 dollars."
  and run 108dbb62-… settled that as 'docs-lie' — … No replacement sentence was
  given, and KEPT does not write one: a system that generated documentation prose
  until its own tests agreed with it would be asserting what it cannot observe.
```

That is the whole reason `--text` exists rather than a generator. Every *other* field
of the amendment comes from the run and none of it is re-derived here — the promise
id, the citation, the strategy, the router's rationale quoted verbatim, the evidence
reference. What the command will not do is compose English until the tests pass.

There is a second gate worth naming: a run the verdict write guard did not admit
proposes nothing at all (`amend-run-unproven`). A crashed stream or a preflight
rejection means KEPT failed to find out whether the claim was true, and a claim is
not false because the finding-out failed.

## The proposal, and the interlock

```
am_57fdcb99  pending  apps/fixture/README.md:20
  was        - The Cart screen applies a 10 percent discount automatically when the
             subtotal exceeds 50 dollars.
  proposed   - The Cart screen shows the order total with no automatic discounts.
```

`expectedSha256` is `sha256(normaliseClaim(currentText))` — `1c7787fb…` — taken from
what is **on disk** at proposal time rather than from the citation the run recorded
minutes earlier. Acceptance re-reads the line and re-hashes it, and a mismatch is
`stale`: no byte written, exit 0. The hash is keyed on the same normalised claim
`promiseId` is keyed on, so the interlock goes stale exactly when the promise identity
would have moved — a whitespace reflow does not invalidate a pending amendment, and a
reworded claim does.

`apps/fixture/README.md` after the proposal:
`b2118de7aef19263a2d6fb18eba0778e4120b5521077e6de4ed0d26383efadef` — unchanged, which
is the R7.4 half of the demonstration.

## Acceptance was demonstrated against a copy, deliberately

`accept.stdout.txt` is a real `node bin/kept amend accept am_57fdcb99` against a
repository root under `.tmp/` holding a **byte-identical copy** of the README
(`b2118de7…`) and a copy of the amendment record. `accept.readme.diff` is the diff it
produced:

```
-- The Cart screen applies a 10 percent discount automatically when the subtotal exceeds 50 dollars.
+- The Cart screen shows the order total with no automatic discounts.
```

One line replaced, forty-five lines before and forty-five after, every other byte
identical.

It was **not** run against the working tree, and the reason is not timidity. Accepting
retires `p_45ccecba7aa5` and creates a successor — the run reported
`successor p_ef77c08130a4` — because `promiseId` is keyed on the normalised claim, so
the amended sentence is a *different* promise carrying no verdict. That is correct
behaviour and it would have destroyed the live red verdict that the closed-loop
demonstration and the committed snapshot are built on, and would have left the eight
line-number pins in `fixture-claims.prop.test.ts` pointing at a sentence that had
moved. Restoring a state file from a backup to put the verdict back would make the
committed evidence exactly as trustworthy as a backup, which is not very.

So: the branch fires, the amendment is staged, the accept path is exercised on real
bytes, and the pinned README is left byte-exact. The command is on the Ledger's
`/amendments` page beside the rendered diff, which is where a human accepts it.

The write discipline itself is asserted rather than demonstrated, which is stronger:
`packages/kept-core/test/repair-docs-amendment.test.ts` pins the specific one-line
write and the stale interlock on this exact claim,
`packages/kept-cli/test/amend.test.ts` drives the CLI's own accept path and asserts
every other byte is identical, and Property 19
(`amendment-write-discipline.prop.test.ts`) quantifies both over generated documents
and generated replacements.
