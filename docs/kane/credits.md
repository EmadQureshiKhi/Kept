# Measured credit consumption — R14.7

Every figure below was read out of a stream committed in this repository, not out of a
note. The reader used for each one is `run_end.credits_consumed` for the ExecutionRun
family and `usage.credits` for the Assurance family; where a figure lives somewhere else,
that is called out, because *where* the number lives is the finding.

`kane-cli` 0.8.4, OAuth as `emadqureshi965`, environment `prod`, Node v20.19.4, repo root
`/Users/nokitha/Desktop/KEPT`. The account started at **11200** credits.

```
$ kane-cli balance
Available credits: 10629.3207
Total credits:     11200
```

**Total project spend to date: 570.6793 credits.**

## The one figure R14.7 asks for

An authored run, its credits read off `credits_consumed` on a real terminal event:

```
kane-cli testmd run tests/shop_filter_test.md --agent --bug-detection continue
```

- stream `docs/kane/corpus/t1-shop_filter-author.ndjson`, exit `0`
- session `909760af-11ff-4cb5-8e6d-07f003ce4f73`, runs `run-0` … `run-3`
- four `run_end` events, each carrying `credits_consumed`, summing to **33.465**
- `test_md_summary.steps` reads `{total: 4, passed: 4, replay_decisions: 0, author_decisions: 4}`

Four authored steps, four charges, nothing replayed. That is the shape every other
authoring figure in this file has.

## Credits are spelled three different ways

This is the load-bearing finding, and it is why R3.10's accessor prefers
`credits_consumed` and accepts `credits`.

| Family / path | Event | Field | Terminal event carries it? |
|---|---|---|---|
| ExecutionRun (`testmd run`), authored step | `run_end` | `credits_consumed`, top level | yes |
| ExecutionRun, **failing replay** | `run_end` | `verdict.credits_consumed`, **nested** | present but not top level |
| ExecutionRun, replayed step | `run_end` | **no credit field at all** | n/a — nothing was charged |
| Assurance (`context extract`, `design tests`, `maintain reconcile`) | `usage`, **non-terminal** | `credits` | **no** — `done` has no credit field |

The Assurance row is the trap. `docs/kane/bootstrap/extract.ndjson` is two `usage` events
and then a terminal `done`:

```
{"type":"usage","v":1,"verb":"extract","credits":3.48,"total_credits":3.48}
{"type":"usage","v":1,"verb":"extract","credits":9.19,"total_credits":12.67}
{"type":"done","v":1,"verb":"extract","status":"complete","exit_code":0}
```

`done`'s whole key set is `type, v, verb, status, exit_code`. A reader that inspects only
the terminal event sees **zero** for a run that cost **12.67**. Accepting the `credits`
spelling is not a defensive nicety; it is the only spelling this family uses, and it is on
an event the terminal-event rule would otherwise skip.

The failing-replay row is the second trap, recorded first in `verdict-spike.md` and
re-verified here: the failing step's `run_end` carries no top-level credit field, and the
charge for the automatic post-failure investigation sits at `verdict.credits_consumed`.

## Authoring — the eight-document corpus

All eight ran under the same invocation, differing only in the path:

```
kane-cli testmd run tests/<slug>_test.md --agent --bug-detection continue
```

Credits are the sum of every `run_end.credits_consumed` in the capture. `authored` is
`test_md_summary.steps.author_decisions`; `replayed` is `replay_decisions`.

| id | stream (under `docs/kane/corpus/`) | session id | exit | authored | replayed | credits | per authored step |
|---|---|---|---|---|---|---|---|
| T-1 | `t1-shop_filter-author.ndjson` | `909760af-11ff-4cb5-8e6d-07f003ce4f73` | 0 | 4 | 0 | **33.465** | 8.37 |
| T-2 | `t2-home_cta-author.ndjson` | `1dcf7a72-fb3c-453a-a0bc-ad1baeaecd45` | 0 | 3 | 0 | **21.708** | 7.24 |
| T-3 | `t3-cart_subtotal-author.ndjson` | `1bcf2ed3-337c-4d9f-9de0-ee16ce08d073` | 0 | 1 | 5 | **6.713** | 6.71 |
| T-4 | `t4-checkout_validation-author.ndjson` | `2cc57e5d-735a-4f9a-a8c5-1a55030f8899` | 0 | 4 | 0 | **24.723** | 6.18 |
| T-5 | `t5-orders_persist-author.ndjson` | `3ae00a12-06ad-41d4-8a2a-2aca46cf9bf4` | 0 | 5 | 0 | **38.711** | 7.74 |
| T-6 | `t6-settings_currency-author.ndjson` | `cc2b070f-ebae-4013-b0e5-c814f28c0a92` | 0 | 4 | 0 | **25.960** | 6.49 |
| T-7 | `t7-cart_discount-author.ndjson` | `994d16b7-6a50-4caa-bc09-491ba6663ffc` | 1 | 3 | 2 | **27.373** | 9.12 |
| T-8 | `t8-product_currency-author.ndjson` | `66ccc5d4-9ba5-4cdc-9394-0b1cca38fc28` | 0 | 3 | 0 | **20.601** | 6.87 |

Kept total: **199.254**. An authored step costs roughly six to nine credits; a replayed
step generates no `credits_consumed` field at all.

T-7 exits `1` because its failure is the deliverable, and it is charged for three authored
steps plus the investigation on the failing one — `run-4` alone carries 13.453.

### The three discarded attempts

Kept because each is evidence for a claim made elsewhere, and paid for either way.

| stream | session id | exit | authored | credits | why it died |
|---|---|---|---|---|---|
| `t3-cart_subtotal-author-attempt1-stale-build.ndjson` | `88599883-c57e-4318-867f-366abd025951` | 1 | 6 | **57.888** | result code 740, stale `.next` served a break that was not in git |
| `t5-orders_persist-author-attempt1-stuck.ndjson` | `d4cee1e1-380c-47b3-8819-4f227d03a624` | 1 | 5 | **67.513** | `stuck.ap_stuck`, result code 330, unresolved template placeholders |
| `t7-cart_discount-author-attempt1-target-closed.ndjson` | `a3d5a121-adcf-4be6-bbbf-3b031f0d8031` | 1 | 5 (3 charged, 2 skipped) | **23.179** | `infra_error.screenshot_failed`, result code 510 |

Discarded total: **148.580** — three quarters of what the kept corpus cost. Corpus grand
total including discards: **347.834**.

## Replay is near-free, and authoring is not

Two independent measurements, both committed.

**A whole document replayed from cache, for nothing.** The verdict spike ran the same
six-step probe three times against the same fixture:

```
kane-cli testmd run docs/kane/spike/cart_subtotal_spike_test.md --agent --bug-detection continue --timeout 240   # author
kane-cli testmd run docs/kane/spike/cart_subtotal_spike_test.md --agent --timeout 240                            # replay
```

| phase | stream | session id | steps | credits in the stream | balance delta |
|---|---|---|---|---|---|
| author, 6 steps | `docs/kane/spike/t3-author.ndjson` | `91636318-2037-4ef4-ae9b-61afe22b96e7` | authored 6, replayed 0 | 6 × `credits_consumed` = **49.206** | 53.88 |
| replay, product broken | `docs/kane/spike/t3-replay-failed.ndjson` | `c26b158e-cb66-4699-a5ce-9fa8a0f35d8b` | authored 0, replayed 6 | **4.842** on `verdict.credits_consumed` only | 4.84 |
| replay, product correct | `docs/kane/spike/t3-replay-passed.ndjson` | `bd19b0e3-1dec-4e47-9c09-14c2f9534696` | authored 0, replayed 6 | **0.000** — no credit field anywhere | 0.00 |

Six identical steps: **49.206 to author, 0.000 to replay.** The failing replay is not a
counter-example to free replay — replay itself was still free, and the 4.842 is the
automatic post-failure investigation, which only runs when something fails.

**The same economy inside the corpus.** T-3's second attempt cost **6.713** against
**57.888** for its first, because five of its six steps came back from the committed
recording and only the last was re-authored. That ratio is the whole argument for
force-adding `output-*/` in `.gitignore`: a reviewer who clones this repository replays
from those recordings and is charged for nothing.

**Stage 15.3's full-suite replay has not landed.** `git log` carries no
"recorded zero-credit replay" commit, so there is no measured all-eight replay figure to
publish yet. The two measurements above are what the repository can prove today: a real
six-step document replayed end to end for 0.00, and a real corpus document re-run for 12
percent of its authoring cost. When 15.3 lands, its figure belongs in this table read the
same way — sum of `run_end.credits_consumed`, cross-checked against a balance delta.

## A refusal is free

Both `done: refused` streams cost exactly nothing, on either spelling, and neither carries
a `run_start` at all — so a refused Assurance run has no session identifier to cite.

| invocation | stream | exit | terminal | credits |
|---|---|---|---|---|
| `kane-cli design tests --use-case uc-2 --mode agent` | `docs/kane/bootstrap/design-tests-uc-2.ndjson` | 2 | `done` / `refused`, `code: UC_UNREVIEWED` | **0.00** |
| `kane-cli cover --json --mode agent` | `docs/kane/bootstrap/cover-after-bootstrap.ndjson` | 2 | `done` / `refused` | **0.00** |

Every listing is free too: `kane-cli context list --json`, `kane-cli context list --type
source --json` and `kane-cli context list --mode agent` (which exits 1 on the rejected
flag) emit no `usage` event and no credit field. The string `credit` does not occur once
across all twenty-three committed listing captures under `docs/kane/bootstrap/` and
`docs/kane/reconcile/`. Neither does `kane-cli balance` charge for itself.

## The Assurance family

```
kane-cli context extract --mode agent
kane-cli design tests --use-case uc-2 --mode agent --allow-unreviewed
kane-cli cover gaps --mode agent
kane-cli cover --mode agent
```

| invocation | stream | session | `usage` events | credits |
|---|---|---|---|---|
| `context extract --mode agent` | `docs/kane/bootstrap/extract.ndjson` | `as-20260821T0004-2336n8y2` | 2 | **12.67** |
| `design tests --use-case uc-2 --mode agent --allow-unreviewed` | `docs/kane/bootstrap/design-tests-uc-2-allow-unreviewed.ndjson` | `as-20260821T0006-h82euroy` | 11 | **76.66** |
| `cover gaps --mode agent` | `docs/kane/bootstrap/cover-gaps-after-bootstrap.ndjson` | none emitted | 0 | **0.00** |
| `cover --mode agent`, after the packs were sealed | `docs/kane/corpus/cover-after-bootstrap.ndjson` | none emitted | 0 | **0.00** |

`12.67 + 76.66 = 89.33`, and the balance moved `11128.5512 → 11039.2185`, a delta of
89.3327. **This family reports its spend exactly.**

The two `cover` rows are honest zeroes with a caveat worth stating: the successful `cover`
stream is two events, `coverage` then `done`, with no `usage` event and no credit field of
either spelling anywhere in it. Nothing was reported, and the balance is consistent with
nothing being charged — but "reported nothing" and "charged nothing" are the same
observation here only because the balance agrees.

## Reconcile

Three `--plan` reconciliations, all under the same spawn, recorded in
`docs/kane/reconcile/plan-1-maintain.ndjson`, `plan2-1-maintain.ndjson` and
`plan3-1-maintain.ndjson`:

```
kane-cli maintain reconcile --from apps/fixture/README.md --source-id readme --plan --mode agent
```

| run | session | terminal | `usage` events | credits |
|---|---|---|---|---|
| plan | `as-20260821T0059-7dj302yx` | `done` / `error`, exit 1, graph data plane timed out | 1 | **3.88** |
| plan2 | `as-20260821T0100-61i2h1iw` | `done` / `complete`, exit 0, empty plan | 0 | **0.00** |
| plan3 | `as-20260821T0101-mnzeh7w5` | `done` / `complete`, exit 0 | 3 | **18.76** |

Reconcile total: **22.64**. Two things here contradict figures quoted in passing
elsewhere, so they are stated plainly:

- **plan3's 18.76 is a total, not an increment.** Its three `usage` events read
  `credits: 4.53 / 4.15 / 10.08` with `total_credits: 4.53 / 8.68 / 18.76`. The 8.68 that
  circulates as "the second reconcile run" is plan3's own mid-run cumulative, not a
  separate run.
- **plan2 cost nothing measurable.** It completed with exit 0 and a `reconcile_plan`
  carrying `rows: []` and emitted no `usage` event at all — four events end to end. An
  agent run that finds nothing to do is charged nothing.

A run that **fails** is still charged: plan's 3.88 bought a search and a provenance trace
before the data plane timed out.

## What adds up, and what does not

| bucket | credits | source |
|---|---|---|
| corpus, kept | 199.254 | 8 streams under `docs/kane/corpus/` |
| corpus, discarded attempts | 148.580 | 3 streams under `docs/kane/corpus/` |
| verdict spike, authoring | 49.206 | `docs/kane/spike/t3-author.ndjson` |
| verdict spike, failing replay | 4.842 | `verdict.credits_consumed`, `t3-replay-failed.ndjson` |
| verdict spike, passing replay | 0.000 | `t3-replay-passed.ndjson` |
| context bootstrap | 89.330 | `extract` + `design tests` |
| reconcile | 22.640 | 3 `maintain reconcile --plan` runs |
| first smoke run, a 3-step `kane-cli run` | 10.351 | `docs/kane/smoke-run.ndjson`, session `d43420ab-6ff9-47ac-9bed-a8d3fbf5749f`, one `run_end` |
| refusals, listings, `balance` | 0.000 | 2 refusals, 23 listing captures |
| **sum of every committed stream** | **524.203** | |
| **measured spend** (`11200 − 10629.3207`) | **570.679** | `kane-cli balance` |
| residual | **46.476** | not reported on any event |

The residual is not a lost capture; it is spend the ExecutionRun family does not report.
Two runs have both a stream sum and a recorded balance delta, and both under-report:

| run | stream sum | balance delta | stream ÷ delta |
|---|---|---|---|
| smoke, 3 steps | 10.351 | `11200 → 11188.7986` = 11.2014 | 0.924 |
| spike authoring, 6 steps | 49.206 | `11188.7986 → 11134.9169` = 53.8817 | 0.913 |

So an ExecutionRun stream reports about 92 percent of what the run actually costs, and the
missing slice is per-run overhead charged with no event to carry it. That accounts for the
residual:

- spike authoring overhead: `53.8817 − 49.206` = **4.676**
- smoke overhead: `11.2014 − 10.351` = **0.850**
- undocumented spend between the passing replay (`11130.0745`) and the start of the
  bootstrap (`11128.5512`): **1.523**
- leaving **39.43** across the eleven corpus runs, which puts the corpus at
  `347.834 ÷ 387.26` = **0.898** reported — the same band as the two runs measured
  directly, and no capture is missing.

The Assurance family, by contrast, reports its spend to the last hundredth.

**Practical consequence: trust a stream figure as a floor, not as a total.** Anything that
budgets against Kane should read `credits_consumed` (or `credits`) for the per-step and
per-agent-turn detail, and reconcile against `kane-cli balance` for the truth.

## Reproducing any figure here

Nothing below spends a credit — every input is committed.

```bash
# Sum the ExecutionRun family: top-level credits_consumed on run_end.
node -e 'const fs=require("node:fs");const f=process.argv[1];let s=0;
for(const l of fs.readFileSync(f,"utf8").split("\n").filter(Boolean)){const o=JSON.parse(l);
if(o.type==="run_end"&&typeof o.credits_consumed==="number")s+=o.credits_consumed;}
console.log(f,s.toFixed(3));' docs/kane/corpus/t1-shop_filter-author.ndjson

# Sum the Assurance family: credits on non-terminal usage events.
node -e 'const fs=require("node:fs");const f=process.argv[1];let s=0;
for(const l of fs.readFileSync(f,"utf8").split("\n").filter(Boolean)){const o=JSON.parse(l);
if(o.type==="usage"&&typeof o.credits==="number")s+=o.credits;}
console.log(f,s.toFixed(3));' docs/kane/bootstrap/extract.ndjson
```

Summing every `credits_consumed` anywhere in a capture double-counts: an authoring
`run_end` repeats the figure inside `per_flow_metadata`. Read the top level, or the
`verdict` object, but not both.
