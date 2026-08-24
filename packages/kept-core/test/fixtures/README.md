# Kane fixtures — provenance register

Inputs to the family-gated NDJSON parser (§4.1–§4.3), the `failure.yaml` loader
(§6.3) and the verdict router (§6.2). Every file is listed below with what it
represents, whether it was **captured** from a real `kane-cli` 0.8.4 run or
**synthetic** (hand-authored to a verified shape), and which task consumes it.

Provenance matters because stage 6 promotes real captured streams over the
hand-authored ones wherever a real capture exists.

**Task 6.4 promoted six real streams and two real triage notes in, and replaced
nothing.** That outcome needs stating plainly, because the task was written
expecting replacements:

- `run-failed-740.ndjson` was *not* replaced, because **no real capture carries
  the confirmed-bug code**. The live spike found that a failing cached replay
  carries no result-code field at all (`docs/kane/verdict-spike.md`). The task's
  own condition — "where the observation supports it" — is therefore not met, and
  a fixture that no longer exercised the numeric rung would have deleted test
  coverage rather than improved it.
- The three `testrun-*.ndjson` files were *not* replaced, because reality
  contradicts what four committed suites pin about them — see
  [where reality disagreed](#where-reality-disagreed-with-the-hand-authored-shapes).
  Correcting that is a change to `kane/events.ts` and to those suites; a fixture
  swap is not the place to smuggle in a change to an event contract.
- The real captures were added alongside instead, under their own names, and
  `kane-real-capture.test.ts` asserts every one of the disagreements as
  **observed** behaviour. So the contradiction is now a red test away from being
  silently re-assumed, and the follow-ups are named in
  `docs/kane/verdict-spike.md`.

Ground truth for every shape here is `docs/kane/command-surface.md`, the
empirically verified surface, which overrides all published Kane docs — corrected
in turn by `docs/kane/verdict-spike.md`, which is the only document here written
from streams captured against this repository's own fixture app.

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
| `run-failed-740.ndjson` | SYNTHETIC | A failing authored `run`: nine lines ending in `run_end` with status `failed`, the confirmed-bug code carried as the **string** `"740"`, and an inline `verdict` object with `confirmed: true`. **Kept deliberately after stage 6**: it is the only fixture that exercises the numeric confirmed-bug rung and the `confirmed: true` arm, and no real capture reaches either — the real failing replay carries no code at all and a `confirmed` that was downgraded to false. | 2.14, 11.3, stage 11 |
| `testrun-mixed.ndjson` | SYNTHETIC | A four-member suite: `testrun_plan` (`valid: true`, `test_id` per member) → `testrun_start` → four `member_start`/`member_end` pairs covering **all four** statuses → `testrun_investigations_wait` → `testrun_evidence_ingest` → `testrun_summary` → `testrun_done`. | 2.12–2.14, 6.5 mapping, stage 8 |
| `testrun-preflight-invalid.ndjson` | SYNTHETIC | Preflight rejection: `testrun_plan` with `valid: false` and one member per rejection reason (`missing_meta`, `not_authored`, `org_mismatch`, `project_mismatch`), event `exit_code` 2. Nothing ran, so no member event exists and every total is zero. | 2.13, stage 8 (R4.11) |
| `testrun-crashed.ndjson` | SYNTHETIC | Five lines, **truncated mid-suite before `testrun_done`** — one member passed, the second only started. Outcome genuinely unknown: never a pass, never a failure. | 2.13 (crash classification) |
| `assurance-cover-refused.ndjson` | **CAPTURED** | The verified no-context-store refusal envelope of design §5.3.1, byte-identical to the recorded stdout of a real `cover --mode agent` run in a directory with no `.context/` store. Two lines, verbatim, never paraphrased. A refusal is a **complete** stream, not a crashed one. | 2.16 (regression) |
| `assurance-cover-done.ndjson` | SYNTHETIC | The success path of the Ledger's data source: one `coverage` payload event carrying the `--json` document, then `done` with status `complete` and event `exit_code` 0. | 2.13, 5.3 enrichment, stage 5 |
| `assurance-paused.ndjson` | SYNTHETIC | A paused, resumable `maintain reconcile`: `done` with status `paused` and event `exit_code` **3**. For the Assurance family exit 3 means paused and resumable — **never** a failure. Misreading it is the one mistake that corrupts ledger state. | 2.13, stage 5/8 (R5.4) |
| `assurance-gaps-complete.ndjson` | **CAPTURED** | The real stdout of `cover gaps --json --mode agent` in this repository, byte-identical. Two lines: a `gaps` payload carrying `design_completeness {pct 100, acs_designed "6/6", usecases_complete "1/9", ucs_needing_scenarios 8}`, `proven {pct 100, acs_proven "6/6", source graph_execution_facts, denominator current_live_acs}` and nine per-use-case entries, then `done` with status `complete` at event `exit_code` 0. This is where the Ledger's dual-axis ribbon comes from, and committing it is what makes that axis reproducible with no Kane and no `.context/` store (§5.3.0, R9.9). | 21.5, 22.1 |
| `assurance-gaps-refused.ndjson` | **CAPTURED** | The same command in an empty directory with no `.context/` store: two lines, `error` carrying Kane's own remedy and `done` with status `refused` at event `exit_code` 2, both with `verb: gaps`. The §5.3.1 envelope, observed for the verb KEPT actually invokes. | 21.5, 22.1 |
| `assurance-gaps-paused.ndjson` | DERIVED | The real payload line of `assurance-gaps-complete.ndjson`, followed by a `done` with status `paused` at event `exit_code` **3**. Derived and not captured: `cover gaps` does not pause in this repository. The degradation it exercises still has to hold, and the point of the fixture is that a *readable* payload on a resumable run is refused. | 22.1 |
| `assurance-gaps-truncated.ndjson` | DERIVED | The real payload line and nothing after it. The stream never reaches `done`, so the outcome is unknown and the axes are withheld even though the payload projects nine rows perfectly. | 22.1 |
| `assurance-gaps-no-rows.ndjson` | DERIVED | The real axes with `usecases` and `other` emptied, then a clean `done`. The trap in full: two figures reading 100 over no rows at all, which is what would read as "nothing owed" if the gate ever accepted it. | 22.1 |
| `context-list-sources.jsonl` | SYNTHETIC | The source listing `resolveSourceId` resolves against (§13.2.2), in the shape `context list --json` actually emits: one plain JSON object per line, no envelope and no terminal event, behind the observed `Update available` advisory so the prefix-skip rule is exercised. Shaped so every rung of the five-rung match ladder and every failure rung is reachable from committed bytes. Replaced `context-list-sources.ndjson`, which wrapped the entries in an Assurance envelope Kane never emits for this command. | 12.1, 12.2, 12.5, 15.4 |
| `context-list-live.jsonl` | REAL, verbatim | The **one line the live store prints** for its only source: `id`, `cid`, `label`, `title`, `trust`, `fresh`. No path key, and `cid` is not one of `digest \| sha256 \| hash \| content_hash` — which is why the ladder needs a fifth `basename-slug` rung to match `apps/fixture/README.md` at all. | 15.4 |
| `context-list-no-store.txt` | REAL, verbatim | The whole stdout of `context list --type source --json` in a directory with no `.context/`: `error: no context store here (run \`kane-cli context ingest <files>\` first)`, at exit **2**, as plain text rather than in an envelope. This is what `reason: 'no-store'` is pinned to. | 15.4 |

### Promoted in task 6.4 — real bytes, verbatim

Captured on 2026-08-20 against `apps/fixture` on port 3100 with `kane-cli` 0.8.4,
OAuth, `prod`. The subject of all six is the T-3 probe at
`docs/kane/spike/cart_subtotal_spike_test.md` — a Kane-valid transcription of
`tests/cart_subtotal_test.md`, which Kane's own parser rejects
(`docs/kane/verdict-spike.md` explains why). Absolute paths are left as captured:
these are records, and a fixture edited for tidiness is no longer a record.

| File | Provenance | What it represents | Consumed by |
|---|---|---|---|
| `run-testmd-authored.ndjson` | **CAPTURED** | 179 lines of a real `testmd run --agent` **authoring** run: `run_start` / `step_start` / `step_event` / `step_end` / `run_end` **per step**, six times, then `test_md_bundle_sync`, `test_md_summary` and the real terminal `test_md_done`. Every step charges; the six charges sum to 49.205855. | 6.4 (`kane-real-capture.test.ts`), 6.3 (`verdict-spike-capture.test.ts`) |
| `run-testmd-replay-failed.ndjson` | **CAPTURED** | The spike's subject: the same test replayed from cache against a deliberately broken `subtotal`. The failing step's `run_end` carries **no result-code field** and an inline `verdict` object with `confirmed: false`, `family: application_issue`, `confidence: 0.97` and a `downgrade_reason`. The investigation's charge is on the **verdict object**, not the event. | 6.3, 6.4, stage 11 |
| `run-testmd-replay-passed.ndjson` | **CAPTURED** | The same test replayed once the break was reverted: six green steps, `replay_decisions: 6`, `author_decisions: 0`, and **no credits field anywhere** — the committed-recording claim (R13.6) as bytes. | 6.3, 6.4 |
| `testrun-real-passed.ndjson` | **CAPTURED** | Seven lines of a real `testrun run`: `testrun_plan` → `testrun_start` → `testrun_member_start` / `testrun_member_end` → `testrun_evidence_ingest` → `testrun_summary` → `testrun_done`. The first real capture of this family. | 6.4 |
| `testrun-real-failed.ndjson` | **CAPTURED** | Eight lines: the same suite against the break, with `testrun_member_end.status` `failed` and a real `testrun_investigations_wait` carrying `count: 1`. The member event carries **no verdict object and no code**, which is why both router configurations answer identically on this family. | 6.4, stage 8 |
| `testrun-real-crashed.ndjson` | **CAPTURED, truncated** | The first five lines of `testrun-real-failed.ndjson` — real bytes, cut where a killed coordinator would stop: the member has ended and the investigation is still running, so the outcome is genuinely unreadable. Nothing was written by hand; the only edit is the cut. | 6.4 |

## Where reality disagreed with the hand-authored shapes

Four contradictions, each asserted as observed behaviour in
`kane-real-capture.test.ts`. Read this list before trusting any `testrun_*` field
in the synthetic fixtures above.

1. **`testrun_done` has no `status` and no `totals`.** It carries
   `{type, execution_id, overall_status}`. The totals live on `testrun_summary`,
   and its real bucket set is `{tests, passed, failed, broken, skipped, authored}`
   — an `authored` bucket the register never anticipated, and no `interrupted`
   key, which settles that open question the only way observation can: there is
   nowhere for `interrupted` to go but `skipped`.
   `testrun-mixed.ndjson` puts `status` and `totals` on `testrun_done`, and
   `kane-ndjson.test.ts`, `radius-plan.test.ts`, `verify.test.ts` and
   `argv-contract.test.ts` read them there.
2. **`testrun_plan.members[].test_id` is a UUID.** Kane reported
   `58f4980c-0110-4f7e-b84a-ed89a963a9c6`, not `T-3`. The plan remains the
   authority for the path-to-identifier mapping (R4.4) — the identifier is simply
   not the logical one the corpus uses. Whether declaring `assurance: {id: T-3}`
   in a test's frontmatter makes the plan report `T-3` is **untested**: the probe
   omits the key deliberately, because setting it would reach for an assurance
   graph this repository does not have yet. `--from-context <ids>` takes
   assurance-graph ids, which is a third namespace again.
3. **`valid: true` does not mean the member is runnable.** A member whose
   frontmatter cannot parse still planned as `valid: true`; the parse error
   surfaced later, on stderr, at authoring time. An *unauthored* member is
   **authored**, not rejected. So `valid: false` is rarer than
   `testrun-preflight-invalid.ndjson` assumes, and exit two for that family was
   not reproducible: a non-existent or non-`_test.md` path is a plain CLI error
   with no NDJSON and no plan at all. Neither the terminal event of a rejected
   plan nor its status string was observed — both remain assumptions.
4. **NDJSON for `testrun run` is enabled by stdin not being a TTY, not by stdout
   being piped.** With stdout redirected to a file and stdin left alone, the same
   command printed human-readable text; with `< /dev/null` added, it printed
   NDJSON — including for `--dry-run`. The `piped-stdout` label in the contract
   table is therefore misnamed, though the *behaviour* KEPT relies on is correct
   by accident of `stdio: ['ignore','pipe','pipe']`, which makes stdin not a TTY.

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
  `testrun_summary.totals`. Stage 6 confirmed the real bucket set as
  `{tests, passed, failed, broken, skipped, authored}` — no `interrupted` key
  exists, so `skipped` is the only place it can go. The `authored` bucket is new
  and absent from this fixture.
- **Two values in `testrun-preflight-invalid.ndjson` are still unobserved
  assumptions**: that a rejected plan emits a terminal `testrun_done`, and that
  its status reads `invalid`. Stage 6 could not reach `valid: false` at all — an
  unparseable member planned as valid and an unauthored one was authored — so
  neither assumption was tested and neither may be keyed off. `valid: false` on
  the plan remains the authoritative signal in the design.
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

One file per triage class of design §6.3. All four are **SYNTHETIC** — each one
carries a category in a spelling the loader accepts, which is what makes it a
usable test of the alias ladder — and all four are consumed by task 2.19 (the
loader) and task 11.4 (`failureYamlTriage`).

Two **CAPTURED** notes joined them in task 6.4, lifted verbatim out of the sealed
pack of the real failing `testrun run`. Neither yields a signal, and that is the
finding:

| File | Provenance | What it represents |
|---|---|---|
| `failure-real-triaged.yaml` | **CAPTURED** | The per-failure note, at `tests/<test>/steps/<n>/failure.yaml` inside the pack. Real triage: `root_cause`, `severity: major`, `verification.status: not_verified`, `suggested_fix` — and its category at **`triage.rca.category`**, one level below the `triage.category` alias, so `signal` reads null. `severity` sits directly under `triage` and *is* read; `confidence` sits under `triage.rca` and is not. |
| `failure-real-index.yaml` | **CAPTURED** | The note at the pack **root**, which is an index rather than a triage record: `generated`, `totals`, and a `failures[]` array pointing at the per-failure notes. It carries none of the four accepted aliases, so it too reads as no signal — and `findFailureYamlArtifact` prefers the pack root, so this is the one a router would actually reach. |

Two further facts about the real packs, neither of which any fixture can carry:

- **A sealed pack is a single `.evidence` zip file, not a directory.**
  `kane/evidence.ts` lists a pack *directory*, so against a real pack it resolves
  nothing and `failureYamlTriage` never sees either note above. The pack's table
  of contents is committed as `docs/kane/spike/pack-listing.txt`.
- **A `testmd run` pack lands in `<cwd>/.testmuai/evidence/` as well as under
  `session_dir/evidence/`**, even though only the session path appears on stderr.
  The `testrun` pack lands in the cwd path only, matching the family's
  `cwd-testmuai` derivation.

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

## `context-list-sources.jsonl` — the seven entries, and why each is shaped that way

The listing is what makes `kane-cli maintain reconcile --source-id <id>` possible
at all: `--from` and `--source-id` are **both** mandatory, and the id can only be
built from the `ok: true` arm of `SourceResolution`, so an unresolved source is a
structural no-op rather than a spawn that exits 2 (§13.2, §13.2.2). This file is
therefore the input to the branch that would otherwise have been silently dead.

The **shape** is observed and the **entries** are synthetic. `context list --json`
prints one plain JSON object per line — no `{type,v,verb}` envelope, no `done` — and
this file matches that, with the real `Update available: 0.8.4 \u2192 0.8.5` advisory
line ahead of the JSON because that was observed on stdout too (R3.23's prefix skip
earns its keep here). The seven entries themselves are shaped by hand so every rung
is reachable; the live store carries exactly one source, and it is committed
separately as `context-list-live.jsonl`.

The projection does not depend on the flat shape either. `projectSourceListing`
walks for **any array of objects**, exactly as the `coverage` payload is walked
(§5.3), and the parsed lines are handed to it as one array — so a release that wraps
them in an envelope stops matching this fixture and keeps projecting.

| # | id | Shape | Reachable outcome |
|---|---|---|---|
| 1 | `src_7f31c0a4` | `source_id` + `path` + `digest` + `retired: false`, plus a `title` | rung 1 `exact-path` |
| 2 | `src_1b9d5e22` | `id` + `sha256` + `status: "active"`, **no path field at all**, plus a `use_case` | rung 3 `digest` |
| 3 | `src_c4a80f13` | `sourceId` + `file` + `content_hash` + `status: "retired"` | `reason: 'retired'` |
| 4 | `src_44e1ba07` | `source_path` + `hash`, live | fork guard / `ambiguous` |
| 5 | `src_9c2d7f58` | `path` + `digest`, live, **same file as 4** | fork guard / `ambiguous` |
| 6 | `src_2f6c1d90` | `path` recorded unnormalised: `apps/fixture/./docs/../app/settings/page.tsx` | rung 2 `abs-path` |
| 7 | `src_5e8b03df` | `uri` naming `docs/adr/currency.md` — a file since moved to `apps/fixture/docs/` | rung 4 `unique-basename` |

- **All four path spellings appear once each** — `path`, `file`, `source_path`,
  `uri` — and all four digest spellings across entries 1–5: `digest`, `sha256`,
  `content_hash`, `hash`. Two entries carry the digest with a `sha256:` prefix and
  two carry the bare hex, because the same value in a different spelling is still
  the same value; that is normalisation, not fuzzy matching.
- **Entries 4 and 5 are the fork-guard case** (§13.2.4 #7): one file has been
  ingested twice and now backs two live sources with the same path *and* the same
  digest. Moving a head would fork the graph, so resolution answers `ambiguous`
  and 12.6 reports `reconcile-source-forked` naming **both** ids. Note the two ids
  differ only in their opening characters — nothing may key off ordinal position,
  so neither "the first one" nor "the lower id" is an answer.
- **Entry 6 is the `abs-path` rung, and it needs no hard-coded repository root.**
  Path normalisation is deliberately the same as `normaliseCoveragePath`: POSIX
  separators, trimmed, no leading `./`, no trailing `/` — and it does **not**
  collapse `..`. So entry 6 fails rung 1 on string equality and matches rung 2
  once both sides are resolved against `repoRoot`. That is what rung 2 is *for*:
  an entry the store recorded in a spelling that is equivalent but not identical.
- **Entry 7 is the `unique-basename` rung and the tightest one.** `currency.md` is
  unique across the listing, so a query for `apps/fixture/docs/currency.md` lands
  on it and nothing else. `page.tsx`, by contrast, is the basename of entries 4, 5
  and 6, so any query that reached rung 4 with that basename is `ambiguous` —
  which is the correct answer and not a shortcoming of the fixture.
- **No entry here reaches the fifth rung, and that is deliberate.** Every id in
  this file is an opaque `src_…` token, so `basename-slug` can never fire over it
  and cannot mask a bug in the four rungs above. The slug rung is exercised over
  `context-list-live.jsonl`, whose id is the real `readme` Kane minted from
  `README.md` — the one case where no path and no comparable digest exists.
- **Titles and use-case names are present on purpose.** Entries 1, 4 and 7 carry a
  `title` and entries 2 and 5 a `use_case`, none of which the ladder may ever
  consult. They are here so a "helpful" fallback that reads them can be caught by
  a test rather than by a reviewer.
- **The digests hash documented byte strings, not the committed files.** A digest
  recorded at ingest is a fact about the bytes at that moment, and pinning it to a
  file this repository keeps editing would make the fixture rot. Tests feed the
  bytes below through the injected `SourceFileSystem`, so the rung is exercised
  with a real `node:crypto` hash and no disk:

  | entry | bytes | sha256 |
  |---|---|---|
  | 1 | `# Fixture storefront\n` | `c7dc998f…4dce213d` |
  | 2 | `# Checkout use case\n` | `aa4a6be8…91443bc7` |
  | 3 | `# Pricing\n` | `bed15d0e…24d4673e` |
  | 4, 5 | `export default function ShopPage() {}\n` | `c91d53d5…ac50d4d4` |

- **The leading progress line is not decoration.** `{step, status, remark}`
  objects are how Kane 0.8.4 reports progress, and it carries a `status` key —
  the same key family the projection reads a lifecycle marker from. It is here so
  that a projection which walked object *keys* rather than arrays of objects would
  fail visibly on committed bytes.
