/**
 * Types for `scripts/check-readonly.mjs`.
 *
 * The scan is JavaScript because it is the first step of `npm run check` and
 * therefore has to run before `tsc` does — a guard that needs a build to exist
 * cannot fail a broken build. This hand-written declaration is how its rule table
 * stays type-checked where it is consumed from TypeScript:
 * `apps/ledger/test/read-only-scan.test.ts`, which `tsc -b` compiles under the
 * repository's strict settings.
 *
 * `ScannedSource` is declared structurally identical to `ScannedFile` in
 * `apps/ledger/test/_scan.ts` on purpose, so the wrapper can feed the shared
 * walk's output straight into these rules without an adapter.
 */

/** A file as both the shared walk and this script's own walk produce it. */
export interface ScannedSource {
  /** Repo-relative, forward-slashed. */
  readonly path: string;
  readonly text: string;
  readonly lines: readonly string[];
}

/** One rule firing on one line. */
export interface Finding {
  /** The rule's id, e.g. `subprocess-import`. */
  readonly rule: string;
  /** 1-based. */
  readonly line: number;
  /** The offending line, trimmed, or a short description for a file-level rule. */
  readonly excerpt: string;
}

/** A finding with the file and the rule's prose attached. */
export interface Violation extends Finding {
  readonly path: string;
  readonly title: string;
  readonly why: string;
}

/** One clause of the read-only guarantee. */
export interface ReadOnlyRule {
  readonly id: string;
  /** Verb phrase completing "this file …". */
  readonly title: string;
  /** Which requirement it serves, and why the requirement exists. */
  readonly why: string;
  find(file: ScannedSource): Finding[];
}

export declare const REPO_ROOT: string;
export declare const LEDGER_ROOT: string;
export declare const EXCLUDED_PREFIX: string;
export declare const CODE_EXTENSIONS: readonly string[];
export declare const INVOKER_EXPORTS: readonly string[];
export declare const RULES: readonly ReadOnlyRule[];

export declare function collectLedgerFiles(): ScannedSource[];
export declare function findViolations(files: readonly ScannedSource[]): Violation[];
export declare function formatViolations(findings: readonly Violation[]): string;
