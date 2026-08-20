/**
 * `PromiseNode` — design §10.2, §10.3 (320×76), §10.4.3, §10.7, §10.8, R8.1, R10.2,
 * R10.5, R10.7.
 *
 * One promise, as the graph draws it: the id a reader can deep-link, the claim in two
 * lines of prose, the `path:line` that makes it checkable, and the verdict as a word
 * beside its hue.
 *
 * **It is a plain presentational component, not a React Flow node type.** React Flow
 * is used for panning, zooming, edges and the viewport only (§10.3), so it is handed
 * a thin adapter in `PromiseGraph` that unwraps its `NodeProps` and renders this. The
 * separation is what lets the node be rendered — and asserted — with no canvas, no
 * `ResizeObserver` and no viewport, which is how Property 23 quantifies over
 * generated snapshots without paying for a graph library 500 times.
 *
 * **Four rows of information, no truncation of meaning.** The claim clamps to two
 * lines in CSS and carries its full text in `title`, repeated verbatim in the panel
 * (§10.7) — so the ellipsis costs a reader nothing but a hover or a keystroke. The
 * id, the citation and the verdict never clamp: they are the three things a judge
 * checks, and a clipped hash is worse than no hash.
 *
 * **Focus is roving and the container owns the keys.** The node is `tabIndex={-1}` and
 * is focused programmatically by `PromiseGraph` as the arrow keys walk the lane
 * (§10.8), so `Tab` enters the graph once rather than once per promise — a 200-promise
 * graph is otherwise a 200-stop tab trap. `role="button"` states that activating it
 * does something; the parallel `role="list"` sidebar carries the semantic list, and it
 * is the path a screen-reader user takes.
 *
 * The verdict wash on the 3px left edge is authored in `promise-node.css`, in rules
 * that carry no `color`, so no wash ever sits behind text (§10.4.3). `VerdictTag`
 * supplies the word and the hue, composed through its documented `className`.
 */

'use client';

import clsx from 'clsx';
import type { SnapshotPromise } from '@kept/core';

import { citationLabel } from '../lib/citation.js';

import { VerdictTag } from './VerdictTag.js';

import '../styles/promise-node.css';

export interface PromiseNodeProps {
  readonly promise: SnapshotPromise;
  /** True when this promise is the panel's subject (`?p=<id>` or a selection). */
  readonly selected?: boolean;
  /** Called on click and on `Enter`/`Space`; the graph owns what selection means. */
  readonly onSelect?: (id: string) => void;
  /**
   * Hands the graph this node's element, so the keyboard model can move focus to it.
   * Called with `null` on unmount, which is what keeps the registry from holding a
   * detached element after a snapshot change.
   */
  readonly registerElement?: (id: string, element: HTMLElement | null) => void;
  readonly className?: string;
}

export function PromiseNode({
  promise,
  selected = false,
  onSelect,
  registerElement,
  className,
}: PromiseNodeProps) {
  return (
    <div
      className={clsx('promise-node', 'surface-raised', className)}
      data-promise-node={promise.id}
      data-selected={selected ? 'true' : 'false'}
      data-verdict={promise.verdict}
      onClick={onSelect === undefined ? undefined : () => onSelect(promise.id)}
      ref={
        registerElement === undefined
          ? undefined
          : (element: HTMLDivElement | null) => registerElement(promise.id, element)
      }
      role="button"
      tabIndex={-1}
    >
      <span className="promise-node__head">
        <span className="promise-node__id">{promise.id}</span>
        <VerdictTag className="promise-node__verdict" verdict={promise.verdict} />
      </span>
      <p className="promise-node__claim" title={promise.claim}>
        {promise.claim}
      </p>
      <span className="promise-node__citation">{citationLabel(promise.citation)}</span>
    </div>
  );
}
