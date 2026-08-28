# Bootstrapping the context store — recorded, against a live Kane

`kane-cli` 0.8.4, OAuth as `emadqureshi965`, env `prod`, Node v20.19.4, repo root
`/Users/nokitha/Desktop/KEPT`. Every stream quoted below is committed verbatim under
`docs/kane/bootstrap/`; nothing here is paraphrased. `.context/` itself is gitignored, so
these recordings are the only committed evidence that the store was ever built.

**Outcome in one line: the store exists — one source, five use-cases, six ACs, four
scenarios, four designed tests — and `cover` still refuses, for a different reason than
before.** The refusal moved from *no store* to *no pack carries coverage*, which is
progress that did not, at the time, lift `degraded`.

> **Read this as a session record, not as current state.** Everything below is what a live
> Kane did on the day, and it is left verbatim. Three of its findings have since been
> acted on: the enrichment provider moved from `cover` to `cover gaps`, so the committed
> snapshot is no longer degraded and publishes a real `provenCoverage`; `context list` was
> taken out of the Assurance family table and now goes through `invokePlain`, which
> appends nothing, so the argv rejection recorded below cannot happen; and the source-id
> ladder gained a fifth rung, so `maintain reconcile` has since run against a genuinely
> resolved source id. Those are recorded in
> [command-surface.md](command-surface.md) and under `docs/kane/reconcile/`.

## What was run, in order

| # | Invocation | Exit | Terminal event | Credits |
|---|---|---|---|---|
| 1 | `kane-cli context ingest apps/fixture/README.md --mode ci` | `0` | none — plain text, not NDJSON | 0 |
| 2 | `kane-cli context list --mode agent` | `1` | none — **flag rejected** | 0 |
| 3 | `kane-cli context extract --mode agent` | `0` | `done` / `complete` | **12.67** |
| 4 | `kane-cli context list --json` | `0` | none — one JSON object per line | 0 |
| 5 | `kane-cli design tests --use-case uc-2 --mode agent` | `2` | `done` / **`refused`** | 0 |
| 6 | `kane-cli design tests --use-case uc-2 --mode agent --allow-unreviewed` | `0` | `done` / `complete` | **76.66** |
| 7 | `kane-cli cover --json --mode agent` | `2` | `done` / **`refused`** | 0 |
| 8 | `kane-cli cover gaps --mode agent` | `0` | `done` / `complete` | 0 |

Balance moved `11128.5512 → 11039.2185`, a delta of **89.33**, which matches the sum of
the two reported figures (12.67 + 76.66 = 89.33) to within the rounding of the per-event
`credits` values. Every refusal was free: both `done: refused` streams cost exactly
nothing, and so did every listing.

Stdin was `/dev/null` on every run, so every one of these is the headless path KEPT itself
takes (§4.7 spawns `['ignore','pipe','pipe']`).

## §4.9.1 held — and it is narrower than it reads

`context ingest … --mode ci` **landed only**, exactly as §4.9.1 predicts. Its entire
stdout is one line, and it is not JSON:

```
created  readme  source sha256:883da226b4bb43118667ad07ab3726394fcb899d595015c57e2931f08f8e8232  blob sha256:2d6ab576b85d2a3ec186d021ac01b57e517f3437efb4378d0a450645f80b4d6a
```

with the remedy on **stderr**, not stdout:

```
landed 1 source(s) — run kane-cli context extract to extract them
```

`.context/` appeared with `store.json`, `meta.json`, one commit and one blob — and zero
use-cases. An ingest that looks like it did nothing had in fact succeeded.

**What §4.9.1 does not say, and should:** the no-extract branch is a property of *ingest*
alone. `context extract --mode agent` extracts perfectly well headless — it is not a
TTY-only command. The two-step bootstrap is required because ingest stops early, not
because extraction needs a human.

## `context extract --mode agent` — the Assurance contract holds

21 lines, terminating on `done`:

```
run_start → source_start → agent_activity×14 → usage×2 → corpus → commit → done
```

```json
{"type":"done","v":1,"verb":"extract","status":"complete","exit_code":0}
```

The `commit` event minted five use-cases (`uc-1`…`uc-5`) with `trusted: 0, derived: 5`.

**Credits are spelled `credits`, not `credits_consumed`, on this family.** Two `usage`
events carried `{"credits":3.48,"total_credits":3.48}` and
`{"credits":9.19,"total_credits":12.67}`; the `done` event carries no credit field at all.
R3.10's "accept `credits` when `credits_consumed` is absent" is not a defensive
nicety — it is the only spelling the Assurance family uses, and the figure lives on a
non-terminal `usage` event, so a reader that only inspects the terminal event sees zero.

## `design tests` refused first, and named its own remedy

The task's prescribed invocation was run verbatim and refused:

```json
{"type":"error","v":1,"verb":"design","code":"UC_UNREVIEWED","message":"design: uc-2 is unreviewed — approve it first, or pass --allow-unreviewed","next":["kane-cli context review --approve uc-2"]}
{"type":"done","v":1,"verb":"design","status":"refused","exit_code":2,"next":["kane-cli context review --approve uc-2","kane-cli design tests --use-case uc-2 --mode agent --allow-unreviewed"]}
```

Freshly extracted use-cases land at `trust: derived`, and `design tests` will not design
against an unreviewed one. The refusal is a `complete` stream (a `done` arrived), cost
nothing, and carries a machine-runnable remedy in `next[]`. The second listed remedy was
taken; approving `uc-2` would have worked equally.

`uc-2` — *Manage cart pricing and discounts* — was chosen because it is the use-case the
committed corpus already makes claims about (cart subtotal, discount).

The successful redesign ran 76 lines, four `commit` events and four `receipt` events:
**6 ACs, 4 scenarios, 4 tests, 5 gaps, 18 warnings**, session
`design-20260821T000617-b13b`. `cover gaps` then reports the designed axis from the live
graph: `design_completeness.pct: 100`, `acs_designed: "6/6"`,
`usecases_complete: "1/5"` — one use-case designed, four still at zero scenarios.

## Did the store get built? Yes — `context list` says so

The check is **`kane-cli context list --json`**, not `--mode agent`:

```
kane-cli context list --mode agent
→ exit 1, error: unknown option '--mode'
```

`context list` takes `--type`, `--inferred`, `--stale`, `--all`, `--json`. It has **no
`--mode` flag at all**, which contradicts `docs/kane/command-surface.md`'s table listing
`context list` in the `--mode agent` Assurance row. Its output is one JSON object per
line, and after extraction it reads:

```
{"id":"readme",…,"label":"source","title":"readme","trust":"-","fresh":"fresh"}
{"id":"uc-1",…,"label":"usecase","title":"Complete checkout with required contact details","trust":"derived","fresh":"fresh"}
{"id":"uc-2",…,"title":"Manage cart pricing and discounts","trust":"derived","fresh":"fresh"}
{"id":"uc-3",…,"title":"Shop in a selected currency","trust":"derived","fresh":"fresh"}
{"id":"uc-4",…,"title":"Browse the coffee catalog","trust":"derived","fresh":"fresh"}
{"id":"uc-5",…,"title":"Review completed orders","trust":"derived","fresh":"fresh"}
```

One further operational detail: stdout carried an
`Update available: 0.8.4 → 0.8.5` advisory line **before** the JSON on some invocations.
R3.23's prefix-skip rule earns its keep here; it is not merely defensive.

## `kept build` after the bootstrap: still `assurance-status:refused`

```
node bin/kept build
  promises     8
  edges        16
  degraded     true (assurance-status:refused)
```

The reason changed, and the new one is committed at
`docs/kane/bootstrap/cover-after-bootstrap.ndjson`:

```json
{"type":"error","v":1,"verb":"cover","message":"error: ed791716-ed4a-456e-ae7a-46d1e05a70d3.evidence carries no coverage/usecases.yaml — the pack predates coverage or its project had no .context at seal time"}
{"type":"done","v":1,"verb":"cover","status":"refused","exit_code":2}
```

So §5.3.1's verified envelope is one of **at least two** refusal shapes. The first
(`no context store here`) is now unreachable in this repo; this one replaces it. The
mapping is unchanged — `stream.kind: 'complete'`, `terminal.status: 'refused'`, Assurance
exit 2 → `degradedReason: 'assurance-status:refused'` — and `kept build` quoted Kane's new
message verbatim in its diagnostic, which is the behaviour §5.3.1 asks for.

`cover` reads its proven axis **from an evidence pack**, and none of the five packs in
`.testmuai/evidence/` contains `coverage/usecases.yaml`; all were sealed before `.context/`
existed. `--from` cannot route around it. Lifting this refusal therefore needs a pack
sealed *after* this bootstrap — task 15.2/15.3 work, not something the bootstrap can do.

`apps/ledger/data/ledger.snapshot.json` was **left untouched** at this point. It was
honestly `degraded: true` with `degradedReason: assurance-status:refused`, which was
exactly what a build reported, and its diagnostic quoted the older *no store* message:
stale prose inside an accurate verdict, left to be regenerated by a build that cleared the
refusal rather than churned here to look busier. That build has since happened, by way of
`cover gaps` rather than a newly sealed pack, and the committed snapshot is clean.

## The store was not yet enough for `resolveSourceId`: two blockers, both since cleared

The task text says this pair is "the precondition for `resolveSourceId` finding a match at
all". The precondition was met and the match still did not happen. Both blockers were
observed, not reasoned about, and both were fixed afterwards, in `packages/kept-core`: the
family table released `context list` to `invokePlain`, and a fifth basename-slug rung was
added to the ladder. `docs/kane/reconcile/` holds the run where the id resolved.

**1. The argv KEPT issues is rejected.** `listing.ts` sets
`SOURCE_LISTING_FAMILY = 'Assurance'`, so the invoker appends the family enabler:

```
kane-cli context list --type source --json --mode agent
→ exit 1, stdout empty, stderr: error: unknown option '--mode'
```

An empty stdout has no `done`, so this resolves as `listing-unreadable`/`crashed-stream` —
never a match. Fixing it means either exempting `context list` from the enabler or moving
it out of the family table; both touch `packages/kept-core`, which this task does not.

**2. Even with the flag fixed, no rung has anything to read.** The four rungs of §13.2.2
are `exact-path`, `abs-path`, `digest`, `unique-basename`. The live projection carries only
`id, cid, label, title, trust, fresh` — **no path key and no digest key**
(`cid` is not one of `digest|sha256|hash|content_hash`). Nor is the path recoverable from
the store: `context explain readme` replays only `minted` and `head_move` records, and no
file under `.context/` contains the string `README`. Kane keys a source by content and by
slug, not by repository path.

The three digests are all different and none is the file's own sha256:

| Value | Where it came from |
|---|---|
| `sha256:883da226…` | `cid` — the source node id, in both the ingest line and the listing |
| `sha256:2d6ab576…` | `blob sha` in the ingest line |
| `b2118de7…` | `shasum -a 256 apps/fixture/README.md` — matches neither |

So the `digest` rung compares a value the listing does not publish against a hash Kane does
not compute the same way. The only thread that survives is the slug: `id: readme` is
plainly derived from `README.md`. Matching on that was a design change rather than a patch,
and it was taken: the basename-slug rung is the fifth rung of the ladder today.

## `design tests` wrote four Kane-format `_test.md` files, and they answer follow-up 4

Unannounced by any event field, the design step wrote its four tests to disk at
`.testmuai/tests/*_test.md`. `.gitignore` ignores `.testmuai/evidence/` and
`.testmuai/variables/` but not `.testmuai/tests/`, so they are committed here. The
BaselineProvider skips `.testmuai` when scanning `**/*_test.md`, so they mint no promise and
change no graph — `npm run check` is green with them present.

They matter because they are **Kane's own canonical `_test.md`, written by Kane**, which is
the missing half of the corpus-format collision recorded as follow-up 4 in
`docs/kane/verdict-spike.md`:

```yaml
---
assurance:
  id: t-4
  base: sha256:ce82c727fdff767577bf3b47fde75466e6a2820424d3e271c192f2bdee9fbf04
---
# Recalculate the subtotal correctly after a below-threshold quantity change

> Prove that changing a cart quantity updates the displayed subtotal correctly …

## Step 1
…
## Step 6 — assert @verifies ac-3, ac-2, ac-4
```

Three things to note for that follow-up. The logical id lives under `assurance.id` and is
spelled `t-4`, lower case, so nothing here is a home for KEPT's `test_id: T-3`. Steps are
`## Step N` headings, confirming that a numbered prose list under an `# H1` parses to zero
steps. And Kane puts a `@verifies` clause **in a step heading**, pointing at its own AC ids
rather than at a source line — the same word KEPT uses for `file:line` citations, with a
different referent. Any reconciliation has to disambiguate those two spellings rather than
assume they are one tag.

## Corrections this bootstrap makes to `docs/kane/command-surface.md`

1. **`context list` has no `--mode` flag.** It is `--json`, and it is not addressable
   through the Assurance NDJSON envelope at all. The contract table lists it under
   `--mode agent`; that row is wrong, and it is wrong in the one place `resolveSourceId`
   depends on.
2. **`context ingest --mode ci` emits plain text, not NDJSON**, and puts its remedy on
   stderr.
3. **The Assurance family spells credits `credits`**, on non-terminal `usage` events, with
   no credit field on `done`.
4. **`design tests` refuses an unreviewed use-case** with `code: UC_UNREVIEWED`, so the
   documented `--use-case <ref>` signature is incomplete for a freshly extracted graph:
   either `context review --approve` or `--allow-unreviewed` is required.
5. **`cover`'s refusal has at least two shapes**, and the store-missing one recorded in
   design §5.3.1 is no longer the one this repo produces.

## Files

| File | What it is |
|---|---|
| `bootstrap/ingest.stdout.txt` `.err` `.exit` | the lands-only ingest, both streams |
| `bootstrap/list-before-extract.*` | `context list --mode agent` rejecting the flag |
| `bootstrap/extract.ndjson` `.err` `.exit` | 21-line Assurance stream, `done: complete` |
| `bootstrap/list-after-extract.json` `.exit` | the store: 1 source + 5 use-cases |
| `bootstrap/design-tests-uc-2.ndjson` `.exit` | the `UC_UNREVIEWED` refusal |
| `bootstrap/design-tests-uc-2-allow-unreviewed.ndjson` `.exit` | 76-line design, 4 commits |
| `bootstrap/cover-after-bootstrap.ndjson` `.exit` | the **new** refusal envelope |
| `bootstrap/cover-gaps-after-bootstrap.ndjson` `.exit` | designed axis from the live graph |
| `bootstrap/list-source-mode-agent.*` `bootstrap/list-source.json` | the resolver's argv, rejected, and the argv that works |
| `bootstrap/kept-build-after-bootstrap.log` | `kept build` still degraded, new reason quoted |
