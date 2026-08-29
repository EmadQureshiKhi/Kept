/**
 * `PromiseGraph` — the hero. Design §10.2, §10.3, §10.8, §10.10, R8.1, R8.2, R8.3,
 * R10.7, R10.8.
 *
 * Four lanes, left to right: the documents a claim was read from, the promises
 * themselves, the designed tests, the sealed evidence. Selecting a promise opens the
 * panel beside the canvas; `?p=<id>` opens the same panel on load, so any state of this
 * page is a URL someone can send.
 *
 * ## The path lights, and everything else recedes
 *
 * Thirty-five lines in one ink across four lanes, and until this existed nothing in the
 * static picture said which of them belonged together. So pointing at a promise, arrowing to
 * one, or having one open in the panel lights *its* path: the document it was read from, the
 * designed test bound to it, the evidence pack sealed for it, and the edges between. Everything
 * else drops to a quarter of its ink. `lib/graphPath.ts` decides what the path is
 * and this file decides nothing about it: the relation is a pure function of the layout, so
 * it is proven over arbitrary snapshots rather than over a rendered canvas.
 *
 * Three properties of the highlight are deliberate:
 *
 *   - **It is opacity and nothing else.** No node changes hue, no verdict changes colour, no
 *     edge changes weight. Colour is the verdict channel (§10.4.3) and spending it on "is
 *     this line relevant" would put two meanings on one signal. A dimmed `red` promise is
 *     still red.
 *   - **It stops at one hop.** A designed test can be bound to several promises, so walking
 *     outwards from one would reach the others through their shared test and light most of
 *     the graph while claiming to show one chain. The shared test is on the path; the
 *     promises sharing it are not. See `graphPath.ts` for the argument in full.
 *   - **It adds nothing to the accessible tree.** Every fact the highlight makes visible is
 *     already in the panel as text and in the parallel `role="list"` as a row, so this is
 *     reinforcement for a reader who can see the canvas and never the only way to learn a
 *     relationship. Nothing here is announced, because nothing here is new information.
 *
 * ## What React Flow does here, and what it does not
 *
 * It pans, it zooms, it draws the edges and it owns the viewport transform (§10.3).
 * That is all. Every coordinate comes from `lib/layout.ts` — lane index times a fixed
 * x, row index times a fixed row height, rows sorted `(verdict rank, id)` with red
 * first — so the graph is arithmetic and two renders of one snapshot are identical.
 * Nothing here asks a layout engine where anything goes, dragging is off, and node
 * selection inside React Flow is off, because selection is the panel's business and
 * having two notions of "selected" is how they come to disagree.
 *
 * Only React Flow's `base.css` is imported: the functional half, the transforms and
 * pane stacking that panning needs, plus the geometry its background, controls and minimap
 * need to be positioned at all. Its default theme is deliberately not loaded, so every
 * colour on this page comes from `tokens.css` and the chrome is restyled in
 * `promise-graph.css` rather than themed over.
 *
 * ## The keyboard model (§10.8)
 *
 * `Tab` reaches the canvas, which is `role="application"` and takes the same focus ring
 * as everything else. Arrow keys walk the promise lane in its painted order, `Enter` and
 * `Space` open the panel, `Escape` closes it and returns focus to the node that opened
 * it. The order and the step arithmetic live in `lib/graphNav.ts` as pure functions, so
 * the model is proven over every schema-valid snapshot rather than over this tree.
 *
 * **The `role="application"` element is React Flow's own wrapper, and that is a
 * decision rather than an accident.** React Flow hard-codes `role="application"` on the
 * div it renders, after its prop spread, so the attribute cannot be overridden or moved.
 * Wrapping it in a *second* `role="application"` — which is the obvious way to write
 * §10.8 — puts two nested application regions in the accessibility tree, one of them
 * unlabelled, for no gain. So `tabIndex`, `aria-label` and the `keydown` handler are
 * passed *through* to that element instead: they survive the spread, where `role` and
 * `className` do not. The result is exactly one application region, and it is the one
 * that is focusable, labelled and owns the keys. `.promise-graph__canvas` around it is
 * geometry — the border, the height and the clip — and carries no role at all.
 *
 * For the same reason `ariaLabelConfig` blanks React Flow's two node and edge
 * descriptions. Their default text tells a reader they can select a node and move it
 * with the arrow keys, which is false here: dragging is off, selection is the panel's,
 * and the arrow keys are handled above. A description that describes another widget is
 * worse than none.
 *
 * Focus roves: nodes are `tabIndex={-1}` and are focused programmatically, so entering
 * the graph costs one `Tab` rather than one per promise. The container keeps focus until
 * the first arrow key, which is why the ring §10.8 asks for is visible at all: a
 * container that immediately handed focus to a node could never show one.
 *
 * The parallel `role="list"` beside the canvas is always in the DOM (§10.8) and every
 * row of it is a native `<button>`. So the graph is a *second* way to reach a promise,
 * never the only one — no part of this page depends on a pointer or on a canvas.
 *
 * ## What is on the canvas
 *
 * The reference is React Flow's own showcase, read into this paper/ink system rather than
 * copied out of its dark one: a framed canvas over a dotted ground, rounded slab nodes with
 * visible handles, smooth bezier edges, zoom and fit-view controls, and a minimap.
 *
 *   - **`<Background variant={Dots} />`** at the page's own 28px ruling, filled with ink at
 *     low alpha in `promise-graph.css`, so the canvas reads as paper rather than as a void.
 *   - **The frame** is `.surface-raised-2` on the container — a 2px ink border and the 6px
 *     offset slab — because §10.4.4 permits a shadow to be *declared* in `surfaces.css`
 *     only, so depth here is picked rather than authored.
 *   - **`<Controls />`** and **`<MiniMap />`**, both restyled to the same vocabulary and
 *     both keyboard reachable: the control buttons are native `<button>`s and take the
 *     shell's focus ring, and neither traps focus, because neither holds any.
 *   - **Four column headings** as nodes, so they pan with the lanes they name.
 *   - **The urgency numeral** on each promise node, and an initial viewport fitted to the
 *     *top* rows rather than to the whole extent, so the `(verdict rank, id)` sort is
 *     something a reader sees in the first second.
 *
 * Nothing here is interactive beyond panning, zooming and selecting: `nodesDraggable`,
 * `nodesConnectable` and `elementsSelectable` are all off, and the handles take no pointer.
 * The graph is a reading surface.
 *
 * ## Density and responsiveness (R10.8)
 *
 * One grid: `minmax(0, 1fr)` for the canvas, 240px for the list, 440px for the panel
 * when it is open. The canvas is the column that yields, so between 1280 and 1920 the
 * page has nothing to overflow — asserted in `test/promise-graph-density.test.ts`. Below
 * 1100px the fixed columns fold underneath in the same stylesheet, so the page has nothing
 * to overflow at 320px either. The canvas height is a `clamp` on viewport height rather
 * than a pinned 620px, and `fitView` runs with a `minZoom` low enough to get all four lanes
 * into a phone-width viewport instead of clipping the outer two.
 *
 * ## Cost
 *
 * `@xyflow/react` is the heaviest thing on the page, so the parallel list, the caption and
 * the panel are all plain markup in the same client component — client components are still
 * server-rendered, so the `role="list"` is in the first HTML and the page is useful before
 * the canvas hydrates. Deliberately *not* `next/dynamic`: `ssr: false` would take the graph
 * out of that HTML, and it is the hero. The node and edge arrays are memoised on the layout,
 * so panning and zooming re-derive neither.
 *
 * ## Motion (§10.6.1, §10.6.3, tasks 17.5 and 17.8)
 *
 * The canvas holds a ref, and `useGraphEntrance` plays the staggered entrance over the
 * promise nodes inside it once per session. Nothing else changes: the coordinates are
 * still the layout's, the entrance animates `opacity` and a 6px `translateY` from
 * those coordinates, and it releases both when it lands — so this tree renders
 * identically with motion on, with motion off, and on the second visit of a session
 * when the flourish does not run at all.
 *
 * `useEdgeDraw` watches the same lane for a *verdict change* and draws the edge to the
 * designed test that carried it (M1, §10.6.3). Both hooks read the painted graph and write
 * nothing back into the layout, and both are one line to delete — which is what §18.1's
 * drop order asks of them.
 */

'use client';

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type FitViewOptions,
  type MiniMapNodeProps,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import clsx from 'clsx';
import type { LedgerSnapshot, SnapshotEvidence, SnapshotPromise, Verdict } from 'kept-core';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { TOKENS } from '../lib/tokens.js';
import {
  LANES,
  LANE_HEADER_H,
  LANE_HEADER_Y,
  LANE_HEADINGS,
  LANE_INDEX,
  NODE_W,
  framingNodeIds,
  laneX,
  layoutSnapshot,
  promiseNodes,
  type LaneKind,
  type LayoutNode,
} from '../lib/layout.js';
import {
  SELECTION_PARAM,
  isCloseKey,
  isNavKey,
  isSelectKey,
  navOrder,
  nextFocus,
  resolveSelection,
  selectionFromSearch,
} from '../lib/graphNav.js';
import { pathOf } from '../lib/graphPath.js';
import { walkthroughSteps } from '../lib/walkthrough.js';

import { useEdgeDraw } from './EdgeDraw.js';
import { useGraphEntrance } from './GraphEntrance.js';
import { LaneHeader, LaneNode } from './LaneNode.js';
import { PromiseList } from './PromiseList.js';
import { PromiseNode } from './PromiseNode.js';
import { PromisePanel } from './PromisePanel.js';
import { Walkthrough } from './Walkthrough.js';

import '@xyflow/react/dist/base.css';
import '../styles/promise-graph.css';

/**
 * The zoom range the canvas allows.
 *
 * `MIN_ZOOM` is low enough that `fitView` can get four 320px lanes across 1520px of graph
 * into a 320px phone viewport rather than clipping the outer two; `MAX_ZOOM` is 1, because
 * the nodes are already authored at their reading size and a zoomed-in node is a blurrier
 * node, not a bigger one.
 */
const MIN_ZOOM = 0.18;
const MAX_ZOOM = 1;

/** Dot pitch of the paper ruling behind the lanes — `--grid-cell`, as a number. */
const DOT_GAP = 28;
const DOT_SIZE = 1.5;

/** The reading order, in words, above the canvas. */
export const GRAPH_CAPTION =
  'Left to right: the document a claim is written in, the promise, the designed test ' +
  'that would prove it, and the evidence a run sealed.';

/** What the canvas is called, for assistive technology and for the tests. */
export const GRAPH_LABEL = 'promise graph';

/** What the page says when the repository states nothing verifiable (§10.10). */
export const GRAPH_EMPTY =
  'This snapshot carries no promises, so there is nothing to draw. A promise appears ' +
  'here as soon as a document states a claim with a citation that resolves.';

/**
 * Classes the path highlight selects through, and the reason there are three of them.
 *
 * `promise-graph.css` dims a node or an edge that is not on the lit path, so it has to be
 * able to tell three cases apart: on the path, off it, and *not a subject at all*. The
 * third is the column headings, which are labels rather than data. Dimming the word
 * `Documents` while a reader follows a line into that lane would take away the one thing
 * telling them which lane they are looking at.
 *
 * Stated here rather than inline so the stylesheet, this file and the tests read one
 * spelling. React Flow puts a node's `className` on its own `.react-flow__node` wrapper and
 * an edge's on the `<g class="react-flow__edge">`, which is why the dim lands on the wrapper
 * and never on `.promise-node` inside it: the entrance of §10.6.1 writes and then releases
 * an inline `opacity` on that inner element, and a stylesheet rule aimed at the same
 * property on the same element would be a second author of it.
 */
export const NODE_CLASS = 'graph-node';
export const NODE_LIT_CLASS = 'graph-node--lit';
export const NODE_HEADER_CLASS = 'graph-node--header';

/** Set on the graph container while a path is lit, so the dim rules have a switch. */
export const PATH_ATTRIBUTE = 'data-path';
export const PATH_LIT = 'lit';
export const PATH_IDLE = 'idle';

/**
 * A promise node's data. A `type` alias rather than an `interface`, because React Flow
 * requires `Record<string, unknown>` and only an alias gets the implicit index
 * signature that satisfies it.
 */
type PromiseNodeData = {
  readonly promise: SnapshotPromise;
  readonly rank: number;
  readonly rankOf: number;
  readonly selected: boolean;
  readonly select: (id: string) => void;
  readonly register: (id: string, element: HTMLElement | null) => void;
};

type LaneNodeData = {
  readonly lane: Exclude<LaneKind, 'promise'>;
  readonly name: string;
};

type LaneHeaderData = {
  readonly lane: LaneKind;
  readonly heading: string;
};

type PromiseFlowNode = Node<PromiseNodeData, 'promise'>;
type LaneFlowNode = Node<LaneNodeData, 'lane'>;
type LaneHeaderFlowNode = Node<LaneHeaderData, 'laneHeader'>;

/**
 * Handles exist because an edge needs two endpoints to attach to. They are drawn — a small
 * ink-ringed dot on each side, the way React Flow's own showcase draws them, so the reader
 * can see where a line leaves a node and where it arrives — and they take no pointer,
 * because a promise is not something a reader wires up by hand.
 */
function PromiseFlowNodeView({ data }: NodeProps<PromiseFlowNode>) {
  return (
    <>
      <Handle isConnectable={false} position={Position.Left} type="target" />
      <PromiseNode
        onSelect={data.select}
        promise={data.promise}
        rank={data.rank}
        rankOf={data.rankOf}
        registerElement={data.register}
        selected={data.selected}
      />
      <Handle isConnectable={false} position={Position.Right} type="source" />
    </>
  );
}

function LaneFlowNodeView({ data }: NodeProps<LaneFlowNode>) {
  return (
    <>
      <Handle isConnectable={false} position={Position.Left} type="target" />
      <LaneNode kind={data.lane} name={data.name} />
      <Handle isConnectable={false} position={Position.Right} type="source" />
    </>
  );
}

/** A column heading. No handles: nothing connects to a label. */
function LaneHeaderFlowNodeView({ data }: NodeProps<LaneHeaderFlowNode>) {
  return <LaneHeader heading={data.heading} kind={data.lane} />;
}

/** Module scope, so React Flow is never handed a new map on a re-render. */
const NODE_TYPES: NodeTypes = {
  promise: PromiseFlowNodeView,
  lane: LaneFlowNodeView,
  laneHeader: LaneHeaderFlowNodeView,
};

/**
 * The four column headings, as nodes.
 *
 * Nodes rather than an overlay, so they pan and zoom with the lanes they name — a heading
 * pinned to the viewport would drift off its column the moment a reader panned sideways,
 * which is worse than no heading. Their ids are namespaced away from the snapshot's, and
 * they carry `data-lane-header` rather than `data-lane`, so neither the projection property
 * nor the keyboard model can mistake one for a subject.
 */
const HEADER_NODES: readonly Node[] = LANES.map((kind): Node => {
  const data: LaneHeaderData = { lane: kind, heading: LANE_HEADINGS[kind] };
  return {
    id: `lane-header:${kind}`,
    type: 'laneHeader',
    position: { x: laneX(LANE_INDEX[kind]), y: LANE_HEADER_Y },
    data,
    /* Never dimmed: a heading names its lane, and a reader following a line into a lane
       needs the name most at the moment everything around it has gone quiet. */
    className: `${NODE_CLASS} ${NODE_HEADER_CLASS}`,
    width: NODE_W,
    height: LANE_HEADER_H,
    draggable: false,
    selectable: false,
    connectable: false,
    focusable: false,
  };
});

/**
 * A minimap node's fill: the verdict, for a promise; the raised paper, for everything else.
 *
 * Read out of `lib/tokens.ts` rather than written as a literal, because an SVG `fill`
 * attribute does not resolve a custom property and a hex typed twice is a hex that drifts.
 * So the minimap is coloured by the same four values the stylesheet resolves (§10.4.1).
 */
const VERDICT_FILL: Readonly<Record<Verdict, string>> = {
  red: TOKENS['--verdict-red'],
  stale: TOKENS['--verdict-stale'],
  undesigned: TOKENS['--verdict-undesigned'],
  proven: TOKENS['--verdict-proven'],
};

function minimapNodeColor(node: Node): string {
  if (node.type !== 'promise') return TOKENS['--ink-050'];
  const { promise } = node.data as PromiseNodeData;
  return VERDICT_FILL[promise.verdict];
}

function minimapNodeStroke(): string {
  return TOKENS['--text-000'];
}

/** The minimap's own node shape, so a promise reads as a slab rather than a rounded blob. */
function MinimapNode({ x, y, width, height, color, strokeColor, className }: MiniMapNodeProps) {
  return (
    <rect
      className={className}
      fill={color}
      height={Math.max(height, 1)}
      stroke={strokeColor}
      width={Math.max(width, 1)}
      x={x}
      y={y}
    />
  );
}

/**
 * React Flow's own node and edge descriptions, blanked.
 *
 * Its defaults describe a graph a reader can drag nodes around in with the arrow keys.
 * Nothing here is draggable, selection belongs to the panel, and the arrow keys walk the
 * promise lane — so the default text describes a different widget, and a wrong
 * description is worse than no description. Module scope so the store is not handed a
 * new object on every render.
 */
const ARIA_LABELS = {
  'node.a11yDescription.default': '',
  'node.a11yDescription.keyboardDisabled': '',
  'edge.a11yDescription.default': '',
} as const;

/** What a context lane's chip names: a path where there is one, an id otherwise. */
function laneName(node: LayoutNode): string {
  switch (node.kind) {
    case 'document':
      return node.document.file;
    case 'test':
      return node.path ?? node.id;
    case 'evidence':
      return node.evidence.id;
    default:
      return node.id;
  }
}

export interface PromiseGraphProps {
  readonly snapshot: LedgerSnapshot;
  /**
   * The promise to open on first paint. Omit it and the graph reads `?p=<id>` from the
   * URL on mount, which is how a shared link opens the panel it names; pass it — `null`
   * included — and the URL is not consulted, which is how a test states its own initial
   * state.
   */
  readonly initialSelectedId?: string | null;
  readonly className?: string;
}

export function PromiseGraph({ snapshot, initialSelectedId, className }: PromiseGraphProps) {
  const layout = useMemo(() => layoutSnapshot(snapshot), [snapshot]);
  /** The promise lane, in the one order `lib/layout.ts` sorted it into. */
  const promises = useMemo<readonly SnapshotPromise[]>(
    () => promiseNodes(layout).map((node) => node.promise),
    [layout],
  );
  const order = useMemo(() => navOrder(layout), [layout]);
  const promiseCount = promises.length;

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    resolveSelection(order, initialSelectedId ?? null),
  );
  /** The promise a pointer is currently over, so the path lights without a click. */
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  /**
   * Which promise the path highlight belongs to, in precedence order.
   *
   * A pointer beats the keyboard beats the open panel, because each of the three is a
   * narrower statement of intent than the one after it: a reader moving a pointer over a node
   * is asking about *that* node right now, a reader who has arrowed to a node is asking about
   * where they are, and an open panel is the standing answer for as long as it is open. So
   * hovering a second promise while the panel is open previews the second one and returns to
   * the open one on the way out, which is the behaviour a reader expects from a preview.
   */
  const litId = hoveredId ?? focusedId ?? selectedId;
  const path = useMemo(() => pathOf(layout, litId), [layout, litId]);
  const lit = path.nodes.size > 0;

  /** The canvas, for the two orchestrations of §10.6 that read the painted graph. */
  const canvas = useRef<HTMLDivElement | null>(null);
  useGraphEntrance(canvas, promises.length);
  /* M1 (§10.6.3): when a promise's verdict moves, the edge to the test that moved it draws
     itself, once. The hook watches the lane's verdicts and animates nothing on first mount. */
  useEdgeDraw(canvas, promises);

  /** Live node elements, so the keyboard model has something to focus. */
  const elements = useRef(new Map<string, HTMLElement>());
  /** The node that opened the panel, so `Escape` has a node to return focus to. */
  const opener = useRef<string | null>(resolveSelection(order, initialSelectedId ?? null));

  const register = useCallback((id: string, element: HTMLElement | null): void => {
    if (element === null) elements.current.delete(id);
    else elements.current.set(id, element);
  }, []);

  const focusNode = useCallback((id: string): void => {
    setFocusedId(id);
    elements.current.get(id)?.focus();
  }, []);

  /** Mirrors the selection into the URL, so every state of this page is shareable. */
  const writeSelection = useCallback((id: string | null): void => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (id === null) url.searchParams.delete(SELECTION_PARAM);
    else url.searchParams.set(SELECTION_PARAM, id);
    window.history.replaceState(window.history.state, '', url);
  }, []);

  const select = useCallback(
    (id: string): void => {
      opener.current = id;
      setSelectedId(id);
      setFocusedId(id);
      writeSelection(id);
    },
    [writeSelection],
  );

  const close = useCallback((): void => {
    setSelectedId(null);
    writeSelection(null);
    const returnTo = opener.current ?? focusedId;
    if (returnTo !== null) elements.current.get(returnTo)?.focus();
  }, [focusedId, writeSelection]);

  /**
   * The guided chain: which step is showing, or null for closed.
   *
   * The state is here rather than in the panel because building the chain needs the amendments and
   * the evidence packs, which belong to the snapshot this component reads. `lib/walkthrough.ts`
   * decides what the steps are; the panel only asks for them to be shown.
   */
  const [walkStep, setWalkStep] = useState<number | null>(null);
  /* The control that opened it, so closing returns focus there rather than to the top of the
     document (§10.8), the same contract `Escape` on a node honours. */
  const walkOpener = useRef<HTMLElement | null>(null);

  const openWalkthrough = useCallback((): void => {
    walkOpener.current = document.activeElement as HTMLElement | null;
    setWalkStep(0);
  }, []);

  const closeWalkthrough = useCallback((): void => {
    setWalkStep(null);
    walkOpener.current?.focus();
  }, []);

  /* Closed whenever the selection moves, because a chain is about one promise: leaving it open
     across a change of subject would show step three of the previous promise's argument beside the
     next promise's panel. */
  useEffect(() => {
    setWalkStep(null);
  }, [selectedId]);

  /* `?p=<id>` on first paint, only when the caller did not state an initial selection.
     Read in an effect rather than on the server: the page is statically rendered from
     the committed snapshot (§10.1), so the query string is not available at build time
     and asking for it would make the route dynamic for a deep link. */
  useEffect(() => {
    if (initialSelectedId !== undefined) return;
    const fromUrl = selectionFromSearch(window.location.search, order);
    if (fromUrl === null) return;
    opener.current = fromUrl;
    setSelectedId(fromUrl);
    setFocusedId(fromUrl);
  }, [initialSelectedId, order]);

  const onCanvasKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (isNavKey(event.key)) {
        const next = nextFocus(order, focusedId, event.key);
        if (next === null) return;
        event.preventDefault();
        focusNode(next);
        return;
      }
      if (isSelectKey(event.key)) {
        const target = focusedId ?? order[0] ?? null;
        if (target === null) return;
        event.preventDefault();
        focusNode(target);
        select(target);
      }
    },
    [focusNode, focusedId, order, select],
  );

  /**
   * Hover, read through React Flow's own node callbacks.
   *
   * Handled here rather than by putting `onMouseEnter` on `PromiseNode`, for two reasons.
   * React Flow already knows which node the pointer is over and hands the node object over,
   * so the promise id needs no second derivation; and the node components stay free of a
   * concern that belongs to the graph rather than to a node. Only the promise lane answers:
   * a document chip has no path of its own, and lighting one would raise the question of
   * which of the promises citing it was meant.
   */
  const onNodeEnter = useCallback((_event: unknown, node: Node): void => {
    setHoveredId(node.type === 'promise' ? node.id : null);
  }, []);

  const onNodeLeave = useCallback((): void => {
    setHoveredId(null);
  }, []);

  /* `Escape` is handled on the section rather than on the canvas, so it closes the panel
     whether focus is on a node or inside the panel's own links (§10.8). */
  const onSectionKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (selectedId === null || !isCloseKey(event.key)) return;
      event.preventDefault();
      close();
    },
    [close, selectedId],
  );

  /**
   * The painted nodes, headings included.
   *
   * Every coordinate and every footprint is read straight off `layout.nodes` — the vertical
   * centring of a short chip inside its row band is arithmetic in `lib/layout.ts` now
   * rather than an offset applied here, so there is exactly one place that knows where a
   * node is. Memoised on the layout, so panning and zooming re-derive nothing.
   */
  const nodes = useMemo<Node[]>(
    () => [
      ...HEADER_NODES,
      ...layout.nodes.map((node): Node => {
        const shape = {
          position: { x: node.x, y: node.y },
          width: node.width,
          height: node.height,
          draggable: false,
          selectable: false,
          connectable: false,
          /* On the wrapper React Flow renders, so the dim never touches the inner
             `.promise-node` the entrance of §10.6.1 writes an inline opacity on. */
          className: path.nodes.has(node.id) ? `${NODE_CLASS} ${NODE_LIT_CLASS}` : NODE_CLASS,
        } as const;

        if (node.kind === 'promise') {
          const data: PromiseNodeData = {
            promise: node.promise,
            rank: node.row + 1,
            rankOf: promiseCount,
            selected: node.promise.id === selectedId,
            select,
            register,
          };
          return { id: node.id, type: 'promise', data, ...shape };
        }
        const data: LaneNodeData = { lane: node.kind, name: laneName(node) };
        return { id: node.id, type: 'lane', data, ...shape };
      }),
    ],
    [layout.nodes, path, promiseCount, register, select, selectedId],
  );

  /**
   * The edges: smooth beziers in ink, with the promise-to-test edge drawn heavier.
   *
   * The weight is not decoration. `designed` is the one edge kind a verdict travels along —
   * it is the path M1 draws when a verdict moves (§10.6.3) — so it is the line worth
   * following, and `promise-graph.css` gives it the extra stroke through the class named
   * here rather than through an inline style.
   */
  const edges = useMemo<Edge[]>(
    () =>
      layout.edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        type: 'default',
        className: path.edges.has(edge.id)
          ? `graph-edge graph-edge--${edge.kind} graph-edge--lit`
          : `graph-edge graph-edge--${edge.kind}`,
        focusable: false,
        selectable: false,
        data: { kind: edge.kind },
      })),
    [layout.edges, path],
  );

  /**
   * The opening shot: the top of the lanes, not the middle of the graph.
   *
   * `fitView` on its own centres the whole extent, which on an eight-row graph puts row
   * four in the middle of the canvas and the most urgent promise off the top edge — the
   * exact opposite of what the sort is for. Fitting to the first few rows of all four lanes
   * frames the urgent end and still shows the left-to-right story.
   */
  const fitViewOptions = useMemo<FitViewOptions>(
    () => ({
      padding: 0.1,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      nodes: framingNodeIds(layout).map((id) => ({ id })),
    }),
    [layout],
  );

  const selected = promises.find((promise) => promise.id === selectedId) ?? null;
  const pack: SnapshotEvidence | null =
    selected === null || selected.evidencePackId === null
      ? null
      : snapshot.evidence.find((entry) => entry.id === selected.evidencePackId) ?? null;

  /* The chain for whatever is selected. Built here because it reads the amendments and the evidence
     packs as well as the promise, and memoised on the id so opening the panel does not rebuild it
     on every keystroke. A chain of one step is a page rather than a sequence, so the trigger is
     withheld below rather than offering a walkthrough with nowhere to walk. */
  const steps = useMemo(
    () => (selectedId === null ? [] : walkthroughSteps(snapshot, selectedId)),
    [selectedId, snapshot],
  );

  return (
    <div
      className={clsx('promise-graph', className)}
      data-panel={selected === null ? 'closed' : 'open'}
      data-path={lit ? PATH_LIT : PATH_IDLE}
      onKeyDown={onSectionKeyDown}
    >
      {/* Five children, placed by name into a two-row grid rather than wrapped in a
          column div each — see the note over `.promise-graph` in `promise-graph.css`. The
          two captions share row 1 and are bottom-aligned in it, so the list's heading and
          the canvas's caption sit on one line and each block starts at the same y as the
          frame beside it. Wrapping each column in its own div is what put them at
          different heights: the taller caption pushed its canvas down and the shorter one
          left its list riding up above it. */}
      <p className="promise-graph__caption">{GRAPH_CAPTION}</p>
      <p className="graph-list__caption">{promises.length} promises, most urgent first</p>

      {/* `.surface-raised-2` frames the canvas: the 2px ink border and the 6px offset
          slab of §10.5, picked in the markup because a shadow may only be *declared* in
          `surfaces.css` (§10.4.4 rule 5). `.promise-graph__canvas` contributes geometry
          only — the fluid height and the clip. */}
      <div className="promise-graph__canvas surface-raised-2" ref={canvas}>
        {/* Gated on the *promise* lane rather than on the node count, and Property 23
            found the difference: a schema-valid snapshot may carry an evidence pack
            that no promise references, and the pack alone was enough to draw a canvas
            holding one stray chip and no subject. This is a graph *of promises*, so
            zero promises is the empty state (§10.10) whatever else happens to be in
            the file — which is also what the sentence above already said. */}
        {promises.length === 0 ? (
          <p className="promise-graph__empty">{GRAPH_EMPTY}</p>
        ) : (
          <ReactFlow
            aria-label={GRAPH_LABEL}
            ariaLabelConfig={ARIA_LABELS}
            colorMode="light"
            disableKeyboardA11y
            edges={edges}
            elementsSelectable={false}
            fitView
            fitViewOptions={fitViewOptions}
            maxZoom={MAX_ZOOM}
            minZoom={MIN_ZOOM}
            nodeTypes={NODE_TYPES}
            nodes={nodes}
            nodesConnectable={false}
            nodesDraggable={false}
            nodesFocusable={false}
            onKeyDown={onCanvasKeyDown}
            onNodeMouseEnter={onNodeEnter}
            onNodeMouseLeave={onNodeLeave}
            tabIndex={0}
            zoomOnDoubleClick={false}
          >
            {/* Paper texture rather than a decoration: the dot pitch is the page's own
                28px ruling, and the fill is ink at low alpha, authored in the stylesheet
                so no colour literal enters this file. */}
            <Background gap={DOT_GAP} size={DOT_SIZE} variant={BackgroundVariant.Dots} />
            <Controls
              className="graph-controls surface-raised"
              position="bottom-left"
              showInteractive={false}
            />
            <MiniMap
              className="graph-minimap surface-raised"
              nodeColor={minimapNodeColor}
              nodeComponent={MinimapNode}
              nodeStrokeColor={minimapNodeStroke}
              pannable
              position="bottom-right"
              zoomable
            />
          </ReactFlow>
        )}
      </div>

      <PromiseList onSelect={select} promises={promises} selectedId={selectedId} />

      {selected === null ? null : (
        <PromisePanel
          evidence={pack}
          onClose={close}
          onExplain={steps.length > 1 ? openWalkthrough : undefined}
          promise={selected}
        />
      )}

      {/* The guided chain, over everything. Offered only when there is a chain: a promise whose
          only step is its own claim has nothing to sequence, and `PromisePanel` renders no trigger
          in that case because `onExplain` is undefined. */}
      {selected === null || walkStep === null || steps.length <= 1 ? null : (
        <Walkthrough
          index={walkStep}
          onClose={closeWalkthrough}
          onIndexChange={setWalkStep}
          promise={selected}
          steps={steps}
        />
      )}
    </div>
  );
}
