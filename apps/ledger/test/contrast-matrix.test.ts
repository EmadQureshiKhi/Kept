/**
 * Visual enforcement 1 of 3 — the contrast matrix over the whole ink ramp.
 * Design §10.4.2, R10.6, and the measurement Property 22 (task 9.5) builds on.
 *
 * The design document does not claim its ratios, it tabulates them. This suite
 * recomputes that table from `lib/tokens.ts` — the same literals the browser
 * resolves, held there by the parity test — and compares every cell. Two things
 * follow, and both are the point:
 *
 *   - A palette edit that lowered a ratio fails here rather than shipping. The
 *     floor is not "the design says 4.5"; it is "the measured minimum anywhere in
 *     this matrix is 4.89:1, produced by `--text-200` on `--ink-150`". Move a hex
 *     one step darker and this suite names the cell.
 *   - `--ink-150` is the hover and selected-node fill, so measuring the full
 *     cross product rather than the resting surface alone is what proves an
 *     interaction cannot drop a pair below threshold.
 *
 * Non-text pairs are excluded from the text floors *by construction*, not by
 * exception: `--hairline` at 1.32:1 and `--hairline-strong` at 1.50:1 are 1px
 * rules and `--focus` is a 2px ring. Their ratios are still pinned below, and a
 * separate assertion checks none of them is ever handed to a `color` declaration.
 */

import { describe, expect, it } from 'vitest';

import {
  CONTRAST_FLOORS,
  CONTRAST_PAIRS,
  INK_SURFACES,
  TOKENS,
  contrastRatio,
  pairRatio,
  type ContrastPair,
  type TokenName,
} from '../lib/tokens.js';
import { STYLE_EXTENSIONS, parseCss, scanLedger } from './_scan.js';

/** The measured minimum anywhere in the matrix, from design §10.4.2. */
const MATRIX_MINIMUM = 4.89;

/** The two pairs that produce it — `--text-200` and `--verdict-undesigned` share a hex. */
const MINIMUM_PAIRS = ['--text-200 on --ink-150', '--verdict-undesigned on --ink-150'] as const;

const key = (pair: Pick<ContrastPair, 'fg' | 'bg'>): string => `${pair.fg} on ${pair.bg}`;

/**
 * Design §10.4.2, transcribed cell by cell. Every entry in `CONTRAST_PAIRS` must
 * appear here and vice versa, so a new pair cannot join the matrix without a
 * measured expectation being written down beside it.
 */
const EXPECTED: Readonly<Record<string, number>> = {
  /* text ramp on all four ink surfaces */
  '--text-000 on --ink-000': 16.03,
  '--text-000 on --ink-050': 15.16,
  '--text-000 on --ink-100': 14.2,
  '--text-000 on --ink-150': 13.02,
  '--text-100 on --ink-000': 8.44,
  '--text-100 on --ink-050': 7.97,
  '--text-100 on --ink-100': 7.47,
  '--text-100 on --ink-150': 6.85,
  '--text-200 on --ink-000': 6.02,
  '--text-200 on --ink-050': 5.69,
  '--text-200 on --ink-100': 5.33,
  '--text-200 on --ink-150': 4.89,

  /* verdict hues as tag text on the page and the panel base */
  '--verdict-proven on --ink-000': 7.98,
  '--verdict-proven on --ink-050': 7.54,
  '--verdict-stale on --ink-000': 8.46,
  '--verdict-stale on --ink-050': 8.0,
  '--verdict-red on --ink-000': 6.17,
  '--verdict-red on --ink-050': 5.83,
  '--verdict-undesigned on --ink-000': 6.02,
  '--verdict-undesigned on --ink-050': 5.69,

  /* the same hues as graph node labels, at rest and hovered / selected */
  '--verdict-proven on --ink-100': 7.06,
  '--verdict-proven on --ink-150': 6.48,
  '--verdict-stale on --ink-100': 7.49,
  '--verdict-stale on --ink-150': 6.87,
  '--verdict-red on --ink-100': 5.46,
  '--verdict-red on --ink-150': 5.01,
  '--verdict-undesigned on --ink-100': 5.33,
  '--verdict-undesigned on --ink-150': 4.89,

  /* badge inversion (§10.11): ink on a verdict fill */
  '--ink-000 on --verdict-proven': 7.98,
  '--ink-000 on --verdict-stale': 8.46,
  '--ink-000 on --verdict-red': 6.17,
  '--ink-000 on --verdict-undesigned': 6.02,

  /* non-text: the focus ring and the two rules */
  '--focus on --ink-000': 7.2,
  '--focus on --ink-050': 6.8,
  '--focus on --ink-100': 6.37,
  '--focus on --ink-150': 5.85,
  '--hairline on --ink-000': 1.32,
  '--hairline-strong on --ink-000': 1.5,
};

const round = (ratio: number): number => Math.round(ratio * 100) / 100;

const JUDGED = CONTRAST_PAIRS.filter((pair) => pair.role !== 'non-text');
const NON_TEXT = CONTRAST_PAIRS.filter((pair) => pair.role === 'non-text');

describe('visual enforcement 1 of 3 — the matrix is not a no-op', () => {
  it('has pairs, and every pair has a transcribed expectation', () => {
    expect(CONTRAST_PAIRS.length).toBeGreaterThan(0);
    expect(JUDGED.length).toBeGreaterThan(0);
    expect(NON_TEXT.length).toBeGreaterThan(0);

    const measured = CONTRAST_PAIRS.map(key).sort();
    expect(new Set(measured).size, 'a pair is listed twice').toBe(measured.length);
    expect(measured).toEqual(Object.keys(EXPECTED).sort());
  });

  it('measures every ink surface, so no interaction state goes unchecked', () => {
    for (const surface of INK_SURFACES) {
      expect(
        JUDGED.some((pair) => pair.bg === surface),
        `${surface} carries no judged text pair — a surface nobody measured`,
      ).toBe(true);
    }
  });

  it('computes WCAG ratios the WCAG way', () => {
    expect(round(contrastRatio('#FFFFFF', '#000000'))).toBe(21);
    expect(round(contrastRatio('#000000', '#FFFFFF'))).toBe(21);
    expect(round(contrastRatio('#14120F', '#14120F'))).toBe(1);
    expect(round(contrastRatio('#fff', '#FFFFFF'))).toBe(1);
  });
});

describe('visual enforcement 1 of 3 — contrast over the whole ramp', () => {
  it('reproduces design §10.4.2 cell for cell', () => {
    const drift: string[] = [];
    for (const pair of CONTRAST_PAIRS) {
      const name = key(pair);
      const expected = EXPECTED[name];
      const measured = round(pairRatio(pair));
      if (expected !== measured) {
        drift.push(`${name}: design says ${expected?.toFixed(2)}, tokens measure ${measured.toFixed(2)}`);
      }
    }
    expect(
      drift,
      drift.length === 0
        ? ''
        : `The palette no longer measures what design §10.4.2 tabulates. Either the ` +
          `tokens moved or the table is stale — reconcile both, do not delete the ` +
          `row.\n${drift.join('\n')}`,
    ).toEqual([]);
  });

  it('clears 4.5:1 for body text on every surface', () => {
    const failures: string[] = [];
    for (const pair of CONTRAST_PAIRS) {
      if (pair.role !== 'body') continue;
      const ratio = pairRatio(pair);
      if (ratio < CONTRAST_FLOORS.body) {
        failures.push(`${key(pair)}: ${ratio.toFixed(2)}:1 is below ${CONTRAST_FLOORS.body}:1`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('clears 3:1 for graph node labels on the node and the selected node', () => {
    const failures: string[] = [];
    for (const pair of CONTRAST_PAIRS) {
      if (pair.role !== 'node-label') continue;
      const ratio = pairRatio(pair);
      if (ratio < CONTRAST_FLOORS['node-label']) {
        failures.push(
          `${key(pair)}: ${ratio.toFixed(2)}:1 is below ${CONTRAST_FLOORS['node-label']}:1`,
        );
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('has 4.89:1 as its lowest measured ratio, from --text-200 on --ink-150', () => {
    const ratios = JUDGED.map((pair) => ({ name: key(pair), ratio: round(pairRatio(pair)) }));
    const lowest = Math.min(...ratios.map((entry) => entry.ratio));

    expect(
      lowest,
      `The matrix minimum moved to ${lowest.toFixed(2)}:1. Design §10.4.2 fixes it at ` +
        `${MATRIX_MINIMUM}:1; a lower value means the palette lost its margin over the ` +
        `4.5:1 body floor, a higher one means the table needs updating with the reason.`,
    ).toBe(MATRIX_MINIMUM);

    expect(
      ratios
        .filter((entry) => entry.ratio === lowest)
        .map((entry) => entry.name)
        .sort(),
    ).toEqual([...MINIMUM_PAIRS]);

    /* and it still clears the floor it is measured against */
    expect(lowest).toBeGreaterThan(CONTRAST_FLOORS.body);
  });

  it('passes the badge inversion in both directions', () => {
    const verdicts = [
      '--verdict-proven',
      '--verdict-stale',
      '--verdict-red',
      '--verdict-undesigned',
    ] as const satisfies readonly TokenName[];

    for (const verdict of verdicts) {
      const inverted = contrastRatio(TOKENS['--ink-000'], TOKENS[verdict]);
      const upright = contrastRatio(TOKENS[verdict], TOKENS['--ink-000']);
      expect(round(inverted)).toBe(round(upright));
      expect(inverted).toBeGreaterThanOrEqual(CONTRAST_FLOORS.body);
    }
  });
});

describe('visual enforcement 1 of 3 — non-text pairs are excluded by construction', () => {
  it('pins the hairline and focus ratios design §10.4.2 names', () => {
    expect(round(pairRatio({ fg: '--hairline', bg: '--ink-000', role: 'non-text' }))).toBe(1.32);
    expect(round(pairRatio({ fg: '--hairline-strong', bg: '--ink-000', role: 'non-text' }))).toBe(1.5);
    for (const pair of NON_TEXT) {
      if (!pair.fg.startsWith('--hairline')) continue;
      expect(pairRatio(pair)).toBeLessThan(CONTRAST_FLOORS['node-label']);
    }
  });

  it('classifies every structural token as non-text and no text token as non-text', () => {
    for (const pair of CONTRAST_PAIRS) {
      const structural = pair.fg.startsWith('--hairline') || pair.fg === '--focus';
      expect(pair.role === 'non-text', `${key(pair)} is misclassified`).toBe(structural);
    }
  });

  /**
   * The cross-check design §10.4.4 asks for, in the form available before a
   * component exists: a non-text token must never reach a `color` declaration in
   * any Ledger stylesheet. Task 8.4 carries the same question for the `--wash-*`
   * tokens across the component tree.
   */
  it('never hands a non-text token to a color declaration', () => {
    const structural = new Set(NON_TEXT.map((pair) => pair.fg));
    expect(structural.size).toBeGreaterThan(0);

    const offences: string[] = [];
    const stylesheets = scanLedger(STYLE_EXTENSIONS);
    expect(stylesheets.length).toBeGreaterThan(0);

    for (const file of stylesheets) {
      for (const rule of parseCss(file.text)) {
        for (const declaration of rule.declarations) {
          if (declaration.property !== 'color') continue;
          for (const token of structural) {
            if (declaration.value.includes(token)) {
              offences.push(
                `${file.path}:${declaration.line}  ${rule.prelude} { color: ${declaration.value} } ` +
                  `— ${token} is a rule or a ring, never text`,
              );
            }
          }
        }
      }
    }
    expect(offences, offences.join('\n')).toEqual([]);
  });
});
