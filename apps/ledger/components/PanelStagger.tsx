/**
 * M3 — the panel section stagger (design §10.6.3, §10.6.4, §18.1, R10.4, task 17.6).
 *
 * The panel arrives as one object — `translateX 16 → 0` and a fade, at `--dur-base` on
 * `--ease-out` — and its sections arrive just behind it, one `--stagger-panel` step
 * apart. §10.6.3 says why that is not decoration: *the stagger establishes that the
 * claim is the subject and the evidence links are its detail.* The claim is already on
 * the page when the first section starts.
 *
 * **The container's slide and fade is not here, and must not be.** It is a plain CSS
 * transition on `.promise-panel` in `styles/promise-panel.css`, which §10.6.3 lists as
 * a transition rather than an orchestration, and §18.1's whole claim about dropping M3
 * is that "the panel's own slide-and-fade is a plain CSS transition and survives".
 * Deleting this file therefore leaves the panel sliding as one unit, which is exactly
 * what that column of the table promises. Moving the container into `play()` would make
 * that sentence false, so the only thing this module touches is the sections.
 *
 * **What the sections animate: opacity, and nothing else.** The container is already
 * travelling 16px; a second displacement inside it would read as the panel's contents
 * sliding *within* the panel, which is motion describing nothing. So the stagger is a
 * fade cascade over a container that is itself moving — one gesture, layered.
 *
 * **The offset and the step are the same 40 ms.** `--stagger-panel` is read once and
 * used twice: as the engine's `start`, which is the "40 ms behind the container" of
 * §10.6.3, and as its step, which is what makes the sections a cascade rather than a
 * block. Both come from the token, so there is no duration literal here (§10.4.1).
 *
 * **One honest discrepancy, in the same shape as M4's.** §10.6.3 says "the panel's
 * three sections", and `PromisePanel` renders four when the promise carries no repair
 * annotation and five when it does — citation, designed test, verdict, repair, evidence.
 * The design's three predates the repair and evidence sections. This staggers *the
 * panel's sections*, whatever the promise makes of them, in painted order: the
 * alternative would be a magic number that silently stopped animating the last two, and
 * a cascade with a hole in it is worse than a cascade one item longer than a sentence
 * in the design document. The count is asserted from `PromisePanel`'s own DOM in
 * `motion-m3-panel-stagger.test.tsx` rather than pinned to a literal.
 *
 * **The resting DOM is the stylesheet's again.** The end state is `opacity: 1`, which is
 * what the cascade already resolves for a section, and it is released once the cascade
 * lands — so a panel that animated, a panel under `prefers-reduced-motion: reduce` and a
 * panel with M3 deleted are the same bytes. See `motionRelease.tsx`.
 *
 * Not a component: a hook and the orchestration it drives, in `components/` because that
 * is where the import scan of task 17.2 permits a gate consumer to live.
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

/** The sections of a panel, as `PromisePanel` renders them. */
export const PANEL_SECTION_SELECTOR = '.promise-panel__section';

/** The one inline declaration the cascade writes, and therefore hands back. */
export const PANEL_STAGGER_INLINE = ['opacity'] as const;

/**
 * The end state: present, at the opacity the stylesheet already resolves.
 *
 * A factory rather than a shared constant, for the reason `entranceEnd` gives — the
 * engine writes its own bookkeeping into the record it is handed, so a module-level
 * object would come back from the first settle carrying a `duration` of 1e-11.
 */
export function panelStaggerEnd(): MotionEndState {
  return { opacity: 1 };
}

/**
 * When the section at `index` starts: `(index + 1) × --stagger-panel`.
 *
 * The `+ 1` is the "40 ms behind the container" of §10.6.3 — the first section waits one
 * step, so the panel is visibly moving before anything inside it is.
 */
export function panelStaggerDelay(index: number): number {
  return (Math.max(index, 0) + 1) * durationMs('--stagger-panel');
}

/**
 * The engine's stagger, offset by one step.
 *
 * `stagger(step, { from: 'first', start: step })` is the same arithmetic
 * {@link panelStaggerDelay} states, expressed as the delay generator the engine applies
 * per target — so the ordering stays the engine's and this module only names the step.
 * The return type is inferred, not annotated: `stagger` is four overloads and
 * `ReturnType<typeof stagger>` resolves to the string one.
 */
function offsetStagger() {
  const step = durationMs('--stagger-panel');
  return stagger(step, { from: 'first', start: step });
}

/** The panel's sections, in the order they are painted. */
export function panelSectionTargets(panel: ParentNode): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(PANEL_SECTION_SELECTOR)];
}

/** One timeline: a fade per section, one `--stagger-panel` step apart. */
export function panelStaggerSpec(targets: readonly HTMLElement[]): MotionSpec {
  return {
    to: panelStaggerEnd(),
    run: () =>
      motionTimeline().add([...targets], {
        opacity: [0, 1],
        duration: durationMs('--dur-base'),
        ease: easeFor('--ease-out'),
        delay: offsetStagger(),
      }),
  };
}

/**
 * The cascade currently running, if one is.
 *
 * One panel is open at a time, so there is one cascade at a time — but a second call
 * must not start a timeline over sections the first is still tweening. The engine would
 * *replace* those tweens, stranding the first timeline so it can never finish, and
 * `play()` would then never resolve and `pendingMotion()` would never return to zero.
 * Completing the earlier one first is the same choice §10.6.4 makes about a preference
 * change: finish, never abandon.
 */
let running: MotionPlayback | null = null;

/**
 * Runs the cascade over an open panel, and resolves once it is at rest.
 *
 * @param onPlayback receives the timeline, so a closing panel can complete it — a
 * half-faded section left on a detached node is the intermediate state §10.6.4 exists to
 * prevent.
 */
export function playPanelStagger(
  panel: ParentNode,
  onPlayback?: (playback: MotionPlayback) => void,
): Promise<void> {
  const targets = panelSectionTargets(panel);
  if (targets.length === 0) return Promise.resolve();

  running?.complete?.();
  running = null;

  /* Asked before the end state is applied, because it decides *when* the release happens
     rather than whether it does. */
  const animating = motionEnabled();
  const spec = panelStaggerSpec(targets);
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
    releaseInlineMotion(targets, PANEL_STAGGER_INLINE);
  };

  /* Motion off: `play()` has already applied the end state synchronously and there is no
     frame to wait for, so the release is synchronous too. Deferring it by even a microtask
     would mean the *first painted state* of a reduced-motion render was an inline
     restatement of the stylesheet rather than the stylesheet, and §10.6.4's claim is about
     the first paint, not the one after it. */
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
 * Plays the cascade when a panel opens, and again when it opens on another promise.
 *
 * `promiseId` is the dependency because that is what "the panel opened" means here:
 * `PromiseGraph` mounts one panel per selection, and selecting a second promise while
 * the first is open re-renders the same element with different contents — which is a new
 * panel to a reader, and so a new cascade.
 */
export function usePanelStagger(panel: RefObject<HTMLElement | null>, promiseId: string): void {
  const playback = useRef<MotionPlayback | null>(null);

  useEffect(() => {
    const element = panel.current;
    if (element === null) return;
    /* Motion off: the panel's specified state under `prefers-reduced-motion: reduce` is
       the stylesheet's own — sections present, at `opacity: 1` — and this cascade is the
       only thing that would ever hide one. So there is nothing for the reduced-motion
       branch to settle *to* that is not already painted, and the cheapest correct thing a
       hook can do is decline. The orchestration itself stays gate-bound: called directly
       it goes through `play()` in either state, which is what
       `motion-m3-panel-stagger.test.tsx` asserts and what the equivalence comparison of
       task 17.3 drives. This is the same division of labour `useGraphEntrance` keeps with
       its session flag — the hook decides *whether* a panel gets a cascade, the
       orchestration decides what one is. */
    if (!motionEnabled()) return;

    void playPanelStagger(element, (started) => {
      playback.current = started;
    });

    /* Completed, not cancelled: closing the panel mid-cascade must not leave a section
       interpolating at 0.4 opacity on a detached node (§10.6.4). */
    return () => {
      playback.current?.complete?.();
      playback.current = null;
    };
  }, [panel, promiseId]);
}
