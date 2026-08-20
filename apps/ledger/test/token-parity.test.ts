/**
 * Visual enforcement 2 of 3 — token parity, both directions.
 * Design §10.4.4 rule 2.
 *
 * The contrast matrix computes its ratios from `lib/tokens.ts`, but the browser
 * paints from `styles/tokens.css`. Without this test those two can drift, and the
 * failure mode is the quiet one: the matrix keeps measuring a palette nobody
 * ships, so a hex edited to something unreadable in CSS passes a green suite.
 *
 * So the comparison runs in both directions. Every `--custom-property` declared
 * in `tokens.css` has a `TOKENS` entry with an identical value, and every `TOKENS`
 * entry is declared in `tokens.css`. Values are compared with whitespace runs
 * collapsed, which is exactly the equivalence CSS itself applies — it is what lets
 * the `--elev-*` ramps stay readable across three lines in the stylesheet and sit
 * on one line in TypeScript.
 *
 * A companion assertion keeps `tokens.css` the only declaration site: no other
 * Ledger stylesheet may declare a custom property. `surfaces.css` consumes tokens;
 * it does not invent them.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TOKENS } from '../lib/tokens.js';
import {
  REPO_ROOT,
  STYLE_EXTENSIONS,
  normaliseCssValue,
  parseCss,
  scanLedger,
  stripCssComments,
} from './_scan.js';

const TOKENS_CSS = 'apps/ledger/styles/tokens.css';

function readTokensCss(): string {
  const source = readFileSync(resolve(REPO_ROOT, TOKENS_CSS), 'utf8');
  if (source.trim() === '') {
    throw new Error(`${TOKENS_CSS} is empty — parity against nothing is not parity.`);
  }
  return source;
}

/** Every custom property declared in `:root`, name to whitespace-normalised value. */
function declaredTokens(): Map<string, { value: string; line: number }> {
  const declared = new Map<string, { value: string; line: number }>();
  for (const rule of parseCss(readTokensCss())) {
    for (const declaration of rule.declarations) {
      if (!declaration.property.startsWith('--')) continue;
      if (declared.has(declaration.property)) {
        throw new Error(
          `${TOKENS_CSS}:${declaration.line} declares ${declaration.property} twice. ` +
            `The later value wins in the browser and the earlier one wins a reader's ` +
            `attention; neither is a token.`,
        );
      }
      declared.set(declaration.property, {
        value: normaliseCssValue(declaration.value),
        line: declaration.line,
      });
    }
  }
  return declared;
}

const DECLARED = declaredTokens();
const MIRRORED = new Map<string, string>(
  Object.entries(TOKENS).map(([name, value]) => [name, normaliseCssValue(value)]),
);

describe('visual enforcement 2 of 3 — the parity scan is not a no-op', () => {
  /**
   * The scans resolve every path against `REPO_ROOT`, so it must be a real
   * absolute filesystem path and not a URL. Under this project's `jsdom`
   * environment Vite rewrites `new URL('<literal>', import.meta.url)` into an
   * `http://localhost:3000/@fs/…` asset URL, which is why `_scan.ts` consumes
   * `import.meta.url` whole instead. This pins that.
   */
  it('resolved an absolute workspace root, not a URL', () => {
    expect(isAbsolute(REPO_ROOT)).toBe(true);
    expect(REPO_ROOT).not.toContain(':/');
    expect(existsSync(resolve(REPO_ROOT, 'packages/kept-core'))).toBe(true);
    expect(existsSync(resolve(REPO_ROOT, TOKENS_CSS))).toBe(true);
  });

  it('found a non-trivial token set on both sides', () => {
    expect(DECLARED.size).toBeGreaterThanOrEqual(60);
    expect(MIRRORED.size).toBeGreaterThanOrEqual(60);
  });

  it('declares the tokens in a :root rule, so they cascade to the document', () => {
    const roots = parseCss(readTokensCss()).filter((rule) => rule.prelude === ':root');
    expect(roots.length).toBe(1);
    expect(roots[0]?.declarations.length).toBe(DECLARED.size);
    expect(roots[0]?.ancestors).toEqual([]);
  });

  it('would notice a value that differs only in whitespace-insensitive ways', () => {
    expect(normaliseCssValue('0 1px  0\n  0 var(--light-edge) inset')).toBe(
      '0 1px 0 0 var(--light-edge) inset',
    );
    expect(normaliseCssValue(' #14120F ')).toBe('#14120F');
    expect(normaliseCssValue('#14120F')).not.toBe(normaliseCssValue('#14120E'));
  });
});

describe('visual enforcement 2 of 3 — tokens.css and lib/tokens.ts agree', () => {
  it('mirrors every declared custom property, with an identical value', () => {
    const offences: string[] = [];
    for (const [name, { value, line }] of DECLARED) {
      const mirrored = MIRRORED.get(name);
      if (mirrored === undefined) {
        offences.push(
          `${TOKENS_CSS}:${line}  ${name} is declared in CSS but missing from TOKENS — ` +
            `the contrast matrix cannot see it`,
        );
      } else if (mirrored !== value) {
        offences.push(
          `${TOKENS_CSS}:${line}  ${name} is "${value}" in CSS and "${mirrored}" in TOKENS`,
        );
      }
    }
    expect(offences, offences.join('\n')).toEqual([]);
  });

  it('declares every mirrored token in CSS, so no test input is fictional', () => {
    const offences: string[] = [];
    for (const [name, value] of MIRRORED) {
      if (!DECLARED.has(name)) {
        offences.push(
          `${name} is in TOKENS as "${value}" but is not declared in ${TOKENS_CSS} — ` +
            `nothing in the browser resolves it`,
        );
      }
    }
    expect(offences, offences.join('\n')).toEqual([]);
  });

  it('keeps tokens.css the only declaration site', () => {
    const offences: string[] = [];
    for (const file of scanLedger(STYLE_EXTENSIONS)) {
      if (file.path === TOKENS_CSS) continue;
      for (const rule of parseCss(file.text)) {
        for (const declaration of rule.declarations) {
          if (declaration.property.startsWith('--')) {
            offences.push(
              `${file.path}:${declaration.line}  declares ${declaration.property}. Tokens ` +
                `live in ${TOKENS_CSS} only, or parity has a blind spot.`,
            );
          }
        }
      }
    }
    expect(offences, offences.join('\n')).toEqual([]);
  });

  it('carries no stray custom property outside the :root block', () => {
    const body = stripCssComments(readTokensCss());
    const outside = body.slice(0, body.indexOf('{'));
    expect(outside).not.toContain('--');
  });
});
