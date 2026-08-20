/**
 * `kept snapshot` — project `.kept/state.json` into the committed ledger file
 * (design §13.1, §9.2, R1.8, R4.14).
 *
 * The whole command is: load the state, build the snapshot, self-check it, write
 * the bytes. It invokes no Kane — the §13.1 table's `Kane invocation` column reads
 * `none` and its `Writes` column reads `snapshot only` — so it costs nothing, is
 * safe to run repeatedly, and is the thing `npm run build:snapshot` calls after
 * `kept build`.
 *
 * One decision is worth naming. When the assembled snapshot fails its own schema
 * check, this command **does not write** and **does not exit non-zero**. Not
 * writing is obvious: publishing a file the Ledger's build-time `parseSnapshot`
 * would reject just moves the failure somewhere less informative. Exiting zero is
 * the less obvious half, and it follows from §14.2 — the CLI's exit code reports
 * whether KEPT worked, and the honest report here is a printed `error` diagnostic
 * naming the offending field path, with the last good committed file still in
 * place. The Ledger build is where an invalid or missing snapshot fails loudly
 * (§14.1), and it still will.
 */

import type {
  CollectingDiagnosticSink,
  Diagnostic,
  KeptState,
  LedgerSnapshot,
  SnapshotAmendment,
  SnapshotEvidence,
  SnapshotReviewCard,
  SnapshotRun,
  StateFileSystem,
} from '@kept/core';
import { createDiagnosticSink, createStateStore, nodeStateFileSystem } from '@kept/core';

import { joinPath } from '../config.js';
import {
  SNAPSHOT_FILE_RELATIVE_PATH,
  buildSnapshot,
  writeSnapshot,
} from '../snapshot.js';

/** Diagnostic codes this command reports. Stable; the Ledger keys off them. */
export const SNAPSHOT_COMMAND_DIAGNOSTIC_CODES = Object.freeze({
  written: 'snapshot-written',
  unchanged: 'snapshot-unchanged',
  notWritten: 'snapshot-not-written',
} as const);

/** The codes as a list, so a test can enumerate them. */
export const SNAPSHOT_COMMAND_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(SNAPSHOT_COMMAND_DIAGNOSTIC_CODES),
);

/** {@link runSnapshot}'s input. Every seam has a production default. */
export interface SnapshotRequest {
  readonly repoRoot: string;
  /** State reads and snapshot writes. Defaults to the `node:fs` implementation. */
  readonly fileSystem?: StateFileSystem | undefined;
  /**
   * The state to project. Omit it and the command loads `.kept/state.json`, which
   * is the normal path; `kept build` passes the state it just wrote so the two
   * commands in `npm run build:snapshot` cannot disagree about what was built.
   */
  readonly state?: KeptState | undefined;
  readonly generatedAt?: string | undefined;
  readonly kaneCliVersion?: string | null | undefined;
  readonly evidence?: readonly SnapshotEvidence[] | undefined;
  readonly runs?: readonly SnapshotRun[] | undefined;
  readonly reviewCards?: readonly SnapshotReviewCard[] | undefined;
  readonly amendments?: readonly SnapshotAmendment[] | undefined;
  readonly diagnostics?: CollectingDiagnosticSink | undefined;
}

/** What {@link runSnapshot} did. */
export interface SnapshotResult {
  readonly snapshot: LedgerSnapshot;
  /** Absolute path of the committed snapshot file. */
  readonly path: string;
  /** True when the bytes were written. False when invalid, or already identical. */
  readonly written: boolean;
  /** False when the self-check rejected the snapshot; `error` names the field. */
  readonly valid: boolean;
  readonly error: string | null;
  readonly bytes: number;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Write the committed snapshot. Never throws for any state of the world,
 * including an absent or corrupt `.kept/state.json` — the state store answers an
 * empty state plus a diagnostic for both, and an empty graph is a perfectly valid
 * snapshot whose two coverage figures are `null` (R9.3).
 */
export function runSnapshot(request: SnapshotRequest): SnapshotResult {
  const sink = request.diagnostics ?? createDiagnosticSink();
  // One filesystem for both the state read and the snapshot write, so a test that
  // seeds a state file sees the snapshot land in the same map.
  const fileSystem = request.fileSystem ?? nodeStateFileSystem();
  const store = createStateStore({ repoRoot: request.repoRoot, fileSystem, sink });
  const state = request.state ?? store.load();

  const built = buildSnapshot({
    state,
    diagnostics: sink,
    ...(request.generatedAt === undefined ? {} : { generatedAt: request.generatedAt }),
    ...(request.kaneCliVersion === undefined ? {} : { kaneCliVersion: request.kaneCliVersion }),
    ...(request.evidence === undefined ? {} : { evidence: request.evidence }),
    ...(request.runs === undefined ? {} : { runs: request.runs }),
    ...(request.reviewCards === undefined ? {} : { reviewCards: request.reviewCards }),
    ...(request.amendments === undefined ? {} : { amendments: request.amendments }),
  });

  if (!built.valid) {
    sink.report({
      code: SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.notWritten,
      severity: 'error',
      message:
        `The snapshot was not written because it failed its own schema check; the previously ` +
        `committed file stands. ${built.error ?? 'no reason reported'}`,
    });
    return {
      snapshot: built.snapshot,
      path: joinPath(request.repoRoot, SNAPSHOT_FILE_RELATIVE_PATH),
      written: false,
      valid: false,
      error: built.error,
      bytes: 0,
      diagnostics: sink.entries,
    };
  }

  const write = writeSnapshot({ repoRoot: request.repoRoot, text: built.text, fileSystem });
  sink.report({
    code: write.changed
      ? SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.written
      : SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.unchanged,
    severity: 'info',
    message: write.changed
      ? `kept snapshot: wrote ${write.bytes} bytes carrying ` +
        `${built.snapshot.promises.length} promise` +
        `${built.snapshot.promises.length === 1 ? '' : 's'}`
      : `kept snapshot: the committed file is already byte-identical, so nothing was written`,
  });

  return {
    snapshot: built.snapshot,
    path: write.path,
    written: write.changed,
    valid: true,
    error: null,
    bytes: write.bytes,
    diagnostics: sink.entries,
  };
}
