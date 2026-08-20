/**
 * `DegradedChip` — design §10.10, R2.11, R9.3.
 *
 * When the snapshot is degraded, the Proven Coverage tile is **replaced** by this
 * chip. Not greyed, not shown as `0%`, not shown as a number with a footnote:
 * replaced, by the words `baseline data only`.
 *
 * That is the honest rendering of the state the enrichment axis was discarded in.
 * A `0%` would be a lie — every promise still has its citation and its designed
 * test — and a dimmed number would still be a number a judge could read off the
 * page. The words say precisely what is known and what is withheld, which is R2.11
 * read literally: render the indicator, omit the figure.
 *
 * The chip takes the tile's **exact** footprint, and it does so by wearing
 * `.metric-rail__chip`, which shares one rule with `.metric-tile` in
 * `styles/metric-rail.css`. There is no second box rule for either — the rail's
 * rhythm is unchanged in the degraded state because the geometry is literally the
 * same geometry, and `test/metric-rail-alignment.test.ts` asserts that the two
 * selectors keep sharing one rule.
 *
 * The label stays `proven coverage`. The tile names the figure that is missing,
 * rather than quietly becoming a different tile.
 *
 * No count-up runs here: §10.6.2's interpolation is over a figure, and this chip has
 * none. There is nothing to animate, which is the whole reason a degraded rail is
 * cheaper rather than more complicated.
 */

import clsx from 'clsx';

import { METRIC_RAIL_CLASSES } from '../lib/metricRail.js';

import '../styles/metric-rail.css';

/** The words R2.11 and design §10.10 specify, verbatim and in one place. */
export const DEGRADED_WORDS = 'baseline data only';

export interface DegradedChipProps {
  /** The label of the tile this chip stands in for. */
  readonly label?: string;
}

export function DegradedChip({ label = 'proven coverage' }: DegradedChipProps) {
  return (
    <li className={clsx(METRIC_RAIL_CLASSES.chip, 'surface-raised')} data-degraded="true">
      <p className={METRIC_RAIL_CLASSES.figure}>
        <span className={METRIC_RAIL_CLASSES.word}>{DEGRADED_WORDS}</span>
      </p>
      <span className={METRIC_RAIL_CLASSES.label}>{label}</span>
    </li>
  );
}
