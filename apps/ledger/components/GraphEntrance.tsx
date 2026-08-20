/**
 * M4 — the graph entrance (design §10.6.1, §10.6.4, §18.1, R10.4, task 17.5).
 *
 * On first paint of `/`, the promise lane arrives one node at a time, 24 ms apart,
 * each node fading in and lifting the last 6px into a position `lib/layout.ts` had
 * already resolved. §18.1 calls it "the most visible craft on the page and the most
 * likely thing a judge notices in the first three seconds", and drops it second to
 * last.
 *
 * Four properties of it are load-bearing, and each is a test in
 * `motion-m4-graph-entrance.test.tsx`:
 *
 * 1. **It animates only `opacity` and a `translateY`, from the final coordinates.**
 *    The nodes are already where they belong — the layout is arithmetic, deliberately
 *    (§10.3) — so nothing here moves a node *to* its place, which is why no `width`,
 *    `height`, `top` or `left` appears anywhere in this file and why the lift is a
 *    `transform`. Motion never feeds back into the layout.
 * 2. **It is bounded.** The delay of the *n*th node is `min(n × 24ms, 620ms)`, so a
 *    200-promise graph does not make a reader wait: past the twenty-sixth node the
 *    remainder shares one delay and appears together. The stagger itself is the
 *    engine's `stagger(24, { from: 'first' })` — index arithmetic, capped, rather
 *    than a second notion of ordering.
 * 3. **It runs once per session.** A `sessionStorage` flag, so navigating back to `/`
 *    from `/coverage` does not replay it. The flag gates the *animation*, never the
 *    state: a second visit renders the resting graph, which is what a reader already
 *    has and what §18.1 says dropping this flourish leaves behind.
 * 4. **The resting DOM is byte-identical to the no-motion render.** The entrance ends
 *    by releasing the two declarations it wrote, so a page that animated, a page
 *    under `prefers-reduced-motion: reduce`, and a page whose second visit skipped
 *    the flourish are the same bytes. See `motionRelease.tsx` for why that is the
 *    release rather than the end state.
 *
 * **Lane order, and one honest discrepancy.** §10.6.1's prose says "documents settle,
 * then promises, then designed tests", while its own code sample — and task 17.5,
 * which is the executable statement of it — say `.promise-node`, and state the cap in
 * `nodeCount`. This implements the narrower, twice-written thing: the promise lane,
 * in the order it is painted, which `lib/layout.ts` sorts `(verdict rank, id)` with
 * red first. So the entrance still teaches something true about the graph — the most
 * urgent promise arrives first — and the context lanes are simply present, which is
 * what they are: context. Widening it to all four lanes is one selector away, and
 * document order is already lane-major, so nothing here has to be rewritten to do it.
 *
 * Not a component. A hook and the orchestration it drives, in `components/` because
 * that is where the `animejs` import scan (task 17.2) permits a gate consumer to
 * live, and `.tsx` because the root project's `include` names only `lib/` and `test/`
 * — a `.ts` file here would be checked by neither program.
 */

'use client';

import { useEffect, useRef, type RefObject } from 'react';

import {
  durationMs,
  easeFor,
  motionEnabled,
  motionTimeline,
  play,
  stagger,
  type MotionEndState,
  type MotionPlayback,
  type MotionSpec,
} from '../lib/motion.js';

import { releaseInlineMotion } from './motionRelease.js';

/** What the entrance animates: the promise lane, as `PromiseNode` renders it. */
export const ENTRANCE_SELECTOR = '.promise-node';

/** The lift, in pixels. §10.6.1's `translateY: [6, 0]`, and the whole displacement. */
export const ENTRANCE_LIFT_PX = 6;

/**
 * The ceiling on the stagger, from §10.6.1: `min(nodeCount × 24ms, 620ms)`.
 *
 * Not a duration — each node still fades over `--dur-slow`. It is the budget for
 * *when the last one starts*, which is the number that grows with the snapshot and
 * the one a judge would feel.
 */
export const ENTRANCE_CAP_MS = 620;

/** Where the once-per-session flag lives. Namespaced, because the origin is shared. */
export const ENTRANCE_SESSION_KEY = 'kept.ledger.graph-entrance';

/**
 * The end state: visible, and at the coordinate the layout computed.
 *
 * A factory rather than a shared constant, and not as a matter of taste. `utils.set`
 * — which is how the gate applies an end state — treats the record it is handed as a
 * parameter bag and writes its own bookkeeping into it, so a module-level object
 * would come back from the first reduced-motion settle carrying `composition` and a
 * `duration` of `1e-11`. A fresh record per orchestration keeps the end state a
 * statement about the graph rather than a buffer the engine borrows.
 */
export function entranceEnd(): MotionEndState {
  return { opacity: 1, translateY: 0 };
}

/** The two inline declarations the entrance writes, and therefore hands back. */
export const ENTRANCE_INLINE = ['opacity', 'transform'] as const;

/**
 * The stagger budget for a graph of `nodeCount` nodes — `min(n × 24ms, 620ms)`.
 *
 * Stated as §10.6.1 states it, in `nodeCount` rather than in the last index, so the
 * arithmetic in the design document and the arithmetic here are the same sentence.
 */
export function entranceSpan(nodeCount: number): number {
  return Math.min(Math.max(nodeCount, 0) * durationMs('--stagger-node'), ENTRANCE_CAP_MS);
}

/**
 * When the node at `index` starts — the same ceiling, applied per node.
 *
 * Past `620 / 24` the value stops growing, which is exactly "the remainder appearing
 * together": every node from the twenty-sixth on starts at 620 ms.
 */
export function entranceDelay(index: number): number {
  return Math.min(Math.max(index, 0) * durationMs('--stagger-node'), ENTRANCE_CAP_MS);
}

/**
 * The engine's `stagger`, capped.
 *
 * `stagger(24, { from: 'first' })` is the delay generator §10.6.1 names, and it is
 * unbounded by construction — index times step, for as many nodes as there are. The
 * cap is arithmetic over its result rather than a replacement for it, so the ordering
 * stays the engine's and the ceiling stays this module's.
 */
/**
 * `stagger(24, { from: 'first' })`, the delay generator §10.6.1 names.
 *
 * The return type is inferred rather than annotated on purpose: `stagger` is four
 * overloads, and `ReturnType<typeof stagger>` resolves to the *last* of them — the
 * string one — so annotating it would quietly claim this returns CSS times.
 */
function baseStagger() {
  return stagger(durationMs('--stagger-node'), { from: 'first' });
}

/** The three arguments the engine hands a delay generator, spelled from its own type. */
type StaggerArguments = Parameters<ReturnType<typeof baseStagger>>;

/**
 * What a delay generator is, as this module needs it.
 *
 * The parameter types are taken from `stagger`'s own signature rather than written
 * out, because they are the engine's — the target, the index, and the target list a
 * `from: 'first'` offset is measured against. All three are forwarded verbatim, which
 * is the difference between capping the engine's ordering and quietly replacing it.
 */
export type EntranceDelay = (
  target?: StaggerArguments[0],
  index?: StaggerArguments[1],
  targets?: StaggerArguments[2],
) => number;

export function cappedStagger(): EntranceDelay {
  const staggered = baseStagger();
  return (target, index, targets) =>
    Math.min(Number(staggered(target, index, targets)), ENTRANCE_CAP_MS);
}

/**
 * The promise nodes under `root`, in the order they are painted.
 *
 * Document order, which React Flow takes from `layout.nodes` — lane-major, and within
 * the promise lane `(verdict rank, id)` with red first. So "in lane order" needs no
 * second source of truth here: the DOM already is the layout's order.
 */
export function entranceTargets(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(ENTRANCE_SELECTOR)];
}

/** One timeline: a fade and a 6px lift per node, staggered in painted order. */
export function entranceSpec(targets: readonly HTMLElement[]): MotionSpec {
  return {
    to: entranceEnd(),
    run: () =>
      motionTimeline().add([...targets], {
        opacity: [0, 1],
        translateY: [ENTRANCE_LIFT_PX, 0],
        duration: durationMs('--dur-slow'),
        ease: easeFor('--ease-out'),
        delay: cappedStagger(),
      }),
  };
}

/** `true` when this session has already been shown the entrance. */
export function entranceRanThisSession(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(ENTRANCE_SESSION_KEY) !== null;
  } catch {
    /* Storage can be absent or refused — a privacy mode, a sandboxed frame. An
       entrance that cannot remember is better replayed than skipped, and either
       answer leaves the same resting DOM, so the failure is not one a reader sees. */
    return false;
  }
}

/** Records that it has. Symmetric with {@link entranceRanThisSession}. */
export function markEntranceRanThisSession(): void {
  try {
    globalThis.sessionStorage?.setItem(ENTRANCE_SESSION_KEY, 'true');
  } catch {
    /* as above */
  }
}

/** Forgets it, so the next mount animates again. For tests and for the driver. */
export function forgetEntranceSession(): void {
  try {
    globalThis.sessionStorage?.removeItem(ENTRANCE_SESSION_KEY);
  } catch {
    /* as above */
  }
}

/**
 * The entrance currently running, if one is.
 *
 * There is only ever one graph on `/`, so there is only ever one entrance — but a
 * second call must not start a timeline over targets the first one is still tweening.
 * The engine would resolve that by *replacing* the earlier tweens, which silently
 * strands the first timeline: it can no longer finish, so `play()` never resolves and
 * the gate's in-flight count never returns to zero. Completing the earlier one first
 * is the same choice §10.6.4 makes about a preference change — finish, never abandon —
 * and it keeps `pendingMotion()` honest, which is what the equivalence comparison of
 * task 17.3 waits on.
 */
let running: MotionPlayback | null = null;

/**
 * Runs the entrance over a rendered graph, and resolves once it is at rest.
 *
 * Deliberately unaware of the session flag: this is the orchestration, and whether a
 * given page visit gets one is {@link useGraphEntrance}'s decision. Keeping them
 * apart is also what lets the equivalence test of task 17.3 drive the real animation
 * on a page whose hook has already had its turn.
 *
 * @param onPlayback receives the timeline, so an unmounting graph can complete it.
 */
export function playGraphEntrance(
  root: ParentNode,
  onPlayback?: (playback: MotionPlayback) => void,
): Promise<void> {
  const targets = entranceTargets(root);
  if (targets.length === 0) return Promise.resolve();

  running?.complete?.();
  running = null;

  /* Asked before the end state is applied, because it decides *when* the release
     happens rather than whether it does. */
  const animating = motionEnabled();
  const spec = entranceSpec(targets);
  const settled = play(targets, {
    to: spec.to,
    run: () => {
      const playback = spec.run();
      running = playback;
      onPlayback?.(playback);
      return playback;
    },
  });

  const release = (): void => {
    releaseInlineMotion(targets, ENTRANCE_INLINE);
  };

  /* Motion off: `play()` has already applied the end state synchronously, and there
     is no frame to wait for — so the release is synchronous too. Deferring it by even
     a microtask would mean the *first painted state* of a reduced-motion render was
     an inline restatement of the stylesheet rather than the stylesheet, and §10.6.4's
     claim is about the first paint, not about the one after it. */
  if (!animating) {
    release();
    return settled;
  }
  return settled.then(() => {
    running = null;
    release();
  });
}

/**
 * Plays the entrance once per session, over the graph `root` holds.
 *
 * `nodeCount` is a dependency rather than a convenience: the effect has to wait until
 * the nodes it animates are in the DOM, and the count changing is the one signal that
 * says they are. It is not otherwise consulted — the cap reads the length of what it
 * actually found.
 */
export function useGraphEntrance(root: RefObject<HTMLElement | null>, nodeCount: number): void {
  const playback = useRef<MotionPlayback | null>(null);

  useEffect(() => {
    const element = root.current;
    if (element === null || nodeCount === 0) return;
    if (entranceRanThisSession()) return;
    markEntranceRanThisSession();

    void playGraphEntrance(element, (started) => {
      playback.current = started;
    });

    /* Completed, not cancelled: a graph that goes away mid-entrance must not leave a
       node interpolating at 0.6 opacity (§10.6.4). */
    return () => {
      playback.current?.complete?.();
      playback.current = null;
    };
  }, [root, nodeCount]);
}
