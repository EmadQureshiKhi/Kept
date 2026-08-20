/**
 * The motion gate — design §10.6, §10.6.4, §10.4.1 (motion tokens), R10.4.
 *
 * The only module in the repository that imports `animejs`. Everything the five
 * orchestrations of §10.6 need arrives through this file, and everything they need
 * is expressed as a {@link MotionSpec}: an end state and a way to reach it. That
 * split is the whole design, because it is what makes the reduced-motion path a
 * *state* rather than a fallback — the end state is declared separately from the
 * animation, so it can be applied on its own, synchronously, as the first painted
 * frame.
 *
 * Three contracts this module keeps, each of them load-bearing:
 *
 * 1. **Motion off means the end state is the first paint.** {@link play} applies
 *    `spec.to` through `utils.set` and resolves an already-settled promise. No
 *    frame is scheduled, so there is no interval in which a reader can see an
 *    intermediate value, and no `await` is needed for the DOM to be final.
 * 2. **Motion on lands on the *same* end state.** When an orchestration finishes,
 *    `spec.to` is applied again before the promise resolves. That looks redundant
 *    and is not: it is what makes the post-animation DOM identical to the
 *    reduced-motion DOM *by construction* rather than by hoping the engine's last
 *    interpolated frame happens to serialise the way `utils.set` does. The
 *    equivalence test (task 17.3) asserts the identity; this line is why it holds.
 * 3. **A mid-session preference change completes, never cancels.** The media query
 *    is observed live. Cancelling a half-played timeline would leave the DOM at
 *    whatever fraction it had reached, which is precisely the harm reduced motion
 *    exists to prevent — so every in-flight playback is completed and then pinned
 *    to its declared end state.
 *
 * **Durations and easings are read from `TOKENS`, never written here.** `--dur-*`,
 * `--stagger-node` and the three `--ease-*` curves are declared once in
 * `styles/tokens.css` and mirrored in `lib/tokens.ts`; {@link durationMs} and
 * {@link easeFor} are the only way this module names one, so a token change moves
 * the CSS and the JavaScript together and `test/token-parity.test.ts` keeps both
 * honest.
 *
 * **Why `.tsx` for a file with no JSX.** The root `tsconfig.json` type-checks
 * `apps/ledger/lib/**\/*.ts` under `lib: ["ES2022"]` with **no DOM**, deliberately:
 * the token mirror and the source scans have no business touching a browser. This
 * module's entire subject is the browser. The `.tsx` extension moves it into
 * `tsc -p apps/ledger`, where the DOM libs live, without weakening the no-DOM
 * guarantee over everything else in `lib/`. `test/_dom.tsx` reached the same
 * conclusion for the same reason, and consumers still import `./motion.js`, which
 * both TypeScript and Vite resolve here.
 *
 * **What is deliberately absent.** No looping, no ping-pong, no motion driven by a
 * scroll position, no physics-based or overshooting easing — {@link easeFor}
 * refuses a curve whose control points leave the unit range on the y axis, so an
 * overshoot cannot arrive by renaming one. `test/motion-scan.test.ts` states those
 * refusals over this file's source; this module states them again in code, where a
 * violation fails at runtime rather than at review.
 */

import { animate, createTimeline, cubicBezier, stagger, svg, utils } from 'animejs';

import { TOKENS, type TokenName } from './tokens.js';

/** The one media query the Ledger asks about. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** A token that carries a time: the five durations and the node stagger. */
export type DurationToken = Extract<TokenName, `--dur-${string}` | `--stagger-${string}`>;

/** A token that carries an easing curve. Three exist, and all three settle. */
export type EaseToken = Extract<TokenName, `--ease-${string}`>;

/**
 * What an orchestration animates. A selector, one element, or several.
 *
 * Kept narrower than the engine's own target type on purpose: a `MotionSpec` is
 * written against elements the component already holds, and the engine's wider
 * union — plain objects, WAAPI handles, other animations — is not a thing any of
 * the five orchestrations targets.
 */
export type MotionTargets = string | Element | readonly Element[];

/** The end state of an orchestration, as engine property names. */
export type MotionEndState = Readonly<Record<string, string | number>>;

/**
 * The minimum this module needs from a running animation: a completion hook and a
 * way to finish early.
 *
 * Both `animate()` and `createTimeline()` satisfy it structurally, so a spec can
 * return either without a cast. `complete` is optional because a spec is free to
 * return a bare thenable — a count-up driven by `utils.set` per frame, for
 * instance — and a spec that cannot be completed early is still settled to its
 * declared end state when the preference changes.
 */
export interface MotionPlayback {
  then(resolve: () => void): unknown;
  complete?(): unknown;
}

/**
 * One orchestration: where it ends, and how it gets there.
 *
 * `to` is the *only* thing the reduced-motion path reads, which is the test of
 * whether a spec is written correctly. If applying `to` alone does not produce the
 * finished interface, the animation is carrying information — and §10.6.4 forbids
 * that: nothing in the Ledger's information is carried by motion.
 */
export interface MotionSpec {
  readonly to: MotionEndState;
  readonly run: () => MotionPlayback;
}

/* ────────────────────────────── the token readers ──────────────────────────── */

const TIME_VALUE = /^(-?[0-9]*\.?[0-9]+)(ms|s)$/;
const CUBIC_CURVE = /^cubic-bezier\(([^)]*)\)$/;

/**
 * A duration token as a whole number of milliseconds, the unit the engine takes.
 *
 * Throws on a malformed token rather than defaulting to zero: a duration that
 * silently became `0` would look exactly like the reduced-motion branch, and the
 * one thing worse than an animation that does not run is one that cannot be told
 * apart from the accessibility state.
 */
export function durationMs(token: DurationToken): number {
  const declared = TOKENS[token];
  const match = TIME_VALUE.exec(declared);
  const amount = Number.parseFloat(match?.[1] ?? 'NaN');
  const unit = match?.[2];
  if (Number.isNaN(amount) || unit === undefined) {
    throw new Error(
      `Motion token ${token} is "${declared}", which is not a CSS time. Durations are ` +
        `declared once in styles/tokens.css and mirrored in lib/tokens.ts (§10.4.1).`,
    );
  }
  return unit === 's' ? amount * 1000 : amount;
}

/**
 * An easing token as the engine's own easing function.
 *
 * The three shipped curves are `cubic-bezier()` values in CSS, and in `animejs`
 * 4.5.0 the equivalent has to be the *imported function*, not a string: the string
 * spelling the design document shows was removed from the engine's core, and
 * passing it now warns and silently degrades to linear. So the CSS value is parsed
 * and handed to `cubicBezier()`, which keeps one declaration of each curve.
 *
 * The unit-range check is the §10.6.3 refusal in code. A control point outside
 * `[0, 1]` on the y axis overshoots, which is a bounce whatever it is named, and
 * this is the one place a curve enters the application.
 */
export function easeFor(token: EaseToken): ReturnType<typeof cubicBezier> {
  const declared = TOKENS[token];
  const match = CUBIC_CURVE.exec(declared);
  if (match === null) {
    throw new Error(
      `Motion token ${token} is "${declared}", which is not a cubic curve. The three ` +
        `eases of §10.4.1 are the only easings the Ledger animates on.`,
    );
  }
  const points = (match[1] ?? '').split(',').map((part) => Number.parseFloat(part.trim()));
  const [x1 = Number.NaN, y1 = Number.NaN, x2 = Number.NaN, y2 = Number.NaN] = points;
  if (points.length !== 4 || [x1, y1, x2, y2].some((value) => Number.isNaN(value))) {
    throw new Error(`Motion token ${token} is "${declared}", which is not four numbers.`);
  }
  for (const y of [y1, y2]) {
    if (y < 0 || y > 1) {
      throw new Error(
        `Motion token ${token} overshoots at y=${y}. A control point outside the unit ` +
          `range is an overshoot whatever it is called, and §10.6.3 forbids one.`,
      );
    }
  }
  return cubicBezier(x1, y1, x2, y2);
}

/* ───────────────────────────── the preference itself ───────────────────────── */

function preferenceQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(REDUCED_MOTION_QUERY);
}

/**
 * `true` when this environment both has a DOM and has not asked for reduced motion.
 *
 * Server rendering answers `false`, which is the correct answer rather than a
 * convenient one: the server's job is to emit the end state, and that is exactly
 * what the reduced-motion branch does.
 */
export function motionEnabled(): boolean {
  const query = preferenceQuery();
  return query !== null && !query.matches;
}

/* ──────────────────────── in-flight playbacks, and the gate ────────────────── */

interface InFlight {
  readonly targets: MotionTargets;
  readonly to: MotionEndState;
  readonly playback: MotionPlayback;
}

const inFlight = new Set<InFlight>();

/** How many orchestrations are currently running. Zero once every one has landed. */
export function pendingMotion(): number {
  return inFlight.size;
}

/**
 * Applies an end state immediately, through the same engine the animation uses.
 *
 * Going through `utils.set` rather than assigning inline styles by hand is what
 * makes the two paths comparable: the property vocabulary, the units and the
 * serialisation are the engine's in both, so `translateY: 0` produces the same
 * declaration whether it was set or animated to.
 */
export function settle(targets: MotionTargets, to: MotionEndState): void {
  /* The engine's parameter type unions tween forms, keyframe forms and callbacks;
     an end state is a narrower thing than any of them, and this is the boundary
     where that narrowing is stated once. */
  utils.set(targets as Parameters<typeof utils.set>[0], to as Parameters<typeof utils.set>[1]);
}

/**
 * Completes every in-flight orchestration and pins it to its declared end state.
 *
 * **Completed, not cancelled.** Cancelling would leave each target wherever its
 * interpolation had reached — a half-lifted node, a tag mid-pulse — which is the
 * intermediate DOM §10.6.4 exists to prevent. Completing lands the engine on the
 * end of its own timeline; the `settle` that follows makes that landing identical
 * to the state the reduced-motion branch would have written.
 */
export function settleInFlight(): void {
  for (const entry of [...inFlight]) {
    inFlight.delete(entry);
    entry.playback.complete?.();
    settle(entry.targets, entry.to);
  }
}

let subscription: { readonly query: MediaQueryList; readonly listener: () => void } | null = null;

/**
 * Starts observing the preference, replacing any existing subscription.
 *
 * One subscription per session, on one cached `MediaQueryList` — `matchMedia`
 * returns a fresh object per call, so subscribing per {@link play} would leak a
 * listener per orchestration. {@link play} calls this lazily on its first animated
 * run, so nothing is observed on a page that never animates.
 */
export function observeMotionPreference(): void {
  stopObservingMotionPreference();
  const query = preferenceQuery();
  if (query === null || typeof query.addEventListener !== 'function') return;
  const listener = (): void => {
    if (!motionEnabled()) settleInFlight();
  };
  query.addEventListener('change', listener);
  subscription = { query, listener };
}

/** Stops observing. Symmetric with {@link observeMotionPreference}. */
export function stopObservingMotionPreference(): void {
  const current = subscription;
  subscription = null;
  if (current === null) return;
  if (typeof current.query.removeEventListener === 'function') {
    current.query.removeEventListener('change', current.listener);
  }
}

/** `true` when the live preference is being observed. */
export function observingMotionPreference(): boolean {
  return subscription !== null;
}

/**
 * The gate every orchestration goes through (§10.6.4).
 *
 * Motion off: `spec.to` is applied synchronously and the returned promise is
 * already resolved, so the end state is the first painted state and a caller that
 * does not await still sees a finished interface.
 *
 * Motion on: `spec.run()` builds the animation, the playback is tracked so a
 * mid-flight preference change can complete it, and the promise resolves after the
 * end state has been pinned — so the DOM a caller observes on resolution is the
 * same DOM the reduced-motion branch writes.
 */
export function play(targets: MotionTargets, spec: MotionSpec): Promise<void> {
  if (!motionEnabled()) {
    settle(targets, spec.to);
    return Promise.resolve();
  }
  if (subscription === null) observeMotionPreference();

  const playback = spec.run();
  const entry: InFlight = { targets, to: spec.to, playback };
  inFlight.add(entry);

  return new Promise<void>((resolve) => {
    playback.then(() => {
      inFlight.delete(entry);
      settle(targets, spec.to);
      resolve();
    });
  });
}

/* ─────────────────────── the engine surface, narrowed ──────────────────────── */

export type MotionTimelineParams = NonNullable<Parameters<typeof createTimeline>[0]>;
export type MotionAnimationParams = Parameters<typeof animate>[1];

/**
 * A timeline that runs once.
 *
 * `loop: false` is pinned here rather than trusted to each call site, so the
 * refusal in §10.6.3 — no ambient motion, ever — is a property of the only
 * timeline factory the application has.
 */
export function motionTimeline(
  params: MotionTimelineParams = {},
): ReturnType<typeof createTimeline> {
  return createTimeline({ ...params, loop: false });
}

/** A single animation that runs once, for an orchestration that needs no timeline. */
export function motionAnimation(
  targets: MotionTargets,
  params: MotionAnimationParams,
): ReturnType<typeof animate> {
  return animate(targets as Parameters<typeof animate>[0], { ...params, loop: false });
}

/**
 * The engine's stagger helper, re-exported so a component never imports `animejs`.
 *
 * A delay generator is arithmetic over an index, not an engine entry point: it
 * starts nothing, so re-exporting it opens no route around the gate. The graph
 * entrance of §10.6.1 needs it, and needs it in lane order.
 */
export { stagger };

/**
 * `svg.createDrawable`, likewise re-exported for the edge draw of §10.6.3 (M1).
 *
 * It converts a path into something whose stroke can be tweened; like `stagger` it
 * animates nothing on its own, so the gate stays the only way motion begins.
 */
export const drawable = svg.createDrawable;
