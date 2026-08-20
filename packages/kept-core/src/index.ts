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
