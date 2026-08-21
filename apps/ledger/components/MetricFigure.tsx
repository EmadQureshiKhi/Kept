/**
 * `MetricFigure` — design §10.2, §10.6.2, §10.7 (optical alignment), §10.10,
 * R9.1, R9.2, R9.3.
 *
 * The figure a rail tile carries: a coverage ratio as digits and a `%` kept apart,
 * the literal `n/a` when no division may be performed, or a plain count for the
 * suite-debt tile.
 *
 * Three decisions, all of them forced by something outside this file:
 *
 * 1. **The split is not formatting, it is the alignment.** `metricFigureParts`
 *    returns the digit run and the unit separately because `styles/metric-rail.css`
 *    sets them at different sizes and hangs a `-0.06em` optical margin off the `%`,
 *    so the *digits* line up across the rail rather than the glyph run. A component
 *    that rendered `"87%"` as one string would take the stylesheet's alignment away
 *    from it, so the percentage is never formatted here.
 *
 * 2. **The accessible name is the final value from first paint.** §10.6.2 layers a
 *    count-up over this DOM in task 17.7; a screen reader must never be read an
 *    intermediate number. So the element is `role="img"` with an `aria-label` of
 *    the *final* formatted value — the assistive tree gets one stable string while
 *    the count-up rewrites only the digit run beneath it. That is also why the name
 *    comes from `formatMetricFigure`, the same formatter the visible runs come
 *    from: the two are character-identical by construction, not by coincidence.
 *
 * 3. **A ratio outside `[0, 1]` throws.** `wholePercent` refuses it rather than
 *    clamping, and this component does not catch it. A ratio above 1 is a promise
 *    counted twice upstream, and rendering `100%` for it would hide exactly the
 *    kind of dishonest number the product exists to refuse (R9.3).
 *
 * **Motion (§10.6.2, task 17.7).** M2 counts the digit run up from 0 through
 * `useMetricCountUp`, which is why this is a client component: the count-up needs the
 * rendered element, and the element is this one. Everything above still holds while it
 * runs — the `%`, the alignment and the accessible name are untouched, and the digits
 * are formatted every frame by {@link countUpFor}'s formatter, which is the formatter
 * the markup below renders from. Deleting `MetricCountUp.tsx` (§18.1 drops M2 second)
 * leaves this component rendering exactly what it renders today.
 */

'use client';

import clsx from 'clsx';
import { useRef } from 'react';

import {
  METRIC_RAIL_CLASSES,
  formatMetricFigure,
  metricFigureParts,
  percentDigits,
  wholePercent,
} from '../lib/metricRail.js';

import { useMetricCountUp, type CountUpFigure } from './MetricCountUp.js';

import '../styles/metric-rail.css';

/**
 * What a tile can show.
 *
 * `coverage` is a ratio in `[0, 1]`, or `null` for the zero-promise case that R9.3
 * requires to render `n/a` with no division performed. `count` is a whole number of
 * promises — the suite debt of R5.8 — which has no unit and no rounding, so it
 * carries no percentage semantics at all.
 */
export type MetricValue =
  | { readonly kind: 'coverage'; readonly ratio: number | null }
  | { readonly kind: 'count'; readonly value: number };

/**
 * A count as its digit run.
 *
 * Refuses a fraction or a negative the way `wholePercent` refuses a ratio outside
 * the unit interval: the suite debt is a cardinality, so `2.5` or `-1` is an
 * upstream counting error and rendering it rounded would launder that error into
 * the interface.
 */
export function countDigits(value: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `countDigits expects a whole count of promises, received ${String(value)}. A ` +
        `fractional or negative count is a projection defect, not a formatting one.`,
    );
  }
  return String(value);
}

/** The one string the figure announces, whatever shape it is. */
export function metricFigureLabel(value: MetricValue): string {
  return value.kind === 'coverage' ? formatMetricFigure(value.ratio) : countDigits(value.value);
}

/**
 * What M2 counts to for this value, and the formatter it counts through — or `null` when
 * there is nothing to count (§10.6.2, task 17.7).
 *
 * `null` for a withheld ratio, because `n/a` is not a number (R9.3), and `null` for zero,
 * because counting `0 → 0` is a figure pretending to move. The formatters are the two the
 * markup below renders from: `percentDigits` for a percentage, `countDigits` for a count.
 * That shared choice is what makes the count-up's final frame character-identical to the
 * static render rather than merely equal-looking.
 */
export function countUpFor(value: MetricValue): CountUpFigure | null {
  if (value.kind === 'count') {
    /* no range check here: the markup below renders through `countDigits`, which refuses a
       fraction or a negative, so a bad count is a throw at render rather than a count-up
       over a nonsense range */
    return value.value === 0 ? null : { to: value.value, format: countDigits };
  }
  if (value.ratio === null) return null;
  const whole = wholePercent(value.ratio);
  return whole === 0 ? null : { to: whole, format: percentDigits };
}

export interface MetricFigureProps {
  readonly value: MetricValue;
  readonly className?: string;
}

/**
 * The figure row: one strut, one baseline, and the runs the stylesheet aligns.
 *
 * `<p>` because `.metric-figure` is `display: block` with its margin zeroed and its
 * own `font-size`/`line-height` cutting the strut that fixes the baseline — the row
 * is inline flow with children on that strut, not a flex box, so a 20px `n/a` and a
 * 40px digit run occupy the same height and the rail's rhythm is the same in every
 * state (§10.7, R9.3).
 */
export function MetricFigure({ value, className }: MetricFigureProps) {
  const label = metricFigureLabel(value);

  /* M2 (§10.6.2): the digit run counts up from 0; the name above it is already final. The
     ref exists for that and for nothing else. */
  const figure = useRef<HTMLParagraphElement | null>(null);
  useMetricCountUp(figure, countUpFor(value));

  return (
    <p
      aria-label={label}
      className={clsx(METRIC_RAIL_CLASSES.figure, className)}
      ref={figure}
      role="img"
    >
      {value.kind === 'count' ? (
        <span className={METRIC_RAIL_CLASSES.digits}>{countDigits(value.value)}</span>
      ) : (
        <CoverageRuns ratio={value.ratio} />
      )}
    </p>
  );
}

/** The two runs of a percentage, or the literal that stands in for both. */
function CoverageRuns({ ratio }: { readonly ratio: number | null }) {
  const parts = metricFigureParts(ratio);

  if (parts.kind === 'not-applicable') {
    return <span className={METRIC_RAIL_CLASSES.notApplicable}>{parts.text}</span>;
  }

  return (
    <>
      <span className={METRIC_RAIL_CLASSES.digits}>{parts.digits}</span>
      <span className={METRIC_RAIL_CLASSES.unit}>{parts.unit}</span>
    </>
  );
}
