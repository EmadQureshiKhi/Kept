/**
 * M4 — the graph entrance stagger (task 17.5, design §10.6.1, §10.6.4, §18.1, R10.4).
 *
 * The entrance is the most visible craft on the page, and the four claims worth
 * checking about it are all claims a machine can settle:
 *
 *   1. **The stagger is bounded.** `min(nodeCount × 24ms, 620ms)`, so the
 *      twenty-sixth node and the two-hundredth start at the same instant and a large
 *      graph never makes a reader wait. Asserted as arithmetic, over sizes this
 *      snapshot will never have, because the cap exists for the snapshot it might.
 *   2. **It animates the layout's own coordinates.** `opacity` and a 6px `translateY`,
 *      and nothing else — checked by reading what actually lands in the `style`
 *      attribute mid-flight rather than by reading the call site.
 *   3. **It runs once per session.** The second mount of a session animates nothing,
 *      and renders the same DOM as the first one settled on.
 *   4. **The resting DOM is byte-identical to the no-motion render.** Task 17.5's own
 *      words. Three renders are compared: motion off, motion on and landed, and the
 *      second visit that skipped the flourish entirely.
 *
 * The graph is the shipped `PromiseGraph` over the committed snapshot, so the node
 * count, the painted order and the coordinates are the real ones. jsdom does no
 * layout, so nothing here asserts a width or an edge; it does run
 * `requestAnimationFrame`, so the timeline genuinely ticks.
 *
 * `matchMedia` is shimmed for the same reason and with the same scoping as in
 * `reduced-motion-equivalence.test.tsx` — jsdom implements none, the ledger project
 * shares one jsdom (`isolate: false`), so it is installed in `beforeAll` and removed
 * in `afterAll`. `sessionStorage` needed no shim: jsdom implements it, and it persists
 * across files in this project, which is why every test below clears the flag first.
 */

import { cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ENTRANCE_CAP_MS,
  ENTRANCE_INLINE,
  ENTRANCE_LIFT_PX,
  ENTRANCE_SESSION_KEY,
  entranceDelay,
  entranceEnd,
  entranceRanThisSession,
  entranceSpan,
  entranceSpec,
  entranceTargets,
  forgetEntranceSession,
  markEntranceRanThisSession,
  playGraphEntrance,
} from '../components/GraphEntrance.js';
import { PromiseGraph } from '../components/PromiseGraph.js';
import { releaseInlineMotion } from '../components/motionRelease.js';
import {
  REDUCED_MOTION_QUERY,
  durationMs,
  motionEnabled,
  pendingMotion,
  play,
  stopObservingMotionPreference,
  type MotionPlayback,
} from '../lib/motion.js';
import { layoutSnapshot, promiseNodes } from '../lib/layout.js';
import { snapshot } from '../lib/snapshot.js';

import { installBrowserShims } from './_dom.js';

installBrowserShims();

/* ─────────────────── the preference, which jsdom does not have ──────────────── */

let reducedMotion = false;

type MatchMedia = (query: string) => MediaQueryList;

function installPreference(): void {
  (globalThis as unknown as { matchMedia: MatchMedia }).matchMedia = ((media: string) =>
    ({
      media,
      get matches(): boolean {
        return media === REDUCED_MOTION_QUERY && reducedMotion;
      },
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
    }) as unknown as MediaQueryList) as MatchMedia;
}

beforeAll(installPreference);

afterAll(() => {
  stopObservingMotionPreference();
  delete (globalThis as { matchMedia?: MatchMedia }).matchMedia;
  forgetEntranceSession();
});

beforeEach(() => {
  reducedMotion = false;
  forgetEntranceSession();
});

afterEach(() => {
  cleanup();
  stopObservingMotionPreference();
  reducedMotion = false;
  forgetEntranceSession();
});

/* ───────────────────────────────── the fixture ──────────────────────────────── */

const STAGGER = durationMs('--stagger-node');
const LANE = promiseNodes(layoutSnapshot(snapshot)).map((node) => node.promise.id);

/** Renders the shipped graph over the committed snapshot. */
function renderGraph(): HTMLElement {
  return render(<PromiseGraph initialSelectedId={null} snapshot={snapshot} />).container;
}

/**
 * The same graph, with the session flag already spent so the hook stays out of it.
 *
 * Used by the tests whose subject is the orchestration rather than the hook: two
 * entrances over one set of nodes is a state the application never reaches — one graph,
 * one session, one entrance — and asserting a stagger against nodes another timeline
 * has already finished tells you nothing about either.
 */
function renderRestedGraph(): HTMLElement {
  markEntranceRanThisSession();
  return renderGraph();
}

/** Every promise node's `style` attribute, in painted order. */
function restingStyles(root: ParentNode): (string | null)[] {
  return entranceTargets(root).map((node) => node.getAttribute('style'));
}

async function quiet(): Promise<void> {
  for (let attempt = 0; attempt < 100 && pendingMotion() > 0; attempt += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
  expect(pendingMotion(), 'the entrance never finished').toBe(0);
}

/* ────────────────────────── the cap is real arithmetic ──────────────────────── */

describe('the entrance is bounded, so a large graph never makes a reader wait', () => {
  it('reads the stagger from the token rather than from a literal', () => {
    expect(STAGGER).toBe(24);
    expect(ENTRANCE_CAP_MS).toBe(620);
    expect(ENTRANCE_LIFT_PX).toBe(6);
  });

  it('spans min(nodeCount × 24ms, 620ms)', () => {
    for (const nodeCount of [0, 1, 8, 25, 26, 200, 2000]) {
      expect(entranceSpan(nodeCount)).toBe(Math.min(nodeCount * STAGGER, ENTRANCE_CAP_MS));
    }
    expect(entranceSpan(8)).toBe(192);
    expect(entranceSpan(25)).toBe(600);
    expect(entranceSpan(26)).toBe(ENTRANCE_CAP_MS);
  });

  it('lets the remainder appear together once the cap is reached', () => {
    expect(entranceDelay(0)).toBe(0);
    expect(entranceDelay(1)).toBe(STAGGER);
    expect(entranceDelay(25)).toBe(600);
    for (const index of [26, 27, 199, 1999]) {
      expect(
        entranceDelay(index),
        'a node past the cap waits longer than 620ms, so a 200-promise graph makes a ' +
          'judge wait (§10.6.1)',
      ).toBe(ENTRANCE_CAP_MS);
    }
    /* monotonic, so the order is never scrambled by the ceiling */
    for (let index = 1; index < 40; index += 1) {
      expect(entranceDelay(index)).toBeGreaterThanOrEqual(entranceDelay(index - 1));
    }
  });

  it('declares an end state of visible, and at the layout coordinate', () => {
    expect(entranceEnd()).toEqual({ opacity: 1, translateY: 0 });
    /* a fresh record each time: the engine writes its own bookkeeping into the object
       it is handed, so a shared constant comes back from the first settle carrying a
       `composition` and a `duration` of 1e-11 */
    expect(entranceEnd()).not.toBe(entranceEnd());
  });
});

/* ─────────────────────── the targets, in the painted order ──────────────────── */

describe('the entrance animates the promise lane in the order it is painted', () => {
  it('finds every promise node, in lib/layout.ts order', () => {
    const container = renderGraph();
    const targets = entranceTargets(container);
    expect(targets.length, 'no promise node was found, so the entrance is a no-op').toBe(
      snapshot.promises.length,
    );
    expect(targets.map((node) => node.getAttribute('data-promise-node'))).toEqual(LANE);
  });

  it('animates nothing when the graph has no promise lane', () => {
    const empty = document.createElement('div');
    document.body.append(empty);
    expect(entranceTargets(empty)).toEqual([]);
    return playGraphEntrance(empty);
  });
});

/* ───────────── what it writes: opacity and a transform, and no more ─────────── */

describe('the entrance writes only opacity and a transform', () => {
  it('lifts from 6px at zero opacity and lands at the coordinate the layout gave', async () => {
    const container = renderRestedGraph();
    expect(motionEnabled(), 'the preference shim is not answering').toBe(true);

    let playback: MotionPlayback | null = null;
    const settled = playGraphEntrance(container, (started) => {
      playback = started;
    });
    const handle = playback as unknown as {
      seek(time: number): void;
      complete(): void;
      duration: number;
    } | null;
    expect(handle, 'no timeline was built with motion on').not.toBeNull();

    handle?.seek(durationMs('--dur-slow') / 2);
    const first = entranceTargets(container)[0];
    const written = [...(first?.style ?? [])];
    expect(written.length, 'nothing was in flight, so this proves nothing').toBeGreaterThan(0);
    for (const property of written) {
      expect(
        ENTRANCE_INLINE as readonly string[],
        `the entrance animates ${property}, which is neither opacity nor the transform ` +
          `the 6px lift uses — §10.6.3 forbids animating layout`,
      ).toContain(property);
    }
    expect(first?.style.transform ?? '').toContain('translateY');

    /* one timeline, and its length is the last node's delay plus one fade */
    expect(handle?.duration).toBe(
      entranceDelay(snapshot.promises.length - 1) + durationMs('--dur-slow'),
    );

    handle?.complete();
    await settled;
    await quiet();
  });

  it('completes an entrance already running rather than stranding it', async () => {
    const container = renderGraph();
    expect(pendingMotion(), 'the mount did not start an entrance').toBe(1);

    /* the second call is the one the equivalence driver makes: the hook has already
       had its turn on this page, and the comparison wants the animation anyway */
    await playGraphEntrance(container);
    expect(
      pendingMotion(),
      'a second entrance left the first one unable to finish, so the gate still ' +
        'believes something is in flight',
    ).toBe(0);
    expect(restingStyles(container).every((style) => style === null)).toBe(true);
  });

  it('starts the lane in painted order, red first', async () => {
    const container = renderRestedGraph();
    let playback: MotionPlayback | null = null;
    const settled = playGraphEntrance(container, (started) => {
      playback = started;
    });
    const handle = playback as unknown as { seek(time: number): void; complete(): void } | null;

    /* one stagger step in, the first node has begun and the last has not */
    handle?.seek(STAGGER / 2);
    const targets = entranceTargets(container);
    const opacities = targets.map((node) => Number(node.style.opacity));
    expect(opacities[0], 'the first painted node had not started').toBeGreaterThan(0);
    expect(
      opacities[opacities.length - 1],
      'every node started at once, so there is no stagger',
    ).toBe(0);

    handle?.complete();
    await settled;
    await quiet();
  });
});

/* ───────────────────── once per session, and only the animation ─────────────── */

describe('the entrance runs once per session', () => {
  it('remembers in sessionStorage, under a namespaced key', () => {
    expect(entranceRanThisSession()).toBe(false);
    markEntranceRanThisSession();
    expect(entranceRanThisSession()).toBe(true);
    expect(globalThis.sessionStorage.getItem(ENTRANCE_SESSION_KEY)).not.toBeNull();
    expect(ENTRANCE_SESSION_KEY).toContain('kept');
    forgetEntranceSession();
    expect(entranceRanThisSession()).toBe(false);
  });

  it('animates on the first mount of a session and not on the second', async () => {
    renderGraph();
    expect(
      pendingMotion(),
      'the graph mounted with motion on and nothing entered, so M4 never ran',
    ).toBe(1);
    expect(entranceRanThisSession()).toBe(true);
    await quiet();
    cleanup();

    const second = renderGraph();
    expect(
      pendingMotion(),
      'the entrance replayed on a second visit; navigating back to / is not an event ' +
        '(§10.6.1)',
    ).toBe(0);
    expect(restingStyles(second).every((style) => style === null)).toBe(true);
  });

  it('completes rather than freezing when the graph unmounts mid-entrance', async () => {
    const container = renderGraph();
    const targets = entranceTargets(container);
    expect(pendingMotion()).toBe(1);

    cleanup();

    expect(
      pendingMotion(),
      'the entrance survived its own graph, so detached nodes are still being ' +
        'interpolated (§10.6.4: complete, never cancel)',
    ).toBe(0);

    /* the end state lands synchronously with the completion; the release that hands it
       back is a microtask behind, which is still inside the same task and so still
       before any paint */
    await quiet();
    expect(targets.every((node) => node.getAttribute('style') === null)).toBe(true);
  });
});

/* ──────── the resting DOM is the same bytes in all three states (17.5) ──────── */

describe('the resting DOM is byte-identical to the no-motion render', () => {
  it('agrees across motion off, motion on and landed, and the skipped second visit', async () => {
    reducedMotion = true;
    const off = restingStyles(renderGraph());
    expect(off.length).toBe(snapshot.promises.length);
    expect(
      off.every((style) => style === null),
      'the reduced-motion render carries an inline style, so the graph does not rest ' +
        'where the stylesheet puts it',
    ).toBe(true);
    cleanup();
    forgetEntranceSession();

    reducedMotion = false;
    const container = renderGraph();
    await quiet();
    const on = restingStyles(container);
    expect(
      on,
      'a node that animated kept the declarations the entrance wrote. Task 17.5 asks ' +
        'for a resting DOM byte-identical to the no-motion render, and §18.1 says ' +
        'dropping M4 leaves nodes at opacity 1 — both mean nothing inline survives.',
    ).toEqual(off);
    cleanup();

    /* the third state: the flourish did not run at all, which is also what dropping
       it entirely would produce */
    const skipped = restingStyles(renderGraph());
    expect(skipped).toEqual(off);
  });

  it('is a spec whose end state alone produces the finished graph', async () => {
    reducedMotion = true;
    expect(motionEnabled()).toBe(false);

    const container = renderRestedGraph();
    const targets = entranceTargets(container);
    const spec = entranceSpec(targets);
    expect(spec.to).toEqual(entranceEnd());

    /* the gate, called directly, so what is asserted is the end state rather than
       this module's handling of it: motion off means `to` is applied with no frame in
       between, which is the test of whether a MotionSpec is written correctly */
    const settled = play(targets, spec);
    const first = targets[0];
    expect(first?.style.opacity).toBe('1');
    expect(first?.style.transform).toBe('translateY(0px)');
    expect(pendingMotion()).toBe(0);
    await settled;

    releaseInlineMotion(targets, ENTRANCE_INLINE);
    expect(first?.getAttribute('style')).toBeNull();
  });

  it('rests where the stylesheet puts it with motion off, in the same call', () => {
    reducedMotion = true;
    const container = renderRestedGraph();

    let playback: MotionPlayback | null = null;
    void playGraphEntrance(container, (started) => {
      playback = started;
    });

    /* no await: with motion off there is no frame to wait for, so the release cannot
       be a microtask behind either — the first painted state of a reduced-motion
       render is the stylesheet's, not an inline restatement of it (§10.6.4) */
    expect(playback, 'a timeline was built under reduced motion').toBeNull();
    expect(pendingMotion()).toBe(0);
    expect(restingStyles(container).every((style) => style === null)).toBe(true);
  });
});
