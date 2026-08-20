import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  NO_PROVIDER_AXES,
  VERDICTS,
  inMemoryCitationSource,
  mergeGraph,
  normaliseClaim,
  promiseId,
  toPosix,
  type DesignedTest,
  type PromiseCandidate,
  type ProviderAxes,
  type ProviderAxisOverlay,
  type ProviderResult,
  type Verdict,
} from '@kept/core';

/**
 * Feature: kept, Property 4: Provider merge prefers enrichment on the assurance
 * axes and baseline on citations
 * (design §Correctness Properties, §5.4, R1.7, R2.1).
 *
 * *For any* pair of promise candidates sharing an identifier, the merged graph
 * contains exactly one promise for that identifier whose designed test reference
 * and verdict come from the enrichment provider when the enrichment provider
 * supplied them, whose citation and claim text come from the baseline provider in
 * every case, and whose provider list contains both providers.
 *
 * ### How the property is encoded
 *
 * "Sharing an identifier" is generated rather than asserted. A promise id is
 * SHA-256 over `toPosix(file)` and `normaliseClaim(claim)` and nothing else
 * (§3.2), so the two candidates are built from **one** claim and **one** path and
 * then each is spelled differently in ways those two normalisers are documented to
 * collapse: leading blockquote, heading, bullet and checkbox markers, doubled
 * internal spaces, zero-width characters, a `./` prefix, backslash separators,
 * doubled slashes, surrounding whitespace. That makes the collision a fact about
 * the derivation rather than about string equality, and it means a regression in
 * either normaliser fails this property instead of hiding behind identical inputs.
 *
 * Everything the merge must *not* read is deliberately made to disagree:
 *
 * - the enrichment candidate cites a **different line**, sometimes one past the end
 *   of the document, so any leak of its citation is a visible wrong answer;
 * - the cited line's text on disk is unrelated to the claim, so `citation.text`
 *   coming from disk (§3.3) and `claim` coming from baseline's field are two
 *   separate assertions rather than one;
 * - the baseline candidate carries its own designed test and verdict, so
 *   "enrichment wins" is a change and not a no-op.
 *
 * The expectations are computed from the drawn inputs by re-stating §5.4's rule
 * *order* — union, then overlay, then the undesigned default — because that order
 * is itself the requirement: rule 4 runs after rule 2, so a promise enrichment
 * un-designed is `undesigned` no matter what verdict enrichment also sent. Nothing
 * in the oracle calls the code under test.
 *
 * Extra baseline-only promises ride along in every graph, so "exactly one promise
 * for that identifier" is checked inside a graph that has others rather than in a
 * graph of one.
 *
 * **Validates: Requirements 1.7, 2.1**
 */

/** Design's testing-strategy floor is 100 runs; stated so it cannot regress. */
const NUM_RUNS = 500;

/** Distinct, already-normalised claims. Distinct so their ids cannot collide. */
const CLAIMS: readonly string[] = [
  'Every cart subtotal updates on quantity change',
  'Orders survive a page reload',
  'Checkout rejects an empty postcode',
  'The shop filter narrows by roast',
  'Settings persist the display currency',
  'Discount codes stack with the loyalty rate',
];

const DOCS: readonly string[] = [
  'apps/fixture/README.md',
  'README.md',
  'docs/promises.md',
  'apps/fixture/app/shop/README.md',
];

const TEST_DOCS: readonly string[] = [
  'tests/cart_subtotal_test.md',
  'tests/orders_persist_test.md',
];

/**
 * Spellings of one claim that `normaliseClaim` collapses to the same value:
 * leading markdown decoration, collapsible whitespace, zero-width characters.
 */
const CLAIM_SPELLINGS: readonly ((claim: string) => string)[] = [
  (claim) => claim,
  (claim) => `   ${claim}\t`,
  (claim) => claim.replace(/ /g, '   '),
  (claim) => `> ${claim}`,
  (claim) => `### ${claim}`,
  (claim) => `- [ ] ${claim}`,
  (claim) => `\u200b${claim}\u200d`,
  (claim) => `> - 1. ${claim}`,
];

/** Spellings of one path that `toPosix` collapses to the same value. */
const PATH_SPELLINGS: readonly ((path: string) => string)[] = [
  (path) => path,
  (path) => `./${path}`,
  (path) => ` ${path} `,
  (path) => path.replace(/\//g, '\\'),
  (path) => path.replace(/\//g, '//'),
  (path) => `././${path}`,
];

const arbDesignedTest: fc.Arbitrary<DesignedTest> = fc.record({
  path: fc.constantFrom(...TEST_DOCS),
  testId: fc.oneof(fc.constant(null), fc.constantFrom('T-1', 'T-2', 'T-7')),
});

/** `undefined` means "the provider did not supply this field" (§5.1, §5.4). */
function optional<T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | undefined> {
  return fc.oneof(fc.constant(undefined), arb);
}

const arbVerdict: fc.Arbitrary<Verdict> = fc.constantFrom(...VERDICTS);

const arbOverlay: fc.Arbitrary<ProviderAxisOverlay> = fc.record(
  {
    // Overlay `designedTest` is `DesignedTest`, never null: an overlay says "set
    // this axis", and clearing is not something an absent payload may do.
    designedTest: arbDesignedTest,
    verdict: arbVerdict,
    evidencePackId: fc.constantFrom('ev_20260820T183041Z', 'ev_other'),
  },
  { requiredKeys: [] },
);

interface Drawn {
  readonly doc: string;
  readonly claims: readonly string[];
  readonly claimSpelling: (claim: string) => string;
  readonly pathSpelling: (path: string) => string;
  readonly enrichmentLine: number;
  readonly baselineDesigned: DesignedTest | null;
  readonly baselineVerdict: Verdict | undefined;
  readonly enrichmentDesigned: DesignedTest | null | undefined;
  readonly enrichmentVerdict: Verdict | undefined;
  readonly overlay: ProviderAxisOverlay | undefined;
}

const arbDrawn: fc.Arbitrary<Drawn> = fc.record({
  doc: fc.constantFrom(...DOCS),
  claims: fc.shuffledSubarray([...CLAIMS], { minLength: 1, maxLength: 4 }),
  claimSpelling: fc.constantFrom(...CLAIM_SPELLINGS),
  pathSpelling: fc.constantFrom(...PATH_SPELLINGS),
  // Deliberately unconstrained: sometimes inside the document, sometimes past its
  // end. Either way the merge may not read it.
  enrichmentLine: fc.integer({ min: 1, max: 40 }),
  baselineDesigned: fc.oneof(fc.constant(null), arbDesignedTest),
  baselineVerdict: optional(arbVerdict),
  enrichmentDesigned: optional(fc.oneof(fc.constant(null), arbDesignedTest)),
  enrichmentVerdict: optional(arbVerdict),
  overlay: optional(arbOverlay),
});

/**
 * The cited document. Line 1 is a heading and every claim gets a line whose text
 * is **not** the claim — so `citation.text` proves it came from disk rather than
 * from either provider's copy.
 */
function documentFor(claims: readonly string[]): readonly string[] {
  return ['# Kepler Coffee promises', ...claims.map((_, index) => `line ${index + 2} on disk`), ''];
}

function baselineLineFor(index: number): number {
  return index + 2;
}

describe('Feature: kept, Property 4: Provider merge prefers enrichment on the assurance axes and baseline on citations', () => {
  it('yields one promise per identifier with baseline citations and enrichment axes', () => {
    fc.assert(
      fc.property(arbDrawn, (drawn) => {
        const lines = documentFor(drawn.claims);
        const citations = inMemoryCitationSource({ [drawn.doc]: lines.join('\n') });

        const collidingClaim = drawn.claims[0] as string;
        const collidingLine = baselineLineFor(0);
        const collidingId = promiseId(drawn.doc, collidingClaim);

        const baselineCandidates: PromiseCandidate[] = drawn.claims.map((claim, index) => ({
          claim,
          citation: { file: drawn.doc, line: baselineLineFor(index), text: 'drifted paraphrase' },
          provider: 'baseline',
          designedTest: index === 0 ? drawn.baselineDesigned : null,
          ...(index === 0 && drawn.baselineVerdict !== undefined
            ? { verdict: drawn.baselineVerdict }
            : {}),
        }));

        // The pair: one claim, one path, two spellings of each.
        const enrichmentCandidate: PromiseCandidate = {
          claim: drawn.claimSpelling(collidingClaim),
          citation: {
            file: drawn.pathSpelling(drawn.doc),
            line: drawn.enrichmentLine,
            text: 'enrichment invented this text',
          },
          provider: 'enrichment',
          ...(drawn.enrichmentDesigned === undefined
            ? {}
            : { designedTest: drawn.enrichmentDesigned }),
          ...(drawn.enrichmentVerdict === undefined ? {} : { verdict: drawn.enrichmentVerdict }),
        };

        // The generated spellings must actually collide, or the property would be
        // asserting something weaker than it claims.
        expect(
          promiseId(enrichmentCandidate.citation?.file as string, enrichmentCandidate.claim),
        ).toBe(collidingId);

        const axes: ProviderAxes =
          drawn.overlay === undefined
            ? NO_PROVIDER_AXES
            : new Map<string, ProviderAxisOverlay>([[collidingId, drawn.overlay]]);

        const baseline: ProviderResult = {
          provider: 'baseline',
          candidates: baselineCandidates,
          axes: NO_PROVIDER_AXES,
          ok: true,
          degradedReason: null,
          diagnostics: [],
        };
        const enrichment: ProviderResult = {
          provider: 'enrichment',
          candidates: [enrichmentCandidate],
          axes,
          ok: true,
          degradedReason: null,
          diagnostics: [],
        };

        const merged = mergeGraph({ baseline, enrichment, citations });

        // ── Exactly one promise for that identifier, in a graph with others. ──
        const forId = merged.graph.promises.filter((promise) => promise.id === collidingId);
        expect(forId).toHaveLength(1);
        expect(merged.graph.promises).toHaveLength(drawn.claims.length);
        const promise = forId[0];
        if (promise === undefined) throw new Error('unreachable: length was asserted');

        // ── Citation and claim come from baseline in every case. ─────────────
        expect(promise.citation.file).toBe(toPosix(drawn.doc));
        expect(promise.citation.line).toBe(collidingLine);
        // Verbatim from disk, which is neither provider's copy of it (§3.3, R1.3).
        expect(promise.citation.text).toBe(lines[collidingLine - 1]);
        expect(promise.claim).toBe(normaliseClaim(collidingClaim));

        // ── Designed test and verdict come from enrichment when supplied. ────
        // §5.4's rule order, re-stated: union (2), then overlay (3), then the
        // undesigned default (4).
        const designedAfterUnion =
          drawn.enrichmentDesigned === undefined
            ? drawn.baselineDesigned
            : drawn.enrichmentDesigned;
        const expectedDesigned =
          drawn.overlay?.designedTest === undefined
            ? designedAfterUnion
            : drawn.overlay.designedTest;

        const baselineVerdict =
          drawn.baselineVerdict ?? (drawn.baselineDesigned === null ? 'undesigned' : 'stale');
        const verdictAfterUnion = drawn.enrichmentVerdict ?? baselineVerdict;
        const verdictAfterOverlay = drawn.overlay?.verdict ?? verdictAfterUnion;
        const expectedVerdict =
          expectedDesigned === null ? 'undesigned' : verdictAfterOverlay;

        expect(promise.designedTest).toEqual(expectedDesigned);
        expect(promise.verdict).toBe(expectedVerdict);
        expect(promise.evidencePackId).toBe(drawn.overlay?.evidencePackId ?? null);

        // ── The provider list contains both providers. ───────────────────────
        expect(promise.providers).toEqual(['baseline', 'enrichment']);
        expect(merged.mergedIds).toContain(collidingId);

        // ── And nothing else was disturbed. ─────────────────────────────────
        for (const other of merged.graph.promises) {
          if (other.id === collidingId) continue;
          // Only the colliding id was supplied by both, so every other promise
          // names baseline alone — the merge does not spread provenance.
          expect(other.providers).toEqual(['baseline']);
          expect(other.designedTest).toBeNull();
          expect(other.verdict).toBe('undesigned');
        }
        const ids = merged.graph.promises.map((entry) => entry.id);
        expect(ids).toEqual([...ids].sort());
        expect(merged.uncitedEnrichmentClaims).toEqual([]);
        expect(merged.graph.degraded).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is idempotent for the fields it touches: merging a merged result changes nothing', () => {
    // §5.4 claims the merge is idempotent for the fields it touches, which is what
    // lets the property above assert it directly. Feeding the merged promises back
    // in as baseline candidates, with the same enrichment axes, must be a fixed
    // point — otherwise "the merged graph" would depend on how many times a build
    // ran the merge.
    fc.assert(
      fc.property(arbDrawn, (drawn) => {
        const lines = documentFor(drawn.claims);
        const citations = inMemoryCitationSource({ [drawn.doc]: lines.join('\n') });
        const collidingId = promiseId(drawn.doc, drawn.claims[0] as string);
        const axes: ProviderAxes =
          drawn.overlay === undefined
            ? NO_PROVIDER_AXES
            : new Map<string, ProviderAxisOverlay>([[collidingId, drawn.overlay]]);

        const first = mergeGraph({
          baseline: {
            provider: 'baseline',
            candidates: drawn.claims.map((claim, index) => ({
              claim,
              citation: {
                file: drawn.doc,
                line: baselineLineFor(index),
                text: 'drifted paraphrase',
              },
              provider: 'baseline',
              designedTest: index === 0 ? drawn.baselineDesigned : null,
            })),
            axes: NO_PROVIDER_AXES,
            ok: true,
            degradedReason: null,
            diagnostics: [],
          },
          enrichment: {
            provider: 'enrichment',
            candidates: [],
            axes,
            ok: true,
            degradedReason: null,
            diagnostics: [],
          },
          citations,
        });

        const second = mergeGraph({
          baseline: {
            provider: 'baseline',
            candidates: first.graph.promises.map((promise) => ({
              claim: promise.claim,
              citation: promise.citation,
              provider: 'baseline',
              designedTest: promise.designedTest,
              verdict: promise.verdict,
              evidencePackId: promise.evidencePackId,
            })),
            axes: NO_PROVIDER_AXES,
            ok: true,
            degradedReason: null,
            diagnostics: [],
          },
          enrichment: {
            provider: 'enrichment',
            candidates: [],
            axes,
            ok: true,
            degradedReason: null,
            diagnostics: [],
          },
          citations,
        });

        // `providers` is the one field that legitimately differs: the second pass
        // was handed everything as a baseline candidate, so it has no enrichment
        // candidate to union in. Compare everything else.
        const strip = (promises: readonly { readonly id: string }[]): unknown =>
          promises.map((promise) => ({ ...promise, providers: undefined }));
        expect(strip(second.graph.promises)).toEqual(strip(first.graph.promises));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
