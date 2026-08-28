/**
 * M1 — the edge draw along the verdict path (task 17.8, design §10.6.3, §10.6.4, §18.1,
 * R10.4).
 *
 * ── What this file can and cannot prove ──────────────────────────────────────────
 *
 * **jsdom paints no React Flow edge at all.** It does no layout, so the pane measures zero
 * and React Flow renders no `.react-flow__edge-path`. That is asserted below rather than
 * assumed, because it is the premise of everything else here: a test claiming a *drawn edge*
 * over a jsdom render of the graph would be asserting nothing at all. **The visual result —
 * a line wiping in from its source end over `--dur-slow` — is unverifiable under jsdom and
 * is checked by eye in a browser.** Said plainly, once, so nobody reads the green below as
 * more than it is.
 *
 * What *is* assertable, and is:
 *
 *   1. **Which edge.** The promise → designed-test edge, by the id `lib/layout.ts` gives it,
 *      and not the `cites` or `sealed` edge, and not another promise's.
 *   2. **On which event.** Only a promise that was already on the page with a *different*
 *      verdict. A promise that arrived is an entrance (M4), not a verdict change.
 *   3. **The end state, under motion off.** Fully drawn, applied synchronously, with the
 *      drawable's attributes handed back so a drawn edge and a static one are the same
 *      bytes.
 *   4. **One pass, never a loop.** The timeline lasts exactly `--dur-pulse` and is finished
 *      when it lands: nothing restarts it, and the engine is idle afterwards.
 *
 * The edge itself is a real `<path>` in a real `data-id="designed:…"` wrapper, built here
 * because the browser would have built one and jsdom will not. Everything else — the gate,
 * `svg.createDrawable`, the timeline, the tokens — is the shipped code.
 */

import type { SnapshotPromise } from 'kept-core';
import { cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  DESIGNED_EDGE_PREFIX,
  EDGE_DRAW_ATTRIBUTES,
  EDGE_DRAW_FROM,
  EDGE_DRAW_TO,
  changedVerdicts,
  designedEdgeIdPrefix,
  edgeDrawEnd,
  edgeDrawSpec,
  edgeDrawables,
  playEdgeDraw,
  releaseEdgeDraw,
  verdictEdgePaths,
  verdictsOf,
} from '../components/EdgeDraw.js';
import { PromiseGraph } from '../components/PromiseGraph.js';
import {
  REDUCED_MOTION_QUERY,
  durationMs,
  motionEnabled,
  pendingMotion,
  play,
  stopObservingMotionPreference,
  type MotionPlayback,
} from '../lib/motion.js';
import { layoutSnapshot } from '../lib/layout.js';
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

async function quiet(): Promise<void> {
  for (let attempt = 0; attempt < 100 && pendingMotion() > 0; attempt += 1) {
    await new Promise((ready) => {
      setTimeout(ready, 20);
    });
  }
}

beforeAll(installPreference);

afterAll(() => {
  stopObservingMotionPreference();
  delete (globalThis as { matchMedia?: MatchMedia }).matchMedia;
});

beforeEach(() => {
  reducedMotion = false;
});

afterEach(async () => {
  cleanup();
  await quiet();
  stopObservingMotionPreference();
  reducedMotion = false;
  for (const stray of [...document.body.querySelectorAll('svg[data-synthetic]')]) stray.remove();
});

/* ───────────────────────────────── the fixture ──────────────────────────────── */

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const SUBJECT: SnapshotPromise | undefined = snapshot.promises[0];
const OTHER: SnapshotPromise | undefined = snapshot.promises[1];

/** A real edge wrapper with a real path inside it, of `kind` and for `promiseId`. */
function edgeElement(kind: string, from: string, to: string): SVGSVGElement {
  const root = document.createElementNS(SVG_NAMESPACE, 'svg');
  root.setAttribute('data-synthetic', 'true');
  const wrapper = document.createElementNS(SVG_NAMESPACE, 'g');
  wrapper.setAttribute('class', 'react-flow__edge');
  wrapper.setAttribute('data-id', `${kind}:${from}->${to}`);
  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute('class', 'react-flow__edge-path');
  path.setAttribute('d', 'M0 0 L 240 0');
  wrapper.append(path);
  root.append(wrapper);
  document.body.append(root);
  return root;
}

/**
 * The dash pattern on a path, as two numbers.
 *
 * `stroke-dasharray` is how a drawn fraction is expressed: `dash` is the visible run and
 * `gap` the rest, so "fully drawn" is a positive dash and a zero gap. Reading it here rather
 * than trusting the `draw` attribute is deliberate — that attribute is the helper's own
 * bookkeeping, and a value written to it without the dash pair following is exactly the
 * failure this file exists to catch.
 */
function dashOf(path: SVGPathElement): { readonly dash: number; readonly gap: number } {
  const [dash = Number.NaN, gap = Number.NaN] = (path.getAttribute('stroke-dasharray') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return { dash, gap };
}

/** The verdict path for `SUBJECT`, as React Flow would render it. */
function verdictPath(): { readonly root: SVGSVGElement; readonly path: SVGPathElement } {
  if (SUBJECT === undefined) throw new Error('the committed snapshot carries no promise');
  const root = edgeElement('designed', SUBJECT.id, 't_designed');
  const path = root.querySelector<SVGPathElement>('path');
  if (path === null) throw new Error('the fixture built no path');
  return { root, path };
}

/* ────────────── the premise: jsdom paints no edge, so say so ────────────────── */

describe('jsdom paints no React Flow edge, which is the premise of this file', () => {
  it('renders the real graph and finds no edge path in it', () => {
    if (SUBJECT === undefined) return;
    const { container } = render(<PromiseGraph initialSelectedId={null} snapshot={snapshot} />);
    expect(
      container.querySelectorAll('path.react-flow__edge-path').length,
      'React Flow painted an edge under jsdom. The visual clause of M1 became assertable ' +
        'here — assert it, and delete this test.',
    ).toBe(0);
    expect(verdictEdgePaths(container, SUBJECT.id)).toEqual([]);
  });

  it('has designed edges in the layout regardless, so there is a path to draw in a browser', () => {
    const layout = layoutSnapshot(snapshot);
    const designed = layout.edges.filter((edge) => edge.kind === 'designed');
    expect(
      designed.length,
      'the committed snapshot has no designed edge at all, so M1 would have nothing to ' +
        'draw in any renderer',
    ).toBeGreaterThan(0);
    for (const edge of designed) {
      expect(edge.id.startsWith(DESIGNED_EDGE_PREFIX)).toBe(true);
      expect(edge.id).toBe(`${designedEdgeIdPrefix(edge.from)}${edge.to}`);
    }
  });

  it('draws nothing, and throws nothing, when no edge is painted', () => {
    if (SUBJECT === undefined) return;
    const empty = document.createElement('div');
    document.body.append(empty);
    expect(verdictEdgePaths(empty, SUBJECT.id)).toEqual([]);
    const settled = playEdgeDraw(empty, SUBJECT.id);
    expect(pendingMotion()).toBe(0);
    empty.remove();
    return settled;
  });
});

/* ────────────────── which edge: the verdict path, and no other ──────────────── */

describe('the draw is scoped to the promise-to-designed-test edge', () => {
  it('finds the designed edge for that promise', () => {
    if (SUBJECT === undefined) return;
    const { path } = verdictPath();
    expect(verdictEdgePaths(document.body, SUBJECT.id)).toEqual([path]);
  });

  it('ignores the cites and sealed edges, which no verdict travelled', () => {
    if (SUBJECT === undefined) return;
    edgeElement('cites', 'd_doc', SUBJECT.id);
    edgeElement('sealed', SUBJECT.id, 'ev_pack');
    expect(
      verdictEdgePaths(document.body, SUBJECT.id),
      'a cites or sealed edge was drawn. §10.6.3 draws the path between a promise and the ' +
        'test designed to prove it, because that is the causality the animation states.',
    ).toEqual([]);
  });

  it('ignores another promise’s verdict path', () => {
    if (SUBJECT === undefined || OTHER === undefined) return;
    verdictPath();
    expect(verdictEdgePaths(document.body, OTHER.id)).toEqual([]);
  });
});

/* ─────────────── on which event: a change, never an arrival ─────────────────── */

describe('the draw fires on a verdict change and on nothing else', () => {
  const promises: readonly SnapshotPromise[] = snapshot.promises;

  it('reads the lane’s verdicts as a map of what the page currently states', () => {
    const verdicts = verdictsOf(promises);
    expect(verdicts.size).toBe(promises.length);
    for (const promise of promises) expect(verdicts.get(promise.id)).toBe(promise.verdict);
  });

  it('names only the promises whose verdict moved', () => {
    if (SUBJECT === undefined) return;
    const before = verdictsOf(promises);
    expect(changedVerdicts(before, promises), 'nothing moved, so nothing may draw').toEqual([]);

    const moved = promises.map((promise) =>
      promise.id === SUBJECT.id
        ? { ...promise, verdict: promise.verdict === 'proven' ? 'red' : 'proven' }
        : promise,
    ) as readonly SnapshotPromise[];
    expect(changedVerdicts(before, moved)).toEqual([SUBJECT.id]);
  });

  it('treats a promise that was not there as an arrival, which is M4’s business', () => {
    if (SUBJECT === undefined) return;
    expect(
      changedVerdicts(new Map(), promises),
      'a promise the previous render did not carry was read as a verdict change; an ' +
        'arrival is the entrance of §10.6.1, and a page that drew every edge on load ' +
        'would announce events that did not happen',
    ).toEqual([]);
  });

  it('draws nothing on the first mount of the real graph', () => {
    render(<PromiseGraph initialSelectedId={null} snapshot={snapshot} />);
    /* the entrance may be in flight — this is about M1, so the assertion is that no edge
       draw was started, which under jsdom is also all the DOM would allow */
    expect(document.querySelectorAll('[draw]').length).toBe(0);
  });
});

/* ──────────── one pass, at --dur-pulse, and fully drawn when it lands ───────── */

describe('the pulse runs once, lasts --dur-pulse, and hands the edge back', () => {
  it('reads both durations from tokens', () => {
    expect(durationMs('--dur-slow')).toBe(420);
    expect(durationMs('--dur-pulse')).toBe(1400);
    expect(edgeDrawEnd()).toEqual({ draw: EDGE_DRAW_TO });
    /* a fresh record: the engine writes its own bookkeeping into the object it is handed */
    expect(edgeDrawEnd()).not.toBe(edgeDrawEnd());
    expect(EDGE_DRAW_FROM).toBe('0 0');
  });

  it('builds one timeline whose whole length is the single pulse', async () => {
    if (SUBJECT === undefined) return;
    const { path } = verdictPath();
    expect(motionEnabled(), 'the preference shim is not answering').toBe(true);

    let playback: MotionPlayback | null = null;
    const settled = playEdgeDraw(document.body, SUBJECT.id, (started) => {
      playback = started;
    });
    const handle = playback as unknown as {
      seek(time: number): void;
      complete(): void;
      duration: number;
      currentTime: number;
    } | null;
    expect(handle, 'no timeline was built with motion on').not.toBeNull();
    expect(
      handle?.duration,
      'the pulse is not --dur-pulse long. §10.6.3 asks for a single 1.4 s pulse: the draw ' +
        'takes --dur-slow and the drawn edge is held for the rest of the envelope.',
    ).toBe(durationMs('--dur-pulse'));

    /* the draw itself: partway through --dur-slow the line is partly drawn — a visible run
       and a gap that has not closed yet */
    handle?.seek(durationMs('--dur-slow') / 2);
    const midFlight = path.getAttribute('draw');
    expect(midFlight, 'the drawable wrote no draw value, so nothing was drawing').not.toBeNull();
    expect(midFlight).not.toBe(EDGE_DRAW_TO);
    const drawing = dashOf(path);
    expect(drawing.dash, 'nothing was drawn halfway through the wipe').toBeGreaterThan(0);
    expect(drawing.gap, 'the line was already whole halfway through the wipe').toBeGreaterThan(0);

    handle?.complete();
    /* read before the await: the release is a microtask behind the last frame, so this is
       the one moment the fully drawn edge exists in the DOM */
    expect(dashOf(path).gap, 'the pulse ended on a line with a gap in it').toBe(0);
    await settled;

    /* landed, and handed back: a drawn edge is the same bytes as one that never animated */
    for (const attribute of EDGE_DRAW_ATTRIBUTES) {
      expect(path.hasAttribute(attribute), `${attribute} outlived the pulse`).toBe(false);
    }
    expect(pendingMotion()).toBe(0);
  });

  it('does not redraw itself once it has landed', async () => {
    if (SUBJECT === undefined) return;
    const { path } = verdictPath();
    await playEdgeDraw(document.body, SUBJECT.id);
    expect(pendingMotion()).toBe(0);

    /* a loop would restart the wipe; two frames later there is still nothing running and
       nothing written */
    await new Promise((ready) => {
      setTimeout(ready, 60);
    });
    expect(
      path.hasAttribute('draw'),
      'the edge is drawing again after landing. §10.6.3 forbids a loop, and ' +
        'motionTimeline pins the loop parameter off for exactly this reason.',
    ).toBe(false);
    expect(pendingMotion()).toBe(0);
  });

  it('completes a pulse already running rather than stranding it', async () => {
    if (SUBJECT === undefined) return;
    verdictPath();
    const first = playEdgeDraw(document.body, SUBJECT.id);
    expect(pendingMotion()).toBe(1);
    await playEdgeDraw(document.body, SUBJECT.id);
    await first;
    expect(
      pendingMotion(),
      'a second pulse left the first one unable to finish, so the gate still believes ' +
        'something is in flight',
    ).toBe(0);
  });
});

/* ─────────────── motion off: fully drawn, synchronously, no residue ─────────── */

describe('motion off means the edge is already drawn', () => {
  it('applies the end state with no frame in between, then hands the path back', () => {
    if (SUBJECT === undefined) return;
    reducedMotion = true;
    expect(motionEnabled()).toBe(false);

    const { path } = verdictPath();
    let playback: MotionPlayback | null = null;
    void playEdgeDraw(document.body, SUBJECT.id, (started) => {
      playback = started;
    });

    /* no await: with motion off there is no frame to wait for, so the release is in the same
       call — the first painted state of a reduced-motion render is the stylesheet's */
    expect(playback, 'a timeline was built under reduced motion').toBeNull();
    expect(pendingMotion()).toBe(0);
    for (const attribute of EDGE_DRAW_ATTRIBUTES) {
      expect(path.hasAttribute(attribute), `${attribute} survived a reduced-motion draw`).toBe(
        false,
      );
    }
  });

  it('is a spec whose end state alone leaves the edge fully drawn', async () => {
    reducedMotion = true;
    const { path } = verdictPath();
    const drawables = edgeDrawables([path]);
    const spec = edgeDrawSpec(drawables);
    expect(spec.to).toEqual(edgeDrawEnd());

    /* Freshly created, the drawable is fully *undrawn*: a zero-length dash followed by a gap
       the length of the path. So the assertion below is a real one — the end state has to
       turn that into a solid line. */
    expect(dashOf(path).dash).toBe(0);

    /* the gate, called directly, so what is asserted is the end state rather than this
       module's handling of it: `draw: '0 1'` is the whole line visible, which is how the
       static edge already looks */
    const settled = play(drawables, spec);
    expect(path.getAttribute('draw')).toBe(EDGE_DRAW_TO);
    expect(Number(path.getAttribute('stroke-dashoffset'))).toBe(0);
    const landed = dashOf(path);
    expect(
      landed.gap,
      'the end state left a gap in the dash pattern, so a reduced-motion render shows a ' +
        'partly drawn edge — or none at all (§10.6.4)',
    ).toBe(0);
    expect(landed.dash).toBeGreaterThan(0);
    expect(pendingMotion()).toBe(0);
    await settled;

    releaseEdgeDraw([path]);
    expect(path.getAttribute('style')).toBeNull();
    for (const attribute of EDGE_DRAW_ATTRIBUTES) {
      expect(path.hasAttribute(attribute)).toBe(false);
    }
  });
});
