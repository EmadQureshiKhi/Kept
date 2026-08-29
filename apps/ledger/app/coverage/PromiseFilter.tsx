/**
 * The verdict filter over the promise list, design §10.1, §10.7, R9.8, R8.4.
 *
 * Thirteen promises is a short list and still too long to find the interesting ones in:
 * the four `stale` rows are the debt this page exists to publish, and they sit scattered
 * among the eight that passed. One click narrows the list to them, and the narrowed view
 * has its own URL.
 *
 * ## The chips are links, and that was not the first design
 *
 * This began as a row of `<button>` elements holding `useState`, which is the obvious way
 * to build a filter and the wrong way to build one here. `coverage-ribbon.test.tsx` asserts
 * that `/coverage` renders **no `button`, no `form` and no `input` at all**, as a DOM-level
 * proof that the page offers no way to spend a credit (§9, R8.4). A filter chip spends
 * nothing, but the invariant is deliberately structural rather than case-by-case: "there is
 * no control on this page" is checkable, and "every control here is harmless" is an argument
 * that needs re-making every time somebody adds one.
 *
 * Putting the state in the URL instead turned out strictly better than the version the test
 * rejected:
 *
 *   - **Shareable.** `/coverage?verdict=stale` opens on the four owed claims, which is the
 *     link worth handing someone rather than "open the page and then click".
 *   - **Still static.** A query string addresses no new route. The page stays
 *     `force-static` and the whole list ships in the first HTML.
 *   - **Accessible without being made so.** A link is focusable, announced and
 *     middle-clickable because it is a link. `aria-current` states which one is active.
 *
 * ## Plain anchors rather than `next/link`, and `pushState` rather than a navigation
 *
 * `next/link` is not used, for a reason worth writing down: this project resolves modules as
 * `NodeNext`, Next ships no `exports` map, and `next/link` does not resolve for the type
 * checker under that combination. The options were to loosen module resolution for the whole
 * repository or to use the platform. The platform wins.
 *
 * **But an unhandled `<a href>` was the wrong half of the platform to use, and it showed.**
 * Following one is a full document navigation, so the browser discarded the scroll position
 * and dropped the reader at the top of the page. On this page the chips sit *below* the
 * title, the metric rail and the coverage ribbon, so every click threw away the very thing
 * the reader had scrolled to. A filter that moves the page is not a filter, it is a reload.
 *
 * So the click is handled: `history.pushState` writes the same URL the `href` spells, and
 * the component sets its own state. Nothing navigates, nothing scrolls, and the address bar
 * still ends up on `/coverage?verdict=stale`. Three properties come out of doing it this way
 * rather than with `useState` alone:
 *
 *   - **The `href` is real.** `event.preventDefault()` only runs for a plain left click, so
 *     cmd-click still opens a tab, right-click still offers "copy link address", and a
 *     reader with JavaScript off still gets a working link to a page that lists everything.
 *   - **Back and forward work.** `pushState` adds a history entry and the `popstate`
 *     listener below reads the URL again, so the browser's own buttons walk the filter.
 *   - **The URL stays the single source of truth.** State is set from the same value the
 *     `href` carries, so a chip and the address bar cannot disagree.
 *
 * The prerendered HTML cannot know the query string, so it renders the whole list and the
 * filter narrows it on mount. That is the graceful degradation: with no JavaScript the
 * reader keeps every promise on the page, because the filter is an accelerator over data
 * that is already there and never the only way to see it.
 *
 * ## The chips reuse `VerdictTag` rather than restating it
 *
 * Each chip *contains* a `VerdictTag`, so the rule that a verdict always carries a word, and
 * that the hue lives on the word rather than behind it, is kept exactly once (§10.4.3,
 * R10.2). This file authors no colour: strip its own rules and the chips still read `red`,
 * `stale`, `proven` in the right hues. The order is `VERDICT_RANK`, red first, which is how
 * the list is sorted and how §10.3 ranks attention.
 *
 * ## Only verdicts that are present get a chip
 *
 * A chip reading `undesigned 0` invites a reader to click it and find nothing, which teaches
 * them the filter is broken. Absent verdicts get no chip, so every chip leads somewhere, and
 * the counts are derived from the data so a chip cannot disagree with the list under it.
 */

'use client';

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';

import type { SnapshotPromise, Verdict } from 'kept-core';

import { VERDICT_RANK, VerdictTag } from '../../components/VerdictTag.js';
import { isPlainClick } from '../../lib/plainClick.js';

import { PromiseRow } from './PromiseRow.js';

import '../../styles/coverage.css';

/** The query key the filter reads. */
export const VERDICT_PARAM = 'verdict';

/** The path the chips link to, so the query string is the only thing that varies. */
export const COVERAGE_PATH = '/coverage';

/** The word on the chip that clears the filter. */
export const ALL_LABEL = 'all';

/** The accessible name of the chip row, since the chips are links rather than a form. */
export const FILTER_GROUP_LABEL = 'Filter promises by verdict';

/**
 * The verdict a raw query value selects, or null for all.
 *
 * An unrecognised value is null rather than an error: `?verdict=banana` is a URL somebody
 * typed, and the honest response is the unfiltered page rather than an empty list that reads
 * as "this repository states no promises".
 */
export function selectedVerdict(raw: string | null): Verdict | null {
  return raw !== null && (VERDICT_RANK as readonly string[]).includes(raw)
    ? (raw as Verdict)
    : null;
}

/**
 * What the live region says. A function so the sentence has one author and a test can assert
 * it rather than reassembling it.
 */
export function filterStatus(shown: number, total: number, verdict: Verdict | null): string {
  if (verdict === null) return `Showing all ${String(total)} promises.`;
  return `Showing ${String(shown)} of ${String(total)} promises, filtered to ${verdict}.`;
}

/** The href for one chip. `all` clears the query rather than spelling a value for it. */
export function chipHref(verdict: Verdict | null): string {
  return verdict === null ? COVERAGE_PATH : `${COVERAGE_PATH}?${VERDICT_PARAM}=${verdict}`;
}

/**
 * Which clicks this component may take over, re-exported from `lib/plainClick.ts`.
 *
 * The rule is shared with the evidence lightbox in the promise panel, which hands a reader
 * the same kind of real link and handles the same narrow case of clicking it, so it is
 * declared once in `lib/` and named here for the tests and for anybody reading this file
 * top to bottom.
 */
export { isPlainClick } from '../../lib/plainClick.js';

export interface PromiseFilterProps {
  readonly promises: readonly SnapshotPromise[];
}

export function PromiseFilter({ promises }: PromiseFilterProps) {
  /**
   * Null on the server and on first paint, which is what keeps hydration honest: the
   * prerendered HTML has no query string to read, so it renders every promise, and the
   * client agrees with it until the effect below runs.
   */
  const [selected, setSelected] = useState<Verdict | null>(null);

  useEffect(() => {
    const readUrl = (): void => {
      setSelected(selectedVerdict(new URLSearchParams(window.location.search).get(VERDICT_PARAM)));
    };
    readUrl();
    /* Back and forward are the browser's filter controls once the chips push history
       entries, so the URL is re-read rather than assumed to still match the state. */
    window.addEventListener('popstate', readUrl);
    return () => {
      window.removeEventListener('popstate', readUrl);
    };
  }, []);

  /**
   * Take over a plain left click, and leave every other click to the browser.
   *
   * `pushState` writes exactly the string the `href` carries, so the address bar and the
   * chip cannot disagree, and the scroll position is untouched because nothing navigated.
   */
  const choose = useCallback(
    (verdict: Verdict | null) => (event: MouseEvent<HTMLAnchorElement>) => {
      if (!isPlainClick(event)) return;
      event.preventDefault();
      window.history.pushState(null, '', chipHref(verdict));
      setSelected(verdict);
    },
    [],
  );

  /** How many promises carry each verdict, counted from the data rather than declared. */
  const counts = useMemo(() => {
    const tally = new Map<Verdict, number>();
    for (const promise of promises) {
      tally.set(promise.verdict, (tally.get(promise.verdict) ?? 0) + 1);
    }
    return tally;
  }, [promises]);

  /** The verdicts worth offering, in attention order, never one with no rows. */
  const offered = useMemo(
    () => VERDICT_RANK.filter((verdict) => (counts.get(verdict) ?? 0) > 0),
    [counts],
  );

  const shown = useMemo(
    () => (selected === null ? promises : promises.filter((p) => p.verdict === selected)),
    [promises, selected],
  );

  return (
    <>
      <div aria-label={FILTER_GROUP_LABEL} className="promise-filter" role="group">
        <a
          aria-current={selected === null ? 'true' : undefined}
          className="promise-filter__chip"
          href={chipHref(null)}
          onClick={choose(null)}
        >
          <span className="promise-filter__all">{ALL_LABEL}</span>
          <span className="promise-filter__count">{promises.length}</span>
        </a>
        {offered.map((verdict) => (
          <a
            aria-current={selected === verdict ? 'true' : undefined}
            className="promise-filter__chip"
            href={chipHref(verdict)}
            key={verdict}
            onClick={choose(verdict)}
          >
            <VerdictTag verdict={verdict} />
            <span className="promise-filter__count">{counts.get(verdict) ?? 0}</span>
          </a>
        ))}
      </div>

      {/* Polite rather than assertive: a filter is not an alert, and a reader tabbing
          through the chips should not have each one interrupt them. */}
      <p aria-live="polite" className="promise-filter__status" role="status">
        {filterStatus(shown.length, promises.length, selected)}
      </p>

      <div className="promise-list-frame surface-raised">
        <ul className="promise-list">
          {shown.map((promise) => (
            <PromiseRow key={promise.id} promise={promise} />
          ))}
        </ul>
      </div>
    </>
  );
}
