import type {
  ChildProcessLike,
  CollectingDiagnosticSink,
  StateFileSystem,
} from '@kept/core';
import {
  KaneInvoker,
  STATE_FILE_RELATIVE_PATH,
  createDiagnosticSink,
  createKeptState,
  designedTestId,
  documentId,
  inMemoryBaselineFileSystem,
  inMemoryCitationSource,
  inMemoryStateFileSystem,
  isKeptState,
  serialiseState,
} from '@kept/core';
import { describe, expect, it } from 'vitest';

import { BUILD_DIAGNOSTIC_CODES, runBuild } from '../src/commands/build.js';
import { DEFAULT_CONFIG } from '../src/config.js';

/**
 * `kept build` (design §5.4, §13.1, §14.1, R2.10, R2.12).
 *
 * Every test here runs with no disk and no Kane process: the state file, the
 * `*_test.md` walk, the cited-document reads and the child process are all
 * injected. What is being asserted is the *composition* — that baseline is the
 * citation authority, that a degraded enrichment axis costs exactly the proven
 * figure and the coverage axes and nothing else, and that the freshness triple is
 * left alone by this command in every case, `cover gaps` reads the assurance graph
 * and proves nothing, so "last verified" is not its to advance.
 */
const REPO = '/repo';
const STATE_PATH = `${REPO}/${STATE_FILE_RELATIVE_PATH}`;
const DOC = 'apps/fixture/README.md';
const TEST_DOC = 'tests/cart_subtotal_test.md';

const README = [
  '# Kepler Coffee',
  '',
  '- The Cart screen shows a running subtotal that updates immediately.',
  '- The Shop screen lists exactly six coffees.',
  '',
].join('\n');

/** One `*_test.md` citing line 3 of the README, in the repository's own format. */
const TEST_DOCUMENT = [
  '---',
  'test_id: T-3',
  'tags: [cart, subtotal]',
  '---',
  '',
  '# Cart subtotal updates immediately',
  '',
  `<!-- @verifies ${DOC}:3 the breakable subtotal claim -->`,
  '',
  '1. Navigate to http://localhost:3100/cart.',
  '',
].join('\n');

function seams(): {
  readonly fileSystem: StateFileSystem;
  readonly sink: CollectingDiagnosticSink;
  readonly baselineFileSystem: ReturnType<typeof inMemoryBaselineFileSystem>;
  readonly citations: ReturnType<typeof inMemoryCitationSource>;
} {
  return {
    fileSystem: inMemoryStateFileSystem(),
    sink: createDiagnosticSink(),
    baselineFileSystem: inMemoryBaselineFileSystem({ [TEST_DOC]: TEST_DOCUMENT }),
    citations: inMemoryCitationSource({ [DOC]: README }),
  };
}

// ---------------------------------------------------------------------------
// A fake Kane child process, so the accepted path needs no credits
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

/** An invoker that replays `lines` and exits `exitCode`. Records the argv. */
function fakeInvoker(
  lines: readonly string[],
  exitCode: number | null,
): { readonly invoker: KaneInvoker; readonly argv: string[][] } {
  const argv: string[][] = [];
  const invoker = new KaneInvoker({
    resolveBinary: () => '/stub/bin/kane-cli',
    spawn: (_command, args) => {
      argv.push([...args]);
      const child = new FakeChild();
      queueMicrotask(() => {
        for (const line of lines) child.stdout.emit(`${line}\n`);
        child.close(exitCode);
      });
      return child.asChild();
    },
  });
  return { invoker, argv };
}

/**
 * A `cover gaps` run the acceptance gate takes: complete, `done`, one use-case row.
 *
 * Shaped like the real capture (§5.3.0) and deliberately smaller: this suite is
 * about what `kept build` does with an accepted run, and the projection itself is
 * asserted against the committed nine-row stream in `packages/kept-core`.
 */
const ACCEPTED_LINES: readonly string[] = [
  JSON.stringify({
    type: 'gaps',
    v: 1,
    verb: 'gaps',
    stage: 'all',
    design_completeness: {
      pct: 100,
      acs_designed: '6/6',
      usecases_complete: '1/9',
      ucs_needing_scenarios: 8,
    },
    proven: {
      pct: 100,
      acs_proven: '6/6',
      failing: 0,
      blocked: 0,
      not_run: 0,
      config: { source: 'graph_execution_facts', denominator: 'current_live_acs' },
    },
    usecases: [
      {
        id: 'uc-2',
        title: 'Manage cart pricing and discounts',
        risk: 'high',
        design_completeness: { pct: 100, status: 'complete' },
        stale_acs: 0,
        proven: { pct: 100, status: 'proven' },
        pending: [],
      },
    ],
  }),
  JSON.stringify({
    type: 'done',
    v: 1,
    verb: 'gaps',
    status: 'complete',
    exit_code: 0,
    run_id: 'run-gaps-1',
  }),
];

/** The verified refusal envelope of §5.3.1: complete, `done`, `status: refused`. */
const REFUSED_LINES: readonly string[] = [
  JSON.stringify({
    type: 'done',
    v: 1,
    verb: 'cover',
    status: 'refused',
    exit_code: 2,
    message: 'error: no context store here (run `kane-cli context ingest <files>` first)',
  }),
];

// ---------------------------------------------------------------------------

describe('kept build with no Kane at all (R2.12)', () => {
  it('builds from baseline alone, degrades, and still writes the state file', async () => {
    const { fileSystem, sink, baselineFileSystem, citations } = seams();

    const result = await runBuild({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      fileSystem,
      baselineFileSystem,
      citations,
      diagnostics: sink,
      at: '2026-08-20T12:00:00.000Z',
    });

    expect(result.baseline.ok).toBe(true);
    expect(result.enrichment.ok).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.degradedReasons).toEqual(['kane-not-found']);
    // The whole point of R2.12: the promise is still there, with its citation.
    expect(result.state.graph.promises).toHaveLength(1);
    expect(result.state.graph.promises[0]?.citation).toEqual({
      file: DOC,
      line: 3,
      text: '- The Cart screen shows a running subtotal that updates immediately.',
    });
    expect(result.statePath).toBe(STATE_PATH);
    const written = fileSystem.readFile(STATE_PATH);
    expect(written).not.toBeNull();
    expect(isKeptState(JSON.parse(written as string))).toBe(true);
  });

  it('holds the freshness triple, because nothing was consumed', async () => {
    const { fileSystem, sink, baselineFileSystem, citations } = seams();
    const result = await runBuild({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      fileSystem,
      baselineFileSystem,
      citations,
      diagnostics: sink,
      at: '2026-08-20T12:00:00.000Z',
    });

    expect(result.freshnessMoved).toBe(false);
    expect(result.state.freshness).toEqual({
      terminalEventAt: null,
      terminalEventType: null,
      commandFamily: null,
    });
    expect(sink.has(BUILD_DIAGNOSTIC_CODES.freshnessHeld)).toBe(true);
  });

  it('is honest about an empty repository rather than failing', async () => {
    const { fileSystem, sink } = seams();
    const result = await runBuild({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      fileSystem,
      baselineFileSystem: inMemoryBaselineFileSystem({}),
      citations: inMemoryCitationSource({}),
      diagnostics: sink,
      at: '2026-08-20T12:00:00.000Z',
    });

    expect(result.baseline.ok).toBe(true);
    expect(result.state.graph.promises).toEqual([]);
    expect(result.state.graph.edges).toEqual([]);
    expect(fileSystem.readFile(STATE_PATH)).not.toBeNull();
  });
});

describe('kept build derives the graph lanes from the promises', () => {
  it('emits a cites edge from the document and a designed edge to the test', async () => {
    const { fileSystem, sink, baselineFileSystem, citations } = seams();
    const result = await runBuild({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      fileSystem,
      baselineFileSystem,
      citations,
      diagnostics: sink,
      at: '2026-08-20T12:00:00.000Z',
    });

    const promise = result.state.graph.promises[0];
    expect(promise).toBeDefined();
    expect(result.state.graph.edges).toEqual([
      { from: documentId(DOC), to: promise?.id, kind: 'cites' },
      { from: promise?.id, to: designedTestId(TEST_DOC), kind: 'designed' },
    ]);
  });
});

describe('kept build with a cover gaps run the gate accepts', () => {
  it('issues `cover gaps --json --mode agent` and advances the freshness triple', async () => {
    const { fileSystem, sink, baselineFileSystem, citations } = seams();
    const { invoker, argv } = fakeInvoker(ACCEPTED_LINES, 0);

    const result = await runBuild({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      fileSystem,
      baselineFileSystem,
      citations,
      invoker,
      diagnostics: sink,
      at: '2026-08-20T12:00:00.000Z',
    });

    // The enabler is `--mode agent`, appended by the invoker from the contract
    // table — never `--agent`, which the Assurance family does not accept.
    expect(argv[0]).toEqual(['cover', 'gaps', '--json', '--mode', 'agent']);
    expect(result.enrichment.ok).toBe(true);
    expect(result.degraded).toBe(false);

    // And it holds the freshness triple even though the gate accepted the run.
    // `cover gaps` reads the assurance graph and proves nothing, its own proven
    // axis is derived from execution facts whose `latest_run` is an *earlier* run,
    // so advancing the Ledger's "last verified" chip here would restate an old proof
    // as new. The triple belongs to `kept verify`.
    expect(result.freshnessMoved).toBe(false);
    expect(result.freshnessRefusals).toEqual([]);
    expect(result.state.freshness).toEqual({
      terminalEventAt: null,
      terminalEventType: null,
      commandFamily: null,
    });
    expect(sink.has(BUILD_DIAGNOSTIC_CODES.freshnessHeld)).toBe(true);
  });

  it('leaves a prior freshness triple exactly where a verification run left it', async () => {
    const { fileSystem, sink, baselineFileSystem, citations } = seams();
    const prior = createKeptState({
      updatedAt: '2026-08-19T00:00:00.000Z',
      freshness: {
        terminalEventAt: '2026-08-19T00:00:00.000Z',
        terminalEventType: 'testrun_done',
        commandFamily: 'ExecutionTestrun',
      },
    });
    fileSystem.writeFile(STATE_PATH, serialiseState(prior));
    const { invoker } = fakeInvoker(ACCEPTED_LINES, 0);

    const result = await runBuild({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      fileSystem,
      baselineFileSystem,
      citations,
      invoker,
      diagnostics: sink,
      at: '2026-08-20T12:00:00.000Z',
    });

    expect(result.enrichment.ok).toBe(true);
    expect(result.state.freshness).toEqual(prior.freshness);
  });

  it('records the axes in the state, so `kept snapshot` needs no Kane (R9.14)', async () => {
    const { fileSystem, sink, baselineFileSystem, citations } = seams();
    const { invoker } = fakeInvoker(ACCEPTED_LINES, 0);

    const result = await runBuild({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      fileSystem,
      baselineFileSystem,
      citations,
      invoker,
      diagnostics: sink,
      at: '2026-08-20T12:00:00.000Z',
    });

    expect(result.coverageAxes).not.toBeNull();
    expect(result.coverageAxes?.designCompleteness.ratio.text).toBe('6/6');
    expect(result.coverageAxes?.designCompleteness.usecasesComplete.text).toBe('1/9');
    expect(result.coverageAxes?.proven.ratio.text).toBe('6/6');
    expect(result.coverageAxes?.rows.map((row) => row.id)).toEqual(['uc-2']);

    // And they survived the write, which is the only thing that carries them across
    // to the second process of `npm run build:snapshot`.
    expect(result.state.coverageAxes).toEqual(result.coverageAxes);
    const written = JSON.parse(fileSystem.readFile(STATE_PATH) as string) as unknown;
    expect(isKeptState(written)).toBe(true);
    expect((written as { coverageAxes: unknown }).coverageAxes).toEqual(result.coverageAxes);
  });
});

describe('kept build withholds the axes on every degraded path (R9.13)', () => {
  const degradations: readonly {
    readonly what: string;
    readonly lines: readonly string[];
    readonly exitCode: number | null;
    readonly reason: string;
  }[] = [
    { what: 'a refusal', lines: REFUSED_LINES, exitCode: 2, reason: 'assurance-status:refused' },
    {
      what: 'a pause at exit 3',
      lines: [
        ACCEPTED_LINES[0] as string,
        JSON.stringify({ type: 'done', v: 1, verb: 'gaps', status: 'paused', exit_code: 3 }),
      ],
      exitCode: 3,
      reason: 'paused-resumable',
    },
    {
      what: 'a stream truncated before done',
      lines: [ACCEPTED_LINES[0] as string],
      exitCode: 0,
      reason: 'crashed-stream: outcome unknown',
    },
    {
      what: 'a payload with no use-case rows',
      lines: [
        JSON.stringify({
          type: 'gaps',
          v: 1,
          verb: 'gaps',
          design_completeness: { pct: 100, acs_designed: '6/6' },
          proven: { pct: 100, acs_proven: '6/6' },
          usecases: [],
        }),
        JSON.stringify({ type: 'done', v: 1, verb: 'gaps', status: 'complete', exit_code: 0 }),
      ],
      exitCode: 0,
      reason: 'gaps-payload-unreadable',
    },
  ];

  for (const degradation of degradations) {
    it(`withholds them on ${degradation.what}, and never writes a zero`, async () => {
      const { fileSystem, sink, baselineFileSystem, citations } = seams();
      const { invoker } = fakeInvoker(degradation.lines, degradation.exitCode);

      const result = await runBuild({
        repoRoot: REPO,
        config: DEFAULT_CONFIG,
        fileSystem,
        baselineFileSystem,
        citations,
        invoker,
        diagnostics: sink,
        at: '2026-08-20T12:00:00.000Z',
      });

      expect(result.degraded).toBe(true);
      expect(result.degradedReasons).toEqual([degradation.reason]);
      expect(result.coverageAxes).toBeNull();
      expect(result.state.coverageAxes).toBeNull();
      // Nothing here is an error-severity diagnostic, so the build still exits 0.
      expect(sink.hasSeverity('error')).toBe(false);
    });
  }
});

describe('kept build with the verified cover refusal (§5.3.1)', () => {
  it('reports assurance-status:refused, exits through no throw, and holds freshness', async () => {
    const { fileSystem, sink, baselineFileSystem, citations } = seams();
    const { invoker } = fakeInvoker(REFUSED_LINES, 2);

    const result = await runBuild({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      fileSystem,
      baselineFileSystem,
      citations,
      invoker,
      diagnostics: sink,
      at: '2026-08-20T12:00:00.000Z',
    });

    expect(result.enrichment.ok).toBe(false);
    expect(result.degradedReasons).toEqual(['assurance-status:refused']);
    expect(result.degraded).toBe(true);
    // A refusal is a *complete* stream whose exit reads as failure, so the write
    // guard alone would have authorised a freshness move. It must not happen: the
    // run consumed nothing into the graph, and §14.1's refusal row counts
    // `freshness.terminalEventAt` among the things it leaves unchanged.
    expect(result.freshnessMoved).toBe(false);
    expect(result.state.freshness.terminalEventAt).toBeNull();
    // And the citation survived the outage untouched.
    expect(result.state.graph.promises).toHaveLength(1);
  });
});

describe('kept build never advances freshness on an unproven outcome', () => {
  it('holds it for a crashed stream — no terminal event at all', async () => {
    const { fileSystem, sink, baselineFileSystem, citations } = seams();
    const { invoker } = fakeInvoker([JSON.stringify({ type: 'progress', step: 'scan' })], 0);

    const result = await runBuild({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      fileSystem,
      baselineFileSystem,
      citations,
      invoker,
      diagnostics: sink,
      at: '2026-08-20T12:00:00.000Z',
    });

    expect(result.freshnessMoved).toBe(false);
    expect(result.state.freshness.terminalEventAt).toBeNull();
  });

  it('holds it for an Assurance pause, which exits 3 and is resumable', async () => {
    const { fileSystem, sink, baselineFileSystem, citations } = seams();
    const { invoker } = fakeInvoker(
      [
        JSON.stringify({
          type: 'done',
          v: 1,
          verb: 'cover',
          status: 'paused',
          exit_code: 3,
        }),
      ],
      3,
    );

    const result = await runBuild({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      fileSystem,
      baselineFileSystem,
      citations,
      invoker,
      diagnostics: sink,
      at: '2026-08-20T12:00:00.000Z',
    });

    expect(result.freshnessMoved).toBe(false);
    expect(result.state.freshness.terminalEventAt).toBeNull();
    expect(result.state.graph.promises).toHaveLength(1);
  });
});

describe('kept build preserves prior state under an outage', () => {
  it('carries the prior freshness forward rather than clearing it', async () => {
    const { sink, baselineFileSystem, citations } = seams();
    // A state file that already records a consumed terminal event.
    const prior = {
      schemaVersion: 1,
      updatedAt: '2026-08-19T09:00:00.000Z',
      freshness: {
        terminalEventAt: '2026-08-19T09:00:00.000Z',
        terminalEventType: 'done',
        commandFamily: 'Assurance',
      },
      graph: { promises: [], edges: [], degraded: false, degradedReasons: [], diagnostics: [] },
    };
    const fileSystem = inMemoryStateFileSystem({
      [STATE_PATH]: `${JSON.stringify(prior, null, 2)}\n`,
    });

    const result = await runBuild({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      fileSystem,
      baselineFileSystem,
      citations,
      diagnostics: sink,
      at: '2026-08-20T12:00:00.000Z',
    });

    expect(result.freshnessMoved).toBe(false);
    expect(result.state.freshness).toEqual(prior.freshness);
    expect(result.state.updatedAt).toBe('2026-08-20T12:00:00.000Z');
  });
});
