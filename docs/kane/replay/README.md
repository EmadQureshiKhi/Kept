# The recorded zero-credit replay of the full suite

`npm run loop` — `kept verify --all --member-debug` — run against the live
`kane-cli` 0.8.4 with every recording of the corpus committed, captured verbatim.
`packages/kept-cli/test/recorded-verify-all.test.ts` asserts against these bytes and
starts no process.

| file | what it is |
|---|---|
| `loop.stdout.txt` / `loop.stderr.txt` / `loop.exit.txt` | the `npm run loop` invocation, exit 0 |
| `verify-all-replay.ndjson` | Kane's stdout for the **same argv**, captured directly so the stream is readable |
| `verify-all-replay.stderr.txt` | the `KANE_TESTRUN_MEMBER_DEBUG=1` member stream — where the credit figures are |
| `verify-all-replay.exit.txt` | exit 1: one member failed, which is the designed outcome |
| `plan.json` | the plan cache the run wrote, repository-relative paths and all |
| `run-entry.json` | `.kept/handoff/<runId>.json`, the run entry (`.kept/` is gitignored) |

## The outcome

Nine members, eight passed, one failed. `totals` is
`{tests: 9, passed: 8, failed: 1, broken: 0, skipped: 0, authored: 0}` and `authored`
is `[]` — **Kane authored nothing**; every step came back from a recording. The
failing member is `tests/cart_discount_test.md` (T-7), which asserts the never-true
ten-percent-discount claim and is designed to fail on a correct application.

Eight verdicts moved: **seven `proven`, T-7 `red`**, routed to `docs-lie`. The
freshness triple advanced to a real `testrun_done`, and
`apps/ledger/data/ledger.snapshot.json` now publishes `provenCount: 7`,
`staleCount: 0` where it published eight `stale` before.

## What it cost, measured rather than asserted

R4.6 says a replay's reported credits are 0. The honest answer is more interesting.

**The stream reports no cost at all.** There is no `credits_consumed` field anywhere
in `verify-all-replay.ndjson`, so `credits()` answers **`null`**, and the run entry
records `"credits": null`. A `0` there would be a claim about what the run cost;
`null` is the truth, which is that this family's terminal event does not report cost.

**The figure exists one layer down, and only for the failure.** With
`--member-debug`, each member's own `testmd` stream is echoed on stderr, and exactly
one line out of nine members carries credits — the failing member's `run_end`:

```
result_code 740, reason_code assertion_error.confirmed_product_bug
run_end.credits_consumed          10.84068
run_end.verdict.credits_consumed   5.01660   (the bug judgement, billed separately)
```

**The balance is the only end-to-end measure.** `kane-cli balance`, either side of
each run:

| run | delta |
|---|---|
| one passing member replayed alone (`tests/home_cta_test.md`) | **0.0000** |
| the failing member replayed alone (`tests/cart_discount_test.md`) | 9.8505 |
| the whole suite, three times | 17.6992, 19.8322, 23.0489 |

So a replay is **free where it passes** and costs a judgement where it fails. R4.6's
"0 credits" holds for the eight passing members and does not hold for the ninth, and
the ninth is failing on purpose. A judge who clones this repository and runs
`npm run loop` spends credits only on Kane's analysis of the docs-lie.

The `[member]` stream is **not** in `loop.stderr.txt`, and that is a gap rather than a
choice: `KaneInvoker` consumes the child's stderr and keeps only a tail, so R4.12's
"capture the `[member]`-prefixed events into the run diagnostics" is unimplemented.
`verify-all-replay.stderr.txt` exists because the same argv was run directly.

## Four findings that were shapes nobody had written down

Each of these was a silent wrong answer before this run, and each is now pinned by a
test.

**1. `testrun run --dry-run` emits no `testrun_done`.** It prints one line — the
`testrun_plan` event — and exits 0, because a dry run executes nothing and so has no
execution to report done. `readPlan` required the terminal event conjunctively, so it
discarded *every* plan the installed CLI can produce: `.kept/plan.json` was never
written, no identifier was ever derived, and `kept verify --all` reported
`radius empty — nothing was invoked` on a repository with thirteen selectable
members. The gate is now "a clean exit carrying a plan event is a complete dry run",
and a truncated stream that also exits badly is still a crash.

**2. Kane reports member paths absolute; the graph keys on repository-relative.**
`testrun_plan.members[].path` and `testrun_member_end.path` both arrive as
`/Users/…/KEPT/tests/home_cta_test.md` against a graph that says
`tests/home_cta_test.md`. The two compare unequal, which read as "no promise is
designed by this member" — an empty radius that looks like a decision. `toRepoRelative`
is the one conversion, on the boundary, and `PlanMember.path`'s own doc comment
already promised it.

**3. `--from-context` cannot name the corpus.** It resolves ids against the
**assurance graph**, so the plan's own `test_id` — a testcase UUID — is rejected
outright:

```
error: --from-context: unknown id '6badb68a-…' — it does not resolve in the assurance graph
```

and the only ids it does resolve are `t-1`…`t-4`, which name the four unauthored
`.testmuai/tests/*_test.md` documents `design tests` wrote. So `--all` names the
plan's member **paths** instead. This matters beyond `--all`: R4.2 specifies
`--changed` as `--from-context <ids>` with plan identifiers, and that invocation
exits 2 against 0.8.4. The `--changed` path is left exactly as the requirement
specifies, and the mismatch is recorded here rather than patched silently.

**4. An unscoped `testrun run` is not free.** It selects every `*_test.md` in the
project — thirteen documents here, not eight — including the four unauthored drafts,
which have no recording and would be **authored live**, against a discount feature
the fixture does not have. A member with no recording has no `test_id` in the plan,
so the plan already distinguishes them, and `--all` now names only the identified
ones and diagnoses the rest per member:

```
warn verify-suite-member-unidentified: .testmuai/tests/apply-discount-…_test.md is in
  the testrun plan with no test_id, which means Kane holds no recording for it, so
  replaying it would author it live and spend credits.
```

Nine cached members take **215–242 s** wall-clock, so `--all` also needed a budget
above the 300 s hook figure; `--changed`, the save-hook path, keeps it.

## Two things this run does not fix

**`kept build` was discarding every verdict.** The command's own header says "every
prior verdict is preserved", and it did not: the merge answers from the providers, no
provider knows a verdict, so the rebuilt graph came back eight times `stale`
immediately after the replay wrote eight verdicts. It now carries the verdict state
forward, keyed on promise id — and an id is derived from the citation plus the
normalised claim, so a match is the same sentence in the same file and a reworded
claim correctly starts `stale` again. That fix is in this commit; the discovery
belongs to this run.

**The evidence pack a verdict points at is the wrong one.** `listArtifacts` resolves
the newest pack under `.testmuai/evidence/` by mtime, and this tree contains iCloud
duplicates — the run resolved `a1039478-… 2.evidence`, with a literal space and a `2`.
The snapshot clears the reference rather than publishing a dead link, so nothing is
wrong in the committed file, but pack curation (15.7) inherits the problem.

`cover` still refuses, on a third distinct reason: the newest sealed pack is now a
*replay* pack, and Kane answers
`error: <id> carries no coverage/usecases.yaml — the pack predates coverage or its
project had no .context at seal time`. So `degradedReasons` remains
`["assurance-status:refused"]`, `provenCoverage` remains withheld as `null`, and the
snapshot publishes seven proven verdicts without publishing a coverage percentage —
which is the distinction R2.11 exists to protect: a verdict is what KEPT observed, and
coverage is what Kane's graph says the observation covers.
