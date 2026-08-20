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

import { DIFF_KIND_WORDS, DIFF_MARKERS, type DiffRow } from '../lib/diff.js';

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

export interface DiffViewProps {
  readonly rows: readonly DiffRow[];
  /**
   * The diff's accessible name — what it is a diff *of*. Required, because a grid of
   * numbers and fragments with no name is unusable without sight of the heading above
   * it.
   */
  readonly label: string;
  readonly className?: string;
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

export function DiffView({ rows, label, className }: DiffViewProps) {
  const changed = rows.some((row) => row.kind !== 'ctx');
  const empty = rows.length === 0 || rows.every((row) => row.text.length === 0);

  return (
    <div aria-label={label} className={clsx('diff-view', 'surface-well', className)} role="table">
      {changed ? (
        rows.map((row, index) => <Row key={`${index}:${row.kind}`} row={row} />)
      ) : (
        <p className="diff-view__note">{empty ? DIFF_WORDS.absent : DIFF_WORDS.unchanged}</p>
      )}
    </div>
  );
}
