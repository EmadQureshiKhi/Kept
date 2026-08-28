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

import type { CollectingDiagnosticSink, Diagnostic } from 'kept-core';
import { KaneInvoker, createDiagnosticSink } from 'kept-core';
import { handoffPaths, parseHandoff, serialiseHandoff } from 'kept-core';
import { nodeStateFileSystem, type StateFileSystem } from 'kept-core';

import type { ParsedArgv } from './args.js';
import { EXIT_OK, EXIT_USAGE, parseArgv, readList, readString } from './args.js';
import type { KeptConfig } from './config.js';
import { applyOverrides, loadConfig, memberDebugEnv } from './config.js';
import { AMEND_DIAGNOSTIC_CODES, runAmend, type AmendResult } from './commands/amend.js';
import { runBuild } from './commands/build.js';
import { runDoctor } from './commands/doctor.js';
import { runInit } from './commands/init.js';
import type { EvolveHelpProbe } from './commands/evolve.js';
import { runEvolve } from './commands/evolve.js';
import {
  reconcileUsageErrors,
  runReconcile,
  runReconcileApply,
} from './commands/reconcile.js';
import { runSnapshot } from './commands/snapshot.js';
import { runVerify } from './commands/verify.js';
import { WATCH_LOCAL_ENV_VALUE, runWatch } from './commands/watch.js';
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
  /**
   * Directory listings — `.kept/amendments/` and `.kept/handoff/`. Defaults to
   * `node:fs`. Injected so a test that seeds an in-memory filesystem can also be
   * seen by the two projections that enumerate a directory rather than read a path.
   */
  readonly readDirectory?: ((path: string) => readonly string[]) | undefined;
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
  /**
   * `kept evolve`'s one-time `maintain evolve --help` probe (§4.9).
   *
   * Its own seam rather than a use of {@link KaneInvoker}, because the invoker
   * appends the Assurance enabler from the contract (§4.7) — so asking it to run
   * `--help` would append the very `--mode agent` the probe exists to look for.
   * Defaults to the real `spawnSync` probe; a test injects one and starts no
   * process.
   */
  readonly evolveHelpProbe?: EvolveHelpProbe | undefined;
}

/** The commands this stage implements. The rest report honestly and exit 0. */
export const IMPLEMENTED_COMMANDS: readonly string[] = Object.freeze([
  'init',
  'build',
  'snapshot',
  'verify',
  'reconcile',
  'evolve',
  'amend',
  'doctor',
  'watch',
  'handoff',
]);

/**
 * Which task lands each unimplemented command, so the message can say so.
 *
 * **Empty, and that is the point of the guard rather than a reason to delete it.** It
 * held `handoff: 'task 12.11'` until an audit checked the pointer: task 12.11 is
 * `Write the hook-schema validation test`, complete, and about something else entirely,
 * and no task in the plan implemented `kept handoff` at all. So the help text advertised
 * a command that did not dispatch and sent anyone who tried it to a finished task about
 * hook schemas. The command is implemented now (see {@link dispatchHandoff}), which is
 * the honest resolution: the pieces were all in `handoff/handoff.ts` already.
 *
 * `argv-contract.test.ts` asserts this table against `KEPT_COMMANDS` and
 * {@link IMPLEMENTED_COMMANDS}, so a command may be in exactly one of the two states and
 * an entry here has to name a task that exists and is open.
 */
const PENDING_TASKS: Readonly<Record<string, string>> = Object.freeze({});

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
    case 'init':
      return dispatchInit(parsed, { repoRoot, fileSystem, sink, at, io });
    case 'doctor':
      return await dispatchDoctor(parsed, { repoRoot, config, fileSystem, sink, at, io });
    case 'build':
      return await dispatchBuild(parsed, { repoRoot, config, fileSystem, sink, at, io });
    case 'snapshot':
      return dispatchSnapshot(parsed, { repoRoot, fileSystem, sink, at, io });
    case 'verify':
      return await dispatchVerify(parsed, { repoRoot, config, fileSystem, sink, at, io });
    case 'reconcile':
      return await dispatchReconcile(parsed, { repoRoot, config, fileSystem, sink, at, io });
    case 'evolve':
      return await dispatchEvolve(parsed, { repoRoot, config, fileSystem, sink, at, io });
    case 'amend':
      return await dispatchAmend(parsed, { repoRoot, config, fileSystem, sink, at, io });
    case 'watch':
      return await dispatchWatch(parsed, { repoRoot, config, fileSystem, sink, at, io });
    case 'handoff':
      return dispatchHandoff(parsed, { repoRoot, fileSystem, sink, at, io });
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

/**
 * `kept init [--force]` (design §21.1, R16.1 to R16.8).
 *
 * Synchronous and unlike every other arm here it takes **no invoker**, because
 * {@link runInit} has no process seam at all (R16.6). That is deliberate and it is
 * why this arm cannot accidentally grow one: there is no parameter to pass.
 *
 * The config is not read into this arm either. `init` is the command a repository
 * runs *before* it has a config, so a dispatch that resolved one first would be
 * reporting defaults at the reader before writing the file that replaces them.
 */
function dispatchInit(parsed: ParsedArgv, context: Dispatch): number {
  const result = runInit({
    repoRoot: context.repoRoot,
    // Read off `flags` rather than `options`: `CommonOptions` is the four flags
    // every command takes, and `--force` belongs to exactly one of them.
    force: parsed.flags.has('force'),
    fileSystem: context.fileSystem,
    diagnostics: context.sink,
  });

  if (parsed.options.json) {
    context.io.write(
      `${JSON.stringify(
        {
          command: 'init',
          implemented: true,
          repoRoot: context.repoRoot,
          configPath: result.configPath,
          configWritten: result.configWritten,
          replacedConfigPath: result.replacedConfigPath,
          alreadyConfigured: result.alreadyConfigured,
          examplePath: result.examplePath,
          exampleWritten: result.exampleWritten,
          corpusRoot: result.detection.corpusRoot,
          documents: result.detection.documents,
          corpusFiles: result.detection.corpusFiles,
          docGlobs: result.detection.docGlobs,
          writes: result.writes,
          nextCommand: result.nextCommand,
          kaneInvocations: result.kaneInvocations,
          credits: result.credits,
          diagnostics: result.diagnostics,
        },
        null,
        2,
      )}\n`,
    );
  } else if (result.alreadyConfigured) {
    context.io.write(
      [
        `kept init`,
        `  repository   ${context.repoRoot}`,
        `  config       ${result.configPath} already exists, so nothing was written`,
        ``,
        `  Run \`kept init --force\` to replace it, or \`${result.nextCommand}\` to see what`,
        `  this repository still needs.`,
        '',
      ].join('\n'),
    );
  } else {
    context.io.write(
      [
        `kept init`,
        `  repository   ${context.repoRoot}`,
        `  config       ${result.configPath}${result.configWritten ? '' : ' (not written)'}`,
        `  corpus root  ${result.detection.corpusRoot}`,
        `  example      ${result.examplePath}${
          result.exampleWritten ? '' : ' (left as it was)'
        }`,
        `  documents    ${result.detection.documents.length} candidate${
          result.detection.documents.length === 1 ? '' : 's'
        }, no citation written for any of them`,
        `  designed     ${result.detection.corpusFiles.length} existing \`*_test.md\``,
        `  Kane         ${result.kaneInvocations} invocations, ${result.credits} credits`,
        ``,
        `  Next: ${result.nextCommand}`,
        '',
      ].join('\n'),
    );
  }
  writeDiagnostics(context.io, result.diagnostics, parsed.options.json);
  // Nothing `init` can meet is a failure of KEPT: a config that already exists, a
  // repository with no documentation, a read-only checkout (§14.2, R16.2).
  return EXIT_OK;
}

/**
 * `kept doctor` (design §21.2, R18.1 to R18.10).
 *
 * The invoker is resolved the way `kept build` resolves it, so a real run probes a
 * real binary, and `io.kane === false` exercises the R2.12 "no Kane at all" path.
 * `runDoctor` bounds it to one spawn by the shape of the seam it accepts, so this
 * arm cannot widen that by passing something richer.
 */
async function dispatchDoctor(
  parsed: ParsedArgv,
  context: Dispatch & { readonly config: KeptConfig },
): Promise<number> {
  const invoker =
    context.io.invoker ??
    (context.io.kane === false ? undefined : new KaneInvoker({ sink: context.sink }));

  const result = await runDoctor({
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
          command: 'doctor',
          implemented: true,
          repoRoot: context.repoRoot,
          checks: result.checks,
          spawns: result.spawns,
          kane: result.kane,
          corpus: result.corpus,
          snapshot: result.snapshot,
          subject: result.subject,
          contextStore: result.contextStore,
          fences: result.fences,
          handoff: result.handoff.paths,
          diagnostics: result.diagnostics,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    const pad = (text: string, width: number): string => text.padEnd(width, ' ');
    context.io.write(
      [
        `kept doctor`,
        `  repository   ${context.repoRoot}`,
        '',
        ...result.checks.flatMap((check) => {
          const head = `  ${check.number}. ${pad(check.title, 18)} ${pad(check.status, 16)} ${
            check.detail
          }`;
          return check.remedy === null ? [head] : [head, `     remedy: ${check.remedy}`];
        }),
        '',
        `  ${result.spawns} Kane invocation${result.spawns === 1 ? '' : 's'}, 0 credits. ` +
          `Exit code 0 in every case.`,
        '',
      ].join('\n'),
    );
  }
  writeDiagnostics(context.io, result.diagnostics, parsed.options.json);
  // R18.8, and the field is the literal 0, so this cannot return anything else.
  return result.exitCode;
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
    /* Both seams or neither. `fileSystem` reads files by path and cannot list a
       directory, and the snapshot this command writes projects three stores by
       enumerating one each, so passing only `fileSystem` leaves those listings on real
       disk while the reads go to the injected map. Threading it here is what makes the
       chain complete from the process boundary rather than only from `runSnapshot`. */
    ...(context.io.readDirectory === undefined
      ? {}
      : { readDirectory: context.io.readDirectory }),
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
          memberStreamPath: result.memberStreamPath,
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
      // Both seams or neither, for the reason at `SnapshotRequest.readDirectory`.
      ...(context.io.readDirectory === undefined
        ? {}
        : { readDirectory: context.io.readDirectory }),
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
    // Both seams or neither, for the reason at `SnapshotRequest.readDirectory`.
    ...(context.io.readDirectory === undefined
      ? {}
      : { readDirectory: context.io.readDirectory }),
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
        /* Read off the result, never asserted. This line used to be the literal string
           "none created; every change is held (R5.7)", which was half true in the worst
           available way: the held claim was correct and the count was not. On the run
           that exercised the docs trigger end to end, Kane staged nine changes, the JSON
           output reported nine review cards, and this summary said none had been created
           while the ledger rendered all nine. A summary that contradicts the artefact it
           summarises is worse than no summary, because it is the one a human reads. The
           `evolve` renderer below already spelled this correctly, which is what made the
           divergence findable at all. */
        `  review cards ${
          result.reviewCards.length === 0
            ? 'none created'
            : `${result.reviewCards.length} staged`
        }; every change is held (R5.7)`,
        `  handoff      ${result.handoffs[result.handoffs.length - 1]?.paths.newest ?? 'none'}`,
        '',
      ].join('\n'),
    );
  }
  writeDiagnostics(context.io, result.diagnostics, parsed.options.json);
  // Every refusal is a refusal of Kane's, not a failure of KEPT (§14.1, R2.10).
  return EXIT_OK;
}

/**
 * `kept evolve <testPath>` — the held `test-drift` branch (design §8.1, §13.1, R7.2).
 *
 * The ref arrives as the word after the command, which `parseArgv` reports as
 * `subcommand` rather than as `positionals[0]` — that is the parser's shape for every
 * command, and `kept reconcile apply` uses the same field for the same reason. Both
 * are read so a future variadic spelling does not silently lose the ref.
 *
 * Exit code zero for every outcome, including the flag-mismatch degradation that is
 * the *live* path on the installed 0.8.4: `maintain evolve` there carries no `--mode`
 * option, so the invocation is skipped and the drift is held as a review card. That
 * is Kane's surface being what it is, not KEPT failing (R2.10, §14.2).
 */
async function dispatchEvolve(
  parsed: ParsedArgv,
  context: Dispatch & { readonly config: KeptConfig },
): Promise<number> {
  const invoker =
    context.io.invoker ??
    (context.io.kane === false ? undefined : new KaneInvoker({ sink: context.sink }));
  const ref = parsed.subcommand ?? parsed.positionals[0] ?? null;

  const result = await runEvolve({
    repoRoot: context.repoRoot,
    config: context.config,
    ref,
    fileSystem: context.fileSystem,
    diagnostics: context.sink,
    at: context.at,
    ...(invoker === undefined ? {} : { invoker }),
    ...(context.io.evolveHelpProbe === undefined
      ? {}
      : { helpProbe: context.io.evolveHelpProbe }),
  });

  if (parsed.options.json) {
    context.io.write(
      `${JSON.stringify(
        {
          command: 'evolve',
          implemented: true,
          repoRoot: context.repoRoot,
          ref: result.ref,
          promiseId: result.promiseId,
          probe:
            result.probe === null
              ? null
              : {
                  ran: result.probe.ran,
                  exitCode: result.probe.exitCode,
                  flags: result.probe.flags,
                  supportsModeAgent: result.probe.supportsModeAgent,
                  failure: result.probe.failure,
                },
          flagSupported: result.flagSupported,
          degradedByFlagProbe: result.degradedByFlagProbe,
          argv: result.argv,
          invoked: result.invoked,
          exitCode: result.exitCode,
          exitMeaning: result.exitMeaning,
          terminalSeen: result.terminalSeen,
          status: result.status,
          paused: result.paused,
          message: result.message,
          staged: result.staged.length,
          reviewCards: result.reviewCards.map((card) => ({
            id: card.id,
            kind: card.kind,
            branch: card.branch,
            promiseId: card.promiseId,
            status: card.status,
            proposedChanges: card.proposedChanges.length,
          })),
          cardPaths: result.cardPaths,
          runId: result.runId,
          handoffPath: result.handoff.paths.newest,
          nextAction: result.handoff.handoff.nextAction,
          diagnostics: result.diagnostics,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    context.io.write(
      [
        `kept evolve${result.ref === null ? '' : ` ${result.ref}`}`,
        `  repository   ${context.repoRoot}`,
        `  promise      ${result.promiseId ?? 'unattributed — no designed test matches this ref'}`,
        `  flag probe   ${
          result.probe === null
            ? 'not run — no reference was given'
            : result.probe.ran
              ? `${result.probe.flags.join(', ') || 'no long flags'} → --mode ${
                  result.flagSupported ? 'supported' : 'absent, so nothing was invoked'
                }`
              : `unreadable (${result.probe.failure ?? 'no reason reported'})`
        }`,
        `  command      ${result.invoked ? result.argv.join(' ') : 'none'}`,
        `  outcome      ${
          result.invoked
            ? `${result.status ?? 'unknown'}${result.paused ? ', resumable' : ''}`
            : 'no Kane process was started'
        }`,
        `  review cards ${
          result.reviewCards.length === 0
            ? 'none created'
            : `${result.reviewCards.map((card) => card.id).join(', ')} — held, never applied`
        }`,
        `  handoff      ${result.handoff.paths.newest}`,
        '',
      ].join('\n'),
    );
  }
  writeDiagnostics(context.io, result.diagnostics, parsed.options.json);
  // A flag Kane does not have is a fact about Kane, not a failure of KEPT (§14.2).
  return EXIT_OK;
}

/**
 * `kept amend propose | list | show | accept | reject` (design §8.3, §8.4, §13.1).
 *
 * The verb arrives as `subcommand` and the id as `positionals[0]`, the same shape
 * `kept reconcile apply` and `kept evolve` use. Exit code zero for every outcome,
 * including the two refusals worth naming: a document that moved under a proposal
 * (`stale` — the interlock did its job, and no byte was written) and a `docs-lie`
 * with no `--text` (KEPT does not write documentation prose). Both are states of the
 * world, not failures of KEPT (§14.2).
 */
async function dispatchAmend(
  parsed: ParsedArgv,
  context: Dispatch & { readonly config: KeptConfig },
): Promise<number> {
  const invoker =
    context.io.invoker ??
    (context.io.kane === false ? undefined : new KaneInvoker({ sink: context.sink }));

  const result = await runAmend({
    repoRoot: context.repoRoot,
    config: context.config,
    subcommand: parsed.subcommand,
    id: parsed.positionals[0] ?? null,
    runId: readString(parsed.flags, 'run'),
    text: readString(parsed.flags, 'text'),
    fileSystem: context.fileSystem,
    ...(context.io.readDirectory === undefined
      ? {}
      : { readDirectory: context.io.readDirectory }),
    diagnostics: context.sink,
    at: context.at,
    ...(invoker === undefined ? {} : { invoker }),
  });

  if (parsed.options.json) {
    context.io.write(
      `${JSON.stringify(
        {
          command: 'amend',
          subcommand: result.subcommand,
          implemented: true,
          repoRoot: context.repoRoot,
          runId: result.runId,
          amendments: result.amendments,
          proposals: result.proposals.map((proposal) =>
            proposal.ok
              ? {
                  ok: true,
                  id: proposal.amendment.id,
                  path: proposal.path,
                  wrote: proposal.wrote,
                  existed: proposal.existed,
                }
              : { ok: false, reason: proposal.reason },
          ),
          pending: result.pending.map((entry) => ({
            promiseId: entry.promiseId,
            citation: entry.citation,
            branch: entry.repair?.branch ?? null,
            rationale: entry.repair?.rationale ?? null,
          })),
          accepted:
            result.accepted === null
              ? null
              : {
                  outcome: result.accepted.outcome,
                  applied: result.accepted.applied,
                  successorPromiseId: result.accepted.successorPromiseId,
                  rebuildRequired: result.accepted.rebuildRequired,
                },
          rejected: result.rejected === null ? null : { outcome: result.rejected.outcome },
          rebuilt: result.rebuilt,
          snapshot:
            result.snapshot === null
              ? null
              : { path: result.snapshot.path, written: result.snapshot.written },
          diagnostics: result.diagnostics,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    context.io.write(
      [
        `kept amend ${result.subcommand ?? '(no verb)'}`,
        `  repository   ${context.repoRoot}`,
        ...(result.runId === null ? [] : [`  run          ${result.runId}`]),
        ...(result.pending.length === 0
          ? []
          : [`  docs-lie     ${result.pending.length} claim(s) the router settled`]),
        // `propose` staging nothing is an outcome, not a debug note, so it is said
        // here rather than left to a diagnostic the human form never prints.
        //
        // Task 22.2's live cycle found this the hard way. The run it was pointed at
        // had settled its failure as `test-drift`, so there was no docs-lie to amend
        // and nothing was staged, which is correct. `amend-no-docs-lie` said exactly
        // that at `info`, and `writeDiagnostics` drops `info` on purpose so the human
        // output is not flooded. The result was a command that printed two lines, its
        // own name and the repository path, exited 0, and left a reader with no way to
        // tell a refusal from a success. Surfacing the one diagnostic that explains an
        // empty `propose` is narrower than making `info` visible everywhere.
        ...proposeRefusalLines(result),
        ...result.amendments.map(
          (amendment) =>
            `  ${amendment.id}   ${amendment.status}  ` +
            `${amendment.citation.file}:${amendment.citation.line}\n` +
            `    was        ${amendment.currentText}\n` +
            `    proposed   ${amendment.proposedText}`,
        ),
        ...(result.accepted === null
          ? []
          : [
              `  outcome      ${result.accepted.outcome}` +
                `${result.accepted.applied ? ', one line written' : ', no document byte written'}`,
              `  successor    ${result.accepted.successorPromiseId ?? 'none'}`,
              `  graph        ${result.rebuilt ? 'rebuilt' : 'unchanged'}`,
            ]),
        ...(result.rejected === null ? [] : [`  outcome      ${result.rejected.outcome}`]),
        ...(result.snapshot === null
          ? []
          : [
              `  snapshot     ${
                result.snapshot.written ? 'written' : 'unchanged, already byte-identical'
              }`,
            ]),
        '',
      ].join('\n'),
    );
  }
  writeDiagnostics(context.io, result.diagnostics, parsed.options.json);
  // A stale interlock, a missing run, a claim with no replacement: all data (§14.2).
  return EXIT_OK;
}

/**
 * `kept watch` (design §8.5, §13.1, R7.5, R7.6).
 *
 * The one arm that returns while its work is still running: a bound listener keeps
 * the event loop alive, and `index.ts` sets `process.exitCode` rather than calling
 * `process.exit`, so the process stays up until the reader stops it. That is the
 * command doing what it says. When the gate is absent, or the port is taken, or the
 * bind comes back on the wrong interface, nothing is listening, there is nothing to
 * keep alive, and the process ends normally with the same exit code of 0 (§14.2).
 *
 * The host and port are not read from here, from a flag or from the environment.
 * `runWatch` owns them as constants and refuses to serve any address that is not
 * loopback, so this arm has no way to widen the bind even by mistake.
 */
async function dispatchWatch(
  parsed: ParsedArgv,
  context: Dispatch & { readonly config: KeptConfig },
): Promise<number> {
  const invoker =
    context.io.invoker ??
    (context.io.kane === false ? undefined : new KaneInvoker({ sink: context.sink }));

  const handle = await runWatch({
    repoRoot: context.repoRoot,
    config: context.config,
    env: context.io.env,
    fileSystem: context.fileSystem,
    diagnostics: context.sink,
    now: () => (context.io.now?.() ?? new Date()).toISOString(),
    ...(invoker === undefined ? {} : { invoker }),
  });
  const result = handle.result;

  if (parsed.options.json) {
    context.io.write(
      `${JSON.stringify(
        {
          command: 'watch',
          implemented: true,
          repoRoot: context.repoRoot,
          listening: result.listening,
          host: result.host,
          port: result.port,
          route: result.route,
          local: result.local,
          envVar: result.envVar,
          refusal: result.refusal,
          error: result.error,
          diagnostics: result.diagnostics,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    context.io.write(
      [
        `kept watch`,
        `  repository   ${context.repoRoot}`,
        `  listening    ${
          result.listening
            ? `${result.host}:${result.port}, loopback only`
            : `nothing was bound (${result.refusal ?? 'unreported'})`
        }`,
        `  route        ${result.route}, and no other method or path`,
        `  gate         ${result.envVar}=${
          result.local ? WATCH_LOCAL_ENV_VALUE : 'unset, so nothing was started'
        }`,
        `  ledger       unchanged: this listener adds no route to it (design §8.5)`,
        '',
        ...(result.listening
          ? [`  Accepting an amendment here runs the same path as \`kept amend accept <id>\`.`, '']
          : [
              `  \`kept amend accept <id>\` is unaffected and is the path the deployed`,
              `  Ledger's accept control copies either way.`,
              '',
            ]),
      ].join('\n'),
    );
  }
  writeDiagnostics(context.io, result.diagnostics, parsed.options.json);
  // An occupied port and a missing gate variable are states of the world (§14.2),
  // and the field is the literal 0, so this cannot return anything else.
  return result.exitCode;
}

function dispatchSnapshot(parsed: ParsedArgv, context: Dispatch): number {
  const result = runSnapshot({
    repoRoot: context.repoRoot,
    fileSystem: context.fileSystem,
    diagnostics: context.sink,
    generatedAt: context.at,
    ...(context.io.readDirectory === undefined
      ? {}
      : { readDirectory: context.io.readDirectory }),
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

/**
 * `kept handoff [--run <id>]` (design §13.1, R11.4, R11.7).
 *
 * Prints the agent handoff: the file an agent's next move comes from, rather than an exit
 * code. `.kept/handoff.json` is always the newest one, and `.kept/handoff/<run>.json` is
 * the immutable per-run copy, so `--run` reads the archive and no argument reads the
 * newest.
 *
 * **Why this arm exists now.** The help text has advertised this command since §13.1 was
 * written, it never dispatched, and `PENDING_TASKS` pointed anyone who tried it at task
 * 12.11, which is a completed test about hook schemas. An audit checked the pointer.
 * Nothing in the plan implemented the command, so it was advertised, absent, and
 * misdirecting all at once, which is three claims a reader could act on and none of them
 * true. Every piece it needs was already in `handoff/handoff.ts`: `handoffPaths` resolves
 * both spellings, `parseHandoff` validates, `readNewestHandoff` reads the live one. The
 * command is thirty lines of wiring over machinery that was already tested.
 *
 * **It spawns nothing and writes nothing.** A handoff is a record of a run that already
 * happened, so reading one costs no credits and touches no state. That is also what makes
 * it safe for a hook prompt to quote: the two agent hooks tell an agent to read this file,
 * and a command that re-ran anything to show it would turn a read into a side effect.
 *
 * Absent is not an error. A repository that has never verified anything has no handoff,
 * which is an ordinary state, so it is reported by name and the exit code stays zero
 * (§14.2).
 */
function dispatchHandoff(parsed: ParsedArgv, context: Dispatch): number {
  const runId = readString(parsed.flags, 'run');
  const paths = handoffPaths(context.repoRoot, runId ?? '');
  const path = runId === null ? paths.newest : paths.archive;
  const contents = context.fileSystem.readFile(path);
  const handoff = contents === null ? null : parseHandoff(contents);

  if (handoff === null) {
    const reason =
      contents === null
        ? `no handoff exists at ${path}`
        : `the handoff at ${path} is not a handoff this build recognises`;
    const message =
      `kept handoff: ${reason}. A repository that has not verified anything yet has no ` +
      `handoff, which is an ordinary state rather than a failure; run \`kept verify\` or ` +
      `\`kept reconcile\` to produce one.`;
    context.sink.report({ code: 'handoff-absent', severity: 'warn', message });
    if (parsed.options.json) {
      context.io.write(
        `${JSON.stringify(
          {
            command: 'handoff',
            implemented: true,
            repoRoot: context.repoRoot,
            path,
            runId,
            handoff: null,
            diagnostics: context.sink.entries,
          },
          null,
          2,
        )}\n`,
      );
    } else {
      context.io.write(`${message}\n`);
    }
    return EXIT_OK;
  }

  if (parsed.options.json) {
    context.io.write(
      `${JSON.stringify(
        {
          command: 'handoff',
          implemented: true,
          repoRoot: context.repoRoot,
          path,
          runId,
          handoff,
          diagnostics: context.sink.entries,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    /* The whole file, verbatim, through the writer's own serialiser. An agent reading
       this needs the fence and the instruction exactly as written, and a summary would
       be a second, lossier spelling of a contract that already has one. */
    context.io.write(serialiseHandoff(handoff));
  }
  writeDiagnostics(context.io, context.sink.entries, parsed.options.json);
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
 * The reason `kept amend propose` staged nothing, for the human summary.
 *
 * Empty for every other verb and for a `propose` that did stage something, so the
 * summary gains a line exactly when it would otherwise say nothing at all. The text
 * is the command's own diagnostic rather than a second wording of it, so the two
 * cannot drift apart.
 */
function proposeRefusalLines(result: AmendResult): readonly string[] {
  if (result.subcommand !== 'propose') return [];
  if (result.amendments.length > 0 || result.pending.length > 0) return [];
  const explained = result.diagnostics.find(
    (entry) => entry.code === AMEND_DIAGNOSTIC_CODES.noDocsLie,
  );
  return explained === undefined ? [] : [`  outcome      ${explained.message}`];
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
  '  init [--force]             write .kept/config.json and scaffold one designed test',
  '  build                      run both promise providers and write .kept/state.json',
  '  snapshot                   write apps/ledger/data/ledger.snapshot.json',
  '  verify --changed <p…>      re-verify the blast radius of changed files',
  '  verify --all               re-verify every designed test',
  '  reconcile --changed <p…>   stage documentation reconciliation (--plan)',
  '  reconcile apply [plan]     walk a stored plan (human-only, never a hook)',
  '  evolve <testPath>          propose a test-drift repair',
  '  amend propose --run <id> --text <s>     stage a docs-lie amendment',
  '  amend list|show|accept|reject <id>      review, apply or decline one',
  '  handoff [--run <id>]       print the agent handoff for a run',
  '  doctor                     report the environment, including kane-cli',
  '  watch                      listen on loopback for one-click amendment accepts',
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
