/**
 * The admission gate, run over an in-memory repository.
 *
 * The claim this application makes is that it runs **the same gate the CLI runs**, with the
 * filesystem swapped for a map of fetched documents. That is the difference between this page being
 * KEPT and being a plausible imitation of it, so it is the thing these tests are about.
 *
 * Two properties matter most:
 *
 *   1. **A promise's citation text is the bytes of the cited line.** Not a normalisation of it, not
 *      a trim of it. If that ever stopped being true, a graph drawn here could not be checked
 *      against the file it came from, which is the whole basis of the product.
 *   2. **Nothing is invented.** No verdict, because no run happened. A rejected claim is reported
 *      with a reason rather than dropped, because a claim silently missing from a graph is worse
 *      than one visibly refused.
 *
 * No network here. `github.ts` fetches; this takes bytes and returns a graph, which is why the
 * interesting logic is testable at all.
 */

import { describe, expect, it } from 'vitest';

import { admitRepository, byDocument, citationLabel, mapCitationSource } from '../lib/admit.js';

/** A minimal repository: one README stating a claim, one test document citing it. */
function repository(claim: string, line: number): Map<string, string> {
  const readme = ['# Product', '', '## What it does', '', claim, '', 'More prose.'].join('\n');
  const test = [
    '---',
    'covers:',
    '  - "src/**"',
    '---',
    '',
    '# Cart discount',
    '',
    `@verifies README.md:${String(line)}`,
    '',
    '## Steps',
    '1. Open the cart',
  ].join('\n');
  return new Map([
    ['README.md', readme],
    ['tests/cart_test.md', test],
  ]);
}

/** The claim sits on line 5 of the README above. */
const CLAIM = '- The cart applies a 10 percent discount above 50 dollars.';
const CLAIM_LINE = 5;

describe('the gate finds a claim in a repository it was handed', () => {
  it('admits a well-formed tag and cites it to the line', async () => {
    const report = await admitRepository(repository(CLAIM, CLAIM_LINE), 'owner/repo');

    expect(report.promises).toHaveLength(1);
    const promise = report.promises[0];
    expect(promise?.file).toBe('README.md');
    expect(promise?.line).toBe(CLAIM_LINE);
    expect(promise?.testPath).toBe('tests/cart_test.md');
    expect(report.testDocuments).toEqual(['tests/cart_test.md']);
    expect(report.tagCount).toBe(1);
  });

  it('carries the cited line as bytes, untrimmed', async () => {
    /* The property the whole product rests on: a citation a reader cannot check against the file is
       not a citation. Leading and trailing space are part of a document, so a claim written with
       them keeps them. */
    const padded = '   - The cart applies a discount.\t ';
    const report = await admitRepository(repository(padded, CLAIM_LINE), 'owner/repo');
    expect(report.promises[0]?.text).toBe(padded);
  });

  it('gives every promise no verdict, because no run happened', async () => {
    /* A verdict is a statement that a terminal event proved or broke a claim. This page invokes
       Kane zero times, so there is nothing to state and nothing is stated. The flattened record
       carries no verdict field at all, which is stronger than carrying a null one. */
    const report = await admitRepository(repository(CLAIM, CLAIM_LINE), 'owner/repo');
    const promise = report.promises[0] as unknown as Record<string, unknown>;
    expect(Object.keys(promise).sort()).toEqual([
      'claim',
      'file',
      'id',
      'line',
      'testId',
      'testPath',
      'text',
    ]);
  });

  it('spells a citation one way', async () => {
    const report = await admitRepository(repository(CLAIM, CLAIM_LINE), 'owner/repo');
    expect(citationLabel(report.promises[0] as never)).toBe(`README.md:${String(CLAIM_LINE)}`);
  });
});

describe('the gate refuses rather than inventing', () => {
  it('rejects a tag citing a file the repository does not hold, and says so', async () => {
    const files = repository(CLAIM, CLAIM_LINE);
    files.set('tests/cart_test.md', '# T\n\n@verifies MISSING.md:1\n');
    const report = await admitRepository(files, 'owner/repo');

    expect(report.promises).toHaveLength(0);
    /* Reported, not dropped. A claim missing from a graph with no explanation is the failure mode
       this project exists to prevent. */
    expect(report.diagnostics.length).toBeGreaterThan(0);
    expect(report.diagnostics.map((entry) => entry.message).join(' ')).toContain('MISSING.md');
  });

  it('rejects a tag citing past the end of a file', async () => {
    const report = await admitRepository(repository(CLAIM, 9999), 'owner/repo');
    expect(report.promises).toHaveLength(0);
    expect(report.diagnostics.length).toBeGreaterThan(0);
  });

  it('finds nothing in a repository with no test documents, and does not fail', async () => {
    /* A legitimate repository state, not an error: most repositories have no designed tests yet,
       and the page says so in prose rather than reporting a fault. */
    const report = await admitRepository(new Map([['README.md', '# Hello\n']]), 'owner/repo');
    expect(report.promises).toHaveLength(0);
    expect(report.testDocuments).toHaveLength(0);
    expect(report.tagCount).toBe(0);
  });

  it('finds nothing in an empty repository, and does not throw', async () => {
    const report = await admitRepository(new Map(), 'owner/repo');
    expect(report.promises).toHaveLength(0);
  });
});

describe('the citation source reads the same bytes the walk read', () => {
  it('answers from the map, and null for anything absent', () => {
    /* Handing the same map to the walk and to the gate is what guarantees the claim text and the
       admitted citation text came from one read. `kept-core` documents that requirement on
       `BaselineContext.citations`. */
    const source = mapCitationSource(new Map([['a.md', 'one\ntwo\n']]));
    expect(source.read('a.md')).toBe('one\ntwo\n');
    expect(source.read('missing.md')).toBeNull();
  });
});

describe('the result is grouped the way a reader asks the question', () => {
  it('groups by cited document, in path order, and by line within one', () => {
    const promises = [
      { id: 'p3', claim: 'c', file: 'z.md', line: 2, text: 'c', testPath: null, testId: null },
      { id: 'p1', claim: 'a', file: 'a.md', line: 9, text: 'a', testPath: null, testId: null },
      { id: 'p2', claim: 'b', file: 'a.md', line: 3, text: 'b', testPath: null, testId: null },
    ];
    const groups = byDocument(promises);
    expect(groups.map((group) => group.file)).toEqual(['a.md', 'z.md']);
    /* Within a file the order is the file's own, so the list can be read alongside it. */
    expect(groups[0]?.promises.map((promise) => promise.line)).toEqual([3, 9]);
  });

  it('groups nothing into nothing', () => {
    expect(byDocument([])).toEqual([]);
  });
});
