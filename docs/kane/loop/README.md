# The closed loop, driven live — and the one clause it does not yet satisfy

`apps/fixture/lib/cart.ts` was broken on its one-line `subtotal` body, the fixture
was rebuilt and reserved, `kept verify --changed` was fired twice, and the subtotal
promise moved **red → proven**. Both handoffs, both captured `[member]` streams and
the snapshot carrying both terminal events are committed here.

One clause of the task is **not** met, and it is not met for a measured reason rather
than an unfinished one: the red run's repair branch is `docs-lie`, not `code-break`.
Everything below is the evidence for why, because that gap is the most interesting
thing this run produced.

| file | what it is |
|---|---|
| `the-one-line.txt` | the break and the repair, one line each |
| `verify-red.*` | `kept verify --changed apps/fixture/lib/cart.ts --member-debug`, broken build |
| `red-0944d075.handoff.json` | the handoff that run wrote (`.kept/` is gitignored) |
| `red-0944d075.member.ndjson` | the `[member]` stream it captured — 10 step groups, 2 members |
| `verify-green.*` | the same command against the repaired build |
| `green-57591bff.handoff.json` / `.member.ndjson` | the same two records for the green run |
| `pack-failure-yaml-index.yaml` | the sealed pack's top-level triage index |
| `pack-failure-yaml-cart-subtotal.yaml` | the per-step triage note for the broken subtotal |
| `balance-*.txt` | `kane-cli balance` either side of each run |

## The verdict transition, which is the thing being demonstrated

| run | `tests/cart_subtotal_test.md` | promise `p_8d965c2fae07` |
|---|---|---|
| `0944d075-8dab-4683-a59f-96e51308697c` | `failed` | **red** |
| `57591bff-4480-455e-9ab7-c92263ff58ac` | `passed` | **proven** |

Same command, same argv, same recording. The only thing that changed between them is
one line of application source. Seven promises are proven and the eighth is the
designed never-true discount claim, exactly as before the break — so the loop moved a
verdict and moved nothing else (R4.15).

Both runs went through `mayWriteVerdicts`: `testrun_done` arrived, exit meaning
`failure`, so the guard admitted them. Neither was widened to make that true.

Measured cost, from `kane-cli balance` either side:

| run | delta |
|---|---|
| red | 7.76 |
| green | 10.26 |

A replay is free where it passes and costs a judgement where it fails, which is what
15.3 measured over the whole suite and what holds here over two members.

## Blocker resolved: `kept verify --changed` could not run at all

R4.2 specifies the save-hook replay as `testrun run --from-context <ids>`. Against
0.8.4 that argv **exits 2**: the flag resolves ids against the assurance graph and a
plan member's `test_id` is a testcase UUID that does not live there. So every
save-triggered verification would have failed before this task, and the closed loop
could not fire. The argv now names the plan's member **paths**, exactly as `--all`
already did; the radius is still computed from plan identifiers and nothing else
(R4.4, Property 16). The observed error text is in `docs/kane/command-surface.md`.

## Finding 1: `testrun_member_end` carries no classification signal at all

The event carries `path`, `test_id` and `status`. **That is all.** No `result_code`,
no `reason_code`, no `verdict` object — verified across six live runs and visible in
every committed run entry, where `verdictSource.resultCode` is `null`.

Design §6.2's ladder reads the verdict object first (rules 1 and 2) and the coerced
code next (rule 3). Neither had anything to read, so every failure fell to rule 4,
delegated to the triage note — and the note lives inside a sealed `.evidence`
**zip** that `listArtifacts` does not open, so `failure-yaml-absent` was reported and
the answer was `docs-lie`. **Every failure this project has ever routed was routed
`docs-lie`, including a deliberately broken `subtotal`.** The three-way branch was a
one-way branch that looked like it was working, because the one failure anyone had
looked at closely was a genuine docs-lie.

R4.12 is the fix and it was recorded as unimplemented in 15.3. Under
`KANE_TESTRUN_MEMBER_DEBUG=1` each member's own `testmd` stream is echoed on stderr
prefixed `[member] `, and the failing step group's `run_end` carries all three
signals. `KaneInvoker` now has an `onStderrLine` seam — `stderrTail` keeps fifty
lines and a two-member run produces two hundred — and `kane/memberDebug.ts` parses
and attributes them. The stream is persisted to
`.kept/diagnostics/<runId>.member.ndjson`, which is R4.12's second clause and the
only reason the rest of this document could be written.

`--member-debug` is therefore **not a debugging flag**. It decides the repair branch,
and the code hook's prompt now says so and passes it.

### Attribution is by segment, not by `run_id`

The first attempt paired `run_end` events one-to-one with `testrun_member_end` and
got **forty terminals for nine members**. Kane replays a `*_test.md` as a series of
runs — `run-0`, `run-1`, … — one per step group, restarting the numbering for each
member, and `run_id` names no member. The per-member boundary is `test_md_done`
(`{type, overall_status, duration_s, session_id}`), of which there are exactly nine
for nine members. So the stream is cut into **segments** at `test_md_done`, and each
segment's signal is the step group that failed.

Pairing then refuses on any disagreement — a length mismatch, or a status that
contradicts the member event — and attributes nothing rather than something wrong. A
verdict object on the wrong failure would authorise an automatic source patch against
a promise nobody tested.

## Finding 2: `--bug-detection` is a profile setting, so the argv now states it

`kane-cli config show` on this machine reports `"bug_detection":"off"`. Kane's
investigation is what produces the code and the verdict object, so the branch KEPT
chooses depended on ambient state in another tool's config file — changeable by
anyone, invisible in the argv, absent from every recording. `--bug-detection
continue` is now on every replay for the same reason `--on-failure continue` is: the
contract is the argv (R3.4, §4.7).

It is not sufficient, which is finding 3.

## Finding 3: Kane's own judgement of one unchanged failure is not stable

The never-true discount claim, `tests/cart_discount_test.md`, fails identically every
time. Kane's conclusion about that identical failure, read off the `[member]` stream:

| run | `result_code` | `verdict` object | branch KEPT derives |
|---|---|---|---|
| 15.3's suite replay | `740` | `confirmed: true`, `application_issue`, confidence **0.95** | `code-break`, overridden to `docs-lie` |
| `f4726521`, `f0d80fd8`, `0944d075` | *absent* | *absent* | `docs-lie` (residue) |
| `57591bff` | `710` | `confirmed: false`, `ui_data_defect`, confidence **0.89** | `test-drift` |

Three different branches for one unchanged failure, from one unchanged test, against
one unchanged application. Kane sometimes investigates a replay failure and sometimes
does not, and when it does it has said both *confirmed* and *not confirmed* about the
same disagreement.

**This is why the red run reports `docs-lie` rather than `code-break`.** Rule 2 fires
when Kane says `confirmed: true`; on the run that was committed here Kane said nothing
at all. Re-running until it says the convenient thing would be a coin flip presented
as a demonstration, so it was not done.

## Finding 4: the conclusion KEPT needs exists, in a place nothing reads

The investigation *did* run on the replay failures — it just wrote its answer into the
sealed pack rather than onto the stream. `pack-failure-yaml-cart-subtotal.yaml` is the
note for the broken subtotal, extracted from
`.testmuai/evidence/0944d075-….evidence`:

```yaml
title: Cart summary totals stay at $18.00 while line total is $36.00
triage:
  by: { kind: agent, id: v16-investigation/replay }
  rca:
    root_cause: The cart summary is using the wrong amount. It is not matching the
      item's quantity and line total…
    category: application_issue/ui_data_defect
    confidence: 0.96
  severity: major
```

`category: application_issue/ui_data_defect`, confidence 0.96, on the *first*
attempt — a product fault, which is §6.3 row 1 and therefore `code-break`. Kane knew.
Three things stand between that file and the branch, and each is a real change with a
real decision in it:

1. **The note is inside a zip.** `listArtifacts` resolves a pack *directory*; Kane
   seals a single `.evidence` archive. The CLI already has a zip reader (evidence
   curation), so this is a matter of where the reader belongs, not whether one exists.
2. **The category is nested one level deeper than the alias list reads.**
   `TRIAGE_SIGNAL_FIELDS` tries `triage.category`; the real file spells it
   `triage.rca.category`.
3. **`application_issue` is not in `CODE_BREAK_SIGNALS`.** That list is deliberately
   closed, because `code-break` is the one branch whose repair is applied
   automatically. Adding Kane's own product-fault family to it is defensible and it is
   not a change to make silently.

There is a fourth, and it is the one that needs a decision rather than an
implementation: **the note is per failing step, under
`tests/<slug>/steps/<n>/failure.yaml`, and nothing ties a slug to a member.** The
top-level index names `test: cart-subtotal-d5ba3490` — a slug derived from the test
document's title, not its path. Attributing a triage note to a member would mean
inferring identity from a name, which is the one thing §7.1 and §4.6 exist to forbid,
and the alternative — one note for the whole pack — would give two members in one
radius the same branch. That is a specification question, so it was left as one.

## What was and was not obeyed

The `code-break` fence authorises editing fixture source; `docs-lie` forbids it. The
red run reported `docs-lie`, so **no agent repaired anything from that handoff.** The
break was mine, made deliberately to drive the loop, and I reverted my own edit — the
fence was not widened, and no repair was performed under an instruction that forbade
it. `git diff` on `apps/fixture/lib/cart.ts` is empty.

`mayWriteVerdicts` is unchanged. `BRANCH_FENCES` is unchanged. The radius is still
derived from `testrun_plan.members[].test_id` and from nothing else.

## The stale-build trap, since it cost this project two spurious failures

`next start` serves a prebuilt `.next`. Both runs here followed the full sequence —
stop the server, `rm -rf apps/fixture/.next`, rebuild, restart, then **verify the
served chunk** before spending a credit:

```
broken:   function f(e){return a(e[0]?.price??0)}
repaired: function f(e){return a(e.reduce((e,t)=>e+t.price*t.qty,0))}
```

Both were confirmed by `curl` against `/_next/static/chunks/` before either
verification ran. The `reduce` that remains in the broken bundle is `itemCount`, which
is a different function and correct in both.
