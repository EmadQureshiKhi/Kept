/**
 * `DiffView` — design §10.9, §10.5, §10.7, §10.4.3, R7.5, R10.1, R10.5.
 *
 * The diff reads as **cut into** the card rather than stacked on it: the container is
 * `.surface-well`, the one recessed surface of §10.5, whose light ramp is inverted so
 * the occlusion sits inside the top edge. That is the same treatment `PromisePanel`
 * gives the verbatim citation quote, and for the same argument — a well says *these are
 * the bytes*, a raised card says *this is our commentary on them*. A diff is the former.
 *
 * It renders **rows**, not two texts, and that is what lets one component serve both
 * repair surfaces. `/amendments` has a before and an after and runs `diffLines` over
 * them; `/reviews` has a patch Kane already rendered and runs `parseUnifiedDiff` over
 * that. A component that took two texts would have forced `/reviews` either to fake a
 * before/after pair or to grow a second renderer.
 *
 * ## Two layouts over one alignment
 *
 * `mode` picks unified or split, and unified is the default so every existing caller is
 * unchanged. The split layout is the reading a one-line prose amendment actually wants: read
 * unified, the sentence the README states and the sentence proposed instead sit on two lines
 * with a marker in front of each, and the reader scans across a line break to find which words
 * moved; read side by side they are on one line and the change is where the columns stop
 * matching.
 *
 * **Both layouts render the same alignment.** `splitRows` pairs the rows this component was
 * handed rather than diffing the two texts again, so toggling cannot change which line is
 * reported as replacing which. Two views of one amendment that disagreed on that would be two
 * different claims about one edit, and the reader would have no way to tell which was the
 * ledger's.
 *
 * The wash-and-hue split survives into the split layout, on the element that has to carry it:
 * `data-diff` moves from the row to each `.diff-side`, because in a split row the two halves are
 * different kinds and one row attribute could only describe one of them. An empty half carries
 * no `data-diff` at all, so no wash rule and no hue rule reaches it: a gap is the absence of a
 * line, not a third kind of change.
 *
 * Three decisions the markup encodes rather than the stylesheet:
 *
 * 1. **The wash is on the row and the hue is on the text, and they are different
 *    elements.** §10.9 puts `--wash-red` / `--wash-proven` on each changed row's left
 *    3px edge and the verdict hue on its body. Written as one element they would
 *    eventually be written as one CSS rule, and text on a wash is exactly the pair
 *    Property 22's contrast clause assumes cannot exist. Split across two elements, no
 *    rule *can* declare both — the same structural trick `VerdictTag` uses, and
 *    `typography-discipline.test.ts` fails on the merged spelling.
 * 2. **Every row says what it is in words as well as in colour** (R10.5). The `-` and
 *    `+` markers are rendered text, and the row carries `removed` / `added` /
 *    `unchanged` in its accessible name, so a reader with colour removed — which is
 *    literally what these tests see, since jsdom applies no stylesheet — still gets the
 *    diff. A red row whose only claim to being a deletion was its colour would fail
 *    R10.5 in the one place the product argues from.
 * 3. **The gutter carries both sides' numbers, in tabular numerals** (§10.7). The
 *    numbers come off `lib/diff.ts`'s rows rather than from counting rendered children,
 *    so a deletion is numbered in the *before* text and the addition replacing it in
 *    the *after* — which is what a unified diff means. Proportional digits would not
 *    form a column, so the declaration is non-negotiable and the typography scan
 *    asserts it.
 *
 * Server component: no hooks, no handlers, no client boundary, and no import of
 * `lib/motion` — nothing here animates, so nothing here needs the reduced-motion gate
 * or an entry in its orchestration register.
 */

import clsx from 'clsx';

import {
  DIFF_KIND_WORDS,
  DIFF_MARKERS,
  splitRows,
  type DiffRow,
  type SplitDiffRow,
} from '../lib/diff.js';
import { DEFAULT_DIFF_MODE, type DiffMode } from '../lib/diffMode.js';

import '../styles/diff.css';

/** The words the view says around the rows. Exported so tests assert the words. */
export const DIFF_WORDS = {
  /** A diff with no changed row: whatever produced it is proposing nothing. */
  unchanged:
    'Every line of this diff is unchanged, so there is nothing here to apply. A proposal ' +
    'that differs from the file in no byte is a proposal with nothing in it.',
  /** A diff with no rows at all: none was rendered, which is not the same thing. */
  absent:
    'No diff was rendered for this change, so there is nothing to show. The summary above ' +
    'is what was recorded; nothing was applied either way.',
} as const;

/** The two column headings the split layout needs, so a reader knows which side is which. */
export const SPLIT_HEADINGS = { before: 'written now', after: 'proposed' } as const;

/**
 * What an empty half of a split row is called.
 *
 * A gap opposite a deletion means the after text has no line there, which is the fact the layout
 * is showing. It carries no `data-diff`, so no wash and no hue rule reaches it, and it says the
 * word in its accessible name rather than being a silent blank.
 */
export const SPLIT_GAP_WORD = 'no line';

/**
 * The accessible name of one split row.
 *
 * A split row is two facts at once and a screen reader gets them in one string, because the two
 * halves only mean something together: `removed line 20, added line 20` is a replacement, and
 * `removed line 20, no line` is a deletion with nothing put in its place.
 */
export function splitRowLabel(row: SplitDiffRow): string {
  const side = (cell: DiffRow | null): string =>
    cell === null
      ? SPLIT_GAP_WORD
      : `${DIFF_KIND_WORDS[cell.kind]} line ${String(cell.beforeLine ?? cell.afterLine ?? 0)}`;
  return `${side(row.before)}, ${side(row.after)}`;
}

export interface DiffViewProps {
  readonly rows: readonly DiffRow[];
  /**
   * The diff's accessible name — what it is a diff *of*. Required, because a grid of
   * numbers and fragments with no name is unusable without sight of the heading above
   * it.
   */
  readonly label: string;
  /**
   * How the rows are laid out. Unified by default, so `/reviews` and every existing caller are
   * unchanged and the layout a reader gets without asking is the one they already had.
   */
  readonly mode?: DiffMode;
  readonly className?: string;
}

/** One half of a split row: the gutter, the marker and the bytes, or a stated gap. */
function SplitSide({ cell }: { readonly cell: DiffRow | null }) {
  if (cell === null) {
    /* No `data-diff`, so no wash rule and no hue rule can reach this element: a gap is the
       absence of a line rather than a third kind of change. */
    return (
      <span className="diff-side diff-side--gap" role="cell">
        <span className="diff-gutter" />
        <span className="diff-marker" />
        <span className="diff-text" />
      </span>
    );
  }
  return (
    <span className="diff-side" data-diff={cell.kind} role="cell">
      <span className="diff-gutter">{cell.beforeLine ?? cell.afterLine ?? ''}</span>
      <span className="diff-marker">{DIFF_MARKERS[cell.kind]}</span>
      <span className="diff-text">{cell.text}</span>
    </span>
  );
}

/** One row: before gutter, after gutter, marker, bytes. */
function Row({ row }: { readonly row: DiffRow }) {
  return (
    <div
      aria-label={`${DIFF_KIND_WORDS[row.kind]} line ${row.beforeLine ?? row.afterLine ?? 0}`}
      className="diff-row"
      data-diff={row.kind}
      role="row"
    >
      <span className="diff-gutter" role="cell">
        {row.beforeLine ?? ''}
      </span>
      <span className="diff-gutter" role="cell">
        {row.afterLine ?? ''}
      </span>
      <span className="diff-marker" role="cell">
        {DIFF_MARKERS[row.kind]}
      </span>
      <span className="diff-text" role="cell">
        {row.text}
      </span>
    </div>
  );
}

export function DiffView({ rows, label, mode = DEFAULT_DIFF_MODE, className }: DiffViewProps) {
  const changed = rows.some((row) => row.kind !== 'ctx');
  const empty = rows.length === 0 || rows.every((row) => row.text.length === 0);
  /* Derived from the rows that were handed in, never from the two texts again: there is one
     alignment and the split layout is a presentation of it, so the two views of one amendment
     cannot disagree about which line replaced which. See `splitRows` in `lib/diff.ts`. */
  const split = mode === 'split' ? splitRows(rows) : null;

  return (
    <div
      aria-label={label}
      className={clsx('diff-view', 'surface-well', className)}
      data-mode={mode}
      role="table"
    >
      {!changed ? (
        <p className="diff-view__note">{empty ? DIFF_WORDS.absent : DIFF_WORDS.unchanged}</p>
      ) : split === null ? (
        rows.map((row, index) => <Row key={`${index}:${row.kind}`} row={row} />)
      ) : (
        <>
          {/* The headings name the columns, because two panes of mono with no labels leave a
              reader to infer which side is the file and which is the proposal. Row-scoped
              headers rather than a caption: they belong to the grid. */}
          <div className="diff-row diff-row--split diff-row--heading" role="row">
            <span className="diff-side-heading" role="columnheader">
              {SPLIT_HEADINGS.before}
            </span>
            <span className="diff-side-heading" role="columnheader">
              {SPLIT_HEADINGS.after}
            </span>
          </div>
          {split.map((row, index) => (
            <div
              aria-label={splitRowLabel(row)}
              className="diff-row diff-row--split"
              key={`${index}:${row.before?.kind ?? 'gap'}:${row.after?.kind ?? 'gap'}`}
              role="row"
            >
              <SplitSide cell={row.before} />
              <SplitSide cell={row.after} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
