import { readFileSync } from 'node:fs';

import type {
  ChildProcessLike,
  CollectingDiagnosticSink,
  EvidenceDirEntry,
  EvidenceFileSystem,
  EvidenceStat,
  FailureYamlFileSystem,
  KeptState,
  PlanFileSystem,
  PromiseRecord,
  StateFileSystem,
  TestDocumentSource,
} from '@kept/core';
import {
  HANDOFF_FILE_RELATIVE_PATH,
  KaneInvoker,
  MEMBER_STATUS_DIAGNOSTIC_CODES,
  PLAN_FILE_RELATIVE_PATH,
  RADIUS_DIAGNOSTIC_CODES,
  STATE_FILE_RELATIVE_PATH,
  createDiagnosticSink,
  createKeptState,
  createPromiseGraph,
  createPromiseRecord,
  inMemoryPlanFileSystem,
  inMemoryStateFileSystem,
  serialiseState,
} from '@kept/core';
import { describe, expect, it } from 'vitest';

import { EXIT_OK } from '../src/args.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { main } from '../src/main.js';
import {
  VERIFY_DIAGNOSTIC_CODES,
  fromContextValue,
  planMemberPaths,
  runVerify,
  verifyArgv,
} from '../src/commands/verify.js';

/**
 * `kept verify --changed` / `--all` (design §7.4, §13.1, §14.1, R4.1–R4.15).
 *
 * Every test here runs with no disk and **no Kane process**: the state file, the
 * plan cache, the `covers:` reads, the evidence walk, the `failure.yaml` read and
 * the child process are all injected, and the NDJSON comes from the committed
 * fixtures of task 2.10 rather than from a hand-rolled literal — so what is being
 * asserted is the composition against streams the repository already trusts.
 *
 * Two things are worth over-testing, and they are the two the design calls out.
 * The argv, because `testrun run` takes **no** `--agent` and a stray one means
 * nothing runs at all. And the write guard, because a stream that never reached
 * `testrun_done` must write no verdict *whatsoever* — not the members it happened
 * to see before it stopped.
 */
const REPO = '/repo';
const AT = '2026-08-20T18:41:02.118Z';
const STATE_PATH = `${REPO}/${STATE_FILE_RELATIVE_PATH}`;
const HANDOFF_PATH = `${REPO}/${HANDOFF_FILE_RELATIVE_PATH}`;
const FIXTURES = new URL('../../kept-core/test/fixtures/', import.meta.url);

function fixtureLines(name: string): readonly string[] {
  return readFileSync(new URL(name, FIXTURES), 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0);
}

const MIXED = fixtureLines('testrun-mixed.ndjson');
const PREFLIGHT_INVALID = fixtureLines('testrun-preflight-invalid.ndjson');
const CRASHED = fixtureLines('testrun-crashed.ndjson');

// ---------------------------------------------------------------------------
// The repository under test: five promises, five designed tests
// ---------------------------------------------------------------------------

const DOC = 'apps/fixture/README.md';

interface Seed {
  readonly claim: string;
  readonly line: number;
  readonly test: string;
  readonly testId: string;
  readonly verdict: 'proven' | 'red' | 'stale';
}

/** T-6 is deliberately last: nothing in the `--changed` radius ever selects it. */
const SEEDS: readonly Seed[] = [
  {
    claim: 'The Shop screen lists exactly six coffees.',
    line: 4,
    test: 'tests/shop_filter_test.md',
    testId: 'T-1',
    verdict: 'red',
  },
  {
    claim: 'The Cart screen shows a running subtotal that updates immediately.',
    line: 5,
    test: 'tests/cart_subtotal_test.md',
    testId: 'T-3',
    verdict: 'proven',
  },
  {
    claim: 'Checkout refuses an order with an empty delivery address.',
    line: 6,
    test: 'tests/checkout_validation_test.md',
    testId: 'T-4',
    verdict: 'proven',
  },
  {
    claim: 'Orders persist across a page reload.',
    line: 7,
    test: 'tests/orders_persist_test.md',
    testId: 'T-5',
    verdict: 'proven',
  },
  {
    claim: 'The Settings screen changes the currency everywhere.',
    line: 8,
    test: 'tests/settings_currency_test.md',
    testId: 'T-6',
    verdict: 'proven',
  },
];

function recordFor(seed: Seed): PromiseRecord {
  return createPromiseRecord({
    claim: seed.claim,
    citation: { file: DOC, line: seed.line, text: seed.claim },
    designedTest: { path: seed.test, testId: seed.testId },
    verdict: seed.verdict,
    verdictSource: {
      runId: 'run_prior',
      terminalEventType: 'testrun_done',
      at: '2026-08-01T00:00:00.000Z',
      memberStatus: seed.verdict === 'proven' ? 'passed' : 'failed',
      resultCode: null,
      reasonCode: null,
    },
    providers: ['baseline'],
  });
}

function priorState(): KeptState {
  return createKeptState({
    updatedAt: '2026-08-01T00:00:00.000Z',
    freshness: {
      terminalEventAt: '2026-08-01T00:00:00.000Z',
      terminalEventType: 'testrun_done',
      commandFamily: 'ExecutionTestrun',
    },
    graph: createPromiseGraph({ promises: SEEDS.map(recordFor) }),
  });
}

function promiseIdFor(testId: string, state: KeptState): string {
  const found = state.graph.promises.find(
    (promise) => promise.designedTest?.testId === testId,
  );
  expect(found, `a promise designed by ${testId}`).toBeDefined();
  return (found as PromiseRecord).id;
}

// ---------------------------------------------------------------------------
// Seams
// ---------------------------------------------------------------------------

/** A cached plan carrying Kane's own ids for all five documents. */
function planJson(): string {
  return `${JSON.stringify(
    {
      valid: true,
      capturedAt: AT,
      members: SEEDS.map((seed) => ({
        path: seed.test,
        testId: seed.testId,
        tags: [],
        failure: null,
      })),
    },
    null,
    2,
  )}\n`;
}

function planFileSystem(seed: Readonly<Record<string, string>> = {}): PlanFileSystem {
  return inMemoryPlanFileSystem({
    [PLAN_FILE_RELATIVE_PATH]: { text: planJson(), mtimeMs: Date.parse(AT) },
    ...Object.fromEntries(
      Object.entries(seed).map(([path, text]) => [path, { text, mtimeMs: 0 }]),
    ),
  });
}

/** `covers:` globs, one document per designed test. Only T-3 covers `lib/cart.ts`. */
const COVERS: Readonly<Record<string, readonly string[]>> = {
  'tests/shop_filter_test.md': ['apps/fixture/app/shop/**'],
  'tests/cart_subtotal_test.md': ['apps/fixture/lib/cart.ts', 'apps/fixture/app/cart/**'],
  'tests/checkout_validation_test.md': ['apps/fixture/app/checkout/**'],
  'tests/orders_persist_test.md': ['apps/fixture/lib/orders.ts'],
  'tests/settings_currency_test.md': ['apps/fixture/app/settings/**'],
};

function testDocuments(): TestDocumentSource {
  const files = new Map<string, string>();
  for (const [path, covers] of Object.entries(COVERS)) {
    files.set(
      path,
      ['---', `covers: [${covers.join(', ')}]`, '---', '', '# a designed test', ''].join('\n'),
    );
  }
  return { readFile: (path: string): string | null => files.get(path) ?? null };
}

/** One sealed pack under `<cwd>/.testmuai/evidence`, the family-derived location. */
const PACK_ID = 'ev_20260820T184011Z';
const EVIDENCE_DIR = `${REPO}/.testmuai/evidence`;
const PACK_DIR = `${EVIDENCE_DIR}/${PACK_ID}`;

function evidenceFileSystem(): EvidenceFileSystem {
  const files = new Set([`${PACK_DIR}/failure.yaml`, `${PACK_DIR}/annotated.png`]);
  return {
    readDirectory(dir: string): readonly EvidenceDirEntry[] {
      if (dir === EVIDENCE_DIR) {
        return [{ name: PACK_ID, isDirectory: true, isFile: false }];
      }
      if (dir === PACK_DIR) {
        return [
          { name: 'annotated.png', isDirectory: false, isFile: true },
          { name: 'failure.yaml', isDirectory: false, isFile: true },
        ];
      }
      throw new Error(`ENOENT: ${dir}`);
    },
    stat(path: string): EvidenceStat | null {
      if (path === PACK_DIR) return { mtimeMs: Date.parse(AT), bytes: null, isDirectory: true };
      if (files.has(path)) return { mtimeMs: Date.parse(AT), bytes: 128, isDirectory: false };
      return null;
    },
  };
}

/** The pack's triage note, for the rung that reads one. */
function yamlFileSystem(): FailureYamlFileSystem {
  return {
    readFile: (path: string): string | null =>
      path === `${PACK_DIR}/failure.yaml`
        ? ['triage:', '  category: product_bug', 'summary: the subtotal ignored quantity', ''].join(
            '\n',
          )
        : null,
  };
}

// ---------------------------------------------------------------------------
// A fake Kane child process, keyed on argv so one invoker serves both calls
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

interface Fake {
  readonly invoker: KaneInvoker;
  /** Every argv the invoker actually spawned, enabler included. */
  readonly argv: string[][];
  readonly env: Record<string, string | undefined>[];
}

/** Replays `lines`/`exitCode` for the replay, and `plan` for a `--dry-run`. */
function fakeInvoker(
  lines: readonly string[],
  exitCode: number | null,
  planLines: readonly string[] = [],
): Fake {
  const argv: string[][] = [];
  const env: Record<string, string | undefined>[] = [];
  const invoker = new KaneInvoker({
    resolveBinary: () => '/stub/bin/kane-cli',
    spawn: (_command, args, options) => {
      argv.push([...args]);
      env.push({ ...options.env });
      const dryRun = args.includes('--dry-run');
      const child = new FakeChild();
      queueMicrotask(() => {
        for (const line of dryRun ? planLines : lines) child.stdout.emit(`${line}\n`);
        child.close(dryRun ? 0 : exitCode);
      });
      return child.asChild();
    },
  });
  return { invoker, argv, env };
}

interface Harness {
  readonly fileSystem: StateFileSystem;
  readonly sink: CollectingDiagnosticSink;
}

function harness(): Harness {
  return {
    fileSystem: inMemoryStateFileSystem({ [STATE_PATH]: serialiseState(priorState()) }),
    sink: createDiagnosticSink(),
  };
}

interface RunOptions {
  readonly all?: boolean;
  readonly changed?: readonly string[];
  readonly lines?: readonly string[];
  readonly exitCode?: number | null;
  readonly planLines?: readonly string[];
  readonly plan?: PlanFileSystem;
  readonly withKane?: boolean;
}

async function run(
  io: Harness,
  options: RunOptions = {},
): Promise<{
  readonly result: Awaited<ReturnType<typeof runVerify>>;
  readonly fake: Fake;
}> {
  const fake = fakeInvoker(options.lines ?? MIXED, options.exitCode ?? 1, options.planLines);
  const result = await runVerify({
    repoRoot: REPO,
    config: DEFAULT_CONFIG,
    ...(options.all === undefined ? {} : { all: options.all }),
    changed: options.changed ?? [],
    fileSystem: io.fileSystem,
    planFileSystem: options.plan ?? planFileSystem(),
    testDocuments: testDocuments(),
    evidenceFileSystem: evidenceFileSystem(),
    yaml: yamlFileSystem(),
    diagnostics: io.sink,
    at: AT,
    now: () => Date.parse(AT),
    ...(options.withKane === false ? {} : { invoker: fake.invoker }),
  });
  return { result, fake };
}

// ---------------------------------------------------------------------------

describe('the argv of a replay (§7.4, §13.1, R3.5)', () => {
  it('names exactly the radius on --changed, by path, and carries no --agent', async () => {
    const io = harness();
    const { result, fake } = await run(io, { changed: ['apps/fixture/lib/cart.ts'] });

    // The radius is still identifiers, and they still come from the plan (R4.4).
    expect(result.radius.testIds).toEqual(['T-3']);
    // The argv names the path of the member carrying that identifier, because
    // `--from-context` resolves against the assurance graph and rejects a plan
    // `test_id` outright — see `verifyArgv`'s header for the measured error.
    expect(fake.argv).toEqual([
      ['testrun', 'run', 'tests/cart_subtotal_test.md', '--on-failure', 'continue'],
    ]);
    // The enabler for this family is the pipe itself. Nothing is appended, and an
    // `--agent` anywhere would mean nothing ran at all.
    expect(result.argv).toEqual([
      'testrun',
      'run',
      'tests/cart_subtotal_test.md',
      '--on-failure',
      'continue',
    ]);
    for (const args of fake.argv) expect(args).not.toContain('--agent');
    for (const args of fake.argv) expect(args).not.toContain('--from-context');
    // One member selected, one path named: the radius is not widened to the suite.
    expect(fake.argv[0]?.filter((word) => word.endsWith('_test.md'))).toHaveLength(1);
  });

  it('names the plan’s own member paths on --all', async () => {
    const io = harness();
    const { result, fake } = await run(io, { all: true });

    expect(result.scope).toBe('all');
    expect(result.radius.testIds).toEqual(['T-1', 'T-3', 'T-4', 'T-5', 'T-6']);
    // Naming them is what keeps a whole-suite replay free: a member the plan gave
    // no id has no recording, so an unscoped selection authors it live (15.3). The
    // paths come from `testrun_plan.members[]`, never from a directory walk.
    const expected = [
      'testrun',
      'run',
      'tests/cart_subtotal_test.md',
      'tests/checkout_validation_test.md',
      'tests/orders_persist_test.md',
      'tests/settings_currency_test.md',
      'tests/shop_filter_test.md',
      '--on-failure',
      'continue',
    ];
    expect(fake.argv).toEqual([expected]);
    expect(result.argv).toEqual(expected);
    for (const args of fake.argv) expect(args).not.toContain('--agent');
  });

  it('dedupes and sorts the member paths, and never emits the specified flag', () => {
    // `fromContextValue` is the spelling R4.2 specifies and 0.8.4 cannot accept. It
    // is kept, and kept correct, so the requirement and the correction are both
    // readable — but no argv this function composes carries it.
    expect(fromContextValue(['T-5', 'T-3', 'T-5'])).toBe('T-3,T-5');
    expect(
      verifyArgv('changed', ['T-5', 'T-3'], [
        'tests/orders_persist_test.md',
        'tests/cart_subtotal_test.md',
        'tests/orders_persist_test.md',
      ]),
    ).toEqual([
      'testrun',
      'run',
      'tests/cart_subtotal_test.md',
      'tests/orders_persist_test.md',
      '--on-failure',
      'continue',
    ]);
    // An identifier no path was looked up for selects nothing, in either scope.
    expect(verifyArgv('changed', ['T-9'], [])).toEqual([
      'testrun',
      'run',
      '--on-failure',
      'continue',
    ]);
  });

  it('looks a path up only from a plan member the radius identified', () => {
    const plan = {
      valid: true,
      capturedAt: AT,
      members: [
        { path: 'tests/cart_subtotal_test.md', testId: 'T-3', tags: [], failure: null },
        { path: 'tests/orders_persist_test.md', testId: 'T-5', tags: [], failure: null },
        // No `test_id`: no recording, so naming it would author it live (R4.6).
        { path: '.testmuai/tests/apply-discount_test.md', testId: null, tags: [], failure: null },
      ],
    } as const;

    expect(planMemberPaths(plan, ['T-3'])).toEqual(['tests/cart_subtotal_test.md']);
    // An unidentified member is unreachable: there is no id that selects it.
    expect(planMemberPaths(plan, ['T-3', 'T-5'])).toEqual([
      'tests/cart_subtotal_test.md',
      'tests/orders_persist_test.md',
    ]);
    expect(planMemberPaths(plan, [])).toEqual([]);
    expect(planMemberPaths(null, ['T-3'])).toEqual([]);
  });

  it('refreshes the plan through --dry-run before the replay, both without --agent', async () => {
    const io = harness();
    // No cached plan, so `readPlan` must obtain the identifiers first.
    const { result, fake } = await run(io, {
      changed: ['apps/fixture/lib/cart.ts'],
      plan: inMemoryPlanFileSystem({}),
      planLines: MIXED,
    });

    expect(fake.argv[0]).toEqual(['testrun', 'run', '--dry-run']);
    expect(fake.argv[1]).toEqual([
      'testrun',
      'run',
      'tests/cart_subtotal_test.md',
      '--on-failure',
      'continue',
    ]);
    expect(result.radius.testIds).toEqual(['T-3']);
    for (const args of fake.argv) expect(args).not.toContain('--agent');
  });

  it('sets KANE_TESTRUN_MEMBER_DEBUG only when member capture is on (R4.12)', async () => {
    const io = harness();
    const { fake } = await run(io, { changed: ['apps/fixture/lib/cart.ts'] });
    expect(fake.env[0]?.['KANE_TESTRUN_MEMBER_DEBUG']).toBeUndefined();

    const debug = fakeInvoker(MIXED, 1);
    await runVerify({
      repoRoot: REPO,
      config: { ...DEFAULT_CONFIG, memberDebug: true },
      changed: ['apps/fixture/lib/cart.ts'],
      fileSystem: harness().fileSystem,
      planFileSystem: planFileSystem(),
      testDocuments: testDocuments(),
      evidenceFileSystem: evidenceFileSystem(),
      yaml: yamlFileSystem(),
      at: AT,
      now: () => Date.parse(AT),
      invoker: debug.invoker,
    });
    expect(debug.env[0]?.['KANE_TESTRUN_MEMBER_DEBUG']).toBe('1');
  });
});

describe('an empty blast radius costs nothing (R4.5)', () => {
  it('starts no process, writes no verdict, and still writes the handoff', async () => {
    const io = harness();
    const { result, fake } = await run(io, { changed: ['README.md'] });

    expect(fake.argv).toEqual([]);
    expect(result.invoked).toBe(false);
    expect(result.radius.testIds).toEqual([]);
    expect(result.radius.unmatchedPaths).toEqual(['README.md']);
    expect(io.sink.has(RADIUS_DIAGNOSTIC_CODES.pathUncovered)).toBe(true);
    expect(result.wrote).toBe(false);
    expect(result.updatedPromiseIds).toEqual([]);
    // §14.1: every existing verdict and the freshness triple are unchanged.
    expect(result.state.freshness.terminalEventAt).toBe('2026-08-01T00:00:00.000Z');
    // …and the handoff still lands, with a null branch and a reason.
    expect(io.fileSystem.readFile(HANDOFF_PATH)).not.toBeNull();
    expect(result.handoff.handoff.nextAction.branch).toBeNull();
    expect(result.handoff.handoff.diagnostics.length).toBeGreaterThan(0);
    expect(result.snapshot.valid).toBe(true);
  });
});

describe('member results become verdicts (§6.5, R4.8, R4.9)', () => {
  it('maps all four statuses and records the two lossy ones verbatim', async () => {
    const io = harness();
    const { result } = await run(io, { all: true });

    const byTestId = new Map(result.members.map((member) => [member.testId, member]));
    expect(byTestId.get('T-1')?.verdict).toBe('proven');
    expect(byTestId.get('T-3')?.verdict).toBe('red');
    expect(byTestId.get('T-4')?.verdict).toBe('red');
    expect(byTestId.get('T-5')?.verdict).toBe('stale');

    const state = result.state;
    expect(state.graph.promises.find((p) => p.designedTest?.testId === 'T-1')?.verdict).toBe(
      'proven',
    );
    expect(state.graph.promises.find((p) => p.designedTest?.testId === 'T-3')?.verdict).toBe('red');
    expect(state.graph.promises.find((p) => p.designedTest?.testId === 'T-4')?.verdict).toBe('red');
    expect(state.graph.promises.find((p) => p.designedTest?.testId === 'T-5')?.verdict).toBe(
      'stale',
    );

    // R4.9: once `broken` and `failed` are both `red`, the diagnostic is the only
    // surviving evidence of which one happened, so it quotes the status verbatim.
    const recorded = io.sink.entries.filter(
      (entry) => entry.code === MEMBER_STATUS_DIAGNOSTIC_CODES.recorded,
    );
    const messages = recorded.map((entry) => entry.message).join('\n');
    expect(messages).toContain('"broken"');
    expect(messages).toContain('"interrupted"');
    expect(messages).toContain('"failed"');
  });

  it('routes only the failed and broken members, and records the branch', async () => {
    const io = harness();
    const { result } = await run(io, { all: true });

    const byTestId = new Map(result.members.map((member) => [member.testId, member]));
    expect(byTestId.get('T-1')?.repair).toBeNull();
    // An interrupted member proved nothing, so it has no repair branch at all.
    expect(byTestId.get('T-5')?.repair).toBeNull();
    expect(byTestId.get('T-3')?.repair?.branch).toBe('code-break');
    expect(byTestId.get('T-3')?.repair?.strategy).toBe('resultCode740');
    expect(byTestId.get('T-4')?.repair).not.toBeNull();
    // The reference is a resolved artefact, made repository-relative, never composed.
    expect(byTestId.get('T-3')?.repair?.evidenceRef).toBe(
      `.testmuai/evidence/${PACK_ID}/failure.yaml`,
    );
  });

  it('resolves the pack from the family and advances the freshness triple', async () => {
    const io = harness();
    const { result } = await run(io, { all: true });

    expect(result.evidencePackId).toBe(PACK_ID);
    expect(result.terminalSeen).toBe(true);
    expect(result.exitMeaning).toBe('failure');
    expect(result.wrote).toBe(true);
    expect(result.state.freshness).toEqual({
      terminalEventAt: AT,
      terminalEventType: 'testrun_done',
      commandFamily: 'ExecutionTestrun',
    });
    // The state file, the handoff and the snapshot are all written (§13.1).
    expect(io.fileSystem.readFile(STATE_PATH)).not.toBeNull();
    expect(io.fileSystem.readFile(HANDOFF_PATH)).not.toBeNull();
    expect(result.snapshot.written).toBe(true);
  });

  it('hands the agent a code-break fence when one is what the run produced', async () => {
    const io = harness();
    const { result } = await run(io, { all: true });
    const next = result.handoff.handoff.nextAction;

    expect(next.branch).toBe('code-break');
    expect(next.allowedPaths).toEqual([
      'apps/fixture/app/**',
      'apps/fixture/components/**',
      'apps/fixture/lib/**',
    ]);
    expect(next.forbiddenPaths).toContain('apps/fixture/README.md');
    expect(next.forbiddenPaths).toContain('tests/**');
  });
});

describe('only promises in the radius move (R4.10, R4.15)', () => {
  it('leaves an out-of-radius promise exactly as it was', async () => {
    const io = harness();
    const before = priorState();
    const outsideId = promiseIdFor('T-6', before);
    const outsideBefore = before.graph.promises.find((promise) => promise.id === outsideId);

    const { result } = await run(io, { changed: ['apps/fixture/lib/cart.ts'] });

    expect(result.radius.promiseIds).toEqual([promiseIdFor('T-3', before)]);
    expect(result.updatedPromiseIds).toEqual([promiseIdFor('T-3', before)]);

    const outsideAfter = result.state.graph.promises.find(
      (promise) => promise.id === outsideId,
    );
    expect(JSON.stringify(outsideAfter)).toBe(JSON.stringify(outsideBefore));
    expect(outsideAfter?.verdict).toBe('proven');
    expect(outsideAfter?.verdictSource?.runId).toBe('run_prior');
    expect(outsideAfter?.verdictSource?.at).toBe('2026-08-01T00:00:00.000Z');
  });
});

describe('a preflight rejection executes nothing (R4.11, §14.1)', () => {
  it('records every member reason and leaves all verdicts unchanged', async () => {
    const io = harness();
    const { result } = await run(io, {
      all: true,
      lines: PREFLIGHT_INVALID,
      exitCode: 2,
    });

    expect(result.preflightRejected).toBe(true);
    expect(result.exitMeaning).toBe('preflight-rejected');
    expect(result.wrote).toBe(false);
    expect(result.updatedPromiseIds).toEqual([]);

    const reasons = io.sink.entries
      .filter((entry) => entry.code === VERIFY_DIAGNOSTIC_CODES.preflightRejected)
      .map((entry) => entry.message)
      .join('\n');
    for (const reason of ['missing_meta', 'not_authored', 'org_mismatch', 'project_mismatch']) {
      expect(reasons).toContain(reason);
    }

    // Verdicts and freshness stand exactly where they were.
    expect(JSON.stringify(result.state.graph.promises)).toBe(
      JSON.stringify(priorState().graph.promises),
    );
    expect(result.state.freshness.terminalEventAt).toBe('2026-08-01T00:00:00.000Z');
    expect(result.handoff.handoff.nextAction.branch).toBeNull();
  });
});

describe('a stream that never reaches testrun_done writes nothing (R4.7, R4.10)', () => {
  it('discards the member results it did see and preserves the prior state', async () => {
    const io = harness();
    const { result } = await run(io, { all: true, lines: CRASHED, exitCode: 0 });

    // The truncated fixture carries one passing member. A run that wrote it would
    // report a partial suite as a whole one.
    expect(result.members).toHaveLength(1);
    expect(result.members[0]?.status).toBe('passed');
    expect(result.terminalSeen).toBe(false);
    expect(result.wrote).toBe(false);
    expect(result.refusals).toEqual(['stream-crashed']);
    expect(result.updatedPromiseIds).toEqual([]);
    expect(io.sink.has(VERIFY_DIAGNOSTIC_CODES.outcomeUnknown)).toBe(true);

    // T-1 was `red` before and stays `red`, despite the passing member event.
    const before = priorState();
    expect(JSON.stringify(result.state.graph.promises)).toBe(
      JSON.stringify(before.graph.promises),
    );
    expect(result.state.freshness).toEqual(before.freshness);
    // And the handoff still lands, saying the outcome is unknown.
    expect(result.handoff.handoff.outcome.terminalSeen).toBe(false);
    expect(result.handoff.handoff.nextAction.branch).toBeNull();
    expect(io.fileSystem.readFile(HANDOFF_PATH)).not.toBeNull();
  });
});

describe('through the dispatcher (§13.1, §14.2)', () => {
  /** `main` with no Kane boundary: the empty-radius path, end to end. */
  async function dispatch(argv: readonly string[]): Promise<{
    readonly code: number;
    readonly out: string;
    readonly fileSystem: StateFileSystem;
  }> {
    const out: string[] = [];
    const fileSystem = inMemoryStateFileSystem({
      [STATE_PATH]: serialiseState(priorState()),
    });
    const code = await main(argv, {
      write: (text) => {
        out.push(text);
      },
      writeError: () => {
        // Diagnostics are asserted through the `--json` payload.
      },
      cwd: REPO,
      env: {},
      fileSystem,
      now: () => new Date(AT),
      kane: false,
    });
    return { code, out: out.join(''), fileSystem };
  }

  it('exits 0 and reports the scope for --changed', async () => {
    const { code, out, fileSystem } = await dispatch([
      'verify',
      '--changed',
      'apps/fixture/lib/cart.ts',
      '--json',
    ]);
    expect(code).toBe(EXIT_OK);
    const payload = JSON.parse(out) as Record<string, unknown>;
    expect(payload['command']).toBe('verify');
    expect(payload['implemented']).toBe(true);
    expect(payload['scope']).toBe('changed');
    expect(payload['invoked']).toBe(false);
    expect(payload['wrote']).toBe(false);
    // The handoff lands even here, which is the point of writing one every run.
    expect(fileSystem.readFile(HANDOFF_PATH)).not.toBeNull();
  });

  it('exits 0 for --all with no plan to name identifiers from', async () => {
    const { code, out } = await dispatch(['verify', '--all']);
    expect(code).toBe(EXIT_OK);
    expect(out).toContain('kept verify --all');
    expect(out).toContain('empty — nothing was invoked');
  });
});

describe('no Kane at all is a supported state (R2.12)', () => {
  it('reports it, writes the handoff, and moves nothing', async () => {
    const io = harness();
    const { result } = await run(io, { all: true, withKane: false });

    expect(result.invoked).toBe(false);
    expect(io.sink.has(VERIFY_DIAGNOSTIC_CODES.kaneUnavailable)).toBe(true);
    expect(result.wrote).toBe(false);
    expect(result.state.freshness.terminalEventAt).toBe('2026-08-01T00:00:00.000Z');
    expect(io.fileSystem.readFile(HANDOFF_PATH)).not.toBeNull();
  });
});
