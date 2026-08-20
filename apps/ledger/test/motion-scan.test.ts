/**
 * The CSS motion scan, widened — design §10.6 (the motion system), §10.6.3 (the
 * forbidden list), §10.6.4 (the reduced-motion state and its CSS insurance),
 * R10.4.
 *
 * R10.4 restricts animation to transitions that accompany a verdict change or a
 * selection change. Design §10.6 spends that budget deliberately on five
 * orchestrations and then names, precisely, everything it refuses: hover bounce
 * and hover scale, skeleton shimmer, parallax, motion driven by scroll, any
 * looping or ambient animation, spring physics on layout, and anything animating
 * `width`, `height`, `top` or `left` rather than a compositor-only property.
 *
 * This file is the machine form of that refusal, and it is deliberately written
 * *before* stage 17 builds `lib/motion.ts`. A guard authored after the code it
 * guards only ratifies whatever was already written. Authored first, it is a
 * specification the implementation has to satisfy — so the rules below are stated
 * over both spellings a declaration can take, the CSS one and the style-object
 * one, and over the `animejs` idioms stage 17 will reach for.
 *
 * Six rules:
 *
 *   1. The `@media (prefers-reduced-motion: reduce)` insurance block exists, is
 *      universal, and zeroes both durations, pins the iteration count to 1 and
 *      forces `scroll-behavior: auto` — with `!important`, because insurance that
 *      loses the cascade is not insurance.
 *   2. Every animated property is one of `opacity`, `transform`, `color`,
 *      `background-color`, `border-color`, `outline-color`, `box-shadow`. That
 *      list is closed, and `all` is not a member of it — `transition: all` is how
 *      a `width` animation arrives without anyone typing one.
 *   3. Nothing animates `width`, `height`, `top` or `left`, in CSS or as an
 *      `animejs` `[from, to]` pair.
 *   4. No iteration count above 1, no `infinite`, no `alternate` ping-pong, no
 *      `loop` in a JavaScript orchestration. An ambient loop is the single most
 *      reliable tell of a generated interface.
 *   5. No hover bounce or hover scale, no shimmer, no parallax, no scroll-driven
 *      motion, no spring or overshoot easing. Overshoot is detected
 *      arithmetically — a `cubic-bezier` with a control point outside the unit
 *      range on the y axis *is* a bounce, whatever it is named.
 *   6. Every `@keyframes` block, referenced or not, obeys rule 2. An unreferenced
 *      shimmer is a shimmer with a commit behind it.
 *
 * **Scope.** The CSS rules read every stylesheet under `apps/ledger`, this file
 * included — a stylesheet cannot be a fixture. The JavaScript rules read shipped
 * code only, with `test/` excluded, because the fixtures below construct the
 * violations they detect and a scan that failed on its own counter-examples could
 * only be kept green by weakening it. That exclusion is asserted rather than
 * assumed, and every detector is proven against known-bad and known-good input.
 *
 * A zero-file scan is a failure here, exactly as in `_scan.ts`: the tree walk
 * throws when a root yields nothing, the stylesheet count is asserted, and the
 * number of motion declarations actually inspected is asserted to be non-zero, so
 * this cannot decay into a green no-op.
 */

import { describe, expect, it } from 'vitest';

import {
  CODE_EXTENSIONS,
  STYLE_EXTENSIONS,
  normaliseCssValue,
  parseCss,
  scanLedger,
  stripCssComments,
  type CssDeclaration,
  type CssRule,
  type ScannedFile,
} from './_scan.js';

/* ─────────────────────────── the closed allowlist ──────────────────────────── */

/**
 * The only properties the Ledger may animate (§10.6.4). `opacity` and `transform`
 * are compositor-only; the four colour properties and the shadow are cheap paint
 * that carries verdict and focus information. Nothing else earns a frame.
 */
export const ANIMATABLE: ReadonlySet<string> = new Set([
  'opacity',
  'transform',
  'color',
  'background-color',
  'border-color',
  'outline-color',
  'box-shadow',
]);

/** Named in §10.6.3 as never animated: each forces layout on every frame. */
export const FORBIDDEN_TARGETS: ReadonlySet<string> = new Set(['width', 'height', 'top', 'left']);

/** `@media (prefers-reduced-motion: reduce)`, however it is spaced. */
const REDUCED_MOTION_PRELUDE = /^@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)$/;

/** `@keyframes name`, vendor prefix tolerated. */
const KEYFRAMES_PRELUDE = /^@(?:-[a-z]+-)?keyframes\s+(\S+)$/;

/**
 * The vocabulary of ambient motion. Applied to keyframe and animation *names*
 * only, never to prose — `surfaces.css` has to be able to say in a comment that
 * it does not glow.
 */
const AMBIENT_NAME =
  /shimmer|skeleton|pulse|glow|blink|breath|float|wiggle|spin|marquee|ticker|ambient|bounce|heartbeat|throb/i;

/** Parallax, in the three shapes it takes. */
const PARALLAX = /background-attachment\s*:\s*fixed|\bperspective\s*:|\btranslateZ\s*\(|preserve-3d/i;

/** Scroll-driven motion: the CSS timelines, and smooth scrolling as a motion. */
const SCROLL_DRIVEN_CSS =
  /animation-timeline|scroll-timeline|view-timeline|timeline-scope|\bscroll\s*\(\s*\)|\bview\s*\(|scroll-behavior\s*:\s*smooth/i;

/** Scroll-driven motion, JavaScript side — including `animejs`'s own entry points. */
const SCROLL_DRIVEN_CODE = /\bonScroll\b|\bcreateScroll\w*|\bScrollTimeline\b|\bscrollTimeline\b/;

/** Spring physics and the named overshoot easings (§10.6.3). */
const SPRING_OR_OVERSHOOT_NAME =
  /\bcreateSpring\b|\bspring\s*\(|\b(?:in|out|inOut)(?:Bounce|Elastic|Back)\b/;

/** An `animejs` keyframe pair on a layout property: `width: [0, 320]`. */
const CODE_LAYOUT_TWEEN = /\b(width|height|top|left)\s*:\s*\[/g;

/** An ambient loop, JavaScript side. `loop: false` is the only accepted spelling. */
const CODE_LOOP = /\bloop\s*:\s*(?!false\b)[^,}\s]+/g;
const CODE_ALTERNATE = /\balternate\s*:\s*true\b/g;

/** A `transition` or `animation` value carried in a style object or an option bag. */
const CODE_MOTION_DECLARATION =
  /\b(transition|transitionProperty|animation|animationName|animationIterationCount|animationDirection)\s*:\s*(['"`])([^'"`]*)\2/g;

/** `cubic-bezier(x1, y1, x2, y2)` in either the CSS or the `animejs` spelling. */
const BEZIER = /\bcubic-?[Bb]ezier\s*\(([^)]*)\)/g;

/** Tokens that are a time, so never a property name or a keyframe name. */
const TIME_TOKEN = /^-?[\d.]+m?s$/i;

/** A bare number, which in an `animation` shorthand is the iteration count. */
const NUMBER_TOKEN = /^\d*\.?\d+$/;

/**
 * Keywords that may appear where a property or keyframe name could, and are
 * neither. `all` is deliberately absent: it must reach the allowlist check and
 * fail there.
 */
const MOTION_KEYWORDS: ReadonlySet<string> = new Set([
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'linear',
  'step-start',
  'step-end',
  'normal',
  'reverse',
  'alternate',
  'alternate-reverse',
  'forwards',
  'backwards',
  'both',
  'running',
  'paused',
  'infinite',
  'none',
  'allow-discrete',
  'initial',
  'inherit',
  'unset',
  'revert',
  'revert-layer',
  'important',
]);

const TEST_DIRECTORY = 'apps/ledger/test/';
const SHELL_CSS = 'apps/ledger/styles/shell.css';

const STYLESHEETS: ScannedFile[] = scanLedger(STYLE_EXTENSIONS);
const SHIPPED_CODE: ScannedFile[] = scanLedger(CODE_EXTENSIONS).filter(
  (file) => !file.path.startsWith(TEST_DIRECTORY),
);

/* ──────────────────────────── value tokenisation ───────────────────────────── */

/**
 * Splits a CSS value on any of `separators`, ignoring separators nested inside
 * parentheses — so `cubic-bezier(.16, .84, .28, 1)` survives a comma split and
 * `var(--dur-fast)` survives a space split.
 */
export function splitOutsideParens(value: string, separators: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of value) {
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    if (depth === 0 && separators.includes(character)) {
      if (current.trim() !== '') parts.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

/** Drops a trailing `!important`, which is a cascade instruction, not a value. */
export function withoutImportant(value: string): string {
  return normaliseCssValue(value.replace(/!\s*important\s*$/i, ''));
}

/**
 * `true` for a token that could be a CSS property name or a keyframe name: a bare
 * identifier that is neither a time nor one of the motion keywords. `all` passes
 * deliberately, so the allowlist gets to reject it by name.
 */
export function isNameToken(token: string): boolean {
  const bare = token.toLowerCase();
  if (!/^-{0,2}[a-z][a-z0-9-]*$/.test(bare)) return false;
  if (TIME_TOKEN.test(bare)) return false;
  return !MOTION_KEYWORDS.has(bare);
}

/**
 * The properties a `transition` or `transition-property` value animates.
 *
 * Every comma-separated layer contributes the identifier tokens it carries, which
 * for a well-formed value is exactly one. A malformed layer yielding two is
 * reported twice rather than guessed at — the point is to notice, not to parse
 * heroically.
 */
export function transitionTargets(value: string): string[] {
  const targets: string[] = [];
  for (const layer of splitOutsideParens(withoutImportant(value), ',')) {
    for (const token of splitOutsideParens(layer, ' \t\n')) {
      if (isNameToken(token)) targets.push(token.toLowerCase());
    }
  }
  return targets;
}

export interface AnimationShorthand {
  /** Keyframe names referenced by the value. */
  readonly names: string[];
  /** Iteration counts found, `Infinity` standing for the `infinite` keyword. */
  readonly iterations: number[];
  /** `true` when the value asks for a ping-pong. */
  readonly alternates: boolean;
}

/**
 * Reads an `animation` shorthand. In the shorthand a bare number is the iteration
 * count and a bare identifier is the keyframe name, which is why the two are
 * separated here rather than pattern-matched at the call site.
 */
export function animationShorthand(value: string): AnimationShorthand {
  const names: string[] = [];
  const iterations: number[] = [];
  let alternates = false;
  for (const layer of splitOutsideParens(withoutImportant(value), ',')) {
    for (const token of splitOutsideParens(layer, ' \t\n')) {
      const bare = token.toLowerCase();
      if (bare === 'infinite') iterations.push(Number.POSITIVE_INFINITY);
      else if (bare === 'alternate' || bare === 'alternate-reverse') alternates = true;
      else if (NUMBER_TOKEN.test(bare)) iterations.push(Number(bare));
      else if (isNameToken(token)) names.push(token);
    }
  }
  return { names, iterations, alternates };
}

/** Iteration counts in an `animation-iteration-count` value. */
export function iterationCounts(value: string): number[] {
  return splitOutsideParens(withoutImportant(value), ',').map((part) =>
    part.toLowerCase() === 'infinite' ? Number.POSITIVE_INFINITY : Number(part),
  );
}

/** `true` when a duration value is zero, in any unit CSS accepts. */
export function isZeroDuration(value: string): boolean {
  return splitOutsideParens(withoutImportant(value), ',').every(
    (part) => Number.parseFloat(part) === 0,
  );
}

/**
 * `true` when a `cubic-bezier` overshoots — a control point outside `[0, 1]` on
 * the y axis. That is the arithmetic definition of a bounce or a back easing, and
 * it catches one whatever the author called it.
 */
export function overshoots(value: string): boolean {
  for (const match of value.matchAll(BEZIER)) {
    const numbers = (match[1] ?? '').split(',').map((part) => Number.parseFloat(part.trim()));
    const y1 = numbers[1];
    const y2 = numbers[3];
    for (const y of [y1, y2]) {
      if (y !== undefined && !Number.isNaN(y) && (y < 0 || y > 1)) return true;
    }
  }
  return false;
}

/* ─────────────────────────── stylesheet inspection ─────────────────────────── */

export interface MotionDeclaration {
  readonly path: string;
  readonly rule: CssRule;
  readonly declaration: CssDeclaration;
}

/** Every declaration in every ledger stylesheet, with its rule for context. */
function declarations(): MotionDeclaration[] {
  const found: MotionDeclaration[] = [];
  for (const file of STYLESHEETS) {
    for (const rule of parseCss(file.text)) {
      for (const declaration of rule.declarations) {
        found.push({ path: file.path, rule, declaration });
      }
    }
  }
  return found;
}

const DECLARATIONS: MotionDeclaration[] = declarations();

function propertyIs(entry: MotionDeclaration, ...names: readonly string[]): boolean {
  return names.includes(entry.declaration.property.toLowerCase());
}

export interface KeyframesBlock {
  readonly path: string;
  readonly name: string;
  readonly properties: readonly CssDeclaration[];
  readonly line: number;
}

/** Every `@keyframes` block under `apps/ledger`, referenced or not. */
function keyframes(): KeyframesBlock[] {
  const blocks = new Map<string, { path: string; name: string; properties: CssDeclaration[]; line: number }>();
  for (const file of STYLESHEETS) {
    for (const rule of parseCss(file.text)) {
      for (const ancestor of [rule.prelude, ...rule.ancestors]) {
        const match = KEYFRAMES_PRELUDE.exec(ancestor);
        if (match === null) continue;
        const name = match[1] ?? '';
        const key = `${file.path}#${name}`;
        const existing = blocks.get(key);
        if (existing === undefined) {
          blocks.set(key, { path: file.path, name, properties: [...rule.declarations], line: rule.line });
        } else {
          existing.properties.push(...rule.declarations);
        }
      }
    }
  }
  return [...blocks.values()];
}

const KEYFRAMES: KeyframesBlock[] = keyframes();

/** The reduced-motion insurance rules: universal selectors under the media query. */
function reducedMotionRules(): { path: string; rule: CssRule }[] {
  const found: { path: string; rule: CssRule }[] = [];
  for (const file of STYLESHEETS) {
    for (const rule of parseCss(file.text)) {
      if (rule.ancestors.some((ancestor) => REDUCED_MOTION_PRELUDE.test(ancestor))) {
        found.push({ path: file.path, rule });
      }
    }
  }
  return found;
}

const REDUCED_MOTION_RULES = reducedMotionRules();

function report(offences: readonly string[], rule: string): void {
  expect(
    offences,
    offences.length === 0 ? '' : `Motion scan — ${rule} (design §10.6, R10.4).\n${offences.join('\n')}`,
  ).toEqual([]);
}

/* ───────────────────────────────── meta-tests ──────────────────────────────── */

describe('the motion scan is not a no-op', () => {
  it('scanned the stylesheets, the shell among them', () => {
    expect(STYLESHEETS.length).toBeGreaterThanOrEqual(3);
    expect(
      STYLESHEETS.some((file) => file.path === SHELL_CSS),
      `${SHELL_CSS} was not scanned — the reduced-motion insurance lives there`,
    ).toBe(true);
    expect(DECLARATIONS.length, 'no CSS declaration was parsed at all').toBeGreaterThan(0);
  });

  it('throws rather than passing when a scan root yields no files', () => {
    expect(() => scanLedger(['.no-such-extension'])).toThrow(/no-op guard/);
  });

  it('inspected at least one real transition or animation declaration', () => {
    const motion = DECLARATIONS.filter((entry) =>
      propertyIs(entry, 'transition', 'transition-property', 'animation', 'animation-name'),
    );
    expect(
      motion.length,
      'the allowlist rule matched nothing in shipped CSS, so it proves nothing. If the ' +
        'Ledger genuinely animates nothing yet, this line is the tripwire that says so.',
    ).toBeGreaterThan(0);
  });

  it('reads shipped code with its own fixtures excluded, and says which', () => {
    expect(SHIPPED_CODE.length, 'no shipped code file was scanned').toBeGreaterThan(0);
    expect(SHIPPED_CODE.every((file) => !file.path.startsWith(TEST_DIRECTORY))).toBe(true);
  });

  it('splits a value without being fooled by nested parentheses', () => {
    expect(splitOutsideParens('transform 420ms cubic-bezier(.16, .84, .28, 1)', ',')).toEqual([
      'transform 420ms cubic-bezier(.16, .84, .28, 1)',
    ]);
    expect(splitOutsideParens('opacity var(--dur-fast), transform var(--dur-base)', ',')).toEqual([
      'opacity var(--dur-fast)',
      'transform var(--dur-base)',
    ]);
  });

  it('names the animated property in every spelling a transition takes', () => {
    expect(transitionTargets('opacity var(--dur-micro) var(--ease-out)')).toEqual(['opacity']);
    expect(transitionTargets('transform 160ms ease-out, color 240ms linear')).toEqual([
      'transform',
      'color',
    ]);
    expect(transitionTargets('outline-color 90ms cubic-bezier(.16,.84,.28,1)')).toEqual([
      'outline-color',
    ]);
    expect(transitionTargets('all 200ms ease')).toEqual(['all']);
    expect(transitionTargets('width 200ms ease-out')).toEqual(['width']);
    expect(transitionTargets('none')).toEqual([]);
    expect(transitionTargets('0ms !important')).toEqual([]);
  });

  it('separates a keyframe name from an iteration count in the shorthand', () => {
    expect(animationShorthand('420ms var(--ease-out) both node-enter')).toEqual({
      names: ['node-enter'],
      iterations: [],
      alternates: false,
    });
    expect(animationShorthand('1.4s linear infinite shimmer')).toEqual({
      names: ['shimmer'],
      iterations: [Number.POSITIVE_INFINITY],
      alternates: false,
    });
    expect(animationShorthand('2s ease 3 alternate breathe')).toEqual({
      names: ['breathe'],
      iterations: [3],
      alternates: true,
    });
  });

  it('reads iteration counts and zero durations the way the cascade does', () => {
    expect(iterationCounts('1 !important')).toEqual([1]);
    expect(iterationCounts('infinite')).toEqual([Number.POSITIVE_INFINITY]);
    expect(iterationCounts('2')).toEqual([2]);
    expect(isZeroDuration('0ms !important')).toBe(true);
    expect(isZeroDuration('0s')).toBe(true);
    expect(isZeroDuration('0.01ms')).toBe(false);
    expect(isZeroDuration('240ms')).toBe(false);
  });

  it('calls an overshooting curve a bounce, and clears the three shipped eases', () => {
    expect(overshoots('cubic-bezier(.34, 1.56, .64, 1)')).toBe(true);
    expect(overshoots('cubicBezier(.5, -0.4, .5, 1)')).toBe(true);
    for (const settled of [
      'cubic-bezier(.16, .84, .28, 1)',
      'cubic-bezier(.50, .00, .20, 1)',
      'cubic-bezier(.20, .90, .10, 1)',
    ]) {
      expect(overshoots(settled), `false-positived on a shipped ease: ${settled}`).toBe(false);
    }
  });

  it('trips on the shapes an ambient loop takes in JavaScript', () => {
    expect([...'loop: true'.matchAll(CODE_LOOP)].length).toBe(1);
    expect([...'loop: -1'.matchAll(CODE_LOOP)].length).toBe(1);
    expect([...'loop: false'.matchAll(CODE_LOOP)].length).toBe(0);
    expect([...'alternate: true'.matchAll(CODE_ALTERNATE)].length).toBe(1);
    expect([...'alternate: false'.matchAll(CODE_ALTERNATE)].length).toBe(0);
  });

  it('trips on a layout property tweened from a pair, and not on a static length', () => {
    expect([...'width: [0, 320]'.matchAll(CODE_LAYOUT_TWEEN)].length).toBe(1);
    expect([...'top: [ -6, 0 ]'.matchAll(CODE_LAYOUT_TWEEN)].length).toBe(1);
    expect([...`width: '100%'`.matchAll(CODE_LAYOUT_TWEEN)].length).toBe(0);
    expect([...'translateY: [6, 0]'.matchAll(CODE_LAYOUT_TWEEN)].length).toBe(0);
  });

  it('trips on the forbidden techniques by name', () => {
    expect(PARALLAX.test('background-attachment: fixed')).toBe(true);
    expect(PARALLAX.test('perspective: 800px')).toBe(true);
    expect(PARALLAX.test('transform: translateY(6px)')).toBe(false);
    expect(SCROLL_DRIVEN_CSS.test('animation-timeline: --page')).toBe(true);
    expect(SCROLL_DRIVEN_CSS.test('scroll-behavior: smooth')).toBe(true);
    expect(SCROLL_DRIVEN_CSS.test('scroll-behavior: auto !important')).toBe(false);
    expect(SCROLL_DRIVEN_CODE.test('onScroll({ container })')).toBe(true);
    expect(SCROLL_DRIVEN_CODE.test('element.scrollIntoView()')).toBe(false);
    expect(SPRING_OR_OVERSHOOT_NAME.test('createSpring({ stiffness: 120 })')).toBe(true);
    expect(SPRING_OR_OVERSHOOT_NAME.test('eases.outBounce')).toBe(true);
    expect(SPRING_OR_OVERSHOOT_NAME.test('eases.outQuad')).toBe(false);
    expect(AMBIENT_NAME.test('skeleton-shimmer')).toBe(true);
    expect(AMBIENT_NAME.test('node-enter')).toBe(false);
    expect(AMBIENT_NAME.test('verdict-flip')).toBe(false);
  });

  it('finds a motion declaration inside a style object', () => {
    const source = `const style = { transition: 'width 200ms ease' };`;
    const matches = [...source.matchAll(CODE_MOTION_DECLARATION)];
    expect(matches.length).toBe(1);
    expect(transitionTargets(matches[0]?.[3] ?? '')).toEqual(['width']);
  });
});

/* ───────── rule 1 — the reduced-motion insurance block exists (§10.6.4) ────── */

describe('reduced motion is a specified state, insured in CSS', () => {
  const universal = REDUCED_MOTION_RULES.filter((entry) =>
    splitOutsideParens(entry.rule.prelude, ',').includes('*'),
  );

  const insurance = new Map<string, CssDeclaration>();
  for (const entry of universal) {
    for (const declaration of entry.rule.declarations) {
      insurance.set(declaration.property.toLowerCase(), declaration);
    }
  }

  it('declares a prefers-reduced-motion: reduce block over the universal selector', () => {
    expect(
      REDUCED_MOTION_RULES.length,
      'No @media (prefers-reduced-motion: reduce) block exists under apps/ledger. It is ' +
        'the insurance for the one case lib/motion.ts cannot cover: the setting changing ' +
        'mid-session with a transition already in flight (design §10.6.4).',
    ).toBeGreaterThan(0);
    expect(universal.length, 'the block exists but does not reach every element').toBeGreaterThan(0);
    const selectors = new Set(universal.flatMap((entry) => splitOutsideParens(entry.rule.prelude, ',')));
    for (const required of ['*', '*::before', '*::after']) {
      expect(selectors.has(required), `the block does not cover ${required}`).toBe(true);
    }
  });

  it('zeroes both durations, pins the iteration count to 1 and forces scroll-behavior auto', () => {
    const duration = ['animation-duration', 'transition-duration'] as const;
    for (const property of duration) {
      const declaration = insurance.get(property);
      expect(declaration, `the block does not set ${property}`).toBeDefined();
      expect(
        isZeroDuration(declaration?.value ?? '1s'),
        `${property} is "${declaration?.value ?? ''}"; under reduced motion it is zero`,
      ).toBe(true);
    }

    const count = insurance.get('animation-iteration-count');
    expect(count, 'the block does not pin animation-iteration-count').toBeDefined();
    expect(iterationCounts(count?.value ?? 'infinite')).toEqual([1]);

    const scroll = insurance.get('scroll-behavior');
    expect(scroll, 'the block does not force scroll-behavior').toBeDefined();
    expect(withoutImportant(scroll?.value ?? '').toLowerCase()).toBe('auto');
  });

  it('marks every one of them !important, because insurance that loses is not insurance', () => {
    for (const property of [
      'animation-duration',
      'animation-iteration-count',
      'transition-duration',
      'scroll-behavior',
    ]) {
      const declaration = insurance.get(property);
      expect(
        /!\s*important\s*$/i.test(declaration?.value ?? ''),
        `${property} in the reduced-motion block is not !important, so an authored ` +
          `duration outranks it and a half-played transition survives the setting change`,
      ).toBe(true);
    }
  });
});

/* ───── rules 2, 3 and 6 — the closed allowlist, in CSS and in style objects ── */

describe('every animated property is on the closed allowlist', () => {
  function check(where: string, targets: readonly string[], offences: string[]): void {
    for (const target of targets) {
      if (FORBIDDEN_TARGETS.has(target)) {
        offences.push(
          `${where}  animates ${target}, which forces layout on every frame; ` +
            `use transform instead (design §10.6.3)`,
        );
      } else if (target === 'all') {
        offences.push(
          `${where}  animates "all", which is how a width or a top animation arrives ` +
            `without anyone typing one; name the properties`,
        );
      } else if (!ANIMATABLE.has(target)) {
        offences.push(
          `${where}  animates ${target}, which is not on the allowlist ` +
            `(${[...ANIMATABLE].join(', ')})`,
        );
      }
    }
  }

  it('transitions only allowlisted properties in every stylesheet', () => {
    const offences: string[] = [];
    for (const entry of DECLARATIONS) {
      if (!propertyIs(entry, 'transition', 'transition-property')) continue;
      check(
        `${entry.path}:${entry.declaration.line}  ${entry.rule.prelude}`,
        transitionTargets(entry.declaration.value),
        offences,
      );
    }
    report(offences, 'a transition is compositor work or cheap paint, never layout');
  });

  it('keeps every @keyframes block on the same allowlist, referenced or not', () => {
    const offences: string[] = [];
    for (const block of KEYFRAMES) {
      for (const declaration of block.properties) {
        check(
          `${block.path}:${declaration.line}  @keyframes ${block.name}`,
          [declaration.property.toLowerCase()],
          offences,
        );
      }
    }
    report(offences, 'an unreferenced shimmer is a shimmer with a commit behind it');

    if (KEYFRAMES.length === 0) {
      expect(
        KEYFRAMES,
        'No @keyframes block exists under apps/ledger yet. The five orchestrations of ' +
          '§10.6 are built in stage 17 through lib/motion.ts rather than in CSS, so this ' +
          'is expected — and this assertion is the tripwire that engages on the first one.',
      ).toEqual([]);
    }
  });

  it('transitions only allowlisted properties in a style object or an option bag', () => {
    const offences: string[] = [];
    for (const file of SHIPPED_CODE) {
      file.lines.forEach((line, index) => {
        for (const match of line.matchAll(CODE_MOTION_DECLARATION)) {
          const property = (match[1] ?? '').toLowerCase();
          const value = match[3] ?? '';
          const where = `${file.path}:${index + 1}`;
          if (property === 'transition' || property === 'transitionproperty') {
            check(where, transitionTargets(value), offences);
          }
        }
      });
    }
    report(offences, 'the style-object spelling of a transition is still a transition');
  });

  it('never tweens width, height, top or left from a keyframe pair', () => {
    const offences: string[] = [];
    for (const file of SHIPPED_CODE) {
      file.lines.forEach((line, index) => {
        for (const match of line.matchAll(CODE_LAYOUT_TWEEN)) {
          offences.push(
            `${file.path}:${index + 1}  ${match[1] ?? ''} is animated from a [from, to] pair; ` +
              `the entrance of §10.6.1 lifts with translateY for exactly this reason`,
          );
        }
      });
    }
    report(offences, 'layout properties are not animated, in CSS or in a timeline');
  });
});

/* ─────────────── rule 4 — nothing loops, nothing runs ambiently ────────────── */

describe('nothing loops and nothing runs ambiently', () => {
  it('never sets an iteration count above 1 in CSS', () => {
    const offences: string[] = [];
    for (const entry of DECLARATIONS) {
      const where = `${entry.path}:${entry.declaration.line}  ${entry.rule.prelude}`;
      if (propertyIs(entry, 'animation-iteration-count')) {
        for (const count of iterationCounts(entry.declaration.value)) {
          if (!(count <= 1)) {
            offences.push(`${where}  animation-iteration-count is ${count}`);
          }
        }
      }
      if (propertyIs(entry, 'animation')) {
        const shorthand = animationShorthand(entry.declaration.value);
        for (const count of shorthand.iterations) {
          if (!(count <= 1)) offences.push(`${where}  the shorthand repeats ${count} times`);
        }
        if (shorthand.alternates) offences.push(`${where}  the shorthand ping-pongs`);
      }
      if (propertyIs(entry, 'animation-direction')) {
        const direction = withoutImportant(entry.declaration.value).toLowerCase();
        if (direction.includes('alternate')) {
          offences.push(`${where}  animation-direction: ${direction} is a ping-pong, so a loop`);
        }
      }
    }
    report(offences, 'an ambient loop is the most reliable tell of a generated interface');
  });

  it('never names an animation after ambient motion', () => {
    const offences: string[] = [];
    for (const block of KEYFRAMES) {
      if (AMBIENT_NAME.test(block.name)) {
        offences.push(`${block.path}:${block.line}  @keyframes ${block.name}`);
      }
    }
    for (const entry of DECLARATIONS) {
      if (!propertyIs(entry, 'animation', 'animation-name')) continue;
      for (const name of animationShorthand(entry.declaration.value).names) {
        if (AMBIENT_NAME.test(name)) {
          offences.push(`${entry.path}:${entry.declaration.line}  animates "${name}"`);
        }
      }
    }
    report(offences, 'no shimmer, no pulse, no glow, no breathing UI');
  });

  it('asks for no loop and no ping-pong in a JavaScript orchestration', () => {
    const offences: string[] = [];
    for (const file of SHIPPED_CODE) {
      file.lines.forEach((line, index) => {
        for (const match of [...line.matchAll(CODE_LOOP), ...line.matchAll(CODE_ALTERNATE)]) {
          offences.push(`${file.path}:${index + 1}  ${match[0]}`);
        }
      });
    }
    report(
      offences,
      'every orchestration of §10.6 runs once; the graph entrance is even gated on a ' +
        'sessionStorage flag so it does not replay on navigation',
    );
  });
});

/* ────── rule 5 — no hover bounce, shimmer, parallax, scroll or spring ─────── */

describe('the named techniques of §10.6.3 are absent', () => {
  it('puts no bounce and no scale on hover', () => {
    const offences: string[] = [];
    for (const entry of DECLARATIONS) {
      const prelude = entry.rule.prelude.toLowerCase();
      if (!prelude.includes(':hover')) continue;
      const property = entry.declaration.property.toLowerCase();
      const value = entry.declaration.value.toLowerCase();
      const where = `${entry.path}:${entry.declaration.line}  ${entry.rule.prelude}`;
      if (property === 'transform' && value.includes('scale')) {
        offences.push(`${where}  scales on hover`);
      }
      if (property === 'animation' || property === 'animation-name') {
        offences.push(`${where}  runs a keyframe animation on hover`);
      }
    }
    report(offences, 'hover changes a surface and an outline; it does not perform');
  });

  it('uses no parallax and no scroll-driven motion in CSS', () => {
    const offences: string[] = [];
    for (const file of STYLESHEETS) {
      /* comments are blanked rather than skipped, so line numbers survive and a
         stylesheet is free to explain in prose which technique it refuses */
      stripCssComments(file.text)
        .split('\n')
        .forEach((line, index) => {
          if (PARALLAX.test(line)) {
            offences.push(`${file.path}:${index + 1}  parallax: ${line.trim()}`);
          }
          if (SCROLL_DRIVEN_CSS.test(line)) {
            offences.push(`${file.path}:${index + 1}  scroll-driven: ${line.trim()}`);
          }
        });
    }
    report(offences, 'motion is triggered by a state change, never by a scroll position');
  });

  it('drives nothing from scroll and springs nothing in JavaScript', () => {
    const offences: string[] = [];
    for (const file of SHIPPED_CODE) {
      file.lines.forEach((line, index) => {
        if (SCROLL_DRIVEN_CODE.test(line)) {
          offences.push(`${file.path}:${index + 1}  scroll-driven: ${line.trim()}`);
        }
        if (SPRING_OR_OVERSHOOT_NAME.test(line)) {
          offences.push(`${file.path}:${index + 1}  spring or overshoot: ${line.trim()}`);
        }
      });
    }
    report(offences, 'spring physics on layout is on the forbidden list of §10.6.3');
  });

  it('overshoots no easing curve anywhere', () => {
    const offences: string[] = [];
    for (const entry of DECLARATIONS) {
      if (overshoots(entry.declaration.value)) {
        offences.push(
          `${entry.path}:${entry.declaration.line}  ${entry.declaration.property}: ` +
            `${normaliseCssValue(entry.declaration.value)}`,
        );
      }
    }
    for (const file of SHIPPED_CODE) {
      file.lines.forEach((line, index) => {
        if (overshoots(line)) offences.push(`${file.path}:${index + 1}  ${line.trim()}`);
      });
    }
    report(
      offences,
      'a control point outside the unit range on the y axis is a bounce whatever it is ' +
        'called; the three shipped eases settle',
    );
  });
});
