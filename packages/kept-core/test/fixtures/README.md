# Kane fixtures — provenance register

Inputs to the family-gated NDJSON parser (§4.1–§4.3), the `failure.yaml` loader
(§6.3) and the verdict router (§6.2). Every file is listed below with what it
represents, whether it was **captured** from a real `kane-cli` 0.8.4 run or
**synthetic** (hand-authored to a verified shape), and which task consumes it.

Provenance matters because stage 6 promotes real captured streams over the
hand-authored ones wherever a real capture exists. **Task 6.4 replaces the files
marked SYNTHETIC**; the two marked CAPTURED are already real and must not be
regenerated or edited.

Ground truth for every shape here is `docs/kane/command-surface.md`, the
empirically verified surface, which overrides all published Kane docs.

## The rule that shapes all of these

There are three terminal events, one per Command_Family: `run_end`
(Execution_Run), `testrun_done` (Execution_Testrun), `done` (Assurance). **No
fixture carries another family's terminal event** — a stream that did would let a
parser bound to the wrong family appear to work. The Assurance envelope
`{type, v: 1, verb}` appears on Assurance events only; `run_*` and `testrun_*`
events carry no `v`, matching the recorded capture.

`run_start`, `step_start` and `step_end` do not exist in 0.8.4 and appear
nowhere here. Progress events are the untyped `{step, status, remark}` objects.

## NDJSON

| File | Provenance | What it represents | Consumed by |
|---|---|---|---|
| `run-passed.ndjson` | **CAPTURED** | Byte-for-byte copy of `docs/kane/smoke-run.ndjson` — a real recorded twelve-line `run --agent` stream ending in `run_end`, status `passed`. | 2.12–2.14, 2.15 |
| `run-failed-740.ndjson` | SYNTHETIC | A failing authored `run`: nine lines ending in `run_end` with status `failed`, the confirmed-bug code carried as the **string** `"740"`, and an inline `verdict` object. | 2.14, 11.3, stage 11 |
| `testrun-mixed.ndjson` | SYNTHETIC | A four-member suite: `testrun_plan` (`valid: true`, `test_id` per member) → `testrun_start` → four `member_start`/`member_end` pairs covering **all four** statuses → `testrun_investigations_wait` → `testrun_evidence_ingest` → `testrun_summary` → `testrun_done`. | 2.12–2.14, 6.5 mapping, stage 8 |
| `testrun-preflight-invalid.ndjson` | SYNTHETIC | Preflight rejection: `testrun_plan` with `valid: false` and one member per rejection reason (`missing_meta`, `not_authored`, `org_mismatch`, `project_mismatch`), event `exit_code` 2. Nothing ran, so no member event exists and every total is zero. | 2.13, stage 8 (R4.11) |
| `testrun-crashed.ndjson` | SYNTHETIC | Five lines, **truncated mid-suite before `testrun_done`** — one member passed, the second only started. Outcome genuinely unknown: never a pass, never a failure. | 2.13 (crash classification) |
| `assurance-cover-refused.ndjson` | **CAPTURED** | The verified no-context-store refusal envelope of design §5.3.1, byte-identical to the recorded stdout of a real `cover --mode agent` run in a directory with no `.context/` store. Two lines, verbatim, never paraphrased. A refusal is a **complete** stream, not a crashed one. | 2.16 (regression) |
| `assurance-cover-done.ndjson` | SYNTHETIC | The success path of the Ledger's data source: one `coverage` payload event carrying the `--json` document, then `done` with status `complete` and event `exit_code` 0. | 2.13, 5.3 enrichment, stage 5 |
| `assurance-paused.ndjson` | SYNTHETIC | A paused, resumable `maintain reconcile`: `done` with status `paused` and event `exit_code` **3**. For the Assurance family exit 3 means paused and resumable — **never** a failure. Misreading it is the one mistake that corrupts ledger state. | 2.13, stage 5/8 (R5.4) |

### Notes a consumer needs

- **Mixed typing is deliberate, not sloppiness.** The captured smoke run types
  the result code as the number `100` at the top level and the string `"100"`
  inside `per_flow_metadata[0]` — both in one event.
  `run-failed-740.ndjson` inverts that: the string `"740"` at the top level and
  the number `740` in `per_flow_metadata[0]`. `testrun-mixed.ndjson` adds a
  third instance, the string `"801"` on the broken member. Read the field only
  through the coercing accessor; a raw comparison fires on one typing and
  silently never fires on the other.
- **`run_dir` is present in `run-failed-740.ndjson` on purpose.** It is legacy
  and no longer created by Kane. The parser must tolerate it and must never
  perform a filesystem read against it. The evidence path is on stderr only and
  is resolved from `session_dir`, never read out of a terminal event — which is
  why no fixture carries an evidence-pack field on `run_end`.
- **Credits are `credits_consumed`.** The skill reference's `credits` is wrong;
  both are accepted, `credits_consumed` preferred. Replay costs nothing, so
  every `testrun` member here reports `0`.
- **`interrupted` is counted in the `skipped` bucket** of
  `testrun_summary.totals`, whose observed shape is
  `{tests, passed, failed, broken, skipped}` with no `interrupted` key. That
  placement is an assumption, not an observation — confirm it in stage 6.
- **Two values in `testrun-preflight-invalid.ndjson` are unobserved
  assumptions**: that a rejected plan still emits a terminal `testrun_done`, and
  that its status reads `invalid`. The verified surface says only "nothing runs,
  exit 2". `valid: false` on the plan is the authoritative signal; do not key
  behaviour off that status string. Confirm both in stage 6.
- **`review_card` in `assurance-paused.ndjson` is an invented type name.** The
  event vocabulary is explicitly open ("new event types and fields may appear in
  any release"), so it doubles as a real unknown-type-retention case. The
  parser must retain it and continue.
- **The `coverage` payload schema is not pinned by observation**, so it is read
  tolerantly: walk the payload for any array of objects and accept entries
  carrying a test identity and/or a path. The array here lives at
  `coverage.tests`; a consumer that hard-codes that path is over-fitting.
- Test ids map to the fixture-app corpus consistently across every file:
  `T-1` shop_filter, `T-2` home_cta, `T-3` cart_subtotal (the breakable claim),
  `T-4` checkout_validation, `T-5` orders_persist, `T-6` settings_currency,
  `T-7` cart_discount (the never-true claim).

## `failure.yaml`

One file per triage class of design §6.3. All four are **SYNTHETIC** — no real
sealed pack is committed yet — and all four are consumed by task 2.19 (the
loader) and task 11.4 (`failureYamlTriage`).

| File | Signal field used | Signal | Expected branch |
|---|---|---|---|
| `failure-product-bug.yaml` | `triage.category` (nested) | `product_bug` | `code-break` |
| `failure-selector.yaml` | `category` (top level) | `selector_not_found` | `test-drift` |
| `failure-assertion.yaml` | `classification` | `assertion` | `docs-lie` |
| `failure-unparseable.yaml` | — | deliberately invalid YAML | `docs-lie` (default) |

- The three parseable files each use a **different** one of the accepted
  category-ish field names, so the loader's alias handling is exercised by real
  files. The fourth accepted alias, `reason`, has no dedicated fixture — cover
  it with a generated case in task 11.4.
- `failure-selector.yaml` carries a code inside the seven-hundred band on
  purpose. A selector signal must outrank the numeric band, so this file is the
  discriminator for that ordering; only the assertion class combines its signal
  with the band.
- `failure-unparseable.yaml` is verified to be **rejected** by the `yaml`
  package (unterminated quote). Do not repair its syntax — the broken syntax is
  the fixture. The loader returns null and the router defaults to `docs-lie`.
- The assertion fixture is the fixture app's never-true discount claim: the app
  behaved correctly, every selector resolved, and the assertion still failed.
  That residue is the documentation's problem, which is exactly why the
  assertion class routes to `docs-lie`.
