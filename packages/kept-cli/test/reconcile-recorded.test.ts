import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type {
  BaselineFileSystem,
  ChildProcessLike,
  CitationSource,
  KeptState,
  PromiseRecord,
  StateFileSystem,
} from '@kept/core';
import {
  KaneInvoker,
  STATE_FILE_RELATIVE_PATH,
  createDiagnosticSink,
  createKeptState,
  createPromiseGraph,
  createPromiseRecord,
  inMemoryBaselineFileSystem,
  inMemoryCitationSource,
  inMemorySourceCacheFileSystem,
  serialiseState,
} from '@kept/core';
import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../src/config.js';
import { RECONCILE_DIAGNOSTIC_CODES, runReconcile } from '../src/commands/reconcile.js';

/**
 * Task 15.4 — `maintain reconcile --plan` driven by **recorded** streams from a live
 * `kane-cli` 0.8.4, against a source the ladder really resolved (design §13.2,
 * §13.2.2, §13.2.3, R5.2, R5.3, R5.7, R2.10).
 *
 * Every byte this file reads comes from `docs/kane/reconcile/`, captured while the
 * live reconcile ran against this repository's own `.context/` store. Nothing here
 * is a shape somebody guessed at, which is the point: three separate defects in
 * this branch were invisible to a suite built on invented shapes and obvious the
 * moment the real ones arrived.
 *
 * | recording | what it pins |
 * |---|---|
 * | `list-source.json` | the listing is **flat JSON lines**, and its only usable key is a slug |
 * | `plan3-0-context.argv.json` | nothing is appended to `context list` — it has no family |
 * | `plan3-1-maintain.argv.json` | `--from`, the **resolved** `--source-id`, `--plan`, `--mode agent` |
 * | `plan3-1-maintain.ndjson` | five staged changes arrive as `reconcile_plan.rows[]` |
 * | `plan-1-maintain.ndjson` | a genuine Kane-side failure: `done.status: 'error'` |
 * | `list-source-nostore.json` | the verbatim no-store refusal, on stdout, at exit 2 |
 *
 * The three defects, for the reader who wants to know what a recording bought:
 *
 * 1. `context list --json` was declared `Assurance`, so the invoker appended
 *    `--mode agent` — a flag the command does not have. Recorded at
 *    `list-source-mode-agent.*`: exit 1, empty stdout. Every save resolved to
 *    `listing-unreadable`.
 * 2. The live listing publishes no path and no digest, so all four original match
 *    rungs had nothing to read. `basename-slug` is the rung that resolves it.
 * 3. Staged changes arrive as `reconcile_plan.rows[]`, not as `review_card` events,
 *    so a reader that knew only the second spelling reported zero staged items for a
 *    run that staged five.
 */
const HERE = new URL('./', import.meta.url);
const REPO = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/+$/, '');
const RECORDED = new URL('../../../docs/kane/reconcile/', HERE);

const AT = '2026-08-21T01:01:54.341Z';
const NOW_MS = Date.parse(AT);
const README = 'apps/fixture/README.md';
const STATE_PATH = `${REPO}/${STATE_FILE_RELATIVE_PATH}`;
const REVIEW_CARDS_DIR = `${REPO}/.kept/review-cards`;

/** One recording, split into the lines the process boundary would have handed back. */
function recorded(name: string): readonly string[] {
  return readFileSync(new URL(name, RECORDED), 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0);
}

/** One recorded argv, exactly as the invoker passed it to `spawn`. */
function recordedArgv(name: string): readonly string[] {
  return JSON.parse(readFileSync(new URL(name, RECORDED), 'utf8')) as readonly string[];
}

/** The live store's listing: one flat JSON object, keyed by the slug `readme`. */
const LIVE_LISTING = recorded('list-source.json');
/** The verbatim stdout of a `context list` where there is no `.context/` at all. */
const NO_STORE = recorded('list-source-nostore.json');
/** The reconciliation that staged five changes into a stored plan. */
const PLAN_OK = recorded('plan3-1-maintain.ndjson');
/** The reconciliation Kane's own graph plane failed during (R2.10: that is data). */
const PLAN_ERROR = recorded('plan-1-maintain.ndjson');
/** `cover --json`, so the gated rebuild of R5.2 has an enrichment half to consume. */
const COVER = recorded('plan3-2-cover.ndjson');

/** The five rows the successful plan staged, read straight out of the recording. */
const RECORDED_ROWS = (() => {
  for (const line of PLAN_OK) {
    const event = JSON.parse(line) as Record<string, unknown>;
    if (event['type'] !== 'reconcile_plan') continue;
    const rows = event['rows'];
    if (Array.isArray(rows) && rows.length > 0) return rows as readonly Record<string, unknown>[];
  }
  throw new Error('the recorded plan carries no reconcile_plan rows');
})();

// ---------------------------------------------------------------------------
// The prior state, whose verdicts must not move
// ---------------------------------------------------------------------------

function promise(claim: string, line: number): PromiseRecord {
  return createPromiseRecord({
    claim,
    citation: { file: README, line, text: claim },
    designedTest: { path: 'tests/cart_subtotal_test.md', testId: 'T-3' },
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
      promise('The cart subtotal equals the sum of line totals.', 3),
      promise('Checkout applies a ten percent discount.', 4),
    ],
  }),
});

const PRIOR_BYTES = serialiseState(PRIOR);

// ---------------------------------------------------------------------------
// The spawn seam, recording rather than spawning
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
    queueMicrotask(() => {
      for (const listener of this.listeners.get('close') ?? []) listener(null, null);
    });
    return true;
  }
  asChild(): ChildProcessLike {
    return this as unknown as ChildProcessLike;
  }
  finish(lines: readonly string[], code: number | null): void {
    queueMicrotask(() => {
      for (const line of lines) this.stdout.emit(`${line}\n`);
      for (const listener of this.listeners.get('close') ?? []) listener(code, null);
    });
  }
}

interface Replay {
  readonly listing?: readonly string[];
  readonly listingExit?: number;
  readonly plan?: readonly string[];
  readonly planExit?: number;
}

interface Run {
  readonly result: Awaited<ReturnType<typeof runReconcile>>;
  readonly spawns: readonly string[][];
  readonly files: Map<string, string>;
}

/**
 * Replay the recordings through the real command.
 *
 * The only thing standing in for a live process is `spawn`: binary resolution, argv
 * composition, line splitting, exit interpretation, stream parsing, the match
 * ladder, the cards and the rebuild are all the shipped code.
 */
async function replay(options: Replay = {}): Promise<Run> {
  const spawns: string[][] = [];
  const invoker = new KaneInvoker({
    sink: createDiagnosticSink(),
    resolveBinary: () => '/stub/bin/kane-cli',
    spawn: (_command, args) => {
      spawns.push([...args]);
      const child = new FakeChild();
      if (args[0] === 'context') {
        child.finish(options.listing ?? LIVE_LISTING, options.listingExit ?? 0);
      } else if (args[0] === 'cover') {
        child.finish(COVER, 0);
      } else {
        child.finish(options.plan ?? PLAN_OK, options.planExit ?? 0);
      }
      return child.asChild();
    },
  });

  const fileSystem: StateFileSystem & { readonly files: Map<string, string> } =
    inMemorySourceCacheFileSystem({ [STATE_PATH]: PRIOR_BYTES });
  const baselineFileSystem: BaselineFileSystem = inMemoryBaselineFileSystem({});
  const citations: CitationSource = inMemoryCitationSource({});

  const result = await runReconcile({
    repoRoot: REPO,
    config: DEFAULT_CONFIG,
    changed: [README],
    invoker,
    fileSystem,
    baselineFileSystem,
    citations,
    diagnostics: createDiagnosticSink(),
    at: AT,
    now: () => NOW_MS,
  });
  return { result, spawns, files: fileSystem.files };
}

const cardPaths = (files: Map<string, string>): readonly string[] =>
  [...files.keys()].filter((path) => path.startsWith(REVIEW_CARDS_DIR));

// ---------------------------------------------------------------------------
// The resolved invocation (§13.2.2, §13.2.3)
// ---------------------------------------------------------------------------

describe('the recorded reconcile --plan against a live resolved source (§13.2)', () => {
  it('issues the recorded argv, with the source id resolved rather than guessed', async () => {
    const run = await replay();

    // The listing first, and **nothing appended to it**. This is the family-less
    // seam: the recorded `list-source-mode-agent.*` capture is what an appended
    // `--mode agent` cost — exit 1 and an empty stdout.
    expect(run.spawns[0]).toEqual(recordedArgv('plan3-0-context.argv.json'));
    expect(run.spawns[0]).not.toContain('--mode');

    // Then `maintain reconcile`, byte-for-byte the argv the live run issued: the
    // saved document, the id the ladder resolved, `--plan`, and the Assurance
    // enabler the invoker appended from the contract table.
    const doc = run.result.docs[0];
    expect(doc?.argv).toEqual(recordedArgv('plan3-1-maintain.argv.json'));
    expect(run.spawns[1]).toEqual(recordedArgv('plan3-1-maintain.argv.json'));
    expect(doc?.sourceId).toBe('readme');
    // The rung that answered. The live listing publishes no path and no digest, so
    // this is the only rung that could have.
    expect(doc?.via).toBe('basename-slug');
    expect(doc?.refusal).toBeNull();
    expect(run.result.invocations).toBe(1);
  });

  it('reaches the terminal done and records the head move that lands under --plan', async () => {
    const run = await replay();
    const doc = run.result.docs[0];

    expect(doc?.terminalSeen).toBe(true);
    expect(doc?.status).toBe('complete');
    expect(doc?.accepted).toBe(true);
    expect(doc?.exitCode).toBe(0);
    expect(doc?.exitMeaning).toBe('success');
    expect(doc?.headMoved).toBe(true);

    // The head move is a mutation inside Kane's own store that lands even under
    // `--plan`, so it is on the run's diagnostics and a reviewer is never surprised
    // by it (§13.2.3).
    const headMove = run.result.diagnostics.find(
      (entry) => entry.code === RECONCILE_DIAGNOSTIC_CODES.headMoved,
    );
    expect(headMove).toBeDefined();
    expect(headMove?.message).toContain('readme');
    expect(headMove?.message).toContain('--plan');
    expect(headMove?.file).toBe(README);
  });

  it('lands every change the recording staged as a held review card (R5.7)', async () => {
    const run = await replay();

    // Five rows on one `reconcile_plan` event — read off the recording rather than
    // written down here, so a re-capture with a different count cannot pass by
    // agreeing with a stale literal.
    expect(RECORDED_ROWS.length).toBe(5);
    expect(run.result.docs[0]?.staged).toHaveLength(RECORDED_ROWS.length);
    expect(run.result.reviewCards).toHaveLength(RECORDED_ROWS.length);

    for (const card of run.result.reviewCards) {
      expect(card.kind).toBe('reconcile');
      // Held, and held is the strongest thing a card ever is: the vocabulary is
      // `open` and `dismissed`, and neither of them means applied.
      expect(card.status).toBe('open');
      expect(card.promiseId).toMatch(/^p_/);
      expect(card.proposedChanges.map((change) => change.file)).toEqual([README]);
    }

    // Each row's own words survive into the card a reviewer reads.
    const summaries = run.result.reviewCards.flatMap((card) =>
      card.proposedChanges.map((change) => change.summary),
    );
    for (const row of RECORDED_ROWS) {
      const needle = `${String(row['kind'])} ${String(row['ref'])}`;
      expect(summaries.some((text) => text.includes(needle))).toBe(true);
    }

    // One file per card, all of them under `.kept/`, and nothing applied anywhere.
    expect(cardPaths(run.files)).toHaveLength(RECORDED_ROWS.length);
    expect(run.result.diagnostics.map((entry) => entry.code)).toContain(
      RECONCILE_DIAGNOSTIC_CODES.staged,
    );
  });

  it('rebuilds the graph from both providers, gated on the terminal event (R5.2)', async () => {
    const run = await replay();
    expect(run.result.rebuilt).toBe(true);
    // Three processes, in this order, and the third is the enrichment half.
    expect(run.spawns.map((argv) => argv[0])).toEqual(['context', 'maintain', 'cover']);
    expect(run.spawns[2]).toEqual(recordedArgv('plan3-2-cover.argv.json'));
  });
});

// ---------------------------------------------------------------------------
// The recorded Kane-side failure (R2.10, R5.3)
// ---------------------------------------------------------------------------

describe('the recorded reconciliation Kane itself failed (R2.10)', () => {
  it('reports the failure verbatim, holds no card and rebuilds nothing', async () => {
    const run = await replay({ plan: PLAN_ERROR, planExit: 1 });
    const doc = run.result.docs[0];

    // A real failure from a real run: the graph data plane gave up mid-reconcile.
    // It is recorded rather than smoothed over, because that is data (R2.10).
    expect(doc?.invoked).toBe(true);
    expect(doc?.terminalSeen).toBe(true);
    expect(doc?.status).toBe('error');
    expect(doc?.accepted).toBe(false);
    expect(doc?.headMoved).toBe(false);
    expect(doc?.message).toContain('search_similar_batch');

    expect(run.result.reviewCards).toEqual([]);
    expect(cardPaths(run.files)).toEqual([]);
    expect(run.result.rebuilt).toBe(false);
    expect(run.files.get(STATE_PATH)).toBe(PRIOR_BYTES);
    expect(run.result.diagnostics.map((entry) => entry.code)).toContain(
      RECONCILE_DIAGNOSTIC_CODES.refused,
    );
  });
});

// ---------------------------------------------------------------------------
// The negative case: no source, no process (§13.2.2)
// ---------------------------------------------------------------------------

describe('a source that is not there costs no process (§13.2.2)', () => {
  it('spawns only the listing, writes no card and moves no verdict', async () => {
    const run = await replay({ listing: NO_STORE, listingExit: 2 });
    const doc = run.result.docs[0];

    // One process: the listing that told us there is no store. `maintain reconcile`
    // is not reachable without a resolved id, so this is structural rather than
    // guarded — `reconcileArgv` answers null on every failure arm.
    expect(run.spawns).toHaveLength(1);
    expect(run.spawns.map((argv) => argv[0])).toEqual(['context']);
    expect(doc?.invoked).toBe(false);
    expect(doc?.argv).toEqual([]);
    expect(doc?.sourceId).toBeNull();
    expect(doc?.refusal?.reason).toBe('no-store');
    // Kane's own remedy, quoted rather than paraphrased.
    expect(doc?.refusal?.diagnostic.message).toContain('context ingest');

    // No card, no state write, no verdict movement, and `degraded` still false —
    // an unresolved source lost no proven data (R5.3, §14.1).
    expect(run.result.reviewCards).toEqual([]);
    expect(cardPaths(run.files)).toEqual([]);
    expect(run.result.rebuilt).toBe(false);
    expect(run.files.get(STATE_PATH)).toBe(PRIOR_BYTES);
    expect(serialiseState(run.result.state)).toBe(PRIOR_BYTES);
    expect(run.result.state.graph.promises.map((record) => record.verdict)).toEqual([
      'proven',
      'proven',
    ]);
    expect(run.result.state.freshness).toEqual(PRIOR.freshness);
    expect(run.result.state.graph.degraded).toBe(false);
  });
});
