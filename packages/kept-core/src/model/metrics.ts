/**
 * Coverage metrics (design §9.1, R5.8, R9.1, R9.2, R9.3, R2.11).
 *
 * The numbers a judge reads first. Field names and nullability are taken
 * verbatim from the snapshot's `metrics` block in design §9.1, because that block
 * is the contract the zod schema of task 3.13 validates and the Ledger's metric
 * rail renders; a name invented here would be a name the schema rejects.
 *
 * Two rules govern the whole file, and both are honesty rules rather than
 * arithmetic ones.
 *
 * **1. Zero promises means both ratios are `null`, and no division happens.** An
 * empty graph is a legitimate state — a repository with no `*_test.md` files and
 * no claims yet — not an error. Dividing anyway yields `NaN`, which survives
 * `JSON.stringify` as the literal `null` in some paths and as a thrown error in
 * others, and which would render in the metric rail as *a coverage figure*. So
 * {@link computeMetrics} returns the frozen {@link ZERO_PROMISE_METRICS} by
 * identity before any ratio is formed: on the zero path there is no division
 * expression to reach, not a division standing behind a guard. R9.3's "SHALL
 * perform no division" is satisfied structurally, and the Ledger renders `n/a`
 * off the null.
 *
 * **2. `provenCoverage` is `null` when the graph is degraded.** A degraded graph
 * is one whose enrichment axis was discarded — Kane refused, timed out, crashed
 * or was absent (R2.8, R2.9, R2.12). In that state KEPT does not know what is
 * proven right now, and a number would be a claim of knowledge it does not have.
 * R2.11 has the Ledger *omit* the Proven Coverage figure and show a `baseline
 * data only` chip in its place, and null is how that omission reaches the UI: the
 * tile has no figure to render, so it cannot render a stale or invented one. The
 * honest failure mode is "we are not claiming proof right now", never "proof is
 * 0%".
 *
 * The per-verdict *counts* are still reported when degraded. A count is a
 * statement about the verdicts the graph currently carries — which, on a degraded
 * build, are the ones the write guard of §4.8 preserved from the last good run —
 * and §9.1 gives those fields no null. It is the ratio, the figure presented as
 * *the current state of proof*, that is withheld.
 *
 * Output is plain JSON throughout: integers, finite ratios in `[0, 1]`, and
 * explicit `null` for absent. No `NaN`, no `Infinity`, no `undefined`, so
 * `parse(serialise(x))` deep-equals `x` as §9.1 requires.
 */

import { VERDICTS, type PromiseGraph, type PromiseRecord, type Verdict } from './promise.js';

/**
 * The `metrics` block of the ledger snapshot (design §9.1), field for field.
 *
 * `undesignedCount` is the outstanding **suite debt** of R5.8 — the promises
 * nobody has designed a test for. It is one field, not two: reporting the same
 * number twice under two names would let the two drift apart.
 */
export interface CoverageMetrics {
  /** Promise count. Always equals `graph.promises.length`. */
  readonly totalPromises: number;
  /** Promises with a non-null designed-test reference (R9.1). */
  readonly designedCount: number;
  readonly provenCount: number;
  readonly redCount: number;
  readonly staleCount: number;
  /** The outstanding suite debt (R5.8). */
  readonly undesignedCount: number;
  /** `designedCount / totalPromises`, or null when the total is zero (R9.3). */
  readonly designedCoverage: number | null;
  /** `provenCount / totalPromises`, or null when the total is zero **or** the graph is degraded (R2.11, R9.3). */
  readonly provenCoverage: number | null;
}

/** The count field each verdict is tallied into. */
type VerdictCountField = 'provenCount' | 'redCount' | 'staleCount' | 'undesignedCount';

/**
 * Verdict → count field, exhaustive over {@link VERDICTS} and injective.
 *
 * Declared as a total `Record<Verdict, …>` so adding a fifth verdict to the
 * model is a compile error here rather than a promise that quietly lands in no
 * bucket and makes the counts stop summing to the total. Exported so Property 21
 * can iterate the vocabulary instead of hand-listing four field names — the
 * hand-listing being exactly how a count gets forgotten.
 */
export const VERDICT_COUNT_FIELDS: Readonly<Record<Verdict, VerdictCountField>> = Object.freeze({
  proven: 'provenCount',
  red: 'redCount',
  stale: 'staleCount',
  undesigned: 'undesignedCount',
});

/**
 * The metrics of a graph with no promises: every count zero, both ratios null.
 *
 * Returned **by identity** from {@link computeMetrics}, which is what makes
 * "no division performed" observable rather than merely claimed: a caller can
 * assert reference equality and know the zero path computed nothing at all.
 */
export const ZERO_PROMISE_METRICS: CoverageMetrics = Object.freeze({
  totalPromises: 0,
  designedCount: 0,
  provenCount: 0,
  redCount: 0,
  staleCount: 0,
  undesignedCount: 0,
  designedCoverage: null,
  provenCoverage: null,
});

/** Zeroed tally, one bucket per verdict and no others (R1.6). */
function zeroTally(): Record<Verdict, number> {
  const tally = {} as Record<Verdict, number>;
  for (const verdict of VERDICTS) tally[verdict] = 0;
  return tally;
}

/**
 * Tally verdicts, one promise into exactly one bucket.
 *
 * Throws `TypeError` on a verdict outside the four. That is a programming error,
 * not a state of the world: `isPromiseRecord` refuses an unknown verdict at the
 * process edge, so a fifth value here means the graph was cast rather than built
 * or parsed (design §14.2 reserves exceptions for precisely this). Silently
 * ignoring it would be worse than throwing — the counts would stop summing to
 * the total, and the snapshot's cross-field rules would fail far from the cause.
 */
function tallyVerdicts(promises: readonly PromiseRecord[]): Record<Verdict, number> {
  const tally = zeroTally();
  // Read through a widened view: the declared key union would make the
  // "no such bucket" check below dead code at the type level, and it is exactly
  // the runtime case a cast past the type system produces.
  const buckets = tally as Record<string, number | undefined>;
  for (const promise of promises) {
    const current = buckets[promise.verdict];
    if (current === undefined) {
      throw new TypeError(`unknown verdict in promise graph: ${String(promise.verdict)}`);
    }
    buckets[promise.verdict] = current + 1;
  }
  return tally;
}

/**
 * A count over a non-zero total.
 *
 * The zero case is unreachable from {@link computeMetrics}, which returns before
 * calling this; the guard is kept so the function is total for any other caller
 * and so no path through this module can produce `0/0`.
 */
function ratio(count: number, total: number): number | null {
  if (total === 0) return null;
  return count / total;
}

/**
 * Compute the snapshot's `metrics` block from a graph.
 *
 * `designedCount` is counted from `designedTest !== null`, not from the verdict.
 * R9.1 defines Designed Coverage as the promises with "a non-null designed test
 * reference" over the total, and that is the fact the field states. The verdict
 * usually agrees — `createPromiseRecord` defaults to `undesigned` when there is
 * no designed test — but the two are independent once a caller passes a verdict
 * explicitly, which is what the verdict router does on every run. A promise whose
 * designed test failed is `red`, not `undesigned`, and it is still designed; a
 * promise waiting on evidence is `stale`, and it is still designed. Counting
 * `designedCount` as `total - undesignedCount` would report those as undesigned
 * and understate the design work that exists.
 *
 * Pure and total: reads the promise list and the `degraded` flag, touches no
 * clock, no filesystem and no process.
 */
export function computeMetrics(graph: PromiseGraph): CoverageMetrics {
  const tally = tallyVerdicts(graph.promises);
  const totalPromises = graph.promises.length;

  // Rule 1. Nothing below this line runs for an empty graph, so no division can
  // be performed on a zero total (R9.3).
  if (totalPromises === 0) return ZERO_PROMISE_METRICS;

  const designedCount = graph.promises.filter((promise) => promise.designedTest !== null).length;

  return {
    totalPromises,
    designedCount,
    provenCount: tally.proven,
    redCount: tally.red,
    staleCount: tally.stale,
    undesignedCount: tally.undesigned,
    designedCoverage: ratio(designedCount, totalPromises),
    // Rule 2. Degraded means the enrichment axis was discarded, so the proven
    // figure is withheld rather than computed (R2.11).
    provenCoverage: graph.degraded ? null : ratio(tally.proven, totalPromises),
  };
}
