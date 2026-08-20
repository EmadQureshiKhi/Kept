/**
 * The metric rail, rendered — design §10.2, §10.7, §10.10, R2.11, R9.1, R9.2, R9.3.
 *
 * `test/metric-rail-alignment.test.ts` (task 8.7) asserts the stylesheet and the
 * formatter. This file asserts the DOM those two exist for, and it is organised
 * around the three states R9.3 and R2.11 make different:
 *
 *   1. **a figure** — digits and `%` as two elements, because the alignment is the
 *      split and a single `"87%"` string would take it away from the stylesheet;
 *   2. **`n/a`** — the literal, with no division performed, when the promise count is
 *      zero;
 *   3. **replaced** — the proven coverage tile swapped for `baseline data only` when
 *      the snapshot is degraded, at the same footprint rather than as a dimmed number.
 *
 * The fixtures are the live snapshot's numbers, written out here rather than imported
 * from `data/ledger.snapshot.json`: task 9.1 is landing the loader concurrently, and a
 * component test that depended on a file being committed by another commit would fail
 * for a reason that has nothing to do with the component. The values are the real
 * ones — degraded on `assurance-status:refused`, designed coverage 1, suite debt 0,
 * never verified — so the degraded path under test is the path a judge sees first.
 *
 * The count-up of §10.6.2 arrives in task 17.7 and must not change this DOM, so the
 * accessible name is asserted to be the *final* value here, at first paint, with no
 * animation in play.
 */

import { cleanup, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEGRADED_WORDS, DegradedChip } from '../components/DegradedChip.js';
import {
  FRESHNESS_TONE_CLASSES,
  FreshnessChip,
  type FreshnessChipProps,
  type FreshnessTone,
} from '../components/FreshnessChip.js';
import { MetricFigure, countDigits, metricFigureLabel } from '../components/MetricFigure.js';
import { MetricRail, type RailMetrics } from '../components/MetricRail.js';
import { METRIC_RAIL_CLASSES } from '../lib/metricRail.js';

/** The committed snapshot's metrics, verbatim. Degraded, so proven is withheld. */
const LIVE_METRICS: RailMetrics = {
  designedCoverage: 1,
  provenCoverage: null,
  undesignedCount: 0,
};

/** The committed snapshot's freshness: no terminal event has ever been consumed. */
const LIVE_FRESHNESS: FreshnessChipProps = {
  relative: 'never verified',
  tone: 'unverified',
  at: null,
};

const PROVEN_TILE = `[data-metric='proven-coverage']`;

/**
 * Unmount after every case, and scope every role query to the container this case
 * rendered.
 *
 * The ledger project runs with `isolate: false` — one jsdom instance shared by every
 * ledger suite, because cold-starting several is what blows the worker budget on this
 * machine. A shared `document` means a global `screen` query can see another file's
 * markup, and it means Testing Library's automatic cleanup, registered once by
 * whichever suite imported it first, does not fire for the rest. Both are answered
 * here rather than in the configuration, so these assertions are true regardless of
 * how the suites are pooled.
 */
afterEach(cleanup);

/* ─────────────────────────────── the four tiles ─────────────────────────────── */

describe('MetricRail — four members, in the order §10.2 lists them', () => {
  it('renders a named list of four tiles', () => {
    const { container } = render(
      <MetricRail degraded={false} freshness={LIVE_FRESHNESS} metrics={LIVE_METRICS} />,
    );

    const rail = within(container).getByRole('list', { name: 'coverage and freshness' });
    expect(rail.classList.contains(METRIC_RAIL_CLASSES.rail)).toBe(true);
    expect(within(container).getAllByRole('listitem')).toHaveLength(4);
  });

  it('labels them proven coverage, designed coverage, suite debt and last verified', () => {
    const { container } = render(
      <MetricRail degraded={false} freshness={LIVE_FRESHNESS} metrics={LIVE_METRICS} />,
    );
    const labels = [...container.querySelectorAll(`.${METRIC_RAIL_CLASSES.label}`)].map(
      (element) => element.textContent,
    );
    expect(labels).toEqual([
      'proven coverage',
      'designed coverage',
      'suite debt',
      'last verified',
    ]);
  });

  it('renders the suite debt as a count, with no unit and no percentage', () => {
    const { container } = render(
      <MetricRail
        degraded={false}
        freshness={LIVE_FRESHNESS}
        metrics={{ ...LIVE_METRICS, undesignedCount: 3 }}
      />,
    );
    const tile = container.querySelector(`[data-metric='suite-debt']`);
    expect(tile?.querySelector(`.${METRIC_RAIL_CLASSES.digits}`)?.textContent).toBe('3');
    expect(
      tile?.querySelector(`.${METRIC_RAIL_CLASSES.unit}`),
      'the suite debt is a cardinality, not a ratio, so it carries no %',
    ).toBeNull();
  });
});

/* ──────────────────────── state 1: a figure, in two runs ────────────────────── */

describe('MetricFigure — the figure is two runs and one accessible name', () => {
  it('splits a coverage ratio into digits and unit', () => {
    const { container } = render(<MetricFigure value={{ kind: 'coverage', ratio: 0.87 }} />);
    expect(container.querySelector(`.${METRIC_RAIL_CLASSES.digits}`)?.textContent).toBe('87');
    expect(container.querySelector(`.${METRIC_RAIL_CLASSES.unit}`)?.textContent).toBe('%');
  });

  it('carries the final value in its accessible name from first paint (§10.6.2)', () => {
    const { container } = render(<MetricFigure value={{ kind: 'coverage', ratio: 1 }} />);
    const figure = within(container).getByRole('img', { name: '100%' });
    expect(figure.classList.contains(METRIC_RAIL_CLASSES.figure)).toBe(true);
    expect(
      figure.getAttribute('aria-label'),
      'the count-up of task 17.7 rewrites the digit run only; a screen reader must ' +
        'never be read an intermediate number',
    ).toBe('100%');
  });

  it('names a count by its digits and a withheld ratio by its literal', () => {
    expect(metricFigureLabel({ kind: 'coverage', ratio: 0.5 })).toBe('50%');
    expect(metricFigureLabel({ kind: 'coverage', ratio: null })).toBe('n/a');
    expect(metricFigureLabel({ kind: 'count', value: 12 })).toBe('12');
  });

  it('refuses a ratio outside the unit interval rather than rendering 100%', () => {
    const console_ = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => render(<MetricFigure value={{ kind: 'coverage', ratio: 1.5 }} />)).toThrow(
        /ratio in \[0, 1\]/,
      );
    } finally {
      console_.mockRestore();
    }
  });

  it('refuses a fractional or negative count for the same reason', () => {
    expect(() => countDigits(2.5)).toThrow(/whole count of promises/);
    expect(() => countDigits(-1)).toThrow(/whole count of promises/);
    expect(countDigits(0)).toBe('0');
  });
});

/* ─────────────── state 2: n/a, with no division performed (R9.3) ─────────────── */

describe('MetricRail — a zero promise count renders the literal n/a', () => {
  it('renders n/a for both coverage figures and divides nothing', () => {
    const { container } = render(
      <MetricRail
        degraded={false}
        freshness={LIVE_FRESHNESS}
        metrics={{ designedCoverage: null, provenCoverage: null, undesignedCount: 0 }}
      />,
    );

    const literals = [...container.querySelectorAll(`.${METRIC_RAIL_CLASSES.notApplicable}`)];
    expect(literals).toHaveLength(2);
    expect(literals.map((element) => element.textContent)).toEqual(['n/a', 'n/a']);
    expect(
      container.querySelectorAll(`.${METRIC_RAIL_CLASSES.unit}`),
      'a % beside n/a would imply a division that was never performed',
    ).toHaveLength(0);
    expect(within(container).getAllByRole('img', { name: 'n/a' })).toHaveLength(2);
  });
});

/* ───────────── state 3: degraded replaces the tile, not its contents ─────────── */

describe('MetricRail — degraded replaces the proven coverage tile (R2.11, §10.10)', () => {
  it('renders the chip instead of the tile, keeping the rail at four members', () => {
    const { container } = render(
      <MetricRail degraded freshness={LIVE_FRESHNESS} metrics={LIVE_METRICS} />,
    );

    expect(within(container).getAllByRole('listitem')).toHaveLength(4);
    expect(
      container.querySelector(PROVEN_TILE),
      'R2.11: the proven coverage figure is omitted, so its tile is gone rather than empty',
    ).toBeNull();

    const chip = container.querySelector(`.${METRIC_RAIL_CLASSES.chip}`);
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain(DEGRADED_WORDS);
    expect(
      chip?.classList.contains(METRIC_RAIL_CLASSES.tile),
      'the chip wears its own class; the shared footprint comes from one CSS rule, ' +
        'not from stacking both classes on one element',
    ).toBe(false);
  });

  it('shows no number in the degraded chip at all', () => {
    const { container } = render(<DegradedChip />);
    expect(container.querySelector(`.${METRIC_RAIL_CLASSES.digits}`)).toBeNull();
    expect(container.querySelector(`.${METRIC_RAIL_CLASSES.unit}`)).toBeNull();
    expect(container.querySelector(`.${METRIC_RAIL_CLASSES.notApplicable}`)).toBeNull();
    expect(container.querySelector(`.${METRIC_RAIL_CLASSES.word}`)?.textContent).toBe(
      'baseline data only',
    );
  });

  it('keeps the label of the figure it withholds, so the rail names what is missing', () => {
    const { container } = render(<DegradedChip />);
    expect(container.querySelector(`.${METRIC_RAIL_CLASSES.label}`)?.textContent).toBe(
      'proven coverage',
    );
  });

  it('still renders designed coverage, because baseline data is real data', () => {
    const { container } = render(
      <MetricRail degraded freshness={LIVE_FRESHNESS} metrics={LIVE_METRICS} />,
    );
    const designed = container.querySelector(`[data-metric='designed-coverage']`);
    expect(designed?.querySelector(`.${METRIC_RAIL_CLASSES.digits}`)?.textContent).toBe('100');
    expect(designed?.querySelector(`.${METRIC_RAIL_CLASSES.unit}`)?.textContent).toBe('%');
  });
});

/* ───────────────────────────── the freshness tile ────────────────────────────── */

describe('FreshnessChip — three tones, and the words that make them honest', () => {
  const cases: readonly { readonly tone: FreshnessTone; readonly relative: string }[] = [
    { tone: 'current', relative: '3 hours ago' },
    { tone: 'stale', relative: '4 days ago' },
    { tone: 'unverified', relative: 'never verified' },
  ];

  it('renders the relative string and the tone class for each tone', () => {
    for (const { tone, relative } of cases) {
      const { container, unmount } = render(<FreshnessChip relative={relative} tone={tone} />);
      const value = container.querySelector(`.${METRIC_RAIL_CLASSES.word}`);
      expect(value?.textContent, `${tone} lost its words`).toBe(relative);
      expect(value?.classList.contains(FRESHNESS_TONE_CLASSES[tone])).toBe(true);
      expect(container.firstElementChild?.getAttribute('data-freshness')).toBe(tone);
      unmount();
    }
  });

  it('exposes the exact instant as a title when there is one, and none when there is not', () => {
    const at = '2026-08-20T16:03:53.805Z';
    const { container, unmount } = render(
      <FreshnessChip at={at} relative="3 hours ago" tone="current" />,
    );
    expect(container.querySelector(`.${METRIC_RAIL_CLASSES.figure}`)?.getAttribute('title')).toBe(at);
    unmount();

    const never = render(<FreshnessChip at={null} relative="never verified" tone="unverified" />);
    expect(
      never.container.querySelector(`.${METRIC_RAIL_CLASSES.figure}`)?.hasAttribute('title'),
      'there is no instant to show, so there is no empty tooltip either',
    ).toBe(false);
  });

  it('labels the tile last verified by default', () => {
    const { container } = render(<FreshnessChip relative="never verified" tone="unverified" />);
    expect(container.querySelector(`.${METRIC_RAIL_CLASSES.label}`)?.textContent).toBe(
      'last verified',
    );
  });
});
