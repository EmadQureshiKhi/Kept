/**
 * `kept evolve <testPath>` — the `test-drift` repair branch (design §8.1, §8.2,
 * §13.1, §4.9, §14.1, R5.7, R7.2, R7.7, R2.10, R2.12).
 *
 * §8.1 gives this branch autonomy **hold**: Kane may propose, KEPT may record, and
 * nothing is ever applied. The artefact is `.kept/review-cards/<id>.json` and
 * `repair/reviewCard.ts` owns it; this file owns the argv, the probe that decides
 * whether that argv can be issued at all, and the honest card for the case where it
 * cannot.
 *
 * ## The flag probe, and why it is not defensive padding
 *
 * §13.1 specifies the invocation as `maintain evolve <ref> --mode agent`. §4.9 then
 * states the operating rule that makes a probe necessary rather than cautious: help
 * omissions prove nothing, so probe `kane-cli <cmd> --help` before concluding
 * anything, and rank observed runtime behaviour above every published document.
 * Applied here, the rule cuts the other way too — a flag the option table does not
 * carry is a flag the process will reject, and Kane rejects an unknown option
 * *before doing any work*, so an unguarded invocation is a branch that looks wired
 * up and is silently dead. That is the same defect §13.2 exists to correct for
 * `maintain reconcile`, found on the other side.
 *
 * The probe was run against the installed 0.8.4 while this command was written, and
 * what it observed is recorded here because it is load-bearing:
 *
 * ```
 * $ kane-cli maintain evolve --help
 * Usage: kane-cli maintain evolve [options] [ref]
 * Options:
 *   --from-stale        Evolve every use-case with stale designed entities …
 *   --because <reason>  Re-design a FRESH target anyway …
 *   -h, --help          display help for command
 *
 * $ kane-cli maintain evolve --mode agent <ref>
 * error: unknown option '--mode'
 * ```
 *
 * `maintain reconcile --help`, from the same binary and the same command group,
 * **does** list `--mode <mode>`. So the asymmetry is real rather than an abridged
 * help table, and on this machine `kept evolve` takes the degradation path every
 * time. The argv of §13.1 is still composed exactly as specified — see
 * {@link evolveArgv} — because it is the contract for the version that carries the
 * flag, and pinning it is what makes the day it lands a one-line change instead of
 * a rediscovery.
 *
 * ## The decisive finding: the flag is not the obstacle, and no flag ever will be
 *
 * Task 21.1 set out to correct the argv and wire this branch for real. The argv was
 * already right, and correcting it changes nothing, because **`maintain evolve`
 * refuses to run headlessly at all**. Probed once, deliberately, against a fresh
 * target with nothing designed under it so that a success could supersede nothing:
 *
 * ```console
 * $ kane-cli maintain evolve uc-10 --because "…" > capture.ndjson
 * evolving uc-10: reading the graph…                      # the only stdout line
 * error: evolve needs a TTY — the blast-radius confirm is the point; headless
 *   evolution rides `kane-cli maintain reconcile`          # stderr, exit 2
 * ```
 *
 * Three things fall out of that one probe, all recorded under `docs/kane/evolve/`:
 *
 * 1. **Piped stdout is not an NDJSON enabler for this verb.** It produced one line
 *    of human prose and then refused. So there was never a machine-readable stream
 *    to consume, with or without `--mode`.
 * 2. **The refusal is a design decision, not a gap.** Kane says why: the
 *    blast-radius confirm *is* the point. This verb supersedes a use case's
 *    scenario and test pairs, and Kane will not do that without a human looking at
 *    what is about to be superseded. That is the same instinct as §8.1's `hold`
 *    autonomy on this very branch, arrived at independently on the other side of
 *    the process boundary, and it would be perverse for KEPT to try to defeat it.
 * 3. **Kane names the headless route, and KEPT already takes it.** "Headless
 *    evolution rides `kane-cli maintain reconcile`", which is §13.2's command,
 *    which `kept reconcile` already invokes, and whose staged rows already become
 *    held review cards through `mirrorReconcileStagedChanges`. The capability this
 *    task wanted — Kane proposes a re-design, KEPT holds it for a human — exists
 *    and is exercised; it simply arrives through the other verb.
 *
 * The probe cost **nothing**: exit 2 before any model call, `.context/` still at 39
 * records, and the graph's `context list --json` byte-identical either side. So the
 * degradation path below is not a workaround for a missing flag. It is the correct
 * and only headless behaviour for this verb, and the remedy it names is Kane's own.
 *
 * ## What the degradation does, and what it refuses to do
 *
 * When the flag is unsupported the invocation is **skipped entirely**: no process,
 * no credits, no partial stream to misread. The drift is still real — something
 * routed to `test-drift`, which is why this command was called — so it is recorded
 * as a `test-drift` review card built from the failure context alone, with an empty
 * `proposedChanges` list, because Kane rendered no change and inventing one would
 * be the ledger lying in the one place it exists not to. {@link testDriftReviewCard}
 * is the constructor `repair/reviewCard.ts` provides for exactly this, and it
 * deliberately does not go through the outcome gate: the card records a failure
 * rather than a staged change.
 *
 * A probe that could not run at all is a *different* answer and is treated as one.
 * No binary, a crash, an empty help text: none of those is evidence about the flag,
 * so no card is written and the diagnostic says only that nothing could be probed
 * (R2.12). Writing a flag-mismatch card for a missing binary would be a claim the
 * command has no grounds for.
 *
 * ## The probe is cached per process, and it is a seam
 *
 * One `--help` per process, memoised — a hook that fires `kept evolve` for three
 * drifted tests in one run must not pay for three identical probes, and the answer
 * cannot change under a running process. {@link clearEvolveHelpProbeCache} exists
 * for tests, following `clearKaneBinaryCache`'s precedent, and is never called
 * mid-run.
 *
 * The probe does **not** go through {@link KaneInvoker}, and that is structural
 * rather than convenient: the invoker appends the family's NDJSON enabler from the
 * contract (§4.7), so asking it to run `maintain evolve --help` would append the
 * very `--mode agent` whose presence is the question. A probe that cannot be issued
 * without the thing it probes for is not a probe. So it is its own tiny seam —
 * {@link EvolveHelpProbe}, defaulting to {@link nodeEvolveHelpProbe} — which is also
 * what keeps every test in this file process-free.
 *
 * ## What this command does not write
 *
 * State, snapshot and verdicts, all deliberately. §13.1's `Writes` column for this
 * row reads `review cards, handoff` and nothing else. An evolution proposes changes
 * to the *designed-test corpus*; it verifies nothing, so advancing freshness or
 * moving a verdict for it would be the overstatement the ledger exists not to make
 * (§14.1, R9.6). The graph is not rebuilt either — no documentation and no test file
 * changed, because nothing was applied.
 */

import { spawnSync } from 'node:child_process';

import type {
  CollectingDiagnosticSink,
  Diagnostic,
  ExitMeaning,
  HandoffHook,
  InvocationResult,
  KaneInvoker,
  KeptState,
  ParsedStream,
  PromiseRecord,
  ProposedChange,
  RepairStrategy,
  ReviewCard,
  StateFileSystem,
  WriteHandoffResult,
} from 'kept-core';
import {
  ACCEPTED_ASSURANCE_STATUS,
  KANE_BINARY_NAME,
  contractFor,
  createDiagnosticSink,
  createStateStore,
  normaliseAssuranceStatus,
  normaliseChangedPath,
  parseStream,
  resolvedKaneBinary,
  testDriftReviewCard,
  writeHandoff,
  writeReviewCard,
} from 'kept-core';

import { handoffFenceSurfaces, type KeptConfig } from '../config.js';

/** The family `maintain evolve` belongs to (§4.1, §13.1). Terminal: `done`. */
export const EVOLVE_FAMILY = 'Assurance' as const;

/** The verb, without flags. `--mode agent` is the invoker's, never written here. */
export const EVOLVE_ARGV_HEAD: readonly string[] = Object.freeze(['maintain', 'evolve']);

/** The flag whose presence the probe is looking for (§13.1, §4.7). */
export const MODE_FLAG = '--mode';

/** The value that flag carries for the Assurance family. */
export const AGENT_MODE = 'agent';

/** The probe's own flag. Kane's help is the only thing it reads. */
export const HELP_FLAG = '--help';

/** The probe's argv, without the binary. Carries no `--mode`, by construction. */
export const EVOLVE_HELP_ARGV: readonly string[] = Object.freeze([
  ...EVOLVE_ARGV_HEAD,
  HELP_FLAG,
]);

/** How long the probe is given. A `--help` that takes ten seconds is broken. */
export const EVOLVE_HELP_TIMEOUT_MS = 10_000;

/**
 * The argv for one evolution, **without** the NDJSON enabler.
 *
 * `--mode agent` is appended by the invoker from the Assurance contract (§4.7), so
 * it is absent here for the same reason it is absent from
 * `reconcilePlanArgv`: that table is the one home for the per-family enabler and a
 * second copy is how the two come to disagree. The effective argv at the process
 * boundary is therefore `maintain evolve <ref> --mode agent`, which is exactly the
 * §13.1 row and exactly what `test/argv-contract.test.ts` pins.
 *
 * The ref is passed through verbatim. Kane's `[ref]` accepts a test, a scenario, an
 * acceptance criterion or a use-case reference, and narrowing that to a path here
 * would refuse three of the four for no reason KEPT can justify.
 */
export function evolveArgv(ref: string): readonly string[] {
  return Object.freeze([...EVOLVE_ARGV_HEAD, ref]);
}

/** Diagnostic codes this command reports. Stable strings; the Ledger keys off them. */
export const EVOLVE_DIAGNOSTIC_CODES = Object.freeze({
  started: 'evolve-started',
  /** No ref was given, so there is nothing to evolve and nothing was run. */
  noRef: 'evolve-no-ref',
  /** The `--help` probe ran and its option table was read (§4.9). */
  probed: 'evolve-help-probed',
  /** The probe could not run at all, so nothing is known about the flag (R2.12). */
  probeUnavailable: 'evolve-help-probe-unavailable',
  /** The option table carries no `--mode`, so the invocation was skipped. */
  flagMismatch: 'evolve-flag-mismatch',
  /** A `test-drift` card was written from the failure context alone. */
  heldWithoutInvocation: 'evolve-held-without-invocation',
  /** The ref matched no promise, so no schema-valid card could be attributed. */
  unattributed: 'evolve-ref-unattributed',
  /** A ref, a supported flag, and no Kane boundary to hand them to (R2.12). */
  kaneUnavailable: 'evolve-kane-unavailable',
  /** `done.status: paused` with exit 3: resumable, nothing changed (R5.4). */
  paused: 'evolve-paused',
  /** The stream never reached `done`, so the outcome is unknown (R5.3). */
  outcomeUnknown: 'evolve-outcome-unknown',
  /** A terminal event that did not accept: refused, error, or anything new. */
  refused: 'evolve-refused',
  /** Changes Kane proposed, mirrored into held cards and applied nowhere (R7.2). */
  held: 'evolve-held',
  completed: 'evolve-completed',
} as const);

/** The codes as a list, so a test can enumerate them. */
export const EVOLVE_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(EVOLVE_DIAGNOSTIC_CODES),
);

/** The synthetic run id used when the terminal event carried none of Kane's own. */
export const SYNTHETIC_RUN_ID_PREFIX = 'kept-evolve:';

/**
 * The event type Kane uses for a staged item, matching `reconcile.ts`. Read, never
 * required: a stream that staged nothing is a normal stream.
 */
export const STAGED_ITEM_EVENT_TYPE = 'review_card';

// ---------------------------------------------------------------------------
// The probe (§4.9)
// ---------------------------------------------------------------------------

/** What one `maintain evolve --help` told us. */
export interface EvolveHelpObservation {
  /** Whether a probe process started and produced help text at all. */
  readonly ran: boolean;
  /** The probe's own exit code, or null when it never started. */
  readonly exitCode: number | null;
  /** Every long flag the option table listed, in the order it listed them. */
  readonly flags: readonly string[];
  /** Whether `--mode` appears among them — the whole question (§13.1). */
  readonly supportsModeAgent: boolean;
  /** The help text as read, so a diagnostic can quote rather than paraphrase. */
  readonly text: string;
  /** Why nothing could be observed, or null when something was. */
  readonly failure: string | null;
}

/**
 * Read a `--help` option table.
 *
 * Long flags only, and matched wherever they appear rather than only inside an
 * `Options:` block: the block heading is a formatting detail of whichever argument
 * parser Kane happens to use, and keying the answer to it would make a cosmetic
 * release note read as a removed flag. Empty text is **not** an answer — it is the
 * probe having failed — because "the table lists no flags" and "there was no table"
 * are different facts and only the first one is evidence.
 */
export function parseEvolveHelp(
  text: string,
  exitCode: number | null,
): EvolveHelpObservation {
  const flags: string[] = [];
  for (const match of text.matchAll(/(?:^|[\s,([])(--[a-z][a-z0-9-]*)/g)) {
    const flag = match[1];
    if (flag !== undefined && !flags.includes(flag)) flags.push(flag);
  }
  if (text.trim().length === 0) {
    return {
      ran: false,
      exitCode,
      flags: Object.freeze([]),
      supportsModeAgent: false,
      text,
      failure: 'the probe produced no help text at all',
    };
  }
  return {
    ran: true,
    exitCode,
    flags: Object.freeze(flags),
    supportsModeAgent: flags.includes(MODE_FLAG),
    text,
    failure: null,
  };
}

/** An observation for a probe that never got as far as a process. */
export function unprobed(failure: string): EvolveHelpObservation {
  return {
    ran: false,
    exitCode: null,
    flags: Object.freeze([]),
    supportsModeAgent: false,
    text: '',
    failure,
  };
}

/** The probe seam. Injected everywhere, so no test starts a real process. */
export type EvolveHelpProbe = (request: {
  readonly cwd: string;
  readonly timeoutMs: number;
}) => Promise<EvolveHelpObservation>;

/**
 * The production probe: one synchronous `maintain evolve --help`.
 *
 * Synchronous on purpose. A `--help` is a few milliseconds of process start-up and
 * nothing else, it happens at most once per process, and an async spawn here would
 * add a stream plumbing path whose only job is to read a fixed string. Both streams
 * are read because argument parsers disagree about which one help belongs on, and
 * refusing to read stderr would make a perfectly good option table invisible.
 */
export const nodeEvolveHelpProbe: EvolveHelpProbe = async ({ cwd, timeoutMs }) => {
  const binary = resolvedKaneBinary();
  if (binary === null) {
    return unprobed(
      `${KANE_BINARY_NAME} was not found on PATH, so no option table could be read`,
    );
  }
  try {
    const probe = spawnSync(binary, [...EVOLVE_HELP_ARGV], {
      cwd,
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (probe.error !== undefined) {
      return unprobed(`the probe could not be started (${probe.error.message})`);
    }
    return parseEvolveHelp(`${probe.stdout ?? ''}\n${probe.stderr ?? ''}`, probe.status);
  } catch (cause) {
    return unprobed(
      `the probe could not be started (${cause instanceof Error ? cause.message : String(cause)})`,
    );
  }
};

/** The per-process memo. One `--help`, however many refs are evolved. */
let helpMemo: Promise<EvolveHelpObservation> | undefined;

/** Forget the memo. For tests, following `clearKaneBinaryCache`; never mid-run. */
export function clearEvolveHelpProbeCache(): void {
  helpMemo = undefined;
}

/**
 * Probe once per process (§14.1's "one-time probe, cached per process").
 *
 * The *promise* is memoised rather than its value, so two refs evolved in the same
 * tick share one probe instead of racing two.
 */
export async function probeEvolveHelp(
  probe: EvolveHelpProbe,
  request: { readonly cwd: string; readonly timeoutMs?: number | undefined },
): Promise<EvolveHelpObservation> {
  helpMemo ??= probe({
    cwd: request.cwd,
    timeoutMs: request.timeoutMs ?? EVOLVE_HELP_TIMEOUT_MS,
  }).catch((cause: unknown) =>
    unprobed(`the probe threw (${cause instanceof Error ? cause.message : String(cause)})`),
  );
  return await helpMemo;
}

// ---------------------------------------------------------------------------
// Attributing the drift to a promise
// ---------------------------------------------------------------------------

/**
 * The promise a ref names, or null.
 *
 * A card must carry a `p_` id the graph actually holds — `buildReviewCard` refuses
 * to invent one, and a card pointing at a promise that does not exist would be a
 * dead link in the Ledger. The ref is matched against the designed test's **path**
 * first and its `test_id` second, because §13.1 spells the argument `<testPath>`
 * while Kane's own `[ref]` accepts an assurance id, and a user who pasted the id
 * from `/reviews` means the same drift.
 *
 * The graph is sorted by id, so a ref that two promises share resolves to the same
 * promise on every machine rather than to whichever was walked first.
 */
export function promiseForRef(state: KeptState, ref: string, repoRoot?: string): PromiseRecord | null {
  const normalised = normaliseChangedPath(ref, repoRoot);
  const byPath = state.graph.promises.find(
    (promise) => promise.designedTest !== null && promise.designedTest.path === normalised,
  );
  if (byPath !== undefined) return byPath;
  const byTestId = state.graph.promises.find(
    (promise) => promise.designedTest !== null && promise.designedTest.testId === ref,
  );
  return byTestId ?? null;
}

// ---------------------------------------------------------------------------
// Reading Kane's staged items, as `test-drift`
// ---------------------------------------------------------------------------

/**
 * Field spellings a staged item might use, mirroring `repair/reviewCard.ts`'s own
 * tolerance for the same reason it has it: an item whose summary arrived under
 * `one_liner` is the same held change, and refusing it over a key name would
 * silently lose it.
 *
 * The mirroring is deliberate and is not a candidate for de-duplication.
 * `reviewCardsFromStagedItems` hardcodes `kind: 'reconcile'`, which is correct for
 * the command it was written for and wrong here: §8.2 makes `kind` the record of
 * *which command produced the card*, and a card from `kept evolve` labelled
 * `reconcile` would tell a reviewer sorting `/reviews` the wrong provenance. So the
 * gate is restated locally — `accepted` and nothing else admits a card — and the
 * kind comes from {@link testDriftReviewCard}.
 */
const TITLE_KEYS: readonly string[] = ['title', 'summary', 'one_liner', 'message', 'name'];
const DETAIL_KEYS: readonly string[] = ['detail', 'details', 'description', 'body', 'rationale'];
const CHANGE_LIST_KEYS: readonly string[] = [
  'proposed_changes',
  'proposedChanges',
  'changes',
  'files',
];
const CHANGE_FILE_KEYS: readonly string[] = ['file', 'path', 'target', 'file_path'];
const CHANGE_SUMMARY_KEYS: readonly string[] = ['summary', 'title', 'description', 'reason'];
const CHANGE_DIFF_KEYS: readonly string[] = ['diff', 'patch', 'unified_diff'];

/** The first non-empty string among the given keys, or null. */
function firstString(source: unknown, keys: readonly string[]): string | null {
  if (typeof source !== 'object' || source === null) return null;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
}

/** One change out of an unknown record, tolerantly. A bare path is legitimate. */
function changeFrom(value: unknown): ProposedChange | null {
  if (typeof value === 'string') {
    return value.trim().length === 0 ? null : { file: value, summary: '', diff: '' };
  }
  const file = firstString(value, CHANGE_FILE_KEYS);
  if (file === null) return null;
  return {
    file,
    summary: firstString(value, CHANGE_SUMMARY_KEYS) ?? '',
    diff: firstString(value, CHANGE_DIFF_KEYS) ?? '',
  };
}

/** The change list of a staged item, tolerantly. */
export function stagedChanges(item: Record<string, unknown>): readonly ProposedChange[] {
  for (const key of CHANGE_LIST_KEYS) {
    const value = item[key];
    if (!Array.isArray(value)) continue;
    const changes: ProposedChange[] = [];
    for (const entry of value) {
      const change = changeFrom(entry);
      if (change !== null) changes.push(change);
    }
    return Object.freeze(changes);
  }
  const single = changeFrom(item);
  return single === null ? Object.freeze([]) : Object.freeze([single]);
}

/** Every `review_card` event a stream carried, verbatim. */
function stagedItems(
  stream: ParsedStream<typeof EVOLVE_FAMILY> | null,
): readonly Record<string, unknown>[] {
  if (stream === null) return Object.freeze([]);
  return Object.freeze(
    stream.events
      .filter((event) => event['type'] === STAGED_ITEM_EVENT_TYPE)
      .map((event) => event as Record<string, unknown>),
  );
}

/** A string field off an unknown record, or null. */
function readString(source: unknown, key: string): string | null {
  if (typeof source !== 'object' || source === null) return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Kane's own words for this run: the terminal's `message` when it carried one, else
 * the first non-empty `message` anywhere in the stream.
 *
 * The fallback is the same one `reconcile.ts` and `context/listing.ts` make, for the
 * same verified reason: the refusal envelope of §5.3.1 puts the remedy on a separate
 * `error` event and leaves the terminal with no message, so a reader that looked only
 * at the terminal would discard the one sentence saying what to do about it.
 */
function kaneMessage(
  stream: ParsedStream<typeof EVOLVE_FAMILY> | null,
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

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

/** {@link runEvolve}'s input. Every seam has a production default. */
export interface EvolveRequest {
  /** Absolute repository root. `process.cwd()` is never substituted downstream. */
  readonly repoRoot: string;
  readonly config: KeptConfig;
  /** The `<ref>` §13.1 spells `<testPath>`. Absent means nothing to evolve. */
  readonly ref?: string | null | undefined;
  /** The Kane process boundary. Absent means nothing can be invoked (R2.12). */
  readonly invoker?: KaneInvoker | undefined;
  /** The `--help` probe. Defaults to {@link nodeEvolveHelpProbe}. */
  readonly helpProbe?: EvolveHelpProbe | undefined;
  /** State reads, card writes and handoff writes. Defaults to `node:fs`. */
  readonly fileSystem?: StateFileSystem | undefined;
  readonly diagnostics?: CollectingDiagnosticSink | undefined;
  /** ISO 8601 instant written into the card and the handoff. Defaults to now. */
  readonly at?: string | undefined;
  /** What fired the run. A human by default: no hook invokes this (§11.1). */
  readonly trigger?:
    | {
        readonly hook?: HandoffHook | null;
        readonly event?: string | null;
        readonly paths?: readonly string[];
      }
    | undefined;
}

/** What {@link runEvolve} did. */
export interface EvolveResult {
  /** The ref as given, or null when none was. */
  readonly ref: string | null;
  /** The promise the drift was attributed to, or null when none matched. */
  readonly promiseId: string | null;
  /** What the one-time `--help` probe observed. Null only when no ref was given. */
  readonly probe: EvolveHelpObservation | null;
  /** Whether `--mode` appears in Kane's own option table for this verb. */
  readonly flagSupported: boolean;
  /** argv actually issued, `--mode agent` included. Empty when nothing ran. */
  readonly argv: readonly string[];
  readonly invoked: boolean;
  readonly exitCode: number | null;
  readonly exitMeaning: ExitMeaning | null;
  /** Whether the `done` event arrived (R5.3). */
  readonly terminalSeen: boolean;
  /** `done.status`, normalised, or null when no terminal event arrived. */
  readonly status: string | null;
  /** Terminal `done` with an accepting status: the card gate (R5.3, R5.4). */
  readonly accepted: boolean;
  readonly paused: boolean;
  /** Items Kane staged, verbatim. */
  readonly staged: readonly Record<string, unknown>[];
  /** Kane's own message, quoted rather than paraphrased. */
  readonly message: string | null;
  /** Every card this run holds, whether it wrote the file or found it already there. */
  readonly reviewCards: readonly ReviewCard[];
  /** Absolute paths of those cards, in the same order. */
  readonly cardPaths: readonly string[];
  /** True when the card exists because the flag probe refused the invocation. */
  readonly degradedByFlagProbe: boolean;
  readonly runId: string;
  readonly handoff: WriteHandoffResult;
  readonly diagnostics: readonly Diagnostic[];
}

/** Persist one card, and answer what landed. Never throws. */
function holdCard(options: {
  readonly repoRoot: string;
  readonly card: ReviewCard;
  readonly sink: CollectingDiagnosticSink;
  readonly fileSystem: StateFileSystem | undefined;
}): { readonly card: ReviewCard; readonly path: string } {
  const written = writeReviewCard({
    repoRoot: options.repoRoot,
    card: options.card,
    diagnostics: options.sink,
    ...(options.fileSystem === undefined ? {} : { fileSystem: options.fileSystem }),
  });
  return { card: written.card, path: written.path };
}

/**
 * Run the `test-drift` branch (§8.1, R7.2).
 *
 * Never throws for any state of the world: no ref, a ref no promise cites, no
 * `kane-cli` at all, a probe that could not run, an option table without the flag, a
 * crashed stream, a pause, a refusal, our own timeout. Every one of those is a
 * diagnostic plus a handoff, and the exit code stays zero (R2.10, §14.2).
 */
export async function runEvolve(request: EvolveRequest): Promise<EvolveResult> {
  const sink = request.diagnostics ?? createDiagnosticSink();
  const at = request.at ?? new Date().toISOString();
  const ref = request.ref === undefined || request.ref === null || request.ref.length === 0
    ? null
    : request.ref;
  const runId = `${SYNTHETIC_RUN_ID_PREFIX}${at}`;
  const strategy: RepairStrategy = request.config.verdictRouter;

  const store = createStateStore({
    repoRoot: request.repoRoot,
    ...(request.fileSystem === undefined ? {} : { fileSystem: request.fileSystem }),
    sink,
  });
  const state = store.load();
  const promise = ref === null ? null : promiseForRef(state, ref, request.repoRoot);

  sink.report({
    code: EVOLVE_DIAGNOSTIC_CODES.started,
    severity: 'info',
    message:
      `kept evolve${ref === null ? '' : ` ${ref}`}: the held branch of design §8.1 — Kane may ` +
      `propose and nothing is ever applied. Budget ${request.config.timeouts.hookMs} ms, router ` +
      `${strategy}.`,
  });

  /**
   * Close the run: write the handoff **once**, with every diagnostic this run
   * produced, and answer the result.
   *
   * Written last on every arm, not per-arm, because `writeHandoff` is called for
   * every run (§11.2, R11.4) and calling it twice would leave `.kept/handoff.json`
   * describing the same run from two different points in its own history — the
   * archive copy is immutable, so the second call would also be recorded as a
   * collision. One exit, one handoff.
   */
  const finish = (
    partial: Partial<EvolveResult> & { readonly probe: EvolveHelpObservation | null },
  ): EvolveResult => {
    const resolvedRunId = partial.runId ?? runId;
    const argv = partial.argv ?? Object.freeze([]);
    const invoked = partial.invoked ?? false;
    return {
      ref,
      promiseId: promise?.id ?? null,
      flagSupported: partial.probe?.supportsModeAgent ?? false,
      exitCode: null,
      exitMeaning: null,
      terminalSeen: false,
      status: null,
      accepted: false,
      paused: false,
      staged: Object.freeze([]),
      message: null,
      reviewCards: Object.freeze([]),
      cardPaths: Object.freeze([]),
      degradedByFlagProbe: false,
      ...partial,
      argv,
      invoked,
      runId: resolvedRunId,
      handoff: writeHandoff({
        repoRoot: request.repoRoot,
        fences: handoffFenceSurfaces(request.config),
        runId: resolvedRunId,
        at,
        // `hook: null` is the point: no hook invokes this command (§11.1).
        trigger: {
          hook: request.trigger?.hook ?? null,
          event: request.trigger?.event ?? null,
          paths: request.trigger?.paths ?? (ref === null ? [] : [ref]),
        },
        command: { family: EVOLVE_FAMILY, argv, invoked },
        diagnostics: sink.entries,
        ...(request.fileSystem === undefined ? {} : { fileSystem: request.fileSystem }),
      }),
      diagnostics: sink.entries,
    };
  };

  // ── No ref: nothing to evolve, and nothing to probe for either. ────────────
  if (ref === null) {
    sink.report({
      code: EVOLVE_DIAGNOSTIC_CODES.noRef,
      severity: 'warn',
      message:
        `kept evolve takes the reference of the drifted test (design §13.1 spells it ` +
        `<testPath>); none was given, so nothing was probed, nothing was invoked and no review ` +
        `card was created.`,
    });
    return finish({ probe: null });
  }

  // ── The one-time probe (§4.9). Cached per process; never through the invoker. ─
  const probe = await probeEvolveHelp(request.helpProbe ?? nodeEvolveHelpProbe, {
    cwd: request.repoRoot,
  });

  if (!probe.ran) {
    // Not evidence about the flag. A missing binary is R2.12's supported state of
    // the world, and writing a flag-mismatch card for it would be a claim with no
    // grounds — so this arm records the absence and holds nothing.
    sink.report({
      code: EVOLVE_DIAGNOSTIC_CODES.probeUnavailable,
      severity: 'warn',
      message:
        `\`${KANE_BINARY_NAME} ${EVOLVE_HELP_ARGV.join(' ')}\` could not be read (` +
        `${probe.failure ?? 'no reason reported'}), so nothing is known about whether ` +
        `\`${MODE_FLAG} ${AGENT_MODE}\` is supported. No process was started, no review card was ` +
        `created and every verdict stands.`,
    });
    return finish({ probe });
  }

  sink.report({
    code: EVOLVE_DIAGNOSTIC_CODES.probed,
    severity: 'info',
    message:
      `\`${KANE_BINARY_NAME} ${EVOLVE_HELP_ARGV.join(' ')}\` lists ${probe.flags.length} long ` +
      `flag(s): ${probe.flags.join(', ') || 'none'}. Probed once for this process and cached ` +
      `(§4.9: help omissions prove nothing, so the table is read rather than assumed).`,
  });

  // ── The degradation §14.1 specifies: no flag, no invocation, one held card. ──
  if (!probe.supportsModeAgent) {
    sink.report({
      code: EVOLVE_DIAGNOSTIC_CODES.flagMismatch,
      severity: 'warn',
      message:
        `\`maintain evolve\` on this ${KANE_BINARY_NAME} carries no \`${MODE_FLAG}\` option, so ` +
        `\`${[...evolveArgv(ref), MODE_FLAG, AGENT_MODE].join(' ')}\` would be rejected as an ` +
        `unknown option with nothing run. The invocation was skipped rather than attempted: no ` +
        `process, no credits, and no partial stream to misread. The table it listed was ` +
        `${probe.flags.join(', ') || 'empty'}, and \`maintain reconcile\` on the same binary ` +
        `does carry it — so this is an option this verb does not have, not an abridged help ` +
        `table. The drift is held as a review card instead.`,
      file: ref,
    });

    if (promise === null) {
      sink.report({
        code: EVOLVE_DIAGNOSTIC_CODES.unattributed,
        severity: 'warn',
        message:
          `${ref} matches no designed test in .kept/state.json, so the drift could not be ` +
          `attributed to a promise and no review card was created: a card has to name a real ` +
          `promise id, and inventing one would put a dead link in the Ledger. Run \`kept build\` ` +
          `first if the graph is stale.`,
        file: ref,
      });
      return finish({ probe, degradedByFlagProbe: true });
    }

    const draft = testDriftReviewCard({
      // Prose, deliberately: a card title is read as a sentence on `/reviews`, and
      // §10.7 keeps prose out of mono. The identifiers live in the card's own fields.
      title: `Test drift held for ${ref}: evolution could not be driven headlessly`,
      detail:
        `The verdict router settled this promise on the test-drift branch, so ` +
        `\`maintain evolve\` was the repair. The installed ${KANE_BINARY_NAME} exposes no ` +
        `${MODE_FLAG} option on that verb — its option table lists ` +
        `${probe.flags.join(', ') || 'no long flags'} — and the verb also refuses to run ` +
        `without a TTY at all: \`evolve needs a TTY — the blast-radius confirm is the point; ` +
        `headless evolution rides \`kane-cli maintain reconcile\`\`. So the invocation was ` +
        `skipped and no change was proposed. Nothing was applied and nothing was written ` +
        `outside .kept/. Two routes forward, and neither is waiting for a flag: drive the ` +
        `evolution interactively and review its pair diff by hand, or save the documentation ` +
        `and let \`kept reconcile\` take Kane's own headless path, which stages the same ` +
        `re-design as held review cards nothing applies.`,
      // Empty on purpose: Kane rendered no change, and a card that listed one would
      // be the ledger asserting a repair nobody proposed.
      proposedChanges: [],
      context: {
        promiseId: promise.id,
        createdAt: at,
        strategy,
        evidenceRef: promise.repair?.evidenceRef ?? null,
        diagnostics: sink,
      },
    });

    if (!draft.ok) return finish({ probe, degradedByFlagProbe: true });

    const held = holdCard({
      repoRoot: request.repoRoot,
      card: draft.card,
      sink,
      fileSystem: request.fileSystem,
    });
    sink.report({
      code: EVOLVE_DIAGNOSTIC_CODES.heldWithoutInvocation,
      severity: 'info',
      message:
        `review card ${held.card.id} holds the drift on ${ref} for promise ${promise.id} with no ` +
        `proposed change, because none was rendered. Status '${held.card.status}': a human ` +
        `decides, and nothing was applied (R7.2).`,
      file: ref,
    });

    return finish({
      probe,
      degradedByFlagProbe: true,
      reviewCards: Object.freeze([held.card]),
      cardPaths: Object.freeze([held.path]),
    });
  }

  // ── The flag is there. Now the argv of §13.1 can actually be issued. ────────
  if (request.invoker === undefined) {
    sink.report({
      code: EVOLVE_DIAGNOSTIC_CODES.kaneUnavailable,
      severity: 'warn',
      message:
        `\`maintain evolve\` accepts ${MODE_FLAG}, but there is no Kane boundary to hand ` +
        `${ref} to, so nothing was invoked, no review card was created and every verdict is ` +
        `preserved (R2.12).`,
      file: ref,
    });
    return finish({ probe });
  }

  const declared = evolveArgv(ref);
  const invocation: InvocationResult<typeof EVOLVE_FAMILY> = await request.invoker.invoke({
    family: EVOLVE_FAMILY,
    argv: declared,
    cwd: request.repoRoot,
    timeoutMs: request.config.timeouts.hookMs,
  });
  const stream = parseStream(contractFor(EVOLVE_FAMILY), invocation.stdoutLines, { sink });
  const terminal = stream.kind === 'complete' ? stream.terminal : null;
  const status = terminal === null ? null : normaliseAssuranceStatus(terminal.status);
  const accepted = status === ACCEPTED_ASSURANCE_STATUS;
  const paused = status === 'paused';
  const message = kaneMessage(stream, terminal);
  const staged = stagedItems(stream);
  const resolvedRunId = readString(terminal, 'run_id') ?? runId;

  if (stream.kind === 'crashed') {
    // R5.3: the outcome is unknown, so no card is created. What arrived before the
    // stream died is not known to be what Kane finished proposing.
    sink.report({
      code: EVOLVE_DIAGNOSTIC_CODES.outcomeUnknown,
      severity: 'warn',
      message:
        `the evolve stream for ${ref} ended without its '${stream.expectedTerminal}' event, so ` +
        `the outcome is unknown: no review card was created and every verdict stands.`,
      file: ref,
    });
  } else if (paused) {
    sink.report({
      code: EVOLVE_DIAGNOSTIC_CODES.paused,
      severity: 'warn',
      message:
        `the evolution of ${ref} is paused and resumable (exit ` +
        `${invocation.exitCode ?? 'unknown'}), so nothing changed and no review card was ` +
        `created.${message === null ? '' : ` Kane reported: ${message}`}` +
        `${
          readString(terminal, 'resume') === null
            ? ''
            : ` Resume with: ${readString(terminal, 'resume') ?? ''}`
        }`,
      file: ref,
    });
  } else if (!accepted) {
    // A refusal is a `complete` stream, not a crash (§5.3.1), and Kane's own exit 2
    // is data — so its words are quoted rather than summarised (R2.10).
    sink.report({
      code: EVOLVE_DIAGNOSTIC_CODES.refused,
      severity: 'warn',
      message:
        `the evolution of ${ref} finished with status '${status ?? 'unknown'}' (exit ` +
        `${invocation.exitCode ?? 'unknown'}), so nothing was consumed: no review card was ` +
        `created and every verdict stands.` +
        `${message === null ? '' : ` Kane reported: ${message}`}`,
      file: ref,
    });
  }

  // The gate, restated in one place: an accepting terminal `done` and nothing else
  // admits a card (R5.3, R5.4). A crashed, paused or refused stream holds nothing.
  const cards: ReviewCard[] = [];
  const paths: string[] = [];
  if (accepted && promise !== null) {
    const seen = new Set<string>();
    for (const item of staged) {
      const changes = stagedChanges(item);
      const echoed = firstString(item, TITLE_KEYS);
      const draft = testDriftReviewCard({
        title:
          echoed ??
          `Evolution proposed a held change to ${changes[0]?.file ?? 'the designed suite'}`,
        detail: firstString(item, DETAIL_KEYS) ?? '',
        proposedChanges: changes,
        context: {
          promiseId: promise.id,
          createdAt: at,
          strategy,
          evidenceRef: promise.repair?.evidenceRef ?? null,
          diagnostics: sink,
        },
      });
      if (!draft.ok || seen.has(draft.card.id)) continue;
      seen.add(draft.card.id);
      const held = holdCard({
        repoRoot: request.repoRoot,
        card: draft.card,
        sink,
        fileSystem: request.fileSystem,
      });
      cards.push(held.card);
      paths.push(held.path);
    }
    sink.report({
      code: EVOLVE_DIAGNOSTIC_CODES.held,
      severity: 'info',
      message:
        `${cards.length} review card(s) hold what the evolution of ${ref} proposed for promise ` +
        `${promise.id}. Nothing was applied: R7.2 holds every change, and the only writes this ` +
        `run made are under .kept/.${message === null ? '' : ` Kane reported: ${message}`}`,
      file: ref,
    });
  } else if (accepted && promise === null) {
    sink.report({
      code: EVOLVE_DIAGNOSTIC_CODES.unattributed,
      severity: 'warn',
      message:
        `the evolution of ${ref} completed and staged ${staged.length} item(s), but ${ref} ` +
        `matches no designed test in .kept/state.json, so nothing could be attributed to a ` +
        `promise and no review card was created. Nothing was applied either way.`,
      file: ref,
    });
  }

  sink.report({
    code: EVOLVE_DIAGNOSTIC_CODES.completed,
    severity: 'info',
    message:
      `kept evolve ${ref}: one invocation, status '${status ?? 'none'}', ${staged.length} staged ` +
      `item(s), ${cards.length} held card(s), no verdict written and no test file touched`,
  });

  return finish({
    probe,
    argv: invocation.effectiveArgv,
    invoked: true,
    exitCode: invocation.exitCode,
    exitMeaning: invocation.exitMeaning,
    terminalSeen: terminal !== null,
    status,
    accepted,
    paused,
    staged,
    message,
    reviewCards: Object.freeze(cards),
    cardPaths: Object.freeze(paths),
    runId: resolvedRunId,
  });
}
