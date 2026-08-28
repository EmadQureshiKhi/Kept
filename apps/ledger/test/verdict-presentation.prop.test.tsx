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
 * stylesheets the browser actually loads and requires each derived pair to clear the
 * floors *and* to be present in the declared list. So the matrix proves the declared
 * pairs are safe, and this proves the used pairs are declared. Neither subsumes the
 * other, and a component that reached for an unmeasured colour fails here.
 *
 * ── How the pairs are derived, and why it is not a cross product ──────────────
 *
 * This derivation used to collect every `background-color` in the tree into one set
 * and every `color` into another, then measure the cross product of the two. That is
 * wrong in a way worth recording, because it is the shape of mistake a scan is prone
 * to: it measures combinations no element renders.
 *
 * The neubrutalist link hover is what exposed it. `a:hover` inverts — ink becomes the
 * fill and paper becomes the text — so `--text-000` entered the fill set and
 * `--ink-000` entered the foreground set, and the cross product duly manufactured
 * `--ink-000` on `--ink-000` at 1.00:1 and failed. No element has ever rendered that.
 * Paper text exists *because* the fill under it is ink; the two arrived together and
 * the derivation split them apart.
 *
 * So pairs are collected **co-occurring**, per rule:
 *
 *   - a rule that sets both `background-color` and `color` contributes the pairs its
 *     own two declarations make. That is an element's rendered state, read off the
 *     stylesheet;
 *   - a rule that sets only `color` sits on whatever paper an ancestor painted. The
 *     four `--ink-*` surfaces are the whole of what that can be — the shell paints
 *     `--ink-000`, the three surface classes paint the other three — so its
 *     foreground is measured against all four, which is strictly the worst case;
 *   - a rule that sets only `background-color` contributes no pair, because it
 *     carries no text. It is still recorded, because *which* fills exist is its own
 *     rule (below).
 *
 * The floors do not move: `CONTRAST_FLOORS.body` is 4.5 and `node-label` is 3. What
 * changed is that the space measured against them is now made of pairs that exist.
 * The meta-tests below plant a genuine low-contrast co-occurring pair and a genuine
 * illegitimate fill and prove the derivation still catches both, and one of them
 * pins the old bug directly: an inverted fill in one rule and a dark foreground in
 * another must not be paired with each other.
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
import type { Verdict } from 'kept-core';
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
 * The list is short on purpose: colour is the verdict channel (§10.4.3), so an entry
 * appearing here is a design decision, not a refactor.
 *
 * The third entry was added by task 14.6, and it records a decision the design had
 * already made rather than widening the rule to fit a component. §10.9 names these two
 * tokens for this use in so many words — "`--verdict-red` for deletions,
 * `--verdict-proven` for additions" — and `lib/tokens.ts` has carried
 * `--verdict-red on --ink-050` as a measured **body** pair labelled *diff deletions*
 * since the palette was written, which is the well's own fill. So no pair enters the
 * matrix that was not already measured, and the two floors were already cleared.
 *
 * What makes it admissible rather than merely specified is that the diff keeps both
 * halves of §10.4.3's bargain. The hue is on `.diff-text` and `.diff-marker`; the
 * `--wash-*` is on `.diff-row`'s 3px left border, in rules that declare no `color` at
 * all — so a wash still contributes no foreground/background pair and the matrix stays
 * finite. And colour is still not the only channel: the marker glyph is rendered text
 * and each row's accessible name says `removed`, `added` or `unchanged`, which is what
 * the presentation clause below actually asserts.
 */
const VERDICT_CONSUMERS: readonly { readonly match: string; readonly because: string }[] = [
  { match: '[data-verdict=', because: 'VerdictTag — the hue beside the word (R10.5)' },
  {
    match: '.freshness-value--stale',
    because: 'the freshness chip over 24 hours — the ochre R9.7 requires (§10.4.2)',
  },
  {
    match: '[data-diff=',
    because:
      'DiffView — clay deletions and patina additions, named by §10.9 and measured in ' +
      "lib/tokens.ts as the 'diff deletions' body pair on --ink-050",
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

/* ── the co-occurrence derivation ───────────────────────────────────────────── */

/**
 * Where a pair's background came from.
 *
 * - `declared`  — the rule painted it. The fill and the foreground are two
 *                 declarations of one rule, so the pair is a state an element renders.
 * - `inherited` — the rule set only `color`, so its element sits on paper an ancestor
 *                 painted. Measured against all four `--ink-*` surfaces, which is the
 *                 whole of what an ancestor can have painted and therefore the worst
 *                 case rather than a guess.
 */
type FillOrigin = 'declared' | 'inherited';

interface CoOccurringPair {
  readonly fg: TokenName;
  readonly bg: TokenName;
  readonly origin: FillOrigin;
  /** `path:line  selector`, so a failure names the rule rather than two tokens. */
  readonly where: string;
}

interface DerivedFill {
  readonly token: TokenName;
  /** `true` when the same rule also sets a `color`, so the fill chose its own text. */
  readonly carriesText: boolean;
  readonly where: string;
}

interface Derivation {
  /** Every rule read, at-rules included — the denominator of the no-op guard. */
  readonly rules: number;
  readonly pairs: readonly CoOccurringPair[];
  readonly fills: readonly DerivedFill[];
}

/**
 * Derives the co-occurring pair space from a set of stylesheets.
 *
 * Written over an argument rather than over the module-scope scan so the meta-tests
 * can hand it a planted stylesheet and check what it does with one. A derivation only
 * provable against the tree it happens to read is a derivation nobody can check.
 */
function derive(
  files: readonly { readonly path: string; readonly text: string }[],
): Derivation {
  const pairs: CoOccurringPair[] = [];
  const fills: DerivedFill[] = [];
  let rules = 0;

  for (const file of files) {
    for (const rule of parseCss(file.text)) {
      rules += 1;
      const where = (line: number): string => `${file.path}:${line}  ${rule.prelude}`;
      const tokensFor = (property: string): { token: TokenName; line: number }[] =>
        rule.declarations
          .filter((declaration) => declaration.property.toLowerCase() === property)
          .flatMap((declaration) => {
            const token = soleToken(normaliseCssValue(declaration.value));
            return token !== null && token in TOKENS
              ? [{ token: token as TokenName, line: declaration.line }]
              : [];
          });

      const ruleFills = tokensFor('background-color');
      const foregrounds = tokensFor('color');

      for (const fill of ruleFills) {
        fills.push({
          token: fill.token,
          carriesText: foregrounds.length > 0,
          where: where(fill.line),
        });
      }

      for (const foreground of foregrounds) {
        const backgrounds: readonly TokenName[] =
          ruleFills.length > 0 ? ruleFills.map((fill) => fill.token) : INK_SURFACES;
        const origin: FillOrigin = ruleFills.length > 0 ? 'declared' : 'inherited';
        for (const background of backgrounds) {
          pairs.push({
            fg: foreground.token,
            bg: background,
            origin,
            where: where(foreground.line),
          });
        }
      }
    }
  }

  return { rules, pairs, fills };
}

/**
 * Throws unless the derivation actually derived something.
 *
 * Both halves matter and they fail differently. Zero rules means the tree moved or the
 * parser broke; zero pairs means the stylesheets stopped colouring text, which is not a
 * thing that happens quietly. Either way every assertion downstream would quantify over
 * an empty set and pass, which is the one outcome a guard must not have.
 */
function assertProductive(derivation: Derivation, what: string): Derivation {
  if (derivation.rules === 0) {
    throw new Error(`${what}: no CSS rule was parsed — a zero-rule derivation is a no-op guard.`);
  }
  if (derivation.pairs.length === 0) {
    throw new Error(
      `${what}: no co-occurring foreground/background pair was derived — a zero-pair ` +
        `derivation is a no-op guard, and every floor below would hold vacuously.`,
    );
  }
  return derivation;
}

const DERIVED = assertProductive(derive(STYLESHEETS), 'the Ledger stylesheets');

/** Every pair an element renders, per the rules above. */
const DERIVED_PAIRS: readonly CoOccurringPair[] = Object.freeze(DERIVED.pairs);

function sortedTokens(tokens: readonly TokenName[]): readonly TokenName[] {
  const unique = [...new Set(tokens)];
  unique.sort();
  return Object.freeze(unique);
}

const USED_FOREGROUNDS: readonly TokenName[] = sortedTokens(
  DERIVED_PAIRS.map((pair) => pair.fg),
);

/** Every background a rule actually paints — the inherited surfaces are not fills. */
const USED_FILLS: readonly TokenName[] = sortedTokens(DERIVED.fills.map((fill) => fill.token));

/**
 * The fills that are not paper, and the reason the exception exists.
 *
 * §10.7's link hover inverts: ink becomes the fill and paper becomes the text. That is
 * a legitimate fill and the four-surface rule this replaced could not admit it — but
 * "not one of the four surfaces" is still a violation for everything else, so the
 * exception is a list of one rather than a widening. A verdict hue as a fill, a
 * hairline as a fill or a wash as a fill all still fail, and an inversion that forgot
 * to invert its text fails too: an ink fill with no `color` beside it inherits dark
 * text onto dark paper, which is the exact failure the clause exists to catch.
 */
const INVERSION_FILLS: readonly TokenName[] = Object.freeze(['--text-000']);

const PERMITTED_FILLS: ReadonlySet<TokenName> = new Set([...INK_SURFACES, ...INVERSION_FILLS]);

function ratioOf(pair: CoOccurringPair): number {
  return contrastRatio(TOKENS[pair.fg], TOKENS[pair.bg]);
}

/** The pairs that fail a floor, formatted for a message rather than counted. */
function belowFloor(
  pairs: readonly CoOccurringPair[],
  floor: number,
): readonly CoOccurringPair[] {
  return pairs.filter((pair) => ratioOf(pair) < floor);
}

function describe22(pair: CoOccurringPair): string {
  return `${pair.where} — ${pair.fg} on ${pair.bg} (${pair.origin}) measures ${ratioOf(
    pair,
  ).toFixed(2)}:1`;
}

const DECLARED_FOREGROUNDS = new Set(CONTRAST_PAIRS.map((pair) => pair.fg));

/* ─────────────────────────────── the generators ─────────────────────────────── */

const arbVerdict = fc.constantFrom(...VERDICTS);
/** The whole elevation ramp: `--ink-150` is the hover and selected fill (§10.4.2). */
const arbSurface = fc.constantFrom(...INK_SURFACES);

/** The real pair space: what a rule paints, or what it inherits. Never a cross product. */
const arbPair = fc.constantFrom(...DERIVED_PAIRS);

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
    expect(FILL_USAGES.length, 'no background-color declaration was found').toBeGreaterThanOrEqual(4);
    expect(DERIVED.rules, 'no CSS rule was parsed').toBeGreaterThan(50);
    expect(DERIVED_PAIRS.length, 'no co-occurring pair was derived').toBeGreaterThan(30);
    expect(USED_FOREGROUNDS.length).toBeGreaterThanOrEqual(6);
    expect(USED_FILLS.length).toBeGreaterThanOrEqual(4);
  });

  it('refuses a zero-rule or zero-pair derivation instead of passing vacuously', () => {
    expect(() => assertProductive(derive([]), 'nothing')).toThrow(/zero-rule/);
    expect(() =>
      assertProductive(derive([{ path: 'planted.css', text: '.a { padding: 0; }' }]), 'no colour'),
    ).toThrow(/zero-pair/);
    /* and the real one is productive, which is what makes the two throws above a guard
       rather than a curiosity */
    expect(() => assertProductive(DERIVED, 'the Ledger stylesheets')).not.toThrow();
  });

  it('pairs a fill with the text of its own rule, not with every colour in the tree', () => {
    /* The regression this derivation replaced, in miniature: an inverted hover state in
       one rule and ordinary dark body text in another. Crossing the two sets produces
       --ink-000 on --ink-000 at 1.00:1, a combination nothing renders. Co-occurrence
       produces the two real pairs and nothing else. */
    const planted = derive([
      {
        path: 'planted.css',
        text:
          'a:hover {\n  background-color: var(--text-000);\n  color: var(--ink-000);\n}\n' +
          '.body-copy {\n  color: var(--text-000);\n}\n',
      },
    ]);

    expect(planted.pairs.filter((pair) => pair.origin === 'declared')).toEqual([
      {
        fg: '--ink-000',
        bg: '--text-000',
        origin: 'declared',
        where: 'planted.css:3  a:hover',
      },
    ]);
    expect(
      planted.pairs.some((pair) => pair.fg === '--ink-000' && pair.bg === '--ink-000'),
      'the inverted foreground was paired with a surface its own rule does not paint',
    ).toBe(false);
    /* the body-copy rule paints nothing, so it is measured against all four surfaces */
    expect(
      planted.pairs.filter((pair) => pair.origin === 'inherited').map((pair) => pair.bg),
    ).toEqual([...INK_SURFACES]);
    expect(belowFloor(planted.pairs, CONTRAST_FLOORS.body)).toEqual([]);
  });

  it('still catches genuine low contrast, on a declared fill and on an inherited one', () => {
    /* Paper on paper: a real co-occurring pair, and unreadable. */
    const declared = derive([
      { path: 'planted.css', text: '.ghost {\n  background-color: var(--ink-150);\n  color: var(--ink-100);\n}\n' },
    ]);
    expect(declared.pairs).toHaveLength(1);
    expect(belowFloor(declared.pairs, CONTRAST_FLOORS.body).map(describe22)).toHaveLength(1);
    expect(ratioOf(declared.pairs[0] as CoOccurringPair)).toBeLessThan(1.1);

    /* And the same colour with no fill of its own: it inherits paper, so at least one of
       the four surfaces catches it. This is the half a per-rule derivation could lose. */
    const inherited = derive([{ path: 'planted.css', text: '.ghost {\n  color: var(--ink-100);\n}\n' }]);
    expect(inherited.pairs).toHaveLength(INK_SURFACES.length);
    expect(
      belowFloor(inherited.pairs, CONTRAST_FLOORS.body).length,
      'near-white text on the paper ramp was not caught',
    ).toBeGreaterThan(0);

    /* The floors themselves are pinned here, so weakening one to make a real failure go
       away breaks this test rather than passing quietly. */
    expect(CONTRAST_FLOORS.body).toBe(4.5);
    expect(CONTRAST_FLOORS['node-label']).toBe(3);
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

  /**
   * The clause that replaced "paints backgrounds only from the four-step ink ramp".
   *
   * That version was true until §10.7's link hover inverted, and then it was simply
   * wrong: ink *is* a fill there, deliberately. It is replaced rather than deleted,
   * because "which fills exist" is a real rule and dropping it would leave a verdict
   * hue free to become a background. Three things are asserted instead of one, and
   * together they bite harder:
   *
   *   1. every fill is one of the four paper surfaces or `--text-000` as an inversion;
   *   2. all four paper surfaces are used, so the ramp is not quietly collapsing;
   *   3. an inversion sets its own `color` in the same rule, and that pair clears the
   *      body floor. An ink fill with no foreground beside it inherits dark text onto
   *      dark paper — the fill is the *reason* the paper text is readable, so the two
   *      are required to arrive together.
   */
  it('fills only from the paper ramp, or with ink as a declared inversion', () => {
    const strays = DERIVED.fills.filter((fill) => !PERMITTED_FILLS.has(fill.token));
    expect(
      strays.map((fill) => `${fill.where} — background-color: var(${fill.token})`),
      `§10.4.3: a background is one of the four paper surfaces, or --text-000 where the ` +
        `interface inverts. A verdict hue, a wash or a hairline as a fill puts text on a ` +
        `surface the matrix never measured:\n${strays.map((fill) => fill.where).join('\n')}`,
    ).toEqual([]);

    for (const surface of INK_SURFACES) {
      expect(USED_FILLS, `${surface} is declared but nothing paints it`).toContain(surface);
    }

    const inversions = DERIVED.fills.filter((fill) => INVERSION_FILLS.includes(fill.token));
    expect(
      inversions.length,
      'no fill inverts, so the exception above is carrying no weight and should go',
    ).toBeGreaterThan(0);
    const silent = inversions.filter((fill) => !fill.carriesText);
    expect(
      silent.map((fill) => fill.where),
      `an ink fill that sets no color of its own inherits dark text onto dark ink. The ` +
        `inversion is only readable because it inverts both halves:\n${silent
          .map((fill) => fill.where)
          .join('\n')}`,
    ).toEqual([]);

    const invertedPairs = DERIVED_PAIRS.filter(
      (pair) => pair.origin === 'declared' && INVERSION_FILLS.includes(pair.bg),
    );
    expect(invertedPairs.length).toBeGreaterThan(0);
    const failing = belowFloor(invertedPairs, CONTRAST_FLOORS.body);
    expect(
      failing.map(describe22),
      `an inverted state is read as body copy like any other, so it clears the same ` +
        `${CONTRAST_FLOORS.body}:1 floor:\n${failing.map(describe22).join('\n')}`,
    ).toEqual([]);
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
  it('clears 4.5:1 for every co-occurring pair the stylesheets produce', () => {
    fc.assert(
      fc.property(arbPair, (pair) => {
        const ratio = ratioOf(pair);
        expect(
          ratio,
          `${describe22(pair)}, below the ${CONTRAST_FLOORS.body}:1 body floor of R10.6`,
        ).toBeGreaterThanOrEqual(CONTRAST_FLOORS.body);
        expect(ratio).toBeGreaterThanOrEqual(CONTRAST_FLOORS['node-label']);
      }),
      { numRuns: NUM_RUNS },
    );

    /* The property samples; this enumerates. Together they are a sampled search with a
       total check behind it, so a pair the generator happened not to draw still fails. */
    const failing = belowFloor(DERIVED_PAIRS, CONTRAST_FLOORS.body);
    expect(failing.map(describe22), failing.map(describe22).join('\n')).toEqual([]);
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

    /* Every surface of the ramp appears as the background of some derived pair — the
       inherited pairs guarantee it, and this is the assertion that they did. A
       derivation that quietly stopped measuring the hover fill would fail here. */
    const backgrounds = new Set(DERIVED_PAIRS.map((pair) => pair.bg));
    for (const surface of INK_SURFACES) {
      expect(backgrounds.has(surface), `nothing was measured against ${surface}`).toBe(true);
    }

    /* the worst cell in the whole derived space, for the record */
    const worst = Math.min(...DERIVED_PAIRS.map(ratioOf));
    expect(Math.round(worst * 100) / 100).toBeGreaterThanOrEqual(CONTRAST_FLOORS.body);
  });
});
