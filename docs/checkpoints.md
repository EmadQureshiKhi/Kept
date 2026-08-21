# Checkpoint record

Checkpoints in `.kiro/specs/kept/tasks.md` say "ensure all tests pass, ask the user if
questions arise". This file is where the answers live, so a checkpoint is a record
rather than a moment someone remembers passing. One section per checkpoint, each with
the counts it was cleared on, the failures that were investigated and what turned out
to be real.

---

## Checkpoints 16 and 18 — verified 2026-08-21

Two checkpoints cleared in one pass, because four agents had been committing in
parallel across disjoint lanes and each had verified only its own: three of them
reported cross-lane failures they were told not to touch, and nobody had run the whole
tree at once. That is what this pass did.

### The authoritative runs

`npm run check` is `node scripts/check-readonly.mjs && tsc -b && npm run
typecheck:fixture && npm run typecheck:ledger && vitest --run`.

| # | Time | Tree | Result |
|---|------|------|--------|
| A | 10:51 | `c0e5b1f`, nothing uncommitted but `tasks.md` and two strays | **green** — 132 files, 2221 passed, 1 skipped, 51.3 s |
| B | 11:04 | A plus another lane's half-written triage modules | failed in `tsc -b` at 5 s, two type errors in that lane's uncommitted files |
| C | 11:41 | `a24be2d` plus that lane's uncommitted work, now compiling | 135 files, 133 passed, **2 failed**, 2268 passed / 3 skipped / 1 todo, 34.7 s |

Run A is the authoritative statement about the committed tree, and it is green.
Run C's two failures are both in the still-uncommitted lane and are described below.

The read-only scan reports `42 Ledger source files, 11 rules, no violations`;
`tsc -b`, `tsc -p apps/fixture` and `tsc -p apps/ledger` are all clean in A and C.

**Which commit the 2221 was measured at.** Run A's `132 files, 2221 passed, 1 skipped,
51.32 s` is measured at **`c0e5b1f`**, not at whatever HEAD happens to be when this is
read. Three commits landed after it: `302c99a` (`vercel.json`, `docs/deploy-ledger.md`),
`422d4d2` (README front matter **and a new test file**,
`packages/kept-core/test/readme-front-matter.test.ts`), and `fe62a5f` (the flake fix
below, which changes two `numRuns` constants and adds two `timeout` options — no test is
added or removed). So at `a24be2d` the tree carries **133** test files, one more than run
A counted, and its passing total is correspondingly higher than 2221. That reconciles run
C exactly: 132 from run A, plus `readme-front-matter.test.ts`, plus the uncommitted lane's
two new test files (`kane-pack-triage`, `kane-pack-archive`) is the 135 files C reported.

The figure is therefore falsifiable at `c0e5b1f` and only there. It has deliberately not
been re-measured at `a24be2d`: the lane described under "the two failures that are not
ours" is still mid-flight, so a whole-tree run now would report that lane's in-progress
state rather than the committed tree's, and the resulting number would be misleading in
both directions. The honest re-measurement is a single `npm run check` on a clean tree
once that lane lands.

**Re-verified at `a24be2d`** (targeted, not whole-tree): `reduced-motion-equivalence`
14 passed, and the seven Ledger scan gates in one run — `motion-scan`, `contrast-matrix`,
`token-parity`, `forbidden-palette`, `typography-discipline`, `animejs-import-scan`,
`read-only-scan` — **128 passed**, which is exactly the sum of their per-file counts in
the checkpoint 18 table. So the gate counts below are not carried on run A's authority
alone.

### The one real regression, found and fixed

Three agents attributed a set of failures to machine contention from running in
parallel. Re-run on an idle machine, all but one of them were exactly that:

- **`packages/kept-cli/test/argv-contract.test.ts`, `committed-snapshot.test.ts`,
  `recorded-verify-all.test.ts`** — reported failing while `verify.ts` and the
  snapshot were mid-edit. Both edits have landed (`9fec79a`, `7af96a5`) and all three
  files pass in run A.
- **The `|fixture|` suites** — reported failing because `apps/fixture/lib/cart.ts`
  "computes a discount the tests say it must not". Confirmed transient: the file is
  the single-`return` `reduce` form with no discount logic, `git diff` on it is empty,
  and its last commit is `fe8a5bb`. The reported state was the deliberate break of the
  closed-loop demonstration, caught mid-flight.
- **`verify.test.ts`, `token-parity.test.ts`, `degradation.prop.test.ts`** — pass in
  run A and in isolation. Contention.

The exception was real, and it was not contention.

**`apps/ledger/test/projection-completeness.prop.test.tsx` was genuinely too slow for
its budget.** Reproduced with no other agent competing and nothing else running:

```
✓ paints every promise once, carrying its claim and its path:line      3174 ms
✓ renders one labelled role="list" with a native button per promise    2513 ms
✓ reaches any promise from an unfocused graph with arrow keys alone    3746 ms
× opens on Enter and names the verbatim citation, the test and the verdict
  Error: Test timed out in 5000ms.                                     5655 ms
✓ links exactly the artefacts the snapshot lists for that promise      3670 ms
```

A vitest project does not inherit the root `testTimeout`, so the ledger project runs
on the default 5 s per test. Five of the file's seven clauses mount `PromiseGraph`
once per generated case at 500 cases each, and one mount-assert-unmount cycle costs
6–8 ms — so each clause was spending 3.2–5.7 s of a 5 s budget. The same clause
finished in 3867 ms in one run and timed out at 5655 ms in the next. A test that is
green only when the machine is idle will be red for whoever runs it next.

Fixed in **`fe62a5f`**, in the test rather than in `vitest.config.ts` (whose comment
block explains why it is pinned — a cold `import('jsdom')` on this iCloud-synced tree
once took 629 seconds, and the ledger project is deliberately one fork with its own
`sequence.groupOrder`):

- `RENDER_RUNS` is **150** for the five mounting clauses; `NUM_RUNS` stays **500** for
  the two analytic clauses, which only read a generated snapshot and finish in tens of
  milliseconds. 150 is half again this plan's floor of 100 cases per property, and the
  five clauses together still sample 750 snapshots.
- The slowest clause now finishes in **1604 ms**, and the whole ledger project dropped
  from 40.4 s to 26.3 s.

`apps/ledger/test/reduced-motion-equivalence.test.tsx` was the other file near the
line, at 3676 ms and 3633 ms, and its cost has no such fix: its two settling tests
wait out real declared durations — `--dur-pulse` 1400 ms for the edge pulse,
`--dur-figure` 760 ms for each of the rail's two counting figures, `--dur-slow` 420 ms
for the flip, `--dur-base` plus three `--stagger-panel` steps for the panel cascade —
a little under 4 s of clock that is the claim being made rather than waste. The lever
that would make those tests fast is shortening the motion tokens, which is changing
the product to suit the test. So those two tests state their own 30 s budget, the same
one the root config gives every other project, with the arithmetic written down beside
it. If it is ever reached, an orchestration never resolved, which is precisely what
`pendingMotion()` asserts.

### The two failures that are not ours

Run C failed two files, and both belong to the lane that was still uncommitted while
this pass ran (`packages/kept-core/src/verdict/failureYamlTriage.ts`, `router.ts`, and
the new `kane/packTriage.ts` / `kane/packArchive.ts`):

| File | Test | Why |
|------|------|-----|
| `packages/kept-core/test/kane-real-capture.test.ts` | spells the category one level below the alias the loader accepts | `expect(note.signal).toBeNull()` now receives `"application_issue/ui_data_defect"` — the uncommitted triage reads a signal where the committed one read none |
| `packages/kept-cli/test/recorded-verify-all.test.ts` | routes the failing member to docs-lie and leaves the others unrouted | same cause, one layer up: the branch the router returns moved with that signal |

Both files pass in run A, on the committed tree, so the failures were introduced by
work in progress and are that lane's to settle as it lands its routing fix. They were
not edited here.

---

### Checkpoint 16 — the Verified dimension is real

The substance of this checkpoint is that the promise graph carries real verdicts
rather than eight `stale` ones. Read from the committed
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
| `degradedReasons` | `["coverage-payload-unreadable"]` |
| `freshness` | `testrun_done` / `ExecutionTestrun` / `2026-08-21T05:34:51.562Z` |

Seven `proven`, one `red`, no `stale`. Every verdict names its own `verdictSource`
with `terminalEventType: testrun_done` and a `memberStatus` that agrees with it, and
those sources name **two** distinct runs — `108dbb62` for six promises and `57591bff`
for two — which is the closed loop of 15.6 re-verifying part of the graph and carrying
the rest across by reference. The newest of those instants is exactly the freshness
triple's, so nothing carries a verdict from the future. The one `red` is
`apps/fixture/README.md:20`, the never-true discount claim, and it is the only promise
carrying a repair (`test-drift` on this run). That failure is the designed deliverable
of the corpus, not a defect.

Every figure in that table was re-read straight from the committed snapshot at `a24be2d`,
including the 6/2 split across the two run ids, the `red` promise's citation
(`apps/fixture/README.md:20`) and its `test-drift` repair — so the table is a quotation of
the artefact, not a transcription of a test's expectation.

`packages/kept-cli/test/committed-snapshot.test.ts` agrees with what the file
actually says rather than with a stale expectation, and it passes. Worth recording
precisely, because the brief for this pass said otherwise: **`degradedReasons` is
`["coverage-payload-unreadable"]`, not `["assurance-status:refused"]`.** That is the
third distinct honest reason this axis has been discarded for, and it is a different
observation from the second: `cover` did answer with a coverage payload this build
could not project, evidenced by 28 `info:enrichment-coverage-entry-refused`
diagnostics and one `warn:enrichment-coverage-unprojectable` beside
`warn:merge-degraded`. The test deliberately does not pin the token — it requires at
least one reason and that a diagnostic explain it — because pinning it would make the
test a statement about which way Kane happened to fail this week.

`provenCoverage` stays `null` and is not papered over. Seven proven verdicts do not
license a coverage percentage: a verdict is what KEPT observed, coverage is what
Kane's graph says the observation covers, and the axis that answers the second
question was discarded. Publishing a figure derived from the verdicts alone would
state as coverage something Kane never confirmed (R2.11).

**Checkpoint 16: cleared.** The dimension is real — real verdicts, from real terminal
events, with the one number nobody earned still withheld.

### Checkpoint 18 — the page moves and the reduced-motion render is identical

Every named gate, confirmed green by name in one run (11 files, 206 tests, all
passing):

| Gate | File | Tests |
|------|------|-------|
| reduced-motion equivalence | `apps/ledger/test/reduced-motion-equivalence.test.tsx` | 14 |
| widened CSS motion scan | `apps/ledger/test/motion-scan.test.ts` | 27 |
| visual trio 1 — contrast | `apps/ledger/test/contrast-matrix.test.ts` | 11 |
| visual trio 2 — token parity | `apps/ledger/test/token-parity.test.ts` | 8 |
| visual trio 3 — forbidden palette | `apps/ledger/test/forbidden-palette.test.ts` | 17 |
| typography scan | `apps/ledger/test/typography-discipline.test.ts` | 10 |
| source scan 1 of 6 | `packages/kept-core/test/no-raw-result-code.test.ts` | 5 |
| read-only scan | `apps/ledger/test/read-only-scan.test.ts` | 42 |
| source scan 3 of 6 — router isolation | `packages/kept-core/test/router-isolation.test.ts` | 10 |
| animejs import scan | `apps/ledger/test/animejs-import-scan.test.ts` | 13 |
| judge-path scan | `packages/kept-core/test/judge-path.test.ts` | 49 |

Each scan still refuses to pass by inspecting nothing, which is the property that
keeps a green scan meaningful. Confirmed per file: `no-raw-result-code` and
`router-isolation` both open with a "the scan itself is not a no-op" block asserting a
file was found under every scan root and that the exempt or fenced file is among them;
`read-only-scan` fails on "no Ledger source file was scanned at all";
`animejs-import-scan` fails if the gate module is absent, since its absence would make
every later rule pass by inspecting nothing; `motion-scan` requires the shell
stylesheet and at least one parsed declaration; `forbidden-palette` and
`typography-discipline` each assert a non-empty tree; `token-parity` throws when
`tokens.css` is empty, because parity against nothing is not parity; and `judge-path`
throws outright from `findOffences` on an empty file set.

The reduced-motion equivalence test is the one that matters most here and it is not
vacuous: its orchestration registry is asserted to name exactly the shipped modules
that import `lib/motion.js`, so a flourish cannot land without joining the
comparison, and the registry currently has five entries — M1 through M5. The
comparison drives all five, waits for `pendingMotion()` to reach zero, and requires
the settled DOM and the `prefers-reduced-motion: reduce` DOM to be equal declaration
by declaration, including each metric figure's accessible name.

**Checkpoint 18: cleared**, with the reservation that the tree is green apart from the
two files described above, which belong to a lane that was still mid-flight and which
pass on the committed tree.

### The two untracked strays, decided

- **`apps/ledger/next-env.d.ts` — committed** (`a24be2d`). The two Next applications
  were inconsistent: the fixture's copy has been tracked since the fixture landed, the
  Ledger's had drifted untracked. One treatment for both, and committed rather than
  ignored, because the judge path is `npm run check` on a fresh clone and
  `tsc -p apps/fixture` names `next-env.d.ts` in its `include` — a file the typecheck
  names should be a file the clone has. Both copies reference `./.next/types/*.d.ts`,
  which is generated and gitignored, so the obvious objection is a committed file
  pointing at absent build output; probed directly, a project with `skipLibCheck` on —
  which both apps set — typechecks clean with those references unresolvable, because
  the file is a declaration file and is skipped. It costs nothing on a clone that has
  never run Next.
- **`.vscode/` — deleted.** It held one file whose entire content was `{}`. There was
  no setting in it to preserve, so there was nothing to commit; it is not added to
  `.gitignore`, so if an editor writes a real setting later, the diff will show it.

### Assumptions made rather than asked

- The two failing files above are left to their lane. Re-checking after that lane
  lands is cheaper and more honest than editing files another agent is mid-edit on.
- Cutting Property 23's render sample is a change to what the property samples, not to
  what it claims. 150 cases per clause is above this plan's stated floor, and a
  property that reliably runs is worth more than one that samples more and flakes.
- `degradedReasons` was recorded as the file states it, not as the brief for this pass
  predicted. The snapshot is the artefact; the brief was working from an earlier read.
