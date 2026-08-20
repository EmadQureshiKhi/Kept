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
import { IMPLEMENTED_COMMANDS, main } from '../src/main.js';
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
 * Four commands exist today and are asserted directly: `kept build`, the plan
 * refresh, `kept verify` in both scopes, and `kept reconcile --changed`. Two do
 * not exist yet — `kept evolve` is task 14.2 and `kept doctor` is task 21.2 — and
 * for those a skipped test that quietly passes would be worse than no test, since
 * the row it is meant to protect would land unprotected.
 *
 * So each pending row is guarded two ways. {@link PENDING_ARGV} pins the argv
 * §13.1 requires, and a **live** assertion states that the command is not
 * implemented and spawns nothing at all. The moment either one lands, that
 * assertion fails loudly and its author is sent here to replace it with the real
 * process-boundary check beside the pinned argv. The `it.skip` body carries the
 * assertion to promote, so promoting it is a deletion and a rename.
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
const LISTING = fixtureLines('context-list-sources.ndjson');

/** A reconcile that completed, in the Assurance envelope's shape. */
const RECONCILE_DONE = [
  '{"type":"done","v":1,"verb":"reconcile","status":"complete","exit_code":0,' +
    '"message":"staged into the stored plan"}',
];

/** An empty store: nothing backs the document, so nothing may be spawned. */
const EMPTY_STORE = [
  '{"type":"sources","v":1,"verb":"context list","total":0,"sources":[]}',
  '{"type":"done","v":1,"verb":"context list","status":"complete","exit_code":0}',
];

/** A listing carrying one live source per named document. */
function listingFor(entries: readonly (readonly [string, string])[]): readonly string[] {
  const sources = entries
    .map(([id, path]) => JSON.stringify({ source_id: id, path, retired: false }))
    .join(',');
  return [
    `{"type":"sources","v":1,"verb":"context list","total":${entries.length},"sources":[${sources}]}`,
    '{"type":"done","v":1,"verb":"context list","status":"complete","exit_code":0}',
  ];
}

// ---------------------------------------------------------------------------
// The argv every §13.1 row must produce, pinned in one table
// ---------------------------------------------------------------------------

/**
 * The argv of the two commands §13.1 specifies and this build does not have.
 *
 * `<ref>` and the plan path are placeholders: what is pinned is the **shape** —
 * the verb, the flag order, and the `--mode agent` enabler the invoker appends for
 * the Assurance family (§4.7). `kept doctor` is the one row with no family at all,
 * so it takes no enabler; `--version` is the whole argv.
 */
const PENDING_ARGV = Object.freeze({
  /** Task 14.2. Assurance, so the invoker appends `--mode agent`. */
  evolve: Object.freeze(['maintain', 'evolve', '<ref>', '--mode', 'agent']),
  /** Task 21.2. No family, no enabler, a 10 s budget (§13.1). */
  doctor: Object.freeze(['--version']),
});

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

describe('kept build → cover --json --mode agent', () => {
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
    expect(spawnsOf(kane.spawns, 'cover')).toEqual([['cover', '--json', '--mode', 'agent']]);
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
      config: DEFAULT_CONFIG,
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

describe('kept verify --changed → testrun run --from-context <ids> --on-failure continue', () => {
  it('names exactly the blast radius, and nothing else', async () => {
    const kane = recorder();
    const result = await runVerify({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
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

    expect(result.radius.testIds).toEqual(['T-3']);
    expect(spawnsOf(kane.spawns, 'testrun')).toEqual([
      ['testrun', 'run', '--from-context', 'T-3', '--on-failure', 'continue'],
    ]);
    for (const argv of kane.spawns) expect(argv).not.toContain('--agent');
  });
});

describe('kept verify --all → testrun run --on-failure continue', () => {
  it('names no identifiers at all', async () => {
    const kane = recorder();
    await runVerify({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
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

    expect(spawnsOf(kane.spawns, 'testrun')).toEqual([
      ['testrun', 'run', '--on-failure', 'continue'],
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
    config: DEFAULT_CONFIG,
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
    expect(spawnsOf(run.spawns, 'context')).toEqual([
      ['context', 'list', '--type', 'source', '--json', '--mode', 'agent'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// The two rows that do not exist yet (tasks 14.2 and 21.2)
// ---------------------------------------------------------------------------

describe('kept evolve → maintain evolve <ref> --mode agent (task 14.2, pending)', () => {
  it('is not implemented yet, and spawns nothing — this fails the moment it lands', async () => {
    // Two live guards, and both are meant to break. When 14.2 wires the command,
    // `IMPLEMENTED_COMMANDS` grows and the recorded spawn appears, so whoever
    // lands it is sent here to promote the skipped assertion below.
    expect(IMPLEMENTED_COMMANDS).not.toContain('evolve');

    const kane = recorder();
    const exitCode = await main(['evolve', 'tests/cart_subtotal_test.md'], {
      write: () => undefined,
      writeError: () => undefined,
      cwd: REPO,
      env: {},
      fileSystem: files(),
      now: () => new Date(AT),
      invoker: kane.invoker,
    });

    expect(exitCode).toBe(EXIT_OK);
    expect(kane.spawns).toEqual([]);
  });

  it('pins the argv §13.1 requires, so the shape cannot drift while unimplemented', () => {
    expect([...PENDING_ARGV.evolve]).toEqual(['maintain', 'evolve', '<ref>', '--mode', 'agent']);
  });

  it.skip('promote when 14.2 lands: issues maintain evolve <ref> --mode agent', async () => {
    const kane = recorder();
    await main(['evolve', 'tests/cart_subtotal_test.md'], {
      write: () => undefined,
      writeError: () => undefined,
      cwd: REPO,
      env: {},
      fileSystem: files(),
      now: () => new Date(AT),
      invoker: kane.invoker,
    });
    const spawned = spawnsOf(kane.spawns, 'maintain');
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.[1]).toBe('evolve');
    expect((spawned[0] ?? []).slice(-2)).toEqual(['--mode', 'agent']);
    expect(spawned[0]).not.toContain('--agent');
  });
});

describe('kept doctor → --version (task 21.2, pending)', () => {
  it('is not implemented yet, and spawns nothing — this fails the moment it lands', async () => {
    expect(IMPLEMENTED_COMMANDS).not.toContain('doctor');

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
    expect(kane.spawns).toEqual([]);
  });

  it('pins the argv §13.1 requires: no family, so no enabler', () => {
    expect([...PENDING_ARGV.doctor]).toEqual(['--version']);
    expect(PENDING_ARGV.doctor).not.toContain('--mode');
    expect(PENDING_ARGV.doctor).not.toContain('--agent');
  });

  it.skip('promote when 21.2 lands: issues --version and nothing else', async () => {
    const kane = recorder();
    await main(['doctor'], {
      write: () => undefined,
      writeError: () => undefined,
      cwd: REPO,
      env: {},
      fileSystem: files(),
      now: () => new Date(AT),
      invoker: kane.invoker,
    });
    expect(kane.spawns).toEqual([['--version']]);
  });
});
