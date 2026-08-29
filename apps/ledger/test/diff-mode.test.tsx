/**
 * The diff layout toggle: `lib/diffMode.ts` and `splitRows` as arithmetic, `DiffView` as the two
 * layouts, `DiffPane` as the control. Design §10.9, §10.1, §10.4.3, R7.5, R10.5, R10.8.
 *
 * The reason this exists: the amendment on file replaces one sentence of prose with another.
 * Read unified those two sentences are on separate lines with a marker in front of each, and the
 * reader scans across a line break to find which words moved. Read side by side they are on one
 * line and the change is where the columns stop matching.
 *
 * Three groups carry the weight.
 *
 * **One alignment, two presentations.** `splitRows` pairs the rows it is handed rather than
 * diffing the two texts again. If it recomputed, the two views of one amendment could report
 * different lines as replacing each other, and a reader who toggled would be shown two claims
 * about one edit with no way to tell which was the ledger's. There is a test that the same rows
 * come out of both layouts, in order.
 *
 * **The wash and the hue stay on different elements.** §10.4.3 keeps a verdict wash off anything
 * that carries text, and `typography-discipline.test.ts` fails on the merged spelling. In a split
 * row the two halves are different kinds, so the attribute the rules select through had to move
 * from the row to each pane. That move is asserted here, along with the absence of a `data-diff`
 * on an empty half, which is what keeps a gap from being coloured as a third kind of change.
 *
 * **Colour is still not the only channel** (R10.5). jsdom applies no stylesheet at all, so every
 * assertion in this file is what a reader with colour removed gets: the markers are rendered text
 * and every split row names both of its halves in its accessible name.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AMENDMENTS_PATH, AmendmentCard } from '../components/AmendmentCard.js';
import {
  DIFF_MODE_GROUP_LABEL,
  DIFF_MODE_WORDS,
  DiffPane,
} from '../components/DiffPane.js';
import { SPLIT_HEADINGS, SPLIT_GAP_WORD, DiffView, splitRowLabel } from '../components/DiffView.js';
import { diffLines, parseUnifiedDiff, splitRows, unifiedText } from '../lib/diff.js';
import {
  DEFAULT_DIFF_MODE,
  DIFF_MODES,
  DIFF_MODE_PARAM,
  diffModeFromSearch,
  diffModeHref,
  diffModeOf,
} from '../lib/diffMode.js';
import { snapshot } from '../lib/snapshot.js';

afterEach(cleanup);

const CURRENT =
  '- The Cart screen applies a 10 percent discount automatically when the subtotal exceeds 50.';
const PROPOSED = '- The Cart screen shows the order total with no automatic discounts.';

/** Put the browser on a URL, the way a real load of that URL would. */
function visit(search: string): void {
  window.history.replaceState(null, '', `${AMENDMENTS_PATH}${search}`);
}

beforeEach(() => visit(''));

/* ──────────────────────────── the mode, as arithmetic ─────────────────────────── */

describe('the layout is read out of the URL and never trusted', () => {
  it('accepts the two modes and falls back to unified for anything else', () => {
    expect(diffModeOf('split')).toBe('split');
    expect(diffModeOf('unified')).toBe('unified');
    /* `?view=banana` is a URL somebody typed. The honest answer is the page as it normally
       reads, not an error and not a blank. */
    for (const raw of [null, undefined, '', 'banana', 'SPLIT', 'side-by-side']) {
      expect(diffModeOf(raw), String(raw)).toBe(DEFAULT_DIFF_MODE);
    }
  });

  it('reads a search string with or without its question mark', () => {
    expect(diffModeFromSearch(`?${DIFF_MODE_PARAM}=split`)).toBe('split');
    expect(diffModeFromSearch(`${DIFF_MODE_PARAM}=split`)).toBe('split');
    expect(diffModeFromSearch('')).toBe(DEFAULT_DIFF_MODE);
  });

  it('clears the parameter for the default rather than spelling it out', () => {
    /* The canonical URL for the page is the one a reader gets by not choosing. */
    expect(diffModeHref('/amendments', '', 'unified')).toBe('/amendments');
    expect(diffModeHref('/amendments', `?${DIFF_MODE_PARAM}=split`, 'unified')).toBe('/amendments');
    expect(diffModeHref('/amendments', '', 'split')).toBe(`/amendments?${DIFF_MODE_PARAM}=split`);
  });

  it('preserves every other parameter, so a shared link keeps meaning what it meant', () => {
    /* Not politeness: rebuilding the query from scratch would drop anything the page grows
       later, and the link a reader copied would silently stop working. */
    expect(diffModeHref('/amendments', '?a=1&b=2', 'split')).toBe(
      `/amendments?a=1&b=2&${DIFF_MODE_PARAM}=split`,
    );
    expect(diffModeHref('/amendments', `?a=1&${DIFF_MODE_PARAM}=split`, 'unified')).toBe(
      '/amendments?a=1',
    );
  });
});

/* ────────────────────── the pairing, over one alignment ───────────────────────── */

describe('splitRows pairs the rows it is given, and computes no second alignment', () => {
  it('pairs a replacement so the two sentences sit opposite each other', () => {
    const rows = diffLines(CURRENT, PROPOSED, { firstLine: 20 });
    const split = splitRows(rows);
    expect(split).toHaveLength(1);
    expect(split[0]?.before?.text).toBe(CURRENT);
    expect(split[0]?.after?.text).toBe(PROPOSED);
    /* The gutter numbers stay each side's own: the deletion is line 20 of the before text and
       the addition is line 20 of the after text. */
    expect(split[0]?.before?.beforeLine).toBe(20);
    expect(split[0]?.after?.afterLine).toBe(20);
  });

  it('gives context the same line on both sides', () => {
    const split = splitRows(diffLines('a\nb\nc', 'a\nx\nc', { firstLine: 1 }));
    expect(split.map((row) => [row.before?.text ?? null, row.after?.text ?? null])).toEqual([
      ['a', 'a'],
      ['b', 'x'],
      ['c', 'c'],
    ]);
  });

  it('leaves a gap opposite an unmatched deletion or addition', () => {
    /* Three lines became two: the third deletion has nothing opposite it, and the gap is the
       fact the layout is showing. */
    const shrink = splitRows(diffLines('a\nb\nc', 'x\ny'));
    expect(shrink.map((row) => [row.before?.text ?? null, row.after?.text ?? null])).toEqual([
      ['a', 'x'],
      ['b', 'y'],
      ['c', null],
    ]);

    const grow = splitRows(diffLines('a', 'x\ny\nz'));
    expect(grow.map((row) => [row.before?.text ?? null, row.after?.text ?? null])).toEqual([
      ['a', 'x'],
      [null, 'y'],
      [null, 'z'],
    ]);
  });

  it('takes a run of deletions and the additions after it as one replacement', () => {
    /* Row by row this would stagger the edit down the page: the first deletion opposite a gap,
       then a gap opposite the first addition. Two runs zipped is what "these lines became those
       lines" looks like. */
    const rows = parseUnifiedDiff('-one\n-two\n+ONE\n+TWO');
    const split = splitRows(rows);
    expect(split.map((row) => [row.before?.text ?? null, row.after?.text ?? null])).toEqual([
      ['one', 'ONE'],
      ['two', 'TWO'],
    ]);
  });

  it('loses no row, and keeps each column in the order its own text is in', () => {
    /**
     * The property that matters, stated per column rather than over a flattened list.
     *
     * Flattening a split diff back into one sequence does *not* reproduce the unified order,
     * and that is the layout working rather than a bug: a run of two deletions followed by two
     * additions reads `- - + +` unified and `-|+` `-|+` split, because pairing a replacement is
     * exactly the reordering the side-by-side view exists to do.
     *
     * What must hold is that neither column invents, drops or reorders anything. The before
     * column is the before text and the after column is the after text, each in file order, and
     * every row of the unified diff appears in whichever column or columns it belongs to. If
     * this fails, the two layouts are two different claims about one edit.
     */
    const rows = diffLines('a\nb\nc\nd', 'a\nB\nC\nd\ne', { firstLine: 7 });
    const split = splitRows(rows);

    const beforeColumn = split.map((row) => row.before).filter((cell) => cell !== null);
    const afterColumn = split.map((row) => row.after).filter((cell) => cell !== null);

    expect(unifiedText(beforeColumn)).toBe(
      unifiedText(rows.filter((row) => row.kind !== 'add')),
    );
    expect(unifiedText(afterColumn)).toBe(unifiedText(rows.filter((row) => row.kind !== 'del')));

    /* And nothing was duplicated into a column it does not belong to: every cell in the before
       column is a row of the before text, and every cell in the after column of the after. */
    for (const cell of beforeColumn) expect(cell.beforeLine).not.toBeNull();
    for (const cell of afterColumn) expect(cell.afterLine).not.toBeNull();
  });

  it('pairs nothing for no rows', () => {
    expect(splitRows([])).toEqual([]);
  });
});

/* ──────────────────────────── the two layouts, rendered ──────────────────────── */

describe('DiffView draws the same diff two ways', () => {
  const ROWS = diffLines(CURRENT, PROPOSED, { firstLine: 20 });

  it('is unified unless asked otherwise, so every existing caller is unchanged', () => {
    const { container, unmount } = render(<DiffView label="d" rows={ROWS} />);
    try {
      expect(container.querySelector('.diff-view')?.getAttribute('data-mode')).toBe('unified');
      expect(container.querySelectorAll('.diff-row--split')).toHaveLength(0);
      const rows = [...container.querySelectorAll('.diff-row')];
      expect(rows.map((row) => row.getAttribute('data-diff'))).toEqual(['del', 'add']);
    } finally {
      unmount();
    }
  });

  it('names both panes, so a reader knows which side is the file', () => {
    const { container, unmount } = render(<DiffView label="d" mode="split" rows={ROWS} />);
    try {
      const headings = [...container.querySelectorAll('.diff-side-heading')];
      expect(headings.map((heading) => heading.textContent)).toEqual([
        SPLIT_HEADINGS.before,
        SPLIT_HEADINGS.after,
      ]);
      for (const heading of headings) {
        expect(heading.getAttribute('role')).toBe('columnheader');
      }
    } finally {
      unmount();
    }
  });

  it('puts the two sentences on one row, each with its own gutter and marker', () => {
    const { container, unmount } = render(<DiffView label="d" mode="split" rows={ROWS} />);
    try {
      expect(container.querySelector('.diff-view')?.getAttribute('data-mode')).toBe('split');
      const body = [...container.querySelectorAll('.diff-row--split:not(.diff-row--heading)')];
      expect(body).toHaveLength(1);

      const sides = [...(body[0]?.querySelectorAll('.diff-side') ?? [])];
      expect(sides).toHaveLength(2);
      expect(sides[0]?.getAttribute('data-diff')).toBe('del');
      expect(sides[1]?.getAttribute('data-diff')).toBe('add');
      expect(sides[0]?.querySelector('.diff-text')?.textContent).toBe(CURRENT);
      expect(sides[1]?.querySelector('.diff-text')?.textContent).toBe(PROPOSED);
      expect(sides[0]?.querySelector('.diff-gutter')?.textContent).toBe('20');
      expect(sides[1]?.querySelector('.diff-gutter')?.textContent).toBe('20');
      /* The markers are rendered text, so the diff reads as a diff with every stylesheet
         stripped, which is literally what jsdom sees (R10.5). */
      expect(sides[0]?.querySelector('.diff-marker')?.textContent).toBe('-');
      expect(sides[1]?.querySelector('.diff-marker')?.textContent).toBe('+');
    } finally {
      unmount();
    }
  });

  it('moves data-diff from the row to each pane, so the wash rules still carry no text', () => {
    const { container, unmount } = render(<DiffView label="d" mode="split" rows={ROWS} />);
    try {
      /* §10.4.3 keeps a wash off anything carrying text, and the wash is selected through
         `data-diff`. In a split row the two halves are different kinds, so one attribute on the
         row could only ever describe one of them. */
      for (const row of container.querySelectorAll('.diff-row--split')) {
        expect(row.hasAttribute('data-diff'), 'a split row still claims one kind').toBe(false);
      }
      expect(container.querySelectorAll('.diff-side[data-diff]')).toHaveLength(2);
    } finally {
      unmount();
    }
  });

  it('leaves an empty half unmarked, so a gap is never coloured as a change', () => {
    const { container, unmount } = render(
      <DiffView label="d" mode="split" rows={diffLines('a\nb', 'x')} />,
    );
    try {
      const gaps = [...container.querySelectorAll('.diff-side--gap')];
      expect(gaps.length).toBeGreaterThan(0);
      for (const gap of gaps) {
        /* No `data-diff`, so neither the wash rules nor the hue rules can reach it. A gap is
           the absence of a line rather than a third kind of change. */
        expect(gap.hasAttribute('data-diff')).toBe(false);
        expect(gap.querySelector('.diff-text')?.textContent).toBe('');
      }
    } finally {
      unmount();
    }
  });

  it('names every split row on both of its halves', () => {
    const rows = diffLines('a\nb', 'x');
    const { container, unmount } = render(<DiffView label="d" mode="split" rows={rows} />);
    try {
      const expected = splitRows(rows).map((row) => splitRowLabel(row));
      const named = [...container.querySelectorAll('.diff-row--split:not(.diff-row--heading)')].map(
        (row) => row.getAttribute('aria-label'),
      );
      expect(named).toEqual(expected);
      /* The two halves only mean something together, so they arrive as one string: `removed
         line 2, no line` is a deletion with nothing put in its place. */
      expect(expected.some((label) => label.includes(SPLIT_GAP_WORD))).toBe(true);
    } finally {
      unmount();
    }
  });

  it('says an unchanged diff is unchanged in either layout', () => {
    for (const mode of DIFF_MODES) {
      const { container, unmount } = render(
        <DiffView label="d" mode={mode} rows={diffLines(CURRENT, CURRENT)} />,
      );
      expect(container.querySelector('.diff-view__note')).not.toBeNull();
      expect(container.querySelectorAll('.diff-row')).toHaveLength(0);
      unmount();
    }
  });
});

/* ────────────────────────────── the control itself ───────────────────────────── */

describe('DiffPane offers the choice as a link and keeps the page in place', () => {
  const ROWS = diffLines(CURRENT, PROPOSED, { firstLine: 20 });

  function pane() {
    return render(<DiffPane label="d" path={AMENDMENTS_PATH} rows={ROWS} />);
  }

  function options(container: HTMLElement): readonly HTMLAnchorElement[] {
    return [...container.querySelectorAll<HTMLAnchorElement>('.diff-mode__option')];
  }

  /** Click an option and report whether the navigation was prevented. */
  function click(link: HTMLAnchorElement, init: Partial<MouseEventInit> = {}): boolean {
    let prevented = false;
    act(() => {
      prevented = !fireEvent.click(link, { button: 0, ...init });
    });
    return prevented;
  }

  it('offers both layouts as named links, in a named group', () => {
    const { container, unmount } = pane();
    try {
      const group = container.querySelector('.diff-mode');
      expect(group?.getAttribute('role')).toBe('group');
      expect(group?.getAttribute('aria-label')).toBe(DIFF_MODE_GROUP_LABEL);

      const links = options(container);
      expect(links.map((link) => link.textContent)).toEqual(
        DIFF_MODES.map((mode) => DIFF_MODE_WORDS[mode]),
      );
      for (const link of links) {
        expect(link.tagName, 'an option is not an anchor, so it is a control').toBe('A');
        expect(link.getAttribute('href')).toBeTruthy();
      }
      /* Two links and nothing else: the route's read-only guarantee is that no control on it
         reaches a handler, and a form here would be the first one (R8.4). */
      expect(container.querySelectorAll('form')).toHaveLength(0);
      expect(container.querySelectorAll('input')).toHaveLength(0);
    } finally {
      unmount();
    }
  });

  it('renders unified on first paint, which is what the prerendered HTML has to show', () => {
    /* The page is statically rendered, so there is no query string at build time. The client
       agrees with that HTML until its effect runs, which is the hydration contract. */
    const { container, unmount } = pane();
    try {
      expect(container.querySelector('.diff-view')?.getAttribute('data-mode')).toBe('unified');
      expect(options(container)[0]?.getAttribute('aria-current')).toBe('true');
    } finally {
      unmount();
    }
  });

  it('opens in the split layout when the URL names it', () => {
    visit(`?${DIFF_MODE_PARAM}=split`);
    const { container, unmount } = pane();
    try {
      expect(container.querySelector('.diff-view')?.getAttribute('data-mode')).toBe('split');
      const current = options(container).filter(
        (link) => link.getAttribute('aria-current') === 'true',
      );
      expect(current, 'exactly one option is current').toHaveLength(1);
      expect(current[0]?.textContent).toBe(DIFF_MODE_WORDS.split);
    } finally {
      unmount();
    }
  });

  it('switches in place: no navigation, and the URL says which layout', () => {
    const { container, unmount } = pane();
    try {
      const split = options(container).find(
        (link) => link.textContent === DIFF_MODE_WORDS.split,
      ) as HTMLAnchorElement;
      /* Prevented, so the browser does not reload the page and drop the scroll position. */
      expect(click(split), 'the click was allowed to navigate').toBe(true);
      expect(window.location.pathname + window.location.search).toBe(
        `${AMENDMENTS_PATH}?${DIFF_MODE_PARAM}=split`,
      );
      expect(container.querySelector('.diff-view')?.getAttribute('data-mode')).toBe('split');

      const unified = options(container).find(
        (link) => link.textContent === DIFF_MODE_WORDS.unified,
      ) as HTMLAnchorElement;
      expect(click(unified)).toBe(true);
      expect(window.location.pathname + window.location.search).toBe(AMENDMENTS_PATH);
      expect(container.querySelector('.diff-view')?.getAttribute('data-mode')).toBe('unified');
    } finally {
      unmount();
    }
  });

  it('keeps two panes on one page agreeing, because both read the URL', () => {
    /* The reason the mode is a URL rather than state in one place: the cards are server
       components, so lifting the mode to the page would make the page a client component and
       drag the snapshot's contract package into a browser chunk. */
    const { container, unmount } = render(
      <>
        <DiffPane label="one" path={AMENDMENTS_PATH} rows={ROWS} />
        <DiffPane label="two" path={AMENDMENTS_PATH} rows={ROWS} />
      </>,
    );
    try {
      const views = () =>
        [...container.querySelectorAll('.diff-view')].map((view) => view.getAttribute('data-mode'));
      expect(views()).toEqual(['unified', 'unified']);

      const split = options(container).find(
        (link) => link.textContent === DIFF_MODE_WORDS.split,
      ) as HTMLAnchorElement;
      click(split);
      expect(views(), 'the second pane did not follow the first').toEqual(['split', 'split']);
    } finally {
      unmount();
    }
  });

  it('follows the browser back button', () => {
    const { container, unmount } = pane();
    try {
      click(
        options(container).find(
          (link) => link.textContent === DIFF_MODE_WORDS.split,
        ) as HTMLAnchorElement,
      );
      expect(container.querySelector('.diff-view')?.getAttribute('data-mode')).toBe('split');

      /* jsdom runs no `popstate` for `history.back()`, so the URL is restored and the event
         dispatched directly. What is under test is that the pane re-reads the URL rather than
         holding a mode the address bar has moved away from. */
      act(() => {
        window.history.replaceState(null, '', AMENDMENTS_PATH);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      expect(container.querySelector('.diff-view')?.getAttribute('data-mode')).toBe('unified');
    } finally {
      unmount();
    }
  });

  it('leaves a cmd-click to the browser, so an option is still a real link', () => {
    const { container, unmount } = pane();
    try {
      const split = options(container).find(
        (link) => link.textContent === DIFF_MODE_WORDS.split,
      ) as HTMLAnchorElement;
      expect(click(split, { metaKey: true }), 'a cmd-click was hijacked').toBe(false);
      expect(window.location.search).toBe('');
      expect(container.querySelector('.diff-view')?.getAttribute('data-mode')).toBe('unified');
    } finally {
      unmount();
    }
  });
});

/* ───────────────────── the card and the committed amendment ──────────────────── */

describe('the amendment on file can be read either way', () => {
  it('carries the toggle on the card, linking to the amendments route', () => {
    const amendment = snapshot.amendments[0];
    expect(amendment, 'the committed snapshot carries no amendment').toBeDefined();
    if (amendment === undefined) return;

    const { container, unmount } = render(<AmendmentCard amendment={amendment} />);
    try {
      const links = [...container.querySelectorAll<HTMLAnchorElement>('.diff-mode__option')];
      expect(links).toHaveLength(DIFF_MODES.length);
      expect(links.map((link) => link.getAttribute('href'))).toEqual([
        AMENDMENTS_PATH,
        `${AMENDMENTS_PATH}?${DIFF_MODE_PARAM}=split`,
      ]);
      /* Unchanged by default: the card still renders the unified diff the tests around it
         already assert, and the toggle is an addition rather than a replacement. */
      expect(container.querySelector('.diff-view')?.getAttribute('data-mode')).toBe('unified');
      expect(container.querySelectorAll('.diff-row')).toHaveLength(2);
    } finally {
      unmount();
    }
  });

  it('reads the committed one-line replacement side by side', () => {
    const amendment = snapshot.amendments[0];
    if (amendment === undefined) return;
    visit(`?${DIFF_MODE_PARAM}=split`);

    const { container, unmount } = render(<AmendmentCard amendment={amendment} />);
    try {
      const body = [...container.querySelectorAll('.diff-row--split:not(.diff-row--heading)')];
      /* One row, both sentences on it. This is the whole reason the layout exists: the claim
         the README makes and the claim proposed instead, directly above each other. */
      expect(body).toHaveLength(1);
      const texts = [...(body[0]?.querySelectorAll('.diff-text') ?? [])].map(
        (cell) => cell.textContent,
      );
      expect(texts).toEqual([amendment.currentText, amendment.proposedText]);
    } finally {
      unmount();
    }
  });
});
