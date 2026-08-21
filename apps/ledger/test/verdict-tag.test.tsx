/**
 * `VerdictTag`, asserted — design §10.4.3, §10.7, R10.2, R10.3, R10.5.
 *
 * Two halves, because the component's promise has two halves.
 *
 * The **rendered** half: every verdict renders its word as text, in a box carrying
 * that verdict as data. jsdom applies none of the stylesheet, which makes these
 * assertions exactly the right shape — what they see is what a reader sees with
 * colour taken away, and R10.5 is the requirement that colour is never the only
 * channel.
 *
 * The **authored** half: the stylesheet keeps the wash on the box and the hue on the
 * word, in rules that never mix. `test/typography-discipline.test.ts` fails on a rule
 * declaring a wash *and* a `color`; this file asserts the stronger, positive form —
 * each verdict has exactly one edge rule and exactly one hue rule, each carrying one
 * declaration, and each naming the token for its own verdict rather than a
 * neighbour's. Cross-wiring proven's hue to red's wash would pass every scan in the
 * repository and would still be wrong.
 *
 * Property 22's presentation and contrast clauses live in
 * `verdict-presentation.prop.test.tsx`; the mapping is proven there over every
 * surface of the elevation ramp. Here it is proven to exist and to be one-to-one.
 */

import { cleanup, render } from '@testing-library/react';
import type { Verdict } from '@kept/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  VERDICT_RANK,
  VERDICT_TOKENS,
  VERDICT_WASHES,
  VerdictTag,
} from '../components/VerdictTag.js';
import { TOKENS } from '../lib/tokens.js';
import { STYLE_EXTENSIONS, normaliseCssValue, parseCss, scanLedger, type CssRule } from './_scan.js';

const VERDICT_TAG_CSS = 'apps/ledger/styles/verdict-tag.css';

/**
 * Unmount after every case. The ledger project shares one jsdom instance across its
 * suites (`isolate: false`), so Testing Library's automatic cleanup fires only for
 * whichever suite imported it first; every query below is container-scoped for the
 * same reason.
 */
afterEach(cleanup);

/** The vocabulary, from the mapping itself, so a fifth verdict cannot be forgotten. */
const VERDICTS: readonly Verdict[] = Object.freeze(
  (Object.keys(VERDICT_TOKENS) as Verdict[]).sort(),
);

const RULES: readonly CssRule[] = (() => {
  const found = scanLedger(STYLE_EXTENSIONS).find((file) => file.path === VERDICT_TAG_CSS);
  if (found === undefined) {
    throw new Error(
      `${VERDICT_TAG_CSS} was not found. The assertions below would parse zero rules and ` +
        `pass, so a renamed stylesheet fails loudly instead.`,
    );
  }
  return parseCss(found.text);
})();

/** Every rule whose prelude is exactly `selector`, whitespace-normalised. */
function rulesFor(selector: string): CssRule[] {
  return RULES.filter((rule) => rule.prelude === selector);
}

function declarationsOf(rule: CssRule): Map<string, string> {
  return new Map(
    rule.declarations.map((declaration) => [
      declaration.property.toLowerCase(),
      normaliseCssValue(declaration.value),
    ]),
  );
}

describe('VerdictTag — the word is always rendered, colour or no colour', () => {
  it('renders exactly the four verdict words, and nothing decorative', () => {
    expect([...VERDICTS]).toEqual(['proven', 'red', 'stale', 'undesigned']);

    for (const verdict of VERDICTS) {
      const { container, unmount } = render(<VerdictTag verdict={verdict} />);
      const tag = container.firstElementChild;
      expect(tag, `no element rendered for ${verdict}`).not.toBeNull();
      expect(
        tag?.textContent,
        `R10.5: the tag's text is the verdict itself, so data and label cannot drift`,
      ).toBe(verdict);
      unmount();
    }
  });

  it('carries the verdict as data, and the word in a child of its own', () => {
    const { container } = render(<VerdictTag verdict="red" />);
    const tag = container.querySelector('.verdict-tag');
    expect(tag).not.toBeNull();
    expect(tag?.getAttribute('data-verdict')).toBe('red');

    const word = tag?.querySelector('.verdict-tag__word');
    expect(
      word,
      `the hue belongs to the word and the wash to the box; one element could not ` +
        `carry both without a rule that mixes them`,
    ).not.toBeNull();
    expect(word?.textContent).toBe('red');
    expect(word?.parentElement).toBe(tag);
  });

  it('composes a caller class onto the box without dropping its own', () => {
    const { container } = render(<VerdictTag className="promise-node__verdict" verdict="proven" />);
    const tag = container.firstElementChild;
    expect(tag?.classList.contains('verdict-tag')).toBe(true);
    expect(tag?.classList.contains('promise-node__verdict')).toBe(true);
  });

  it('ranks red first, so the layout of §10.3 sorts what needs attention to the top', () => {
    expect([...VERDICT_RANK]).toEqual(['red', 'stale', 'undesigned', 'proven']);
    expect([...VERDICT_RANK].sort()).toEqual([...VERDICTS]);
  });
});

describe('VerdictTag — the token mapping is one-to-one and neutral where it must be', () => {
  it('maps each verdict to its own hue and its own wash, with no sharing', () => {
    expect(VERDICT_TOKENS).toEqual({
      proven: '--verdict-proven',
      red: '--verdict-red',
      stale: '--verdict-stale',
      undesigned: '--verdict-undesigned',
    });
    expect(VERDICT_WASHES).toEqual({
      proven: '--wash-proven',
      red: '--wash-red',
      stale: '--wash-stale',
      undesigned: '--wash-undesigned',
    });
    expect(new Set(Object.values(VERDICT_TOKENS)).size).toBe(VERDICTS.length);
    expect(new Set(Object.values(VERDICT_WASHES)).size).toBe(VERDICTS.length);
  });

  it('gives undesigned the neutral stone-sage, the same value the labels use (R10.3)', () => {
    expect(TOKENS[VERDICT_TOKENS.undesigned]).toBe(TOKENS['--text-200']);
    expect(TOKENS[VERDICT_TOKENS.undesigned]).toBe('#55555A');
  });
});

describe('VerdictTag — the stylesheet keeps the wash and the hue apart', () => {
  it('parsed a stylesheet with something in it', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(10);
    expect(RULES.every((rule) => rule.ancestors.length === 0)).toBe(true);
  });

  it('draws the edge at the structural weight and leaves the box without a hue', () => {
    const base = rulesFor('.verdict-tag');
    expect(base.length).toBe(1);
    const declared = declarationsOf(base[0] as CssRule);
    /* `--line`, the structural border weight of §10.4.1, rather than a bare 1px: the
       badge grammar distinguishes states by fill and border weight, so the weight is
       the token every other structural edge in the system uses. */
    expect(declared.get('border')).toBe('var(--line) solid transparent');
    expect(declared.get('border-radius')).toBe('var(--r-chip)');
    expect(
      declared.has('color'),
      `§10.4.3: the box carries the wash, so it must never carry text colour`,
    ).toBe(false);
    /* the fill is a paper surface from the four-step ramp, never ink and never a hue */
    expect(declared.get('background-color')).toBe('var(--ink-100)');
    /* a verdict word is one token and is never broken across lines (R10.5) */
    expect(declared.get('white-space')).toBe('nowrap');
  });

  it('sets the word in mono at --fs-micro, tracked open (§10.7)', () => {
    const word = rulesFor('.verdict-tag__word');
    expect(word.length).toBe(1);
    const declared = declarationsOf(word[0] as CssRule);
    expect(declared.get('font-family')).toBe('var(--font-mono)');
    expect(declared.get('font-size')).toBe('var(--fs-micro)');
    expect(declared.get('letter-spacing')).toBe('var(--tr-mono)');
    /* at 11px inside a bordered box, the regular weight reads as a caption rather
       than as a state */
    expect(declared.get('font-weight')).toBe('700');
    /* the verdict-colour row of §10.6.3, and `color` is on the motion allowlist */
    expect(declared.get('transition')).toBe('color var(--dur-base) var(--ease-out)');
  });

  it('gives every verdict one edge rule naming its own wash and nothing else', () => {
    for (const verdict of VERDICTS) {
      const edge = rulesFor(`.verdict-tag[data-verdict='${verdict}']`);
      expect(edge.length, `${verdict} has ${edge.length} edge rules, expected 1`).toBe(1);
      const declared = declarationsOf(edge[0] as CssRule);
      expect([...declared.keys()]).toEqual(['border-color']);
      expect(declared.get('border-color')).toBe(`var(${VERDICT_WASHES[verdict]})`);
    }
  });

  it('gives every verdict one hue rule naming its own token and nothing else', () => {
    for (const verdict of VERDICTS) {
      const hue = rulesFor(`.verdict-tag[data-verdict='${verdict}'] .verdict-tag__word`);
      expect(hue.length, `${verdict} has ${hue.length} hue rules, expected 1`).toBe(1);
      const declared = declarationsOf(hue[0] as CssRule);
      expect([...declared.keys()]).toEqual(['color']);
      expect(declared.get('color')).toBe(`var(${VERDICT_TOKENS[verdict]})`);
    }
  });

  it('never lets one rule carry both a wash and text', () => {
    const mixed = RULES.filter((rule) => {
      const declared = declarationsOf(rule);
      const wash = [...declared.values()].some((value) => value.includes('--wash-'));
      return wash && declared.has('color');
    }).map((rule) => rule.prelude);
    expect(
      mixed,
      `a wash behind text would add a foreground/background pair to the matrix ` +
        `Property 22 assumes is finite (§10.4.3)`,
    ).toEqual([]);
  });

  it('declares no colour of its own — every value resolves through a token', () => {
    const literals: string[] = [];
    for (const rule of RULES) {
      for (const declaration of rule.declarations) {
        if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(declaration.value)) {
          literals.push(`${rule.prelude} { ${declaration.property}: ${declaration.value} }`);
        }
      }
    }
    expect(literals, literals.join('\n')).toEqual([]);
  });
});
