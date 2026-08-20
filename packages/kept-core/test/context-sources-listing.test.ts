import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  KaneInvoker,
  MAX_SOURCE_WALK_DEPTH,
  SOURCE_DIAGNOSTIC_CODES,
  SOURCE_LISTING_ARGV,
  SOURCE_LISTING_DIAGNOSTIC_CODES,
  SOURCE_LISTING_FAMILY,
  SOURCE_LISTING_TIMEOUT_MS,
  SOURCE_REASON_DIAGNOSTIC_CODE,
  applyNdjsonEnabler,
  createDiagnosticSink,
  listStoreSources,
  projectSourceListing,
  resolveSourceId,
  sourceDigest,
  type ChildProcessLike,
  type CollectingDiagnosticSink,
  type SourceListing,
  type SourceResolution,
  type StoreSource,
} from '@kept/core';

import { arbStoreSourceListing } from './arbitraries.js';

/**
 * Task 12.2 — the tolerant projection of `context list --type source --json`,
 * and `resolveSourceId` (design §13.2.2, §5.3, R5.2).
 *
 * Not one test here starts a Kane process. The invoker's `spawn` and
 * `resolveBinary` are both injected, so every arm — the read listing, the
 * refusal that means "no store", a stream that never reached `done`, our own
 * timeout kill, an absent binary — is exercised over committed bytes with no
 * credit spent and no `.context/` store in sight.
 *
 * The load-bearing assertion is the one about *reachability*. `--source-id` is
 * built from `SourceResolution`'s `ok: true` arm and from nowhere else, so each
 * failure below is a value a caller cannot turn into an argv. That is what makes
 * an unresolved source a no-op by structure rather than by discipline: no spawn,
 * no review card, no verdict movement, `degraded` still false, exit 0 (§14.1).
 * The earlier design's bare `maintain reconcile` would have exited 2 on every
 * save while looking perfectly wired up, and the test that would have caught it
 * is this one.
 */

const FIXTURES = new URL('./fixtures/', import.meta.url);

function fixtureLines(name: string): readonly string[] {
  return readFileSync(new URL(name, FIXTURES), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
}

/** The committed listing, and the committed refusal a storeless repository gives. */
const LISTING_LINES = fixtureLines('context-list-sources.ndjson');
const REFUSED_LINES = fixtureLines('assurance-cover-refused.ndjson');

/** The refusal's own message, decoded without the parser's help. */
const REFUSAL_MESSAGE = (JSON.parse(REFUSED_LINES[0] as string) as Record<string, unknown>)[
  'message'
] as string;

/** The listing's payload event, decoded independently of the stream reader. */
const LISTING_PAYLOAD = JSON.parse(LISTING_LINES[1] as string) as Record<string, unknown>;

/** The byte strings the fixtures register pins for the four hashed entries. */
const BYTES = {
  readme: '# Fixture storefront\n',
  checkout: '# Checkout use case\n',
  pricing: '# Pricing\n',
  shop: 'export default function ShopPage() {}\n',
} as const;

const REPO = '/repo';
const BIN = '/stub/bin/kane-cli';

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

/**
 * An invoker that replays `lines` and exits `exitCode`. `binary: null` is an
 * absent `kane-cli`; `hang: true` never closes on its own, so the budget ends it.
 */
function stub(options: {
  readonly lines?: readonly string[];
  readonly exitCode?: number | null;
  readonly binary?: string | null;
  readonly hang?: boolean;
}): Stub {
  const sink = createDiagnosticSink();
  const spawns: string[][] = [];
  const invoker = new KaneInvoker({
    sink,
    resolveBinary: () => (options.binary === null ? null : (options.binary ?? BIN)),
    spawn: (_command, args) => {
      spawns.push([...args]);
      const child = new FakeChild();
      if (options.hang !== true) {
        queueMicrotask(() => {
          for (const line of options.lines ?? []) child.stdout.emit(`${line}\n`);
          child.emitClose(options.exitCode ?? 0);
        });
      }
      return child.asChild();
    },
  });
  return { invoker, sink, spawns };
}

/** Narrow to the resolved arm, failing the test rather than the type-check. */
function resolved(resolution: SourceResolution): { readonly sourceId: string; readonly via: string } {
  if (!resolution.ok) {
    throw new Error(`expected a resolved source, got reason '${resolution.reason}'`);
  }
  return { sourceId: resolution.source.sourceId, via: resolution.via };
}

/** Narrow to the read arm of a listing. */
function read(listing: SourceListing): readonly StoreSource[] {
  if (!listing.ok) throw new Error(`expected a listing, got reason '${listing.reason}'`);
  return listing.sources;
}

function byId(sources: readonly StoreSource[], sourceId: string): StoreSource {
  const found = sources.find((source) => source.sourceId === sourceId);
  if (found === undefined) throw new Error(`no projected source ${sourceId}`);
  return found;
}

// ---------------------------------------------------------------------------
// The projection, over the committed payload
// ---------------------------------------------------------------------------

describe('the source listing projects tolerantly (§13.2.2)', () => {
  const projection = projectSourceListing(LISTING_PAYLOAD, { repoRoot: REPO });

  it('projects every entry of the committed payload, in wire order', () => {
    expect(projection.sources.map((source) => source.sourceId)).toEqual([
      'src_7f31c0a4',
      'src_1b9d5e22',
      'src_c4a80f13',
      'src_44e1ba07',
      'src_9c2d7f58',
      'src_2f6c1d90',
      'src_5e8b03df',
    ]);
    expect(projection.refused).toEqual([]);
    expect(projection.duplicates).toEqual([]);
    expect(projection.truncated).toBe(false);
    // The array was found by shape, and its location is reported so a diagnostic
    // can name one entry rather than "somewhere in the payload".
    expect(projection.arrays).toBe(1);
  });

  it('reads an id, a path, a digest and a lifecycle marker under every spelling', () => {
    // `source_id` + `path` + `digest` + `retired`.
    expect(byId(projection.sources, 'src_7f31c0a4')).toMatchObject({
      path: 'apps/fixture/README.md',
      absPath: resolve(REPO, 'apps/fixture/README.md'),
      digest: sourceDigest(BYTES.readme),
      retired: false,
    });
    // `sourceId` + `file` + `content_hash` + `status: "retired"`.
    expect(byId(projection.sources, 'src_c4a80f13')).toMatchObject({
      path: 'apps/fixture/docs/pricing.md',
      digest: sourceDigest(BYTES.pricing),
      retired: true,
    });
    // `source_id` + `source_path` + a bare `hash` with no algorithm prefix.
    expect(byId(projection.sources, 'src_44e1ba07')).toMatchObject({
      path: 'apps/fixture/app/shop/page.tsx',
      digest: sourceDigest(BYTES.shop),
      retired: false,
    });
    // `uri` carrying a repo-relative path, and `status: "active"` reading as live.
    expect(byId(projection.sources, 'src_5e8b03df').path).toBe('docs/adr/currency.md');
    expect(byId(projection.sources, 'src_1b9d5e22').retired).toBe(false);
  });

  it('accepts an entry that carries no path at all', () => {
    // The entry the digest rung exists for: an `id` and an `sha256`, nothing else
    // to match on. A missing path is a normal entry, not a broken one.
    const entry = byId(projection.sources, 'src_1b9d5e22');
    expect(entry.path).toBeNull();
    expect(entry.absPath).toBeNull();
    expect(entry.digest).toBe(sourceDigest(BYTES.checkout));
  });

  it('keeps the unprojected entry in raw, and matches on nothing inside it', () => {
    const entry = byId(projection.sources, 'src_7f31c0a4');
    expect(entry.raw).toMatchObject({ title: 'Fixture storefront README' });
    // The title is a string the ladder must never consult; it survives for a
    // diagnostic to show, and the projected record has no field for it.
    expect(Object.keys(entry)).toEqual([
      'sourceId',
      'path',
      'absPath',
      'digest',
      'retired',
      'raw',
    ]);
  });

  it('keeps two live entries that name one file, because that is the fork guard', () => {
    // Deduplication is on the **id**, never on the path: entries 4 and 5 are one
    // file backing two live sources, and collapsing them would turn §13.2.4 #7
    // into a silent single match.
    const shop = projection.sources.filter(
      (source) => source.path === 'apps/fixture/app/shop/page.tsx',
    );
    expect(shop.map((source) => source.sourceId)).toEqual(['src_44e1ba07', 'src_9c2d7f58']);
  });
});

describe('the projection is structural, not positional', () => {
  it('finds the array through an extra envelope and a renamed key', () => {
    const wrapped = {
      type: 'sources',
      payload: { result: { items: [{ sourceId: 'src_deep01', file: './docs/a.md' }] } },
    };
    const projection = projectSourceListing(wrapped, { repoRoot: REPO });
    expect(projection.sources).toHaveLength(1);
    expect(projection.sources[0]).toMatchObject({
      sourceId: 'src_deep01',
      path: 'docs/a.md',
    });
  });

  it('refuses an entry with no id and names where it was', () => {
    const projection = projectSourceListing(
      { sources: [{ path: 'docs/a.md', digest: 'sha256:aa' }, 'junk', 7] },
      { repoRoot: REPO },
    );
    expect(projection.sources).toEqual([]);
    expect(projection.refused).toEqual(['sources[0]']);
    // An id is the one field `--source-id` is built from, so an entry without one
    // is not a source — and deriving an id from `docs/a.md` is exactly what
    // §13.2.2 forbids.
    expect(projection.examined).toBe(1);
  });

  it('keeps the first of two entries claiming one id, and says so', () => {
    const projection = projectSourceListing(
      {
        sources: [
          { source_id: 'src_same01', path: 'docs/first.md' },
          { source_id: 'src_same01', path: 'docs/second.md' },
        ],
      },
      { repoRoot: REPO },
    );
    expect(projection.sources).toHaveLength(1);
    expect(projection.sources[0]?.path).toBe('docs/first.md');
    expect(projection.duplicates).toEqual(['sources[1]']);
  });

  it('reads an unrecognised lifecycle marker as live, and records it', () => {
    const projection = projectSourceListing(
      { sources: [{ id: 'src_odd001', path: 'docs/a.md', status: 'quiescent' }] },
      { repoRoot: REPO },
    );
    expect(projection.sources[0]?.retired).toBe(false);
    expect(projection.unknownLifecycle).toEqual(['sources[0]: quiescent']);
  });

  it('distinguishes an empty listing from an unreadable one', () => {
    const empty = projectSourceListing({ total: 0, sources: [] }, { repoRoot: REPO });
    expect(empty.sources).toEqual([]);
    expect(empty.emptyArrays).toBe(1);

    const unreadable = projectSourceListing({ total: 3, note: 'a shape we do not know' }, {
      repoRoot: REPO,
    });
    expect(unreadable.emptyArrays).toBe(0);
    expect(unreadable.arrays).toBe(0);
  });

  it('is total over junk, and bounded in depth', () => {
    for (const payload of [null, undefined, 7, 'text', true, []]) {
      expect(projectSourceListing(payload, { repoRoot: REPO }).sources).toEqual([]);
    }
    let deep: unknown = { sources: [{ source_id: 'src_buried' }] };
    for (let index = 0; index <= MAX_SOURCE_WALK_DEPTH + 2; index += 1) deep = { wrap: deep };
    const projection = projectSourceListing(deep, { repoRoot: REPO });
    expect(projection.sources).toEqual([]);
    expect(projection.truncated).toBe(true);
  });

  it('projects every generated listing the shared generator produces', () => {
    // A deterministic sweep, not a property: the generator already reaches the
    // four required listing shapes by construction (exact path, digest-only,
    // retired, duplicate), so replaying a fixed sample is the cheapest way to
    // check the projection against every key spelling and envelope it emits.
    for (const listing of fc.sample(arbStoreSourceListing, { numRuns: 200, seed: 20_260_820 })) {
      const projection = projectSourceListing(listing.payload, { repoRoot: REPO });
      expect(projection.sources.map((source) => source.sourceId)).toEqual(
        listing.entries.map((entry) => entry.sourceId),
      );
      for (const entry of listing.entries) {
        const projected = byId(projection.sources, entry.sourceId);
        expect(projected.retired).toBe(entry.retired);
        if (entry.digest === null) expect(projected.digest).toBeNull();
        else expect(projected.digest).toBe(entry.digest.replace(/^sha256:/, ''));
        if (entry.path === null) expect(projected.path).toBeNull();
        else expect(projected.path).toBe(entry.path);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The invocation
// ---------------------------------------------------------------------------

describe('the listing invocation (§13.2.2)', () => {
  it('issues context list --type source --json and lets the invoker append the enabler', async () => {
    const kane = stub({ lines: LISTING_LINES });
    const listing = await listStoreSources({ repoRoot: REPO, invoker: kane.invoker });

    expect([...SOURCE_LISTING_ARGV]).toEqual(['context', 'list', '--type', 'source', '--json']);
    // `--mode agent` comes from the Assurance contract, appended once, at the
    // invoker seam — never written at this call site, and never `--agent`.
    expect([...listing.effectiveArgv]).toEqual([
      'context',
      'list',
      '--type',
      'source',
      '--json',
      '--mode',
      'agent',
    ]);
    expect(kane.spawns).toEqual([[...listing.effectiveArgv]]);
    expect([...applyNdjsonEnabler(SOURCE_LISTING_FAMILY, SOURCE_LISTING_ARGV)]).toEqual([
      ...listing.effectiveArgv,
    ]);
    expect(SOURCE_LISTING_TIMEOUT_MS).toBe(60_000);
  });

  it('reads the committed listing and reports what it found', async () => {
    const kane = stub({ lines: LISTING_LINES });
    const sink = createDiagnosticSink();
    const listing = await listStoreSources({
      repoRoot: REPO,
      invoker: kane.invoker,
      diagnostics: sink,
    });

    expect(read(listing)).toHaveLength(7);
    expect(listing.status).toBe('complete');
    const recorded = sink.withCode(SOURCE_LISTING_DIAGNOSTIC_CODES.listed);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.message).toContain('1 retired');
    expect(recorded[0]?.message).toContain('6 live');
  });

  it('reads a refusal as no-store, quoting Kane’s own remedy', async () => {
    // The committed refusal envelope: a **complete** stream with
    // `status: 'refused'` and its own exit code. A `context list` against a
    // repository with no `.context/` store looks exactly like this — which is the
    // live path here today — and misreading it as a crash would throw the remedy
    // away and describe a working Kane as a broken one (§5.3.1).
    const kane = stub({ lines: REFUSED_LINES, exitCode: 2 });
    const listing = await listStoreSources({ repoRoot: REPO, invoker: kane.invoker });

    expect(listing.ok).toBe(false);
    if (listing.ok) return;
    expect(listing.reason).toBe('no-store');
    expect(listing.stream?.kind).toBe('complete');
    expect(listing.status).toBe('refused');
    expect(listing.diagnostic.code).toBe(SOURCE_REASON_DIAGNOSTIC_CODE['no-store']);
    expect(listing.diagnostic.message).toContain(REFUSAL_MESSAGE);
    expect(listing.diagnostic.message).toContain('context ingest');
  });

  it('reads a stream with no done event as crashed-stream', async () => {
    const kane = stub({ lines: [LISTING_LINES[0] as string, LISTING_LINES[1] as string] });
    const listing = await listStoreSources({ repoRoot: REPO, invoker: kane.invoker });

    expect(listing.ok).toBe(false);
    if (listing.ok) return;
    expect(listing.reason).toBe('crashed-stream');
    expect(listing.diagnostic.code).toBe(SOURCE_REASON_DIAGNOSTIC_CODE['crashed-stream']);
    // The payload was there in full, and it is still not trusted: a listing
    // missing entries Kane had not enumerated turns a real match into a missing
    // one.
    expect(listing.projection).toBeNull();
  });

  it('reads a missing invoker, an absent binary and a pause as listing-unreadable', async () => {
    const noInvoker = await listStoreSources({ repoRoot: REPO });
    expect(noInvoker.ok).toBe(false);
    if (!noInvoker.ok) expect(noInvoker.reason).toBe('listing-unreadable');

    const absent = stub({ binary: null });
    const noBinary = await listStoreSources({ repoRoot: REPO, invoker: absent.invoker });
    expect(noBinary.ok).toBe(false);
    if (!noBinary.ok) expect(noBinary.reason).toBe('listing-unreadable');
    // No binary means no process: the stub was never asked to spawn anything.
    expect(absent.spawns).toEqual([]);

    const paused = stub({
      lines: ['{"type":"done","v":1,"verb":"context list","status":"paused","exit_code":3}'],
      exitCode: 3,
    });
    const pausedListing = await listStoreSources({ repoRoot: REPO, invoker: paused.invoker });
    expect(pausedListing.ok).toBe(false);
    if (pausedListing.ok) return;
    expect(pausedListing.reason).toBe('listing-unreadable');
    // Exit 3 is a pause, resumable, and never a failure — the message says so.
    expect(pausedListing.diagnostic.message).toContain('resumable');
  });

  it('reads our own timeout kill as listing-unreadable rather than a crash', async () => {
    const kane = stub({ hang: true });
    const listing = await listStoreSources({
      repoRoot: REPO,
      invoker: kane.invoker,
      timeoutMs: 25,
    });

    expect(listing.timedOut).toBe(true);
    expect(listing.ok).toBe(false);
    if (listing.ok) return;
    expect(listing.reason).toBe('listing-unreadable');
    expect(listing.diagnostic.message).toContain('budget');
  });

  it('reads a payload with nothing recognisable in it as listing-unreadable', async () => {
    const kane = stub({
      lines: [
        '{"type":"sources","v":1,"verb":"context list","total":3,"note":"a shape we do not know"}',
        '{"type":"done","v":1,"verb":"context list","status":"complete","exit_code":0}',
      ],
    });
    const listing = await listStoreSources({ repoRoot: REPO, invoker: kane.invoker });

    expect(listing.ok).toBe(false);
    if (listing.ok) return;
    expect(listing.reason).toBe('listing-unreadable');
    expect(listing.diagnostic.message).toContain('not an empty store');
  });

  it('reads an empty store as a listing with no sources, not as a failure', async () => {
    const kane = stub({
      lines: [
        '{"type":"sources","v":1,"verb":"context list","total":0,"sources":[]}',
        '{"type":"done","v":1,"verb":"context list","status":"complete","exit_code":0}',
      ],
    });
    const listing = await listStoreSources({ repoRoot: REPO, invoker: kane.invoker });

    // An empty store said something; the honest answer to it is the ingest
    // remedy, which is what the ladder's `no-match` carries.
    expect(read(listing)).toEqual([]);
    expect(listing.projection?.emptyArrays).toBe(1);
  });

  it('never examines the stream’s own events as candidate entries', async () => {
    const kane = stub({ lines: LISTING_LINES });
    const listing = await listStoreSources({ repoRoot: REPO, invoker: kane.invoker });
    // Only the seven members of the `sources` array were examined; the progress
    // line, the payload event and `done` are not sources and are not refused
    // entries either.
    expect(listing.projection?.examined).toBe(7);
    expect(listing.projection?.refused).toEqual([]);
    expect(listing.projection?.sources[0]?.sourceId).toBe('src_7f31c0a4');
  });
});

// ---------------------------------------------------------------------------
// resolveSourceId — the door in front of the ladder
// ---------------------------------------------------------------------------

describe('resolveSourceId composes the listing with the ladder (§13.2.2)', () => {
  /** No file on disk: the digest is stated, so rung 3 is exercised deliberately. */
  async function walk(
    file: string,
    options: {
      readonly lines?: readonly string[];
      readonly fileDigest?: string | null;
      readonly sources?: readonly StoreSource[];
      readonly sink?: CollectingDiagnosticSink;
    } = {},
  ): Promise<{ readonly resolution: SourceResolution; readonly spawns: string[][] }> {
    const kane = stub({ lines: options.lines ?? LISTING_LINES });
    const resolution = await resolveSourceId({
      repoRoot: REPO,
      file,
      invoker: kane.invoker,
      diagnostics: options.sink,
      fileDigest: options.fileDigest ?? null,
      ...(options.sources === undefined ? {} : { sources: options.sources }),
    });
    return { resolution, spawns: kane.spawns };
  }

  it('resolves an exact path through the read listing', async () => {
    const { resolution, spawns } = await walk('apps/fixture/README.md');
    expect(resolved(resolution)).toEqual({ sourceId: 'src_7f31c0a4', via: 'exact-path' });
    expect(spawns).toHaveLength(1);
  });

  it('resolves an unnormalised store path through the absolute rung', async () => {
    const { resolution } = await walk('apps/fixture/app/settings/page.tsx');
    expect(resolved(resolution)).toEqual({ sourceId: 'src_2f6c1d90', via: 'abs-path' });
  });

  it('resolves a pathless entry through the digest of the file’s bytes', async () => {
    const { resolution } = await walk('apps/fixture/app/checkout/use-case.md', {
      fileDigest: sourceDigest(BYTES.checkout),
    });
    expect(resolved(resolution)).toEqual({ sourceId: 'src_1b9d5e22', via: 'digest' });
  });

  it('resolves a moved file through its unique basename', async () => {
    const { resolution } = await walk('apps/fixture/docs/currency.md');
    expect(resolved(resolution)).toEqual({ sourceId: 'src_5e8b03df', via: 'unique-basename' });
  });

  it('answers ambiguous when one file backs two live sources', async () => {
    const { resolution } = await walk('apps/fixture/app/shop/page.tsx');
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('ambiguous');
    expect(resolution.diagnostic.message).toContain('src_44e1ba07');
    expect(resolution.diagnostic.message).toContain('src_9c2d7f58');
  });

  it('answers retired rather than handing a retired id to Kane', async () => {
    const { resolution } = await walk('apps/fixture/docs/pricing.md');
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('retired');
    expect(resolution.diagnostic.code).toBe(SOURCE_DIAGNOSTIC_CODES.retired);
  });

  it('answers no-match over an empty store and names the ingest remedy', async () => {
    const { resolution } = await walk('apps/fixture/README.md', {
      lines: [
        '{"type":"sources","v":1,"verb":"context list","total":0,"sources":[]}',
        '{"type":"done","v":1,"verb":"context list","status":"complete","exit_code":0}',
      ],
    });
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toBe('no-match');
    expect(resolution.diagnostic.message).toContain(
      'kane-cli context ingest apps/fixture/README.md',
    );
  });

  it('hands each listing failure back as the unresolved arm, unchanged', async () => {
    const cases: readonly {
      readonly reason: string;
      readonly lines: readonly string[];
      readonly exitCode?: number;
    }[] = [
      { reason: 'no-store', lines: REFUSED_LINES, exitCode: 2 },
      { reason: 'crashed-stream', lines: [LISTING_LINES[1] as string] },
    ];
    for (const testCase of cases) {
      const kane = stub({ lines: testCase.lines, exitCode: testCase.exitCode ?? 0 });
      const resolution = await resolveSourceId({
        repoRoot: REPO,
        file: 'apps/fixture/README.md',
        invoker: kane.invoker,
        fileDigest: null,
      });
      expect(resolution.ok).toBe(false);
      if (resolution.ok) continue;
      expect(resolution.reason).toBe(testCase.reason);
      expect(resolution.diagnostic.code).toBe(
        SOURCE_REASON_DIAGNOSTIC_CODE[
          testCase.reason as keyof typeof SOURCE_REASON_DIAGNOSTIC_CODE
        ],
      );
    }

    // And with no Kane at all: still a reason, still no process.
    const absent = stub({ binary: null });
    const unresolved = await resolveSourceId({
      repoRoot: REPO,
      file: 'apps/fixture/README.md',
      invoker: absent.invoker,
      fileDigest: null,
    });
    expect(unresolved.ok).toBe(false);
    if (!unresolved.ok) expect(unresolved.reason).toBe('listing-unreadable');
    expect(absent.spawns).toEqual([]);
  });

  it('runs no process at all when the sources were supplied', async () => {
    // The seam task 12.3's read-through cache uses: a fresh `.kept/sources.json`
    // answers the ladder with no `context list` at all, and `via: 'cache'` is
    // already in the union so the cache costs no type change.
    const kane = stub({ lines: LISTING_LINES });
    const cached: readonly StoreSource[] = [
      {
        sourceId: 'src_cached1',
        path: 'apps/fixture/README.md',
        absPath: resolve(REPO, 'apps/fixture/README.md'),
        digest: null,
        retired: false,
        raw: { source_id: 'src_cached1' },
      },
    ];
    const resolution = await resolveSourceId({
      repoRoot: REPO,
      file: 'apps/fixture/README.md',
      invoker: kane.invoker,
      sources: cached,
      fileDigest: null,
    });
    expect(resolved(resolution)).toEqual({ sourceId: 'src_cached1', via: 'exact-path' });
    expect(kane.spawns).toEqual([]);
  });

  it('skips the digest rung when the file’s bytes cannot be read, and says so', async () => {
    const kane = stub({ lines: LISTING_LINES });
    const sink = createDiagnosticSink();
    const resolution = await resolveSourceId({
      repoRoot: REPO,
      file: 'apps/fixture/README.md',
      invoker: kane.invoker,
      diagnostics: sink,
      readBytes: () => null,
    });
    // The path rungs still answer; an unreadable file is not an unresolved one.
    expect(resolved(resolution).via).toBe('exact-path');
    expect(sink.has(SOURCE_LISTING_DIAGNOSTIC_CODES.fileUnreadable)).toBe(true);
  });

  it('reads the bytes through the injected reader when no digest was supplied', async () => {
    const kane = stub({ lines: LISTING_LINES });
    const asked: string[] = [];
    const resolution = await resolveSourceId({
      repoRoot: REPO,
      // A file the store recorded only by digest, under a name it never saw.
      file: 'apps/fixture/docs/moved-checkout.md',
      invoker: kane.invoker,
      readBytes: (absPath) => {
        asked.push(absPath);
        return new TextEncoder().encode(BYTES.checkout);
      },
    });
    expect(asked).toEqual([resolve(REPO, 'apps/fixture/docs/moved-checkout.md')]);
    expect(resolved(resolution)).toEqual({ sourceId: 'src_1b9d5e22', via: 'digest' });
  });

  it('records every diagnostic it returns in the injected sink', async () => {
    const sink = createDiagnosticSink();
    const { resolution } = await walk('apps/fixture/app/shop/page.tsx', { sink });
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(sink.entries).toContainEqual(resolution.diagnostic);
    // The failure arms carry a reason and a diagnostic, and no `source` — so
    // `--source-id` is not reachable from any of them, which is what makes an
    // unresolved source a no-op by structure (§13.2).
    expect(Object.keys(resolution).sort()).toEqual(['diagnostic', 'ok', 'reason']);
  });
});
