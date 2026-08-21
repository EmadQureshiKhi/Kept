/**
 * M2 — the metric count-up (task 17.7, design §10.6.2, §10.6.4, §18.1, R10.4).
 *
 * The count-up is the one orchestration that writes *text*, so the claims worth checking
 * are about characters rather than about pixels:
 *
 *   1. **The final frame is character-identical to the static render.** Not "equal to two
 *      decimal places", not "renders 87 for 0.87": the string in the DOM after the count
 *      is the same string `lib/metricRail.ts` produced on the server, for every ratio
 *      tried, because both go through the same formatter.
 *   2. **No frame is a number a reader would not accept.** Every intermediate value is a
 *      whole figure in range — no `86.4`, no `-0`, no exponent — which is what tabular
 *      numerals then keep from reflowing.
 *   3. **The accessible name never moves.** Read mid-count, `aria-label` is still the
 *      final value: §10.6.2's guard, and the reason an animation is allowed near text at
 *      all.
 *   4. **A figure that has no number does not count.** The degraded chip that replaces the
 *      proven-coverage tile (R2.11) and the `n/a` of a withheld ratio (R9.3) both decline,
 *      structurally — they render no digit run — and the committed snapshot is degraded, so
 *      that is the live path.
 *   5. **Motion off is a state.** The end state is applied synchronously, the digits read
 *      their final value with no frame in between, and no inline declaration is written at
 *      any point, so the resting DOM is the server's bytes.
 *
 * jsdom implements no `matchMedia`, so the preference is shimmed here — a browser API jsdom
 * lacks, in the standing of `_dom.tsx`'s `ResizeObserver`, not a stand-in for anything this
 * repository wrote. Installed in `beforeAll` and removed in `afterAll`, because the ledger
 * project shares one jsdom across its suites (`isolate: false`).
 */

import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { FreshnessChipProps } from '../components/FreshnessChip.js';
import {
  COUNT_UP_SELECTOR,
  countUpDigitRun,
  countUpEnd,
  countUpSpec,
  playMetricCountUp,
} from '../components/MetricCountUp.js';
import { MetricFigure, countUpFor } from '../components/MetricFigure.js';
import { MetricRail } from '../components/MetricRail.js';
import {
  METRIC_RAIL_CLASSES,
  formatMetricFigure,
  metricFigureParts,
  percentDigits,
} from '../lib/metricRail.js';
import {
  REDUCED_MOTION_QUERY,
  durationMs,
  motionEnabled,
  pendingMotion,
  play,
  stopObservingMotionPreference,
  type MotionPlayback,
} from '../lib/motion.js';
import { snapshot } from '../lib/snapshot.js';

import { REPO_ROOT, normaliseCssValue, parseCss } from './_scan.js';

/* ─────────────────── the preference, which jsdom does not have ──────────────── */

let reducedMotion = false;

type MatchMedia = (query: string) => MediaQueryList;

function installPreference(): void {
  (globalThis as unknown as { matchMedia: MatchMedia }).matchMedia = ((media: string) =>
    ({
      media,
      get matches(): boolean {
        return media === REDUCED_MOTION_QUERY && reducedMotion;
      },
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
    }) as unknown as MediaQueryList) as MatchMedia;
}

/** Waits for every in-flight orchestration to land. */
async function quiet(): Promise<void> {
  for (let attempt = 0; attempt < 100 && pendingMotion() > 0; attempt += 1) {
    await new Promise((ready) => {
      setTimeout(ready, 20);
    });
  }
}

beforeAll(installPreference);

afterAll(() => {
  stopObservingMotionPreference();
  delete (globalThis as { matchMedia?: MatchMedia }).matchMedia;
});

beforeEach(() => {
  reducedMotion = false;
});

afterEach(async () => {
  cleanup();
  /* a count-up left ticking would keep the engine awake for every file after this one,
     which the ledger project shares a jsdom with */
  await quiet();
  stopObservingMotionPreference();
  reducedMotion = false;
});

/* ───────────────────────────────── the fixture ──────────────────────────────── */

/** The freshness props the rail needs and this file has no opinion about. */
const FRESHNESS: FreshnessChipProps = {
  relative: 'just now',
  tone: 'current',
  at: '2026-01-01T00:00:00.000Z',
};

/** A rendered figure, and the digit run inside it. */
interface Figure {
  readonly figure: HTMLElement;
  readonly digits: HTMLElement | null;
}

function renderFigure(ratio: number): Figure {
  const { container } = render(<MetricFigure value={{ kind: 'coverage', ratio }} />);
  const figure = container.querySelector<HTMLElement>('[role="img"]');
  if (figure === null) throw new Error('MetricFigure rendered no figure');
  return { figure, digits: countUpDigitRun(figure) };
}

/** Counts a figure to completion at once, rather than waiting `--dur-figure` per case. */
async function countNow(figure: HTMLElement, to: number): Promise<void> {
  let playback: MotionPlayback | null = null;
  const settled = playMetricCountUp(figure, { to, format: percentDigits }, (started) => {
    playback = started;
  });
  (playback as unknown as { complete(): void } | null)?.complete();
  await settled;
}

/* ─────────────── what counts, and what has no number to count to ───────────── */

describe('a figure counts only when it carries a number', () => {
  it('counts a percentage through percentDigits and a count through countDigits', () => {
    const percent = countUpFor({ kind: 'coverage', ratio: 0.87 });
    expect(percent?.to).toBe(87);
    expect(percent?.format(87)).toBe('87');
    expect(percent?.format(5)).toBe('5');

    const count = countUpFor({ kind: 'count', value: 12 });
    expect(count?.to).toBe(12);
    expect(count?.format(12)).toBe('12');
  });

  it('declines a withheld ratio, because n/a is not a number (R9.3)', () => {
    expect(countUpFor({ kind: 'coverage', ratio: null })).toBeNull();
    const { figure, digits } = renderFigure(0);
    /* 0% renders a digit run, and still does not count: 0 → 0 is a figure pretending to
       move, which §10.6.3 refuses along with every other motion that says nothing */
    expect(digits?.textContent).toBe('0');
    expect(countUpFor({ kind: 'coverage', ratio: 0 })).toBeNull();
    expect(countUpFor({ kind: 'count', value: 0 })).toBeNull();
    return playMetricCountUp(figure, { to: 0, format: percentDigits });
  });

  it('finds no digit run in the chip that replaces a degraded tile (R2.11)', () => {
    const { container } = render(
      <MetricRail
        degraded
        freshness={FRESHNESS}
        metrics={{ designedCoverage: 0.5, provenCoverage: null, undesignedCount: 1 }}
      />,
    );
    const chip = container.querySelector<HTMLElement>('[data-degraded="true"]');
    expect(chip, 'the degraded rail rendered no chip').not.toBeNull();
    const chipFigure = chip?.querySelector<HTMLElement>(`.${METRIC_RAIL_CLASSES.figure}`) ?? null;
    expect(chipFigure, 'the chip rendered no figure row').not.toBeNull();
    if (chipFigure === null) return undefined;
    expect(
      countUpDigitRun(chipFigure),
      'the degraded chip carries a digit run, so M2 would count up a figure that is not ' +
        'there — the chip states a withheld figure in words (§10.10)',
    ).toBeNull();

    /* and the orchestration declines it rather than throwing */
    return playMetricCountUp(chipFigure, { to: 42, format: percentDigits });
  });

  it('counts exactly the tiles of the committed rail that carry a figure', async () => {
    /* The real snapshot, whatever state it is in. Today it is `degraded: true` with
       `provenCoverage: null`, so the chip stands where a figure would and two tiles count —
       but the assertion is written against the rail as rendered rather than against that
       state, because which figures the snapshot carries is the snapshot's business and this
       flourish's rule is the same either way: a tile counts if and only if it shows a
       positive number. */
    const { container } = render(
      <MetricRail
        degraded={snapshot.degraded}
        freshness={FRESHNESS}
        metrics={snapshot.metrics}
      />,
    );

    let expected = 0;
    for (const tile of container.querySelectorAll<HTMLElement>('[data-metric]')) {
      const figure = tile.querySelector<HTMLElement>('[role="img"]');
      if (figure === null) continue;
      if (countUpDigitRun(figure) === null) continue;
      /* the accessible name is the final value from first paint, so it is safe to read while
         a count is already in flight */
      const value = Number((figure.getAttribute('aria-label') ?? '').replace('%', ''));
      if (Number.isInteger(value) && value > 0) expected += 1;
    }

    expect(
      pendingMotion(),
      'the rail counted a different number of figures than it renders. A tile counts when ' +
        'it shows a positive number, and never when the degraded chip replaced it (R2.11) ' +
        'or the ratio was withheld (R9.3).',
    ).toBe(expected);
    await quiet();
  });
});

/* ──────────── the final frame is the static render, character for character ─── */

describe('the final frame is character-identical to the static render', () => {
  it('lands on the formatter the server used, for every ratio tried', async () => {
    expect(motionEnabled(), 'the preference shim is not answering').toBe(true);

    for (const ratio of [0.01, 0.07, 0.5, 0.874, 0.999, 1]) {
      const { figure, digits } = renderFigure(ratio);
      const parts = metricFigureParts(ratio);
      expect(parts.kind).toBe('percent');
      if (parts.kind !== 'percent') continue;

      /* the server's own text, before anything animates */
      expect(digits?.textContent).toBe(parts.digits);

      await countNow(figure, Number(parts.digits));
      expect(
        digits?.textContent,
        `the count-up landed on "${digits?.textContent ?? ''}" where the static render ` +
          `wrote "${parts.digits}". §10.6.2 asks for the final frame to be ` +
          `character-identical, which is why both go through the same formatter.`,
      ).toBe(parts.digits);
      /* the digits plus the unit element beside them are the whole figure, which is the
         one string `formatMetricFigure` produces for the badge and the accessible name */
      const unit = figure.querySelector(`.${METRIC_RAIL_CLASSES.unit}`);
      expect(`${digits?.textContent ?? ''}${unit?.textContent ?? ''}`).toBe(
        formatMetricFigure(ratio),
      );
      cleanup();
      await quiet();
    }
  });

  it('declares an end state of the final digits, freshly each time', () => {
    const counting = { to: 87, format: percentDigits };
    expect(countUpEnd(counting)).toEqual({ textContent: '87' });
    /* a fresh record: the engine writes its own bookkeeping into the object it is handed */
    expect(countUpEnd(counting)).not.toBe(countUpEnd(counting));
  });

  it('interpolates over --dur-figure and writes only whole figures', async () => {
    const { figure, digits } = renderFigure(0.88);
    expect(digits, 'no digit run to count').not.toBeNull();
    if (digits === null) return;

    let playback: MotionPlayback | null = null;
    const settled = playMetricCountUp(figure, { to: 88, format: percentDigits }, (started) => {
      playback = started;
    });
    const handle = playback as unknown as {
      seek(time: number): void;
      complete(): void;
      duration: number;
    } | null;
    expect(handle, 'no timeline was built with motion on').not.toBeNull();
    expect(
      handle?.duration,
      'the count-up does not last --dur-figure, which is the one duration §10.6.2 names',
    ).toBe(durationMs('--dur-figure'));

    const seen: string[] = [];
    for (const fraction of [0.05, 0.2, 0.4, 0.6, 0.8, 0.95]) {
      handle?.seek(durationMs('--dur-figure') * fraction);
      seen.push(digits.textContent ?? '');
    }

    for (const frame of seen) {
      expect(frame, `"${frame}" is not a whole figure`).toMatch(/^\d+$/);
      const whole = Number(frame);
      expect(Number.isInteger(whole)).toBe(true);
      expect(whole).toBeGreaterThanOrEqual(0);
      expect(whole).toBeLessThanOrEqual(88);
      /* every frame is formatted by the formatter, so it is a string the static render
         could itself have produced */
      expect(frame).toBe(percentDigits(whole));
    }
    expect(
      new Set(seen).size,
      'every sampled frame read the same figure, so nothing counted',
    ).toBeGreaterThan(1);
    expect(Number(seen[0])).toBeLessThan(Number(seen[seen.length - 1]));

    handle?.complete();
    await settled;
    expect(digits.textContent).toBe('88');
  });
});

/* ─────────── the accessible name is the final value, at every instant ───────── */

describe('a screen reader is never handed an intermediate number', () => {
  it('keeps the final value in aria-label while the digits climb', async () => {
    const { figure, digits } = renderFigure(0.63);
    expect(figure.getAttribute('aria-label')).toBe('63%');

    let playback: MotionPlayback | null = null;
    const settled = playMetricCountUp(figure, { to: 63, format: percentDigits }, (started) => {
      playback = started;
    });
    const handle = playback as unknown as { seek(time: number): void; complete(): void } | null;

    handle?.seek(durationMs('--dur-figure') / 3);
    expect(
      Number(digits?.textContent),
      'the digits did not move, so this proves nothing about the name',
    ).toBeLessThan(63);
    expect(
      figure.getAttribute('aria-label'),
      'the count-up rewrote the accessible name, so a screen reader would be read an ' +
        'intermediate number (§10.6.2)',
    ).toBe('63%');

    handle?.complete();
    await settled;
    expect(figure.getAttribute('aria-label')).toBe('63%');
    expect(digits?.textContent).toBe('63');
  });

  it('completes a count already running rather than stranding it', async () => {
    const { figure, digits } = renderFigure(0.55);
    const first = playMetricCountUp(figure, { to: 55, format: percentDigits });
    expect(pendingMotion(), 'the first count did not start').toBe(1);

    /* the second call is the one the equivalence driver makes: the mount effect has already
       had its turn on this figure, and the comparison wants the count anyway */
    await playMetricCountUp(figure, { to: 55, format: percentDigits });
    await first;
    expect(
      pendingMotion(),
      'a second count left the first one unable to finish, so the gate still believes ' +
        'something is in flight',
    ).toBe(0);
    expect(digits?.textContent).toBe('55');
  });

  it('completes rather than freezing when the rail unmounts mid-count', async () => {
    const { figure, digits } = renderFigure(0.42);
    let playback: MotionPlayback | null = null;
    const settled = playMetricCountUp(figure, { to: 42, format: percentDigits }, (started) => {
      playback = started;
    });
    const handle = playback as unknown as { seek(time: number): void; complete(): void } | null;
    handle?.seek(durationMs('--dur-figure') / 4);
    expect(Number(digits?.textContent)).toBeLessThan(42);

    /* what an unmounting figure does: complete, never cancel (§10.6.4) */
    handle?.complete();
    await settled;
    expect(
      digits?.textContent,
      'a figure abandoned mid-count kept a number that was never true',
    ).toBe('42');
  });
});

/* ─────────────── motion off: the server's bytes, and nothing added ──────────── */

describe('motion off means the digits are already final', () => {
  it('applies the end state synchronously, with no frame in between', async () => {
    reducedMotion = true;
    expect(motionEnabled()).toBe(false);

    const { figure, digits } = renderFigure(0.74);
    expect(digits?.textContent).toBe('74');
    if (digits === null) return;

    const spec = countUpSpec(digits, { to: 74, format: percentDigits });
    const settled = play(digits, spec);
    /* asserted before any await: "the first painted state" is a claim about the absence of
       an interval */
    expect(digits.textContent).toBe('74');
    expect(pendingMotion()).toBe(0);
    await settled;
    expect(digits.textContent).toBe('74');
  });

  it('writes no inline declaration in either state, so there is nothing to release', async () => {
    reducedMotion = true;
    const off = renderFigure(0.91);
    expect(off.figure.getAttribute('style')).toBeNull();
    expect(off.digits?.getAttribute('style')).toBeNull();
    cleanup();

    reducedMotion = false;
    const on = renderFigure(0.91);
    await countNow(on.figure, 91);
    expect(
      on.digits?.getAttribute('style'),
      'the count-up wrote an inline style, so a figure that animated is not the same ' +
        'bytes as one that did not (§18.1)',
    ).toBeNull();
    expect(on.figure.getAttribute('style')).toBeNull();
    expect(on.digits?.textContent).toBe('91');
  });

  it('declines to count on mount under reduced motion', () => {
    reducedMotion = true;
    render(
      <MetricRail
        degraded={false}
        freshness={FRESHNESS}
        metrics={{ designedCoverage: 0.5, provenCoverage: 0.25, undesignedCount: 3 }}
      />,
    );
    expect(
      pendingMotion(),
      'a count-up started under prefers-reduced-motion: reduce; the digits are already ' +
        'final, so there is nothing for it to do (§10.6.4)',
    ).toBe(0);
  });

  it('counts on mount with motion on, and only the tiles that have a figure', async () => {
    reducedMotion = false;
    render(
      <MetricRail
        degraded
        freshness={FRESHNESS}
        metrics={{ designedCoverage: 0.5, provenCoverage: null, undesignedCount: 3 }}
      />,
    );
    /* designed coverage and suite debt count; the degraded chip has no figure and the
       freshness chip is prose */
    expect(pendingMotion()).toBe(2);
    await quiet();
    expect(pendingMotion()).toBe(0);
  });
});

/* ────────── tabular numerals: the typography that keeps the count still ─────── */

describe('the digit run is tabular, so counting does not reflow it', () => {
  const METRIC_CSS = 'apps/ledger/styles/metric-rail.css';

  it('declares tabular numerals on the run the count-up rewrites', () => {
    const text = readFileSync(resolve(REPO_ROOT, METRIC_CSS), 'utf8');
    expect(text.trim(), `${METRIC_CSS} is empty, so this rule reads nothing`).not.toBe('');
    const rules = parseCss(text).filter((rule) => rule.prelude === COUNT_UP_SELECTOR);
    expect(rules.length, `${METRIC_CSS} declares no ${COUNT_UP_SELECTOR} rule`).toBe(1);
    const numerals = rules[0]?.declarations.find(
      (declaration) => declaration.property === 'font-variant-numeric',
    );
    expect(
      normaliseCssValue(numerals?.value ?? ''),
      `The count-up rewrites ${COUNT_UP_SELECTOR} on every frame; with proportional ` +
        `digits the row would jitter as the figure climbs (§10.7, §10.6.2).`,
    ).toContain('tabular-nums');
  });
});
