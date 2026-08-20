/**
 * Shared machinery for the Ledger's source scans (design §10.4.4, §10.7).
 *
 * Not a test suite — the filename is deliberately outside Vitest's
 * `**\/*.test.ts` glob. It holds the tree walk, a small CSS parser and the colour
 * maths that the contrast, parity, forbidden-palette and typography scans all
 * need, so those four files disagree about nothing.
 *
 * Two rules this module exists to uphold:
 *
 * 1. **No glob dependency.** The runtime budget is closed at the nine packages of
 *    design §2.2 and `micromatch` is not among them, so the walk is hand-rolled,
 *    matching the precedent set by `no-raw-result-code.test.ts`.
 * 2. **A zero-file scan is a failure, not a pass.** Every scan root is asserted
 *    to exist and to yield files. A directory rename that turned a guard into a
 *    silently green no-op would be worse than the violation it hunts.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOKENS } from '../lib/tokens.js';

/**
 * The workspace root, anchored on this file and confirmed by two markers.
 *
 * `fileURLToPath(new URL('../../..', import.meta.url))` — the spelling
 * `packages/kept-core/test/no-raw-result-code.test.ts` uses, and the obvious one
 * to reach for — throws `TypeError: The URL must be of scheme file` here, and the
 * reason is not the scheme of `import.meta.url`. That is a `file:` URL in both
 * projects. It is that Vite statically recognises the literal pattern
 * `new URL('<literal>', import.meta.url)` as an asset reference and rewrites it,
 * and under this project's `jsdom` environment — a *web* transform — the
 * rewritten value is `http://localhost:3000/@fs/…`. The precedent runs in the
 * `node` environment, where that rewrite does not apply, which is the whole of
 * the difference between the two files.
 *
 * So the URL is consumed whole, never as the base of a relative one:
 * `fileURLToPath(import.meta.url)` is left alone by that transform. Anchoring on
 * the module rather than on `process.cwd()` also means a scan run from a
 * subdirectory resolves the same root.
 *
 * The walk then climbs to the two markers that identify this workspace — a
 * `package.json` beside `packages/kept-core` — and throws rather than guessing,
 * because a scan rooted at the wrong directory finds nothing and a scan that
 * finds nothing passes.
 */
function findRepoRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 12; depth += 1) {
    if (
      existsSync(resolve(current, 'package.json')) &&
      existsSync(resolve(current, 'packages/kept-core'))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(
    `Could not locate the workspace root above ${fileURLToPath(import.meta.url)}. The ` +
      `source scans resolve every path from it, and a scan rooted nowhere is a no-op guard.`,
  );
}

export const REPO_ROOT = findRepoRoot();

/** Everything the Ledger owns. The palette rules apply to all of it. */
export const LEDGER_ROOT = 'apps/ledger';

/**
 * Directories whose **name alone** identifies them as build output or vendored code,
 * wherever they appear.
 *
 * Note what is no longer here: `coverage`. It was listed as a tool-output name, and
 * then `apps/ledger/app/coverage/` became a real route (task 9.8) — so the contrast,
 * parity, forbidden-palette, typography and motion scans were all silently declining
 * to read a shipped page. Five enforcement tests with a blind spot over a route is
 * worse than any of the violations they hunt, because it presents as green.
 * `scripts/check-readonly.mjs` reached the same conclusion from the other side and
 * left `coverage` out of its own list for the same reason.
 */
const SKIP_DIRECTORY_NAMES = new Set(['node_modules', 'dist', '.git', '.next', 'out']);

/**
 * Tool-output directories whose *name* is ambiguous, identified by their **path**.
 *
 * A coverage reporter configured to write inside the scan root would land here, and
 * that directory genuinely is output and genuinely should be skipped — the mistake
 * above was matching on the name, which a route is free to share. Repo-relative and
 * forward-slashed, matching {@link ScannedFile.path}.
 */
export const SKIP_DIRECTORY_PATHS: ReadonlySet<string> = new Set(['apps/ledger/coverage']);

/** Repo-relative, forward-slashed, the one spelling every path in this module uses. */
function repoRelative(absolute: string): string {
  return relative(REPO_ROOT, absolute).split('\\').join('/');
}

/**
 * `true` when the tree walk must not descend into this directory.
 *
 * Exported so the decision itself can be asserted rather than inferred from what the
 * walk happened to return: `test/scan-coverage-route.test.ts` proves both halves — that
 * `apps/ledger/app/coverage` is read and that `apps/ledger/coverage` is not.
 */
export function isSkippedDirectory(absolutePath: string): boolean {
  const path = repoRelative(absolutePath);
  const name = path.slice(path.lastIndexOf('/') + 1);
  return SKIP_DIRECTORY_NAMES.has(name) || SKIP_DIRECTORY_PATHS.has(path);
}

export interface ScannedFile {
  /** Repo-relative, forward-slashed. */
  readonly path: string;
  readonly text: string;
  readonly lines: readonly string[];
}

function collect(absoluteRoot: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  const stack: string[] = [absoluteRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const child = resolve(current, entry.name);
      if (entry.isDirectory()) {
        if (!isSkippedDirectory(child)) stack.push(child);
      } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
        found.push(child);
      }
    }
  }
  return found.sort();
}

/**
 * Every file under `apps/ledger` with one of `extensions`.
 *
 * Throws rather than returning nothing: the root must exist and must contain at
 * least one match, because both a moved tree and a stale extension list present
 * as an empty result, and an empty result silently disarms the caller.
 */
export function scanLedger(extensions: readonly string[]): ScannedFile[] {
  const absoluteRoot = resolve(REPO_ROOT, LEDGER_ROOT);
  const stats = statSync(absoluteRoot, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isDirectory()) {
    throw new Error(
      `Scan root ${LEDGER_ROOT} does not exist. A guard must not be allowed to pass ` +
        `by scanning nothing — update LEDGER_ROOT to the tree's new shape.`,
    );
  }
  const files = collect(absoluteRoot, extensions);
  if (files.length === 0) {
    throw new Error(
      `Scan root ${LEDGER_ROOT} contains no ${extensions.join('/')} files. Either the ` +
        `tree moved or the extension list is stale; a zero-file scan is a no-op guard.`,
    );
  }
  return files.map((path) => {
    const text = readFileSync(path, 'utf8');
    return {
      path: relative(REPO_ROOT, path).split('\\').join('/'),
      text,
      lines: text.split('\n'),
    };
  });
}

/** Source extensions that can carry a colour, a class name or a style. */
export const STYLE_EXTENSIONS = ['.css'] as const;
export const CODE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.mjs'] as const;
export const TEXT_EXTENSIONS = [
  ...STYLE_EXTENSIONS,
  ...CODE_EXTENSIONS,
  '.json',
  '.md',
  '.svg',
  '.html',
] as const;

/* ────────────────────────── a very small CSS parser ────────────────────────── */

export interface CssDeclaration {
  /** Lower-cased property name, `--custom-property` names kept verbatim. */
  readonly property: string;
  readonly value: string;
  /** 1-based line of the semicolon that closed the declaration. */
  readonly line: number;
}

export interface CssRule {
  /** The prelude, e.g. `.surface-well` or `:root`. */
  readonly prelude: string;
  /** Enclosing at-rule preludes, outermost first, e.g. `@media (…)`. */
  readonly ancestors: readonly string[];
  readonly declarations: readonly CssDeclaration[];
  readonly line: number;
}

/** Blanks comments while preserving every newline, so line numbers survive. */
export function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
}

/**
 * Parses the subset of CSS this repository writes: rules, nested at-rules, and
 * declarations. No support for strings containing braces or semicolons, which the
 * Ledger's stylesheets do not contain — the font stacks quote only plain names.
 */
export function parseCss(source: string): CssRule[] {
  const clean = stripCssComments(source);
  const rules: CssRule[] = [];
  const open: { prelude: string; line: number; declarations: CssDeclaration[] }[] = [];
  let buffer = '';
  let line = 1;

  const flushDeclaration = (): void => {
    const text = buffer.trim();
    buffer = '';
    if (text === '' || !text.includes(':')) return;
    const block = open[open.length - 1];
    if (block === undefined) return;
    const split = text.indexOf(':');
    block.declarations.push({
      property: text.slice(0, split).trim(),
      value: text.slice(split + 1).trim(),
      line,
    });
  };

  for (const character of clean) {
    if (character === '\n') line += 1;
    if (character === '{') {
      open.push({ prelude: buffer.trim().replace(/\s+/g, ' '), line, declarations: [] });
      buffer = '';
    } else if (character === '}') {
      flushDeclaration();
      const block = open.pop();
      if (block !== undefined) {
        rules.push({
          prelude: block.prelude,
          ancestors: open.map((entry) => entry.prelude),
          declarations: block.declarations,
          line: block.line,
        });
      }
    } else if (character === ';') {
      flushDeclaration();
    } else {
      buffer += character;
    }
  }
  return rules;
}

/** Collapses whitespace runs so a multi-line CSS value compares as one line. */
export function normaliseCssValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/* ───────────────────────────── colour arithmetic ───────────────────────────── */

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * Matches hex colour literals of 3, 4, 6 or 8 digits.
 *
 * Global, so use it with `matchAll` (which works on a clone) and never with
 * `test` (which would carry `lastIndex` between calls).
 */
export const HEX_COLOUR = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;

/**
 * Matches functional `rgb()` / `rgba()` colours, comma or space separated.
 *
 * Case-insensitive because CSS is, and safe to be so: the leading `\b` means an
 * identifier ending in those letters, `hexToRgba` among them, is not a colour.
 */
export const RGB_COLOUR =
  /\brgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)(?:[\s,/]+([0-9.%]+))?\s*\)/gi;

export function hexToRgba(literal: string): Rgba {
  const body = literal.replace(/^#/, '');
  const short = body.length === 3 || body.length === 4;
  const at = (index: number): number => {
    const slice = short
      ? `${body[index] ?? ''}${body[index] ?? ''}`
      : body.slice(index * 2, index * 2 + 2);
    return Number.parseInt(slice, 16);
  };
  const hasAlpha = body.length === 4 || body.length === 8;
  return { r: at(0), g: at(1), b: at(2), a: hasAlpha ? at(3) / 255 : 1 };
}

/** HSL saturation, 0 to 1. The measure the 70% ceiling of §10.4 is stated in. */
export function saturation({ r, g, b }: Rgba): number {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  if (max === min) return 0;
  const delta = max - min;
  const lightness = (max + min) / 2;
  return lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
}

/** Hue in degrees, 0 to 360. Meaningless when `saturation` is 0. */
export function hue({ r, g, b }: Rgba): number {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta === 0) return 0;
  let sixths: number;
  if (max === red) sixths = ((green - blue) / delta) % 6;
  else if (max === green) sixths = (blue - red) / delta + 2;
  else sixths = (red - green) / delta + 4;
  return (sixths * 60 + 360) % 360;
}

/**
 * Named hue bands. A "hue family" in the §10.4 sense: the coarse thing an eye
 * names, not a degree. Anything below 10% saturation is achromatic and belongs to
 * no family, which is what lets the ink ramp appear in a gradient beside a wash
 * without counting as a second hue.
 */
const HUE_FAMILIES: readonly { readonly name: string; readonly from: number; readonly to: number }[] =
  [
    { name: 'red', from: 345, to: 15 },
    { name: 'orange', from: 15, to: 45 },
    { name: 'yellow', from: 45, to: 70 },
    { name: 'green', from: 70, to: 160 },
    { name: 'cyan', from: 160, to: 200 },
    { name: 'blue', from: 200, to: 260 },
    { name: 'violet', from: 260, to: 290 },
    { name: 'magenta', from: 290, to: 345 },
  ];

export const ACHROMATIC_SATURATION = 0.1;

export function hueFamily(colour: Rgba): string | null {
  if (colour.a === 0) return null;
  if (saturation(colour) < ACHROMATIC_SATURATION) return null;
  const degrees = hue(colour);
  for (const family of HUE_FAMILIES) {
    const wraps = family.from > family.to;
    const inside = wraps
      ? degrees >= family.from || degrees < family.to
      : degrees >= family.from && degrees < family.to;
    if (inside) return family.name;
  }
  return null;
}

/**
 * Every colour a CSS value resolves to, including through `var(--token)` — the
 * washes and the light tokens are only ever reached that way, so a scan that did
 * not resolve them would inspect an empty list and pass.
 */
export function coloursIn(value: string): Rgba[] {
  const seen: Rgba[] = [];
  const resolved = value.replace(/var\(\s*(--[\w-]+)\s*[^)]*\)/g, (_match, name: string) => {
    const token = TOKENS[name as keyof typeof TOKENS];
    return token === undefined ? ' ' : ` ${token} `;
  });
  for (const match of resolved.matchAll(HEX_COLOUR)) {
    const literal = match[1];
    if (literal !== undefined) seen.push(hexToRgba(literal));
  }
  for (const match of resolved.matchAll(RGB_COLOUR)) {
    const [, r, g, b, a] = match;
    if (r === undefined || g === undefined || b === undefined) continue;
    const alpha = a === undefined ? 1 : a.endsWith('%') ? Number.parseFloat(a) / 100 : Number(a);
    seen.push({ r: Number(r), g: Number(g), b: Number(b), a: Number.isNaN(alpha) ? 1 : alpha });
  }
  return seen;
}

/**
 * Every component file under `apps/ledger`, or none.
 *
 * The component-level rules of §10.7 and §10.4.3 cannot be evaluated before
 * stage 9 lands a single `.tsx`. This is how those scans tell "nothing to check
 * yet" from "the tree moved and I am checking nothing": it keys off the file
 * extension across the whole app rather than off a `components/` directory name,
 * so relocating or renaming that directory cannot disarm them, and the scans that
 * call it assert the empty case explicitly rather than skipping quietly.
 */
export function componentFiles(): ScannedFile[] {
  const absoluteRoot = resolve(REPO_ROOT, LEDGER_ROOT);
  const stats = statSync(absoluteRoot, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isDirectory()) {
    throw new Error(`Scan root ${LEDGER_ROOT} does not exist; a zero-file scan is a no-op guard.`);
  }
  return collect(absoluteRoot, ['.tsx']).map((path) => {
    const text = readFileSync(path, 'utf8');
    return {
      path: relative(REPO_ROOT, path).split('\\').join('/'),
      text,
      lines: text.split('\n'),
    };
  });
}
