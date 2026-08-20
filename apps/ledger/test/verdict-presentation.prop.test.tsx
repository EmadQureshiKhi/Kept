/**
 * **Property 22 (presentation and contrast clauses): Verdict presentation always
 * pairs colour with a word, at accessible contrast on every surface of the
 * elevation ramp.**
 *
 * **Validates: Requirements 10.2, 10.3, 10.5, 10.6**
 *
 * The property has three clauses. This file owns two of them:
 *
 *   - **presentation** — for any verdict and any surface that renders it, the
 *     verdict's text label is present in the output, the mapped token is the one
 *     specified for that verdict, `undesigned` is the neutral token, and no
 *     non-verdict element uses a verdict token;
 *   - **contrast** — for any foreground/background token pair *actually used*, the
 *     ratio clears 4.5:1 for body text and 3:1 for graph node labels, on every
 *     surface of the elevation ramp.
 *
 * The third clause — that the rendered label, token and computed contrast are
 * identical under every setting of `prefers-reduced-motion` — belongs to task 17.3,
 * which is where `lib/motion.ts` and the orchestrations it gates exist to be
 * compared. It is deliberately absent here rather than stubbed.
 *
 * **How this differs from `contrast-matrix.test.ts`, and why both exist.** That file
 * recomputes the table design §10.4.2 tabulates, cell by cell, from the *declared*
 * pair list in `lib/tokens.ts`. It cannot notice a pair the components use and the
 * list forgot. This file works the other way round: it derives the pairs from the
 * stylesheets the browser actually loads — every `color` declaration crossed with
 * every `background-color` a surface class sets — and requires each derived pair to
 * clear the floors *and* to be present in the declared list. So the matrix proves the
 * declared pairs are safe, and this proves the used pairs are declared. Neither
 * subsumes the other, and a component that reached for an unmeasured colour fails
 * here.
 *
 * The washes are excluded by construction rather than by omission, and that exclusion
 * is checked rather than trusted: no `--wash-*` token may appear in a `color`
 * declaration, so no wash can enter the derived pair space at all.
 *
 * jsdom applies no stylesheet, which is a feature for the presentation clause and a
 * limit for the contrast one. So the two are proven differently and honestly: the
 * label is asserted against the rendered DOM, where a reader with colour taken away
 * sees exactly what these assertions see; the ramp is quantified over arithmetically,
 * against the same literals `tokens.css` hands the browser and the parity test pins.
 */

import { cleanup, render } from '@testing-library/react';
import fc from 'fast-check';
import type { Verdict } from '@kept/core';
import { afterEach, describe, expect, it } from 'vitest';

import { FreshnessChip } from '../components/FreshnessChip.js';
import { VERDICT_TOKENS, VERDICT_WASHES, VerdictTag } from '../components/VerdictTag.js';
import {
  CONTRAST_FLOORS,
  CONTRAST_PAIRS,
  INK_SURFACES,
  TOKENS,
  contrastRatio,
  type TokenName,
} from '../lib/tokens.js';
import {
  STYLE_EXTENSIONS,
  hexToRgba,
  hueFamily,
  normaliseCssValue,
  parseCss,
  scanLedger,
} from './_scan.js';

/** Runs per property. */
const NUM_RUNS = 500;

/**
 * Each run unmounts what it rendered inside the property, so the DOM cannot grow to
 * 500 tags; this is the belt to that brace. The ledger project shares one jsdom
 * instance across its suites (`isolate: false`), so nothing here relies on Testing
 * Library's automatic cleanup, and every query is scoped to its own container.
 */
afterEach(cleanup);

/** The verdict vocabulary, taken from the component's own mapping. */
const VERDICTS: readonly Verdict[] = Object.freeze(
  (Object.keys(VERDICT_TOKENS) as Verdict[]).sort(),
);

/**
 * Selectors permitted to carry a `--verdict-*` token, and the reason each is.
 *
 * The list is short on purpose: colour is the verdict channel (§10.4.3), so a third
 * entry appearing here would be a design decision, not a refactor.
 */
const VERDICT_CONSUMERS: readonly { readonly match: string; readonly because: string }[] = [
  { match: '[data-verdict=', because: 'VerdictTag — the hue beside the word (R10.5)' },
  {
    match: '.freshness-value--stale',
    because: 'the freshness chip over 24 hours — the ochre R9.7 requires (§10.4.2)',
  },
];

/* ─────────────────── the pair space, derived from the stylesheets ────────────── */

const STYLESHEETS = scanLedger(STYLE_EXTENSIONS);

interface Usage {
  readonly path: string;
  readonly line: number;
  readonly selector: string;
  readonly property: string;
  readonly value: string;
}

/** Every declaration in every Ledger stylesheet, with its selector for context. */
const USAGES: readonly Usage[] = STYLESHEETS.flatMap((file) =>
  parseCss(file.text).flatMap((rule) =>
    rule.declarations.map((declaration) => ({
      path: file.path,
      line: declaration.line,
      selector: rule.prelude,
      property: declaration.property.toLowerCase(),
      value: normaliseCssValue(declaration.value),
    })),
  ),
);

/** `--token` when the value is exactly one `var()` reference, else `null`. */
function soleToken(value: string): string | null {
  const match = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
  return match?.[1] ?? null;
}

const COLOUR_USAGES = USAGES.filter((usage) => usage.property === 'color');
const FILL_USAGES = USAGES.filter((usage) => usage.property === 'background-color');

/**
 * Every foreground token the Ledger hands to a `color` declaration.
 *
 * This is the honest definition of "actually used" available to a static scan, and it
 * is the input to the contrast clause below.
 */
function tokensOf(usages: readonly Usage[]): readonly TokenName[] {
  const names = [
    ...new Set(
      usages
        .map((usage) => soleToken(usage.value))
        .filter((token): token is TokenName => token !== null && token in TOKENS),
    ),
  ];
  names.sort();
  return Object.freeze(names);
}

const USED_FOREGROUNDS: readonly TokenName[] = tokensOf(COLOUR_USAGES);

/** Every background a surface class or the shell paints. */
const USED_FILLS: readonly TokenName[] = tokensOf(FILL_USAGES);

const DECLARED_FOREGROUNDS = new Set(CONTRAST_PAIRS.map((pair) => pair.fg));

/* ─────────────────────────────── the generators ─────────────────────────────── */

const arbVerdict = fc.constantFrom(...VERDICTS);
/** The whole elevation ramp: `--ink-150` is the hover and selected fill (§10.4.2). */
const arbSurface = fc.constantFrom(...INK_SURFACES);
const arbForeground = fc.constantFrom(...USED_FOREGROUNDS);

/** Relative-time strings of the shape `lib/relativeTime.ts` produces. */
const arbRelative = fc
  .tuple(fc.integer({ min: 1, max: 90 }), fc.constantFrom('days', 'weeks', 'months'))
  .map(([count, unit]) => `${count} ${unit} ago`);

/* ───────────────────────────────── meta-tests ──────────────────────────────── */

describe('Property 22 — the derivation is not a no-op', () => {
  it('read every stylesheet and found colour on both sides of a pair', () => {
    expect(STYLESHEETS.length).toBeGreaterThanOrEqual(5);
    expect(USAGES.length).toBeGreaterThan(50);
    expect(COLOUR_USAGES.length, 'no color declaration was found at all').toBeGreaterThanOrEqual(8);
    expect(USED_FOREGROUNDS.length).toBeGreaterThanOrEqual(6);
    expect(USED_FILLS.length).toBeGreaterThanOrEqual(4);
  });

  it('derived the four verdict hues among the foregrounds actually used', () => {
    for (const verdict of VERDICTS) {
      expect(
        USED_FOREGROUNDS,
        `${verdict} maps to ${VERDICT_TOKENS[verdict]}, which no stylesheet hands to a ` +
          `color declaration — the presentation clause would prove nothing`,
      ).toContain(VERDICT_TOKENS[verdict]);
    }
  });

  it('resolves every color declaration to exactly one token, and never to a literal', () => {
    const offences = COLOUR_USAGES.filter((usage) => soleToken(usage.value) === null).map(
      (usage) => `${usage.path}:${usage.line}  ${usage.selector} { color: ${usage.value} }`,
    );
    expect(
      offences,
      `a text colour that is not a single token cannot be measured, so it cannot be ` +
        `proven to clear R10.6's floors:\n${offences.join('\n')}`,
    ).toEqual([]);
  });

  it('paints backgrounds only from the four-step ink ramp', () => {
    expect([...USED_FILLS].sort()).toEqual([...INK_SURFACES].sort());
  });
});

/* ───────────────────── clause 1 — colour always carries a word ──────────────── */

describe('Property 22 — presentation: every verdict renders its word beside its hue', () => {
  it('renders the label and the specified token for any verdict on any surface', () => {
    fc.assert(
      fc.property(arbVerdict, arbSurface, (verdict, surface) => {
        const { container, unmount } = render(
          <div data-surface={surface}>
            <VerdictTag verdict={verdict} />
          </div>,
        );
        try {
          const tag = container.querySelector('.verdict-tag');
          expect(tag).not.toBeNull();

          /* the word is in the output — with jsdom applying no stylesheet, this is
             literally the render a reader gets with colour taken away (R10.5) */
          expect(tag?.textContent).toBe(verdict);
          expect(tag?.getAttribute('data-verdict')).toBe(verdict);

          /* the mapped token is the one design §10.4.1 specifies for this verdict */
          const token = VERDICT_TOKENS[verdict];
          expect(token).toBe(`--verdict-${verdict}`);
          expect(TOKENS[token]).toMatch(/^#[0-9A-F]{6}$/);

          /* and the stylesheet gives that token to this verdict's word, not another's */
          const hue = USAGES.find(
            (usage) =>
              usage.property === 'color' &&
              usage.selector.includes(`[data-verdict='${verdict}']`),
          );
          expect(hue?.value).toBe(`var(${token})`);

          /* the wash stays on the box, and never in a rule that carries text */
          const edge = USAGES.find(
            (usage) =>
              usage.property === 'border-color' &&
              usage.selector === `.verdict-tag[data-verdict='${verdict}']`,
          );
          expect(edge?.value).toBe(`var(${VERDICT_WASHES[verdict]})`);

          /* the pair this surface produces clears the body floor, not merely the
             node-label one — the tag is read as text wherever it sits */
          expect(contrastRatio(TOKENS[token], TOKENS[surface])).toBeGreaterThanOrEqual(
            CONTRAST_FLOORS.body,
          );
        } finally {
          unmount();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('renders words beside the ochre when a run is over 24 hours old (R9.7)', () => {
    fc.assert(
      fc.property(arbRelative, arbSurface, (relative, surface) => {
        const { container, unmount } = render(<FreshnessChip relative={relative} tone="stale" />);
        try {
          const value = container.querySelector('.freshness-value--stale');
          expect(value).not.toBeNull();
          expect(
            value?.textContent,
            'the ochre is a second channel; the words say how old the run is',
          ).toBe(relative);
          expect(contrastRatio(TOKENS['--verdict-stale'], TOKENS[surface])).toBeGreaterThanOrEqual(
            CONTRAST_FLOORS.body,
          );
        } finally {
          unmount();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('gives undesigned the neutral token, which measures as no hue at all (R10.3)', () => {
    expect(VERDICT_TOKENS.undesigned).toBe('--verdict-undesigned');
    expect(TOKENS['--verdict-undesigned']).toBe(TOKENS['--text-200']);
    expect(
      hueFamily(hexToRgba(TOKENS['--verdict-undesigned'])),
      'an undesigned promise is a missing test, not a warning about one, so the token ' +
        'sits below the achromatic threshold and belongs to no hue family',
    ).toBeNull();

    const families = (['proven', 'stale', 'red'] as const).map((verdict) =>
      hueFamily(hexToRgba(TOKENS[VERDICT_TOKENS[verdict]])),
    );
    expect(families.every((family) => family !== null)).toBe(true);
    expect(new Set(families).size, 'two verdicts share a hue family').toBe(3);
  });

  it('lets no non-verdict element use a verdict token', () => {
    const offences: string[] = [];
    for (const usage of USAGES) {
      if (!/var\(\s*--verdict-/.test(usage.value)) continue;
      if (usage.property.startsWith('--verdict-')) continue; /* the declaration itself */
      const permitted = VERDICT_CONSUMERS.some((consumer) =>
        usage.selector.includes(consumer.match),
      );
      if (!permitted) {
        offences.push(
          `${usage.path}:${usage.line}  ${usage.selector} { ${usage.property}: ${usage.value} }`,
        );
      }
    }
    expect(
      offences,
      `colour is the verdict channel (§10.4.3): no brand colour, no coloured button, no ` +
        `gradient hero. The permitted consumers are:\n` +
        VERDICT_CONSUMERS.map((consumer) => `  ${consumer.match} — ${consumer.because}`).join('\n') +
        `\n${offences.join('\n')}`,
    ).toEqual([]);
  });
});

/* ──────────────── clause 2 — every used pair clears its floor ───────────────── */

describe('Property 22 — contrast: every pair actually used, on every surface', () => {
  it('clears 4.5:1 for any used foreground on any surface of the ramp', () => {
    fc.assert(
      fc.property(arbForeground, arbSurface, (foreground, surface) => {
        const ratio = contrastRatio(TOKENS[foreground], TOKENS[surface]);
        expect(
          ratio,
          `${foreground} on ${surface} measures ${ratio.toFixed(2)}:1, below the ` +
            `${CONTRAST_FLOORS.body}:1 body floor of R10.6`,
        ).toBeGreaterThanOrEqual(CONTRAST_FLOORS.body);
        expect(ratio).toBeGreaterThanOrEqual(CONTRAST_FLOORS['node-label']);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('declares every used foreground in the measured matrix', () => {
    const undeclared = USED_FOREGROUNDS.filter((token) => !DECLARED_FOREGROUNDS.has(token));
    expect(
      undeclared,
      `these tokens colour text but appear in no CONTRAST_PAIRS entry, so ` +
        `contrast-matrix.test.ts never measured them:\n${undeclared.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps the washes and the structural tokens out of the pair space entirely', () => {
    const excluded = USED_FOREGROUNDS.filter(
      (token) =>
        token.startsWith('--wash-') || token.startsWith('--hairline') || token === '--focus',
    );
    expect(
      excluded,
      `§10.4.3: a wash is an edge, a trough or a 1px border; --hairline is a rule and ` +
        `--focus is a ring. None of them carries text, which is what keeps the matrix ` +
        `finite:\n${excluded.join('\n')}`,
    ).toEqual([]);
  });

  it('proves the ramp was crossed, not just the page surface', () => {
    expect(INK_SURFACES).toHaveLength(4);
    expect([...INK_SURFACES]).toContain('--ink-150');
    /* the worst cell in the whole derived space, for the record */
    const worst = Math.min(
      ...USED_FOREGROUNDS.flatMap((foreground) =>
        INK_SURFACES.map((surface) => contrastRatio(TOKENS[foreground], TOKENS[surface])),
      ),
    );
    expect(Math.round(worst * 100) / 100).toBeGreaterThanOrEqual(CONTRAST_FLOORS.body);
  });
});
