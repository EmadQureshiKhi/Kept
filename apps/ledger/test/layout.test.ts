/**
 * Deterministic lane layout — task 9.2, design §10.3, R10.8.
 *
 * The claims worth testing here are all about *sameness*: the same snapshot lays
 * out at the same coordinates twice, on any machine, in any locale, with red at
 * the top. Everything else in this file supports one of those.
 */

import { describe, expect, it } from 'vitest';

import {
  LANES,
  LANE_INDEX,
  LANE_X,
  NODE_H,
  NODE_W,
  ROW_H,
  VERDICT_RANK,
  laneX,
  layoutSnapshot,
  promiseNodes,
  rowY,
} from '../lib/layout.js';
import type { LayoutNode } from '../lib/layout.js';
import { snapshot } from '../lib/snapshot.js';
import { scanLedger } from './_scan.js';

const layout = layoutSnapshot(snapshot);

/**
 * The layout module's own source, for the no-engine assertion. Read through the
 * shared scan helper rather than a second file walker (`test/_scan.ts` owns that).
 */
function layoutSourceText(): string {
  const found = scanLedger(['.ts']).find((file) => file.path.endsWith('lib/layout.ts'));
  if (found === undefined) throw new Error('lib/layout.ts was not found by the ledger scan.');
  return found.text;
}

function nodesInLane(kind: (typeof LANES)[number]): readonly LayoutNode[] {
  return layout.nodes.filter((node) => node.kind === kind);
}

describe('the constants are the design document verbatim', () => {
  it('places the four lanes where §10.3 says', () => {
    expect(LANE_X).toStrictEqual([0, 360, 760, 1080]);
    expect(ROW_H).toBe(92);
    expect(LANE_INDEX).toStrictEqual({ document: 0, promise: 1, test: 2, evidence: 3 });
  });

  it('ranks red first and proven last', () => {
    expect(VERDICT_RANK).toStrictEqual({ red: 0, stale: 1, undesigned: 2, proven: 3 });
  });

  it('refuses a lane that does not exist rather than inventing an x', () => {
    expect(() => laneX(4)).toThrow(/four lanes|4 lanes|§10.3/);
    expect(laneX(0)).toBe(0);
    expect(laneX(3)).toBe(1080);
  });

  it('spaces rows by multiplication alone', () => {
    expect(rowY(0)).toBe(0);
    expect(rowY(1)).toBe(ROW_H);
    expect(rowY(7)).toBe(7 * ROW_H);
  });
});

describe('the layout of the committed snapshot', () => {
  it('lays out every promise, exactly once', () => {
    const promises = promiseNodes(layout);
    expect(promises).toHaveLength(snapshot.promises.length);
    expect(new Set(promises.map((node) => node.id)).size).toBe(snapshot.promises.length);
    expect([...promises].map((node) => node.promise.id).sort()).toStrictEqual(
      snapshot.promises.map((promise) => promise.id).sort(),
    );
  });

  it('puts each lane at its own x and every node of a lane on that x', () => {
    for (const kind of LANES) {
      const lane = LANE_INDEX[kind];
      for (const node of nodesInLane(kind)) {
        expect(node.lane).toBe(lane);
        expect(node.x).toBe(LANE_X[lane]);
      }
    }
  });

  it('numbers rows from zero within each lane, with no gaps and no repeats', () => {
    for (const kind of LANES) {
      const rows = nodesInLane(kind).map((node) => node.row);
      expect(rows).toStrictEqual([...rows].sort((a, b) => a - b));
      expect(rows).toStrictEqual(rows.map((_, index) => index));
      expect(layout.laneRows[LANE_INDEX[kind]]).toBe(rows.length);
    }
  });

  it('derives y from the row and nothing else', () => {
    for (const node of layout.nodes) expect(node.y).toBe(node.row * ROW_H);
  });

  it('carries a verdict on promise nodes and on no others', () => {
    for (const node of layout.nodes) {
      if (node.kind === 'promise') expect(node.verdict).not.toBeNull();
      else expect(node.verdict).toBeNull();
    }
  });

  it('derives the designed-test lane from the designed edges', () => {
    const tests = nodesInLane('test');
    const designed = snapshot.edges.filter((edge) => edge.kind === 'designed');
    expect(tests).toHaveLength(new Set(designed.map((edge) => edge.to)).size);
    for (const node of tests) {
      expect(node.id.startsWith('t_')).toBe(true);
      if (node.kind !== 'test') throw new Error('lane filter returned the wrong kind');
      expect(node.path).toMatch(/_test\.md$/);
      expect(node.promiseIds.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('resolves every edge endpoint to a laid-out node', () => {
    expect(layout.danglingEdges).toStrictEqual([]);
    expect(layout.edges).toHaveLength(snapshot.edges.length);
    const ids = new Set(layout.nodes.map((node) => node.id));
    for (const edge of layout.edges) {
      expect(ids.has(edge.from)).toBe(true);
      expect(ids.has(edge.to)).toBe(true);
    }
    expect(new Set(layout.edges.map((edge) => edge.id)).size).toBe(layout.edges.length);
  });

  it('reports an extent wide enough for the rightmost lane', () => {
    expect(layout.width).toBe(1080 + NODE_W);
    const tallest = Math.max(...layout.laneRows);
    expect(layout.height).toBe((tallest - 1) * ROW_H + NODE_H);
  });
});

describe('ordering', () => {
  it('sorts red to the top and proven to the bottom', () => {
    const promises = promiseNodes(layout);
    const ranks = promises.map((node) => VERDICT_RANK[node.verdict]);
    expect(ranks).toStrictEqual([...ranks].sort((a, b) => a - b));
  });

  it('breaks a rank tie by id, ascending', () => {
    const promises = promiseNodes(layout);
    // Every promise in the committed snapshot is `stale`, so this is a pure id sort.
    const stale = promises.filter((node) => node.verdict === 'stale').map((node) => node.id);
    expect(stale).toStrictEqual([...stale].sort());
  });

  it('is independent of the order the snapshot lists promises in', () => {
    const reversed = { ...snapshot, promises: [...snapshot.promises].reverse() };
    expect(layoutSnapshot(reversed).nodes).toStrictEqual(layout.nodes);
  });

  it('lifts a red promise above a stale one regardless of id', () => {
    const first = snapshot.promises[0];
    const last = snapshot.promises[snapshot.promises.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (first === undefined || last === undefined) return;
    // Redden whichever id sorts *last*, so only the rank can put it on top.
    const reddened = first.id > last.id ? first : last;
    const promises = snapshot.promises.map((promise) =>
      promise.id === reddened.id ? { ...promise, verdict: 'red' as const } : promise,
    );
    const relaid = promiseNodes(layoutSnapshot({ ...snapshot, promises }));
    expect(relaid[0]?.id).toBe(reddened.id);
    expect(relaid[0]?.row).toBe(0);
    expect(relaid[0]?.y).toBe(0);
  });
});

describe('determinism', () => {
  it('produces deeply equal output for two runs on the same snapshot', () => {
    expect(layoutSnapshot(snapshot)).toStrictEqual(layoutSnapshot(snapshot));
  });

  it('produces identical coordinates across repeated runs', () => {
    const coordinates = (): string =>
      layoutSnapshot(snapshot)
        .nodes.map((node) => `${node.id}@${node.x},${node.y}`)
        .join('|');
    const first = coordinates();
    for (let attempt = 0; attempt < 5; attempt += 1) expect(coordinates()).toBe(first);
  });

  it('uses no layout engine, no clock and no randomness', () => {
    // The whole reason this module is hand-written: any of these would move a node
    // between two renders of the same snapshot, and the screenshots would jitter.
    const source = layoutSourceText();
    expect(source).not.toMatch(/dagre|elkjs|d3-force|Math\.random|Date\.now|new Date/);
  });
});

describe('the empty graph', () => {
  const empty = {
    ...snapshot,
    promises: [],
    documents: [],
    edges: [],
    evidence: [],
    metrics: {
      ...snapshot.metrics,
      totalPromises: 0,
      designedCount: 0,
      provenCount: 0,
      redCount: 0,
      staleCount: 0,
      undesignedCount: 0,
      designedCoverage: null,
      provenCoverage: null,
    },
  };

  it('lays out nothing, with no extent and no throw', () => {
    const laid = layoutSnapshot(empty);
    expect(laid.nodes).toStrictEqual([]);
    expect(laid.edges).toStrictEqual([]);
    expect(laid.laneRows).toStrictEqual([0, 0, 0, 0]);
    expect(laid.height).toBe(0);
    expect(laid.width).toBe(1080 + NODE_W);
  });
});
