/**
 * The command dispatcher (design §13.1, §13.2.3, §14.2).
 *
 * {@link main} is the whole CLI as a function: argv in, exit code out, all I/O
 * through an injected {@link CliIo}. Nothing here reads `process` directly, which
 * is what lets the argv contract and the exit-code policy be asserted with no
 * child process and no temporary directory anywhere — `index.ts` is the only file
 * that touches the real process, and it is four lines long.
 *
 * The exit-code policy, in one place:
 *
 * - **{@link EXIT_USAGE} (2)** when and only when mutually exclusive flags were
 *   given. §13.2.3 names the pair — `--plan` with `--apply` — and §14.1's last row
 *   makes it the single non-zero exit in the product.
 * - **{@link EXIT_OK} (0)** for everything else. A degraded build, a missing
 *   `kane-cli`, a `cover` that refused for want of a `.context/` store, an unknown
 *   flag, a command that has not been implemented yet: all zero. Kane's outcomes
 *   are data (R2.10, R2.12), and a hook whose exit code flickers with the health
 *   of an external binary is a hook somebody disables.
 *
 * The commands §13.1 lists but this stage does not implement report that plainly
 * and exit 0. That is not a stub pretending to work — `--json` says
 * `"implemented": false` and the text output names the task that lands it — and it
 * is strictly better than an unrecognised-command error, because `kept verify` is
 * a real command whose behaviour is specified and simply not built yet.
 */

import { resolve } from 'node:path';

import type { CollectingDiagnosticSink, Diagnostic } from '@kept/core';
import { KaneInvoker, createDiagnosticSink } from '@kept/core';
import { nodeStateFileSystem, type StateFileSystem } from '@kept/core';

import type { ParsedArgv } from './args.js';
import { EXIT_OK, EXIT_USAGE, parseArgv, readList } from './args.js';
import type { KeptConfig } from './config.js';
import { applyOverrides, loadConfig, memberDebugEnv } from './config.js';
import { runBuild } from './commands/build.js';
import {
  reconcileUsageErrors,
  runReconcile,
  runReconcileApply,
} from './commands/reconcile.js';
import { runSnapshot } from './commands/snapshot.js';
import { runVerify } from './commands/verify.js';
import { KEPT_VERSION } from './version.js';

/** Everything {@link main} needs from the outside world. */
export interface CliIo {
  write(text: string): void;
  writeError(text: string): void;
  /** Working directory `--repo` is resolved against. */
  readonly cwd: string;
  /** Mutable environment, so `KANE_TESTRUN_MEMBER_DEBUG` can be set (R4.12). */
  readonly env: Record<string, string | undefined>;
  /** State and snapshot reads and writes. Defaults to `node:fs`. */
  readonly fileSystem?: StateFileSystem | undefined;
  /** Fixed instant, so a test can assert the snapshot's `generatedAt`. */
  readonly now?: (() => Date) | undefined;
  /**
   * The Kane process boundary. Defaults to a real {@link KaneInvoker}, which is
   * what makes `kept build` actually issue `cover --json --mode agent` (§13.1).
   * A test passes one with an injected `spawn`, or omits it deliberately to
   * exercise the R2.12 "no Kane at all" path.
   */
  readonly invoker?: KaneInvoker | undefined;
  /** False to run `kept build` with no Kane boundary at all (R2.12). */
  readonly kane?: boolean | undefined;
}

/** The commands this stage implements. The rest report honestly and exit 0. */
export const IMPLEMENTED_COMMANDS: readonly string[] = Object.freeze([
  'build',
  'snapshot',
  'verify',
  'reconcile',
]);

/** Which task lands each unimplemented command, so the message can say so. */
const PENDING_TASKS: Readonly<Record<string, string>> = Object.freeze({
  evolve: 'task 12.10',
  amend: 'task 14.5',
  handoff: 'task 12.11',
  doctor: 'task 16.2',
  watch: 'task 16.4',
});

/**
 * Run the CLI.
 *
 * Returns an exit code; never calls `process.exit`, never throws for a state of
 * the world. A thrown exception from here would be a programming error, and
 * `index.ts` reports it as one.
 */
export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  const parsed = parseArgv(argv);

  // ── The single usage error (§13.2.3). Nothing has run; nothing is written. ──
  if (parsed.usageErrors.length > 0) {
    io.writeError(
      [
        ...parsed.usageErrors.map((message) => `kept: ${message}`),
        '',
        USAGE,
        '',
      ].join('\n'),
    );
    return EXIT_USAGE;
  }

  if (parsed.help) {
    io.write(`${USAGE}\n`);
    return EXIT_OK;
  }

  const sink: CollectingDiagnosticSink = createDiagnosticSink(
    io.now === undefined ? {} : { clock: io.now },
  );
  for (const note of parsed.notes) {
    sink.report({ code: `argv-${note.code}`, severity: 'warn', message: note.message });
  }

  const repoRoot = resolve(io.cwd, parsed.options.repo);
  const fileSystem = io.fileSystem ?? nodeStateFileSystem();
  const loaded = loadConfig({ repoRoot, fileSystem, diagnostics: sink });
  const config = applyOverrides(
    loaded.config,
    { router: parsed.options.router, memberDebug: parsed.options.memberDebug },
    sink,
  );
  // R4.12: the variable is set for the invocation, and only ever set — Kane reads
  // its presence, so there is no `=0` spelling that turns member capture off.
  for (const [key, value] of Object.entries(memberDebugEnv(config))) io.env[key] = value;

  const at = (io.now?.() ?? new Date()).toISOString();

  switch (parsed.command) {
    case 'build':
      return await dispatchBuild(parsed, { repoRoot, config, fileSystem, sink, at, io });
    case 'snapshot':
      return dispatchSnapshot(parsed, { repoRoot, fileSystem, sink, at, io });
    case 'verify':
      return await dispatchVerify(parsed, { repoRoot, config, fileSystem, sink, at, io });
    case 'reconcile':
      return await dispatchReconcile(parsed, { repoRoot, config, fileSystem, sink, at, io });
    default:
      return reportPending(parsed, { repoRoot, config, sink, io });
  }
}

/** Shared dispatch context, so the command arms read as one shape. */
interface Dispatch {
  readonly repoRoot: string;
  readonly fileSystem: StateFileSystem;
  readonly sink: CollectingDiagnosticSink;
  readonly at: string;
  readonly io: CliIo;
}

async function dispatchBuild(
  parsed: ParsedArgv,
  context: Dispatch & { readonly config: KeptConfig },
): Promise<number> {
  // A real invoker unless the caller supplied one or opted out. Its absence is a
  // supported state of the world (R2.12) but never the default: §13.1 has
  // `kept build` issue `cover --json --mode agent`, and a build that quietly never
  // tried would report `kane-not-found` for a Kane that is installed and working.
  const invoker =
    context.io.invoker ??
    (context.io.kane === false ? undefined : new KaneInvoker({ sink: context.sink }));

  const result = await runBuild({
    repoRoot: context.repoRoot,
    config: context.config,
    fileSystem: context.fileSystem,
    diagnostics: context.sink,
    at: context.at,
    ...(invoker === undefined ? {} : { invoker }),
  });

  if (parsed.options.json) {
    context.io.write(
      `${JSON.stringify(
        {
          command: 'build',
          implemented: true,
          repoRoot: context.repoRoot,
          statePath: result.statePath,
          promises: result.state.graph.promises.length,
          edges: result.state.graph.edges.length,
          degraded: result.degraded,
          degradedReasons: result.degradedReasons,
          freshness: result.state.freshness,
          freshnessMoved: result.freshnessMoved,
          freshnessRefusals: result.freshnessRefusals,
          diagnostics: result.diagnostics,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    context.io.write(
      [
        `kept build`,
        `  repository   ${context.repoRoot}`,
        `  state        ${result.statePath}`,
        `  promises     ${result.state.graph.promises.length}`,
        `  edges        ${result.state.graph.edges.length}`,
        `  degraded     ${String(result.degraded)}${
          result.degradedReasons.length > 0 ? ` (${result.degradedReasons.join(', ')})` : ''
        }`,
        `  freshness    ${
          result.state.freshness.terminalEventAt ?? 'never verified'
        }${result.freshnessMoved ? ' (advanced by this run)' : ''}`,
        '',
      ].join('\n'),
    );
  }
  writeDiagnostics(context.io, result.diagnostics, parsed.options.json);
  // Degradation is a fact about the world, not a failure of KEPT (R2.10, R2.12).
  return EXIT_OK;
}

/**
 * `kept verify --changed <p…>` / `kept verify --all` (design §7.4, §13.1).
 *
 * The command the code hook fires, and the only one that can move a verdict to
 * `proven`. Its exit code is still zero for everything Kane can do — a crashed
 * stream, a preflight rejection, a missing binary — because a hook whose exit code
 * flickers with the health of an external binary is a hook somebody disables
 * (§14.2).
 */
async function dispatchVerify(
  parsed: ParsedArgv,
  context: Dispatch & { readonly config: KeptConfig },
): Promise<number> {
  const invoker =
    context.io.invoker ??
    (context.io.kane === false ? undefined : new KaneInvoker({ sink: context.sink }));

  const result = await runVerify({
    repoRoot: context.repoRoot,
    config: context.config,
    all: parsed.flags.has('all'),
    changed: readList(parsed.flags, 'changed'),
    fileSystem: context.fileSystem,
    diagnostics: context.sink,
    at: context.at,
    ...(invoker === undefined ? {} : { invoker }),
  });

  if (parsed.options.json) {
    context.io.write(
      `${JSON.stringify(
        {
          command: 'verify',
          implemented: true,
          repoRoot: context.repoRoot,
          scope: result.scope,
          argv: result.argv,
          invoked: result.invoked,
          runId: result.runId,
          exitCode: result.exitCode,
          exitMeaning: result.exitMeaning,
          terminalSeen: result.terminalSeen,
          preflightRejected: result.preflightRejected,
          wrote: result.wrote,
          refusals: result.refusals,
          radius: {
            testIds: result.radius.testIds,
            promiseIds: result.radius.promiseIds,
            unmatchedPaths: result.radius.unmatchedPaths,
            skippedNoTestId: result.radius.skippedNoTestId,
          },
          members: result.members,
          updatedPromiseIds: result.updatedPromiseIds,
          credits: result.credits,
          evidencePackId: result.evidencePackId,
          statePath: result.statePath,
          handoffPath: result.handoff.paths.newest,
          nextAction: result.handoff.handoff.nextAction,
          snapshot: { path: result.snapshot.path, written: result.snapshot.written },
          freshness: result.state.freshness,
          diagnostics: result.diagnostics,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    context.io.write(
      [
        `kept verify --${result.scope}`,
        `  repository   ${context.repoRoot}`,
        `  radius       ${
          result.radius.testIds.length === 0
            ? 'empty — nothing was invoked'
            : result.radius.testIds.join(', ')
        }`,
        `  command      ${result.invoked ? result.argv.join(' ') : 'none'}`,
        `  outcome      ${
          result.invoked
            ? `${result.exitMeaning ?? 'unknown'}, ${
                result.terminalSeen ? 'testrun_done seen' : 'no terminal event — outcome unknown'
              }`
            : 'no Kane process was started'
        }`,
        `  verdicts     ${
          result.wrote
            ? `${result.updatedPromiseIds.length} written`
            : `none written${result.refusals.length > 0 ? ` (${result.refusals.join(', ')})` : ''}`
        }`,
        `  next action  ${result.handoff.handoff.nextAction.branch ?? 'none'}`,
        `  handoff      ${result.handoff.paths.newest}`,
        '',
      ].join('\n'),
    );
  }
  writeDiagnostics(context.io, result.diagnostics, parsed.options.json);
  // Every outcome Kane can produce is data, so this is always zero (R2.10).
  return EXIT_OK;
}

/**
 * `kept reconcile --changed <p…>` and `kept reconcile apply [planPath]`
 * (design §13.2, §14.1).
 *
 * Two commands behind one word, and they are not variants of each other. The
 * `--changed` form is what the docs hook fires: `--plan`, always, one invocation
 * per changed doc, each with its own resolved `--source-id`. The `apply` form is
 * human-only, absent from both hook prompts, and walks a stored plan behind
 * Kane's approval prompt.
 *
 * This arm carries the **one non-zero exit in the product**. `--plan` together
 * with `--apply` is a usage error rejected before any spawn, and
 * `reconcileUsageErrors` catches the spelling the parser's flag table cannot see —
 * `kept reconcile apply --plan`, where `apply` arrived as a subcommand word.
 * Everything else exits 0: Kane's refusal, its pause, its exit 2 and its absence
 * are all data (R2.10, §14.2).
 */
async function dispatchReconcile(
  parsed: ParsedArgv,
  context: Dispatch & { readonly config: KeptConfig },
): Promise<number> {
  const usageErrors = reconcileUsageErrors(parsed);
  if (usageErrors.length > 0) {
    context.io.writeError(
      [...usageErrors.map((message) => `kept: ${message}`), '', USAGE, ''].join('\n'),
    );
    return EXIT_USAGE;
  }

  const invoker =
    context.io.invoker ??
    (context.io.kane === false ? undefined : new KaneInvoker({ sink: context.sink }));

  if (parsed.subcommand === 'apply') {
    const planPath = parsed.positionals[0] ?? null;
    const result = await runReconcileApply({
      repoRoot: context.repoRoot,
      config: context.config,
      planPath,
      fileSystem: context.fileSystem,
      diagnostics: context.sink,
      at: context.at,
      ...(invoker === undefined ? {} : { invoker }),
    });

    if (parsed.options.json) {
      context.io.write(
        `${JSON.stringify(
          {
            command: 'reconcile apply',
            implemented: true,
            repoRoot: context.repoRoot,
            planPath: result.planPath,
            argv: result.argv,
            invoked: result.invoked,
            exitCode: result.exitCode,
            exitMeaning: result.exitMeaning,
            terminalSeen: result.terminalSeen,
            status: result.status,
            paused: result.paused,
            message: result.message,
            staged: result.staged.length,
            handoffPath: result.handoff.paths.newest,
            nextAction: result.handoff.handoff.nextAction,
            snapshot: { path: result.snapshot.path, written: result.snapshot.written },
            diagnostics: result.diagnostics,
          },
          null,
          2,
        )}\n`,
      );
    } else {
      context.io.write(
        [
          `kept reconcile apply${result.planPath === null ? '' : ` ${result.planPath}`}`,
          `  repository   ${context.repoRoot}`,
          `  command      ${result.invoked ? result.argv.join(' ') : 'none'}`,
          `  outcome      ${
            result.invoked
              ? `${result.status ?? 'unknown'}${
                  result.terminalSeen ? '' : ' — no terminal event, outcome unknown'
                }`
              : 'no Kane process was started'
          }`,
          `  staged       ${result.staged.length} item(s) reported, none applied`,
          `  handoff      ${result.handoff.paths.newest}`,
          '',
        ].join('\n'),
      );
    }
    writeDiagnostics(context.io, result.diagnostics, parsed.options.json);
    return EXIT_OK;
  }

  const result = await runReconcile({
    repoRoot: context.repoRoot,
    config: context.config,
    changed: readList(parsed.flags, 'changed'),
    fileSystem: context.fileSystem,
    diagnostics: context.sink,
    at: context.at,
    ...(invoker === undefined ? {} : { invoker }),
  });

  if (parsed.options.json) {
    context.io.write(
      `${JSON.stringify(
        {
          command: 'reconcile',
          implemented: true,
          repoRoot: context.repoRoot,
          documents: result.docs.map((doc) => ({
            file: doc.file,
            sourceId: doc.sourceId,
            via: doc.via,
            refusal:
              doc.refusal === null
                ? null
                : { check: doc.refusal.check, code: doc.refusal.code, reason: doc.refusal.reason },
            argv: doc.argv,
            invoked: doc.invoked,
            exitCode: doc.exitCode,
            exitMeaning: doc.exitMeaning,
            terminalSeen: doc.terminalSeen,
            status: doc.status,
            paused: doc.paused,
            headMoved: doc.headMoved,
            staged: doc.staged.length,
            message: doc.message,
            runId: doc.runId,
            handoffPath: doc.handoff.paths.newest,
          })),
          outOfScope: result.outOfScope,
          invocations: result.invocations,
          rebuilt: result.rebuilt,
          reviewCards: result.reviewCards,
          statePath: result.statePath,
          promises: result.state.graph.promises.length,
          undesigned: result.state.graph.promises.filter(
            (promise) => promise.verdict === 'undesigned',
          ).length,
          degraded: result.state.graph.degraded,
          freshness: result.state.freshness,
          snapshot: { path: result.snapshot.path, written: result.snapshot.written },
          diagnostics: result.diagnostics,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    context.io.write(
      [
        `kept reconcile --changed`,
        `  repository   ${context.repoRoot}`,
        `  documents    ${
          result.docs.length === 0
            ? 'none inside the docs hook pattern set — nothing was invoked'
            : result.docs.map((doc) => doc.file).join(', ')
        }`,
        ...result.docs.map(
          (doc) =>
            `  ${doc.file}\n` +
            `    source     ${doc.sourceId ?? 'unresolved'}${
              doc.via === null ? '' : ` (via ${doc.via})`
            }\n` +
            `    command    ${doc.invoked ? doc.argv.join(' ') : 'none'}\n` +
            `    outcome    ${
              doc.invoked
                ? `${doc.status ?? 'unknown'}${doc.paused ? ', resumable' : ''}`
                : `refused: ${doc.refusal?.code ?? 'unknown'}`
            }`,
        ),
        `  graph        ${
          result.rebuilt
            ? `rebuilt, ${result.state.graph.promises.length} promise(s)`
            : 'unchanged — no accepted terminal event'
        }`,
        `  review cards none created; every change is held (R5.7)`,
        `  handoff      ${result.handoffs[result.handoffs.length - 1]?.paths.newest ?? 'none'}`,
        '',
      ].join('\n'),
    );
  }
  writeDiagnostics(context.io, result.diagnostics, parsed.options.json);
  // Every refusal is a refusal of Kane's, not a failure of KEPT (§14.1, R2.10).
  return EXIT_OK;
}

function dispatchSnapshot(parsed: ParsedArgv, context: Dispatch): number {
  const result = runSnapshot({
    repoRoot: context.repoRoot,
    fileSystem: context.fileSystem,
    diagnostics: context.sink,
    generatedAt: context.at,
  });

  if (parsed.options.json) {
    context.io.write(
      `${JSON.stringify(
        {
          command: 'snapshot',
          implemented: true,
          repoRoot: context.repoRoot,
          path: result.path,
          written: result.written,
          valid: result.valid,
          error: result.error,
          bytes: result.bytes,
          metrics: result.snapshot.metrics,
          diagnostics: result.diagnostics,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    context.io.write(
      [
        `kept snapshot`,
        `  file         ${result.path}`,
        `  status       ${
          result.valid
            ? result.written
              ? `written, ${result.bytes} bytes`
              : 'unchanged, already byte-identical'
            : 'not written — the snapshot failed its own schema check'
        }`,
        `  promises     ${result.snapshot.metrics.totalPromises}`,
        `  designed     ${formatCoverage(result.snapshot.metrics.designedCoverage)}`,
        `  proven       ${formatCoverage(result.snapshot.metrics.provenCoverage)}`,
        '',
      ].join('\n'),
    );
  }
  writeDiagnostics(context.io, result.diagnostics, parsed.options.json);
  // Not written is reported, never signalled: §14.2 keeps the exit code a
  // statement about whether KEPT worked, and the Ledger build is where a missing
  // or invalid snapshot fails loudly (§14.1).
  return EXIT_OK;
}

function reportPending(
  parsed: ParsedArgv,
  context: {
    readonly repoRoot: string;
    readonly config: KeptConfig;
    readonly sink: CollectingDiagnosticSink;
    readonly io: CliIo;
  },
): number {
  const command = parsed.command ?? '(none)';
  const task = PENDING_TASKS[command] ?? 'a later task';
  const message =
    `kept ${command} is specified in design §13.1 and lands in ${task}; nothing was run and ` +
    `nothing was written`;
  context.sink.report({ code: 'command-not-implemented', severity: 'warn', message });

  if (parsed.options.json) {
    context.io.write(
      `${JSON.stringify(
        {
          command,
          implemented: false,
          repoRoot: context.repoRoot,
          router: context.config.verdictRouter,
          message,
          diagnostics: context.sink.entries,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    context.io.write(`${message}\n`);
  }
  // Exit 0: the CLI worked, and it told the truth about what it did not do.
  return EXIT_OK;
}

/** A ratio as a whole-number percentage, or `n/a` for the honest null (R9.3). */
function formatCoverage(value: number | null): string {
  return value === null ? 'n/a' : `${Math.round(value * 100)}%`;
}

/**
 * Diagnostics go to stderr so stdout stays a clean `--json` payload, and are
 * suppressed under `--json` because the payload already carries them.
 */
function writeDiagnostics(
  io: CliIo,
  diagnostics: readonly Diagnostic[],
  json: boolean,
): void {
  if (json || diagnostics.length === 0) return;
  const shown = diagnostics.filter((entry) => entry.severity !== 'info');
  if (shown.length === 0) return;
  io.writeError(
    `${shown
      .map((entry) => `  ${entry.severity} ${entry.code}: ${entry.message}`)
      .join('\n')}\n`,
  );
}

/** The usage text. Mirrors the §13.1 table; no generator, so it cannot lie by omission. */
export const USAGE = [
  `kept ${KEPT_VERSION} — a living ledger of the promises a codebase makes.`,
  '',
  'Usage: kept <command> [options]',
  '',
  'Commands:',
  '  build                      run both promise providers and write .kept/state.json',
  '  snapshot                   write apps/ledger/data/ledger.snapshot.json',
  '  verify --changed <p…>      re-verify the blast radius of changed files',
  '  verify --all               re-verify every designed test',
  '  reconcile --changed <p…>   stage documentation reconciliation (--plan)',
  '  reconcile apply [plan]     walk a stored plan (human-only, never a hook)',
  '  evolve <testPath>          propose a test-drift repair',
  '  amend propose|list|show|accept|reject   documentation amendments',
  '  handoff [--run <id>]       print the agent handoff for a run',
  '  doctor                     report the environment, including kane-cli',
  '  watch                      tail NDJSON and listen for loopback accepts',
  '',
  'Common options:',
  '  --repo <root>              repository root (default: the working directory)',
  '  --json                     machine-readable stdout',
  '  --router <name>            resultCode740 | failureYamlTriage, for one invocation',
  '  --member-debug             set KANE_TESTRUN_MEMBER_DEBUG=1 and capture [member] lines',
  '  -h, --help                 this text',
  '',
  'Every command exits 0. The one exception is mutually exclusive flags',
  '(--plan with --apply), which exits 2 before anything runs.',
  '',
  `Commands implemented in this build: ${IMPLEMENTED_COMMANDS.join(', ')}.`,
].join('\n');
