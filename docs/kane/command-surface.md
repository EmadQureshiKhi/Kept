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
| `context extract`, `design tests`, `maintain reconcile`, `cover`, `cover gaps` | **`done`** | `--mode agent` |

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
| `--from-context <ids>` | **Select members by assurance-graph test ids** (`T-1,T-2`). Unions with explicit paths. Our blast-radius selector. **Not present in skill v0.0.17's flag table — the CLI is ahead of the skill here.** |
| `--tags <list>` | ANY-match on frontmatter `tags:`, case-insensitive |
| `--match <regex>` | filter by project-relative path |
| `--parallel <n>` | default `1`; each worker gets an isolated Chrome + fresh temp profile |
| `--on-failure` | `continue` (default) \| `fail-fast` |
| `--bug-detection` | `off\|stop\|continue` — "passed through to **authoring** members" |
| `--dry-run` | plan + validate, execute nothing |
| `--retry` / `--retry-count <n>` | replay recovery, default 3 |
| `--remote [backend]` | needs `kane-cli plugin install remote-execution` |

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

Envelope: `{"type": …, "v": 1, "verb": "extract"|"design"|"reconcile"|"cover"|"gaps", …}`.
Terminates with exactly one `{"type":"done","status":…,"exit_code":…}` where
`status` ∈ `complete|paused|error|refused|interrupted|aborted`. A stream ending
**without** `done` means the process crashed — outcome unknown.

`cover` emits one `coverage` payload event carrying the full `--json` document,
then `done`. `cover gaps` emits `gaps`, then `done`, with ready-to-run commands
in `next[]`.

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

## The open question — now substantially de-risked, still worth confirming

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
is a strong signal, not a proof — the spike stays, but it is now a confirmation
rather than a gamble. Fallback remains `failure.yaml` triage plus the `7xx`
assertion codes, behind the same strategy interface.
