import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ADMISSION_DIAGNOSTIC_CODES,
  BASELINE_DIAGNOSTIC_CODES,
  FRONTMATTER_MAX_LINES,
  MAX_SCAN_DEPTH,
  TEST_DOCUMENT_SUFFIX,
  baselineProvider,
  buildBaselineOnlyGraph,
  collectBaseline,
  createDiagnosticSink,
  extractVerifiesTags,
  inMemoryBaselineFileSystem,
  inMemoryCitationSource,
  isSkippedDirectoryName,
  isTestDocumentName,
  isUndecodableDocument,
  nodeBaselineFileSystem,
  readFrontmatter,
  type BaselineContext,
  type BaselineDirEntry,
  type BaselineFileSystem,
} from '@kept/core';
// Imported from the module rather than the barrel: the two readers below landed with
// the Kane-format reconciliation (15.2), and this file has to compile at that commit
// whether or not the barrel has caught up with them yet.
import { extractCoversGlobs, readDocumentCovers } from '../src/providers/baseline.js';

/**
 * Unit coverage for the baseline promise provider (design §5.2, R2.1–R2.4).
 *
 * The property suite (`baseline-totality.prop.test.ts`) owns totality across
 * generated repositories. What is asserted here is the concrete grammar: which
 * `@verifies` shapes are accepted and which are named as malformed, exactly where
 * the frontmatter reader stops, that skipped directories are genuinely never
 * descended into, and that candidates reach the graph only through the admission
 * gate with their citation text read from disk.
 */

const REPO_ROOT = '/tmp/kept-baseline-unit';

function lines(...parts: readonly string[]): string {
  return `${parts.join('\n')}\n`;
}

describe('baseline provider — name predicates', () => {
  it('matches only files ending in the test-document suffix', () => {
    expect(TEST_DOCUMENT_SUFFIX).toBe('_test.md');
    expect(isTestDocumentName('checkout_test.md')).toBe(true);
    expect(isTestDocumentName('_test.md')).toBe(true);
    expect(isTestDocumentName('checkout_test.mdx')).toBe(false);
    expect(isTestDocumentName('checkout-test.md')).toBe(false);
    expect(isTestDocumentName('CHECKOUT_TEST.MD')).toBe(false);
  });

  it('skips the six directory shapes of design §5.2', () => {
    for (const name of ['node_modules', '.git', '.next', 'dist', '.testmuai']) {
      expect(isSkippedDirectoryName(name)).toBe(true);
    }
    expect(isSkippedDirectoryName('output-2026-02-01T09-00-00Z')).toBe(true);
    expect(isSkippedDirectoryName('output')).toBe(false);
    expect(isSkippedDirectoryName('docs')).toBe(false);
    expect(isSkippedDirectoryName('distribution')).toBe(false);
  });
});

describe('baseline provider — the hand-rolled frontmatter reader', () => {
  it('reads the four supported forms', () => {
    const frontmatter = readFrontmatter([
      '---',
      'test_id: T-3',
      '# a comment',
      'tags: [checkout, subtotal]',
      'covers:',
      '  - apps/fixture/README.md',
      '  - docs/promises.md',
      '',
      '---',
      'body',
    ]);
    expect(frontmatter.present).toBe(true);
    expect(frontmatter.terminated).toBe(true);
    expect(frontmatter.testId).toBe('T-3');
    expect(frontmatter.tags).toEqual(['checkout', 'subtotal']);
    expect(frontmatter.covers).toEqual(['apps/fixture/README.md', 'docs/promises.md']);
    expect(frontmatter.lineSpan).toBe(9);
    expect(frontmatter.unparsedLines).toEqual([]);
  });

  it('reports no frontmatter when the document does not open with a fence', () => {
    expect(readFrontmatter(['# title', 'test_id: T-1', '---']).present).toBe(false);
  });

  it('closes on the twentieth body line and gives up on the twenty-first', () => {
    const filler = Array.from({ length: FRONTMATTER_MAX_LINES - 1 }, (_, i) => `k${i}: v${i}`);
    const justInside = readFrontmatter(['---', ...filler, 'test_id: T-9', '---']);
    expect(justInside.terminated).toBe(true);
    expect(justInside.testId).toBe('T-9');

    const justOutside = readFrontmatter(['---', ...filler, 'k19: v19', 'test_id: T-9', '---']);
    expect(justOutside.present).toBe(true);
    expect(justOutside.terminated).toBe(false);
    expect(justOutside.testId).toBeNull();
    expect(justOutside.lineSpan).toBe(0);
  });

  it('records a line that matches none of the supported forms, and keeps going', () => {
    const frontmatter = readFrontmatter(['---', 'test_id: T-4', 'this is prose', '---']);
    expect(frontmatter.terminated).toBe(true);
    expect(frontmatter.testId).toBe('T-4');
    expect(frontmatter.unparsedLines).toEqual([3]);
  });

  it('treats a key truncated mid-block as an unterminated fence', () => {
    const frontmatter = readFrontmatter(['---', 'test_id']);
    expect(frontmatter.present).toBe(true);
    expect(frontmatter.terminated).toBe(false);
  });

  it('reads the logical id out of Kane’s `assurance` block', () => {
    // The only spelling `kane-cli` 0.8.4 accepts: a root `test_id:` is rejected as
    // an unknown config key at exit two, before a browser launches, so every
    // runnable document in the committed corpus declares its id here.
    const frontmatter = readFrontmatter([
      '---',
      'mode: testing',
      'assurance:',
      '  id: T-3',
      '  base: sha256:ce82c727',
      'tags: [cart, subtotal]',
      '---',
    ]);
    expect(frontmatter.testId).toBe('T-3');
    expect(frontmatter.tags).toEqual(['cart', 'subtotal']);
    expect(frontmatter.unparsedLines).toEqual([]);
  });

  it('preserves the case of an id rather than normalising it', () => {
    // Kane writes its own ids lower-case; KEPT's corpus is authored upper-case and
    // 0.8.4 accepts either. The value is a lookup hint, so it is read verbatim.
    expect(readFrontmatter(['---', 'assurance:', '  id: t-4', '---']).testId).toBe('t-4');
  });

  it('prefers `assurance.id` over a legacy root `test_id`', () => {
    const frontmatter = readFrontmatter([
      '---',
      'test_id: T-legacy',
      'assurance:',
      '  id: T-3',
      '---',
    ]);
    expect(frontmatter.testId).toBe('T-3');
  });

  it('still reads a bare `covers:` list after a nested mapping block', () => {
    const frontmatter = readFrontmatter([
      '---',
      'assurance:',
      '  id: T-3',
      'covers:',
      '  - apps/fixture/lib/cart.ts',
      '---',
    ]);
    expect(frontmatter.testId).toBe('T-3');
    expect(frontmatter.covers).toEqual(['apps/fixture/lib/cart.ts']);
  });
});

describe('baseline provider — the @covers body annotation', () => {
  it('reads comma-separated globs out of an HTML comment', () => {
    expect(
      extractCoversGlobs(['<!-- @covers apps/fixture/lib/cart.ts, apps/fixture/app/cart/** -->']),
    ).toEqual(['apps/fixture/lib/cart.ts', 'apps/fixture/app/cart/**']);
  });

  it('contributes nothing for a bare marker and keeps no comment delimiter', () => {
    expect(extractCoversGlobs(['<!-- @covers -->', 'prose', '@covers'])).toEqual([]);
  });

  it('unions both homes, frontmatter first, de-duplicated', () => {
    const document = [
      '---',
      'assurance:',
      '  id: T-3',
      'covers:',
      '  - apps/fixture/lib/cart.ts',
      '---',
      '# title',
      '<!-- @covers apps/fixture/lib/cart.ts apps/fixture/app/cart/** -->',
    ];
    expect(readDocumentCovers(document)).toEqual([
      'apps/fixture/lib/cart.ts',
      'apps/fixture/app/cart/**',
    ]);
  });

  it('answers an empty list for a document that declares no globs at all', () => {
    expect(readDocumentCovers(['---', 'assurance:', '  id: T-3', '---', '# title'])).toEqual([]);
  });
});

describe('baseline provider — the @verifies grammar', () => {
  it('accepts a tag with trailing free text and drops the prose', () => {
    const scan = extractVerifiesTags([
      '<!-- @verifies apps/fixture/README.md:16 the subtotal claim -->',
    ]);
    expect(scan.tags).toHaveLength(1);
    expect(scan.tags[0]?.file).toBe('apps/fixture/README.md');
    expect(scan.tags[0]?.line).toBe(16);
    expect(scan.tags[0]?.trailing).toBe('the subtotal claim -->');
    expect(scan.rejected).toEqual([]);
  });

  it('accepts several tags on one line, and leading zeros', () => {
    const scan = extractVerifiesTags(['@verifies a.md:007 and @verifies b.md:2']);
    expect(scan.tags.map((tag) => [tag.file, tag.line])).toEqual([
      ['a.md', 7],
      ['b.md', 2],
    ]);
  });

  it('normalises a backslash path and reports the document line the tag sat on', () => {
    const scan = extractVerifiesTags(['x', 'y', '@verifies docs\\promises.md:3'], 10);
    expect(scan.tags[0]?.file).toBe('docs/promises.md');
    expect(scan.tags[0]?.at).toBe(12);
  });

  it('rejects the malformed shapes, once per line, naming the line', () => {
    const scan = extractVerifiesTags([
      '@verifies README.md 12',
      '@verifies README.md:abc',
      '@verifies a:b.md:12',
      '@verifies',
    ]);
    expect(scan.tags).toEqual([]);
    expect(scan.rejected.map((entry) => [entry.at, entry.reason])).toEqual([
      [1, 'malformed'],
      [2, 'malformed'],
      [3, 'malformed'],
      [4, 'malformed'],
    ]);
  });

  it('rejects a line number no citation can have', () => {
    const scan = extractVerifiesTags(['@verifies README.md:0', '@verifies README.md:99999999999999999999']);
    expect(scan.tags).toEqual([]);
    expect(scan.rejected.map((entry) => entry.reason)).toEqual(['line-invalid', 'line-invalid']);
  });

  it('ignores lines that never mention the marker', () => {
    expect(extractVerifiesTags(['# title', '', 'prose about verification'])).toEqual({
      tags: [],
      rejected: [],
    });
  });
});

describe('baseline provider — undecodable documents', () => {
  it('treats a NUL byte and a wall of replacement characters as not text', () => {
    expect(isUndecodableDocument('# fine\n')).toBe(false);
    expect(isUndecodableDocument('# fine \ufffd here\n')).toBe(false);
    expect(isUndecodableDocument('a\u0000b')).toBe(true);
    expect(isUndecodableDocument('\ufffd\ufffd\ufffd\ufffd')).toBe(true);
  });
});

describe('baseline provider — the scan', () => {
  const documents = {
    'apps/fixture/checkout_test.md': lines(
      '---',
      'test_id: T-3',
      'tags: [checkout]',
      '---',
      '',
      '<!-- @verifies apps/fixture/README.md:2 the subtotal claim -->',
    ),
    'docs/api_test.md': lines('@verifies docs/api.md:1'),
    'docs/notes.md': lines('@verifies docs/api.md:1'),
    'node_modules/pkg/hidden_test.md': lines('@verifies docs/api.md:1'),
    '.git/hooks/hidden_test.md': lines('@verifies docs/api.md:1'),
    '.next/cache/hidden_test.md': lines('@verifies docs/api.md:1'),
    'dist/hidden_test.md': lines('@verifies docs/api.md:1'),
    'output-2026/hidden_test.md': lines('@verifies docs/api.md:1'),
    '.testmuai/hidden_test.md': lines('@verifies docs/api.md:1'),
  } as const;

  const cited = {
    'apps/fixture/README.md': lines('# Fixture', 'The subtotal always excludes shipping.'),
    'docs/api.md': lines('Every endpoint answers within one second.'),
  } as const;

  it('finds test documents outside the skipped directories and nowhere inside them', async () => {
    const result = await collectBaseline({
      repoRoot: REPO_ROOT,
      fs: inMemoryBaselineFileSystem(documents),
      citations: inMemoryCitationSource(cited),
    });

    expect(result.ok).toBe(true);
    expect(result.degradedReason).toBeNull();
    expect(result.provider).toBe('baseline');
    expect(result.files).toEqual(['apps/fixture/checkout_test.md', 'docs/api_test.md']);
    expect(result.skipped).toEqual([]);
    expect(result.tagCount).toBe(2);
    expect(result.axes.size).toBe(0);
  });

  it('takes the claim from the cited line and the designed test from frontmatter', async () => {
    const result = await collectBaseline({
      repoRoot: REPO_ROOT,
      fs: inMemoryBaselineFileSystem(documents),
      citations: inMemoryCitationSource(cited),
    });

    const candidate = result.candidates.find(
      (entry) => entry.citation?.file === 'apps/fixture/README.md',
    );
    expect(candidate?.claim).toBe('The subtotal always excludes shipping.');
    expect(candidate?.citation?.line).toBe(2);
    expect(candidate?.provider).toBe('baseline');
    expect(candidate?.designedTest).toEqual({
      path: 'apps/fixture/checkout_test.md',
      testId: 'T-3',
    });

    const untagged = result.candidates.find((entry) => entry.citation?.file === 'docs/api.md');
    expect(untagged?.designedTest).toEqual({ path: 'docs/api_test.md', testId: null });
  });

  it('distinguishes a repository with no test documents from one where every document is unreadable', async () => {
    const empty = await collectBaseline({
      repoRoot: REPO_ROOT,
      fs: inMemoryBaselineFileSystem({ 'README.md': '# nothing to see\n' }),
      citations: inMemoryCitationSource({}),
    });
    expect(empty.files).toEqual([]);
    expect(empty.skipped).toEqual([]);
    expect(empty.candidates).toEqual([]);
    expect(empty.diagnostics.map((entry) => entry.code)).toEqual([
      BASELINE_DIAGNOSTIC_CODES.noTestDocuments,
    ]);

    const unreadable = await collectBaseline({
      repoRoot: REPO_ROOT,
      fs: inMemoryBaselineFileSystem({
        'a_test.md': 'header\u0000\u0000binary',
        'b_test.md': 'plan\u0000binary',
      }),
      citations: inMemoryCitationSource({}),
    });
    expect(unreadable.files).toEqual(['a_test.md', 'b_test.md']);
    expect(unreadable.skipped).toEqual(['a_test.md', 'b_test.md']);
    expect(unreadable.candidates).toEqual([]);
    expect(
      unreadable.diagnostics.every(
        (entry) => entry.code === BASELINE_DIAGNOSTIC_CODES.documentNotText,
      ),
    ).toBe(true);
    expect(unreadable.diagnostics.map((entry) => entry.file)).toEqual(['a_test.md', 'b_test.md']);
    expect(
      unreadable.diagnostics.some(
        (entry) => entry.code === BASELINE_DIAGNOSTIC_CODES.noTestDocuments,
      ),
    ).toBe(false);
  });

  it('skips one unreadable document, names it, and keeps scanning the rest', async () => {
    const failing: BaselineFileSystem = {
      readDirectory(dir: string): readonly BaselineDirEntry[] {
        if (dir !== '') throw new Error(`unexpected directory ${dir}`);
        return [
          { name: 'broken_test.md', isDirectory: false, isFile: true },
          { name: 'good_test.md', isDirectory: false, isFile: true },
        ];
      },
      readFile(file: string): string | null {
        if (file === 'broken_test.md') throw new Error('EACCES: permission denied');
        return lines('@verifies docs/api.md:1');
      },
    };

    const result = await collectBaseline({
      repoRoot: REPO_ROOT,
      fs: failing,
      citations: inMemoryCitationSource(cited),
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toEqual(['broken_test.md']);
    expect(result.candidates).toHaveLength(1);
    const diagnostic = result.diagnostics.find(
      (entry) => entry.code === BASELINE_DIAGNOSTIC_CODES.documentUnreadable,
    );
    expect(diagnostic?.file).toBe('broken_test.md');
    expect(diagnostic?.message).toContain('broken_test.md');
  });

  it('succeeds with a diagnostic when the repository root cannot be listed at all', async () => {
    const absent: BaselineFileSystem = {
      readDirectory(): readonly BaselineDirEntry[] {
        throw new Error('ENOENT: no such file or directory');
      },
      readFile(): string | null {
        return null;
      },
    };
    const result = await collectBaseline({
      repoRoot: '/nowhere/at/all',
      fs: absent,
      citations: inMemoryCitationSource({}),
    });
    expect(result.ok).toBe(true);
    expect(result.degradedReason).toBeNull();
    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.map((entry) => entry.code)).toEqual([
      BASELINE_DIAGNOSTIC_CODES.directoryUnreadable,
      BASELINE_DIAGNOSTIC_CODES.noTestDocuments,
    ]);
  });

  it('truncates a cyclic filesystem at the depth cap instead of hanging', async () => {
    const cyclic: BaselineFileSystem = {
      readDirectory(): readonly BaselineDirEntry[] {
        return [
          { name: 'loop', isDirectory: true, isFile: false },
          { name: 'ring_test.md', isDirectory: false, isFile: true },
        ];
      },
      readFile(): string | null {
        return lines('@verifies docs/api.md:1');
      },
    };
    const result = await collectBaseline({
      repoRoot: REPO_ROOT,
      fs: cyclic,
      citations: inMemoryCitationSource(cited),
    });
    expect(result.ok).toBe(true);
    expect(result.files).toHaveLength(MAX_SCAN_DEPTH + 1);
    expect(
      result.diagnostics.some((entry) => entry.code === BASELINE_DIAGNOSTIC_CODES.depthCapped),
    ).toBe(true);
  });

  it('scans the whole document when the frontmatter fence never closes', async () => {
    const result = await collectBaseline({
      repoRoot: REPO_ROOT,
      fs: inMemoryBaselineFileSystem({
        'a_test.md': lines('---', 'test_id: T-1', '@verifies docs/api.md:1'),
      }),
      citations: inMemoryCitationSource(cited),
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.designedTest?.testId).toBeNull();
    expect(
      result.diagnostics.some(
        (entry) => entry.code === BASELINE_DIAGNOSTIC_CODES.frontmatterUnterminated,
      ),
    ).toBe(true);
  });

  it('exposes itself through the shared adapter interface', async () => {
    expect(baselineProvider.name).toBe('baseline');
    // A `BaselineContext` is a `ProviderContext`, so the provider is usable
    // through the shared interface with its seams still injected (R2.1).
    const context: BaselineContext = {
      repoRoot: REPO_ROOT,
      fs: inMemoryBaselineFileSystem(documents),
      citations: inMemoryCitationSource(cited),
    };
    const result = await baselineProvider.collect(context);
    expect(result.ok).toBe(true);
    expect(result.candidates).toHaveLength(2);
  });
});

describe('baseline provider — the admission funnel', () => {
  it('admits resolvable citations with their text read from disk', async () => {
    const { result, batch } = await buildBaselineOnlyGraph({
      repoRoot: '/tmp/kept-baseline-funnel',
      fs: inMemoryBaselineFileSystem({
        'checkout_test.md': lines('@verifies README.md:2 the subtotal claim'),
      }),
      citations: inMemoryCitationSource({
        'README.md': lines('# Fixture', 'The subtotal always excludes shipping.'),
      }),
    });

    expect(result.ok).toBe(true);
    expect(batch.graph.degraded).toBe(false);
    expect(batch.graph.degradedReasons).toEqual([]);
    expect(batch.admitted).toHaveLength(1);
    expect(batch.admitted[0]?.citation.text).toBe('The subtotal always excludes shipping.');
    expect(batch.admitted[0]?.claim).toBe('The subtotal always excludes shipping.');
    expect(batch.admitted[0]?.providers).toEqual(['baseline']);
    expect(batch.rejected).toEqual([]);
  });

  it('lets the gate refuse a stale citation rather than dropping it silently', async () => {
    const sink = createDiagnosticSink();
    const { batch } = await buildBaselineOnlyGraph({
      repoRoot: '/tmp/kept-baseline-stale',
      diagnostics: sink,
      fs: inMemoryBaselineFileSystem({
        'checkout_test.md': lines('@verifies README.md:41', '@verifies GONE.md:1'),
      }),
      citations: inMemoryCitationSource({ 'README.md': lines('one', 'two') }),
    });

    expect(batch.admitted).toEqual([]);
    expect(batch.rejected.map((entry) => entry.reason)).toEqual([
      'line-out-of-range',
      'file-missing',
    ]);
    expect(sink.has(ADMISSION_DIAGNOSTIC_CODES.lineOutOfRange)).toBe(true);
    expect(sink.has(ADMISSION_DIAGNOSTIC_CODES.fileMissing)).toBe(true);
  });

  it('collapses duplicate tags in one document to a single promise', async () => {
    const { result, batch } = await buildBaselineOnlyGraph({
      repoRoot: '/tmp/kept-baseline-dupe',
      fs: inMemoryBaselineFileSystem({
        'checkout_test.md': lines('@verifies README.md:1', '@verifies README.md:1 again'),
      }),
      citations: inMemoryCitationSource({ 'README.md': lines('One claim.') }),
    });
    expect(result.tagCount).toBe(2);
    expect(batch.admitted).toHaveLength(1);
  });
});

describe('baseline provider — against a real temporary tree', () => {
  let root = '';

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'kept-baseline-'));
    mkdirSync(join(root, 'apps', 'fixture'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(root, 'output-2026'), { recursive: true });
    writeFileSync(
      join(root, 'apps', 'fixture', 'README.md'),
      lines('# Fixture', 'The subtotal always excludes shipping.'),
      'utf8',
    );
    writeFileSync(
      join(root, 'apps', 'fixture', 'checkout_test.md'),
      lines('---', 'test_id: T-3', '---', '@verifies apps/fixture/README.md:2 subtotal'),
      'utf8',
    );
    writeFileSync(
      join(root, 'node_modules', 'pkg', 'vendor_test.md'),
      lines('@verifies apps/fixture/README.md:1'),
      'utf8',
    );
    writeFileSync(
      join(root, 'output-2026', 'recording_test.md'),
      lines('@verifies apps/fixture/README.md:1'),
      'utf8',
    );
  });

  afterAll(() => {
    if (root.length > 0) rmSync(root, { recursive: true, force: true });
  });

  it('scans the real tree through node:fs and skips the vendored and recorded trees', async () => {
    const { result, batch } = await buildBaselineOnlyGraph({
      repoRoot: root,
      fs: nodeBaselineFileSystem(root),
    });

    expect(result.ok).toBe(true);
    expect(result.files).toEqual(['apps/fixture/checkout_test.md']);
    expect(batch.admitted).toHaveLength(1);
    expect(batch.admitted[0]?.citation).toEqual({
      file: 'apps/fixture/README.md',
      line: 2,
      text: 'The subtotal always excludes shipping.',
    });
    expect(batch.admitted[0]?.designedTest).toEqual({
      path: 'apps/fixture/checkout_test.md',
      testId: 'T-3',
    });
  });
});
