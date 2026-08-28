/**
 * M1 — the edge draw along the verdict path (design §10.6.3, §10.6.4, §18.1, R10.4,
 * task 17.8).
 *
 * When a promise's verdict moves, the edge between that promise and the test designed to
 * prove it draws itself 0 → 100% over `--dur-slow`, once, inside a single `--dur-pulse`
 * envelope. §10.6.3 says what it is for: it shows **which** test moved the verdict, which
 * is causality the static graph can only imply.
 *
 * §18.1 puts this first in the drop order — lowest information density of the five, and the
 * fiddliest against React Flow's edge internals. Everything below is written to make that
 * cut cheap: the module is self-contained, `PromiseGraph` consumes it in one line, and the
 * fallback §18.1 names — "static edge in `--hairline-strong`; the panel already names which
 * test moved the verdict" — is what the page renders the moment this file is deleted.
 *
 * ── What is verifiable here, and what is not ─────────────────────────────────────
 *
 * **jsdom paints no React Flow edge at all.** It does no layout, so React Flow measures a
 * zero-size pane, positions nothing, and renders no `.react-flow__edge-path`. A test
 * asserting a drawn edge over a jsdom render of `/` would be asserting nothing, and
 * `motion-m1-edge-draw.test.tsx` says so out loud and then asserts what *is* assertable:
 * the selection (which edge, for which promise, on which change), the arithmetic, the end
 * state under reduced motion, the single pass, and the release. The visual result — a line
 * that wipes in from its source end — is **unverifiable under jsdom** and is checked by
 * eye in a browser. That is stated rather than dressed up.
 *
 * ── The three decisions ──────────────────────────────────────────────────────────
 *
 * 1. **`svg.createDrawable`, and therefore an SVG geometry element, is the target.** The
 *    helper returns a proxy over each path whose `draw` property writes `pathLength`,
 *    `stroke-dasharray` and `stroke-dashoffset` together; it is typed as the element
 *    intersected with that property, so it passes through the gate as an ordinary target.
 *    Writing the dash pair by hand instead would mean re-deriving a path's length in this
 *    file, which is exactly the fiddliness §18.1 warns about.
 * 2. **One pass, and the pass is the whole gesture.** The draw occupies `--dur-slow` at
 *    position 0; a zero-duration `set` at `--dur-pulse` holds the timeline open to 1.4 s
 *    and writes the same fully-drawn value again. So the *single* pulse §10.6.3 asks for is
 *    one timeline of a stated length with nothing after it — no repeat, no ping-pong, no
 *    ambient redraw. `motionTimeline` pins the loop parameter off for every timeline in the
 *    application, so a loop cannot arrive here by accident either.
 * 3. **The drawable's attributes are handed back when it lands.** A drawn edge and an edge
 *    that never animated must be the same bytes (§18.1, §10.6.4), and `createDrawable`
 *    leaves four attributes behind. They are removed after the pulse, so the resting edge
 *    is the stylesheet's again — the attribute analogue of `motionRelease.tsx`, which
 *    removes inline *style* declarations for M3, M4 and M5.
 *
 * Not a component: a hook and the orchestration it drives, in `components/` because that is
 * where the import scan of task 17.2 permits a gate consumer to live.
 */

'use client';

import type { SnapshotPromise, Verdict } from 'kept-core';
import { useEffect, useRef, type RefObject } from 'react';

import {
  drawable,
  durationMs,
  easeFor,
  motionEnabled,
  motionTimeline,
  play,
  type MotionEndState,
  type MotionPlayback,
  type MotionSpec,
} from '../lib/motion.js';

/** React Flow's own wrapper for one edge. It carries the layout's edge id in `data-id`. */
export const EDGE_SELECTOR = '.react-flow__edge[data-id]';

/** The geometry inside that wrapper — the line a reader sees. */
export const EDGE_PATH_SELECTOR = 'path.react-flow__edge-path';

/**
 * The prefix `lib/layout.ts` gives the promise → designed-test edge.
 *
 * Edge ids are `${kind}:${from}->${to}`, so this both names the kind M1 draws and excludes
 * the other two: a `cites` edge runs from a document to a promise and a `sealed` edge from a
 * promise to its evidence pack, and neither is a path a verdict travelled.
 */
export const DESIGNED_EDGE_PREFIX = 'designed:';

/** The four attributes `svg.createDrawable` writes, and therefore the ones released. */
export const EDGE_DRAW_ATTRIBUTES = [
  'draw',
  'stroke-dasharray',
  'stroke-dashoffset',
  'pathLength',
] as const;

/** Nothing drawn yet, and fully drawn — the two ends of `draw`, in its own notation. */
export const EDGE_DRAW_FROM = '0 0';
export const EDGE_DRAW_TO = '0 1';

/** The id of the edge from `promiseId` to its designed test, as the layout spells it. */
export function designedEdgeIdPrefix(promiseId: string): string {
  return `${DESIGNED_EDGE_PREFIX}${promiseId}->`;
}

/**
 * The edge paths between `promiseId` and its designed test, in document order.
 *
 * Matched by walking the rendered edges and comparing the id prefix, rather than through an
 * attribute selector: a promise id is a hash and an edge id contains `>`, and quoting that
 * into a selector correctly is a worse bet than a string comparison. Empty under jsdom,
 * always — see the header.
 */
export function verdictEdgePaths(root: ParentNode, promiseId: string): SVGPathElement[] {
  const prefix = designedEdgeIdPrefix(promiseId);
  const found: SVGPathElement[] = [];
  for (const edge of root.querySelectorAll<SVGGElement>(EDGE_SELECTOR)) {
    if (!(edge.getAttribute('data-id') ?? '').startsWith(prefix)) continue;
    found.push(...edge.querySelectorAll<SVGPathElement>(EDGE_PATH_SELECTOR));
  }
  return found;
}

/** The end state: fully drawn, which is how a static edge already looks. */
export function edgeDrawEnd(): MotionEndState {
  return { draw: EDGE_DRAW_TO };
}

/** Hands the paths back to the stylesheet by removing what the drawable wrote. */
export function releaseEdgeDraw(paths: readonly Element[]): void {
  for (const path of paths) {
    for (const attribute of EDGE_DRAW_ATTRIBUTES) path.removeAttribute(attribute);
  }
}

/** What `svg.createDrawable` hands back: each path, plus the `draw` property. */
export type EdgeDrawables = ReturnType<typeof drawable>;

/**
 * The drawable proxies for a set of paths — **the targets, and not the paths themselves.**
 *
 * The distinction is the whole mechanism. Writing `draw` on a proxy runs the helper's own
 * `setAttribute`, which recomputes `stroke-dasharray` and `stroke-dashoffset` from the path's
 * length; writing it on the bare element sets a `draw` attribute that no renderer reads and
 * leaves the dash pair at `0 <length>` — a line that is fully *undrawn*. So an end state
 * applied to the element would hide the edge instead of showing it, which is the opposite of
 * what §10.6.4 requires of the reduced-motion branch. Everything downstream of here targets
 * the proxies for that reason.
 */
export function edgeDrawables(paths: readonly Element[]): EdgeDrawables {
  return drawable([...paths] as Parameters<typeof drawable>[0]);
}

/**
 * One timeline: the draw at `--dur-slow`, inside a `--dur-pulse` envelope, once.
 *
 * The trailing `set` is not a second animation. It is a zero-duration write of the value the
 * draw already reached, positioned at the end of the envelope, so the timeline's own length
 * *is* the 1.4 s §10.6.3 states and the drawn edge is held rather than released early.
 */
export function edgeDrawSpec(drawables: EdgeDrawables): MotionSpec {
  return {
    to: edgeDrawEnd(),
    run: () =>
      motionTimeline()
        .add(
          drawables,
          {
            draw: [EDGE_DRAW_FROM, EDGE_DRAW_TO],
            duration: durationMs('--dur-slow'),
            ease: easeFor('--ease-out'),
          },
          0,
        )
        .set(drawables, { draw: EDGE_DRAW_TO }, durationMs('--dur-pulse')),
  };
}

/** The pulse currently running, if one is. Completed before another starts (§10.6.4). */
let running: MotionPlayback | null = null;

/**
 * Draws the edge from `promiseId` to its designed test, once, and resolves at rest.
 *
 * A no-op — an already-resolved promise, no drawable created, nothing written — when the
 * graph has no such edge painted. That is every jsdom render and also the honest answer for
 * a promise with no designed test: there is no path, because there is no test, which is the
 * suite debt the rail counts rather than something to animate.
 *
 * @param onPlayback receives the timeline, so an unmounting graph can complete it.
 */
export function playEdgeDraw(
  root: ParentNode,
  promiseId: string,
  onPlayback?: (playback: MotionPlayback) => void,
): Promise<void> {
  const paths = verdictEdgePaths(root, promiseId);
  if (paths.length === 0) return Promise.resolve();

  running?.complete?.();
  running = null;

  const animating = motionEnabled();
  /* The drawables are the gate's targets: `spec.to` has to reach the proxy, or the
     reduced-motion branch writes a `draw` attribute nothing reads and leaves the edge
     undrawn. See {@link edgeDrawables}. */
  const drawables = edgeDrawables(paths);
  const spec = edgeDrawSpec(drawables);
  const settled = play(drawables, {
    to: spec.to,
    run: () => {
      const playback = spec.run();
      running = playback;
      onPlayback?.(playback);
      return playback;
    },
  });

  const release = (): void => {
    releaseEdgeDraw(paths);
  };

  /* Motion off: the end state has already been applied synchronously and there is no frame
     to wait for, so the release is synchronous too — the first painted state of a
     reduced-motion render is the stylesheet's, not a restatement of it (§10.6.4). */
  if (!animating) {
    release();
    return settled;
  }
  return settled.then(() => {
    running = null;
    release();
  });
}

/** The verdict of each promise, as the graph currently states it. */
export function verdictsOf(promises: readonly SnapshotPromise[]): Map<string, Verdict> {
  return new Map(promises.map((promise) => [promise.id, promise.verdict]));
}

/**
 * The promises whose verdict moved between two renders, in the order they are painted.
 *
 * A promise the previous render did not carry is **not** a change: it arrived, and an
 * arrival is M4's entrance (§10.6.1). Only a promise that was there, with a different
 * verdict, carried one — which is precisely "that path carried a verdict change".
 */
export function changedVerdicts(
  previous: ReadonlyMap<string, Verdict>,
  promises: readonly SnapshotPromise[],
): string[] {
  return promises
    .filter((promise) => {
      const was = previous.get(promise.id);
      return was !== undefined && was !== promise.verdict;
    })
    .map((promise) => promise.id);
}

/**
 * Draws the verdict path for every promise whose verdict changed.
 *
 * The previous verdicts are remembered in a ref rather than read from the DOM, for the
 * reason `useVerdictFlip` gives: by the time an effect runs React has painted the new
 * verdict, so only this hook still knows the old one. First mount records and draws
 * nothing — a page that drew eight edges on load would be announcing eight events that did
 * not happen.
 *
 * Motion off declines here rather than in the orchestration: a fully drawn edge is what the
 * stylesheet already paints, so there is no end state left to settle. Called directly,
 * {@link playEdgeDraw} still goes through the gate in either state.
 */
export function useEdgeDraw(
  root: RefObject<HTMLElement | null>,
  promises: readonly SnapshotPromise[],
): void {
  const previous = useRef<Map<string, Verdict> | null>(null);
  const playback = useRef<MotionPlayback | null>(null);

  useEffect(() => {
    const was = previous.current;
    previous.current = verdictsOf(promises);
    const element = root.current;
    if (element === null || was === null) return;
    if (!motionEnabled()) return;

    for (const promiseId of changedVerdicts(was, promises)) {
      void playEdgeDraw(element, promiseId, (started) => {
        playback.current = started;
      });
    }

    /* Completed, never cancelled: a graph that goes away mid-pulse must not leave an edge
       drawn to 60% (§10.6.4). */
    return () => {
      playback.current?.complete?.();
      playback.current = null;
    };
  }, [root, promises]);
}
