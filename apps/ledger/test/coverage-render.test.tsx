/**
 * `/coverage`, rendered — design §10.1, §10.10, R9.1, R9.2, R9.3, R9.6, R9.7,
 * R9.8.
 *
 * R9.8 asks for one public page reporting proven coverage, designed coverage, the
 * freshness timestamp and every promise's verdict. This suite reads that
 * requirement as four assertions against the page rendered from the committed
 * snapshot, and then two more about degradation. Which side of that split the file
 * happens to be on moves with Kane, so the clauses branch on `snapshot.degraded`
 * rather than pinning a state: today it is clean, so the proven figure is a number
 * and the freshness chip reports an age, and the withheld arm asserts that the
 * figure is replaced by words and the ribbon is withheld with it whenever that
 * arm is the one on disk.
 *
 * jsdom applies none of the stylesheet, which makes these assertions the right
 * shape: what they see is what a reader sees with colour taken away. Every verdict
 * therefore has to arrive as a word, which is R10.5 and the presentation clause of
 * Property 22 read through this page.
 *
 * The page's freshness is measured against the snapshot's own `generatedAt` rather
 * than the clock, so this render is deterministic — the same committed input
 * produces the same page on every machine, which is what lets a screenshot and a
 * test agree about what the page says.
 */

import { cleanup, render } from '@testing-library/react';
import type { SnapshotPromise } from '@kept/core';
import { SnapshotPromiseSchema } from '@kept/core';
import { afterEach, describe, expect, it } from 'vitest';

import { NO_DESIGNED_TEST, PromiseRow } from '../app/coverage/PromiseRow.js';
import CoveragePage from '../app/coverage/page.js';
import { DEGRADED_WORDS } from '../components/DegradedChip.js';
import { formatMetricFigure } from '../lib/metricRail.js';
import { NEVER_VERIFIED } from '../lib/relativeTime.js';
import { snapshot } from '../lib/snapshot.js';

afterEach(cleanup);

function makePromise(overrides: Partial<SnapshotPromise>): SnapshotPromise {
  return SnapshotPromiseSchema.parse({
    id: 'p_177308118beb',
    claim: 'The Settings screen keeps the selected currency after a full page reload.',
    citation: {
      file: 'apps/fixture/README.md',
      line: 19,
      text: '- The Settings screen keeps the selected currency after a full page reload.',
    },
    designedTest: { path: 'tests/settings_currency_test.md', testId: 'T-6' },
    verdict: 'stale',
    verdictSource: null,
    repair: null,
    evidencePackId: null,
    providers: ['baseline'],
    credits: null,
    ...overrides,
  });
}

describe('/coverage — the four things R9.8 asks for are on the page', () => {
  it('reports both coverage figures, from the snapshot and never recomputed', () => {
    const { container, unmount } = render(<CoveragePage />);
    const text = container.textContent ?? '';

    const designed = container.querySelector('[data-metric="designed-coverage"]');
    expect(designed, 'no designed coverage tile').not.toBeNull();
    expect(designed?.textContent).toContain(formatMetricFigure(snapshot.metrics.designedCoverage));

    /* Which state the committed file is in moves with Kane, so the invariant is
       asserted rather than the state: degraded replaces the proven tile with words
       (R2.11), clean renders it as the figure in the file, and nothing renders a
       zero for a run that proved nothing. */
    if (snapshot.degraded) {
      expect(container.querySelector('[data-degraded="true"]')).not.toBeNull();
      expect(container.querySelector('[data-metric="proven-coverage"]')).toBeNull();
      expect(text).toContain(DEGRADED_WORDS);
      expect(snapshot.metrics.provenCoverage).toBeNull();
    } else {
      const proven = container.querySelector('[data-metric="proven-coverage"]');
      expect(proven, 'no proven coverage tile on a clean snapshot').not.toBeNull();
      expect(proven?.textContent).toContain(formatMetricFigure(snapshot.metrics.provenCoverage));
      expect(container.querySelector('[data-degraded="true"]')).toBeNull();
      expect(text).not.toContain(DEGRADED_WORDS);
    }
    unmount();
  });

  it('reports the freshness of the newest consumed terminal event', () => {
    const { container, unmount } = render(<CoveragePage />);
    const chip = container.querySelector('[data-freshness]');
    expect(chip, 'no freshness chip').not.toBeNull();
    // The committed snapshot has consumed one: the whole-suite replay of 15.3. So
    // the chip carries an age rather than the never-verified copy, and it must not
    // fall back to that copy while a real instant is present.
    expect(snapshot.freshness.terminalEventAt).not.toBeNull();
    expect(chip?.getAttribute('data-freshness')).not.toBe('unverified');
    expect(chip?.textContent).not.toContain(NEVER_VERIFIED);
    expect(['current', 'stale']).toContain(chip?.getAttribute('data-freshness'));
    unmount();
  });

  it('lists every promise with its verdict as a word, not only as a colour', () => {
    const { container, unmount } = render(<CoveragePage />);
    /* Scoped by `data-promise` rather than by the row class. The dual-axis ribbon
       lays its use-case rows out on the same `.promise-list__item` grid, one list, on
       one sheet, rather than a second visual language, and a use case is not a
       promise. Keying on the attribute is what keeps the page from ever letting one
       be counted as the other. */
    const rows = container.querySelectorAll('[data-promise]');
    expect(rows.length).toBe(snapshot.promises.length);
    expect(rows.length).toBe(snapshot.metrics.totalPromises);

    for (const promise of snapshot.promises) {
      const row = container.querySelector(`[data-promise="${promise.id}"]`);
      expect(row, `${promise.id} is not on the page`).not.toBeNull();
      expect(row?.textContent).toContain(promise.claim);
      expect(row?.textContent).toContain(promise.verdict);
      expect(row?.textContent).toContain(`${promise.citation.file}:${promise.citation.line}`);
    }
    unmount();
  });

  it('states the counts behind the figures, and the instant they were measured at', () => {
    const { container, unmount } = render(<CoveragePage />);
    const text = container.textContent ?? '';
    expect(text).toContain(
      `${snapshot.metrics.provenCount} of ${snapshot.metrics.totalPromises} promises proven`,
    );
    expect(text).toContain(`${snapshot.metrics.designedCount} designed`);
    expect(text).toContain(snapshot.generatedAt);
    unmount();
  });
});

describe('/coverage, degradation says why, in its own words', () => {
  it('quotes every degraded reason verbatim, and withholds rather than zeroing', () => {
    const { container, unmount } = render(<CoveragePage />);
    const text = container.textContent ?? '';

    if (snapshot.degraded) {
      expect(snapshot.degradedReasons.length).toBeGreaterThan(0);
      for (const reason of snapshot.degradedReasons) {
        expect(text, `${reason} is not on the page`).toContain(reason);
      }
      expect(text).toContain('withheld');
      // And the ribbon is withheld with it: never a zero, never an empty row list.
      expect(snapshot.coverageAxes ?? null).toBeNull();
      expect(container.querySelector('[data-coverage-axes="withheld"]')).not.toBeNull();
      expect(container.querySelectorAll('[data-usecase]')).toHaveLength(0);
    } else {
      expect(snapshot.degradedReasons).toEqual([]);
      expect(container.querySelector('[data-coverage-axes="withheld"]')).toBeNull();
    }
    unmount();
  });

  it('renders exactly as many rail percentages as the snapshot has coverage figures', () => {
    const { container, unmount } = render(<CoveragePage />);
    /* The rail is the only place a `%` sits inside `.metric-figure`; the ribbon's own
       percentages are in their own runs and never borrow the rail's class, which is
       half of how the two proven figures stay apart (R9.15). */
    const figures = [...container.querySelectorAll('.metric-figure')].map(
      (element) => element.getAttribute('aria-label') ?? element.textContent ?? '',
    );
    expect(figures.length).toBeGreaterThan(0);
    const expected = snapshot.metrics.provenCoverage === null ? 1 : 2;
    expect(figures.filter((figure) => figure.includes('%')).length).toBe(expected);
    unmount();
  });
});

describe('/coverage — a promise row is prose, an identifier and a word', () => {
  it('renders the claim, the citation and the designed test id', () => {
    const promise = makePromise({});
    const { container, unmount } = render(
      <ul>
        <PromiseRow promise={promise} />
      </ul>,
    );
    const text = container.textContent ?? '';
    expect(text).toContain(promise.claim);
    expect(text).toContain('apps/fixture/README.md:19');
    expect(text).toContain('tests/settings_currency_test.md T-6');
    expect(container.querySelector('.verdict-tag__word')?.textContent).toBe('stale');
    unmount();
  });

  it('says a promise has no designed test rather than leaving a blank', () => {
    const { container, unmount } = render(
      <ul>
        <PromiseRow promise={makePromise({ designedTest: null, verdict: 'undesigned' })} />
      </ul>,
    );
    expect(container.textContent).toContain(NO_DESIGNED_TEST);
    expect(container.querySelector('.verdict-tag__word')?.textContent).toBe('undesigned');
    unmount();
  });

  it('carries the verdict as data as well as text, for the column of tags', () => {
    const { container, unmount } = render(
      <ul>
        <PromiseRow promise={makePromise({ verdict: 'red' })} />
      </ul>,
    );
    const item = container.querySelector('.promise-list__item');
    expect(item?.getAttribute('data-verdict')).toBe('red');
    expect(item?.textContent).toContain('red');
    unmount();
  });
});

describe('/coverage — attention sorts to the top', () => {
  it('orders promises by verdict rank then id, the order the graph uses', () => {
    const { container, unmount } = render(<CoveragePage />);
    const ranks = ['red', 'stale', 'undesigned', 'proven'];
    const rendered = [...container.querySelectorAll('[data-promise]')].map(
      (element) => element.getAttribute('data-verdict') ?? '',
    );
    const positions = rendered.map((verdict) => ranks.indexOf(verdict));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((left, right) => left - right)).toEqual(positions);
    unmount();
  });

  it('takes no request and no props, so it stays a static render', () => {
    expect(CoveragePage.length).toBe(0);
  });
});
