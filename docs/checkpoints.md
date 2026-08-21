# Verification record

**What this is for.** The task plan places checkpoints between stages, each of which says
"ensure all tests pass". A checkpoint that is only a moment somebody remembers passing is
not evidence, so this file is where the answers live: what each checkpoint asserted, the
counts it was cleared on, and — the part worth reading — what clearing it turned up.

Three of the entries below record defects that a passing component suite could not have
found. Those are the reason this file exists rather than a line saying "all green".

Reproduce the authoritative run with:

```bash
npm run check    # check-readonly.mjs && tsc -b && both app typechecks && vitest --run
```

---

## Checkpoint 16 — is the Verified dimension real?

The question is whether the promise graph carries real verdicts from real Kane terminal
events, or eight `stale` placeholders. Read straight from the committed
`apps/ledger/data/ledger.snapshot.json`:

| Figure | Value |
|--------|-------|
| `totalPromises` | 8 |
| `designedCount` / `designedCoverage` | 8 / 1 |
| `provenCount` | **7** |
| `redCount` | **1** |
| `staleCount` | **0** |
| `undesignedCount` | 0 |
| `provenCoverage` | **null** |
| `degraded` | true |
| `degradedReasons` | `["assurance-status:refused"]` |
| `freshness` | `testrun_done` / `ExecutionTestrun` / `2026-08-21T08:44:01.085Z` |

Seven proven, one red, none stale. Every verdict names its own `verdictSource` with
`terminalEventType: testrun_done` and a `memberStatus` that agrees with it, and those
sources name **two distinct runs** — `108dbb62` for six promises and `f2cac6b7` for two.
That split is the closed loop re-verifying part of the graph and carrying the rest across
by reference, which is the behaviour the write guard exists to produce. The newest of those
instants is exactly the freshness triple's, so no promise carries a verdict from the future.

The one red promise is `apps/fixture/README.md:20` — the never-true discount claim — and it
is the only promise carrying a repair annotation. **That failure is the designed deliverable
of the corpus, not a defect.** A green suite here would mean the docs-lie branch had nothing
to demonstrate.

Every figure in that table is a quotation of the artefact, re-read from the committed file
rather than transcribed from a test's expectation.

### Why `provenCoverage` is null and stays null

Seven proven verdicts do not license a coverage percentage. A verdict is what KEPT observed;
coverage is what Kane's assurance graph says the observation *covers*; and the axis that
answers the second question was discarded on this build. Publishing a figure derived from
the verdicts alone would state as coverage something Kane never confirmed, which
Requirement 2.11 forbids and which is the exact dishonesty this product exists to prevent.

`degradedReasons` is worth a note. It has legitimately read three different values across
builds — `assurance-status:refused` when there was no context store, and
`coverage-payload-unreadable` when `cover` answered with a payload this build could not
project, evidenced by 28 `enrichment-coverage-entry-refused` diagnostics beside
`merge-degraded`. `packages/kept-cli/test/committed-snapshot.test.ts` deliberately does
**not** pin the token: it requires at least one reason and a diagnostic explaining it,
because pinning the string would turn the test into a statement about which way Kane
happened to fail that week.

**Cleared.** Real verdicts, from real terminal events, with the one number nobody earned
still withheld.

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
| committed evidence | `evidence: []`, a README in the directory | 1 pack, 37 artefacts, 4.0 MB, every link a static URL |
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

## Still outstanding

Checkpoint 20 cannot be cleared from the repository alone. Two items need the account holder:

- **The Vercel deployment.** Everything it depends on is done — `vercel.json`,
  [`deploy-ledger.md`](deploy-ledger.md), and a README whose only remaining edit is one URL on
  line 17.
- **The demonstration video**, 180 seconds, in the mandated order: the deployed Ledger, a
  code-break repair, then an accepted docs-lie amendment diff.

The README's [Status](../README.md#status) section carries the full accounting, including the
coverage ribbon and the docs-triggered loop.
