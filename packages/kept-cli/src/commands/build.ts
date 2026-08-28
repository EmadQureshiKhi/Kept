/**
 * `kept build`, both providers, one canonical graph, one state file
 * (design §5.4, §13.1, §14.1, R2.10, R2.12).
 *
 * Six steps, and the order is the design's:
 *
 * 1. **baseline** (`providers/baseline.ts`) scans `**\/*_test.md` and produces
 *    candidates. It cannot fail, `BaselineResult` types `ok` as the literal
 *    `true`, which is what makes the rest of this function safe to write without
 *    a fallback path for "no promises could be found at all".
 * 2. the prior state is loaded, so the verdicts a verification run earned survive a
 *    rebuild (step 4b) and so the freshness triple is carried rather than reset.
 * 3. **enrichment** (`providers/enrichment.ts`) invokes `cover gaps --json` under
 *    the Assurance family with the budget from `.kept/config.json`, and projects
 *    the dual coverage axes out of its `gaps` payload (§5.3.0, R9.9). Absence,
 *    refusal, pause, crash, timeout and an unreadable payload all arrive as
 *    `ok: false` with their own `degradedReason`, never as a throw, never as a
 *    non-zero exit from `kept`, and every one of them leaves the axes withheld.
 * 4. **merge** (`providers/merge.ts`) runs the citation gate over baseline's
 *    candidates, unions in enrichment's axes, defaults undesigned promises, and
 *    sets `degraded` from enrichment alone.
 * 5. **edges** are derived from the merged promises and the graph is rebuilt
 *    through `createPromiseGraph`, which is the single authority on canonical
 *    order.
 * 6. **state** is written through `state.ts`, the single write guard, and only
 *    through it.
 *
 * Step 6 is the one worth being explicit about. `kept build` writes **no verdict
 * and no freshness**. It writes the graph, the carried verdicts and the coverage
 * axes, and nothing else.
 *
 * The freshness half used to be conditional: an accepted `cover` run was treated as
 * a terminal event consumed into the graph, which is how R9.6 defines the
 * Freshness_Timestamp. That was safe only because acceptance never happened,
 * `cover --json` refused on every invocation here. `cover gaps` is accepted on every
 * build, and it **verifies nothing**: it reads the assurance graph, and its proven
 * axis is derived from execution facts whose `latest_run` is an *earlier* run. So
 * advancing the Ledger's "last verified" chip on it would restate an old proof as
 * new, which is the overstatement §14.1 keeps `freshness.terminalEventAt` out of.
 * The triple therefore belongs to `kept verify`, whose runs prove things, and this
 * command has nothing to contribute to it.
 *
 * The command's exit code is not a function of any of this. `degraded: true` with
 * `degradedReason: assurance-status:refused`, the honest state of a repository
 * with no `.context/` store, exits 0 (R2.10), and so does a missing `kane-cli`
 * (R2.12).
 */

import type {
  BaselineFileSystem,
  CitationSource,
  CollectingDiagnosticSink,
  CoverageAxes,
  Diagnostic,
  KaneInvoker,
  KeptState,
  MergeResult,
  ProviderResult,
  StateFileSystem,
  WriteRefusalReason,
} from 'kept-core';
import {
  collectBaseline,
  createDiagnosticSink,
  createEnrichmentProvider,
  createKeptState,
  createPromiseGraph,
  createStateStore,
  mergeGraph,
  readCoverageAxes,
} from 'kept-core';

import type { KeptConfig } from '../config.js';
import { deriveEdges } from '../graph.js';

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
  /**
   * The dual coverage axes this run accepted, or null on every degraded path
   * (R9.13, R9.14). Also written into the state file, which is what carries them
   * across to `kept snapshot`.
   */
  readonly coverageAxes: CoverageAxes | null;
  /**
   * Always `false`. `kept build` moves no freshness at all, see step 6b: a
   * `cover gaps` run reads the assurance graph and proves nothing, so the "last
   * verified" chip is not its to advance. Kept on the result because the command
   * reports it, and reporting `false` truthfully is better than dropping a field a
   * reader has learned to look for.
   */
  readonly freshnessMoved: boolean;
  /** Always empty: there is no freshness move to refuse. */
  readonly freshnessRefusals: readonly WriteRefusalReason[];
  /** Everything every step reported, in order. */
  readonly diagnostics: readonly Diagnostic[];
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
    // `corpus.root` from the config, so the scan looks where this repository keeps
    // its designed tests (§20.1, R15.9). The provider's own fallback is the
    // repository root, which finds everything; what it no longer contains is a
    // literal directory name that happened to be true here.
    corpusRoot: request.config.corpus.root,
    diagnostics: sink,
    ...(request.citations === undefined ? {} : { citations: request.citations }),
    ...(request.baselineFileSystem === undefined ? {} : { fs: request.baselineFileSystem }),
  });

  // ── 2 and 3. Enrichment: the dual coverage axes, from the live graph. ──────
  //
  // No keying targets are derived any more, and that is a fact about the payload
  // rather than a simplification. `cover gaps` reports use cases, not test
  // documents: it carries no `test_id` and no path, so there is nothing a promise
  // could be keyed by and no axis overlay to write (§5.3.0). The promise-level
  // proven axis comes from real verification runs through the write guard of §4.8,
  // which is where it always belonged.
  const enrichment = await createEnrichmentProvider({
    timeoutMs: request.config.timeouts.enrichmentMs,
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

  // ── 4b. Carry the verified state of every promise that survived (R4.15). ───
  //
  // The merge answers from the providers, and no provider knows a verdict: the
  // baseline scan reads claims out of Markdown and enrichment supplies coverage
  // axes. So a rebuilt promise arrives `stale`, with no `verdictSource`, no
  // repair, no pack and no credits. Writing that graph would mean `kept build`
  // silently discarding every verdict `kept verify` earned, measured, not
  // theorised: a `--all` replay that had just written eight verdicts came back
  // eight times `stale` from the next `npm run build:snapshot` (15.3). The header
  // above and the two diagnostics below both promise that "every prior verdict is
  // preserved", so this restores the behaviour the command already documents.
  //
  // Keyed on `id`, and that is what makes it safe rather than a guess. A promise
  // id is derived from the citation file plus the **normalised claim** and nothing
  // else, so an id that matches is the same sentence in the same file: the verdict
  // it earned is still about the thing being described. Edit the claim and the id
  // changes, no prior record matches, and the new promise is `stale`, which is
  // exactly right, because nothing has verified the new wording.
  const priorById = new Map(prior.graph.promises.map((promise) => [promise.id, promise]));
  const carried = merge.graph.promises.map((promise) => {
    const previous = priorById.get(promise.id);
    if (previous === undefined) return promise;
    return {
      ...promise,
      verdict: previous.verdict,
      verdictSource: previous.verdictSource,
      // The same invariant `applyRun` enforces on the way in: a repair annotation
      // belongs to a failure, so a promise carried forward as `proven` carries no
      // annotation. Enforcing it here as well is what lets a state file written
      // before the rule existed heal on the next rebuild rather than keep
      // publishing a `proven` promise labelled `docs-lie`.
      repair: previous.verdict === 'proven' ? null : previous.repair,
      evidencePackId: previous.evidencePackId,
      credits: previous.credits,
    };
  });

  // ── 5. Edges, then the canonical graph. ───────────────────────────────────
  const graph = createPromiseGraph({
    promises: carried,
    edges: deriveEdges(carried),
    degraded: merge.graph.degraded,
    degradedReasons: merge.graph.degradedReasons,
    diagnostics: merge.graph.diagnostics,
  });

  // ── 6. State, through the single write guard. ─────────────────────────────
  // Freshness carried forward first: it moves only if the guard says so, below.
  //
  // The coverage axes are taken from **this** run and never carried forward from
  // the prior state. `readCoverageAxes` answers null on every degraded path, so a
  // refusal, a pause, a crash, a timeout or an unreadable payload clears the field
  //, which is R9.13 at the persistence layer: axes from a previous run presented
  // as current would be exactly the withheld figure filled in with a stale one.
  const coverageAxes = enrichment.ok ? readCoverageAxes(enrichment) : null;
  const candidate = createKeptState({
    updatedAt: at,
    freshness: prior.freshness,
    graph,
    coverageAxes,
  });
  // ── 6b. Freshness is held, in every case, and `cover gaps` is why. ─────────
  //
  // The freshness triple is what the Ledger's `last verified` chip renders, and a
  // `cover gaps` run **verifies nothing**. It reads the assurance graph: its own
  // proven axis is derived from `graph_execution_facts` and its
  // `latest_run.execution_id` names an *earlier* run, the one that actually proved
  // something. Advancing the chip to the instant we asked the question would
  // restate that older proof as new, the exact overstatement §14.1 keeps
  // `freshness.terminalEventAt` out of, and the reason the previous version of this
  // code refused the move on every degraded path.
  //
  // What changed is that acceptance is now reachable. While `cover --json` refused
  // on every invocation the accepting arm never ran, so an accepted-run freshness
  // move looked harmless. With `cover gaps` accepted on every build it would fire
  // every time, and "last verified" would come to mean "last built". So the move is
  // gone rather than gated: the triple belongs to `kept verify`, whose runs prove
  // things, and this command has nothing to contribute to it.
  //
  // `freshnessMoved` and `freshnessRefusals` stay on the result because `kept build`
  // reports them; they are now constants, and that is the honest reading.
  const state = candidate;
  const freshnessMoved = false;
  const freshnessRefusals: readonly WriteRefusalReason[] = [];

  sink.report({
    code: BUILD_DIAGNOSTIC_CODES.freshnessHeld,
    severity: 'info',
    message:
      `\`cover gaps\` reads the assurance graph and proves nothing` +
      `${merge.degradedReasons.length > 0 ? ` (${merge.degradedReasons.join(', ')})` : ''}, so ` +
      `the freshness triple stands at ` +
      `${prior.freshness.terminalEventAt ?? 'never verified'} and every prior verdict is ` +
      `preserved`,
  });

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
    coverageAxes,
    freshnessMoved,
    freshnessRefusals,
    diagnostics: sink.entries,
  };
}
