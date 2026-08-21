/**
 * `kept snapshot` — assembling and writing `apps/ledger/data/ledger.snapshot.json`
 * (design §9.1, §9.2, §9.3, R1.8, R4.14, R8.8).
 *
 * This is the CLI↔UI seam, and the whole judge story: the file is **committed**,
 * so the deployed Ledger needs no Kane, no Chrome, no credentials and no network.
 * Everything a judge sees is a projection of these bytes.
 *
 * The assembly is a projection too — of `.kept/state.json`. Nothing is invented
 * here:
 *
 * - `promises`, `edges`, `degraded`, `degradedReasons` and the graph diagnostics
 *   come from `state.graph`;
 * - `freshness` comes from `state.freshness`, which only the write guard of
 *   `state.ts` can move (§4.8), so a crashed or paused run cannot advance the
 *   freshness chip by going through this module;
 * - `metrics` is `computeMetrics(state.graph)`, which withholds `provenCoverage`
 *   while degraded rather than reporting zero (R2.11) and performs no division on
 *   an empty graph (R9.3);
 * - `documents` is derived from the citations (`graph.ts`).
 *
 * The one judgement this module makes is about **references it cannot resolve**.
 * §9.1 rule 3 requires every `evidencePackId` and every `repair.evidenceRef` to
 * name a pack the snapshot carries, and rule 4 requires every edge endpoint to be
 * a node it declares. A pack becomes a node only once it has been copied under
 * `apps/ledger/public/evidence/` — so between a verification run and the copy step
 * there is a real state of the world where the graph holds a reference the
 * snapshot cannot honour. Writing it anyway would fail the Ledger build; dropping
 * it quietly would put a dead link in front of a judge. So the reference is
 * cleared **and diagnosed**, with the pack id in the message, and the diagnostic
 * rides in the snapshot's own `diagnostics` array where `/runs` renders it.
 *
 * `serialiseSnapshot` is the only writer, and {@link buildSnapshot} hands its
 * output straight back through `parseSnapshot` before anything touches disk. That
 * self-check is cheap and it is the difference between "the Ledger build fails
 * naming a field" and "the CLI told you which field, before the file existed".
 */

import type {
  CollectingDiagnosticSink,
  Diagnostic,
  DiagnosticSink,
  KeptState,
  LedgerSnapshot,
  SnapshotAmendment,
  SnapshotEvidence,
  SnapshotPromise,
  SnapshotReviewCard,
  SnapshotRun,
  StateFileSystem,
} from '@kept/core';
import {
  MAX_SNAPSHOT_RUNS,
  SNAPSHOT_SCHEMA_VERSION,
  computeMetrics,
  createDiagnosticSink,
  designedTestId,
  evidencePackIdFromRef,
  isNodeId,
  parseSnapshot,
  serialiseSnapshot,
} from '@kept/core';

import { joinPath } from './config.js';
import { deriveDocuments } from './graph.js';
import { KEPT_VERSION } from './version.js';

/** The committed snapshot's path, relative to the repository root. */
export const SNAPSHOT_FILE_RELATIVE_PATH = 'apps/ledger/data/ledger.snapshot.json';

/** Diagnostic codes this module reports. Stable; the Ledger keys off them. */
export const SNAPSHOT_DIAGNOSTIC_CODES = Object.freeze({
  evidenceUnresolved: 'snapshot-evidence-unresolved',
  repairEvidenceUnresolved: 'snapshot-repair-evidence-unresolved',
  edgeUnresolved: 'snapshot-edge-unresolved',
  runsTruncated: 'snapshot-runs-truncated',
  invalid: 'snapshot-invalid',
} as const);

/** The codes as a list, so a test can enumerate them. */
export const SNAPSHOT_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(SNAPSHOT_DIAGNOSTIC_CODES),
);

/** {@link buildSnapshot}'s input. */
export interface BuildSnapshotRequest {
  readonly state: KeptState;
  /** ISO 8601 instant. Defaults to now; a test passes a fixed one. */
  readonly generatedAt?: string | undefined;
  /** `kane-cli --version`, when the caller has probed it. `kept doctor` does. */
  readonly kaneCliVersion?: string | null | undefined;
  /**
   * Sealed packs already committed under `apps/ledger/public/evidence/`. Every
   * evidence reference the graph carries is resolved against this list.
   */
  readonly evidence?: readonly SnapshotEvidence[] | undefined;
  /** Newest first. Capped at {@link MAX_SNAPSHOT_RUNS} with a diagnostic. */
  readonly runs?: readonly SnapshotRun[] | undefined;
  readonly reviewCards?: readonly SnapshotReviewCard[] | undefined;
  readonly amendments?: readonly SnapshotAmendment[] | undefined;
  readonly diagnostics?: DiagnosticSink | undefined;
}

/** What {@link buildSnapshot} answers. */
export interface BuildSnapshotResult {
  /** The snapshot, already through `parseSnapshot` when `valid` is true. */
  readonly snapshot: LedgerSnapshot;
  /** The canonical bytes, ready to write. */
  readonly text: string;
  /** False when the self-check rejected it; `error` then names the field path. */
  readonly valid: boolean;
  /** The self-check's message, field path included, or null. */
  readonly error: string | null;
  /** Only what this module recorded, in report order. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Project a state into a snapshot, and check the result against the schema.
 *
 * Never throws. A snapshot this module could not make valid comes back with
 * `valid: false` and the field path in `error`, because a caller's right response
 * is to report and leave the last good file in place — not to crash a hook.
 */
export function buildSnapshot(request: BuildSnapshotRequest): BuildSnapshotResult {
  const sink: CollectingDiagnosticSink = createDiagnosticSink();
  const report = (draft: Parameters<DiagnosticSink['report']>[0]): Diagnostic => {
    const diagnostic = sink.report(draft);
    request.diagnostics?.report({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      file: diagnostic.file,
      line: diagnostic.line,
    });
    return diagnostic;
  };

  const { graph } = request.state;
  const evidence = request.evidence ?? [];
  const packs = new Set(evidence.map((pack) => pack.id));
  const documents = deriveDocuments(graph.promises);

  // ── promises, with unresolvable evidence references cleared and named ──────
  const promises: SnapshotPromise[] = graph.promises.map((promise) => {
    let evidencePackId = promise.evidencePackId;
    if (evidencePackId !== null && !packs.has(evidencePackId)) {
      report({
        code: SNAPSHOT_DIAGNOSTIC_CODES.evidenceUnresolved,
        severity: 'warn',
        message:
          `Promise '${promise.id}' references evidence pack '${evidencePackId}', which is not ` +
          `committed under apps/ledger/public/evidence/, so the reference was cleared rather ` +
          `than published as a dead link.`,
        file: promise.citation.file,
        line: promise.citation.line,
      });
      evidencePackId = null;
    }

    let repair = promise.repair;
    if (repair !== null && repair.evidenceRef !== null) {
      const packId = evidencePackIdFromRef(repair.evidenceRef);
      if (packId === null || !packs.has(packId)) {
        report({
          code: SNAPSHOT_DIAGNOSTIC_CODES.repairEvidenceUnresolved,
          severity: 'warn',
          message:
            `Promise '${promise.id}' has a repair annotation referencing ` +
            `'${repair.evidenceRef}', which resolves to ` +
            `${packId === null ? 'no evidence pack' : `pack '${packId}'`} in this snapshot, so ` +
            `the reference was cleared.`,
          file: promise.citation.file,
          line: promise.citation.line,
        });
        repair = { ...repair, evidenceRef: null };
      }
    }

    return {
      id: promise.id,
      claim: promise.claim,
      citation: { ...promise.citation },
      designedTest: promise.designedTest === null ? null : { ...promise.designedTest },
      verdict: promise.verdict,
      verdictSource: promise.verdictSource === null ? null : { ...promise.verdictSource },
      repair,
      evidencePackId,
      providers: [...promise.providers],
      credits: promise.credits,
    };
  });

  // ── edges, with endpoints checked against the nodes this snapshot declares ─
  const nodes = new Set<string>([
    ...promises.map((promise) => promise.id),
    ...documents.map((document) => document.id),
    ...packs,
  ]);
  for (const promise of promises) {
    // The same derivation the schema's own endpoint rule performs, so the node set
    // this module checks against and the one the schema builds cannot disagree.
    if (promise.designedTest !== null) nodes.add(designedTestId(promise.designedTest.path));
  }
  const edges = graph.edges.filter((edge) => {
    const bad = ([edge.from, edge.to] as const).filter(
      (end) => !isNodeId(end) || !nodes.has(end),
    );
    if (bad.length === 0) return true;
    report({
      code: SNAPSHOT_DIAGNOSTIC_CODES.edgeUnresolved,
      severity: 'warn',
      message:
        `The '${edge.kind}' edge ${edge.from} → ${edge.to} names ` +
        `${bad.map((end) => `'${end}'`).join(' and ')}, which this snapshot declares no node ` +
        `for, so the edge was dropped rather than published as an edge to nothing.`,
      file: null,
    });
    return false;
  });

  // ── runs, under the same rule-3 clearing the promises just went through ────
  //
  // A run entry names the pack the invocation sealed, and that id arrives from
  // Kane: on this machine it is `a1039478-… 2.evidence`, an iCloud duplicate with a
  // literal space, which is neither committed nor even spellable as a snapshot
  // evidence id. Clearing it here rather than at the schema is deliberate — the
  // rule that catches a dead link should be the rule that reports it, and a run
  // whose pack was not curated is still a terminal event worth publishing.
  const allRuns = (request.runs ?? []).map((run) => {
    if (run.evidencePackId === null || packs.has(run.evidencePackId)) return run;
    report({
      code: SNAPSHOT_DIAGNOSTIC_CODES.evidenceUnresolved,
      severity: 'warn',
      message:
        `Run '${run.id}' references evidence pack '${run.evidencePackId}', which is not ` +
        `committed under apps/ledger/public/evidence/, so the reference was cleared rather ` +
        `than published as a dead link.`,
      file: null,
    });
    return { ...run, evidencePackId: null };
  });
  const runs = allRuns.slice(0, MAX_SNAPSHOT_RUNS);

  // ── amendments and review cards, under the same rule ──────────────────────
  //
  // An amendment carries the evidence reference the router settled the branch
  // from, and a review card carries one too. Neither is exempt from rule 3: a
  // reference nothing committed is a link a judge clicks and lands nowhere, and the
  // rest of the record — the diff, the rationale, the interlock — is unaffected by
  // clearing it.
  const clearRef = <T extends { readonly id: string; readonly evidenceRef: string | null }>(
    entry: T,
    kind: string,
  ): T => {
    if (entry.evidenceRef === null) return entry;
    const packId = evidencePackIdFromRef(entry.evidenceRef);
    if (packId !== null && packs.has(packId)) return entry;
    report({
      code: SNAPSHOT_DIAGNOSTIC_CODES.repairEvidenceUnresolved,
      severity: 'warn',
      message:
        `${kind} '${entry.id}' references '${entry.evidenceRef}', which resolves to ` +
        `${packId === null ? 'no evidence pack' : `pack '${packId}'`} in this snapshot, so the ` +
        `reference was cleared rather than published as a dead link.`,
      file: null,
    });
    return { ...entry, evidenceRef: null };
  };
  const amendments = (request.amendments ?? []).map((amendment) =>
    clearRef(amendment, 'Amendment'),
  );
  const reviewCards = (request.reviewCards ?? []).map((card) => clearRef(card, 'Review card'));
  if (allRuns.length > runs.length) {
    report({
      code: SNAPSHOT_DIAGNOSTIC_CODES.runsTruncated,
      severity: 'info',
      message:
        `${allRuns.length} runs were offered and the committed file carries the newest ` +
        `${MAX_SNAPSHOT_RUNS} (design §9.1), so ${allRuns.length - runs.length} were dropped.`,
      file: null,
    });
  }

  const snapshot: LedgerSnapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: request.generatedAt ?? new Date().toISOString(),
    generator: { kept: KEPT_VERSION, kaneCli: request.kaneCliVersion ?? null },
    degraded: graph.degraded,
    degradedReasons: [...graph.degradedReasons],
    freshness: { ...request.state.freshness },
    metrics: computeMetrics(graph),
    promises,
    edges: edges.map((edge) => ({ ...edge })),
    documents: [...documents],
    evidence: [...evidence],
    runs: [...runs],
    reviewCards,
    amendments,
    // The graph's own diagnostics first — they happened first — then this
    // module's, so `/runs` reads in the order the build discovered things.
    diagnostics: [...graph.diagnostics, ...sink.entries],
  };

  const text = serialiseSnapshot(snapshot);
  try {
    // The self-check. `parseSnapshot` runs all five cross-field rules and throws
    // naming the path (R8.8), which is exactly the message a caller should print.
    parseSnapshot(text);
    return { snapshot, text, valid: true, error: null, diagnostics: sink.entries };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report({
      code: SNAPSHOT_DIAGNOSTIC_CODES.invalid,
      severity: 'error',
      message:
        `The assembled snapshot does not satisfy the schema, so it was not written and the ` +
        `previously committed file stands: ${message}`,
      file: SNAPSHOT_FILE_RELATIVE_PATH,
    });
    return { snapshot, text, valid: false, error: message, diagnostics: sink.entries };
  }
}

/** {@link writeSnapshot}'s input. */
export interface WriteSnapshotRequest {
  readonly repoRoot: string;
  readonly text: string;
  readonly fileSystem: StateFileSystem;
}

/** What {@link writeSnapshot} wrote. */
export interface WriteSnapshotResult {
  readonly path: string;
  readonly bytes: number;
  /** False when the bytes already on disk were identical, so nothing was written. */
  readonly changed: boolean;
}

/**
 * Write the canonical bytes, creating `apps/ledger/data/` if needed.
 *
 * Skips the write when the file is already byte-identical. That is not an
 * optimisation: the snapshot is committed, and rewriting identical bytes would
 * touch the file's mtime, which is what a `next dev` watcher rebuilds on.
 */
export function writeSnapshot(request: WriteSnapshotRequest): WriteSnapshotResult {
  const path = joinPath(request.repoRoot, SNAPSHOT_FILE_RELATIVE_PATH);
  const existing = request.fileSystem.readFile(path);
  const bytes = Buffer.byteLength(request.text, 'utf8');
  if (existing === request.text) return { path, bytes, changed: false };
  request.fileSystem.ensureDir(path.slice(0, path.lastIndexOf('/')));
  request.fileSystem.writeFile(path, request.text);
  return { path, bytes, changed: true };
}
