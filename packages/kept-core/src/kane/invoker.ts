/**
 * `KaneInvoker` — the one process boundary between KEPT and Kane (design §4.7,
 * R2.12, R3.4, R3.5, R11.8).
 *
 * Everything family-dependent about *starting* a Kane process lives here, and it
 * is read from `contractFor(family)` rather than re-derived: how NDJSON is turned
 * on, and what the process's exit code meant. Everything family-dependent about
 * *reading* the resulting stream lives in `kane/ndjson.ts`.
 *
 * ## Three things this module gets right on purpose
 *
 * **1. The NDJSON enabler is per family, and one of the three is not a flag.**
 *
 * | family             | enabler        | appended argv    |
 * |--------------------|----------------|------------------|
 * | `ExecutionRun`     | `agent-flag`   | `--agent`        |
 * | `ExecutionTestrun` | `piped-stdout` | *nothing*        |
 * | `Assurance`        | `mode-agent`   | `--mode agent`   |
 *
 * `testrun run` has **no `--agent` flag at all** — passing one is an error, and
 * it emits NDJSON whenever stdout is a pipe (R3.5). So for that family the
 * invoker appends nothing and asserts `--agent` is absent from the argv it was
 * handed. Getting this backwards is not a soft failure: the flag is rejected and
 * blast-radius verification never runs.
 *
 * **2. `stdio: ['ignore','pipe','pipe']`, always.**
 *
 * stdin is ignored on every invocation, which is what makes Kane's interactive
 * `ask_user` step self-disable — it is auto-disabled when stdin is not a TTY, so
 * it can never appear in our streams and can never block a hook.
 *
 * The documented consequence, recorded here so it is not rediscovered mid-build
 * (design §4.9.1): `context ingest <src…>` is a one-flow entry point that lands
 * sources *and continues into extraction* — but only on the TTY path. With stdin
 * ignored, **any `context ingest` KEPT performs itself lands the source only and
 * never extracts.** That is why the bootstrap of design §4.9.1 is two explicit
 * commands (`context ingest … --mode ci`, then `context extract`) rather than one,
 * and why a headless ingest that looks like it "did nothing" has in fact
 * succeeded. Nothing in this file should ever be changed to attach a TTY to make
 * ingest extract; the second command is the fix.
 *
 * stderr is piped and its last {@link STDERR_TAIL_LINES} lines are retained
 * because the evidence-pack hint (`kane-cli evidence serve <path>`) is printed on
 * **stderr only** and appears in no terminal event (design §4.6), and because
 * `[member]` debug lines arrive there too.
 *
 * **3. It never throws for anything Kane does.**
 *
 * Binary absence, an auth failure, a refusal, a crash, a timeout — all of it is
 * returned as data and reported as a diagnostic (design §14.2). The only throws
 * are programming errors detectable at development time, and there are exactly
 * two of them: an argv that does not belong to the declared family, and `--agent`
 * on an `ExecutionTestrun` argv. Both are mistakes in *our* call sites, neither
 * can be caused by the state of the world, and both would otherwise fail silently
 * — a wrong family parses a stream against the wrong terminal event and reports
 * nothing at all. Keeping every other failure as data is what keeps the KEPT
 * CLI's exit code a statement about KEPT rather than about the product.
 *
 * ## Seam with the parser
 *
 * `invoke()` returns the raw stdout lines, not a `ParsedStream`. The invoker is
 * deliberately independent of the event types: it knows how to *start* a family
 * and how to read its exit, and nothing about event shapes. `kane/ndjson.ts`
 * (task 2.9) composes the two by calling `parseStream(contractFor(spec.family),
 * result.stdoutLines)`, which keeps this file testable with a stub spawn and no
 * Kane process anywhere in the suite.
 */

import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants, statSync } from 'node:fs';
import { delimiter as pathDelimiter, join } from 'node:path';

import type { Diagnostic, DiagnosticSink } from '../diagnostics.js';
import { createDiagnosticSink } from '../diagnostics.js';
import { contractFor, familyForArgv, type CommandFamily, type NdjsonEnabler } from './family.js';
import { exitMeaning, type ExitMeaning } from './exit.js';

/** The binary KEPT invokes. Never invoked to probe it — resolution is filesystem-only. */
export const KANE_BINARY_NAME = 'kane-cli';

/** Environment override for the binary path, used by CI and by `kept doctor`. */
export const KANE_BINARY_ENV_VAR = 'KEPT_KANE_BIN';

/** The flag that enables NDJSON for `ExecutionRun`, and is an error elsewhere. */
export const AGENT_FLAG = '--agent';

/** How many trailing stderr lines are retained. Enough for the evidence hint. */
export const STDERR_TAIL_LINES = 50;

/** Grace between SIGTERM and SIGKILL on a timeout (design §4.7 step 6). */
export const KILL_GRACE_MS = 2_000;

/**
 * The argv each enabler appends, written exactly once. The `piped-stdout` entry
 * being empty is the whole point: it is not a flag, it is a property of the
 * stdio configuration, which this module fixes unconditionally.
 */
export const NDJSON_ENABLER_ARGV: { readonly [E in NdjsonEnabler]: readonly string[] } =
  Object.freeze({
    'agent-flag': Object.freeze([AGENT_FLAG]),
    'piped-stdout': Object.freeze([]),
    'mode-agent': Object.freeze(['--mode', 'agent']),
  });

/** What a call site asks for. `argv` excludes the enabler — the invoker adds it. */
export interface InvocationSpec<F extends CommandFamily> {
  /** The declared family. Not inferred from argv; asserted against it. */
  readonly family: F;
  /** argv WITHOUT the NDJSON enabler, and without the binary name. */
  readonly argv: readonly string[];
  readonly cwd: string;
  /** Overrides layered over `process.env`; PATH survives unless overridden. */
  readonly env?: Readonly<Record<string, string>> | undefined;
  /**
   * Budget in milliseconds. Only a finite value greater than zero arms the
   * timer; anything else runs unbounded. Callers read these from
   * `.kept/config.json` (`timeouts.hookMs` 300 000, `timeouts.enrichmentMs`
   * 60 000) — no budget is hardcoded here.
   */
  readonly timeoutMs: number;
  /**
   * Live tail, one call per complete stdout line, in order. Typed as a plain
   * string callback so the invoker stays independent of the event types; the dev
   * NDJSON pane and the parser both consume it. A throwing callback is caught and
   * diagnosed, never propagated.
   */
  readonly onLine?: ((line: string) => void) | undefined;
}

/** Everything one invocation produced. No field is a promise of success. */
export interface InvocationResult<F extends CommandFamily> {
  /** The spec as given, so a result is self-describing on the `/runs` page. */
  readonly spec: InvocationSpec<F>;
  /** argv actually passed, enabler included. What task 12.13 asserts against. */
  readonly effectiveArgv: readonly string[];
  /** Complete stdout lines, in order, newline stripped. Fed to `parseStream`. */
  readonly stdoutLines: readonly string[];
  /** Process exit code, or null when signalled or never started. */
  readonly exitCode: number | null;
  /** The code interpreted against the family (design §4.5). */
  readonly exitMeaning: ExitMeaning;
  /** Whether *our* timer fired and we killed it. */
  readonly timedOut: boolean;
  readonly durationMs: number;
  /** Last {@link STDERR_TAIL_LINES} stderr lines — the evidence hint lives here. */
  readonly stderrTail: readonly string[];
  /** Absolute path spawned, or null when the binary was not found. */
  readonly resolvedBinary: string | null;
  /** Everything recorded. Also reported to the injected sink. */
  readonly diagnostics: readonly Diagnostic[];
}

/** Minimal shape of a piped stream. Node's `Readable` satisfies it. */
export interface ReadableLike {
  setEncoding(encoding: string): unknown;
  on(event: 'data', listener: (chunk: string) => void): unknown;
}

/** Minimal shape of a child process. Node's `ChildProcess` satisfies it. */
export interface ChildProcessLike {
  readonly stdout: ReadableLike | null;
  readonly stderr: ReadableLike | null;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: (code: number | null, signal: string | null) => void): unknown;
  kill(signal?: string): boolean;
}

/** The stdio triple is fixed, so it is part of the type a stub receives. */
export interface SpawnOptionsLike {
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
  readonly stdio: readonly ['ignore', 'pipe', 'pipe'];
}

/** The injection seam that keeps every test in this stage process-free. */
export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsLike,
) => ChildProcessLike;

/** Resolves the binary, or returns null when it is absent. Never invokes it. */
export type BinaryResolver = () => string | null;

/** Construction options. Every default is production; every override is a test seam. */
export interface KaneInvokerOptions {
  /** Defaults to `node:child_process.spawn` with the fixed stdio triple. */
  readonly spawn?: SpawnLike | undefined;
  /** Defaults to the memoised PATH lookup, so `PATH` is untouched in tests. */
  readonly resolveBinary?: BinaryResolver | undefined;
  /** Where diagnostics go. A fresh collecting sink when omitted. */
  readonly sink?: DiagnosticSink | undefined;
  /** Monotonic-enough clock for `durationMs`. Defaults to `Date.now`. */
  readonly now?: (() => number) | undefined;
  /** SIGTERM→SIGKILL grace. Defaults to {@link KILL_GRACE_MS}. */
  readonly killGraceMs?: number | undefined;
}

/** Is this path an executable file? Filesystem only — the binary is never run. */
function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Uncached PATH lookup for `kane-cli`. Exported because `kept doctor` needs the
 * live answer rather than the memo.
 *
 * Honours {@link KANE_BINARY_ENV_VAR} first so CI can pin a path, then walks
 * `PATH`. Windows extensions are tried because the launcher is cross-platform
 * even though the demo is not.
 */
export function findKaneBinary(
  options: {
    readonly env?: Readonly<Record<string, string | undefined>> | undefined;
    readonly isExecutable?: ((candidate: string) => boolean) | undefined;
  } = {},
): string | null {
  const env = options.env ?? process.env;
  const executable = options.isExecutable ?? isExecutableFile;

  const pinned = env[KANE_BINARY_ENV_VAR];
  if (typeof pinned === 'string' && pinned.trim().length > 0) {
    const path = pinned.trim();
    return executable(path) ? path : null;
  }

  const extensions =
    process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  const raw = env['PATH'] ?? env['Path'] ?? '';
  for (const entry of raw.split(pathDelimiter)) {
    const dir = entry.trim();
    if (dir.length === 0) continue;
    for (const extension of extensions) {
      const candidate = join(dir, `${KANE_BINARY_NAME}${extension}`);
      if (executable(candidate)) return candidate;
    }
  }
  return null;
}

/** The once-per-process memo. `undefined` means "not looked up yet". */
let binaryMemo: { readonly value: string | null } | undefined;

/**
 * The resolution every `KaneInvoker` uses by default: the PATH lookup, performed
 * **once per process** and cached thereafter (design §4.7 step 1). A missing
 * binary is a stable fact for the life of a process, and every hook-triggered
 * invocation would otherwise re-walk PATH.
 */
export function resolvedKaneBinary(): string | null {
  binaryMemo ??= Object.freeze({ value: findKaneBinary() });
  return binaryMemo.value;
}

/** Forget the memo. For tests and for `kept doctor --refresh`; never mid-run. */
export function clearKaneBinaryCache(): void {
  binaryMemo = undefined;
}

/**
 * Build the argv actually passed to Kane: the caller's argv plus the family's
 * NDJSON enabler, read from the contract.
 *
 * This is the per-command argv contract at the invoker seam, and it is exported
 * separately from `invoke()` so it can be asserted with no process anywhere
 * (task 2.21, extended per KEPT command in task 12.13).
 *
 * Throws `TypeError` in exactly two cases, both programming errors at
 * development time:
 *
 * - `familyForArgv(argv)` disagrees with `family`, including the `null` it
 *   returns for an argv it cannot classify. A wrong-but-plausible family would
 *   parse the stream against the wrong terminal event and report *nothing*,
 *   silently, which is the failure the three-contract model exists to prevent.
 * - `--agent` appears anywhere in an `ExecutionTestrun` argv. That flag does not
 *   exist on `testrun run`; Kane rejects it and nothing runs (R3.5).
 */
export function applyNdjsonEnabler<F extends CommandFamily>(
  family: F,
  argv: readonly string[],
): readonly string[] {
  const contract = contractFor(family);

  const detected = familyForArgv(argv);
  if (detected !== family) {
    throw new TypeError(
      `Kane argv does not belong to the declared family: declared ${family}, argv classifies as ${
        detected ?? 'no family'
      } (argv: ${argv.join(' ')})`,
    );
  }

  if (contract.ndjson === 'piped-stdout' && hasAgentFlag(argv)) {
    throw new TypeError(
      `${AGENT_FLAG} is not a flag of this command: ${family} enables NDJSON through piped stdout, ` +
        `and Kane rejects ${AGENT_FLAG} here (argv: ${argv.join(' ')})`,
    );
  }

  return Object.freeze([...argv, ...NDJSON_ENABLER_ARGV[contract.ndjson]]);
}

/** `--agent` anywhere, in bare or `--agent=…` form. Position is irrelevant. */
function hasAgentFlag(argv: readonly string[]): boolean {
  return argv.some(
    (token) => typeof token === 'string' && (token === AGENT_FLAG || token.startsWith(`${AGENT_FLAG}=`)),
  );
}

/**
 * Incremental line splitter. Chunk boundaries fall wherever the operating system
 * put them, so a boundary mid-line must not produce two lines, and a final line
 * with no trailing newline must still be delivered — Kane's last event is often
 * exactly that, and losing it would turn every complete stream into a crashed one.
 */
class LineSplitter {
  private buffer = '';

  push(chunk: string, emit: (line: string) => void): void {
    this.buffer += chunk;
    for (;;) {
      const index = this.buffer.indexOf('\n');
      if (index < 0) break;
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      emit(stripCarriageReturn(line));
    }
  }

  /** Deliver whatever is left. Called once, at close: the missing-newline case. */
  flush(emit: (line: string) => void): void {
    if (this.buffer.length === 0) return;
    const line = this.buffer;
    this.buffer = '';
    emit(stripCarriageReturn(line));
  }
}

function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** A bounded tail. Keeps the last `limit` lines and forgets the rest. */
class LineTail {
  private readonly lines: string[] = [];

  constructor(private readonly limit: number) {}

  push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > this.limit) this.lines.splice(0, this.lines.length - this.limit);
  }

  snapshot(): readonly string[] {
    return [...this.lines];
  }
}

function nodeSpawn(
  command: string,
  args: readonly string[],
  options: SpawnOptionsLike,
): ChildProcessLike {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    // Fixed, never configurable. stdin ignored so `ask_user` self-disables; see
    // the header note on what that means for `context ingest` (design §4.9.1).
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return child as unknown as ChildProcessLike;
}

/**
 * The process boundary. One instance per run is fine; the binary lookup is
 * shared process-wide through {@link resolvedKaneBinary}.
 */
export class KaneInvoker {
  private readonly spawnFn: SpawnLike;
  private readonly resolveBinary: BinaryResolver;
  private readonly sink: DiagnosticSink;
  private readonly now: () => number;
  private readonly killGraceMs: number;
  /** Per-instance memo, so an injected resolver is also called once. */
  private binary: { readonly value: string | null } | undefined;

  constructor(options: KaneInvokerOptions = {}) {
    this.spawnFn = options.spawn ?? nodeSpawn;
    this.resolveBinary = options.resolveBinary ?? resolvedKaneBinary;
    this.sink = options.sink ?? createDiagnosticSink();
    this.now = options.now ?? ((): number => Date.now());
    this.killGraceMs =
      typeof options.killGraceMs === 'number' && Number.isFinite(options.killGraceMs)
        ? Math.max(0, options.killGraceMs)
        : KILL_GRACE_MS;
  }

  /** The resolved binary for this process, looked up at most once. */
  binaryPath(): string | null {
    this.binary ??= Object.freeze({ value: this.resolveBinary() });
    return this.binary.value;
  }

  /**
   * Run one Kane command. Resolves for every outcome; rejects only for the two
   * development-time programming errors described on {@link applyNdjsonEnabler}.
   */
  async invoke<F extends CommandFamily>(spec: InvocationSpec<F>): Promise<InvocationResult<F>> {
    // Steps 2 and 3 first, and before anything observable happens: a mismatch is
    // our bug, and it should surface without a process, a diagnostic or a credit.
    const effectiveArgv = applyNdjsonEnabler(spec.family, spec.argv);

    const started = this.now();
    const diagnostics: Diagnostic[] = [];
    const record = (
      code: string,
      severity: 'info' | 'warn' | 'error',
      message: string,
    ): void => {
      diagnostics.push(this.sink.report({ code, severity, message, file: null, line: null }));
    };

    // Step 1. Absent binary is data, not an exception (R2.12).
    const resolvedBinary = this.binaryPath();
    if (resolvedBinary === null) {
      record(
        'kane-not-found',
        'warn',
        `${KANE_BINARY_NAME} was not found on PATH; ${spec.argv.join(' ')} was not invoked`,
      );
      return {
        spec,
        effectiveArgv,
        stdoutLines: [],
        exitCode: null,
        exitMeaning: 'kane-not-found',
        timedOut: false,
        durationMs: Math.max(0, this.now() - started),
        stderrTail: [],
        resolvedBinary: null,
        diagnostics,
      };
    }

    const stdoutLines: string[] = [];
    const stderrTail = new LineTail(STDERR_TAIL_LINES);
    const stdoutSplitter = new LineSplitter();
    const stderrSplitter = new LineSplitter();
    let onLineFailed = false;

    const emitStdout = (line: string): void => {
      stdoutLines.push(line);
      const onLine = spec.onLine;
      if (onLine === undefined) return;
      try {
        onLine(line);
      } catch (error) {
        // A broken live tail is a bug in the pane, not a reason to lose a run.
        if (!onLineFailed) {
          onLineFailed = true;
          record('invoker-on-line', 'warn', `onLine callback threw: ${describeError(error)}`);
        }
      }
    };

    const options: SpawnOptionsLike = {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    };

    let child: ChildProcessLike;
    try {
      child = this.spawnFn(resolvedBinary, effectiveArgv, options);
    } catch (error) {
      // spawn can throw synchronously on a bad cwd. Still not an exception of ours.
      record(
        'kane-spawn-failed',
        'warn',
        `${KANE_BINARY_NAME} could not be spawned: ${describeError(error)}`,
      );
      return {
        spec,
        effectiveArgv,
        stdoutLines: [],
        exitCode: null,
        exitMeaning: isNotFoundError(error) ? 'kane-not-found' : 'force-interrupted',
        timedOut: false,
        durationMs: Math.max(0, this.now() - started),
        stderrTail: [],
        resolvedBinary,
        diagnostics,
      };
    }

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdoutSplitter.push(String(chunk), emitStdout);
    });
    child.stderr?.on('data', (chunk: string) => {
      stderrSplitter.push(String(chunk), (line) => {
        stderrTail.push(line);
      });
    });

    const outcome = await new Promise<{
      readonly code: number | null;
      readonly killed: boolean;
      readonly notFound: boolean;
      readonly error: unknown;
    }>((resolve) => {
      let settled = false;
      let killed = false;
      let termTimer: ReturnType<typeof setTimeout> | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;

      const clearTimers = (): void => {
        if (termTimer !== undefined) clearTimeout(termTimer);
        if (killTimer !== undefined) clearTimeout(killTimer);
        termTimer = undefined;
        killTimer = undefined;
      };

      const settle = (result: {
        readonly code: number | null;
        readonly notFound: boolean;
        readonly error: unknown;
      }): void => {
        if (settled) return;
        settled = true;
        clearTimers();
        stdoutSplitter.flush(emitStdout);
        stderrSplitter.flush((line) => {
          stderrTail.push(line);
        });
        resolve({ ...result, killed });
      };

      // Step 6. Only a finite positive budget arms the timer.
      if (Number.isFinite(spec.timeoutMs) && spec.timeoutMs > 0) {
        termTimer = setTimeout(() => {
          killed = true;
          safeKill(child, 'SIGTERM');
          // Escalate rather than wait: a Kane process holding a Chrome child can
          // ignore SIGTERM, and a hook that never returns is worse than a killed one.
          killTimer = setTimeout(() => {
            safeKill(child, 'SIGKILL');
          }, this.killGraceMs);
        }, spec.timeoutMs);
      }

      child.on('error', (error: Error) => {
        // Node emits 'error' then 'close' for ENOENT; settling on the first of
        // the two keeps a stub that only emits 'error' from hanging the promise.
        settle({ code: null, notFound: isNotFoundError(error), error });
      });

      child.on('close', (code: number | null) => {
        settle({ code, notFound: false, error: undefined });
      });
    });

    if (outcome.killed) {
      record(
        'kane-timeout',
        'warn',
        `${KANE_BINARY_NAME} ${spec.argv.join(' ')} exceeded its ${spec.timeoutMs} ms budget and was terminated; prior verdicts are unchanged`,
      );
    } else if (outcome.notFound) {
      record(
        'kane-not-found',
        'warn',
        `${KANE_BINARY_NAME} could not be executed at ${resolvedBinary}: ${describeError(outcome.error)}`,
      );
    } else if (outcome.error !== undefined) {
      record(
        'kane-spawn-failed',
        'warn',
        `${KANE_BINARY_NAME} failed during execution: ${describeError(outcome.error)}`,
      );
    }

    // A `notFound` outcome reads as `kane-not-found` whatever the code, matching
    // the ENOENT row of design §4.5. Every other outcome goes through the family
    // interpretation, where `killed` already outranks the code.
    const meaning: ExitMeaning =
      outcome.notFound && !outcome.killed
        ? 'kane-not-found'
        : exitMeaning(spec.family, outcome.code, outcome.killed);

    return {
      spec,
      effectiveArgv,
      stdoutLines,
      exitCode: outcome.code,
      exitMeaning: meaning,
      timedOut: outcome.killed,
      durationMs: Math.max(0, this.now() - started),
      stderrTail: stderrTail.snapshot(),
      resolvedBinary,
      diagnostics,
    };
  }
}

/** Signalling a process that already exited throws; that is not our failure. */
function safeKill(child: ChildProcessLike, signal: 'SIGTERM' | 'SIGKILL'): void {
  try {
    child.kill(signal);
  } catch {
    // Already gone. Nothing to report — the close handler settles the promise.
  }
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { code?: unknown }).code === 'ENOENT';
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
