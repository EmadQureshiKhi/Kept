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
} from 'kept-core';
import {
  MAX_SNAPSHOT_RUNS,
  SNAPSHOT_SCHEMA_VERSION,
  computeMetrics,
  createDiagnosticSink,
  designedTestId,
  SEALED_PACK_SUFFIX,
  evidenceId,
  evidencePackIdFromRef,
  isNodeId,
  parseSnapshot,
  serialiseSnapshot,
} from 'kept-core';

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
  /**
   * `kane-cli --version`, when the caller has probed it. **No command passes it
   * today, so `generator.kaneCli` is `null` in every committed snapshot.**
   *
   * The comment here used to read "`kept doctor` does", and that was false in the
   * way this repository has learned to watch for: `kept doctor` really is the one
   * command that probes the version (`probeKane`, R18.2), and it does not call
   * `runSnapshot` at all. It writes a handoff and nothing else (R18.10). All six
   * `runSnapshot` call sites omit this field, so the value can only ever be the
   * `?? null` default, and the comment named a caller that does not exist. That is
   * the shape `listReviewCards` had at task 22.2, minus the user impact: nothing in
   * the Ledger renders `generator.kaneCli`, so a null here misleads no reader.
   *
   * **Why it was left as a correction rather than wired up.** `kept snapshot` is
   * documented throughout as needing no Kane, no Chrome and no network (§13.1's
   * invocation column reads `none`), so this command must not grow a probe. The
   * version would therefore have to arrive through `.kept/state.json`, written by a
   * command that already spawns Kane. `kept build` is that command, and the route is
   * not cheap: the one stream it consumes, `cover gaps --json --mode agent`, carries
   * no version anywhere in the Assurance envelope, so build would need a **second
   * spawn** purely for `--version`. That contradicts the published invocation tables
   * in the README and design §13.1, which give `kept build` exactly one invocation,
   * and it buys a field nothing renders. So the honest fix was the comment.
   *
   * The seam stays, because it is how the value would arrive if that changed: read
   * the version off the state in `runSnapshot` and pass it here. What would have to
   * land first is a persisted field on {@link KeptState}, tolerant of a state file
   * written before it existed, and a decision about whether a version probed by an
   * earlier command may be published as the generator of this snapshot.
   */
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

  /**
   * The node id a graph pack reference resolves to.
   *
   * The graph carries **Kane's** name for a pack — a bare `execution_id` with a
   * `.evidence` suffix — and the snapshot's node ids are `ev_`-prefixed by §9.1's
   * `evidenceIdField`, because the Ledger lanes a node by its prefix. Comparing the
   * two spellings directly matched nothing, so every reference in this projection
   * was cleared as a dead link on a repository whose archives were on disk and
   * whose curated artefacts had just been written. `evidenceId` is the one minter,
   * and it is idempotent, so an id that is already a node id passes through.
   */
  const nodeIdOf = (packId: string): string => evidenceId(packId);

  // `evidencePackIdFromRef` now recognises both spellings — the `ev_` segment a
  // snapshot-minted reference carries, and the sealed `<execution_id>.evidence`
  // segment the router writes — and returns the node id either way. One function,
  // in core, used by this projection and by the schema's own rule, so the rule that
  // rejects a reference and the code that clears one cannot disagree.
  const packIdFromEvidenceRef = evidencePackIdFromRef;

  // ── promises, with unresolvable evidence references cleared and named ──────
  const promises: SnapshotPromise[] = graph.promises.map((promise) => {
    let evidencePackId = promise.evidencePackId === null ? null : nodeIdOf(promise.evidencePackId);
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
      const packId = packIdFromEvidenceRef(repair.evidenceRef);
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
  const edges = graph.edges.flatMap((edge) => {
    // An `evidence` edge's `to` endpoint is Kane's own pack name, because that is
    // what the graph records; the node this snapshot declares is the minted `ev_`
    // id. Mapping the endpoint is the same correction the promise, run and
    // amendment projections make, and without it every evidence edge was dropped
    // as "an edge to nothing" — on a snapshot that had just published the node.
    const to = edge.kind === 'evidence' ? nodeIdOf(edge.to) : edge.to;
    const mapped = to === edge.to ? edge : { ...edge, to };
    const bad = ([mapped.from, mapped.to] as const).filter(
      (end) => !isNodeId(end) || !nodes.has(end),
    );
    if (bad.length === 0) return [mapped];
    report({
      code: SNAPSHOT_DIAGNOSTIC_CODES.edgeUnresolved,
      severity: 'warn',
      message:
        `The '${edge.kind}' edge ${edge.from} → ${edge.to} names ` +
        `${bad.map((end) => `'${end}'`).join(' and ')}, which this snapshot declares no node ` +
        `for, so the edge was dropped rather than published as an edge to nothing.`,
      file: null,
    });
    return [];
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
    if (run.evidencePackId === null) return run;
    const nodeId = nodeIdOf(run.evidencePackId);
    if (packs.has(nodeId)) return { ...run, evidencePackId: nodeId };
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
  /**
   * The newest runs, **plus every run a promise names as its verdict source**.
   *
   * This used to be `allRuns.slice(0, MAX_SNAPSHOT_RUNS)`, and that dropped a run six
   * promises were citing. The log grew past the cap for the first time at task 22.2,
   * and `108dbb62`, the whole-suite replay that earned six of the seven proven
   * verdicts, fell off the end of it. Every one of those promises went on carrying
   * `verdictSource.runId: '108dbb62…'` while `/runs` no longer listed the run and the
   * row a reader clicked through to did not exist.
   *
   * That is the same fault the evidence rules of §9.1 already refuse in three other
   * places: a reference to something the snapshot does not carry is worse than an
   * absent reference, because the absent one is honest and the dangling one looks
   * like a bug in the page. A verdict whose provenance cannot be opened is not a
   * traceable verdict, and traceability is the point of recording the run id at all.
   *
   * So the cap is a cap on *history*, not on provenance. Cited runs are kept
   * unconditionally, even if they alone exceed the cap: a longer committed file is a
   * cost, and an unopenable verdict is a lie. The remaining places go to the newest
   * uncited runs, and the order the caller gave is preserved so the log still reads
   * newest first.
   */
  const citedRunIds = new Set(
    graph.promises
      .map((promise) => promise.verdictSource?.runId)
      .filter((id): id is string => typeof id === 'string' && id !== ''),
  );
  const cited = allRuns.filter((run) => citedRunIds.has(run.id));
  const uncited = allRuns.filter((run) => !citedRunIds.has(run.id));
  const keep = new Set([
    ...cited.map((run) => run.id),
    ...uncited.slice(0, Math.max(0, MAX_SNAPSHOT_RUNS - cited.length)).map((run) => run.id),
  ]);
  const runs = allRuns.filter((run) => keep.has(run.id));

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
    const packId = packIdFromEvidenceRef(entry.evidenceRef);
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
        `${allRuns.length} runs were offered and the committed file carries ${runs.length} ` +
        `(design §9.1): the newest up to ${MAX_SNAPSHOT_RUNS}, plus every run a promise ` +
        `names as its verdict source, so ${allRuns.length - runs.length} were dropped. ` +
        `${cited.length} run(s) were retained as cited provenance regardless of age, ` +
        `because a verdict pointing at a run this file does not carry cannot be opened.`,
      file: null,
    });
  }

  const snapshot: LedgerSnapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: request.generatedAt ?? new Date().toISOString(),
    // `kaneCli` is `null` in every snapshot this repository has written, because no
    // caller passes the version. See {@link BuildSnapshotRequest.kaneCliVersion} for
    // why that is a documented gap rather than a probe waiting to be added here.
    generator: { kept: KEPT_VERSION, kaneCli: request.kaneCliVersion ?? null },
    degraded: graph.degraded,
    degradedReasons: [...graph.degradedReasons],
    freshness: { ...request.state.freshness },
    metrics: computeMetrics(graph),
    // R9.14: recorded in the committed file so the shareable page renders both axes
    // with Kane invoked zero times. Withheld, `null`, never an empty ribbon,
    // whenever the graph is degraded, which is the schema's own rule 6 and which
    // this projection satisfies by construction rather than by trusting the state:
    // a degraded build already cleared the field, and clearing it again here means
    // a hand-edited state file cannot publish axes the graph does not support.
    coverageAxes: graph.degraded ? null : coverageAxesOf(request.state),
    promises,
    edges: edges.map((edge) => ({ ...edge })),
    documents: [...documents],
    evidence: [...evidence],
    runs: [...runs],
    reviewCards,
    amendments,
    // The graph's own diagnostics first, they happened first, then this
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

/**
 * The axes the state carries, in the snapshot's own shape, or null.
 *
 * A projection rather than a pass-through, and the reason is `undefined`: a state
 * file written before the field existed has no key, the canonical serialiser throws
 * on an `undefined` value (§9.2), and `?? null` at the one place the value enters
 * the snapshot is cheaper than a migration. The shape is otherwise identical, the
 * core projection already produced the field names the schema declares, so this
 * copies rather than converts, and every array is copied so the snapshot cannot
 * share a frozen structure with the state.
 */
function coverageAxesOf(state: KeptState): LedgerSnapshot['coverageAxes'] {
  const axes = state.coverageAxes ?? null;
  if (axes === null || axes.rows.length === 0) return null;
  return {
    designCompleteness: {
      pct: axes.designCompleteness.pct,
      ratio: { ...axes.designCompleteness.ratio },
      usecasesComplete: { ...axes.designCompleteness.usecasesComplete },
      ucsNeedingScenarios: axes.designCompleteness.ucsNeedingScenarios,
    },
    proven: {
      pct: axes.proven.pct,
      ratio: { ...axes.proven.ratio },
      failing: axes.proven.failing,
      blocked: axes.proven.blocked,
      notRun: axes.proven.notRun,
      latestRunExecutionId: axes.proven.latestRunExecutionId,
      source: axes.proven.source,
      denominatorBasis: axes.proven.denominatorBasis,
    },
    rows: axes.rows.map((row) => ({
      id: row.id,
      title: row.title,
      risk: row.risk,
      riskRank: row.riskRank,
      designCompleteness: { ...row.designCompleteness },
      proven: { ...row.proven },
      staleAcs: row.staleAcs,
      pending: row.pending.map((item) => ({ ...item })),
    })),
  };
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
