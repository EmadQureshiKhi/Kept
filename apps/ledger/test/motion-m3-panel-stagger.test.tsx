/**
 * M3 — the panel section stagger (task 17.6, design §10.6.3, §10.6.4, §18.1, R10.4).
 *
 * Four claims, and the fourth is the one §18.1 actually cares about:
 *
 *   1. **The offset and the step are one token.** `(index + 1) × --stagger-panel`, so
 *      the first section starts 40 ms *behind the container* and each one after it a
 *      step later. Asserted as arithmetic against the token, never against a literal.
 *   2. **The sections fade, and nothing else moves.** What lands in a section's
 *      `style` attribute mid-flight is read back, so the claim is about the DOM rather
 *      than about the call site.
 *   3. **Motion off is a state.** The end state is applied with no frame in between,
 *      and the resting DOM is the stylesheet's again — a panel that animated, a panel
 *      under `prefers-reduced-motion: reduce` and a panel whose flourish was cut are
 *      the same bytes.
 *   4. **Dropping M3 leaves the container's slide-and-fade intact.** That is §18.1's
 *      promise, and it only holds while the container transition lives in
 *      `promise-panel.css` and this orchestration never touches `.promise-panel`.
 *      Both halves are asserted: the CSS rule is read, and the module's own source is
 *      read for the selector it animates.
 *
 * The panel is the shipped `PromisePanel` over a promise from the committed snapshot,
 * so the section count is the real one — four today, five for a promise carrying a
 * repair annotation. Nothing here pins that count to a literal; §10.6.3 says "three",
 * which predates two of the sections, and the flourish staggers what the component
 * renders. See the header of `components/PanelStagger.tsx`.
 *
 * jsdom implements no `matchMedia`, so the preference is shimmed here — a browser API
 * jsdom lacks, in the standing of `_dom.tsx`'s `ResizeObserver`, not a stand-in for
 * anything this repository wrote. Installed in `beforeAll` and removed in `afterAll`,
 * because the ledger project shares one jsdom across its suites (`isolate: false`).
 */

import type { SnapshotPromise } from 'kept-core';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  PANEL_SECTION_SELECTOR,
  PANEL_STAGGER_INLINE,
  panelSectionTargets,
  panelStaggerDelay,
  panelStaggerEnd,
  panelStaggerSpec,
  playPanelStagger,
} from '../components/PanelStagger.js';
import { PromisePanel } from '../components/PromisePanel.js';
import {
  REDUCED_MOTION_QUERY,
  durationMs,
  motionEnabled,
  pendingMotion,
  play,
  stopObservingMotionPreference,
  type MotionPlayback,
} from '../lib/motion.js';
import { snapshot } from '../lib/snapshot.js';

import { REPO_ROOT, normaliseCssValue, parseCss } from './_scan.js';

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
});

beforeEach(() => {
  reducedMotion = false;
});

afterEach(() => {
  cleanup();
  stopObservingMotionPreference();
  reducedMotion = false;
});

/* ───────────────────────────────── the fixture ──────────────────────────────── */

const STEP = durationMs('--stagger-panel');

/** The first promise of the committed snapshot: a real claim, a real citation. */
const SUBJECT: SnapshotPromise | undefined = snapshot.promises[0];

/** Renders the shipped panel and returns its container element. */
function renderPanel(promise: SnapshotPromise | undefined = SUBJECT): HTMLElement {
  if (promise === undefined) throw new Error('the committed snapshot carries no promise');
  const { container } = render(<PromisePanel promise={promise} />);
  const panel = container.querySelector<HTMLElement>('[data-promise-panel]');
  if (panel === null) throw new Error('PromisePanel rendered no panel');
  return panel;
}

/** Every section's `style` attribute, in painted order. `null` where absent. */
function restingStyles(panel: ParentNode): (string | null)[] {
  return panelSectionTargets(panel).map((section) => section.getAttribute('style'));
}

/** Waits for every in-flight orchestration to land, then says so. */
async function quiet(): Promise<void> {
  for (let attempt = 0; attempt < 100 && pendingMotion() > 0; attempt += 1) {
    await new Promise((ready) => {
      setTimeout(ready, 20);
    });
  }
  expect(pendingMotion(), 'a cascade never finished').toBe(0);
}

/* ──────────────────── the offset and the step are one token ─────────────────── */

describe('the sections start one --stagger-panel step behind the container', () => {
  it('reads the step from the token rather than from a literal', () => {
    expect(STEP).toBe(40);
  });

  it('delays the nth section by (n + 1) steps, monotonically', () => {
    expect(panelStaggerDelay(0)).toBe(STEP);
    for (const index of [0, 1, 2, 3, 4, 9]) {
      expect(panelStaggerDelay(index)).toBe((index + 1) * STEP);
    }
    for (let index = 1; index < 8; index += 1) {
      expect(panelStaggerDelay(index)).toBeGreaterThan(panelStaggerDelay(index - 1));
    }
    /* the first section waits, which is what "behind the container" means: the panel is
       already moving before anything inside it is */
    expect(panelStaggerDelay(0)).toBeGreaterThan(0);
  });

  it('declares an end state of present, at the opacity the stylesheet resolves', () => {
    expect(panelStaggerEnd()).toEqual({ opacity: 1 });
    /* a fresh record each time: the engine writes its own bookkeeping into the object it
       is handed, so a shared constant comes back from the first settle carrying a
       `composition` and a `duration` of 1e-11 */
    expect(panelStaggerEnd()).not.toBe(panelStaggerEnd());
  });
});

/* ────────────────────── the targets, in the painted order ───────────────────── */

describe('the cascade animates the panel sections the component renders', () => {
  it('finds every section, and only sections', () => {
    const panel = renderPanel();
    const targets = panelSectionTargets(panel);
    expect(targets.length, 'no panel section was found, so the cascade is a no-op')
      .toBeGreaterThan(2);
    expect(targets.length).toBe(panel.querySelectorAll(PANEL_SECTION_SELECTOR).length);
    for (const section of targets) {
      expect(section.tagName.toLowerCase()).toBe('section');
      expect(section.className).toContain('promise-panel__section');
    }
    /* the container is not among them — §18.1's promise depends on that */
    expect(targets).not.toContain(panel);
  });

  it('animates nothing when there is no panel', () => {
    const empty = document.createElement('div');
    document.body.append(empty);
    expect(panelSectionTargets(empty)).toEqual([]);
    return playPanelStagger(empty);
  });
});

/* ─────────────── what it writes: opacity, and nothing but opacity ───────────── */

describe('the cascade writes only opacity', () => {
  it('fades each section in, later ones after earlier ones', async () => {
    const panel = renderPanel();
    expect(motionEnabled(), 'the preference shim is not answering').toBe(true);

    let playback: MotionPlayback | null = null;
    const settled = playPanelStagger(panel, (started) => {
      playback = started;
    });
    const handle = playback as unknown as {
      seek(time: number): void;
      complete(): void;
      duration: number;
    } | null;
    expect(handle, 'no timeline was built with motion on').not.toBeNull();

    /* one step in, the first section has begun and the last has not */
    handle?.seek(STEP + durationMs('--dur-base') / 2);
    const sections = panelSectionTargets(panel);
    const first = sections[0];
    const last = sections[sections.length - 1];

    const written = [...(first?.style ?? [])];
    expect(written.length, 'nothing was in flight, so this proves nothing').toBeGreaterThan(0);
    for (const property of written) {
      expect(
        PANEL_STAGGER_INLINE as readonly string[],
        `the cascade animates ${property}. The container's own slide is a CSS ` +
          `transition (§10.6.3); the sections only fade.`,
      ).toContain(property);
    }
    expect(Number(first?.style.opacity)).toBeGreaterThan(0);
    expect(
      Number(last?.style.opacity),
      'every section faded at once, so there is no stagger',
    ).toBeLessThan(Number(first?.style.opacity));

    /* one timeline, and its length is the last section's delay plus one fade */
    expect(handle?.duration).toBe(
      panelStaggerDelay(sections.length - 1) + durationMs('--dur-base'),
    );

    handle?.complete();
    await settled;
    await quiet();
  });

  it('completes a cascade already running rather than stranding it', async () => {
    const panel = renderPanel();
    expect(pendingMotion(), 'the mount did not start a cascade').toBe(1);

    await playPanelStagger(panel);
    expect(
      pendingMotion(),
      'a second cascade left the first one unable to finish, so the gate still believes ' +
        'something is in flight',
    ).toBe(0);
    expect(restingStyles(panel).every((style) => style === null)).toBe(true);
  });

  it('completes rather than freezing when the panel closes mid-cascade', async () => {
    const panel = renderPanel();
    const sections = panelSectionTargets(panel);
    expect(pendingMotion()).toBe(1);

    cleanup();

    expect(
      pendingMotion(),
      'the cascade survived its own panel, so detached sections are still being ' +
        'interpolated (§10.6.4: complete, never cancel)',
    ).toBe(0);
    await quiet();
    expect(sections.every((section) => section.getAttribute('style') === null)).toBe(true);
  });
});

/* ─────────── motion off is a state, and the resting DOM is one DOM ─────────── */

describe('the resting DOM is byte-identical to the no-motion render', () => {
  it('applies the end state synchronously with motion off, and rests with no style', () => {
    reducedMotion = true;
    expect(motionEnabled()).toBe(false);

    const panel = renderPanel();
    let playback: MotionPlayback | null = null;
    void playPanelStagger(panel, (started) => {
      playback = started;
    });

    /* no await: with motion off there is no frame to wait for, so the release cannot be a
       microtask behind either — the first painted state of a reduced-motion render is the
       stylesheet's, not an inline restatement of it (§10.6.4) */
    expect(playback, 'a timeline was built under reduced motion').toBeNull();
    expect(pendingMotion()).toBe(0);
    expect(restingStyles(panel).every((style) => style === null)).toBe(true);
  });

  it('is a spec whose end state alone produces the finished panel', async () => {
    reducedMotion = true;
    const panel = renderPanel();
    const targets = panelSectionTargets(panel);
    const spec = panelStaggerSpec(targets);
    expect(spec.to).toEqual(panelStaggerEnd());

    /* the gate, called directly, so what is asserted is the end state rather than this
       module's handling of it */
    const settled = play(targets, spec);
    expect(targets[0]?.style.opacity).toBe('1');
    expect(pendingMotion()).toBe(0);
    await settled;
  });

  it('agrees across motion off, motion on and landed, and the dropped flourish', async () => {
    reducedMotion = true;
    const off = restingStyles(renderPanel());
    expect(off.length).toBeGreaterThan(2);
    expect(
      off.every((style) => style === null),
      'the reduced-motion render carries an inline style, so the panel does not rest ' +
        'where the stylesheet puts it',
    ).toBe(true);
    cleanup();

    reducedMotion = false;
    const panel = renderPanel();
    await quiet();
    expect(
      restingStyles(panel),
      'a section that faded kept the declaration the cascade wrote, so a panel that ' +
        'animated is not the same bytes as one that did not (§18.1)',
    ).toEqual(off);
  });
});

/* ────────── §18.1: dropping M3 leaves the container transition intact ───────── */

describe('the container slides whether or not this flourish exists', () => {
  const PANEL_CSS = 'apps/ledger/styles/promise-panel.css';
  const MODULE = 'apps/ledger/components/PanelStagger.tsx';

  function read(path: string): string {
    const text = readFileSync(resolve(REPO_ROOT, path), 'utf8');
    if (text.trim() === '') throw new Error(`${path} is empty, so this rule reads nothing`);
    return text;
  }

  it('keeps the container slide-and-fade a plain CSS transition on .promise-panel', () => {
    const rules = parseCss(read(PANEL_CSS)).filter((rule) => rule.prelude === '.promise-panel');
    expect(rules.length, `${PANEL_CSS} declares no .promise-panel rule`).toBe(1);
    const transition = rules[0]?.declarations.find(
      (declaration) => declaration.property === 'transition',
    );
    expect(
      transition,
      `The panel's slide and fade is a plain CSS transition (§10.6.3), and §18.1's claim ` +
        `that dropping M3 leaves the panel "sliding as one unit" depends on it living in ` +
        `${PANEL_CSS} rather than in a timeline.`,
    ).toBeDefined();
    const value = normaliseCssValue(transition?.value ?? '');
    expect(value).toContain('opacity');
    expect(value).toContain('transform');
    expect(value).toContain('var(--dur-base)');
    expect(value).toContain('var(--ease-out)');
  });

  it('never animates the container itself, so deleting this module changes nothing else', () => {
    const source = read(MODULE);
    expect(PANEL_SECTION_SELECTOR).toBe('.promise-panel__section');
    /* the only selector the module names is the section one; a `.promise-panel` selector
       here would mean the container had been moved into play() */
    expect(
      source.includes(`'.promise-panel'`),
      `${MODULE} selects the panel container. M3 staggers the sections; the container is ` +
        `the stylesheet's, and §18.1 promises it survives this flourish being cut.`,
    ).toBe(false);
    expect(source).toContain(PANEL_SECTION_SELECTOR);
  });
});
