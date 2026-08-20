/**
 * The graph's keyboard model, as arithmetic — design §10.8, R10.7, R10.8, and the
 * reachability and selectability clauses of Property 23.
 *
 * §10.8 says a judge with no pointer must be able to reach every promise, open it,
 * and get back out. That is a claim about a *walk over a list*, not about a canvas,
 * so it is written here as a pure function of the layout and asserted over every
 * schema-valid snapshot rather than over one rendered tree. `PromiseGraph` binds
 * these functions to `keydown` and to `.focus()` and decides nothing itself, which
 * is what keeps the model provable and the component thin.
 *
 * Four decisions worth stating, because each one is a place a keyboard model
 * usually goes wrong:
 *
 * 1. **Only promises take focus.** The walk order is the promise lane in the row
 *    order `lib/layout.ts` already fixed — `(verdict rank, id)`, red first — so the
 *    first `Tab` into the graph lands on the promise that most needs attention, and
 *    the arrow order is the same order the eye reads down the lane. The document,
 *    designed-test and evidence lanes are context for a promise rather than
 *    destinations: everything they carry is repeated in the panel, in text, so
 *    making them focusable would add three keystrokes per promise and no
 *    information.
 * 2. **Both axes walk the same lane.** The promise lane is one column, so
 *    `ArrowRight` behaves as `ArrowDown` and `ArrowLeft` as `ArrowUp`. The
 *    alternative — reserving the horizontal axis for lane changes — would leave two
 *    keys dead for the whole walk, and a dead arrow key inside `role="application"`
 *    reads as a broken widget rather than as a design.
 * 3. **The ends clamp; they do not wrap.** Holding `ArrowDown` stops on the last
 *    promise instead of silently starting again at the top, so "am I at the end of
 *    the list" is answerable without counting. `Home` and `End` are the fast path.
 * 4. **A selection is only ever an id that exists.** `?p=<id>` arrives from a URL,
 *    which means from anywhere; {@link resolveSelection} is the single funnel that
 *    turns it into either a promise in *this* snapshot or `null`. There is no
 *    "unknown promise" state to render, and a stale link degrades to the graph with
 *    nothing selected rather than to an empty panel making a claim about an id the
 *    ledger has never seen.
 *
 * Nothing here touches the DOM: the module is checked under the repository's no-DOM
 * `lib` (root `tsconfig.json`), so the model is provable in a Node test and shared
 * verbatim with the browser.
 */

import type { GraphLayout } from './layout.js';
import { promiseNodes } from './layout.js';

/** Keys that move focus one step towards the end of the lane. */
export const NAV_FORWARD_KEYS = ['ArrowDown', 'ArrowRight'] as const;

/** Keys that move focus one step towards the start of the lane. */
export const NAV_BACKWARD_KEYS = ['ArrowUp', 'ArrowLeft'] as const;

/** Keys that jump to the ends of the lane. */
export const NAV_FIRST_KEYS = ['Home'] as const;
export const NAV_LAST_KEYS = ['End'] as const;

/**
 * Keys that select the focused promise and open its panel (§10.8).
 *
 * `' '` is `KeyboardEvent.key` for the space bar; `'Spacebar'` is the legacy IE
 * spelling, kept because it costs one array entry and its absence would be a
 * silently unselectable node on a browser we did not test.
 */
export const SELECT_KEYS = ['Enter', ' ', 'Spacebar'] as const;

/** Keys that close the panel and return focus to the node that opened it. */
export const CLOSE_KEYS = ['Escape', 'Esc'] as const;

/** Every key the graph consumes for navigation. */
export const NAV_KEYS = [
  ...NAV_FORWARD_KEYS,
  ...NAV_BACKWARD_KEYS,
  ...NAV_FIRST_KEYS,
  ...NAV_LAST_KEYS,
] as const;

export type NavKey = (typeof NAV_KEYS)[number];

const NAV_KEY_SET: ReadonlySet<string> = new Set<string>(NAV_KEYS);
const FORWARD: ReadonlySet<string> = new Set<string>(NAV_FORWARD_KEYS);
const BACKWARD: ReadonlySet<string> = new Set<string>(NAV_BACKWARD_KEYS);
const FIRST: ReadonlySet<string> = new Set<string>(NAV_FIRST_KEYS);
const LAST: ReadonlySet<string> = new Set<string>(NAV_LAST_KEYS);
const SELECT: ReadonlySet<string> = new Set<string>(SELECT_KEYS);
const CLOSE: ReadonlySet<string> = new Set<string>(CLOSE_KEYS);

/** `true` when the graph moves focus for this key rather than letting it through. */
export function isNavKey(key: string): key is NavKey {
  return NAV_KEY_SET.has(key);
}

/** `true` when this key opens the focused promise's panel (§10.8). */
export function isSelectKey(key: string): boolean {
  return SELECT.has(key);
}

/** `true` when this key closes the panel and restores focus (§10.8). */
export function isCloseKey(key: string): boolean {
  return CLOSE.has(key);
}

/**
 * The ids the arrow keys walk, in lane order.
 *
 * Derived from `promiseNodes`, so the keyboard order and the painted order are the
 * same order by construction — they cannot drift, because there is only one sort.
 */
export function navOrder(layout: GraphLayout): readonly string[] {
  return promiseNodes(layout).map((node) => node.id);
}

/**
 * Where focus goes for `key`, given where it is now.
 *
 * `null` in means "the graph has just been entered", and every key answers with an
 * end of the lane rather than with nothing, so the first keystroke after `Tab`
 * always lands somewhere. `null` out means there is nowhere to go: the lane is
 * empty. An id that is not in the order is treated as an entry, because a promise
 * that has left the snapshot cannot be the anchor of a step.
 */
export function nextFocus(
  order: readonly string[],
  current: string | null,
  key: NavKey,
): string | null {
  if (order.length === 0) return null;
  const first = order[0] ?? null;
  const last = order[order.length - 1] ?? null;

  if (FIRST.has(key)) return first;
  if (LAST.has(key)) return last;

  const at = current === null ? -1 : order.indexOf(current);
  if (at === -1) return FORWARD.has(key) ? first : last;

  if (FORWARD.has(key)) return order[Math.min(at + 1, order.length - 1)] ?? last;
  if (BACKWARD.has(key)) return order[Math.max(at - 1, 0)] ?? first;
  return current;
}

/**
 * The id `?p=<id>` selects, or `null`.
 *
 * Only ever returns an id the order contains, so every downstream reader — the
 * panel, the node's selected state, the list's pressed state — is looking at a
 * promise that exists in this snapshot.
 */
export function resolveSelection(
  order: readonly string[],
  parameter: string | null | undefined,
): string | null {
  if (parameter === null || parameter === undefined || parameter === '') return null;
  return order.includes(parameter) ? parameter : null;
}

/** The query parameter design §9.6 deep-links a promise with. */
export const SELECTION_PARAM = 'p';

/**
 * The selection encoded in a query string, whatever shape it arrives in.
 *
 * Takes the raw `location.search` rather than a parsed object so the browser and a
 * test read the same code path, and so the parsing lives beside the walk it feeds.
 */
export function selectionFromSearch(search: string, order: readonly string[]): string | null {
  const query = search.startsWith('?') ? search.slice(1) : search;
  return resolveSelection(order, new URLSearchParams(query).get(SELECTION_PARAM));
}
