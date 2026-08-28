/**
 * `MetricRail` — design §10.2, §10.7, §10.10, R2.11, R9.1, R9.2, R9.3, R10.8.
 *
 * Four tiles, in the order §10.2 lists them: proven coverage, designed coverage,
 * suite debt, last verified. One of them is replaced rather than emptied when the
 * snapshot is degraded, and none of them is ever computed here.
 *
 * **The rail does no arithmetic.** Every figure it renders is a field of
 * `snapshot.metrics`, computed once in `kept-core` and re-checked on parse by the
 * schema's cross-field rules — counts agree with the promise list, and each coverage
 * value is null exactly when no division was performed (Property 21, R9.3). A rail
 * that divided anything would be a second authority on the one number this product
 * is judged by, so the props are the schema's own shape via `Pick` and the component
 * is a projection with no opinions.
 *
 * **Degraded is a replacement, not a variant.** `degraded === true` swaps the proven
 * coverage tile for `DegradedChip`, which occupies the identical footprint through
 * the one box rule `.metric-tile` and `.metric-rail__chip` share (§10.10). So the
 * rail has four members in both states, the same rhythm, and no conditional spacing
 * anywhere. That branch is not the live path today: the committed snapshot carries
 * `degraded: false` and no reasons, so what a judge sees first is four tiles with a
 * real proven figure in the first of them, seven promises out of thirteen. The
 * replacement still has to hold its footprint, because a single refusal upstream
 * brings it back, and a rail that only kept its rhythm in the state it happened to
 * be committed in would break on the day it mattered.
 *
 * `<ul>`/`<li>` because the rail is a list of figures, and `.metric-rail` already
 * removes the markers and lays the row out as a grid of
 * `repeat(auto-fit, minmax(10rem, 1fr))` at a `--s-4` gutter. That is what makes the
 * rail work from 320px to a wide monitor without a breakpoint anywhere: the container
 * decides how many tiles fit — four on a laptop, two on a tablet, one on a phone —
 * rather than a media query guessing at it, and `min-width: 0` on the tiles means no
 * figure can force the grid wider than the column it sits in (R10.8).
 *
 * Server component: no hooks, no handlers, no client boundary. Task 17.7 layers the
 * count-up of §10.6.2 over `MetricFigure`'s digit run without changing this markup.
 */

import clsx from 'clsx';
import type { SnapshotMetrics } from 'kept-core';

import { METRIC_RAIL_CLASSES } from '../lib/metricRail.js';

import { DegradedChip } from './DegradedChip.js';
import { FreshnessChip, type FreshnessChipProps } from './FreshnessChip.js';
import { MetricFigure, type MetricValue } from './MetricFigure.js';

import '../styles/metric-rail.css';

/**
 * The three metrics the rail projects, as the schema's own field types.
 *
 * `Pick` rather than a restatement: a rename or a widening in
 * `packages/kept-core/src/model/snapshot.ts` reaches this component as a type error
 * instead of as a tile that renders `undefined`.
 *
 * `totalPromises` is deliberately **not** among them. The zero-promise case reaches
 * the rail already resolved, as a `null` coverage value — the schema guarantees each
 * coverage field is null exactly when the total is zero (or, for proven, when the
 * graph is degraded), so a rail that re-read the total could only disagree with the
 * division that was or was not performed upstream.
 */
export type RailMetrics = Pick<
  SnapshotMetrics,
  'designedCoverage' | 'provenCoverage' | 'undesignedCount'
>;

export interface MetricTileProps {
  /** Value of the tile's `data-metric` attribute — a stable handle for tests. */
  readonly metric: string;
  readonly label: string;
  readonly value: MetricValue;
}

/** One tile: the figure on its strut, the label on the 4px grid beneath it. */
export function MetricTile({ metric, label, value }: MetricTileProps) {
  return (
    <li className={clsx(METRIC_RAIL_CLASSES.tile, 'surface-raised')} data-metric={metric}>
      <MetricFigure value={value} />
      <span className={METRIC_RAIL_CLASSES.label}>{label}</span>
    </li>
  );
}

export interface MetricRailProps {
  readonly metrics: RailMetrics;
  /** From `snapshot.degraded`. When true, proven coverage is withheld (R2.11). */
  readonly degraded: boolean;
  /** Presentation from `lib/relativeTime.ts`, passed through untouched. */
  readonly freshness: FreshnessChipProps;
  readonly className?: string;
}

export function MetricRail({ metrics, degraded, freshness, className }: MetricRailProps) {
  return (
    <ul
      aria-label="coverage and freshness"
      className={clsx(METRIC_RAIL_CLASSES.rail, className)}
    >
      {degraded ? (
        <DegradedChip label="proven coverage" />
      ) : (
        <MetricTile
          label="proven coverage"
          metric="proven-coverage"
          value={{ kind: 'coverage', ratio: metrics.provenCoverage }}
        />
      )}
      <MetricTile
        label="designed coverage"
        metric="designed-coverage"
        value={{ kind: 'coverage', ratio: metrics.designedCoverage }}
      />
      <MetricTile
        label="suite debt"
        metric="suite-debt"
        value={{ kind: 'count', value: metrics.undesignedCount }}
      />
      <FreshnessChip {...freshness} />
    </ul>
  );
}
