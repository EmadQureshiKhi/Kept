/**
 * `FreshnessChip` — design §10.2, §10.10, R9.6, R9.7.
 *
 * The rail's fourth tile: how long ago the newest consumed Terminal_Event was, as
 * a relative-time string, in one of three tones.
 *
 * | tone         | when                          | colour              |
 * |--------------|-------------------------------|---------------------|
 * | `current`    | age within 24 hours           | `--text-100`        |
 * | `stale`      | age **strictly over** 24 hours | `--verdict-stale`   |
 * | `unverified` | no terminal event at all      | `--text-200`        |
 *
 * **The string and the tone are both inputs.** Formatting an ISO 8601 timestamp
 * into `3 hours ago`, and deciding which side of the 24-hour boundary it falls on,
 * belong to `lib/relativeTime.ts` — a pure function with a property test of its own
 * (Property 24, task 9.3). This component renders what that function returned and
 * decides nothing, so there is exactly one authority on the boundary and no second
 * place for `>` to become `>=`. The `unverified` tone's string is likewise supplied
 * rather than invented here: `never verified` is the formatter's answer for `null`.
 *
 * The value is `--font-ui` on the figure row's baseline strut, at the same
 * `--fs-lg` as the `%` and as `n/a`, so the rail's rhythm does not change because
 * one tile carries words instead of numerals (§10.7).
 *
 * The colour is never the only signal. `stale` puts a verdict token on a
 * non-verdict element, which the palette rules allow for exactly this case
 * (§10.4.2 lists "freshness > 24 h" against `--verdict-stale`) — and it is honest
 * because the words beside it already say how old the run is. Property 22's
 * presentation clause holds the pairing.
 */

import clsx from 'clsx';

import { METRIC_RAIL_CLASSES } from '../lib/metricRail.js';

import '../styles/metric-rail.css';
import '../styles/freshness-chip.css';

export type FreshnessTone = 'current' | 'stale' | 'unverified';

/** The tone → class mapping, exhaustive over `FreshnessTone` by its type. */
export const FRESHNESS_TONE_CLASSES: Readonly<Record<FreshnessTone, string>> = {
  current: 'freshness-value--current',
  stale: 'freshness-value--stale',
  unverified: 'freshness-value--unverified',
};

export interface FreshnessChipProps {
  /** The formatted relative time, e.g. `3 hours ago` or `never verified`. */
  readonly relative: string;
  readonly tone: FreshnessTone;
  /**
   * The ISO 8601 timestamp behind the relative string, exposed as a `title` so the
   * exact instant is recoverable without the page having to spend a line on it.
   * `null` when nothing has been verified, in which case there is no title.
   */
  readonly at?: string | null;
  /** The tile label. */
  readonly label?: string;
}

export function FreshnessChip({
  relative,
  tone,
  at = null,
  label = 'last verified',
}: FreshnessChipProps) {
  return (
    <li className={clsx(METRIC_RAIL_CLASSES.tile, 'surface-raised')} data-freshness={tone}>
      <p className={METRIC_RAIL_CLASSES.figure} {...(at === null ? {} : { title: at })}>
        <span className={clsx(METRIC_RAIL_CLASSES.word, FRESHNESS_TONE_CLASSES[tone])}>
          {relative}
        </span>
      </p>
      <span className={METRIC_RAIL_CLASSES.label}>{label}</span>
    </li>
  );
}
