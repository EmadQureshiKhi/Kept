/**
 * `/coverage`, rendered — design §10.1, §10.10, R9.1, R9.2, R9.3, R9.6, R9.7,
 * R9.8.
 *
 * R9.8 asks for one public page reporting proven coverage, designed coverage, the
 * freshness timestamp and every promise's verdict. This suite reads that
 * requirement as four assertions against the page rendered from the committed
 * snapshot, and then two more against the state that snapshot happens to be in:
 * degraded, so the proven figure is *replaced* by words rather than shown as a
 * number, and never verified, so the freshness chip says exactly that.
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

    /* Degraded today, so the proven tile is replaced rather than emptied (R2.11). */
    expect(snapshot.degraded).toBe(true);
    expect(container.querySelector('[data-degraded="true"]')).not.toBeNull();
    expect(container.querySelector('[data-metric="proven-coverage"]')).toBeNull();
    expect(text).toContain(DEGRADED_WORDS);
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
    const rows = container.querySelectorAll('.promise-list__item');
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

describe('/coverage — the degraded state says why, in its own words', () => {
  it('quotes every degraded reason verbatim', () => {
    const { container, unmount } = render(<CoveragePage />);
    const text = container.textContent ?? '';
    expect(snapshot.degradedReasons.length).toBeGreaterThan(0);
    for (const reason of snapshot.degradedReasons) {
      expect(text, `${reason} is not on the page`).toContain(reason);
    }
    expect(text).toContain('withheld');
    unmount();
  });

  it('shows no proven percentage anywhere while the proven axis is withheld', () => {
    const { container, unmount } = render(<CoveragePage />);
    expect(snapshot.metrics.provenCoverage).toBeNull();
    /* The only figure on the page is designed coverage; a proven number would have
       to come from a division nobody performed. */
    const figures = [...container.querySelectorAll('.metric-figure')].map(
      (element) => element.getAttribute('aria-label') ?? element.textContent ?? '',
    );
    expect(figures.length).toBeGreaterThan(0);
    expect(figures.filter((figure) => figure.includes('%')).length).toBe(1);
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
    const rendered = [...container.querySelectorAll('.promise-list__item')].map(
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
