# The closed loop, driven live — and the `code-break` branch, finally firing

`apps/fixture/lib/cart.ts` was broken on its one-line `subtotal` body, `kept verify
--changed` was fired, the branch came back **`code-break`** with a fixture-source write
fence, the line was repaired inside that fence, and the second verification landed the
promise on **`proven`**. Both handoffs, both captured `[member]` streams, both sealed
triage notes and the four balance readings are committed here.

**This is the first time `code-break` has ever fired in this project.** Everything
before it routed `docs-lie` — including, twice, a deliberately broken `subtotal`. The
first half of this document is the run; the second half is why it took three findings
and one specification decision to get there, because that is the more useful half.

| file | what it is |
|---|---|
| `the-one-line.txt` | the break and the repair, one line each |
| `codebreak-verify-red.*` | `kept verify --changed apps/fixture/lib/cart.ts --member-debug`, broken build |
| `codebreak-red-defd438c.handoff.json` | the handoff that run wrote (`.kept/` is gitignored) |
| `codebreak-red-defd438c.member.ndjson` | the `[member]` stream it captured |
| `codebreak-verify-green.*` / `codebreak-green-f4cc8633.*` | the same four records for the repaired build |
| `codebreak-pack-t3-subtotal.failure.yaml` | the sealed triage note that decided the branch |
| `codebreak-pack-t3-subtotal.result.yaml` | the `external_id` block that attributed it to a member |
| `codebreak-pack-t7-discount.*` | the same two files for the never-true claim, which is the counter-example |
| `codebreak-balance-*.txt` | `kane-cli balance` either side of each run |
| `pack-failure-yaml-*.yaml`, `red-0944d075.*`, `green-57591bff.*`, `verify-red.*`, `verify-green.*` | the earlier `docs-lie` pair, kept as the evidence for findings 1 to 4 |

## The run

Two members in the radius, because `apps/fixture/lib/cart.ts` is covered by both the
subtotal test and the discount test.

### Red — `defd438c-8f4d-4768-87c8-3cff627a2443`

| member | verdict | Kane's sealed category | branch |
|---|---|---|---|
| `cart_subtotal_test.md` (T-3) | **`proven` → `red`** | `application_issue/ui_data_defect` 0.96 | `code-break` |
| `cart_discount_test.md` (T-7) | `red` → `red` | `application_issue/ui_data_defect` 0.97 | `code-break` |

```
next action  code-break
autonomy     apply
allowedPaths apps/fixture/app/** apps/fixture/components/** apps/fixture/lib/**
```

The fence was granted **because T-3 was `proven` before this run** — §8.1.1. T-7 was
not, and the handoff says so rather than leaving it to be noticed:

```
warn handoff-code-break-unproven
  promise p_45ccecba7aa5 routed 'code-break' and KEPT has never proven it — its verdict
  before this run was 'red', not 'proven'. There is no observed earlier state to
  restore, so an automatic patch would implement the claim rather than repair a
  regression, and no path is authorised for it — though another promise in this radius
  was proven, so the run does carry a write fence.        (apps/fixture/README.md:20)
```

### Green — `f4cc8633-43cb-4799-95b2-000093f3cffd`

| member | verdict | branch |
|---|---|---|
| `cart_subtotal_test.md` (T-3) | **`red` → `proven`** | none — it passed |
| `cart_discount_test.md` (T-7) | `red` → `red` | `test-drift` |

Same command, same argv, same recordings. One line of application source changed
between them. Seven promises proven and the eighth still the designed never-true claim,
so the loop moved one verdict and moved nothing else (R4.15). Both runs went through
`mayWriteVerdicts` on a real `testrun_done` at exit meaning `failure`; neither guard was
widened.

Measured cost, from `kane-cli balance` either side:

| run | delta |
|---|---|
| red | 4.99 |
| green | 14.99 |

A replay is free where it passes and costs a judgement where it fails.

## Why it took this long

### Finding 1: `testrun_member_end` carries no classification signal at all

`path`, `test_id`, `status`. **That is all** — no `result_code`, no `reason_code`, no
`verdict` object, across six live runs, and `verdictSource.resultCode` is `null` in
every committed run entry. Design §6.2's ladder reads the verdict object first and the
coerced code second; neither had anything to read, so every failure fell to the triage
rung — and the note was inside a sealed zip nothing opened.

R4.12 is the fix. Under `KANE_TESTRUN_MEMBER_DEBUG=1` each member's own `testmd` stream
is echoed on stderr prefixed `[member] `, `KaneInvoker` has an `onStderrLine` seam, and
`kane/memberDebug.ts` cuts the stream into one segment per member at `test_md_done`.
The stream is persisted to `.kept/diagnostics/<runId>.member.ndjson`.

`--member-debug` is therefore **not a debugging flag.** It decides the repair branch.

Attribution is by **segment**, not by `run_id`: pairing `run_end` one-to-one gave forty
terminals for nine members, because Kane replays a document as `run-0`, `run-1`, … per
step group and restarts the numbering per member. Pairing refuses on any disagreement
and attributes nothing rather than something wrong.

### Finding 2: `--bug-detection` is a profile setting, so the argv states it

`kane-cli config show` reports `"bug_detection":"off"` on this machine. Kane's
investigation is what produces the code and the verdict object, so the branch depended
on ambient state in another tool's config — changeable by anyone, invisible in the
argv, absent from every recording. `--bug-detection continue` is now on every replay,
for the same reason `--on-failure continue` is: the contract is the argv.

### Finding 3: Kane's judgement of one unchanged failure is not stable

`tests/cart_discount_test.md` asserts a claim that is false by construction and fails
identically every time. What Kane has concluded about that one failure:

| source | `result_code` | verdict object / category | branch it implies |
|---|---|---|---|
| 15.3's suite replay | `740` | `confirmed: true`, `application_issue`, 0.95 | `code-break` |
| `f4726521`, `f0d80fd8`, `0944d075` | absent | absent | `docs-lie` residue |
| `57591bff` | `710` | `confirmed: false`, `ui_data_defect`, 0.89 | `test-drift` |
| pack `57591bff` | — | `application_issue/ui_data_defect` 0.89 | `code-break` |
| pack `108dbb62` | — | `automation_bug/state_transition_bug` 0.91 | `test-drift` |
| this document's green run | — | `ui_data_defect` 0.84 | `test-drift` |

Six samples, three branches, one unchanged failure against one unchanged application.
Re-running until it says something convenient would be a coin flip presented as a
demonstration, so that was never done.

### Finding 4: the conclusion KEPT needs was in a place nothing read

The investigation *did* run — it wrote its answer into the sealed pack rather than onto
the stream. `codebreak-pack-t3-subtotal.failure.yaml`, from this run's own archive:

```yaml
title: Cart summary totals remain $18.00 while cart line total is $36.00
triage:
  by: { kind: agent, id: v16-investigation/replay }
  rca:
    root_cause: The cart summary is still showing the old amount instead of adding
      up what is currently in the cart.
    category: application_issue/ui_data_defect
    confidence: 0.98
  severity: major
```

Three things stood between that file and the branch, and all three are now closed:

1. **The note is inside a zip.** `listArtifacts` resolved a pack *directory*; Kane
   seals a single `.evidence` archive. `kane/packArchive.ts` is the reader —
   `node:zlib` `inflateRawSync`, no dependency added, no `unzip` spawned — shared with
   the evidence curation that built it first.
2. **The category is nested one level deeper than the alias list read.**
   `triage.rca.category`, not `triage.category`, with `confidence` beside it and
   `severity` one level up. The deeper spelling now leads the precedence list.
3. **`application_issue` was missing from `CODE_BREAK_SIGNALS`.** The seven tokens
   beside it were authored from Kane's documented vocabulary before any pack had been
   opened. Without Kane's own product-fault family, a note reading
   `application_issue/ui_data_defect` at 0.96 routed `docs-lie`.

**And the fourth, which needed a decision rather than an implementation, is answered by
the pack itself.** The note is per failing step, under
`tests/<slug>/steps/<n-a-b>/failure.yaml`, where the slug derives from the document's
*title* — `cart-subtotal-d5ba3490`. Matching a slug to a member path would infer
identity from a name, which §7.1 and §4.6 exist to forbid. But each
`tests/<slug>/result.yaml` carries an `external_id` block, and in it the member's own
`test_id`:

```yaml
external_id:
  execution_id: defd438c-8f4d-4768-87c8-3cff627a2443
  test_id: 1c4fff07-a0da-495b-8471-26d45b4a1441      # cart_subtotal_test.md
```

```yaml
external_id:
  execution_id: defd438c-8f4d-4768-87c8-3cff627a2443
  test_id: 4be09740-bce4-483f-ad83-9e6cc24bd421      # cart_discount_test.md
```

Those are the same UUIDs `testrun_member_end` reports and the same ones the blast radius
selected. So identity is **read, not guessed**: `kane/packTriage.ts` keys notes by that
`test_id`, locates the archive by this run's own `execution_id` so a previous or
parallel run's pack is never opened, and attributes nothing to a member the pack does
not name. No slug is ever compared to a path.

## The decision: what Kane's vocabulary cannot say

Closing findings 1 to 4 makes `code-break` reachable. It does not make it *safe*, and
the reason is structural rather than a gap in a list.

**Kane treats the designed test as the specification.** So for the never-true discount
claim, `codebreak-pack-t7-discount.failure.yaml` reads
`application_issue/ui_data_defect` at **0.97** — with, on the earlier `57591bff` pack,
`suggested_fix: Check the cart's discount calculation … verify the total updates to 10%
below the subtotal`. That is a correct description, on Kane's own terms, of a discount
the cart never applies, written with no way to know the sentence was invented to be
false. The genuinely broken `subtotal` earns the **same** category at 0.96.

One token, two opposite meanings, and there is no third token meaning *the claim itself
is false* — because from where Kane stands, the claim cannot be false. No widening of
`CODE_BREAK_SIGNALS` fixes that.

Had the branch alone been trusted, the red run above would have handed an agent
`allowedPaths: apps/fixture/**` and the instruction *"restore the behaviour the cited
claim describes"* for a claim describing a feature that has never existed. It would have
set about **implementing a ten-percent discount nobody designed**. That is a worse
failure than the routing bug it would be fixing: the system rewriting the product to
match a lie.

**So the distinction is made one layer up, on evidence Kane does not have: the promise's
own prior verdict.** `proven` means KEPT itself witnessed the behaviour, with a terminal
event and a sealed pack behind it — red after that is a regression, and restoring it is
exactly what `code-break` is for. A promise never `proven` has no such witness.

> **You cannot break what was never proven to work.**

Design §8.1.1, R7.8, R7.9. It is a condition on §8.1's *autonomy* column, not on the
branch: the router keeps returning what R6.3, R6.4 and R6.5 require, and the snapshot,
`/runs` and the Ledger keep publishing Kane's real conclusion, which is the honest thing
to show. Only the write path is withheld, and the withheld fence forbids every glob the
granted one allowed — so it narrows, and Property 26's containment holds more strictly
than before.

That is visible in the two runs above. The red run granted the fence for T-3 and named
T-7 as not having earned it. The green run's only failing member is T-7, and it carries
no write path at all.

## One defect this run found

The first green handoff listed T-3 under `code-break` **after it had passed.**
`applyRun` clears `repair` on a proven verdict, but the record handed to the handoff
builder is the *pre-run* one and still carried the annotation, and
`input.repair ?? promise.repair` could not tell "this run routed nothing" from "the
caller has no opinion". A handoff is an instruction, so it was telling an agent to
repair a promise that had just gone green. Absent and `null` are now different values,
and `handoff-file.test.ts` pins both directions. The pair committed here was re-driven
after the fix so that both records come from the shipped code.

## What was and was not obeyed

The break was made deliberately to drive the loop and the repair was the exact inverse
of it, inside `nextAction.allowedPaths` and nowhere else. `git diff` on
`apps/fixture/lib/cart.ts` is empty, and `apps/fixture/README.md` is unchanged at
sha256 `b2118de7aef19263a2d6fb18eba0778e4120b5521077e6de4ed0d26383efadef`.

`mayWriteVerdicts` is unchanged. `BRANCH_FENCES` is unchanged, and `fenceFor` still
answers §8.1's table unconditionally — the new row is a separate constant applied at a
single site. The radius is still derived from `testrun_plan.members[].test_id` and from
nothing else.

## The stale-build trap, since it cost this project two spurious failures

`next start` serves a prebuilt `.next`. Every rebuild in this run followed the whole
sequence — kill the server, `rm -rf apps/fixture/.next`, rebuild, restart, then **read
the served chunk back over HTTP** and refuse to spend a credit unless it carries the
intended form:

```
broken:   function f(e){return a(e[0]?.price??0)}
repaired: function f(e){return a(e.reduce((e,t)=>e+t.price*t.qty,0))}
```

The check is a hard gate in the driving script, not a habit. The `reduce` that remains
in the broken bundle is `itemCount`, a different function, correct in both.
