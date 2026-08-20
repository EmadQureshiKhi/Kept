# Kane CLI 0.8.4 — verified command surface

Everything here was confirmed by running the CLI on this machine, not read from
the docs site. Where the two disagree, this file wins.

## The top-level `--help` is abridged — don't trust omissions

`kane-cli --help` does not list `cover`, `maintain`, `generate`, `balance`,
`doctor`, `plugin`, or `changelog`. **All of them exist and work.** Absence from
help means nothing. Probe with `kane-cli <cmd> --help` before concluding a
command is missing.

## Commands we rely on

| Command | Verified signature |
|---|---|
| `context` | `ingest \| extract \| list \| review \| sessions \| …` |
| `design tests` | `--use-case <ref>` |
| `cover` | `[--from <pack>] [--json] [--mode interactive\|agent\|ci]` |
| `cover gaps` | `[uc]` — dual-axis ribbon, designed × proven, from the live graph |
| `maintain reconcile` | changed source lands, extraction re-runs, changes HOLD as review cards |
| `maintain evolve` | `[ref]` — re-designs the parent use-case; unaffected items preserved verbatim |
| `testrun run` | see flags below |
| `evidence` | `validate \| serve \| merge` |

`cover --from` defaults to the newest pack in `.testmuai/evidence`.

## `testrun run` flags (the loop's engine)

| Flag | Notes |
|---|---|
| `--from-context <ids>` | **Select members by assurance-graph test ids** (`T-1,T-2`). Unions with explicit paths. This is our blast-radius selector. |
| `--tags <list>` | ANY-match on frontmatter `tags:` |
| `--match <regex>` | filter by project-relative path |
| `--parallel <n>` | default `1` |
| `--on-failure` | `continue` (default) \| `fail-fast` |
| `--bug-detection` | `off\|stop\|continue` — see open question below |
| `--dry-run` | plan + validate, execute nothing |
| `--retry` / `--retry-count <n>` | replay recovery, default 3 |
| `--remote [backend]` | needs `kane-cli plugin install remote-execution` |

## `run` flags — one documented default is wrong

`--max-steps` default is **50**, not 30 as the docs state. Also present and
undocumented: `--task-skills` (experimental). Note `--url` is **not** in the
`run` flag list; put the starting URL in the objective text instead.

## Real NDJSON event stream

Observed sequence from an actual `--agent` run:

```
recording_state          ← undocumented
skill_update_available   ← undocumented
bifurcation
{step, status, remark}   ← untyped, one per step (8 of them)
run_end                  ← terminal
```

The docs site's Agent Mode page claims typed `run_start` / `step_start` /
`step_end` events. **Those do not exist in 0.8.4.** Parse rule: build on
`run_end` only, identify progress events by presence of a `step` key, and
tolerate unknown `type` values — the vocabulary is open and two of the five
types above appear in no documentation.

All 12 lines of our smoke run parsed with a strict JSON parser. No lenient
parsing needed.

## Real `run_end` fields

```
status  summary  one_liner  reason  duration  final_state
bifurcated  total_runs  run_id
context { memory, variables, pointer }
credits_consumed          ← docs call this `credits`. It is not.
result_code  reason_code  per_flow_metadata[]
session_dir  run_dir  test_url
```

`result_code` is the HTTP-style code (`100` = `success.complete`), separate from
the process exit code (`0`). Both appear. `740` = confirmed product bug.

## Credit economics (measured)

A 3-step run against example.com cost **10.35 credits**; account balance moved
`11200 → 11188.80`, so ~11.2 all-in. Authoring is the cost; replay is free.
Budget is a non-issue at this scale.

## Open question to validate before relying on it

`--bug-detection` is described as *"detect product bugs while authoring member
steps"* — **while authoring**. The 0.5.0 changelog instead says investigation
happens whenever a run fails. If the product-bug verdict only fires during
authoring and not on cached replay, the three-way repair branch cannot key off
`740` during replay-driven verification.

**This is the single most important thing to test empirically once a fixture app
and one authored test exist.** Fallback if it only fires on authoring: drive the
branch off `failure.yaml` triage plus the `7xx` assertion-error codes instead.
