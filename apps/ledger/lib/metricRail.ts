/**
 * The metric rail's typed surface — design §10.7, §10.10, R9.3, R10.1.
 *
 * Two things, both of which exist so the optical alignment in
 * `styles/metric-rail.css` cannot be authored wrongly by the components that come
 * later (`MetricRail`, `MetricFigure`, `DegradedChip`, task 9.4):
 *
 * 1. **`METRIC_RAIL_CLASSES`** — the class contract, as literal types. The
 *    alignment test asserts every name below has a rule in the stylesheet and that
 *    the stylesheet introduces no rail class the map does not name, so a typo is a
 *    failing test rather than a figure that silently sits off the baseline.
 *
 * 2. **`metricFigureParts`** — the split between the digits and the run that
 *    follows them. The alignment *is* that split: the digits are one element at
 *    `--fs-metric` and the `%` is another at `--fs-lg` carrying the optical margin.
 *    A component that formatted `"87%"` into a single string could not align it.
 *    `formatMetricFigure` then rejoins the parts for the places that genuinely need
 *    one string — the badge's SVG text (§10.11) and the accessible name the
 *    count-up of §10.6.2 must carry from the first frame.
 *
 * Nothing here touches the DOM, so it type-checks under the repository's no-DOM
 * `lib` and is importable from a server component, the badge route and a Node test
 * alike.
 */

/** The literal a figure renders when no division may be performed (R9.3). */
export const NOT_APPLICABLE = 'n/a';

/** The unit that follows the digits, and the only run carrying optical margin. */
export const PERCENT_UNIT = '%';

/**
 * The class names `styles/metric-rail.css` defines, and the only ones it defines.
 *
 * - `rail`  the flex row of tiles
 * - `tile`  one tile's footprint
 * - `chip`  the same footprint, for the chip that replaces a tile when degraded
 * - `figure` the strut that fixes the baseline regardless of what sits on it
 * - `digits` the numerals, at `--fs-metric`
 * - `unit` the `%`, at `--fs-lg`, carrying the `-0.06em` optical margin
 * - `notApplicable` the literal `n/a`, at `--fs-lg` on the digits' baseline
 * - `word` a chip's prose, at `--fs-lg` on the digits' baseline
 * - `label` the tile's label, on the 4px grid the digits sit on
 */
export const METRIC_RAIL_CLASSES = {
  rail: 'metric-rail',
  tile: 'metric-tile',
  chip: 'metric-rail__chip',
  figure: 'metric-figure',
  digits: 'metric-figure__digits',
  unit: 'metric-figure__unit',
  notApplicable: 'metric-figure__na',
  word: 'metric-figure__word',
  label: 'metric-tile__label',
} as const;

export type MetricRailClass = (typeof METRIC_RAIL_CLASSES)[keyof typeof METRIC_RAIL_CLASSES];

/** A coverage ratio that resolved to a number: digits and unit, kept apart. */
export interface PercentFigure {
  readonly kind: 'percent';
  /** `"0"` through `"100"`, never padded and never empty. */
  readonly digits: string;
  readonly unit: typeof PERCENT_UNIT;
}

/** A coverage ratio that did not exist, because the promise count was zero. */
export interface NotApplicableFigure {
  readonly kind: 'not-applicable';
  readonly text: typeof NOT_APPLICABLE;
}

export type MetricFigureParts = PercentFigure | NotApplicableFigure;

/**
 * A coverage ratio as a whole-number percentage, 0 to 100.
 *
 * Throws outside the closed unit interval rather than clamping. A ratio above 1
 * means the projection counted a promise twice and a negative one means it counted
 * below zero; both are upstream defects, and a figure that quietly rendered `100%`
 * for either would hide exactly the kind of dishonest number this product exists
 * to refuse.
 */
export function wholePercent(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    throw new RangeError(
      `wholePercent expects a finite coverage ratio, received ${String(ratio)}. A ` +
        `non-finite ratio is a division that should have been refused (R9.3).`,
    );
  }
  if (ratio < 0 || ratio > 1) {
    throw new RangeError(
      `wholePercent expects a ratio in [0, 1], received ${ratio}. Coverage is a count ` +
        `over a total; outside that range the count is wrong, not the formatting.`,
    );
  }
  return Math.round(ratio * 100);
}

/**
 * A whole-number percentage as the digit run the rail sets at `--fs-metric`.
 *
 * Separate from `wholePercent` because the count-up of §10.6.2 interpolates over
 * integers and formats each intermediate frame through this function, so every
 * frame is character-identical in shape to the final one and tabular numerals hold
 * the width steady across all three digit counts.
 */
export function percentDigits(percent: number): string {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new RangeError(
      `percentDigits expects a whole percentage in [0, 100], received ${String(percent)}.`,
    );
  }
  return String(percent);
}

/**
 * The runs a tile renders, kept apart so each can carry its own size, family and
 * optical margin. `null` — a zero promise count — yields the literal `n/a` with no
 * division performed (R9.3).
 */
export function metricFigureParts(ratio: number | null): MetricFigureParts {
  if (ratio === null) return { kind: 'not-applicable', text: NOT_APPLICABLE };
  return { kind: 'percent', digits: percentDigits(wholePercent(ratio)), unit: PERCENT_UNIT };
}

/**
 * The same figure as one string, for the badge's SVG text and for the accessible
 * name the count-up carries before it starts. Character-identical to the visible
 * runs concatenated, which is what makes the no-motion render and the final frame
 * the same render.
 */
export function formatMetricFigure(ratio: number | null): string {
  const parts = metricFigureParts(ratio);
  return parts.kind === 'percent' ? `${parts.digits}${parts.unit}` : parts.text;
}
