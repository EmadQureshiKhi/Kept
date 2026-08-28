/**
 * `kept verify --changed <p…>` / `kept verify --all` — the command that closes
 * the loop (design §7.4, §13.1, §14.1, R4.1–R4.15, R11.9).
 *
 * This is the only command that can move a verdict from `red` to `proven`, and
 * the only one a save hook fires. Everything about it is arranged around two
 * facts that are easy to get wrong and expensive to get wrong quietly.
 *
 * ## One: `testrun_done` is required before anything is written
 *
 * `testrun run` belongs to the `ExecutionTestrun` family, whose terminal event is
 * `testrun_done` and whose NDJSON arrives because **stdout is a pipe** — there is
 * no `--agent` flag on this command and Kane rejects one (§4.1, R3.5). The
 * consumption order is §7.4's: `testrun_plan` first, so a `valid: false` preflight
 * carries each member's reason; then every `testrun_member_end`; and then the
 * terminal event, which is not optional. A stream that stops short of it is
 * `crashed` — outcome unknown, never a pass and never a failure — and a run that
 * wrote the members it happened to see would report a partial suite as a whole
 * one.
 *
 * That rule is not re-implemented here. Every verdict goes through
 * `StateStore.applyRun`, which calls `mayWriteVerdicts` first and, on refusal,
 * returns the prior state **by reference** (§4.8). So this command hands the
 * outcome and the writes to the guard even when the stream crashed, and the
 * "nothing is written" half is structural rather than an `if` in this file.
 *
 * ## Two: promises outside the blast radius come out byte-identical
 *
 * `applyRun` is given `radius.promiseIds`, and it carries every promise outside
 * that set across by reference — the same object, verdict source and freshness
 * evidence included (R4.15). Verifying three promises must not touch the other
 * five, and Property 9's radius clause pins it.
 *
 * ## What this file does *not* decide
 *
 * - **Which identifiers reach Kane.** They come from `testrun_plan.members[]` and
 *   nowhere else (§7.1, R4.3, R4.4): `readPlan` obtains them and
 *   `computeBlastRadius` selects among them. Nothing here infers an id from a
 *   path, a filename or a position.
 * - **Whether to spawn at all.** `shouldInvokeKane` is the single home of R4.5's
 *   rule that zero identifiers costs zero processes.
 * - **Which repair branch a failure gets.** `selectRouter` is the only door to a
 *   strategy (§6.4, R6.10), and only `failed` and `broken` reach it —
 *   `entersVerdictRouter` says so once, and `reportMemberStatus` records `broken`
 *   and `interrupted` verbatim in the diagnostics, because once both are `red`
 *   the diagnostic is the only surviving evidence of which happened (R4.9).
 * - **Where evidence lives.** `<cwd>/.testmuai/evidence` is derived from the
 *   *family* by `listArtifacts` (§4.6, R4.13). No path is lifted off an event.
 *
 * The handoff is written for **every** run — crashed, preflight-rejected,
 * radius-empty, Kane-absent — because an agent that reads a stale handoff repairs
 * the wrong thing (§11.2, R11.4). Then the snapshot (R4.14). And the exit code is
 * always zero: Kane's outcomes are data (R2.10, §14.2).
 */

import type {
  BlastRadius,
  CollectingDiagnosticSink,
  Diagnostic,
  EvidenceFileSystem,
  EvidenceListing,
  ExitMeaning,
  FailureYamlFileSystem,
  HandoffHook,
  HandoffResultInput,
  InvocationResult,
  KaneInvoker,
  KeptState,
  ParsedStream,
  PlanFileSystem,
  PromiseRecord,
  RoutedRepair,
  RunOutcome,
  SealedPackFileSystem,
  SealedPackTriage,
  StateFileSystem,
  TestDocumentSource,
  TestrunPlan,
  Verdict,
  VerdictWrite,
  WriteHandoffResult,
  WriteRefusalReason,
} from 'kept-core';
import {
  computeBlastRadius,
  collectTestCoverage,
  contractFor,
  createDiagnosticSink,
  createFailureContext,
  createStateStore,
  credits as creditsOf,
  entersVerdictRouter,
  isMemberStatus,
  listArtifacts,
  MEMBER_DEBUG_PREFIX,
  nodeBaselineFileSystem,
  nodeStateFileSystem,
  outcomeFromInvocation,
  pairMemberDebug,
  parseMemberDebug,
  parseStream,
  readPlan,
  readSealedPackTriage,
  sealedNoteFor,
  reportMemberStatus,
  resultCode,
  selectRouter,
  shouldInvokeKane,
  toPosix,
  toRepoRelative,
  writeHandoff,
} from 'kept-core';

import type { KeptConfig } from '../config.js';
import { handoffFenceSurfaces, memberDebugEnv } from '../config.js';

import type { SnapshotResult } from './snapshot.js';
import { runSnapshot } from './snapshot.js';

/** The family `testrun run` belongs to. Named once; read from here everywhere. */
export const VERIFY_FAMILY = 'ExecutionTestrun' as const;

/**
 * The argv of a replay, **without** the selection and **without** an NDJSON
 * enabler — this family has none to add, and `--agent` anywhere in it is rejected
 * by the invoker (§4.1, §7.4, R3.5).
 */
export const VERIFY_ARGV_HEAD: readonly string[] = Object.freeze(['testrun', 'run']);

/**
 * The flags every replay carries, whatever its scope.
 *
 * `--on-failure continue`: one failing member must not stop the suite (§7.4).
 *
 * `--bug-detection continue`: **the branch depends on it, so it is stated rather
 * than inherited.** Kane's bug investigation is what produces `result_code 740` and
 * the inline `verdict` object, and those are §6.2's first three rungs — without
 * them every failure falls through to a triage note inside a sealed zip nothing
 * opens, and answers `docs-lie`. The mode is a *profile* setting
 * (`kane-cli config show` → `"bug_detection":"off"` on this machine), which means
 * the branch KEPT chooses would otherwise depend on ambient state in a config file
 * belonging to another tool, changeable by anyone, invisible in the argv, and
 * absent from the recording. A run that reports `code-break` on Tuesday and
 * `docs-lie` on Wednesday for the same failure is not a router; the flag overrides
 * the profile so the contract is the argv (R3.4, §4.7). `continue` rather than
 * `stop` for the same reason as `--on-failure`.
 */
export const VERIFY_ARGV_TAIL: readonly string[] = Object.freeze([
  '--on-failure',
  'continue',
  '--bug-detection',
  'continue',
]);

/**
 * The flag R4.2 specifies for scoping a replay, and the flag the installed 0.8.4
 * cannot be scoped with.
 *
 * Kept as a named constant because it is still the *specified* spelling and
 * because two assertions depend on naming it — the argv contract asserts it is
 * absent from both scopes, and `docs/kane/command-surface.md` records why. See
 * {@link verifyArgv} for the measured error text.
 */
export const FROM_CONTEXT_FLAG = '--from-context';

/** The synthetic run id used when the terminal event carried none of Kane's own. */
export const SYNTHETIC_RUN_ID_PREFIX = 'kept-verify:';

/** Diagnostic codes this command reports. Stable; the Ledger keys off them. */
export const VERIFY_DIAGNOSTIC_CODES = Object.freeze({
  started: 'verify-started',
  /** A radius was selected but there is no Kane boundary to replay it with. */
  kaneUnavailable: 'verify-kane-unavailable',
  /** `testrun_plan.valid === false`: nothing ran, one reason per member (R4.11). */
  preflightRejected: 'verify-preflight-rejected',
  /** The stream never reached `testrun_done`, so the outcome is unknown (R4.7). */
  outcomeUnknown: 'verify-outcome-unknown',
  /** A member could not be tied to any promise in the graph. */
  memberUnattributed: 'verify-member-unattributed',
  /** `--all` and `--changed` were both given; the whole suite wins. */
  scopeOverridden: 'verify-scope-overridden',
  /** A suite member carries no plan identifier, so `--all` does not replay it. */
  suiteMemberUnidentified: 'verify-suite-member-unidentified',
  /** The `[member]` stream was captured to `.kept/diagnostics/` (R4.12). */
  memberStreamCaptured: 'verify-member-stream-captured',
  /** It was captured and could not be written. The routing is unaffected. */
  memberStreamUnwritten: 'verify-member-stream-unwritten',
  completed: 'verify-completed',
} as const);

/** The codes as a list, so a test can enumerate them. */
export const VERIFY_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(VERIFY_DIAGNOSTIC_CODES),
);

/** How the run was scoped. `all` replays the suite; `changed` replays a radius. */
export type VerifyScope = 'all' | 'changed';

/** One member the run reported on, after attribution and routing. */
export interface VerifiedMember {
  /** The status exactly as it arrived on the wire. Never normalised. */
  readonly status: string;
  /** True when the status is one of the four Kane documents. */
  readonly known: boolean;
  readonly verdict: Verdict;
  /** Kane's assurance-graph id, when the event or the plan carried one. */
  readonly testId: string | null;
  /** Repository-relative path of the member's `*_test.md`, when known. */
  readonly path: string | null;
  /** Promises this member reported on. Empty means it could not be attributed. */
  readonly promiseIds: readonly string[];
  /** The router's answer, or null when the status never entered the router. */
  readonly repair: RoutedRepair | null;
}

/** {@link runVerify}'s input. Every seam has a production default. */
export interface VerifyRequest {
  /** Absolute repository root. `process.cwd()` is never substituted downstream. */
  readonly repoRoot: string;
  readonly config: KeptConfig;
  /** `--all`: replay every member the plan enumerates. */
  readonly all?: boolean | undefined;
  /** `--changed <p…>`: the hook's saved paths, verbatim. */
  readonly changed?: readonly string[] | undefined;
  /** The Kane process boundary. Absent means no replay is possible (R2.12). */
  readonly invoker?: KaneInvoker | undefined;
  /** State, handoff and snapshot reads and writes. Defaults to `node:fs`. */
  readonly fileSystem?: StateFileSystem | undefined;
  /**
   * The directory listing the snapshot's own projections enumerate, handed
   * straight to `runSnapshot`. Defaults to `node:fs`.
   *
   * It is a second seam beside `fileSystem` because `StateFileSystem` reads files
   * by path and cannot list a directory, while the runs, amendments and held-change
   * projections all begin by enumerating one. Injecting `fileSystem` alone
   * therefore redirects the reads and leaves the listing on real disk, which is a
   * silent read of the developer's own `.kept/` from a test that believed it was
   * hermetic. See `SnapshotRequest.readDirectory` for the fuller account.
   */
  readonly readDirectory?: ((path: string) => readonly string[]) | undefined;
  /** The plan cache and the `*_test.md` mtime walk. Defaults to `node:fs`. */
  readonly planFileSystem?: PlanFileSystem | undefined;
  /** `covers:` reads. Defaults to `nodeBaselineFileSystem(repoRoot)`. */
  readonly testDocuments?: TestDocumentSource | undefined;
  /** The evidence walk. Defaults to the `node:fs` implementation. */
  readonly evidenceFileSystem?: EvidenceFileSystem | undefined;
  /** The sealed `.evidence` archive read the triage rung needs. Defaults to `node:fs`. */
  readonly sealedPackFileSystem?: SealedPackFileSystem | undefined;
  /** The `failure.yaml` read the triage rung may pull. Defaults to `node:fs`. */
  readonly yaml?: FailureYamlFileSystem | undefined;
  readonly diagnostics?: CollectingDiagnosticSink | undefined;
  /** ISO 8601 instant of the consumed terminal event. Defaults to now. */
  readonly at?: string | undefined;
  /** Epoch milliseconds, for plan staleness. Defaults to `Date.now`. */
  readonly now?: (() => number) | undefined;
  /** What fired the run. `hook: null` means a human ran the CLI (§11.2). */
  readonly trigger?:
    | {
        readonly hook?: HandoffHook | null;
        readonly event?: string | null;
        readonly paths?: readonly string[];
      }
    | undefined;
}

/** What {@link runVerify} did. */
export interface VerifyResult {
  readonly scope: VerifyScope;
  /** The state as written — or, on a refused write, as it stood. */
  readonly state: KeptState;
  readonly statePath: string;
  readonly radius: BlastRadius;
  /** argv actually passed, enabler included. Empty when nothing was invoked. */
  readonly argv: readonly string[];
  readonly invoked: boolean;
  readonly exitCode: number | null;
  readonly exitMeaning: ExitMeaning | null;
  /** Whether `testrun_done` arrived (R4.7). */
  readonly terminalSeen: boolean;
  /** `testrun_plan.valid === false`: nothing ran, verdicts untouched (R4.11). */
  readonly preflightRejected: boolean;
  /** Whether the write guard admitted this run. */
  readonly wrote: boolean;
  /** Which halves of the guard the run failed. Empty exactly when `wrote`. */
  readonly refusals: readonly WriteRefusalReason[];
  readonly updatedPromiseIds: readonly string[];
  readonly members: readonly VerifiedMember[];
  readonly runId: string;
  /** Through `credits()`, which prefers `credits_consumed` (R14.7). */
  readonly credits: number | null;
  /** The newest pack this run resolved, or null. Family-derived (R4.13). */
  readonly evidencePackId: string | null;
  /** Where the captured `[member]` stream landed, or null (R4.12). */
  readonly memberStreamPath: string | null;
  readonly handoff: WriteHandoffResult;
  readonly snapshot: SnapshotResult;
  readonly diagnostics: readonly Diagnostic[];
}

/** The identifier list `--from-context` takes: deduped, sorted, comma-joined. */
export function fromContextValue(testIds: readonly string[]): string {
  return [...new Set(testIds)].sort().join(',');
}

/**
 * The argv for one replay (§7.4, §13.1).
 *
 * **Both scopes name the plan's member paths, and neither can name identifiers.**
 * R4.2 specifies `--changed` as `--from-context <ids>` carrying the radius, and
 * that invocation exits 2 against the installed 0.8.4 for the same measured reason
 * `--all` could not use it: the flag resolves ids against the **assurance graph**,
 * and a plan's `test_id` is a testcase UUID that does not live there —
 *
 * ```
 * error: --from-context: unknown id '6badb68a-3ff8-4a1f-a8bd-3a6a4a2f5e2c' — it
 *   does not resolve in the assurance graph
 * ```
 *
 * — while the only ids it *does* resolve are `t-1`…`t-4`, which name the four
 * unauthored `.testmuai/tests/*_test.md` drafts `design tests` wrote. The corpus is
 * unreachable through that flag in either scope, so `kept verify --changed` — the
 * code hook's own path, and the command that closes the loop — could not fire at
 * all while the requirement's spelling was kept. The correction is the one `--all`
 * already made and nothing more: **the argv names paths, the radius is still
 * computed from identifiers.** `radius.testIds` comes from
 * `testrun_plan.members[].test_id` and from nothing else (R4.4, Property 16), and
 * the paths handed over here are looked up *from those identifiers* by
 * {@link planMemberPaths} — so the set replayed is exactly the set the plan
 * identified, and widening the radius to the whole suite is not a thing this
 * function can do.
 *
 * **Why `--all` needed it first.** Left unscoped,
 * `testrun run` selects every `*_test.md` in the project, which in this repository
 * is thirteen documents rather than eight: the corpus, the verdict spike's
 * transcription, and the four `.testmuai/tests/*_test.md` documents Kane's own
 * `design tests` wrote during the stage-15 bootstrap. Those four have never been
 * authored — the plan gives them **no `test_id`**, because a member's id is read
 * from its recording's `.internal/meta.json`, so no recording means no id — and
 * replaying them authors them live against a discount feature the fixture does not
 * have. A judge's `npm run loop` would spend real credits on documents that mint no
 * promise, which is what R4.6 and R13.6 forbid.
 *
 * Positional member paths are what is left, and they keep the authority where §7.1
 * puts it: every path comes from `testrun_plan.members[]`, and only from members the
 * plan gave an identifier, so the set replayed is exactly the set with a recording.
 *
 * Neither scope carries an NDJSON enabler, because this family gets NDJSON from
 * piped stdout and `--agent` does not exist on `testrun run`.
 */
export function verifyArgv(
  scope: VerifyScope,
  testIds: readonly string[],
  memberPaths: readonly string[] = [],
): readonly string[] {
  // `testIds` is unused in the argv and deliberately still a parameter: it is what
  // decided `memberPaths`, and R4.2's identifier-first rule is easier to check when
  // the function that composes the argv is handed both halves.
  void testIds;
  return Object.freeze([
    ...VERIFY_ARGV_HEAD,
    ...[...new Set(memberPaths)].sort(),
    ...VERIFY_ARGV_TAIL,
  ]);
}

/**
 * The repository-relative paths of the plan members carrying these identifiers.
 *
 * The one lookup that turns a radius into an argv (§7.1, R4.4). It reads
 * `plan.members[]` and nothing else, so a path can only reach Kane by way of a
 * member the plan gave a `test_id` *and* the radius selected: no filename is
 * guessed, no directory is walked, and an identifier the plan does not carry
 * selects nothing.
 */
export function planMemberPaths(
  plan: TestrunPlan | null,
  testIds: readonly string[],
): readonly string[] {
  const wanted = new Set(testIds);
  const paths = new Set<string>();
  for (const member of plan?.members ?? []) {
    if (member.testId !== null && wanted.has(member.testId)) paths.add(toPosix(member.path));
  }
  return Object.freeze([...paths].sort());
}

/**
 * The budget for a whole-suite replay, in milliseconds (§13.1).
 *
 * `timeouts.hookMs` is 300 000 and stays the budget for `--changed`, which is the
 * save-hook path and replays a handful of members. `--all` is a manual operation
 * over the entire suite, and the measurement says it does not fit: one cached
 * three-step member replays in **29 s** wall-clock, and the suite has nine
 * identified members, so 300 s terminates the run mid-flight — a `kane-timeout`
 * and a crashed stream, which writes no verdict at all. Fifteen minutes clears the
 * measured cost with room for the six-step members.
 */
export const VERIFY_ALL_TIMEOUT_MS = 900_000;

/** The budget for one scope. `--changed` keeps the configured hook budget. */
export function verifyTimeoutMs(scope: VerifyScope, hookMs: number): number {
  return scope === 'all' ? Math.max(hookMs, VERIFY_ALL_TIMEOUT_MS) : hookMs;
}

/** Where a run's captured `[member]` stream lands, relative to the repo root. */
export const MEMBER_STREAM_DIRECTORY_RELATIVE_PATH = '.kept/diagnostics';

/**
 * Persist the captured `[member]` stream as NDJSON — R4.12's second clause.
 *
 * One file per run, payloads only, prefix stripped, in arrival order. It is written
 * before anything is routed, so a run whose branch surprises somebody leaves the
 * bytes that decided it — and, more usefully, a run where the signal turned out to
 * be *absent* leaves proof of the absence. Returns the path, or null when there was
 * nothing to write.
 */
function writeMemberStream(
  request: VerifyRequest,
  runId: string,
  lines: readonly string[],
  sink: CollectingDiagnosticSink,
): string | null {
  const payloads = lines
    .filter((line) => line.includes(MEMBER_DEBUG_PREFIX))
    .map((line) => line.slice(line.indexOf(MEMBER_DEBUG_PREFIX) + MEMBER_DEBUG_PREFIX.length));
  if (payloads.length === 0) return null;

  const fileSystem = request.fileSystem ?? nodeStateFileSystem();
  const directory = `${request.repoRoot}/${MEMBER_STREAM_DIRECTORY_RELATIVE_PATH}`;
  const path = `${directory}/${runId.replace(/[^A-Za-z0-9._-]+/g, '_')}.member.ndjson`;
  try {
    fileSystem.ensureDir(directory);
    fileSystem.writeFile(path, `${payloads.join('\n')}\n`);
  } catch (error) {
    sink.report({
      code: VERIFY_DIAGNOSTIC_CODES.memberStreamUnwritten,
      severity: 'warn',
      message:
        `${payloads.length} '[member]' event(s) were captured and could not be written to ` +
        `${MEMBER_STREAM_DIRECTORY_RELATIVE_PATH}/ (${
          error instanceof Error ? error.message : String(error)
        }). The routing is unaffected; only the record of it is missing.`,
    });
    return null;
  }
  sink.report({
    code: VERIFY_DIAGNOSTIC_CODES.memberStreamCaptured,
    severity: 'info',
    message:
      `${payloads.length} '[member]' event(s) were captured into ` +
      `${MEMBER_STREAM_DIRECTORY_RELATIVE_PATH}/${runId}.member.ndjson (R4.12). This is where ` +
      `the classification signal lives: testrun_member_end carries no result code, no reason ` +
      `code and no verdict object.`,
  });
  return path;
}

/** A string field off an unknown record, or null. */
function readString(source: unknown, key: string): string | null {
  if (typeof source !== 'object' || source === null) return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The radius for `--all`: every plan member that carries an identifier.
 *
 * The same authority rule as `computeBlastRadius` — ids come from
 * `plan.members[].test_id` and a member without one is excluded and listed in
 * `skippedNoTestId`. What differs is only the *selection*: `--all` selects the
 * whole plan rather than the tests a changed path covers, so there is nothing to
 * match and `unmatchedPaths` is empty by construction.
 */
function wholeSuiteRadius(plan: TestrunPlan | null, graph: KeptState['graph']): BlastRadius {
  const testIds = new Set<string>();
  const selected = new Set<string>();
  const skippedNoTestId: string[] = [];

  for (const member of plan?.members ?? []) {
    const path = toPosix(member.path);
    if (member.testId === null) {
      skippedNoTestId.push(path);
      continue;
    }
    testIds.add(member.testId);
    selected.add(path);
  }

  const promiseIds = new Set<string>();
  for (const promise of graph.promises) {
    const designed = promise.designedTest;
    if (designed !== null && selected.has(toPosix(designed.path))) promiseIds.add(promise.id);
  }

  return Object.freeze({
    testIds: Object.freeze([...testIds].sort()),
    promiseIds: Object.freeze([...promiseIds].sort()),
    coveringTests: Object.freeze([...selected].sort()),
    skippedNoTestId: Object.freeze(skippedNoTestId.sort()),
    unmatchedPaths: Object.freeze([]),
    diagnostics: Object.freeze([]),
  });
}

/** Every `*_test.md` path worth reading `covers:` from: the plan's, and the graph's. */
function testDocumentPaths(
  plan: TestrunPlan | null,
  graph: KeptState['graph'],
): readonly string[] {
  const paths = new Set<string>();
  for (const member of plan?.members ?? []) paths.add(toPosix(member.path));
  for (const promise of graph.promises) {
    const designed = promise.designedTest;
    if (designed !== null) paths.add(toPosix(designed.path));
  }
  return [...paths].sort();
}

/**
 * Run the verification (design §7.4).
 *
 * Never throws for any state of the world: no plan, no `kane-cli`, an empty
 * radius, a preflight rejection, a stream that stopped mid-suite, a member status
 * from a later Kane release. Every one of those is a diagnostic plus a handoff,
 * and the state file, the handoff and the snapshot are written in all of them.
 */
export async function runVerify(request: VerifyRequest): Promise<VerifyResult> {
  const sink = request.diagnostics ?? createDiagnosticSink();
  const at = request.at ?? new Date().toISOString();
  const scope: VerifyScope = request.all === true ? 'all' : 'changed';
  const changed = request.changed ?? [];

  if (scope === 'all' && changed.length > 0) {
    sink.report({
      code: VERIFY_DIAGNOSTIC_CODES.scopeOverridden,
      severity: 'info',
      message:
        `--all replays every member the plan enumerates, so the ${changed.length} path(s) ` +
        `given with --changed do not narrow it`,
    });
  }

  const store = createStateStore({
    repoRoot: request.repoRoot,
    ...(request.fileSystem === undefined ? {} : { fileSystem: request.fileSystem }),
    sink,
  });
  const prior = store.load();

  sink.report({
    code: VERIFY_DIAGNOSTIC_CODES.started,
    severity: 'info',
    message:
      `kept verify --${scope}: ${prior.graph.promises.length} promise(s) in the graph, ` +
      `budget ${request.config.timeouts.hookMs} ms, router '${request.config.verdictRouter}'`,
  });

  // ── The plan. The only authority on the identifiers Kane accepts (R4.4). ───
  const plan = await readPlan({
    cwd: request.repoRoot,
    repoRoot: request.repoRoot,
    // `corpus.root`, so the staleness walk looks where this repository's designed
    // tests actually live rather than at a directory the engine invented (§20.1).
    corpusRoot: request.config.corpus.root,
    sink,
    ...(request.invoker === undefined ? {} : { invoker: request.invoker }),
    ...(request.planFileSystem === undefined
      ? {}
      : { fs: request.planFileSystem }),
    ...(request.now === undefined ? {} : { now: request.now }),
  });

  // ── The radius. Zero identifiers means zero Kane processes (R4.5). ────────
  const radius =
    scope === 'all'
      ? wholeSuiteRadius(plan, prior.graph)
      : computeBlastRadius({
          changed,
          graph: prior.graph,
          plan,
          covers: collectTestCoverage({
            source: request.testDocuments ?? nodeBaselineFileSystem(request.repoRoot),
            paths: testDocumentPaths(plan, prior.graph),
            sink,
          }),
          repoRoot: request.repoRoot,
          sink,
        });

  // R4.6's cost rule, made visible: a member with no plan identifier has no
  // recording to replay from, so naming it would author it live. `--all` leaves it
  // out, and says so per member rather than quietly running a shorter suite.
  if (scope === 'all') {
    for (const path of radius.skippedNoTestId) {
      sink.report({
        code: VERIFY_DIAGNOSTIC_CODES.suiteMemberUnidentified,
        severity: 'warn',
        message:
          `${path} is in the testrun plan with no test_id, which means Kane holds no recording ` +
          `for it, so replaying it would author it live and spend credits. It is excluded from ` +
          `the whole-suite replay and no verdict of its own moves.`,
        file: path,
      });
    }
  }

  // The argv names paths, and every path is looked up from an identifier the radius
  // selected — never from `radius.coveringTests`, which for `--changed` also holds
  // the documents that covered the save but carried no `test_id`, and naming one of
  // those would author it live.
  const argv = verifyArgv(scope, radius.testIds, planMemberPaths(plan, radius.testIds));
  const invoke = shouldInvokeKane(radius) && request.invoker !== undefined;
  if (shouldInvokeKane(radius) && request.invoker === undefined) {
    sink.report({
      code: VERIFY_DIAGNOSTIC_CODES.kaneUnavailable,
      severity: 'warn',
      message:
        `${radius.testIds.length} member(s) are in the blast radius but there is no Kane ` +
        `boundary to replay them with, so nothing was invoked and every existing verdict is ` +
        `preserved`,
    });
  }

  // R4.12: the `[member]` stream, captured in full rather than tailed. This is not
  // diagnostics — `testrun_member_end` carries no result code, no reason code and
  // no verdict object, so a member's own `run_end` on stderr is the only place the
  // signal R6.4 calls primary exists. See `kane/memberDebug.ts`.
  const stderrLines: string[] = [];
  const invocation: InvocationResult<typeof VERIFY_FAMILY> | null = invoke
    ? await (request.invoker as KaneInvoker).invoke({
        family: VERIFY_FAMILY,
        // No enabler: NDJSON comes from the pipe, and the invoker asserts that no
        // `--agent` reached this argv (§4.1, R3.5).
        argv,
        cwd: request.repoRoot,
        env: memberDebugEnv(request.config),
        timeoutMs: verifyTimeoutMs(scope, request.config.timeouts.hookMs),
        onStderrLine: (line: string): void => {
          stderrLines.push(line);
        },
      })
    : null;

  const stream: ParsedStream<typeof VERIFY_FAMILY> | null =
    invocation === null
      ? null
      : parseStream(contractFor(VERIFY_FAMILY), invocation.stdoutLines, { sink });
  const terminal = stream !== null && stream.kind === 'complete' ? stream.terminal : null;
  // `execution_id` is the id this family actually carries: `testrun_done` is
  // `{type, execution_id, overall_status}` — no `run_id`, observed on the live
  // stream and recorded in `docs/kane/verdict-spike.md`. It is also the id Kane
  // seals the evidence pack under, so reading it is what ties a run entry to the
  // artefacts a judge clicks. `run_id` is still preferred in case a later release
  // adds one, and the synthetic id remains for a stream that carried neither.
  const runId =
    readString(terminal, 'run_id') ??
    readString(terminal, 'execution_id') ??
    `${SYNTHETIC_RUN_ID_PREFIX}${at}`;

  // ── 1. `testrun_plan`. `valid: false` is a preflight rejection (R4.11). ───
  let preflightRejected = false;
  if (stream !== null && stream.plan !== null && stream.plan.valid !== true) {
    preflightRejected = true;
    const members = stream.plan.members ?? [];
    for (const member of members) {
      sink.report({
        code: VERIFY_DIAGNOSTIC_CODES.preflightRejected,
        severity: 'warn',
        message:
          `preflight rejected ${member.path ?? 'a member the plan did not name'}` +
          `${typeof member.failure === 'string' ? `: ${member.failure}` : ''}. Nothing was ` +
          `executed, so every existing verdict and the freshness triple are preserved.`,
        ...(typeof member.path === 'string' ? { file: member.path } : {}),
      });
    }
    if (members.length === 0) {
      sink.report({
        code: VERIFY_DIAGNOSTIC_CODES.preflightRejected,
        severity: 'warn',
        message:
          `the testrun plan reported the suite as invalid and named no members, so nothing ` +
          `was executed and every existing verdict is preserved`,
      });
    }
  }

  // ── 4. Evidence, from the family — never from an event field (R4.13). ─────
  const evidence: EvidenceListing | null =
    stream === null
      ? null
      : listArtifacts({
          family: VERIFY_FAMILY,
          cwd: request.repoRoot,
          // This run's own pack, not whatever sealed last. `testrun_done` carries
          // `execution_id` and Kane names the archive after it, so the promise's
          // `evidencePackId` names a file that exists — which is what lets
          // `kept snapshot` curate it and a judge click a real artefact.
          executionId:
            readString(terminal, 'execution_id') ?? readString(terminal, 'run_id'),
          diagnostics: sink,
          ...(request.evidenceFileSystem === undefined
            ? {}
            : { fs: request.evidenceFileSystem }),
        });

  // The triage notes sealed inside this run's own `.evidence` archive, keyed by the
  // member `test_id` the pack itself declares (§6.3, R6.7).
  //
  // This is the other half of the gap `docs/kane/loop/README.md` measured. Kane's
  // inline verdict object is not stable — for one unchanged failure it has said
  // `confirmed: true`, said nothing at all, and said `confirmed: false` across six
  // runs — while the sealed note has said `application_issue/ui_data_defect` at
  // confidence 0.96 on the first attempt, every time. The note is the signal; it
  // was simply inside a zip nothing opened.
  //
  // Attribution is by identifier, never by name: the pack's `tests/<slug>/
  // result.yaml` carries `external_id.test_id`, the same UUID `testrun_member_end`
  // reports, so no member is ever handed another member's judgement. The archive is
  // located in the family-derived evidence directory and **filtered** by this run's
  // execution id, so a pack sealed by a previous or parallel run is not read at all.
  const sealedTriage: SealedPackTriage | null =
    terminal === null
      ? null
      : readSealedPackTriage({
          evidenceDir: evidence?.dir ?? null,
          executionId: readString(terminal, 'execution_id') ?? readString(terminal, 'run_id'),
          diagnostics: sink,
          ...(request.sealedPackFileSystem === undefined
            ? {}
            : { fs: request.sealedPackFileSystem }),
        });

  // ── 2 and 5. Members, mapped and routed. ─────────────────────────────────
  const router = selectRouter({ verdictRouter: request.config.verdictRouter }, sink);
  const byPath = new Map<string, PromiseRecord[]>();
  for (const promise of prior.graph.promises) {
    const designed = promise.designedTest;
    if (designed === null) continue;
    const key = toPosix(designed.path);
    const existing = byPath.get(key) ?? [];
    existing.push(promise);
    byPath.set(key, existing);
  }
  const pathForTestId = new Map<string, string>();
  for (const member of plan?.members ?? []) {
    if (member.testId !== null) pathForTestId.set(member.testId, toPosix(member.path));
  }

  const members: VerifiedMember[] = [];
  const results: HandoffResultInput[] = [];
  const writes: VerdictWrite[] = [];

  // Pair the captured member terminals with the suite's member events, by order,
  // and refuse the whole attribution on any disagreement. `terminals[i]` is the
  // signal for the ith member event, or null when there is none to trust.
  const memberEvents = stream?.members ?? [];
  // R4.12's second clause: the captured events land in the run diagnostics, as
  // NDJSON, one file per run. Without this the only record of the signal that
  // decided a branch is the branch itself — and when the signal is *absent*, as it
  // was on the first live loop, there is nothing at all to look at.
  const memberStreamPath = writeMemberStream(request, runId, stderrLines, sink);
  const pairing = pairMemberDebug(
    memberEvents.map((event) => ({
      status: typeof event.status === 'string' ? event.status : '',
      path:
        typeof event.path === 'string' && event.path.trim().length > 0
          ? toRepoRelative(event.path.trim(), request.repoRoot)
          : null,
    })),
    parseMemberDebug(stderrLines, sink),
    sink,
  );

  let memberIndex = -1;
  for (const event of memberEvents) {
    memberIndex += 1;
    const memberTerminal = pairing.terminals[memberIndex] ?? null;
    const status = typeof event.status === 'string' ? event.status : '';
    const testId = typeof event.test_id === 'string' && event.test_id.length > 0
      ? event.test_id
      : null;
    // Kane reports this path absolute; the graph keys on repository-relative
    // (§7.3). One conversion, on the boundary, or every member is unattributed.
    const path =
      typeof event.path === 'string' && event.path.trim().length > 0
        ? toRepoRelative(event.path.trim(), request.repoRoot)
        : testId === null
          ? null
          : pathForTestId.get(testId) ?? null;

    // R4.9: the status is recorded verbatim here, whatever happens to the
    // verdict, so `broken` stays distinguishable from an asserted failure.
    const mapping = reportMemberStatus({ status, testId, path }, sink);
    const attributed = path === null ? [] : byPath.get(path) ?? [];
    if (attributed.length === 0) {
      sink.report({
        code: VERIFY_DIAGNOSTIC_CODES.memberUnattributed,
        severity: 'warn',
        message:
          `testrun_member_end reported "${status}" for ` +
          `${testId ?? path ?? 'a member carrying neither a test id nor a path'}, which no ` +
          `promise in the graph is designed by, so the result was recorded and no verdict moved`,
        ...(path === null ? {} : { file: path }),
      });
    }

    // Only `failed` and `broken` enter the router, and only a stream that reached
    // its terminal event has a failing terminal to reason from.
    const routable = entersVerdictRouter(status) && terminal !== null;
    let repair: RoutedRepair | null = null;

    for (const promise of attributed) {
      if (routable && repair === null) {
        repair = router.route(
          createFailureContext({
            family: VERIFY_FAMILY,

            // Never `testrun_done`. R3.3 says verdict data comes from the
            // terminal event *plus* this family's members, and for this family it
            // is entirely the members: the suite terminal is
            // `{type, execution_id, overall_status}` and carries no code at all.
            //
            // Which member event, though, is the thing that was measured wrong.
            // `testrun_member_end` carries `path`, `test_id` and `status` and
            // **nothing else** — no `result_code`, no `reason_code`, no `verdict`
            // object — so routing from it makes every failure fall past §6.2's
            // object and numeric rungs into the triage note, and the note lives
            // inside a sealed `.evidence` zip that `listArtifacts` does not open.
            // The result was `docs-lie` for every failure ever routed, including a
            // deliberately broken `subtotal`. The member's **own** `run_end`, from
            // the `[member]` stream (R4.12), carries all three; it is preferred
            // when the capture paired, and the member event remains the fallback
            // so an unpaired run still routes conservatively rather than not at
            // all. The suite terminal is still *required*: `terminal !== null` is
            // what says `testrun_done` arrived, and routing is gated on it.
            terminal: memberTerminal ?? (event as Record<string, unknown>),
            promiseId: promise.id,
            ...(isMemberStatus(status) ? { memberStatus: status } : {}),
            evidence,
            repoRoot: request.repoRoot,
            verdictObject: memberTerminal?.['verdict'] ?? event.verdict,
            // Null unless the pack tied a note to *this* member's test id.
            sealedTriage: sealedNoteFor(sealedTriage, testId),
            diagnostics: sink,
            ...(request.yaml === undefined ? {} : { yaml: request.yaml }),
          }),
        );
      }
      results.push({
        promise,
        testId,
        memberStatus: isMemberStatus(status) ? status : null,
        verdict: mapping.verdict,
        repair,
        verdictObject: memberTerminal?.['verdict'] ?? event.verdict,
        evidence,
      });
      // A preflight-rejected run executed nothing, so it proposes no verdict at
      // all — the guard would refuse the write anyway on exit two, and this keeps
      // that true even for a plan that reported `valid: false` some other way.
      if (preflightRejected) continue;
      writes.push({
        promiseId: promise.id,
        verdict: mapping.verdict,
        memberStatus: isMemberStatus(status) ? status : null,
        // Same source as the routing, and for the same reason: the code, the
        // reason code and the credits a member's judgement cost are all on its own
        // `run_end` and none of them are on `testrun_member_end`.
        resultCode: resultCode(memberTerminal ?? (event as Record<string, unknown>)),
        reasonCode:
          readString(memberTerminal, 'reason_code') ?? readString(event, 'reason_code'),
        repair,
        evidencePackId: evidence?.pack?.id ?? null,
        credits: creditsOf(memberTerminal ?? (event as Record<string, unknown>)),
      });
    }

    members.push({
      status,
      known: mapping.known,
      verdict: mapping.verdict,
      testId,
      path,
      promiseIds: attributed.map((promise) => promise.id),
      repair,
    });
  }

  // ── 3 and 6. The guard. A crashed stream writes nothing, by construction. ──
  //
  // Through `outcomeFromInvocation` rather than as an object literal. The literal
  // read `invocation.exitMeaning` verbatim and was therefore correct, but core's
  // own doc comment says the pairing exists so the exit meaning is read from the
  // result and never recomputed, which only holds while every caller goes through
  // it. Three call sites spelling the pairing by hand made that a convention, and
  // a convention is what the exit-3 rule cannot afford: an Assurance pause read as
  // a failure overwrites good verdicts with red ones.
  const outcome: RunOutcome<typeof VERIFY_FAMILY> | null =
    invocation === null || stream === null
      ? null
      : outcomeFromInvocation(runId, invocation, stream);

  const applied =
    outcome === null
      ? null
      : store.applyRun(prior, {
          outcome,
          writes,
          // Promises outside this set are carried across by reference, verdict
          // source and freshness evidence included (R4.15).
          radius: radius.promiseIds,
          at,
          sink,
        });

  if (stream !== null && stream.kind === 'crashed') {
    sink.report({
      code: VERIFY_DIAGNOSTIC_CODES.outcomeUnknown,
      severity: 'warn',
      message:
        `the testrun stream ended without its '${stream.expectedTerminal}' event after ` +
        `${stream.members.length} member result(s), so the outcome is unknown: no verdict was ` +
        `written and the freshness triple stands`,
    });
  }

  const state = applied?.state ?? prior;
  const written = store.save(state);

  // ── 7. Handoff, then snapshot (R4.14). The handoff is written every run. ──
  const handoff = writeHandoff({
    repoRoot: request.repoRoot,
    fences: handoffFenceSurfaces(request.config),
    runId,
    run: outcome,
    exitCode: invocation?.exitCode ?? null,
    // Measured by the invoker, carried rather than derived: `/runs` publishes a
    // duration only when a process was actually timed (§10.1).
    durationMs: invocation?.durationMs ?? null,
    radius,
    results,
    trigger: request.trigger ?? { hook: null, event: null, paths: changed },
    command: {
      family: VERIFY_FAMILY,
      argv: invocation?.effectiveArgv ?? [],
      invoked: invocation !== null,
    },
    diagnostics: sink.entries,
    at,
    ...(request.fileSystem === undefined ? {} : { fileSystem: request.fileSystem }),
  });

  const snapshot = runSnapshot({
    repoRoot: request.repoRoot,
    state: written,
    generatedAt: at,
    diagnostics: sink,
    ...(request.fileSystem === undefined ? {} : { fileSystem: request.fileSystem }),
    // Both seams or neither. `fileSystem` alone redirects the projections' file
    // reads and leaves their directory listings on real disk.
    ...(request.readDirectory === undefined ? {} : { readDirectory: request.readDirectory }),
  });

  sink.report({
    code: VERIFY_DIAGNOSTIC_CODES.completed,
    severity: 'info',
    message:
      `kept verify --${scope}: ${radius.testIds.length} member(s) in the radius, ` +
      `${members.length} result(s) consumed, ${applied?.updatedPromiseIds.length ?? 0} ` +
      `verdict(s) written${
        applied === null || applied.wrote ? '' : ` (${applied.refusals.join(', ')})`
      }`,
  });

  return {
    scope,
    state: written,
    statePath: store.path,
    radius,
    argv: invocation?.effectiveArgv ?? argv,
    invoked: invocation !== null,
    exitCode: invocation?.exitCode ?? null,
    exitMeaning: invocation?.exitMeaning ?? null,
    terminalSeen: terminal !== null,
    preflightRejected,
    wrote: applied?.wrote ?? false,
    refusals: applied?.refusals ?? [],
    updatedPromiseIds: applied?.updatedPromiseIds ?? [],
    members: Object.freeze(members),
    runId,
    credits: terminal === null ? null : creditsOf(terminal as Record<string, unknown>),
    evidencePackId: evidence?.pack?.id ?? null,
    memberStreamPath,
    handoff,
    snapshot,
    diagnostics: sink.entries,
  };
}
