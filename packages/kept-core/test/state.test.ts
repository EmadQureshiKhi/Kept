import { describe, expect, it } from 'vitest';

import {
  EMPTY_FRESHNESS,
  EXIT_MEANINGS,
  STATE_DIAGNOSTIC_CODES,
  STATE_FILE_RELATIVE_PATH,
  STATE_SCHEMA_VERSION,
  WRITE_PERMITTING_EXIT_MEANINGS,
  WRITE_REFUSAL_REASONS,
  applyRun,
  contractFor,
  createDiagnosticSink,
  createKeptState,
  createPromiseGraph,
  createPromiseRecord,
  createStateStore,
  deepFreeze,
  inMemoryStateFileSystem,
  isKeptState,
  isStateFreshness,
  mayWriteVerdicts,
  outcomeFromInvocation,
  parseStream,
  serialiseState,
  writeRefusals,
  type CommandFamily,
  type ExitMeaning,
  type InvocationResult,
  type KeptState,
  type ParsedStream,
  type PromiseRecord,
  type RunOutcome,
} from 'kept-core';

/**
 * Unit tests for `state.ts` — the single verdict write guard (design §4.8,
 * R2.10, R3.7, R5.3, R5.4, R11.8–R11.11).
 *
 * Streams are built by *parsing real NDJSON lines* rather than by hand-rolling
 * `CompleteStream` literals. A fabricated stream object could claim
 * `kind: 'complete'` while carrying a terminal event the parser would never have
 * produced, and the guard's stream half would then be tested against a shape
 * that cannot occur.
 */

/** The terminal line each family ends with, per the contract table of §4.1. */
const TERMINAL_LINE: { readonly [F in CommandFamily]: string } = {
  ExecutionRun: JSON.stringify({ type: 'run_end', status: 'passed', result_code: 0 }),
  ExecutionTestrun: JSON.stringify({ type: 'testrun_done', status: 'passed' }),
  Assurance: JSON.stringify({ type: 'done', status: 'complete', exit_code: 0 }),
};

/**
 * Events that look like a real run and are not the terminal event. A crashed
 * stream built from these is the dangerous case: plausible content, unknown
 * outcome.
 */
const PLAUSIBLE_LINES: readonly string[] = [
  JSON.stringify({ step: 'plan', status: 'ok', remark: 'resolved 3 members' }),
  JSON.stringify({ type: 'testrun_member_end', path: 'a_test.md', status: 'passed' }),
  JSON.stringify({ type: 'testrun_member_end', path: 'b_test.md', status: 'passed' }),
];

/**
 * Streams are typed at `CommandFamily` rather than at a narrow literal on
 * purpose: the guard is a statement about every family, and a helper that
 * specialised would let a clause below be proven for one contract only.
 */
function streamFor(family: CommandFamily, kind: 'complete' | 'crashed'): ParsedStream<CommandFamily> {
  const lines = kind === 'complete' ? [...PLAUSIBLE_LINES, TERMINAL_LINE[family]] : PLAUSIBLE_LINES;
  return parseStream(contractFor(family), lines);
}

function outcome(
  family: CommandFamily,
  kind: 'complete' | 'crashed',
  meaning: ExitMeaning,
): RunOutcome<CommandFamily> {
  return {
    runId: `run_${family}_${kind}_${meaning}`,
    exitMeaning: meaning,
    stream: streamFor(family, kind),
  };
}

function promise(claim: string, line: number): PromiseRecord {
  return createPromiseRecord({
    claim,
    citation: { file: 'apps/fixture/README.md', line, text: claim },
    designedTest: { path: 'tests/cart_test.md', testId: 'T-1' },
    verdict: 'proven',
    verdictSource: {
      runId: 'run_prior',
      terminalEventType: 'testrun_done',
      at: '2026-08-01T00:00:00.000Z',
      memberStatus: 'passed',
      resultCode: 0,
      reasonCode: null,
    },
    providers: ['baseline'],
  });
}

const FIRST = promise('The cart subtotal equals the sum of line totals.', 3);
const SECOND = promise('Checkout applies a ten percent discount.', 4);

const PRIOR: KeptState = createKeptState({
  updatedAt: '2026-08-01T00:00:00.000Z',
  freshness: {
    terminalEventAt: '2026-08-01T00:00:00.000Z',
    terminalEventType: 'testrun_done',
    commandFamily: 'ExecutionTestrun',
  },
  graph: createPromiseGraph({ promises: [FIRST, SECOND] }),
});

const AT = '2026-08-20T18:40:11.000Z';

describe('state.ts: mayWriteVerdicts — both halves, always', () => {
  it('accepts exactly complete streams whose exit meaning is write-permitting', () => {
    for (const family of ['ExecutionRun', 'ExecutionTestrun', 'Assurance'] as const) {
      for (const meaning of EXIT_MEANINGS) {
        for (const kind of ['complete', 'crashed'] as const) {
          const expected = kind === 'complete' && WRITE_PERMITTING_EXIT_MEANINGS.has(meaning);
          expect(
            mayWriteVerdicts(outcome(family, kind, meaning)),
            `${family} / ${kind} / ${meaning}`,
          ).toBe(expected);
        }
      }
    }
  });

  it('names which half failed, and names none when the outcome is proven', () => {
    expect(writeRefusals(outcome('Assurance', 'crashed', 'paused-resumable'))).toEqual([
      ...WRITE_REFUSAL_REASONS,
    ]);
    expect(writeRefusals(outcome('Assurance', 'complete', 'paused-resumable'))).toEqual([
      'exit-meaning-unproven',
    ]);
    expect(writeRefusals(outcome('ExecutionRun', 'crashed', 'success'))).toEqual([
      'stream-crashed',
    ]);
    expect(writeRefusals(outcome('ExecutionRun', 'complete', 'success'))).toEqual([]);
  });

  it('reaches the terminal event only after the guard has narrowed the outcome', () => {
    const proven = outcome('ExecutionRun', 'complete', 'failure');
    expect(mayWriteVerdicts(proven)).toBe(true);
    if (mayWriteVerdicts(proven)) {
      // `terminal` is on the type here and nowhere else — the compile-time half
      // of the guard, which is why this line is a test at all.
      expect(proven.stream.terminal.type).toBe('run_end');
    }
  });

  it('reads the exit meaning from the invocation rather than recomputing it', () => {
    const stream = streamFor('Assurance', 'complete');
    const result = {
      exitMeaning: 'paused-resumable',
      exitCode: 3,
    } as unknown as InvocationResult<CommandFamily>;
    const paired = outcomeFromInvocation('run_paused', result, stream);
    expect(paired.exitMeaning).toBe('paused-resumable');
    expect(mayWriteVerdicts(paired)).toBe(false);
  });
});

describe('state.ts: applyRun refuses without touching anything', () => {
  const hazards: readonly (readonly [string, RunOutcome<CommandFamily>])[] = [
    ['an Assurance pause (exit 3)', outcome('Assurance', 'complete', 'paused-resumable')],
    ['our own timeout kill', outcome('ExecutionTestrun', 'crashed', 'killed-by-timeout')],
    ['a preflight rejection', outcome('ExecutionTestrun', 'complete', 'preflight-rejected')],
    ['a missing binary', outcome('ExecutionRun', 'crashed', 'kane-not-found')],
    ['a force-interrupt', outcome('Assurance', 'complete', 'force-interrupted')],
    ['a plausible crashed stream', outcome('ExecutionTestrun', 'crashed', 'success')],
  ];

  for (const [label, unproven] of hazards) {
    it(`preserves prior verdicts and freshness on ${label}`, () => {
      const sink = createDiagnosticSink();
      const result = applyRun(PRIOR, {
        outcome: unproven,
        writes: [{ promiseId: FIRST.id, verdict: 'red' }],
        at: AT,
        sink,
      });

      // Identity, not equality: there is no copying code to get wrong.
      expect(result.state).toBe(PRIOR);
      expect(result.wrote).toBe(false);
      expect(result.refusals.length).toBeGreaterThan(0);
      expect(result.updatedPromiseIds).toEqual([]);
      expect(result.skippedPromiseIds).toEqual([FIRST.id]);
      expect(result.state.graph.promises[0]?.verdict).toBe('proven');
      expect(result.state.freshness.terminalEventAt).toBe('2026-08-01T00:00:00.000Z');
      expect(result.state.updatedAt).toBe('2026-08-01T00:00:00.000Z');
      expect(sink.size).toBe(result.refusals.length);
      expect(result.diagnostics.every((entry) => entry.severity === 'warn')).toBe(true);
    });
  }

  it('records the refusal rather than throwing, and says what it was waiting for', () => {
    const sink = createDiagnosticSink();
    applyRun(PRIOR, {
      outcome: outcome('Assurance', 'crashed', 'paused-resumable'),
      at: AT,
      sink,
    });
    expect(sink.has(STATE_DIAGNOSTIC_CODES.refusedCrashedStream)).toBe(true);
    expect(sink.has(STATE_DIAGNOSTIC_CODES.refusedExitMeaning)).toBe(true);
    expect(sink.withCode(STATE_DIAGNOSTIC_CODES.refusedCrashedStream)[0]?.message).toContain(
      'done',
    );
    expect(sink.withCode(STATE_DIAGNOSTIC_CODES.refusedExitMeaning)[0]?.message).toContain(
      'paused-resumable',
    );
  });
});

describe('state.ts: applyRun on a proven outcome', () => {
  it('moves the verdict, builds provenance, and moves all three freshness fields', () => {
    const result = applyRun(PRIOR, {
      outcome: outcome('ExecutionTestrun', 'complete', 'failure'),
      writes: [
        {
          promiseId: FIRST.id,
          verdict: 'red',
          memberStatus: 'failed',
          resultCode: 740,
          reasonCode: 'assertion_failed',
        },
      ],
      at: AT,
    });

    expect(result.wrote).toBe(true);
    expect(result.refusals).toEqual([]);
    expect(result.updatedPromiseIds).toEqual([FIRST.id]);

    const written = result.state.graph.promises.find((entry) => entry.id === FIRST.id);
    expect(written?.verdict).toBe('red');
    expect(written?.verdictSource).toEqual({
      runId: 'run_ExecutionTestrun_complete_failure',
      terminalEventType: contractFor('ExecutionTestrun').terminalType,
      at: AT,
      memberStatus: 'failed',
      resultCode: 740,
      reasonCode: 'assertion_failed',
    });

    expect(result.state.freshness).toEqual({
      terminalEventAt: AT,
      terminalEventType: 'testrun_done',
      commandFamily: 'ExecutionTestrun',
    });
  });

  it('carries an untouched promise across by reference, deep-frozen', () => {
    const result = applyRun(PRIOR, {
      outcome: outcome('ExecutionRun', 'complete', 'success'),
      writes: [{ promiseId: FIRST.id, verdict: 'proven', memberStatus: null }],
      at: AT,
    });

    const untouched = result.state.graph.promises.find((entry) => entry.id === SECOND.id);
    expect(untouched).toBe(SECOND);
    expect(Object.isFrozen(untouched)).toBe(true);
    expect(Object.isFrozen(untouched?.citation)).toBe(true);
    expect(() => {
      (untouched as { verdict: string }).verdict = 'proven';
    }).toThrow(TypeError);
  });

  it('preserves a promise outside the blast radius verbatim (R4.15)', () => {
    const sink = createDiagnosticSink();
    const result = applyRun(PRIOR, {
      outcome: outcome('ExecutionTestrun', 'complete', 'failure'),
      writes: [
        { promiseId: FIRST.id, verdict: 'red', memberStatus: 'failed' },
        { promiseId: SECOND.id, verdict: 'red', memberStatus: 'failed' },
      ],
      radius: [FIRST.id],
      at: AT,
      sink,
    });

    expect(result.updatedPromiseIds).toEqual([FIRST.id]);
    expect(result.skippedPromiseIds).toEqual([SECOND.id]);
    expect(result.state.graph.promises.find((entry) => entry.id === SECOND.id)).toBe(SECOND);
    expect(sink.has(STATE_DIAGNOSTIC_CODES.outsideRadius)).toBe(true);
  });

  it('declines a write naming a promise the graph does not carry', () => {
    const sink = createDiagnosticSink();
    const result = applyRun(PRIOR, {
      outcome: outcome('ExecutionRun', 'complete', 'success'),
      writes: [{ promiseId: 'p_000000000000', verdict: 'proven' }],
      at: AT,
      sink,
    });
    expect(result.updatedPromiseIds).toEqual([]);
    expect(result.skippedPromiseIds).toEqual(['p_000000000000']);
    expect(sink.has(STATE_DIAGNOSTIC_CODES.unknownPromise)).toBe(true);
  });

  it('advances freshness on a proven run that changed no verdict', () => {
    const result = applyRun(PRIOR, {
      outcome: outcome('Assurance', 'complete', 'success'),
      at: AT,
    });
    expect(result.wrote).toBe(true);
    expect(result.updatedPromiseIds).toEqual([]);
    expect(result.state.freshness).toEqual({
      terminalEventAt: AT,
      terminalEventType: 'done',
      commandFamily: 'Assurance',
    });
    for (const entry of result.state.graph.promises) {
      expect(entry.verdict).toBe('proven');
    }
  });
});

describe('state.ts: the state file', () => {
  it('starts empty, with freshness absent all three fields together', () => {
    const empty = createKeptState();
    expect(empty.schemaVersion).toBe(STATE_SCHEMA_VERSION);
    expect(empty.freshness).toEqual(EMPTY_FRESHNESS);
    expect(isStateFreshness(empty.freshness)).toBe(true);
    expect(isKeptState(empty)).toBe(true);
    expect(Object.isFrozen(empty)).toBe(true);
  });

  it('rejects freshness carrying two of its three fields', () => {
    expect(
      isStateFreshness({
        terminalEventAt: AT,
        terminalEventType: 'done',
        commandFamily: null,
      }),
    ).toBe(false);
  });

  it('serialises to plain JSON with no undefined, Date or NaN surviving', () => {
    const text = serialiseState(PRIOR);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toContain('undefined');
    expect(JSON.parse(text)).toEqual(PRIOR);
    expect(isKeptState(JSON.parse(text))).toBe(true);
  });

  it('round-trips through the store, and answers empty on an unreadable file', () => {
    const fileSystem = inMemoryStateFileSystem();
    const store = createStateStore({ repoRoot: '/tmp/repo', fileSystem });
    expect(store.path).toBe(`/tmp/repo/${STATE_FILE_RELATIVE_PATH}`);

    store.save(PRIOR);
    expect(store.load()).toEqual(PRIOR);

    const sink = createDiagnosticSink();
    const broken = createStateStore({
      repoRoot: '/tmp/repo',
      fileSystem: inMemoryStateFileSystem({
        [`/tmp/repo/${STATE_FILE_RELATIVE_PATH}`]: '{ not json',
      }),
      sink,
    });
    expect(broken.load().graph.promises).toEqual([]);
    expect(sink.has(STATE_DIAGNOSTIC_CODES.loadUnreadable)).toBe(true);

    const stale = createStateStore({
      repoRoot: '/tmp/repo',
      fileSystem: inMemoryStateFileSystem({
        [`/tmp/repo/${STATE_FILE_RELATIVE_PATH}`]: JSON.stringify({ schemaVersion: 99 }),
      }),
      sink,
    });
    expect(stale.load().graph.promises).toEqual([]);
    expect(sink.has(STATE_DIAGNOSTIC_CODES.loadInvalid)).toBe(true);
  });

  it('routes the store method through the same guard', () => {
    const store = createStateStore({
      repoRoot: '/tmp/repo',
      fileSystem: inMemoryStateFileSystem(),
      clock: () => new Date(AT),
    });
    const refused = store.applyRun(PRIOR, {
      outcome: outcome('Assurance', 'complete', 'paused-resumable'),
      writes: [{ promiseId: FIRST.id, verdict: 'red' }],
    });
    expect(refused.state).toBe(PRIOR);
    expect(refused.wrote).toBe(false);

    const wrote = store.applyRun(PRIOR, {
      outcome: outcome('Assurance', 'complete', 'success'),
      writes: [{ promiseId: FIRST.id, verdict: 'red' }],
    });
    expect(wrote.wrote).toBe(true);
    expect(wrote.state.freshness.terminalEventAt).toBe(AT);
  });

  it('deep-freezes a nested structure it is handed, cycles included', () => {
    const cyclic: Record<string, unknown> = { inner: { leaf: 1 } };
    cyclic['self'] = cyclic;
    expect(Object.isFrozen(deepFreeze(cyclic))).toBe(true);
    expect(Object.isFrozen(cyclic['inner'])).toBe(true);
  });
});
