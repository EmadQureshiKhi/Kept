import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FORK_GUARD_DIAGNOSTIC_CODE,
  FORK_GUARD_RUNGS,
  HANDOFF_DIAGNOSTIC_CODES,
  HANDOFF_FILE_RELATIVE_PATH,
  KaneInvoker,
  LADDER_RUNGS,
  SOURCES_CACHE_SCHEMA_VERSION,
  SOURCE_DIAGNOSTIC_CODES,
  SOURCE_REASON_DIAGNOSTIC_CODE,
  SOURCE_RESOLUTION_REASONS,
  SOURCE_RESOLUTION_VIA,
  createDiagnosticSink,
  createKeptState,
  createPromiseGraph,
  createPromiseRecord,
  forkGuard,
  handoffPaths,
  inMemorySourceCacheFileSystem,
  isHandoffFile,
  parseHandoff,
  resolveSourceIdCached,
  serialiseSourcesCache,
  serialiseState,
  sourceDigest,
  sourcesCachePath,
  sourcesListingSignature,
  writeHandoff,
  type CachedSourceResolution,
  type ChildProcessLike,
  type CollectingDiagnosticSink,
  type Diagnostic,
  type HandoffFile,
  type KeptState,
  type PromiseRecord,
  type SourceResolution,
  type SourcesCache,
  type StoreSource,
} from '@kept/core';

/**
 * Task 12.5 — the structural test for the docs branch that was previously dead
 * (design §13.2.2, §13.2.4, §14.1, R5.1, R5.2, R5.3, R5.7).
 *
 * ## What this suite is for, and how it differs from the two beside it
 *
 * `context-sources-ladder.test.ts` proves the ladder *decides* correctly and
 * `context-sources-listing.test.ts` proves the listing is *read* correctly. This
 * one proves the thing neither of them can: that every way resolution can fail is
 * a **no-op by structure**.
 *
 * `kane-cli maintain reconcile` requires both `--from <file>` and `--source-id
 * <id>`. An earlier version of the design issued it bare, which would have exited
 * two on every single save while looking perfectly wired up — a docs branch that
 * was silently dead. The correction is not discipline, it is a type:
 * `--source-id` can only be built from the `ok: true` arm of
 * {@link SourceResolution}, so an unresolved source is not *expressible* as an
 * argv. {@link reconcileArgv} below is that fact written as a function, and every
 * failure rung asserts it answers `null`.
 *
 * So each rung of the table is checked against all six steps of §13.2.2, at the
 * level `kept-core` reaches today:
 *
 * | step | asserted here as |
 * |---|---|
 * | 1. a diagnostic | the reason's own code, from `SOURCE_REASON_DIAGNOSTIC_CODE` |
 * | 2. **no spawn** | the recording stub saw no argv containing `reconcile`, and no argv is constructible from the resolution |
 * | 3. no review card | no `results` reach the handoff, so `nextAction.artefact` is null |
 * | 4. verdicts and freshness unchanged | the prior state is the same object *and* the same bytes, and `outcome.verdictsPermitted` is false because there is no run for `mayWriteVerdicts` to admit |
 * | 5. handoff with `branch: null` | written through the real `writeHandoff`, read back through `isHandoffFile` |
 * | 6. exit 0 | {@link RECONCILE_REFUSAL_EXIT_CODE}, the one value §14.1 allows every one of these rows |
 *
 * And `degraded` stays **false** on every one of them (R5.3). That is the clause
 * most easily broken by reflex: `degraded` reports that the *proven axis* is
 * untrustworthy, and an unresolved source loses no proven data at all — the
 * baseline graph and every prior verdict are intact.
 *
 * ## What is left for 12.6
 *
 * `kept reconcile --changed` does not exist yet; it is task 12.6. So the no-spawn
 * guarantee is asserted here at the level this package can reach: the `ok: false`
 * arm of a real `resolveSourceId`/`resolveSourceIdCached` call over the committed
 * fixture, the fact that no argv can be constructed from it, and the fact that the
 * only process any of these paths starts is the listing itself.
 * {@link reconcileRefusal} is a deliberately thin stand-in for the command's six
 * steps, and {@link FAILURE_RUNGS} is the table 12.6 extends: when the real
 * command lands it drives the same table with the same expectations and adds the
 * assertions only it can make — the process-level `spawns` of `maintain
 * reconcile`, the CLI's own exit code, and the review-card directory staying
 * empty. Nothing here needs rewriting for that.
 *
 * Nothing in this file starts a Kane process or writes a byte to disk.
 */

const REPO = '/repo';
const BIN = '/stub/bin/kane-cli';
const CACHE_PATH = sourcesCachePath(REPO);
const AT = '2026-08-20T18:40:11.000Z';
const NOW_MS = Date.parse('2026-08-20T18:40:00.000Z');

/**
 * The exit code §14.1 gives every reconcile refusal row: **0**.
 *
 * `kept`'s exit code reports whether KEPT worked, never whether the product
 * passed (§14.2). Kane's own exit two is data. The single case where `kept` itself
 * exits non-zero is `--plan` together with `--apply`, which is a usage error
 * rejected before any spawn — and it is 12.7's, not this table's.
 */
const RECONCILE_REFUSAL_EXIT_CODE = 0;

const FIXTURES = new URL('./fixtures/', import.meta.url);

function fixtureLines(name: string): readonly string[] {
  return readFileSync(new URL(name, FIXTURES), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
}

const LISTING_LINES = fixtureLines('context-list-sources.ndjson');
const REFUSED_LINES = fixtureLines('assurance-cover-refused.ndjson');
/** The listing fixture truncated before its `done` event. */
const CRASHED_LINES = [LISTING_LINES[0] as string, LISTING_LINES[1] as string];
/** An empty store: it said something, so the honest answer is the ingest remedy. */
const EMPTY_STORE_LINES = [
  '{"type":"sources","v":1,"verb":"context list","total":0,"sources":[]}',
  '{"type":"done","v":1,"verb":"context list","status":"complete","exit_code":0}',
];

const BYTES = {
  readme: '# Fixture storefront\n',
  checkout: '# Checkout use case\n',
  pricing: '# Pricing\n',
  shop: 'export default function ShopPage() {}\n',
} as const;

// ---------------------------------------------------------------------------
// The seam that would spawn, if anything could
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
      this.emitClose(null);
    });
    return true;
  }

  emitClose(code: number | null): void {
    for (const listener of this.listeners.get('close') ?? []) listener(code, null);
  }

  asChild(): ChildProcessLike {
    return this as unknown as ChildProcessLike;
  }
}

interface Stub {
  readonly invoker: KaneInvoker;
  readonly spawns: string[][];
}

/**
 * A recording invoker. `spawns` is the whole point of it: an argv this stub was
 * never asked for is a process that never started, and the table below asserts
 * that no argv naming `reconcile` ever reaches it.
 */
function stub(
  options: {
    readonly lines?: readonly string[];
    readonly exitCode?: number | null;
    readonly binary?: string | null;
  } = {},
): Stub {
  const spawns: string[][] = [];
  const invoker = new KaneInvoker({
    sink: createDiagnosticSink(),
    resolveBinary: () => (options.binary === null ? null : (options.binary ?? BIN)),
    spawn: (_command, args) => {
      spawns.push([...args]);
      const child = new FakeChild();
      queueMicrotask(() => {
        for (const line of options.lines ?? LISTING_LINES) child.stdout.emit(`${line}\n`);
        child.emitClose(options.exitCode ?? 0);
      });
      return child.asChild();
    },
  });
  return { invoker, spawns };
}

// ---------------------------------------------------------------------------
// The argv, and the reason it cannot exist without a resolved source
// ---------------------------------------------------------------------------

/**
 * The invocation of §13.2.1, composed the only way it can be composed.
 *
 * `resolution.source.sourceId` is reachable on the `ok: true` arm and on no other,
 * so the early return is not a guard a future refactor could "helpfully" drop —
 * there is nothing to fall back to. This is the shape 12.6 issues; the NDJSON
 * enabler is appended by the invoker from the Assurance contract and is never
 * written at a call site.
 */
function reconcileArgv(resolution: SourceResolution, file: string): readonly string[] | null {
  if (!resolution.ok) return null;
  return ['maintain', 'reconcile', '--from', file, '--source-id', resolution.source.sourceId, '--plan'];
}

// ---------------------------------------------------------------------------
// The state that must not move
// ---------------------------------------------------------------------------

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

/** A repository with two proven promises and a consumed terminal event. */
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
// The six steps, as far as kept-core reaches
// ---------------------------------------------------------------------------

/** What one refusal produced. Everything §13.2.2 step 1 to 6 can be read from. */
interface RefusalRun {
  readonly exitCode: number;
  readonly handoff: HandoffFile;
  /** The state, by reference. A refusal returns the prior one and writes nothing. */
  readonly state: KeptState;
  readonly files: Map<string, string>;
}

/**
 * The six steps of §13.2.2 for a resolution that failed.
 *
 * Deliberately thin, and deliberately unable to do the one thing that would make
 * it a lie: it takes a {@link SourceResolution} and never a source id, so it
 * cannot invoke anything, and it takes the prior state and hands it back by
 * reference rather than rebuilding it. Task 12.6 replaces this with the real
 * command; the assertions it feeds do not change.
 */
function reconcileRefusal(options: {
  readonly runId: string;
  readonly file: string;
  readonly diagnostics: readonly Diagnostic[];
}): RefusalRun {
  const fileSystem = inMemorySourceCacheFileSystem();
  const written = writeHandoff({
    runId: options.runId,
    at: AT,
    repoRoot: REPO,
    fileSystem,
    trigger: { hook: 'kept-docs-reconcile', event: 'fileEdited', paths: [options.file] },
    // The family is recorded so `/runs` can say what *would* have run; `invoked`
    // is false because nothing did, and `argv` is empty because none exists.
    command: { family: 'Assurance', argv: [], invoked: false },
    diagnostics: options.diagnostics,
    // No `run`, no `results`: no process started, so there is no outcome to gate
    // and no repair to authorise.
  });
  return {
    exitCode: RECONCILE_REFUSAL_EXIT_CODE,
    handoff: written.handoff,
    state: PRIOR,
    files: fileSystem.files,
  };
}

// ---------------------------------------------------------------------------
// Driving the resolution
// ---------------------------------------------------------------------------

interface Attempt {
  readonly resolution: SourceResolution;
  readonly outcome: CachedSourceResolution;
  readonly spawns: readonly string[][];
  readonly sink: CollectingDiagnosticSink;
}

function source(parts: {
  readonly sourceId: string;
  readonly path?: string | null;
  readonly digest?: string | null;
  readonly retired?: boolean;
}): StoreSource {
  const path = parts.path ?? null;
  return {
    sourceId: parts.sourceId,
    path,
    absPath: path === null ? null : resolve(REPO, path),
    digest: parts.digest ?? null,
    retired: parts.retired ?? false,
    raw: { source_id: parts.sourceId },
  };
}

/** Resolve through the read-through cache: the door `kept reconcile` knocks on. */
async function attempt(options: {
  readonly file: string;
  readonly lines?: readonly string[];
  readonly exitCode?: number | null;
  readonly binary?: string | null;
  readonly fileDigest?: string | null;
  readonly cache?: SourcesCache;
  readonly mtimeMs?: number;
}): Promise<Attempt> {
  const kane = stub({
    ...(options.lines === undefined ? {} : { lines: options.lines }),
    ...(options.exitCode === undefined ? {} : { exitCode: options.exitCode }),
    ...(options.binary === undefined ? {} : { binary: options.binary }),
  });
  const fileSystem = inMemorySourceCacheFileSystem(
    options.cache === undefined ? {} : { [CACHE_PATH]: serialiseSourcesCache(options.cache) },
    options.mtimeMs === undefined ? {} : { [resolve(REPO, options.file)]: options.mtimeMs },
  );
  const sink = createDiagnosticSink();
  const outcome = await resolveSourceIdCached({
    repoRoot: REPO,
    file: options.file,
    invoker: kane.invoker,
    diagnostics: sink,
    fileSystem,
    mtimeMs: fileSystem.mtimeMs,
    now: () => NOW_MS,
    fileDigest: options.fileDigest ?? null,
  });
  return { resolution: outcome.resolution, outcome, spawns: kane.spawns, sink };
}

function resolvedVia(attempted: Attempt): { readonly sourceId: string; readonly via: string } {
  const { resolution } = attempted;
  if (!resolution.ok) {
    throw new Error(`expected a resolved source, got reason '${resolution.reason}'`);
  }
  return { sourceId: resolution.source.sourceId, via: resolution.via };
}

// ---------------------------------------------------------------------------
// One case per rung, through the door that has five of them
// ---------------------------------------------------------------------------

describe('every rung reports itself, cache included (§13.2.2)', () => {
  it('answers via cache when a recorded resolution is honoured', async () => {
    const readme = source({
      sourceId: 'src_7f31c0a4',
      path: 'apps/fixture/README.md',
      digest: sourceDigest(BYTES.readme),
    });
    const cache: SourcesCache = {
      schemaVersion: SOURCES_CACHE_SCHEMA_VERSION,
      refreshedAt: new Date(NOW_MS - 60_000).toISOString(),
      listingSignature: sourcesListingSignature([readme]),
      sources: [readme],
      byPath: {
        'apps/fixture/README.md': {
          sourceId: 'src_7f31c0a4',
          via: 'exact-path',
          digest: readme.digest,
          resolvedAt: new Date(NOW_MS - 60_000).toISOString(),
        },
      },
    };
    const attempted = await attempt({
      file: 'apps/fixture/README.md',
      cache,
      mtimeMs: NOW_MS - 120_000,
    });
    expect(resolvedVia(attempted)).toEqual({ sourceId: 'src_7f31c0a4', via: 'cache' });
    // The rung in front of the ladder costs no process at all.
    expect(attempted.spawns).toEqual([]);
  });

  it('answers each of the four ladder rungs over the committed listing', async () => {
    const cases: readonly {
      readonly via: string;
      readonly file: string;
      readonly sourceId: string;
      readonly fileDigest?: string;
    }[] = [
      { via: 'exact-path', file: 'apps/fixture/README.md', sourceId: 'src_7f31c0a4' },
      { via: 'abs-path', file: 'apps/fixture/app/settings/page.tsx', sourceId: 'src_2f6c1d90' },
      {
        via: 'digest',
        file: 'apps/fixture/docs/moved-checkout.md',
        sourceId: 'src_1b9d5e22',
        fileDigest: sourceDigest(BYTES.checkout),
      },
      { via: 'unique-basename', file: 'apps/fixture/docs/currency.md', sourceId: 'src_5e8b03df' },
    ];
    expect(cases.map((testCase) => testCase.via)).toEqual([...LADDER_RUNGS]);

    for (const testCase of cases) {
      const attempted = await attempt({
        file: testCase.file,
        ...(testCase.fileDigest === undefined ? {} : { fileDigest: testCase.fileDigest }),
      });
      expect(resolvedVia(attempted), testCase.via).toEqual({
        sourceId: testCase.sourceId,
        via: testCase.via,
      });
      // Exactly one process: the listing. Never a second one, never a reconcile.
      expect(attempted.spawns).toHaveLength(1);
      expect(attempted.spawns[0]).toEqual([
        'context',
        'list',
        '--type',
        'source',
        '--json',
        '--mode',
        'agent',
      ]);
      // And this is the arm — the only arm — an argv can be built from.
      const argv = reconcileArgv(attempted.resolution, testCase.file);
      expect(argv).not.toBeNull();
      expect(argv).toEqual([
        'maintain',
        'reconcile',
        '--from',
        testCase.file,
        '--source-id',
        testCase.sourceId,
        '--plan',
      ]);
      expect(argv).not.toContain('--apply');
    }
  });

  it('covers the whole via vocabulary between the cache and the ladder', () => {
    expect([...SOURCE_RESOLUTION_VIA]).toEqual(['cache', ...LADDER_RUNGS]);
  });
});

// ---------------------------------------------------------------------------
// Every failure rung: no spawn, nothing moved, a handoff, exit 0
// ---------------------------------------------------------------------------

/**
 * One rung of §13.2.2's failure vocabulary and how to reach it.
 *
 * The table is the extension point. Task 12.6 drives it with the real `kept
 * reconcile --changed` and adds the assertions only a command can make; nothing
 * below has to change for that.
 */
interface FailureRung {
  readonly reason: (typeof SOURCE_RESOLUTION_REASONS)[number];
  readonly file: string;
  readonly arrange: Parameters<typeof attempt>[0];
  /** Whether reaching this rung is expected to start the listing process. */
  readonly listingSpawns: number;
}

const FAILURE_RUNGS: readonly FailureRung[] = [
  {
    reason: 'no-store',
    file: 'apps/fixture/README.md',
    // The live path in this repository today: no `.context/` store exists yet, and
    // a refusal is a *complete* stream carrying its own remedy (§5.3.1).
    arrange: { file: 'apps/fixture/README.md', lines: REFUSED_LINES, exitCode: 2 },
    listingSpawns: 1,
  },
  {
    reason: 'listing-unreadable',
    file: 'apps/fixture/README.md',
    arrange: { file: 'apps/fixture/README.md', binary: null },
    listingSpawns: 0,
  },
  {
    reason: 'crashed-stream',
    file: 'apps/fixture/README.md',
    arrange: { file: 'apps/fixture/README.md', lines: CRASHED_LINES },
    listingSpawns: 1,
  },
  {
    reason: 'no-match',
    file: 'apps/fixture/README.md',
    arrange: { file: 'apps/fixture/README.md', lines: EMPTY_STORE_LINES },
    listingSpawns: 1,
  },
  {
    reason: 'ambiguous',
    // Entries four and five of the fixture: one file, two live sources.
    file: 'apps/fixture/app/shop/page.tsx',
    arrange: { file: 'apps/fixture/app/shop/page.tsx' },
    listingSpawns: 1,
  },
  {
    reason: 'retired',
    file: 'apps/fixture/docs/pricing.md',
    arrange: { file: 'apps/fixture/docs/pricing.md' },
    listingSpawns: 1,
  },
];

describe('the failure vocabulary is complete, so no rung can be added untested', () => {
  it('covers every reason §13.2.2 defines, once each', () => {
    expect(FAILURE_RUNGS.map((rung) => rung.reason)).toEqual([...SOURCE_RESOLUTION_REASONS]);
  });
});

for (const rung of FAILURE_RUNGS) {
  describe(`the ${rung.reason} rung is a no-op by structure (§13.2.2, §14.1)`, () => {
    it('answers its own reason and its own diagnostic code', async () => {
      const attempted = await attempt(rung.arrange);
      expect(attempted.resolution.ok).toBe(false);
      if (attempted.resolution.ok) return;
      expect(attempted.resolution.reason).toBe(rung.reason);
      expect(attempted.resolution.diagnostic.code).toBe(SOURCE_REASON_DIAGNOSTIC_CODE[rung.reason]);
      expect(attempted.sink.entries).toContainEqual(attempted.resolution.diagnostic);
    });

    it('spawns no maintain reconcile, and no second process either', async () => {
      const attempted = await attempt(rung.arrange);
      // Step 2 of §13.2.2, as a fact about the process boundary.
      expect(attempted.spawns.filter((argv) => argv.includes('reconcile'))).toEqual([]);
      expect(attempted.spawns.filter((argv) => argv.includes('maintain'))).toEqual([]);
      // And the only thing that may run is the listing itself, at most once.
      expect(attempted.spawns).toHaveLength(rung.listingSpawns);
      for (const argv of attempted.spawns) expect(argv[0]).toBe('context');
    });

    it('yields no argv at all, because there is no id to put in one', async () => {
      const { resolution } = await attempt(rung.arrange);
      expect(reconcileArgv(resolution, rung.file)).toBeNull();
      // The failure arm carries a reason and a diagnostic and no `source`, so a
      // caller cannot reach a `--source-id` even by ignoring `ok`. That is what
      // makes this a no-op by structure rather than by discipline (§13.2).
      expect(Object.keys(resolution).sort()).toEqual(['diagnostic', 'ok', 'reason']);
      expect('source' in resolution).toBe(false);
    });

    it('moves no verdict, no freshness, and does not set degraded', async () => {
      const { resolution } = await attempt(rung.arrange);
      expect(resolution.ok).toBe(false);
      if (resolution.ok) return;
      const run = reconcileRefusal({
        runId: `rc_${rung.reason}`,
        file: rung.file,
        diagnostics: [resolution.diagnostic],
      });

      // The prior state, by reference and by bytes: nothing rebuilt it, and a
      // future refactor that does still has to keep every value.
      expect(run.state).toBe(PRIOR);
      expect(serialiseState(run.state)).toBe(PRIOR_BYTES);
      expect(run.state.freshness).toEqual(PRIOR.freshness);
      expect(run.state.graph.promises.map((record) => record.verdict)).toEqual([
        'proven',
        'proven',
      ]);
      // R5.3: no proven data was lost, so `degraded` stays false. This is the
      // clause reflex breaks — every *other* adversity row of §14.1 sets it.
      expect(run.state.graph.degraded).toBe(false);
      expect(run.state.graph.degradedReasons).toEqual([]);
      // There is no run for the write guard to admit, so no verdict could have
      // been written even if a caller had tried.
      expect(run.handoff.outcome.verdictsPermitted).toBe(false);
      expect(run.handoff.outcome.exitMeaning).toBeNull();
      expect(run.handoff.outcome.terminalSeen).toBe(false);
    });

    it('writes a handoff with branch null, the reason first, and no review card', async () => {
      const { resolution } = await attempt(rung.arrange);
      expect(resolution.ok).toBe(false);
      if (resolution.ok) return;
      const run = reconcileRefusal({
        runId: `rc_${rung.reason}`,
        file: rung.file,
        diagnostics: [resolution.diagnostic],
      });

      expect(run.handoff.nextAction.branch).toBeNull();
      // Step 3: nothing was produced, so R5.7 is trivially satisfied and there is
      // no artefact to hold.
      expect(run.handoff.nextAction.artefact).toBeNull();
      expect(run.handoff.nextAction.autonomy).toBe('none');
      expect(run.handoff.results).toEqual([]);
      // The invariant `writeHandoff` guarantees: a null branch always carries a
      // reason, and the module's reason stays first.
      expect(run.handoff.diagnostics.length).toBeGreaterThan(0);
      expect(run.handoff.diagnostics[0]).toEqual(resolution.diagnostic);
      expect(run.handoff.diagnostics.map((entry) => entry.code)).toContain(
        HANDOFF_DIAGNOSTIC_CODES.noInvocation,
      );
      expect(run.handoff.command.invoked).toBe(false);
      expect(run.handoff.command.argv).toEqual([]);

      // Both files land, and the newest one reads back as a handoff.
      const paths = handoffPaths(REPO, `rc_${rung.reason}`);
      expect(run.files.has(paths.newest)).toBe(true);
      expect(run.files.has(paths.archive)).toBe(true);
      const readBack = parseHandoff(run.files.get(paths.newest) as string);
      expect(readBack).not.toBeNull();
      expect(isHandoffFile(readBack)).toBe(true);
      expect(HANDOFF_FILE_RELATIVE_PATH).toBe('.kept/handoff.json');
    });

    it('exits 0, because Kane’s refusal is data and KEPT worked', async () => {
      const { resolution } = await attempt(rung.arrange);
      expect(resolution.ok).toBe(false);
      if (resolution.ok) return;
      const run = reconcileRefusal({
        runId: `rc_${rung.reason}`,
        file: rung.file,
        diagnostics: [resolution.diagnostic],
      });
      expect(run.exitCode).toBe(0);
    });
  });
}

// ---------------------------------------------------------------------------
// The cache-crash case: a hiccup must not turn the branch into a no-op
// ---------------------------------------------------------------------------

describe('a crashed refresh honours the previous entry, so the branch still runs', () => {
  const shop = source({
    sourceId: 'src_44e1ba07',
    path: 'apps/fixture/app/shop/page.tsx',
    digest: sourceDigest(BYTES.shop),
  });
  const readme = source({
    sourceId: 'src_7f31c0a4',
    path: 'apps/fixture/README.md',
    digest: sourceDigest(BYTES.readme),
  });

  function cacheWith(sources: readonly StoreSource[], path: string, sourceId: string): SourcesCache {
    // Recorded outside the ten-minute window on purpose: this is the stale entry
    // §13.2.2 says to honour anyway when the refresh fails.
    const resolvedAt = new Date(NOW_MS - 700_000).toISOString();
    return {
      schemaVersion: SOURCES_CACHE_SCHEMA_VERSION,
      refreshedAt: resolvedAt,
      listingSignature: sourcesListingSignature(sources),
      sources,
      byPath: { [path]: { sourceId, via: 'exact-path', digest: null, resolvedAt } },
    };
  }

  it('resolves via cache and yields a real argv, rather than nothing', async () => {
    const attempted = await attempt({
      file: 'apps/fixture/README.md',
      cache: cacheWith([readme], 'apps/fixture/README.md', 'src_7f31c0a4'),
      // The document was just saved, so the refresh had to happen — and it crashed.
      mtimeMs: NOW_MS - 1_000,
      lines: CRASHED_LINES,
    });

    expect(resolvedVia(attempted)).toEqual({ sourceId: 'src_7f31c0a4', via: 'cache' });
    expect(attempted.outcome.honouredStaleEntry).toBe(true);
    expect(attempted.outcome.wrote).toBe(false);
    // This is the point of the rule: the docs branch is **not** a no-op here.
    expect(reconcileArgv(attempted.resolution, 'apps/fixture/README.md')).toEqual([
      'maintain',
      'reconcile',
      '--from',
      'apps/fixture/README.md',
      '--source-id',
      'src_7f31c0a4',
      '--plan',
    ]);
  });

  it('still refuses when the crash leaves no entry to honour', async () => {
    const attempted = await attempt({
      file: 'apps/fixture/README.md',
      cache: cacheWith([shop], 'apps/fixture/app/shop/page.tsx', 'src_44e1ba07'),
      mtimeMs: NOW_MS - 1_000,
      lines: CRASHED_LINES,
    });
    expect(attempted.resolution.ok).toBe(false);
    if (attempted.resolution.ok) return;
    expect(attempted.resolution.reason).toBe('crashed-stream');
    expect(reconcileArgv(attempted.resolution, 'apps/fixture/README.md')).toBeNull();
    expect(attempted.spawns.filter((argv) => argv.includes('reconcile'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The fork guard — check seven of §13.2.4
// ---------------------------------------------------------------------------

describe('the fork guard names both conflicting source ids (§13.2.4 #7)', () => {
  /** The fixture's duplicate pair: one file, two live sources. */
  const FORKED: readonly StoreSource[] = [
    source({
      sourceId: 'src_44e1ba07',
      path: 'apps/fixture/app/shop/page.tsx',
      digest: sourceDigest(BYTES.shop),
    }),
    source({
      sourceId: 'src_9c2d7f58',
      path: 'apps/fixture/app/shop/page.tsx',
      digest: sourceDigest(BYTES.shop),
    }),
  ];

  it('fires on a cached resolution, which the ladder never sees', () => {
    // A `byPath` hit bypasses the ladder entirely, so `ambiguous` cannot catch a
    // fork that appeared in the store after the entry was recorded. The guard is
    // the only thing that sees it.
    const sink = createDiagnosticSink();
    const result = forkGuard({
      repoRoot: REPO,
      file: 'apps/fixture/app/shop/page.tsx',
      sources: FORKED,
      fileDigest: sourceDigest(BYTES.shop),
      resolved: FORKED[0] as StoreSource,
      diagnostics: sink,
    });

    expect(result.forked).toBe(true);
    if (!result.forked) return;
    expect(result.conflicts.map((conflict) => conflict.source.sourceId)).toEqual(['src_9c2d7f58']);
    expect(result.diagnostic.code).toBe('reconcile-source-forked');
    expect(result.diagnostic.code).toBe(FORK_GUARD_DIAGNOSTIC_CODE);
    expect(result.diagnostic.severity).toBe('warn');
    // Both ids, which is the information a human needs to retire one of them.
    expect(result.diagnostic.message).toContain('src_44e1ba07');
    expect(result.diagnostic.message).toContain('src_9c2d7f58');
    expect(result.diagnostic.file).toBe('apps/fixture/app/shop/page.tsx');
    expect(sink.entries).toContainEqual(result.diagnostic);
  });

  it('fires when the rungs disagree, with nothing tied anywhere', () => {
    // First-hit-wins resolves this file on its unique path, and a *different* live
    // source records the same digest under another name. Nothing tied, so the
    // ladder is right to answer — and the file still backs two live sources.
    const sources: readonly StoreSource[] = [
      source({
        sourceId: 'src_bypath1',
        path: 'apps/fixture/README.md',
        digest: sourceDigest(BYTES.readme),
      }),
      source({
        sourceId: 'src_bydigest',
        path: 'apps/fixture/docs/copy-of-readme.md',
        digest: sourceDigest(BYTES.readme),
      }),
    ];
    const sink = createDiagnosticSink();
    const result = forkGuard({
      repoRoot: REPO,
      file: 'apps/fixture/README.md',
      sources,
      fileDigest: sourceDigest(BYTES.readme),
      resolved: sources[0] as StoreSource,
      diagnostics: sink,
    });
    expect(result.forked).toBe(true);
    if (!result.forked) return;
    expect(result.conflicts).toEqual([{ source: sources[1], rung: 'digest' }]);
    expect(result.diagnostic.message).toContain('src_bydigest');
  });

  it('does not fire on a retired duplicate, which cannot fork a graph', () => {
    const sources: readonly StoreSource[] = [
      FORKED[0] as StoreSource,
      { ...(FORKED[1] as StoreSource), retired: true },
    ];
    const result = forkGuard({
      repoRoot: REPO,
      file: 'apps/fixture/app/shop/page.tsx',
      sources,
      fileDigest: sourceDigest(BYTES.shop),
      resolved: sources[0] as StoreSource,
      diagnostics: createDiagnosticSink(),
    });
    // Retiring one of them is exactly how a human resolves a fork, so a retired
    // entry must not keep the refusal alive for ever.
    expect(result.forked).toBe(false);
  });

  it('does not fire on a shared basename, because that is not the same file', () => {
    // Two documents can share a filename. Refusing a save over that would be a
    // fuzzy match, which no rung is allowed to be.
    expect([...FORK_GUARD_RUNGS]).toEqual(['exact-path', 'abs-path', 'digest']);
    const sources: readonly StoreSource[] = [
      source({ sourceId: 'src_here001', path: 'apps/fixture/docs/pricing.md' }),
      source({ sourceId: 'src_there01', path: 'docs/adr/pricing.md' }),
    ];
    const result = forkGuard({
      repoRoot: REPO,
      file: 'apps/fixture/docs/pricing.md',
      sources,
      fileDigest: null,
      resolved: sources[0] as StoreSource,
      diagnostics: createDiagnosticSink(),
    });
    expect(result.forked).toBe(false);
  });

  it('is total over a listing that does not carry the resolved source at all', () => {
    // The cache-inconsistency case: not a fork, and handled by refreshing rather
    // than by refusing.
    const result = forkGuard({
      repoRoot: REPO,
      file: 'apps/fixture/docs/gone.md',
      sources: [],
      fileDigest: null,
      resolved: source({ sourceId: 'src_gone001', path: 'apps/fixture/docs/gone.md' }),
      diagnostics: createDiagnosticSink(),
    });
    expect(result.forked).toBe(false);
  });

  it('refuses the whole invocation the way every other rung does', async () => {
    // A fork takes the same six steps as §13.2.2's rungs: a diagnostic, no spawn,
    // no review card, verdicts and freshness untouched, `degraded` still false, a
    // handoff with `branch: null`, and exit 0. Kane's own exit two is data.
    const sink = createDiagnosticSink();
    const guard = forkGuard({
      repoRoot: REPO,
      file: 'apps/fixture/app/shop/page.tsx',
      sources: FORKED,
      fileDigest: sourceDigest(BYTES.shop),
      resolved: FORKED[0] as StoreSource,
      diagnostics: sink,
    });
    expect(guard.forked).toBe(true);
    if (!guard.forked) return;

    const run = reconcileRefusal({
      runId: 'rc_forked',
      file: 'apps/fixture/app/shop/page.tsx',
      diagnostics: [guard.diagnostic],
    });
    expect(run.exitCode).toBe(0);
    expect(run.handoff.nextAction.branch).toBeNull();
    expect(run.handoff.diagnostics[0]?.code).toBe(FORK_GUARD_DIAGNOSTIC_CODE);
    expect(run.handoff.command.invoked).toBe(false);
    expect(run.state).toBe(PRIOR);
    expect(serialiseState(run.state)).toBe(PRIOR_BYTES);
    expect(run.state.graph.degraded).toBe(false);

    // And the ladder itself, over the same listing, answers `ambiguous` — a
    // different refusal for a different question, with its own code.
    const attempted = await attempt({ file: 'apps/fixture/app/shop/page.tsx' });
    expect(attempted.resolution.ok).toBe(false);
    if (attempted.resolution.ok) return;
    expect(attempted.resolution.reason).toBe('ambiguous');
    expect(attempted.resolution.diagnostic.code).toBe(SOURCE_DIAGNOSTIC_CODES.ambiguous);
    expect(attempted.resolution.diagnostic.code).not.toBe(FORK_GUARD_DIAGNOSTIC_CODE);
  });
});
