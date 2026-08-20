/**
 * The keyboard model, as arithmetic — task 9.6, design §10.8, R10.7.
 *
 * `test/promise-graph.test.tsx` asserts the bindings: that a `keydown` on the canvas
 * moves DOM focus, that `Enter` opens the panel, that `Escape` puts focus back. This
 * file asserts the *model* those bindings consume, on the committed snapshot and on the
 * two structural extremes — no promises at all, and one promise — because those are the
 * cases where an off-by-one in a walk stops being visible.
 *
 * No DOM here: the module under test is checked under the repository's no-DOM `lib`
 * (root `tsconfig.json`), and so is this file.
 */

import { describe, expect, it } from 'vitest';

import {
  CLOSE_KEYS,
  NAV_BACKWARD_KEYS,
  NAV_FORWARD_KEYS,
  NAV_KEYS,
  SELECTION_PARAM,
  SELECT_KEYS,
  isCloseKey,
  isNavKey,
  isSelectKey,
  navOrder,
  nextFocus,
  resolveSelection,
  selectionFromSearch,
} from '../lib/graphNav.js';
import { VERDICT_RANK, layoutSnapshot } from '../lib/layout.js';
import { snapshot } from '../lib/snapshot.js';

const LAYOUT = layoutSnapshot(snapshot);
const ORDER = navOrder(LAYOUT);

/** The lane order, walked forwards from a given start. */
function walk(order: readonly string[], from: string | null, steps: number, key: 'ArrowDown' | 'ArrowUp'): string[] {
  const visited: string[] = [];
  let at = from;
  for (let step = 0; step < steps; step += 1) {
    at = nextFocus(order, at, key);
    if (at === null) break;
    visited.push(at);
  }
  return visited;
}

describe('the walk order is the painted order', () => {
  it('holds every promise in the committed snapshot, and only promises', () => {
    expect(ORDER).toHaveLength(snapshot.promises.length);
    expect([...ORDER].sort()).toEqual(snapshot.promises.map((promise) => promise.id).sort());
  });

  it('sorts by (verdict rank, id) with red first, exactly as the lane paints it', () => {
    const ranks = ORDER.map((id) => {
      const promise = snapshot.promises.find((entry) => entry.id === id);
      expect(promise, `${id} is in the walk order but not in the snapshot`).toBeDefined();
      return VERDICT_RANK[promise?.verdict ?? 'proven'];
    });
    expect([...ranks].sort((left, right) => left - right)).toEqual(ranks);
  });

  it('excludes the context lanes, because they are not focus stops (§10.8)', () => {
    const others = LAYOUT.nodes.filter((node) => node.kind !== 'promise').map((node) => node.id);
    expect(others.length, 'the committed snapshot has documents and designed tests').toBeGreaterThan(0);
    for (const id of others) expect(ORDER).not.toContain(id);
  });
});

describe('the arrow keys walk the lane and clamp at its ends', () => {
  it('reaches every promise from the first one with the forward key alone', () => {
    const first = ORDER[0] ?? null;
    expect(first).not.toBeNull();
    const visited = [first, ...walk(ORDER, first, ORDER.length - 1, 'ArrowDown')];
    expect(visited).toEqual([...ORDER]);
  });

  it('comes back the way it went', () => {
    const last = ORDER[ORDER.length - 1] ?? null;
    const visited = [last, ...walk(ORDER, last, ORDER.length - 1, 'ArrowUp')];
    expect(visited).toEqual([...ORDER].reverse());
  });

  it('clamps rather than wrapping, so the end of the lane is findable', () => {
    const first = ORDER[0] ?? '';
    const last = ORDER[ORDER.length - 1] ?? '';
    expect(nextFocus(ORDER, first, 'ArrowUp')).toBe(first);
    expect(nextFocus(ORDER, last, 'ArrowDown')).toBe(last);
  });

  it('treats both axes as the same lane, because the lane is one column', () => {
    const at = ORDER[1] ?? '';
    for (const key of NAV_FORWARD_KEYS) expect(nextFocus(ORDER, at, key)).toBe(ORDER[2]);
    for (const key of NAV_BACKWARD_KEYS) expect(nextFocus(ORDER, at, key)).toBe(ORDER[0]);
  });

  it('answers the first keystroke after Tab, whichever key it is', () => {
    for (const key of NAV_KEYS) {
      const landed = nextFocus(ORDER, null, key);
      expect(landed, `${key} from an unfocused graph went nowhere`).not.toBeNull();
      expect(ORDER).toContain(landed);
    }
    expect(nextFocus(ORDER, null, 'ArrowDown')).toBe(ORDER[0]);
    expect(nextFocus(ORDER, null, 'ArrowUp')).toBe(ORDER[ORDER.length - 1]);
    expect(nextFocus(ORDER, null, 'Home')).toBe(ORDER[0]);
    expect(nextFocus(ORDER, null, 'End')).toBe(ORDER[ORDER.length - 1]);
  });

  it('re-enters the lane when the anchor has left the snapshot', () => {
    expect(nextFocus(ORDER, 'p_000000000000', 'ArrowDown')).toBe(ORDER[0]);
    expect(nextFocus(ORDER, 'p_000000000000', 'ArrowUp')).toBe(ORDER[ORDER.length - 1]);
  });

  it('goes nowhere in an empty lane, rather than inventing a stop', () => {
    for (const key of NAV_KEYS) expect(nextFocus([], null, key)).toBeNull();
    expect(nextFocus([], 'p_000000000000', 'ArrowDown')).toBeNull();
  });

  it('stands still on a lane of one', () => {
    const single = ['p_1'];
    for (const key of NAV_KEYS) expect(nextFocus(single, 'p_1', key)).toBe('p_1');
  });
});

describe('the keys the graph consumes are the keys §10.8 names', () => {
  it('claims the four arrows and both ends, and nothing else', () => {
    expect([...NAV_KEYS]).toEqual(['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End']);
    for (const key of NAV_KEYS) expect(isNavKey(key)).toBe(true);
    for (const key of ['Tab', 'a', 'Enter', ' ', 'Escape', 'PageDown']) {
      expect(isNavKey(key), `${key} must reach the browser`).toBe(false);
    }
  });

  it('selects on Enter and on Space, in both spellings of Space', () => {
    expect([...SELECT_KEYS]).toEqual(['Enter', ' ', 'Spacebar']);
    for (const key of SELECT_KEYS) expect(isSelectKey(key)).toBe(true);
    expect(isSelectKey('Escape')).toBe(false);
  });

  it('closes on Escape, in both spellings', () => {
    expect([...CLOSE_KEYS]).toEqual(['Escape', 'Esc']);
    for (const key of CLOSE_KEYS) expect(isCloseKey(key)).toBe(true);
    expect(isCloseKey('Enter')).toBe(false);
  });
});

describe('a selection is only ever an id this snapshot carries', () => {
  it('resolves every promise in the snapshot', () => {
    for (const id of ORDER) expect(resolveSelection(ORDER, id)).toBe(id);
  });

  it('refuses an id from anywhere else, and every empty spelling of one', () => {
    for (const parameter of ['p_deadbeefdead', 'd_2aafe9714a4b', '', null, undefined]) {
      expect(resolveSelection(ORDER, parameter)).toBeNull();
    }
  });

  it('reads the id out of a query string, with or without its leading question mark', () => {
    const id = ORDER[0] ?? '';
    expect(selectionFromSearch(`?${SELECTION_PARAM}=${id}`, ORDER)).toBe(id);
    expect(selectionFromSearch(`${SELECTION_PARAM}=${id}`, ORDER)).toBe(id);
    expect(selectionFromSearch(`?other=1&${SELECTION_PARAM}=${id}`, ORDER)).toBe(id);
    expect(selectionFromSearch('', ORDER)).toBeNull();
    expect(selectionFromSearch('?other=1', ORDER)).toBeNull();
    expect(selectionFromSearch(`?${SELECTION_PARAM}=p_deadbeefdead`, ORDER)).toBeNull();
  });
});
