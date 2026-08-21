/**
 * M2 — the metric count-up (design §10.6.2, §10.6.4, §18.1, R10.4, task 17.7).
 *
 * A rail figure interpolates 0 → its value over `--dur-figure` on `--ease-out`, and each
 * frame is written with `utils.set` — through the gate's own {@link settle}, which is that
 * call — after being formatted by **the exact formatter the static render used**. That is
 * the whole design of this file, and each clause of it is load-bearing:
 *
 * - **The formatter, not a formatter.** `percentDigits` and `countDigits` are the
 *   functions `MetricFigure` renders the digit run from, so the final frame is
 *   character-identical to the server-rendered text by construction rather than by
 *   coincidence. A second `String(n)` here would agree today and drift the moment the
 *   rail's formatting acquires a rule.
 * - **The digit run only.** The `%` sits in its own element carrying the `-0.06em`
 *   optical margin (§10.7), and the accessible name lives on the `role="img"` figure
 *   above both. Rewriting the digits leaves the unit, the alignment and the name alone.
 * - **The accessible name never moves.** `MetricFigure` puts the *final* value in
 *   `aria-label` at first paint, so a screen reader is handed one stable string while the
 *   digits underneath it climb. §10.6.2 calls that the guard; `reduced-motion-equivalence`
 *   asserts it in both media states, and it is the reason this orchestration is allowed to
 *   touch text at all.
 * - **No count-up for a tile the degraded chip replaced.** Not by asking whether the
 *   snapshot is degraded — `DegradedChip` renders no figure and therefore no digit run, so
 *   {@link countUpDigitRun} finds nothing and there is nothing to animate. The same
 *   mechanism covers `n/a` (R9.3): a withheld ratio has no number, so it does not count.
 *   The committed snapshot is `degraded: true` with `provenCoverage: null`, so that is the
 *   live path and the one a judge sees first.
 *
 * **Why the end state is a string.** Every other orchestration ends at a style
 * declaration; this one ends at *text*, which is already correct on the server. So `to` is
 * `{ textContent: <the final digits> }`: with motion off the gate writes the string the
 * DOM already carries — a no-op that is nonetheless the *specified* end state rather than
 * an absence of one — and with motion on the gate writes it again after the last frame, so
 * the two renders cannot differ by a rounding. Nothing inline is written at any point, so
 * unlike M3, M4 and M5 there is no declaration to release (see `motionRelease.tsx`).
 *
 * **`textContent` reaches the DOM, and that is the engine's own rule rather than a trick.**
 * `animejs` classifies a property on a DOM target by looking for it in `style`, then among
 * the SVG attributes, then in the target itself; `textContent` is in the target, so it is
 * assigned, not `setAttribute`d. That is why a per-frame `utils.set` can carry a formatted
 * string at all.
 *
 * Not a component: a hook and the orchestration it drives, in `components/` because that is
 * where the import scan of task 17.2 permits a gate consumer to live.
 */

'use client';

import { useEffect, useRef, type RefObject } from 'react';

import {
  durationMs,
  easeFor,
  motionEnabled,
  motionTimeline,
  play,
  settle,
  type MotionEndState,
  type MotionPlayback,
  type MotionSpec,
} from '../lib/motion.js';
import { METRIC_RAIL_CLASSES } from '../lib/metricRail.js';

/** The digit run inside a figure — the one element this orchestration rewrites. */
export const COUNT_UP_SELECTOR = `.${METRIC_RAIL_CLASSES.digits}`;

/**
 * A figure that has a number to count to.
 *
 * `format` is passed in rather than chosen here because the two rail shapes format
 * differently — a coverage percentage and a promise count — and both formatters belong to
 * the module that renders them. See `MetricFigure.countUpFor`.
 */
export interface CountUpFigure {
  /** The whole number the digits arrive at: a percentage, or a count of promises. */
  readonly to: number;
  /** The exact formatter the static render used for the digit run. */
  readonly format: (whole: number) => string;
}

/**
 * The digit run of a figure, or `null` when the figure carries none.
 *
 * `null` is the answer for the two states that have no number: the literal `n/a` of a
 * withheld ratio (R9.3), and the chip that replaces a tile when the snapshot is degraded
 * (R2.11) — which renders a word where the digits would be. Both must not count up, and
 * this is where both are declined, structurally, rather than by a flag.
 */
export function countUpDigitRun(figure: ParentNode): HTMLElement | null {
  return figure.querySelector<HTMLElement>(COUNT_UP_SELECTOR);
}

/**
 * The end state: the final digits, formatted exactly as the static render formatted them.
 *
 * A factory rather than a shared record — the engine writes its own bookkeeping into the
 * object it is handed, so a cached one would come back from the first settle carrying a
 * `duration` of 1e-11.
 */
export function countUpEnd(counting: CountUpFigure): MotionEndState {
  return { textContent: counting.format(counting.to) };
}

/**
 * Every frame: interpolate, round to a whole figure, format, write.
 *
 * The rounding is not cosmetic. The digit run is the only thing a reader sees change, and
 * a fractional percentage would both format differently and reflow — `percentDigits`
 * refuses one outright, which is the formatter enforcing the same rule from the other
 * side.
 */
export function countUpFrame(digits: HTMLElement, counting: CountUpFigure, whole: number): void {
  settle(digits, { textContent: counting.format(Math.round(whole)) });
}

/**
 * One tween over one number, with the DOM written from it per frame.
 *
 * The engine's target is a plain object rather than the element: what is being
 * interpolated is a *figure*, and the element receives the formatted result. Animating the
 * element's `textContent` directly would hand the engine a string to decompose, which is
 * how a count-up ends up rendering `87.0000` for one frame.
 */
export function countUpSpec(digits: HTMLElement, counting: CountUpFigure): MotionSpec {
  const counter = { whole: 0 };
  return {
    to: countUpEnd(counting),
    run: () =>
      motionTimeline().add(counter, {
        whole: counting.to,
        duration: durationMs('--dur-figure'),
        ease: easeFor('--ease-out'),
        onUpdate: () => {
          countUpFrame(digits, counting, counter.whole);
        },
      }),
  };
}

/**
 * The count currently running over each digit run, if one is.
 *
 * Keyed by element because the rail has several figures and each counts independently —
 * but *one* figure must never carry two counts. Two timelines writing one `textContent`
 * interleave per frame, so the digits would read whichever tween ticked last and the run
 * would visibly stutter; worse, the engine resolves the collision by replacing the earlier
 * tween, which strands the earlier timeline so it can never finish, `play()` never
 * resolves, and `pendingMotion()` never returns to zero. Completing the earlier count
 * first is the same choice §10.6.4 makes about a preference change: finish, never abandon.
 */
const running = new Map<HTMLElement, MotionPlayback>();

/**
 * Counts one figure up, and resolves when its digits read their final value.
 *
 * A no-op — an already-resolved promise, no timeline, nothing written — when the figure
 * has no digit run, or when the value is zero. Counting `0 → 0` is 760 ms of a figure
 * pretending to move, and §10.6.3's refusal of ambient motion covers a count-up that
 * counts nothing.
 *
 * @param onPlayback receives the timeline, so an unmounting rail can complete it: a
 * half-counted figure left on a detached node is the intermediate state §10.6.4 exists to
 * prevent.
 */
export function playMetricCountUp(
  figure: HTMLElement,
  counting: CountUpFigure,
  onPlayback?: (playback: MotionPlayback) => void,
): Promise<void> {
  const digits = countUpDigitRun(figure);
  if (digits === null || counting.to <= 0) return Promise.resolve();

  running.get(digits)?.complete?.();
  running.delete(digits);

  let started: MotionPlayback | null = null;
  const spec = countUpSpec(digits, counting);
  const settled = play(digits, {
    to: spec.to,
    run: () => {
      const playback = spec.run();
      started = playback;
      running.set(digits, playback);
      onPlayback?.(playback);
      return playback;
    },
  });

  return settled.then(() => {
    /* only if it is still ours: a count started after this one owns the entry now, and
       its own settle is the one that must land last */
    if (started !== null && running.get(digits) === started) running.delete(digits);
  });
}

/**
 * Counts a rendered figure up once, on mount.
 *
 * Motion off declines here rather than in the orchestration, and the reason is the same one
 * `useGraphEntrance` gives for its session flag: the hook is the policy, `play()` is the
 * mechanism. Under `prefers-reduced-motion: reduce` the digits already read their final
 * value — the server wrote them — so there is no end state left to settle, and settling one
 * anyway would spend engine work per render to write a string that is already there.
 * Called directly, {@link playMetricCountUp} still goes through the gate in either state,
 * which is what `motion-m2-metric-count-up.test.tsx` asserts.
 *
 * `counting` is destructured into its two stable parts for the dependency list: the value
 * is a number and the formatter is a module-level function, so the effect fires when the
 * figure changes and not when its owner re-renders.
 */
export function useMetricCountUp(
  figure: RefObject<HTMLElement | null>,
  counting: CountUpFigure | null,
): void {
  const playback = useRef<MotionPlayback | null>(null);
  const to = counting?.to ?? null;
  const format = counting?.format ?? null;

  useEffect(() => {
    const element = figure.current;
    if (element === null || to === null || format === null) return;
    if (!motionEnabled()) return;

    void playMetricCountUp(element, { to, format }, (started) => {
      playback.current = started;
    });

    return () => {
      playback.current?.complete?.();
      playback.current = null;
    };
  }, [figure, to, format]);
}
