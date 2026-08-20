import { describe, expect, it } from 'vitest';

import {
  VERDICTS,
  VERDICT_COUNT_FIELDS,
  ZERO_PROMISE_METRICS,
  computeMetrics,
  createPromiseGraph,
  createPromiseRecord,
  type PromiseRecord,
  type Verdict,
} from '@kept/core';

/**
 * Unit tests for `model/metrics.ts` (design §9.1, R5.8, R9.1, R9.2, R9.3, R2.11).
 * Property 21 states the arithmetic for every graph; these pin the specific
 * states the design names — the empty graph, the degraded graph, and the case
 * where the verdict and the designed-test reference disagree.
 */

function promise(options: {
  claim: string;
  designed?: boolean;
  verdict?: Verdict;
}): PromiseRecord {
  return createPromiseRecord({
    claim: options.claim,
    citation: { file: 'README.md', line: 1, text: options.claim },
    designedTest: options.designed === true ? { path: 'docs/x_test.md', testId: 'T-1' } : null,
    ...(options.verdict === undefined ? {} : { verdict: options.verdict }),
    providers: ['baseline'],
  });
}

describe('computeMetrics', () => {
  it('counts an empty graph as zero with both ratios null, computing nothing', () => {
    const metrics = computeMetrics(createPromiseGraph());
    // Reference equality: the zero path returned a precomputed constant, so no
    // division was performed on a zero total (R9.3).
    expect(metrics).toBe(ZERO_PROMISE_METRICS);
    expect(metrics.designedCoverage).toBeNull();
    expect(metrics.provenCoverage).toBeNull();
    expect(Number.isNaN(metrics.designedCoverage as unknown as number)).toBe(false);
    expect(metrics.totalPromises).toBe(0);
  });

  it('keeps both ratios null for an empty graph that is also degraded', () => {
    const metrics = computeMetrics(
      createPromiseGraph({ degraded: true, degradedReasons: ['kane-not-found'] }),
    );
    expect(metrics).toBe(ZERO_PROMISE_METRICS);
  });

  it('reports counts and both ratios for a mixed graph', () => {
    const graph = createPromiseGraph({
      promises: [
        promise({ claim: 'cart updates', designed: true, verdict: 'proven' }),
        promise({ claim: 'subtotal is right', designed: true, verdict: 'red' }),
        promise({ claim: 'shipping is free', designed: true, verdict: 'stale' }),
        promise({ claim: 'checkout is fast' }),
      ],
    });
    const metrics = computeMetrics(graph);
    expect(metrics.totalPromises).toBe(4);
    expect(metrics.designedCount).toBe(3);
    expect(metrics.provenCount).toBe(1);
    expect(metrics.redCount).toBe(1);
    expect(metrics.staleCount).toBe(1);
    expect(metrics.undesignedCount).toBe(1);
    expect(metrics.designedCoverage).toBe(0.75);
    expect(metrics.provenCoverage).toBe(0.25);
  });

  it('withholds proven coverage when the graph is degraded, keeping the counts', () => {
    const promises = [
      promise({ claim: 'cart updates', designed: true, verdict: 'proven' }),
      promise({ claim: 'checkout is fast', designed: true, verdict: 'stale' }),
    ];
    const healthy = computeMetrics(createPromiseGraph({ promises }));
    const degraded = computeMetrics(
      createPromiseGraph({ promises, degraded: true, degradedReasons: ['enrichment-timeout'] }),
    );
    expect(healthy.provenCoverage).toBe(0.5);
    // R2.11: omitted, not zeroed and not stale.
    expect(degraded.provenCoverage).toBeNull();
    expect(degraded.provenCount).toBe(1);
    expect(degraded.designedCoverage).toBe(1);
  });

  it('counts designed from the designed-test reference, not from the verdict', () => {
    // A designed promise whose test failed is red, and still designed (R9.1).
    const graph = createPromiseGraph({
      promises: [
        promise({ claim: 'cart updates', designed: true, verdict: 'red' }),
        // And the disagreeing direction: an explicit undesigned verdict on a
        // promise that does carry a designed test.
        promise({ claim: 'checkout is fast', designed: true, verdict: 'undesigned' }),
      ],
    });
    const metrics = computeMetrics(graph);
    expect(metrics.designedCount).toBe(2);
    expect(metrics.undesignedCount).toBe(1);
    expect(metrics.designedCoverage).toBe(1);
  });

  it('reports 0 and 1 as ratios rather than null when the total is non-zero', () => {
    const none = computeMetrics(
      createPromiseGraph({ promises: [promise({ claim: 'checkout is fast' })] }),
    );
    expect(none.designedCoverage).toBe(0);
    expect(none.provenCoverage).toBe(0);
    const all = computeMetrics(
      createPromiseGraph({
        promises: [promise({ claim: 'cart updates', designed: true, verdict: 'proven' })],
      }),
    );
    expect(all.designedCoverage).toBe(1);
    expect(all.provenCoverage).toBe(1);
  });

  it('tallies every verdict into exactly one field, exhaustively', () => {
    const fields = VERDICTS.map((verdict) => VERDICT_COUNT_FIELDS[verdict]);
    expect(fields).toHaveLength(4);
    expect(new Set(fields).size).toBe(4);
    for (const verdict of VERDICTS) {
      const metrics = computeMetrics(
        createPromiseGraph({ promises: [promise({ claim: 'cart updates', verdict })] }),
      );
      expect(metrics[VERDICT_COUNT_FIELDS[verdict]]).toBe(1);
      const others = VERDICTS.filter((other) => other !== verdict);
      for (const other of others) expect(metrics[VERDICT_COUNT_FIELDS[other]]).toBe(0);
    }
  });

  it('survives a JSON round trip with no NaN, Infinity or dropped key', () => {
    const graph = createPromiseGraph({
      promises: [promise({ claim: 'cart updates', designed: true, verdict: 'proven' })],
      degraded: true,
    });
    const metrics = computeMetrics(graph);
    expect(JSON.parse(JSON.stringify(metrics))).toEqual(metrics);
    expect(JSON.stringify(computeMetrics(createPromiseGraph()))).toContain('"provenCoverage":null');
  });

  it('refuses a verdict outside the four rather than losing the promise', () => {
    const rogue = {
      ...promise({ claim: 'cart updates' }),
      verdict: 'maybe' as unknown as Verdict,
    };
    expect(() => computeMetrics(createPromiseGraph({ promises: [rogue] }))).toThrow(TypeError);
  });
});
