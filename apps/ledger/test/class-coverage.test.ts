/**
 * Every class the Ledger renders is defined by a stylesheet (design §10.4.4, §10.7).
 *
 * ## Why this exists
 *
 * `/coverage` shipped with **eight** class names that no stylesheet defined:
 * `.coverage-axes`, `.coverage-axis`, `.coverage-axis__ratio`,
 * `.coverage-axis__detail` and the four `.coverage-pending*` names. The dual-axis
 * ribbon therefore had no layout at all. Each axis is four `<span>` elements, and an
 * unstyled `<span>` is inline, so the figure, the label, the denominator and the
 * explanation ran together into one line a reader could not parse:
 *
 *     100%designed, acceptance criteria6/6acceptance criteria bound to a designed
 *     scenario in the assurance graph100%proven, acceptance criteria6/6…
 *
 * Nothing was red. The markup was correct, the figures were correct, and the suites
 * that assert what the page *says* all passed, because `textContent` is identical
 * whether or not a rule exists. What no test asked was whether the page could be
 * **read**. That is the fourth time in this repository a defect has lived in the
 * composition rather than in a part, and the reason the guard is general rather than
 * eight specific assertions: the next missing rule will be on a page nobody is
 * looking at either.
 *
 * ## What it checks, and what it deliberately does not
 *
 * Every literal `className="…"` in every `.tsx` under `apps/ledger` is split into
 * tokens, and each token must appear as a selector in some committed stylesheet. That
 * catches the whole failure mode: a name typed in the markup that no rule matches.
 *
 * It does **not** check the other direction. An unused rule is dead weight, not a
 * broken page, and `motion-scan.test.ts` already refuses an unreferenced `@keyframes`
 * for the separate reason that a shimmer with a commit behind it is a shimmer
 * somebody meant to use. Nor does it check dynamic class names: a template literal or
 * a lookup cannot be resolved statically, so those are skipped rather than guessed at,
 * and {@link DYNAMIC_CLASS_SOURCES} names the modules that use them so the skip is a
 * recorded exemption rather than a silent hole.
 */

import { describe, expect, it } from 'vitest';

import { STYLE_EXTENSIONS, scanLedger } from './_scan.js';

/** Every committed stylesheet, as one body of text. */
const CSS = scanLedger(STYLE_EXTENSIONS)
  .map((file) => file.text)
  .join('\n');

/** Every `.tsx` the Ledger ships, tests excluded. */
const COMPONENTS = scanLedger(['.tsx']).filter(
  (file) => !file.path.startsWith('apps/ledger/test/'),
);

/**
 * Class tokens that are composed at run time and cannot be resolved by reading source.
 *
 * Named so the exemption is auditable. Each of these builds a name from a value, and
 * the suites listed beside them assert the composed result against the stylesheet in
 * their own way, which is the only place that check can be made honestly.
 */
const DYNAMIC_CLASS_SOURCES: readonly string[] = Object.freeze([
  'apps/ledger/components/VerdictTag.tsx',
  'apps/ledger/components/PromiseNode.tsx',
  'apps/ledger/components/LaneNode.tsx',
]);

/** Class tokens from every literal `className="…"` in one file. */
function literalClasses(text: string): readonly string[] {
  const tokens = new Set<string>();
  for (const match of text.matchAll(/className="([^"{}]+)"/g)) {
    for (const token of (match[1] ?? '').split(/\s+/)) {
      if (token !== '') tokens.add(token);
    }
  }
  return [...tokens];
}

/** Is there a selector for this class in any committed stylesheet? */
function defined(token: string): boolean {
  // Escaped, because a BEM name carries `-` and `_` and a class could carry a digit.
  return new RegExp(`\\.${token.replace(/[^\w-]/g, '\\$&')}(?![\\w-])`).test(CSS);
}

describe('the Ledger renders no class that no stylesheet defines', () => {
  it('scans something, so the guard cannot pass by reading nothing', () => {
    expect(COMPONENTS.length).toBeGreaterThan(10);
    expect(CSS.length).toBeGreaterThan(10_000);
    // A name that is certainly defined, and one that certainly is not, so the
    // predicate itself is checked rather than assumed.
    expect(defined('promise-list__item')).toBe(true);
    expect(defined('definitely-not-a-real-class-name')).toBe(false);
  });

  it('defines every class name the components spell out', () => {
    const missing: string[] = [];
    for (const file of COMPONENTS) {
      for (const token of literalClasses(file.text)) {
        if (!defined(token)) missing.push(`${file.path} -> .${token}`);
      }
    }
    expect(
      missing.sort(),
      `these class names are rendered and matched by no rule in any stylesheet, so the ` +
        `elements carrying them have no layout at all. That is how the dual-axis ribbon ` +
        `shipped as one unbroken run of text with every content assertion passing.`,
    ).toEqual([]);
  });

  it('covers the coverage ribbon in particular, since that is where it went wrong', () => {
    // Named explicitly as a regression pin. The general rule above would catch these
    // again, and naming them means a reader of this file learns what the general rule
    // is for.
    for (const token of [
      'coverage-axes',
      'coverage-axis',
      'coverage-axis__ratio',
      'coverage-axis__detail',
      'coverage-pending',
      'coverage-pending__item',
      'coverage-pending__stage',
      'coverage-pending__why',
    ]) {
      expect(defined(token), `.${token} is rendered by /coverage and defined nowhere`).toBe(
        true,
      );
    }
  });

  it('lays the axis figures out as a grid, so four spans cannot run together', () => {
    /* The specific fix, asserted as a property of the rule rather than as its text: an
       axis has to establish a block layout for its children, or the inline default
       returns and so does the jumbled line. */
    const axis = /\.coverage-axis\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(axis).toMatch(/display:\s*grid/);
    const axes = /\.coverage-axes\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(axes).toMatch(/display:\s*grid/);
    // The browser's default bullets and indent are removed, or the ribbon reads as a
    // bulleted list of numbers.
    expect(axes).toMatch(/list-style:\s*none/);
    expect(axes).toMatch(/padding:\s*0/);
    // The figure gets a line of its own; inline was the whole defect.
    const figure = /\.coverage-axis\s+\.coverage-page__figure\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(figure).toMatch(/display:\s*block/);
  });

  it('records which components build a class name at run time', () => {
    // The exemption, kept honest: a module that stops composing dynamically should
    // leave this list, and one that starts should join it deliberately.
    const dynamic = COMPONENTS.filter((file) => /className=\{/.test(file.text)).map(
      (file) => file.path,
    );
    for (const path of DYNAMIC_CLASS_SOURCES) {
      expect(dynamic, `${path} no longer composes a class name at run time`).toContain(path);
    }
  });
});
