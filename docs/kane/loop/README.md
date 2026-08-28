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
| `t9-*` | the documentation-triggered cycle, written up in the last section of this document |

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

## The other trigger: one documentation-triggered cycle, and the state it found

Everything above is the code trigger. Task 22.2 asked for the *documentation* trigger to
be driven the same way, as one continuous cycle rather than as fragments, and it was, on
Kane CLI 0.8.4 against a real Chrome. The captures are the `t9-*` files here. The cycle
did not go where the plan said it would, and that is the half of this section worth
reading.

A ninth claim was added to `apps/fixture/README.md` saying the Shop screen keeps the
selected roast filter across a full page reload. The filter is `useState` over a static
array and `apps/fixture/app/shop/page.tsx`'s own header says so, so the claim was false
the moment it was written, which is the point. A designed test was written for it, two
verifications were run, Kane authored the test against a real browser, and the claim was
then reverted. That order is not a typo, and finding 6 is about what it cost.

| file | what it is |
|---|---|
| `t9-shop_filter_persist-author.ndjson` | the authoring run of `tests/shop_filter_persist_test.md`, with its `.exit.txt` and `.stderr.txt` beside it |
| `t9-verify-docs-change-empty-radius.stdout.json` | `kept verify --changed apps/fixture/README.md --member-debug --json` |
| `t9-verify-source-change-skipped.stdout.json` | `kept verify --changed apps/fixture/app/shop/page.tsx --member-debug --json` |
| `t9-testrun-plan-test-ids.json` | Kane's own plan as it stood, which is where the second finding below is checkable |

The authoring run went through `tools/live-author.sh` and both verifications through
`tools/live-verify.sh`. Those exist because the fixture has to be answering on port 3100
before Kane drives Chrome at it and, in this working environment, a server cannot outlive
the call that started it: a backgrounded process dies with its process group the moment
the parent shell returns. So the application and the run share one process group and one
lifetime. They are two scripts rather than one flag because authoring spends credits and
replay does not, and mixing the two behind one entry point makes it easy to spend money
by accident.

### The authoring run, which is the dearest single document in the repository

Exit `1`. Ninety-two lines, ninety-one of them readable events; one line is a stray
fragment of JSON with no opening brace, which the parser skips rather than failing on
(R3.23). A truncated line is a fact about the capture, not a reason to throw.

| reading | value |
|---|---|
| `run_end` events | **5** over four steps: three passed, two failed |
| credits, summed off those five | 4.761070, 8.360615, 4.055040, 7.801045, 16.376240 = **41.354** |
| `bifurcation` events | 4 |
| terminal `test_md_done` events | **2**, at 109 s and 168 s |
| `test_md_summary.steps`, on both halves | `total 4, passed 3, failed 1, skipped 0, replay_decisions 0, author_decisions 4` |
| `commit`, on both halves | `committed: false`, `reason: run_failed`, two different `testcase_id` values |

Four steps and five charges, because the fourth step is the one that asserts the claim and
it was attempted twice. Neither attempt could succeed, the claim being false, so the run
paid twice for the same impossibility. Against the eight corpus documents, whose figures
are itemised in [`docs/kane/credits.md`](../credits.md) and run from **6.713** (T-3, five
of six steps replayed from a recording) to **38.711** (T-5), 41.354 makes this the dearest
single document here. No `kane-cli balance` reading was taken either side of it, so treat
that figure the way `credits.md` says to treat any stream figure: as a floor. An
ExecutionRun stream reports about 92 percent of what a run actually costs.

Kane split the document into **two** test cases and ran it twice, and both halves reached
the same place: three steps passed, the assertion failed, nothing was committed. Two
terminal events for one invocation is the reader-facing consequence, and it is why §4.2
accepts the *first* terminal rather than the last and why the parser retains the second
instead of treating it as a protocol error. A consumer that assumes one terminal per
invocation is reading half of this stream.

### Finding 5: Kane produced a third answer to "the claim was never true", and blamed itself

The decision recorded above rests on Kane having no way to say *the claim is false*. This
run is the strongest evidence for that yet, because it did not reach for the product at
all. Both `test_md_bug_verdict` events, both on step 4:

| `confirmed` | `family` | `category` | `confidence` | `severity` |
|---|---|---|---|---|
| `false` | `automation_bug` | `agent_misstep` | 0.82 | major |
| `false` | `automation_bug` | `state_transition_bug` | 0.84 | major |

The second one's own summary, verbatim from the capture:

```
The test hit its final check while the page was on All roasts instead of Dark roast,
so the agent got stuck and could not complete the verification.
```

That is an accurate description of the fixture behaving correctly. The Shop screen does
reset to All roasts after a reload, which is exactly what the ninth claim denied, and Kane
observed it and filed it as its own mistake.

Set that beside T-7. `docs/kane/corpus/t7-cart_discount-author.ndjson` is an equally false
claim, and its one verdict reads `confirmed: true`, `application_issue/ui_data_defect` at
**0.95**. One kind of situation, a claim that was never true, has now drawn a confirmed
product fault at 0.95 and an unconfirmed agent fault at 0.84. The category moves run to
run. What never appears is a category meaning the claim itself is false, because from
where Kane stands the claim cannot be false. That is not a complication of the argument
above, it is the argument.

### Finding 6: the new member never entered a blast radius, and the reason is not the one it looks like

Task 22.2 predicted the new member would fail, the router would answer `docs-lie`, and
§8.1.1 would withhold the write path because the promise had never been proven. None of
the three happened. The member was excluded from the radius instead, and working out why
took longer than the run did.

**What the captures show.** The plan `kept verify` refreshed and used holds seventeen
members, nine of them carrying an identifier, and `tests/shop_filter_persist_test.md`
carrying `null`. The source-change verification excluded it and said so rather than
dropping it quietly:

```
warn radius-member-no-test-id
  tests/shop_filter_persist_test.md is in the testrun plan with no test_id, so it is
  excluded from the blast radius: an identifier is only ever taken from the plan, never
  guessed from a path or a filename.      (tests/shop_filter_persist_test.md)
```

That is correct behaviour, it is the rule that keeps a later re-verification honest, and
the committed suite asserts it as correct rather than working around it.

**Where the identifier actually comes from.** Kane writes it into the recording it keeps
beside the document, at `tests/output-<slug>/.internal/meta.json`, and the plan reports
that value. Across all seventeen members of the captured plan the two agree exactly:
every id in the plan is the recording's id, and the id is absent for precisely the eight
members that have no recording, which are the four `.testmuai/tests/*` documents, the
three self-cited `kept_*` documents, and the new one.

**And this is the part that corrects the obvious reading.** A *failed* authoring run still
writes a recording and still mints an identifier. This run's own recording,
`tests/output-shop_filter_persist/.internal/meta.json`, carries
`test_id: a2bda3fb-07fd-4c0f-a9e7-85e66e878625`, written at `2026-08-25T12:00:55Z` with
`run_kind: author` and `status: broken`. T-7 is the same story from four days earlier: its
authoring run reported `committed: false, reason: run_failed`, and
`tests/cart_discount_test.md` carries an identifier in this very plan and is replayed by
every suite run in this repository.

So the timeline is the explanation, and it is worth having straight:

| when (UTC) | what |
|---|---|
| 11:55:28 | the plan is refreshed and cached. The new document has no recording, so no id |
| 11:56:08 to 11:56:43 | `verify --changed apps/fixture/app/shop/page.tsx` runs against that plan and excludes the new member |
| 11:58:04 to 12:01 | the authoring run, which fails and mints `a2bda3fb` into the recording |
| 12:06:08 | the committed snapshot is rebuilt, by which time the claim and its test are out of the tree |

**No verification was run after the authoring run.** The committed snapshot's freshness is
still `11:56:08.608Z`, the source-change run. So what this cycle demonstrates is that a
designed test authored *after* the last plan refresh is invisible to the blast radius
until the plan is refreshed, which is §7.2's cache doing exactly what §7.2 says it does
with a ten-minute window. What it does **not** demonstrate is the stronger and more
interesting claim that a claim admitted today can never go red. On this evidence it
probably can: the identifier exists, and one `kept verify --changed` against a refreshed
plan would settle it.

**That run has since been made, and it can.** See "The second cycle" below. Assumption A20
records the closed form, beside A19.

The five self-cited promises are a different case, which is the next finding.

### Finding 7: the fuller reason `staleCount` reads 5

The five self-cited root-README promises from stage 26 have three designed tests between
them, and in the same plan capture all three carry `null`:

```
tests/kept_badge_endpoint_test.md   testId: null
tests/kept_demo_boot_test.md        testId: null
tests/kept_self_claims_test.md      testId: null
```

None of the three had ever been through an authoring run when this was captured, so there
was no `tests/output-kept_*` recording, so there was no identifier for the plan to report,
so `verify --changed` could not select them **however the radius is computed**. They were
not waiting on somebody remembering to run them; they were waiting on the authoring run
that would mint the identifier. "Designed but not yet proven" was true and incomplete. The
plan capture is where anyone can check the fuller reason without taking it on trust.

**One of the three has since been authored**, `tests/kept_badge_endpoint_test.md`, for
14.5994 credits, and it passed on the first attempt. `README.md:679` is `proven` as a
result, `staleCount` reads 4, and proven coverage rose from 54 percent to 62 percent. The
capture above is kept exactly as Kane wrote it, showing all three identifiers null, because
it is a transcript of one moment rather than a description of the present. The current plan
is `.kept/plan.json`, and `docs/self-verification.md` carries the accounting.

### Finding 8: a documentation change puts nothing in the blast radius

`kept verify --changed apps/fixture/README.md` selected **0** members, started no Kane
process, consumed nothing and moved no verdict:

```
invoked      false
members      []
radius       unmatchedPaths ["apps/fixture/README.md"]
info  radius-path-uncovered   no designed test covers apps/fixture/README.md
info  radius-empty            The blast radius is empty for 1 changed path(s), so no
                              Kane process is started and every existing verdict is
                              preserved.
info  verify-completed        0 member(s) in the radius, 0 result(s) consumed,
                              0 verdict(s) written
```

That is correct. The radius is computed from changed **source** against each test's
`covers:` fence, so editing prose selects nothing, and it is the whole reason
`kept reconcile --changed` is a separate command: a documentation edit is answered by
staging held changes for a human, not by re-running browser tests. It had not previously
been written down, and an empty radius on a documentation edit reads like a bug until it
is.

The source-change run is the contrast, on the same fixture and the same plan:

```
argv     testrun run tests/home_cta_test.md tests/shop_filter_test.md
           --on-failure continue --bug-detection continue
members  tests/home_cta_test.md      passed → proven
         tests/shop_filter_test.md   passed → proven
member   129 '[member]' lines, 2 segments, 7 step groups, 0 failing
next     branch null · autonomy none · allowedPaths [] · command null
```

Both selected members passed, so there was nothing to repair, and the withheld fence
forbids every glob a granted one would have allowed: `tests`, `tests/**`, `README.md`,
`apps/fixture/README.md`, `apps/fixture/docs/**`, `packages/**` and all three fixture
source globs. That is §8.1.1's refusal in its ordinary shape.

### What the cycle did not produce, stated plainly

**No amendment, and no `docs-lie`.** §11.4's steps 5 to 7 are "the member fails", "the
router answers `docs-lie`" and "`kept amend propose` renders it on `/amendments`". None of
them ran, because a member excluded from the radius never fails, a member that never fails
never routes, and `kept amend propose` had no red promise to propose against. The one
amendment in the committed snapshot is still `am_57fdcb99`, proposed on 21 August against
`apps/fixture/README.md:20`, the never-true discount claim. So the docs-lie branch is
demonstrated, on T-7, and it is **not** demonstrated by this cycle. Finding 6 says what
stood in the way and what did not: the missing step is one verification against a
refreshed plan, not a structural impossibility.

### Four defects found by driving it

Three were in the wiring between components that each passed their own tests, which is
the third time in this repository that the defect has been in the composition rather than
in a part.

1. **`runSnapshot` had no projection from `.kept/review-cards/`.** `listReviewCards` was
   written, exported, unit-tested, and its own doc comment said `kept snapshot` filled its
   `reviewCards` field from it. Nothing called it. `runSnapshot` accepted `reviewCards`
   only as a request field and neither `reconcile` nor `evolve` passed it, so the snapshot
   wrote `[]` on every path a human could reach and `/reviews` could never show a held
   change. It surfaced because the documentation edit made Kane stage nine changes, KEPT
   mirrored nine cards to disk, the JSON output reported nine, and the snapshot written in
   the same second carried none. Both `t9-verify-*` captures now record the working
   projection: `projected 21 terminal events from .kept/handoff/, 1 amendment from
   .kept/amendments/ and 9 held changes from .kept/review-cards/`.
2. **The human-readable `kept reconcile` summary hard-coded `review cards none created`**
   while nine were staged. Half true in the worst available way: the held claim was
   correct and the count was not, and this is the line a human actually reads. It now
   reads off the result. The `evolve` renderer beside it already spelled this correctly,
   which is what made the divergence findable.
3. **The `reconcile-completed` diagnostic hard-coded `no review card created`** for the
   same reason and now reports the count.
4. Separately, `docs/publish.md` carried a section headed "Currently red, and blocking"
   naming a defect that had already been fixed. Published prose that describes a state
   the repository has left is the failure mode this project exists to catch, so it is now
   guarded by `packages/kept-cli/test/published-docs.test.ts`.

### The lie is not in the tree

`apps/fixture/README.md` is back at its committed content, eight claims, one per line,
and its pinned sha256 `b2118de7aef19263a2d6fb18eba0778e4120b5521077e6de4ed0d26383efadef`
holds. `tests/shop_filter_persist_test.md` is gone from the corpus; the plan capture names
it because the capture is the record. `packages/kept-cli/test/docs-trigger-loop.test.ts`
asserts every figure in this section against the committed bytes, thirty-one tests in 137 ms
with Kane invoked zero times, and `fixture-claims.prop.test.ts` and
`committed-snapshot.test.ts` enforce the revert independently of it.

One disagreement was left standing on purpose rather than tidied away. That suite's file
header read the exclusion as permanent, on the grounds that Kane commits a recording only
when a run passes. Its assertions were all sound, because they are about the plan capture
and the run, but the prose around them overshot what those bytes support, and
`tests/output-shop_filter_persist/.internal/meta.json` in the same tree was the flat
contradiction: a failed authoring run wrote a recording and an identifier. Finding 6 above
is the corrected reading, and the header now carries it with a second live run behind it.

---

## The second cycle: the run this one left open

Everything above stops at a question it could not answer, because the plan had been cached
before the designed test existed: **can a claim admitted today actually be driven to red?**
Answering it needed one verification against a refreshed plan, with the claim and its test
back in the tree. The recording that would have made it cheap was deleted during cleanup, so
the real price was a fresh authoring run.

Captures are `docs/kane/loop/t9b-*`, and eleven tests in
`packages/kept-cli/test/docs-trigger-loop.test.ts` assert them against the committed bytes
with Kane invoked zero times.

### What it cost

| what | credits |
|---|---|
| authoring the designed test, four steps, all authored | **36.8983** |
| the failing member's judgement on verification | **10.80946** |
| the two members that replayed from cache | 0 |

### What happened, in order

| step | outcome |
|---|---|
| the ninth claim re-added to `apps/fixture/README.md` line 21 | done |
| `tests/shop_filter_persist_test.md` re-authored live against a real Chrome | **failed at step 4**, which is the claim, and the fixture is right to fail it |
| the recording | written anyway: `test_id: 1080f892-b002-43f4-b123-16dc4ea3837b`, `run_kind: author`, `status: failed`, while Kane declined to commit it, `committed: false, reason: run_failed` |
| `.kept/plan.json` deleted, then `kept build` | the plan is recaptured and now reports that identifier |
| `kept verify --changed apps/fixture/app/shop/page.tsx --member-debug` | the member **is selected**: the identifier is in the radius and the document is in the command Kane was handed |
| the member | **failed**, `resultCode 330`, `reasonCode stuck.ap_stuck` |
| the promise at line 21 | **`red`**, with a real verdict source naming run `be3de265-0fbd-498b-ad8f-54eb3afb62d8` |
| the router | **`test-drift`**, not `docs-lie` |
| `kept amend propose` | staged **nothing**, and said why |
| the revert | `apps/fixture/README.md` back at `b2118de7aef19263a2d6fb18eba0778e4120b5521077e6de4ed0d26383efadef`, the document and its recording gone |

### The three things this settles

**A claim admitted today can go red.** That was the open question, and the answer is yes. The
exclusion in Finding 6 was a fact about *when the plan was taken*, never about the claim, and
the ordering it implies is now demonstrated rather than deduced: author, refresh the plan,
then verify.

**Kane still will not say the claim is false, and this is the third independent run to show
it.** The `test_md_bug_verdict` came back `confirmed: false`, `family: automation_bug`,
`category: state_transition_bug` at 0.81 confidence, and its own summary describes the
fixture's correct behaviour before filing it as the agent's mistake. Across the corpus one
unchanged kind of failure has now drawn `application_issue` at 0.95 and `automation_bug` at
0.81 and 0.84. The category moves run to run; what never appears is a category meaning the
documentation is wrong, because from where Kane stands the documentation is the
specification. That is the argument the three-way router rests on, and it is measured rather
than argued.

**The interlock refuses to write, and a reader can see it refuse.** R6.4 makes Kane's inline
verdict object outrank the numeric result code, so `confirmed: false` routes the failure to
the test rather than the product. An amendment is only ever proposed for the branch the
router settled, so `kept amend propose` had nothing to work from, wrote nothing, and exited
0. The `docs-lie` branch stays demonstrated on T-7, whose amendment renders on `/amendments`
right now.

### One defect this cycle found

`kept amend propose` refused correctly and told the reader nothing. `amend-no-docs-lie`
carries the whole explanation, naming the run and the branch it actually settled, but it is
an `info` diagnostic and the human output drops `info` on purpose so it is not flooded. What
a reader got was two lines, the command's own name and the repository path, and a zero exit,
with no way to distinguish a refusal from a success.

Fixed: `propose` now surfaces that one diagnostic in its summary, reusing the diagnostic's
own text so the two cannot drift apart, and two tests in `amend.test.ts` cover the refusal
and the case where a proposal really did stage something.

### One environmental note

The verification curated an evidence pack into `apps/ledger/public/evidence/`, the revert
deleted it, and the iCloud sync daemon on this machine restored the directory a few minutes
later. So the test asserting the revert does not check the working tree for that pack: what
matters is that it was never committed, and `evidence-integrity.test.ts` enforces that
against git's own index, where no background process can undo it. The test says so in place
rather than leaving a reader to wonder why one artefact is missing from the list.
