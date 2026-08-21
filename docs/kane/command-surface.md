# Kane CLI 0.8.4 — verified command surface

Two sources, both authoritative over the docs site:

1. **Direct probing** of `kane-cli` on this machine (`--help`, real runs).
2. **`kane-cli install skill`** (skill **v0.0.17**) which ships `references/*.md`
   into `~/.claude/skills/kane-cli/references/`. These are more detailed and more
   current than the published website docs.

Where the website disagrees with either, they win. Where the skill references
disagree with observed runtime behaviour, **observed behaviour wins** (noted
inline below — there are two such cases).

> The skill installs for Claude Code / Codex CLI / Gemini CLI only. It does
> **not** install for Kiro — `~/.kiro/skills/` stays empty, because Kiro uses
> `powers/`. Installing it changed no CLI behaviour; its value is the reference
> docs.

## THE BIG ONE: there are three terminal-event contracts, not one

This is the single most important fact for anything parsing Kane output, and
getting it wrong silently breaks the loop.

| Command | Terminal event | How NDJSON is enabled |
|---|---|---|
| `run`, `testmd run` | `run_end` | `--agent` |
| `testrun run` | **`testrun_done`** | **automatic when stdout is piped — there is NO `--agent` flag** |
| `context extract`, `design tests`, `maintain reconcile`, `maintain evolve`, `cover`, `cover gaps` | **`done`** | `--mode agent` |
| `context list` | **none** | **not addressable this way — see the correction below** |

**Correction, observed 2026-08-21 against this same 0.8.4.** An earlier reading of
this table put `context list` in the `--mode agent` row. It does not belong there,
and the mistake was load-bearing: `resolveSourceId` issued
`context list --type source --json --mode agent` and got

```
exit 1, stdout empty, stderr: error: unknown option '--mode'
```

`kane-cli context list --help` lists `--type <t>`, `--inferred`, `--stale`,
`--all`, `--json` and nothing else — there is **no `--mode` flag on this command at
all**. Its `--json` output is one plain JSON object per line, not the
`{type,v,verb}` envelope, and it never emits `done`, so it carries none of the four
family-dependent facts. `maintain reconcile --help` even points at it in the bare
form: *"see `kane-cli context list --type source`"*. In a directory with no
`.context/` it prints `error: no context store here (run `kane-cli context ingest
<files>` first)` on **stdout** and exits 2 — plain text again, not a refusal
envelope. Both streams are committed under `docs/kane/reconcile/`.

`packages/kept-core/src/kane/family.ts`'s `CONTRACTS` table listed it under
Assurance for the same reason; that entry is gone, `familyForArgv` answers `null`
for it, and it is invoked through `KaneInvoker.invokePlain`, which appends nothing.

Consequences for KEPT: blast-radius verification uses `testrun run`, so it must
parse `testrun_done`. The Ledger's data source is `cover`, so it must parse
`done`. Only ad-hoc single runs use `run_end`. A parser built solely on `run_end`
would hang or silently report nothing on both of our real paths.

## The top-level `--help` is abridged — don't trust omissions

`kane-cli --help` does not list `cover`, `maintain`, `generate`, `balance`,
`doctor`, `plugin`, or `changelog`. **All of them exist and work.** Probe with
`kane-cli <cmd> --help` before concluding anything is missing.

## Commands we rely on

| Command | Verified signature |
|---|---|
| `context` | `ingest \| extract \| list \| review \| sessions \| …` |
| `context list` | `[--type <t>] [--inferred] [--stale] [--all] [--json]` — **no `--mode`**; `--json` is JSON lines, one object per line. `--all` is what includes superseded versions, so the default listing is the live one |
| `design tests` | `--use-case <ref>` |
| `cover` | `[--from <pack>] [--json] [--mode interactive\|agent\|ci]` |
| `cover gaps` | `[uc]` — dual-axis ribbon, designed × proven, from the live graph |
| `maintain reconcile` | changed source lands, extraction re-runs, changes HOLD as review cards |
| `maintain evolve` | `[ref]` — re-designs the parent use-case; unaffected items preserved verbatim |
| `testrun run` | see below |
| `evidence` | `validate \| serve \| merge` |

`cover --from` defaults to the newest pack in `.testmuai/evidence`.

## `testrun run` — the loop's engine

Flags confirmed from the installed CLI's own `--help`:

| Flag | Notes |
|---|---|
| `--from-context <ids>` | Selects members by **assurance-graph** ids. **It cannot name this corpus** — see the correction below. **Not present in skill v0.0.17's flag table — the CLI is ahead of the skill here.** |
| `--tags <list>` | ANY-match on frontmatter `tags:`, case-insensitive |
| `--match <regex>` | filter by project-relative path |
| `--parallel <n>` | default `1`; each worker gets an isolated Chrome + fresh temp profile |
| `--on-failure` | `continue` (default) \| `fail-fast` |
| `--bug-detection` | `off\|stop\|continue` — "passed through to **authoring** members" |
| `--dry-run` | plan + validate, execute nothing |
| `--retry` / `--retry-count <n>` | replay recovery, default 3 |
| `--remote [backend]` | needs `kane-cli plugin install remote-execution` |

### Correction, observed 2026-08-21: `--from-context` cannot name the corpus, in either scope

The flag resolves its ids against the **assurance graph**. A plan member's `test_id`
is a *testcase* UUID and does not live there, so handing the plan's own identifiers
back to the CLI that produced them is rejected outright:

```
$ kane-cli testrun run --from-context 6badb68a-3ff8-4a1f-a8bd-3a6a4a2f5e2c --on-failure continue
error: --from-context: unknown id '6badb68a-3ff8-4a1f-a8bd-3a6a4a2f5e2c' — it does not
  resolve in the assurance graph
$ echo $?
2
```

The only ids it *does* resolve here are `t-1`…`t-4`, which name the four unauthored
`.testmuai/tests/*_test.md` documents `design tests` wrote during the stage-15
bootstrap — documents with no recording, which a replay would **author live**. So the
flag is unusable for both of KEPT's scopes, and for opposite reasons: it rejects the
corpus and accepts exactly the four documents that must never be named.

Positional member paths are what is left. `kept verify --all` moved to them in 15.3;
`kept verify --changed` — the code hook's path, and the command that closes the loop
— moved to them in 15.6, because until it did, **every save-triggered verification
exited 2 and nothing was ever verified**. R4.2 specifies the `--from-context`
spelling and is not silently rewritten: the mismatch is recorded here, the flag
constant is still named in `verify.ts`, and `argv-contract.test.ts` now asserts the
flag is absent from both scopes.

What did **not** change is where the selection comes from. The radius is still
computed from `testrun_plan.members[].test_id` and from nothing else (R4.4,
Property 16); the paths handed to Kane are looked up *from those identifiers*, so a
member the plan gave no id is unreachable — there is no id that selects it — and the
radius is never widened to the whole suite to route around the flag.

### testrun event stream

`testrun_plan` → `testrun_start` → (`testrun_member_start` / `testrun_member_end`)×N
→ `testrun_investigations_wait`? → `testrun_evidence_ingest`? → `testrun_summary`
→ **`testrun_done`**.

- `testrun_plan` carries `members: [{path, test_id?, tags, failure?}]` and `valid`.
  **`test_id` here is the path→assurance-id mapping** we need. If `valid: false`,
  nothing runs, exit `2`.
- `testrun_member_end.status` ∈ `passed | failed | broken | interrupted` — four
  values, not two.
- `testrun_summary.totals` = `{tests, passed, failed, broken, skipped}`.
- Members run silently by design. `KANE_TESTRUN_MEMBER_DEBUG=1` routes member
  events to stderr prefixed `[member]`.
- Preflight rejects on `missing_meta`, `not_authored`, `org_mismatch`,
  `project_mismatch`. Every member must be authored and share one org + project.

## Assurance stream (`--mode agent`)

Note this section describes the commands that *are* in the family: `context list`
is not one of them, whatever an earlier version of the table above said.

Envelope: `{"type": …, "v": 1, "verb": "extract"|"design"|"reconcile"|"cover"|"gaps", …}`.
Terminates with exactly one `{"type":"done","status":…,"exit_code":…}` where
`status` ∈ `complete|paused|error|refused|interrupted|aborted`. A stream ending
**without** `done` means the process crashed — outcome unknown.

`cover` emits one `coverage` payload event carrying the full `--json` document,
then `done`. `cover gaps` emits `gaps`, then `done`, with ready-to-run commands
in `next[]`.

### `maintain reconcile --plan` stages into `reconcile_plan.rows[]`, not `review_card`

**Correction, observed 2026-08-21 against 0.8.4.** A live
`maintain reconcile --from apps/fixture/README.md --source-id readme --plan --mode agent`
that staged five changes emitted **no `review_card` event at all**. It carried one
`reconcile_plan` event whose `rows[]` held all five:

```json
{"type":"reconcile_plan","v":1,"verb":"reconcile","source_id":"readme",
 "plan_path":"…/.context/reconcile/plans/2026-08-21T01-03-07-214Z-readme.json",
 "rows":[{"kind":"ADD","ref":"uc-6","why":"new use-case extracted from readme"},
         {"kind":"ADD","ref":"uc-7","why":"…"},{"kind":"ADD","ref":"uc-8","why":"…"},
         {"kind":"ADD","ref":"uc-10","why":"…"},
         {"kind":"MODIFY","ref":"uc-4","why":"updated: description, value, criteria (staged — commits on approval)"}],
 "archive":[]}
```

One event, many rows: a **row** is what corresponds to one held change, so five
rows are five review cards, not one. `plan_path` names the stored plan that holds
them and is the only thing that makes them walkable with `kept reconcile apply`;
it is `null` on a run that staged nothing. `rows: []` is normal — a trivial edit
produced `done: complete` with an empty `rows[]` and a null `plan_path`.

KEPT read only the `review_card` spelling (which the recorded `maintain evolve`
stream does use), so it reported **zero staged items for a run that staged five**
and wrote no card at all. Both spellings are now read; a `reconcile_plan` row is
lifted into one held card each, `status: 'open'`, and nothing is ever applied.
`ref` names a node in *Kane's* graph (`uc-10`), not a KEPT promise, so the card's
attribution comes from the changed document rather than from the row.

The recordings are committed under `docs/kane/reconcile/`: `plan3-*` is the
five-row success, `plan2-*` the empty-rows trivial edit, and `plan-1-*` a genuine
Kane-side failure (`graph_query search_similar_batch: no reply`) that ended
`done: {status: "error", exit_code: 1}`. The `plan*-summary.json` files are the
verbatim output of those runs and therefore predate this correction — they report
`stagedCount: 0` for the five-row run, which is the defect itself, preserved.

Defensive parse rule that is correct on all versions: skip any non-JSON prefix
lines and start at the first line beginning with `{`.

**Exit codes differ for these commands only:** `3` means *paused and resumable*,
not timeout. `130` = force-interrupted. For `run` / `testmd` / `testrun` /
`generate`, `3` still means timeout or cancelled.

## `run` flags — one documented default is wrong

`--max-steps` default is **50**, not 30 as the website states. Also present and
undocumented: `--task-skills` (experimental). `--url` is **not** in the `run`
flag list; put the starting URL in the objective text.

## Real NDJSON — `run` / `testmd run`

Observed sequence from an actual `--agent` run:

```
recording_state          ← undocumented anywhere
skill_update_available   ← undocumented anywhere
bifurcation
{step, status, remark}   ← untyped, one per step (8 of them)
run_end                  ← terminal
```

There is **no** `run_start`, `step_start`, or `step_end`. The website's Agent Mode
page claims those exist; they do not. Identify progress events by the presence of
a `step` key, and tolerate unknown `type` values — the vocabulary is explicitly
open ("new event types and fields may appear in any release").

Other typed events that can appear: `project_folder_auto_defaulted` (fires before
any progress event), `child_agent_start` / `child_agent_end`, `ask_user`
(auto-disabled when stdin is not a TTY, so never in our context), `error`,
`test_md_evidence_ingest`, `test_md_bundle_sync`.

All 12 lines of our smoke run parsed with a strict JSON parser. No lenient
parsing needed.

## Real `run_end` fields

```
status  summary  one_liner  reason  duration  final_state
bifurcated  total_runs  run_id
context { memory, variables, pointer }
credits_consumed          ← see discrepancy below
result_code  reason_code  per_flow_metadata[]
session_dir  run_dir      ← run_dir is LEGACY, no longer created
test_url
```

### Two places the skill reference and reality disagree

**1. Credit field name.** Skill v0.0.17 documents `credits`. Our actual run
emitted **`credits_consumed`**. Accept either; prefer `credits_consumed`.

**2. `result_code` type.** Skill v0.0.17 says *string*, and shows a confirmed
product bug as `result_code: "740"`. Our actual run emitted **number `100`**.
So it is not consistently typed — **coerce before comparing.** A strict
`result_code === 740` check would silently never match a string `"740"`. This is
exactly the kind of bug that would make the three-way branch appear to work while
never firing.

### The `verdict` object (new, important)

Under bug detection, a confirmed product bug carries `result_code` 740 **plus a
`verdict` object**: `confirmed`, `family`, `category`, `severity`, `one_liner`,
`confidence`. That is structured triage delivered inline in the terminal event —
richer than reading `failure.yaml`, and the better primary signal for our router.

### Evidence location is not in the event

`run_end` carries **no** evidence-pack field. The hint
`evidence: view locally with kane-cli evidence serve <path>` is printed on
**stderr**. Sealed packs live under `session_dir/evidence/`; a `testrun` suite
pack is created directly in `<cwd>/.testmuai/evidence/`.

## Credit economics (measured)

A 3-step authored run cost **10.35 credits**; balance moved `11200 → 11188.80`,
so ~11.2 all-in. Authoring costs; replay is free. Budget is a non-issue.

### Correction, observed 2026-08-21: `testrun_member_end` carries no classification signal

It carries `path`, `test_id` and `status`. **That is all** — no `result_code`, no
`reason_code`, no `verdict` object, across six live runs. The signals are on each
member's **own** `run_end`, which reaches stderr only under
`KANE_TESTRUN_MEMBER_DEBUG=1`, prefixed `[member] `. So `--member-debug` is not a
debugging convenience: without it §6.2's object and numeric rungs are unreachable and
every failure routes to the residue. See `docs/kane/loop/README.md`.

Two shapes matter for reading that stream:

- `run_end` is emitted **per step group**, `run-0`, `run-1`, …, renumbered for each
  member — nine members of the suite replay produced **forty** of them, and `run_id`
  names no member.
- `test_md_done` (`{type, overall_status, duration_s, session_id}`) is the per-member
  boundary: exactly nine for nine members.

`--bug-detection` is also a **profile** setting (`kane-cli config show` →
`"bug_detection":"off"`), so the branch KEPT chooses would otherwise depend on ambient
state in another tool's config. Every replay now states `--bug-detection continue` in
the argv.

And the investigation's own conclusion, when it runs, is written into the sealed pack
rather than the stream: `tests/<slug>/steps/<n>/failure.yaml` carries
`triage.rca.category: application_issue/ui_data_defect` with a confidence figure. That
is one level deeper than `triage.category`, and the pack is a zip.

### Correction, observed 2026-08-21: a sealed pack is one **file**, and the note is attributable

`<cwd>/.testmuai/evidence/<execution_id>.evidence` is a single **zip archive** of two
to eleven megabytes, not a directory. Any resolver that lists directories finds only
extractions somebody left behind — which is what KEPT did, so `failure-yaml-absent` was
reported on every run and no evidence pack was ever curated.

The archive's shape, read off four live packs:

```
failure.yaml                                  # index: one row per failing member
run.yaml
coverage/usecases.yaml                        # absent on a replay pack — see below
tests/<slug>/result.yaml                      # carries external_id, incl. test_id
tests/<slug>/logs/{meta.yaml,N-console.ndjson,N-network.har}
tests/<slug>/steps/<ordinal-a-b>/failure.yaml # the categorised triage note
tests/<slug>/steps/<ordinal-a-b>/screenshot.jpg
tests/<slug>/steps/<ordinal-a-b>/annotated.png
```

`<slug>` is derived from the document's **title** — `cart-subtotal-d5ba3490` — and
nothing in the note ties it to a member path. The attribution key is one level over, in
`tests/<slug>/result.yaml`:

```yaml
external_id:
  execution_id: 58fb2dfa-94f1-4190-8922-cd8e2079bfe6
  test_id: 1c4fff07-a0da-495b-8471-26d45b4a1441      # == testrun_member_end.test_id
```

That is the same UUID the member event reports and the same one the blast radius
selected, so a note can be attributed by identifier and never by matching a name.

Two further facts about the directory it lives in. `testrun_done` carries
`execution_id` and Kane names the archive after it, so "this run's pack" is knowable —
"the newest pack present" is a different pack on any machine that has run the suite
twice. And on a synced filesystem, iCloud Drive resolves a write collision by keeping
both sides and appending an ordinal: `<uuid> 2.evidence`, sometimes a directory holding
a partial extraction, which sorts **newest** because the sync wrote it last. Both are
rejected by name in `kane/evidence.ts`.

### `cover` on a replay pack: `coverage-payload-unreadable`, not a refusal

`cover --json --mode agent` used to answer `done.status = refused` at exit 2 because
there was no `.context/` store. It no longer refuses; it returns `done: complete` with a
payload whose `depth` axis is empty, and against the newest sealed pack it reports:

```
error: <execution_id> carries no coverage/usecases.yaml — the pack predates coverage
       or its project had no .context at seal time
```

A pack sealed by a *replay* carries no `coverage/usecases.yaml`, so the enrichment axis
is discarded and `kept build` reports `coverage-payload-unreadable`. `provenCoverage`
stays `null` as a result: verdicts are what KEPT observed, coverage is what Kane's graph
says they cover, and withholding the second is honest rather than reporting zero.

## The open question — answered, and the answer is "not on a cached replay"

`--bug-detection` is documented as applying to **authoring** members, which
raised the worry that `740` never fires on cached replay — and our whole
three-way branch keys off it.

Evidence it *does* work on replay: the `testrun_investigations_wait` event is
described as *"Failed **replays** left investigations running; the coordinator
waits before sealing."* Combined with the 0.5.0 changelog ("when a run fails,
kane-cli automatically investigates whether it hit a product bug or a test
issue"), the picture is:

- `--bug-detection` = **proactive** detection during authoring.
- Post-failure **investigation is automatic** and does apply to replay failures.

So `740` plus the `verdict` object should be available on a failing replay. That
was a strong signal, not a proof.

**Measured 2026-08-21, and the original worry was justified.** Across four live
replay failures of the same unchanged test, the member's own `run_end` carried:

| run | `result_code` | `verdict` object |
|---|---|---|
| 15.3's suite replay, where the member **authored** its failing step | `740` | `confirmed: true`, `application_issue`, 0.95 |
| three replay-only failures | *absent* | *absent* |
| one replay-only failure | `710` | `confirmed: false`, `ui_data_defect`, 0.89 |

Three different KEPT branches for one unchanged failure of one unchanged test
against one unchanged application. `740` fires when the member **authors**; on a
cached replay the investigation is intermittent, and when it does run it has
answered both *confirmed* and *not confirmed* about the same disagreement.

The `verdict` object is therefore the richest signal available and not a dependable
one, which is why `failureYamlTriage` ships as a working fallback (R6.13) — and why
the per-step `failure.yaml` **inside the sealed pack**, where the investigation's
real answer lands with a 0.96 confidence and a product-fault category, is the signal
worth reaching next. `docs/kane/loop/README.md` records all of it, including the
three changes and one specification question that stand between that file and the
`code-break` branch.
