import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  BaselineFileSystem,
  ChildProcessLike,
  CitationSource,
  CollectingDiagnosticSink,
  KeptState,
  PromiseRecord,
  SourceResolutionReason,
  StateFileSystem,
  StoreSource,
} from '@kept/core';
import {
  FIXTURE_DOC_GLOBS,
  FORK_GUARD_DIAGNOSTIC_CODE,
  HANDOFF_DIAGNOSTIC_CODES,
  HANDOFF_FILE_RELATIVE_PATH,
  KaneInvoker,
  SOURCES_CACHE_FILE_RELATIVE_PATH,
  SOURCES_CACHE_SCHEMA_VERSION,
  SOURCE_DIAGNOSTIC_CODES,
  SOURCE_REASON_DIAGNOSTIC_CODE,
  SOURCE_RESOLUTION_REASONS,
  STATE_FILE_RELATIVE_PATH,
  createDiagnosticSink,
  createKeptState,
  createPromiseGraph,
  createPromiseRecord,
  inMemoryBaselineFileSystem,
  inMemoryCitationSource,
  inMemorySourceCacheFileSystem,
  isHandoffFile,
  parseHandoff,
  serialiseSourcesCache,
  serialiseState,
  sourcesListingSignature,
} from '@kept/core';
import { describe, expect, it } from 'vitest';

import { EXIT_OK } from '../src/args.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { main } from '../src/main.js';
import {
  RECONCILE_CHECK_FOR_REASON,
  RECONCILE_DIAGNOSTIC_CODES,
  RECONCILE_INGESTABLE_EXTENSIONS,
  RECONCILE_LADDER_CHECKS,
  filterChangedDocs,
  isIngestablePath,
  reconcileArgv,
  reconcilePlanArgv,
  runReconcile,
} from '../src/commands/reconcile.js';

/**
 * Task 12.6 — `kept reconcile --changed <p…>`, the corrected docs branch
 * (design §13.2, §13.2.1–§13.2.4, §14.1, R5.1–R5.8, R2.10).
 *
 * This suite is the command-level half of a pair. `kept-core`'s
 * `context-sources-ladder-structural.test.ts` already drives a six-row failure
 * table and asserts, per rung, the reason code, that no argv is constructible,
 * that the prior state is identical by reference and by bytes, that `degraded`
 * stays false, that a real handoff lands with `branch: null`, and that the
 * refusal's exit code is zero. Its header names exactly what is left for this
 * task: **the same table, driven by the real command, plus the three assertions
 * only a command can make** —
 *
 *   1. the *process-level* spawns: no argv naming `maintain reconcile` ever
 *      reaches the child-process seam;
 *   2. the CLI's own exit code, taken from `main` rather than from a constant;
 *   3. the review-card directory staying empty.
 *
 * Nothing here starts a Kane process: the spawn seam is a recording stub and the
 * NDJSON comes from the committed fixtures of task 2.10 wherever one exists. And
 * nothing here writes a byte to disk — state, the source cache, both handoff
 * files and the snapshot all go through one in-memory filesystem.
 *
 * `repoRoot` is the **real** workspace root, deliberately. Ladder check 3 is an
 * `fs.stat` before any spawn, and pointing the command at a repository whose
 * `apps/fixture/README.md` genuinely exists is what lets every row of the failure
 * table exercise the *resolution* rungs rather than tripping over a missing file
 * first. Writes are still injected, so the working tree is only ever read.
 */
const REPO = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/+$/, '');
const AT = '2026-08-20T18:41:02.118Z';
const NOW_MS = Date.parse(AT);

/** The one document the docs hook fires on, and it is really there. */
const README = 'apps/fixture/README.md';

const STATE_PATH = `${REPO}/${STATE_FILE_RELATIVE_PATH}`;
const HANDOFF_PATH = `${REPO}/${HANDOFF_FILE_RELATIVE_PATH}`;
const CACHE_PATH = `${REPO}/${SOURCES_CACHE_FILE_RELATIVE_PATH}`;
const REVIEW_CARDS_DIR = `${REPO}/.kept/review-cards`;

const FIXTURES = new URL('../../kept-core/test/fixtures/', import.meta.url);

function fixtureLines(name: string): readonly string[] {
  return readFileSync(new URL(name, FIXTURES), 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0);
}

/** The committed listing: seven entries, `apps/fixture/README.md` among them. */
const LISTING = fixtureLines('context-list-sources.ndjson');
/** The verified refusal envelope: a **complete** stream, not a crash (§5.3.1). */
const REFUSED = fixtureLines('assurance-cover-refused.ndjson');
/** A reconcile that paused with a staged card and exit 3 (R5.4). */
const PAUSED = fixtureLines('assurance-paused.ndjson');
/** `cover --json`, so the gated graph rebuild has something to consume. */
const COVER_DONE = fixtureLines('assurance-cover-done.ndjson');

/** The listing fixture truncated before its `done` event. */
const LISTING_CRASHED = [LISTING[0] as string, LISTING[1] as string];

/**
 * An empty store: it *said* something, so the honest answer is `no-match` and the
 * `context ingest` remedy. Composed here rather than committed because there is
 * no capture of an empty store and inventing a file would imply there is.
 */
const EMPTY_STORE = [
  '{"type":"sources","v":1,"verb":"context list","total":0,"sources":[]}',
  '{"type":"done","v":1,"verb":"context list","status":"complete","exit_code":0}',
];

/** One listing entry, as the wire spells it. */
function entry(parts: {
  readonly id: string;
  readonly path: string;
  readonly retired?: boolean;
}): string {
  return JSON.stringify({
    source_id: parts.id,
    path: parts.path,
    retired: parts.retired ?? false,
  });
}

/** A listing carrying exactly these entries, in the committed envelope's shape. */
function listingOf(entries: readonly string[]): readonly string[] {
  return [
    `{"type":"sources","v":1,"verb":"context list","total":${entries.length},"sources":[${entries.join(
      ',',
    )}]}`,
    '{"type":"done","v":1,"verb":"context list","status":"complete","exit_code":0}',
  ];
}

/** Two live sources for one document: the ladder cannot choose, so `ambiguous`. */
const AMBIGUOUS_LISTING = listingOf([
  entry({ id: 'src_readme01', path: README }),
  entry({ id: 'src_readme02', path: README }),
]);

/** The document's only match is retired, so it is never handed to Kane (check 6). */
const RETIRED_LISTING = listingOf([entry({ id: 'src_readme01', path: README, retired: true })]);

/** One projected listing entry, as `.kept/sources.json` stores it. */
function storeSource(parts: {
  readonly sourceId: string;
  readonly path: string;
  readonly retired?: boolean;
}): StoreSource {
  return {
    sourceId: parts.sourceId,
    path: parts.path,
    absPath: resolve(REPO, parts.path),
    digest: null,
    retired: parts.retired ?? false,
    raw: { source_id: parts.sourceId },
  };
}

/**
 * A cache whose recorded resolution names one id while its listing carries a
 * **second** live entry backed by the same document.
 *
 * This is the only way to reach check 7 through the command: a `byPath` hit
 * bypasses the ladder, so `ambiguous` never fires and the fork guard is the sole
 * thing standing between a head move and a forked graph (§13.2.4 #7).
 */
const FORKED_SOURCES: readonly StoreSource[] = [
  storeSource({ sourceId: 'src_readme01', path: README }),
  storeSource({ sourceId: 'src_readme02', path: README }),
];

const FORKED_CACHE = serialiseSourcesCache({
  schemaVersion: SOURCES_CACHE_SCHEMA_VERSION,
  refreshedAt: new Date(NOW_MS - 60_000).toISOString(),
  listingSignature: sourcesListingSignature(FORKED_SOURCES),
  sources: FORKED_SOURCES,
  byPath: {
    [README]: {
      sourceId: 'src_readme01',
      via: 'exact-path',
      digest: null,
      resolvedAt: new Date(NOW_MS - 60_000).toISOString(),
    },
  },
});

/** A reconcile stream that completed. Modelled on the paused fixture's envelope. */
const RECONCILE_DONE = [
  '{"step":"maintain.reconcile","status":"running","remark":"moving the source head"}',
  `{"type":"review_card","v":1,"verb":"reconcile","id":"rc_01M0EF9YB4","kind":"claim_added",` +
    `"path":"${README}","line":9,"summary":"a new claim has no designed test"}`,
  '{"type":"done","v":1,"verb":"reconcile","status":"complete","exit_code":0,' +
    '"message":"1 change staged into the stored plan"}',
];

// ---------------------------------------------------------------------------
// The state that must not move
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
// The seam that would spawn
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
      this.close(null);
    });
    return true;
  }
  close(code: number | null): void {
    for (const listener of this.listeners.get('close') ?? []) listener(code, null);
  }
  asChild(): ChildProcessLike {
    return this as unknown as ChildProcessLike;
  }
}

interface Stub {
  readonly invoker: KaneInvoker;
  /** Every argv the stub was asked for, enabler included. The whole point. */
  readonly spawns: string[][];
}

interface StubOptions {
  readonly listing?: readonly string[];
  readonly listingExit?: number | null;
  readonly reconcile?: readonly string[];
  readonly reconcileExit?: number | null;
  readonly cover?: readonly string[];
  readonly binary?: string | null;
}

/**
 * A recording invoker that answers by verb, so one stub serves the listing, the
 * reconcile and the `cover` run of a gated rebuild.
 */
function stub(options: StubOptions = {}): Stub {
  const spawns: string[][] = [];
  const invoker = new KaneInvoker({
    sink: createDiagnosticSink(),
    resolveBinary: () => (options.binary === null ? null : (options.binary ?? '/stub/bin/kane-cli')),
    spawn: (_command, args) => {
      spawns.push([...args]);
      const child = new FakeChild();
      const isListing = args[0] === 'context';
      const isCover = args[0] === 'cover';
      const lines = isListing
        ? (options.listing ?? LISTING)
        : isCover
          ? (options.cover ?? COVER_DONE)
          : (options.reconcile ?? RECONCILE_DONE);
      const code = isListing
        ? (options.listingExit ?? 0)
        : isCover
          ? 0
          : (options.reconcileExit ?? 0);
      queueMicrotask(() => {
        for (const line of lines) child.stdout.emit(`${line}\n`);
        child.close(code);
      });
      return child.asChild();
    },
  });
  return { invoker, spawns };
}

/** An in-memory tree holding the prior state and nothing else. */
function files(seed: Readonly<Record<string, string>> = {}): StateFileSystem & {
  readonly files: Map<string, string>;
} {
  return inMemorySourceCacheFileSystem({ [STATE_PATH]: PRIOR_BYTES, ...seed });
}

/** An empty baseline scan, so a gated rebuild costs no walk of the real tree. */
function baseline(): BaselineFileSystem {
  return inMemoryBaselineFileSystem({});
}

function citations(): CitationSource {
  return inMemoryCitationSource({});
}

// ---------------------------------------------------------------------------
// Driving the command
// ---------------------------------------------------------------------------

interface Run {
  readonly result: Awaited<ReturnType<typeof runReconcile>>;
  readonly spawns: readonly string[][];
  readonly files: Map<string, string>;
  readonly sink: CollectingDiagnosticSink;
}

async function reconcile(
  options: StubOptions & {
    readonly changed?: readonly string[];
    readonly seed?: Readonly<Record<string, string>>;
    readonly withKane?: boolean;
  } = {},
): Promise<Run> {
  const kane = stub(options);
  const fileSystem = files(options.seed);
  const sink = createDiagnosticSink();
  const result = await runReconcile({
    repoRoot: REPO,
    config: DEFAULT_CONFIG,
    changed: options.changed ?? [README],
    fileSystem,
    baselineFileSystem: baseline(),
    citations: citations(),
    diagnostics: sink,
    at: AT,
    now: () => NOW_MS,
    ...(options.withKane === false ? {} : { invoker: kane.invoker }),
  });
  return { result, spawns: kane.spawns, files: fileSystem.files, sink };
}

/** The same command through `main`, so the exit code is the CLI's own. */
async function throughMain(
  options: StubOptions & { readonly argv: readonly string[] },
): Promise<{
  readonly exitCode: number;
  readonly out: string;
  readonly err: string;
  readonly spawns: readonly string[][];
  readonly files: Map<string, string>;
}> {
  const kane = stub(options);
  const fileSystem = files();
  const out: string[] = [];
  const err: string[] = [];
  const exitCode = await main(options.argv, {
    write: (text) => {
      out.push(text);
    },
    writeError: (text) => {
      err.push(text);
    },
    cwd: REPO,
    env: {},
    fileSystem,
    now: () => new Date(AT),
    invoker: kane.invoker,
  });
  return { exitCode, out: out.join(''), err: err.join(''), spawns: kane.spawns, files: fileSystem.files };
}

/** Every argv the run issued that names the reconcile verb. Must be empty on a refusal. */
function reconcileSpawns(spawns: readonly string[][]): readonly string[][] {
  return spawns.filter((argv) => argv.includes('reconcile') || argv.includes('maintain'));
}

// ---------------------------------------------------------------------------
// The argv — the contract with Kane (§13.2.1)
// ---------------------------------------------------------------------------

describe('the argv kept reconcile --changed issues (§13.2.1, §13.1)', () => {
  it('carries --from, --source-id and --plan, with --mode agent appended by the invoker', async () => {
    const run = await reconcile();

    expect(run.result.invocations).toBe(1);
    const doc = run.result.docs[0];
    expect(doc?.file).toBe(README);
    expect(doc?.sourceId).toBe('src_7f31c0a4');
    expect(doc?.via).toBe('exact-path');
    expect(doc?.argv).toEqual([
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

    // And at the process boundary, which is the only place it counts.
    expect(reconcileSpawns(run.spawns)).toEqual([
      [
        'maintain',
        'reconcile',
        '--from',
        README,
        '--source-id',
        'src_7f31c0a4',
        '--plan',
        '--mode',
        'agent',
      ],
    ]);
    for (const argv of run.spawns) expect(argv).not.toContain('--apply');
    // `--agent` is `ExecutionRun`'s enabler; this family takes `--mode agent`.
    for (const argv of run.spawns) expect(argv).not.toContain('--agent');
  });

  it('composes both mandatory flags and never --apply', () => {
    expect(reconcilePlanArgv(README, 'src_7f31c0a4')).toEqual([
      'maintain',
      'reconcile',
      '--from',
      README,
      '--source-id',
      'src_7f31c0a4',
      '--plan',
    ]);
    expect(reconcilePlanArgv(README, 'src_7f31c0a4')).not.toContain('--apply');
  });

  it('cannot compose an argv from a failed resolution, because there is no id', () => {
    const sink = createDiagnosticSink();
    const failure = {
      ok: false as const,
      reason: 'no-match' as const,
      diagnostic: sink.report({
        code: SOURCE_DIAGNOSTIC_CODES.unresolved,
        severity: 'warn',
        message: 'no ingested source matches it',
      }),
    };
    expect(reconcileArgv(failure, README)).toBeNull();
  });

  it('issues one invocation per changed doc, sequentially', async () => {
    // Two documents, one head move each, each with its own resolved id. The second
    // resolves from the cache the first wrote, so only one listing is needed.
    const run = await reconcile({
      changed: [README, 'apps/fixture/docs/pricing.md'],
      listing: listingOf([
        entry({ id: 'src_readme01', path: README }),
        entry({ id: 'src_pricing1', path: 'apps/fixture/docs/pricing.md' }),
      ]),
    });

    // `apps/fixture/docs/pricing.md` is not on disk, so ladder check 3 refuses it
    // before any spawn — which is exactly the behaviour under test: one document
    // admitted, one invocation, and the refusal reported per document.
    expect(run.result.docs.map((doc) => doc.file)).toEqual([
      README,
      'apps/fixture/docs/pricing.md',
    ]);
    expect(run.result.invocations).toBe(1);
    expect(reconcileSpawns(run.spawns)).toHaveLength(1);
    expect(run.result.docs[1]?.refusal?.check).toBe('from-exists');
    expect(run.result.docs[1]?.refusal?.code).toBe(RECONCILE_DIAGNOSTIC_CODES.fromMissing);
  });
});

// ---------------------------------------------------------------------------
// The filter (§13.2.1)
// ---------------------------------------------------------------------------

describe('the Docs_Hook pattern set is the filter (§13.2.1, R5.1)', () => {
  it('keeps documentation, drops code, normalises and dedupes', () => {
    const filtered = filterChangedDocs(
      [
        `${REPO}/${README}`,
        `./${README}`,
        'apps/fixture/docs/pricing.md',
        'apps/fixture/lib/cart.ts',
        '   ',
      ],
      REPO,
    );
    expect(filtered.docs).toEqual([README, 'apps/fixture/docs/pricing.md']);
    expect(filtered.outOfScope).toEqual(['apps/fixture/lib/cart.ts']);
  });

  it('uses the handoff module’s glob list rather than a second copy of it', () => {
    expect([...FIXTURE_DOC_GLOBS]).toEqual(['apps/fixture/README.md', 'apps/fixture/docs/**']);
  });

  it('invokes nothing at all when no changed doc survives filtering', async () => {
    const run = await reconcile({ changed: ['apps/fixture/lib/cart.ts'] });

    expect(run.result.docs).toEqual([]);
    expect(run.result.invocations).toBe(0);
    // Zero spawns: not one reconcile, and not even a listing.
    expect(run.spawns).toEqual([]);
    expect(run.result.diagnostics.map((entry) => entry.code)).toContain(
      RECONCILE_DIAGNOSTIC_CODES.noChangedDocs,
    );
    // The handoff is still written, so an agent cannot read the previous run's.
    expect(run.result.handoffs).toHaveLength(1);
    expect(run.result.handoffs[0]?.handoff.nextAction.branch).toBeNull();
    expect(run.files.has(HANDOFF_PATH)).toBe(true);
    // And the state file was not rewritten at all.
    expect(run.files.get(STATE_PATH)).toBe(PRIOR_BYTES);
  });

  it('exits 0 with no changed doc, through the CLI', async () => {
    const through = await throughMain({ argv: ['reconcile', '--changed', 'apps/fixture/lib/cart.ts'] });
    expect(through.exitCode).toBe(EXIT_OK);
    expect(through.spawns).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Ladder checks 3 and 4 — the free ones (§13.2.4)
// ---------------------------------------------------------------------------

describe('the fail-fast ladder mirrors all seven rows locally (§13.2.4)', () => {
  it('names the seven rows in the design’s order', () => {
    expect([...RECONCILE_LADDER_CHECKS]).toEqual([
      'from-present',
      'source-id-resolved',
      'from-exists',
      'ingestable-type',
      'source-known',
      'source-live',
      'fork-guard',
    ]);
  });

  it('maps every resolution reason onto a row, so none is unaccounted for', () => {
    const reasons: readonly SourceResolutionReason[] = SOURCE_RESOLUTION_REASONS;
    for (const reason of reasons) {
      expect(RECONCILE_LADDER_CHECKS).toContain(RECONCILE_CHECK_FOR_REASON[reason]);
    }
  });

  it('refuses a document that is not there, with no spawn (check 3)', async () => {
    const run = await reconcile({ changed: ['apps/fixture/docs/ghost.md'] });
    expect(run.result.docs[0]?.refusal?.check).toBe('from-exists');
    expect(run.spawns).toEqual([]);
    expect(run.result.invocations).toBe(0);
  });

  it('refuses a non-ingestable extension, with no spawn (check 4)', () => {
    expect(isIngestablePath('apps/fixture/docs/diagram.png')).toBe(false);
    expect(isIngestablePath('apps/fixture/docs/archive.zip')).toBe(false);
    // No extension at all is refused too, rather than waved through.
    expect(isIngestablePath('apps/fixture/docs/NOTICE')).toBe(false);
    expect(isIngestablePath(README)).toBe(true);
    expect(RECONCILE_INGESTABLE_EXTENSIONS).toContain('.md');
  });

  it('refuses a fork, naming both conflicting ids, with no spawn (check 7)', async () => {
    // The subtle row. A `byPath` hit bypasses the ladder entirely, so `ambiguous`
    // cannot catch a fork that appeared in the store since the entry was recorded
    // — the guard is the only thing that sees it. So the cache is seeded with a
    // resolution to the first id, and its listing carries a *second* live entry
    // backed by the same document.
    const run = await reconcile({ seed: { [CACHE_PATH]: FORKED_CACHE } });
    const doc = run.result.docs[0];

    expect(doc?.refusal?.check).toBe('fork-guard');
    expect(doc?.refusal?.code).toBe(FORK_GUARD_DIAGNOSTIC_CODE);
    // Both ids, which is the information a human needs to retire one of them.
    expect(doc?.refusal?.diagnostic.message).toContain('src_readme01');
    expect(doc?.refusal?.diagnostic.message).toContain('src_readme02');
    // A cache hit spawns nothing at all, and the refusal spawns nothing either.
    expect(run.spawns).toEqual([]);
    expect(run.result.invocations).toBe(0);
    // The resolution succeeded — this is a refusal *after* one, which is what
    // distinguishes the guard from the ladder's `ambiguous`.
    expect(doc?.resolution?.ok).toBe(true);
    expect(doc?.via).toBe('cache');
  });

  it('answers ambiguous from the ladder when two live entries tie, also with no spawn', async () => {
    const run = await reconcile({ listing: AMBIGUOUS_LISTING });
    const doc = run.result.docs[0];
    expect(doc?.refusal?.code).toBe(SOURCE_DIAGNOSTIC_CODES.ambiguous);
    expect(doc?.refusal?.code).not.toBe(FORK_GUARD_DIAGNOSTIC_CODE);
    expect(reconcileSpawns(run.spawns)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The six-row failure table, driven by the real command (§13.2.2, §14.1)
// ---------------------------------------------------------------------------

/**
 * One rung of §13.2.2's failure vocabulary and how to reach it through the
 * command.
 *
 * This is the table `context-sources-ladder-structural.test.ts` built and said
 * 12.6 would drive with the real `kept reconcile --changed`. Every arrangement
 * points at `apps/fixture/README.md`, which really exists, so each row exercises
 * the resolution rung it names rather than tripping over ladder check 3 first.
 */
interface FailureRung {
  readonly reason: SourceResolutionReason;
  readonly stub: StubOptions;
  /** Whether reaching this rung is expected to start the listing process. */
  readonly listingSpawns: number;
}

const FAILURE_RUNGS: readonly FailureRung[] = [
  {
    // The live path in this repository today: there is no `.context/` store yet,
    // and a refusal is a *complete* stream carrying its own remedy (§5.3.1).
    reason: 'no-store',
    stub: { listing: REFUSED, listingExit: 2 },
    listingSpawns: 1,
  },
  { reason: 'listing-unreadable', stub: { binary: null }, listingSpawns: 0 },
  { reason: 'crashed-stream', stub: { listing: LISTING_CRASHED }, listingSpawns: 1 },
  { reason: 'no-match', stub: { listing: EMPTY_STORE }, listingSpawns: 1 },
  { reason: 'ambiguous', stub: { listing: AMBIGUOUS_LISTING }, listingSpawns: 1 },
  { reason: 'retired', stub: { listing: RETIRED_LISTING }, listingSpawns: 1 },
];

describe('the failure vocabulary is complete, so no rung can be added untested', () => {
  it('covers every reason §13.2.2 defines, once each', () => {
    expect(FAILURE_RUNGS.map((rung) => rung.reason)).toEqual([...SOURCE_RESOLUTION_REASONS]);
  });
});

for (const rung of FAILURE_RUNGS) {
  describe(`kept reconcile refuses the ${rung.reason} rung (§13.2.2, §14.1)`, () => {
    it('reports the reason’s own diagnostic code and no other refusal', async () => {
      const run = await reconcile(rung.stub);
      const doc = run.result.docs[0];
      expect(doc?.refusal?.reason).toBe(rung.reason);
      expect(doc?.refusal?.code).toBe(SOURCE_REASON_DIAGNOSTIC_CODE[rung.reason]);
      expect(run.result.diagnostics.map((entry) => entry.code)).toContain(
        SOURCE_REASON_DIAGNOSTIC_CODE[rung.reason],
      );
    });

    it('spawns no maintain reconcile at the process boundary', async () => {
      const run = await reconcile(rung.stub);
      // The assertion only a command can make: not "no argv was constructible",
      // but "no process was started".
      expect(reconcileSpawns(run.spawns)).toEqual([]);
      expect(run.result.invocations).toBe(0);
      expect(run.result.docs[0]?.invoked).toBe(false);
      expect(run.result.docs[0]?.argv).toEqual([]);
      // And the only thing that may run is the listing itself, at most once.
      expect(run.spawns).toHaveLength(rung.listingSpawns);
      for (const argv of run.spawns) expect(argv[0]).toBe('context');
    });

    it('leaves every verdict, the freshness triple and degraded alone', async () => {
      const run = await reconcile(rung.stub);

      // The state file was not rewritten at all — byte-identical is not the claim,
      // untouched is.
      expect(run.files.get(STATE_PATH)).toBe(PRIOR_BYTES);
      expect(serialiseState(run.result.state)).toBe(PRIOR_BYTES);
      expect(run.result.state.freshness).toEqual(PRIOR.freshness);
      expect(run.result.state.graph.promises.map((record) => record.verdict)).toEqual([
        'proven',
        'proven',
      ]);
      // R5.3: no proven data was lost, so `degraded` stays false. Every *other*
      // adversity row of §14.1 sets it, which is what makes this easy to break.
      expect(run.result.state.graph.degraded).toBe(false);
      expect(run.result.state.graph.degradedReasons).toEqual([]);
      expect(run.result.rebuilt).toBe(false);
    });

    it('creates no review card, and leaves the review-card directory absent', async () => {
      const run = await reconcile(rung.stub);
      expect(run.result.reviewCards).toBeNull();
      expect(run.result.docs[0]?.staged).toEqual([]);
      // The third assertion only a command can make. Nothing under
      // `.kept/review-cards/` was created, by this command or by anything it called.
      const written = [...run.files.keys()];
      expect(written.filter((path) => path.startsWith(REVIEW_CARDS_DIR))).toEqual([]);
    });

    it('writes a handoff with branch null, the reason first, and nothing invoked', async () => {
      const run = await reconcile(rung.stub);
      const handoff = run.result.docs[0]?.handoff;
      expect(handoff).toBeDefined();
      if (handoff === undefined) return;

      expect(handoff.handoff.nextAction.branch).toBeNull();
      expect(handoff.handoff.nextAction.artefact).toBeNull();
      expect(handoff.handoff.results).toEqual([]);
      expect(handoff.handoff.command.invoked).toBe(false);
      expect(handoff.handoff.command.argv).toEqual([]);
      expect(handoff.handoff.diagnostics[0]?.code).toBe(
        SOURCE_REASON_DIAGNOSTIC_CODE[rung.reason],
      );
      expect(handoff.handoff.diagnostics.map((entry) => entry.code)).toContain(
        HANDOFF_DIAGNOSTIC_CODES.noInvocation,
      );
      expect(handoff.handoff.outcome.verdictsPermitted).toBe(false);

      // Both files land, and the newest reads back as a handoff.
      const readBack = parseHandoff(run.files.get(HANDOFF_PATH) as string);
      expect(readBack).not.toBeNull();
      expect(isHandoffFile(readBack)).toBe(true);
    });

    it('exits 0 through the CLI, because Kane’s refusal is data', async () => {
      const through = await throughMain({ ...rung.stub, argv: ['reconcile', '--changed', README] });
      expect(through.exitCode).toBe(EXIT_OK);
      expect(reconcileSpawns(through.spawns)).toEqual([]);
      // Nothing about the repository moved.
      expect(through.files.get(STATE_PATH)).toBe(PRIOR_BYTES);
    });
  });
}

// ---------------------------------------------------------------------------
// The outcomes of a run that did happen (§13.2.3, R5.2, R5.3, R5.4)
// ---------------------------------------------------------------------------

describe('a completed reconciliation (§13.2.3, R5.2, R5.7)', () => {
  it('records the head move that lands even under --plan', async () => {
    const run = await reconcile();
    const doc = run.result.docs[0];
    expect(doc?.accepted).toBe(true);
    expect(doc?.headMoved).toBe(true);
    expect(doc?.status).toBe('complete');
    const headMove = run.result.diagnostics.find(
      (entry) => entry.code === RECONCILE_DIAGNOSTIC_CODES.headMoved,
    );
    expect(headMove).toBeDefined();
    expect(headMove?.message).toContain('src_7f31c0a4');
    expect(headMove?.message).toContain('--plan');
  });

  it('holds every staged change and creates no review card of its own (R5.7)', async () => {
    const run = await reconcile();
    // Kane staged one item; KEPT records it and applies nothing. Mirroring these
    // into `.kept/review-cards/` is task 14.1's, so the directory stays absent.
    expect(run.result.docs[0]?.staged).toHaveLength(1);
    expect(run.result.reviewCards).toBeNull();
    expect([...run.files.keys()].filter((path) => path.startsWith(REVIEW_CARDS_DIR))).toEqual([]);
    expect(run.result.diagnostics.map((entry) => entry.code)).toContain(
      RECONCILE_DIAGNOSTIC_CODES.staged,
    );
  });

  it('rebuilds the graph from both providers, gated on the terminal done (R5.2)', async () => {
    const run = await reconcile();
    expect(run.result.rebuilt).toBe(true);
    expect(run.result.build).not.toBeNull();
    // The rebuild is the second Kane process, and it is `cover` — the enrichment
    // half of "both providers".
    expect(run.spawns.map((argv) => argv[0])).toEqual(['context', 'maintain', 'cover']);
    expect(run.result.diagnostics.map((entry) => entry.code)).toContain(
      RECONCILE_DIAGNOSTIC_CODES.rebuilt,
    );
  });

  it('exits 0 through the CLI and writes the snapshot', async () => {
    const run = await reconcile();
    expect(run.result.snapshot.valid).toBe(true);
  });
});

describe('a reconciliation that did not complete leaves the graph alone', () => {
  it('treats paused with exit 3 as resumable, with nothing changed (R5.4)', async () => {
    const run = await reconcile({ reconcile: PAUSED, reconcileExit: 3 });
    const doc = run.result.docs[0];

    expect(doc?.invoked).toBe(true);
    expect(doc?.terminalSeen).toBe(true);
    expect(doc?.status).toBe('paused');
    expect(doc?.paused).toBe(true);
    // Exit 3 on an Assurance command is a pause, never a failure (§4.5).
    expect(doc?.exitMeaning).toBe('paused-resumable');
    expect(doc?.headMoved).toBe(false);
    expect(doc?.accepted).toBe(false);

    // Nothing changed: no rebuild, no state write, no card, and no failure.
    expect(run.result.rebuilt).toBe(false);
    expect(run.files.get(STATE_PATH)).toBe(PRIOR_BYTES);
    expect(run.result.state.graph.degraded).toBe(false);
    expect(run.result.diagnostics.map((entry) => entry.code)).toContain(
      RECONCILE_DIAGNOSTIC_CODES.paused,
    );
    expect([...run.files.keys()].filter((path) => path.startsWith(REVIEW_CARDS_DIR))).toEqual([]);
  });

  it('classifies a stream with no done event as outcome unknown (R5.3)', async () => {
    const run = await reconcile({
      // The reconcile fixture truncated before its terminal event.
      reconcile: [RECONCILE_DONE[0] as string, RECONCILE_DONE[1] as string],
    });
    const doc = run.result.docs[0];

    expect(doc?.invoked).toBe(true);
    expect(doc?.terminalSeen).toBe(false);
    expect(doc?.status).toBeNull();
    expect(doc?.headMoved).toBe(false);
    expect(run.result.rebuilt).toBe(false);
    expect(run.files.get(STATE_PATH)).toBe(PRIOR_BYTES);
    expect(run.result.diagnostics.map((entry) => entry.code)).toContain(
      RECONCILE_DIAGNOSTIC_CODES.outcomeUnknown,
    );
    // A crashed stream creates no review card from that stream (R5.3).
    expect([...run.files.keys()].filter((path) => path.startsWith(REVIEW_CARDS_DIR))).toEqual([]);
  });

  it('quotes Kane’s own message when the run was refused', async () => {
    const run = await reconcile({ reconcile: REFUSED, reconcileExit: 2 });
    const refusal = run.result.diagnostics.find(
      (entry) => entry.code === RECONCILE_DIAGNOSTIC_CODES.refused,
    );
    expect(refusal).toBeDefined();
    expect(refusal?.message).toContain('context ingest');
    expect(run.result.rebuilt).toBe(false);
  });
});
