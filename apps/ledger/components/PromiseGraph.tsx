/**
 * `PromiseGraph` — the hero. Design §10.2, §10.3, §10.8, §10.10, R8.1, R8.2, R8.3,
 * R10.7, R10.8.
 *
 * Four lanes, left to right: the documents a claim was read from, the promises
 * themselves, the designed tests, the sealed evidence. Selecting a promise opens the
 * panel beside the canvas; `?p=<id>` opens the same panel on load, so any state of this
 * page is a URL someone can send.
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
 * pane stacking that panning needs. Its default theme is deliberately not loaded, so
 * the palette on this page is the one in `tokens.css` and no third-party colour reaches
 * it.
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
 * ## Density (R10.8)
 *
 * One grid: `minmax(0, 1fr)` for the canvas, 240px for the list, 440px for the panel
 * when it is open. The canvas is the column that yields, so between 1280 and 1920 the
 * page has nothing to overflow — asserted in `test/promise-graph-density.test.ts`.
 */

'use client';

import {
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import clsx from 'clsx';
import type { LedgerSnapshot, SnapshotEvidence, SnapshotPromise } from '@kept/core';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import {
  NODE_H,
  NODE_W,
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

import { LaneNode } from './LaneNode.js';
import { PromiseList } from './PromiseList.js';
import { PromiseNode } from './PromiseNode.js';
import { PromisePanel } from './PromisePanel.js';

import '@xyflow/react/dist/base.css';
import '../styles/promise-graph.css';

/** Footprint of the three context lanes, mirrored from `promise-node.css`. */
const LANE_NODE_W = 240;
const LANE_NODE_H = 44;

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
 * A promise node's data. A `type` alias rather than an `interface`, because React Flow
 * requires `Record<string, unknown>` and only an alias gets the implicit index
 * signature that satisfies it.
 */
type PromiseNodeData = {
  readonly promise: SnapshotPromise;
  readonly selected: boolean;
  readonly select: (id: string) => void;
  readonly register: (id: string, element: HTMLElement | null) => void;
};

type LaneNodeData = {
  readonly lane: Exclude<LaneKind, 'promise'>;
  readonly name: string;
};

type PromiseFlowNode = Node<PromiseNodeData, 'promise'>;
type LaneFlowNode = Node<LaneNodeData, 'lane'>;

/**
 * Handles exist because an edge needs two endpoints to attach to; they are painted to
 * nothing in `promise-graph.css` and take no pointer, because a promise is not
 * something a reader wires up by hand.
 */
function PromiseFlowNodeView({ data }: NodeProps<PromiseFlowNode>) {
  return (
    <>
      <Handle isConnectable={false} position={Position.Left} type="target" />
      <PromiseNode
        onSelect={data.select}
        promise={data.promise}
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

/** Module scope, so React Flow is never handed a new map on a re-render. */
const NODE_TYPES: NodeTypes = { promise: PromiseFlowNodeView, lane: LaneFlowNodeView };

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

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    resolveSelection(order, initialSelectedId ?? null),
  );

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

  const nodes = useMemo<Node[]>(
    () =>
      layout.nodes.map((node): Node => {
        if (node.kind === 'promise') {
          const data: PromiseNodeData = {
            promise: node.promise,
            selected: node.promise.id === selectedId,
            select,
            register,
          };
          return {
            id: node.id,
            type: 'promise',
            position: { x: node.x, y: node.y },
            data,
            width: NODE_W,
            height: NODE_H,
            draggable: false,
            selectable: false,
            connectable: false,
          };
        }
        const data: LaneNodeData = { lane: node.kind, name: laneName(node) };
        return {
          id: node.id,
          type: 'lane',
          /* Centred on the promise row it belongs to: the chip is shorter than a node,
             and this is presentation over the layout rather than a change to it — the
             coordinates `lib/layout.ts` computed are untouched. */
          position: { x: node.x, y: node.y + (NODE_H - LANE_NODE_H) / 2 },
          data,
          width: LANE_NODE_W,
          height: LANE_NODE_H,
          draggable: false,
          selectable: false,
          connectable: false,
        };
      }),
    [layout.nodes, register, select, selectedId],
  );

  const edges = useMemo<Edge[]>(
    () =>
      layout.edges.map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        focusable: false,
        selectable: false,
        data: { kind: edge.kind },
      })),
    [layout.edges],
  );

  const selected = promises.find((promise) => promise.id === selectedId) ?? null;
  const pack: SnapshotEvidence | null =
    selected === null || selected.evidencePackId === null
      ? null
      : snapshot.evidence.find((entry) => entry.id === selected.evidencePackId) ?? null;

  return (
    <div
      className={clsx('promise-graph', className)}
      data-panel={selected === null ? 'closed' : 'open'}
      onKeyDown={onSectionKeyDown}
    >
      <div>
        <p className="promise-graph__caption">{GRAPH_CAPTION}</p>
        <div className="promise-graph__canvas">
          {/* Gated on the *promise* lane rather than on the node count, and Property 23
              found the difference: a schema-valid snapshot may carry an evidence pack
              that no promise references, and the pack alone was enough to draw a canvas
              holding one stray chip and no subject. This is a graph *of promises*, so
              zero promises is the empty state (§10.10) whatever else happens to be in
              the file — which is also what the sentence below already said. */}
          {promises.length === 0 ? (
            <p className="promise-graph__empty">{GRAPH_EMPTY}</p>
          ) : (
            <ReactFlow
              aria-label={GRAPH_LABEL}
              ariaLabelConfig={ARIA_LABELS}
              colorMode="dark"
              disableKeyboardA11y
              edges={edges}
              elementsSelectable={false}
              fitView
              fitViewOptions={{ padding: 0.12 }}
              maxZoom={1.5}
              minZoom={0.5}
              nodeTypes={NODE_TYPES}
              nodes={nodes}
              nodesConnectable={false}
              nodesDraggable={false}
              nodesFocusable={false}
              onKeyDown={onCanvasKeyDown}
              tabIndex={0}
              zoomOnDoubleClick={false}
            />
          )}
        </div>
      </div>

      <div>
        <p className="graph-list__caption">{promises.length} promises, most urgent first</p>
        <PromiseList onSelect={select} promises={promises} selectedId={selectedId} />
      </div>

      {selected === null ? null : (
        <PromisePanel evidence={pack} onClose={close} promise={selected} />
      )}
    </div>
  );
}
