/**
 * Visual enforcement 3 of 3, and source scan 6 of 6 — the forbidden-palette scan.
 * Design §10.4 (the forbidden list), §10.4.4 rule 3, §10.5 (depth is authored in
 * one file), R10.2, R10.3, R10.6.
 *
 * The brief was "no AI slop". That is a judgement, so it is turned into six
 * mechanical rules a machine can hold for us:
 *
 *   1. no glassmorphism blur, in CSS or in a React style object;
 *   2. no colour whose HSL saturation exceeds 70% — the ceiling that keeps neon,
 *      the pure-channel `00FF` family and every rainbow stop out;
 *   3. no gradient mixing more than two hue families, which is what a rainbow
 *      scale and the purple-to-blue startup gradient both are;
 *   4. no shadow coloured with anything but `--occlude` or a `--light-edge*`
 *      token, so a glow cannot arrive by way of a shadow;
 *   5. no shadow declaration outside `styles/surfaces.css`, so the three surface
 *      classes stay the only way a component authors depth;
 *   6. no emoji codepoint anywhere under `apps/ledger`.
 *
 * **This file grants itself no exemption.** Every fixture below constructs its
 * violation at run time — the banned property names are assembled from parts and
 * the banned colours from string fragments — so the scan reads its own source
 * along with everything else and the meta-tests below still prove the patterns
 * bite. A file that had to be skipped to stay green would be a hole the width of
 * a test directory.
 */

import { describe, expect, it } from 'vitest';

import { TOKENS } from '../lib/tokens.js';
import {
  STYLE_EXTENSIONS,
  TEXT_EXTENSIONS,
  coloursIn,
  hueFamily,
  parseCss,
  saturation,
  scanLedger,
  type ScannedFile,
} from './_scan.js';

/* ── the banned spellings, assembled so this file never contains one ────────── */

/** The glassmorphism property, and its React style-object spelling. */
const BLUR_PROPERTY = ['backdrop', 'filter'].join('-');
const BLUR_PROPERTY_CAMEL = `backdrop${'Filter'}`;

/** The shadow property, and its React style-object spelling. */
const SHADOW_PROPERTY = ['box', 'shadow'].join('-');
const SHADOW_PROPERTY_CAMEL = `box${'Shadow'}`;

/** The one file permitted to declare a shadow (design §10.5). */
const SURFACES_CSS = 'apps/ledger/styles/surfaces.css';
const TOKENS_CSS = 'apps/ledger/styles/tokens.css';

/** Saturation ceiling from design §10.4. Anything above it is not this palette. */
const MAX_SATURATION = 0.7;

/** Hue families a single gradient may mix. */
const MAX_HUE_FAMILIES = 2;

/**
 * Colour tokens a shadow may name. `--elev-*` is composition — a class saying
 * `var(--elev-1)` is picking a level from the ramp, not inventing a colour.
 */
const SHADOW_TOKENS = /^--(?:occlude|light-edge(?:-strong)?|elev-[0-9]+)$/;

/**
 * Emoji, by property rather than by list: `Extended_Pictographic` covers the
 * pictographic codepoints including the legacy dingbats, and the regional
 * indicators and the emoji variation selector cover flags and text-to-emoji
 * presentation. Typographic arrows, box-drawing and the degree sign are outside
 * it, which is what lets the stylesheets keep their comment rules.
 */
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\uFE0F/u;

const BLUR = new RegExp(`${BLUR_PROPERTY}|${BLUR_PROPERTY_CAMEL}`, 'i');
const SHADOW_DECLARATION = new RegExp(`(?:${SHADOW_PROPERTY}|${SHADOW_PROPERTY_CAMEL})\\s*:`, 'i');
const GRADIENT_CALL = /\b(?:repeating-)?(?:linear|radial|conic)-gradient\(/gi;

const CODE_AND_STYLE = scanLedger(TEXT_EXTENSIONS);
const STYLESHEETS = scanLedger(STYLE_EXTENSIONS);

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index && cursor < text.length; cursor += 1) {
    if (text[cursor] === '\n') line += 1;
  }
  return line;
}

/** Gradient argument lists, extracted with balanced parentheses. */
function gradients(text: string): { readonly args: string; readonly line: number }[] {
  const found: { args: string; line: number }[] = [];
  for (const match of text.matchAll(GRADIENT_CALL)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let cursor = start;
    while (cursor < text.length && depth > 0) {
      const character = text[cursor];
      if (character === '(') depth += 1;
      else if (character === ')') depth -= 1;
      cursor += 1;
    }
    found.push({ args: text.slice(start, cursor - 1), line: lineOf(text, match.index ?? 0) });
  }
  return found;
}

function oversaturated(text: string): { readonly colour: string; readonly value: number }[] {
  const offences: { colour: string; value: number }[] = [];
  for (const colour of coloursIn(text)) {
    const value = saturation(colour);
    if (value > MAX_SATURATION) {
      offences.push({ colour: `rgb(${colour.r} ${colour.g} ${colour.b})`, value });
    }
  }
  return offences;
}

function report(offences: readonly string[], rule: string): void {
  expect(
    offences,
    offences.length === 0
      ? ''
      : `Forbidden palette — ${rule} (design §10.4, §10.5).\n${offences.join('\n')}`,
  ).toEqual([]);
}

/* ───────────────────────────────── meta-tests ──────────────────────────────── */

describe('source scan 6 of 6 — the scan is not a no-op', () => {
  it('scanned the Ledger tree, including its own stylesheets', () => {
    expect(CODE_AND_STYLE.length).toBeGreaterThan(0);
    expect(STYLESHEETS.length).toBeGreaterThanOrEqual(2);
    for (const required of [TOKENS_CSS, SURFACES_CSS]) {
      expect(
        CODE_AND_STYLE.some((file) => file.path === required),
        `${required} was not scanned — has it moved?`,
      ).toBe(true);
    }
  });

  it('scanned itself, so it cannot hide a violation in a test fixture', () => {
    const self = CODE_AND_STYLE.find((file) => file.path.endsWith('forbidden-palette.test.ts'));
    expect(self, 'the scan did not read its own source').toBeDefined();
    expect(BLUR.test(self?.text ?? ''), 'this file names the blur property literally').toBe(false);
    expect(EMOJI.test(self?.text ?? ''), 'this file contains an emoji literally').toBe(false);
  });

  it('trips on the blur property in either spelling', () => {
    for (const bad of [`${BLUR_PROPERTY}: blur(12px);`, `${BLUR_PROPERTY_CAMEL}: 'blur(12px)'`]) {
      expect(BLUR.test(bad), `blur pattern missed: ${bad}`).toBe(true);
    }
    for (const good of ['filter: none;', 'background-color: var(--ink-100);']) {
      expect(BLUR.test(good), `blur pattern false-positived on: ${good}`).toBe(false);
    }
  });

  it('trips on an oversaturated colour and clears every token in the palette', () => {
    const neon = ['#', '00FF', '88'].join('');
    const startupViolet = ['#', '7B2F', 'F7'].join('');
    const pureRed = ['rgb(', '255, 0, 0', ')'].join('');
    const pureGreenShort = ['#', '0F0'].join('');
    for (const bad of [neon, startupViolet, pureRed, pureGreenShort]) {
      expect(oversaturated(bad).length, `saturation rule missed: ${bad}`).toBeGreaterThan(0);
    }
    for (const [name, value] of Object.entries(TOKENS)) {
      expect(oversaturated(value), `${name} is over the saturation ceiling`).toEqual([]);
    }
  });

  it('trips on a gradient mixing three hue families and not on the plane wash', () => {
    const rainbow = `linear-gradient(90deg, ${['#', 'D97A', '66'].join('')}, ${[
      '#',
      '6FB8',
      '94',
    ].join('')}, ${['#', '7FA6', 'BC'].join('')})`;
    const families = (source: string): number => {
      const first = gradients(source)[0];
      expect(first).toBeDefined();
      return new Set(
        coloursIn(first?.args ?? '')
          .map(hueFamily)
          .filter((family): family is string => family !== null),
      ).size;
    };
    expect(families(rainbow)).toBeGreaterThan(MAX_HUE_FAMILIES);
    expect(families('linear-gradient(176deg, var(--light-wash), transparent 62%)')).toBeLessThanOrEqual(
      MAX_HUE_FAMILIES,
    );
  });

  it('trips on a shadow declaration in either spelling', () => {
    for (const bad of [
      `${SHADOW_PROPERTY}: 0 2px 4px rgba(0, 0, 0, 0.2);`,
      `${SHADOW_PROPERTY_CAMEL}: '0 0 12px #6FB894'`,
    ]) {
      expect(SHADOW_DECLARATION.test(bad), `shadow pattern missed: ${bad}`).toBe(true);
    }
    for (const good of ['--elev-1: 0 1px 0 0 var(--light-edge) inset;', 'border: 1px solid red;']) {
      expect(SHADOW_DECLARATION.test(good), `shadow pattern false-positived on: ${good}`).toBe(false);
    }
  });

  it('trips on an emoji codepoint and not on the characters the comments use', () => {
    for (const codepoint of [0x1f389, 0x2705, 0x1f680, 0x26a0]) {
      expect(EMOJI.test(String.fromCodePoint(codepoint)), `emoji rule missed U+${codepoint.toString(16)}`).toBe(
        true,
      );
    }
    for (const allowed of ['─────', '→', '·', '°', '§10.4', '—', 'ø']) {
      expect(EMOJI.test(allowed), `emoji rule false-positived on: ${allowed}`).toBe(false);
    }
  });
});

/* ───────────────────────────── the scan proper ─────────────────────────────── */

describe('source scan 6 of 6 — forbidden palette', () => {
  it('uses no glassmorphism blur anywhere', () => {
    const offences: string[] = [];
    for (const file of CODE_AND_STYLE) {
      file.lines.forEach((line, index) => {
        if (BLUR.test(line)) {
          offences.push(`${file.path}:${index + 1}  ${line.trim()}`);
        }
      });
    }
    report(offences, 'glassmorphism blur is not in this visual system');
  });

  it('declares no colour above 70% saturation', () => {
    const offences: string[] = [];
    for (const file of CODE_AND_STYLE) {
      file.lines.forEach((line, index) => {
        for (const { colour, value } of oversaturated(line)) {
          offences.push(
            `${file.path}:${index + 1}  ${colour} is ${(value * 100).toFixed(1)}% saturated  ` +
              `${line.trim()}`,
          );
        }
      });
    }
    report(offences, 'the palette is desaturated ink and oxidised verdict hues, nothing brighter');
  });

  it('mixes at most two hue families in any gradient', () => {
    const offences: string[] = [];
    for (const file of CODE_AND_STYLE) {
      for (const gradient of gradients(file.text)) {
        const families = new Set(
          coloursIn(gradient.args)
            .map(hueFamily)
            .filter((family): family is string => family !== null),
        );
        if (families.size > MAX_HUE_FAMILIES) {
          offences.push(
            `${file.path}:${gradient.line}  mixes ${families.size} hue families ` +
              `(${[...families].sort().join(', ')})`,
          );
        }
      }
    }
    report(offences, 'a multi-hue gradient is a rainbow scale wearing a coat');
  });

  it('colours every shadow with --occlude or a --light-edge token, and nothing else', () => {
    const offences: string[] = [];
    for (const file of STYLESHEETS) {
      for (const rule of parseCss(file.text)) {
        for (const declaration of rule.declarations) {
          const isShadow =
            declaration.property.toLowerCase() === SHADOW_PROPERTY ||
            /^--elev-[0-9]+$/.test(declaration.property);
          if (!isShadow) continue;

          for (const match of declaration.value.matchAll(/var\(\s*(--[\w-]+)/g)) {
            const token = match[1] ?? '';
            if (!SHADOW_TOKENS.test(token)) {
              offences.push(
                `${file.path}:${declaration.line}  ${declaration.property} names ${token}; ` +
                  `a shadow is occlusion or an edge highlight, never a colour`,
              );
            }
          }
          const literals = coloursIn(declaration.value.replace(/var\([^)]*\)/g, ' '));
          if (literals.length > 0) {
            offences.push(
              `${file.path}:${declaration.line}  ${declaration.property} carries a literal ` +
                `colour; use the tokens so the light stays one source`,
            );
          }
        }
      }
    }
    report(offences, 'shadows are warm occlusion, never coloured and never a glow');
  });

  it('declares a shadow in surfaces.css and nowhere else', () => {
    const offences: string[] = [];
    for (const file of CODE_AND_STYLE) {
      if (file.path === SURFACES_CSS) continue;
      file.lines.forEach((line, index) => {
        if (SHADOW_DECLARATION.test(line)) {
          offences.push(`${file.path}:${index + 1}  ${line.trim()}`);
        }
      });
    }
    report(
      offences,
      `depth is authored once: pick .surface-raised, .surface-raised-2 or .surface-well ` +
        `instead of writing a ${SHADOW_PROPERTY}`,
    );
  });

  it('contains no emoji codepoint under apps/ledger', () => {
    const offences: string[] = [];
    for (const file of CODE_AND_STYLE) {
      file.lines.forEach((line, index) => {
        const match = EMOJI.exec(line);
        if (match !== null) {
          offences.push(
            `${file.path}:${index + 1}  U+${(match[0].codePointAt(0) ?? 0)
              .toString(16)
              .toUpperCase()
              .padStart(4, '0')}`,
          );
        }
      });
    }
    report(offences, 'emoji are not a UI vocabulary here; a word or a token is');
  });
});

/* ───────────────── the surface contract the scan exists to protect ─────────── */

describe('source scan 6 of 6 — three surface classes, and only three', () => {
  const surfaces = STYLESHEETS.find((file) => file.path === SURFACES_CSS);

  function surfacesFile(): ScannedFile {
    expect(surfaces, `${SURFACES_CSS} was not scanned`).toBeDefined();
    if (surfaces === undefined) throw new Error(`${SURFACES_CSS} is missing`);
    return surfaces;
  }

  it('defines exactly .surface-raised, .surface-raised-2 and .surface-well', () => {
    const preludes = parseCss(surfacesFile().text).map((rule) => rule.prelude);
    expect(preludes.sort()).toEqual(['.surface-raised', '.surface-raised-2', '.surface-well']);
  });

  it('gives every one of them a shadow, because that is what they are for', () => {
    for (const rule of parseCss(surfacesFile().text)) {
      const properties = rule.declarations.map((declaration) => declaration.property.toLowerCase());
      expect(properties, `${rule.prelude} authors no depth`).toContain(SHADOW_PROPERTY);
      expect(properties, `${rule.prelude} sets no fill`).toContain('background-color');
    }
  });

  it('expresses the light source as a top edge, downward occlusion and an off-axis wash', () => {
    const text = surfacesFile().text;
    /* above: the 1px inset highlight, through the ramp for raised levels and
       directly for the inverted well */
    expect(text).toContain('var(--elev-1)');
    expect(text).toContain('var(--elev-2)');
    expect(text).toContain('var(--light-edge) inset');
    /* off vertical: 176deg, not 180deg */
    expect(text).toContain('linear-gradient(176deg, var(--light-wash), transparent 62%)');
    /* the well inverts the ramp rather than lighting itself from below */
    expect(text).toContain('var(--occlude) inset');
  });

  it('leaves --elev-3 declared and unused, reserved for a future overlay', () => {
    const tokens = STYLESHEETS.find((file) => file.path === TOKENS_CSS);
    expect(tokens?.text).toContain('--elev-3:');

    const references: string[] = [];
    for (const file of CODE_AND_STYLE) {
      file.lines.forEach((line, index) => {
        if (/var\(\s*--elev-3\s*\)/.test(line)) references.push(`${file.path}:${index + 1}`);
      });
    }
    expect(
      references,
      `--elev-3 is reserved for a future overlay (design §10.5). Using it is a ` +
        `deliberate act: add the overlay, then update this assertion.\n${references.join('\n')}`,
    ).toEqual([]);
  });
});
