/**
 * M5 — the verdict flip (design §10.6.3, §10.6.4, §18.1, R10.4, task 17.4).
 *
 * A promise changing state is *the* event this product exists to show, which is why
 * §18.1 builds this first and drops it last. One timeline marks it:
 *
 *   - the **word** cross-fades `--verdict-*` → `--verdict-*`;
 *   - the **box** pulses `1 → 1.06 → 1`;
 *   - the **node's** 3px left edge cross-fades `--wash-*` → `--wash-*`;
 *
 * all three starting together at `--dur-slow` on `--ease-emphasis`, and all three
 * routed through the one `play()` gate so the reduced-motion state is a property of
 * the gate rather than of this file (§10.6.4).
 *
 * **The three targets come for free from `VerdictTag`'s split DOM.** That component
 * puts the wash on the box and the hue on the word specifically so no CSS rule can
 * declare a wash and a `color` together (§10.4.3); the same split hands this
 * orchestration a `transform` target and a `color` target that cannot collide. The
 * selectors below are the only coupling, and they are the two class names that
 * component's stylesheet is built around.
 *
 * **What the animation is not allowed to carry.** Nothing. The verdict word is text,
 * the hue and the wash are `data-verdict` plus `verdict-tag.css`, and all of it is
 * correct with motion off — which is exactly why the end state can be *released*
 * after landing (see `motionRelease.tsx`) and the resting DOM is the stylesheet's
 * again. A reader who never sees this animation loses nothing but the emphasis.
 *
 * **Why the hues are read from `TOKENS` rather than from the DOM.** The obvious
 * spelling — read `getComputedStyle(word).color` for the "from" value — breaks the
 * second time it runs: the first flip leaves an inline colour, and the read then
 * returns that instead of what the cascade says. Reading both endpoints from the
 * token mirror keeps the arithmetic deterministic, keeps it working under jsdom
 * (which applies no stylesheet at all), and keeps it honest — `VERDICT_TOKENS` and
 * `VERDICT_WASHES` are the same `Record<Verdict, TokenName>` maps the component
 * renders from, so the animation cannot flip to a colour the tag would not have
 * settled on. It adds no new `--verdict-*` *selector*, so the two-consumer allowlist
 * of `verdict-presentation.prop.test.tsx` is untouched.
 *
 * **Today it is a no-op, deliberately.** The committed snapshot spreads its thirteen
 * promises across three verdicts, seven `proven`, five `stale` and one `red`, but it is a
 * single instant: nothing on the page has a verdict to flip *from*, because there is no
 * earlier snapshot to have moved away from. Verdict movement arrives with stage 15.
 * `playVerdictFlip` therefore returns an already-resolved promise when the two verdicts
 * are equal, and the hook fires only on a change, never on mount. What is tested is the
 * change itself:
 * every ordered pair of verdicts, on a real node, in `motion-m5-verdict-flip.test.tsx`.
 */

'use client';

import type { Verdict } from '@kept/core';
import { useEffect, useRef, type RefObject } from 'react';

import {
  durationMs,
  easeFor,
  motionTimeline,
  play,
  type MotionEndState,
  type MotionPlayback,
  type MotionSpec,
} from '../lib/motion.js';
import { TOKENS } from '../lib/tokens.js';

import { VERDICT_TOKENS, VERDICT_WASHES } from './VerdictTag.js';
import { releaseInlineMotion } from './motionRelease.js';

/** The tag box — `VerdictTag`'s outer span, which carries the wash border. */
export const VERDICT_TAG_SELECTOR = '.verdict-tag';

/** The word inside it, which carries the verdict hue and nothing else. */
export const VERDICT_WORD_SELECTOR = '.verdict-tag__word';

/**
 * The peak of the pulse, from the §10.6.3 table: `1 → 1.06 → 1`.
 *
 * 6% is the whole budget. It is enough to catch peripheral vision on a 320px node
 * and small enough that the tag never overlaps its neighbours, so no layout is
 * implied and no reflow is possible — a `transform`, on the compositor, returning
 * to identity.
 */
export const VERDICT_FLIP_PEAK = 1.06;

/**
 * The inline declarations the flip writes, and therefore the ones it hands back.
 *
 * `transform` rather than `scale`: the engine composes its transform functions into
 * the one CSS property, so that is the property name the release has to remove.
 */
export const VERDICT_FLIP_INLINE = ['transform', 'color', 'border-left-color'] as const;

/** The three elements one flip moves, resolved from a promise node. */
export interface VerdictFlipTargets {
  /** The node, whose 3px left edge carries the wash. */
  readonly node: HTMLElement;
  /** The tag box, which pulses. */
  readonly tag: HTMLElement;
  /** The verdict word, which changes hue. */
  readonly word: HTMLElement;
}

/**
 * The three targets inside a promise node, or `null` if the tag is not there.
 *
 * `null` rather than a throw: a node without a tag is a rendering this repository
 * does not produce (`PromiseNode` always renders one), and if it ever did, refusing
 * to animate is the correct response — the verdict would still be readable.
 */
export function verdictFlipTargets(node: HTMLElement): VerdictFlipTargets | null {
  const tag = node.querySelector<HTMLElement>(VERDICT_TAG_SELECTOR);
  const word = tag?.querySelector<HTMLElement>(VERDICT_WORD_SELECTOR) ?? null;
  if (tag === null || word === null) return null;
  return { node, tag, word };
}

/**
 * The end state, as §10.6.4 requires it: the new verdict's hue, the new verdict's
 * wash, and scale back at identity.
 *
 * One record for all three targets, because the gate settles one end state over the
 * targets it was given. Every value in it is what the cascade already resolves for
 * the element that owns it — the hue for the word, the wash for the node's edge,
 * identity for the box — so applying the whole record to all three is visually
 * inert, and it is removed a microtask later either way.
 */
export function verdictFlipEnd(to: Verdict): MotionEndState {
  return {
    scale: 1,
    color: TOKENS[VERDICT_TOKENS[to]],
    borderLeftColor: TOKENS[VERDICT_WASHES[to]],
  };
}

/**
 * One timeline, three tracks, all beginning at position `0`.
 *
 * The explicit `0` is what makes it *one* event rather than a sequence: a timeline
 * appends by default, and a colour that finished before the pulse started would read
 * as two things happening to one tag.
 */
export function verdictFlipSpec(
  targets: VerdictFlipTargets,
  from: Verdict,
  to: Verdict,
): MotionSpec {
  const duration = durationMs('--dur-slow');
  const ease = easeFor('--ease-emphasis');
  return {
    to: verdictFlipEnd(to),
    run: () =>
      motionTimeline()
        .add(
          targets.word,
          {
            color: [TOKENS[VERDICT_TOKENS[from]], TOKENS[VERDICT_TOKENS[to]]],
            duration,
            ease,
          },
          0,
        )
        .add(targets.tag, { scale: [1, VERDICT_FLIP_PEAK, 1], duration, ease }, 0)
        .add(
          targets.node,
          {
            borderLeftColor: [TOKENS[VERDICT_WASHES[from]], TOKENS[VERDICT_WASHES[to]]],
            duration,
            ease,
          },
          0,
        ),
  };
}

/**
 * Marks a promise node's verdict changing from `from` to `to`.
 *
 * Resolves when the flip has landed and the inline declarations have been released,
 * so an awaiting caller — a test, or the equivalence comparison of task 17.3 — sees
 * the resting DOM rather than the last frame.
 *
 * A no-op when the verdict did not change, which is the state of the whole page
 * today: an already-resolved promise, no timeline built, nothing written.
 *
 * @param onPlayback receives the timeline, so a caller can complete it early —
 * which is what unmounting does, because a half-played pulse left on a detached
 * node is the intermediate state §10.6.4 exists to prevent.
 */
export function playVerdictFlip(
  node: HTMLElement,
  from: Verdict,
  to: Verdict,
  onPlayback?: (playback: MotionPlayback) => void,
): Promise<void> {
  if (from === to) return Promise.resolve();
  const targets = verdictFlipTargets(node);
  if (targets === null) return Promise.resolve();

  const elements: readonly HTMLElement[] = [targets.word, targets.tag, targets.node];
  const spec = verdictFlipSpec(targets, from, to);
  const settled = play(elements, {
    to: spec.to,
    run: () => {
      const playback = spec.run();
      onPlayback?.(playback);
      return playback;
    },
  });
  return settled.then(() => {
    releaseInlineMotion(elements, VERDICT_FLIP_INLINE);
  });
}

/**
 * Fires the flip when a rendered node's verdict changes.
 *
 * The previous verdict is remembered in a ref rather than derived from the DOM,
 * because by the time an effect runs React has already painted the new one — the
 * hue on the page is the destination, and only this hook still knows the origin.
 *
 * First mount records the verdict and animates nothing: an entrance is M4's job
 * (§10.6.1), and a page that pulsed every tag on load would be announcing eight
 * events that did not happen.
 */
export function useVerdictFlip(nodeRef: RefObject<HTMLElement | null>, verdict: Verdict): void {
  const previous = useRef<Verdict | null>(null);
  const playback = useRef<MotionPlayback | null>(null);

  useEffect(() => {
    const from = previous.current;
    previous.current = verdict;
    const node = nodeRef.current;
    if (node === null || from === null || from === verdict) return;

    void playVerdictFlip(node, from, verdict, (started) => {
      playback.current = started;
    });

    /* Completed, never cancelled — the gate's third contract, applied to the one
       thing the gate cannot see: this component going away mid-pulse. */
    return () => {
      playback.current?.complete?.();
      playback.current = null;
    };
  }, [nodeRef, verdict]);
}
