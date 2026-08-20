import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LADDER_RUNGS,
  SOURCE_DIAGNOSTIC_CODES,
  SOURCE_REASON_DIAGNOSTIC_CODE,
  SOURCE_RESOLUTION_REASONS,
  SOURCE_RESOLUTION_VIA,
  absoluteSourcePath,
  createDiagnosticSink,
  matchStoreSources,
  normaliseDigest,
  normaliseSourcePath,
  repoRelativeSourcePath,
  resolveFromSources,
  sourceDigest,
  type CollectingDiagnosticSink,
  type SourceResolution,
  type StoreSource,
} from '@kept/core';

/**
 * Task 12.1 — the four-rung match ladder (design §13.2.2, R5.1, R5.2).
 *
 * Nothing here starts a process, reads a file or touches a clock. The ladder
 * takes an already-projected listing and an already-computed digest, which is
 * exactly what lets every rung be exercised over literal values: the listing is
 * built by hand from the shapes the committed
 * `test/fixtures/context-list-sources.ndjson` carries, and the digests are
 * `node:crypto` hashes of the byte strings that fixture's provenance register
 * documents. The listing invocation and its tolerant projection are task 12.2's
 * and are tested separately, so a failure here is a failure of the *decision*
 * rather than of the wire reading.
 *
 * The load-bearing assertion is not any single rung. It is that a ladder with no
 * live candidate answers with a **reason** rather than an id: `--source-id` is
 * built from the `ok: true` arm and from nowhere else, so `maintain reconcile`
 * cannot be spawned at all from any of the failure arms below. That is the
 * difference between a no-op by structure and a no-op by discipline (§13.2).
 */

const REPO = '/repo';

/** The byte strings the fixtures register pins, with their documented hashes. */
const BYTES = {
  readme: '# Fixture storefront\n',
  checkout: '# Checkout use case\n',
  pricing: '# Pricing\n',
  shop: 'export default function ShopPage() {}\n',
} as const;

const DIGESTS = {
  readme: 'c7dc998fbfb3ec23c4817491fa4f7603b27939384df0f211de1f203d4dce213d',
  checkout: 'aa4a6be837d8998dfb97713df877b620aa79c68a9df79fd8d569e28891443bc7',
  pricing: 'bed15d0e284ad747eded1f7b14779a27bb4460ec4338031a9da995b124d4673e',
  shop: 'c91d53d5b18775975873ed0fca920a1603ff32b40a0460e0f2faa885ac50d4d4',
} as const;

/**
 * Build one projected entry the way task 12.2's projection will: a repo-relative
 * path when the recorded spelling is relative, an absolute form resolved against
 * `repoRoot`, and a digest with any algorithm prefix already stripped.
 */
function source(parts: {
  readonly sourceId: string;
  readonly path?: string | null;
  readonly digest?: string | null;
  readonly retired?: boolean;
  readonly raw?: unknown;
}): StoreSource {
  const recorded = parts.path ?? null;
  return {
    sourceId: parts.sourceId,
    path: recorded === null ? null : repoRelativeSourcePath(recorded),
    absPath: recorded === null ? null : absoluteSourcePath(REPO, recorded),
    digest: normaliseDigest(parts.digest ?? null),
    retired: parts.retired ?? false,
    raw: parts.raw ?? { source_id: parts.sourceId },
  };
}

/** The seven entries of the committed fixture, projected by hand. */
const LISTING: readonly StoreSource[] = [
  source({
    sourceId: 'src_7f31c0a4',
    path: 'apps/fixture/README.md',
    digest: `sha256:${DIGESTS.readme}`,
    raw: { source_id: 'src_7f31c0a4', title: 'Fixture storefront README' },
  }),
  source({
    sourceId: 'src_1b9d5e22',
    path: null,
    digest: DIGESTS.checkout,
    raw: { id: 'src_1b9d5e22', use_case: 'checkout' },
  }),
  source({
    sourceId: 'src_c4a80f13',
    path: 'apps/fixture/docs/pricing.md',
    digest: `sha256:${DIGESTS.pricing}`,
    retired: true,
  }),
  source({
    sourceId: 'src_44e1ba07',
    path: 'apps/fixture/app/shop/page.tsx',
    digest: DIGESTS.shop,
    raw: { source_id: 'src_44e1ba07', title: 'Shop listing page' },
  }),
  source({
    sourceId: 'src_9c2d7f58',
    path: 'apps/fixture/app/shop/page.tsx',
    digest: `sha256:${DIGESTS.shop}`,
    raw: { source_id: 'src_9c2d7f58', use_case: 'shop' },
  }),
  source({ sourceId: 'src_2f6c1d90', path: 'apps/fixture/./docs/../app/settings/page.tsx' }),
  source({ sourceId: 'src_5e8b03df', path: 'docs/adr/currency.md' }),
];

interface Attempt {
  readonly resolution: SourceResolution;
  readonly sink: CollectingDiagnosticSink;
}

function walk(
  file: string,
  options: {
    readonly sources?: readonly StoreSource[];
    readonly fileDigest?: string | null;
    readonly repoRoot?: string;
  } = {},
): Attempt {
  const sink = createDiagnosticSink();
  const resolution = resolveFromSources({
    repoRoot: options.repoRoot ?? REPO,
    file,
    sources: options.sources ?? LISTING,
    fileDigest: options.fileDigest ?? null,
    diagnostics: sink,
  });
  return { resolution, sink };
}

/** Narrow to the resolved arm, failing the test rather than the type-check. */
function resolved(attempt: Attempt): { readonly sourceId: string; readonly via: string } {
  const { resolution } = attempt;
  if (!resolution.ok) {
    throw new Error(`expected a resolved source, got reason '${resolution.reason}'`);
  }
  return { sourceId: resolution.source.sourceId, via: resolution.via };
}

// ---------------------------------------------------------------------------
// The digests are real hashes of the documented bytes
// ---------------------------------------------------------------------------

describe('sourceDigest hashes bytes, not a decoded string', () => {
  it('reproduces every digest the fixtures register documents', () => {
    expect(sourceDigest(BYTES.readme)).toBe(DIGESTS.readme);
    expect(sourceDigest(BYTES.checkout)).toBe(DIGESTS.checkout);
    expect(sourceDigest(BYTES.pricing)).toBe(DIGESTS.pricing);
    expect(sourceDigest(BYTES.shop)).toBe(DIGESTS.shop);
  });

  it('hashes a Uint8Array and its UTF-8 string form identically', () => {
    const bytes = new TextEncoder().encode(BYTES.shop);
    expect(sourceDigest(bytes)).toBe(sourceDigest(BYTES.shop));
  });

  it('treats a byte sequence that is not valid UTF-8 as its own value', () => {
    // A lossy decode would map both of these onto the replacement character and
    // hand two different files the same digest.
    const first = sourceDigest(new Uint8Array([0xff, 0xfe, 0x00]));
    const second = sourceDigest(new Uint8Array([0xff, 0xfd, 0x00]));
    expect(first).not.toBe(second);
  });
});

// ---------------------------------------------------------------------------
// Rung 1 — exact repo-relative POSIX path
// ---------------------------------------------------------------------------

describe('rung 1, exact-path', () => {
  it('resolves a path the store recorded verbatim and reports exact-path', () => {
    expect(resolved(walk('apps/fixture/README.md'))).toEqual({
      sourceId: 'src_7f31c0a4',
      via: 'exact-path',
    });
  });

  it('accepts the same path in an equivalent spelling', () => {
    // `./` prefix, doubled separator, surrounding whitespace and a Windows
    // separator are all the same path written differently. Reading a value is
    // not guessing at one.
    for (const spelling of [
      './apps/fixture/README.md',
      'apps//fixture/README.md',
      '  apps/fixture/README.md  ',
      'apps\\fixture\\README.md',
    ]) {
      expect(resolved(walk(spelling)).via).toBe('exact-path');
    }
  });

  it('records the accepted rung as a diagnostic naming the id', () => {
    const attempt = walk('apps/fixture/README.md');
    const recorded = attempt.sink.withCode(SOURCE_DIAGNOSTIC_CODES.resolved);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.message).toContain('src_7f31c0a4');
    expect(recorded[0]?.message).toContain('exact-path');
    expect(recorded[0]?.severity).toBe('info');
  });

  it('is case-sensitive, because two spellings are two files', () => {
    expect(walk('apps/fixture/readme.md').resolution.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rung 2 — absolute path resolved against repoRoot
// ---------------------------------------------------------------------------

describe('rung 2, abs-path', () => {
  it('matches an entry the store recorded unnormalised, and reports abs-path', () => {
    // Entry 6 of the fixture: `apps/fixture/./docs/../app/settings/page.tsx`.
    // String equality misses it; resolving both sides against repoRoot does not.
    expect(resolved(walk('apps/fixture/app/settings/page.tsx'))).toEqual({
      sourceId: 'src_2f6c1d90',
      via: 'abs-path',
    });
  });

  it('matches when the query itself is absolute', () => {
    const absolute = resolve(REPO, 'apps/fixture/README.md');
    // An absolute query has no repo-relative form at all, so rung 1 cannot fire
    // and the rung that answers is the one that resolved both sides.
    expect(resolved(walk(absolute))).toEqual({
      sourceId: 'src_7f31c0a4',
      via: 'abs-path',
    });
  });

  it('does not fold rung 2 into rung 1 by collapsing segments early', () => {
    // The normalisation the projection uses keeps `..` in place on purpose: if it
    // collapsed them, entry 6 would match rung 1 and rung 2 could never report
    // itself. This is the assertion that pins that decision.
    expect(normaliseSourcePath('apps/fixture/./docs/../app/settings/page.tsx')).toBe(
      'apps/fixture/./docs/../app/settings/page.tsx',
    );
    expect(absoluteSourcePath(REPO, 'apps/fixture/./docs/../app/settings/page.tsx')).toBe(
      resolve(REPO, 'apps/fixture/app/settings/page.tsx'),
    );
  });

  it('resolves a different repoRoot to a different absolute path', () => {
    const elsewhere = walk('apps/fixture/app/settings/page.tsx', {
      repoRoot: '/elsewhere',
    });
    // The listing above was projected against `/repo`, so the same relative query
    // under another root matches nothing at rung 2 — and falls to rung 4, where
    // `page.tsx` is the basename of three entries.
    expect(elsewhere.resolution.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rung 3 — sha256 of the file's current bytes
// ---------------------------------------------------------------------------

describe('rung 3, digest', () => {
  it('matches an entry that carries no path at all, and reports digest', () => {
    // Entry 2 of the fixture: an `id` and an `sha256`, no path field. The digest
    // rung exists for exactly this entry, and it is a normal entry rather than a
    // broken one.
    expect(
      resolved(
        walk('apps/fixture/app/checkout/use-case.md', {
          fileDigest: sourceDigest(BYTES.checkout),
        }),
      ),
    ).toEqual({ sourceId: 'src_1b9d5e22', via: 'digest' });
  });

  it('matches a recorded digest whichever spelling it arrived in', () => {
    expect(normaliseDigest(`sha256:${DIGESTS.readme.toUpperCase()}`)).toBe(DIGESTS.readme);
    expect(normaliseDigest(`  SHA256:${DIGESTS.readme}  `)).toBe(DIGESTS.readme);
    // Entry 1 records the prefixed form; the computed digest is bare hex.
    const attempt = walk('apps/fixture/docs/moved-readme.md', {
      fileDigest: DIGESTS.readme,
    });
    expect(resolved(attempt)).toEqual({ sourceId: 'src_7f31c0a4', via: 'digest' });
  });

  it('is skipped entirely when the bytes could not be read', () => {
    // A file we cannot read is not a file whose digest is "no digest": entry 6
    // records no digest, and a null-against-null match would hand Kane an id
    // derived from nothing.
    const attempt = walk('apps/fixture/docs/unreadable.md', { fileDigest: null });
    expect(attempt.resolution.ok).toBe(false);
    if (!attempt.resolution.ok) expect(attempt.resolution.reason).toBe('no-match');
  });

  it('never matches on a digest prefix or a truncated hex string', () => {
    const attempt = walk('apps/fixture/docs/moved.md', {
      fileDigest: DIGESTS.readme.slice(0, 12),
    });
    expect(attempt.resolution.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rung 4 — basename equality with exactly one live candidate
// ---------------------------------------------------------------------------

describe('rung 4, unique-basename', () => {
  it('matches a moved file whose basename is unique in the listing', () => {
    // Entry 7 records `docs/adr/currency.md`; the file now lives under
    // `apps/fixture/docs/`. `currency.md` is unique, so the rung can answer.
    expect(resolved(walk('apps/fixture/docs/currency.md'))).toEqual({
      sourceId: 'src_5e8b03df',
      via: 'unique-basename',
    });
  });

  it('keys on the basename of whichever spelling the entry carried', () => {
    const listing = [source({ sourceId: 'src_abs01', path: '/repo/deep/only-here.md' })];
    expect(resolved(walk('other/place/only-here.md', { sources: listing })).via).toBe(
      'unique-basename',
    );
  });

  it('refuses to answer when the basename is shared by two live entries', () => {
    // `page.tsx` is the basename of entries 4, 5 and 6. Three candidates is not a
    // weaker version of one candidate.
    const attempt = walk('somewhere/else/page.tsx');
    expect(attempt.resolution.ok).toBe(false);
    if (!attempt.resolution.ok) expect(attempt.resolution.reason).toBe('ambiguous');
  });
});

// ---------------------------------------------------------------------------
// First hit wins, and the rungs are walked in the documented order
// ---------------------------------------------------------------------------

describe('the ladder is first-hit-wins in a fixed order', () => {
  it('prefers the exact path over the digest that names another entry', () => {
    // The README's own path is recorded on entry 1 and the checkout bytes hash to
    // entry 2. Handing both facts in at once must answer with the path rung.
    const attempt = walk('apps/fixture/README.md', {
      fileDigest: sourceDigest(BYTES.checkout),
    });
    expect(resolved(attempt)).toEqual({ sourceId: 'src_7f31c0a4', via: 'exact-path' });
  });

  it('prefers the absolute match over a unique basename elsewhere', () => {
    const listing = [
      source({ sourceId: 'src_rel01', path: 'apps/fixture/./app/settings/page.tsx' }),
      source({ sourceId: 'src_base01', path: 'archive/settings-page.tsx' }),
    ];
    expect(resolved(walk('apps/fixture/app/settings/page.tsx', { sources: listing })).via).toBe(
      'abs-path',
    );
  });

  it('exposes all four rungs, in ladder order, for the fork guard to reuse', () => {
    const matches = matchStoreSources({
      repoRoot: REPO,
      file: 'apps/fixture/app/shop/page.tsx',
      sources: LISTING,
      fileDigest: sourceDigest(BYTES.shop),
    });
    expect(matches.rungs.map((rung) => rung.rung)).toEqual([...LADDER_RUNGS]);
    // Entries 4 and 5 are the fork-guard pair: one file, two live sources, both
    // reachable on the path rung and on the digest rung.
    const exact = matches.rungs[0];
    expect(exact?.live.map((entry) => entry.sourceId)).toEqual(['src_44e1ba07', 'src_9c2d7f58']);
    expect(matches.rungs[2]?.live.map((entry) => entry.sourceId)).toEqual([
      'src_44e1ba07',
      'src_9c2d7f58',
    ]);
    expect(matches.relPath).toBe('apps/fixture/app/shop/page.tsx');
    expect(matches.absPath).toBe(resolve(REPO, 'apps/fixture/app/shop/page.tsx'));
  });
});

// ---------------------------------------------------------------------------
// No fuzzy matching at any rung
// ---------------------------------------------------------------------------

describe('no fuzzy matching at any rung', () => {
  it('never consults a title, a use-case name or ordinal position', () => {
    const listing = [
      source({
        sourceId: 'src_title1',
        path: 'somewhere/entirely/other.md',
        raw: { source_id: 'src_title1', title: 'apps/fixture/README.md' },
      }),
      source({
        sourceId: 'src_case01',
        path: 'another/place.md',
        raw: { source_id: 'src_case01', use_case: 'readme' },
      }),
    ];
    const attempt = walk('apps/fixture/README.md', { sources: listing });
    expect(attempt.resolution.ok).toBe(false);
    if (!attempt.resolution.ok) expect(attempt.resolution.reason).toBe('no-match');
  });

  it('does not answer with the first entry, the last entry or the lower id', () => {
    const forward = [
      source({ sourceId: 'src_fork0001', path: 'apps/fixture/README.md' }),
      source({ sourceId: 'src_fork0002', path: 'apps/fixture/README.md' }),
    ];
    const backward = [...forward].reverse();
    for (const listing of [forward, backward]) {
      const attempt = walk('apps/fixture/README.md', { sources: listing });
      expect(attempt.resolution.ok).toBe(false);
      if (!attempt.resolution.ok) {
        expect(attempt.resolution.reason).toBe('ambiguous');
        expect(attempt.resolution.diagnostic.message).toContain('src_fork0001');
        expect(attempt.resolution.diagnostic.message).toContain('src_fork0002');
      }
    }
  });

  it('does not match a near-miss filename, however close it looks', () => {
    // Every one of these differs from `README.md` in its basename, so no rung can
    // reach it. A *directory* that differs is a different matter: rung 4 answers
    // there deliberately, and only when the basename is unique.
    for (const near of [
      'apps/fixture/READM.md',
      'apps/fixture/README.markdown',
      'apps/fixture/README',
      'apps/fixture/README.md.bak',
    ]) {
      const attempt = walk(near, { sources: [LISTING[0] as StoreSource] });
      expect(attempt.resolution.ok, `${near} must not resolve`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The failure arms
// ---------------------------------------------------------------------------

describe('no-match', () => {
  it('answers no-match over an empty listing and quotes the ingest remedy', () => {
    const attempt = walk('apps/fixture/README.md', { sources: [] });
    expect(attempt.resolution.ok).toBe(false);
    if (attempt.resolution.ok) return;
    expect(attempt.resolution.reason).toBe('no-match');
    expect(attempt.resolution.diagnostic.code).toBe(SOURCE_DIAGNOSTIC_CODES.unresolved);
    expect(attempt.resolution.diagnostic.message).toContain(
      'kane-cli context ingest apps/fixture/README.md',
    );
    expect(attempt.resolution.diagnostic.file).toBe('apps/fixture/README.md');
    expect(attempt.resolution.diagnostic.severity).toBe('warn');
  });

  it('records the diagnostic it embeds, once, in the injected sink', () => {
    const attempt = walk('apps/fixture/README.md', { sources: [] });
    expect(attempt.sink.entries).toHaveLength(1);
    if (!attempt.resolution.ok) {
      expect(attempt.sink.entries[0]).toEqual(attempt.resolution.diagnostic);
    }
  });
});

describe('ambiguous', () => {
  it('names every tied id and refuses to choose', () => {
    const attempt = walk('apps/fixture/app/shop/page.tsx');
    expect(attempt.resolution.ok).toBe(false);
    if (attempt.resolution.ok) return;
    expect(attempt.resolution.reason).toBe('ambiguous');
    expect(attempt.resolution.diagnostic.code).toBe(SOURCE_DIAGNOSTIC_CODES.ambiguous);
    expect(attempt.resolution.diagnostic.message).toContain('src_44e1ba07');
    expect(attempt.resolution.diagnostic.message).toContain('src_9c2d7f58');
  });

  it('is not softened by a retired entry tying alongside one live match', () => {
    // A retired source cannot fork a graph, so it is not a competing candidate.
    const listing = [
      source({ sourceId: 'src_live01', path: 'apps/fixture/README.md' }),
      source({ sourceId: 'src_dead01', path: 'apps/fixture/README.md', retired: true }),
    ];
    const attempt = walk('apps/fixture/README.md', { sources: listing });
    expect(resolved(attempt)).toEqual({ sourceId: 'src_live01', via: 'exact-path' });
    expect(attempt.sink.entries[0]?.message).toContain('retired');
  });
});

describe('retired', () => {
  it('answers retired rather than handing a retired id to Kane', () => {
    // Entry 3 of the fixture carries `status: "retired"`.
    const attempt = walk('apps/fixture/docs/pricing.md');
    expect(attempt.resolution.ok).toBe(false);
    if (attempt.resolution.ok) return;
    expect(attempt.resolution.reason).toBe('retired');
    expect(attempt.resolution.diagnostic.code).toBe(SOURCE_DIAGNOSTIC_CODES.retired);
    expect(attempt.resolution.diagnostic.message).toContain('src_c4a80f13');
  });

  it('answers retired on the digest rung too, not only on a path', () => {
    const attempt = walk('apps/fixture/docs/renamed-pricing.md', {
      fileDigest: sourceDigest(BYTES.pricing),
    });
    expect(attempt.resolution.ok).toBe(false);
    if (!attempt.resolution.ok) expect(attempt.resolution.reason).toBe('retired');
  });
});

// ---------------------------------------------------------------------------
// Totality, and the closed vocabularies
// ---------------------------------------------------------------------------

describe('the ladder is total and never throws', () => {
  it('survives an empty file, a bare dot and a path that escapes the root', () => {
    for (const file of ['', '.', '..', '../outside/README.md', '   ']) {
      const attempt = walk(file, { sources: LISTING });
      expect(typeof attempt.resolution.ok).toBe('boolean');
    }
  });

  it('drops a path-ish value that cannot be repo-relative', () => {
    expect(repoRelativeSourcePath('/absolute/README.md')).toBeNull();
    expect(repoRelativeSourcePath('file:///repo/README.md')).toBeNull();
    expect(repoRelativeSourcePath('../escapes/README.md')).toBeNull();
    expect(repoRelativeSourcePath(42)).toBeNull();
    expect(repoRelativeSourcePath('')).toBeNull();
  });

  it('decodes a file URI into the absolute path it names', () => {
    // Path normalisation collapses `//`, so the scheme survives as `file:/…`.
    // Recognising it there is what keeps a URI off rung 1 and out of rung 4's
    // basename comparison as a phantom repo-relative path.
    for (const spelling of [
      'file:///repo/apps/fixture/README%20copy.md',
      'file:/repo/apps/fixture/README%20copy.md',
      'FILE:///repo/apps/fixture/README copy.md',
    ]) {
      expect(absoluteSourcePath(REPO, spelling)).toBe('/repo/apps/fixture/README copy.md');
    }
    expect(repoRelativeSourcePath('file:///repo/README.md')).toBeNull();
    // An opaque `file:` value names no path, so it is left as the relative string
    // it looks like rather than promoted to an absolute one it never named.
    expect(repoRelativeSourcePath('file:relative.md')).toBe('file:relative.md');
  });

  it('answers null for a digest that is not a non-empty string', () => {
    expect(normaliseDigest(null)).toBeNull();
    expect(normaliseDigest('   ')).toBeNull();
    expect(normaliseDigest('sha256:')).toBeNull();
    expect(normaliseDigest(7)).toBeNull();
  });

  it('carries the whole failure vocabulary and one diagnostic code per reason', () => {
    expect([...SOURCE_RESOLUTION_REASONS]).toEqual([
      'no-store',
      'listing-unreadable',
      'crashed-stream',
      'no-match',
      'ambiguous',
      'retired',
    ]);
    for (const reason of SOURCE_RESOLUTION_REASONS) {
      expect(typeof SOURCE_REASON_DIAGNOSTIC_CODE[reason]).toBe('string');
    }
    // `cache` leads the `via` union so 12.3's read-through cache slots in front of
    // the ladder without changing the type.
    expect([...SOURCE_RESOLUTION_VIA]).toEqual(['cache', ...LADDER_RUNGS]);
  });
});
