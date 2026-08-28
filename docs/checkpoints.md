# Verification record

**What this is for.** The task plan places checkpoints between stages, each of which says
"ensure all tests pass". A checkpoint that is only a moment somebody remembers passing is
not evidence, so this file is where the answers live: what each checkpoint asserted, the
counts it was cleared on, and — the part worth reading — what clearing it turned up.

Four of the entries below record defects that a passing component suite could not have
found. Those are the reason this file exists rather than a line saying "all green".

Reproduce the authoritative run with:

```bash
npm run check    # check-readonly.mjs && tsc -b && both app typechecks && vitest --run
```

---

## Checkpoint 16 — is the Verified dimension real?

The question is whether the promise graph carries real verdicts from real Kane terminal
events, or eight `stale` placeholders. Read straight from the committed
`apps/ledger/data/ledger.snapshot.json` as it stood when this checkpoint was cleared, on
the eight-promise graph it then held. The graph has since grown to thirteen, and the
current figures are quoted in the stage 26 entry further down rather than written over
these ones:

| Figure | Value |
|--------|-------|
| `totalPromises` | 8 |
| `designedCount` / `designedCoverage` | 8 / 1 |
| `provenCount` | **7** |
| `redCount` | **1** |
| `staleCount` | **0** |
| `undesignedCount` | 0 |
| `provenCoverage` | **0.875** |
| `degraded` | **false** |
| `degradedReasons` | `[]` |
| `coverageAxes` | present: design completeness `6/6`, proven `6/6`, **nine** use-case rows |
| `freshness` | `testrun_done` / `ExecutionTestrun` / `2026-08-21T16:35:22.779Z` |

Seven proven, one red, none stale. Every verdict names its own `verdictSource` with
`terminalEventType: testrun_done` and a `memberStatus` that agrees with it, and those
sources name **two distinct runs**: `108dbb62` for six promises and `9b365184` for two.
That split is the closed loop re-verifying part of the graph and carrying the rest across
by reference, which is the behaviour the write guard exists to produce. The newest of those
instants is exactly the freshness triple's, so no promise carries a verdict from the future.

The one red promise is `apps/fixture/README.md:20` — the never-true discount claim — and it
is the only promise carrying a repair annotation, which in the committed file reads branch
`test-drift`, category `ui_data_defect`, confidence 0.78, from run `9b365184`. **That failure
is the designed deliverable of the corpus, not a defect.** A green suite here would mean the
docs-lie branch had nothing to demonstrate.

Every figure in that table was a quotation of the artefact, re-read from the committed file
rather than transcribed from a test's expectation.

### Why `provenCoverage` was withheld, and what changed

**For most of this project's life the table above read `provenCoverage: null`, `degraded:
true`, `degradedReasons: ["assurance-status:refused"]`.** The figure was withheld rather than
estimated, and that is the half of this entry worth reading, because the rule that withheld it
has not changed. Only the availability of the input has.

The rule. Seven proven verdicts do not license a coverage percentage. A verdict is what KEPT
observed; coverage is what Kane's assurance graph says the observation *covers*; and while the
axis answering the second question is unreadable, publishing a figure derived from the
verdicts alone would state as coverage something Kane never confirmed. Requirement 2.11
forbids that, and it is the exact dishonesty this product exists to prevent. Seven of eight
would have looked entirely plausible on the page, which is what made it worth refusing.

What changed is where the axis comes from. The enrichment provider used to invoke `cover
--json`, which reads its depth axis out of a **sealed evidence pack**. A coverage document is
minted at authoring time, every pack in this repository is a **replay** pack, and so `cover`
refuses at exit 2 here. Not intermittently, and not fixably by retrying. Reaching the axis
that way would have meant re-authoring the whole corpus through the interactive,
credit-metered design chain. The provider now invokes `cover gaps --json --mode agent`, which answers
**both** axes from the live assurance graph and needs no pack at all. The committed file
records the accepting run as an `enrichment-accepted` diagnostic: `cover gaps --json`
completed with status `complete`, design completeness 100% (6/6 acceptance criteria designed,
1/9 use cases complete), proven 100% (6/6 acceptance criteria with execution facts), nine
use-case rows published. With the axis in hand the graph is clean, so the figure is no longer
withheld. It read 7 of 8, `0.875`, on the eight-promise graph this checkpoint was cleared on,
then 7 of 13, `0.5384615384615384`, once the root README's five claims joined the fixture's
eight, and the committed file reads 8 of 13, `0.6153846153846154`, now that one of those five
has been verified. What withheld it was never the size of the graph, so the figure moved
three times and the rule did not.

**Two figures that must not be confused.** `provenCoverage` counts *promises this repository
verified*: thirteen claims, eight proven. The ribbon's `proven` axis counts *acceptance criteria
Kane's graph holds execution facts for*: six of six, with `source: graph_execution_facts` and
`denominatorBasis: current_live_acs`. Different denominators over different objects. They
disagree, they are labelled differently on the page, and neither borrows the other's word.

**The withheld path is still the documented behaviour**, not a phase the project grew out of.
If the assurance graph cannot be read, both percentages and the whole ribbon go back to being
withheld: never a zero, never an empty ribbon.
`packages/kept-cli/test/committed-snapshot.test.ts` asserts the invariant rather than the
state: while `degraded` it requires a reason, a diagnostic explaining it, a null
`provenCoverage` and null `coverageAxes`; while clean it requires exactly no reasons, the
figure equal to `provenCount / totalPromises`, and the axes present, on the grounds that a
clean snapshot publishing no axes is withholding what it has. So the withholding is enforced
in both directions and neither direction is the special case.

`degradedReasons` is worth a note. It has legitimately read three states across builds:
`assurance-status:refused` when there was no context store, `coverage-payload-unreadable` when
`cover` answered with a payload this build could not project, and empty now. That middle token
has been **renamed `gaps-payload-unreadable`** for the same reason the command changed: the old
name told a reader to go and read the output of a command KEPT no longer runs.
`packages/kept-core/test/providers-enrichment.test.ts` pins the new spelling and asserts the
old one is gone from the vocabulary. The committed-snapshot test still deliberately does
**not** pin whichever token is live, because pinning the string would turn the test into a
statement about which way Kane happened to fail that week.

**Cleared.** Real verdicts, from real terminal events, and a coverage figure that is published
only because there is now an axis behind it.

---

## Checkpoint 18 — does the page move, and is the reduced-motion render identical?

Eleven named gates, confirmed green by name in one run — 206 tests:

| Gate | File | Tests |
|------|------|-------|
| reduced-motion equivalence | `apps/ledger/test/reduced-motion-equivalence.test.tsx` | 14 |
| widened CSS motion scan | `apps/ledger/test/motion-scan.test.ts` | 27 |
| visual trio 1 — contrast over the whole ramp | `apps/ledger/test/contrast-matrix.test.ts` | 11 |
| visual trio 2 — token parity | `apps/ledger/test/token-parity.test.ts` | 8 |
| visual trio 3 — forbidden palette | `apps/ledger/test/forbidden-palette.test.ts` | 17 |
| typography discipline | `apps/ledger/test/typography-discipline.test.ts` | 10 |
| source scan — no raw `result_code` | `packages/kept-core/test/no-raw-result-code.test.ts` | 5 |
| source scan — Ledger read-only | `apps/ledger/test/read-only-scan.test.ts` | 42 |
| source scan — router isolation | `packages/kept-core/test/router-isolation.test.ts` | 10 |
| source scan — animejs import shape | `apps/ledger/test/animejs-import-scan.test.ts` | 13 |
| judge-path scan | `packages/kept-core/test/judge-path.test.ts` | 49 |

### No scan is allowed to pass by inspecting nothing

That property is what keeps a green scan meaningful, and it is asserted per file rather than
assumed. `no-raw-result-code` and `router-isolation` each open with a block asserting a file
was found under every scan root and that the exempt or fenced file is among them.
`read-only-scan` fails on "no Ledger source file was scanned at all". `animejs-import-scan`
fails if the motion gate module is absent, since its absence would make every later rule pass
vacuously. `motion-scan` requires the shell stylesheet and at least one parsed declaration.
`forbidden-palette` and `typography-discipline` each require a non-empty tree. `token-parity`
throws when `tokens.css` is empty, because parity against nothing is not parity. And
`judge-path` throws outright on an empty file set, then proves each of its rules fires against
a planted violation.

The reduced-motion equivalence test is the one that matters most here, and it is not vacuous
either: its orchestration registry is asserted to name exactly the shipped modules that import
the motion gate, so a new flourish cannot land without joining the comparison. The registry
currently holds five entries — M1 through M5. The comparison drives all five, waits for every
pending animation to settle, and requires the settled DOM and the `prefers-reduced-motion:
reduce` DOM to be equal declaration by declaration, including each metric figure's accessible
name.

**Cleared.**

### The one real flake, found and fixed

Several files were reported failing under machine contention. Re-run on an idle machine, all
but one were exactly that. The exception was real.

`apps/ledger/test/projection-completeness.prop.test.tsx` was genuinely too slow for its
budget. A vitest project does not inherit the root `testTimeout`, so the ledger project ran on
the default 5 s per test. Five of that file's seven clauses mount the promise graph once per
generated case at 500 cases each, and one mount-assert-unmount cycle costs 6–8 ms — so each
clause was spending 3.2–5.7 s of a 5 s budget. The same clause finished in 3867 ms in one run
and timed out at 5655 ms in the next.

**A test that is green only when the machine is idle will be red for whoever runs it next**,
so it was fixed in the test rather than by loosening the config:

- `RENDER_RUNS` is **150** for the five mounting clauses; the two analytic clauses stay at
  **500**, since they only read a generated snapshot and finish in tens of milliseconds. 150
  is half again the plan's floor of 100 cases per property, and the five clauses together
  still sample 750 snapshots.
- The slowest clause now finishes in **1604 ms**, and the ledger project dropped from 40.4 s
  to 26.3 s.

Cutting the render sample changes what the property samples, not what it claims — and a
property that reliably runs is worth more than one that samples more and flakes.

`reduced-motion-equivalence.test.tsx` was the other file near the line, at about 3.6 s, and
its cost has no such fix: its two settling tests wait out real declared durations — 1400 ms
for the edge pulse, 760 ms for each of the rail's two counting figures, 420 ms for the verdict
flip, and the panel cascade's base plus three stagger steps. That is a little under four
seconds of clock which *is* the claim being made rather than waste. The only lever that would
make those tests fast is shortening the motion tokens, which is changing the product to suit
the test. So those two state their own 30 s budget with the arithmetic written beside them; if
it is ever reached, an orchestration never resolved, which is precisely what the test asserts.

---

## Checkpoint 16, re-verified after `code-break` first fired

Checkpoint 16 was cleared once on the strength of seven proven verdicts and one red. It is
re-recorded because the answer got considerably stronger, and because two things it rested on
turned out to be wrong.

```
read-only scan: 42 Ledger source files, 11 rules, no violations
Test Files  135 passed (135)
     Tests  2288 passed | 3 skipped | 1 todo (2292)
```

| | before | after |
|---|---|---|
| verdicts | 7 proven, 1 red | unchanged |
| branches ever fired | `docs-lie` only | `code-break`, `test-drift`, `docs-lie` |
| closed loop | red → proven, branch wrong | red → proven, branch `code-break`, fence granted |
| committed evidence | `evidence: []`, a README in the directory | 1 pack, 37 artefacts, 4,128,905 bytes, every link a static path under `/evidence/` |
| evidence edges | 0 published | 2 published, 6 dropped and diagnosed |

**`code-break` had never once fired in this project.** Every failure ever routed went to
`docs-lie`, including a deliberately broken subtotal, because the classification signal lives
in a sealed zip that nothing opened. The three-way branch was a one-way branch that looked
like it worked, and no component test could see it — every unit passed, and the composition
was wrong. [`docs/kane/loop/README.md`](kane/loop/README.md) is the measured write-up.

### The question this checkpoint had been hiding

Making `code-break` reachable is not the same as making it safe, and the gap is a
specification question rather than a bug. **Kane treats the designed test as the
specification**, so the fixture's deliberately never-true discount claim earns
`application_issue/ui_data_defect` at 0.95 — the same category the genuinely broken subtotal
earns at 0.96 — and there is no token meaning "the claim is false", because from where Kane
stands the claim cannot be false. One unchanged failure has drawn four different answers
across three packs and six runs.

Answered in design §8.1.1 on evidence Kane does not have: **automatic repair is granted only
to restore a promise KEPT has itself proven.** You cannot break what was never proven to work.
It is a condition on the autonomy column and not on the branch, so the router still reports
what Requirements 6.3 to 6.5 demand and the Ledger still publishes Kane's real conclusion;
only the write path is withheld, and the withheld fence forbids every glob the granted one
allowed.

The live red run is the proof it was needed. T-3 went `proven → red` and was granted the
fence. T-7 — the never-true claim, which Kane had just labelled a product fault at 0.95 — was
named in a `handoff-code-break-unproven` diagnostic and given no path at all. Without that
gate, the run would have set an agent to work implementing a discount nobody designed, in
order to satisfy a sentence invented to be false.

### Defects found by clearing it

**Five in the evidence chain, each hiding the next.** A pack is a *file* and the resolver
listed only directories. Cloud-sync `<uuid> 2.evidence` conflict copies sorted newest and were
selected as packs. "The newest pack" is not "this run's pack". A helper doubled the
`.evidence` suffix. And the `ev_`-prefixed node id could never equal Kane's bare-UUID pack
name — so the projection cleared every evidence reference *and* the schema then failed the
whole snapshot, which meant `kept snapshot` silently refused to write and the Ledger went on
serving an older state.

**One in the handoff.** `input.repair ?? promise.repair` could not distinguish "this run
routed nothing" from "the caller has no opinion", so a member that had just **passed** carried
the previous run's `code-break` into the handoff. A handoff is an instruction, and that one
was telling an agent to repair a promise that had just gone green.

**One orphan evidence pack**, caught by the referential-integrity property on the very commit
that first gave it something to find.

### Decisions recorded rather than buried

- The prior-verdict gate is a **fence, not a branch**, specifically so that no requirement had
  to be weakened. Requirements 6.3, 6.4, 6.5 and 6.9 are untouched.
- The grant is "at least one proven promise in the radius", not "all". A real regression beside
  a never-proven promise is still legitimate work, and the second promise is named in a
  diagnostic either way.
- On a repository that has never verified anything, every promise is `stale`, so the first
  failing run authorises no patch. That is correct rather than a gap, it is diagnosed rather
  than silent, and it does not touch the judge path, because the committed snapshot ships the
  baseline.
- The credit table in [`docs/kane/credits.md`](kane/credits.md) publishes the discarded runs as
  well as the kept one. The account paid for all of them.

---

## Checkpoint 26: does the engine leave this repository, and does it check itself?

Stages 23 to 26 asked one question in four parts. Can the engine be pointed at a repository
that is not this one (23), does a stranger's first two commands behave (24), does the sentence
"a published `@corgod/kept-cli` and `kept-core` are coming soon" survive being tested (25), and does
the tool graph the promises its own README makes (26). The stage 21 tail landed alongside:
task 21.3 gave the badge its visual polish, tasks 21.5 and 22.1 built the `cover gaps`
dual-axis ribbon the entry above describes, task 21.8 put the `kept watch` accept path on a
loopback listener outside the Next app, and task 21.9 added the dev-only live NDJSON pane.

The snapshot the four stages left behind, read off the committed
`apps/ledger/data/ledger.snapshot.json` at the time rather than from any test's expectation.
**This is the record of that moment, not the current file.** Work after it verified
`README.md:679`, which moved `provenCount` to 8, `staleCount` to 4 and `provenCoverage` to
`0.6153846153846154`, and re-ran the whole recorded suite, which changed the run and
diagnostic counts. `docs/self-verification.md` carries the current figures.

| Figure | Value |
|--------|-------|
| `totalPromises` | **13** |
| `designedCount` / `designedCoverage` | 13 / 1 |
| `provenCount` | 7 |
| `redCount` | 1 |
| `staleCount` | **5** |
| `undesignedCount` | 0 |
| `provenCoverage` | **0.5384615384615384** |
| `degraded` | false |
| `degradedReasons` | `[]` |
| `documents` | **two**: `apps/fixture/README.md` with 8 claims, `README.md` with 5 |
| `coverageAxes` | present: design completeness `6/6` at 100%, use cases complete `1/9` with 8 needing scenarios, proven `6/6` at 100% from `graph_execution_facts`, nine use-case rows |
| evidence / runs / diagnostics / amendments / review cards | 1 pack, 17 runs, 30 diagnostics, 1 amendment, 0 review cards |
| `generator` | `kept` `0.1.0`, `kaneCli` `null` |
| `freshness` | `testrun_done` / `ExecutionTestrun` / `2026-08-21T16:35:22.779Z` |

Two of those rows are the whole stage. **`documents` has two entries**, and the second is this
repository's own root `README.md`, cited at lines 22, 68, 89, 301 and 679. **`provenCoverage`
fell from `0.875` to 7 of 13** because those five claims came in with nothing proving them yet.
The fall was the deliverable rather than a regression: a ledger that shows what it owes is the
product, and one tuned to look complete is the thing this product exists to prevent. All five
were carried as `stale`, which is the honest word for designed and never run. One of them,
line 679, has since been verified by a test document authored live, so four are still owed and
the figure reads 8 of 13. [`self-verification.md`](self-verification.md) prints the
line-by-line accounting for both halves.

`generator.kept` reading `0.1.0` is stage 25 showing through into the artefact. It read `0.0.0`
for the whole of the project's life before it, which is a version nobody can install, and the
snapshot now records the one a stranger could.

### The defect clearing it turned up

**`kept-core` imported `yaml` and `zod` without declaring either of them.** Three modules
reach for them, `model/snapshot.ts` for `zod` and `kane/failureYaml.ts` and `kane/packTriage.ts`
for `yaml`, and the manifest listed no runtime dependencies at all. Inside this workspace that
is invisible: npm hoists both packages to the root `node_modules` for the Ledger's own use, so
every import resolves, every test passes and every type-check is clean. From the registry it is
a broken package. An installer receives a core that fails at import time with
`Cannot find package 'yaml' imported from …`, and nothing in a component suite can see it,
because the thing that hides the fault is the workspace the suite runs in.

It was found by the only test that could find it: the one that packs both tarballs, installs
them into a directory outside the workspace root with no `node_modules` above it, and runs the
binary from there. Both manifests now declare `yaml` at `^2.9.0` and `zod` at `^4.4.3`, both
packages are off `private` at `0.1.0`, and `@corgod/kept-cli` depends on `kept-core` by `^0.1.0`
rather than by the literal `0.0.0` that only ever resolved through a symlink.

This is the same shape as the defects recorded above, and it is the reason this file is worth
keeping. Every unit passed. The composition was wrong. The claim "these packages are
publishable" had no test behind it, which is precisely the class of unchecked claim KEPT was
built to catch, found this time in KEPT.

### The metric that did not move, and why that is correct

Task 26.3 expected `undesignedCount` to become non-zero and `designedCoverage` to fall below
`1`. Neither happened. Both still read 0 and `1`, and the reason is the citation grammar rather
than an omission or a trimmed graph.

A promise enters this graph only through a `@verifies` tag, and the tag that admits a claim is
the same annotation that binds the document carrying it as that claim's designed test.
`packages/kept-core/src/providers/baseline.ts` sets `designedTest` to the tagging document's
own path and id for every candidate it emits, with no branch that omits it, so a promise with
no designed test cannot be constructed here at all. The `undesigned` arm is real, specified by
Requirement 19.4 and exercised over generated providers by Property 36, and a host repository
whose provider supplies an unbound claim gets exactly that behaviour. It is unreachable in this
repository, by construction.

What fell instead was `provenCoverage`, and it is the better figure to have fallen. Reaching
`undesigned` from a `@verifies` tag would have needed a second annotation meaning "admitted
here, and deliberately not designed", used by nothing but this repository's own claims, which
is the special case Property 36 exists to forbid. The graph reports five `stale` promises
instead: designed, not yet proven, counted, and visible on the page beside the lower
percentage they caused. Nothing is omitted, which is what Requirement 19.4 is actually about.
The finding is recorded in design §23.2 and at task 26.3 rather than left as a gap.

**Cleared.** The engine runs against a configured repository, the onboarding commands behave on
a bare one, the packages install from a tarball outside this workspace, and the README making
the claims is now a document in the graph that checks them.

---

## Stage 22.2: does the documentation trigger close, and what stopped it

Design §11.4 asks for the documentation trigger to be driven as one continuous cycle:
overpromise in a README, let the hook fire, bind a designed test, fail it, route
`docs-lie`, propose an amendment, revert the claim. It was driven live against Kane CLI
0.8.4 and a real Chrome. **The first four steps and the last one ran; the failure, the
branch and the amendment did not**, and working out why took longer than the run did. That
is the reason this entry is here rather than a line saying the cycle ran.

A ninth claim went into `apps/fixture/README.md` saying the Shop screen keeps the selected
roast filter across a full page reload. The filter is `useState` over a static array, so
the claim was false by construction. A designed test was written for it, two verifications
were run, Kane authored the test against a real browser, and the claim was reverted. That
order matters and the second finding below is about why. `apps/fixture/README.md` is back at
its committed content and its pinned sha256
`b2118de7aef19263a2d6fb18eba0778e4120b5521077e6de4ed0d26383efadef` holds.

Read out of the committed captures under `docs/kane/loop/t9-*` rather than transcribed:

| Figure | Value |
|--------|-------|
| authoring run, `run_end` events | 5 over four steps, 3 passed, 2 failed, exit 1 |
| credits, summed off those five | **41.354**, the dearest single document in this repository |
| terminal `test_md_done` events | 2, from four `bifurcation` events, at 109 s and 168 s |
| `commit`, on both halves | `committed: false`, `reason: run_failed` |
| Kane's verdicts on the false claim | two, both `confirmed: false`, `automation_bug`, `agent_misstep` 0.82 and `state_transition_bug` 0.84 |
| `verify --changed apps/fixture/README.md` | **0** members in the radius, no Kane process started, 0 verdicts written |
| `verify --changed apps/fixture/app/shop/page.tsx` | 2 members, both passed, 1 skipped and diagnosed |
| plan members carrying no `test_id` | **8** of 17, including the new document and all three self-cited tests |
| identifier the failed authoring run minted anyway | `a2bda3fb-07fd-4c0f-a9e7-85e66e878625`, into `tests/output-shop_filter_persist/.internal/meta.json` at 12:00:55Z, five minutes after the plan was captured |
| amendments in the committed snapshot | still **1**, `am_57fdcb99` from 21 August, against the T-7 discount claim |

The whole-suite counts are not re-taken here: this work is documentation, spec text and
three source fixes, and the authoritative run belongs to task 27.4. What was run for it is
the guard that pins the captures, `packages/kept-cli/test/docs-trigger-loop.test.ts`,
eighteen tests in 126 ms with Kane invoked zero times.
[`kane/loop/README.md`](kane/loop/README.md) is the measured write-up.

### The structural findings, including one that did not survive checking

**A designed test with no recording cannot enter a blast radius, and that is where the
identifier lives.** KEPT takes a `test_id` only from Kane's plan, never from a path, and
Kane's plan reports the value it wrote into the recording it keeps beside the document, at
`tests/output-<slug>/.internal/meta.json`. Across all seventeen members of the captured
plan the two agree exactly: every identifier in the plan is the recording's, and it is
absent for precisely the eight members that have no recording. So a promise whose designed
test has never been authored is unreachable through the replay path, and the exclusion is
diagnosed by name rather than silent. Recorded as assumption A20 beside A19, in design
§7.2.1, and at task 22.2.

**The stronger reading of that, which this cycle looked like it had proved, does not
hold.** A *failed* authoring run still writes a recording and still mints an identifier:
this run's own recording carries `test_id: a2bda3fb-07fd-4c0f-a9e7-85e66e878625`, written
at 12:00:55Z with `run_kind: author` and `status: broken`, and T-7's authoring run reported
`committed: false, reason: run_failed` while `tests/cart_discount_test.md` carries an
identifier in the same plan. The reason the new member never went red is the timeline: the
plan was refreshed at 11:55:28Z, both verifications ran inside the next ninety seconds, the
authoring run finished at 12:01, and **no verification was run after it** (the committed
snapshot's freshness is still 11:56:08Z). So what is established is narrower and still
worth having: a test authored after the last plan refresh is invisible to the radius until
the plan is refreshed. Whether the member would then have gone red needed one
`verify --changed` against a refreshed plan.

**That run has since been made, and it closes A20.** A second cycle re-added the claim,
re-authored the document live for 36.8983 credits, deleted `.kept/plan.json` so the plan
would be recaptured, and ran `kept verify --changed apps/fixture/app/shop/page.tsx`. The
refreshed plan carried `test_id: 1080f892-b002-43f4-b123-16dc4ea3837b`, the member entered
the radius with nothing skipped for want of an identifier, it failed, and the promise moved
from `stale` to **`red`** for 10.80946 credits. So the exclusion above is a property of when
the plan was taken and never of the claim, and the ordering it implies is demonstrated:
author, refresh the plan, then verify.

**The third prediction is now measured wrong rather than untested.** The router answered
`test-drift`, not `docs-lie`, because Kane reported `confirmed: false` and R6.4 makes the
inline verdict object outrank the numeric code. `kept amend propose` therefore staged
nothing, which is §8.1.1 working, and `nextAction` granted `allowedPaths: []` with the
claim's own document on the forbidden side. One defect fell out of it: that refusal was
invisible in the human summary, because its diagnostic is `info` and the human form drops
`info` on purpose. `propose` now prints it. The `docs-lie` branch stays demonstrated on T-7.

The inconsistency left standing above is resolved rather than still open: the file header of
`packages/kept-cli/test/docs-trigger-loop.test.ts` no longer reads the exclusion as
permanent, and it now carries a second live run behind that reading.

**One thing this cycle's record lost, stated rather than papered over.** iCloud Drive
hollowed out 194 files in this repository afterwards, and five of the second cycle's
captures were among them, never having been committed. The assertions moved onto
`t9b-handoff.json`, which survived and carries the same facts as structured fields. Two
figures went with the lost files, the failing member's result code and its credit charge,
and the suite says so where it used to assert them rather than restating them from a
console transcript.

**The fuller reason `staleCount` reads 5 survives that correction intact.** The five
self-cited root-README promises have three designed tests between them, and all three carry
no identifier because none has ever been through an authoring run at all, so no recording
exists for the plan to read. They are not waiting on somebody remembering to run them; they
are waiting on the run that would mint the identifier, and until then `verify --changed`
cannot select them however the radius is computed. "Designed but not yet proven" was true
and incomplete. `docs/self-verification.md` now carries the fuller reason and the capture
anyone can check it against.

### The defect clearing it turned up, for the fourth time in the same shape

**`kept snapshot` had no projection from `.kept/review-cards/`.** `listReviewCards` was
written, exported, unit-tested, and its own doc comment said `kept snapshot` filled the
snapshot's `reviewCards` field from it. Nothing called it. `runSnapshot` took `reviewCards`
only as a request field, and neither of the two commands that produce cards passed it, so
the snapshot wrote `[]` on every path a human could reach and `/reviews` could never render
a held change. The documentation edit is what exposed it: Kane staged nine changes, KEPT
mirrored nine cards to disk, the JSON output reported nine, and the snapshot written in the
same second carried none.

Two more in the same wiring, both in the sentence a human reads rather than in the data.
The `kept reconcile` summary hard-coded `review cards none created` while nine were staged,
and the `reconcile-completed` diagnostic hard-coded `no review card created`. Half true in
the worst available way: the held claim was correct and the count was not. Both now read off
the result. The `evolve` renderer beside them already spelled it correctly, which is what
made the divergence findable at all.

And one in published prose: `docs/publish.md` carried a section headed "Currently red, and
blocking" naming a defect that had already been fixed. A document describing a state the
repository has left is exactly the failure this project exists to catch, so it is now
guarded by `packages/kept-cli/test/published-docs.test.ts`.

**Every unit passed. The composition was wrong.** That is the same shape as the evidence
chain in the entry above, as the handoff resurrecting a stale repair annotation, and as
`kept-core` importing `yaml` and `zod` without declaring them. Four entries, four defects
that lived in the wiring between parts that were each correct alone, and none of them
findable by a component suite. Recording that they share a shape is the point of this file.

### Two more found while putting the tree back, and both are about counting

**The run log's cap dropped a run six promises were citing.** `MAX_SNAPSHOT_RUNS` was
applied as a plain newest-first slice. The log grew past the cap for the first time during
this stage, and `108dbb62`, the whole-suite replay that earned six of the seven proven
verdicts, fell off the end of it. All six promises went on carrying
`verdictSource.runId: '108dbb62…'` while `/runs` no longer listed the run, so the row a
reader clicked through to did not exist. That is the same fault the evidence rules of §9.1
refuse in three other places, and for the same reason: a reference to something the
snapshot does not carry is worse than an absent one, because the absent one is honest and
the dangling one looks like a bug in the page. The cap is a cap on history rather than on
provenance now, so a cited run is retained regardless of age, and
`committed-snapshot.test.ts` asserts the property rather than the retention code.

**`maintain reconcile` appends use cases rather than matching them, so the ribbon's
headline figure is not idempotent.** Three `maintain reconcile --plan` runs against the
same document, two of them identical, moved Kane's graph from nine use cases to thirteen
by re-extracting the same ones: `uc-11`, `uc-12` and `uc-13` are word-for-word duplicates
of `uc-1`, `uc-2` and `uc-3`. `usecases_complete` therefore fell from `1/9` to `1/13` and
`ucs_needing_scenarios` rose from 8 to 12, which is fabricated debt: no new use case had
been described and the product had not changed.

The uncomfortable half is that **`1/9` was already carrying one earlier round of the same
thing.** `uc-1` and `uc-6`, `uc-2` and `uc-7`, `uc-3` and `uc-8`, `uc-5` and `uc-10` are
four duplicate pairs, so the graph describes five distinct use cases and reports nine. The
figure this repository has been publishing is Kane's own count, faithfully, and Kane's own
count is inflated. It is left at `1/9` rather than corrected to `1/5`, because §5.3.0's
rule is that the ribbon publishes Kane's report verbatim and the moment KEPT starts
deduplicating Kane's graph on the way to the page it is no longer quoting a source, it is
editing one. What the page owes a reader instead is the caveat, and the ribbon's own
copy is where that belongs.

Today's four were undone with `kane-cli context revert 36 --yes` and `revert 35 --yes`,
which invert a record's effects through a compensation record and leave history intact:
`context fsck` verifies 39 records with the derived projection in parity, and `cover gaps`
reads `1/9` with eight use cases needing scenarios again. The `retire`, `revert` and
`review` verbs are the reason this was recoverable at all, and none of them had been
exercised before.

### Decisions recorded rather than buried

- **The identifier rule was not relaxed.** The obvious way to make the cycle finish is to
  derive a `test_id` from the document's path when the plan has none. That would make every
  later re-verification a guess, so the exclusion stays, and it stays diagnosed by name
  (`radius-member-no-test-id`) rather than silent.
- **The claim was not made true to make the run pass.** Implementing filter persistence in
  the fixture would have produced a green cycle demonstrating nothing, and it is the same
  mistake §8.1.1 exists to stop an agent making.
- **The cycle was driven once.** Kane's category for a never-true claim has now moved
  across `application_issue` at 0.95 and `automation_bug` at 0.84, so re-running until it
  says something convenient would be a coin flip presented as a demonstration.
- **Task 22.2's checkbox is left open.** What was predicted and what was delivered are both
  written at the task, the way 21.9 and 26.3 are, and whether that is enough to tick is the
  author's call rather than this file's.

**Recorded, not cleared.** The reconcile half and the verification half both ran live and
are committed; the amendment half is demonstrated on T-7 and is not demonstrated by this
cycle. What stands between this cycle and its own last three steps is now measured, and it
is one verification against a refreshed plan rather than a property of the system.

---

## Still outstanding

Checkpoint 20 needed the account holder for two things, and both have since landed. The
Ledger is deployed, the README's line 17 carries the live URL in place of the placeholder that
held it there, and the deploy with its post-deploy checks is written up in
[`deploy-ledger.md`](deploy-ledger.md). The demonstration video is recorded and linked from the
README's Start here section.

What is outstanding follows from these entries rather than from that work. The task plan notes
that the committed recording shows the Ledger **as it was**, and the state in the stage 26 table
above is no longer that: it is clean, it publishes both coverage axes, the degraded chip the
recording would have shown on the rail is gone, and the graph the recording walks has thirteen
promises in it rather than eight, five of them cited to the repository's own README. So the
recording is due to be made again against the state recorded here, which is where the plan puts
it.

The README's [Status](../README.md#status) section carries the full accounting, including the
coverage ribbon and the docs-triggered loop.
