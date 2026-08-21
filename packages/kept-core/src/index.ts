/**
 * Public surface of `@kept/core` (design §2.1). This barrel is the only import
 * path consumers use — `@kept/cli`, `apps/ledger` and the tests all read from
 * here, never from a deep `dist/**` path.
 *
 * Modules are re-exported as their tasks land: the Kane three-contract layer
 * (stage 2), the promise model and snapshot contract (stage 3), the verdict
 * router (stage 11).
 */

/** Package identity, used by `kept doctor` and by the launcher's build check. */
export const KEPT_CORE_PACKAGE = '@kept/core';

// Diagnostics (1.3) — the reporting channel every later module uses instead of
// throwing.
export type {
  Diagnostic,
  DiagnosticClock,
  DiagnosticDraft,
  DiagnosticSeverity,
  DiagnosticSink,
  CollectingDiagnosticSink,
} from './diagnostics.js';
export { DIAGNOSTIC_SEVERITIES, createDiagnosticSink, isDiagnostic } from './diagnostics.js';

// Kane three-contract layer (2.1) — the four family-dependent facts, encoded
// once. `contractFor` is the only way to obtain a `FamilyContract`, which is
// what makes parsing without a declared family a type error (design §4.2).
export type {
  CommandFamily,
  Exit3Meaning,
  EvidenceLocation,
  FamilyContract,
  NdjsonEnabler,
  TerminalType,
} from './kane/family.js';
export {
  COMMAND_FAMILIES,
  contractFor,
  familyForArgv,
  isCommandFamily,
} from './kane/family.js';

// Coercing accessors (2.2) — the only site in the repo that reads and compares
// `result_code`, because Kane types it inconsistently within a single event
// (design §4.4). Enforced by test/no-raw-result-code.test.ts.
export { CREDITS_FIELDS, RESULT_CODE_FIELD, credits, resultCode } from './kane/coerce.js';

// Per-family exit-code interpretation (2.6) — total over every integer and
// `null`, and the reason an Assurance pause can never read as a failure
// (design §4.5, A14). `WRITE_PERMITTING_EXIT_MEANINGS` is the exit-code half of
// the single verdict write guard (design §4.8).
export type { ExitMeaning } from './kane/exit.js';
export {
  EXIT_FORCE_INTERRUPTED,
  EXIT_KANE_NOT_FOUND,
  EXIT_MEANINGS,
  EXIT_PAUSED_OR_TIMEOUT,
  EXIT_PREFLIGHT_REJECTED,
  EXIT_SUCCESS,
  WRITE_PERMITTING_EXIT_MEANINGS,
  exitMeaning,
  isExitMeaning,
  permitsVerdictWrite,
} from './kane/exit.js';

// Evidence-pack resolution (2.17) — the location is derived from the command
// family and never from a terminal event, because no terminal event carries an
// evidence path and `run_dir` is legacy and no longer created (design §4.6, A12,
// R3.19). Every path returned is absolute.
export type {
  ArtifactKind,
  EvidenceArtifact,
  EvidenceDirEntry,
  EvidenceDirRequest,
  EvidenceFileSystem,
  EvidenceListing,
  EvidencePack,
  EvidenceStat,
  ListArtifactsRequest,
} from './kane/evidence.js';
export {
  ARTIFACT_KINDS,
  EVIDENCE_DIR_NAME,
  TESTMUAI_DIR_NAME,
  classifyArtifact,
  listArtifacts,
  nodeEvidenceFileSystem,
  resolveEvidenceDir,
} from './kane/evidence.js';

// The Kane process boundary (2.20) — the one place a Kane process is started.
// `applyNdjsonEnabler` is the per-family argv contract (`--agent` / nothing /
// `--mode agent`, design §4.7 steps 2–4, R3.4, R3.5) and is exported separately
// so it can be asserted with no process anywhere (tasks 2.21 and 12.13). stdin
// is always `ignore`, which is what makes `ask_user` self-disable — and the
// reason any `context ingest` KEPT performs lands only and never extracts
// (§4.9.1). Nothing Kane does throws: absence, refusal, crash and timeout are
// all returned as data (R2.12, R11.8).
export type {
  BinaryResolver,
  ChildProcessLike,
  InvocationResult,
  InvocationSpec,
  KaneInvokerOptions,
  ReadableLike,
  SpawnLike,
  SpawnOptionsLike,
} from './kane/invoker.js';
export {
  AGENT_FLAG,
  KANE_BINARY_ENV_VAR,
  KANE_BINARY_NAME,
  KILL_GRACE_MS,
  KaneInvoker,
  NDJSON_ENABLER_ARGV,
  STDERR_TAIL_LINES,
  applyNdjsonEnabler,
  clearKaneBinaryCache,
  findKaneBinary,
  resolvedKaneBinary,
} from './kane/invoker.js';

// Identifier derivation (3.1) — the stability rule (design §3.2, R1.2). A
// promise id is keyed on the citation file plus the normalised claim and on
// nothing else: never the line number, never the ordering of claims in the file.
// That is what lets a promise keep its verdict, evidence and history when
// somebody inserts a paragraph above it. Unseeded SHA-256 from `node:crypto`, so
// the same claim derives the same id in a different process a year later.
export {
  ID_HASH_LENGTH,
  NODE_ID_PREFIXES,
  designedTestId,
  documentId,
  evidenceId,
  isDesignedTestId,
  isDocumentId,
  isEvidenceId,
  isNodeId,
  isPromiseId,
  normaliseClaim,
  promiseId,
  sha256Hex,
  toPosix,
} from './model/ids.js';

// The promise model (3.1) — one of the two data contracts of the system
// (design §3.1, R1.1, R1.6). Structural, not branded, because §9.1 requires
// `parse(serialise(x))` to deep-equal `x` and a phantom brand would type a
// parsed record as carrying a property it does not have. Absent fields are
// explicit `null` and never `undefined`, because `JSON.stringify` drops an
// `undefined` key and would silently change the snapshot's shape; the factories
// write the nulls and the guards refuse a record that lost the key.
export type {
  Citation,
  DesignedTest,
  GraphEdge,
  GraphEdgeKind,
  PromiseGraph,
  PromiseGraphInput,
  PromiseRecord,
  PromiseRecordInput,
  ProviderName,
  RepairAnnotation,
  RepairBranch,
  RepairStrategy,
  Verdict,
  VerdictSource,
} from './model/promise.js';
export {
  GRAPH_EDGE_KINDS,
  PROVIDER_NAMES,
  REPAIR_BRANCHES,
  REPAIR_STRATEGIES,
  VERDICTS,
  compareGraphEdges,
  comparePromiseRecords,
  createPromiseGraph,
  createPromiseRecord,
  isCitation,
  isDesignedTest,
  isGraphEdge,
  isGraphEdgeKind,
  isPromiseGraph,
  isPromiseRecord,
  isProviderName,
  isRepairAnnotation,
  isRepairBranch,
  isRepairStrategy,
  isVerdict,
  isVerdictSource,
} from './model/promise.js';

// The Kane event surface (2.8) — every shape the three terminal contracts can
// put on the wire (design §4.3, §5.3.1, R3.16–R3.22). `TerminalEvent<F>` is
// indexed by family, so a stream's terminal event cannot be read as another
// family's. The vocabulary is open by Kane's own documentation:
// `KNOWN_EVENT_TYPES` is a recognition list, never an allow-list, and every
// event carries an index signature so an unannounced field survives the trip.
// Fields a branch could key on (`result_code`, `confirmed`, `confidence`,
// `exit_code`) are typed as the widest plausible wire union, which is what
// forces normalisation instead of a raw comparison that fires on one of Kane's
// two typings and silently never fires on the other. `run_dir` is fenced: the
// wire key is not declared, only `runDirLegacy`, and no filesystem call may ever
// take it (§4.6, R3.18). `VerdictObject` here is the **raw wire shape**; the
// verdict router of stage 11 normalises it into its own settled view.
export type {
  AssuranceDoneEvent,
  AssuranceEnvelope,
  AssuranceStatus,
  EventType,
  KaneErrorEvent,
  KaneEvent,
  KaneEventBase,
  KnownEventType,
  MemberEndEvent,
  MemberEndStatus,
  OtherKaneEvent,
  PerFlowMetadata,
  ProgressEvent,
  RunEndContext,
  RunEndEvent,
  TerminalEvent,
  TestrunDoneEvent,
  TestrunPlanEvent,
  TestrunPlanMember,
  TestrunSummaryEvent,
  TestrunTotals,
  VerdictObject,
  WireEnum,
} from './kane/events.js';
export {
  ASSURANCE_STATUSES,
  KNOWN_EVENT_TYPES,
  MEMBER_END_STATUSES,
  RUN_END_WIRE_FIELDS,
  VERDICT_OBJECT_FIELDS,
  isKnownEventType,
  isVerdictObject,
} from './kane/events.js';

// Coverage metrics (3.11) — the snapshot's `metrics` block (design §9.1, R5.8,
// R9.1, R9.2, R9.3, R2.11). Two honesty rules live in this module. A graph with
// no promises answers `ZERO_PROMISE_METRICS` **by identity**, so both ratios are
// an explicit `null` and no division is performed on a zero total — `0/0` would
// reach the metric rail as a coverage figure, and "no promises yet" is not
// "nothing is proven". And a degraded graph withholds `provenCoverage` entirely,
// because when the enrichment axis was discarded KEPT does not know what is
// proven and a number would claim knowledge it lacks; the Ledger turns that null
// into the `baseline data only` chip. `designedCount` is counted from a non-null
// designed-test reference, never from the verdict, because a designed promise
// whose test failed is `red` and still designed.
export type { CoverageMetrics } from './model/metrics.js';
export {
  VERDICT_COUNT_FIELDS,
  ZERO_PROMISE_METRICS,
  computeMetrics,
} from './model/metrics.js';

// The `failure.yaml` loader (2.19) — the **fallback** triage source of design
// §6.3 (R6.7). The primary signal is the inline `verdict` object on the terminal
// event, which is richer structured triage delivered in the stream itself
// (§6.2, A6); this module is what the router reads when no such object arrived,
// and it is why `failureYamlTriage` can ship working regardless of the verdict
// spike (R6.13). It derives no path of its own: `loadFailureYamlFromEvidence`
// composes with `listArtifacts`, so the pack location still comes from the
// command family and never from an event field (§4.6, A12). It routes nothing
// either — the signal and the coerced code are surfaced unordered, and choosing
// a branch from them is task 11.4. Absent, unreadable, invalid or
// unmaterialisable files answer `null` plus a diagnostic quoting the parser's
// real reason and line; a document that parsed and merely says nothing — empty,
// a bare scalar, a sequence — answers a record, because those are different
// facts about a run (§14.2).
export type {
  FailureYaml,
  FailureYamlFileSystem,
  LoadFailureYamlRequest,
  LoadFromEvidenceRequest,
  TriageSignalField,
} from './kane/failureYaml.js';
export {
  FAILURE_YAML_FILENAMES,
  TRIAGE_SIGNAL_FIELDS,
  findFailureYamlArtifact,
  loadFailureYaml,
  loadFailureYamlFromEvidence,
  nodeFailureYamlFileSystem,
} from './kane/failureYaml.js';

// The family-gated NDJSON parser (2.9) — the only exported parse entry point,
// and it takes a `FamilyContract` first (design §4.2). Since `contractFor()` is
// the only way to obtain one, a parse call cannot exist without a family named
// at the call site, which is what stops a stream being read against the wrong
// terminal event: Kane 0.8.4 ends `ExecutionRun` with `run_end`,
// `ExecutionTestrun` with `testrun_done` and `Assurance` with `done`, and a
// parser bound to the first reports nothing — silently — on the other two.
// `terminal` exists **only** on the `complete` arm of `ParsedStream`, so reading
// a verdict off a crashed stream is a compile error rather than an `undefined`
// that reads as a pass; the `crashed` arm carries `expectedTerminal` plus an
// outcome-unknown diagnostic naming the family and the type it waited for
// (R3.6). A `cover` refusal is therefore **complete** with `status: 'refused'`,
// not crashed (§5.3.1). Classification is `step`-key first (R3.8), the last
// terminal-type event wins, unrecognised types are retained rather than dropped
// (R3.9), non-`{` prefix lines are skipped silently (R3.23) and a malformed line
// is diagnosed with its one-based number while parsing continues (R3.24).
export type {
  CompleteStream,
  CrashedStream,
  ParseStreamOptions,
  ParsedStream,
  ParsedStreamShared,
} from './kane/ndjson.js';
export {
  NDJSON_CRASHED_DIAGNOSTIC_CODE,
  NDJSON_PARSE_DIAGNOSTIC_CODE,
  NDJSON_SNIPPET_LENGTH,
  PROGRESS_KEY,
  parseStream,
} from './kane/ndjson.js';

// The ledger snapshot schema (3.13) — the CLI↔UI seam (design §9.1, R8.8).
// `apps/ledger/data/ledger.snapshot.json` is committed, which is the whole judge
// story: the deployed Ledger needs no Kane, no Chrome, no credentials and no
// network (§9.3, R13.4). So this schema is the authority on that file, not the
// model's cheap structural guards, and it is deliberately strict — an unknown
// key is an error rather than being silently stripped, because an unknown key
// means the file was not written by `kept snapshot`. Every "absent" field is
// `.nullable()` and never `.optional()`, which in zod still *requires the key*:
// that is what catches a record whose `designedTest` was dropped by
// `JSON.stringify` (which drops `undefined` and keeps `null`). Five cross-field
// rules run on every parse, each naming its offending path (R8.8): count
// agreement against `promises`, coverage nullability (null iff zero promises,
// and `provenCoverage` also null while degraded), evidence-reference
// resolution, edge-endpoint resolution, and freshness type/family consistency
// read from the contract table of §4.1. Vocabularies are imported, never
// restated, so the snapshot can never become a second authority on the eight
// exit meanings or the seven artefact kinds.
export type {
  LedgerSnapshot,
  LedgerSnapshotShape,
  SnapshotAmendment,
  SnapshotArtifact,
  SnapshotDiagnostic,
  SnapshotDocument,
  SnapshotEdge,
  SnapshotEvidence,
  SnapshotFreshness,
  SnapshotMetrics,
  SnapshotPromise,
  SnapshotReviewCard,
  SnapshotRun,
  SnapshotRunMember,
  SnapshotVerdictObject,
} from './model/snapshot.js';
export {
  AMENDMENT_STATUSES,
  EVIDENCE_KINDS,
  LedgerSnapshotSchema,
  MAX_SNAPSHOT_RUNS,
  REVIEW_CARD_KINDS,
  REVIEW_CARD_STATUSES,
  SNAPSHOT_SCHEMA_VERSION,
  SnapshotAmendmentSchema,
  SnapshotArtifactSchema,
  SnapshotCitationSchema,
  SnapshotDesignedTestSchema,
  SnapshotDiagnosticSchema,
  SnapshotDocumentSchema,
  SnapshotEdgeSchema,
  SnapshotEvidenceSchema,
  SnapshotFreshnessSchema,
  SnapshotGeneratorSchema,
  SnapshotMetricsSchema,
  SnapshotPromiseSchema,
  SnapshotProposedChangeSchema,
  SnapshotRepairSchema,
  SnapshotReviewCardSchema,
  SnapshotRunMemberSchema,
  SnapshotRunSchema,
  SnapshotVerdictObjectSchema,
  SnapshotVerdictSourceSchema,
  TERMINAL_EVENT_TYPES,
  evidencePackIdFromRef,
  isLedgerSnapshot,
} from './model/snapshot.js';

// Canonical snapshot serialisation (3.14) — the bytes of the committed file
// (design §9.2, R1.8). `parseSnapshot(serialiseSnapshot(x))` deep-equals
// `canonicaliseSnapshot(x)`, which is `x` itself for anything the CLI builds,
// and re-serialising is byte-identical. That is what keeps the committed
// snapshot's git diff readable line-by-line when the commit history is part of
// what a reviewer reads. The stringifier is hand-rolled rather than
// `JSON.stringify(v, null, 2)` because that function reorders integer-like keys,
// turns a stray `Date` into a perfectly plausible string, and silently *drops* a
// key whose value is `undefined`; here each of those throws a `TypeError` naming
// the path. `parseSnapshot` is the one place in the model where throwing is
// right — a malformed snapshot is a broken build artefact, not a state of the
// world, and R8.8 wants the Ledger build to fail naming the field.
export {
  SnapshotParseError,
  canonicaliseSnapshot,
  parseSnapshot,
  serialiseSnapshot,
} from './model/canonical.js';

// The citation admission gate (3.3) — the single funnel into the graph
// (design §3.3, R1.3, R1.4, R1.5). A promise cannot enter the graph without a
// citation that resolves to a real line in a real file, and `admitPromise` is
// what makes the Ledger's "every promise is cited to a file and line" claim true
// rather than aspirational: there is exactly one place a candidate becomes a
// graph-bound `PromiseRecord`, so there is exactly one place to read to know what
// the graph guarantees. Three rejections, each carrying what a reviewer needs to
// act: `no-citation` names the supplying provider (R1.5), `line-out-of-range`
// carries both the requested line and the file's actual line count (R1.4), and
// `file-missing` covers a file that could not be read — including a path this
// gate refuses to read, because `toPosix` deliberately does not police absolute
// or escaping paths and a citation is by definition repository-relative. On
// admission `citation.text` is overwritten with the verbatim line read from disk
// (R1.3): a provider may have paraphrased or gone stale, and disk is the
// authority. Line splitting is `split('\n')`, one-based, untrimmed, and a file
// ending in `\n` gains no phantom final line — a three-line file has three lines
// and line 4 is out of range. The only qualification to "no trimming" is the `\r`
// of a CRLF terminator, which is part of the terminator and would otherwise make
// the committed snapshot depend on how the tree was checked out (§9.1). Reading
// happens only through the injected `CitationSource`, which is why the property
// suite can exercise the same code path over generated documents with no disk
// anywhere. Adversity is always a `Diagnostic`, never a throw (§14.2).
export type {
  Admission,
  AdmissionAccepted,
  AdmissionBatch,
  AdmissionBatchRequest,
  AdmissionFileMissing,
  AdmissionLineOutOfRange,
  AdmissionNoCitation,
  AdmissionRejected,
  AdmissionRejectionReason,
  AdmissionRequest,
  CitationSource,
  PromiseCandidate,
} from './model/admission.js';
export {
  ADMISSION_DIAGNOSTIC_CODES,
  ADMISSION_DIAGNOSTIC_CODE_VALUES,
  ADMISSION_REJECTION_REASONS,
  admitPromise,
  admitPromises,
  citedLine,
  inMemoryCitationSource,
  isCitationPathSafe,
  lineCount,
  nodeCitationSource,
  splitLines,
} from './model/admission.js';

// The single verdict write guard, and the working-state store behind it (3.16) —
// design §4.8, §14.1 step 6, R2.10, R3.7, R5.3, R5.4, R11.8–R11.11. The ledger's
// whole claim is that it never overstates what it has proved, and that claim
// reduces to one predicate stated once: a verdict may move **only** when the
// stream reached its family's terminal event **and** the process exit meant
// success or failure. Both halves, always. Neither is restated here —
// `mayWriteVerdicts` reads the exit-code half from
// `WRITE_PERMITTING_EXIT_MEANINGS` through `permitsVerdictWrite` (kane/exit.ts),
// so this module names no exit meaning at all and a ninth `ExitMeaning` member
// cannot join the writable side by being added; the stream half is the `kind`
// discriminant of `ParsedStream`, and because the guard is declared as a type
// predicate, `stream.terminal` becomes reachable *only* on the branch the guard
// authorised. `applyRun` is the only exported way to move a verdict: it calls the
// guard first and, on refusal, returns the prior state **by reference** — so a
// crashed stream, our own timeout kill, an Assurance pause (exit 3, resumable and
// the single most damaging thing to misread), a force-interrupt, a preflight
// rejection with nothing run at all and a missing binary preserve prior verdicts
// *and* the freshness triple by construction, not by an `if` at each call site.
// The three freshness fields move together or not at all, with the terminal event
// type read from `contractFor()` so it can never disagree with the family that
// produced it (§9.1 rule 5). Refusals are recorded as diagnostics and never
// thrown, and deliberately never folded into the state — appending one would mean
// the state had changed. Everything returned is deep-frozen and untouched records
// are carried across by reference, so an out-of-radius promise *is* its prior
// self (R4.15) and a downstream mutation is a `TypeError` rather than silent
// ledger corruption; `Object.freeze` is the right tool precisely because a frozen
// plain object is still plain, so `canonicaliseSnapshot` accepts it.
export type {
  ApplyRunRequest,
  ApplyRunResult,
  KeptState,
  KeptStateInput,
  ProvenRunOutcome,
  RunOutcome,
  StateFileSystem,
  StateFreshness,
  StateStore,
  StateStoreOptions,
  VerdictWrite,
  WriteRefusalReason,
} from './state.js';
export {
  EMPTY_FRESHNESS,
  STATE_DIAGNOSTIC_CODES,
  STATE_DIAGNOSTIC_CODE_VALUES,
  STATE_FILE_RELATIVE_PATH,
  STATE_SCHEMA_VERSION,
  WRITE_REFUSAL_REASONS,
  applyRun,
  createKeptState,
  createStateStore,
  deepFreeze,
  inMemoryStateFileSystem,
  isKeptState,
  isStateFreshness,
  mayWriteVerdicts,
  nodeStateFileSystem,
  outcomeFromInvocation,
  serialiseState,
  writeRefusals,
} from './state.js';

// The one promise-provider interface (3.5) — design §5.1, R2.1. Both providers
// implement `PromiseAdapter` and nothing else, so the graph builder knows nothing
// about `*_test.md` files or about `kane-cli cover`. The load-bearing detail is
// that **failure is a field, not a throw**: `collect` never rejects, so a
// provider that could not do its job returns `ok: false` with a `degradedReason`
// and the build continues on whatever the other one produced (R2.8, R2.10,
// R2.12). Providers report *candidates*, never records, because the citation
// admission gate of §3.3 is the single funnel into the graph. `invoker` is
// optional on the context for one reason: R2.12 makes a run with no Kane at all a
// supported state, and the baseline provider needs nothing but the filesystem
// (§5.5) — a required field would force every baseline caller to construct a
// process boundary it will never use.
export type {
  PromiseAdapter,
  ProviderAxes,
  ProviderAxisOverlay,
  ProviderContext,
  ProviderResult,
} from './providers/adapter.js';
export { NO_PROVIDER_AXES } from './providers/adapter.js';

// The baseline promise provider (3.5) — the floor under the whole system
// (design §5.2, §5.5, R2.2, R2.3, R2.4). One sentence governs it: `collect`
// resolves `ok: true` for every repository state — a missing root, an unreadable
// directory, a file named `x_test.md` holding compiled bytes, frontmatter
// truncated mid-key, a tag citing line zero of a file that does not exist, and a
// repository with no `*_test.md` files at all. R2.4 states that
// unconditionally, so `BaselineResult` types `ok` as the literal `true` and
// `degradedReason` as the literal `null`: a failing baseline scan is not
// expressible rather than merely unlikely. That is architectural, from assumption
// A2 — the enrichment axis may be absent, refused, paused, timed out or crashed
// and the ledger still renders on baseline alone, so if baseline could fail
// `kept build` could fail and the ledger would have nothing to show. This module
// never sets `degraded` either; that flag belongs to the enrichment axis alone
// (§5.4 step 5). Three things stop "never fails" from becoming "silently finds
// nothing": a repository with no test documents is distinguishable from one where
// every test document was unreadable (`files` empty plus one `info` diagnostic,
// versus `skipped` equal to `files` plus one `warn` naming each, R2.3); every skip
// is named by a diagnostic carrying that path; and a tag whose cited file or line
// does not resolve still becomes a candidate, so the gate refuses it and says why
// (R1.4) instead of the claim vanishing. The `**\/*_test.md` walk is hand-rolled
// with a skip set (`node_modules`, `.git`, `.next`, `dist`, `output-*`,
// `.testmuai`) and a depth cap — there is no glob dependency, and skipping
// `output-*` is load-bearing because it holds committed Kane recordings that can
// themselves contain `*_test.md` files. Frontmatter is read by a bounded
// twenty-line hand-rolled reader rather than `yaml`, and its `test_id` is a cache:
// §3.4 makes `testrun_plan.members[].test_id` authoritative and the designed-test
// node id is keyed on the document path. Cited files are read only through the
// gate's own `CitationSource`, the same instance used for admission, so the
// derived claim and the admitted citation text can never disagree.
export type {
  BaselineContext,
  BaselineDirEntry,
  BaselineFileSystem,
  BaselineOnlyGraph,
  BaselineResult,
  Frontmatter,
  RejectedTag,
  VerifiesScan,
  VerifiesTag,
} from './providers/baseline.js';
export {
  BASELINE_DIAGNOSTIC_CODES,
  BASELINE_DIAGNOSTIC_CODE_VALUES,
  BASELINE_PROVIDER_NAME,
  FRONTMATTER_FENCE,
  FRONTMATTER_MAX_LINES,
  MAX_SCAN_DEPTH,
  SKIPPED_DIRECTORY_NAMES,
  SKIPPED_DIRECTORY_PREFIXES,
  TEST_DOCUMENT_SUFFIX,
  VERIFIES_TAG_SOURCE,
  baselineProvider,
  buildBaselineOnlyGraph,
  collectBaseline,
  extractVerifiesTags,
  inMemoryBaselineFileSystem,
  isSkippedDirectoryName,
  isTestDocumentName,
  isUndecodableDocument,
  nodeBaselineFileSystem,
  readFrontmatter,
} from './providers/baseline.js';

// Tolerant projection of the Assurance `coverage` payload (3.7) — design §5.3.
// The parser deliberately exposes the **whole raw `coverage` event**, because the
// payload's internal schema is not pinned by observation, so this module is where
// an unpinned wire shape becomes axis overlays. The rule is structural rather than
// positional: walk the payload for any array of objects and accept an entry that
// carries a recognisable test identity (`test_id` | `testId` | `id`) and/or a path
// (`path` | `file` | `test_path` | …), plus optional booleans and enums for the
// designed and proven axes. The one recorded payload keeps its array at
// `coverage.tests`; a reader that hard-coded that path would over-fit a single
// capture, and an extra wrapper level would then project zero entries — which is a
// degraded build, not a quiet mis-read. Keying is two-step and in this order:
// `test_id` against a candidate's `designedTest.testId`, else the normalised
// `path` against `designedTest.path`. A match is a **set**, because one
// `*_test.md` legitimately verifies every promise that cites it. A target with no
// designed test matches nothing, and that is right rather than a gap: a coverage
// entry names a test document, and only baseline knows which claim a document
// verifies. `coverageVerdict` returns **null** when the entry says nothing about
// the proven axis, so an unrecognised payload shape can never move a verdict.
export type {
  CoverageAxesRequest,
  CoverageAxesResult,
  CoverageAxisTarget,
  CoverageEntry,
  CoverageMatch,
  CoverageMatchKind,
  CoverageProjection,
} from './providers/coverage.js';
export {
  COVERAGE_DESIGNED_KEYS,
  COVERAGE_PACK_KEYS,
  COVERAGE_PATH_KEYS,
  COVERAGE_PROVEN_KEYS,
  COVERAGE_PROVEN_STATUSES,
  COVERAGE_RED_STATUSES,
  COVERAGE_STALE_STATUSES,
  COVERAGE_STATUS_KEYS,
  COVERAGE_TEST_ID_KEYS,
  COVERAGE_UNDESIGNED_STATUSES,
  MAX_COVERAGE_ENTRIES,
  MAX_COVERAGE_WALK_DEPTH,
  buildCoverageAxes,
  coverageVerdict,
  normaliseCoveragePath,
  projectCoverage,
} from './providers/coverage.js';

// The enrichment promise provider (3.7) — `cover`, gated on the Assurance `done`
// event (design §5.3, §5.3.1, R2.5–R2.9, R2.12). It contributes exactly one thing,
// the assurance axes, and deliberately no candidates and no citations at all:
// §5.4 makes baseline the sole citation authority, and the cheapest way to
// guarantee a Kane outage can never move a citation is for the outage-prone
// provider to have none to move — so `candidates` is typed as the empty tuple.
// The acceptance gate is conjunctive and narrow: `stream.kind === 'complete'`
// **and** a `done` event **and** `terminal.status === 'complete'` **and** a
// `coverage` payload that projects at least one entry. Every near-miss looks
// successful from one angle — a refusal is a *complete* stream (§5.3.1), a pause
// exits 3 and is resumable, a crashed run may have emitted plenty of progress, an
// empty payload parses perfectly — and accepting any of them publishes a proven
// figure the run did not earn. Anything else degrades with its **own** reason from
// the fixed vocabulary of §5.3, because the Ledger's `/runs` page renders that
// string to tell a reviewer why they are looking at baseline data only: the
// verified refusal answers `assurance-status:refused` plus a diagnostic quoting
// Kane's own remedy ("run `context ingest`"), which a generic failure would have
// thrown away. argv is `cover --json` and the `--mode agent` enabler is appended
// by the invoker from the contract table, never restated here. The 60 s budget is
// **required and never defaulted** in this module: `timeouts.enrichmentMs` lives
// in `.kept/config.json` and a default here would be a second home for it, which
// is why the provider is a factory. Nothing throws: absence (R2.12), refusal,
// pause, crash, timeout and an unreadable payload all arrive as `ok: false`.
export type {
  EnrichmentContext,
  EnrichmentResult,
  EnrichmentTarget,
} from './providers/enrichment.js';
export {
  ACCEPTED_ASSURANCE_STATUS,
  ASSURANCE_EXIT_REASON_PREFIX,
  ASSURANCE_STATUS_REASON_PREFIX,
  ENRICHMENT_ARGV,
  ENRICHMENT_DEGRADED_REASONS,
  ENRICHMENT_DEGRADED_REASON_VALUES,
  ENRICHMENT_DIAGNOSTIC_CODES,
  ENRICHMENT_DIAGNOSTIC_CODE_VALUES,
  ENRICHMENT_FAMILY,
  ENRICHMENT_PROVIDER_NAME,
  assuranceExitReason,
  assuranceStatusReason,
  collectEnrichment,
  createEnrichmentProvider,
  enrichmentTargetsFromCandidates,
  enrichmentTargetsFromPromises,
  normaliseAssuranceStatus,
} from './providers/enrichment.js';

// The canonical provider merge (3.8) — design §5.4, R1.7, R2.1, R5.5. Six rules,
// each of them a rule about who is allowed to say what. The admission gate runs
// over **baseline** candidates first, so baseline is the sole citation authority
// and an outage cannot move a citation. On an id collision (R1.7) baseline keeps
// `citation` and `claim` in every case, `designedTest` and `verdict` come from
// enrichment when it supplied them, `providers` is the union and diagnostics are
// concatenated. Axis overlays are then applied, and only keys that are *present*
// are written — a missing key means "leave whatever baseline had", never "clear
// it", so a coverage payload that omitted a test cannot silently un-design it.
// Any promise still without a designed test is `undesigned` (R5.5), and because
// that rule runs after the union it outranks an enrichment verdict for a promise
// enrichment also un-designed. `degraded` is `!enrichment.ok` and nothing else,
// which is what makes `computeMetrics` withhold `provenCoverage` rather than
// report zero (R2.11). Canonical order needs no code here: `createPromiseGraph`
// already sorts promises by id and edges by `(kind, from, to)` and collapses
// duplicate edges, so building through it *is* the requirement — restating the
// comparators would be a second authority on the order the committed snapshot's
// byte stability depends on. An enrichment candidate matching no baseline promise
// is dropped and reported rather than admitted, which follows from the citation
// rule rather than being an extra policy. Omitting `enrichment` is *not* the
// R2.12 path: "Kane is absent" is an enrichment result carrying `kane-not-found`,
// because that is a fact about a run the ledger has to show.
export type { MergeRequest, MergeResult } from './providers/merge.js';
export {
  MERGE_DIAGNOSTIC_CODES,
  MERGE_DIAGNOSTIC_CODE_VALUES,
  mergeGraph,
} from './providers/merge.js';

// The verdict router (11.1) — one strategy interface, two implementations, and a
// single configuration string (design §6.1, §6.4, R6.1, R6.10, R6.14). The
// interface exists because one empirical question was still open when it was
// designed (R6.12): whether a failing cached replay carries the confirmed-bug
// code and an inline `verdict` object at all. The whole three-way repair branch
// keys off the answer, so rather than guess, the answer was fenced behind an
// interface — and the fence is what this barrel enforces. **`selectRouter` is the
// only door.** Neither concrete strategy is exported from here, and nothing
// outside `src/verdict/` imports one, so the spike's outcome can only ever change
// one string in `.kept/config.json` (source scan 3 of 6). An unknown value in
// that string falls back to `resultCode740` **with a diagnostic** and never
// throws: the file is hand-edited and read once at startup, and taking the ledger
// down over a typo would be the worse failure.
// `route` is total by contract — exactly one branch from `code-break`,
// `test-drift` and `docs-lie` for every input, never null, never two, defaulting
// to `docs-lie` when no rule matched (R6.9), because `code-break` requires
// positive evidence of a product fault and `test-drift` requires positive
// evidence of a test-mechanics fault, so the residue belongs to the
// documentation — which is also the only branch that writes nothing without a
// human. `RoutedRepair` is an alias of `RepairAnnotation`, not a lookalike, so the
// routed answer is stored on a `PromiseRecord` with no translation table to
// drift. `NormalisedVerdict` is named apart from `kane/events.ts`'s
// `VerdictObject` on purpose: that one is the **raw wire shape** with every field
// optional and `confirmed` typed as `boolean | string | number | null`, and
// `normaliseVerdictObject` is the crossing from it to the settled shape design
// §6.1 describes. `createFailureContext` is the recommended way to build a
// context: it normalises the object once, fills both evidence paths from the
// family-derived listing rather than from any event field (R6.11), and memoises
// the `failure.yaml` load so the note is read lazily, at most once, and the same
// context answers the same branch on repeated calls.
export type {
  FailureContext,
  FailureContextRequest,
  NormalisedVerdict,
  RoutedRepair,
  VerdictRouter,
  VerdictRouterConfig,
} from './verdict/router.js';
export {
  DEFAULT_VERDICT_ROUTER,
  VERDICT_ROUTER_DIAGNOSTIC_CODES,
  VERDICT_ROUTER_NAMES,
  createFailureContext,
  isVerdictRouterName,
  normaliseVerdictObject,
  resolveEvidenceRef,
  selectRouter,
} from './verdict/router.js';

// Member status → verdict (11.1) — the seam where Kane's four execution statuses
// become the ledger's four verdicts (design §6.5, R3.20, R4.8, R4.9). The two
// vocabularies are not the same four, and the mapping is deliberately lossy in
// one direction and deliberately lossless in the other: `failed` and `broken`
// both become `red`, because the ledger has no fifth colour for "asserted and
// lost" versus "the harness fell over" — and the distinction the verdict throws
// away is preserved verbatim in the run diagnostics by `reportMemberStatus`, so a
// reviewer can still tell the two apart afterwards (R4.9). `memberStatusToVerdict`
// takes a `string` rather than the union because the value arrives from another
// process: a fifth status from a later Kane release is a state of the world, not
// a programming error, and it maps to `stale` — the verdict that claims nothing —
// flagged `known: false` so the caller diagnoses it instead of silently reading
// it as proof or as failure. `entersVerdictRouter` is the single statement that
// only `failed` and `broken` reach the router: `interrupted` proved nothing, so
// there is no failure to triage and manufacturing a repair branch out of that
// absence is exactly the dishonesty the ledger exists to avoid.
export type { MemberStatus, MemberStatusMapping, MemberStatusReport } from './verdict/memberStatus.js';
export {
  MEMBER_STATUSES,
  MEMBER_STATUS_DIAGNOSTIC_CODES,
  MEMBER_STATUS_DIAGNOSTIC_CODE_VALUES,
  ROUTER_MEMBER_STATUSES,
  entersVerdictRouter,
  isMemberStatus,
  memberStatusToVerdict,
  reportMemberStatus,
} from './verdict/memberStatus.js';

// Source-id resolution and its four-rung match ladder (12.1) — design §13.2.2,
// R5.1, R5.2. `kane-cli maintain reconcile` requires **both** `--from` and
// `--source-id`; the earlier bare invocation would have exited 2 on every save
// while looking wired up. The correction is structural, not disciplinary:
// `--source-id` can only be built from the `ok: true` arm of `SourceResolution`,
// so an unresolved source is not *expressible* as a spawn — no process, no
// credit, no review card, no verdict movement, `degraded` still false, exit 0
// (§14.1). The ladder is first-hit-wins over four rungs — repo-relative path
// equality, absolute-path equality after resolving both sides against
// `repoRoot`, sha256 of the file's current bytes against the recorded digest,
// then basename equality with exactly one live candidate — and there is **no
// fuzzy matching at any rung**: two or more live candidates tying is `ambiguous`
// rather than a coin flip, and titles, use-case names and ordinal position are
// never consulted even though the listing carries all three. Normalising
// `sha256:9e0c…` to `9e0c…` is reading a value, not guessing at one; deciding
// two different values are close enough is what the ladder refuses. Path
// normalisation deliberately mirrors `normaliseCoveragePath` and does **not**
// collapse `..`, because rung 1 is equality over that spelling and rung 2 is
// equality over the resolved form — folding them would leave a rung that can
// never report itself. Retirement is judged at the winning rung only, so a
// retired duplicate does not make a live match ambiguous (a retired source
// cannot fork a graph) while a match that is *only* retired answers `retired`
// rather than being handed to Kane. `matchStoreSources` is exported because the
// fork guard of §13.2.4 #7 asks a different question of the same match sets, and
// two definitions of "matches" would eventually disagree.
export type {
  LadderRung,
  ResolveFromSourcesRequest,
  RungMatches,
  SourceMatchRequest,
  SourceMatchSet,
  SourceResolution,
  SourceResolutionReason,
  SourceResolutionVia,
  StoreSource,
} from './context/sources.js';
export {
  DIGEST_ALGORITHM_PREFIX,
  LADDER_RUNGS,
  SOURCE_DIAGNOSTIC_CODES,
  SOURCE_DIAGNOSTIC_CODE_VALUES,
  SOURCE_REASON_DIAGNOSTIC_CODE,
  SOURCE_RESOLUTION_REASONS,
  SOURCE_RESOLUTION_VIA,
  absoluteSourcePath,
  matchStoreSources,
  normaliseDigest,
  normaliseSourcePath,
  repoRelativeSourcePath,
  resolveFromSources,
  sourceDigest,
} from './context/sources.js';

// The store's source listing, and the door in front of the ladder (12.2) —
// design §13.2.2, R5.2. One invocation, `context list --type source --json`,
// Assurance family, terminal `done`, 60 s budget; the `--mode agent` enabler is
// appended by the invoker from the contract table and never written here, so the
// effective argv is a fact this module reports rather than a string it composes.
// The payload is projected exactly as tolerantly as the coverage payload (§5.3):
// walk for **any array of objects** and accept an entry carrying an id under any
// of `source_id | id | sourceId`, optionally a path (`path | file | uri |
// source_path`), a digest (`digest | sha256 | hash | content_hash`) and a
// lifecycle marker (`retired | status`), keeping the unprojected entry in `raw`
// for diagnostics. Hard-coding `sources` as the array's key would over-fit one
// capture, and an extra envelope level would then project nothing — which reads
// as an empty store and answers every save with the wrong remedy. Tolerance
// stops in two places: an entry with no id is refused and its location reported,
// because an id is the one field `--source-id` is built from and deriving one
// from a filename is what §13.2.2 forbids outright; and an **empty** array is an
// empty store (`ok`, no sources, so the ladder answers `no-match` and names the
// `context ingest` remedy) while a payload with no array of objects anywhere is
// `listing-unreadable` — failing to read a store is not the same fact as reading
// an empty one. Three failure reasons, each from its own observation: a
// **complete** stream whose `done.status` is `refused` is `no-store`, which is
// the live path in this repository today and is a refusal rather than a crash
// (§5.3.1), so Kane's own remedy is quoted verbatim instead of being thrown away;
// a stream that never reached `done` is `crashed-stream`; everything else that
// left us without a listing — no invoker, no binary, our own timeout kill, a
// pause, an inconsistent envelope — is `listing-unreadable`. `resolveSourceId`
// composes the listing with the ladder and is the only door to a `--source-id`:
// every failure arrives as the `ok: false` arm carrying a reason and a
// diagnostic, so an unresolved source is not *expressible* as a spawn. Its
// `sources` seam is where 12.3's `.kept/sources.json` read-through cache slots
// in, ahead of any process, using the `cache` member the `via` union already
// carries. Nothing throws for anything Kane, the payload or the disk does.
export type {
  ListStoreSourcesRequest,
  ProjectSourceListingOptions,
  ResolveSourceIdRequest,
  SourceByteReader,
  SourceListing,
  SourceListingFailureReason,
  SourceListingProjection,
} from './context/listing.js';
export {
  LIVE_LIFECYCLE_VALUES,
  MAX_SOURCE_ENTRIES,
  MAX_SOURCE_WALK_DEPTH,
  RETIRED_LIFECYCLE_VALUES,
  SOURCE_DIGEST_KEYS,
  SOURCE_ID_KEYS,
  SOURCE_LIFECYCLE_KEYS,
  SOURCE_LISTING_ARGV,
  SOURCE_LISTING_DIAGNOSTIC_CODES,
  SOURCE_LISTING_DIAGNOSTIC_CODE_VALUES,
  SOURCE_LISTING_FAMILY,
  SOURCE_LISTING_TIMEOUT_MS,
  SOURCE_PATH_KEYS,
  listStoreSources,
  nodeSourceByteReader,
  projectSourceListing,
  resolveSourceId,
} from './context/listing.js';

// The testrun plan cache (11.8) — design §7.2, R4.4. `testrun_plan.members[]` is
// the only authority for the mapping from a `*_test.md` path to an
// assurance-graph identifier, so this module's whole job is to obtain the real
// ids and keep them somewhere cheap: `.kept/plan.json`, gitignored because it is
// regenerable single-writer working state like `state.json`. The refresh is
// `kane-cli testrun run --dry-run` under the `ExecutionTestrun` family, whose
// NDJSON enabler is **piped stdout and not a flag** — `--agent` does not exist on
// `testrun run`, Kane rejects it, and nothing runs — so `PLAN_REFRESH_ARGV`
// carries no enabler, the invoker appends none, and `applyNdjsonEnabler` asserts
// none arrived. For this family a process exit of 2 means *preflight rejected*
// rather than generic failure, which is why the gate reads the stream and not the
// exit code. Only `testrun_plan` is consumed, and yet `testrun_done` is still
// required: a truncated `--dry-run` is a crashed stream whose plan may be missing
// members Kane had not enumerated, and under-enumerating silently shrinks the
// blast radius until `kept verify` is a no-op that reports success. When the gate
// refuses — no invoker, no binary, a crashed stream, a completed stream with no
// plan event — **the previous cache is left exactly as it was**, unwritten and
// undeleted, so a transient Kane hiccup cannot turn a working verify path into a
// no-op. Staleness has three triggers (§7.2): missing or malformed, older than
// `maxAgeMs` (ten minutes), or older than any `*_test.md` — the last read from the
// repository-root `tests/` tree, because editing a test document changes what Kane
// would run and a ten-minute window would hand `--from-context` a pre-edit set.
// `PlanMember.testId` is `string | null` and never blank, so "Kane has no id for
// this document" has exactly one representation.
export type {
  PlanFileSystem,
  PlanMember,
  PlanStaleReason,
  PlanStaleness,
  PlanStalenessRequest,
  ReadPlanRequest,
  TestDocumentStamp,
  TestrunPlan,
} from './radius/plan.js';
export {
  MAX_TEST_DOCUMENT_DEPTH,
  PLAN_DIAGNOSTIC_CODES,
  PLAN_DIAGNOSTIC_CODE_VALUES,
  PLAN_FAMILY,
  PLAN_FILE_RELATIVE_PATH,
  PLAN_MAX_AGE_MS,
  PLAN_REFRESH_ARGV,
  PLAN_REFRESH_TIMEOUT_MS,
  TEST_DOCUMENT_ROOT,
  inMemoryPlanFileSystem,
  isTestrunPlan,
  newestTestDocument,
  nodePlanFileSystem,
  normalisePlanEvent,
  planStaleness,
  readPlan,
  serialisePlan,
} from './radius/plan.js';

// The blast radius (11.9) — design §7.1, §7.3, R4.2, R4.3, R4.5. The chain is
// changed paths → tests whose frontmatter `covers:` globs match one → promises
// those tests verify → **the `test_id` of each of those tests, read off
// `testrun_plan.members[]` and nowhere else**. Three structural choices keep that
// last clause true rather than merely intended: `collectTestCoverage` returns
// `path` and `covers` only, deliberately discarding the `test_id` the baseline
// frontmatter reader hands it, so a future refactor cannot start trusting
// frontmatter ids without widening a return type; `computeBlastRadius` is pure —
// no filesystem, no invoker, the plan is a parameter — so with `plan: null` it
// answers zero identifiers rather than guessing, because "Kane has not told us
// the ids" and "we can infer the ids" are different states and only one is
// honest; and a member present in the plan **without** an id is excluded, listed
// in `skippedNoTestId` and diagnosed, never given one by inference from a
// filename, a path or an ordinal position. An empty radius is the common case on
// an unrelated edit and it must cost nothing: `shouldInvokeKane` is the single
// home of R4.5's rule that zero identifiers means zero Kane processes, and one
// `radius-path-uncovered` diagnostic is recorded per uncovered path so a reviewer
// sees precisely which edit nothing verifies. Glob matching is `matchesGlob`,
// about thirty lines over repository-relative POSIX paths supporting literal
// segments, `*` within a segment and `**` across any number of them — there is no
// `micromatch`, the runtime budget of §2.2 is closed at nine packages. The grammar
// deliberately does **not** treat a bare directory as a prefix, so a document that
// means a subtree writes `.../**`, as the committed corpus does. Design §7.3
// sketches `computeBlastRadius({ changed, graph, plan })`; `covers` is the fourth
// input the sketch omits and §7.1's own chain requires, kept as data rather than a
// filesystem read so the function stays pure.
export type {
  BlastRadius,
  BlastRadiusRequest,
  CollectTestCoverageRequest,
  TestCoverage,
  TestDocumentSource,
} from './radius/radius.js';
export {
  RADIUS_DIAGNOSTIC_CODES,
  RADIUS_DIAGNOSTIC_CODE_VALUES,
  collectTestCoverage,
  computeBlastRadius,
  matchesAnyGlob,
  matchesGlob,
  normaliseChangedPath,
  shouldInvokeKane,
} from './radius/radius.js';

// The handoff file (12.8) — the closed-loop contract (design §11.2, §11.3, §8.1,
// §14.1, R7.1, R11.4, R11.7). This is the artefact that makes the loop real
// rather than claimed: KEPT writes it, the Kiro hook's agent prompt reads it, the
// agent repairs inside the fence it declares, saving that repair re-fires the
// hook, and the verdict moves. Two properties carry the whole weight. **It is
// written for every run** — crashed, paused, timed out, preflight-rejected,
// kane-not-found, source-unresolved, radius-empty, never-invoked — with
// `nextAction.branch: null` and a populated `diagnostics` array, because a
// failure path that wrote nothing would leave the agent reading the *previous*
// run's instruction and repairing a promise that is no longer red. The invariant
// is mechanical rather than disciplinary: `buildHandoff` synthesises the reason
// itself when the caller supplied none, so a null branch with an empty
// `diagnostics` is not expressible, and `isHandoffFile` re-checks it on the way
// back in. **And the fence is by branch**, which is what makes §8.1's autonomy
// table real: on `code-break` `allowedPaths` is the three fixture-source globs
// and nothing else, while `forbiddenPaths` names the fixture documentation (or
// the loop could "fix" a red promise by editing the claim — the exact dishonesty
// this product exists to prevent), the repository-root `tests/**` corpus (or it
// could weaken the assertion instead of the bug), and `apps/ledger/**` plus
// `packages/**`, because KEPT's own code is never the repair target. `test-drift`
// and `docs-lie` fence with an **empty** allowed set, since §8.1 holds the one as
// a review card and never writes the other silently; the difference between all
// three is encoded three ways at once — in `allowedPaths`, in `autonomy` and
// `artefact` which are §8.1's own two columns, and in `command`, the exact
// invocation §11.1's prompt runs. Nothing here decides whether a verdict moved:
// `verdictsPermitted` *calls* `mayWriteVerdicts`, and a run the guard refuses can
// never carry a branch however many repairs a caller passes. No path is composed
// either — every evidence path comes from an `EvidenceListing` that derived it
// from the command family (§4.6), so an `evidenceRef` is a real resolved path or
// null. `citation` is required rather than nullable on a result because a result
// is built from a `PromiseRecord`, and a record cannot enter the graph without a
// citation the admission gate resolved (§3.3) — R11.4's "the citation" is
// guaranteed by the type. The filesystem seam is `StateFileSystem`, reused rather
// than redeclared, so `inMemoryStateFileSystem` keeps this module's whole suite
// off disk.
export type {
  BuildHandoffRequest,
  HandoffArtefact,
  HandoffArtifacts,
  HandoffAutonomy,
  HandoffBlastRadius,
  HandoffCommand,
  HandoffFence,
  HandoffFile,
  HandoffFileSystem,
  HandoffHook,
  HandoffNextAction,
  HandoffOutcome,
  HandoffPaths,
  HandoffResult,
  HandoffResultInput,
  HandoffTrigger,
  HandoffVerdictObject,
  WriteHandoffRequest,
  WriteHandoffResult,
} from './handoff/handoff.js';
export {
  BRANCH_FENCES,
  FIXTURE_DOC_GLOBS,
  FIXTURE_SOURCE_GLOBS,
  HANDOFF_DIAGNOSTIC_CODES,
  HANDOFF_DIAGNOSTIC_CODE_VALUES,
  HANDOFF_DIRECTORY_RELATIVE_PATH,
  HANDOFF_FILE_RELATIVE_PATH,
  HANDOFF_HOOKS,
  HANDOFF_SCHEMA_VERSION,
  KEPT_LAUNCHER,
  KEPT_OWN_GLOBS,
  NEXT_ACTION_BRANCH_PRECEDENCE,
  TEST_CORPUS_GLOBS,
  buildHandoff,
  fenceFor,
  handoffArchiveFileName,
  handoffPaths,
  isHandoffFile,
  parseHandoff,
  readNewestHandoff,
  serialiseHandoff,
  writeHandoff,
} from './handoff/handoff.js';

// The `.kept/sources.json` read-through cache (12.3) — design §13.2.2, R5.2.
// The third `.kept/` artefact, beside `plan.json` and `state.json` and gitignored
// for the same reason: regenerable single-writer working state, disposable at the
// cost of one extra `context list`. It slots into the `sources` seam
// `resolveSourceId` already exposes, so a hit invokes **nothing at all** and
// answers `via: 'cache'` — the member that already leads `SourceResolutionVia`,
// which is why a whole rung arrives here without changing a type. The rung that
// originally answered is stored on the entry as a `LadderRung`, a type that
// cannot spell `cache`, so a cached record can never claim the cache as its own
// provenance. An entry is honoured only when **both** conditions of §13.2.2 hold:
// it is younger than `maxAgeMs` (ten minutes) *and* the cited file's mtime is not
// newer than its `resolvedAt`. Either alone is too weak — age alone would hand
// `--source-id` a resolution taken before the very edit that fired the hook, and
// the mtime alone would never notice a store that moved under a file nobody
// touched — and an unreadable mtime is a miss rather than a pass, because not
// knowing is not the same as knowing it is fine. `listingSignature` is a hash of
// the **projected** listing (id, both path spellings, digest, retirement; sorted
// by id so wire reordering is not churn, and `raw` excluded so an `ingested_at`
// stamp moving is not either), which is what lets a refresh keep every recorded
// resolution when the store did not change and drop all of them when it did. The
// rule that matters most is the one `plan.ts` set: a refresh that fails — no
// store, no binary, our own timeout, a stream that never reached `done` — writes
// nothing, deletes nothing, and **the previous entry is still honoured**. That is
// a considered trade rather than a shortcut: the worst case is one process where
// Kane's own checks refuse a moved id with nothing mutated (§13.2.4), against a
// save that silently does nothing, which is the exact failure §13.2 exists to
// make impossible. A *successful* refresh that fails to resolve deletes the
// recorded entry instead, so a later hiccup cannot honour a resolution this
// listing just disproved. The filesystem seam is `StateFileSystem`, reused rather
// than redeclared; mtimes come through their own tiny seam because neither
// `state.ts` nor `handoff.ts` has any use for one.
export type {
  CachedSourceResolution,
  ResolveSourceIdCachedRequest,
  SourceCacheEntry,
  SourceCacheStaleReason,
  SourceCacheStaleness,
  SourceCacheStalenessRequest,
  SourceMtimeReader,
  SourcesCache,
} from './context/cache.js';
export {
  LISTING_SIGNATURE_PREFIX,
  SOURCES_CACHE_FILE_RELATIVE_PATH,
  SOURCES_CACHE_MAX_AGE_MS,
  SOURCES_CACHE_SCHEMA_VERSION,
  SOURCE_CACHE_DIAGNOSTIC_CODES,
  SOURCE_CACHE_DIAGNOSTIC_CODE_VALUES,
  inMemorySourceCacheFileSystem,
  isSourceCacheEntry,
  isSourcesCache,
  nodeSourceMtimeReader,
  readSourcesCache,
  resolveSourceIdCached,
  serialiseSourcesCache,
  sourceCacheStaleness,
  sourcesCachePath,
  sourcesListingSignature,
  writeSourcesCache,
} from './context/cache.js';

// The fork guard — check seven of the fail-fast ladder (design §13.2.4, R5.2).
// One file ingested twice now backs two live sources, and moving a head would
// silently fork the assurance graph; Kane refuses, and KEPT detects the same
// condition from the listing it already read so the refusal costs no process at
// all. It is **not** the ladder's `ambiguous` and the difference is worth stating:
// `ambiguous` is what the ladder answers when two live candidates tie at the rung
// it is standing on, so there is no resolution; the guard runs *after* a
// resolution succeeded and asks whether some other live entry is backed by the
// same file. That happens with nothing tied in two ways — first-hit-wins stops at
// rung one, so a unique path can resolve while a different live entry records the
// same digest elsewhere; and a `.kept/sources.json` hit bypasses the ladder
// entirely, so a fork that appeared since the entry was recorded is invisible to
// it and the guard is the only thing that sees it. The rung sets come from
// `matchStoreSources` rather than from a second notion of matching, and
// `unique-basename` is deliberately excluded: §13.2.4 asks whether the path or
// digest matches, and two documents sharing a filename are two documents. A
// retired entry is never a conflict, because retiring one is precisely how a human
// resolves a fork. The result is a discriminated union so the conflicting ids are
// reachable only on the arm that found some, and the diagnostic
// `reconcile-source-forked` names **both** — which is the one piece of information
// the human needs. Like every other row of §14.1 this is a refusal and not a
// failure: no spawn, no review card, verdicts and freshness untouched, `degraded`
// still false because no proven data was lost, a handoff with `branch: null`, exit
// zero. Wiring those six steps to a command is `kept reconcile`'s job (12.6);
// deciding whether the condition holds is this file's.
export type { ForkConflict, ForkGuardRequest, ForkGuardResult } from './context/forkGuard.js';
export {
  FORK_GUARD_DIAGNOSTIC_CODE,
  FORK_GUARD_RUNGS,
  forkGuard,
} from './context/forkGuard.js';

// Review cards (14.1) — the held-change artefact of design §8.1 and §8.2, and the
// reason `kept reconcile` creates none itself. Kane's `--plan` already holds:
// the head move lands and every other change is **staged** into Kane's own stored
// plan, which is exactly R5.7's "hold every change, apply none automatically". So
// this module mirrors `ReconcileDoc.staged` — the `review_card` events the stream
// carried — into `.kept/review-cards/<id>.json` rather than reimplementing holding
// on top of Kane, and there is no apply path here at all: not guarded, not flagged,
// none. The branch a card carries is *read off* `BRANCH_FENCES` rather than passed
// in, so every card this module can produce has autonomy `hold` and artefact
// `review-card` by construction, and its status is `open` — the vocabulary of §8.2
// has no "applied". `kind` is a separate question and both are kept: `kind` records
// which command staged the change (`reconcile` or `test-drift`), `branch` records
// what class of repair it is, and for both commands that is a held change to the
// designed-test corpus. Ids are content-derived, so a hook that fires on every save
// re-mirrors the same items into the same cards instead of accumulating duplicates,
// and an existing card is left exactly as it was — its status may already have been
// dismissed by a human. `ReviewCard` is field-for-field `SnapshotReviewCard`, so
// `kept snapshot`'s projection is `toSnapshotReviewCard` and nothing else; the raw
// staged event stays on the reconcile result and in the run's handoff. Every write
// goes through `keptWritePath`, the `.kept/` fence, which is what makes "no file
// outside `.kept/` is written" a property of the code rather than of one run.
export type {
  MirroredHeldChanges,
  ProposedChange,
  RepairDirectoryReader,
  ReviewCard,
  ReviewCardContext,
  ReviewCardDraft,
  ReviewCardKind,
  ReviewCardStatus,
  WriteReviewCardRequest,
  WriteReviewCardResult,
} from './repair/reviewCard.js';
export {
  KEPT_DIRECTORY_NAME,
  REVIEW_CARDS_DIRECTORY_RELATIVE_PATH,
  REVIEW_CARD_BRANCH,
  REVIEW_CARD_BRANCHES,
  REVIEW_CARD_DIAGNOSTIC_CODES,
  REVIEW_CARD_DIAGNOSTIC_CODE_VALUES,
  REVIEW_CARD_ID_HASH_LENGTH,
  REVIEW_CARD_ID_PREFIX,
  REVIEW_CARD_OPEN_STATUS,
  buildReviewCard,
  inMemoryRepairFileSystem,
  isKeptWritePath,
  isProposedChange,
  isReviewCard,
  isReviewCardId,
  keptWritePath,
  listReviewCards,
  mirrorReconcileStagedChanges,
  nodeRepairDirectoryReader,
  parseReviewCard,
  readReviewCard,
  repairDirectoryOf,
  reviewCardFromStagedItem,
  reviewCardId,
  reviewCardPath,
  reviewCardsDirectory,
  reviewCardsFromStagedItems,
  serialiseReviewCard,
  testDriftReviewCard,
  toSnapshotReviewCard,
  writeReviewCard,
} from './repair/reviewCard.js';

// The surgical write (14.4) — how one line becomes another, at the level of bytes
// (design §8.4). Terminators are kept **per line** rather than sniffed per file,
// which is the difference between an amendment that changes one line and one that
// silently rewrites a mixed-ending document end to end. Three facts fall out of
// that: `joinDocument(splitDocument(text))` is `text` for every string, replacing
// one line's text leaves every other byte identical including each other line's
// terminator, and trailing-newline state is preserved because it is not a separate
// fact — the last line's terminator is the empty string when the file did not end
// in a newline. A CRLF file stays CRLF and a file with no final newline does not
// gain one. Line numbering is the citation admission gate's, asserted against
// `splitLines` over generated documents rather than trusted to two hand-written
// splitters staying in step, and a lone carriage return is content rather than a
// terminator. A replacement carrying a line terminator is **refused** rather than
// accommodated: inserting one would turn one line into two and shift every citation
// below it. `applyLineEdit` is the one function in `src/repair/` that writes outside
// `.kept/` and it is reachable from exactly one caller — `acceptAmendment`, past the
// interlock — which is what makes "a proposal writes no documentation byte" a
// property of the code rather than of one execution. The rename is its own one-line
// seam for the same reason `SourceMtimeReader` and `ReconcileFileProbe` are theirs.
export type {
  ApplyLineEditRefusal,
  ApplyLineEditResult,
  AtomicRenamer,
  DocumentLine,
  DocumentModel,
  LineEditFileSystem,
  LineEditRefusal,
  LineEditResult,
  LineEnding,
} from './repair/lineEdit.js';
export {
  BYTE_ORDER_MARK,
  LINE_ENDINGS,
  TEMP_FILE_SUFFIX,
  applyLineEdit,
  documentLineCount,
  dominantLineEnding,
  hasTrailingNewline,
  joinDocument,
  nodeAtomicRenamer,
  replaceLine,
  splitDocument,
  tempPathFor,
} from './repair/lineEdit.js';

// Docs amendments (14.4) — the third repair branch, and the differentiator (design
// §8.3, §8.4, R7.3, R7.4, R7.6). `propose()` writes **one** file under
// `.kept/amendments/` carrying the current text, the proposed replacement, the
// interlock, the rationale, the evidence reference and the artefacts; it touches no
// documentation byte on any path, including its failure paths, because every write
// here goes through the `.kept/` fence. The id is `am_` plus eight hex of the promise
// id and the proposed text, so re-proposing the same replacement is the same
// amendment and a hook firing on every save accumulates nothing — and an existing
// record is left exactly as it was, createdAt and status included, because a human
// may already have decided about it. `accept()` re-reads the file and re-hashes the
// cited line: on a mismatch the status becomes `stale`, a diagnostic says the cited
// line changed since the proposal, **no documentation byte is written** and the
// process exits zero, because a document that moved under a proposal is a state of
// the world and not a failure of KEPT. On a match exactly one array element is
// replaced, the result is written to `<file>.kept-tmp` and renamed atomically over
// the original. `reject()` sets one field of one file and touches nothing else.
//
// Two things worth reading before consuming this. First, the hash is taken over
// `normaliseClaim(text)`: §8.3's annotation says "sha256 of currentText" and §8.4
// step 3 spells `sha256(normaliseClaim(lines[line-1]))`, those differ for any line
// with a bullet or indentation, and §8.4 wins — it is the executable step, and it
// makes the interlock go stale exactly when `promiseId` would have moved, since that
// id is keyed on the same normalised claim. Second, and following from it: an
// accepted amendment does not repair a promise, it **retires** one and creates
// another. `p_old` leaves the graph and the successor `amendedPromiseId` enters it
// with no verdict, because carrying the old verdict across would assert that Kane
// proved a sentence it never saw. `AcceptResult.successorPromiseId` names it, and
// `rebuildRequired` is the obligation `kept amend accept` discharges by calling
// `runBuild` and `runSnapshot` — those live in `@kept/cli`, so core reports the
// obligation rather than reaching for a dependency it must not have.
export type {
  AcceptAmendmentRequest,
  AcceptOutcome,
  AcceptResult,
  AmendmentStatus,
  DocsAmendment,
  ProposeAmendmentRequest,
  ProposeRefusal,
  ProposeResult,
  RejectResult,
} from './repair/docsAmendment.js';
export {
  AMENDMENTS_DIRECTORY_RELATIVE_PATH,
  AMENDMENT_DIAGNOSTIC_CODES,
  AMENDMENT_DIAGNOSTIC_CODE_VALUES,
  AMENDMENT_ID_HASH_LENGTH,
  AMENDMENT_ID_PREFIX,
  acceptAmendment,
  amendedPromiseId,
  amendmentId,
  amendmentInterlockHash,
  amendmentPath,
  amendmentsDirectory,
  isAmendmentId,
  isDocsAmendment,
  listAmendments,
  parseDocsAmendment,
  proposeAmendment,
  readAmendment,
  rejectAmendment,
  serialiseAmendment,
  toSnapshotAmendment,
} from './repair/docsAmendment.js';

// The family-less process boundary and the JSON-lines source listing (15.4) —
// design §4.1, §13.2.2. `context list --json` is **not** one of the three event
// contracts: it has no `--mode` flag (its own `--help`), its output is one plain
// JSON object per line rather than the `{type,v,verb}` envelope, and it never emits
// `done`. Declaring it `Assurance` made the invoker append `--mode agent`, which
// Kane rejects with `error: unknown option '--mode'` at exit 1 and an empty stdout
// — so every source resolution answered `listing-unreadable` and no save could ever
// match. `invokePlain` is the corrected seam: it appends nothing, asserts through
// `plainArgv` that the argv does **not** classify into a family (the mirror of
// `applyNdjsonEnabler`'s check), and hands back lines. `parseStream` stays
// unreachable from it, because it takes a `FamilyContract` and there is no contract
// for "no family". `plainExitMeaning` reads the exit family-independently: a plain
// listing has no pause to resume and no preflight to reject, so 2 and 3 are
// ordinary failures rather than invented meanings. Recorded at
// `docs/kane/reconcile/`.
export type { PlainInvocationResult, PlainInvocationSpec } from './kane/invoker.js';
export { plainArgv } from './kane/invoker.js';
export { plainExitMeaning } from './kane/exit.js';
export type { SourceListingLines } from './context/listing.js';
export {
  SOURCE_LISTING_NO_STORE_MARKERS,
  readSourceListingLines,
} from './context/listing.js';

// The fifth match rung (15.4) — design §13.2.2. The live store's projection carries
// `id, cid, label, title, trust, fresh`: no path key, and `cid` is not one of the
// digest spellings, so rungs 1 to 4 have nothing to read. Kane keys a source by
// content and by **slug** — `apps/fixture/README.md` minted `id: readme` — so
// `basename-slug` is the lowest-priority rung, below `unique-basename` so it can
// never shadow a stronger match, subject to the same one-live-candidate rule, and
// carrying its own `via` string so a reviewer is never told a path matched when the
// listing published none.
export { basenameSlug, slugOfName } from './context/sources.js';

// The Kane-runnable homes for a document's KEPT-only annotations (15.2) — design
// §5.2, R4.4. `kane-cli` 0.8.4 accepts a closed set of root frontmatter keys and
// rejects anything else with `unknown config key`, exit 2, before a browser
// launches — so neither `test_id` nor `covers` can live in the fence of a document
// that has to run. The logical id moves to Kane's own `assurance: {id}`, read by
// `readFrontmatter` and still only ever a cache; the radius globs move into the
// body as `<!-- @covers a, b -->`, exactly parallel to the `<!-- @verifies
// file:line -->` convention that already works, so there is one annotation
// mechanism rather than two. `readDocumentCovers` reads both homes so the radius
// never has to know which one a document used.
export { COVERS_MARKER, extractCoversGlobs, readDocumentCovers } from './providers/baseline.js';

// The one path conversion on the Kane boundary (15.3) — design §7.3, §7.4, R4.4.
// The graph, every `covers:` glob and every `designedTest.path` are
// repository-relative POSIX; Kane 0.8.4 reports `testrun_plan.members[].path` and
// `testrun_member_end.path` **absolute**, observed against this repository. The
// two forms compare unequal, and an unequal comparison here reads as "no promise
// is designed by this member" — an empty radius that looks like a decision rather
// than a mismatch. `toRepoRelative` is idempotent on an already-relative path and
// leaves a path under a different root absolute, so a member outside the
// repository stays visible instead of being reshaped to fit.
export { toRepoRelative } from './model/ids.js';

// The `[member]` stream, captured rather than tailed (15.6) — design §4.1, §6.2,
// §7.4, R4.12, R6.4, R6.5. `testrun_member_end` carries `path`, `test_id` and
// `status` and **nothing else**: no `result_code`, no `reason_code`, no `verdict`
// object. That was assumed rather than measured until the closed loop was driven
// live, and the consequence was that §6.2's object rung and numeric rung had
// nothing to read, so every failing member delegated to a triage note that lives
// inside a sealed `.evidence` zip nothing opens — and answered `docs-lie` every
// time, including for a deliberately broken `subtotal`. The three-way branch was a
// one-way branch that looked like it was working. Under
// `KANE_TESTRUN_MEMBER_DEBUG=1` each member's own `run_end` is echoed on stderr
// prefixed `[member] `, carrying the code, the reason code, the full verdict object
// and the credits the judgement cost. `parseMemberDebug` collects those terminals;
// `pairMemberDebug` ties them to the suite's member events **by order** — Kane's
// `run_id: "run-4"` is a session-local index that names no member — and refuses the
// whole attribution on any disagreement in length or status, because a verdict
// object on the wrong failure would authorise an automatic source patch against a
// promise nobody tested.
export type {
  MemberDebugCapture,
  MemberDebugPairing,
  MemberTerminal,
  PairableMember,
} from './kane/memberDebug.js';
export type { MemberSegment } from './kane/memberDebug.js';
export {
  MEMBER_DEBUG_DIAGNOSTIC_CODES,
  MEMBER_DEBUG_DIAGNOSTIC_CODE_VALUES,
  MEMBER_DEBUG_PREFIX,
  MEMBER_TERMINAL_TYPE,
  STEP_GROUP_TERMINAL_TYPE,
  pairMemberDebug,
  parseMemberDebug,
} from './kane/memberDebug.js';

// The sealed pack, opened (§4.6, §6.3, R6.7, R13.4). Kane seals a pack as a single
// `.evidence` **zip**, and `kane/evidence.ts` walks a pack *directory*, so the
// triage note that decides the repair branch sat in a file nothing in KEPT opened.
// `readPackEntries` is enough of the zip format to read one — `node:zlib`'s raw
// inflate, no dependency added and no `unzip` spawned — and it lives here because
// two callers need it: `kept snapshot` curates the artefacts a judge clicks, and
// `readSealedPackTriage` reads the note that routes a repair.
export type { PackEntry, ReadPackOptions } from './kane/packArchive.js';
export { PackFormatError, readPackEntries } from './kane/packArchive.js';

// Attribution is by **identifier**. The note is per failing step under
// `tests/<slug>/steps/<n-a-b>/failure.yaml` and the slug comes from the document's
// title, which §7.1 and §4.6 forbid inferring identity from; but the pack's own
// `tests/<slug>/result.yaml` carries `external_id.test_id`, the same UUID
// `testrun_member_end` reports. So a note is tied to a member by a UUID match, an
// archive that is not this run's execution is not read at all, and anything
// ambiguous is attributed to nobody — a signal on the wrong member would authorise
// an automatic source patch against a promise nobody tested.
export type {
  SealedPackFileSystem,
  SealedPackTriage,
  SealedPackTriageRequest,
  SealedTriageNote,
} from './kane/packTriage.js';
export {
  PACK_RESULT_FILENAME,
  PACK_TESTS_PREFIX,
  SEALED_PACK_SUFFIX,
  SEALED_TRIAGE_DIAGNOSTIC_CODES,
  SEALED_TRIAGE_DIAGNOSTIC_CODE_VALUES,
  nodeSealedPackFileSystem,
  readSealedPackTriage,
  sealedNoteFor,
  testIdFromResultManifest,
} from './kane/packTriage.js';

// The one condition on automatic repair — design §8.1.1, and the answer to the
// question §6.3's signal table cannot answer.
//
// `code-break` is the only branch that hands an agent a write path, and the only
// evidence of a product fault that survives to KEPT is the category in Kane's sealed
// triage note. That category cannot carry the distinction the branch needs, because
// **Kane treats the test document as the specification**: for the fixture's
// deliberately never-true discount claim it reports `application_issue/ui_data_defect`
// with a suggested fix that reads "check the cart's discount calculation" — correct on
// its own terms about a discount the cart never applies, and identical to the category
// it gives the genuinely broken `subtotal`. One token, two opposite meanings, and no
// third token meaning "the claim is false", because from where Kane stands the claim
// is the spec. Measured across three committed packs and six live runs, one unchanged
// failure has drawn four different answers.
//
// The discriminator KEPT has and Kane cannot is the promise's own **prior verdict**.
// `proven` means KEPT itself witnessed the behaviour, with a terminal event and a
// sealed pack behind it, so red is a regression and restoring it is exactly what
// `code-break` authorises. A promise never `proven` has no such witness: nothing
// established it worked, so nothing broke. **You cannot break what was never proven to
// work** — which is also the difference between an agent restoring a `subtotal` and an
// agent implementing a discount nobody designed.
//
// It is a *fence*, not a branch. The router keeps returning what R6.3, R6.4 and R6.5
// require, and the Ledger keeps publishing Kane's actual conclusion; what is withheld
// is autonomy, which is §8.1's own column. `fenceForResults` is the single site that
// decides it, so the condition cannot be forgotten by a second caller, and the row it
// returns only ever **narrows** — `allowedPaths` empties and nothing is added, so
// Property 26's containment holds more strictly than before.
export {
  AUTOMATIC_REPAIR_REQUIRES_VERDICT,
  UNPROVEN_CODE_BREAK_FENCE,
  fenceForResults,
  grantsAutomaticRepair,
} from './handoff/handoff.js';

// What Kane actually seals, and what a sync client leaves beside it (§4.6, R4.13).
//
// A pack is a single `<execution_id>.evidence` **archive file** — two to eleven
// megabytes of zip — not a directory. `listArtifacts` considered only directories, so
// the only packs it could ever see were leftover extractions and iCloud conflict
// copies, and every evidence reference the snapshot published was therefore cleared as
// a dead link. `apps/ledger/public/evidence/` stayed empty for the same reason.
//
// `isSyncConflictCopy` names the second half of that: iCloud Drive resolves a write
// collision by keeping both sides and appending a space and an ordinal, and the copy
// sorts *newest* because the sync wrote it last. Selecting it attributed a run's
// evidence to an id no archive is named after. It is rejected by name, because a
// conflict copy is a fact about the filesystem and the pack it shadows is still there
// under its real name.
//
// `ListArtifactsRequest.executionId` closes the third: `testrun_done` carries
// `execution_id` and Kane names the archive after it, so "this run's pack" is
// available where only "the newest pack present" was being used. A mismatch is
// diagnosed rather than silently accepted.
// `SEALED_PACK_SUFFIX` is already published above, from `kane/packTriage.ts`, which is
// the module that reads an archive; `kane/evidence.ts` imports it from there so the two
// cannot disagree about what a pack is called.
export { isSyncConflictCopy } from './kane/evidence.js';
