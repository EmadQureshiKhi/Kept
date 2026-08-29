/**
 * `DiffPane`: the diff, with a control over how it is laid out. Design §10.9, §10.1, §10.8,
 * R7.5, R8.4, R10.7.
 *
 * A one-line prose amendment is the case a unified diff serves worst. The sentence the README
 * states and the sentence proposed instead land on two lines with a marker in front of each, and
 * a reader comparing them scans across a line break to find which words moved. Side by side they
 * are on one line and the change is where the columns stop matching. The amendment on file is
 * exactly that shape, so this is a real choice about how to read one edit rather than a
 * preference, and the reader makes it.
 *
 * ## The choice is a link, and the pane is the only client boundary it needs
 *
 * The two options are anchors carrying `?view=split` and the bare path, and clicking one is
 * handled: `preventDefault`, `history.pushState`, then re-read. So the page does not navigate,
 * the scroll position is kept, the URL is shareable, and the browser's back and forward walk the
 * choice. `isPlainClick` keeps a modified click with the browser, so cmd-click still opens a tab
 * and the anchors are genuinely links rather than buttons in disguise.
 *
 * **Every pane reads the URL rather than being handed a value.** `/amendments` renders its cards
 * as server components, so lifting the mode to the page would make the page a client component,
 * and the page reads the snapshot whose contract package reaches modules that open files. See
 * `RunLog` for what that costs. Instead each pane reads one query parameter, and a pane that
 * changed it dispatches `DIFF_MODE_EVENT` so the others re-read: the address bar stays the single
 * source of truth and two diffs on one page cannot disagree about how they are drawn.
 *
 * ## What crosses the boundary is data, not code
 *
 * `rows` arrive as plain objects from `lib/diff.ts`, which imports nothing at all, and `DiffView`
 * reaches only `clsx`, that module and a stylesheet. So this client bundle contains no part of
 * the CLI-and-UI contract package and there is nothing here for the chunker to fail on.
 *
 * ## Nothing here writes
 *
 * The pane spends no credit, fetches nothing and reaches no handler: it is `Array` work over rows
 * the server already rendered into props (R8.4, R8.6). The read-only scan asserts that over this
 * directory, and the toggle is two anchors and no form.
 */

'use client';

import { useCallback, useEffect, useState, type MouseEvent } from 'react';

import type { DiffRow } from '../lib/diff.js';
import {
  DEFAULT_DIFF_MODE,
  DIFF_MODES,
  DIFF_MODE_EVENT,
  diffModeFromSearch,
  diffModeHref,
  type DiffMode,
} from '../lib/diffMode.js';
import { isPlainClick } from '../lib/plainClick.js';

import { DiffView } from './DiffView.js';

import '../styles/diff.css';

/** The accessible name of the two-option group, since the options are links not a fieldset. */
export const DIFF_MODE_GROUP_LABEL = 'Diff layout';

/** The word on each option. The mode's own name, so the control needs no glossary. */
export const DIFF_MODE_WORDS: Readonly<Record<DiffMode, string>> = {
  unified: 'unified',
  split: 'side by side',
};

export interface DiffPaneProps {
  readonly rows: readonly DiffRow[];
  /** The diff's accessible name: what it is a diff *of*. Passed through to `DiffView`. */
  readonly label: string;
  /**
   * The route the two options link to, supplied by the caller rather than read from the browser.
   *
   * It has to be a prop because the first HTML is prerendered: there is no `window` to ask, and
   * an anchor with an empty `href` in the served markup is not a link. The caller is a server
   * component that knows exactly which route it is, so it says so.
   */
  readonly path: string;
  readonly className?: string;
}

export function DiffPane({ rows, label, path, className }: DiffPaneProps) {
  /**
   * `DEFAULT_DIFF_MODE` on the server and on first paint, which is what keeps hydration honest:
   * the prerendered HTML has no query string to read, so it renders the unified layout and the
   * client agrees with it until the effect below runs.
   */
  const [mode, setMode] = useState<DiffMode>(DEFAULT_DIFF_MODE);
  /** The search string the hrefs are built against, so other parameters survive the toggle. */
  const [search, setSearch] = useState<string>('');

  useEffect(() => {
    const readUrl = (): void => {
      setMode(diffModeFromSearch(window.location.search));
      setSearch(window.location.search);
    };
    readUrl();
    /* `popstate` for the browser's own back and forward; the custom event for another pane on
       this page having changed the mode, since `pushState` fires nothing. */
    window.addEventListener('popstate', readUrl);
    window.addEventListener(DIFF_MODE_EVENT, readUrl);
    return () => {
      window.removeEventListener('popstate', readUrl);
      window.removeEventListener(DIFF_MODE_EVENT, readUrl);
    };
  }, []);

  const choose = useCallback(
    (next: DiffMode) => (event: MouseEvent<HTMLAnchorElement>) => {
      if (!isPlainClick(event)) return;
      event.preventDefault();
      const href = diffModeHref(window.location.pathname, window.location.search, next);
      window.history.pushState(null, '', href);
      /* Told rather than assumed: every pane, this one included, re-reads the URL from the
         listener above, so there is one code path that decides what a pane shows. */
      window.dispatchEvent(new Event(DIFF_MODE_EVENT));
    },
    [],
  );

  return (
    <div className={className}>
      <div aria-label={DIFF_MODE_GROUP_LABEL} className="diff-mode" role="group">
        {DIFF_MODES.map((option) => (
          <a
            aria-current={mode === option ? 'true' : undefined}
            className="diff-mode__option"
            href={diffModeHref(path, search, option)}
            key={option}
            onClick={choose(option)}
          >
            {DIFF_MODE_WORDS[option]}
          </a>
        ))}
      </div>
      <DiffView label={label} mode={mode} rows={rows} />
    </div>
  );
}
