/**
 * Deterministic lane layout — task 9.2, design §10.3, R10.8.
 *
 * The claims worth testing here are all about *sameness*: the same snapshot lays
 * out at the same coordinates twice, on any machine, in any locale, with red at
 * the top. Everything else in this file supports one of those.
 *
 * Two more claims joined them, and they are about *space* rather than sameness — because
 * the geometry this module shipped with was wrong in a way no determinism test could see.
 * The lanes sat at `[0, 360, 760, 1080]`: a 40px gutter, then 80px, then none at all, since
 * a 320px node at x 760 ends exactly where lane 3 began. And the context chips were 44px
 * tall around 48px of content. Both renders were perfectly deterministic and both clipped
 * their text. So:
 *
 *   - **equal, positive gutters** — every adjacent pair of lanes is checked, and checked to
 *     be *equal* as well as positive, because unequal gutters are what a zero gutter hides
 *     in;
 *   - **no two boxes intersect** — every pair of painted nodes, by bounding box, using the
 *     footprints the layout now carries on each node.
 *
 * Neither is a matter of taste, and neither can be satisfied by looking at a screenshot.
 */

import { describe, expect, it } from 'vitest';

import {
  LANES,
  LANE_GUTTER,
  LANE_HEADER_H,
  LANE_HEADER_Y,
  LANE_INDEX,
  LANE_NODE_H,
  LANE_NODE_W,
  LANE_PITCH,
  LANE_X,
  NODE_H,
  NODE_SIZE,
  NODE_W,
  ROW_H,
  VERDICT_RANK,
  VIEWPORT_ROWS,
  boxesIntersect,
  framingNodeIds,
  laneGutters,
  laneX,
  layoutSnapshot,
  nodeBoxes,
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

describe('the constants are one pitch, not four hand-picked offsets', () => {
  it('places every lane at its index times one pitch', () => {
    expect(LANE_X).toStrictEqual([0, 400, 800, 1200]);
    expect(LANE_PITCH).toBe(400);
    expect(
      LANE_X,
      'a lane offset that is not a multiple of the pitch is a gutter nobody chose',
    ).toStrictEqual(LANES.map((_, lane) => lane * LANE_PITCH));
    expect(ROW_H).toBe(112);
    expect(LANE_INDEX).toStrictEqual({ document: 0, promise: 1, test: 2, evidence: 3 });
  });

  it('states the two footprints, and gives each lane the one it paints', () => {
    expect([NODE_W, NODE_H]).toStrictEqual([320, 88]);
    expect([LANE_NODE_W, LANE_NODE_H]).toStrictEqual([240, 56]);
    expect(NODE_SIZE).toStrictEqual({
      document: { width: 240, height: 56 },
      promise: { width: 320, height: 88 },
      test: { width: 240, height: 56 },
      evidence: { width: 240, height: 56 },
    });
  });

  it('ranks red first and proven last', () => {
    expect(VERDICT_RANK).toStrictEqual({ red: 0, stale: 1, undesigned: 2, proven: 3 });
  });

  it('refuses a lane that does not exist rather than inventing an x', () => {
    expect(() => laneX(4)).toThrow(/four lanes|4 lanes|§10.3/);
    expect(laneX(0)).toBe(0);
    expect(laneX(3)).toBe(1200);
  });

  it('spaces rows by multiplication and one per-lane constant', () => {
    expect(rowY(0)).toBe(0);
    expect(rowY(1)).toBe(ROW_H);
    expect(rowY(7)).toBe(7 * ROW_H);
    /* a shorter chip is centred in the band its row reserves — a constant, not a measurement */
    expect(rowY(0, 'document')).toBe((NODE_H - LANE_NODE_H) / 2);
    expect(rowY(3, 'evidence')).toBe(3 * ROW_H + (NODE_H - LANE_NODE_H) / 2);
  });
});

/* ─────────── the geometry, measured rather than eyeballed (the clipping bug) ───── */

describe('every column has the same generous gutter', () => {
  it('leaves a positive, equal gutter between every adjacent pair of lanes', () => {
    const gutters = laneGutters();
    expect(gutters, 'four lanes have three gutters').toHaveLength(LANE_X.length - 1);
    for (const gutter of gutters) {
      expect(
        gutter,
        `two lanes are ${gutter}px apart. The bug this replaced put lane 3 at 1080 and ` +
          `ended lane 2's 320px node at exactly 1080, so the designed-test and evidence ` +
          `columns were one column and their text ran through each other.`,
      ).toBeGreaterThan(0);
    }
    expect(
      new Set(gutters).size,
      `the gutters are ${gutters.join(', ')}; unequal gutters are four offsets nobody is ` +
        `keeping in step, which is how the zero-gutter pair arrived`,
    ).toBe(1);
    expect(gutters).toStrictEqual([LANE_GUTTER, LANE_GUTTER, LANE_GUTTER]);
    expect(LANE_GUTTER).toBe(80);
  });

  it('leaves a real gutter between two stacked rows, in every lane', () => {
    for (const kind of LANES) {
      const gutter = ROW_H - NODE_SIZE[kind].height;
      expect(
        gutter,
        `${kind} nodes are ${NODE_SIZE[kind].height}px tall on a ${ROW_H}px row pitch, so ` +
          `two stacked rows are ${gutter}px apart; a lane of touching boxes is a column`,
      ).toBeGreaterThanOrEqual(8);
    }
    expect(ROW_H).toBeGreaterThan(NODE_H);
  });

  it('keeps the column headings clear of row 0', () => {
    expect(LANE_HEADER_Y).toBeLessThan(0);
    expect(
      LANE_HEADER_Y + LANE_HEADER_H,
      'a heading that reaches y 0 is a heading sitting on the most urgent promise',
    ).toBeLessThanOrEqual(0);
    expect(LANE_HEADER_Y + LANE_HEADER_H).toBe(-(ROW_H - NODE_H));
  });

  it('places no two nodes in overlapping boxes, over every pair in the graph', () => {
    const boxes = nodeBoxes(layout);
    expect(boxes.length, 'the committed snapshot lays out nothing').toBeGreaterThan(1);

    const offences: string[] = [];
    for (let first = 0; first < boxes.length; first += 1) {
      for (let second = first + 1; second < boxes.length; second += 1) {
        const left = boxes[first];
        const right = boxes[second];
        if (left === undefined || right === undefined) continue;
        if (!boxesIntersect(left, right)) continue;
        offences.push(
          `${left.id} [${left.left},${left.top}–${left.right},${left.bottom}] overlaps ` +
            `${right.id} [${right.left},${right.top}–${right.right},${right.bottom}]`,
        );
      }
    }
    expect(
      offences,
      `two painted nodes share area, which is two nodes' text on top of each other — the ` +
        `symptom this geometry was rewritten to remove:\n${offences.join('\n')}`,
    ).toStrictEqual([]);
  });

  it('reserves a box at least as tall as the content the stylesheet puts in it', () => {
    /* The content heights `promise-node.css` sums to, from the same --s-* steps it uses:
       a promise node is 16 (head, plus a 1px rank border either side) + 32 (two clamped
       claim lines) + 16 (citation) inside 8px of padding top and bottom; a context chip is
       12 (kind) + 4 (gap) + 16 (name) inside the same. A box smaller than that number is
       the clipping bug, arithmetically. */
    const promiseContent = 18 + 32 + 16 + 8 + 8;
    const chipContent = 12 + 4 + 16 + 8 + 8;
    expect(NODE_H, `a promise node needs ${promiseContent}px of content box`).toBeGreaterThanOrEqual(
      promiseContent,
    );
    expect(
      LANE_NODE_H,
      `a context chip needs ${chipContent}px; 44 was the bug — it clipped every document, ` +
        `designed-test and evidence name in half`,
    ).toBeGreaterThanOrEqual(chipContent);
  });
});

describe('the initial viewport frames the urgent end of the lane', () => {
  it('fits to the top rows rather than to the whole extent', () => {
    const framed = new Set(framingNodeIds(layout));
    expect(framed.size).toBeGreaterThan(0);
    for (const node of layout.nodes) {
      expect(
        framed.has(node.id),
        `${node.id} is in row ${node.row} and ${node.row < VIEWPORT_ROWS ? 'was not' : 'was'} framed`,
      ).toBe(node.row < VIEWPORT_ROWS);
    }
    /* the most urgent promise is in the opening shot, which is the point of the sort */
    expect(framed.has(promiseNodes(layout)[0]?.id ?? '')).toBe(true);
  });

  it('falls back to the whole graph when it is shorter than the frame', () => {
    const short = {
      ...snapshot,
      promises: snapshot.promises.slice(0, 1),
      documents: [],
      edges: [],
      evidence: [],
    };
    const laid = layoutSnapshot(short);
    expect(framingNodeIds(laid)).toStrictEqual(laid.nodes.map((node) => node.id));
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

  it('derives y from the row and the node\u2019s own height, and nothing else', () => {
    for (const node of layout.nodes) {
      expect(node.y).toBe(node.row * ROW_H + (NODE_H - node.height) / 2);
    }
  });

  it('carries the painted footprint its lane paints', () => {
    for (const node of layout.nodes) {
      expect({ width: node.width, height: node.height }).toStrictEqual(NODE_SIZE[node.kind]);
    }
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
    expect(layout.width).toBe(1200 + NODE_W);
    expect(layout.width).toBe(1520);
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

  it('paints the urgency order as row 0 downwards, which is what the numeral states', () => {
    const promises = promiseNodes(layout);
    expect(promises.map((node) => node.row)).toStrictEqual(promises.map((_, index) => index));
    /* the node the graph labels "1" is the node at the top of the lane */
    expect(promises[0]?.y).toBe(0);
  });

  it('lifts a red promise above a stale one regardless of id', () => {
    // Level the field first. The committed snapshot has been verified — seven
    // `proven` and one `red` — so reddening one more promise would leave two reds
    // and the assertion would be about which red sorts first, not about rank
    // beating id. Every promise starts `stale` here, and exactly one is reddened.
    const levelled = snapshot.promises.map((promise) => ({
      ...promise,
      verdict: 'stale' as const,
    }));
    const first = levelled[0];
    const last = levelled[levelled.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (first === undefined || last === undefined) return;
    // Redden whichever id sorts *last*, so only the rank can put it on top.
    const reddened = first.id > last.id ? first : last;
    const promises = levelled.map((promise) =>
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
    expect(laid.width).toBe(1200 + NODE_W);
    expect(framingNodeIds(laid)).toStrictEqual([]);
  });
});
