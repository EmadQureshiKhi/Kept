import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  BASELINE_DIAGNOSTIC_CODES,
  buildBaselineOnlyGraph,
  collectBaseline,
  createDiagnosticSink,
  inMemoryBaselineFileSystem,
  inMemoryCitationSource,
  type BaselineDirEntry,
  type BaselineFileSystem,
} from 'kept-core';

/**
 * Feature: kept, Property 5: The baseline provider is total
 * (design §Correctness Properties, §5.2, §5.5, R2.2, R2.3, R2.4).
 *
 * *For any* repository content — including zero `*_test.md` files, unreadable
 * files, malformed frontmatter, binary content, and arbitrary byte sequences —
 * the baseline provider resolves successfully, never throws, never sets the
 * degraded flag, emits one promise per well-formed `@verifies` tag, and records
 * one diagnostic per file it skipped.
 *
 * Totality is the whole property, and the honest way to test it is to make the
 * repository hostile and the expectation independent. Repositories are generated
 * as a list of documents, each carrying **how many well-formed tags it was built
 * with** and **whether it was built to be undecodable** — so the expected
 * candidate count, the expected file list and the expected skip list are all
 * known by construction and nothing in the oracle is computed by the code under
 * test. The skip-set and suffix rules are re-stated locally here for the same
 * reason: a test that asked the implementation which directories it skips would
 * agree with any answer.
 *
 * The generators cover every adversity the requirement names: zero test
 * documents, a root that cannot be listed, a cyclic tree, files that are not
 * UTF-8, frontmatter truncated mid-key and frontmatter longer than the twenty-line
 * bound, tags that are malformed or name a non-numeric line or line zero or carry
 * no colon or a colon inside the path, duplicate tags in one document, documents
 * with no tags at all, CRLF terminators, a missing final newline, and a
 * `*_test.md` planted inside each of the six skipped directory shapes.
 *
 * **Validates: Requirements 2.2, 2.3, 2.4**
 */

/** Design's testing-strategy floor is 100 runs; stated so it cannot regress. */
const NUM_RUNS = 500;

/**
 * The skip rules, restated so the oracle is independent of the implementation.
 * Task 2.11 should absorb these as `arbSkippedDirectory` / `arbTestDocumentName`.
 */
const SKIPPED_SEGMENTS: readonly string[] = ['node_modules', '.git', '.next', 'dist', '.testmuai'];
const TEST_SUFFIX = '_test.md';

function isInSkippedTree(path: string): boolean {
  const segments = path.split('/');
  // The file's own name is not a directory segment.
  return segments
    .slice(0, -1)
    .some((segment) => SKIPPED_SEGMENTS.includes(segment) || segment.startsWith('output-'));
}

function isTestDocument(path: string): boolean {
  const name = path.split('/').pop() ?? '';
  return name.endsWith(TEST_SUFFIX);
}

/** Cited documents that exist. Some tags point here; many deliberately do not. */
const CITED_DOCUMENTS: Readonly<Record<string, string>> = {
  'README.md': 'The subtotal always excludes shipping.\nRefunds settle within one day.\n',
  'docs/api.md': 'Every endpoint answers within one second.\n',
};

/** Directories the scan is expected to walk. `''` is the repository root. */
const arbSafeDirectory: fc.Arbitrary<string> = fc.constantFrom(
  '',
  'apps',
  'apps/fixture',
  'docs',
  'packages/kept-core/test',
);

/** One `*_test.md` inside each skipped shape, including nested and root forms. */
const arbSkippedDirectory: fc.Arbitrary<string> = fc.constantFrom(
  'node_modules',
  'node_modules/pkg/deep',
  'apps/node_modules',
  '.git',
  '.git/hooks',
  '.next/cache',
  'dist',
  'dist/chunks',
  'output-2026-02-01T09-00-00Z',
  'output-2026-02-01T09-00-00Z/nested',
  '.testmuai',
);

/** File names: two are test documents by the suffix rule, three are not. */
const arbFileName: fc.Arbitrary<string> = fc.constantFrom(
  'checkout_test.md',
  'refunds_test.md',
  '_test.md',
  'notes.md',
  'plan_test.mdx',
);

/** Paths the grammar accepts, whether or not a document exists at them. */
const arbTagPath: fc.Arbitrary<string> = fc.constantFrom(
  'README.md',
  'docs/api.md',
  'docs/absent.md',
  '/etc/passwd',
  '../../secrets.env',
);

/** A body line that contributes exactly one well-formed tag. */
const arbOneTagLine: fc.Arbitrary<string> = fc
  .tuple(
    arbTagPath,
    fc.integer({ min: 1, max: 60 }),
    fc.constantFrom('', ' the subtotal claim', ' -->', '\tsee also'),
  )
  .map(([path, line, trailing]) => `<!-- @verifies ${path}:${line}${trailing}`);

/** A body line that contributes exactly two well-formed tags. */
const arbTwoTagLine: fc.Arbitrary<string> = fc
  .tuple(arbTagPath, fc.integer({ min: 1, max: 60 }), arbTagPath, fc.integer({ min: 1, max: 60 }))
  .map(([a, x, b, y]) => `@verifies ${a}:${x} and @verifies ${b}:${y} both`);

/** Lines that mention the marker but yield nothing: the rejected grammar cases. */
const arbNoTagLine: fc.Arbitrary<string> = fc.constantFrom(
  '@verifies README.md 12',
  '@verifies README.md:abc',
  '@verifies a:b.md:12',
  '@verifies README.md:0',
  '@verifies README.md:99999999999999999999',
  '@verifies',
  '@verifiesREADME.md:1',
  '# a heading with no tag at all',
  '',
  '   ',
  '| a | table | cell |',
);

interface BodyPlan {
  readonly lines: readonly string[];
  readonly wellFormed: number;
}

const arbBodyLine: fc.Arbitrary<BodyPlan> = fc.oneof(
  arbOneTagLine.map((line) => ({ lines: [line], wellFormed: 1 })),
  arbTwoTagLine.map((line) => ({ lines: [line], wellFormed: 2 })),
  arbNoTagLine.map((line) => ({ lines: [line], wellFormed: 0 })),
  // Duplicate tags in one document: two identical well-formed tags.
  arbOneTagLine.map((line) => ({ lines: [line, line], wellFormed: 2 })),
);

const arbBody: fc.Arbitrary<BodyPlan> = fc
  .array(arbBodyLine, { minLength: 0, maxLength: 6 })
  .map((plans) => ({
    lines: plans.flatMap((plan) => plan.lines),
    wellFormed: plans.reduce((total, plan) => total + plan.wellFormed, 0),
  }));

/**
 * Frontmatter shapes. None contains a tag, so a block that is read and a block
 * that is skipped contribute the same zero either way — which is what lets the
 * body count stand as the whole expectation.
 */
const arbFrontmatterLines: fc.Arbitrary<readonly string[]> = fc.oneof(
  fc.constant([]),
  fc.constant(['---', 'test_id: T-3', 'tags: [checkout, subtotal]', '---']),
  fc.constant(['---', 'covers:', '  - README.md', '  - docs/api.md', '---']),
  fc.constant(['---', 'test_id: "T-9"', 'this line is prose, not a key', '---']),
  // Truncated mid-key: the fence never closes.
  fc.constant(['---', 'test_id']),
  // Longer than the twenty-line bound, so the closing fence is never reached.
  fc.constant([
    '---',
    ...Array.from({ length: 24 }, (_, index) => `k${index}: v${index}`),
    '---',
  ]),
);

interface DocumentPlan {
  readonly path: string;
  readonly content: string;
  /** Well-formed tags the document was built with. Zero when undecodable. */
  readonly wellFormed: number;
  /** Built to be unreadable as text, so the provider must skip and name it. */
  readonly undecodable: boolean;
}

const arbDocument: fc.Arbitrary<DocumentPlan> = fc
  .record({
    directory: fc.oneof({ weight: 3, arbitrary: arbSafeDirectory }, { weight: 1, arbitrary: arbSkippedDirectory }),
    name: arbFileName,
    frontmatter: arbFrontmatterLines,
    body: arbBody,
    eol: fc.constantFrom('\n', '\r\n'),
    finalNewline: fc.boolean(),
    binary: fc.oneof(
      { weight: 6, arbitrary: fc.constant(null) },
      { weight: 1, arbitrary: fc.constantFrom('head\u0000\u0000tail', '\ufffd\ufffd\ufffd\ufffd\ufffd') },
    ),
  })
  .map(({ directory, name, frontmatter, body, eol, finalNewline, binary }) => {
    const path = directory === '' ? name : `${directory}/${name}`;
    if (binary !== null) {
      return { path, content: binary, wellFormed: 0, undecodable: true };
    }
    const all = [...frontmatter, ...body.lines];
    const content = all.join(eol) + (finalNewline && all.length > 0 ? eol : '');
    return { path, content, wellFormed: body.wellFormed, undecodable: false };
  });

/** A whole repository. Zero documents is generated, and is a valid state. */
const arbRepository: fc.Arbitrary<readonly DocumentPlan[]> = fc.uniqueArray(arbDocument, {
  minLength: 0,
  maxLength: 8,
  selector: (plan) => plan.path,
});

function filesystemFor(plans: readonly DocumentPlan[]): BaselineFileSystem {
  const files: Record<string, string> = { 'README.md': '# root readme\n' };
  for (const plan of plans) files[plan.path] = plan.content;
  return inMemoryBaselineFileSystem(files);
}

describe('Feature: kept, Property 5: The baseline provider is total', () => {
  it('resolves ok for every generated repository, never degrading', async () => {
    await fc.assert(
      fc.asyncProperty(arbRepository, async (plans) => {
        const result = await collectBaseline({
          repoRoot: '/tmp/kept-property-baseline',
          fs: filesystemFor(plans),
          citations: inMemoryCitationSource(CITED_DOCUMENTS),
        });

        expect(result.ok).toBe(true);
        expect(result.provider).toBe('baseline');
        expect(result.degradedReason).toBeNull();
        expect(result.axes.size).toBe(0);
        // The unreachable arm must stay unreachable.
        expect(
          result.diagnostics.some(
            (entry) => entry.code === BASELINE_DIAGNOSTIC_CODES.unexpected,
          ),
        ).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('scans exactly the test documents outside the skipped directories', async () => {
    await fc.assert(
      fc.asyncProperty(arbRepository, async (plans) => {
        const result = await collectBaseline({
          repoRoot: '/tmp/kept-property-baseline',
          fs: filesystemFor(plans),
          citations: inMemoryCitationSource(CITED_DOCUMENTS),
        });

        const expected = plans
          .filter((plan) => isTestDocument(plan.path) && !isInSkippedTree(plan.path))
          .map((plan) => plan.path)
          .sort();

        expect([...result.files]).toEqual(expected);
        // The load-bearing half: nothing under a skipped directory was read, so a
        // committed Kane recording under `output-*` cannot mint promises.
        expect(result.files.filter((file) => isInSkippedTree(file))).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('emits one candidate per well-formed tag and one named diagnostic per skipped file', async () => {
    await fc.assert(
      fc.asyncProperty(arbRepository, async (plans) => {
        const result = await collectBaseline({
          repoRoot: '/tmp/kept-property-baseline',
          fs: filesystemFor(plans),
          citations: inMemoryCitationSource(CITED_DOCUMENTS),
        });

        const scanned = plans.filter(
          (plan) => isTestDocument(plan.path) && !isInSkippedTree(plan.path),
        );
        const expectedTags = scanned
          .filter((plan) => !plan.undecodable)
          .reduce((total, plan) => total + plan.wellFormed, 0);
        const expectedSkipped = scanned
          .filter((plan) => plan.undecodable)
          .map((plan) => plan.path)
          .sort();

        expect(result.candidates).toHaveLength(expectedTags);
        expect(result.tagCount).toBe(expectedTags);
        expect([...result.skipped]).toEqual(expectedSkipped);

        // R2.3 — every skipped file is named by a diagnostic of its own.
        for (const path of expectedSkipped) {
          const named = result.diagnostics.filter(
            (entry) =>
              entry.file === path &&
              (entry.code === BASELINE_DIAGNOSTIC_CODES.documentNotText ||
                entry.code === BASELINE_DIAGNOSTIC_CODES.documentUnreadable),
          );
          expect(named).toHaveLength(1);
          expect(named[0]?.message).toContain(path);
        }

        // Every candidate carries provenance and a citation for the gate to judge.
        for (const candidate of result.candidates) {
          expect(candidate.provider).toBe('baseline');
          expect(candidate.citation).not.toBeNull();
          expect(candidate.citation?.line).toBeGreaterThanOrEqual(1);
          expect(candidate.designedTest?.path).toBeDefined();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('distinguishes zero test documents from every test document being unreadable', async () => {
    await fc.assert(
      fc.asyncProperty(arbRepository, async (plans) => {
        const result = await collectBaseline({
          repoRoot: '/tmp/kept-property-baseline',
          fs: filesystemFor(plans),
          citations: inMemoryCitationSource(CITED_DOCUMENTS),
        });

        const noTestDocuments = result.diagnostics.some(
          (entry) => entry.code === BASELINE_DIAGNOSTIC_CODES.noTestDocuments,
        );

        // The `info` diagnostic fires if and only if the scan found nothing at
        // all — so "no test documents" and "documents found, none readable" are
        // never the same answer even though both yield zero promises.
        expect(noTestDocuments).toBe(result.files.length === 0);
        if (result.files.length > 0 && result.skipped.length === result.files.length) {
          expect(result.candidates).toEqual([]);
          expect(noTestDocuments).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('builds a graph that is never degraded, through the admission gate', async () => {
    await fc.assert(
      fc.asyncProperty(arbRepository, async (plans) => {
        const sink = createDiagnosticSink();
        const { result, batch } = await buildBaselineOnlyGraph({
          repoRoot: '/tmp/kept-property-baseline',
          diagnostics: sink,
          fs: filesystemFor(plans),
          citations: inMemoryCitationSource(CITED_DOCUMENTS),
        });

        expect(result.ok).toBe(true);
        expect(batch.graph.degraded).toBe(false);
        expect(batch.graph.degradedReasons).toEqual([]);
        expect(batch.admissions).toHaveLength(result.candidates.length);
        expect(batch.rejected).toHaveLength(
          batch.admissions.filter((admission) => !admission.ok).length,
        );
        // Admitted is the accepted set minus duplicate ids, never more.
        expect(batch.admitted.length).toBeLessThanOrEqual(
          batch.admissions.filter((admission) => admission.ok).length,
        );
        // Whatever survived the gate is cited to a line that exists.
        for (const promise of batch.admitted) {
          const document = CITED_DOCUMENTS[promise.citation.file];
          expect(document).toBeDefined();
          const documentLines = (document as string).replace(/\n$/, '').split('\n');
          expect(promise.citation.text).toBe(documentLines[promise.citation.line - 1]);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('resolves ok for arbitrary byte sequences as document content', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.tuple(arbFileName, fc.string({ minLength: 0, maxLength: 400 })), {
          minLength: 0,
          maxLength: 4,
          selector: ([name]) => name,
        }),
        async (documents) => {
          const files: Record<string, string> = {};
          for (const [name, content] of documents) files[name] = content;
          const result = await collectBaseline({
            repoRoot: '/tmp/kept-property-baseline',
            fs: inMemoryBaselineFileSystem(files),
            citations: inMemoryCitationSource(CITED_DOCUMENTS),
          });
          expect(result.ok).toBe(true);
          expect(result.degradedReason).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('resolves ok when the filesystem itself is hostile', async () => {
    const arbHostileFs: fc.Arbitrary<BaselineFileSystem> = fc
      .record({
        listThrows: fc.boolean(),
        readThrows: fc.boolean(),
        readNull: fc.boolean(),
        cyclic: fc.boolean(),
      })
      .map(({ listThrows, readThrows, readNull, cyclic }) => ({
        readDirectory(dir: string): readonly BaselineDirEntry[] {
          if (listThrows) throw new Error(`ENOENT: no such directory ${dir}`);
          const entries: BaselineDirEntry[] = [
            { name: 'ring_test.md', isDirectory: false, isFile: true },
            { name: 'link_test.md', isDirectory: false, isFile: false },
          ];
          if (cyclic) entries.push({ name: 'loop', isDirectory: true, isFile: false });
          return entries;
        },
        readFile(file: string): string | null {
          if (readThrows) throw new Error(`EACCES: permission denied reading ${file}`);
          if (readNull) return null;
          return '@verifies README.md:1\n';
        },
      }));

    await fc.assert(
      fc.asyncProperty(arbHostileFs, async (fs) => {
        const { result, batch } = await buildBaselineOnlyGraph({
          repoRoot: '/tmp/kept-property-baseline',
          fs,
          citations: inMemoryCitationSource(CITED_DOCUMENTS),
        });
        expect(result.ok).toBe(true);
        expect(result.degradedReason).toBeNull();
        expect(batch.graph.degraded).toBe(false);
        // A symlink is neither a file nor a directory here, so it is never read.
        expect(result.files.includes('link_test.md')).toBe(false);
        for (const path of result.skipped) {
          expect(result.diagnostics.some((entry) => entry.file === path)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
