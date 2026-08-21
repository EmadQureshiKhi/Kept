/**
 * Deterministic lane layout — design §10.3, R9.6 (via the graph's freshness
 * ordering), R10.8, Property 23's reachability clause.
 *
 * Every node's position is arithmetic over the snapshot: lane index times a fixed
 * x, row index times a fixed row height. There is no layout engine, no force
 * simulation and no settling, which is the point. A physics layout would place the
 * same graph differently on a different machine, on a different frame budget, or
 * simply twice in a row, and then the graph in the video would not be the graph in
 * the deployed build. React Flow is used downstream for panning, zooming, edges
 * and the viewport only; it is never asked where anything goes.
 *
 * Lanes, left to right (§10.3): documents, promises, designed tests, evidence.
 *
 * ## The geometry, and why it is stated as one pitch
 *
 * A 320px node on a 400px lane pitch and an 88px node on a 112px row pitch. So every
 * adjacent pair of lanes gets the same 80px gutter and every pair of stacked rows the same
 * 24px one, and both facts are consequences of two numbers rather than of four hand-picked
 * offsets that have to be kept in step by hand.
 *
 * They were not, previously, and it showed: the lanes sat at `[0, 360, 760, 1080]`, which
 * is a 40px gutter, then an 80px gutter, then **nothing at all** — a 320px node at x 760
 * ends at exactly 1080, where lane 3 started, so the designed-test and evidence columns
 * were one column and their text ran through each other. The context chips were 44px tall
 * around 48px of content, so each of them clipped its own name as well. `layout.test.ts`
 * now asserts the gutters are positive and equal and that no two painted boxes intersect,
 * because "looks fine" is not a measurement and this is what "looks fine" was hiding.
 *
 * Rows within a lane sort by `(verdict rank, id)` with red first, so the promises
 * that need attention are where the eye already is. Only promises carry a verdict,
 * so the other three lanes sort by id alone — the same comparator with a constant
 * rank. Ids are compared by code unit rather than by locale: `localeCompare`
 * depends on ICU data and the host's locale, and a row order that moved between
 * machines would defeat the whole reason this module exists.
 *
 * Motion is layered on top of these coordinates and never feeds back into them
 * (§10.3), so the resting state after an entrance animation is byte-identical to
 * the no-motion render.
 *
 * The designed-test and evidence lanes are derived from the snapshot's `edges`
 * rather than re-hashed here. Ids of the form `t_…` exist because §9.1 puts a
 * `designed` edge from each promise to its test document, and the schema's
 * endpoint rule guarantees every edge endpoint resolves; deriving them from the
 * edges therefore cannot disagree with the edges, whereas recomputing a hash could.
 * It also keeps this module free of `node:crypto`, so it type-checks and runs
 * identically in a server component, a Node test and the browser.
 */

import type {
  LedgerSnapshot,
  SnapshotDocument,
  SnapshotEdge,
  SnapshotEvidence,
  SnapshotPromise,
  Verdict,
} from '@kept/core';

/** Widest node in the graph — the promise node. Every lane pitch is measured from it. */
export const NODE_W = 320;

/**
 * Height of a promise node, and the height every row reserves.
 *
 * Raised from 76 because 76 was a guess that the content then outgrew: the node's three
 * rows sum to 60px of line box inside 16px of vertical padding, and a box that leaves no
 * slack clips the moment a line height or a padding step moves. 88 leaves 12px, and the
 * box is `border-box` so the border cannot eat into it.
 */
export const NODE_H = 88;

/** Footprint of the three context lanes' chips. Mirrored by `.lane-node`. */
export const LANE_NODE_W = 240;

/**
 * Height of a context-lane chip.
 *
 * Raised from 44, which was the clipping bug: the chip carries a 12px kind label, a 4px
 * gap and a 16px name line inside 16px of vertical padding — 48px of content in a 44px
 * box, so every document, designed-test and evidence chip cut its own name in half. 56
 * leaves 8px of slack. The chip is shorter than a promise node on purpose (it is context,
 * not a subject), but "shorter" is not the same as "shorter than its contents".
 */
export const LANE_NODE_H = 56;

/**
 * Horizontal distance between one lane's left edge and the next.
 *
 * One pitch for all four lanes, so every gutter is the same gutter. The previous offsets
 * — `[0, 360, 760, 1080]` — spent 40px between lanes 0 and 1, 80px between 1 and 2 and
 * **zero** between 2 and 3: a 320px node at x 760 ends at 1080, which is exactly where
 * lane 3 began, so the designed-test and evidence columns were the same column and their
 * text overlapped. A single pitch makes that arithmetically impossible rather than
 * carefully avoided.
 */
export const LANE_PITCH = 400;

/** The gutter every adjacent pair of lanes gets: pitch minus the widest node. */
export const LANE_GUTTER = LANE_PITCH - NODE_W;

/**
 * Lane x offsets, in order — `lane index × LANE_PITCH`.
 *
 * Written out rather than mapped so the tuple keeps its literal length, which `laneX`
 * relies on to refuse a fifth lane. `layout.test.ts` asserts it equals the multiplication.
 */
export const LANE_X = [0, 400, 800, 1200] as const;

/**
 * Vertical pitch between rows.
 *
 * Strictly greater than `NODE_H`, and by a whole spacing step: a lane whose rows touch is
 * a column of boxes rather than a lane, and 24px is the gutter that reads as one.
 */
export const ROW_H = 112;

/** The four lanes, in x order. The index into `LANE_X` is the lane's identity. */
export const LANES = ['document', 'promise', 'test', 'evidence'] as const;

export type LaneKind = (typeof LANES)[number];

/** Lane index per kind — `LANE_X[LANE_INDEX[kind]]` is that lane's x. */
export const LANE_INDEX: Readonly<Record<LaneKind, number>> = {
  document: 0,
  promise: 1,
  test: 2,
  evidence: 3,
};

/**
 * What each column is called, above the lanes.
 *
 * The reading order of §10.3 said in four words instead of only in the caption, so the
 * left-to-right story is legible without clicking anything. Headings are labels rather
 * than controls, so nothing here is a focus stop.
 */
export const LANE_HEADINGS: Readonly<Record<LaneKind, string>> = {
  document: 'Documents',
  promise: 'Promises',
  test: 'Designed tests',
  evidence: 'Evidence',
};

/** Height of a lane heading. */
export const LANE_HEADER_H = 32;

/**
 * y of the lane headings — above row 0, by one node gutter.
 *
 * Negative, so row 0 stays at y 0 and every row's y remains `row × ROW_H` plus a constant
 * that depends only on the node's own height. `LANE_HEADER_Y + LANE_HEADER_H` is `-24`,
 * which is the proof that a heading cannot touch the row beneath it.
 */
export const LANE_HEADER_Y = -(LANE_HEADER_H + (ROW_H - NODE_H));

/** The painted footprint of a node in each lane, in the one place both CSS and TS read. */
export const NODE_SIZE: Readonly<
  Record<LaneKind, { readonly width: number; readonly height: number }>
> = {
  document: { width: LANE_NODE_W, height: LANE_NODE_H },
  promise: { width: NODE_W, height: NODE_H },
  test: { width: LANE_NODE_W, height: LANE_NODE_H },
  evidence: { width: LANE_NODE_W, height: LANE_NODE_H },
};

/**
 * Sort rank per verdict — red first (§10.3).
 *
 * Read as urgency, not as severity: `red` is a promise the product breaks,
 * `stale` is one nothing has checked recently, `undesigned` is suite debt, and
 * `proven` needs no attention at all, so it sinks.
 */
export const VERDICT_RANK: Readonly<Record<Verdict, number>> = {
  red: 0,
  stale: 1,
  undesigned: 2,
  proven: 3,
};

/** Rank used by a lane whose nodes carry no verdict, so those lanes sort by id. */
const UNRANKED = Number.MAX_SAFE_INTEGER;

interface LayoutNodeBase {
  readonly id: string;
  readonly kind: LaneKind;
  /** Index into `LANE_X`. */
  readonly lane: number;
  /** Zero-based row within the lane. */
  readonly row: number;
  readonly x: number;
  readonly y: number;
  /** The painted footprint, so a bounding box is readable without a stylesheet. */
  readonly width: number;
  readonly height: number;
  /** Present only on a promise; the other lanes have nothing to be a verdict of. */
  readonly verdict: Verdict | null;
}

export interface DocumentLayoutNode extends LayoutNodeBase {
  readonly kind: 'document';
  readonly verdict: null;
  readonly document: SnapshotDocument;
}

export interface PromiseLayoutNode extends LayoutNodeBase {
  readonly kind: 'promise';
  readonly verdict: Verdict;
  readonly promise: SnapshotPromise;
}

export interface TestLayoutNode extends LayoutNodeBase {
  readonly kind: 'test';
  readonly verdict: null;
  /** Repo-relative path of the `*_test.md` document, or null if no promise named one. */
  readonly path: string | null;
  /** The authored `test_id`, when a promise carried one. */
  readonly testId: string | null;
  /** Every promise this document is the designed test for, in id order. */
  readonly promiseIds: readonly string[];
}

export interface EvidenceLayoutNode extends LayoutNodeBase {
  readonly kind: 'evidence';
  readonly verdict: null;
  readonly evidence: SnapshotEvidence;
}

export type LayoutNode =
  | DocumentLayoutNode
  | PromiseLayoutNode
  | TestLayoutNode
  | EvidenceLayoutNode;

export interface LayoutEdge {
  /** Stable, derived from the endpoints and kind, so React keys never collide. */
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: SnapshotEdge['kind'];
}

export interface GraphLayout {
  /** Every node, lane-major then row order — the order the keyboard model walks. */
  readonly nodes: readonly LayoutNode[];
  /** Every edge whose endpoints both resolved to a node. */
  readonly edges: readonly LayoutEdge[];
  /**
   * Endpoints that resolved to nothing. Empty for any snapshot the schema
   * accepted; surfaced rather than dropped silently so a future shape change shows
   * up as a visible count instead of a missing line.
   */
  readonly danglingEdges: readonly LayoutEdge[];
  /** Row count per lane, indexed as `LANE_X` is. */
  readonly laneRows: readonly number[];
  /** Extent of the laid-out graph, for the initial viewport. */
  readonly width: number;
  readonly height: number;
}

/** Code-unit comparison. Locale-independent, and therefore machine-independent. */
function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function byRankThenId(
  left: { rank: number; id: string },
  right: { rank: number; id: string },
): number {
  return left.rank === right.rank
    ? compareIds(left.id, right.id)
    : left.rank - right.rank;
}

/** x for a lane, by index. */
export function laneX(lane: number): number {
  const x = LANE_X[lane];
  if (x === undefined) {
    throw new RangeError(
      `laneX received lane ${lane}, but the layout has ${LANE_X.length} lanes ` +
        `(design §10.3). A fifth lane is a design change, not a coordinate.`,
    );
  }
  return x;
}

/**
 * y for a row in a given lane. Multiplication and one constant, nothing else.
 *
 * The row's own height is `ROW_H` and the tallest thing in it is a promise node, so a
 * shorter chip is centred in the band its row reserves — `(NODE_H − height) / 2`, a
 * constant per lane. That is presentation expressed as arithmetic rather than as an offset
 * applied later by a component: two renders of one snapshot still land on the same pixel,
 * and the y a test reads is the y a reader sees.
 */
export function rowY(row: number, kind: LaneKind = 'promise'): number {
  return row * ROW_H + (NODE_H - NODE_SIZE[kind].height) / 2;
}

/** The designed-test lane, derived from the snapshot's `designed` edges. */
function testLaneEntries(
  snapshot: LedgerSnapshot,
): { id: string; path: string | null; testId: string | null; promiseIds: string[] }[] {
  const promisesById = new Map(snapshot.promises.map((promise) => [promise.id, promise]));
  const byTestId = new Map<
    string,
    { id: string; path: string | null; testId: string | null; promiseIds: string[] }
  >();

  for (const edge of snapshot.edges) {
    if (edge.kind !== 'designed') continue;
    let entry = byTestId.get(edge.to);
    if (entry === undefined) {
      entry = { id: edge.to, path: null, testId: null, promiseIds: [] };
      byTestId.set(edge.to, entry);
    }
    const promise = promisesById.get(edge.from);
    if (promise === undefined) continue;
    entry.promiseIds.push(promise.id);
    if (promise.designedTest !== null) {
      entry.path ??= promise.designedTest.path;
      entry.testId ??= promise.designedTest.testId;
    }
  }

  for (const entry of byTestId.values()) entry.promiseIds.sort(compareIds);
  return [...byTestId.values()];
}

/**
 * The whole graph's geometry, as a pure function of the snapshot.
 *
 * Called twice with the same snapshot it returns deeply equal results, which is
 * the property the screenshots depend on and which the unit tests assert directly.
 */
export function layoutSnapshot(snapshot: LedgerSnapshot): GraphLayout {
  const nodes: LayoutNode[] = [];
  const laneRows: number[] = [0, 0, 0, 0];

  const place = <T extends LayoutNode>(
    kind: LaneKind,
    rows: readonly { rank: number; id: string; build: (row: number, x: number, y: number) => T }[],
  ): void => {
    const lane = LANE_INDEX[kind];
    const x = laneX(lane);
    const ordered = [...rows].sort(byRankThenId);
    ordered.forEach((entry, row) => {
      nodes.push(entry.build(row, x, rowY(row, kind)));
    });
    laneRows[lane] = ordered.length;
  };

  place(
    'document',
    snapshot.documents.map((document) => ({
      rank: UNRANKED,
      id: document.id,
      build: (row: number, x: number, y: number): DocumentLayoutNode => ({
        id: document.id,
        kind: 'document',
        lane: LANE_INDEX.document,
        row,
        x,
        y,
        width: NODE_SIZE.document.width,
        height: NODE_SIZE.document.height,
        verdict: null,
        document,
      }),
    })),
  );

  place(
    'promise',
    snapshot.promises.map((promise) => ({
      rank: VERDICT_RANK[promise.verdict],
      id: promise.id,
      build: (row: number, x: number, y: number): PromiseLayoutNode => ({
        id: promise.id,
        kind: 'promise',
        lane: LANE_INDEX.promise,
        row,
        x,
        y,
        width: NODE_SIZE.promise.width,
        height: NODE_SIZE.promise.height,
        verdict: promise.verdict,
        promise,
      }),
    })),
  );

  place(
    'test',
    testLaneEntries(snapshot).map((entry) => ({
      rank: UNRANKED,
      id: entry.id,
      build: (row: number, x: number, y: number): TestLayoutNode => ({
        id: entry.id,
        kind: 'test',
        lane: LANE_INDEX.test,
        row,
        x,
        y,
        width: NODE_SIZE.test.width,
        height: NODE_SIZE.test.height,
        verdict: null,
        path: entry.path,
        testId: entry.testId,
        promiseIds: entry.promiseIds,
      }),
    })),
  );

  place(
    'evidence',
    snapshot.evidence.map((evidence) => ({
      rank: UNRANKED,
      id: evidence.id,
      build: (row: number, x: number, y: number): EvidenceLayoutNode => ({
        id: evidence.id,
        kind: 'evidence',
        lane: LANE_INDEX.evidence,
        row,
        x,
        y,
        width: NODE_SIZE.evidence.width,
        height: NODE_SIZE.evidence.height,
        verdict: null,
        evidence,
      }),
    })),
  );

  const placed = new Set(nodes.map((node) => node.id));
  const edges: LayoutEdge[] = [];
  const danglingEdges: LayoutEdge[] = [];
  for (const edge of snapshot.edges) {
    const laid: LayoutEdge = {
      id: `${edge.kind}:${edge.from}->${edge.to}`,
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
    };
    if (placed.has(edge.from) && placed.has(edge.to)) edges.push(laid);
    else danglingEdges.push(laid);
  }

  const tallest = laneRows.reduce((most, count) => Math.max(most, count), 0);
  return {
    nodes,
    edges,
    danglingEdges,
    laneRows,
    width: laneX(LANE_X.length - 1) + NODE_W,
    height: tallest === 0 ? 0 : rowY(tallest - 1) + NODE_H,
  };
}

/** The promise nodes only, in the row order the keyboard model walks (§10.8). */
export function promiseNodes(layout: GraphLayout): readonly PromiseLayoutNode[] {
  return layout.nodes.filter((node): node is PromiseLayoutNode => node.kind === 'promise');
}

/**
 * How many rows the initial viewport frames.
 *
 * The rows are sorted `(verdict rank, id)` with red first, so framing the *top* of the
 * graph rather than centring the whole of it is what makes "most urgent first" a thing a
 * reader sees rather than a thing the sort knows. Four rows across four lanes is a legible
 * opening shot at a phone width and still shows the lane structure on a wide monitor.
 */
export const VIEWPORT_ROWS = 4;

/**
 * The ids the initial viewport is fitted to: every node in the first {@link VIEWPORT_ROWS}
 * rows of every lane.
 *
 * Falls back to the whole graph when it is shorter than that, so a two-promise snapshot is
 * framed rather than magnified past `maxZoom` and clipped.
 */
export function framingNodeIds(layout: GraphLayout): readonly string[] {
  const framed = layout.nodes.filter((node) => node.row < VIEWPORT_ROWS);
  return (framed.length === 0 ? layout.nodes : framed).map((node) => node.id);
}

/** A node's painted bounding box, in layout coordinates. */
export interface NodeBox {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Every node's bounding box.
 *
 * Exported so the non-overlap guarantee is *measured* rather than eyeballed: two boxes that
 * intersect are two nodes whose text is on top of each other, and that is arithmetic a test
 * can settle. `layout.test.ts` checks every pair.
 */
export function nodeBoxes(layout: GraphLayout): readonly NodeBox[] {
  return layout.nodes.map((node) => ({
    id: node.id,
    left: node.x,
    top: node.y,
    right: node.x + node.width,
    bottom: node.y + node.height,
  }));
}

/** `true` when two painted boxes share any area. Touching edges do not count. */
export function boxesIntersect(left: NodeBox, right: NodeBox): boolean {
  return (
    left.left < right.right &&
    right.left < left.right &&
    left.top < right.bottom &&
    right.top < left.bottom
  );
}

/**
 * The gutter between each adjacent pair of lanes, left to right.
 *
 * `LANE_X[n + 1] − (LANE_X[n] + NODE_W)`, so a zero or negative entry is two columns that
 * touch or overlap — which is the bug this module was carrying. One pitch for all four
 * lanes means every entry is {@link LANE_GUTTER}, and `layout.test.ts` asserts exactly
 * that rather than trusting the constants to stay in step.
 */
export function laneGutters(): readonly number[] {
  const gutters: number[] = [];
  for (let lane = 0; lane + 1 < LANE_X.length; lane += 1) {
    gutters.push(laneX(lane + 1) - (laneX(lane) + NODE_W));
  }
  return gutters;
}
