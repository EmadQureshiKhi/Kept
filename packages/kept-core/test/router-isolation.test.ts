import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '@kept/core';
import {
  REPAIR_BRANCHES,
  VERDICT_ROUTER_NAMES,
  createFailureContext,
  isRepairAnnotation,
  selectRouter,
} from '@kept/core';

/**
 * Source scan 3 of 6 — no concrete verdict router outside `src/verdict/`
 * (design §6.1, §6.4, R6.10, R6.14).
 *
 * An architectural guard, not coverage. One empirical question was still open
 * when the router was designed (R6.12): whether a failing cached replay carries
 * the confirmed-bug code and an inline `verdict` object at all. The whole
 * three-way repair branch keys off the answer, so instead of guessing, the answer
 * was fenced behind a strategy interface with two implementations and a single
 * configuration string. The promise that buys is precise: whichever way the spike
 * lands, **one string in `.kept/config.json` changes and nothing else in the
 * repository does** (R6.14).
 *
 * That promise is only true while `selectRouter` is the only door. The moment a
 * consumer imports `resultCode740Router` directly, the spike's outcome becomes a
 * code change in an unknown number of call sites, and no unit test notices —
 * every one of them still passes, because the imported strategy works fine. Only
 * a ban on the import shape catches it.
 *
 * ## Imports, not mentions
 *
 * This scan is deliberately the mirror image of source scan 1 of 6, which
 * inspects comments on purpose because prose spelling out a banned comparison is
 * how the comparison gets copied into code. Here prose is *legitimate*, and
 * common: `model/promise.ts` declares `RepairStrategy` as the union of the two
 * strategy names, `kane/failureYaml.ts` explains in prose why `failureYamlTriage`
 * can ship regardless of the spike, `kept-cli/src/config.ts` carries both names
 * as string literals in `VERDICT_ROUTER_NAMES`, and this package's barrel
 * documents the fence by naming what it fences. All four predate the routers, and
 * a scan that matched the *name* rather than the *import* would fail on every one
 * of them while catching nothing real.
 *
 * So comments are blanked before any pattern runs, and what is banned is an
 * import shape:
 *
 * 1. a module specifier resolving to `verdict/resultCode740` or
 *    `verdict/failureYamlTriage` — static, side-effect, dynamic or `require`,
 *    through source, through `dist/**`, or re-exported onward; and
 * 2. an import clause naming `resultCode740Router` or `failureYamlTriageRouter`,
 *    wherever it claims to import them from — including the barrel, which today
 *    exports neither.
 *
 * `selectRouter` is the only legal door and stays importable from anywhere.
 *
 * ## Zero files is a failure
 *
 * Every root is asserted to exist and to yield source files, following the
 * precedent of `no-raw-result-code.test.ts`. A tree rename that turned this guard
 * into a silently green no-op would be worse than the violation it hunts. For the
 * same reason the fence is checked from both sides: the suite asserts that
 * `src/verdict/router.ts` really does import both concretes — so the exemption
 * has something behind it — and that `selectRouter` really does reach both
 * strategies and route with them, so the scan can never be green merely because
 * nothing in the repository uses a router at all.
 */

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * The trees whose module graph is policed: both published packages and the
 * Ledger, which is the downstream consumer R6.14 names.
 *
 * `packages/kept-core/test` is deliberately absent. The two strategies have unit
 * suites of their own (`verdict-result-code-740.test.ts`,
 * `verdict-failure-yaml-triage.test.ts`) and those must import what they test.
 * The fence is about shipped logic — what changes if the spike lands the other
 * way — and a test that exercises a strategy directly changes nothing about
 * which strategy the CLI runs.
 */
const SCAN_ROOTS = ['packages/kept-core/src', 'packages/kept-cli/src', 'apps/ledger'] as const;

/** Inside the fence. Everything under it may import a concrete freely. */
const FENCE = 'packages/kept-core/src/verdict/';

/** The two concrete strategy modules, by basename. */
const CONCRETE_MODULES: readonly string[] = ['resultCode740', 'failureYamlTriage'];

/** The two concrete strategy objects, by exported symbol. */
const CONCRETE_SYMBOLS: readonly string[] = ['resultCode740Router', 'failureYamlTriageRouter'];

/** The one legal door, asserted to stay importable from anywhere. */
const DOOR = 'selectRouter';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'] as const;
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', '.next', 'out', 'coverage']);

/** Extensions a module specifier may carry, longest first. */
const SPECIFIER_EXTENSIONS = ['.d.ts', '.mts', '.cts', '.tsx', '.ts', '.mjs', '.cjs', '.js'];

/**
 * Blank every comment while preserving newlines, so reported line numbers still
 * point at the offending line.
 *
 * Hand-written rather than regex-based because a naive `//` rule mangles a URL
 * inside a string literal, and this repository's diagnostics are full of them.
 * The scanner tracks the four states that matter — line comment, block comment,
 * quoted string, template literal — and nothing else; no regex-literal state,
 * because a `/` division or regex is never confused for a comment opener here
 * without also being followed by `/` or `*`, and the two false readings that
 * shape could produce (a blanked regex body, an unblanked comment) both fail
 * safe: this scan only ever *removes* text from consideration, and a specifier is
 * a quoted string, which is a state the scanner does track.
 */
function stripComments(source: string): string {
  let out = '';
  let index = 0;
  type State = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';
  let state: State = 'code';

  while (index < source.length) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';

    if (state === 'code') {
      if (character === '/' && next === '/') {
        state = 'line';
        out += '  ';
        index += 2;
        continue;
      }
      if (character === '/' && next === '*') {
        state = 'block';
        out += '  ';
        index += 2;
        continue;
      }
      if (character === "'") state = 'single';
      else if (character === '"') state = 'double';
      else if (character === '`') state = 'template';
      out += character;
      index += 1;
      continue;
    }

    if (state === 'line') {
      if (character === '\n') {
        state = 'code';
        out += '\n';
      } else {
        out += ' ';
      }
      index += 1;
      continue;
    }

    if (state === 'block') {
      if (character === '*' && next === '/') {
        state = 'code';
        out += '  ';
        index += 2;
        continue;
      }
      out += character === '\n' ? '\n' : ' ';
      index += 1;
      continue;
    }

    // Inside a string of some kind: copy verbatim, honour escapes, and leave on
    // the matching closer. A specifier lives here, so nothing is blanked.
    if (character === '\\') {
      out += source.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (
      (state === 'single' && character === "'") ||
      (state === 'double' && character === '"') ||
      (state === 'template' && character === '`')
    ) {
      state = 'code';
    }
    out += character;
    index += 1;
  }
  return out;
}

/** One import site found in a file. */
interface ImportSite {
  /** 1-based line of the statement's keyword. */
  readonly line: number;
  /** The module specifier, verbatim. */
  readonly specifier: string;
  /** What was bound, for a `from`-form. Empty for the other three forms. */
  readonly clause: string;
  readonly form: 'static' | 'side-effect' | 'dynamic' | 'require';
}

/**
 * Every import shape this repository can express.
 *
 * The `from`-form's clause is restricted to the characters a real import clause
 * can hold — identifiers, braces, commas, `*`, `as`, `type`, whitespace — which
 * both keeps the lazy match from spanning two statements and means a string
 * literal containing the word "import" cannot start a phantom match.
 */
const IMPORT_PATTERNS: readonly { readonly form: ImportSite['form']; readonly re: RegExp }[] = [
  { form: 'static', re: /\b(?:import|export)\s+([\w$*{},\s]*?)\s*from\s*['"]([^'"]+)['"]/g },
  { form: 'side-effect', re: /\bimport\s*['"]([^'"]+)['"]/g },
  { form: 'dynamic', re: /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g },
  { form: 'require', re: /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g },
];

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let at = 0; at < index; at += 1) if (text[at] === '\n') line += 1;
  return line;
}

/** Every import site in one file's text, comments already blanked. */
export function importSites(source: string): ImportSite[] {
  const text = stripComments(source);
  const sites: ImportSite[] = [];
  for (const { form, re } of IMPORT_PATTERNS) {
    const pattern = new RegExp(re.source, re.flags);
    let match = pattern.exec(text);
    while (match !== null) {
      const isStatic = form === 'static';
      const specifier = (isStatic ? match[2] : match[1]) ?? '';
      sites.push({
        line: lineOf(text, match.index),
        specifier,
        clause: isStatic ? (match[1] ?? '') : '',
        form,
      });
      match = pattern.exec(text);
    }
  }
  return sites.sort((a, b) => a.line - b.line);
}

/** Strip a module extension from the last segment of a specifier. */
function withoutExtension(segment: string): string {
  for (const extension of SPECIFIER_EXTENSIONS) {
    if (segment.endsWith(extension)) return segment.slice(0, -extension.length);
  }
  return segment;
}

/**
 * Whether a specifier resolves to a concrete strategy module.
 *
 * Matched on path segments rather than on a whole-string suffix, so
 * `./resultCode740.js`, `../verdict/resultCode740.js`,
 * `@kept/core/dist/verdict/failureYamlTriage.js` and a hypothetical
 * `verdict/resultCode740/index.js` all land the same way.
 */
export function namesConcreteModule(specifier: string): boolean {
  const segments = specifier.split('/').filter((segment) => segment.length > 0);
  return segments.some(
    (segment, position) =>
      CONCRETE_MODULES.includes(position === segments.length - 1 ? withoutExtension(segment) : segment),
  );
}

/** Whether an import clause binds a concrete strategy object. */
export function bindsConcreteSymbol(clause: string): boolean {
  return CONCRETE_SYMBOLS.some((symbol) => new RegExp(`\\b${symbol}\\b`).test(clause));
}

/** Every reason one import site is a violation. Empty when it is legal. */
export function violationsAt(site: ImportSite): string[] {
  const reasons: string[] = [];
  if (namesConcreteModule(site.specifier)) {
    reasons.push(`${site.form} import of concrete strategy module '${site.specifier}'`);
  }
  if (bindsConcreteSymbol(site.clause)) {
    reasons.push(`import binds a concrete strategy object from '${site.specifier}'`);
  }
  return reasons;
}

interface ScannedFile {
  /** Repo-relative, forward-slashed. */
  readonly path: string;
  readonly text: string;
  readonly sites: readonly ImportSite[];
}

function collectSourceFiles(absoluteRoot: string): string[] {
  const found: string[] = [];
  const stack: string[] = [absoluteRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const child = resolve(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) stack.push(child);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        found.push(child);
      }
    }
  }
  return found.sort();
}

/** Scan every root, refusing to pass by scanning nothing. */
function scanAllRoots(): ScannedFile[] {
  const files: ScannedFile[] = [];
  for (const root of SCAN_ROOTS) {
    const absoluteRoot = resolve(REPO_ROOT, root);
    const stats = statSync(absoluteRoot, { throwIfNoEntry: false });
    if (stats === undefined || !stats.isDirectory()) {
      throw new Error(
        `Source-scan root ${root} does not exist. The fence cannot be allowed to pass by ` +
          `scanning nothing — update SCAN_ROOTS to the tree's new shape.`,
      );
    }
    const rootFiles = collectSourceFiles(absoluteRoot);
    if (rootFiles.length === 0) {
      throw new Error(
        `Source-scan root ${root} contains no TypeScript files. Either the tree moved or the ` +
          `extension list is stale; a zero-file scan is a no-op guard.`,
      );
    }
    for (const path of rootFiles) {
      const text = readFileSync(path, 'utf8');
      files.push({
        path: relative(REPO_ROOT, path).split('\\').join('/'),
        text,
        sites: importSites(text),
      });
    }
  }
  return files;
}

const SCANNED = scanAllRoots();

/**
 * The files that name a strategy in prose or as a string literal and must stay
 * clean. Every one predates the routers, which is the point: they are the
 * evidence that this scan matches imports rather than mentions.
 */
const PROSE_FILES: readonly string[] = [
  'packages/kept-core/src/model/promise.ts',
  'packages/kept-core/src/kane/failureYaml.ts',
  'packages/kept-core/src/index.ts',
  'packages/kept-cli/src/config.ts',
];

describe('source scan 3 of 6 — the scan itself is not a no-op', () => {
  it('found source files under every scan root', () => {
    expect(SCANNED.length).toBeGreaterThanOrEqual(SCAN_ROOTS.length);
    for (const root of SCAN_ROOTS) {
      expect(SCANNED.some((file) => file.path.startsWith(`${root}/`))).toBe(true);
    }
  });

  it('found import sites at all, so the extractor is not silently empty', () => {
    const total = SCANNED.reduce((count, file) => count + file.sites.length, 0);
    expect(total).toBeGreaterThan(SCANNED.length);
  });

  it('the fence has something behind it: router.ts imports both concretes', () => {
    const router = SCANNED.find((file) => file.path === `${FENCE}router.ts`);
    expect(router, `${FENCE}router.ts was not scanned — has it moved?`).toBeDefined();
    const specifiers = (router?.sites ?? []).map((site) => site.specifier);
    for (const module of CONCRETE_MODULES) {
      expect(
        specifiers.some((specifier) => specifier.includes(module)),
        `${FENCE}router.ts no longer imports ${module} — the selection table moved, and this ` +
          `scan is now fencing nothing.`,
      ).toBe(true);
    }
    // And the exemption is load-bearing: without it, router.ts is a violation.
    expect((router?.sites ?? []).flatMap(violationsAt).length).toBeGreaterThanOrEqual(2);
  });

  it('trips on each banned import form when handed one', () => {
    const evasions = [
      "import { resultCode740Router } from '../verdict/resultCode740.js';",
      "import { failureYamlTriageRouter } from '@kept/core';",
      "import type { VerdictRouter } from '../verdict/failureYamlTriage.js';",
      "export { resultCode740Router } from './verdict/resultCode740.js';",
      "import '@kept/core/dist/verdict/failureYamlTriage.js';",
      "const mod = await import('./verdict/resultCode740.js');",
      "const mod = require('@kept/core/dist/verdict/resultCode740.js');",
      "import * as strategy from '../../packages/kept-core/src/verdict/failureYamlTriage.js';",
    ];
    for (const line of evasions) {
      expect(
        importSites(line).flatMap(violationsAt).length,
        `pattern set failed to catch: ${line}`,
      ).toBeGreaterThan(0);
    }
  });

  it('does not trip on a mention, a config literal, or the legal door', () => {
    const allowed = [
      `import { ${DOOR} } from '@kept/core';`,
      "import { selectRouter, type VerdictRouter } from '../verdict/router.js';",
      "export type RepairStrategy = 'resultCode740' | 'failureYamlTriage';",
      "export const VERDICT_ROUTER_NAMES = ['resultCode740', 'failureYamlTriage'] as const;",
      "const router = name === 'resultCode740' ? primary : fallback;",
      '// nothing outside src/verdict imports resultCode740Router or the triage router',
      "/** Falls back to resultCode740 with a diagnostic. See failureYamlTriage. */",
      "report({ message: `verdictRouter is ${name}; using resultCode740` });",
      "const url = 'https://example.invalid/verdict/resultCode740.js is only prose';",
    ];
    for (const line of allowed) {
      expect(
        importSites(line).flatMap(violationsAt),
        `pattern set false-positived on: ${line}`,
      ).toEqual([]);
    }
  });

  it('the files that name a strategy in prose were scanned and are clean', () => {
    for (const path of PROSE_FILES) {
      const file = SCANNED.find((scanned) => scanned.path === path);
      expect(file, `${path} was not scanned — has it moved?`).toBeDefined();
      expect(
        CONCRETE_MODULES.some((module) => (file?.text ?? '').includes(module)),
        `${path} no longer names a strategy, so it no longer evidences mention-versus-import.`,
      ).toBe(true);
      expect((file?.sites ?? []).flatMap(violationsAt)).toEqual([]);
    }
  });
});

describe('source scan 3 of 6 — selectRouter is the only door, and it works', () => {
  it('reaches both strategies, and each names itself', () => {
    for (const name of VERDICT_ROUTER_NAMES) {
      expect(selectRouter({ verdictRouter: name }).name).toBe(name);
    }
    const distinct = new Set(
      VERDICT_ROUTER_NAMES.map((name) => selectRouter({ verdictRouter: name })),
    );
    expect(distinct.size).toBe(VERDICT_ROUTER_NAMES.length);
  });

  it('routes through both strategies, so the fence is not green by disuse', () => {
    for (const name of VERDICT_ROUTER_NAMES) {
      const routed = selectRouter({ verdictRouter: name }).route(
        createFailureContext({
          family: 'ExecutionTestrun',
          terminal: { verdict: { confirmed: true, category: 'product_bug' } },
          promiseId: 'p_000000000000',
        }),
      );
      expect(isRepairAnnotation(routed)).toBe(true);
      expect(REPAIR_BRANCHES).toContain(routed.branch);
    }
  });

  it('exports the door and neither concrete from the package barrel', () => {
    const exported = Object.keys(barrel);
    expect(exported).toContain(DOOR);
    for (const symbol of CONCRETE_SYMBOLS) {
      expect(
        exported,
        `@kept/core exports ${symbol}. The barrel is the widest door in the repository: ` +
          `exporting a concrete strategy makes every consumer able to depend on one, which is ` +
          `exactly what R6.10 forbids.`,
      ).not.toContain(symbol);
    }
  });
});

describe('source scan 3 of 6 — no concrete router import outside src/verdict', () => {
  it('finds no banned import in any policed source file', () => {
    const offences: string[] = [];
    for (const file of SCANNED) {
      if (file.path.startsWith(FENCE)) continue;
      for (const site of file.sites) {
        for (const reason of violationsAt(site)) {
          offences.push(`${file.path}:${site.line}  ${reason}`);
        }
      }
    }

    expect(
      offences,
      offences.length === 0
        ? ''
        : `Only ${FENCE} may import a concrete verdict strategy; every other consumer goes ` +
          `through ${DOOR} (design §6.4, R6.10, R6.14). The verdict spike's outcome has to ` +
          `remain one string in .kept/config.json, and a direct import turns it into a code ` +
          `change at every call site. Offending imports:\n${offences.join('\n')}`,
    ).toEqual([]);
  });
});
