/**
 * The metric rail's optical alignment, asserted — design §10.7, §10.10, R9.3, R10.1.
 *
 * Task 9.4 builds `MetricRail`, `MetricFigure` and `DegradedChip` against the
 * stylesheet and the class contract this file guards. Alignment is the kind of
 * craft that is invisible when present and unfixable once a component tree has
 * grown around a broken version of it, so each of the four claims design §10.7
 * makes is turned into arithmetic here rather than left to a reviewer's eye:
 *
 *   1. the `%` is `--fs-lg`, baseline-aligned, and carries the `-0.06em` right
 *      margin that keeps the *digits* rather than the glyph run on the tile's
 *      optical left edge;
 *   2. `n/a` is `--fs-lg` on the same baseline as the digits it replaces, so a
 *      degraded rail keeps the rail's rhythm (R9.3);
 *   3. the labels and the figures share one 4px grid — every structural length in
 *      the stylesheet resolves to a multiple of 4px, with exactly one deliberate
 *      sub-grid exception, which the test names;
 *   4. the numerals are tabular and lining, because the count-up of §10.6.2
 *      rewrites the digit run on every frame.
 *
 * The mechanism claim is checked too, not just the declarations: the row's height
 * and baseline come from a strut the row sets on *itself*, which is what makes a
 * 20px `n/a` and a 40px digit run occupy the same box. That is the difference
 * between satisfying §10.7 and happening to look right with today's content.
 *
 * Every path resolves through `_scan.ts`, which throws rather than scanning
 * nothing, and the stylesheet's presence is asserted before anything is read from
 * it — a stylesheet that had been renamed would otherwise parse to zero rules and
 * pass every assertion below.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  METRIC_RAIL_CLASSES,
  NOT_APPLICABLE,
  formatMetricFigure,
  metricFigureParts,
  percentDigits,
  wholePercent,
} from '../lib/metricRail.js';
import { TOKENS } from '../lib/tokens.js';
import { STYLE_EXTENSIONS, normaliseCssValue, parseCss, scanLedger, type CssRule } from './_scan.js';

/** fast-check runs for the one local invariant below. */
const NUM_RUNS = 500;

const METRIC_RAIL_CSS = 'apps/ledger/styles/metric-rail.css';

/** The 4px module of design §10.4.1. Every structural length is a multiple. */
const GRID = 4;

/** `1rem` in the Ledger, whose root font size is 16px by declaration (§10.4.1). */
const ROOT_FONT_PX = 16;

/**
 * Properties that place something on the grid. Deliberately not "every property
 * with a length in it": `border-radius` is a curve rather than a position, and
 * `flex-basis` is a ratio's zero.
 */
const GRID_PROPERTIES = new Set([
  'gap',
  'row-gap',
  'column-gap',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'height',
  'min-height',
  'line-height',
  'top',
  'bottom',
]);

const KEYWORD_LENGTHS = /^(?:auto|normal|none|inherit|initial|unset|0)$/;

/* ─────────────────────────── reading the stylesheet ────────────────────────── */

const STYLESHEET = (() => {
  const found = scanLedger(STYLE_EXTENSIONS).find((file) => file.path === METRIC_RAIL_CSS);
  if (found === undefined) {
    throw new Error(
      `${METRIC_RAIL_CSS} was not found under apps/ledger. The alignment assertions ` +
        `below would parse zero rules and pass; a renamed stylesheet must fail loudly.`,
    );
  }
  return found;
})();

const RULES: readonly CssRule[] = parseCss(STYLESHEET.text);

/** Each rule's selectors, comma-split and trimmed. */
function selectorsOf(rule: CssRule): string[] {
  return rule.prelude.split(',').map((selector) => selector.trim());
}

/**
 * Every declaration that applies to `.className`, later rules winning — the
 * cascade for a set of equally specific single-class rules, which is all this
 * stylesheet contains. Merging matters: the unit's size arrives from the rule it
 * shares with `n/a`, and its optical margin from a rule of its own.
 */
function declarationsFor(className: string): Map<string, string> {
  const merged = new Map<string, string>();
  for (const rule of RULES) {
    if (!selectorsOf(rule).includes(`.${className}`)) continue;
    for (const declaration of rule.declarations) {
      merged.set(declaration.property.toLowerCase(), normaliseCssValue(declaration.value));
    }
  }
  return merged;
}

function declaration(className: string, property: string): string | undefined {
  return declarationsFor(className).get(property);
}

/** Expands `var(--token)` through `TOKENS`, failing loudly on a name that is not one. */
function expandTokens(value: string): string {
  return value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_whole, name: string) => {
    const token = TOKENS[name as keyof typeof TOKENS];
    if (token === undefined) {
      throw new Error(
        `${METRIC_RAIL_CSS} names ${name}, which tokens.css does not declare — nothing ` +
          `in the browser resolves it and the length below is not the length authored.`,
      );
    }
    return token;
  });
}

type Length =
  | { readonly kind: 'px'; readonly px: number }
  /** `em`, `ex`, `ch`, `%` — relative to type rather than to the grid. */
  | { readonly kind: 'optical'; readonly text: string }
  /** A unitless number, e.g. a line-height multiplier. */
  | { readonly kind: 'ratio'; readonly value: number }
  | { readonly kind: 'keyword' };

function resolveLength(part: string): Length {
  if (KEYWORD_LENGTHS.test(part)) return { kind: 'keyword' };
  const absolute = /^(-?\d*\.?\d+)(px|rem)$/.exec(part);
  if (absolute !== null) {
    const magnitude = Number(absolute[1]);
    return { kind: 'px', px: absolute[2] === 'rem' ? magnitude * ROOT_FONT_PX : magnitude };
  }
  if (/^-?\d*\.?\d+(?:em|ex|ch|%)$/.test(part)) return { kind: 'optical', text: part };
  if (/^-?\d*\.?\d+$/.test(part)) return { kind: 'ratio', value: Number(part) };
  return { kind: 'keyword' };
}

/** A declared font size in px, or `null` when the class declares none. */
function fontSizePx(className: string): number | null {
  const declared = declaration(className, 'font-size');
  if (declared === undefined) return null;
  const resolved = resolveLength(expandTokens(declared));
  return resolved.kind === 'px' ? resolved.px : null;
}

/** Every class the stylesheet defines a rule for. */
const DEFINED_CLASSES: ReadonlySet<string> = new Set(
  RULES.flatMap((rule) =>
    [...rule.prelude.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1] ?? ''),
  ).filter((name) => name !== ''),
);

const CONTRACT = METRIC_RAIL_CLASSES;

/* ───────────────────────────────── meta-tests ──────────────────────────────── */

describe('metric rail alignment — the assertions have something to read', () => {
  it('read a non-trivial stylesheet', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(7);
    const declarations = RULES.reduce((total, rule) => total + rule.declarations.length, 0);
    expect(declarations, 'the stylesheet parsed to no declarations').toBeGreaterThanOrEqual(30);
    expect(RULES.every((rule) => rule.ancestors.length === 0)).toBe(true);
  });

  it('defines a rule for every class the typed contract names', () => {
    const missing = Object.entries(CONTRACT)
      .filter(([, className]) => !DEFINED_CLASSES.has(className))
      .map(([key, className]) => `${key} -> .${className}`);
    expect(
      missing,
      `lib/metricRail.ts names classes ${METRIC_RAIL_CSS} does not define, so task 9.4 ` +
        `would render an unstyled figure:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('defines no rail class the typed contract does not name', () => {
    const named = new Set<string>(Object.values(CONTRACT));
    const stray = [...DEFINED_CLASSES].filter((className) => !named.has(className)).sort();
    expect(
      stray,
      `${METRIC_RAIL_CSS} styles classes no component can reach through the contract in ` +
        `lib/metricRail.ts:\n${stray.map((name) => `.${name}`).join('\n')}`,
    ).toEqual([]);
  });

  it('resolves tokens to real lengths, and refuses a name that is not a token', () => {
    expect(resolveLength(expandTokens('var(--fs-lg)'))).toEqual({ kind: 'px', px: 20 });
    expect(resolveLength(expandTokens('var(--s-4)'))).toEqual({ kind: 'px', px: 16 });
    expect(resolveLength('-0.06em')).toEqual({ kind: 'optical', text: '-0.06em' });
    expect(resolveLength(expandTokens('var(--lh-tight)'))).toEqual({ kind: 'ratio', value: 1.2 });
    expect(() => expandTokens('var(--fs-enormous)')).toThrow(/tokens.css does not declare/);
  });
});

/* ──────────────────── claim 1: the digits align, not the run ────────────────── */

describe('metric rail alignment — the unit is optical, the digits are the column', () => {
  it('sets the % at --fs-lg on the digits baseline with a -0.06em right margin', () => {
    const unit = declarationsFor(CONTRACT.unit);
    expect(unit.get('font-size')).toBe('var(--fs-lg)');
    expect(unit.get('vertical-align')).toBe('baseline');
    expect(
      unit.get('margin-right'),
      `design §10.7: the -0.06em takes back the %'s trailing side bearing so a tile's ` +
        `figure box begins and ends on ink and the four digit runs agree`,
    ).toBe('-0.06em');
  });

  it('sets the digits at --fs-metric, the size the strut is cut for', () => {
    expect(declaration(CONTRACT.digits, 'font-size')).toBe('var(--fs-metric)');
    expect(declaration(CONTRACT.digits, 'vertical-align')).toBe('baseline');
    expect(fontSizePx(CONTRACT.digits)).toBe(40);
  });

  it('keeps the unit smaller than the digits, so the number carries the tile', () => {
    const digits = fontSizePx(CONTRACT.digits);
    const unit = fontSizePx(CONTRACT.unit);
    expect(digits).not.toBeNull();
    expect(unit).not.toBeNull();
    expect(unit ?? 0).toBeLessThan(digits ?? 0);
  });
});

/* ─────────── claim 2: a degraded rail is the same rail (R9.3, §10.10) ───────── */

describe('metric rail alignment — n/a and the chip keep the rail rhythm', () => {
  it('sets n/a at --fs-lg on the baseline of the digits it replaces', () => {
    const notApplicable = declarationsFor(CONTRACT.notApplicable);
    expect(notApplicable.get('font-size')).toBe('var(--fs-lg)');
    expect(notApplicable.get('vertical-align')).toBe('baseline');
    /* it stands in for numerals, so it keeps their family */
    expect(notApplicable.get('font-family')).toBe('var(--font-mono)');
  });

  it('sets n/a, the unit and the chip word to one size', () => {
    const sizes = [CONTRACT.unit, CONTRACT.notApplicable, CONTRACT.word].map((className) => ({
      className,
      px: fontSizePx(className),
    }));
    for (const size of sizes) {
      expect(size.px, `.${size.className} declares no resolvable font size`).toBe(20);
    }
  });

  it('fixes the baseline on a strut the row sets on itself, not on its tallest child', () => {
    const figure = declarationsFor(CONTRACT.figure);
    /* inline flow, so the strut exists at all: a flex row's height would follow
       its tallest child and a 20px n/a would shorten the tile */
    expect(figure.get('display')).toBe('block');
    expect(figure.get('font-size')).toBe('var(--fs-metric)');
    expect(figure.get('line-height')).toBe('var(--lh-tight)');

    const strut = 40 * 1.2;
    expect(strut).toBe(48);
    expect(strut % GRID, 'the strut is off the 4px grid').toBe(0);
  });

  it('lets no child of the figure exceed the strut or leave the baseline', () => {
    const offences: string[] = [];
    for (const className of DEFINED_CLASSES) {
      if (!className.startsWith(`${CONTRACT.figure}__`)) continue;
      const merged = declarationsFor(className);
      if (merged.get('vertical-align') !== 'baseline') {
        offences.push(`.${className} does not declare vertical-align: baseline`);
      }
      const px = fontSizePx(className);
      if (px !== null && px > 40) {
        offences.push(`.${className} is ${px}px, taller than the 40px strut`);
      }
    }
    expect(
      offences,
      `a run that leaves the baseline or outgrows the strut changes the tile's height, ` +
        `which is the rhythm change R9.3 forbids:\n${offences.join('\n')}`,
    ).toEqual([]);
    expect(
      [...DEFINED_CLASSES].filter((name) => name.startsWith(`${CONTRACT.figure}__`)).length,
      'no figure child was scanned',
    ).toBeGreaterThanOrEqual(3);
  });

  it('gives the chip the tile footprint exactly, by writing it once', () => {
    const shared = RULES.filter((rule) => {
      const selectors = selectorsOf(rule);
      return (
        selectors.includes(`.${CONTRACT.tile}`) && selectors.includes(`.${CONTRACT.chip}`)
      );
    });
    expect(
      shared.length,
      `§10.10: the chip takes the tile's exact footprint. One rule naming both is how ` +
        `that stays true — two rules can drift.`,
    ).toBe(1);
    const box = declarationsFor(CONTRACT.tile);
    expect([...box.keys()].sort()).toEqual([...declarationsFor(CONTRACT.chip).keys()].sort());
    for (const [property, value] of box) {
      expect(declaration(CONTRACT.chip, property), `.${CONTRACT.chip} differs on ${property}`).toBe(
        value,
      );
    }
    expect(box.get('padding')).toBe('var(--s-4)');
    expect(box.get('box-sizing')).toBe('border-box');
  });
});

/* ───────────────────── claim 3: labels and figures share 4px ────────────────── */

describe('metric rail alignment — one 4px grid, one named exception', () => {
  it('resolves every structural length to a multiple of 4px', () => {
    const offences: string[] = [];
    let checked = 0;

    for (const rule of RULES) {
      const ruleFontSize = (() => {
        const declared = rule.declarations.find(
          (candidate) => candidate.property.toLowerCase() === 'font-size',
        );
        if (declared === undefined) return null;
        const resolved = resolveLength(expandTokens(normaliseCssValue(declared.value)));
        return resolved.kind === 'px' ? resolved.px : null;
      })();

      for (const declared of rule.declarations) {
        const property = declared.property.toLowerCase();
        if (!GRID_PROPERTIES.has(property)) continue;
        for (const part of expandTokens(normaliseCssValue(declared.value)).split(' ')) {
          if (part === '') continue;
          const length = resolveLength(part);
          let px: number | null = null;
          if (length.kind === 'px') px = length.px;
          else if (length.kind === 'ratio' && property === 'line-height' && ruleFontSize !== null) {
            px = length.value * ruleFontSize;
          } else continue;
          checked += 1;
          if (Math.abs(px % GRID) > 1e-9) {
            offences.push(`${rule.prelude} { ${property}: ${declared.value} } resolves to ${px}px`);
          }
        }
      }
    }

    expect(
      checked,
      'no structural length was resolved — the grid assertion checked nothing',
    ).toBeGreaterThanOrEqual(5);
    expect(
      offences,
      `design §10.7: tile labels sit on a 4px baseline grid shared with the digits, and ` +
        `§10.4.1 permits no spacing value off that module.\n${offences.join('\n')}`,
    ).toEqual([]);
  });

  it('puts the label line box on the grid too', () => {
    const label = declarationsFor(CONTRACT.label);
    expect(label.get('line-height')).toBe('var(--s-4)');
    expect(label.get('font-size')).toBe('var(--fs-sm)');
    const margin = expandTokens(label.get('margin') ?? '')
      .split(' ')
      .map((part) => resolveLength(part))
      .map((length) => (length.kind === 'px' ? length.px : 0));
    expect(margin.length).toBeGreaterThan(0);
    for (const value of margin) expect(value % GRID).toBe(0);
  });

  it('permits exactly one sub-grid length, and it is the optical unit margin', () => {
    const optical: string[] = [];
    for (const rule of RULES) {
      for (const declared of rule.declarations) {
        const property = declared.property.toLowerCase();
        if (!GRID_PROPERTIES.has(property)) continue;
        for (const part of normaliseCssValue(declared.value).split(' ')) {
          if (resolveLength(part).kind === 'optical') {
            optical.push(`${rule.prelude} { ${property}: ${part} }`);
          }
        }
      }
    }
    expect(
      optical,
      `the -0.06em is optical rather than structural and is the only length allowed off ` +
        `the module. A second one is a spacing decision hiding in a type unit.`,
    ).toEqual([`.${CONTRACT.unit} { margin-right: -0.06em }`]);
  });
});

/* ──────────────── claim 4: tabular numerals, and mono for numerals ─────────── */

describe('metric rail alignment — tabular numerals and the mono/ui split', () => {
  it('declares tabular, lining numerals on the row and on the digit run', () => {
    for (const className of [CONTRACT.figure, CONTRACT.digits]) {
      expect(
        declaration(className, 'font-variant-numeric'),
        `.${className} must hold the digit advance steady: the count-up of §10.6.2 ` +
          `rewrites this run on every frame`,
      ).toBe('tabular-nums lining-nums');
    }
  });

  it('keeps numerals in mono and prose in the UI face', () => {
    expect(declaration(CONTRACT.figure, 'font-family')).toBe('var(--font-mono)');
    expect(declaration(CONTRACT.notApplicable, 'font-family')).toBe('var(--font-mono)');
    expect(declaration(CONTRACT.word, 'font-family')).toBe('var(--font-ui)');
    expect(declaration(CONTRACT.label, 'font-family')).toBe('var(--font-ui)');
  });

  it('tracks only the display run, and unsets tracking where it inherits', () => {
    expect(declaration(CONTRACT.figure, 'letter-spacing')).toBe('var(--tr-tight)');
    expect(declaration(CONTRACT.word, 'letter-spacing')).toBe('normal');
    expect(declaration(CONTRACT.label, 'letter-spacing')).toBe('normal');
  });
});

/* ────────────── the split the alignment depends on, in TypeScript ───────────── */

describe('metric rail alignment — the figure is two runs, not one string', () => {
  it('splits a ratio into digits and unit', () => {
    expect(metricFigureParts(0.87)).toEqual({ kind: 'percent', digits: '87', unit: '%' });
    expect(metricFigureParts(0)).toEqual({ kind: 'percent', digits: '0', unit: '%' });
    expect(metricFigureParts(1)).toEqual({ kind: 'percent', digits: '100', unit: '%' });
  });

  it('renders the literal n/a for a zero promise count, dividing nothing', () => {
    expect(metricFigureParts(null)).toEqual({ kind: 'not-applicable', text: NOT_APPLICABLE });
    expect(formatMetricFigure(null)).toBe('n/a');
  });

  it('rejects a ratio outside the closed unit interval rather than clamping', () => {
    expect(() => wholePercent(1.5)).toThrow(/ratio in \[0, 1\]/);
    expect(() => wholePercent(-0.01)).toThrow(/ratio in \[0, 1\]/);
    expect(() => wholePercent(Number.NaN)).toThrow(/finite coverage ratio/);
    expect(() => percentDigits(12.5)).toThrow(/whole percentage/);
    expect(() => percentDigits(101)).toThrow(/whole percentage/);
  });

  it('formats every whole percentage to at most three tabular columns', () => {
    for (let percent = 0; percent <= 100; percent += 1) {
      const digits = percentDigits(percent);
      expect(digits.length).toBeGreaterThanOrEqual(1);
      expect(digits.length).toBeLessThanOrEqual(3);
      expect(digits).toMatch(/^\d+$/);
    }
  });

  /**
   * A local invariant of the formatter rather than a numbered design property: the
   * visible runs, concatenated, are the string the badge and the accessible name
   * use. That identity is what makes the final count-up frame and the no-motion
   * render the same render (§10.6.2).
   */
  it('keeps the joined runs identical to the single-string form, for any ratio', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (ratio) => {
        const parts = metricFigureParts(ratio);
        expect(parts.kind).toBe('percent');
        if (parts.kind !== 'percent') return;
        expect(formatMetricFigure(ratio)).toBe(`${parts.digits}${parts.unit}`);
        const percent = Number(parts.digits);
        expect(Number.isInteger(percent)).toBe(true);
        expect(percent).toBeGreaterThanOrEqual(0);
        expect(percent).toBeLessThanOrEqual(100);
        expect(Math.abs(percent / 100 - ratio)).toBeLessThanOrEqual(0.005 + 1e-9);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
