/**
 * The reduced-motion equivalence test — task 17.3, design §10.6.4, §18.2,
 * **Property 22 (reduced-motion clause)**, R10.4, R10.6.
 *
 * §10.6.4's title is the claim: *reduced motion is a specified state, not a
 * fallback.* Stated as something a machine can check, it is an identity — the DOM
 * rendered under `prefers-reduced-motion: reduce` and the DOM left behind after
 * every orchestration has finished are the **same DOM with the same animated
 * declarations**. Not similar, not equivalent in spirit: equal, declaration by
 * declaration.
 *
 * This is not droppable (§18.2). It is an accessibility guarantee and a clause of
 * Property 22, and it is what makes M1–M5 individually droppable in the first
 * place: every flourish goes through `play()`, so if this file is green, cutting a
 * flourish cannot break the accessibility state.
 *
 * ── Keeping it honest ─────────────────────────────────────────────────────────
 *
 * Written before M5 and M4 exist, a page-level comparison would be *vacuously*
 * green: two renders that were never going to differ, agreeing. Three things stop
 * that, and each of them is a test below rather than a promise here.
 *
 *   1. **The comparison machinery is proven, not assumed.** A fixture element is
 *      driven through the real `play()` in both states, and the comparison is
 *      required to *report a difference* when that element is mid-flight. A
 *      differ that cannot see a half-played animation could not see a broken one.
 *   2. **The gate's own contract is asserted over real animated declarations.**
 *      Motion off applies the end state synchronously — asserted before any
 *      `await`, because "the first painted state" is a claim about the absence of
 *      an interval. Motion on lands on the identical declarations. And a
 *      preference change mid-flight *completes* the timeline: the element is at its
 *      end state, not frozen at 0.94 opacity, which is the precise harm §10.6.4
 *      exists to prevent.
 *   3. **A tripwire fires when the first real orchestration lands without joining
 *      this file.** Any shipped module that imports `lib/motion.js` must appear in
 *      {@link ORCHESTRATIONS} with a driver, so M5 cannot be committed while this
 *      comparison still inspects a page where nothing moves. That is the shape the
 *      zero-`@keyframes` tripwire in `motion-scan.test.ts` and the vacuous-clause
 *      tripwire in the projection property both take.
 *
 * ── What jsdom can and cannot be asked ───────────────────────────────────────
 *
 *   - **It implements no `matchMedia` at all.** So the preference is supplied here,
 *     as a shim for a browser API rather than a mock of anything the Ledger wrote —
 *     the same standing `_dom.tsx` has for `ResizeObserver`. Worth stating what the
 *     absence proves on its own: with no `matchMedia`, `motionEnabled()` answers
 *     `false`, so an environment that cannot be asked about the preference gets the
 *     reduced-motion state. The gate fails safe.
 *   - **It applies no stylesheet** (the suite runs with CSS transforms off), so
 *     every computed value read below comes from an inline style. That is exactly
 *     where the engine writes, which is why the comparison is meaningful anyway:
 *     what differs between the two states is inline, and what does not differ is
 *     authored CSS that both states share.
 *   - **It does no layout, so React Flow paints no edge.** The edge-draw clause is
 *     therefore compared through `stroke-dasharray` / `stroke-dashoffset` over
 *     whatever paths exist, and the real assertion for M1 arrives with M1 through
 *     the registry. Claiming a drawn edge from a tree that cannot draw one would be
 *     the emptiest kind of green.
 */

import type { Verdict } from '@kept/core';
import { cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import LedgerPage from '../app/page.js';
import { playGraphEntrance } from '../components/GraphEntrance.js';
import { playPanelStagger } from '../components/PanelStagger.js';
import { PromisePanel } from '../components/PromisePanel.js';
import { playVerdictFlip } from '../components/VerdictFlip.js';
import { VERDICT_RANK } from '../components/VerdictTag.js';
import {
  REDUCED_MOTION_QUERY,
  durationMs,
  easeFor,
  motionAnimation,
  motionEnabled,
  observeMotionPreference,
  pendingMotion,
  play,
  stopObservingMotionPreference,
  type MotionSpec,
} from '../lib/motion.js';
import { formatMetricFigure } from '../lib/metricRail.js';
import { snapshot } from '../lib/snapshot.js';

import { installBrowserShims } from './_dom.js';
import { CODE_EXTENSIONS, scanLedger, type ScannedFile } from './_scan.js';

installBrowserShims();

/* ─────────────────── the preference, which jsdom does not have ──────────────── */

let reducedMotion = false;
const changeListeners = new Set<() => void>();

const preferenceQuery = {
  media: REDUCED_MOTION_QUERY,
  get matches(): boolean {
    return reducedMotion;
  },
  addEventListener(_type: 'change', listener: () => void): void {
    changeListeners.add(listener);
  },
  removeEventListener(_type: 'change', listener: () => void): void {
    changeListeners.delete(listener);
  },
};

type MatchMedia = (query: string) => MediaQueryList;

/**
 * Installs `matchMedia`, answering the reduced-motion query from a live flag.
 *
 * Scoped to this file with `beforeAll`/`afterAll` because the ledger project shares
 * one jsdom instance across its suites (`isolate: false`): leaving a global behind
 * would change what every other file's code sees.
 */
function installPreference(): void {
  (globalThis as unknown as { matchMedia: MatchMedia }).matchMedia = ((media: string) =>
    (media === REDUCED_MOTION_QUERY
      ? preferenceQuery
      : { ...preferenceQuery, media, matches: false }) as unknown as MediaQueryList) as MatchMedia;
}

function removePreference(): void {
  delete (globalThis as unknown as { matchMedia?: MatchMedia }).matchMedia;
}

/** Sets the preference and delivers the `change` event a real browser would. */
function setReducedMotion(next: boolean): void {
  reducedMotion = next;
  for (const listener of [...changeListeners]) listener();
}

beforeAll(installPreference);

afterAll(() => {
  stopObservingMotionPreference();
  removePreference();
});

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  reducedMotion = false;
});

afterEach(() => {
  cleanup();
  stopObservingMotionPreference();
  changeListeners.clear();
  reducedMotion = false;
});

/* ───────────────────────── every animated declaration ──────────────────────── */

/**
 * The closed allowlist of `motion-scan.test.ts`, plus the two stroke properties an
 * edge draw moves. Nothing else may be animated, so nothing else needs comparing —
 * and reading the list from the same seven names keeps the two files agreeing about
 * what "animated" means.
 */
const ANIMATED_PROPERTIES = [
  'opacity',
  'transform',
  'color',
  'background-color',
  'border-color',
  'outline-color',
  'box-shadow',
  'stroke-dasharray',
  'stroke-dashoffset',
] as const;

/** One element's animated declarations, plus the two things a reader is given. */
type Declarations = Readonly<Record<string, string>>;

function declarationsOf(element: Element): Declarations {
  const computed = element.ownerDocument.defaultView?.getComputedStyle(element);
  const found: Record<string, string> = {};
  for (const property of ANIMATED_PROPERTIES) {
    found[property] = computed?.getPropertyValue(property) ?? '';
  }
  /* the accessible name, and the text a sighted reader sees — a count-up that
     rewrote either at rest would be a difference between the two states */
  found['aria-label'] = element.getAttribute('aria-label') ?? '';
  found['text'] = element.children.length === 0 ? (element.textContent ?? '') : '';
  return found;
}

/**
 * A stable key for an element across two renders of the same tree.
 *
 * Document order plus the tag and the handles the components already carry. Both
 * renders come from one component tree, so a key that fails to line up is itself a
 * finding, reported as a missing element rather than silently skipped.
 */
function keyOf(element: Element, index: number): string {
  const handles = ['data-promise-node', 'data-promise-panel', 'data-metric', 'data-verdict']
    .map((attribute) => element.getAttribute(attribute))
    .filter((value): value is string => value !== null);
  const identity = handles.length > 0 ? `[${handles.join('|')}]` : `.${element.className || '-'}`;
  return `${String(index).padStart(4, '0')} ${element.tagName.toLowerCase()}${identity}`;
}

function animatedSnapshot(root: ParentNode): Map<string, Declarations> {
  const found = new Map<string, Declarations>();
  [...root.querySelectorAll('*')].forEach((element, index) => {
    found.set(keyOf(element, index), declarationsOf(element));
  });
  return found;
}

/** Every declaration that differs between two snapshots, named. */
function differences(
  left: Map<string, Declarations>,
  right: Map<string, Declarations>,
): string[] {
  const found: string[] = [];
  for (const [key, declarations] of left) {
    const other = right.get(key);
    if (other === undefined) {
      found.push(`${key}  present in the first render and absent from the second`);
      continue;
    }
    for (const [property, value] of Object.entries(declarations)) {
      const compared = other[property] ?? '';
      if (compared !== value) {
        found.push(`${key}  ${property}: "${value}" vs "${compared}"`);
      }
    }
  }
  for (const key of right.keys()) {
    if (!left.has(key)) found.push(`${key}  present in the second render only`);
  }
  return found;
}

/* ───────────────── the orchestration registry, and its tripwire ────────────── */

interface Orchestration {
  /** The shipped module that consumes the gate. */
  readonly site: string;
  /** Runs it against a rendered page and resolves when it has finished. */
  readonly drive: (container: HTMLElement) => Promise<void>;
}

/**
 * Every orchestration this comparison drives.
 *
 * The tripwire at the end of this file asserts that this list names exactly the
 * shipped modules importing `lib/motion.js`, so a flourish cannot be committed while
 * the page comparison still inspects a page where nothing moves.
 *
 * **M5 is driven at a verdict it cannot reach today, on purpose.** The committed
 * snapshot is `degraded: true` with all eight promises `stale`, so no promise on this
 * page has a *previous* verdict — verdict movement arrives with stage 15. Driving the
 * flip with `from` set to some other verdict and `to` set to the one the page
 * actually states is exactly the update `PromiseGraph` will pass down when a snapshot
 * moves: the DOM already shows the destination, and the animation travels from where
 * the promise used to be. That makes the comparison below a real one — a page whose
 * tags have been through a 420 ms cross-fade and pulse, against a page under reduced
 * motion that never moved.
 */
const ORCHESTRATIONS: readonly Orchestration[] = [
  {
    /**
     * M4 — the graph entrance (§10.6.1). Driven explicitly rather than left to the
     * mount effect, because the effect is gated on a `sessionStorage` flag that one of
     * the renders above has already spent: a comparison that depended on which test
     * ran first would be exactly the vacuous green this registry exists to prevent.
     * The orchestration itself is unaware of the flag, so calling it here animates the
     * real nodes of the real page, in lane order, through `play()`.
     */
    site: 'apps/ledger/components/GraphEntrance.tsx',
    drive: async (container) => {
      const nodes = container.querySelectorAll('[data-promise-node]');
      expect(nodes.length, 'no promise node to enter, so M4 was not driven at all')
        .toBeGreaterThan(0);
      await playGraphEntrance(container);
    },
  },
  {
    /**
     * M3 — the panel section cascade (§10.6.3). Driven on a panel rendered beside the
     * page rather than on one inside it, and that is a statement about `/` rather than a
     * convenience: `/` opens no panel, because a panel is what `?p=<id>` or a selection
     * opens (§10.8). Opening one *inside* the compared container would make the two
     * renders differ by a whole panel, which is a difference this file would report and
     * be right to. So the orchestration runs over a real `PromisePanel` over a real
     * promise, and the page comparison keeps comparing the page.
     */
    site: 'apps/ledger/components/PanelStagger.tsx',
    drive: async () => {
      const promise = snapshot.promises[0];
      expect(promise, 'the snapshot carries no promise, so M3 was not driven at all')
        .toBeDefined();
      if (promise === undefined) return;
      const beside = render(<PromisePanel promise={promise} />).container;
      const panel = beside.querySelector<HTMLElement>('[data-promise-panel]');
      expect(panel, 'no panel was rendered, so M3 was not driven at all').not.toBeNull();
      if (panel === null) return;
      await playPanelStagger(panel);
    },
  },
  {
    site: 'apps/ledger/components/VerdictFlip.tsx',
    drive: async (container) => {
      const node = container.querySelector<HTMLElement>('[data-promise-node]');
      expect(node, 'no promise node to flip, so M5 was not driven at all').not.toBeNull();
      if (node === null) return;
      const current = (node.getAttribute('data-verdict') ?? '') as Verdict;
      const previous = VERDICT_RANK.find((verdict) => verdict !== current);
      expect(previous, 'every verdict is the current one, which cannot be').toBeDefined();
      if (previous === undefined) return;
      await playVerdictFlip(node, previous, current);
    },
  },
];

const GATE = 'apps/ledger/lib/motion.tsx';
const TEST_DIRECTORY = 'apps/ledger/test/';
const GATE_SPECIFIER = /from\s*(['"])[^'"]*lib\/motion\.js\1/;

const SHIPPED: ScannedFile[] = scanLedger(CODE_EXTENSIONS).filter(
  (file) => !file.path.startsWith(TEST_DIRECTORY),
);

/** Shipped modules that import the gate — the orchestrations, whatever they animate. */
const GATE_CONSUMERS: string[] = SHIPPED.filter(
  (file) => file.path !== GATE && GATE_SPECIFIER.test(file.text),
)
  .map((file) => file.path)
  .sort();

/** Runs every registered orchestration and waits for the engine to go quiet. */
async function settleEveryOrchestration(container: HTMLElement): Promise<void> {
  for (const orchestration of ORCHESTRATIONS) await orchestration.drive(container);
  for (let attempt = 0; attempt < 100 && pendingMotion() > 0; attempt += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
  expect(pendingMotion(), 'an orchestration never finished, so the render is mid-flight').toBe(0);
}

/* ─────────────────────────── the fixture orchestration ─────────────────────── */

/** The end state of the fixture: the entrance of §10.6.1, one element wide. */
const FIXTURE_END = { opacity: 1, translateY: 0 } as const;

interface Fixture {
  readonly element: HTMLElement;
  readonly spec: MotionSpec;
  /** The engine handle, once `run()` has built it. Seeking it renders a frame. */
  handle: ReturnType<typeof motionAnimation> | null;
}

/**
 * An element that genuinely animates, driven through the shipped gate.
 *
 * Deliberately the same shape as M4's entrance — `opacity` and a 6px lift, from a
 * position the layout already resolved — so what is proven here is the mechanism
 * the flourishes will use, not a toy.
 */
function fixture(): Fixture {
  const element = document.createElement('div');
  element.className = 'motion-fixture';
  document.body.append(element);
  const built: Fixture = {
    element,
    handle: null,
    spec: {
      to: FIXTURE_END,
      run: () => {
        const animation = motionAnimation(element, {
          opacity: [0, 1],
          translateY: [6, 0],
          duration: durationMs('--dur-slow'),
          ease: easeFor('--ease-out'),
        });
        built.handle = animation;
        return animation;
      },
    },
  };
  return built;
}

/* ──────────────────────────────── the machinery ────────────────────────────── */

describe('the equivalence machinery is not blind', () => {
  it('reads a real page, and reads every animated property on it', () => {
    const { container } = render(<LedgerPage />);
    const taken = animatedSnapshot(container);
    expect(taken.size, 'the page under comparison has almost no elements').toBeGreaterThan(30);
    for (const declarations of taken.values()) {
      expect(Object.keys(declarations).sort()).toEqual(
        [...ANIMATED_PROPERTIES, 'aria-label', 'text'].sort(),
      );
    }
  });

  it('reports no difference between two renders of the same state', () => {
    setReducedMotion(true);
    const first = animatedSnapshot(render(<LedgerPage />).container);
    cleanup();
    const second = animatedSnapshot(render(<LedgerPage />).container);
    expect(differences(first, second)).toEqual([]);
  });

  it('reports a difference when one element is caught mid-flight', () => {
    setReducedMotion(false);
    expect(motionEnabled(), 'the preference shim is not answering').toBe(true);

    const driven = fixture();
    const settled = play(driven.element, driven.spec);
    const half = durationMs('--dur-slow') / 2;
    driven.handle?.seek(half);
    const midFlight = animatedSnapshot(document.body);

    driven.handle?.complete();
    const finished = animatedSnapshot(document.body);

    const found = differences(midFlight, finished);
    expect(
      found.length,
      'the comparison saw no difference between a half-played animation and a finished ' +
        'one. A differ that cannot see that cannot see a broken reduced-motion render ' +
        'either, and every assertion in this file would be worthless.',
    ).toBeGreaterThan(0);
    expect(found.join('\n')).toContain('opacity');
    expect(found.join('\n')).toContain('transform');

    return settled;
  });
});

/* ───────── Property 22 — motion off means the end state is the first paint ──── */

describe('Property 22 (reduced-motion clause): motion off settles synchronously', () => {
  it('applies the end state before returning, with no frame in between', async () => {
    setReducedMotion(true);
    expect(motionEnabled()).toBe(false);

    const driven = fixture();
    const settled = play(driven.element, driven.spec);

    /* asserted before any await: "the first painted state" is a claim about the
       absence of an interval, so awaiting first would test something weaker */
    expect(driven.element.style.opacity).toBe('1');
    expect(driven.element.style.transform).toBe('translateY(0px)');
    expect(driven.handle, 'an animation was built under reduced motion').toBeNull();
    expect(pendingMotion()).toBe(0);

    await settled;
    expect(driven.element.style.opacity).toBe('1');
  });

  it('lands on the identical declarations whether it animated or was set', async () => {
    setReducedMotion(true);
    const off = fixture();
    await play(off.element, off.spec);
    const withoutMotion = declarationsOf(off.element);

    setReducedMotion(false);
    const on = fixture();
    const running = play(on.element, on.spec);
    on.handle?.complete();
    await running;
    const afterMotion = declarationsOf(on.element);

    expect(
      afterMotion,
      'the post-animation declarations differ from the ones reduced motion writes, so ' +
        'the two renders of / cannot be identical either (§10.6.4)',
    ).toEqual(withoutMotion);
  });
});

/* ────────────── a mid-session change completes, never cancels ──────────────── */

describe('Property 22 (reduced-motion clause): a preference change completes in-flight motion', () => {
  it('finishes the timeline rather than freezing it half-played', async () => {
    setReducedMotion(false);
    const driven = fixture();
    const settled = play(driven.element, driven.spec);
    observeMotionPreference();

    driven.handle?.seek(durationMs('--dur-slow') / 2);
    const midFlight = declarationsOf(driven.element);
    expect(
      midFlight['opacity'],
      'nothing was in flight, so this test would prove nothing about cancelling',
    ).not.toBe('1');
    expect(pendingMotion()).toBe(1);

    setReducedMotion(true);

    /* synchronously, because a reader who flips the setting must not see the
       intermediate DOM even once */
    expect(driven.element.style.opacity).toBe('1');
    expect(driven.element.style.transform).toBe('translateY(0px)');
    expect(pendingMotion()).toBe(0);

    await settled;
  });

  it('leaves the element where the reduced-motion branch would have put it', async () => {
    setReducedMotion(true);
    const reference = fixture();
    await play(reference.element, reference.spec);
    const target = declarationsOf(reference.element);

    setReducedMotion(false);
    const driven = fixture();
    const settled = play(driven.element, driven.spec);
    observeMotionPreference();
    driven.handle?.seek(durationMs('--dur-figure') / 4);
    setReducedMotion(true);
    await settled;

    expect(declarationsOf(driven.element)).toEqual(target);
  });
});

/* ─────────── Property 22 — the two renders of / are the same DOM ───────────── */

describe('Property 22 (reduced-motion clause): the two renders of / are one render', () => {
  it('compares every animated declaration, node opacity and transform included', async () => {
    setReducedMotion(true);
    const reduced = animatedSnapshot(render(<LedgerPage />).container);
    cleanup();

    setReducedMotion(false);
    const { container } = render(<LedgerPage />);
    await settleEveryOrchestration(container);
    const animated = animatedSnapshot(container);

    const found = differences(reduced, animated);
    expect(
      found,
      `The reduced-motion render and the settled render of / are not the same DOM ` +
        `(design §10.6.4). Every orchestration must declare its end state in ` +
        `MotionSpec.to so the reduced branch can write it, and must not carry ` +
        `information no other channel carries.\n${found.join('\n')}`,
    ).toEqual([]);
  });

  it('finds the graph nodes in both renders, so the comparison covered them', () => {
    setReducedMotion(true);
    const { container } = render(<LedgerPage />);
    const nodes = container.querySelectorAll('[data-promise-node]');
    expect(nodes.length, 'no promise node was painted, so node opacity went unchecked').toBe(
      snapshot.promises.length,
    );
    for (const node of nodes) {
      /* the resting state M4 must animate *from* its own final coordinates */
      expect(node.getAttribute('style') ?? '').not.toContain('opacity: 0');
    }
  });
});

/* ──────────── the metric figure never announces an intermediate number ─────── */

describe('the metric figure carries its final value from first paint', () => {
  /** What each tile must announce, computed from the snapshot rather than the DOM. */
  const EXPECTED: readonly { readonly metric: string; readonly label: string }[] = [
    { metric: 'designed-coverage', label: formatMetricFigure(snapshot.metrics.designedCoverage) },
    { metric: 'suite-debt', label: String(snapshot.metrics.undesignedCount) },
    ...(snapshot.degraded
      ? []
      : [
          {
            metric: 'proven-coverage',
            label: formatMetricFigure(snapshot.metrics.provenCoverage),
          },
        ]),
  ];

  function labelsOf(container: HTMLElement): Record<string, string> {
    const found: Record<string, string> = {};
    for (const tile of container.querySelectorAll('[data-metric]')) {
      const figure = tile.querySelector('[role="img"]');
      expect(figure, `the ${tile.getAttribute('data-metric') ?? ''} tile carries no figure`)
        .not.toBeNull();
      found[tile.getAttribute('data-metric') ?? ''] = figure?.getAttribute('aria-label') ?? '';
      /* the name and the visible runs are one string, so a count-up that rewrote the
         digits without rewriting the name would be caught here at rest */
      expect(figure?.getAttribute('aria-label')).toBe(figure?.textContent);
    }
    return found;
  }

  it('announces the final value under reduced motion, at first paint', () => {
    setReducedMotion(true);
    const found = labelsOf(render(<LedgerPage />).container);
    for (const tile of EXPECTED) expect(found[tile.metric]).toBe(tile.label);
  });

  it('announces the same final value with motion on, before anything has run', async () => {
    setReducedMotion(false);
    const { container } = render(<LedgerPage />);

    /* read at first paint, so a screen reader is never handed an intermediate number
       — §10.6.2's guard, asserted before the count-up of task 17.7 exists */
    const atFirstPaint = labelsOf(container);
    for (const tile of EXPECTED) expect(atFirstPaint[tile.metric]).toBe(tile.label);

    await settleEveryOrchestration(container);
    expect(labelsOf(container)).toEqual(atFirstPaint);
  });
});

/* ──────── the tripwire: no flourish lands without joining this file ────────── */

describe('the first orchestration cannot land without joining this comparison', () => {
  it('scanned shipped code, and can see the gate itself', () => {
    expect(SHIPPED.length, 'no shipped code file was scanned').toBeGreaterThan(0);
    expect(
      SHIPPED.some((file) => file.path === GATE),
      `${GATE} was not scanned, so this tripwire is watching nothing`,
    ).toBe(true);
    expect(GATE_SPECIFIER.test(`import { play } from '../lib/motion.js';`)).toBe(true);
    expect(GATE_SPECIFIER.test(`import { play } from '../lib/layout.js';`)).toBe(false);
  });

  it('drives every shipped module that consumes the gate', () => {
    expect(
      GATE_CONSUMERS,
      `A shipped module imports lib/motion.js and is not driven by this test, so the ` +
        `comparison above is inspecting a page where nothing moves — vacuously green.\n` +
        `Add an entry to ORCHESTRATIONS for each of: ${GATE_CONSUMERS.join(', ')}\n` +
        `Its \`drive\` should trigger the orchestration on a rendered page and resolve ` +
        `when play() resolves. Property 22's reduced-motion clause is not droppable ` +
        `(§18.2): it must be green before the flourish is committed, not after.`,
    ).toEqual(ORCHESTRATIONS.map((orchestration) => orchestration.site));
  });

  it('says plainly that the page comparison now has something to catch', () => {
    /* The inverted form of the assertion this test carried at the gate commit, when
       it read `no orchestration exists yet` and pinned the count to zero. A flourish
       has landed, so the page-level comparison is no longer the vacuous half of this
       file and the count is asserted from below as well as against the scan. */
    expect(
      ORCHESTRATIONS.length,
      'The registry is empty again. The comparison of / above would then be two ' +
        'renders that were never going to differ, agreeing — so this file would pass ' +
        'while saying nothing about §10.6.4.',
    ).toBeGreaterThan(0);
    expect(ORCHESTRATIONS.length).toBe(GATE_CONSUMERS.length);
  });
});
