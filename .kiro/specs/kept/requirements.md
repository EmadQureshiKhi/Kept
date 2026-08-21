# Requirements Document

## Introduction

KEPT is a promise-verification system: "Every promise your product makes, and continuous proof it's still kept." A product's promises live in its README, landing copy, and changelog; its behaviour lives in code; the two drift silently. KEPT builds a single graph of every promise, cites each promise back to the exact source file and line that claims it, associates a Kane CLI test with each promise, and keeps the graph honest from two directions: when code changes it re-verifies the promises in the blast radius, and when documentation changes it reconciles what the test suite now owes.

The differentiating behaviour is the three-way repair branch. A red promise has exactly three causes, and Kane's own failure verdict selects between them: the code broke (patch the code), the test drifted (self-heal the test), or the claim was never true (amend the documentation). The third branch — proposing a documentation amendment because a stated promise was never true — is the novel capability.

The system is delivered as an npm workspaces TypeScript monorepo containing a fixture application under test, a read-only web ledger, a core library, and a CLI. Closed-loop automation is wired through Kiro agent hooks. The deliverable is judged on four equally weighted dimensions (Ships, Verified, Closed loop, Craft), with ties broken on Verified first and Closed loop second, so this document treats "Kane produced a meaningful verdict" and "the verdict was fed back to the agent" as first-class, independently verifiable requirements.

### Documented Assumptions (settled before this document; not open questions)

- **A1 Stack**: TypeScript, npm workspaces monorepo. `apps/fixture` (Next.js, port 3100, application under test), `apps/ledger` (Next.js, port 3000, deployed to Vercel), `packages/kept-core` (promise model, NDJSON parser, cover adapter, verdict router), `bin/kept` (CLI). The Ledger shell is built fresh; no dashboard template is forked.
- **A2 Promise source of truth**: one adapter interface with two providers. The Baseline Provider scans `*_test.md` files for `@verifies` tags and can never fail the build. The Enrichment Provider calls `kane-cli cover --json --mode agent`, reads the `coverage` payload event, waits for the `done` Terminal_Event, and layers designed and proven axes on top.
- **A3 Coverage semantics**: `designedCoverage` = promises with a designed test ÷ total promises. `provenCoverage` = promises with a passing verdict in the newest evidence pack ÷ total promises. The public badge reports `provenCoverage`. Freshness is the ISO 8601 timestamp of the newest consumed Terminal_Event (`run_end`, `testrun_done`, or `done` depending on the command that produced it), rendered as relative time.
- **A4 Ledger scope**: read-only projection. No create, update, or delete operations; no authentication; no server-side mutation endpoints. The Vercel build reads a committed `ledger.snapshot.json`. Local development additionally tails live NDJSON into a terminal pane. The badge is a static route plus an SVG endpoint. This deliberately avoids creating any unauthenticated mutable endpoint.
- **A5 Repair autonomy is branch-specific**: code-break repairs are applied automatically; test-drift repairs are held as review cards; documentation amendments are proposed as a rendered diff for one-click acceptance and are never written silently.
- **A6 Verdict routing is pluggable**: a strategy interface with two implementations, `resultCode740` (primary) and `failureYamlTriage` using `failure.yaml` plus `7xx` assertion codes (fallback). `resultCode740` reads the inline `verdict` object when present, because that object is structured triage delivered in the Terminal_Event and is richer than reading `failure.yaml`. The `--bug-detection` flag applying to authoring members is no longer treated as a coin-flip risk: `testrun_investigations_wait` is documented as waiting on investigations left running by failed *replays*, and the 0.5.0 changelog states investigation runs automatically on any failure. So `--bug-detection` is proactive detection during authoring while post-failure investigation is automatic and does cover replays. The spike is therefore a confirmation step rather than a gamble; the `failureYamlTriage` fallback remains mandatory regardless of its outcome. Nothing downstream depends on anything but the interface.
- **A7 Judge path**: `npm run demo` boots the Fixture App and the Ledger from the committed snapshot with zero Kane invocations and zero credit consumption. The Kane-live loop is a separate documented command. Curated `.evidence` packs are force-added to the repository so reviewers can open real proof without credentials.
- **A8 Sequencing**: the Conduit/RealWorld demonstration is an optional tail task, started only after every submission deliverable is complete and passing.
- **A9 Kane environment**: Kane CLI requires a local Chrome installation and therefore cannot execute on Vercel. The Ledger deploys; the Kane loop is delivered as a runnable command plus recorded video.
- **A10 Kane event vocabulary** (empirically verified, overrides published documentation): there are **three** Terminal_Event contracts, not one — `run` and `testmd run` terminate with `run_end` and enable NDJSON via `--agent`; `testrun run` terminates with `testrun_done` and enables NDJSON **automatically when stdout is piped, with no `--agent` flag existing**; `context extract`, `design tests`, `maintain reconcile`, `cover`, and `cover gaps` terminate with `done` and enable NDJSON via `--mode agent`. Progress events are untyped and identified by the presence of a `step` key; unknown `type` values must be tolerated; the credit field is `credits_consumed` at runtime although the skill reference documents `credits`, so either is accepted; `result_code` is distinct from the process exit code and is **not consistently typed** (skill v0.0.17 documents a string and shows `"740"`; the observed run emitted the number `100`), so it must be coerced before comparison; `run_dir` is legacy and no longer created; the Terminal_Event carries no evidence-pack path.
- **A13 Reference authority ranking**: `kane-cli install skill` (skill v0.0.17) ships `references/*.md` that are more detailed and more current than the published website docs. Authority ranks observed runtime behaviour above the skill references, and the skill references above the website docs. The skill installs for Claude Code, Codex CLI, and Gemini CLI only — it does **not** install for Kiro, which uses `powers/`, so installing it changed no CLI behaviour and its sole value is the reference documentation.
- **A14 Exit-code interpretation is per command family**: for the assurance family (`context`, `design`, `maintain`, `cover`), exit `3` means *paused and resumable* and `130` means force-interrupted. For the execution family (`run`, `testmd`, `testrun`, `generate`), exit `3` still means timeout or cancelled. Misreading a resumable pause as a failure would corrupt ledger state, so exit-code handling is always resolved against the invoked command's family.
- **A11 Credit economics**: authoring a Kane test consumes credits (measured ~10.35 for a three-step run); cached replay is free. Per-save verification is therefore economically viable and is built on replay.
- **A12 Deadline**: submissions lock 21 Aug 2026 11:59 PM IST. Scope decisions favour a complete, verifiable narrow slice over breadth.

## Glossary

- **Promise**: A single verifiable claim the product makes about its own behaviour, expressed as a record with a stable identifier, claim text, a Citation, an optional designed test reference, and a current Verdict.
- **Citation**: The exact provenance of a Promise — repository-relative file path, line number, and the verbatim claim text at that line.
- **Promise_Graph**: The directed graph of all Promises and their relationships to designed tests, evidence, and source citations.
- **Promise_Provider**: A component implementing the Promise_Adapter interface that supplies Promise records to the Promise_Graph.
- **Promise_Adapter**: The single TypeScript interface both Promise_Providers implement, defined in `packages/kept-core`.
- **Baseline_Provider**: The Promise_Provider that derives Promises by scanning `*_test.md` files for `@verifies` tags.
- **Enrichment_Provider**: The Promise_Provider that derives designed and proven axes from `kane-cli cover --json` output.
- **Kane_CLI**: The Kane CLI version 0.8.4 executable, invoked as `kane-cli`.
- **Evidence_Pack**: A sealed `.evidence` archive produced by Kane_CLI containing per-step screenshots, `annotated.png`, a HAR capture, per-step console NDJSON, run logs, and `failure.yaml`. The Evidence_Pack path is not carried in any Terminal_Event; it is resolved from `session_dir/evidence/` for a `run` or `testmd run` invocation and from `<cwd>/.testmuai/evidence/` for a `testrun run` suite pack.
- **Command_Family**: A grouping of Kane_CLI commands that share one Terminal_Event contract, one NDJSON-enabling mechanism, and one exit-code interpretation. The three families are Execution_Run (`run`, `testmd run`), Execution_Testrun (`testrun run`), and Assurance (`context extract`, `design tests`, `maintain reconcile`, `cover`, `cover gaps`).
- **Terminal_Event**: The single NDJSON event that ends a Kane_CLI stream for a given Command_Family — `run_end` for Execution_Run, `testrun_done` for Execution_Testrun, and `done` for Assurance.
- **Run_End_Event**: The Terminal_Event of the Execution_Run family, carrying `status`, `summary`, `one_liner`, `reason`, `duration`, `final_state`, `bifurcated`, `total_runs`, `run_id`, `context`, `credits_consumed`, `result_code`, `reason_code`, `per_flow_metadata`, `session_dir`, `test_url`, and optionally a Verdict_Object. The field `run_dir` is legacy and is no longer created by Kane_CLI.
- **Testrun_Done_Event**: The Terminal_Event of the Execution_Testrun family, emitted as `testrun_done` after `testrun_summary`.
- **Assurance_Done_Event**: The Terminal_Event of the Assurance family, emitted as `done` with `status` in `complete`, `paused`, `error`, `refused`, `interrupted`, or `aborted`, and an `exit_code`.
- **Testrun_Plan_Event**: The `testrun_plan` event that opens an Execution_Testrun stream, carrying `valid` and `members` where each member has `path`, an optional `test_id`, `tags`, and an optional `failure`.
- **Member_Status**: The value of `testrun_member_end.status`, one of `passed`, `failed`, `broken`, or `interrupted`.
- **Preflight_Rejection_Reason**: The reason a `testrun run` member is rejected before execution, one of `missing_meta`, `not_authored`, `org_mismatch`, or `project_mismatch`.
- **Verdict_Object**: The `verdict` object carried inline in a Terminal_Event alongside `result_code` 740 under bug detection, containing `confirmed`, `family`, `category`, `severity`, `one_liner`, and `confidence`. It is structured triage delivered in the event stream and is the preferred primary signal over reading `failure.yaml`.
- **Crashed_Stream**: A Kane_CLI NDJSON stream that ends without the Terminal_Event expected for the invoked Command_Family, denoting a crashed process whose outcome is unknown.
- **NDJSON_Parser**: The component in `packages/kept-core` that parses Kane_CLI newline-delimited JSON output for all three Command_Family contracts.
- **Verdict**: The evaluated state of a Promise, one of `proven`, `red`, `undesigned`, or `stale`.
- **Verdict_Router**: The pluggable strategy component that maps a Kane_CLI failure into exactly one Repair_Branch.
- **Repair_Branch**: One of three classifications of a red Promise — `code-break`, `test-drift`, or `docs-lie`.
- **Blast_Radius**: The set of Promise test identifiers selected for re-verification after a source file changes.
- **Ledger**: The read-only Next.js web application in `apps/ledger` that projects the Promise_Graph.
- **Ledger_Snapshot**: The committed `ledger.snapshot.json` file containing a serialised Promise_Graph, coverage metrics, and freshness timestamp.
- **Fixture_App**: The Next.js application in `apps/fixture` that is the subject under verification.
- **KEPT_CLI**: The command-line entry point at `bin/kept` that builds the Promise_Graph, invokes Kane_CLI, and writes the Ledger_Snapshot.
- **Kiro_Hook**: A hook definition file in `.kiro/hooks/` conforming to the Kiro hook JSON schema.
- **Code_Hook**: The Kiro_Hook triggered by edits to Fixture_App source files.
- **Docs_Hook**: The Kiro_Hook triggered by edits to Fixture_App documentation files.
- **Review_Card**: A persisted, human-reviewable proposed change that the system holds rather than applies.
- **Docs_Amendment**: A proposed documentation change rendered as a syntax-highlighted diff, presented for explicit acceptance.
- **Designed_Coverage**: The ratio of Promises with a designed test to total Promises.
- **Proven_Coverage**: The ratio of Promises with a passing Verdict in the newest consumed Evidence_Pack to total Promises.
- **Freshness_Timestamp**: The ISO 8601 timestamp of the newest Terminal_Event consumed into the Ledger_Snapshot.
- **Badge_Endpoint**: The Ledger route that returns an SVG image reporting Proven_Coverage.
- **Demo_Command**: The `npm run demo` script that starts Fixture_App and Ledger from committed data.
- **Live_Loop_Command**: The documented command that runs the Kane_CLI verification loop against Fixture_App.
- **Verdict_Spike**: The time-boxed empirical confirmation that `result_code` `740` and the Verdict_Object are emitted on cached replay, given the documented evidence that post-failure investigation runs automatically on replay failures.

## Requirements

### Requirement 1: Promise model and citation

**User Story:** As a reviewer of the product, I want every promise to be traceable to the exact line that claims it, so that I can confirm the graph describes real claims rather than invented ones.

#### Acceptance Criteria

1. THE Promise_Graph SHALL represent each Promise as a record containing a unique identifier, claim text, a Citation, a designed test reference or an explicit null, and a Verdict.
2. THE Promise_Graph SHALL assign each Promise an identifier that remains unchanged across rebuilds while the Citation file path and claim text remain unchanged.
3. THE Citation SHALL contain a repository-relative file path, a one-based line number, and the verbatim claim text read from that line.
4. WHEN the KEPT_CLI builds the Promise_Graph, THE KEPT_CLI SHALL reject any Promise whose Citation line number exceeds the line count of the cited file.
5. IF a Promise is supplied without a Citation, THEN THE KEPT_CLI SHALL exclude that Promise from the Promise_Graph and record a diagnostic naming the supplying Promise_Provider.
6. THE Promise_Graph SHALL support the four Verdict values `proven`, `red`, `undesigned`, and `stale`, and no others.
7. WHEN two Promise_Providers supply Promises with the same identifier, THE Promise_Graph SHALL merge them into one Promise, preferring the Enrichment_Provider values for the designed test reference and Verdict fields.
8. THE Promise_Graph SHALL be serialisable to JSON and reconstructible from that JSON with identical Promise identifiers, Citations, and Verdicts.

### Requirement 2: Promise providers and graceful degradation

**User Story:** As the operator of the build, I want the promise graph to survive a misbehaving assurance chain, so that a Kane outage never breaks the ledger or the demo.

#### Acceptance Criteria

1. THE packages/kept-core SHALL define one Promise_Adapter interface that both the Baseline_Provider and the Enrichment_Provider implement.
2. WHEN the Baseline_Provider runs, THE Baseline_Provider SHALL scan all `*_test.md` files under the repository and emit one Promise for each `@verifies` tag found.
3. WHEN the Baseline_Provider encounters a `*_test.md` file that cannot be parsed, THE Baseline_Provider SHALL skip that file, record a diagnostic naming the file, and continue scanning remaining files.
4. THE Baseline_Provider SHALL complete with exit status success for every repository state, including a repository containing zero `*_test.md` files.
5. WHEN the Enrichment_Provider runs, THE Enrichment_Provider SHALL invoke `kane-cli cover --json --mode agent`, SHALL treat the invocation as belonging to the Assurance Command_Family, and SHALL derive the designed and proven axes from the `coverage` payload event of that stream.
6. WHEN the Enrichment_Provider parses the `kane-cli cover --json --mode agent` stream, THE Enrichment_Provider SHALL treat the event whose `type` equals `done` as the Terminal_Event of that stream and SHALL accept the enriched axes only after that Terminal_Event is observed.
7. IF the `kane-cli cover --json --mode agent` stream ends without an event whose `type` equals `done`, THEN THE Enrichment_Provider SHALL classify the stream as a Crashed_Stream, SHALL discard the enriched axes, and SHALL record a diagnostic stating that the outcome is unknown.
8. IF the Enrichment_Provider invocation of Kane_CLI exits with a process exit code that its Command_Family defines as failure, returns a `done` event whose `status` is `error`, `refused`, `interrupted`, or `aborted`, produces a Crashed_Stream, returns output that fails JSON parsing, or does not complete within 60 seconds, THEN THE KEPT_CLI SHALL build the Promise_Graph from the Baseline_Provider alone and set the graph field `degraded` to true.
9. IF the Enrichment_Provider receives a `done` event whose `status` is `paused` with exit code 3, THEN THE KEPT_CLI SHALL record the invocation as paused and resumable, SHALL leave every existing Verdict unchanged, and SHALL set the graph field `degraded` to true.
10. WHILE the Promise_Graph field `degraded` is true, THE KEPT_CLI SHALL exit with process exit code 0.
11. WHILE the Promise_Graph field `degraded` is true, THE Ledger SHALL render a static "baseline data only" indicator and SHALL omit the Proven_Coverage figure.
12. WHERE Kane_CLI is absent from the execution environment, THE KEPT_CLI SHALL build the Promise_Graph from the Baseline_Provider alone and SHALL record a diagnostic stating that Kane_CLI was not found.

### Requirement 3: Kane output parsing

**User Story:** As a developer relying on Kane verdicts, I want parsing to follow the empirically verified event stream for every command KEPT invokes, so that undocumented event types never crash the loop and no real data path is silently unreadable.

#### Acceptance Criteria

1. THE NDJSON_Parser SHALL parse each input line as strict JSON and SHALL emit one parsed event per input line.
2. THE NDJSON_Parser SHALL accept a Command_Family value for every stream it parses and SHALL determine the expected Terminal_Event type from that value as `run_end` for Execution_Run, `testrun_done` for Execution_Testrun, and `done` for Assurance.
3. THE NDJSON_Parser SHALL derive Verdict data exclusively from the Terminal_Event expected for the stream's Command_Family, together with the `testrun_member_end` events of an Execution_Testrun stream.
4. THE KEPT_CLI SHALL enable NDJSON output per Command_Family by passing `--agent` for Execution_Run, by piping stdout for Execution_Testrun, and by passing `--mode agent` for Assurance.
5. THE KEPT_CLI SHALL pass no `--agent` flag to `kane-cli testrun run`.
6. IF a stream ends without the Terminal_Event expected for its Command_Family, THEN THE NDJSON_Parser SHALL classify the stream as a Crashed_Stream, SHALL report the outcome as unknown rather than as a pass or a failure, and SHALL record a diagnostic naming the Command_Family and the expected Terminal_Event type.
7. WHILE a stream is classified as a Crashed_Stream, THE KEPT_CLI SHALL leave every existing Promise Verdict and Freshness_Timestamp unchanged.
8. THE NDJSON_Parser SHALL classify an event as a progress event when that event contains a `step` key.
9. WHEN the NDJSON_Parser encounters an event whose `type` value is not in its known set, THE NDJSON_Parser SHALL retain the event as an unknown-type event and SHALL continue processing subsequent lines.
10. THE NDJSON_Parser SHALL read consumed credits from the field named `credits_consumed` and SHALL accept the field named `credits` as an equivalent source when `credits_consumed` is absent.
11. THE NDJSON_Parser SHALL coerce `result_code` to one canonical type before performing any comparison against that value.
12. THE packages/kept-core SHALL compare `result_code` only through the coercing accessor defined by the NDJSON_Parser, and SHALL contain no strict-equality comparison against an un-coerced `result_code` value.
13. THE NDJSON_Parser SHALL resolve `result_code` `740` from both the string value `"740"` and the number value `740`.
14. THE NDJSON_Parser SHALL expose `result_code` and the process exit code as two separate values.
15. THE NDJSON_Parser SHALL interpret the process exit code against the stream's Command_Family, reporting exit code 3 as paused and resumable for the Assurance family, as timeout or cancellation for the Execution_Run and Execution_Testrun families, and exit code 130 as force-interrupted for the Assurance family.
16. WHEN a Terminal_Event carries a `verdict` object, THE NDJSON_Parser SHALL expose that object as a Verdict_Object with its `confirmed`, `family`, `category`, `severity`, `one_liner`, and `confidence` fields.
17. WHEN a Run_End_Event is parsed, THE NDJSON_Parser SHALL expose `status`, `result_code`, `reason_code`, `credits_consumed`, `run_id`, `session_dir`, `per_flow_metadata`, and the Verdict_Object where present as typed fields.
18. THE NDJSON_Parser SHALL treat `run_dir` as a legacy field, SHALL perform no filesystem read against `run_dir`, and SHALL depend on no `run_dir` value being present.
19. THE NDJSON_Parser SHALL resolve the Evidence_Pack location from `session_dir/evidence/` for the Execution_Run family and from `<cwd>/.testmuai/evidence/` for the Execution_Testrun family, and SHALL read no Evidence_Pack path from the Terminal_Event.
20. WHEN an Execution_Testrun stream is parsed, THE NDJSON_Parser SHALL expose `testrun_member_end.status` values `passed`, `failed`, `broken`, and `interrupted` as four distinct values.
21. WHEN a Testrun_Plan_Event is parsed, THE NDJSON_Parser SHALL expose `valid` and, for each member, `path`, `test_id`, `tags`, and `failure`.
22. WHEN an Assurance stream is parsed, THE NDJSON_Parser SHALL expose the `done` event `status` values `complete`, `paused`, `error`, `refused`, `interrupted`, and `aborted`, and the `exit_code` value.
23. THE NDJSON_Parser SHALL skip every leading line that precedes the first line beginning with the character `{` and SHALL record no diagnostic for those skipped leading lines.
24. IF a line after the first line beginning with `{` fails strict JSON parsing, THEN THE NDJSON_Parser SHALL record a diagnostic containing the line number and SHALL continue processing subsequent lines.
25. THE NDJSON_Parser SHALL parse all twelve lines of the recorded smoke run at `docs/kane/smoke-run.ndjson` as an Execution_Run stream, SHALL identify its `run_end` event as the Terminal_Event, and SHALL record no diagnostic.

### Requirement 4: Code-change trigger and blast-radius verification

**User Story:** As a developer editing product code, I want only the affected promises re-verified on save, so that feedback arrives in seconds and costs nothing.

#### Acceptance Criteria

1. WHEN a file under `apps/fixture` matching the Code_Hook file patterns is saved, THE Code_Hook SHALL trigger the KEPT_CLI blast-radius verification action.
2. WHEN blast-radius verification is triggered, THE KEPT_CLI SHALL compute the Blast_Radius as a set of assurance-graph test identifiers and SHALL invoke `kane-cli testrun run --from-context <ids>` with those identifiers and with stdout piped so that NDJSON output is emitted.
3. THE KEPT_CLI SHALL derive the Blast_Radius from Kane_CLI assurance-graph test identifiers rather than from hand-written static analysis of source files.
4. THE KEPT_CLI SHALL obtain the mapping from member path to assurance-graph test identifier from the `test_id` field of the members carried in the Testrun_Plan_Event, optionally requested by invoking `kane-cli testrun run --dry-run`, rather than inferring that mapping from file paths.
5. IF the computed Blast_Radius contains zero test identifiers, THEN THE KEPT_CLI SHALL skip the Kane_CLI invocation and SHALL record a diagnostic stating that no designed test covers the changed file.
6. WHEN blast-radius verification runs, THE KEPT_CLI SHALL execute against cached recordings so that reported consumed credits for the run are 0.
7. WHEN a blast-radius verification run completes, THE KEPT_CLI SHALL treat the event whose `type` equals `testrun_done` as the Terminal_Event of that run and SHALL update Verdicts only after that Terminal_Event is observed.
8. WHEN a blast-radius verification run completes, THE KEPT_CLI SHALL update the Verdict of every Promise in the Blast_Radius from the Member_Status of the corresponding `testrun_member_end` event, mapping `passed` to `proven`, mapping `failed` and `broken` to `red`, and mapping `interrupted` to `stale`.
9. WHEN a blast-radius verification run reports Member_Status `broken` or `interrupted`, THE KEPT_CLI SHALL record the Member_Status value in the run diagnostics so that a broken or interrupted member is distinguishable from an asserted failure.
10. IF a blast-radius verification stream ends without a `testrun_done` event, THEN THE KEPT_CLI SHALL classify the run as a Crashed_Stream and SHALL leave every Promise Verdict unchanged.
11. IF the Testrun_Plan_Event reports `valid` as false, THEN THE KEPT_CLI SHALL record that no member was executed, SHALL surface the Preflight_Rejection_Reason of each rejected member from the values `missing_meta`, `not_authored`, `org_mismatch`, and `project_mismatch`, SHALL treat the resulting process exit code 2 as a preflight rejection rather than a test failure, and SHALL leave every Promise Verdict unchanged.
12. WHERE per-member diagnostics are requested, THE KEPT_CLI SHALL set the environment variable `KANE_TESTRUN_MEMBER_DEBUG` to `1` for the invocation and SHALL capture the `[member]`-prefixed events emitted on stderr into the run diagnostics.
13. WHEN a blast-radius verification run completes, THE KEPT_CLI SHALL resolve the Evidence_Pack for that run from `<cwd>/.testmuai/evidence/` rather than from any field of the Terminal_Event.
14. WHEN a blast-radius verification run completes, THE KEPT_CLI SHALL write the updated Promise_Graph to the Ledger_Snapshot.
15. WHERE a Promise outside the Blast_Radius exists in the Promise_Graph, THE KEPT_CLI SHALL preserve the existing Verdict and Freshness_Timestamp of that Promise verbatim.

### Requirement 5: Docs-change trigger and reconciliation

**User Story:** As a maintainer editing the README, I want the suite to tell me what it now owes, so that new claims cannot enter the product unverified.

#### Acceptance Criteria

1. WHEN a documentation file under `apps/fixture` matching the Docs_Hook file patterns is saved, THE Docs_Hook SHALL trigger the KEPT_CLI reconciliation action.
2. WHEN reconciliation is triggered, THE KEPT_CLI SHALL invoke `kane-cli maintain reconcile --mode agent`, SHALL treat the event whose `type` equals `done` as the Terminal_Event of that stream, and SHALL rebuild the Promise_Graph from both Promise_Providers after that Terminal_Event is observed.
3. IF a reconciliation stream ends without a `done` event, THEN THE KEPT_CLI SHALL classify the stream as a Crashed_Stream, SHALL leave every Promise Verdict unchanged, and SHALL create no Review_Card from that stream.
4. IF a reconciliation `done` event reports `status` `paused` with exit code 3, THEN THE KEPT_CLI SHALL record the reconciliation as paused and resumable, SHALL leave every Promise Verdict unchanged, and SHALL record no failure.
5. WHEN reconciliation produces a Promise that has no designed test reference, THE KEPT_CLI SHALL set the Verdict of that Promise to `undesigned`.
6. WHEN reconciliation removes the Citation for an existing Promise because the cited claim text is no longer present, THE KEPT_CLI SHALL remove that Promise from the Promise_Graph and SHALL record the removal in the run diagnostics.
7. THE KEPT_CLI SHALL hold every change produced by `kane-cli maintain reconcile` as a Review_Card and SHALL apply no such change automatically.
8. WHEN reconciliation completes, THE Ledger_Snapshot SHALL report the count of Promises with Verdict `undesigned` as the outstanding suite debt.

### Requirement 6: Three-way verdict routing

**User Story:** As the agent repairing a red promise, I want Kane's own verdict to select the repair branch, so that the repair addresses the real cause instead of guessing.

#### Acceptance Criteria

1. THE Verdict_Router SHALL expose one strategy interface that maps a parsed Kane_CLI failure to exactly one Repair_Branch value from `code-break`, `test-drift`, and `docs-lie`.
2. THE packages/kept-core SHALL provide two Verdict_Router implementations named `resultCode740` and `failureYamlTriage`.
3. WHERE the `resultCode740` implementation is selected AND a Terminal_Event carries a coerced `result_code` of 740, THE Verdict_Router SHALL return Repair_Branch `code-break`.
4. WHERE the `resultCode740` implementation is selected AND the Terminal_Event carries a Verdict_Object, THE Verdict_Router SHALL treat that Verdict_Object as the primary classification signal and SHALL expose its `severity`, `category`, and `confidence` values alongside the returned Repair_Branch.
5. WHERE the `resultCode740` implementation is selected AND the Terminal_Event carries a Verdict_Object whose `confirmed` field is false, THE Verdict_Router SHALL return Repair_Branch `test-drift`.
6. WHERE the `resultCode740` implementation is selected AND the Terminal_Event carries no Verdict_Object, THE Verdict_Router SHALL fall back to the `failure.yaml` triage content of the resolved Evidence_Pack.
7. WHERE the `failureYamlTriage` implementation is selected, THE Verdict_Router SHALL derive the Repair_Branch from the `failure.yaml` triage content of the Evidence_Pack together with the `7xx` assertion `result_code` values.
8. THE Verdict_Router SHALL compare `result_code` only through the coercing accessor of the NDJSON_Parser, so that a `result_code` of `"740"` and a `result_code` of `740` produce the same Repair_Branch.
9. THE Verdict_Router SHALL return a Repair_Branch for every failing Terminal_Event it is given, defaulting to `docs-lie` when no rule in the selected implementation matches.
10. THE Verdict_Router implementation SHALL be selected by a single configuration value read at startup, and every downstream consumer SHALL depend only on the strategy interface.
11. WHEN the Verdict_Router returns a Repair_Branch, THE Verdict_Router SHALL also return the Kane_CLI evidence reference that justified the classification, resolved from `session_dir/evidence/` or from the `testrun` Evidence_Pack location.
12. THE Verdict_Spike SHALL confirm empirically whether `result_code` 740 and the Verdict_Object are emitted on a failing cached replay, and THE selected default Verdict_Router implementation SHALL be recorded in the repository as the outcome of that confirmation.
13. THE packages/kept-core SHALL provide the `failureYamlTriage` implementation as a working fallback regardless of the outcome of the Verdict_Spike.
14. THE KEPT_CLI SHALL operate correctly with either Verdict_Router implementation selected, without changes to blast-radius verification, repair handling, or the Ledger.
15. THE Verdict_Router SHALL read the triage content from the sealed `.evidence` archive the run's own `execution_id` names, SHALL attribute a triage note to a member only by the test identifier the archive itself declares for that note, and SHALL attribute no note to a member the archive does not name.

*Measured against `kane-cli` 0.8.4, and the reason 15 exists: Kane seals a single `.evidence` zip, `listArtifacts` resolved only a pack directory, and the note is per failing step under a slug derived from the document's title. Nothing read it, so every failure fell to the `docs-lie` default — including a deliberately broken `subtotal`. Matching the slug to a member path would infer identity from a name, which R4.4 and R6.11 exist to forbid; the archive's own `result.yaml` carries the member's `test_id`, so identity is read rather than guessed. Recorded in `docs/kane/loop/README.md` and design §6.3.1.*

### Requirement 7: Branch-specific repair autonomy

**User Story:** As a maintainer, I want automatic repair only where it is safe, so that the system never rewrites my documentation behind my back.

#### Acceptance Criteria

1. WHEN the Verdict_Router returns Repair_Branch `code-break`, THE Code_Hook SHALL instruct the agent to patch the Fixture_App source and THE Code_Hook SHALL re-fire blast-radius verification on the next save of the patched file.
2. WHEN the Verdict_Router returns Repair_Branch `test-drift`, THE KEPT_CLI SHALL invoke `kane-cli maintain evolve --mode agent` for the affected test reference, SHALL treat the event whose `type` equals `done` as the Terminal_Event of that stream, and SHALL hold the resulting changes as Review_Cards.
3. WHEN the Verdict_Router returns Repair_Branch `docs-lie`, THE KEPT_CLI SHALL produce a Docs_Amendment containing the current documentation text and the proposed replacement text.
4. THE KEPT_CLI SHALL write no documentation file content as a result of Repair_Branch `docs-lie` until the Docs_Amendment is explicitly accepted.
5. WHILE a Docs_Amendment is pending, THE Ledger SHALL render that Docs_Amendment as a syntax-highlighted diff with an accept control.
6. WHEN a Docs_Amendment is accepted, THE KEPT_CLI SHALL apply the proposed replacement text to the cited file at the cited line and SHALL rebuild the Promise_Graph.
7. THE Ledger SHALL render each Review_Card with its originating Promise identifier, Repair_Branch, and Kane_CLI evidence reference.
8. WHERE the Verdict_Router returns Repair_Branch `code-break`, THE Handoff_File SHALL authorise Fixture_App source paths only when the Promise carried verdict `proven` before that run, SHALL otherwise authorise no path at all while still reporting the returned Repair_Branch unchanged, and SHALL record a diagnostic naming the Promise, its prior verdict and its citation.
9. THE Handoff_File SHALL record, for every Promise a run reported on, the verdict that Promise held before the run alongside the verdict the run produced.

*Why 8 is a condition on the fence and not on the branch. `code-break` is the only branch whose repair an agent applies automatically, and the only product-fault evidence that survives to KEPT is the category in Kane's sealed triage note — which cannot carry the distinction the repair needs, because Kane reads the designed test as the specification. The Fixture_App's never-true discount claim (R12.7) and its genuinely broken subtotal both earn `application_issue/ui_data_defect`; one unchanged failure has drawn four different Kane answers across three packs and six runs. Authorising a patch on the first would set an agent to implementing a feature nobody designed, to satisfy a claim invented to be false. The prior verdict is the discriminator KEPT holds and Kane does not: `proven` means this repository observed the behaviour, so red after it is a regression and restoring it is what the branch is for; a Promise never `proven` has no observed state to restore. R6.3, R6.4, R6.5 and R6.9 are untouched, so the Ledger still publishes Kane's real conclusion — only the write path is withheld, and the withheld fence forbids every path the granted one allowed. Design §8.1.1.*

### Requirement 8: Ledger projection and read-only guarantee

**User Story:** As a judge opening the deployed URL, I want a live projection of the promise graph, so that I can see current state without installing anything.

#### Acceptance Criteria

1. THE Ledger SHALL render the Promise_Graph as the primary element of its landing view, using a node-link graph in which each node is one Promise.
2. THE Ledger SHALL render each Promise node with its claim text and its Citation file path and line number.
3. WHEN a Promise node is selected, THE Ledger SHALL display the verbatim cited claim text, the designed test reference, the Verdict, and links to the Evidence_Pack artefacts for that Promise.
4. THE Ledger SHALL expose no HTTP route that creates, updates, or deletes any persisted data.
5. THE Ledger SHALL require no authentication for any route.
6. WHEN the Ledger is built for deployment, THE Ledger SHALL read all Promise_Graph data from the committed Ledger_Snapshot and SHALL invoke Kane_CLI zero times.
7. WHERE the Ledger runs in local development, THE Ledger SHALL additionally tail live Kane_CLI NDJSON output into a terminal pane.
8. IF the Ledger_Snapshot is absent or fails schema validation at build time, THEN THE Ledger SHALL fail the build with a diagnostic naming the missing or invalid field.

### Requirement 9: Coverage metrics, freshness, and badge

**User Story:** As a reader of the repository, I want a single honest number for proven coverage, so that I can judge the product's verification state at a glance.

#### Acceptance Criteria

1. THE Ledger SHALL compute Designed_Coverage as the count of Promises with a non-null designed test reference divided by the total Promise count.
2. THE Ledger SHALL compute Proven_Coverage as the count of Promises with Verdict `proven` in the newest consumed Evidence_Pack divided by the total Promise count.
3. IF the total Promise count is zero, THEN THE Ledger SHALL render both coverage figures as "n/a" and SHALL perform no division.
4. THE Badge_Endpoint SHALL return an SVG image whose displayed value is Proven_Coverage expressed as a whole-number percentage.
5. THE Badge_Endpoint SHALL respond with HTTP content type `image/svg+xml`.
6. THE Ledger SHALL render the Freshness_Timestamp as a relative time string derived from the ISO 8601 timestamp of the newest consumed Terminal_Event.
7. WHERE the newest consumed Terminal_Event is older than 24 hours, THE Ledger SHALL render the freshness indicator in the amber verdict colour.
8. THE Ledger SHALL provide a shareable public page reporting Proven_Coverage, Designed_Coverage, Freshness_Timestamp, and per-Promise Verdicts, reachable without authentication.

### Requirement 10: Interface craft

**User Story:** As a judge assessing craft, I want an interface that looks deliberately designed, so that the work reads as a product rather than a generated template.

#### Acceptance Criteria

1. THE Ledger SHALL apply a dark base palette with monospace typography for identifiers, Citations, and metric values.
2. THE Ledger SHALL reserve saturated colour for Verdict communication, using green for `proven`, amber for `stale`, and red for `red`.
3. THE Ledger SHALL render Promises with Verdict `undesigned` using a neutral non-saturated treatment.
4. THE Ledger SHALL restrict animation to transitions that accompany a Verdict change or a graph selection change.
5. THE Ledger SHALL convey every Verdict with a text label in addition to colour.
6. THE Ledger SHALL meet a contrast ratio of at least 4.5 to 1 for body text and at least 3 to 1 for graph node labels against their backgrounds.
7. THE Ledger SHALL expose keyboard navigation for Promise node selection and for Docs_Amendment acceptance controls.
8. THE Ledger SHALL render the Promise_Graph, coverage metrics, and freshness indicator without layout overflow at viewport widths from 1280 to 1920 pixels.

### Requirement 11: Kiro hook integration and closed loop

**User Story:** As a judge assessing the closed loop, I want to see the verdict travel back into the agent's next action, so that the automation is demonstrably more than "run Kane on save".

#### Acceptance Criteria

1. THE repository SHALL contain the Code_Hook and the Docs_Hook as files under `.kiro/hooks/` conforming to the Kiro hook JSON schema.
2. THE Code_Hook SHALL declare event type `fileEdited` and file patterns restricted to Fixture_App source files.
3. THE Docs_Hook SHALL declare event type `fileEdited` and file patterns restricted to Fixture_App documentation files.
4. WHEN a Kane_CLI verification run completes, THE KEPT_CLI SHALL write the Verdict, the Repair_Branch, the Verdict_Object fields where present, and the resolved Evidence_Pack path to a machine-readable file that the triggered agent action reads.
5. WHEN the agent reads a Repair_Branch of `code-break`, THE agent action SHALL produce a source patch to the Fixture_App and THE saving of that patch SHALL trigger the Code_Hook again.
6. THE closed loop SHALL be demonstrable as the ordered sequence source edit, Kane_CLI verification, Verdict recorded, agent repair action, second Kane_CLI verification, Verdict changed to `proven`.
7. THE repository SHALL contain a persisted record of at least one completed closed-loop sequence, including both Terminal_Event verdicts and the intervening patch.
8. IF a hook-triggered Kane_CLI invocation does not complete within 300 seconds, THEN THE KEPT_CLI SHALL terminate the invocation, record a timeout diagnostic, and leave prior Verdicts unchanged.
9. THE KEPT_CLI SHALL interpret the exit code of every hook-triggered Kane_CLI invocation against the Command_Family of the invoked command before writing any Verdict to the Ledger_Snapshot.
10. IF a hook-triggered Assurance-family invocation exits with code 3, THEN THE KEPT_CLI SHALL record the invocation as paused and resumable, SHALL write no failing Verdict, and SHALL leave the Ledger_Snapshot Verdicts unchanged.
11. IF a hook-triggered Assurance-family invocation exits with code 130, THEN THE KEPT_CLI SHALL record the invocation as force-interrupted and SHALL leave prior Verdicts unchanged.

### Requirement 12: Fixture application and its claims

**User Story:** As a demonstrator, I want an application whose README makes specific checkable claims, so that a promise can be broken on camera and repaired.

#### Acceptance Criteria

1. THE Fixture_App SHALL provide between 6 and 8 navigable screens forming a shop or software-service flow.
2. THE Fixture_App SHALL operate with no backend service and no database, holding all state in the browser or in static files.
3. THE Fixture_App SHALL start from a single npm script and SHALL serve on port 3100.
4. THE Fixture_App SHALL include a README containing at least six claims, each stating a specific observable behaviour of a named screen.
5. THE Fixture_App README SHALL state each claim on a single line so that a Citation line number identifies exactly one claim.
6. THE Fixture_App SHALL contain one designated claim whose corresponding behaviour can be disabled by a single source edit, for use in the code-break demonstration.
7. THE Fixture_App SHALL contain one designated claim that describes behaviour the Fixture_App does not implement, for use in the docs-lie demonstration.
8. WHEN the Fixture_App is started by the Demo_Command, THE Fixture_App SHALL render its landing screen within 30 seconds of the command being issued.

### Requirement 13: Judge path and credential-free operation

**User Story:** As a judge with three minutes and no Kane account, I want something running in under thirty seconds, so that I can evaluate the work without setup friction.

#### Acceptance Criteria

1. WHEN the Demo_Command is issued in a repository with dependencies installed, THE Demo_Command SHALL start both the Fixture_App and the Ledger and SHALL render the Ledger landing view within 30 seconds.
2. WHEN the Demo_Command runs, THE Demo_Command SHALL invoke Kane_CLI zero times and SHALL consume zero credits.
3. THE Demo_Command SHALL succeed with no Kane_CLI credentials, no API keys, and no network access beyond localhost.
4. THE repository SHALL contain the curated Evidence_Packs required by the Ledger, committed in the repository rather than generated at demo time.
5. THE Ledger SHALL link each Promise Verdict to artefacts inside a committed Evidence_Pack, including the per-step screenshot and `annotated.png` where present.
6. THE repository SHALL commit all `output-*/` recording directories so that Kane_CLI replay executes without authoring credits.
7. THE repository SHALL exclude `.context/` from version control.
8. THE Live_Loop_Command SHALL be documented in the repository README together with its prerequisites of a local Chrome installation and Kane_CLI credentials.
9. THE repository README SHALL state the deployed Ledger URL and the Demo_Command within its first 20 lines.

### Requirement 14: Submission deliverables

**User Story:** As a hackathon entrant, I want every required artefact present and within limits, so that the submission is not disqualified on process grounds.

#### Acceptance Criteria

1. THE repository SHALL be publicly readable at a stated URL.
2. THE repository SHALL contain a commit history of at least 15 commits, each with a message naming the change it makes.
3. THE repository SHALL contain a demonstration video of duration 180 seconds or less.
4. THE demonstration video SHALL show, in order, the deployed Ledger, a code-break repair, and an accepted Docs_Amendment diff.
5. THE repository SHALL contain a single-paragraph written summary of the project of 120 words or fewer.
6. THE Ledger SHALL be reachable at a public HTTPS URL served by the deployment target.
7. THE repository SHALL record the measured consumed credits of at least one authored Kane_CLI run, read from `credits_consumed` or from `credits`, as evidence of real Kane_CLI execution.
8. WHERE all submission deliverables in this requirement are complete and passing, THE project MAY add the Conduit or RealWorld demonstration as an additional target.
