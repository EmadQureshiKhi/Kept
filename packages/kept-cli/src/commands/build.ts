/**
 * `kept build` — both providers, one canonical graph, one state file
 * (design §5.4, §13.1, §14.1, R2.10, R2.12).
 *
 * Six steps, and the order is the design's:
 *
 * 1. **baseline** (`providers/baseline.ts`) scans `**\/*_test.md` and produces
 *    candidates. It cannot fail — `BaselineResult` types `ok` as the literal
 *    `true` — which is what makes the rest of this function safe to write without
 *    a fallback path for "no promises could be found at all".
 * 2. **targets** are derived from those candidates, so the coverage payload can
 *    be keyed to promises by the ids the records will actually have.
 * 3. **enrichment** (`providers/enrichment.ts`) invokes `cover --json` under the
 *    Assurance family with the budget from `.kept/config.json`. Absence, refusal,
 *    pause, crash and timeout all arrive as `ok: false` with their own
 *    `degradedReason` — never as a throw, never as a non-zero exit from `kept`.
 * 4. **merge** (`providers/merge.ts`) runs the citation gate over baseline's
 *    candidates, unions in enrichment's axes, defaults undesigned promises, and
 *    sets `degraded` from enrichment alone.
 * 5. **edges** are derived from the merged promises and the graph is rebuilt
 *    through `createPromiseGraph`, which is the single authority on canonical
 *    order.
 * 6. **state** is written through `state.ts` — the single write guard — and only
 *    through it.
 *
 * Step 6 is the one worth being explicit about. `kept build` does not write
 * verdicts: the enrichment provider's coverage overlays are applied by the merge,
 * behind that provider's own four-clause acceptance gate (§5.3). What this command
 * *can* move is **freshness**, because a `cover` run whose axes were accepted is a
 * terminal event consumed into the graph — which is what the Freshness_Timestamp
 * is defined as (R9.6). So the triple is moved by handing that invocation's
 * outcome to `applyRun` with an empty write list, and by nothing else.
 *
 * Two conditions gate it, and both are load-bearing. `applyRun`'s own guard is the
 * necessary one: a crashed stream, a pause, a timeout or a force-interrupt returns
 * the prior state **by reference**, so the prior freshness stands by construction
 * rather than by an `if`. Enrichment *acceptance* is the additional one, and it is
 * narrower on purpose — a `cover` refusal is a **complete** stream (§5.3.1) whose
 * exit reads as `failure`, so the guard alone would authorise the move, and taking
 * it would advance the Ledger's "last verified" chip for a run that verified
 * nothing. §14.1 counts `freshness.terminalEventAt` among the things its refusal
 * rows leave unchanged, and this is where that is honoured.
 *
 * The command's exit code is not a function of any of this. `degraded: true` with
 * `degradedReason: assurance-status:refused` — the honest state of a repository
 * with no `.context/` store — exits 0 (R2.10), and so does a missing `kane-cli`
 * (R2.12).
 */

import type {
  BaselineFileSystem,
  CitationSource,
  CollectingDiagnosticSink,
  Diagnostic,
  ExitMeaning,
  KaneInvoker,
  KeptState,
  MergeResult,
  ParsedStream,
  ProviderResult,
  RunOutcome,
  StateFileSystem,
  WriteRefusalReason,
} from '@kept/core';
import {
  collectBaseline,
  createDiagnosticSink,
  createEnrichmentProvider,
  createKeptState,
  createPromiseGraph,
  createStateStore,
  enrichmentTargetsFromCandidates,
  isExitMeaning,
  mergeGraph,
} from '@kept/core';

import type { KeptConfig } from '../config.js';
import { deriveEdges } from '../graph.js';

/** The synthetic run id used when Kane reported none of its own. */
export const SYNTHETIC_RUN_ID_PREFIX = 'kept-build:';

/** Diagnostic codes this command reports. Stable; the Ledger keys off them. */
export const BUILD_DIAGNOSTIC_CODES = Object.freeze({
  started: 'build-started',
  completed: 'build-completed',
  freshnessHeld: 'build-freshness-held',
} as const);

/** The codes as a list, so a test can enumerate them. */
export const BUILD_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(BUILD_DIAGNOSTIC_CODES),
);

/** {@link runBuild}'s input. Every seam has a production default. */
export interface BuildRequest {
  /** Absolute repository root. `process.cwd()` is never substituted downstream. */
  readonly repoRoot: string;
  readonly config: KeptConfig;
  /** The Kane process boundary. Omit it and enrichment reports `kane-not-found`. */
  readonly invoker?: KaneInvoker | undefined;
  /** State file reads and writes. Defaults to the `node:fs` implementation. */
  readonly fileSystem?: StateFileSystem | undefined;
  /** The `*_test.md` walk. Defaults to `nodeBaselineFileSystem(repoRoot)`. */
  readonly baselineFileSystem?: BaselineFileSystem | undefined;
  /**
   * Cited-document reads, shared between the baseline scan and the admission
   * gate so the derived claim and the admitted citation text came from the same
   * bytes (§5.2).
   */
  readonly citations?: CitationSource | undefined;
  /** Where every provider, the gate and the merge report. */
  readonly diagnostics?: CollectingDiagnosticSink | undefined;
  /** ISO 8601 instant for the state's `updatedAt`. Defaults to now. */
  readonly at?: string | undefined;
}

/** What {@link runBuild} did. */
export interface BuildResult {
  /** The state as written — or, on a refused freshness move, as it stood. */
  readonly state: KeptState;
  /** Absolute path of the state file. */
  readonly statePath: string;
  readonly baseline: ProviderResult;
  readonly enrichment: ProviderResult;
  readonly merge: MergeResult;
  /** `!enrichment.ok`, and nothing else (§5.4 step 5). */
  readonly degraded: boolean;
  readonly degradedReasons: readonly string[];
  /** True when the `cover` outcome was proven and freshness advanced. */
  readonly freshnessMoved: boolean;
  /** Why the freshness move was refused, when it was. Empty when it moved. */
  readonly freshnessRefusals: readonly WriteRefusalReason[];
  /** Everything every step reported, in order. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Kane's own `run_id` for a completed Assurance stream, or null.
 *
 * Read through the event's index signature because `run_id` is not a declared
 * field of the `done` envelope — §5.3.1's verified capture carries
 * `{ type, v, verb, status, exit_code, message }` and nothing else — and an
 * invented field name would be a claim about the wire this repository has not
 * observed.
 */
function kaneRunId(stream: ParsedStream<'Assurance'>): string | null {
  if (stream.kind !== 'complete') return null;
  const value = (stream.terminal as Record<string, unknown>)['run_id'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Run the build.
 *
 * Never throws for any state of the world: no `*_test.md` files, no `kane-cli` on
 * `PATH`, no `.context/` store, an unreadable state file, a `cover` run that
 * paused. Every one of those is a `degradedReason` or a diagnostic, and the state
 * file is written in all of them.
 */
export async function runBuild(request: BuildRequest): Promise<BuildResult> {
  const sink = request.diagnostics ?? createDiagnosticSink();
  const at = request.at ?? new Date().toISOString();

  const store = createStateStore({
    repoRoot: request.repoRoot,
    ...(request.fileSystem === undefined ? {} : { fileSystem: request.fileSystem }),
    sink,
  });
  const prior = store.load();

  sink.report({
    code: BUILD_DIAGNOSTIC_CODES.started,
    severity: 'info',
    message:
      `kept build: baseline scan over ${request.repoRoot}, enrichment budget ` +
      `${request.config.timeouts.enrichmentMs} ms, router '${request.config.verdictRouter}'`,
  });

  // ── 1. Baseline. Infallible by type (§5.2, R2.4). ──────────────────────────
  // `collectBaseline` rather than `baselineProvider.collect`, because the shared
  // `PromiseAdapter` context has no `citations` field and passing the *same*
  // `CitationSource` to the scan and to the gate is what guarantees the derived
  // claim and the admitted citation text came from the same bytes (§5.2).
  const baseline = await collectBaseline({
    repoRoot: request.repoRoot,
    diagnostics: sink,
    ...(request.citations === undefined ? {} : { citations: request.citations }),
    ...(request.baselineFileSystem === undefined ? {} : { fs: request.baselineFileSystem }),
  });

  // ── 2 and 3. Enrichment, keyed to what baseline found. ────────────────────
  const enrichment = await createEnrichmentProvider({
    timeoutMs: request.config.timeouts.enrichmentMs,
    targets: enrichmentTargetsFromCandidates(baseline.candidates),
  }).collect({
    repoRoot: request.repoRoot,
    diagnostics: sink,
    ...(request.invoker === undefined ? {} : { invoker: request.invoker }),
  });

  // ── 4. Merge. Baseline owns citations; enrichment owns the assurance axes. ─
  const merge = mergeGraph({
    baseline,
    enrichment,
    repoRoot: request.repoRoot,
    diagnostics: sink,
    ...(request.citations === undefined ? {} : { citations: request.citations }),
  });

  // ── 5. Edges, then the canonical graph. ───────────────────────────────────
  const graph = createPromiseGraph({
    promises: merge.graph.promises,
    edges: deriveEdges(merge.graph.promises),
    degraded: merge.graph.degraded,
    degradedReasons: merge.graph.degradedReasons,
    diagnostics: merge.graph.diagnostics,
  });

  // ── 6. State, through the single write guard. ─────────────────────────────
  // Freshness carried forward first: it moves only if the guard says so, below.
  const candidate = createKeptState({ updatedAt: at, freshness: prior.freshness, graph });
  const stream = readEnrichmentStream(enrichment);
  let state = candidate;
  let freshnessMoved = false;
  let freshnessRefusals: readonly WriteRefusalReason[] = [];

  if (enrichment.ok && stream !== null) {
    const outcome: RunOutcome<'Assurance'> = {
      runId: kaneRunId(stream) ?? `${SYNTHETIC_RUN_ID_PREFIX}${at}`,
      exitMeaning: readExitMeaning(enrichment),
      stream,
    };
    // No writes: `kept build` moves no verdict. What it can move is the freshness
    // triple, and only when the guard authorises it.
    const applied = store.applyRun(candidate, { outcome, writes: [], at, sink });
    state = applied.state;
    freshnessMoved = applied.wrote;
    freshnessRefusals = applied.refusals;
    if (!applied.wrote) {
      sink.report({
        code: BUILD_DIAGNOSTIC_CODES.freshnessHeld,
        severity: 'info',
        message:
          `The cover run did not prove an outcome (${applied.refusals.join(', ')}), so the ` +
          `freshness triple stands at ` +
          `${prior.freshness.terminalEventAt ?? 'never verified'} and every prior verdict is ` +
          `preserved`,
      });
    }
  } else {
    // The requirements define the Freshness_Timestamp as the instant of the newest
    // terminal event **consumed into the snapshot** (R9.6, and the glossary entry
    // it draws on), and §14.1 counts `freshness.terminalEventAt` as one of the
    // "verdicts" its refusal rows leave unchanged. A degraded enrichment run
    // consumed nothing: its axes were discarded, so the graph below is baseline's
    // alone and no terminal event entered it.
    //
    // That makes this arm strictly *narrower* than the write guard, deliberately.
    // A `cover` refusal is a **complete** stream (§5.3.1) whose exit reads as
    // `failure`, so the guard would authorise a write — and taking it would move
    // the Ledger's "last verified" chip forward for a run that verified nothing,
    // which is precisely the overstatement the ledger exists not to make. The
    // guard stays the necessary condition; acceptance is the additional one.
    sink.report({
      code: BUILD_DIAGNOSTIC_CODES.freshnessHeld,
      severity: 'info',
      message:
        `No terminal event was consumed into the graph` +
        `${merge.degradedReasons.length > 0 ? ` (${merge.degradedReasons.join(', ')})` : ''}, so ` +
        `the freshness triple stands at ` +
        `${prior.freshness.terminalEventAt ?? 'never verified'} and every prior verdict is ` +
        `preserved`,
    });
  }

  const written = store.save(state);

  sink.report({
    code: BUILD_DIAGNOSTIC_CODES.completed,
    severity: 'info',
    message:
      `kept build: ${graph.promises.length} promise${graph.promises.length === 1 ? '' : 's'}, ` +
      `${graph.edges.length} edge${graph.edges.length === 1 ? '' : 's'}, degraded=` +
      `${String(graph.degraded)}` +
      `${graph.degradedReasons.length > 0 ? ` (${graph.degradedReasons.join(', ')})` : ''}`,
  });

  return {
    state: written,
    statePath: store.path,
    baseline,
    enrichment,
    merge,
    degraded: merge.degraded,
    degradedReasons: merge.degradedReasons,
    freshnessMoved,
    freshnessRefusals,
    diagnostics: sink.entries,
  };
}

/**
 * The enrichment result's parsed stream, when it has one.
 *
 * `ProviderResult` does not declare `stream` — only `EnrichmentResult` does, and
 * the merge is deliberately blind to which implementation it holds (§5.1). So the
 * field is read through a widened view and validated structurally: a provider that
 * ran no process at all answers `null`, and there is then no outcome to hand the
 * guard, which is right — nothing was consumed, so nothing about freshness changed.
 */
function readEnrichmentStream(result: ProviderResult): ParsedStream<'Assurance'> | null {
  const value = (result as { readonly stream?: unknown }).stream;
  if (typeof value !== 'object' || value === null) return null;
  const stream = value as { readonly kind?: unknown; readonly family?: unknown };
  if (stream.family !== 'Assurance') return null;
  if (stream.kind !== 'complete' && stream.kind !== 'crashed') return null;
  return value as ParsedStream<'Assurance'>;
}

/**
 * The enrichment result's exit meaning, already interpreted against the Assurance
 * family by the invoker (§4.5). Never recomputed here: interpreting the code a
 * second time would be a second place for the exit-3-is-a-pause rule to be got
 * wrong.
 */
function readExitMeaning(result: ProviderResult): ExitMeaning {
  const value = (result as { readonly exitMeaning?: unknown }).exitMeaning;
  return isExitMeaning(value) ? value : 'kane-not-found';
}
