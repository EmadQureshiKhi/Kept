/**
 * `kept reconcile --changed <p…>` and `kept reconcile apply [planPath]` — the
 * corrected docs branch (design §13.2, §13.2.1–§13.2.4, §14.1, R5.1–R5.8, R2.10).
 *
 * ## The correction this file exists to carry
 *
 * `kane-cli maintain reconcile` **requires** both `--from <file>` and
 * `--source-id <id>`; verified against the installed 0.8.4 by its own `--help`.
 * An earlier version of the design issued a bare `maintain reconcile --mode
 * agent`, which would have exited 2 on every single save while looking perfectly
 * wired up — a docs branch that was silently dead, and the kind of defect no
 * amount of test coverage of the *rest* of the command would have surfaced.
 *
 * The fix is a type, not a habit. `--source-id` is built from
 * `resolution.source.sourceId`, which is reachable on the `ok: true` arm of
 * `SourceResolution` and on no other arm, so {@link reconcileArgv} answers `null`
 * for every failure and an unresolved source is **not expressible** as a spawn.
 * That is what makes §13.2.2's six steps structural: no process, no credits, no
 * review card, no verdict movement, `degraded` still **false**, exit 0.
 *
 * ```
 * maintain reconcile --from apps/fixture/README.md --source-id src_7f31c0a4 --plan --mode agent
 *                    └ the hook's saved path      └ RESOLVED (§13.2.2)     │      └ appended by the
 *                                                                          │        invoker from the
 *                                                                          │        Assurance contract
 *                                                                          └ preview: nothing commits
 * ```
 *
 * ## `degraded` stays false on every refusal
 *
 * R5.3, and the clause reflex breaks: every *other* adversity row of §14.1 sets
 * `degraded`, because it reports that the **proven axis** is untrustworthy. An
 * unresolved source loses no proven data at all — the baseline graph and every
 * prior verdict are intact — so this command never sets it. The signal a reviewer
 * gets is the diagnostic on `/runs`, naming the exact `kane-cli context ingest`
 * remedy.
 *
 * ## The seven-row fail-fast ladder, mirrored locally (§13.2.4)
 *
 * `maintain reconcile` validates in a fixed order and exits 2 with nothing
 * mutated on the first failure. KEPT mirrors **all seven** rows before spawning,
 * so the common refusals cost no process:
 *
 * | # | check | how it is answered here |
 * |---|---|---|
 * | 1 | `--from` present | the filtered changed-doc list; no doc, no invocation |
 * | 2 | `--source-id` resolved | `resolveSourceIdCached`, whose failure arm carries no id |
 * | 3 | `--from` exists | {@link ReconcileFileProbe}, a `fs.stat` before any spawn |
 * | 4 | ingestable type | {@link RECONCILE_INGESTABLE_EXTENSIONS} |
 * | 5 | source id known | the match ladder — an unknown id never leaves resolution |
 * | 6 | source not retired | the `retired` projection, answered as `reason: 'retired'` |
 * | 7 | **fork guard** | `forkGuard` over the same listing (§13.2.4 #7) |
 *
 * Checks 1, 3 and 4 are run **before** the resolution rather than in the table's
 * literal order, and that is deliberate. Rows 1 and 2 of the table are argv-shape
 * questions Kane asks of a command line it was handed; KEPT composes its own argv
 * and can never omit either flag, so its analogue of row 2 is "could an id be
 * resolved at all" — which costs a `context list`. Rows 3 and 4 cost nothing. So
 * running the free checks first changes no outcome, saves a process for a
 * document that is not there, and reports the *specific* refusal (`the file does
 * not exist`) instead of the generic one it would otherwise resolve into. The
 * ordering that matters — no spawn until every check has passed — is unchanged,
 * and {@link RECONCILE_LADDER_CHECKS} keeps the table's own order for the tests.
 *
 * ## The ingestable allow-list, and why it errs wide
 *
 * §13.2.4 leaves the list to the implementation, and the trade is asymmetric.
 * Refusing a document locally that Kane would have accepted is a **silently dead
 * branch** — the exact failure this whole section exists to prevent. Accepting a
 * document Kane refuses costs **one process** that exits 2 with nothing mutated,
 * which is data (R2.10) and is reported verbatim. `context/cache.ts` makes the
 * same trade for a stale cache entry, for the same reason. So the list is the
 * union of the text document extensions a documentation store plausibly ingests
 * and the source extensions the recorded listing shows *already* ingested —
 * `apps/fixture/app/settings/page.tsx` is a `.tsx` file in that capture — and
 * what it excludes is the class of file no store ingests: images, archives,
 * binaries, and a path with no extension at all.
 *
 * ## `--plan`, and the one non-zero exit in the product
 *
 * The hook path is always `--plan` (§13.2.3). `--plan` previews: the head-move
 * lands, everything else is **staged** into Kane's own stored plan, which is
 * precisely the "hold every change, apply none automatically" semantic R5.7 asks
 * for — so KEPT does not implement holding on top of Kane, it uses Kane's
 * staging. The head move is a mutation inside Kane's `.context/` store rather
 * than in this repository, and it lands even under `--plan`, so it is recorded in
 * the run diagnostics and a reviewer is never surprised by it.
 *
 * `--apply` is never issued by a hook. `kept reconcile apply [planPath]` is a
 * deliberate human command, absent from both hook prompts.
 *
 * **`--plan` together with `--apply` is the single case in the whole product
 * where `kept` itself exits non-zero.** It is a usage error, rejected by KEPT's
 * own arg parser *before any spawn*, with a usage message and **exit 2** (§13.2.3,
 * §14.1's last row). Every other outcome this file can produce — a refusal, a
 * pause, a crashed stream, a missing binary, Kane's own exit 2 — exits **0**,
 * because the CLI's exit code reports whether KEPT worked and never whether the
 * product passed (§14.2). {@link reconcileUsageErrors} is where the rejection is
 * decided for this command, and it reads the same
 * `MUTUALLY_EXCLUSIVE_FLAGS` table the parser does rather than restating the rule.
 *
 * ## What this file deliberately does not do
 *
 * It creates **no review card**. R5.7 and Property 20 hold every change
 * reconciliation produces as a held card, and Kane's `--plan` staging is the
 * mechanism; mirroring the staged items into `.kept/review-cards/` is task 14.1's
 * `repair/reviewCard.ts`, which is being built alongside this. The seam is
 * {@link ReconcileDoc.staged} — the `review_card` events the stream carried, kept
 * verbatim — plus {@link ReconcileResult.reviewCards}, which is `null` until 14.1
 * lands. A diagnostic names the count so the staging is visible on `/runs` in the
 * meantime.
 *
 * It also writes **no verdict**. Reconciliation moves no verdict directly: what
 * it can do is change the *graph*, and R5.2 says how — the promise graph is
 * rebuilt from **both providers** after the terminal `done` is observed, which is
 * `runBuild`, and it is gated on that event. A crashed stream and a paused run
 * rebuild nothing. Freshness is not moved here either: a docs reconciliation
 * verified nothing, and advancing the Ledger's "last verified" chip for it would
 * be the overstatement the ledger exists not to make (§14.1, R9.6).
 */

import { statSync } from 'node:fs';

import type {
  BaselineFileSystem,
  CitationSource,
  CollectingDiagnosticSink,
  Diagnostic,
  ExitMeaning,
  HandoffHook,
  InvocationResult,
  KaneInvoker,
  KeptState,
  ParsedStream,
  RunOutcome,
  SourceMtimeReader,
  SourceResolution,
  SourceResolutionReason,
  StateFileSystem,
  StoreSource,
  WriteHandoffResult,
} from '@kept/core';
import {
  ACCEPTED_ASSURANCE_STATUS,
  FIXTURE_DOC_GLOBS,
  FORK_GUARD_DIAGNOSTIC_CODE,
  SOURCE_REASON_DIAGNOSTIC_CODE,
  absoluteSourcePath,
  contractFor,
  createDiagnosticSink,
  createStateStore,
  forkGuard,
  matchesAnyGlob,
  normaliseAssuranceStatus,
  normaliseChangedPath,
  parseStream,
  resolveSourceIdCached,
  writeHandoff,
} from '@kept/core';

import type { ParsedArgv } from '../args.js';
import { MUTUALLY_EXCLUSIVE_FLAGS } from '../args.js';
import type { KeptConfig } from '../config.js';

import type { BuildResult } from './build.js';
import { runBuild } from './build.js';
import type { SnapshotResult } from './snapshot.js';
import { runSnapshot } from './snapshot.js';

/** The family `maintain reconcile` belongs to (§4.1, §13.1). Terminal: `done`. */
export const RECONCILE_FAMILY = 'Assurance' as const;

/** The verb, without flags. `--mode agent` is the invoker's, never written here. */
export const RECONCILE_ARGV_HEAD: readonly string[] = Object.freeze([
  'maintain',
  'reconcile',
]);

/** The new version of the document whose head moves. Mandatory (§13.2). */
export const FROM_FLAG = '--from';

/** The existing source it succeeds. Mandatory, and never hardcoded (§13.2.2). */
export const SOURCE_ID_FLAG = '--source-id';

/** Preview: the head move lands, everything else is staged (§13.2.3). */
export const PLAN_FLAG = '--plan';

/** Walks a stored plan. Human-only; never issued by a hook (§13.2.3). */
export const APPLY_FLAG = '--apply';

/**
 * Extensions `--from` may carry — check 4 of the ladder (§13.2.4).
 *
 * Errs wide on purpose; the header explains the trade. What matters is that the
 * excluded class is the one no store ingests, and that a path with **no**
 * extension is excluded too rather than being waved through.
 */
export const RECONCILE_INGESTABLE_EXTENSIONS: readonly string[] = Object.freeze([
  '.adoc',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.markdown',
  '.md',
  '.mdx',
  '.rst',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

/** One row of the fail-fast ladder, in §13.2.4's own order. */
export type ReconcileLadderCheck =
  | 'from-present'
  | 'source-id-resolved'
  | 'from-exists'
  | 'ingestable-type'
  | 'source-known'
  | 'source-live'
  | 'fork-guard';

/**
 * The seven rows, in the table's order (§13.2.4).
 *
 * Named as data so a test can assert that every one of them is mirrored locally,
 * and so a row cannot be added to the design without a compile error here.
 */
export const RECONCILE_LADDER_CHECKS: readonly ReconcileLadderCheck[] = Object.freeze([
  'from-present',
  'source-id-resolved',
  'from-exists',
  'ingestable-type',
  'source-known',
  'source-live',
  'fork-guard',
]);

/** Which ladder row each resolution failure answers. Total over the vocabulary. */
export const RECONCILE_CHECK_FOR_REASON: {
  readonly [R in SourceResolutionReason]: ReconcileLadderCheck;
} = Object.freeze({
  // Rows 1 to 3 of the resolution vocabulary are all "no id could be obtained".
  'no-store': 'source-id-resolved',
  'listing-unreadable': 'source-id-resolved',
  'crashed-stream': 'source-id-resolved',
  // Nothing in the store backs this file, which is check 5 read from our side:
  // an id we do not have is an id Kane would not know.
  'no-match': 'source-known',
  // Two live candidates tied, so no id was *chosen*. Filing this under check 5
  // would say the store does not know the file, and it knows it twice.
  ambiguous: 'source-id-resolved',
  retired: 'source-live',
});

/** Diagnostic codes this command reports. Stable strings; the Ledger keys off them. */
export const RECONCILE_DIAGNOSTIC_CODES = Object.freeze({
  started: 'reconcile-started',
  /** A saved path outside the Docs_Hook pattern set. Ignored, and said so. */
  outOfScope: 'reconcile-path-out-of-scope',
  /** Zero changed docs after filtering: no invocation at all (§13.2.1). */
  noChangedDocs: 'reconcile-no-changed-docs',
  /** Ladder check 3: `--from` names a file that is not there. */
  fromMissing: 'reconcile-from-missing',
  /** Ladder check 4: the extension is not on the ingestable allow-list. */
  notIngestable: 'reconcile-from-not-ingestable',
  /** A resolved source but no Kane boundary to hand it to (R2.12). */
  kaneUnavailable: 'reconcile-kane-unavailable',
  /** The head move that lands even under `--plan` (§13.2.3). */
  headMoved: 'reconcile-head-moved',
  /** Items Kane staged into its stored plan. Task 14.1 mirrors them into cards. */
  staged: 'reconcile-staged',
  /** `done.status: paused` with exit 3: resumable, nothing changed (R5.4). */
  paused: 'reconcile-paused',
  /** The stream never reached `done`, so the outcome is unknown (R5.3). */
  outcomeUnknown: 'reconcile-outcome-unknown',
  /** A terminal event that did not accept: refused, error, or anything new. */
  refused: 'reconcile-refused',
  /** The graph was rebuilt from both providers after the terminal event (R5.2). */
  rebuilt: 'reconcile-graph-rebuilt',
  /** No terminal `done` was accepted, so the graph was left exactly as it was. */
  rebuildHeld: 'reconcile-graph-rebuild-held',
  /** `kept reconcile apply`: the human-only walk of a stored plan (§13.2.3). */
  applyStarted: 'reconcile-apply-started',
  completed: 'reconcile-completed',
} as const);

/** The codes as a list, so a test can enumerate them. */
export const RECONCILE_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(RECONCILE_DIAGNOSTIC_CODES),
);

/** The synthetic run id used when the terminal event carried none of Kane's own. */
export const SYNTHETIC_RUN_ID_PREFIX = 'kept-reconcile:';

/** The hook whose saved paths reach `--changed` (§11.1). */
export const RECONCILE_HOOK: HandoffHook = 'kept-docs-reconcile';

/**
 * The event type Kane uses for a staged item, as recorded in
 * `test/fixtures/assurance-paused.ndjson`. Read, never required: a stream that
 * staged nothing is a normal stream.
 */
export const STAGED_ITEM_EVENT_TYPE = 'review_card';

// ---------------------------------------------------------------------------
// The argv — the whole point of §13.2
// ---------------------------------------------------------------------------

/**
 * The plan invocation of §13.2.1, without the NDJSON enabler.
 *
 * Both flags, always, in the design's order. `--mode agent` is appended by the
 * invoker from the Assurance contract (§4.7) and writing it here would be a
 * second home for the one fact that table exists to hold once.
 */
export function reconcilePlanArgv(from: string, sourceId: string): readonly string[] {
  return Object.freeze([
    ...RECONCILE_ARGV_HEAD,
    FROM_FLAG,
    from,
    SOURCE_ID_FLAG,
    sourceId,
    PLAN_FLAG,
  ]);
}

/**
 * The argv for one changed document, or `null` when the source is unresolved.
 *
 * This function *is* the correction of §13.2. `resolution.source` exists on the
 * `ok: true` arm and nowhere else, so the early return is not a guard a future
 * refactor could helpfully drop — there is nothing to fall back to, and an
 * unresolved source is therefore a no-op by structure rather than by discipline.
 */
export function reconcileArgv(
  resolution: SourceResolution,
  from: string,
): readonly string[] | null {
  if (!resolution.ok) return null;
  return reconcilePlanArgv(from, resolution.source.sourceId);
}

/**
 * The human-only apply invocation (§13.2.3). Bare walks the latest stored plan
 * behind Kane's approval prompt; a path selects one.
 *
 * `--plan` is structurally absent: this function names `--apply` and nothing
 * else, so there is no code path in `kept` that can emit both flags.
 */
export function reconcileApplyArgv(planPath: string | null): readonly string[] {
  return Object.freeze(
    planPath === null || planPath.length === 0
      ? [...RECONCILE_ARGV_HEAD, APPLY_FLAG]
      : [...RECONCILE_ARGV_HEAD, APPLY_FLAG, planPath],
  );
}

/**
 * The usage errors `kept reconcile` rejects before anything runs (§13.2.3).
 *
 * The parser's own table already catches `--plan --apply`, and `main` returns
 * exit 2 for it before dispatch. This adds the one spelling the table cannot see:
 * `kept reconcile apply` is the **subcommand** form of `--apply`, so
 * `kept reconcile apply --plan` would compose both flags onto Kane's argv while
 * carrying only one of them in `flags`. The rule is not restated — the effective
 * flag set is built and `MUTUALLY_EXCLUSIVE_FLAGS` is read over it, so a second
 * pair added to that table is a row here too and not a new code path.
 */
export function reconcileUsageErrors(parsed: ParsedArgv): readonly string[] {
  const effective = new Set<string>(parsed.flags.keys());
  if (parsed.subcommand === 'apply') effective.add('apply');

  const errors: string[] = [...parsed.usageErrors];
  for (const [left, right] of MUTUALLY_EXCLUSIVE_FLAGS) {
    if (!effective.has(left) || !effective.has(right)) continue;
    const already = errors.some((message) => message.includes(`--${left} and --${right}`));
    if (already) continue;
    errors.push(
      `--${left} and --${right} are mutually exclusive: one stages changes and the other ` +
        `walks what was staged, so no invocation can mean both`,
    );
  }
  return Object.freeze(errors);
}

// ---------------------------------------------------------------------------
// Ladder checks 1, 3 and 4 — the ones that cost nothing
// ---------------------------------------------------------------------------

/** What {@link filterChangedDocs} made of the hook's saved paths. */
export interface ChangedDocs {
  /** Repo-relative POSIX docs inside the pattern set, deduped, in given order. */
  readonly docs: readonly string[];
  /** Saved paths that are not documentation. Reported once each, then ignored. */
  readonly outOfScope: readonly string[];
}

/**
 * Filter the hook's saved paths to the Docs_Hook pattern set (§13.2.1).
 *
 * `FIXTURE_DOC_GLOBS` is the pattern set, imported from the handoff module rather
 * than re-listed here, so the fence the handoff hands back and the filter that
 * selects a document cannot drift apart. Matching goes through `matchesGlob`, the
 * repository's one glob grammar — there is no `micromatch` in the dependency
 * budget of §2.2 and no second notion of what `docs/**` means.
 *
 * Order is the caller's, because §13.2.1 issues one invocation per changed doc
 * *sequentially* and a hook that saved two files has an order worth preserving.
 * Duplicates collapse: the same document twice is one head move.
 */
export function filterChangedDocs(
  changed: readonly string[],
  repoRoot?: string | undefined,
): ChangedDocs {
  const docs: string[] = [];
  const seen = new Set<string>();
  const outOfScope: string[] = [];

  for (const raw of changed) {
    const path = normaliseChangedPath(raw, repoRoot);
    if (path.length === 0) continue;
    if (!matchesAnyGlob(FIXTURE_DOC_GLOBS, path)) {
      if (!outOfScope.includes(path)) outOfScope.push(path);
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    docs.push(path);
  }

  return { docs: Object.freeze(docs), outOfScope: Object.freeze(outOfScope) };
}

/** The extension of a POSIX path, lowercased, or the empty string when it has none. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const cut = name.lastIndexOf('.');
  return cut <= 0 ? '' : name.slice(cut).toLowerCase();
}

/** Ladder check 4: is this an ingestable document type? (§13.2.4). */
export function isIngestablePath(path: string): boolean {
  return RECONCILE_INGESTABLE_EXTENSIONS.includes(extensionOf(path));
}

/**
 * How ladder check 3 asks whether `--from` exists. Injected, so the whole command
 * runs with no disk; separate from {@link SourceMtimeReader} because a mtime is
 * not an existence answer and conflating them would make an unreadable timestamp
 * read as a missing file.
 */
export type ReconcileFileProbe = (absPath: string) => boolean;

/** The production probe. Absence and errors are `false`, never a throw. */
export const nodeReconcileFileProbe: ReconcileFileProbe = (absPath) => {
  const stats = statSync(absPath, { throwIfNoEntry: false });
  return stats !== undefined && stats.isFile();
};

// ---------------------------------------------------------------------------
// One refusal, one document, one run
// ---------------------------------------------------------------------------

/**
 * Why a document was refused: a ladder row, or the one refusal that is not a
 * check at all.
 *
 * `kane-unavailable` is R2.12's supported state of the world — a resolved source
 * and no process boundary to hand it to. It is not a row of §13.2.4 and is not
 * spelled as one, because a reader who saw it filed under `from-present` would
 * conclude the design has a row it does not have.
 */
export type ReconcileRefusalKind = ReconcileLadderCheck | 'kane-unavailable';

/** Which ladder row refused a document, and the diagnostic that says so. */
export interface ReconcileRefusal {
  readonly check: ReconcileRefusalKind;
  /** The diagnostic's code, so a caller can key off it without re-deriving it. */
  readonly code: string;
  /** The resolution reason, when the refusal came from resolution. */
  readonly reason: SourceResolutionReason | null;
  readonly diagnostic: Diagnostic;
}

/** What happened to one changed document. */
export interface ReconcileDoc {
  /** Repo-relative POSIX path, exactly as it reached `--from`. */
  readonly file: string;
  /** The resolution, or null when a free check refused before resolving. */
  readonly resolution: SourceResolution | null;
  /** The resolved id, reachable only when the resolution succeeded. */
  readonly sourceId: string | null;
  /** Which rung answered, `cache` included. Null when nothing resolved. */
  readonly via: string | null;
  /** The ladder row that refused, or null when every check passed. */
  readonly refusal: ReconcileRefusal | null;
  /** argv actually issued, `--mode agent` included. Empty when nothing ran. */
  readonly argv: readonly string[];
  readonly invoked: boolean;
  readonly exitCode: number | null;
  readonly exitMeaning: ExitMeaning | null;
  /** Whether the `done` event arrived (R5.3). */
  readonly terminalSeen: boolean;
  /** `done.status`, normalised, or null when no terminal event arrived. */
  readonly status: string | null;
  /** Terminal `done` with an accepting status: the graph-rebuild gate (R5.2). */
  readonly accepted: boolean;
  /** `done.status: paused` — resumable, and nothing changed (R5.4). */
  readonly paused: boolean;
  /** The head move that lands even under `--plan` (§13.2.3). */
  readonly headMoved: boolean;
  /** Items Kane staged, verbatim. Task 14.1 mirrors these into review cards. */
  readonly staged: readonly Record<string, unknown>[];
  /** Kane's own message, quoted rather than paraphrased. */
  readonly message: string | null;
  readonly runId: string;
  readonly handoff: WriteHandoffResult;
}

/** What {@link runReconcile} did. */
export interface ReconcileResult {
  /** One entry per changed doc, in the order they were processed. */
  readonly docs: readonly ReconcileDoc[];
  /** Saved paths that were not documentation. Reported once each. */
  readonly outOfScope: readonly string[];
  /** How many `maintain reconcile` processes were started. Never more than one per doc. */
  readonly invocations: number;
  /** The state as it now stands — the prior one unless the graph was rebuilt. */
  readonly state: KeptState;
  readonly statePath: string;
  /** Whether the graph was rebuilt from both providers after a terminal `done` (R5.2). */
  readonly rebuilt: boolean;
  readonly build: BuildResult | null;
  /**
   * The seam for task 14.1's `repair/reviewCard.ts`.
   *
   * Always `null` in this build, and deliberately typed as `null` rather than as
   * an empty array: this command produces no card, and an empty list would read
   * as "we looked and there were none". The staged items are on each
   * {@link ReconcileDoc.staged}, which is what 14.1 mirrors into
   * `.kept/review-cards/`.
   */
  readonly reviewCards: null;
  /** Every handoff written by this run. One per doc, or one for a no-doc run. */
  readonly handoffs: readonly WriteHandoffResult[];
  readonly snapshot: SnapshotResult;
  readonly diagnostics: readonly Diagnostic[];
}

/** {@link runReconcile}'s input. Every seam has a production default. */
export interface ReconcileRequest {
  /** Absolute repository root. `process.cwd()` is never substituted downstream. */
  readonly repoRoot: string;
  readonly config: KeptConfig;
  /** `--changed <p…>`: the hook's saved paths, verbatim. */
  readonly changed?: readonly string[] | undefined;
  /** The Kane process boundary. Absent means nothing can be invoked (R2.12). */
  readonly invoker?: KaneInvoker | undefined;
  /** State, source cache, handoff and snapshot reads and writes. Defaults to `node:fs`. */
  readonly fileSystem?: StateFileSystem | undefined;
  /** Ladder check 3. Defaults to {@link nodeReconcileFileProbe}. */
  readonly probe?: ReconcileFileProbe | undefined;
  /**
   * The `*_test.md` walk of the graph rebuild (R5.2), passed straight to
   * `runBuild`. Present so the rebuild gate can be asserted without a scan of the
   * whole working tree; production omits it and gets `node:fs`.
   */
  readonly baselineFileSystem?: BaselineFileSystem | undefined;
  /** Cited-document reads for the same rebuild. Defaults to `node:fs`. */
  readonly citations?: CitationSource | undefined;
  /** The source cache's mtime seam. Defaults to the `node:fs` reader. */
  readonly mtimeMs?: SourceMtimeReader | undefined;
  /** A digest already in hand. `null` states the bytes were unreadable. */
  readonly fileDigest?: string | null | undefined;
  readonly diagnostics?: CollectingDiagnosticSink | undefined;
  /** ISO 8601 instant written into the handoff and the snapshot. Defaults to now. */
  readonly at?: string | undefined;
  /** Epoch milliseconds, for the source cache's window. Defaults to `Date.now`. */
  readonly now?: (() => number) | undefined;
  /** What fired the run. Defaults to the docs hook (§11.2). */
  readonly trigger?:
    | {
        readonly hook?: HandoffHook | null;
        readonly event?: string | null;
        readonly paths?: readonly string[];
      }
    | undefined;
}

/** A string field off an unknown record, or null. */
function readString(source: unknown, key: string): string | null {
  if (typeof source !== 'object' || source === null) return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Kane's own words for this run: the terminal's `message` when it carried one,
 * else the first non-empty `message` anywhere in the stream.
 *
 * The fallback is not defensive padding. The verified refusal envelope of §5.3.1
 * puts the remedy — "run `kane-cli context ingest <files>` first" — on a separate
 * `error` event and leaves the terminal with no message at all, so a reader that
 * only looked at the terminal would report a refusal and silently discard the one
 * sentence that says what to do about it. `context/listing.ts` reads it the same
 * way, for the same reason.
 */
function kaneMessage(
  stream: ParsedStream<typeof RECONCILE_FAMILY> | null,
  terminal: unknown,
): string | null {
  const direct = readString(terminal, 'message');
  if (direct !== null) return direct;
  for (const event of stream?.events ?? []) {
    const message = readString(event, 'message');
    if (message !== null) return message;
  }
  return null;
}

/** Every `review_card` event a stream carried, verbatim. */
function stagedItems(
  stream: ParsedStream<typeof RECONCILE_FAMILY> | null,
): readonly Record<string, unknown>[] {
  if (stream === null) return Object.freeze([]);
  return Object.freeze(
    stream.events
      .filter((event) => event['type'] === STAGED_ITEM_EVENT_TYPE)
      .map((event) => event as Record<string, unknown>),
  );
}

/**
 * Reconcile one document (§13.2.1). Never throws, and never spawns until every
 * one of the seven checks has passed.
 */
async function reconcileOneDoc(options: {
  readonly file: string;
  readonly index: number;
  readonly request: ReconcileRequest;
  readonly sink: CollectingDiagnosticSink;
  readonly at: string;
  readonly probe: ReconcileFileProbe;
}): Promise<ReconcileDoc> {
  const { file, request, sink, at } = options;
  const runId = `${SYNTHETIC_RUN_ID_PREFIX}${at}#${options.index}`;

  /** The six steps of §13.2.2, for a document no check admitted. */
  const refuse = (refusal: ReconcileRefusal): ReconcileDoc => ({
    file,
    resolution: null,
    sourceId: null,
    via: null,
    refusal,
    argv: Object.freeze([]),
    invoked: false,
    exitCode: null,
    exitMeaning: null,
    terminalSeen: false,
    status: null,
    accepted: false,
    paused: false,
    headMoved: false,
    staged: Object.freeze([]),
    message: null,
    runId,
    handoff: writeHandoff({
      repoRoot: request.repoRoot,
      runId,
      at,
      trigger: {
        hook: request.trigger?.hook ?? RECONCILE_HOOK,
        event: request.trigger?.event ?? 'fileEdited',
        paths: request.trigger?.paths ?? [file],
      },
      // The family is recorded so `/runs` can say what *would* have run; `invoked`
      // is false because nothing did, and `argv` is empty because none exists.
      command: { family: RECONCILE_FAMILY, argv: [], invoked: false },
      // The refusal first, so a reader sees the reason before the boilerplate.
      // It is already in the sink, so it is filtered out of the tail rather than
      // carried twice: a handoff that lists one refusal twice reads like two.
      diagnostics: [
        refusal.diagnostic,
        ...sink.entries.filter((entry) => entry !== refusal.diagnostic),
      ],
      ...(request.fileSystem === undefined ? {} : { fileSystem: request.fileSystem }),
      // No `run` and no `results`: no process started, so there is no outcome to
      // gate and no repair to authorise. `nextAction.branch` is null.
    }),
  });

  // ── Check 3. `fs.stat` before anything else that costs a process. ─────────
  const absPath = absoluteSourcePath(request.repoRoot, file);
  if (absPath === null || !options.probe(absPath)) {
    return refuse({
      check: 'from-exists',
      code: RECONCILE_DIAGNOSTIC_CODES.fromMissing,
      reason: null,
      diagnostic: sink.report({
        code: RECONCILE_DIAGNOSTIC_CODES.fromMissing,
        severity: 'warn',
        message:
          `${file} was saved but is not a file that can be read now, so it was not handed to ` +
          `\`maintain reconcile\`: \`--from\` names the new version of a document and a path ` +
          `that is not there would be refused with nothing mutated. Nothing was invoked and no ` +
          `verdict moved.`,
        file,
      }),
    });
  }

  // ── Check 4. The extension allow-list. Also free. ─────────────────────────
  if (!isIngestablePath(file)) {
    return refuse({
      check: 'ingestable-type',
      code: RECONCILE_DIAGNOSTIC_CODES.notIngestable,
      reason: null,
      diagnostic: sink.report({
        code: RECONCILE_DIAGNOSTIC_CODES.notIngestable,
        severity: 'warn',
        message:
          `${file} does not carry an ingestable extension (${RECONCILE_INGESTABLE_EXTENSIONS.join(
            ', ',
          )}), so it was not handed to \`maintain reconcile\`. A file the store cannot ingest ` +
          `has no head to move. Nothing was invoked and no verdict moved.`,
        file,
      }),
    });
  }

  // ── Checks 2, 5 and 6. The resolution gate: no id, no spawn (§13.2.2). ────
  const cached = await resolveSourceIdCached({
    repoRoot: request.repoRoot,
    file,
    diagnostics: sink,
    ...(request.invoker === undefined ? {} : { invoker: request.invoker }),
    ...(request.fileSystem === undefined ? {} : { fileSystem: request.fileSystem }),
    ...(request.mtimeMs === undefined ? {} : { mtimeMs: request.mtimeMs }),
    ...(request.fileDigest === undefined ? {} : { fileDigest: request.fileDigest }),
    ...(request.now === undefined ? {} : { now: request.now }),
    // No `timeoutMs`: the listing's 60 s budget lives in `context/listing.ts`,
    // which is its first and only home. Borrowing `timeouts.enrichmentMs` would
    // tie the `cover` budget to a `context list` that has nothing to do with it.
  });
  const resolution = cached.resolution;

  if (!resolution.ok) {
    const refused = refuse({
      check: RECONCILE_CHECK_FOR_REASON[resolution.reason],
      code: SOURCE_REASON_DIAGNOSTIC_CODE[resolution.reason],
      reason: resolution.reason,
      diagnostic: resolution.diagnostic,
    });
    return { ...refused, resolution };
  }

  // ── Check 7. The fork guard, over the listing the cache already holds. ────
  const sources: readonly StoreSource[] = cached.cache?.sources ?? [];
  const guard = forkGuard({
    repoRoot: request.repoRoot,
    file,
    sources,
    resolved: resolution.source,
    diagnostics: sink,
    ...(request.fileDigest === undefined ? {} : { fileDigest: request.fileDigest }),
  });
  if (guard.forked) {
    const refused = refuse({
      check: 'fork-guard',
      code: FORK_GUARD_DIAGNOSTIC_CODE,
      reason: null,
      diagnostic: guard.diagnostic,
    });
    return { ...refused, resolution, via: resolution.via };
  }

  // ── Every check passed. Now, and only now, the argv exists. ───────────────
  const argv = reconcileArgv(resolution, file);
  if (argv === null || request.invoker === undefined) {
    // `argv === null` is unreachable on this arm — the resolution succeeded — and
    // is kept because the type says so and an outcome nobody planned for is
    // exactly an outcome nobody knows. A missing invoker is reachable and
    // supported (R2.12), and it is a refusal like any other.
    const refused = refuse({
      check: 'kane-unavailable',
      code: RECONCILE_DIAGNOSTIC_CODES.kaneUnavailable,
      reason: null,
      diagnostic: sink.report({
        code: RECONCILE_DIAGNOSTIC_CODES.kaneUnavailable,
        severity: 'warn',
        message:
          `${file} resolved to source ${resolution.source.sourceId}, but there is no Kane ` +
          `boundary to hand it to, so nothing was invoked and every existing verdict is ` +
          `preserved.`,
        file,
      }),
    });
    return { ...refused, resolution, sourceId: resolution.source.sourceId, via: resolution.via };
  }

  const invocation: InvocationResult<typeof RECONCILE_FAMILY> = await request.invoker.invoke({
    family: RECONCILE_FAMILY,
    argv,
    cwd: request.repoRoot,
    timeoutMs: request.config.timeouts.hookMs,
  });
  const stream = parseStream(contractFor(RECONCILE_FAMILY), invocation.stdoutLines, { sink });
  const terminal = stream.kind === 'complete' ? stream.terminal : null;
  const status = terminal === null ? null : normaliseAssuranceStatus(terminal.status);
  const accepted = status === ACCEPTED_ASSURANCE_STATUS;
  const paused = status === 'paused';
  const message = kaneMessage(stream, terminal);
  const staged = stagedItems(stream);
  const kaneRunId = readString(terminal, 'run_id') ?? runId;

  if (stream.kind === 'crashed') {
    // R5.3: outcome unknown. No verdict moves, no card is created, and the graph
    // is not rebuilt — a partial reconciliation is not a reconciliation.
    sink.report({
      code: RECONCILE_DIAGNOSTIC_CODES.outcomeUnknown,
      severity: 'warn',
      message:
        `the reconcile stream for ${file} ended without its '${stream.expectedTerminal}' event, ` +
        `so the outcome is unknown: the promise graph was not rebuilt, no review card was ` +
        `created and every verdict stands.`,
      file,
    });
  } else if (paused) {
    // R5.4: paused with exit 3 is resumable and is **not** a failure.
    sink.report({
      code: RECONCILE_DIAGNOSTIC_CODES.paused,
      severity: 'warn',
      message:
        `reconciliation of ${file} is paused and resumable (exit ${
          invocation.exitCode ?? 'unknown'
        }), so nothing changed: every verdict stands and the graph was not rebuilt.` +
        `${message === null ? '' : ` Kane reported: ${message}`}` +
        `${
          readString(terminal, 'resume') === null
            ? ''
            : ` Resume with: ${readString(terminal, 'resume') ?? ''}`
        }`,
      file,
    });
  } else if (!accepted) {
    // A refusal is a `complete` stream, not a crash (§5.3.1). Kane's own exit 2
    // is data, so its message is quoted rather than summarised.
    sink.report({
      code: RECONCILE_DIAGNOSTIC_CODES.refused,
      severity: 'warn',
      message:
        `reconciliation of ${file} finished with status '${status ?? 'unknown'}' (exit ${
          invocation.exitCode ?? 'unknown'
        }), so nothing was consumed: the graph was not rebuilt and every verdict stands.` +
        `${message === null ? '' : ` Kane reported: ${message}`}`,
      file,
    });
  } else {
    // §13.2.3: the head move lands even under `--plan`. It is a mutation inside
    // Kane's own `.context/` store rather than in this repository, and recording
    // it is what keeps a reviewer from being surprised by it.
    sink.report({
      code: RECONCILE_DIAGNOSTIC_CODES.headMoved,
      severity: 'info',
      message:
        `${file} is now the head of source ${resolution.source.sourceId} (resolved via ` +
        `${resolution.via}). Under \`--plan\` the head move lands inside Kane's context store ` +
        `and every other change is staged into its stored plan; nothing in this repository was ` +
        `committed.${message === null ? '' : ` Kane reported: ${message}`}`,
      file,
    });
  }

  if (staged.length > 0) {
    sink.report({
      code: RECONCILE_DIAGNOSTIC_CODES.staged,
      severity: 'info',
      message:
        `reconciliation of ${file} staged ${staged.length} item${
          staged.length === 1 ? '' : 's'
        } into Kane's stored plan. Nothing is applied: R5.7 holds every change as a review card, ` +
        `and \`kept reconcile apply\` is the only way to walk the plan. Mirroring these into ` +
        `.kept/review-cards/ is task 14.1's; this run created none.`,
      file,
    });
  }

  return {
    file,
    resolution,
    sourceId: resolution.source.sourceId,
    via: resolution.via,
    refusal: null,
    argv: invocation.effectiveArgv,
    invoked: true,
    exitCode: invocation.exitCode,
    exitMeaning: invocation.exitMeaning,
    terminalSeen: terminal !== null,
    status,
    accepted,
    paused,
    headMoved: accepted,
    staged,
    message,
    runId: kaneRunId,
    handoff: writeHandoff({
      repoRoot: request.repoRoot,
      runId: kaneRunId,
      at,
      run: { runId: kaneRunId, exitMeaning: invocation.exitMeaning, stream },
      exitCode: invocation.exitCode,
      trigger: {
        hook: request.trigger?.hook ?? RECONCILE_HOOK,
        event: request.trigger?.event ?? 'fileEdited',
        paths: request.trigger?.paths ?? [file],
      },
      command: {
        family: RECONCILE_FAMILY,
        argv: invocation.effectiveArgv,
        invoked: true,
      },
      // No `results`: reconciliation reports on documents rather than on
      // promises, so there is no promise to authorise a repair for and
      // `nextAction.branch` stays null (R5.7).
      diagnostics: sink.entries,
      ...(request.fileSystem === undefined ? {} : { fileSystem: request.fileSystem }),
    }),
  };
}

/**
 * Run the docs reconciliation (§13.2).
 *
 * One invocation per changed doc, **sequentially**, each with its own resolved
 * source id — sequential because each run moves a head inside Kane's own store
 * and two concurrent head moves over one listing is exactly the fork the guard of
 * §13.2.4 #7 exists to refuse.
 *
 * Never throws for any state of the world: no changed docs, a doc that is not
 * there, a doc that is not ingestable, no `.context/` store (the live state of
 * this repository today), an unreadable listing, a crashed listing, no match, an
 * ambiguous match, a retired source, a fork, no `kane-cli`, a crashed reconcile
 * stream, a pause, our own timeout. Every one of those is a diagnostic plus a
 * handoff, and the exit code stays zero.
 */
export async function runReconcile(request: ReconcileRequest): Promise<ReconcileResult> {
  const sink = request.diagnostics ?? createDiagnosticSink();
  const at = request.at ?? new Date().toISOString();
  const probe = request.probe ?? nodeReconcileFileProbe;
  const changed = request.changed ?? [];
  const filtered = filterChangedDocs(changed, request.repoRoot);

  const store = createStateStore({
    repoRoot: request.repoRoot,
    ...(request.fileSystem === undefined ? {} : { fileSystem: request.fileSystem }),
    sink,
  });
  const prior = store.load();

  sink.report({
    code: RECONCILE_DIAGNOSTIC_CODES.started,
    severity: 'info',
    message:
      `kept reconcile --changed: ${changed.length} saved path(s), ${filtered.docs.length} ` +
      `documentation file(s) inside the hook's pattern set, budget ` +
      `${request.config.timeouts.hookMs} ms`,
  });

  for (const path of filtered.outOfScope) {
    sink.report({
      code: RECONCILE_DIAGNOSTIC_CODES.outOfScope,
      severity: 'info',
      message:
        `${path} is not one of the documentation files reconciliation owns ` +
        `(${FIXTURE_DOC_GLOBS.join(', ')}), so it was ignored. A code change is ` +
        `\`kept verify --changed\`'s, not this command's.`,
      file: path,
    });
  }

  const docs: ReconcileDoc[] = [];
  const handoffs: WriteHandoffResult[] = [];

  if (filtered.docs.length === 0) {
    // §13.2.1: zero changed docs after filtering → no invocation, one diagnostic,
    // exit 0. The handoff is still written, because an agent that reads the
    // *previous* run's handoff repairs the wrong thing (§11.2, R11.4).
    sink.report({
      code: RECONCILE_DIAGNOSTIC_CODES.noChangedDocs,
      severity: 'info',
      message:
        `no changed documentation file survived filtering to ${FIXTURE_DOC_GLOBS.join(', ')}, so ` +
        `\`maintain reconcile\` was not invoked at all: no process, no credits, no review card, ` +
        `and every verdict and the freshness triple stand.`,
    });
    handoffs.push(
      writeHandoff({
        repoRoot: request.repoRoot,
        runId: `${SYNTHETIC_RUN_ID_PREFIX}${at}`,
        at,
        trigger: {
          hook: request.trigger?.hook ?? RECONCILE_HOOK,
          event: request.trigger?.event ?? 'fileEdited',
          paths: request.trigger?.paths ?? changed,
        },
        command: { family: RECONCILE_FAMILY, argv: [], invoked: false },
        diagnostics: sink.entries,
        ...(request.fileSystem === undefined ? {} : { fileSystem: request.fileSystem }),
      }),
    );
  }

  for (const [index, file] of filtered.docs.entries()) {
    const doc = await reconcileOneDoc({ file, index, request, sink, at, probe });
    docs.push(doc);
    handoffs.push(doc.handoff);
  }

  // ── R5.2: rebuild the graph from both providers, gated on the terminal event ─
  //
  // The gate is conjunctive and deliberately narrower than "a `done` arrived": a
  // *paused* reconcile also carries a `done` event, and §13.2.4 and R5.4 both say
  // a pause changes nothing. So an accepting status is the additional condition,
  // exactly as `kept build` treats enrichment acceptance for freshness. A crashed
  // stream, a refusal and a pause all leave `.kept/state.json` untouched — not
  // rewritten byte-identically, untouched — which is what §14.1's "nothing
  // mutated" says literally.
  const accepted = docs.filter((doc) => doc.accepted);
  let state: KeptState = prior;
  let build: BuildResult | null = null;

  if (accepted.length > 0) {
    build = await runBuild({
      repoRoot: request.repoRoot,
      config: request.config,
      diagnostics: sink,
      at,
      ...(request.invoker === undefined ? {} : { invoker: request.invoker }),
      ...(request.fileSystem === undefined ? {} : { fileSystem: request.fileSystem }),
      ...(request.baselineFileSystem === undefined
        ? {}
        : { baselineFileSystem: request.baselineFileSystem }),
      ...(request.citations === undefined ? {} : { citations: request.citations }),
    });
    state = build.state;
    sink.report({
      code: RECONCILE_DIAGNOSTIC_CODES.rebuilt,
      severity: 'info',
      message:
        `the promise graph was rebuilt from both providers after ${accepted.length} terminal ` +
        `'done' event(s): ${state.graph.promises.length} promise(s), of which ` +
        `${state.graph.promises.filter((promise) => promise.verdict === 'undesigned').length} ` +
        `are undesigned — the outstanding suite debt the ledger reports (R5.5, R5.8).`,
    });
  } else {
    sink.report({
      code: RECONCILE_DIAGNOSTIC_CODES.rebuildHeld,
      severity: 'info',
      message:
        `no reconciliation reached an accepted terminal 'done' event, so the promise graph was ` +
        `not rebuilt and .kept/state.json was left exactly as it was: every verdict and the ` +
        `freshness triple stand at ${prior.freshness.terminalEventAt ?? 'never verified'}.`,
    });
  }

  const snapshot = runSnapshot({
    repoRoot: request.repoRoot,
    state,
    generatedAt: at,
    diagnostics: sink,
    ...(request.fileSystem === undefined ? {} : { fileSystem: request.fileSystem }),
  });

  const invocations = docs.filter((doc) => doc.invoked).length;
  sink.report({
    code: RECONCILE_DIAGNOSTIC_CODES.completed,
    severity: 'info',
    message:
      `kept reconcile --changed: ${filtered.docs.length} document(s), ${invocations} ` +
      `invocation(s), ${docs.filter((doc) => doc.refusal !== null).length} refusal(s), ` +
      `${docs.reduce((total, doc) => total + doc.staged.length, 0)} staged item(s), no review ` +
      `card created and no verdict written`,
  });

  return {
    docs: Object.freeze(docs),
    outOfScope: filtered.outOfScope,
    invocations,
    state,
    statePath: store.path,
    rebuilt: build !== null,
    build,
    reviewCards: null,
    handoffs: Object.freeze(handoffs),
    snapshot,
    diagnostics: sink.entries,
  };
}

// ---------------------------------------------------------------------------
// `kept reconcile apply [planPath]` — human-only (§13.2.3)
// ---------------------------------------------------------------------------

/** {@link runReconcileApply}'s input. */
export interface ReconcileApplyRequest {
  readonly repoRoot: string;
  readonly config: KeptConfig;
  /** The plan to walk. Null or absent walks the latest, behind Kane's prompt. */
  readonly planPath?: string | null | undefined;
  readonly invoker?: KaneInvoker | undefined;
  readonly fileSystem?: StateFileSystem | undefined;
  readonly diagnostics?: CollectingDiagnosticSink | undefined;
  readonly at?: string | undefined;
}

/** What {@link runReconcileApply} did. */
export interface ReconcileApplyResult {
  readonly planPath: string | null;
  /** argv actually issued, `--mode agent` included. Empty when nothing ran. */
  readonly argv: readonly string[];
  readonly invoked: boolean;
  readonly exitCode: number | null;
  readonly exitMeaning: ExitMeaning | null;
  readonly terminalSeen: boolean;
  readonly status: string | null;
  readonly accepted: boolean;
  readonly paused: boolean;
  readonly message: string | null;
  /** Items the walked plan reported. Task 14.1 mirrors them into review cards. */
  readonly staged: readonly Record<string, unknown>[];
  readonly runId: string;
  readonly handoff: WriteHandoffResult;
  readonly snapshot: SnapshotResult;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Walk a stored plan (§13.2.3). **Human-only**: no hook invokes this, both hook
 * prompts forbid it by name, and `kept reconcile --changed` cannot reach it.
 *
 * `--apply` bare walks the latest stored plan behind Kane's own approval prompt;
 * a path selects one. `--plan` is never composed alongside it — see
 * {@link reconcileApplyArgv} and {@link reconcileUsageErrors} — so the invalid
 * combination never reaches Kane, and rejecting it is the one case `kept` itself
 * exits non-zero.
 *
 * The graph is **not** rebuilt here. An apply is a human walking a plan behind an
 * approval prompt, and `kept build` is one command away; rebuilding automatically
 * would spend a `cover` run on a decision the human has not finished making.
 */
export async function runReconcileApply(
  request: ReconcileApplyRequest,
): Promise<ReconcileApplyResult> {
  const sink = request.diagnostics ?? createDiagnosticSink();
  const at = request.at ?? new Date().toISOString();
  const planPath = request.planPath ?? null;
  const declared = reconcileApplyArgv(planPath);
  const runId = `${SYNTHETIC_RUN_ID_PREFIX}apply:${at}`;

  sink.report({
    code: RECONCILE_DIAGNOSTIC_CODES.applyStarted,
    severity: 'info',
    message:
      `kept reconcile apply${planPath === null ? '' : ` ${planPath}`}: a human-only walk of ` +
      `${planPath === null ? 'the latest stored plan' : planPath} behind Kane's approval ` +
      `prompt. No hook invokes this command.`,
  });

  const invocation: InvocationResult<typeof RECONCILE_FAMILY> | null =
    request.invoker === undefined
      ? null
      : await request.invoker.invoke({
          family: RECONCILE_FAMILY,
          argv: declared,
          cwd: request.repoRoot,
          timeoutMs: request.config.timeouts.hookMs,
        });

  if (invocation === null) {
    sink.report({
      code: RECONCILE_DIAGNOSTIC_CODES.kaneUnavailable,
      severity: 'warn',
      message:
        `there is no Kane boundary to walk the stored plan with, so nothing was invoked and ` +
        `nothing was applied (R2.12).`,
    });
  }

  const stream =
    invocation === null
      ? null
      : parseStream(contractFor(RECONCILE_FAMILY), invocation.stdoutLines, { sink });
  const terminal = stream !== null && stream.kind === 'complete' ? stream.terminal : null;
  const status = terminal === null ? null : normaliseAssuranceStatus(terminal.status);
  const accepted = status === ACCEPTED_ASSURANCE_STATUS;
  const paused = status === 'paused';
  const message = kaneMessage(stream, terminal);
  const staged = stagedItems(stream);

  if (stream !== null && stream.kind === 'crashed') {
    sink.report({
      code: RECONCILE_DIAGNOSTIC_CODES.outcomeUnknown,
      severity: 'warn',
      message:
        `the apply stream ended without its '${stream.expectedTerminal}' event, so the outcome ` +
        `is unknown and every verdict stands.`,
    });
  } else if (paused) {
    sink.report({
      code: RECONCILE_DIAGNOSTIC_CODES.paused,
      severity: 'warn',
      message:
        `the plan walk is paused and resumable (exit ${invocation?.exitCode ?? 'unknown'}), so ` +
        `nothing changed.${message === null ? '' : ` Kane reported: ${message}`}`,
    });
  } else if (stream !== null && !accepted) {
    sink.report({
      code: RECONCILE_DIAGNOSTIC_CODES.refused,
      severity: 'warn',
      message:
        `the plan walk finished with status '${status ?? 'unknown'}' (exit ` +
        `${invocation?.exitCode ?? 'unknown'}), so nothing was applied.` +
        `${message === null ? '' : ` Kane reported: ${message}`}`,
    });
  }

  const resolvedRunId = readString(terminal, 'run_id') ?? runId;
  // Passed as an explicit `null` rather than omitted, so the family this handoff
  // is generic over is inferred from the outcome instead of widening to every
  // family — a handoff typed over all three would let an `ExecutionRun` terminal
  // be read off an Assurance stream.
  const outcome: RunOutcome<typeof RECONCILE_FAMILY> | null =
    invocation === null || stream === null
      ? null
      : { runId: resolvedRunId, exitMeaning: invocation.exitMeaning, stream };

  const handoff = writeHandoff({
    repoRoot: request.repoRoot,
    runId: resolvedRunId,
    at,
    run: outcome,
    exitCode: invocation?.exitCode ?? null,
    // `hook: null` is the whole point: a human ran this (§11.2).
    trigger: { hook: null, event: null, paths: planPath === null ? [] : [planPath] },
    command: {
      family: RECONCILE_FAMILY,
      argv: invocation?.effectiveArgv ?? [],
      invoked: invocation !== null,
    },
    diagnostics: sink.entries,
    ...(request.fileSystem === undefined ? {} : { fileSystem: request.fileSystem }),
  });

  const snapshot = runSnapshot({
    repoRoot: request.repoRoot,
    generatedAt: at,
    diagnostics: sink,
    ...(request.fileSystem === undefined ? {} : { fileSystem: request.fileSystem }),
  });

  sink.report({
    code: RECONCILE_DIAGNOSTIC_CODES.completed,
    severity: 'info',
    message:
      `kept reconcile apply: ${invocation === null ? 'no' : 'one'} invocation, status ` +
      `'${status ?? 'none'}', ${staged.length} item(s) reported, no verdict written`,
  });

  return {
    planPath,
    argv: invocation?.effectiveArgv ?? Object.freeze([]),
    invoked: invocation !== null,
    exitCode: invocation?.exitCode ?? null,
    exitMeaning: invocation?.exitMeaning ?? null,
    terminalSeen: terminal !== null,
    status,
    accepted,
    paused,
    message,
    staged,
    runId: resolvedRunId,
    handoff,
    snapshot,
    diagnostics: sink.entries,
  };
}
