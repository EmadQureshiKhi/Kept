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
 *     this matrix is 4.98:1, produced by `--verdict-proven` on `--ink-050`". Move a
 *     hex one step lighter and this suite names the cell.
 *   - `--ink-150` is the hover and selected-node fill, so measuring the full
 *     cross product rather than the resting surface alone is what proves an
 *     interaction cannot drop a pair below threshold.
 *
 * The palette is paper and ink, so the ramp's worst case moved: `--ink-050` is the
 * recessed surface and therefore the darkest of the four, which makes it — not
 * `--ink-150` — the cell where dark type has least room. Deep patina on that recess
 * is the whole matrix's tightest pair at 4.98:1, and every judged cell above it
 * clears its floor with margin.
 *
 * Non-text pairs are excluded from the text floors *by construction*, not by
 * exception: `--hairline` at 1.49:1 and `--hairline-strong` at 2.12:1 are 1px
 * rules and `--focus` is a 3px ring. Their ratios are still pinned below, and a
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
const MATRIX_MINIMUM = 4.98;

/**
 * The pair that produces it: deep patina on the recessed surface, the darkest of the
 * four papers. `--text-200` and `--verdict-undesigned` still share a hex and so still
 * tie with each other, but they tie at 6.03:1 on the same recess — comfortably above
 * this floor rather than at it.
 */
const MINIMUM_PAIRS = ['--verdict-proven on --ink-050'] as const;

const key = (pair: Pick<ContrastPair, 'fg' | 'bg'>): string => `${pair.fg} on ${pair.bg}`;

/**
 * Design §10.4.2, transcribed cell by cell. Every entry in `CONTRAST_PAIRS` must
 * appear here and vice versa, so a new pair cannot join the matrix without a
 * measured expectation being written down beside it.
 */
const EXPECTED: Readonly<Record<string, number>> = {
  /* text ramp on all four paper surfaces */
  '--text-000 on --ink-000': 17.72,
  '--text-000 on --ink-050': 16.01,
  '--text-000 on --ink-100': 19.15,
  '--text-000 on --ink-150': 19.68,
  '--text-100 on --ink-000': 10.17,
  '--text-100 on --ink-050': 9.19,
  '--text-100 on --ink-100': 10.99,
  '--text-100 on --ink-150': 11.3,
  '--text-200 on --ink-000': 6.67,
  '--text-200 on --ink-050': 6.03,
  '--text-200 on --ink-100': 7.21,
  '--text-200 on --ink-150': 7.41,

  /* verdict hues as tag text on the page and the recessed panel base */
  '--verdict-proven on --ink-000': 5.51,
  '--verdict-proven on --ink-050': 4.98,
  '--verdict-stale on --ink-000': 6.47,
  '--verdict-stale on --ink-050': 5.85,
  '--verdict-red on --ink-000': 5.74,
  '--verdict-red on --ink-050': 5.19,
  '--verdict-undesigned on --ink-000': 6.67,
  '--verdict-undesigned on --ink-050': 6.03,

  /* the same hues as graph node labels, at rest and hovered / selected */
  '--verdict-proven on --ink-100': 5.96,
  '--verdict-proven on --ink-150': 6.12,
  '--verdict-stale on --ink-100': 6.99,
  '--verdict-stale on --ink-150': 7.19,
  '--verdict-red on --ink-100': 6.2,
  '--verdict-red on --ink-150': 6.38,
  '--verdict-undesigned on --ink-100': 7.21,
  '--verdict-undesigned on --ink-150': 7.41,

  /* badge inversion (§10.11): the page surface as type on a verdict fill */
  '--ink-000 on --verdict-proven': 5.51,
  '--ink-000 on --verdict-stale': 6.47,
  '--ink-000 on --verdict-red': 5.74,
  '--ink-000 on --verdict-undesigned': 6.67,

  /* non-text: the focus ring and the two rules */
  '--focus on --ink-000': 17.72,
  '--focus on --ink-050': 16.01,
  '--focus on --ink-100': 19.15,
  '--focus on --ink-150': 19.68,
  '--hairline on --ink-000': 1.49,
  '--hairline-strong on --ink-000': 2.12,
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
    expect(round(contrastRatio('#0B0B0B', '#0B0B0B'))).toBe(1);
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

  it('has 4.98:1 as its lowest measured ratio, from --verdict-proven on --ink-050', () => {
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
    expect(round(pairRatio({ fg: '--hairline', bg: '--ink-000', role: 'non-text' }))).toBe(1.49);
    expect(round(pairRatio({ fg: '--hairline-strong', bg: '--ink-000', role: 'non-text' }))).toBe(2.12);
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
