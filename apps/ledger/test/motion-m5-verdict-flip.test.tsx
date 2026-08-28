/**
 * M5 — the verdict flip (task 17.4, design §10.6.3, §10.6.4, §18.1, R10.4).
 *
 * Four things are worth asserting about a flourish, and only the first of them is
 * about the animation:
 *
 *   1. **It is one timeline**, at `--dur-slow` on `--ease-emphasis`, moving the three
 *      things the §10.6.3 table names and nothing else. Asserted through the
 *      timeline's own duration and through what lands in the `style` attribute,
 *      rather than by trusting the call site.
 *   2. **It carries no information.** Every ordered pair of verdicts is flipped on a
 *      real node, and the resting DOM afterwards is compared with a node that never
 *      flipped at all — twelve pairs, exhaustive, so this is stronger than sampling.
 *   3. **Motion off is a state.** The end state is applied synchronously, before any
 *      `await`, and the resting DOM is again the stylesheet's.
 *   4. **It fires on a change and only on a change.** Mount animates nothing; a
 *      re-render with a new verdict animates; unmounting mid-pulse *completes*.
 *
 * ── What the snapshot cannot supply ──────────────────────────────────────────
 *
 * The committed snapshot has verdict variety now, seven `proven`, five `stale` and one
 * `red` across its thirteen promises, but it still has no verdict *change* to show: it
 * is one instant, and a flip needs two. That arrives with stage 15. So the change is
 * supplied here: a `PromiseNode` is
 * rendered at one verdict and re-rendered at another, which is exactly the update
 * `PromiseGraph` will pass down when the snapshot moves, and the orchestration is
 * also driven directly against a rendered node for the pairs a single re-render
 * cannot cover. Nothing is mocked: the component, the gate, the engine and the
 * tokens are all the shipped ones.
 *
 * jsdom implements no `matchMedia`, so the preference is shimmed here — a browser
 * API jsdom lacks, in the standing of `_dom.tsx`'s `ResizeObserver`, not a stand-in
 * for anything this repository wrote. It is installed in `beforeAll` and removed in
 * `afterAll` because the ledger project shares one jsdom across its suites
 * (`isolate: false`); a `matchMedia` left behind would silently turn motion on for
 * every other file.
 */

import type { Verdict } from 'kept-core';
import { cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  VERDICT_FLIP_INLINE,
  VERDICT_FLIP_PEAK,
  VERDICT_TAG_SELECTOR,
  VERDICT_WORD_SELECTOR,
  playVerdictFlip,
  verdictFlipEnd,
  verdictFlipTargets,
} from '../components/VerdictFlip.js';
import { PromiseNode } from '../components/PromiseNode.js';
import { VERDICT_RANK, VERDICT_TOKENS, VERDICT_WASHES } from '../components/VerdictTag.js';
import {
  REDUCED_MOTION_QUERY,
  durationMs,
  motionEnabled,
  pendingMotion,
  stopObservingMotionPreference,
  type MotionPlayback,
} from '../lib/motion.js';
import { snapshot } from '../lib/snapshot.js';
import { TOKENS } from '../lib/tokens.js';

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

const VERDICTS: readonly Verdict[] = VERDICT_RANK;

/** The first promise of the committed snapshot: a real claim, a real citation. */
const SUBJECT = snapshot.promises[0];

/** Every ordered pair of *different* verdicts — the twelve flips that can happen. */
const PAIRS: readonly { readonly from: Verdict; readonly to: Verdict }[] = VERDICTS.flatMap(
  (from) => VERDICTS.filter((to) => to !== from).map((to) => ({ from, to })),
);

/** Renders one node at `verdict` and returns its element. */
function renderNode(verdict: Verdict): HTMLElement {
  if (SUBJECT === undefined) throw new Error('the committed snapshot carries no promise');
  const { container } = render(<PromiseNode promise={{ ...SUBJECT, verdict }} />);
  const node = container.querySelector<HTMLElement>('[data-promise-node]');
  if (node === null) throw new Error('PromiseNode rendered no node');
  return node;
}

/** The `style` attribute exactly as it would be serialised, `null` when absent. */
function inlineStyle(element: Element): string | null {
  return element.getAttribute('style');
}

/**
 * Flips a node and completes the timeline at once, rather than waiting `--dur-slow`.
 *
 * Twelve real 420 ms flips is a minute of wall clock spent proving nothing extra:
 * `complete()` is the same code path a mid-session preference change takes (§10.6.4),
 * it runs the engine's own final frame, and `play()` then settles and this file's
 * subject — the release — runs exactly as it does after a natural finish. One flip is
 * left to finish on its own, in the timeline test above, which is where the duration
 * is the claim.
 */
async function flipNow(node: HTMLElement, from: Verdict, to: Verdict): Promise<void> {
  let playback: MotionPlayback | null = null;
  const settled = playVerdictFlip(node, from, to, (started) => {
    playback = started;
  });
  (playback as unknown as { complete(): void } | null)?.complete();
  await settled;
}

/** Waits for every in-flight orchestration to land, then says so. */
async function quiet(): Promise<void> {
  for (let attempt = 0; attempt < 100 && pendingMotion() > 0; attempt += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
  expect(pendingMotion(), 'a flip never finished').toBe(0);
}

/* ───────────────────────────── the three targets ────────────────────────────── */

describe('the flip moves the three things §10.6.3 names', () => {
  it('resolves the split DOM VerdictTag hands it', () => {
    const node = renderNode('stale');
    const targets = verdictFlipTargets(node);
    expect(targets, 'the node carries no verdict tag').not.toBeNull();
    expect(targets?.node).toBe(node);
    expect(targets?.tag).toBe(node.querySelector(VERDICT_TAG_SELECTOR));
    expect(targets?.word).toBe(node.querySelector(VERDICT_WORD_SELECTOR));
    /* the split is what keeps a wash off text: the wash is on the box, the hue on
       the word, and they are different elements (§10.4.3) */
    expect(targets?.tag).not.toBe(targets?.word);
    expect(targets?.word.textContent).toBe('stale');
  });

  it('declines to animate a node with no tag, rather than throwing at a reader', () => {
    const bare = document.createElement('div');
    document.body.append(bare);
    expect(verdictFlipTargets(bare)).toBeNull();
    return playVerdictFlip(bare, 'stale', 'proven');
  });

  it('declares an end state of the new hue, the new wash and identity scale', () => {
    for (const verdict of VERDICTS) {
      expect(verdictFlipEnd(verdict)).toEqual({
        scale: 1,
        color: TOKENS[VERDICT_TOKENS[verdict]],
        borderLeftColor: TOKENS[VERDICT_WASHES[verdict]],
      });
    }
    /* read from the token mirror, never written here: a renamed token fails in
       lib/tokens.ts and token-parity.test.ts rather than resolving to nothing */
    expect(verdictFlipEnd('proven')['color']).toBe(TOKENS['--verdict-proven']);
    expect(verdictFlipEnd('red')['borderLeftColor']).toBe(TOKENS['--wash-red']);
  });

  it('pulses by 6% and returns to identity', () => {
    expect(VERDICT_FLIP_PEAK).toBe(1.06);
    expect(verdictFlipEnd('proven')['scale']).toBe(1);
  });
});

/* ─────────────── one timeline, at --dur-slow on --ease-emphasis ─────────────── */

describe('the flip is one timeline on the motion tokens', () => {
  it('runs for exactly --dur-slow, with every track starting together', async () => {
    const node = renderNode('stale');
    let playback: MotionPlayback | null = null;
    const settled = playVerdictFlip(node, 'stale', 'proven', (started) => {
      playback = started;
    });

    expect(motionEnabled(), 'the preference shim is not answering').toBe(true);
    expect(playback, 'no timeline was built with motion on').not.toBeNull();
    expect(
      (playback as unknown as { duration: number } | null)?.duration,
      'the timeline is longer than --dur-slow, so a track was appended rather than ' +
        'started at position 0 — that reads as two events happening to one tag',
    ).toBe(durationMs('--dur-slow'));

    await settled;
    await quiet();
  });

  it('writes only allowlisted properties while it runs', async () => {
    const node = renderNode('stale');
    const tag = node.querySelector<HTMLElement>(VERDICT_TAG_SELECTOR);
    const word = node.querySelector<HTMLElement>(VERDICT_WORD_SELECTOR);
    let playback: MotionPlayback | null = null;
    const settled = playVerdictFlip(node, 'stale', 'red', (started) => {
      playback = started;
    });

    (playback as unknown as { seek(time: number): void } | null)?.seek(
      durationMs('--dur-slow') / 2,
    );

    const written = [node, tag, word].flatMap((element) =>
      [...(element?.style ?? [])].map((property) => property),
    );
    expect(written.length, 'nothing was in flight, so this proves nothing').toBeGreaterThan(0);
    for (const property of written) {
      expect(
        VERDICT_FLIP_INLINE as readonly string[],
        `the flip animates ${property}, which is not one of the three declarations it ` +
          `is allowed to write (motion-scan.test.ts's closed allowlist)`,
      ).toContain(property);
    }
    /* mid-pulse the box is scaled and the word is not at its resting hue */
    expect(tag?.style.transform ?? '').toContain('scale');

    (playback as unknown as { complete(): void } | null)?.complete();
    await settled;
    await quiet();
  });
});

/* ──────── the resting DOM is the stylesheet's, for all twelve flips ─────────── */

describe('a landed flip leaves the DOM the no-motion render leaves', () => {
  it('is byte-identical to a node that never flipped, for every ordered pair', async () => {
    for (const pair of PAIRS) {
      const reference = renderNode(pair.to);
      const referenceStyles = [
        inlineStyle(reference),
        inlineStyle(reference.querySelector(VERDICT_TAG_SELECTOR) ?? reference),
        inlineStyle(reference.querySelector(VERDICT_WORD_SELECTOR) ?? reference),
      ];
      cleanup();

      const flipped = renderNode(pair.to);
      await flipNow(flipped, pair.from, pair.to);
      const flippedStyles = [
        inlineStyle(flipped),
        inlineStyle(flipped.querySelector(VERDICT_TAG_SELECTOR) ?? flipped),
        inlineStyle(flipped.querySelector(VERDICT_WORD_SELECTOR) ?? flipped),
      ];

      expect(
        flippedStyles,
        `after ${pair.from} → ${pair.to} the node carries inline declarations a node ` +
          `that never animated does not. The resting DOM is the stylesheet's ` +
          `(§18.1, task 17.5) — release what the end state wrote.`,
      ).toEqual(referenceStyles);
      expect(flipped.getAttribute('data-verdict')).toBe(pair.to);
      expect(flipped.querySelector(VERDICT_WORD_SELECTOR)?.textContent).toBe(pair.to);
      cleanup();
      await quiet();
    }
  });

  it('does nothing at all when the verdict did not change', async () => {
    const node = renderNode('stale');
    await playVerdictFlip(node, 'stale', 'stale');
    expect(pendingMotion()).toBe(0);
    expect(inlineStyle(node)).toBeNull();
    expect(inlineStyle(node.querySelector(VERDICT_TAG_SELECTOR) ?? node)).toBeNull();
  });
});

/* ───────────────── motion off: the end state is the first paint ─────────────── */

describe('motion off is a state, not a fallback', () => {
  it('applies the end state before returning and builds no timeline', async () => {
    reducedMotion = true;
    expect(motionEnabled()).toBe(false);

    const node = renderNode('stale');
    const word = node.querySelector<HTMLElement>(VERDICT_WORD_SELECTOR);
    let playback: MotionPlayback | null = null;
    const settled = playVerdictFlip(node, 'stale', 'proven', (started) => {
      playback = started;
    });

    /* asserted before the await: the claim is that there is no interval */
    expect(playback, 'a timeline was built under reduced motion').toBeNull();
    expect(word?.style.color).toBe('rgb(31, 111, 74)');
    expect(pendingMotion()).toBe(0);

    await settled;
    /* and then handed back, so the hue is the stylesheet's again */
    expect(inlineStyle(node)).toBeNull();
    expect(inlineStyle(word ?? node)).toBeNull();
  });
});

/* ───────────────────── it fires on a change, and only then ──────────────────── */

describe('the hook fires on a verdict change', () => {
  it('animates nothing on mount', async () => {
    renderNode('stale');
    expect(pendingMotion(), 'a tag pulsed on first paint, announcing an event that did ' + 'not happen').toBe(0);
    await quiet();
  });

  it('animates when a re-render changes the verdict, and lands at rest', async () => {
    if (SUBJECT === undefined) throw new Error('the committed snapshot carries no promise');
    const view = render(<PromiseNode promise={{ ...SUBJECT, verdict: 'stale' }} />);
    expect(pendingMotion()).toBe(0);

    view.rerender(<PromiseNode promise={{ ...SUBJECT, verdict: 'proven' }} />);
    expect(pendingMotion(), 'the verdict changed and nothing marked it').toBe(1);

    await quiet();
    const node = view.container.querySelector<HTMLElement>('[data-promise-node]');
    expect(inlineStyle(node ?? view.container)).toBeNull();
    expect(node?.getAttribute('data-verdict')).toBe('proven');
  });

  it('completes rather than freezing when the node unmounts mid-pulse', async () => {
    if (SUBJECT === undefined) throw new Error('the committed snapshot carries no promise');
    const view = render(<PromiseNode promise={{ ...SUBJECT, verdict: 'red' }} />);
    view.rerender(<PromiseNode promise={{ ...SUBJECT, verdict: 'undesigned' }} />);
    expect(pendingMotion()).toBe(1);

    view.unmount();

    expect(
      pendingMotion(),
      'the pulse survived its own node, so a detached element is still being ' +
        'interpolated (§10.6.4: complete, never cancel)',
    ).toBe(0);
    await quiet();
  });
});
