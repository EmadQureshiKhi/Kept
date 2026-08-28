/**
 * `PromiseList` — design §10.8 ("a parallel `role="list"` of promises is always
 * present in the DOM"), R10.7, and the reachability clause of Property 23.
 *
 * The list is not a fallback and not a small-screen variant. It is always rendered,
 * always in the same lane order as the canvas, and every row is a native `<button>` —
 * so every promise is reachable and selectable with `Tab` and `Enter` alone, with no
 * canvas, no pointer and none of the graph's own key handling involved. That is what
 * makes "every promise is reachable and selectable" true of the *document* rather than
 * true of a widget, which is why the property asserts the list's presence
 * unconditionally instead of asserting it under a condition.
 *
 * Order comes from `lib/layout.ts` through the ids the graph walks, so the list and the
 * lane cannot disagree: red sorts to the top in both, because there is one sort.
 *
 * `aria-current` rather than `aria-pressed`: the row does not toggle, it names which
 * promise the panel is currently showing. Two lines of the claim in prose, clamped, with
 * the full text in `title` and in the panel — the same bargain the node makes (§10.7).
 *
 * **The rank is the sort, made visible.** `1 of 8` down the left of the column is the same
 * numeral `PromiseNode` carries and it comes from the same place: the promises arrive here in
 * lane order, so the index *is* the rank and no second sort is possible. The column's heading
 * says "most urgent first" — before the numeral landed, nothing in the rows said which one
 * was first, and the order was carried entirely by four verdict hues a reader had to already
 * know the ranking of.
 *
 * **The verdict is a word, on the row's top line, beside its hue.** `VerdictTag` was already
 * here but sat alone on a third line under the claim, with the verdict's real signal — the
 * 3px `--wash-*` left edge — doing the work at an alpha that is close to invisible on paper.
 * Colour is never the only channel (R10.5), so the word sits where the eye already is.
 *
 * **The row is a cell in a ruled sheet, not a box on the page.** The `<ul>` composes
 * `.surface-raised`, so the list is one opaque `--ink-100` plane with a 2px ink edge and the
 * rows are ruled cells inside it. Before that the rows sat directly on the page and the
 * page's own 28px ruling ran through the gap between every pair of them, which is why eight
 * promises read as one block. The elevation is picked rather than authored: §10.4.4 permits a
 * `box-shadow` in `styles/surfaces.css` and in no other file, so a component composes a
 * surface class in its markup and never writes depth.
 *
 * **The class namespace is `graph-list`, not `promise-list`, and that is not a matter
 * of taste.** `styles/coverage.css` already owns `.promise-list`, `.promise-list__item`,
 * `.promise-list__claim`, `.promise-list__id` and `.promise-list__verdict` for the
 * static rows of `/coverage` (task 9.8). Every Ledger stylesheet is global, so a second
 * set of rules under those names would be two components quietly restyling each other
 * across a route boundary — the kind of bug that only shows up after a client-side
 * navigation. The two lists are also genuinely different objects rather than one
 * component wanting a variant: `/coverage`'s row is a non-interactive `<li>` on a
 * shareable page, this is a `<button>` bound to the graph's selection. So they stay two
 * components under two namespaces, and this one is named after the surface it belongs
 * to.
 */

'use client';

import clsx from 'clsx';
import type { SnapshotPromise } from 'kept-core';

import { VerdictTag } from './VerdictTag.js';

import '../styles/promise-graph.css';

export interface PromiseListProps {
  /** The promises, in the lane order the graph walks. */
  readonly promises: readonly SnapshotPromise[];
  readonly selectedId?: string | null;
  readonly onSelect?: (id: string) => void;
  /** Names the list for assistive technology, and for the tests that query by role. */
  readonly label?: string;
  readonly className?: string;
}

export const PROMISE_LIST_LABEL = 'promises';

export function PromiseList({
  promises,
  selectedId = null,
  onSelect,
  label = PROMISE_LIST_LABEL,
  className,
}: PromiseListProps) {
  return (
    <ul aria-label={label} className={clsx('graph-list', 'surface-raised', className)} role="list">
      {promises.map((promise, index) => (
        <li className="graph-list__item" key={promise.id}>
          <button
            aria-current={promise.id === selectedId ? 'true' : undefined}
            className="graph-list__button"
            data-promise-row={promise.id}
            data-verdict={promise.verdict}
            onClick={onSelect === undefined ? undefined : () => onSelect(promise.id)}
            type="button"
          >
            <span className="graph-list__head">
              <span
                className="graph-list__rank"
                title={`urgency ${index + 1} of ${promises.length}, most urgent first`}
              >
                {index + 1}
              </span>
              <span className="graph-list__id">{promise.id}</span>
              <VerdictTag className="graph-list__verdict" verdict={promise.verdict} />
            </span>
            <span className="graph-list__claim" title={promise.claim}>
              {promise.claim}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
