import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  createPromiseGraph,
  createPromiseRecord,
  isPromiseId,
  normaliseClaim,
  promiseId,
  toPosix,
  type PromiseRecord,
} from '@kept/core';

/**
 * Feature: kept, Property 1: Promise identifiers are stable across rebuilds
 * (design §Correctness Properties, §3.2, R1.2).
 *
 * *For any* set of promises, rebuilding the graph after moving a claim to a
 * different line, reordering the claims within its file, or adding and removing
 * unrelated claims produces the same identifier for that promise; and *for any*
 * two promises, their identifiers are equal if and only if their citation file
 * path and normalised claim text are both equal.
 *
 * Two directions, and both are needed. Stability alone is satisfied by a constant
 * — `return 'p_000000000000'` passes every perturbation test ever written — so the
 * *only if* half is what makes the property mean anything: a genuinely different
 * claim, or the same claim in a different file, must land on a different id.
 *
 * The perturbations below are the ones a real editing session performs on a
 * README: insert a paragraph above the claim, reorder the sections, add and
 * delete unrelated claims, check the file out with CRLF endings, drop the
 * trailing newline, reflow a paragraph so the whitespace changes. Every one of
 * them must leave the id alone, because the id is the key a promise's verdict,
 * evidence and history hang from.
 *
 * **Validates: Requirements 1.2**
 */

/** Design's testing-strategy floor is 100 runs; stated so it cannot regress. */
const NUM_RUNS = 500;

/**
 * Repository-relative POSIX paths, drawn from a small pool so that "same file"
 * and "different file" both occur densely. 2.11 should absorb this as part of
 * `arbCitation`.
 */
const arbFile: fc.Arbitrary<string> = fc.constantFrom(
  'apps/fixture/README.md',
  'apps/fixture/CHANGELOG.md',
  'apps/fixture/app/page.tsx',
  'README.md',
  'docs/promises.md',
);

/**
 * Claim words. Deliberately a small alphabet of ordinary words plus a few
 * awkward ones — a leading number, inline markdown, an accented character — so
 * collisions between generated claims are common enough to exercise the *only
 * if* direction rather than being astronomically unlikely.
 */
const arbWord: fc.Arbitrary<string> = fc.constantFrom(
  'cart',
  'subtotal',
  'updates',
  'checkout',
  'is',
  'fast',
  'free',
  'shipping',
  '3.5x',
  '**subtotal**',
  'caf\u00e9',
  'Fast',
);

/** A claim as an author would type it: one line, no newline inside. */
const arbClaim: fc.Arbitrary<string> = fc
  .array(arbWord, { minLength: 1, maxLength: 6 })
  .map((words) => words.join(' '));

/**
 * Whitespace variations the normaliser deliberately absorbs: runs of spaces and
 * tabs, a leading markdown marker, a trailing `\r` from a CRLF checkout, and
 * surrounding indentation. 2.11 should absorb this as `arbWhitespaceNoise`.
 */
const arbDecoration: fc.Arbitrary<(claim: string) => string> = fc.constantFrom(
  (claim: string) => claim,
  (claim: string) => `  ${claim}  `,
  (claim: string) => `\t${claim}`,
  (claim: string) => `${claim}\r`,
  (claim: string) => `- ${claim}`,
  (claim: string) => `* ${claim}`,
  (claim: string) => `1. ${claim}`,
  (claim: string) => `> ${claim}`,
  (claim: string) => `## ${claim}`,
  (claim: string) => `- [ ] ${claim}`,
  (claim: string) => claim.split(' ').join('   '),
  (claim: string) => claim.split(' ').join('\t'),
  (claim: string) => claim.normalize('NFD'),
  (claim: string) => `${claim}\u200b`,
);

/** One-based line numbers, including the boundary. */
const arbLine: fc.Arbitrary<number> = fc.integer({ min: 1, max: 5000 });

/** A whole document: a file, and the claims it carries in authored order. */
const arbDocument: fc.Arbitrary<{ file: string; claims: string[] }> = fc.record({
  file: arbFile,
  claims: fc.array(arbClaim, { minLength: 1, maxLength: 6 }),
});

/**
 * Build the promises a document yields, the way a provider would: walk the lines
 * in order, one promise per claim, line numbers assigned by position. 2.11 should
 * absorb this alongside `arbPromise`/`arbGraph`.
 */
function buildPromises(file: string, claims: readonly string[], firstLine = 1): PromiseRecord[] {
  return claims.map((claim, index) =>
    createPromiseRecord({
      claim,
      citation: { file, line: firstLine + index, text: claim },
      providers: ['baseline'],
    }),
  );
}

describe('Feature: kept, Property 1: Promise identifiers are stable across rebuilds', () => {
  it('keeps the identifier when the claim moves to a different line', () => {
    fc.assert(
      fc.property(arbFile, arbClaim, arbLine, arbLine, (file, claim, first, second) => {
        expect(promiseId(file, claim)).toBe(promiseId(file, claim));
        const before = createPromiseRecord({
          claim,
          citation: { file, line: first, text: claim },
          providers: ['baseline'],
        });
        const after = createPromiseRecord({
          claim,
          citation: { file, line: second, text: claim },
          providers: ['baseline'],
        });
        expect(after.id).toBe(before.id);
        expect(isPromiseId(after.id)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('keeps every identifier when a paragraph is inserted above the claims', () => {
    fc.assert(
      fc.property(arbDocument, fc.integer({ min: 1, max: 400 }), (document, inserted) => {
        const before = buildPromises(document.file, document.claims);
        const after = buildPromises(document.file, document.claims, 1 + inserted);
        expect(after.map((p) => p.id)).toEqual(before.map((p) => p.id));
        // The line numbers did move — the perturbation is real, not a no-op.
        expect(after.map((p) => p.citation.line)).not.toEqual(
          before.map((p) => p.citation.line),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('keeps every identifier when the claims are reordered within the file', () => {
    fc.assert(
      fc.property(arbDocument, (document) => {
        const before = buildPromises(document.file, document.claims);
        const reordered = [...document.claims].reverse();
        const after = buildPromises(document.file, reordered);
        // Same set of ids, and the graph — which sorts by id — is byte-identical.
        expect(new Set(after.map((p) => p.id))).toEqual(new Set(before.map((p) => p.id)));
        expect(JSON.stringify(createPromiseGraph({ promises: after }).promises.map((p) => p.id))).toBe(
          JSON.stringify(createPromiseGraph({ promises: before }).promises.map((p) => p.id)),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('keeps a claim’s identifier when unrelated claims are added and removed', () => {
    fc.assert(
      fc.property(arbDocument, arbClaim, arbClaim, (document, addedAbove, addedBelow) => {
        const kept = document.claims[0];
        if (kept === undefined) return;
        const keptId = promiseId(document.file, kept);
        expect(buildPromises(document.file, document.claims)[0]!.id).toBe(keptId);

        // Claims added above and below — the kept claim shifts down a line and
        // gains neighbours.
        const grown = buildPromises(document.file, [addedAbove, ...document.claims, addedBelow]);
        expect(grown.some((promise) => promise.id === keptId)).toBe(true);

        // And everything else deleted — the kept claim is now line 1 and alone.
        const pruned = buildPromises(document.file, [kept]);
        expect(pruned.map((promise) => promise.id)).toEqual([keptId]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is unmoved by CRLF endings, a missing trailing newline, or a reflow', () => {
    fc.assert(
      fc.property(arbFile, arbClaim, arbDecoration, arbDecoration, (file, claim, one, two) => {
        // A cited line read out of a CRLF checkout keeps a trailing `\r` after
        // `split('\n')`; a file with no trailing newline yields the same last
        // line either way. Both are whitespace-only differences, and so is a
        // reflow, so all of them derive one id.
        const lf = claim;
        const crlf = `${claim}\r`;
        const noTrailingNewline = claim;
        expect(promiseId(file, crlf)).toBe(promiseId(file, lf));
        expect(promiseId(file, noTrailingNewline)).toBe(promiseId(file, lf));
        expect(promiseId(file, one(claim))).toBe(promiseId(file, two(claim)));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is unmoved by a path written with Windows separators or a ./ prefix', () => {
    fc.assert(
      fc.property(arbFile, arbClaim, (file, claim) => {
        expect(promiseId(file.split('/').join('\\'), claim)).toBe(promiseId(file, claim));
        expect(promiseId(`./${file}`, claim)).toBe(promiseId(file, claim));
        expect(promiseId(`  ${file}  `, claim)).toBe(promiseId(file, claim));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is equal if and only if file and normalised claim are both equal', () => {
    fc.assert(
      fc.property(
        arbFile,
        arbFile,
        arbClaim,
        arbClaim,
        arbDecoration,
        arbDecoration,
        (leftFile, rightFile, leftClaim, rightClaim, leftNoise, rightNoise) => {
          const left = promiseId(leftFile, leftNoise(leftClaim));
          const right = promiseId(rightFile, rightNoise(rightClaim));
          const sameKey =
            toPosix(leftFile) === toPosix(rightFile) &&
            normaliseClaim(leftNoise(leftClaim)) === normaliseClaim(rightNoise(rightClaim));
          // Both directions in one assertion: equal ids exactly when the key matches.
          expect(left === right).toBe(sameKey);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('gives a genuinely different claim a different identifier', () => {
    fc.assert(
      fc.property(arbFile, arbClaim, arbClaim, (file, first, second) => {
        fc.pre(normaliseClaim(first) !== normaliseClaim(second));
        expect(promiseId(file, first)).not.toBe(promiseId(file, second));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('gives the same claim in a different file a different identifier', () => {
    fc.assert(
      fc.property(arbFile, arbFile, arbClaim, (leftFile, rightFile, claim) => {
        fc.pre(toPosix(leftFile) !== toPosix(rightFile));
        expect(promiseId(leftFile, claim)).not.toBe(promiseId(rightFile, claim));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is not a constant: distinct claims in one file yield distinct identifiers', () => {
    // The clause that kills `return 'p_000000000000'`.
    fc.assert(
      fc.property(arbDocument, (document) => {
        const distinct = new Set(document.claims.map((claim) => normaliseClaim(claim)));
        const ids = new Set(document.claims.map((claim) => promiseId(document.file, claim)));
        expect(ids.size).toBe(distinct.size);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('derives an identifier that is always well-formed, and takes no line at all', () => {
    fc.assert(
      fc.property(arbFile, arbClaim, arbLine, (file, claim, line) => {
        const id = promiseId(file, claim);
        expect(id).toMatch(/^p_[0-9a-f]{12}$/);
        expect(isPromiseId(id)).toBe(true);
        // The strongest statement available about the line number: it cannot
        // reach the derivation, because the function takes two arguments and
        // neither of them is a line. A record built at that line agrees.
        expect(promiseId.length).toBe(2);
        expect(
          createPromiseRecord({
            claim,
            citation: { file, line, text: claim },
            providers: ['baseline'],
          }).id,
        ).toBe(id);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
