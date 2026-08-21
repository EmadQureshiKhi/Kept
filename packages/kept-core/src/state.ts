/**
 * The single verdict write guard, and the working-state store behind it
 * (design §4.8, §14.1 step 6, R2.10, R3.7, R5.3, R5.4, R11.8–R11.11).
 *
 * The ledger's entire claim is that it never overstates what it has proved. That
 * claim reduces to one predicate, stated once, in this file:
 *
 * > A verdict may move **only** on a proven outcome — the stream reached its
 * > family's terminal event **and** the process exit meant success or failure.
 *
 * Both halves, always. A crashed run that overwrote a green verdict with red
 * would be a lie; one that overwrote red with green would be worse. And an
 * Assurance exit 3 is a *resumable pause* (§4.5, A14): misreading it as a
 * failure would overwrite good verdicts with red ones **and** destroy the state
 * the pause could have been resumed from. So neither half is re-derived here:
 *
 * - the exit-code half is {@link permitsVerdictWrite} from `kane/exit.ts`, which
 *   reads {@link WRITE_PERMITTING_EXIT_MEANINGS}. This file names no exit
 *   meaning at all. A ninth `ExitMeaning` member cannot join the writable side
 *   by being added, because the set it would have to join lives in one place and
 *   is asserted by name there and by Property 9 here.
 * - the stream half is the `kind` discriminant of `ParsedStream`. `terminal`
 *   exists only on the `complete` arm, so once {@link mayWriteVerdicts} has
 *   narrowed an outcome the terminal event is *reachable*, and before it has,
 *   reading one is a compile error rather than an `undefined` that reads as a
 *   pass.
 *
 * ## "By construction", not "by an `if` at each call site"
 *
 * {@link applyRun} is the only exported way to move a verdict. It calls the
 * guard **first**, and on refusal returns the prior state — the same object,
 * by reference, not a copy that happens to be equal. There is no code path
 * through this module that reaches a verdict assignment without the guard having
 * answered true, and no second writer for a later task to forget about.
 *
 * Two consequences worth stating:
 *
 * **Freshness moves with verdicts, never without them.** The three freshness
 * fields describe one thing — the newest consumed terminal event — so they are
 * written together from the outcome (§9.1 rule 5 requires the type to be the one
 * that family's contract fixes, and `contractFor()` is where that is read from)
 * or not written at all. A refusal leaves the prior triple in place, which is
 * exactly what R3.7 and R11.8 ask for: a stream whose outcome is unknown must
 * not advance the freshness chip either.
 *
 * **A refusal is recorded, never thrown.** A crashed stream, a timeout, a pause
 * and a missing binary are all states of the world, and §14.2 reserves
 * exceptions for programming errors. So the refusal reasons come back as data
 * plus diagnostics on the injected sink, and — deliberately — *not* inside the
 * returned state, because appending a diagnostic to the state would mean the
 * state had changed and "returns the state unchanged" would stop being literally
 * true.
 *
 * ## Deep-freezing, and why it coexists with canonical serialisation
 *
 * Every state this module returns is deep-frozen, so a downstream mutation is a
 * runtime error (a `TypeError` under strict mode, which every ES module is)
 * rather than silent ledger corruption. Untouched promise records are carried
 * across **by reference**, so an out-of-radius promise is byte-identical to its
 * prior self in the strongest available sense — it *is* its prior self.
 *
 * `Object.freeze` is the right tool precisely because it does not change what a
 * value is: a frozen plain object still has `Object.prototype`, so
 * `canonicaliseSnapshot` (model/canonical.ts) accepts it. A `Map`, a `Set` or a
 * class instance would have been rejected there by name, which is why no such
 * value appears in {@link KeptState}. `.kept/state.json` therefore stays plain
 * JSON with explicit nulls, no `Date`, no `undefined` and no `NaN`.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import type { Diagnostic, DiagnosticClock, DiagnosticSink } from './diagnostics.js';
import { createDiagnosticSink } from './diagnostics.js';
import type { MemberEndStatus } from './kane/events.js';
import { permitsVerdictWrite, type ExitMeaning } from './kane/exit.js';
import { contractFor, type CommandFamily } from './kane/family.js';
import type { InvocationResult } from './kane/invoker.js';
import type { CompleteStream, ParsedStream } from './kane/ndjson.js';
import {
  createPromiseGraph,
  isPromiseGraph,
  type PromiseGraph,
  type PromiseRecord,
  type RepairAnnotation,
  type Verdict,
  type VerdictSource,
} from './model/promise.js';
import type { SnapshotFreshness } from './model/snapshot.js';

// ---------------------------------------------------------------------------
// The state file
// ---------------------------------------------------------------------------

/** The only working-state schema version this build reads or writes. */
export const STATE_SCHEMA_VERSION = 1;

/**
 * Where the working state lives, relative to the repository root.
 *
 * Gitignored on purpose (`.kept/*` with a `!.kept/config.json` negation): it is
 * single-writer machine state, not a reviewable artefact. The reviewable
 * artefact is `apps/ledger/data/ledger.snapshot.json`, written by task 3.18
 * through `serialiseSnapshot`.
 */
export const STATE_FILE_RELATIVE_PATH = '.kept/state.json';

/**
 * Freshness of the newest consumed terminal event (R9.6, R9.7).
 *
 * An alias of the snapshot's own freshness type rather than a second
 * declaration, so the store and the CLI↔UI seam cannot drift apart on the
 * all-three-or-none rule the snapshot schema enforces.
 */
export type StateFreshness = SnapshotFreshness;

/** Nothing has been consumed yet: all three fields absent, together. */
export const EMPTY_FRESHNESS: StateFreshness = Object.freeze({
  terminalEventAt: null,
  terminalEventType: null,
  commandFamily: null,
});

/**
 * The persisted working state.
 *
 * Deliberately small: the graph the last build produced, the freshness of the
 * newest terminal event consumed into it, and when it was written. Everything
 * else the Ledger renders is derived — `computeMetrics(state.graph)` for the
 * metric rail, the snapshot writer for the committed file.
 */
export interface KeptState {
  readonly schemaVersion: number;
  /** ISO 8601 instant this state was produced. A string, never a `Date`. */
  readonly updatedAt: string;
  readonly freshness: StateFreshness;
  readonly graph: PromiseGraph;
}

/** What a caller supplies to build a state. Every field has an honest default. */
export interface KeptStateInput {
  readonly updatedAt?: string;
  readonly freshness?: StateFreshness;
  readonly graph?: PromiseGraph;
}

/**
 * Build a state, deep-frozen.
 *
 * The single construction site, which is what makes the freeze structural: there
 * is no way to obtain a {@link KeptState} from this module that a later task
 * could mutate in place.
 */
export function createKeptState(input: KeptStateInput = {}): KeptState {
  return deepFreeze<KeptState>({
    schemaVersion: STATE_SCHEMA_VERSION,
    updatedAt: input.updatedAt ?? new Date(0).toISOString(),
    freshness: input.freshness ?? EMPTY_FRESHNESS,
    graph: input.graph ?? createPromiseGraph(),
  });
}

// ---------------------------------------------------------------------------
// Deep freezing
// ---------------------------------------------------------------------------

/**
 * Freeze a value and everything reachable from it, in place, and return it.
 *
 * Cycle-safe through a `WeakSet` even though plain JSON has no cycles — this
 * runs over data that arrived from a JSON file and from generated property
 * inputs, and a stack overflow is a worse failure than an extra allocation.
 * Frozen subtrees are revisited once and skipped, so re-freezing a state that
 * was already frozen is cheap.
 */
export function deepFreeze<T>(value: T): T {
  freezeReachable(value, new WeakSet<object>());
  return value;
}

function freezeReachable(value: unknown, seen: WeakSet<object>): void {
  if (typeof value !== 'object' || value === null) return;
  const subject = value as Record<string, unknown>;
  if (seen.has(subject)) return;
  seen.add(subject);
  Object.freeze(subject);
  for (const key of Object.keys(subject)) freezeReachable(subject[key], seen);
}

// ---------------------------------------------------------------------------
// The run outcome — both halves of the guard, structurally present
// ---------------------------------------------------------------------------

/**
 * One finished Kane invocation, as the state store sees it.
 *
 * `KaneInvoker.invoke()` returns `stdoutLines` rather than a `ParsedStream`
 * (design §4.7), so the two halves of a proven outcome arrive from two places:
 * the exit meaning from the process, the stream classification from the parser.
 * This type is where they are paired, and it carries **exactly** those two
 * halves plus the run's identity — nothing that could be mistaken for a third
 * source of truth about whether the run proved anything.
 *
 * `stream` is a `ParsedStream<F>`, not a `CompleteStream<F>`, because an
 * outcome that never reached its terminal event is a perfectly ordinary thing
 * for this store to be handed. Narrowing it is {@link mayWriteVerdicts}' job.
 */
export interface RunOutcome<F extends CommandFamily> {
  /** Kane's `run_id`, or the synthetic id of the invocation. */
  readonly runId: string;
  /** The process exit, already interpreted against the family (§4.5, R11.9). */
  readonly exitMeaning: ExitMeaning;
  /** The stream, parsed under that family's contract (§4.2). */
  readonly stream: ParsedStream<F>;
}

/**
 * An outcome the guard has accepted: the terminal event is present and
 * reachable, so a verdict read off it is a verdict the run actually reported.
 *
 * The narrowing is on the stream arm only. The exit-meaning half is a runtime
 * set membership by design — {@link WRITE_PERMITTING_EXIT_MEANINGS} is the one
 * authority on it, and a type-level copy of its two members here would be the
 * second authority this module exists to avoid.
 */
export interface ProvenRunOutcome<F extends CommandFamily> extends RunOutcome<F> {
  readonly stream: CompleteStream<F>;
}

/**
 * Pair an invoker result with its parsed stream.
 *
 * The exit meaning is *read* from the result and never recomputed: `exitMeaning`
 * is already applied per family inside the invoker, and interpreting the code a
 * second time here would be a second place for the Assurance exit-3 rule to be
 * got wrong. The `F` parameter threads through both arguments, so a stream
 * parsed under one family cannot be paired with another family's invocation.
 */
export function outcomeFromInvocation<F extends CommandFamily>(
  runId: string,
  result: InvocationResult<F>,
  stream: ParsedStream<F>,
): RunOutcome<F> {
  return { runId, exitMeaning: result.exitMeaning, stream };
}

/**
 * **The single write guard** (design §4.8).
 *
 * True only when the stream reached its family's terminal event *and* the exit
 * meaning is one the {@link WRITE_PERMITTING_EXIT_MEANINGS} set admits. No exit
 * meaning is named in this function, and the terminal-event type is not either.
 *
 * Declared as a type predicate rather than a plain `boolean` so that the
 * narrowing a caller needs comes from the same call that authorised the write:
 * after `if (mayWriteVerdicts(outcome))`, `outcome.stream.terminal` exists.
 * Before it, the field is not on the type.
 */
export function mayWriteVerdicts<F extends CommandFamily>(
  outcome: RunOutcome<F>,
): outcome is ProvenRunOutcome<F> {
  return outcome.stream.kind === 'complete' && permitsVerdictWrite(outcome.exitMeaning);
}

/** Why a write was refused. Both halves can fail at once, so this is a list. */
export const WRITE_REFUSAL_REASONS = Object.freeze([
  'stream-crashed',
  'exit-meaning-unproven',
] as const);

/** One of the two ways an outcome can fail to be proven. */
export type WriteRefusalReason = (typeof WRITE_REFUSAL_REASONS)[number];

/**
 * Which halves of the guard an outcome failed, in table order. Empty exactly
 * when {@link mayWriteVerdicts} is true — the two functions are one statement
 * read two ways, which is what lets a diagnostic name the real reason instead of
 * saying only that something was refused.
 */
export function writeRefusals<F extends CommandFamily>(
  outcome: RunOutcome<F>,
): readonly WriteRefusalReason[] {
  const refusals: WriteRefusalReason[] = [];
  if (outcome.stream.kind !== 'complete') refusals.push('stream-crashed');
  if (!permitsVerdictWrite(outcome.exitMeaning)) refusals.push('exit-meaning-unproven');
  return refusals;
}

// ---------------------------------------------------------------------------
// Applying a run
// ---------------------------------------------------------------------------

/** Diagnostic codes this module reports. Stable; the Ledger keys off them. */
export const STATE_DIAGNOSTIC_CODES = Object.freeze({
  refusedCrashedStream: 'state-write-refused-crashed-stream',
  refusedExitMeaning: 'state-write-refused-exit-meaning',
  unknownPromise: 'state-write-unknown-promise',
  outsideRadius: 'state-write-outside-radius',
  loadUnreadable: 'state-load-unreadable',
  loadInvalid: 'state-load-invalid',
});

/** The codes as a list, so a test can enumerate them. */
export const STATE_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(STATE_DIAGNOSTIC_CODES),
);

/**
 * One verdict the caller wants written, addressed by promise id.
 *
 * There is deliberately no `verdictSource` field. Provenance is *built* by
 * {@link applyRun} from the outcome — the run id, the family's terminal event
 * type and the consumed instant — so a verdict cannot be written without it, and
 * cannot be written carrying a terminal event type that disagrees with the
 * family it came from.
 */
export interface VerdictWrite {
  readonly promiseId: string;
  readonly verdict: Verdict;
  /** Verbatim member status for a testrun verdict, null elsewhere (R4.9). */
  readonly memberStatus?: MemberEndStatus | null;
  /** Already through the coercing accessor of `kane/coerce.ts` (§4.4, R3.12). */
  readonly resultCode?: number | null;
  readonly reasonCode?: string | null;
  readonly repair?: RepairAnnotation | null;
  readonly evidencePackId?: string | null;
  readonly credits?: number | null;
}

/** What {@link applyRun} needs beyond the prior state. */
export interface ApplyRunRequest<F extends CommandFamily> {
  readonly outcome: RunOutcome<F>;
  /** The verdicts to write. Empty is fine — a proven run may change nothing. */
  readonly writes?: readonly VerdictWrite[];
  /**
   * The blast radius, as promise ids. `null` means "no radius was computed" and
   * every write applies; a list means every promise outside it is carried across
   * by reference, byte-identical, verdict source and freshness included (R4.15).
   */
  readonly radius?: readonly string[] | null;
  /** The instant of the consumed terminal event. Defaults to the store's clock. */
  readonly at?: string;
  /** Where refusals and skips are recorded. Defaults to a throwaway sink. */
  readonly sink?: DiagnosticSink;
}

/** What one application of a run did, or declined to do. */
export interface ApplyRunResult {
  /** The new state, or — on refusal — the prior state, by reference. */
  readonly state: KeptState;
  /** Whether the guard authorised the write. */
  readonly wrote: boolean;
  /** Empty exactly when `wrote` is true. */
  readonly refusals: readonly WriteRefusalReason[];
  /** Promise ids whose verdict moved, sorted. */
  readonly updatedPromiseIds: readonly string[];
  /** Promise ids named by a write that was not applied, sorted. */
  readonly skippedPromiseIds: readonly string[];
  /** Everything recorded, in report order. Also reported to the sink. */
  readonly diagnostics: readonly Diagnostic[];
}

/** Read a clock defensively: a broken clock must not take the process down. */
function stampIso(clock: DiagnosticClock): string {
  let value: Date;
  try {
    value = clock();
  } catch {
    value = new Date();
  }
  const ms = value instanceof Date ? value.getTime() : Number.NaN;
  return new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString();
}

/** Sorted copy, so the two id lists in a result are order-independent. */
function sortedIds(ids: Iterable<string>): readonly string[] {
  return [...ids].sort();
}

/**
 * Apply a finished run to a state.
 *
 * **The guard runs first.** Nothing below it is reachable for an unproven
 * outcome: the early return hands back the prior state *by reference*, so
 * "verdicts and freshness are unchanged" is not a property of the copying code
 * below — there is no copying code below to get wrong.
 *
 * On a proven outcome:
 *
 * - each write that names a promise in the graph and inside the radius produces
 *   a new record carrying the new verdict and a freshly built
 *   {@link VerdictSource};
 * - every other promise is carried across **by reference**, so it is its prior
 *   self and not a copy of it;
 * - freshness moves to this run's terminal event, all three fields together,
 *   with the type read from the family contract rather than restated;
 * - the whole result is deep-frozen.
 */
export function applyRun<F extends CommandFamily>(
  state: KeptState,
  request: ApplyRunRequest<F>,
): ApplyRunResult {
  const sink = request.sink ?? createDiagnosticSink();
  const diagnostics: Diagnostic[] = [];
  const { outcome } = request;

  // ── The guard. First, and the only authorisation to write. ────────────────
  if (!mayWriteVerdicts(outcome)) {
    const refusals = writeRefusals(outcome);
    for (const reason of refusals) {
      diagnostics.push(
        sink.report(
          reason === 'stream-crashed'
            ? {
                code: STATE_DIAGNOSTIC_CODES.refusedCrashedStream,
                severity: 'warn',
                message:
                  `run ${outcome.runId}: the ${outcome.stream.family} stream ended without ` +
                  `its ${
                    outcome.stream.kind === 'crashed'
                      ? outcome.stream.expectedTerminal
                      : contractFor(outcome.stream.family).terminalType
                  } event, so the outcome is unknown; ` +
                  `prior verdicts and freshness are preserved`,
              }
            : {
                code: STATE_DIAGNOSTIC_CODES.refusedExitMeaning,
                severity: 'warn',
                message:
                  `run ${outcome.runId}: exit meaning '${outcome.exitMeaning}' does not prove ` +
                  `an outcome, so prior verdicts and freshness are preserved`,
              },
        ),
      );
    }
    return {
      // The prior state itself, frozen so a caller cannot edit what it was told
      // was unchanged. No new object: identity is the strongest form of "unchanged".
      state: deepFreeze(state),
      wrote: false,
      refusals,
      updatedPromiseIds: [],
      skippedPromiseIds: sortedIds((request.writes ?? []).map((write) => write.promiseId)),
      diagnostics,
    };
  }

  // ── Past the guard: this run reached its terminal event and proved something.
  const at = request.at ?? new Date().toISOString();
  const family = outcome.stream.family;
  // The terminal event type comes from the contract table, encoded once in
  // `kane/family.ts`, which is also what the snapshot's freshness consistency
  // rule checks against. Reading it off the event would be a second derivation.
  const terminalEventType = contractFor(family).terminalType;
  const radius = request.radius ?? null;
  const inRadius = radius === null ? null : new Set(radius);

  const byId = new Map<string, VerdictWrite>();
  const skipped = new Set<string>();
  const known = new Set(state.graph.promises.map((promise) => promise.id));

  for (const write of request.writes ?? []) {
    if (!known.has(write.promiseId)) {
      skipped.add(write.promiseId);
      diagnostics.push(
        sink.report({
          code: STATE_DIAGNOSTIC_CODES.unknownPromise,
          severity: 'warn',
          message:
            `run ${outcome.runId}: no promise '${write.promiseId}' in the graph, so the ` +
            `'${write.verdict}' verdict was not written`,
        }),
      );
      continue;
    }
    if (inRadius !== null && !inRadius.has(write.promiseId)) {
      skipped.add(write.promiseId);
      diagnostics.push(
        sink.report({
          code: STATE_DIAGNOSTIC_CODES.outsideRadius,
          severity: 'info',
          message:
            `run ${outcome.runId}: promise '${write.promiseId}' is outside the blast radius, ` +
            `so its verdict and freshness are preserved verbatim`,
        }),
      );
      continue;
    }
    // Last write for an id wins. A testrun reports one member at a time and the
    // caller may fold several into one application; silently keeping the first
    // would drop the newest fact.
    byId.set(write.promiseId, write);
  }

  const updated = new Set<string>();
  const promises = state.graph.promises.map((promise) => {
    const write = byId.get(promise.id);
    // Untouched: the prior record itself, not a copy of it.
    if (write === undefined) return promise;
    updated.add(promise.id);
    const verdictSource: VerdictSource = {
      runId: outcome.runId,
      terminalEventType,
      at,
      memberStatus: write.memberStatus ?? null,
      resultCode: write.resultCode ?? null,
      reasonCode: write.reasonCode ?? null,
    };
    const next: PromiseRecord = {
      ...promise,
      verdict: write.verdict,
      verdictSource,
      // A repair annotation belongs to a *failure*. Carrying one forward onto a
      // verdict that now passes is how the closed loop of 15.6 first published a
      // `proven` promise still labelled `docs-lie`: the run that repaired it wrote
      // `repair: null`, and `?? promise.repair` resurrected the annotation from the
      // run that broke it. A promise Kane just proved has nothing to repair, so the
      // annotation is cleared rather than preserved — for `red` and `stale` the
      // prior annotation is still the best available reading and is kept.
      repair: write.verdict === 'proven' ? null : write.repair ?? promise.repair,
      evidencePackId: write.evidencePackId ?? promise.evidencePackId,
      credits: write.credits ?? promise.credits,
    };
    return next;
  });

  const nextState = createKeptState({
    updatedAt: at,
    // All three fields, together, or none. A proven outcome always has all three.
    freshness: { terminalEventAt: at, terminalEventType, commandFamily: family },
    graph: createPromiseGraph({
      promises,
      edges: state.graph.edges,
      degraded: state.graph.degraded,
      degradedReasons: state.graph.degradedReasons,
      diagnostics: state.graph.diagnostics,
    }),
  });

  return {
    state: nextState,
    wrote: true,
    refusals: [],
    updatedPromiseIds: sortedIds(updated),
    skippedPromiseIds: sortedIds(skipped),
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** The filesystem seam, so every test in this file's suite runs without disk. */
export interface StateFileSystem {
  /** File contents, or null when the file is absent or unreadable. */
  readFile(path: string): string | null;
  /** Create the containing directory, recursively. Never throws for existence. */
  ensureDir(path: string): void;
  writeFile(path: string, contents: string): void;
}

/** An in-memory filesystem. The store's tests use this; so may a caller's. */
export function inMemoryStateFileSystem(
  seed: Readonly<Record<string, string>> = {},
): StateFileSystem & { readonly files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(seed));
  return {
    files,
    readFile(path: string): string | null {
      return files.get(path) ?? null;
    },
    ensureDir(): void {
      // Directories are implicit in a map.
    },
    writeFile(path: string, contents: string): void {
      files.set(path, contents);
    },
  };
}

/** Structural guard for a state read back off disk. */
export function isKeptState(value: unknown): value is KeptState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['schemaVersion'] !== STATE_SCHEMA_VERSION) return false;
  const updatedAt = candidate['updatedAt'];
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) return false;
  if (!isStateFreshness(candidate['freshness'])) return false;
  if (!isPromiseGraph(candidate['graph'])) return false;
  return true;
}

/**
 * Structural guard for freshness, including the all-three-or-none rule the
 * snapshot schema enforces on the way out (§9.1 rule 5). A state file carrying
 * two of the three fields would produce a snapshot that fails the Ledger build,
 * so it is rejected here where the fallback is harmless.
 */
export function isStateFreshness(value: unknown): value is StateFreshness {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const at = candidate['terminalEventAt'];
  const type = candidate['terminalEventType'];
  const family = candidate['commandFamily'];
  const present = [at, type, family].filter((field) => field !== null).length;
  if (present !== 0 && present !== 3) return false;
  if (at !== null && (typeof at !== 'string' || Number.isNaN(Date.parse(at)))) return false;
  if (type !== null && typeof type !== 'string') return false;
  if (family !== null && typeof family !== 'string') return false;
  return true;
}

/** How the state file is spelled. Two-space JSON, one trailing newline. */
export function serialiseState(state: KeptState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

/** Construction options. Every default is production; every override is a seam. */
export interface StateStoreOptions {
  /** Absolute repository root. The state file sits at `.kept/state.json` under it. */
  readonly repoRoot: string;
  readonly fileSystem?: StateFileSystem;
  readonly sink?: DiagnosticSink;
  readonly clock?: DiagnosticClock;
}

/**
 * The working-state store: load, save, and the one path a verdict may move
 * along.
 */
export interface StateStore {
  /** Absolute path of the state file. */
  readonly path: string;
  /**
   * Read the state. An absent, unreadable, malformed or wrong-version file
   * answers an empty state plus a diagnostic — none of those is a programming
   * error, and refusing to start because working state was corrupted would take
   * the ledger down over a cache (§14.2).
   */
  load(): KeptState;
  /** Write the state, creating `.kept/` if needed. Returns what was written. */
  save(state: KeptState): KeptState;
  /** {@link applyRun}, with the store's clock and sink filled in. */
  applyRun<F extends CommandFamily>(
    state: KeptState,
    request: ApplyRunRequest<F>,
  ): ApplyRunResult;
}

/** Join two path fragments with a POSIX separator, without importing `node:path`. */
function joinPath(root: string, relative: string): string {
  return root.endsWith('/') ? `${root}${relative}` : `${root}/${relative}`;
}

/** The directory part of a path, or the path itself when it has no separator. */
function dirOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? path : path.slice(0, cut);
}

/** Create a store. Pass `fileSystem` to keep a test off disk entirely. */
export function createStateStore(options: StateStoreOptions): StateStore {
  const path = joinPath(options.repoRoot, STATE_FILE_RELATIVE_PATH);
  const fileSystem = options.fileSystem ?? nodeStateFileSystem();
  const clock: DiagnosticClock = options.clock ?? ((): Date => new Date());
  const sink = options.sink ?? createDiagnosticSink({ clock });

  return {
    path,
    load(): KeptState {
      const text = fileSystem.readFile(path);
      if (text === null) return createKeptState({ updatedAt: stampIso(clock) });
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (error) {
        sink.report({
          code: STATE_DIAGNOSTIC_CODES.loadUnreadable,
          severity: 'warn',
          message:
            `${STATE_FILE_RELATIVE_PATH} is not valid JSON (` +
            `${error instanceof Error ? error.message : String(error)}); ` +
            `starting from an empty state`,
          file: STATE_FILE_RELATIVE_PATH,
        });
        return createKeptState({ updatedAt: stampIso(clock) });
      }
      if (!isKeptState(raw)) {
        sink.report({
          code: STATE_DIAGNOSTIC_CODES.loadInvalid,
          severity: 'warn',
          message:
            `${STATE_FILE_RELATIVE_PATH} does not match state schema version ` +
            `${STATE_SCHEMA_VERSION}; starting from an empty state`,
          file: STATE_FILE_RELATIVE_PATH,
        });
        return createKeptState({ updatedAt: stampIso(clock) });
      }
      return deepFreeze(raw);
    },
    save(state: KeptState): KeptState {
      fileSystem.ensureDir(dirOf(path));
      fileSystem.writeFile(path, serialiseState(state));
      return deepFreeze(state);
    },
    applyRun<F extends CommandFamily>(
      state: KeptState,
      request: ApplyRunRequest<F>,
    ): ApplyRunResult {
      return applyRun(state, {
        ...request,
        at: request.at ?? stampIso(clock),
        sink: request.sink ?? sink,
      });
    },
  };
}

/**
 * The production filesystem. Imported lazily through `node:fs`'s sync API, which
 * is what the rest of this package already uses for small local reads.
 */
export function nodeStateFileSystem(): StateFileSystem {
  return {
    readFile(path: string): string | null {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    ensureDir(path: string): void {
      try {
        mkdirSync(path, { recursive: true });
      } catch {
        // An existing directory, or a permission problem the write below will
        // report far more precisely than a swallowed mkdir would.
      }
    },
    writeFile(path: string, contents: string): void {
      writeFileSync(path, contents, 'utf8');
    },
  };
}
