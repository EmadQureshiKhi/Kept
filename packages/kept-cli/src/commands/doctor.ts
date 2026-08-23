/**
 * `kept doctor`: seven checks, one spawn, a remedy each, exit zero either way
 * (design §21.2, §20.3, §20.4, R18.1 through R18.10, R2.12).
 *
 * ## Why this command is held to a stricter standard than the rest
 *
 * Every other command in this product reports on a repository that has already
 * been made to work. This one reports on a repository that has not, in the hands
 * of somebody who has just installed the packages and has no reason yet to trust
 * them. So it is the one command whose *failure modes are its entire purpose*: a
 * diagnosis that throws on a missing config, or that exits non-zero because Kane
 * is not installed, has told the reader nothing except that the tool is broken
 * too. That is why three things here are structural rather than disciplined.
 *
 * **Exit code 0, as a type.** {@link DoctorResult.exitCode} is the literal `0`
 * (R18.8). There is no code path that can return anything else, because there is
 * no other value the field admits. Kane's absence is a supported state of the
 * world (R2.12) and `doctor` of all commands must not be the one that treats it
 * as fatal.
 *
 * **At most one Kane spawn, as a type.** {@link DoctorInvoker} is
 * `Pick<KaneInvoker, 'invokePlain'>` and nothing else, so check 6 *cannot* ask
 * Kane whether a context store exists. The method that would let it does not
 * exist on the seam it holds. Check 1 is the only spawn, it goes through
 * `invokePlain` (family-less, appends nothing, the same door `context list`
 * uses), and {@link DoctorResult.spawns} reports the count so a caller can assert
 * it rather than infer it (R18.2).
 *
 * **Determinacy over the seven checks.** {@link DOCTOR_CHECK_IDS} is the design's
 * own list in the design's own order, and {@link runDoctor} builds exactly one
 * {@link DoctorCheck} per entry. A check cannot be skipped by an early return,
 * because there are no early returns: each check is a function from the seams to
 * a status, and the result is the seven of them.
 *
 * ## The three-value status vocabulary, and which value means what
 *
 * `pass` is "this works". `fail` is "this is configured and does not work".
 * `not-configured` is "there is nothing here to check yet, and inventing one
 * would be a guess". The distinction is the whole of §20.4's fail-closed
 * direction: a null `subject.baseUrl` reports `not-configured` and probes
 * **nothing**, rather than probing a port on a stranger's machine. Every status
 * that is not `pass` carries a remedy (R18.9), and that too is checked by
 * construction: {@link doctorCheck} refuses to build a non-passing check with a
 * null remedy.
 *
 * ## What it writes
 *
 * The handoff, and nothing else (R18.10). An agent reads a diagnosis the same way
 * it reads every other outcome, rather than parsing stdout. `command.family` is
 * null because `--version` belongs to no family, and `run` is absent because a
 * plain invocation has no terminal event to prove an outcome with, so no verdict
 * can move from here, by construction rather than by a guard.
 *
 * ## `not-configured` versus `fail`, decided once
 *
 * The two are easy to blur and the difference is the whole value of the command:
 * `not-configured` is "nothing here has been set up yet", `fail` is "this was set
 * up and does not work". A stranger's directory, with no `.kept/config.json`, no
 * snapshot, no corpus, no `.context/`, no Kane, is the first, every check of it,
 * and the remedy it wants is `kept init` rather than seven separate diagnoses of a
 * repository that has not begun (§22.1). A repository whose config names a corpus
 * root that holds no designed tests is the second, and telling that reader to run
 * `kept init` would be wrong.
 *
 * So the rule is applied uniformly: a check reports `not-configured` when the
 * value it depends on was never authored: an absent config file, a null
 * `subject.baseUrl`, an empty allow set, an artefact nothing has built yet. It
 * reports `fail` only when something was authored or present and did not hold up.
 * §20.4's defaults are what make this decidable: every one of them fails closed,
 * so "the default is in force" and "nothing was configured" are the same fact.
 */

import type {
  BaselineFileSystem,
  CollectingDiagnosticSink,
  Diagnostic,
  ExitMeaning,
  KaneInvoker,
  StateFileSystem,
  WriteHandoffResult,
} from '@kept/core';
import {
  KANE_BINARY_NAME,
  createDiagnosticSink,
  extractVerifiesTags,
  isSkippedDirectoryName,
  isTestDocumentName,
  nodeBaselineFileSystem,
  nodeStateFileSystem,
  parseSnapshot,
  writeHandoff,
} from '@kept/core';

import {
  CONFIG_FILE_RELATIVE_PATH,
  REPAIR_BRANCH_NAMES,
  fenceFindings,
  handoffFenceSurfaces,
  joinPath,
  loadConfig,
  type FenceFinding,
  type KeptConfig,
} from '../config.js';
import { SNAPSHOT_FILE_RELATIVE_PATH } from '../snapshot.js';

// ---------------------------------------------------------------------------
// The seven checks, as data
// ---------------------------------------------------------------------------

/**
 * The seven checks of §21.2's table, in the table's own order.
 *
 * Named as data so a test can enumerate them and so a row added to the design is
 * a compile error here rather than a check nobody noticed was missing.
 */
export const DOCTOR_CHECK_IDS = Object.freeze([
  'kane-binary',
  'configuration',
  'corpus',
  'snapshot',
  'subject-reachable',
  'context-store',
  'fences',
] as const);

/** One check's identifier. */
export type DoctorCheckId = (typeof DOCTOR_CHECK_IDS)[number];

/** The three values a check may report (§21.2). Exactly these. */
export const DOCTOR_STATUSES = Object.freeze(['pass', 'fail', 'not-configured'] as const);

/** One check's verdict. */
export type DoctorStatus = (typeof DOCTOR_STATUSES)[number];

/** Human titles, keyed by id, total over the vocabulary. */
export const DOCTOR_CHECK_TITLES: { readonly [K in DoctorCheckId]: string } = Object.freeze({
  'kane-binary': 'Kane binary',
  configuration: 'Configuration',
  corpus: 'Corpus',
  snapshot: 'Snapshot',
  'subject-reachable': 'Subject reachable',
  'context-store': 'Context store',
  fences: 'Fences',
});

/** One reported check. `remedy` is non-null whenever `status` is not `pass`. */
export interface DoctorCheck {
  readonly id: DoctorCheckId;
  /** 1 through 7, matching §21.2's table so a reader can follow along. */
  readonly number: number;
  readonly title: string;
  readonly status: DoctorStatus;
  /** What was observed, in the words a stranger needs. Never empty. */
  readonly detail: string;
  /** The command or file edit that fixes it (R18.9). Null only when passing. */
  readonly remedy: string | null;
}

/**
 * Build one check.
 *
 * The invariant R18.9 asks for is enforced here rather than asserted downstream:
 * a non-passing check with no remedy is not constructible, so there is one place
 * to read to know the rule holds instead of seven.
 */
function doctorCheck(
  id: DoctorCheckId,
  status: DoctorStatus,
  detail: string,
  remedy: string | null,
): DoctorCheck {
  const number = DOCTOR_CHECK_IDS.indexOf(id) + 1;
  return Object.freeze({
    id,
    number,
    title: DOCTOR_CHECK_TITLES[id],
    status,
    detail,
    // A passing check needs no remedy and a failing one cannot be without one.
    // The fallback is not padding: it is the sentence a reader gets if a future
    // arm forgets, and it still names the command that reports the detail.
    remedy:
      status === 'pass'
        ? null
        : (remedy ?? `Run \`${KANE_BINARY_NAME} --help\` and \`kept doctor\` again`),
  });
}

// ---------------------------------------------------------------------------
// Constants this command owns
// ---------------------------------------------------------------------------

/** The version probe. Family-less by construction: it starts with a flag. */
export const DOCTOR_VERSION_ARGV: readonly string[] = Object.freeze(['--version']);

/** `timeouts.doctorMs`'s default (§20.4, R18.2). */
export const DEFAULT_DOCTOR_TIMEOUT_MS = 10_000;

/**
 * The reachability budget (§21.2 row 5). Two seconds, and deliberately not
 * configurable: the question is "is something listening", and a base URL that
 * needs longer than two seconds to answer that has already answered it.
 */
export const SUBJECT_PROBE_TIMEOUT_MS = 2_000;

/** Kane's own store directory, relative to the repository root. */
export const CONTEXT_STORE_RELATIVE_PATH = '.context';

/** The Kane release every observation in this repository was made against. */
export const VERIFIED_KANE_VERSION = '0.8.4';

/** The synthetic run id, since a version probe carries none of Kane's own. */
export const SYNTHETIC_RUN_ID_PREFIX = 'kept-doctor:';

/** Diagnostic codes this command reports. Stable; the Ledger keys off them. */
export const DOCTOR_DIAGNOSTIC_CODES = Object.freeze({
  started: 'doctor-started',
  /** One per check, whatever the status, so `/runs` carries the whole table. */
  check: 'doctor-check',
  completed: 'doctor-completed',
} as const);

/** The codes as a list, so a test can enumerate them. */
export const DOCTOR_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(DOCTOR_DIAGNOSTIC_CODES),
);

/**
 * The remedy for a missing binary, naming the version this repository is verified
 * against (§21.2 row 1). A remedy that said only "install Kane" would leave the
 * reader to discover for themselves that the exit-code vocabulary is per-release.
 */
export const KANE_INSTALL_REMEDY =
  `Install the Kane CLI and put \`${KANE_BINARY_NAME}\` on PATH. Every Kane observation ` +
  `in this repository was made against ${VERIFIED_KANE_VERSION}, so that is the release ` +
  `the exit codes and terminal events are verified against`;

/**
 * The context-store remedy, quoted verbatim (§21.2 row 6), and both commands,
 * not one. A headless ingest lands the source and never extracts (§4.9.1), so a
 * remedy naming only the first leaves the reader with a store Kane can list and
 * `cover` still refuses.
 */
export const CONTEXT_INGEST_REMEDY =
  `Run \`${KANE_BINARY_NAME} context ingest <files> --mode ci\` and then ` +
  `\`${KANE_BINARY_NAME} context extract\`. Both are needed: with stdin ignored an ingest ` +
  `lands the source only and never continues into extraction`;

// ---------------------------------------------------------------------------
// The seams
// ---------------------------------------------------------------------------

/**
 * The Kane boundary, narrowed to the one door check 1 is allowed through.
 *
 * `Pick<KaneInvoker, 'invokePlain'>` rather than `KaneInvoker`, and that is the
 * enforcement of R18.2 rather than a convenience: `invoke` is not reachable from
 * here, so no check in this file can start a second process by taking a different
 * door, and check 6 cannot ask Kane about the context store because there is no
 * method on this type that would let it. A real `KaneInvoker` satisfies it
 * structurally, so production wiring is unchanged.
 */
export type DoctorInvoker = Pick<KaneInvoker, 'invokePlain'>;

/** What one reachability probe observed. Never a throw; absence is data. */
export interface DoctorProbeOutcome {
  /** Whether anything answered at all. An HTTP error status still answers. */
  readonly reachable: boolean;
  /** The HTTP status, when one arrived. Null when nothing did. */
  readonly status: number | null;
  /** Why nothing answered, in the transport's own words. Null on success. */
  readonly error: string | null;
  readonly durationMs: number;
}

/** The reachability seam, so the whole command runs with no network. */
export type DoctorUrlProbe = (url: string, timeoutMs: number) => Promise<DoctorProbeOutcome>;

/**
 * The §20.3 intersection guard, injected so check 7 can be asserted against a
 * finding without an adversarial config having to be written first.
 *
 * Defaults to `config.ts`'s own `fenceFindings`, which is the *same* function
 * `loadConfig` runs its refusal through. That matters more than it looks: a doctor
 * with its own opinion about glob intersection would eventually disagree with the
 * loader, and a fence check that says "clean" about a config the loader refused is
 * worse than no fence check at all.
 */
export type DoctorFenceReader = (config: KeptConfig) => readonly FenceFinding[];

/**
 * The production reachability probe: one GET, bounded, and nothing read off the
 * body.
 *
 * A response is a response. A 404 or a 500 means something is listening on that
 * URL, which is exactly what R18.5 asks: a reachability check that demanded 2xx
 * would report "not reachable" for an application that is up and has no route at
 * `/`, and the remedy it printed ("start the application") would be wrong.
 *
 * `AbortController` rather than `AbortSignal.timeout`, so the timer is cleared on
 * the success path and a bounded probe does not keep the event loop alive for the
 * remainder of its budget.
 */
export const nodeUrlProbe: DoctorUrlProbe = async (url, timeoutMs) => {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    return {
      reachable: true,
      status: response.status,
      error: null,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
};

// ---------------------------------------------------------------------------
// The configuration this command reads (§20.1, §20.4)
// ---------------------------------------------------------------------------
//
// Every accessor below reads a field the type says is present and defends against
// its absence anyway. That is the same "cast then default" `fenceFindings` applies
// to `config.fences[branch]`, and for the same stated reason: a `KeptConfig`
// reaching this command has crossed a JSON boundary, and a diagnostic tool that
// throws on the shape it was asked to diagnose has failed at the one job it has.

/** `timeouts.doctorMs` when the config carries a usable one, else the default. */
export function doctorTimeoutMs(config: KeptConfig): number {
  const value = (config.timeouts as { readonly doctorMs?: unknown } | undefined)?.doctorMs;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return DEFAULT_DOCTOR_TIMEOUT_MS;
  }
  return value;
}

/**
 * `corpus.root`, normalised, or null when the config carries nothing usable.
 *
 * Null means "no directory to scan", and no directory name is invented here to
 * stand in for it. §20.4's default for this key belongs to the loader, which
 * announces applying it; a *second* default invented in the diagnostic tool would
 * let `doctor` report a file count for a directory the rest of the product never
 * scanned.
 */
export function corpusRoot(config: KeptConfig): string | null {
  const root = (config.corpus as { readonly root?: unknown } | undefined)?.root;
  return typeof root === 'string' && root.trim().length > 0 ? root.trim() : null;
}

/** `subject.baseUrl`, or null, which is §20.4's default, and the fail-closed answer. */
export function subjectBaseUrl(config: KeptConfig): string | null {
  const baseUrl = (config.subject as { readonly baseUrl?: unknown } | undefined)?.baseUrl;
  return typeof baseUrl === 'string' && baseUrl.trim().length > 0 ? baseUrl.trim() : null;
}

/**
 * How many allow globs the three fences declare between them.
 *
 * Zero is §20.4's fail-closed default and means no autonomy was granted, so there
 * is no fence to intersect anything, which is `not-configured` rather than a
 * pass. A pass has to mean "autonomy was granted and it stays off the claims".
 */
export function declaredAllowGlobs(config: KeptConfig): number {
  let total = 0;
  for (const branch of REPAIR_BRANCH_NAMES) {
    const fence = config.fences?.[branch] as { readonly allow?: unknown } | undefined;
    const allow = fence?.allow;
    if (Array.isArray(allow)) total += allow.length;
  }
  return total;
}

// ---------------------------------------------------------------------------
// What each check found
// ---------------------------------------------------------------------------

/** Check 1's observations (R18.1). */
export interface DoctorKaneReport {
  /** Whether a binary was resolved and answered. */
  readonly present: boolean;
  /** Absolute path spawned, or null when nothing was found or nothing ran. */
  readonly resolvedBinary: string | null;
  /** The version Kane reported, verbatim, or null when it reported none. */
  readonly version: string | null;
  readonly exitCode: number | null;
  readonly exitMeaning: ExitMeaning | null;
  readonly timedOut: boolean;
  readonly durationMs: number | null;
  /** argv actually issued. Empty when nothing was invoked. */
  readonly argv: readonly string[];
  /** True for the one invocation this command is allowed (R18.2). */
  readonly invoked: boolean;
  /** The budget the probe was given, from `timeouts.doctorMs`. */
  readonly timeoutMs: number;
}

/** Check 2's observations (R18.3). */
export interface DoctorConfigReport {
  /** Whether the file was present, parsed, and every field usable. */
  readonly loaded: boolean;
  /** Whether the file exists at all. Absent and malformed are different facts. */
  readonly present: boolean;
  /** The router in force for this invocation, overrides included. */
  readonly verdictRouter: string;
  /** The loader's own diagnostics, so a field path reaches the reader. */
  readonly diagnostics: readonly Diagnostic[];
  readonly path: string;
}

/** Check 3's observations (R18.7). */
export interface DoctorCorpusReport {
  /** The configured root, or null when the config names none. */
  readonly root: string | null;
  /** Whether the root could be listed at all. */
  readonly readable: boolean;
  /** `*_test.md` files found under it, repository-relative POSIX, sorted. */
  readonly files: readonly string[];
  /** Well-formed `@verifies` tags those files carry. */
  readonly verifiesTags: number;
}

/** Check 4's observations (R18.4). */
export interface DoctorSnapshotReport {
  readonly path: string;
  readonly present: boolean;
  /** Whether the snapshot parser accepted it. */
  readonly valid: boolean;
  /** The parser's own message, when it refused. */
  readonly error: string | null;
}

/** Check 5's observations (R18.5). */
export interface DoctorSubjectReport {
  readonly baseUrl: string | null;
  /** False whenever `baseUrl` is null: nothing is probed (§20.4). */
  readonly probed: boolean;
  readonly reachable: boolean;
  readonly status: number | null;
  readonly error: string | null;
  readonly durationMs: number | null;
  readonly timeoutMs: number;
}

/** Check 6's observations (R18.6). Read from the filesystem, never from Kane. */
export interface DoctorContextStoreReport {
  readonly path: string;
  readonly present: boolean;
}

/** Check 7's observations (§20.3). Reported even when it passes. */
export interface DoctorFenceReport {
  /** Whether the guard could be asked at all. */
  readonly available: boolean;
  /** Allow globs the three fences declare between them. Zero grants no autonomy. */
  readonly declaredGlobs: number;
  readonly findings: readonly FenceFinding[];
}

/** What {@link runDoctor} did. */
export interface DoctorResult {
  /** Exactly seven, in §21.2's order, one per {@link DOCTOR_CHECK_IDS} entry. */
  readonly checks: readonly DoctorCheck[];
  /**
   * Always `0`, as a type (R18.8). Kane's absence, a missing config, an
   * unparseable snapshot and an unreachable subject are all states of the world,
   * and `doctor` is the last command that should report one as a failure of KEPT.
   */
  readonly exitCode: 0;
  /** How many Kane processes were started. Never more than one (R18.2). */
  readonly spawns: number;
  readonly kane: DoctorKaneReport;
  readonly config: DoctorConfigReport;
  readonly corpus: DoctorCorpusReport;
  readonly snapshot: DoctorSnapshotReport;
  readonly subject: DoctorSubjectReport;
  readonly contextStore: DoctorContextStoreReport;
  readonly fences: DoctorFenceReport;
  /** The only file this command writes (R18.10). */
  readonly handoff: WriteHandoffResult;
  readonly runId: string;
  readonly diagnostics: readonly Diagnostic[];
}

/** {@link runDoctor}'s input. Every seam has a production default. */
export interface DoctorRequest {
  /** Absolute repository root. `process.cwd()` is never substituted downstream. */
  readonly repoRoot: string;
  /** The config in force, overrides applied. Check 2 reports its router. */
  readonly config: KeptConfig;
  /**
   * The one Kane door check 1 may use. Omit it and check 1 reports
   * `not-configured` having spawned nothing, which is the honest answer for a run
   * that was given no process boundary.
   */
  readonly invoker?: DoctorInvoker | undefined;
  /** Config, snapshot and handoff reads and writes. Defaults to `node:fs`. */
  readonly fileSystem?: StateFileSystem | undefined;
  /**
   * The corpus walk and the `.context/` probe. Defaults to
   * `nodeBaselineFileSystem(repoRoot)`.
   *
   * One seam for both, because both questions are "what is in this directory" and
   * the answer must come from the same tree. Notably it is *not* the Kane
   * boundary: R18.2 allows one spawn and check 1 has it.
   */
  readonly tree?: BaselineFileSystem | undefined;
  /** The reachability GET. Defaults to {@link nodeUrlProbe}. */
  readonly probeUrl?: DoctorUrlProbe | undefined;
  /** The §20.3 guard. Defaults to `config.ts`'s own `fenceFindings`. */
  readonly fences?: DoctorFenceReader | undefined;
  readonly diagnostics?: CollectingDiagnosticSink | undefined;
  /** ISO 8601 instant written into the handoff. Defaults to now. */
  readonly at?: string | undefined;
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

/**
 * Diagnose the environment.
 *
 * Never throws for any state of the world: no config, no snapshot, no corpus
 * directory, no `.context/`, no `kane-cli` on PATH, a base URL nothing is
 * listening on, a snapshot truncated mid-key, a reachability probe that rejects, a
 * spawn that rejects, and a filesystem whose every read throws. Every one of those
 * is a check with a status and a remedy, the handoff is written in all of them, and
 * {@link DoctorResult.exitCode} is `0`.
 *
 * The one thing that is *not* caught is a filesystem that refuses the handoff
 * write. That is the same line `writeHandoff` draws for every other command, and it
 * is drawn in the right place: a `doctor` that swallowed it would report a
 * diagnosis to a file nobody can read, which is the silent nothing R18.10 exists to
 * prevent.
 *
 * Exactly one process may start, and only from check 1.
 */
export async function runDoctor(request: DoctorRequest): Promise<DoctorResult> {
  const sink = request.diagnostics ?? createDiagnosticSink();
  const at = request.at ?? new Date().toISOString();
  const runId = `${SYNTHETIC_RUN_ID_PREFIX}${at}`;
  const fileSystem = request.fileSystem ?? nodeStateFileSystem();
  const tree = request.tree ?? nodeBaselineFileSystem(request.repoRoot);
  const probeUrl = request.probeUrl ?? nodeUrlProbe;
  const fences = request.fences ?? fenceFindings;

  sink.report({
    code: DOCTOR_DIAGNOSTIC_CODES.started,
    severity: 'info',
    message:
      `kept doctor: ${DOCTOR_CHECK_IDS.length} checks over ${request.repoRoot}, Kane budget ` +
      `${doctorTimeoutMs(request.config)} ms, subject budget ${SUBJECT_PROBE_TIMEOUT_MS} ms`,
  });

  // ── 1. Kane binary. The only spawn in this command (R18.1, R18.2). ────────
  const kane = await probeKane(request);

  // ── 2 through 7. No process, no credit, no network except check 5's GET. ──
  const config = readConfigCheck(request, fileSystem);
  const corpus = readCorpus(request, tree);
  const snapshot = readSnapshot(request, fileSystem);
  const subject = await probeSubject(request, probeUrl);
  const contextStore = readContextStore(tree);
  const fenceReport = readFences(request, fences);

  const checks: readonly DoctorCheck[] = Object.freeze([
    kaneCheckOf(kane),
    configCheckOf(config),
    corpusCheckOf(corpus, config),
    snapshotCheckOf(snapshot),
    subjectCheckOf(subject),
    contextStoreCheckOf(contextStore),
    fenceCheckOf(fenceReport),
  ]);

  for (const check of checks) {
    sink.report({
      code: DOCTOR_DIAGNOSTIC_CODES.check,
      severity: check.status === 'pass' ? 'info' : 'warn',
      message:
        `${check.number}/${DOCTOR_CHECK_IDS.length} ${check.title}: ${check.status}. ` +
        `${check.detail}${check.remedy === null ? '' : `. Remedy: ${check.remedy}`}`,
    });
  }

  const failing = checks.filter((check) => check.status === 'fail').length;
  const unconfigured = checks.filter((check) => check.status === 'not-configured').length;
  sink.report({
    code: DOCTOR_DIAGNOSTIC_CODES.completed,
    severity: 'info',
    message:
      `kept doctor: ${checks.length - failing - unconfigured} passing, ${failing} failing, ` +
      `${unconfigured} not configured, ${kane.invoked ? 1 : 0} Kane invocation. Exit code 0 in ` +
      `every case (R18.8)`,
  });

  // The one file this command writes (R18.10). No `run` and no `results`: a
  // family-less probe has no terminal event, so there is no outcome to gate a
  // verdict write on and none can move from here.
  const handoff = writeHandoff({
    repoRoot: request.repoRoot,
    // The surfaces are reported by check 7 and handed to the handoff from the same
    // config read, so the fence a reader is shown and the fence an agent is given
    // are one resolution rather than two (§20.1, R15.7).
    fences: handoffFenceSurfaces(request.config),
    runId,
    at,
    trigger: { hook: null, event: 'kept doctor', paths: [] },
    command: { family: null, argv: kane.argv, invoked: kane.invoked },
    exitCode: kane.exitCode,
    durationMs: kane.durationMs,
    diagnostics: sink.entries,
    fileSystem,
  });

  return {
    checks,
    exitCode: 0,
    spawns: kane.invoked ? 1 : 0,
    kane,
    config,
    corpus,
    snapshot,
    subject,
    contextStore,
    fences: fenceReport,
    handoff,
    runId,
    diagnostics: sink.entries,
  };
}

// ---------------------------------------------------------------------------
// Check 1: Kane binary (§21.2 row 1, R18.1, R18.2)
// ---------------------------------------------------------------------------

/** A never-invoked report, so the no-invoker arm is one value rather than seven fields. */
function unspawnedKane(timeoutMs: number): DoctorKaneReport {
  return {
    present: false,
    resolvedBinary: null,
    version: null,
    exitCode: null,
    exitMeaning: null,
    timedOut: false,
    durationMs: null,
    argv: Object.freeze([]),
    invoked: false,
    timeoutMs,
  };
}

/**
 * The one spawn (R18.2).
 *
 * `invokePlain`, because `--version` belongs to no family: it carries no terminal
 * event, no NDJSON enabler and no family-specific exit 3, so nothing is appended
 * to its argv. That is the same door `context list` goes through, and it is the
 * only door {@link DoctorInvoker} opens.
 *
 * Total. A thrown spawn, an absent binary, a timeout and a non-zero exit are all
 * reports rather than exceptions. The invoker already resolves for every one of
 * them, and the `catch` covers the argv assertion `plainArgv` would make if
 * {@link DOCTOR_VERSION_ARGV} were ever changed into something that classifies.
 */
async function probeKane(request: DoctorRequest): Promise<DoctorKaneReport> {
  const timeoutMs = doctorTimeoutMs(request.config);
  const invoker = request.invoker;
  if (invoker === undefined) return unspawnedKane(timeoutMs);

  try {
    const invocation = await invoker.invokePlain({
      argv: DOCTOR_VERSION_ARGV,
      cwd: request.repoRoot,
      timeoutMs,
    });
    return {
      present: invocation.resolvedBinary !== null && invocation.exitMeaning !== 'kane-not-found',
      resolvedBinary: invocation.resolvedBinary,
      version: readVersion(invocation.stdoutLines),
      exitCode: invocation.exitCode,
      exitMeaning: invocation.exitMeaning,
      timedOut: invocation.timedOut,
      durationMs: invocation.durationMs,
      argv: invocation.effectiveArgv,
      invoked: true,
      timeoutMs,
    };
  } catch {
    // A programming error on our side, reported as a check rather than as a
    // crash: `doctor` is the command a stranger runs to find out what is wrong,
    // and a stack trace is the least legible answer it could give.
    return unspawnedKane(timeoutMs);
  }
}

/**
 * The version Kane reported, verbatim.
 *
 * The first non-empty line that carries a digit, rather than the first line at
 * all. R3.23's prefix-skip rule earns its keep here for the same reason it does in
 * `context/listing.ts`: an `Update available: 0.8.4 → 0.8.5` advisory has been
 * observed on stdout ahead of the real output, and reporting that as the installed
 * version would be a plausible-looking lie.
 */
export function readVersion(lines: readonly string[]): string | null {
  for (const line of lines) {
    const text = line.trim();
    if (text.length === 0) continue;
    if (/\d/.test(text) && !/^update available/i.test(text)) return text;
  }
  return null;
}

function kaneCheckOf(report: DoctorKaneReport): DoctorCheck {
  if (!report.invoked) {
    return doctorCheck(
      'kane-binary',
      'not-configured',
      `this run was given no Kane process boundary, so \`${KANE_BINARY_NAME} ` +
        `${DOCTOR_VERSION_ARGV.join(' ')}\` was not issued and no process started`,
      KANE_INSTALL_REMEDY,
    );
  }
  if (report.exitMeaning === 'kane-not-found' || report.resolvedBinary === null) {
    // `not-configured` rather than `fail`, by the rule stated in the header: an
    // absent binary is a machine that has not been set up, not a Kane that broke.
    // R2.12 makes the absence a supported state of the world, and R18.1 is still
    // answered, since the presence *is* reported and the answer is "no".
    return doctorCheck(
      'kane-binary',
      'not-configured',
      `\`${KANE_BINARY_NAME}\` was not found on PATH, so nothing could report a version`,
      KANE_INSTALL_REMEDY,
    );
  }
  if (report.timedOut) {
    return doctorCheck(
      'kane-binary',
      'fail',
      `${report.resolvedBinary} did not answer \`${DOCTOR_VERSION_ARGV.join(' ')}\` within ` +
        `${report.timeoutMs} ms`,
      `Run \`${report.resolvedBinary} ${DOCTOR_VERSION_ARGV.join(' ')}\` by hand, and raise ` +
        `timeouts.doctorMs in ${CONFIG_FILE_RELATIVE_PATH} if the binary is simply slow to start`,
    );
  }
  if (report.version === null) {
    return doctorCheck(
      'kane-binary',
      'fail',
      `${report.resolvedBinary} answered \`${DOCTOR_VERSION_ARGV.join(' ')}\` with exit ` +
        `${String(report.exitCode)} and reported no version`,
      `Run \`${report.resolvedBinary} ${DOCTOR_VERSION_ARGV.join(' ')}\` by hand; ${KANE_INSTALL_REMEDY}`,
    );
  }
  return doctorCheck(
    'kane-binary',
    'pass',
    `${report.resolvedBinary} reports ${report.version}`,
    null,
  );
}

// ---------------------------------------------------------------------------
// Check 2: Configuration (§21.2 row 2, R18.3)
// ---------------------------------------------------------------------------

/**
 * Read the config for the *parse* verdict, and report the router from the config
 * the caller handed in.
 *
 * Two sources on purpose. Whether the file parses is a fact about the file, so it
 * is read here. Which router is *selected* is a fact about this invocation, and
 * `--router` overrides it for one invocation (§13.1), and reporting the file's value
 * would tell a reader the run used a router it did not use.
 *
 * The loader's diagnostics are carried rather than re-reported into the run sink:
 * `main.ts` already loads the config once and reports them, and a handoff that
 * lists `config-absent` twice reads like two problems.
 */
function readConfigCheck(request: DoctorRequest, fileSystem: StateFileSystem): DoctorConfigReport {
  const path = joinPath(request.repoRoot, CONFIG_FILE_RELATIVE_PATH);
  let present: boolean;
  try {
    present = fileSystem.readFile(path) !== null;
  } catch {
    present = false;
  }
  let loaded = false;
  let diagnostics: readonly Diagnostic[] = Object.freeze([]);
  try {
    const result = loadConfig({ repoRoot: request.repoRoot, fileSystem });
    loaded = result.loaded;
    diagnostics = result.diagnostics;
  } catch {
    loaded = false;
  }
  return {
    loaded,
    present,
    verdictRouter: request.config.verdictRouter,
    diagnostics,
    path: CONFIG_FILE_RELATIVE_PATH,
  };
}

function configCheckOf(report: DoctorConfigReport): DoctorCheck {
  if (!report.present) {
    return doctorCheck(
      'configuration',
      'not-configured',
      `${report.path} is absent, so the built-in defaults are in force and the ` +
        `'${report.verdictRouter}' router is selected`,
      'Run `kept init` to write a configuration, then `kept doctor` again',
    );
  }
  if (!report.loaded) {
    // The offending field path is the loader's to name, and it already has (§13.1
    // reports one diagnostic per unusable field). Quoting them is what makes the
    // remedy specific rather than a restatement of "the config is wrong".
    const offending = report.diagnostics
      .filter((entry) => entry.severity !== 'info')
      .map((entry) => entry.message);
    return doctorCheck(
      'configuration',
      'fail',
      `${report.path} was read but at least one field could not be used, so a default stands ` +
        `for it; the '${report.verdictRouter}' router is selected`,
      offending.length > 0
        ? `Correct ${report.path}: ${offending.join('; ')}`
        : `Correct ${report.path}, or delete it and run \`kept init\``,
    );
  }
  return doctorCheck(
    'configuration',
    'pass',
    `${report.path} parses and selects the '${report.verdictRouter}' router`,
    null,
  );
}

// ---------------------------------------------------------------------------
// Check 3: Corpus (§21.2 row 3, R18.7)
// ---------------------------------------------------------------------------

/** Trim a configured directory to the repository-relative POSIX form the walk uses. */
function normaliseDir(value: string): string {
  const posix = value.replace(/\\/g, '/').trim();
  const trimmed = posix.replace(/^\.\//, '').replace(/\/+$/, '');
  return trimmed === '.' ? '' : trimmed;
}

/**
 * Count `*_test.md` files under the corpus root and the `@verifies` tags they
 * carry (R18.7).
 *
 * `extractVerifiesTags` rather than a regex written here, because the tag grammar
 * has exactly one home (§5.2) and a second reader of it would eventually disagree
 * with the provider about what a tag is, which would make `doctor` report a tag
 * count the graph does not have.
 *
 * A directory that cannot be listed is reported as unreadable rather than as
 * empty. Those are different facts and only one of them is fixed by `kept init`.
 */
function readCorpus(request: DoctorRequest, tree: BaselineFileSystem): DoctorCorpusReport {
  const configured = corpusRoot(request.config);
  if (configured === null) {
    return { root: null, readable: false, files: Object.freeze([]), verifiesTags: 0 };
  }

  const root = normaliseDir(configured);
  const files: string[] = [];
  const queue: string[] = [root];
  const visited = new Set<string>();
  let readable = true;

  while (queue.length > 0) {
    const dir = queue.shift() as string;
    if (visited.has(dir)) continue;
    visited.add(dir);
    let entries;
    try {
      entries = tree.readDirectory(dir);
    } catch {
      // Only the root's failure is a statement about configuration. A subdirectory
      // that vanished mid-walk is adversity, and reporting the whole root
      // unreadable for it would send the reader after the wrong thing.
      if (dir === root) readable = false;
      continue;
    }
    for (const entry of entries) {
      const child = dir === '' ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        if (!isSkippedDirectoryName(entry.name)) queue.push(child);
        continue;
      }
      if (entry.isFile && isTestDocumentName(entry.name)) files.push(child);
    }
  }

  files.sort();
  let verifiesTags = 0;
  for (const file of files) {
    let text: string | null;
    try {
      text = tree.readFile(file);
    } catch {
      text = null;
    }
    if (text === null) continue;
    verifiesTags += extractVerifiesTags(text.split(/\r?\n/)).tags.length;
  }

  return { root, readable, files: Object.freeze(files), verifiesTags };
}

/** The tag grammar, quoted in the remedy so the reader does not have to find it. */
const TAG_GRAMMAR_REMEDY =
  'A designed test cites a claim with `<!-- @verifies <path>:<line> -->`, which is a repository-relative ' +
  'path, a colon, and the one-based line the claim is stated on. `kept init` scaffolds one ' +
  'example_test.md carrying a tag that must be repointed before it means anything';

function corpusCheckOf(report: DoctorCorpusReport, config: DoctorConfigReport): DoctorCheck {
  if (report.root === null) {
    return doctorCheck(
      'corpus',
      'not-configured',
      `no corpus root is configured, so no directory was scanned for \`*_test.md\` documents`,
      `Run \`kept init\`, or set corpus.root in ${CONFIG_FILE_RELATIVE_PATH} to the directory ` +
        `your designed tests live in`,
    );
  }
  if (!config.present) {
    // The root in play came from §20.4's default, not from the repository. Whether
    // that directory happens to exist is beside the point: nothing has chosen it,
    // so the remedy is to choose one rather than to go and create this one.
    return doctorCheck(
      'corpus',
      'not-configured',
      `no corpus root is configured, so §20.4's default '${report.root}' was scanned and holds ` +
        `${report.files.length} \`*_test.md\` document${report.files.length === 1 ? '' : 's'}`,
      `Run \`kept init\`, which writes corpus.root into ${CONFIG_FILE_RELATIVE_PATH} and ` +
        `scaffolds one example_test.md under it`,
    );
  }
  if (!report.readable) {
    return doctorCheck(
      'corpus',
      'fail',
      `the configured corpus root '${report.root}' could not be listed`,
      `Create '${report.root}', or point corpus.root in ${CONFIG_FILE_RELATIVE_PATH} at a ` +
        `directory that exists. \`kept init\` does both`,
    );
  }
  if (report.files.length === 0) {
    return doctorCheck(
      'corpus',
      'fail',
      `'${report.root}' holds no \`*_test.md\` documents, so there are no designed tests`,
      `Run \`kept init\` to scaffold one. ${TAG_GRAMMAR_REMEDY}`,
    );
  }
  if (report.verifiesTags === 0) {
    return doctorCheck(
      'corpus',
      'fail',
      `'${report.root}' holds ${report.files.length} \`*_test.md\` ` +
        `document${report.files.length === 1 ? '' : 's'} carrying no well-formed \`@verifies\` ` +
        `tag, so none of them designs a promise`,
      TAG_GRAMMAR_REMEDY,
    );
  }
  return doctorCheck(
    'corpus',
    'pass',
    `'${report.root}' holds ${report.files.length} \`*_test.md\` ` +
      `document${report.files.length === 1 ? '' : 's'} carrying ${report.verifiesTags} ` +
      `\`@verifies\` tag${report.verifiesTags === 1 ? '' : 's'}`,
    null,
  );
}

// ---------------------------------------------------------------------------
// Check 4: Snapshot (§21.2 row 4, R18.4)
// ---------------------------------------------------------------------------

/**
 * Present, and accepted by the snapshot parser.
 *
 * `parseSnapshot` rather than a structural guard, because it is the same function
 * the Ledger build uses (§9.2) and it is deliberately the one place in the model
 * where throwing is right, because a malformed snapshot is a broken build artefact, not a
 * state of the world. So `doctor` catches the throw and reports the message it
 * names, which is the field path the reader needs.
 */
function readSnapshot(request: DoctorRequest, fileSystem: StateFileSystem): DoctorSnapshotReport {
  const path = joinPath(request.repoRoot, SNAPSHOT_FILE_RELATIVE_PATH);
  let text: string | null;
  try {
    text = fileSystem.readFile(path);
  } catch {
    text = null;
  }
  if (text === null) {
    return {
      path: SNAPSHOT_FILE_RELATIVE_PATH,
      present: false,
      valid: false,
      error: null,
    };
  }
  try {
    parseSnapshot(text);
    return { path: SNAPSHOT_FILE_RELATIVE_PATH, present: true, valid: true, error: null };
  } catch (error) {
    return {
      path: SNAPSHOT_FILE_RELATIVE_PATH,
      present: true,
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function snapshotCheckOf(report: DoctorSnapshotReport): DoctorCheck {
  if (!report.present) {
    // Nothing has been built yet, which is not the same fact as a build that
    // produced something the schema refuses.
    return doctorCheck(
      'snapshot',
      'not-configured',
      `${report.path} is absent, so nothing has been built yet and there is no ledger to render`,
      'Run `kept build && kept snapshot`',
    );
  }
  if (!report.valid) {
    return doctorCheck(
      'snapshot',
      'fail',
      `${report.path} is present but the snapshot parser refused it: ` +
        `${report.error ?? 'no reason given'}`,
      'Run `kept build && kept snapshot` to rebuild it from the state file',
    );
  }
  return doctorCheck('snapshot', 'pass', `${report.path} is present and satisfies its schema`, null);
}

// ---------------------------------------------------------------------------
// Check 5: Subject reachable (§21.2 row 5, R18.5)
// ---------------------------------------------------------------------------

/**
 * One GET, on a two-second budget, and **only** when a base URL is configured.
 *
 * The null arm probes nothing at all, and that is §20.4's whole point: guessing a
 * port would have `kept doctor` open a connection to something on a stranger's
 * machine that has nothing to do with their repository.
 */
async function probeSubject(
  request: DoctorRequest,
  probeUrl: DoctorUrlProbe,
): Promise<DoctorSubjectReport> {
  const baseUrl = subjectBaseUrl(request.config);
  if (baseUrl === null) {
    return {
      baseUrl: null,
      probed: false,
      reachable: false,
      status: null,
      error: null,
      durationMs: null,
      timeoutMs: SUBJECT_PROBE_TIMEOUT_MS,
    };
  }
  let outcome: DoctorProbeOutcome;
  try {
    outcome = await probeUrl(baseUrl, SUBJECT_PROBE_TIMEOUT_MS);
  } catch (error) {
    outcome = {
      reachable: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
      durationMs: 0,
    };
  }
  return {
    baseUrl,
    probed: true,
    reachable: outcome.reachable,
    status: outcome.status,
    error: outcome.error,
    durationMs: outcome.durationMs,
    timeoutMs: SUBJECT_PROBE_TIMEOUT_MS,
  };
}

function subjectCheckOf(report: DoctorSubjectReport): DoctorCheck {
  if (report.baseUrl === null) {
    return doctorCheck(
      'subject-reachable',
      'not-configured',
      'no subject.baseUrl is configured, so nothing was probed',
      `Set subject.baseUrl in ${CONFIG_FILE_RELATIVE_PATH} to the URL your application serves ` +
        `on, or leave it null if this repository has no running subject`,
    );
  }
  if (!report.reachable) {
    return doctorCheck(
      'subject-reachable',
      'fail',
      `nothing answered a GET to ${report.baseUrl} within ${report.timeoutMs} ms` +
        `${report.error === null ? '' : ` (${report.error})`}`,
      `Start the application serving ${report.baseUrl}, or correct subject.baseUrl in ` +
        `${CONFIG_FILE_RELATIVE_PATH}`,
    );
  }
  return doctorCheck(
    'subject-reachable',
    'pass',
    `${report.baseUrl} answered with HTTP ${String(report.status ?? 'no status')}`,
    null,
  );
}

// ---------------------------------------------------------------------------
// Check 6: Context store (§21.2 row 6, R18.6, R18.2)
// ---------------------------------------------------------------------------

/**
 * Whether `.context/` is there, read from the filesystem.
 *
 * The filesystem and **not** Kane, which is the second half of R18.2. Asking
 * `context list` would be the obvious implementation and it would cost the second
 * spawn this command is not allowed. It would also answer the wrong question,
 * since a listing that fails for want of a store and a listing that fails because
 * the binary is missing are indistinguishable from the exit code alone.
 * {@link DoctorInvoker} makes the wrong implementation unreachable; this function
 * is the right one.
 */
function readContextStore(tree: BaselineFileSystem): DoctorContextStoreReport {
  try {
    tree.readDirectory(CONTEXT_STORE_RELATIVE_PATH);
    return { path: CONTEXT_STORE_RELATIVE_PATH, present: true };
  } catch {
    return { path: CONTEXT_STORE_RELATIVE_PATH, present: false };
  }
}

function contextStoreCheckOf(report: DoctorContextStoreReport): DoctorCheck {
  if (!report.present) {
    // A store nobody has created yet, so `not-configured`. It is a real
    // consequence rather than a shrug: every Assurance command refuses for want of
    // one, which is the honest state of a fresh clone, and the remedy is the two
    // commands that create it.
    return doctorCheck(
      'context-store',
      'not-configured',
      `${report.path}/ is absent, so every Assurance command will refuse for want of a store`,
      CONTEXT_INGEST_REMEDY,
    );
  }
  return doctorCheck('context-store', 'pass', `${report.path}/ is present`, null);
}

// ---------------------------------------------------------------------------
// Check 7: Fences (§21.2 row 7, §20.3)
// ---------------------------------------------------------------------------

/**
 * The §20.3 intersection check, **reported even when it passes**.
 *
 * That is the one row of the table with an explicit instruction to report a pass,
 * and it is the right instruction: a fence that is only mentioned when it is
 * broken is a fence nobody knows is being checked, and §7.1's invariant is the one
 * whose silent failure would make the whole product worthless.
 */
function readFences(request: DoctorRequest, fences: DoctorFenceReader): DoctorFenceReport {
  const declaredGlobs = declaredAllowGlobs(request.config);
  try {
    return {
      available: true,
      declaredGlobs,
      findings: Object.freeze([...fences(request.config)]),
    };
  } catch {
    // The guard is a pure function of the config, so a throw is a bug in it rather
    // than a state of the world. Reporting no findings would claim the fences are
    // clean, which is the one thing a fence check must never say without having
    // looked. §20.3 names a fence with a hole in it as the failure that would make
    // the project worthless. So it is reported as "nobody looked".
    return { available: false, declaredGlobs, findings: Object.freeze([]) };
  }
}

function fenceCheckOf(report: DoctorFenceReport): DoctorCheck {
  if (!report.available) {
    return doctorCheck(
      'fences',
      'not-configured',
      'the fence intersection guard could not be evaluated, so no allow set was checked against ' +
        'the corpus root or the documentation globs',
      `Check fences.<branch>.allow in ${CONFIG_FILE_RELATIVE_PATH}; until the guard answers, no ` +
        `allow set should be treated as verified`,
    );
  }
  if (report.declaredGlobs === 0 && report.findings.length === 0) {
    // §20.4's default: no autonomy granted, so there is no fence to intersect
    // anything. Reporting that as a pass would let "we checked nothing and found
    // nothing" read as "your fences are safe".
    return doctorCheck(
      'fences',
      'not-configured',
      `no branch declares an allow glob, so no repair may write anything and there is no fence ` +
        `to intersect the claims`,
      `Run \`kept init\`, then grant a \`code-break\` repair the source globs it may edit under ` +
        `fences.code-break.allow in ${CONFIG_FILE_RELATIVE_PATH}. Every default here is empty on ` +
        `purpose: no autonomy until it is granted`,
    );
  }
  if (report.findings.length > 0) {
    const named = report.findings
      .map(
        (finding) =>
          `${finding.branch} allows '${finding.allowGlob}', which reaches ` +
          `'${finding.collidesWith}'`,
      )
      .join('; ');
    return doctorCheck(
      'fences',
      'fail',
      `${report.findings.length} allow glob${report.findings.length === 1 ? '' : 's'} ` +
        `intersect${report.findings.length === 1 ? 's' : ''} the claims they are meant to be ` +
        `fenced away from: ${named}`,
      `Narrow the intersecting glob in ${CONFIG_FILE_RELATIVE_PATH}. A code-break repair may ` +
        `never edit the document that states the claim or the test that checks it, so an allow ` +
        `set that reaches either is refused rather than filtered`,
    );
  }
  return doctorCheck(
    'fences',
    'pass',
    `${report.declaredGlobs} allow glob${report.declaredGlobs === 1 ? '' : 's'} declared, and ` +
      `none reaches the corpus root or any documentation glob`,
    null,
  );
}
