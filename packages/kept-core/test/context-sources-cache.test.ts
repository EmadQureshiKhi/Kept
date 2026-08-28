import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  KaneInvoker,
  LADDER_RUNGS,
  SOURCES_CACHE_FILE_RELATIVE_PATH,
  SOURCES_CACHE_MAX_AGE_MS,
  SOURCES_CACHE_SCHEMA_VERSION,
  SOURCE_CACHE_DIAGNOSTIC_CODES,
  createDiagnosticSink,
  inMemorySourceCacheFileSystem,
  isSourceCacheEntry,
  isSourcesCache,
  readSourcesCache,
  resolveSourceIdCached,
  serialiseSourcesCache,
  sourceCacheStaleness,
  sourceDigest,
  sourcesCachePath,
  sourcesListingSignature,
  writeSourcesCache,
  type CachedSourceResolution,
  type ChildProcessLike,
  type CollectingDiagnosticSink,
  type SourceCacheEntry,
  type SourcesCache,
  type StoreSource,
} from 'kept-core';

/**
 * Task 12.3 — the `.kept/sources.json` read-through cache (design §13.2.2, R5.2).
 *
 * No Kane process starts here and no byte reaches a disk. The invoker's `spawn`
 * and `resolveBinary` are injected, the cache file lives in an in-memory
 * `StateFileSystem` — the same seam `state.ts` and `handoff.ts` use, stubbed once
 * — and mtimes come from a map. So every arm is exercised over the committed
 * listing fixture with no `.context/` store in sight and no credit spent.
 *
 * Three things carry the weight, and they are the three the design states:
 *
 * 1. **A hit spawns nothing.** `spawns` is asserted empty, not merely short.
 * 2. **Both honouring conditions are conjunctive.** Younger than `maxAgeMs` *and*
 *    the cited file's mtime not newer than `resolvedAt`. Each is falsified on its
 *    own, so neither can be quietly dropped.
 * 3. **A failed refresh keeps the previous cache and honours the previous entry.**
 *    The stored bytes are compared before and after, so "left in place" is checked
 *    as a fact about the file rather than inferred from a return value.
 */

const REPO = '/repo';
const BIN = '/stub/bin/kane-cli';
const CACHE_PATH = sourcesCachePath(REPO);

const FIXTURES = new URL('./fixtures/', import.meta.url);

function fixtureLines(name: string): readonly string[] {
  return readFileSync(new URL(name, FIXTURES), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
}

const LISTING_LINES = fixtureLines('context-list-sources.jsonl');
/** The verbatim stdout of a `context list` in a directory with no `.context/`. */
const NO_STORE_LINES = fixtureLines('context-list-no-store.txt');

/** The byte strings the fixtures register pins for the hashed entries. */
const BYTES = {
  readme: '# Fixture storefront\n',
  checkout: '# Checkout use case\n',
  pricing: '# Pricing\n',
  shop: 'export default function ShopPage() {}\n',
} as const;

/** A fixed clock, so `refreshedAt` and every window are deterministic. */
const NOW_MS = Date.parse('2026-08-20T18:40:00.000Z');
const NOW_ISO = new Date(NOW_MS).toISOString();
const README = 'apps/fixture/README.md';
const README_ABS = resolve(REPO, README);

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
  readonly sink: CollectingDiagnosticSink;
  /** Every argv the stub was asked to spawn. Length zero means no process ran. */
  readonly spawns: string[][];
}

function stub(
  options: {
    readonly lines?: readonly string[];
    readonly exitCode?: number | null;
    readonly binary?: string | null;
  } = {},
): Stub {
  const sink = createDiagnosticSink();
  const spawns: string[][] = [];
  const invoker = new KaneInvoker({
    sink,
    resolveBinary: () => (options.binary === null ? null : (options.binary ?? BIN)),
    spawn: (_command, args) => {
      spawns.push([...args]);
      const child = new FakeChild();
      queueMicrotask(() => {
        for (const line of options.lines ?? LISTING_LINES) child.stdout.emit(`${line}\n`);
        // `null` is a signalled death, which is a different fact from exit 0.
        child.emitClose(options.exitCode === undefined ? 0 : options.exitCode);
      });
      return child.asChild();
    },
  });
  return { invoker, sink, spawns };
}

/** One projected entry, the way the listing projection builds them. */
function source(parts: {
  readonly sourceId: string;
  readonly path?: string | null;
  readonly digest?: string | null;
  readonly retired?: boolean;
  readonly raw?: unknown;
}): StoreSource {
  const path = parts.path ?? null;
  return {
    sourceId: parts.sourceId,
    path,
    absPath: path === null ? null : resolve(REPO, path),
    digest: parts.digest ?? null,
    retired: parts.retired ?? false,
    raw: parts.raw ?? { source_id: parts.sourceId },
  };
}

const README_SOURCE = source({
  sourceId: 'src_7f31c0a4',
  path: README,
  digest: sourceDigest(BYTES.readme),
});

function entry(parts: Partial<SourceCacheEntry> = {}): SourceCacheEntry {
  return {
    sourceId: 'src_7f31c0a4',
    via: 'exact-path',
    digest: sourceDigest(BYTES.readme),
    // A minute old: inside the ten-minute window by default.
    resolvedAt: new Date(NOW_MS - 60_000).toISOString(),
    ...parts,
  };
}

function cacheOf(parts: Partial<SourcesCache> = {}): SourcesCache {
  const sources = parts.sources ?? [README_SOURCE];
  return {
    schemaVersion: SOURCES_CACHE_SCHEMA_VERSION,
    refreshedAt: new Date(NOW_MS - 60_000).toISOString(),
    listingSignature: sourcesListingSignature(sources),
    sources,
    byPath: parts.byPath ?? { [README]: entry() },
    ...parts,
  };
}

/** The seeded filesystem, its mtimes, and the resolution, in one call. */
async function resolveCached(
  options: {
    readonly cache?: SourcesCache | string | null;
    readonly file?: string;
    readonly mtimeMs?: number | null;
    readonly lines?: readonly string[];
    readonly exitCode?: number | null;
    readonly binary?: string | null;
    readonly maxAgeMs?: number;
    readonly force?: boolean;
    readonly fileDigest?: string | null;
    readonly sink?: CollectingDiagnosticSink;
  } = {},
): Promise<{
  readonly outcome: CachedSourceResolution;
  readonly spawns: string[][];
  readonly files: Map<string, string>;
  readonly sink: CollectingDiagnosticSink;
}> {
  const seeded =
    options.cache === undefined || options.cache === null
      ? {}
      : {
          [CACHE_PATH]:
            typeof options.cache === 'string'
              ? options.cache
              : serialiseSourcesCache(options.cache),
        };
  const file = options.file ?? README;
  const fileSystem = inMemorySourceCacheFileSystem(
    seeded,
    options.mtimeMs === null || options.mtimeMs === undefined
      ? {}
      : { [resolve(REPO, file)]: options.mtimeMs },
  );
  const kane = stub({
    ...(options.lines === undefined ? {} : { lines: options.lines }),
    ...(options.exitCode === undefined ? {} : { exitCode: options.exitCode }),
    ...(options.binary === undefined ? {} : { binary: options.binary }),
  });
  const sink = options.sink ?? createDiagnosticSink();
  const outcome = await resolveSourceIdCached({
    repoRoot: REPO,
    file,
    invoker: kane.invoker,
    diagnostics: sink,
    fileSystem,
    mtimeMs: fileSystem.mtimeMs,
    now: () => NOW_MS,
    fileDigest: options.fileDigest ?? null,
    ...(options.maxAgeMs === undefined ? {} : { maxAgeMs: options.maxAgeMs }),
    ...(options.force === undefined ? {} : { force: options.force }),
  });
  return { outcome, spawns: kane.spawns, files: fileSystem.files, sink };
}

/** Narrow to the resolved arm, failing the test rather than the type-check. */
function resolved(outcome: CachedSourceResolution): {
  readonly sourceId: string;
  readonly via: string;
} {
  const { resolution } = outcome;
  if (!resolution.ok) {
    throw new Error(`expected a resolved source, got reason '${resolution.reason}'`);
  }
  return { sourceId: resolution.source.sourceId, via: resolution.via };
}

// ---------------------------------------------------------------------------
// The file: shape, spelling, and the guard
// ---------------------------------------------------------------------------

describe('the cache file is the shape design §13.2.2 states', () => {
  it('lives beside plan.json and state.json, under .kept/', () => {
    expect(SOURCES_CACHE_FILE_RELATIVE_PATH).toBe('.kept/sources.json');
    expect(sourcesCachePath(REPO)).toBe('/repo/.kept/sources.json');
    expect(sourcesCachePath('/repo/')).toBe('/repo/.kept/sources.json');
    expect(SOURCES_CACHE_MAX_AGE_MS).toBe(600_000);
  });

  it('round-trips through its own spelling, with byPath keys sorted', () => {
    const cache = cacheOf({
      byPath: {
        'apps/fixture/docs/z.md': entry({ sourceId: 'src_z', via: 'digest' }),
        [README]: entry(),
      },
    });
    const text = serialiseSourcesCache(cache);
    expect(text.endsWith('}\n')).toBe(true);
    const parsed: unknown = JSON.parse(text);
    expect(isSourcesCache(parsed)).toBe(true);
    expect(Object.keys((parsed as SourcesCache).byPath)).toEqual([
      README,
      'apps/fixture/docs/z.md',
    ]);
    expect(parsed).toEqual({
      schemaVersion: 1,
      refreshedAt: cache.refreshedAt,
      listingSignature: cache.listingSignature,
      sources: cache.sources,
      byPath: cache.byPath,
    });
  });

  it('refuses a file this version did not write', () => {
    expect(isSourcesCache(null)).toBe(false);
    expect(isSourcesCache({ ...cacheOf(), schemaVersion: 2 })).toBe(false);
    expect(isSourcesCache({ ...cacheOf(), refreshedAt: 'whenever' })).toBe(false);
    expect(isSourcesCache({ ...cacheOf(), listingSignature: '' })).toBe(false);
    expect(isSourcesCache({ ...cacheOf(), sources: [{ sourceId: 'src_x' }] })).toBe(false);
    expect(isSourcesCache({ ...cacheOf(), byPath: [] })).toBe(false);
    expect(isSourcesCache({ ...cacheOf(), byPath: { [README]: { sourceId: 'src_x' } } })).toBe(
      false,
    );
  });

  it('will not accept an entry that claims the cache as its own rung', () => {
    // `via` is a `LadderRung`, which cannot spell `cache`: a recorded resolution
    // came from one of the four rungs or it is not a recorded resolution.
    expect(isSourceCacheEntry(entry())).toBe(true);
    for (const rung of LADDER_RUNGS) {
      expect(isSourceCacheEntry(entry({ via: rung }))).toBe(true);
    }
    expect(isSourceCacheEntry({ ...entry(), via: 'cache' })).toBe(false);
    expect(isSourceCacheEntry({ ...entry(), sourceId: '' })).toBe(false);
    expect(isSourceCacheEntry({ ...entry(), resolvedAt: 'soon' })).toBe(false);
    expect(isSourceCacheEntry({ ...entry(), digest: '' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listingSignature
// ---------------------------------------------------------------------------

describe('listingSignature hashes the projected listing (§13.2.2)', () => {
  const listing = [
    README_SOURCE,
    source({ sourceId: 'src_1b9d5e22', digest: sourceDigest(BYTES.checkout) }),
    source({ sourceId: 'src_c4a80f13', path: 'apps/fixture/docs/pricing.md', retired: true }),
  ];

  it('is a prefixed sha256, and stable across calls', () => {
    const signature = sourcesListingSignature(listing);
    expect(signature).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(sourcesListingSignature(listing)).toBe(signature);
  });

  it('ignores wire order, because a reordered listing is not a changed store', () => {
    expect(sourcesListingSignature([...listing].reverse())).toBe(
      sourcesListingSignature(listing),
    );
  });

  it('ignores raw, because an ingest stamp moving is not a change the ladder reads', () => {
    const restamped = listing.map((projected) => ({
      ...projected,
      raw: { source_id: projected.sourceId, ingested_at: '2026-09-01T00:00:00Z' },
    }));
    expect(sourcesListingSignature(restamped)).toBe(sourcesListingSignature(listing));
  });

  it('changes when anything the ladder can match on changes', () => {
    const base = sourcesListingSignature(listing);
    const mutations: readonly StoreSource[][] = [
      // A new source.
      [...listing, source({ sourceId: 'src_new001', path: 'docs/new.md' })],
      // One fewer source.
      listing.slice(1),
      // A path that moved.
      [source({ ...README_SOURCE, path: 'apps/fixture/README.markdown' }), ...listing.slice(1)],
      // A digest that moved.
      [{ ...README_SOURCE, digest: sourceDigest(BYTES.pricing) }, ...listing.slice(1)],
      // A retirement.
      [{ ...README_SOURCE, retired: true }, ...listing.slice(1)],
      // An id that changed while everything else stayed.
      [{ ...README_SOURCE, sourceId: 'src_other01' }, ...listing.slice(1)],
    ];
    for (const mutated of mutations) {
      expect(sourcesListingSignature(mutated)).not.toBe(base);
    }
  });
});

// ---------------------------------------------------------------------------
// The honouring rule — both conditions, each falsified alone
// ---------------------------------------------------------------------------

describe('a byPath hit is honoured, and spawns nothing at all', () => {
  it('answers via cache with no process, no write and no listing', async () => {
    const { outcome, spawns, files } = await resolveCached({
      cache: cacheOf(),
      mtimeMs: NOW_MS - 120_000,
    });
    expect(resolved(outcome)).toEqual({ sourceId: 'src_7f31c0a4', via: 'cache' });
    expect(outcome.hit).toBe(true);
    expect(outcome.refreshed).toBe(false);
    expect(outcome.wrote).toBe(false);
    expect(outcome.staleness).toEqual({
      stale: false,
      reason: null,
      detail: 'the recorded resolution is current',
    });
    // The load-bearing assertion of the whole module: zero spawns, not few.
    expect(spawns).toEqual([]);
    expect(files.get(CACHE_PATH)).toBe(serialiseSourcesCache(cacheOf()));
  });

  it('records the hit, naming the rung that originally answered', async () => {
    const { sink } = await resolveCached({ cache: cacheOf(), mtimeMs: NOW_MS - 120_000 });
    const recorded = sink.withCode(SOURCE_CACHE_DIAGNOSTIC_CODES.hit);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.message).toContain('src_7f31c0a4');
    expect(recorded[0]?.message).toContain('exact-path');
    expect(recorded[0]?.file).toBe(README);
  });

  it('refreshes when the entry is older than maxAgeMs, mtime notwithstanding', async () => {
    const stale = cacheOf({
      byPath: { [README]: entry({ resolvedAt: new Date(NOW_MS - 700_000).toISOString() }) },
    });
    const { outcome, spawns, sink } = await resolveCached({
      cache: stale,
      // The file itself is ancient: only the age condition is falsified.
      mtimeMs: NOW_MS - 900_000,
    });
    expect(outcome.staleness.reason).toBe('expired');
    expect(outcome.refreshed).toBe(true);
    expect(spawns).toHaveLength(1);
    // No enabler is appended: `context list` belongs to no family and has no
    // `--mode` flag at all.
    expect(spawns[0]).toEqual(['context', 'list', '--type', 'source', '--json']);
    expect(sink.has(SOURCE_CACHE_DIAGNOSTIC_CODES.stale)).toBe(true);
    // And the answer is the ladder's own rung, not the cache's.
    expect(resolved(outcome)).toEqual({ sourceId: 'src_7f31c0a4', via: 'exact-path' });
  });

  it('refreshes when the file is newer than resolvedAt, age notwithstanding', async () => {
    const { outcome, spawns } = await resolveCached({
      // Recorded a minute ago, well inside the window; the file was saved after.
      cache: cacheOf(),
      mtimeMs: NOW_MS - 1_000,
    });
    expect(outcome.staleness.reason).toBe('file-newer');
    expect(outcome.refreshed).toBe(true);
    expect(spawns).toHaveLength(1);
  });

  it('refreshes when the file has no readable mtime, rather than assuming one', async () => {
    // Not knowing whether the file moved is not the same as knowing it did not.
    const { outcome, spawns } = await resolveCached({ cache: cacheOf(), mtimeMs: null });
    expect(outcome.staleness.reason).toBe('file-newer');
    expect(spawns).toHaveLength(1);
  });

  it('honours an entry whose mtime exactly equals resolvedAt', async () => {
    // "not newer than" is the rule, so equality is a hit. A save that landed in
    // the same millisecond as the resolution is not evidence of a later edit.
    const { outcome, spawns } = await resolveCached({
      cache: cacheOf(),
      mtimeMs: Date.parse(entry().resolvedAt),
    });
    expect(resolved(outcome).via).toBe('cache');
    expect(spawns).toEqual([]);
  });

  it('refreshes on force, and on a maxAgeMs a caller disabled it does not', async () => {
    const forced = await resolveCached({
      cache: cacheOf(),
      mtimeMs: NOW_MS - 120_000,
      force: true,
    });
    expect(forced.outcome.staleness.reason).toBe('forced');
    expect(forced.spawns).toHaveLength(1);

    // A non-positive window disables the age condition; the mtime condition holds.
    const offline = await resolveCached({
      cache: cacheOf({
        byPath: { [README]: entry({ resolvedAt: new Date(NOW_MS - 90_000_000).toISOString() }) },
      }),
      mtimeMs: NOW_MS - 90_100_000,
      maxAgeMs: 0,
    });
    expect(resolved(offline.outcome).via).toBe('cache');
    expect(offline.spawns).toEqual([]);
  });
});

describe('the staleness rule is decided in one place', () => {
  const base = { nowMs: NOW_MS, maxAgeMs: SOURCES_CACHE_MAX_AGE_MS } as const;

  it('names every reason it can answer', () => {
    expect(sourceCacheStaleness({ ...base, cache: null }).reason).toBe('missing');
    expect(sourceCacheStaleness({ ...base, cache: null, malformed: true }).reason).toBe(
      'malformed',
    );
    expect(sourceCacheStaleness({ ...base, cache: cacheOf(), entry: null }).reason).toBe(
      'no-entry',
    );
    expect(
      sourceCacheStaleness({ ...base, cache: cacheOf(), entry: entry(), force: true }).reason,
    ).toBe('forced');
    expect(
      sourceCacheStaleness({
        ...base,
        cache: cacheOf(),
        entry: entry(),
        entrySourceLive: false,
      }).reason,
    ).toBe('entry-inconsistent');
    expect(
      sourceCacheStaleness({
        ...base,
        cache: cacheOf(),
        entry: entry({ resolvedAt: 'not an instant' }),
        entrySourceLive: true,
        fileMtimeMs: 0,
      }).reason,
    ).toBe('malformed');
  });

  it('is honest about what it saw, in the detail it reports', () => {
    const expired = sourceCacheStaleness({
      ...base,
      cache: cacheOf(),
      entry: entry({ resolvedAt: new Date(NOW_MS - 900_000).toISOString() }),
      entrySourceLive: true,
      fileMtimeMs: NOW_MS - 900_000,
    });
    expect(expired.detail).toContain('900 s ago');
    expect(expired.detail).toContain(`${SOURCES_CACHE_MAX_AGE_MS} ms`);
  });
});

// ---------------------------------------------------------------------------
// The refresh
// ---------------------------------------------------------------------------

describe('a refresh records what it resolved, and what it listed', () => {
  it('writes every projected source, the signature, and the resolving rung', async () => {
    const { outcome, files, sink } = await resolveCached({ cache: null });
    expect(resolved(outcome)).toEqual({ sourceId: 'src_7f31c0a4', via: 'exact-path' });
    expect(outcome.staleness.reason).toBe('missing');
    expect(outcome.wrote).toBe(true);

    const written: unknown = JSON.parse(files.get(CACHE_PATH) as string);
    expect(isSourcesCache(written)).toBe(true);
    const cache = written as SourcesCache;
    expect(cache.sources).toHaveLength(7);
    expect(cache.refreshedAt).toBe(NOW_ISO);
    expect(cache.listingSignature).toBe(sourcesListingSignature(cache.sources));
    expect(cache.byPath[README]).toEqual({
      sourceId: 'src_7f31c0a4',
      via: 'exact-path',
      digest: sourceDigest(BYTES.readme),
      resolvedAt: NOW_ISO,
    });
    expect(sink.has(SOURCE_CACHE_DIAGNOSTIC_CODES.refreshed)).toBe(true);
  });

  it('records the rung that answered, whichever one it was', async () => {
    const digestHit = await resolveCached({
      cache: null,
      file: 'apps/fixture/docs/moved-checkout.md',
      fileDigest: sourceDigest(BYTES.checkout),
    });
    expect(resolved(digestHit.outcome)).toEqual({ sourceId: 'src_1b9d5e22', via: 'digest' });
    const cache = JSON.parse(digestHit.files.get(CACHE_PATH) as string) as SourcesCache;
    expect(cache.byPath['apps/fixture/docs/moved-checkout.md']?.via).toBe('digest');
  });

  it('keeps other recorded resolutions when the store did not change', async () => {
    const previous = cacheOf({
      // The signature of the *fixture* listing, so the refresh finds no churn.
      sources: [],
      byPath: {
        'apps/fixture/docs/other.md': entry({ sourceId: 'src_5e8b03df', via: 'unique-basename' }),
        [README]: entry({ resolvedAt: new Date(NOW_MS - 700_000).toISOString() }),
      },
    });
    // Seed the previous cache with the signature the incoming listing will hash to.
    const listed = await resolveCached({ cache: null });
    const fresh = listed.outcome.cache as SourcesCache;
    const seeded: SourcesCache = {
      ...previous,
      sources: fresh.sources,
      listingSignature: fresh.listingSignature,
    };

    const { outcome, files, sink } = await resolveCached({
      cache: seeded,
      mtimeMs: NOW_MS - 900_000,
    });
    expect(outcome.staleness.reason).toBe('expired');
    expect(sink.has(SOURCE_CACHE_DIAGNOSTIC_CODES.churn)).toBe(false);
    const cache = JSON.parse(files.get(CACHE_PATH) as string) as SourcesCache;
    expect(Object.keys(cache.byPath).sort()).toEqual([README, 'apps/fixture/docs/other.md']);
    expect(cache.byPath['apps/fixture/docs/other.md']?.sourceId).toBe('src_5e8b03df');
  });

  it('drops every recorded resolution when the listing churned', async () => {
    // The seeded cache carries one source; the incoming listing carries seven, so
    // the signature differs and every prior resolution describes a store that has
    // since changed.
    const { outcome, files, sink } = await resolveCached({
      cache: cacheOf({
        byPath: {
          'apps/fixture/docs/other.md': entry({ sourceId: 'src_ghost01' }),
          [README]: entry({ resolvedAt: new Date(NOW_MS - 700_000).toISOString() }),
        },
      }),
      mtimeMs: NOW_MS - 900_000,
    });
    expect(sink.has(SOURCE_CACHE_DIAGNOSTIC_CODES.churn)).toBe(true);
    expect(outcome.refreshed).toBe(true);
    const cache = JSON.parse(files.get(CACHE_PATH) as string) as SourcesCache;
    expect(Object.keys(cache.byPath)).toEqual([README]);
  });

  it('deletes an entry a fresh listing has just disproved', async () => {
    // The store no longer backs this document. Leaving the record would let a
    // later refresh failure honour a resolution this very listing disproved.
    const { outcome, files } = await resolveCached({
      cache: cacheOf({
        sources: [source({ sourceId: 'src_gone001', path: 'apps/fixture/docs/gone.md' })],
        byPath: {
          'apps/fixture/docs/gone.md': entry({
            sourceId: 'src_gone001',
            resolvedAt: new Date(NOW_MS - 700_000).toISOString(),
          }),
        },
      }),
      file: 'apps/fixture/docs/gone.md',
      mtimeMs: NOW_MS - 900_000,
    });
    expect(outcome.resolution.ok).toBe(false);
    if (!outcome.resolution.ok) expect(outcome.resolution.reason).toBe('no-match');
    const cache = JSON.parse(files.get(CACHE_PATH) as string) as SourcesCache;
    expect(cache.byPath).toEqual({});
  });

  it('refreshes when an entry names an id the cached listing does not back', async () => {
    const { outcome, spawns, sink } = await resolveCached({
      cache: cacheOf({
        sources: [{ ...README_SOURCE, retired: true }],
        byPath: { [README]: entry() },
      }),
      mtimeMs: NOW_MS - 120_000,
    });
    expect(outcome.staleness.reason).toBe('entry-inconsistent');
    expect(sink.has(SOURCE_CACHE_DIAGNOSTIC_CODES.inconsistent)).toBe(true);
    expect(spawns).toHaveLength(1);
    expect(resolved(outcome).via).toBe('exact-path');
  });

  it('reads an unreadable and a malformed cache as absent, and says which', async () => {
    const malformed = await resolveCached({ cache: '{ not json', mtimeMs: NOW_MS - 120_000 });
    expect(malformed.outcome.staleness.reason).toBe('malformed');
    expect(malformed.sink.has(SOURCE_CACHE_DIAGNOSTIC_CODES.malformed)).toBe(true);

    const wrongShape = await resolveCached({
      cache: JSON.stringify({ schemaVersion: 99 }),
      mtimeMs: NOW_MS - 120_000,
    });
    expect(wrongShape.outcome.staleness.reason).toBe('malformed');
    expect(wrongShape.sink.has(SOURCE_CACHE_DIAGNOSTIC_CODES.malformed)).toBe(true);
    // Both still resolve: a discarded cache costs one listing, not a refusal.
    expect(resolved(wrongShape.outcome).via).toBe('exact-path');
  });

  it('records nothing under a file that has no repo-relative form', async () => {
    const { outcome, files } = await resolveCached({ cache: null, file: README_ABS });
    expect(resolved(outcome)).toEqual({ sourceId: 'src_7f31c0a4', via: 'abs-path' });
    const cache = JSON.parse(files.get(CACHE_PATH) as string) as SourcesCache;
    // An absolute path is not a key: another root would misread it.
    expect(cache.byPath).toEqual({});
  });

  it('stands by its resolution when the cache cannot be written', () => {
    const sink = createDiagnosticSink();
    const refusing = {
      readFile: (): string | null => null,
      ensureDir: (): void => {
        throw new Error('EACCES: .kept is read-only');
      },
      writeFile: (): void => {
        throw new Error('EACCES: .kept is read-only');
      },
    };
    expect(writeSourcesCache(REPO, cacheOf(), { fileSystem: refusing, diagnostics: sink })).toBe(
      false,
    );
    expect(sink.has(SOURCE_CACHE_DIAGNOSTIC_CODES.writeFailed)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A failed refresh keeps the cache, and honours what it holds
// ---------------------------------------------------------------------------

describe('a refresh that fails leaves the cache in place (§13.2.2)', () => {
  /**
   * A listing cut off mid-flight. `context list` has no terminal event to be
   * missing — it is a JSON-lines listing — so a truncated one is a *signalled*
   * death, which the stub spells as a `null` exit code.
   */
  const CRASHED = LISTING_LINES.slice(0, 3);
  const CRASHED_EXIT = null;

  it('honours the previous entry when the stream crashes', async () => {
    const previous = cacheOf({
      byPath: { [README]: entry({ resolvedAt: new Date(NOW_MS - 700_000).toISOString() }) },
    });
    const before = serialiseSourcesCache(previous);
    const { outcome, files, sink } = await resolveCached({
      cache: previous,
      // Expired *and* the file was just saved: both conditions fail, so this is a
      // refresh that had to happen, and it is the refresh that then crashed.
      mtimeMs: NOW_MS - 1_000,
      lines: CRASHED,
      exitCode: CRASHED_EXIT,
    });

    expect(resolved(outcome)).toEqual({ sourceId: 'src_7f31c0a4', via: 'cache' });
    expect(outcome.honouredStaleEntry).toBe(true);
    expect(outcome.refreshed).toBe(false);
    expect(outcome.wrote).toBe(false);
    // "Left in place" as a fact about the bytes, not a claim in a return value.
    expect(files.get(CACHE_PATH)).toBe(before);
    const recorded = sink.withCode(
      SOURCE_CACHE_DIAGNOSTIC_CODES.refreshFailedEntryHonoured,
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.severity).toBe('warn');
    expect(recorded[0]?.message).toContain('crashed-stream');
    expect(recorded[0]?.message).toContain('src_7f31c0a4');
  });

  it('honours it for every reason a listing can fail with', async () => {
    const cases: readonly {
      readonly reason: string;
      readonly options: {
        readonly lines?: readonly string[];
        readonly exitCode?: number | null;
        readonly binary?: string | null;
      };
    }[] = [
      { reason: 'crashed-stream', options: { lines: CRASHED, exitCode: CRASHED_EXIT } },
      { reason: 'no-store', options: { lines: NO_STORE_LINES, exitCode: 2 } },
      { reason: 'listing-unreadable', options: { binary: null } },
    ];
    for (const testCase of cases) {
      const { outcome, spawns } = await resolveCached({
        cache: cacheOf({
          byPath: { [README]: entry({ resolvedAt: new Date(NOW_MS - 700_000).toISOString() }) },
        }),
        mtimeMs: NOW_MS - 1_000,
        ...testCase.options,
      });
      expect(resolved(outcome), testCase.reason).toEqual({
        sourceId: 'src_7f31c0a4',
        via: 'cache',
      });
      expect(outcome.honouredStaleEntry).toBe(true);
      // No binary means no process at all, and still an honoured entry.
      if (testCase.reason === 'listing-unreadable') expect(spawns).toEqual([]);
    }
  });

  it('answers the listing’s own reason when there is no entry to honour', async () => {
    const { outcome, files, sink } = await resolveCached({
      cache: cacheOf({ byPath: {} }),
      mtimeMs: NOW_MS - 120_000,
      lines: CRASHED,
      exitCode: CRASHED_EXIT,
    });
    expect(outcome.resolution.ok).toBe(false);
    if (outcome.resolution.ok) return;
    expect(outcome.resolution.reason).toBe('crashed-stream');
    expect(outcome.honouredStaleEntry).toBe(false);
    expect(outcome.wrote).toBe(false);
    // Still nothing deleted: the listing failed, so it taught us nothing.
    expect(files.get(CACHE_PATH)).toBe(serialiseSourcesCache(cacheOf({ byPath: {} })));
    expect(sink.has(SOURCE_CACHE_DIAGNOSTIC_CODES.refreshFailedNoEntry)).toBe(true);
  });

  it('does not honour an entry whose source the cached listing retired', async () => {
    // The cache itself says the id is retired, so there is nothing safe to fall
    // back on: handing Kane a retired id is check six of the fail-fast ladder.
    const { outcome } = await resolveCached({
      cache: cacheOf({
        sources: [{ ...README_SOURCE, retired: true }],
        byPath: { [README]: entry() },
      }),
      mtimeMs: NOW_MS - 120_000,
      lines: CRASHED,
      exitCode: CRASHED_EXIT,
    });
    expect(outcome.resolution.ok).toBe(false);
    if (!outcome.resolution.ok) expect(outcome.resolution.reason).toBe('crashed-stream');
  });
});

// ---------------------------------------------------------------------------
// The read side, on its own
// ---------------------------------------------------------------------------

describe('readSourcesCache is the read side, and triggers nothing', () => {
  it('answers the stored cache, or null, without refreshing anything', () => {
    const fileSystem = inMemorySourceCacheFileSystem({
      [CACHE_PATH]: serialiseSourcesCache(cacheOf()),
    });
    expect(readSourcesCache(REPO, { fileSystem })?.byPath[README]?.sourceId).toBe('src_7f31c0a4');

    const empty = inMemorySourceCacheFileSystem();
    const sink = createDiagnosticSink();
    expect(readSourcesCache(REPO, { fileSystem: empty, diagnostics: sink })).toBeNull();
    // An absent cache is not adversity, so nothing is reported for it.
    expect(sink.entries).toEqual([]);
  });
});
