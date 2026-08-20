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

/** Lane x offsets, in order. Verbatim from design §10.3. */
export const LANE_X = [0, 360, 760, 1080] as const;

/** Vertical pitch between rows. Verbatim from design §10.3. */
export const ROW_H = 92;

/** Node footprint (§9.6), exported so the graph and the viewport agree on bounds. */
export const NODE_W = 320;
export const NODE_H = 76;

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

/** y for a row. Pure multiplication, which is what makes two renders identical. */
export function rowY(row: number): number {
  return row * ROW_H;
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
      nodes.push(entry.build(row, x, rowY(row)));
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
