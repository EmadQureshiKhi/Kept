import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type {
  ChildProcessLike,
  KeptState,
  PromiseRecord,
  StateFileSystem,
  TestDocumentSource,
} from '@kept/core';
import {
  KaneInvoker,
  PLAN_FILE_RELATIVE_PATH,
  STATE_FILE_RELATIVE_PATH,
  createDiagnosticSink,
  createKeptState,
  createPromiseGraph,
  createPromiseRecord,
  inMemoryBaselineFileSystem,
  inMemoryCitationSource,
  inMemoryPlanFileSystem,
  inMemorySourceCacheFileSystem,
  serialiseState,
} from '@kept/core';
import { describe, expect, it } from 'vitest';

import { EXIT_OK } from '../src/args.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { FIXTURE_CONFIG } from './fixture-config.js';
import { IMPLEMENTED_COMMANDS, main } from '../src/main.js';
import type { EvolveHelpObservation } from '../src/commands/evolve.js';
import { clearEvolveHelpProbeCache, parseEvolveHelp } from '../src/commands/evolve.js';
import { runReconcile } from '../src/commands/reconcile.js';
import { runVerify } from '../src/commands/verify.js';

/**
 * Task 12.13 — the per-command argv assertion suite (design §13.1, §13.2,
 * §4.7, R3.4, R3.5, R4.2, R5.2, R7.2).
 *
 * **The argv is the contract with Kane, and a silently wrong flag is a silently
 * dead branch.** That sentence is the whole reason this file exists separately
 * from each command's own suite. Every failure mode it guards against looks like
 * success from every other angle:
 *
 * - `testrun run` takes **no** `--agent`. Kane rejects one, so a stray enabler
 *   means nothing runs at all — and the run still reports an exit code, a
 *   handoff and a clean CLI exit 0.
 * - `maintain reconcile` **requires** `--from` and `--source-id`. The earlier
 *   design issued it bare, which would have exited 2 on every single save while
 *   looking perfectly wired up.
 * - `--plan` with `--apply` cannot both appear, because one stages and the other
 *   walks what was staged.
 *
 * So the assertions here are on the **effective argv at the process boundary** —
 * what the recording stub was actually asked to spawn, enabler included — rather
 * than on any string a command believes it composed. Zero real Kane processes: the
 * spawn seam is injected everywhere, and the NDJSON comes from the committed
 * fixtures of task 2.10.
 *
 * ## Live rows and pending rows
 *
 * Every command that spawns is now asserted at the process boundary: `kept build`,
 * the plan refresh, `kept verify` in both scopes, `kept reconcile --changed`, and
 * since task 14.2 `kept evolve`, and since task 24.3 `kept doctor`. There are no
 * pending rows left.
 *
 * The mechanism that got them here is worth recording, because it worked twice. A
 * pending row was guarded two ways: a pinned argv literal, and a **live** assertion
 * that the command was not implemented and spawned nothing at all. A skipped test
 * that quietly passes would have been worse than no test, since the row it protects
 * would land unprotected. Instead the live assertion failed the moment the command
 * started working, which sent its author here to replace the literal with a real
 * boundary check. `kept evolve` went through it at task 14.2 and `kept doctor` at
 * task 24.3.
 *
 * ## `kept evolve` needs a second seam injected, and that is the point
 *
 * §13.1's row is `maintain evolve <ref> --mode agent`, and the installed 0.8.4
 * **does not carry `--mode` on that verb** — `maintain evolve --help` lists only
 * `--from-stale`, `--because` and `-h`, and a real invocation answers
 * `error: unknown option '--mode'`. So `kept evolve` probes `--help` once per
 * process and skips the invocation when the flag is absent (design §4.9, §14.1),
 * which means the argv this file exists to pin is only *reachable* when the probe
 * reports the flag present.
 *
 * That is asserted honestly rather than papered over. {@link SUPPORTS_MODE} is a
 * probe reporting an option table that carries `--mode`, so the block below proves
 * the argv KEPT composes for a Kane that accepts it; `test/evolve.test.ts` drives
 * the degradation from the *verbatim* option table the installed binary printed.
 * Between them, both halves of the row are covered and neither depends on the
 * other being wrong.
 */
const REPO = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/+$/, '');
const AT = '2026-08-20T18:41:02.118Z';
const STATE_PATH = `${REPO}/${STATE_FILE_RELATIVE_PATH}`;
const README = 'apps/fixture/README.md';
const FIXTURES = new URL('../../kept-core/test/fixtures/', import.meta.url);

function fixtureLines(name: string): readonly string[] {
  return readFileSync(new URL(name, FIXTURES), 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0);
}

const COVER_DONE = fixtureLines('assurance-cover-done.ndjson');
const TESTRUN_MIXED = fixtureLines('testrun-mixed.ndjson');
const LISTING = fixtureLines('context-list-sources.jsonl');

/** A reconcile that completed, in the Assurance envelope's shape. */
const RECONCILE_DONE = [
  '{"type":"done","v":1,"verb":"reconcile","status":"complete","exit_code":0,' +
    '"message":"staged into the stored plan"}',
];

/**
 * An empty store: no lines at all, exit 0. Nothing backs the document, so nothing
 * may be spawned.
 */
const EMPTY_STORE: readonly string[] = [];

/**
 * A listing carrying one live source per named document — one JSON object per
 * line, which is what `context list --json` actually emits.
 */
function listingFor(entries: readonly (readonly [string, string])[]): readonly string[] {
  return entries.map(([id, path]) =>
    JSON.stringify({ source_id: id, path, retired: false }),
  );
}

// ---------------------------------------------------------------------------
// The argv every §13.1 row must produce, pinned in one table
// ---------------------------------------------------------------------------

/**
 * The argv of the one command §13.1 specifies and this build does not have.
 *
 * `kept doctor` is the one row with no family at all, so it takes no enabler;
 * `--version` is the whole argv. `kept evolve` left this table when task 14.2
 * landed — its row is now asserted at the process boundary further down, which is
 * strictly stronger than a pinned literal.
 */
/*
 * `PENDING_ARGV` used to live here with one entry, `doctor: ['--version']`.
 *
 * It is gone because the row it protected landed in task 24.3, and the guard did its
 * job: the live "not implemented, spawns nothing" assertion failed the moment the
 * command started working, which sent its author here to replace a pinned literal
 * with a real process-boundary check. That check is at the bottom of this file. The
 * table is deliberately not left behind as an empty object, because a mechanism with
 * no members is a mechanism the next reader has to work out is inert.
 */

/**
 * The evolve reference §13.1 spells `<testPath>`, and the promise that cites it.
 *
 * A real path from {@link PRIOR} rather than a placeholder, because `kept evolve`
 * attributes the drift to the promise whose designed test the ref names — an
 * unattributed ref creates no review card, and an argv test that also happened to
 * be exercising the unattributed arm would be proving two things at once.
 */
const EVOLVE_REF = 'tests/cart_subtotal_test.md';

/**
 * A `--help` probe reporting an option table that carries `--mode`.
 *
 * The installed 0.8.4 does not; see this file's header. Injected here so the argv
 * of §13.1 is reachable and can be asserted at the process boundary, and spelled
 * as help *text* rather than as a hand-built observation so the parse KEPT ships is
 * the thing under test.
 */
const SUPPORTS_MODE = async (): Promise<EvolveHelpObservation> =>
  parseEvolveHelp(
    [
      'Usage: kane-cli maintain evolve [options] [ref]',
      '',
      'Options:',
      '  --from-stale        Evolve every use-case with stale designed entities',
      '  --because <reason>  Re-design a FRESH target anyway',
      '  --mode <mode>       interactive | agent | ci | override',
      '  -h, --help          display help for command',
    ].join('\n'),
    0,
  );

// ---------------------------------------------------------------------------
// The recording stub: one seam, answering by verb
// ---------------------------------------------------------------------------

class FakeStream {
  private listener: ((chunk: string) => void) | undefined;
  setEncoding(): unknown {
    return this;
  }
  on(_event: string, listener: (chunk: string) => void): unknown {
    this.listener = listener;
    return this;
  }
  emit(chunk: string): void {
    this.listener?.(chunk);
  }
}

class FakeChild {
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  private readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  on(event: string, listener: (...args: unknown[]) => void): unknown {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }
  kill(): boolean {
    return true;
  }
  close(code: number | null): void {
    for (const listener of this.listeners.get('close') ?? []) listener(code, null);
  }
  asChild(): ChildProcessLike {
    return this as unknown as ChildProcessLike;
  }
}

interface Recorder {
  readonly invoker: KaneInvoker;
  /** Every argv the process seam was handed, enabler included. The contract. */
  readonly spawns: string[][];
}

/**
 * A recording invoker that answers by verb, so one instance serves a whole
 * command — a verify that refreshes its plan first, or a reconcile that rebuilds
 * the graph afterwards, both spawn twice for different reasons.
 */
function recorder(options: { readonly listing?: readonly string[] } = {}): Recorder {
  const spawns: string[][] = [];
  const invoker = new KaneInvoker({
    sink: createDiagnosticSink(),
    resolveBinary: () => '/stub/bin/kane-cli',
    spawn: (_command, args) => {
      spawns.push([...args]);
      const child = new FakeChild();
      const lines =
        args[0] === 'cover'
          ? COVER_DONE
          : args[0] === 'testrun'
            ? TESTRUN_MIXED
            : args[0] === 'context'
              ? (options.listing ?? LISTING)
              : RECONCILE_DONE;
      queueMicrotask(() => {
        for (const line of lines) child.stdout.emit(`${line}\n`);
        child.close(args[0] === 'testrun' ? 1 : 0);
      });
      return child.asChild();
    },
  });
  return { invoker, spawns };
}

/** Every recorded argv whose verb pair matches, so a row can be isolated. */
function spawnsOf(recorded: readonly string[][], verb: string): readonly string[][] {
  return recorded.filter((argv) => argv[0] === verb);
}

// ---------------------------------------------------------------------------
// The repository under test: two promises, one designed test each
// ---------------------------------------------------------------------------

function record(claim: string, line: number, test: string, testId: string): PromiseRecord {
  return createPromiseRecord({
    claim,
    citation: { file: README, line, text: claim },
    designedTest: { path: test, testId },
    verdict: 'proven',
    verdictSource: {
      runId: 'run_prior',
      terminalEventType: 'testrun_done',
      at: '2026-08-01T00:00:00.000Z',
      memberStatus: 'passed',
      resultCode: null,
      reasonCode: null,
    },
    providers: ['baseline'],
  });
}

const PRIOR: KeptState = createKeptState({
  updatedAt: '2026-08-01T00:00:00.000Z',
  freshness: {
    terminalEventAt: '2026-08-01T00:00:00.000Z',
    terminalEventType: 'testrun_done',
    commandFamily: 'ExecutionTestrun',
  },
  graph: createPromiseGraph({
    promises: [
      record('The cart subtotal updates immediately.', 3, 'tests/cart_subtotal_test.md', 'T-3'),
      record('Orders persist across a reload.', 4, 'tests/orders_persist_test.md', 'T-5'),
    ],
  }),
});

function files(): StateFileSystem & { readonly files: Map<string, string> } {
  return inMemorySourceCacheFileSystem({ [STATE_PATH]: serialiseState(PRIOR) });
}

/** `covers:` globs, one document per designed test. */
function testDocuments(): TestDocumentSource {
  const covers: Readonly<Record<string, string>> = {
    'tests/cart_subtotal_test.md': 'apps/fixture/lib/cart.ts',
    'tests/orders_persist_test.md': 'apps/fixture/lib/orders.ts',
  };
  return {
    readFile: (path: string): string | null => {
      const glob = covers[path];
      return glob === undefined
        ? null
        : ['---', `covers: [${glob}]`, '---', '', '# a designed test', ''].join('\n');
    },
  };
}

// ---------------------------------------------------------------------------
// kept build (§13.1, R3.4)
// ---------------------------------------------------------------------------

describe('kept build → cover gaps --json --mode agent', () => {
  it('issues exactly that argv, with the Assurance enabler appended by the invoker', async () => {
    const kane = recorder();
    const exitCode = await main(['build'], {
      write: () => undefined,
      writeError: () => undefined,
      cwd: REPO,
      env: {},
      fileSystem: files(),
      now: () => new Date(AT),
      invoker: kane.invoker,
    });

    expect(exitCode).toBe(EXIT_OK);
    // `gaps`, not the singular `cover` (§5.3.0, R9.9): `cover` reads its depth axis
    // out of a sealed Evidence_Pack and refuses on a replay pack, which is every
    // pack this repository seals, so it can never deliver the axes here.
    expect(spawnsOf(kane.spawns, 'cover')).toEqual([
      ['cover', 'gaps', '--json', '--mode', 'agent'],
    ]);
    // `--agent` is `ExecutionRun`'s enabler. On this family it is simply wrong.
    for (const argv of kane.spawns) expect(argv).not.toContain('--agent');
  });
});

// ---------------------------------------------------------------------------
// The plan refresh, and both verify scopes (§7.2, §7.4, R3.5, R4.2)
// ---------------------------------------------------------------------------

describe('the plan refresh → testrun run --dry-run, with no --agent', () => {
  it('refreshes through --dry-run before the replay and carries no enabler', async () => {
    const kane = recorder();
    // No cached plan, so the identifiers must be obtained first (§7.2, R4.4).
    await runVerify({
      repoRoot: REPO,
      config: FIXTURE_CONFIG,
      changed: ['apps/fixture/lib/cart.ts'],
      fileSystem: files(),
      planFileSystem: inMemoryPlanFileSystem({}),
      testDocuments: testDocuments(),
      diagnostics: createDiagnosticSink(),
      at: AT,
      now: () => Date.parse(AT),
      invoker: kane.invoker,
    });

    const testruns = spawnsOf(kane.spawns, 'testrun');
    expect(testruns[0]).toEqual(['testrun', 'run', '--dry-run']);
    // This family gets its NDJSON from the pipe, so nothing is appended — to the
    // refresh or to the replay.
    for (const argv of testruns) expect(argv).not.toContain('--agent');
    for (const argv of testruns) expect(argv).not.toContain('--mode');
  });
});

/**
 * The corrected row (15.6). §13.1 and R4.2 specify
 * `testrun run --from-context <ids> --on-failure continue`, and that argv exits 2
 * against the installed 0.8.4: `--from-context` resolves ids against the assurance
 * graph, and the plan's own `test_id` is a testcase UUID that does not live there.
 * The correction is the one `--all` already made — the argv names the plan's member
 * **paths**, while the radius is still computed from plan identifiers — and it is
 * recorded verbatim in `docs/kane/command-surface.md` with the observed error text.
 */
describe('kept verify --changed → testrun run <plan members> --on-failure continue', () => {
  it('names exactly the blast radius, by path, and nothing else', async () => {
    const kane = recorder();
    const result = await runVerify({
      repoRoot: REPO,
      config: FIXTURE_CONFIG,
      changed: ['apps/fixture/lib/cart.ts'],
      fileSystem: files(),
      planFileSystem: inMemoryPlanFileSystem({
        [PLAN_FILE_RELATIVE_PATH]: {
          text: `${JSON.stringify({
            valid: true,
            capturedAt: AT,
            members: [
              { path: 'tests/cart_subtotal_test.md', testId: 'T-3', tags: [], failure: null },
              { path: 'tests/orders_persist_test.md', testId: 'T-5', tags: [], failure: null },
            ],
          })}\n`,
          mtimeMs: Date.parse(AT),
        },
      }),
      testDocuments: testDocuments(),
      diagnostics: createDiagnosticSink(),
      at: AT,
      now: () => Date.parse(AT),
      invoker: kane.invoker,
    });

    // The radius is identifiers, and they come from `testrun_plan.members[].test_id`
    // and from nothing else (R4.4). Only the *argv* changed.
    expect(result.radius.testIds).toEqual(['T-3']);
    expect(spawnsOf(kane.spawns, 'testrun')).toEqual([
      ['testrun', 'run', 'tests/cart_subtotal_test.md', '--on-failure', 'continue', '--bug-detection', 'continue'],
    ]);
    for (const argv of kane.spawns) expect(argv).not.toContain('--agent');
    // The flag the requirement specifies and the CLI rejects, absent from both
    // scopes now rather than from one.
    for (const argv of kane.spawns) expect(argv).not.toContain('--from-context');
    // One member covered the save, so one path is named. `orders_persist` is in the
    // same plan and stays out of it: the radius was not widened to the suite.
    expect(spawnsOf(kane.spawns, 'testrun')[0]).not.toContain('tests/orders_persist_test.md');
  });
});

describe('kept verify --all → testrun run <plan members> --on-failure continue', () => {
  it('names the plan’s member paths, and no identifiers', async () => {
    const kane = recorder();
    await runVerify({
      repoRoot: REPO,
      config: FIXTURE_CONFIG,
      all: true,
      fileSystem: files(),
      planFileSystem: inMemoryPlanFileSystem({
        [PLAN_FILE_RELATIVE_PATH]: {
          text: `${JSON.stringify({
            valid: true,
            capturedAt: AT,
            members: [
              { path: 'tests/cart_subtotal_test.md', testId: 'T-3', tags: [], failure: null },
            ],
          })}\n`,
          mtimeMs: Date.parse(AT),
        },
      }),
      testDocuments: testDocuments(),
      diagnostics: createDiagnosticSink(),
      at: AT,
      now: () => Date.parse(AT),
      invoker: kane.invoker,
    });

    // An unscoped `testrun run` selects every `*_test.md` in the project, which
    // includes documents no recording exists for — and replaying one of those
    // authors it live and spends credits (15.3). So the whole-suite replay names
    // the members the plan gave an identifier, by path: `--from-context` cannot
    // carry them, because it resolves against the assurance graph and rejects the
    // plan's own `test_id`.
    expect(spawnsOf(kane.spawns, 'testrun')).toEqual([
      ['testrun', 'run', 'tests/cart_subtotal_test.md', '--on-failure', 'continue', '--bug-detection', 'continue'],
    ]);
    for (const argv of kane.spawns) expect(argv).not.toContain('--from-context');
  });
});

// ---------------------------------------------------------------------------
// kept reconcile --changed — the row this whole suite exists for (§13.2)
// ---------------------------------------------------------------------------

/** Run the docs command against the recorder, with every seam injected. */
async function reconcile(options: {
  readonly changed: readonly string[];
  readonly listing?: readonly string[];
  readonly probe?: (absPath: string) => boolean;
}): Promise<{
  readonly result: Awaited<ReturnType<typeof runReconcile>>;
  readonly spawns: readonly string[][];
}> {
  const kane = recorder(options.listing === undefined ? {} : { listing: options.listing });
  const result = await runReconcile({
    repoRoot: REPO,
    config: FIXTURE_CONFIG,
    changed: options.changed,
    fileSystem: files(),
    baselineFileSystem: inMemoryBaselineFileSystem({}),
    citations: inMemoryCitationSource({}),
    diagnostics: createDiagnosticSink(),
    at: AT,
    now: () => Date.parse(AT),
    invoker: kane.invoker,
    ...(options.probe === undefined ? {} : { probe: options.probe }),
  });
  return { result, spawns: kane.spawns };
}

describe('kept reconcile --changed → maintain reconcile --from … --source-id … --plan --mode agent', () => {
  it('carries both mandatory flags and --plan, and never --apply', async () => {
    const run = await reconcile({ changed: [README] });
    const spawned = spawnsOf(run.spawns, 'maintain');

    expect(spawned).toHaveLength(1);
    const argv = spawned[0] as readonly string[];
    expect(argv).toEqual([
      'maintain',
      'reconcile',
      '--from',
      README,
      '--source-id',
      'src_7f31c0a4',
      '--plan',
      '--mode',
      'agent',
    ]);

    // Stated again as the four independent facts §13.2 asks for, so a future argv
    // that happens to differ still fails on the clause it broke.
    expect(argv).toContain('--from');
    expect(argv).toContain('--source-id');
    expect(argv).toContain('--plan');
    expect(argv).not.toContain('--apply');
    // `--from` and `--source-id` each carry a value, and neither is a flag.
    expect(argv[argv.indexOf('--from') + 1]).toBe(README);
    expect(argv[argv.indexOf('--source-id') + 1]).toBe('src_7f31c0a4');
    // The enabler is the Assurance one, appended by the invoker (§4.7).
    expect(argv.slice(-2)).toEqual(['--mode', 'agent']);
    expect(argv).not.toContain('--agent');
  });

  it('never emits --plan and --apply together, on any spawn of any run', async () => {
    const run = await reconcile({ changed: [README] });
    for (const argv of run.spawns) {
      expect(argv.includes('--plan') && argv.includes('--apply')).toBe(false);
    }
  });

  it('issues one invocation per changed doc, each with its own resolved id', async () => {
    const pricing = 'apps/fixture/docs/pricing.md';
    const run = await reconcile({
      changed: [README, pricing],
      listing: listingFor([
        ['src_readme01', README],
        ['src_pricing1', pricing],
      ]),
      // Ladder check 3 is a real `fs.stat`, so the probe stands in for a working
      // tree that has both documents. Everything else is the production path.
      probe: () => true,
    });

    const spawned = spawnsOf(run.spawns, 'maintain');
    expect(spawned).toHaveLength(2);
    expect(spawned.map((argv) => argv[argv.indexOf('--from') + 1])).toEqual([README, pricing]);
    expect(spawned.map((argv) => argv[argv.indexOf('--source-id') + 1])).toEqual([
      'src_readme01',
      'src_pricing1',
    ]);
    // Each document gets its own id, never the first one reused.
    expect(new Set(spawned.map((argv) => argv[argv.indexOf('--source-id') + 1])).size).toBe(2);
    expect(run.result.invocations).toBe(2);
  });

  it('spawns nothing at all when the source id is unresolved', async () => {
    const run = await reconcile({ changed: [README], listing: EMPTY_STORE });

    // The assertion the whole correction of §13.2 reduces to: not a bad argv, no
    // argv — and therefore no process.
    expect(spawnsOf(run.spawns, 'maintain')).toEqual([]);
    expect(run.result.invocations).toBe(0);
    expect(run.result.docs[0]?.argv).toEqual([]);
    // The only thing that ran is the listing that answered "nothing matches".
    expect(run.spawns.map((argv) => argv[0])).toEqual(['context']);
  });

  it('asks the store for its listing with the argv §13.2.2 fixes', async () => {
    const run = await reconcile({ changed: [README] });
    // No enabler: `context list` belongs to no family and has no `--mode` flag,
    // so the declared argv is the effective argv. Appending `--mode agent` was
    // observed to exit 1 with an empty stdout, so no save could ever match.
    expect(spawnsOf(run.spawns, 'context')).toEqual([
      ['context', 'list', '--type', 'source', '--json'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// kept evolve — promoted from the pending table by task 14.2 (§13.1, R7.2)
// ---------------------------------------------------------------------------

describe('kept evolve → maintain evolve <ref> --mode agent', () => {
  it('is implemented, and issues exactly that argv when Kane accepts the flag', async () => {
    clearEvolveHelpProbeCache();
    expect(IMPLEMENTED_COMMANDS).toContain('evolve');

    const kane = recorder();
    const exitCode = await main(['evolve', EVOLVE_REF], {
      write: () => undefined,
      writeError: () => undefined,
      cwd: REPO,
      env: {},
      fileSystem: files(),
      now: () => new Date(AT),
      invoker: kane.invoker,
      evolveHelpProbe: SUPPORTS_MODE,
    });

    expect(exitCode).toBe(EXIT_OK);
    const spawned = spawnsOf(kane.spawns, 'maintain');
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toEqual(['maintain', 'evolve', EVOLVE_REF, '--mode', 'agent']);

    // Stated again as independent facts, so a future argv that happens to differ
    // still fails on the clause it broke.
    expect(spawned[0]?.[1]).toBe('evolve');
    expect((spawned[0] ?? []).slice(-2)).toEqual(['--mode', 'agent']);
    // `--agent` is `ExecutionRun`'s enabler. On this family it is simply wrong.
    expect(spawned[0]).not.toContain('--agent');
    // The probe is not a Kane *invocation*: it never reaches the invoker seam, so
    // it can carry no enabler — which is the whole reason it is its own seam.
    expect(kane.spawns.some((argv) => argv.includes('--help'))).toBe(false);
  });

  it('composes the ref verbatim, in the position §13.1 gives it', async () => {
    clearEvolveHelpProbeCache();
    const kane = recorder();
    // A use-case reference rather than a path: Kane's `[ref]` accepts a test, a
    // scenario, an AC or a use-case, and KEPT narrows none of them.
    await main(['evolve', 'UC-4'], {
      write: () => undefined,
      writeError: () => undefined,
      cwd: REPO,
      env: {},
      fileSystem: files(),
      now: () => new Date(AT),
      invoker: kane.invoker,
      evolveHelpProbe: SUPPORTS_MODE,
    });
    expect(spawnsOf(kane.spawns, 'maintain')).toEqual([
      ['maintain', 'evolve', 'UC-4', '--mode', 'agent'],
    ]);
  });

  it('spawns nothing at all when the option table carries no --mode', async () => {
    clearEvolveHelpProbeCache();
    const kane = recorder();
    const exitCode = await main(['evolve', EVOLVE_REF], {
      write: () => undefined,
      writeError: () => undefined,
      cwd: REPO,
      env: {},
      fileSystem: files(),
      now: () => new Date(AT),
      invoker: kane.invoker,
      // The option table the installed 0.8.4 actually prints — see evolve.test.ts.
      evolveHelpProbe: async () =>
        parseEvolveHelp(
          [
            'Usage: kane-cli maintain evolve [options] [ref]',
            'Options:',
            '  --from-stale        Evolve every use-case with stale designed entities',
            '  --because <reason>  Re-design a FRESH target anyway',
            '  -h, --help          display help for command',
          ].join('\n'),
          0,
        ),
    });

    // The assertion the degradation reduces to: not a bad argv, no argv — and
    // therefore no process and no credits.
    expect(exitCode).toBe(EXIT_OK);
    expect(kane.spawns).toEqual([]);
  });
});

describe('kept doctor → --version (task 24.3)', () => {
  /**
   * Promoted from the pending guard when task 24.3 landed, which is exactly what the
   * guard existed to force. The pinned literal is gone: the argv is now asserted at
   * the process boundary, which is strictly stronger than a constant agreeing with
   * itself.
   */
  it('issues --version and nothing else, on no family and therefore no enabler', async () => {
    expect(IMPLEMENTED_COMMANDS).toContain('doctor');

    const kane = recorder();
    const exitCode = await main(['doctor'], {
      write: () => undefined,
      writeError: () => undefined,
      cwd: REPO,
      env: {},
      fileSystem: files(),
      now: () => new Date(AT),
      invoker: kane.invoker,
    });

    expect(exitCode).toBe(EXIT_OK);
    // One spawn, and the whole argv. `--version` belongs to no family, so the
    // invoker appends nothing: no `--mode agent`, no `--agent`, no piped-stdout
    // enabler to speak of (§13.1, R18.2).
    expect(kane.spawns).toEqual([['--version']]);
    for (const spawn of kane.spawns) {
      expect(spawn).not.toContain('--mode');
      expect(spawn).not.toContain('agent');
    }
  });

  it('exits 0 with no Kane boundary at all, having spawned nothing (R18.8, R2.12)', async () => {
    const kane = recorder();
    const exitCode = await main(['doctor'], {
      write: () => undefined,
      writeError: () => undefined,
      cwd: REPO,
      env: {},
      fileSystem: files(),
      now: () => new Date(AT),
      kane: false,
    });

    expect(exitCode).toBe(EXIT_OK);
    expect(kane.spawns).toEqual([]);
  });
});
