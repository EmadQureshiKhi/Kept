import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  VERDICTS,
  VERDICT_COUNT_FIELDS,
  ZERO_PROMISE_METRICS,
  computeMetrics,
  createPromiseGraph,
  createPromiseRecord,
  type PromiseGraph,
  type PromiseRecord,
  type Verdict,
} from '@kept/core';

/**
 * Feature: kept, Property 21: Metrics are arithmetically consistent and never
 * divide by zero (design §Correctness Properties, §9.1).
 *
 * *For any* promise graph, the snapshot's total, designed, proven, red, stale and
 * undesigned counts equal the corresponding counts over the promise list, the
 * undesigned count equals the reported suite debt, designed coverage equals
 * designed count divided by total, proven coverage equals proven count divided by
 * total, and both coverage values are null with no division performed exactly
 * when the total is zero; and *for any* degraded snapshot, proven coverage is
 * omitted from the rendered output rather than rendered as a number.
 *
 * Three things the arithmetic clause has to say at once, or it says nothing:
 *
 * - **Exhaustive.** The per-verdict counts sum to the total, iterated over
 *   `VERDICTS` rather than over four hand-written field names. A promise that
 *   fell into no bucket, or into two, breaks the sum — which is the only
 *   statement strong enough to catch a forgotten verdict.
 * - **Not a constant.** Ratios are recomputed independently here from the promise
 *   list, so an implementation that always answered `0`, or `1`, or the last
 *   value it saw, fails.
 * - **Null and not zero.** The empty-graph clause asserts `null` explicitly and
 *   asserts `NaN` and `0` are absent, because `0/0` renders in the metric rail as
 *   a coverage figure and "we have no promises" is not "nothing is proven".
 *   Reference equality against the frozen zero constant is the strongest
 *   available encoding of "no division performed" (R9.3): the value came from a
 *   precomputed object, so nothing was computed at all.
 *
 * The degraded clause is the one the "Verified" claim rests on. When the
 * enrichment axis was discarded, KEPT does not know what is proven, so the figure
 * is withheld rather than guessed (R2.11). At this layer that is
 * `provenCoverage === null`; the Ledger turns the null into the `baseline data
 * only` chip.
 *
 * **Validates: Requirements 2.11, 5.8, 9.1, 9.2, 9.3**
 */

/** Design's testing-strategy floor is 100 runs; stated so it cannot regress. */
const NUM_RUNS = 500;

/** Repo-relative POSIX paths. Task 2.11 should absorb this into `arbCitation`. */
const arbFile: fc.Arbitrary<string> = fc.constantFrom(
  'README.md',
  'apps/fixture/README.md',
  'docs/promises.md',
);

/** One-line claims, from a small pool so duplicate ids occur too. */
const arbClaim: fc.Arbitrary<string> = fc
  .array(
    fc.constantFrom('cart', 'subtotal', 'checkout', 'is', 'fast', 'free', 'shipping', 'updates'),
    { minLength: 1, maxLength: 4 },
  )
  .map((words) => words.join(' '));

const arbVerdict: fc.Arbitrary<Verdict> = fc.constantFrom(...VERDICTS);

/**
 * A promise with an independently chosen verdict and designed-test reference, so
 * the two can disagree exactly as they do once the verdict router has run: a
 * designed promise whose test failed is `red` and still designed. Task 2.11
 * should absorb this as `arbPromise`.
 */
const arbPromise: fc.Arbitrary<PromiseRecord> = fc
  .record({
    claim: arbClaim,
    file: arbFile,
    line: fc.integer({ min: 1, max: 500 }),
    verdict: arbVerdict,
    designed: fc.boolean(),
    testId: fc.option(fc.constantFrom('T-1', 'T-2', 'T-3'), { nil: null }),
  })
  .map((input) =>
    createPromiseRecord({
      claim: input.claim,
      citation: { file: input.file, line: input.line, text: input.claim },
      designedTest: input.designed ? { path: 'docs/cart_test.md', testId: input.testId } : null,
      verdict: input.verdict,
      providers: ['baseline'],
    }),
  );

/**
 * Any graph, degraded or not, **including the empty graph** — `minLength` is 0
 * deliberately, so the zero-total path is exercised by the general clauses and
 * not only by the dedicated test below. Task 2.11 should absorb this as
 * `arbGraph`.
 */
const arbGraph: fc.Arbitrary<PromiseGraph> = fc
  .record({
    promises: fc.array(arbPromise, { minLength: 0, maxLength: 12 }),
    degraded: fc.boolean(),
  })
  .map((input) =>
    createPromiseGraph({
      promises: input.promises,
      degraded: input.degraded,
      degradedReasons: input.degraded ? ['enrichment-timeout'] : [],
    }),
  );

/**
 * A graph whose promises all carry one verdict — the all-proven and all-red
 * extremes, where a ratio of exactly 1 or exactly 0 must still be a number and
 * not a null.
 */
const arbUniformGraph: fc.Arbitrary<PromiseGraph> = fc
  .record({
    verdict: arbVerdict,
    promises: fc.array(arbPromise, { minLength: 1, maxLength: 8 }),
    designed: fc.boolean(),
    degraded: fc.boolean(),
  })
  .map((input) =>
    createPromiseGraph({
      promises: input.promises.map((promise) =>
        createPromiseRecord({
          claim: promise.claim,
          citation: promise.citation,
          designedTest: input.designed ? { path: 'docs/cart_test.md', testId: 'T-1' } : null,
          verdict: input.verdict,
          providers: promise.providers,
        }),
      ),
      degraded: input.degraded,
    }),
  );

/** Independent count, computed from the promise list rather than from the metrics. */
function countVerdict(graph: PromiseGraph, verdict: Verdict): number {
  return graph.promises.filter((promise) => promise.verdict === verdict).length;
}

describe('Feature: kept, Property 21: Metrics are arithmetically consistent and never divide by zero', () => {
  it('makes every per-verdict count agree, exhaustively over the vocabulary', () => {
    fc.assert(
      fc.property(arbGraph, (graph) => {
        const metrics = computeMetrics(graph);
        expect(metrics.totalPromises).toBe(graph.promises.length);
        let summed = 0;
        for (const verdict of VERDICTS) {
          const reported = metrics[VERDICT_COUNT_FIELDS[verdict]];
          expect(reported).toBe(countVerdict(graph, verdict));
          summed += reported;
        }
        // No promise uncounted, none counted twice.
        expect(summed).toBe(metrics.totalPromises);
        // And the four verdicts really do land in four distinct fields.
        expect(new Set(VERDICTS.map((verdict) => VERDICT_COUNT_FIELDS[verdict])).size).toBe(
          VERDICTS.length,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reports the undesigned count as the suite debt, from the verdict', () => {
    fc.assert(
      fc.property(arbGraph, (graph) => {
        const metrics = computeMetrics(graph);
        // R5.8: the suite debt is one field, and it is this one.
        expect(metrics.undesignedCount).toBe(countVerdict(graph, 'undesigned'));
        expect(metrics.undesignedCount).toBeLessThanOrEqual(metrics.totalPromises);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('counts designed from a non-null designed-test reference', () => {
    fc.assert(
      fc.property(arbGraph, (graph) => {
        const metrics = computeMetrics(graph);
        // R9.1 counts the reference, not the verdict: the two are independent.
        expect(metrics.designedCount).toBe(
          graph.promises.filter((promise) => promise.designedTest !== null).length,
        );
        expect(metrics.designedCount).toBeLessThanOrEqual(metrics.totalPromises);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('equals count over total whenever a ratio is reported, and stays in range', () => {
    fc.assert(
      fc.property(arbGraph, (graph) => {
        const metrics = computeMetrics(graph);
        if (metrics.totalPromises === 0) return;
        expect(metrics.designedCoverage).toBe(metrics.designedCount / metrics.totalPromises);
        expect(metrics.designedCoverage).toBeGreaterThanOrEqual(0);
        expect(metrics.designedCoverage).toBeLessThanOrEqual(1);
        if (metrics.provenCoverage !== null) {
          expect(metrics.provenCoverage).toBe(metrics.provenCount / metrics.totalPromises);
          expect(metrics.provenCoverage).toBeGreaterThanOrEqual(0);
          expect(metrics.provenCoverage).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('nulls both ratios exactly when the total is zero, and never divides', () => {
    fc.assert(
      fc.property(arbGraph, (graph) => {
        const metrics = computeMetrics(graph);
        const empty = metrics.totalPromises === 0;
        expect(metrics.designedCoverage === null).toBe(empty);
        if (empty) {
          // No division performed: the value came from the frozen constant.
          expect(metrics).toBe(ZERO_PROMISE_METRICS);
          expect(metrics.designedCoverage).toBeNull();
          expect(metrics.provenCoverage).toBeNull();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('nulls proven coverage for every degraded graph', () => {
    fc.assert(
      fc.property(arbGraph, (graph) => {
        const metrics = computeMetrics(graph);
        // R2.11: omitted when degraded, present otherwise unless the graph is empty.
        if (graph.degraded) expect(metrics.provenCoverage).toBeNull();
        expect(metrics.provenCoverage === null).toBe(
          graph.degraded || metrics.totalPromises === 0,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reports 0 and 1 as numbers on a uniform graph, never as a null', () => {
    fc.assert(
      fc.property(arbUniformGraph, (graph) => {
        const metrics = computeMetrics(graph);
        expect(metrics.totalPromises).toBeGreaterThan(0);
        const expected = metrics[VERDICT_COUNT_FIELDS[graph.promises[0]!.verdict]];
        // All of one verdict: that bucket holds everything, the others nothing.
        expect(expected).toBe(metrics.totalPromises);
        expect(metrics.designedCoverage).toBe(graph.promises[0]!.designedTest === null ? 0 : 1);
        if (!graph.degraded) {
          expect(metrics.provenCoverage).toBe(graph.promises[0]!.verdict === 'proven' ? 1 : 0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is plain JSON: no NaN, no Infinity, no dropped key', () => {
    fc.assert(
      fc.property(arbGraph, (graph) => {
        const metrics = computeMetrics(graph);
        for (const value of Object.values(metrics)) {
          if (value === null) continue;
          expect(Number.isFinite(value)).toBe(true);
        }
        expect(JSON.parse(JSON.stringify(metrics))).toEqual(metrics);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('holds for the empty graph named as a required edge case', () => {
    for (const degraded of [false, true]) {
      const metrics = computeMetrics(createPromiseGraph({ degraded }));
      expect(metrics).toBe(ZERO_PROMISE_METRICS);
      expect(metrics.totalPromises).toBe(0);
      expect(metrics.designedCoverage).toBeNull();
      expect(metrics.provenCoverage).toBeNull();
      // Not zero, and not the thing a bare division would have produced.
      expect(metrics.provenCoverage).not.toBe(0);
      expect(Object.values(metrics).some((value) => Number.isNaN(value))).toBe(false);
    }
  });
});
