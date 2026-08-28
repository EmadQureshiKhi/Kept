import { describe, expect, it } from 'vitest';

import {
  ADMISSION_DIAGNOSTIC_CODES,
  ENRICHMENT_DEGRADED_REASONS,
  MERGE_DIAGNOSTIC_CODES,
  NO_PROVIDER_AXES,
  computeMetrics,
  createDiagnosticSink,
  createPromiseRecord,
  inMemoryCitationSource,
  mergeGraph,
  promiseId,
  type CollectingDiagnosticSink,
  type GraphEdge,
  type PromiseCandidate,
  type ProviderAxes,
  type ProviderAxisOverlay,
  type ProviderResult,
} from 'kept-core';

/**
 * Task 3.8 — the canonical provider merge (design §5.4, R1.7, R2.1, R5.5).
 *
 * The whole file is about *who is allowed to say what*. Baseline decides which
 * promises exist, what they claim and where the claim is made; enrichment decides
 * what is designed and what is proven. Those two field sets do not overlap, which
 * is why an outage costs exactly the second one — and every test below is an
 * assertion that the boundary held.
 */

const DOC = 'apps/fixture/README.md';
const CLAIM = 'Every cart subtotal updates on quantity change';
const OTHER_CLAIM = 'Orders survive a page reload';
const DOCUMENT = ['Kepler Coffee promises', CLAIM, OTHER_CLAIM, ''].join('\n');
const CITATIONS = inMemoryCitationSource({ [DOC]: DOCUMENT });

const TEST_DOC = 'tests/cart_subtotal_test.md';

function baselineOf(candidates: readonly PromiseCandidate[]): ProviderResult {
  return {
    provider: 'baseline',
    candidates,
    axes: NO_PROVIDER_AXES,
    ok: true,
    degradedReason: null,
    diagnostics: [],
  };
}

function enrichmentOf(over: {
  readonly candidates?: readonly PromiseCandidate[];
  readonly axes?: ProviderAxes;
  readonly ok?: boolean;
  readonly degradedReason?: string | null;
}): ProviderResult {
  const ok = over.ok ?? true;
  return {
    provider: 'enrichment',
    candidates: over.candidates ?? [],
    axes: over.axes ?? NO_PROVIDER_AXES,
    ok,
    degradedReason: over.degradedReason ?? null,
    diagnostics: [],
  };
}

function overlays(entries: readonly [string, ProviderAxisOverlay][]): ProviderAxes {
  return new Map(entries);
}

/** The baseline candidate every test starts from: cited, designed, unproven. */
const BASELINE_CANDIDATE: PromiseCandidate = {
  claim: CLAIM,
  // Deliberately a stale paraphrase and a stale line: the gate overwrites the
  // text from disk (§3.3) and the line is baseline's to keep.
  citation: { file: DOC, line: 2, text: 'a paraphrase that has drifted' },
  provider: 'baseline',
  designedTest: { path: TEST_DOC, testId: null },
};

const ID = promiseId(DOC, CLAIM);

function sinkAndMerge(request: Parameters<typeof mergeGraph>[0]): {
  readonly result: ReturnType<typeof mergeGraph>;
  readonly sink: CollectingDiagnosticSink;
} {
  const sink = createDiagnosticSink();
  const result = mergeGraph({ ...request, citations: CITATIONS, diagnostics: sink });
  return { result, sink };
}

describe('rule 1: baseline is the sole citation authority (§5.4)', () => {
  it('takes citation and claim from baseline even when enrichment supplied its own', () => {
    const { result } = sinkAndMerge({
      baseline: baselineOf([BASELINE_CANDIDATE]),
      enrichment: enrichmentOf({
        candidates: [
          {
            claim: CLAIM,
            // Same id — same file, same normalised claim — but a different line
            // and text. Neither may reach the graph.
            citation: { file: DOC, line: 3, text: 'enrichment invented this' },
            provider: 'enrichment',
            designedTest: { path: TEST_DOC, testId: 'T-3' },
            verdict: 'proven',
          },
        ],
      }),
    });

    expect(result.graph.promises).toHaveLength(1);
    const promise = result.graph.promises[0];
    expect(promise?.id).toBe(ID);
    // Baseline's line, and the verbatim text read from disk.
    expect(promise?.citation).toEqual({ file: DOC, line: 2, text: CLAIM });
    expect(promise?.claim).toBe(CLAIM);
    // Enrichment's axes.
    expect(promise?.designedTest).toEqual({ path: TEST_DOC, testId: 'T-3' });
    expect(promise?.verdict).toBe('proven');
    // Both providers named.
    expect(promise?.providers).toEqual(['baseline', 'enrichment']);
    expect(result.mergedIds).toEqual([ID]);
  });

  it('drops an enrichment candidate that matches no baseline promise, and says so', () => {
    const { result, sink } = sinkAndMerge({
      baseline: baselineOf([BASELINE_CANDIDATE]),
      enrichment: enrichmentOf({
        candidates: [
          {
            claim: OTHER_CLAIM,
            citation: { file: DOC, line: 3, text: OTHER_CLAIM },
            provider: 'enrichment',
          },
        ],
      }),
    });

    // Enrichment supplies no citations, so it has nothing for the gate to
    // resolve; admitting it would put an uncited promise in the graph.
    expect(result.graph.promises).toHaveLength(1);
    expect(result.uncitedEnrichmentClaims).toEqual([OTHER_CLAIM]);
    expect(sink.has(MERGE_DIAGNOSTIC_CODES.enrichmentUncited)).toBe(true);
  });

  it('still refuses a baseline candidate whose citation does not resolve (R1.4)', () => {
    const { result, sink } = sinkAndMerge({
      baseline: baselineOf([
        { ...BASELINE_CANDIDATE, citation: { file: DOC, line: 99, text: CLAIM } },
      ]),
      enrichment: enrichmentOf({}),
    });
    expect(result.graph.promises).toEqual([]);
    expect(sink.has(ADMISSION_DIAGNOSTIC_CODES.lineOutOfRange)).toBe(true);
  });
});

describe('rule 2: enrichment wins the assurance axes, and only those', () => {
  it('leaves a field alone when enrichment did not supply it', () => {
    const { result } = sinkAndMerge({
      baseline: baselineOf([BASELINE_CANDIDATE]),
      enrichment: enrichmentOf({
        candidates: [
          // A verdict and nothing else. The designed test must survive.
          {
            claim: CLAIM,
            citation: { file: DOC, line: 2, text: CLAIM },
            provider: 'enrichment',
            verdict: 'red',
          },
        ],
      }),
    });
    const promise = result.graph.promises[0];
    expect(promise?.designedTest).toEqual({ path: TEST_DOC, testId: null });
    expect(promise?.verdict).toBe('red');
  });
});

describe('rule 3: axis overlays, where a missing key means "leave it" (§5.1)', () => {
  it('applies designedTest, verdict and evidencePackId when present', () => {
    const { result } = sinkAndMerge({
      baseline: baselineOf([BASELINE_CANDIDATE]),
      enrichment: enrichmentOf({
        axes: overlays([
          [
            ID,
            {
              designedTest: { path: TEST_DOC, testId: 'T-3' },
              verdict: 'proven',
              evidencePackId: 'ev_20260820T183041Z',
            },
          ],
        ]),
      }),
    });
    expect(result.overlaidIds).toEqual([ID]);
    expect(result.graph.promises[0]).toMatchObject({
      designedTest: { path: TEST_DOC, testId: 'T-3' },
      verdict: 'proven',
      evidencePackId: 'ev_20260820T183041Z',
      providers: ['baseline', 'enrichment'],
    });
  });

  it('cannot un-design a promise by omitting the key', () => {
    // The reason overlay fields are optional and not nullable: a coverage payload
    // that simply did not mention this test must not clear its binding.
    const { result } = sinkAndMerge({
      baseline: baselineOf([BASELINE_CANDIDATE]),
      enrichment: enrichmentOf({ axes: overlays([[ID, { verdict: 'proven' }]]) }),
    });
    expect(result.graph.promises[0]?.designedTest).toEqual({ path: TEST_DOC, testId: null });
    expect(result.graph.promises[0]?.verdict).toBe('proven');
  });

  it('ignores an overlay for an id no promise has, and reports it', () => {
    const { result, sink } = sinkAndMerge({
      baseline: baselineOf([BASELINE_CANDIDATE]),
      enrichment: enrichmentOf({ axes: overlays([['p_000000000000', { verdict: 'proven' }]]) }),
    });
    expect(result.unmatchedOverlayIds).toEqual(['p_000000000000']);
    expect(result.graph.promises[0]?.verdict).toBe('stale');
    expect(sink.has(MERGE_DIAGNOSTIC_CODES.overlayUnmatched)).toBe(true);
  });
});

describe('rule 4: no designed test means undesigned (R5.5)', () => {
  it('defaults a promise baseline never designed', () => {
    const { result } = sinkAndMerge({
      baseline: baselineOf([{ ...BASELINE_CANDIDATE, designedTest: null }]),
      enrichment: enrichmentOf({}),
    });
    expect(result.graph.promises[0]?.verdict).toBe('undesigned');
    expect(result.undesignedIds).toEqual([ID]);
  });

  it('outranks an enrichment verdict for a promise enrichment also un-designed', () => {
    // Rule 4 runs after rule 2, and the ordering is the point: a promise with no
    // test cannot be proven, whatever a payload says.
    const { result, sink } = sinkAndMerge({
      baseline: baselineOf([BASELINE_CANDIDATE]),
      enrichment: enrichmentOf({
        candidates: [
          {
            claim: CLAIM,
            citation: { file: DOC, line: 2, text: CLAIM },
            provider: 'enrichment',
            designedTest: null,
            verdict: 'proven',
          },
        ],
      }),
    });
    expect(result.graph.promises[0]?.verdict).toBe('undesigned');
    expect(sink.has(MERGE_DIAGNOSTIC_CODES.undesigned)).toBe(true);
  });
});

describe('rule 5: degraded comes from enrichment and nothing else (§5.4)', () => {
  it('sets the flag and the single reason a failed enrichment gave', () => {
    const { result, sink } = sinkAndMerge({
      baseline: baselineOf([BASELINE_CANDIDATE]),
      enrichment: enrichmentOf({
        ok: false,
        degradedReason: 'assurance-status:refused',
      }),
    });
    expect(result.graph.degraded).toBe(true);
    expect(result.graph.degradedReasons).toEqual(['assurance-status:refused']);
    expect(sink.has(MERGE_DIAGNOSTIC_CODES.degraded)).toBe(true);
    // The honesty consequence: no proven figure at all, rather than zero (R2.11).
    expect(computeMetrics(result.graph).provenCoverage).toBeNull();
  });

  it('is not degraded when enrichment succeeded', () => {
    const { result } = sinkAndMerge({
      baseline: baselineOf([BASELINE_CANDIDATE]),
      enrichment: enrichmentOf({}),
    });
    expect(result.graph.degraded).toBe(false);
    expect(result.graph.degradedReasons).toEqual([]);
  });

  it('is not degraded when no enrichment axis was attempted at all', () => {
    // Omitting the result is the deliberate baseline-only build of §5.5. "Kane is
    // absent" is a *result* carrying `kane-not-found`, because the ledger has to
    // show it — which the next assertion covers.
    const { result } = sinkAndMerge({ baseline: baselineOf([BASELINE_CANDIDATE]) });
    expect(result.graph.degraded).toBe(false);
    expect(result.graph.degradedReasons).toEqual([]);

    const absent = sinkAndMerge({
      baseline: baselineOf([BASELINE_CANDIDATE]),
      enrichment: enrichmentOf({
        ok: false,
        degradedReason: ENRICHMENT_DEGRADED_REASONS.kaneNotFound,
      }),
    });
    expect(absent.result.graph.degraded).toBe(true);
    expect(absent.result.graph.degradedReasons).toEqual(['kane-not-found']);
  });
});

describe('rule 6: the graph is canonical (§5.4, §9.2)', () => {
  it('sorts promises by id and edges by (kind, from, to)', () => {
    const edges: readonly GraphEdge[] = [
      { from: 'p_z', to: 'ev_a', kind: 'evidence' },
      { from: 'd_a', to: 'p_b', kind: 'cites' },
      { from: 'd_a', to: 'p_a', kind: 'cites' },
      // An exact duplicate: collapsed by the constructor.
      { from: 'd_a', to: 'p_a', kind: 'cites' },
    ];
    const { result } = sinkAndMerge({
      baseline: baselineOf([
        { ...BASELINE_CANDIDATE, claim: OTHER_CLAIM, citation: { file: DOC, line: 3, text: '' } },
        BASELINE_CANDIDATE,
      ]),
      enrichment: enrichmentOf({}),
      edges,
    });

    const ids = result.graph.promises.map((promise) => promise.id);
    expect(ids).toEqual([...ids].sort());
    expect(result.graph.edges).toEqual([
      { from: 'd_a', to: 'p_a', kind: 'cites' },
      { from: 'd_a', to: 'p_b', kind: 'cites' },
      { from: 'p_z', to: 'ev_a', kind: 'evidence' },
    ]);
  });

  it('keeps the identity the gate admitted after every overlay (R1.2)', () => {
    const expected = createPromiseRecord({
      claim: CLAIM,
      citation: { file: DOC, line: 2, text: CLAIM },
      providers: ['baseline'],
    });
    const { result } = sinkAndMerge({
      baseline: baselineOf([BASELINE_CANDIDATE]),
      enrichment: enrichmentOf({
        axes: overlays([[ID, { verdict: 'proven', designedTest: { path: TEST_DOC, testId: 'T-9' } }]]),
      }),
    });
    // Rebuilding the record after an overlay re-derives the id from the citation
    // file and the claim, both of which are baseline's, so it cannot move.
    expect(result.graph.promises[0]?.id).toBe(expected.id);
  });

  it('concatenates diagnostics from both providers, the gate and the merge', () => {
    const providerNote = createDiagnosticSink().report({
      code: 'baseline-no-test-documents',
      severity: 'info',
      message: 'no test documents',
    });
    const { result } = sinkAndMerge({
      baseline: {
        ...baselineOf([
          { ...BASELINE_CANDIDATE, citation: null },
          BASELINE_CANDIDATE,
        ]),
        diagnostics: [providerNote],
      },
      enrichment: enrichmentOf({ ok: false, degradedReason: 'enrichment-timeout' }),
    });

    const codes = result.graph.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes[0]).toBe('baseline-no-test-documents');
    expect(codes).toContain(ADMISSION_DIAGNOSTIC_CODES.noCitation);
    expect(codes).toContain(MERGE_DIAGNOSTIC_CODES.degraded);
  });
});
