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
