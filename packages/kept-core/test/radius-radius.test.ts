import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  RADIUS_DIAGNOSTIC_CODES,
  collectTestCoverage,
  computeBlastRadius,
  createDiagnosticSink,
  createPromiseGraph,
  createPromiseRecord,
  matchesAnyGlob,
  matchesGlob,
  nodeBaselineFileSystem,
  normaliseChangedPath,
  shouldInvokeKane,
  type BlastRadius,
  type PlanMember,
  type PromiseGraph,
  type TestCoverage,
  type TestrunPlan,
} from '@kept/core';

/**
 * Task 11.9 — the blast radius (design §7.1, §7.3, R4.2, R4.3, R4.5).
 *
 * `computeBlastRadius` starts no process and reads no file, so there is nothing to
 * stub: the plan is a parameter, which is exactly what makes "no identifier was
 * synthesised" checkable. The one test that touches disk reads the committed
 * `tests/*_test.md` corpus, because the `covers:` globs those documents declare are
 * the real input to the chain and a hand-written copy of them could drift.
 */

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const CAPTURED_AT = '2026-08-20T18:00:00.000Z';

function plan(members: readonly PlanMember[], valid = true): TestrunPlan {
  return { valid, capturedAt: CAPTURED_AT, members };
}

function member(path: string, testId: string | null, failure: string | null = null): PlanMember {
  return { path, testId, tags: [], failure };
}

function covers(entries: Readonly<Record<string, readonly string[]>>): readonly TestCoverage[] {
  return Object.entries(entries).map(([path, globs]) => ({ path, covers: globs }));
}

/** One promise per designed test path, so a radius's promise set is legible. */
function graphOf(designed: Readonly<Record<string, string>>): PromiseGraph {
  return createPromiseGraph({
    promises: Object.entries(designed).map(([claim, path]) =>
      createPromiseRecord({
        claim,
        citation: { file: 'apps/fixture/README.md', line: 16, text: claim },
        designedTest: { path, testId: null },
        providers: ['baseline'],
      }),
    ),
  });
}

function idOf(claim: string, designed: Readonly<Record<string, string>>): string {
  const graph = graphOf(designed);
  const found = graph.promises.find((promise) => promise.claim === claim);
  if (found === undefined) throw new Error(`no promise for ${claim}`);
  return found.id;
}

function countOf(radius: BlastRadius, code: string): number {
  return radius.diagnostics.filter((diagnostic) => diagnostic.code === code).length;
}

// ---------------------------------------------------------------------------
// The hand-rolled glob matcher
// ---------------------------------------------------------------------------

describe('the covers glob matcher (§7.3, no micromatch)', () => {
  it('matches a literal path exactly', () => {
    expect(matchesGlob('apps/fixture/lib/cart.ts', 'apps/fixture/lib/cart.ts')).toBe(true);
    expect(matchesGlob('apps/fixture/lib/cart.ts', 'apps/fixture/lib/carts.ts')).toBe(false);
    expect(matchesGlob('apps/fixture/lib/cart.ts', 'apps/fixture/lib')).toBe(false);
  });

  it('lets `**` cross any number of segments, including none', () => {
    expect(matchesGlob('apps/fixture/app/cart/**', 'apps/fixture/app/cart/page.tsx')).toBe(true);
    expect(matchesGlob('apps/fixture/app/cart/**', 'apps/fixture/app/cart/a/b/c.tsx')).toBe(true);
    expect(matchesGlob('apps/fixture/app/cart/**', 'apps/fixture/app/cart')).toBe(true);
    expect(matchesGlob('apps/fixture/app/cart/**', 'apps/fixture/app/checkout/page.tsx')).toBe(
      false,
    );
    expect(matchesGlob('**/cart.ts', 'apps/fixture/lib/cart.ts')).toBe(true);
    expect(matchesGlob('**', 'anything/at/all.ts')).toBe(true);
  });

  it('keeps `*` inside one segment', () => {
    expect(matchesGlob('apps/fixture/lib/*.ts', 'apps/fixture/lib/cart.ts')).toBe(true);
    expect(matchesGlob('apps/fixture/lib/*.ts', 'apps/fixture/lib/nested/cart.ts')).toBe(false);
    expect(matchesGlob('apps/*/lib/cart.ts', 'apps/fixture/lib/cart.ts')).toBe(true);
    expect(matchesGlob('apps/fixture/lib/c*t.ts', 'apps/fixture/lib/cart.ts')).toBe(true);
    expect(matchesGlob('apps/fixture/lib/c*t.ts', 'apps/fixture/lib/cars.ts')).toBe(false);
  });

  it('does not treat a head and a tail as overlapping', () => {
    expect(matchesGlob('a*a', 'a')).toBe(false);
    expect(matchesGlob('a*a', 'aa')).toBe(true);
  });

  it('is case-sensitive and ignores `./` noise', () => {
    expect(matchesGlob('apps/Fixture/lib/cart.ts', 'apps/fixture/lib/cart.ts')).toBe(false);
    expect(matchesGlob('./apps/fixture/lib/cart.ts', 'apps/fixture/lib/cart.ts')).toBe(true);
  });

  it('matches nothing for an empty pattern, an empty path, or an empty list', () => {
    expect(matchesGlob('', 'apps/fixture/lib/cart.ts')).toBe(false);
    expect(matchesGlob('**', '')).toBe(false);
    expect(matchesAnyGlob([], 'apps/fixture/lib/cart.ts')).toBe(false);
  });
});

describe('changed paths are normalised to repository-relative POSIX', () => {
  it('strips a repo root, a leading ./ and backslashes', () => {
    expect(normaliseChangedPath('/repo/apps/fixture/lib/cart.ts', '/repo')).toBe(
      'apps/fixture/lib/cart.ts',
    );
    expect(normaliseChangedPath('./apps/fixture/lib/cart.ts')).toBe('apps/fixture/lib/cart.ts');
    expect(normaliseChangedPath('apps\\fixture\\lib\\cart.ts')).toBe('apps/fixture/lib/cart.ts');
    expect(normaliseChangedPath('   ')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// `covers:` collection
// ---------------------------------------------------------------------------

describe('covers globs are read from the committed corpus, and ids are not', () => {
  const collected = collectTestCoverage({
    source: nodeBaselineFileSystem(REPO_ROOT),
    paths: ['tests/cart_subtotal_test.md', 'tests/home_cta_test.md'],
  });

  it('reads the real globs of T-3’s document', () => {
    const subtotal = collected.find((entry) => entry.path === 'tests/cart_subtotal_test.md');
    expect(subtotal?.covers).toEqual(['apps/fixture/lib/cart.ts', 'apps/fixture/app/cart/**']);
  });

  it('carries no identifier of any kind, even though the frontmatter has one', () => {
    // The document says `test_id: T-3`. The reader that produced these entries
    // surfaces that field and this module drops it: an identifier may only come
    // from the plan (R4.4), so it must not be reachable from here at all.
    const raw = readFileSync(new URL('../../../tests/cart_subtotal_test.md', import.meta.url), 'utf8');
    expect(raw).toContain('test_id: T-3');
    for (const entry of collected) {
      expect(Object.keys(entry).sort()).toEqual(['covers', 'path']);
      expect(JSON.stringify(entry)).not.toContain('T-3');
    }
  });

  it('diagnoses an unreadable document and a document with no covers', () => {
    const sink = createDiagnosticSink();
    const entries = collectTestCoverage({
      source: {
        readFile: (path) => (path === 'tests/absent_test.md' ? null : '---\ntest_id: T-9\n---\n'),
      },
      paths: ['tests/absent_test.md', 'tests/bare_test.md', 'tests/bare_test.md'],
      sink,
    });

    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.covers.length === 0)).toBe(true);
    expect(sink.has(RADIUS_DIAGNOSTIC_CODES.coversUnreadable)).toBe(true);
    expect(sink.has(RADIUS_DIAGNOSTIC_CODES.coversAbsent)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Radius computation
// ---------------------------------------------------------------------------

describe('the radius selects covering tests and takes ids from the plan (§7.1)', () => {
  const designed = { 'subtotal claim': 'tests/cart_subtotal_test.md', 'cta claim': 'tests/home_cta_test.md' };

  it('walks changed path → covering test → promises → plan id', () => {
    const radius = computeBlastRadius({
      changed: ['apps/fixture/app/cart/page.tsx'],
      graph: graphOf(designed),
      plan: plan([
        member('tests/cart_subtotal_test.md', 'T-3'),
        member('tests/home_cta_test.md', 'T-2'),
      ]),
      covers: covers({
        'tests/cart_subtotal_test.md': ['apps/fixture/lib/cart.ts', 'apps/fixture/app/cart/**'],
        'tests/home_cta_test.md': ['apps/fixture/app/page.tsx'],
      }),
    });

    expect(radius.testIds).toEqual(['T-3']);
    expect(radius.coveringTests).toEqual(['tests/cart_subtotal_test.md']);
    expect(radius.promiseIds).toEqual([idOf('subtotal claim', designed)]);
    expect(radius.unmatchedPaths).toEqual([]);
    expect(shouldInvokeKane(radius)).toBe(true);
  });

  it('uses the plan’s identifier even when every other source suggests another', () => {
    // The document's frontmatter says `T-3` and the promise's designed-test
    // reference says `T-3`. Kane's plan says otherwise, and Kane is the authority.
    const graph = createPromiseGraph({
      promises: [
        createPromiseRecord({
          claim: 'subtotal claim',
          citation: { file: 'apps/fixture/README.md', line: 16, text: 'subtotal claim' },
          designedTest: { path: 'tests/cart_subtotal_test.md', testId: 'T-3' },
          providers: ['baseline'],
        }),
      ],
    });

    const radius = computeBlastRadius({
      changed: ['apps/fixture/lib/cart.ts'],
      graph,
      plan: plan([member('tests/cart_subtotal_test.md', 'KANE-77')]),
      covers: covers({ 'tests/cart_subtotal_test.md': ['apps/fixture/lib/cart.ts'] }),
    });

    expect(radius.testIds).toEqual(['KANE-77']);
    expect(radius.testIds).not.toContain('T-3');
  });

  it('dedupes and sorts identifiers, and collapses repeated changed paths', () => {
    const radius = computeBlastRadius({
      changed: [
        'apps/fixture/lib/cart.ts',
        './apps/fixture/lib/cart.ts',
        'apps/fixture/app/cart/page.tsx',
      ],
      graph: graphOf(designed),
      plan: plan([
        member('tests/cart_subtotal_test.md', 'T-3'),
        member('tests/home_cta_test.md', 'T-2'),
      ]),
      covers: covers({
        'tests/cart_subtotal_test.md': ['apps/fixture/lib/cart.ts', 'apps/fixture/app/cart/**'],
        'tests/home_cta_test.md': ['apps/fixture/**'],
      }),
    });

    expect(radius.testIds).toEqual(['T-2', 'T-3']);
  });
});

describe('everything left out of the radius is left out loudly (R4.3, R4.5)', () => {
  const designed = { 'subtotal claim': 'tests/cart_subtotal_test.md' };
  const coversMap = covers({
    'tests/cart_subtotal_test.md': ['apps/fixture/lib/cart.ts'],
  });

  it('excludes and diagnoses a plan member with no test_id', () => {
    const radius = computeBlastRadius({
      changed: ['apps/fixture/lib/cart.ts'],
      graph: graphOf(designed),
      plan: plan([member('tests/cart_subtotal_test.md', null, 'not_authored')]),
      covers: coversMap,
    });

    expect(radius.testIds).toEqual([]);
    expect(radius.skippedNoTestId).toEqual(['tests/cart_subtotal_test.md']);
    // No verdict may move for a promise nothing will run.
    expect(radius.promiseIds).toEqual([]);
    expect(countOf(radius, RADIUS_DIAGNOSTIC_CODES.memberNoTestId)).toBe(1);
    expect(shouldInvokeKane(radius)).toBe(false);
  });

  it('excludes and diagnoses a covering test absent from the plan', () => {
    const radius = computeBlastRadius({
      changed: ['apps/fixture/lib/cart.ts'],
      graph: graphOf(designed),
      plan: plan([member('tests/home_cta_test.md', 'T-2')]),
      covers: coversMap,
    });

    expect(radius.testIds).toEqual([]);
    expect(countOf(radius, RADIUS_DIAGNOSTIC_CODES.testAbsentFromPlan)).toBe(1);
  });

  it('derives nothing at all when there is no plan', () => {
    const radius = computeBlastRadius({
      changed: ['apps/fixture/lib/cart.ts'],
      graph: graphOf(designed),
      plan: null,
      covers: coversMap,
    });

    expect(radius.testIds).toEqual([]);
    expect(radius.coveringTests).toEqual(['tests/cart_subtotal_test.md']);
    expect(countOf(radius, RADIUS_DIAGNOSTIC_CODES.planUnavailable)).toBe(1);
  });

  it('records one “no designed test covers” diagnostic per uncovered path', () => {
    const radius = computeBlastRadius({
      changed: ['apps/fixture/app/settings/page.tsx', 'apps/fixture/lib/orders.ts', '  '],
      graph: graphOf(designed),
      plan: plan([member('tests/cart_subtotal_test.md', 'T-3')]),
      covers: coversMap,
    });

    expect(radius.unmatchedPaths).toEqual([
      'apps/fixture/app/settings/page.tsx',
      'apps/fixture/lib/orders.ts',
    ]);
    expect(countOf(radius, RADIUS_DIAGNOSTIC_CODES.pathUncovered)).toBe(2);
    expect(radius.diagnostics.map((diagnostic) => diagnostic.message)).toContain(
      'no designed test covers apps/fixture/lib/orders.ts',
    );
    expect(countOf(radius, RADIUS_DIAGNOSTIC_CODES.empty)).toBe(1);
    expect(shouldInvokeKane(radius)).toBe(false);
  });

  it('reports an empty radius for an empty changed set without inventing work', () => {
    const radius = computeBlastRadius({
      changed: [],
      graph: graphOf(designed),
      plan: plan([member('tests/cart_subtotal_test.md', 'T-3')]),
      covers: coversMap,
    });

    expect(radius.testIds).toEqual([]);
    expect(radius.unmatchedPaths).toEqual([]);
    expect(countOf(radius, RADIUS_DIAGNOSTIC_CODES.pathUncovered)).toBe(0);
    expect(countOf(radius, RADIUS_DIAGNOSTIC_CODES.empty)).toBe(1);
  });

  it('reports into an injected sink as well as onto the result', () => {
    const sink = createDiagnosticSink();
    const radius = computeBlastRadius({
      changed: ['apps/fixture/app/orders/page.tsx'],
      graph: graphOf(designed),
      plan: plan([member('tests/cart_subtotal_test.md', 'T-3')]),
      covers: coversMap,
      sink,
    });
    expect(sink.entries).toEqual(radius.diagnostics);
  });
});
