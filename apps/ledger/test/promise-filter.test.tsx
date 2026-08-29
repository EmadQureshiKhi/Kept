/**
 * The verdict filter on `/coverage`, asserted over the committed snapshot and over
 * constructed promises. Design §10.1, §10.7, R9.8, R8.4, R10.2.
 *
 * Three properties are worth more than the rest and are why this file exists.
 *
 * **1. The page still offers no control.** `coverage-ribbon.test.tsx` requires `/coverage`
 * to render no `button`, no `form` and no `input`, as a DOM-level proof that nothing on it
 * can spend a credit. The filter was first built from buttons and that test rejected it,
 * correctly. The chips are links now, so the invariant is restated here against the filter
 * specifically: a future refactor that reaches for a `<button>` because it is the obvious
 * element fails in two places rather than one.
 *
 * **2. A chip never leads nowhere.** Offering `undesigned 0` and showing an empty list
 * teaches a reader the filter is broken. Verdicts with no promises get no chip, and the
 * counts come from the data, so a chip cannot disagree with the list beneath it.
 *
 * **3. The unfiltered view is what renders without JavaScript.** The prerendered HTML
 * cannot know the query string, so first paint lists every promise and the filter narrows
 * on mount. That is the graceful degradation as well as the hydration contract, and it is
 * asserted rather than assumed.
 *
 * **4. Clicking a chip does not navigate.** This is the one the first version got wrong.
 * The chips were unhandled `<a href>`s, so following one was a full document load: the
 * browser threw away the scroll position and dropped the reader at the top of the page,
 * above the title, the metric rail and the whole coverage ribbon. The click is handled now
 * and writes the URL with `history.pushState`, so the last group in this file asserts the
 * three things that has to keep being true: the default action is prevented, the address bar
 * still ends up on the URL the `href` spelled, and a modified click is left alone.
 *
 * jsdom does no navigation, so a filtered view is set up the way the component reads it:
 * `history.replaceState` before render, which is exactly what a real load from
 * `/coverage?verdict=stale` presents.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { SnapshotPromise, Verdict } from 'kept-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALL_LABEL,
  COVERAGE_PATH,
  FILTER_GROUP_LABEL,
  PromiseFilter,
  VERDICT_PARAM,
  chipHref,
  filterStatus,
  isPlainClick,
  selectedVerdict,
} from '../app/coverage/PromiseFilter.js';
import { VERDICT_RANK } from '../components/VerdictTag.js';
import { snapshot } from '../lib/snapshot.js';

import { installBrowserShims } from './_dom.js';

installBrowserShims();

afterEach(cleanup);

/** The committed promises, which is what the page actually renders. */
const PROMISES: readonly SnapshotPromise[] = snapshot.promises;

/** Put the browser on a URL, the way a real load of that URL would. */
function visit(search: string): void {
  window.history.replaceState(null, '', `${COVERAGE_PATH}${search}`);
}

beforeEach(() => visit(''));

/** Every chip in the rendered tree, in document order. */
function chips(container: HTMLElement): readonly HTMLAnchorElement[] {
  return [...container.querySelectorAll<HTMLAnchorElement>('.promise-filter__chip')];
}

/** The promise rows currently listed. */
function rows(container: HTMLElement): readonly HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-promise]')];
}

/* ─────────────────────── the pure functions, first ─────────────────────── */

describe('the filter reads a query string without trusting it', () => {
  it('accepts every verdict the vocabulary declares', () => {
    for (const verdict of VERDICT_RANK) {
      expect(selectedVerdict(verdict)).toBe(verdict);
    }
  });

  it('answers null for anything else, rather than filtering to nothing', () => {
    /* `?verdict=banana` is a URL somebody typed. An empty list would read as "this
       repository states no promises", which is a different and false statement. */
    for (const raw of [null, '', 'banana', 'PROVEN', 'red ', 'undefined']) {
      expect(selectedVerdict(raw)).toBeNull();
    }
  });

  it('spells a href per chip, and clears the query rather than naming a value', () => {
    expect(chipHref(null)).toBe(COVERAGE_PATH);
    for (const verdict of VERDICT_RANK) {
      expect(chipHref(verdict)).toBe(`${COVERAGE_PATH}?${VERDICT_PARAM}=${verdict}`);
    }
  });

  it('says what it did, naming the verdict when there is one', () => {
    expect(filterStatus(13, 13, null)).toBe('Showing all 13 promises.');
    expect(filterStatus(4, 13, 'stale')).toBe(
      'Showing 4 of 13 promises, filtered to stale.',
    );
  });
});

/* ─────────────── the chip row over the committed snapshot ─────────────── */

describe('the chip row offers one chip per verdict that has rows', () => {
  it('counts every chip off the data, and never offers an empty one', () => {
    const { container, unmount } = render(<PromiseFilter promises={PROMISES} />);
    try {
      const present = new Map<Verdict, number>();
      for (const promise of PROMISES) {
        present.set(promise.verdict, (present.get(promise.verdict) ?? 0) + 1);
      }
      /* `all` plus one per verdict actually present. The committed file has three of the
         four, so this is non-vacuous: a fourth chip would mean an empty one was offered. */
      expect(chips(container)).toHaveLength(present.size + 1);

      const text = container.querySelector('.promise-filter')?.textContent ?? '';
      expect(text).toContain(ALL_LABEL);
      expect(text).toContain(String(PROMISES.length));
      for (const [verdict, count] of present) {
        expect(text, `no chip names ${verdict}`).toContain(verdict);
        expect(text, `no chip counts ${String(count)} for ${verdict}`).toContain(
          String(count),
        );
      }
      for (const verdict of VERDICT_RANK) {
        if (present.has(verdict)) continue;
        expect(
          text,
          `${verdict} has no promises and is still offered, so the chip leads nowhere`,
        ).not.toContain(verdict);
      }
    } finally {
      unmount();
    }
  });

  it('orders them red first, which is how the list itself is ordered', () => {
    const { container, unmount } = render(<PromiseFilter promises={PROMISES} />);
    try {
      const offered = chips(container)
        .slice(1)
        .map((chip) => new URL(chip.href, 'http://x').searchParams.get(VERDICT_PARAM));
      const expected = VERDICT_RANK.filter((verdict) =>
        PROMISES.some((promise) => promise.verdict === verdict),
      );
      expect(offered).toEqual([...expected]);
    } finally {
      unmount();
    }
  });

  it('names the group, so the chips are not five unexplained links', () => {
    const { container, unmount } = render(<PromiseFilter promises={PROMISES} />);
    try {
      const group = container.querySelector('.promise-filter');
      expect(group?.getAttribute('role')).toBe('group');
      expect(group?.getAttribute('aria-label')).toBe(FILTER_GROUP_LABEL);
    } finally {
      unmount();
    }
  });
});

/* ────────────── no control, restated against the filter ────────────── */

describe('the filter adds no control to a page that has none', () => {
  it('renders links, and no button, form or input', () => {
    const { container, unmount } = render(<PromiseFilter promises={PROMISES} />);
    try {
      for (const chip of chips(container)) {
        expect(chip.tagName, 'a chip is not an anchor, so it is a control').toBe('A');
        expect(chip.getAttribute('href')).toBeTruthy();
      }
      /* The same three assertions `coverage-ribbon.test.tsx` makes over the whole page,
         made here over the filter, so reaching for a `<button>` fails twice. */
      expect(container.querySelectorAll('button')).toHaveLength(0);
      expect(container.querySelectorAll('form')).toHaveLength(0);
      expect(container.querySelectorAll('input')).toHaveLength(0);
    } finally {
      unmount();
    }
  });

  it('states the active chip with aria-current rather than colour alone', () => {
    visit(`?${VERDICT_PARAM}=stale`);
    const { container, unmount } = render(<PromiseFilter promises={PROMISES} />);
    try {
      const current = chips(container).filter(
        (chip) => chip.getAttribute('aria-current') === 'true',
      );
      expect(current, 'exactly one chip is current').toHaveLength(1);
      expect(new URL(current[0]?.href ?? '', 'http://x').searchParams.get(VERDICT_PARAM)).toBe(
        'stale',
      );
    } finally {
      unmount();
    }
  });
});

/* ─────────────────────── what the filter shows ─────────────────────── */

describe('the list narrows to the verdict the URL names', () => {
  it('lists every promise when no verdict is named', () => {
    const { container, unmount } = render(<PromiseFilter promises={PROMISES} />);
    try {
      expect(rows(container)).toHaveLength(PROMISES.length);
      expect(container.querySelector('.promise-filter__status')?.textContent).toBe(
        filterStatus(PROMISES.length, PROMISES.length, null),
      );
    } finally {
      unmount();
    }
  });

  it('lists only the matching promises, and says how many', () => {
    for (const verdict of ['red', 'stale', 'proven'] as const) {
      visit(`?${VERDICT_PARAM}=${verdict}`);
      const expected = PROMISES.filter((promise) => promise.verdict === verdict);
      expect(expected.length, `no ${verdict} promises to filter to`).toBeGreaterThan(0);
      const { container, unmount } = render(<PromiseFilter promises={PROMISES} />);
      try {
        const listed = rows(container);
        expect(listed).toHaveLength(expected.length);
        for (const row of listed) {
          expect(row.getAttribute('data-verdict')).toBe(verdict);
        }
        expect(container.querySelector('.promise-filter__status')?.textContent).toBe(
          filterStatus(expected.length, PROMISES.length, verdict),
        );
      } finally {
        unmount();
      }
    }
  });

  it('falls back to every promise on a query it does not recognise', () => {
    visit(`?${VERDICT_PARAM}=banana`);
    const { container, unmount } = render(<PromiseFilter promises={PROMISES} />);
    try {
      expect(rows(container)).toHaveLength(PROMISES.length);
    } finally {
      unmount();
    }
  });

  it('announces the change politely, so a keyboard reader is told', () => {
    const { container, unmount } = render(<PromiseFilter promises={PROMISES} />);
    try {
      const status = container.querySelector('.promise-filter__status');
      expect(status?.getAttribute('role')).toBe('status');
      expect(status?.getAttribute('aria-live')).toBe('polite');
    } finally {
      unmount();
    }
  });
});

/* ─────────── the empty and single-verdict shapes, constructed ─────────── */

describe('shapes the committed snapshot does not have', () => {
  /** One promise carrying whatever verdict is asked for. */
  const promiseWith = (verdict: Verdict, index: number): SnapshotPromise => ({
    ...(PROMISES[0] as SnapshotPromise),
    id: `p_${String(index).padStart(12, '0')}`,
    verdict,
  });

  it('offers one chip beside `all` when every promise agrees', () => {
    const uniform = [0, 1, 2].map((index) => promiseWith('proven', index));
    const { container, unmount } = render(<PromiseFilter promises={uniform} />);
    try {
      expect(chips(container)).toHaveLength(2);
      expect(container.querySelector('.promise-filter')?.textContent).toContain('proven');
    } finally {
      unmount();
    }
  });

  it('offers `all` alone for an empty list, and lists nothing', () => {
    const { container, unmount } = render(<PromiseFilter promises={[]} />);
    try {
      expect(chips(container)).toHaveLength(1);
      expect(rows(container)).toHaveLength(0);
      expect(container.querySelector('.promise-filter__status')?.textContent).toBe(
        filterStatus(0, 0, null),
      );
    } finally {
      unmount();
    }
  });

  it('offers a chip for `undesigned` when a promise actually has it', () => {
    /* The committed file has none, which is why the absent-chip clause above is not
       vacuous. Given one, the chip appears, so that clause is about the data and not
       about `undesigned` being special-cased out. */
    const mixed = [promiseWith('undesigned', 0), promiseWith('proven', 1)];
    const { container, unmount } = render(<PromiseFilter promises={mixed} />);
    try {
      expect(chips(container)).toHaveLength(3);
      expect(container.querySelector('.promise-filter')?.textContent).toContain('undesigned');
    } finally {
      unmount();
    }
  });
});

/* ────────── clicking a chip filters in place and never navigates ────────── */

/**
 * The defect these were written for, stated plainly so nobody reintroduces it.
 *
 * The chips shipped as unhandled `<a href="/coverage?verdict=stale">`. Following one is a
 * document navigation, which is fine for the URL and wrong for the reader: the browser
 * discards the scroll offset and lands them at the top of the page. The chip row sits below
 * the title, the metric rail, the measured line and the whole dual-axis ribbon, so a click
 * threw away exactly the position the reader had scrolled to in order to reach the chips.
 *
 * The fix is not `useState` instead of a link. It is a link whose plain click is handled:
 * `preventDefault`, then `pushState` to the string the `href` already carries, then set
 * state. So the URL stays shareable, back and forward still work, a modified click still
 * belongs to the browser, and the page does not move.
 */
describe('a chip filters in place', () => {
  /** Click a chip the way a mouse does, so React's handler runs. */
  function click(chip: HTMLAnchorElement, init: Partial<MouseEventInit> = {}): boolean {
    let defaultPrevented = false;
    act(() => {
      defaultPrevented = !fireEvent.click(chip, { button: 0, ...init });
    });
    return defaultPrevented;
  }

  function chipFor(container: HTMLElement, verdict: Verdict | null): HTMLAnchorElement {
    const wanted = chipHref(verdict);
    const found = chips(container).find((chip) => chip.getAttribute('href') === wanted);
    expect(found, `no chip links to ${wanted}`).toBeDefined();
    return found as HTMLAnchorElement;
  }

  it('only takes over a plain primary click', () => {
    const plain = {
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
    };
    expect(isPlainClick(plain)).toBe(true);
    /* Each of these is a request for the browser's own behaviour: a new tab, a new
       window, a download, or a middle-click tab. Hijacking any of them breaks a
       contract the reader has with their browser rather than with this page. */
    expect(isPlainClick({ ...plain, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, altKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, button: 1 })).toBe(false);
    expect(isPlainClick({ ...plain, defaultPrevented: true })).toBe(false);
  });

  it('prevents the navigation, writes the URL, and narrows the list', () => {
    const { container, unmount } = render(<PromiseFilter promises={PROMISES} />);
    try {
      expect(rows(container)).toHaveLength(PROMISES.length);

      const stale = PROMISES.filter((promise) => promise.verdict === 'stale');
      expect(stale.length, 'no stale promises to filter to').toBeGreaterThan(0);

      const prevented = click(chipFor(container, 'stale'));
      expect(prevented, 'the click was allowed to navigate, so the page will scroll').toBe(true);

      /* The address bar agrees with the chip, which is what keeps the view shareable. */
      expect(window.location.pathname + window.location.search).toBe(chipHref('stale'));
      expect(rows(container)).toHaveLength(stale.length);
      expect(container.querySelector('.promise-filter__status')?.textContent).toBe(
        filterStatus(stale.length, PROMISES.length, 'stale'),
      );
      expect(chipFor(container, 'stale').getAttribute('aria-current')).toBe('true');
    } finally {
      unmount();
    }
  });

  it('clears back to every promise on the `all` chip', () => {
    visit(`?${VERDICT_PARAM}=red`);
    const { container, unmount } = render(<PromiseFilter promises={PROMISES} />);
    try {
      expect(rows(container).length).toBeLessThan(PROMISES.length);
      expect(click(chipFor(container, null))).toBe(true);
      /* `all` clears the query rather than spelling a value for it, so the canonical URL
         for the unfiltered page is the one a reader gets by not filtering. */
      expect(window.location.pathname + window.location.search).toBe(COVERAGE_PATH);
      expect(rows(container)).toHaveLength(PROMISES.length);
    } finally {
      unmount();
    }
  });

  it('adds a history entry, so back and forward walk the filter', () => {
    const { container, unmount } = render(<PromiseFilter promises={PROMISES} />);
    try {
      click(chipFor(container, 'stale'));
      expect(window.location.search).toBe(`?${VERDICT_PARAM}=stale`);

      /* jsdom does not run `popstate` for `history.back()`, so the event is dispatched
         directly after restoring the URL. What is under test is that the component
         re-reads the URL on `popstate` rather than holding state the address bar has
         moved away from. */
      act(() => {
        window.history.replaceState(null, '', COVERAGE_PATH);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      expect(rows(container)).toHaveLength(PROMISES.length);
      expect(chipFor(container, null).getAttribute('aria-current')).toBe('true');
    } finally {
      unmount();
    }
  });

  it('leaves a cmd-click to the browser, so a chip is still a real link', () => {
    const { container, unmount } = render(<PromiseFilter promises={PROMISES} />);
    try {
      const prevented = click(chipFor(container, 'stale'), { metaKey: true });
      expect(prevented, 'a cmd-click was hijacked, so it cannot open a tab').toBe(false);
      /* Nothing was written and nothing was filtered: the browser owns this click. */
      expect(window.location.search).toBe('');
      expect(rows(container)).toHaveLength(PROMISES.length);
    } finally {
      unmount();
    }
  });
});
