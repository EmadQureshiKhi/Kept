import { readFileSync } from 'node:fs';

import type {
  ChildProcessLike,
  KeptState,
  PlanFileSystem,
  PromiseRecord,
  StateFileSystem,
} from '@kept/core';
import {
  KaneInvoker,
  PLAN_FILE_RELATIVE_PATH,
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

import { DEFAULT_CONFIG } from '../src/config.js';
import { VERIFY_DIAGNOSTIC_CODES, runVerify } from '../src/commands/verify.js';

/**
 * The recorded whole-suite replay — task 15.3, design §7.4, §13.1, R4.6, R14.7.
 *
 * `npm run loop` was run against the live `kane-cli` 0.8.4 with every recording of
 * the corpus committed, and its bytes are in the tree: `docs/kane/replay/` holds
 * the NDJSON, the `--member-debug` stderr, the exit code, the plan cache and the
 * run entry the run produced. This suite is that run, asserted — and it starts no
 * process, because the stream is a file.
 *
 * It exists because every other test of `runVerify` feeds it a **fixture**, and a
 * fixture is a shape someone wrote down. Three of this stage's findings are things
 * no fixture had: Kane reports member paths absolute, `testrun_done` carries
 * `execution_id` and no `run_id`, and the terminal event carries no credit figure
 * at all. A test over the real bytes is what keeps those from being re-assumed.
 *
 * ## What the recording says about cost, which is R4.6's question
 *
 * `totals.authored` is 0 and `authored` is `[]`: nine members ran and Kane authored
 * nothing, every step coming back from a committed recording. The stream carries
 * **no `credits_consumed` field anywhere**, so `credits()` answers `null` — not
 * zero. That distinction is the whole point of R4.6 being measured rather than
 * asserted: a `0` would be a claim about what the run cost, and `null` is the
 * truth, which is that this family's terminal event does not report cost.
 *
 * The figure does exist, one layer down. With `KANE_TESTRUN_MEMBER_DEBUG=1` each
 * member's own `testmd` stream is echoed on stderr, and there exactly one member —
 * the failing one — emits a `run_end` carrying `credits_consumed`, plus a separate
 * `verdict.credits_consumed` for the bug analysis. The eight passing members emit
 * none, and a single-member control replay measured a balance delta of 0.0000. So a
 * replay is free where it passes, and a failure costs Kane a judgement.
 */
const RECORDING = new URL('../../../docs/kane/replay/', import.meta.url);

const read = (name: string): string => readFileSync(new URL(name, RECORDING), 'utf8');

const STREAM_LINES: readonly string[] = read('verify-all-replay.ndjson')
  .split('\n')
  .filter((line) => line.trim().length > 0);

const STREAM = STREAM_LINES.map((line) => JSON.parse(line) as Record<string, unknown>);

const MEMBER_STDERR = read('verify-all-replay.stderr.txt');
const RUN_ENTRY = JSON.parse(read('run-entry.json')) as {
  readonly runId: string;
  readonly command: { readonly argv: readonly string[]; readonly ndjsonEnabledBy: string };
  readonly outcome: Record<string, unknown>;
  readonly blastRadius: {
    readonly testIds: readonly string[];
    readonly promiseIds: readonly string[];
    readonly skippedNoTestId: readonly string[];
  };
};

/** The eight claims of `apps/fixture/README.md`, by the id Kane's recordings mint. */
const CORPUS: readonly { readonly path: string; readonly testId: string }[] = [
  { path: 'tests/shop_filter_test.md', testId: 'T-1' },
  { path: 'tests/home_cta_test.md', testId: 'T-2' },
  { path: 'tests/cart_subtotal_test.md', testId: 'T-3' },
  { path: 'tests/checkout_validation_test.md', testId: 'T-4' },
  { path: 'tests/orders_persist_test.md', testId: 'T-5' },
  { path: 'tests/settings_currency_test.md', testId: 'T-6' },
  { path: 'tests/cart_discount_test.md', testId: 'T-7' },
  { path: 'tests/product_currency_test.md', testId: 'T-8' },
];

/** T-7 asserts the never-true discount claim, so its failure is the deliverable. */
const DESIGNED_TO_FAIL = 'tests/cart_discount_test.md';

/** The transcription the verdict spike authored. It mints no promise (§6.12). */
const SPIKE = 'docs/kane/spike/cart_subtotal_spike_test.md';

function eventsOfType(type: string): readonly Record<string, unknown>[] {
  return STREAM.filter((event) => event['type'] === type);
}

/**
 * The repository root the recording was made under, read **off the recording**.
 *
 * Kane reports absolute paths, so the bytes carry one machine's root. Deriving it
 * from the stream rather than from `process.cwd()` is what lets the same bytes be
 * replayed on another machine: the test asserts the relativisation, and the root it
 * relativises against is whatever the recording says it was.
 */
const RECORDED_ROOT: string = (() => {
  const member = eventsOfType('testrun_member_end')
    .map((event) => event['path'])
    .find((path): path is string => typeof path === 'string' && path.includes(`/${SPIKE}`));
  expect(member, 'the recording names the spike member with an absolute path').toBeDefined();
  return (member as string).slice(0, (member as string).length - SPIKE.length - 1);
})();

// ---------------------------------------------------------------------------
// The stream, as bytes
// ---------------------------------------------------------------------------

describe('the recorded whole-suite replay — the stream itself', () => {
  it('ends on testrun_done, carrying execution_id and no run_id', () => {
    const last = STREAM[STREAM.length - 1];
    expect(last?.['type']).toBe('testrun_done');
    expect(typeof last?.['execution_id']).toBe('string');
    expect(last?.['run_id']).toBeUndefined();
    // The shapes §4.1 records for this family: no `status`, no `totals` here.
    expect(last?.['status']).toBeUndefined();
    expect(last?.['totals']).toBeUndefined();
    expect(last?.['overall_status']).toBe('failed');
  });

  it('reports nine members: eight passed, and the one designed to fail', () => {
    const members = eventsOfType('testrun_member_end');
    expect(members).toHaveLength(9);

    const byPath = new Map<string, string>();
    for (const member of members) {
      const path = member['path'];
      const status = member['status'];
      expect(typeof path).toBe('string');
      expect(typeof status).toBe('string');
      // Absolute on the wire. This is the finding the relativisation exists for.
      expect(path as string).toContain(`${RECORDED_ROOT}/`);
      byPath.set((path as string).slice(RECORDED_ROOT.length + 1), status as string);
    }

    expect(byPath.get(DESIGNED_TO_FAIL)).toBe('failed');
    for (const entry of CORPUS) {
      if (entry.path === DESIGNED_TO_FAIL) continue;
      expect(byPath.get(entry.path), `${entry.testId} replayed`).toBe('passed');
    }
    expect(byPath.get(SPIKE)).toBe('passed');
  });

  it('authored nothing: every step came back from a committed recording (R4.6)', () => {
    const summary = eventsOfType('testrun_summary')[0];
    expect(summary).toBeDefined();
    expect(summary?.['authored']).toEqual([]);
    expect(summary?.['totals']).toEqual({
      tests: 9,
      passed: 8,
      failed: 1,
      broken: 0,
      skipped: 0,
      authored: 0,
    });
    // `interrupted` is not a bucket this family reports (§4.1).
    expect(Object.keys(summary?.['totals'] as object)).not.toContain('interrupted');
  });

  it('reports no credit figure on stdout at all, so credits() cannot be zero', () => {
    expect(read('verify-all-replay.ndjson')).not.toContain('credits');
  });

  it('reports the cost of the failing member, and only that member, on stderr', () => {
    const withCredits = MEMBER_STDERR.split('\n')
      .filter((line) => line.includes('credits_consumed'))
      .map((line) => JSON.parse(line.replace('[member] ', '')) as Record<string, unknown>);

    // One member out of nine. The eight that passed cost nothing.
    expect(withCredits).toHaveLength(1);
    const runEnd = withCredits[0] as Record<string, unknown>;
    expect(runEnd['type']).toBe('run_end');
    expect(runEnd['status']).toBe('failed');
    expect(runEnd['result_code']).toBe(740);
    expect(runEnd['reason_code']).toBe('assertion_error.confirmed_product_bug');
    expect(typeof runEnd['credits_consumed']).toBe('number');
    expect(runEnd['credits_consumed'] as number).toBeGreaterThan(0);

    // The bug judgement is billed separately from the run that provoked it.
    const verdict = runEnd['verdict'] as Record<string, unknown>;
    expect(typeof verdict['credits_consumed']).toBe('number');
    expect(verdict['credits_consumed'] as number).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The invocation, as recorded in the run entry
// ---------------------------------------------------------------------------

describe('the recorded whole-suite replay — the argv KEPT actually spawned', () => {
  it('names the plan’s member paths and carries no --agent', () => {
    // The recorded argv, verbatim, and it is a *historical* record: this run
    // predates `--bug-detection continue`, which 15.6 added when Kane's profile
    // setting turned out to decide the repair branch. The recording is not
    // rewritten to match the current composition — that is the whole point of
    // committing it — so the tail asserted here is the tail this run had.
    const argv = RUN_ENTRY.command.argv;
    expect(argv.slice(0, 2)).toEqual(['testrun', 'run']);
    expect(argv.slice(-2)).toEqual(['--on-failure', 'continue']);
    expect(argv).not.toContain('--bug-detection');
    expect(argv).not.toContain('--agent');
    expect(RUN_ENTRY.command.ndjsonEnabledBy).toBe('piped-stdout');

    const named = argv.slice(2, -2);
    expect(named).toEqual([...CORPUS.map((entry) => entry.path), SPIKE].sort());
    // Every path the argv names is a member the plan enumerated with an id.
    const plan = JSON.parse(read('plan.json')) as {
      readonly members: readonly { readonly path: string; readonly testId: string | null }[];
    };
    const identified = plan.members
      .filter((member) => member.testId !== null)
      .map((member) => member.path);
    expect([...named].sort()).toEqual([...identified].sort());
  });

  it('leaves out every member the plan gave no identifier, and says why', () => {
    // No recording means no `test_id`, and replaying such a member authors it live.
    // Four of them exist: the documents Kane's own `design tests` wrote (15.1).
    expect(RUN_ENTRY.blastRadius.skippedNoTestId).toHaveLength(4);
    for (const path of RUN_ENTRY.blastRadius.skippedNoTestId) {
      expect(path.startsWith('.testmuai/tests/')).toBe(true);
      expect(RUN_ENTRY.command.argv).not.toContain(path);
    }
  });

  it('takes its run id from the terminal event rather than minting one', () => {
    const terminal = STREAM[STREAM.length - 1];
    expect(RUN_ENTRY.runId).not.toContain('kept-verify:');
    expect(typeof terminal?.['execution_id']).toBe('string');
    // Not the same execution — this recording and the `npm run loop` run are two
    // replays of one argv — but the same *shape*: a run entry is keyed on Kane's id.
    expect(RUN_ENTRY.runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('records the outcome as a failure with the terminal event seen', () => {
    expect(RUN_ENTRY.outcome['terminalSeen']).toBe(true);
    expect(RUN_ENTRY.outcome['terminalEventType']).toBe('testrun_done');
    expect(RUN_ENTRY.outcome['exitMeaning']).toBe('failure');
    expect(RUN_ENTRY.outcome['verdictsPermitted']).toBe(true);
    // The honest null: the terminal event reports no cost, so nothing is claimed.
    expect(RUN_ENTRY.outcome['credits']).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The verdicts the recording produces, driven through the real command
// ---------------------------------------------------------------------------

const REPO = RECORDED_ROOT;
const AT = '2026-08-21T03:52:23.744Z';
const DOC = 'apps/fixture/README.md';

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

/** Replays the committed stream for the execution, and the committed plan cache. */
function recordedInvoker(): { readonly invoker: KaneInvoker; readonly argv: string[][] } {
  const argv: string[][] = [];
  const invoker = new KaneInvoker({
    resolveBinary: () => '/stub/bin/kane-cli',
    spawn: (_command, args) => {
      argv.push([...args]);
      const child = new FakeChild();
      queueMicrotask(() => {
        for (const line of STREAM_LINES) child.stdout.emit(`${line}\n`);
        child.close(1);
      });
      return child.asChild();
    },
  });
  return { invoker, argv };
}

function record(entry: { readonly path: string; readonly testId: string }): PromiseRecord {
  const claim = `claim verified by ${entry.testId}`;
  return createPromiseRecord({
    claim,
    citation: { file: DOC, line: 12 + CORPUS.indexOf(entry) + 1, text: `- ${claim}` },
    designedTest: { path: entry.path, testId: entry.testId },
    verdict: 'stale',
    providers: ['baseline'],
  });
}

function priorState(): KeptState {
  return createKeptState({
    updatedAt: '2026-08-01T00:00:00.000Z',
    freshness: { terminalEventAt: null, terminalEventType: null, commandFamily: null },
    graph: createPromiseGraph({ promises: CORPUS.map(record) }),
  });
}

function planFileSystem(): PlanFileSystem {
  return inMemoryPlanFileSystem({
    [PLAN_FILE_RELATIVE_PATH]: { text: read('plan.json'), mtimeMs: Date.parse(AT) },
  });
}

function stateFileSystem(): StateFileSystem {
  return inMemoryStateFileSystem({
    [`${REPO}/${STATE_FILE_RELATIVE_PATH}`]: serialiseState(priorState()),
  });
}

describe('the recorded whole-suite replay — what it does to eight stale verdicts', () => {
  it('proves seven promises, reddens the designed failure, and moves the triple', async () => {
    const kane = recordedInvoker();
    const sink = createDiagnosticSink();
    const result = await runVerify({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      all: true,
      fileSystem: stateFileSystem(),
      planFileSystem: planFileSystem(),
      diagnostics: sink,
      at: AT,
      now: () => Date.parse(AT),
      invoker: kane.invoker,
    });

    expect(result.terminalSeen).toBe(true);
    expect(result.exitMeaning).toBe('failure');
    expect(result.wrote).toBe(true);
    expect(result.refusals).toEqual([]);
    expect(result.updatedPromiseIds).toHaveLength(8);

    const verdicts = new Map(
      result.state.graph.promises.map((promise) => [
        promise.designedTest?.testId ?? promise.id,
        promise.verdict,
      ]),
    );
    expect(verdicts.get('T-7')).toBe('red');
    for (const entry of CORPUS) {
      if (entry.path === DESIGNED_TO_FAIL) continue;
      expect(verdicts.get(entry.testId), `${entry.testId} is proven`).toBe('proven');
    }

    expect(result.state.freshness).toEqual({
      terminalEventAt: AT,
      terminalEventType: 'testrun_done',
      commandFamily: 'ExecutionTestrun',
    });
    // The run id is Kane's, not a synthetic stand-in.
    expect(result.runId).toBe(STREAM[STREAM.length - 1]?.['execution_id']);
    // And still no credit figure to report, because the stream reports none.
    expect(result.credits).toBeNull();
  });

  it('attributes every member by relativising the absolute path Kane reports', async () => {
    const kane = recordedInvoker();
    const sink = createDiagnosticSink();
    const result = await runVerify({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      all: true,
      fileSystem: stateFileSystem(),
      planFileSystem: planFileSystem(),
      diagnostics: sink,
      at: AT,
      now: () => Date.parse(AT),
      invoker: kane.invoker,
    });

    for (const member of result.members) {
      expect(member.path?.startsWith('/'), 'a member path was left absolute').not.toBe(true);
    }
    // Only the spike is unattributable: it mints no promise, by design.
    const unattributed = result.members.filter((member) => member.promiseIds.length === 0);
    expect(unattributed).toHaveLength(1);
    expect(unattributed[0]?.path).toBe(SPIKE);
    expect(
      sink.entries.filter(
        (entry) => entry.code === VERIFY_DIAGNOSTIC_CODES.memberUnattributed,
      ),
    ).toHaveLength(1);
  });

  it('routes the failing member to docs-lie and leaves the others unrouted', async () => {
    const kane = recordedInvoker();
    const result = await runVerify({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      all: true,
      fileSystem: stateFileSystem(),
      planFileSystem: planFileSystem(),
      diagnostics: createDiagnosticSink(),
      at: AT,
      now: () => Date.parse(AT),
      invoker: kane.invoker,
    });

    const failing = result.members.filter((member) => member.status === 'failed');
    expect(failing).toHaveLength(1);
    expect(failing[0]?.path).toBe(DESIGNED_TO_FAIL);
    expect(failing[0]?.repair?.branch).toBe('docs-lie');
    for (const member of result.members) {
      if (member.status !== 'failed') expect(member.repair).toBeNull();
    }
  });

  it('spawns exactly the argv the run entry recorded, and spawns it once', async () => {
    const kane = recordedInvoker();
    await runVerify({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      all: true,
      fileSystem: stateFileSystem(),
      planFileSystem: planFileSystem(),
      diagnostics: createDiagnosticSink(),
      at: AT,
      now: () => Date.parse(AT),
      invoker: kane.invoker,
    });

    // One spawn: the plan came from the committed cache, so no refresh was needed.
    expect(kane.argv).toHaveLength(1);
    // Identical to the recording up to the tail, and then two words longer: the
    // recorded run predates `--bug-detection continue`. The member *selection* —
    // the part this test exists to protect — is unchanged, which is asserted as
    // the whole recorded argv minus its tail.
    const spawned = kane.argv[0] as readonly string[];
    expect(spawned.slice(0, -4)).toEqual([...RUN_ENTRY.command.argv].slice(0, -2));
    expect(spawned.slice(-4)).toEqual([
      '--on-failure',
      'continue',
      '--bug-detection',
      'continue',
    ]);
  });
});
