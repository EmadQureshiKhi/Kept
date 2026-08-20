/**
 * Density and the no-horizontal-overflow claim — task 9.6, design §10.3, §10.4.3,
 * §10.7, R10.8.
 *
 * R10.8 says the hero has no horizontal overflow between 1280 and 1920 px. That is a
 * claim about layout, and **jsdom does no layout** — every `offsetWidth` it reports is
 * zero, so a render test asserting widths would be asserting a fiction and would pass
 * on a page that overflowed badly. So the claim is discharged the way it was authored:
 * as arithmetic over the grid in `promise-graph.css`, crossed with the page column in
 * `shell.css`, at both ends of the range and every 32px step between them.
 *
 * The arithmetic is only sound if nothing in the tree can push wider than its column,
 * which is three further rules, each asserted rather than assumed:
 *
 *   1. the canvas column is `minmax(0, 1fr)` — the `0` is what lets it *yield*, and a
 *      bare `1fr` has an `auto` minimum, which is exactly how a grid child's content
 *      pushes a page wider than the window;
 *   2. no rule in either stylesheet sets a non-zero `min-width`;
 *   3. the canvas clips its own viewport (`overflow: hidden`), so a graph 1400px wide
 *      is panned to rather than scrolled to.
 *
 * The footprints are checked against their single source too: `.promise-node` must be
 * exactly the 320×76 `lib/layout.ts` reserves per row, or the lanes and the painted
 * nodes disagree about where a row ends — and `ROW_H` must leave a real gutter between
 * two stacked nodes, which is the difference between a lane and a column of touching
 * boxes.
 *
 * No DOM is touched here, deliberately: this file is `.ts`, so the root
 * `tsconfig.json` type-checks it under `lib: ["ES2022"]` with no DOM at all. A density
 * guard that needed a browser could not be one of the cheap tests.
 */

import { describe, expect, it } from 'vitest';

import { NODE_H, NODE_W, ROW_H } from '../lib/layout.js';
import {
  STYLE_EXTENSIONS,
  normaliseCssValue,
  parseCss,
  scanLedger,
  type CssRule,
} from './_scan.js';

const GRAPH_CSS = 'apps/ledger/styles/promise-graph.css';
const NODE_CSS = 'apps/ledger/styles/promise-node.css';
const PANEL_CSS = 'apps/ledger/styles/promise-panel.css';
const SHELL_CSS = 'apps/ledger/styles/shell.css';

/** The window widths R10.8 names, and the whole range between them. */
const NARROWEST = 1280;
const WIDEST = 1920;

/** `--s-*` steps, resolved from `tokens.css` values (§10.4.1). */
const SPACING: Readonly<Record<string, number>> = {
  '--s-1': 4,
  '--s-2': 8,
  '--s-3': 12,
  '--s-4': 16,
  '--s-6': 24,
  '--s-8': 32,
  '--s-12': 48,
  '--s-16': 64,
};

const STYLESHEETS = scanLedger(STYLE_EXTENSIONS);

function sheet(path: string): CssRule[] {
  const file = STYLESHEETS.find((candidate) => candidate.path === path);
  expect(file, `${path} was not scanned — a renamed stylesheet parses to zero rules`).toBeDefined();
  return parseCss(file?.text ?? '');
}

const GRAPH_RULES = sheet(GRAPH_CSS);
const NODE_RULES = sheet(NODE_CSS);
const PANEL_RULES = sheet(PANEL_CSS);
const SHELL_RULES = sheet(SHELL_CSS);

/** The value of `property` in the rule whose prelude is exactly `prelude`. */
function declaration(rules: readonly CssRule[], prelude: string, property: string): string {
  const rule = rules.find((candidate) => candidate.prelude === prelude);
  expect(rule, `no rule for ${prelude}`).toBeDefined();
  const found = rule?.declarations.find(
    (candidate) => candidate.property.toLowerCase() === property,
  );
  expect(found, `${prelude} declares no ${property}`).toBeDefined();
  return normaliseCssValue(found?.value ?? '');
}

/** A `px` length, or a `var(--s-*)` step, as a number. */
function lengthPx(value: string): number {
  const step = /^var\(\s*(--s-\d+)\s*\)$/.exec(value);
  if (step !== null) {
    const resolved = SPACING[step[1] ?? ''];
    expect(resolved, `${value} is not a --s-* step of the 4px scale`).toBeDefined();
    return resolved ?? Number.NaN;
  }
  const px = /^(-?\d+(?:\.\d+)?)px$/.exec(value);
  expect(px, `${value} is neither a px length nor a --s-* step`).not.toBeNull();
  return Number(px?.[1] ?? Number.NaN);
}

/**
 * The grid's tracks, split so the flexible one is separated from the fixed ones.
 *
 * `minmax(0, 1fr)` survives the split because `splitOutsideParens` is not fooled by
 * the comma inside it — which is the whole reason that helper exists in `_scan.ts`.
 */
function tracks(prelude: string): { flexible: string[]; fixed: number[] } {
  const value = declaration(GRAPH_RULES, prelude, 'grid-template-columns');
  const flexible: string[] = [];
  const fixed: number[] = [];
  let depth = 0;
  let current = '';
  const flush = (): void => {
    const token = current.trim();
    current = '';
    if (token === '') return;
    if (token.includes('fr')) flexible.push(token);
    else fixed.push(lengthPx(token));
  };
  for (const character of value) {
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    if (depth === 0 && /\s/.test(character)) flush();
    else current += character;
  }
  flush();
  return { flexible, fixed };
}

/* ────────────────────────────── the grid, as authored ──────────────────────────── */

describe('the hero is one grid, and the canvas is the column that yields', () => {
  it('gives the canvas minmax(0, 1fr), because a bare 1fr has an auto minimum', () => {
    for (const prelude of ['.promise-graph', ".promise-graph[data-panel='open']"]) {
      const { flexible } = tracks(prelude);
      expect(flexible, `${prelude} has no flexible column`).toHaveLength(1);
      expect(
        flexible[0]?.replace(/\s+/g, ''),
        `${prelude} lets its canvas column take an auto minimum, which is how a graph ` +
          `wider than the window pushes the page wider than the window`,
      ).toBe('minmax(0,1fr)');
    }
  });

  it('adds the panel as a third column rather than as an overlay', () => {
    const closed = tracks('.promise-graph');
    const open = tracks(".promise-graph[data-panel='open']");
    expect(closed.fixed).toEqual([240]);
    expect(open.fixed).toEqual([240, 440]);
    expect(open.fixed.length - closed.fixed.length, 'the panel is not a column').toBe(1);
  });

  it('sizes each fixed column to the component that lives in it', () => {
    /* 440px is the panel width design §10.2 states, declared once in its own file */
    expect(lengthPx(declaration(PANEL_RULES, '.promise-panel', 'width'))).toBe(440);
    /* 240px is the lane chip, so the list column and the context lanes agree */
    expect(lengthPx(declaration(NODE_RULES, '.lane-node', 'width'))).toBe(240);
  });

  it('clips its own viewport, so a wide graph is panned to and never scrolled to', () => {
    expect(declaration(GRAPH_RULES, '.promise-graph__canvas', 'overflow')).toBe('hidden');
    expect(lengthPx(declaration(GRAPH_RULES, '.promise-graph__canvas', 'height'))).toBe(620);
  });
});

/* ───────────────────── no horizontal overflow, 1280 to 1920 (R10.8) ────────────── */

describe('no horizontal overflow anywhere between 1280 and 1920', () => {
  const gap = lengthPx(declaration(GRAPH_RULES, '.promise-graph', 'gap'));
  const columnPadding = lengthPx('var(--s-6)');
  const maxColumn = lengthPx(declaration(SHELL_RULES, '.page-main', 'max-width'));

  /** Canvas width left over at a given viewport, panel open. */
  function canvasWidth(viewport: number): number {
    const { fixed } = tracks(".promise-graph[data-panel='open']");
    const available = Math.min(viewport, maxColumn) - 2 * columnPadding;
    const spent = fixed.reduce((total, width) => total + width, 0) + gap * fixed.length;
    return available - spent;
  }

  it('reads the shell column and the gap from the stylesheets, not from memory', () => {
    expect(gap).toBe(16);
    expect(maxColumn).toBe(1680);
    expect(
      declaration(SHELL_RULES, '.page-main', 'padding'),
      'the page column stopped padding with a --s-* step',
    ).toContain('var(--s-6)');
  });

  it('leaves the canvas a positive width at every 32px step of the range', () => {
    const offences: string[] = [];
    for (let viewport = NARROWEST; viewport <= WIDEST; viewport += 32) {
      const width = canvasWidth(viewport);
      if (width <= 0) offences.push(`${viewport}px viewport leaves ${width}px of canvas`);
    }
    expect(
      offences,
      `the fixed columns and gaps outgrew the page column, so the canvas is squeezed to ` +
        `nothing and the grid overflows (R10.8):\n${offences.join('\n')}`,
    ).toEqual([]);
  });

  it('leaves room for a whole promise node at the narrowest width, panel open', () => {
    const width = canvasWidth(NARROWEST);
    expect(
      width,
      `at ${NARROWEST}px with the panel open the canvas gets ${width}px, which is less ` +
        `than one ${NODE_W}px node — the hero would open on a graph a reader cannot read`,
    ).toBeGreaterThanOrEqual(NODE_W);
    /* for the record: 1280 − 48 padding − (240 + 440) − 32 gaps = 520 */
    expect(width).toBe(520);
  });

  it('spends the extra width on the canvas rather than on the fixed columns', () => {
    expect(canvasWidth(WIDEST)).toBeGreaterThan(canvasWidth(NARROWEST));
    expect(canvasWidth(WIDEST) - canvasWidth(NARROWEST)).toBe(
      Math.min(WIDEST, maxColumn) - NARROWEST,
    );
  });

  it('sets no non-zero min-width anywhere in the hero, which is what lets it yield', () => {
    const offences: string[] = [];
    for (const [path, rules] of [
      [GRAPH_CSS, GRAPH_RULES],
      [NODE_CSS, NODE_RULES],
      [PANEL_CSS, PANEL_RULES],
    ] as const) {
      for (const rule of rules) {
        for (const entry of rule.declarations) {
          if (entry.property.toLowerCase() !== 'min-width') continue;
          const value = normaliseCssValue(entry.value);
          if (value !== '0') {
            offences.push(`${path}:${entry.line}  ${rule.prelude} { min-width: ${value} }`);
          }
        }
      }
    }
    expect(
      offences,
      `a non-zero min-width on a grid child is how horizontal overflow arrives without ` +
        `anyone writing a width (R10.8):\n${offences.join('\n')}`,
    ).toEqual([]);
  });
});

/* ──────────────── the node footprint is the one lib/layout.ts reserves ─────────── */

describe('the painted node is exactly the row the layout reserved for it (§10.3)', () => {
  it('is 320×76, in border-box, so content cannot re-flow the lanes', () => {
    expect(lengthPx(declaration(NODE_RULES, '.promise-node', 'width'))).toBe(NODE_W);
    expect(lengthPx(declaration(NODE_RULES, '.promise-node', 'height'))).toBe(NODE_H);
    expect(NODE_W).toBe(320);
    expect(NODE_H).toBe(76);
    expect(
      declaration(NODE_RULES, '.promise-node', 'box-sizing'),
      'a content-box node grows by its padding and stops being 76px tall',
    ).toBe('border-box');
  });

  it('leaves a real gutter between two stacked rows', () => {
    expect(
      ROW_H - NODE_H,
      `ROW_H ${ROW_H} and a ${NODE_H}px node leave ${ROW_H - NODE_H}px between rows; a ` +
        `lane of touching boxes is a column, not a lane`,
    ).toBeGreaterThanOrEqual(8);
  });

  it('clamps the claim to two lines and keeps the other three rows unclamped (§10.7)', () => {
    expect(declaration(NODE_RULES, '.promise-node__claim', 'line-clamp')).toBe('2');
    expect(declaration(NODE_RULES, '.promise-node__claim', '-webkit-line-clamp')).toBe('2');
    for (const prelude of ['.promise-node__id', '.promise-node__citation']) {
      expect(
        declaration(NODE_RULES, prelude, 'white-space'),
        `${prelude} is an identifier a judge checks; a wrapped hash is worse than none`,
      ).toBe('nowrap');
    }
  });

  it('carries the verdict on a 3px left edge, and only as an edge (§10.4.3)', () => {
    expect(declaration(NODE_RULES, '.promise-node', 'border-left')).toBe('3px solid transparent');
    const washes = NODE_RULES.filter((rule) => rule.prelude.startsWith('.promise-node[data-verdict='));
    expect(washes, 'no verdict wash rule exists at all').toHaveLength(4);
    for (const rule of washes) {
      expect(
        rule.declarations.map((entry) => entry.property),
        `${rule.prelude} declares more than the edge; a rule that sets a wash and a ` +
          `colour together puts text on a wash`,
      ).toEqual(['border-left-color']);
    }
  });
});
