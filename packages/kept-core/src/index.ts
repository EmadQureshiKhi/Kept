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
