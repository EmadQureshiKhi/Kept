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
 * promise the panel is currently showing. One row of the claim in prose, ellipsised,
 * with the full text in `title` and in the panel — the same bargain the node makes
 * (§10.7).
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
import type { SnapshotPromise } from '@kept/core';

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
    <ul aria-label={label} className={clsx('graph-list', className)} role="list">
      {promises.map((promise) => (
        <li className="graph-list__item" key={promise.id}>
          <button
            aria-current={promise.id === selectedId ? 'true' : undefined}
            className="graph-list__button"
            data-promise-row={promise.id}
            data-verdict={promise.verdict}
            onClick={onSelect === undefined ? undefined : () => onSelect(promise.id)}
            type="button"
          >
            <span className="graph-list__id">{promise.id}</span>
            <span className="graph-list__claim" title={promise.claim}>
              {promise.claim}
            </span>
            <VerdictTag className="graph-list__verdict" verdict={promise.verdict} />
          </button>
        </li>
      ))}
    </ul>
  );
}
