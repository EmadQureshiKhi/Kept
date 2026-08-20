/**
 * Source scan 4 of 6 — the `animejs` import shape, its location, and its pin
 * (task 17.2, design §10.6, §10.6.4, §2.2, R10.4).
 *
 * Three claims, and none of them is about style:
 *
 *   1. **Named imports only.** A default or namespace import pulls the whole engine
 *      into the module graph, and with it every entry point §10.6.3 refuses —
 *      scroll observers, physics easings, the loop parameters. Named imports are
 *      what make the forbidden list enforceable by *absence*: if the symbol was
 *      never imported, no call site can reach it. A bare `import 'animejs'` is
 *      rejected for the same reason a namespace import is: it is not a narrowing.
 *   2. **One location.** The gate of §10.6.4 only means something if it is the
 *      single door. Task 17.2 allowlists `lib/motion.tsx` and `components/**`; the
 *      design states the stricter thing — that `lib/motion` is the *only* module
 *      that imports the engine — and both are asserted below, the strict one with
 *      a message that says what to do if it ever needs to be widened.
 *   3. **An exact pin, inside a closed budget.** `animejs` is pinned to the string
 *      `4.5.0`, not a range, because §18.1's cut of last resort is "delete the five
 *      flourishes and the dependency"; a range would make that cut a version bump
 *      as well as a deletion. And the runtime dependency count is exactly nine
 *      (§2.2), which is the number the whole design budgets against a 7 GB disk.
 *
 * **Scope.** The import rules read shipped Ledger code with `apps/ledger/test/`
 * excluded, because the fixtures in this file construct every violation it detects
 * and a scan that failed on its own counter-examples could only be kept green by
 * weakening it. That exclusion is asserted rather than assumed. The gate file is
 * asserted to be present, scanned, and to carry a real named import, so the
 * location rule cannot pass by finding nothing.
 *
 * A zero-file scan is a failure, exactly as in `_scan.ts`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CODE_EXTENSIONS, REPO_ROOT, scanLedger, type ScannedFile } from './_scan.js';

/* ─────────────────────────────── what is allowed ───────────────────────────── */

/** The gate. `.tsx` because its subject is the DOM — see the header of that file. */
const GATE = 'apps/ledger/lib/motion.tsx';

/** The second location task 17.2 permits. */
const COMPONENTS = 'apps/ledger/components/';

const TEST_DIRECTORY = 'apps/ledger/test/';

/** The package name, and the only specifier that may carry it. */
const PACKAGE = 'animejs';
const EXACT_VERSION = '4.5.0';

/**
 * The nine runtime dependencies of §2.2, in the order the design tabulates them.
 *
 * `tailwindcss` is in the list and currently unused — `@tailwindcss/postcss` is not
 * installed and both apps ship hand-written CSS. It stays because the budget is the
 * design's, not an inventory of what is imported today; removing it to tidy up
 * would change a number this scan exists to hold still.
 */
const RUNTIME_BUDGET: readonly string[] = [
  'next',
  'react',
  'react-dom',
  'tailwindcss',
  '@xyflow/react',
  'zod',
  'yaml',
  'clsx',
  'animejs',
];

const SHIPPED: ScannedFile[] = scanLedger(CODE_EXTENSIONS).filter(
  (file) => !file.path.startsWith(TEST_DIRECTORY),
);

/* ────────────────────────────── the classifier ─────────────────────────────── */

/**
 * How a module reached for the engine.
 *
 * `named` is the only acceptable kind. The rest are enumerated rather than lumped
 * into "bad" so the failure message can say which mistake was made.
 */
export type ImportKind = 'named' | 'default' | 'namespace' | 'bare' | 'dynamic' | 'require';

export interface AnimejsImport {
  /** The specifier as written, so a deep path is reported verbatim. */
  readonly specifier: string;
  readonly kind: ImportKind;
  /** 1-based line of the specifier. */
  readonly line: number;
}

/** Any string literal whose specifier is the package or a path inside it. */
const SPECIFIER = /(['"])(animejs(?:\/[^'"]*)?)\1/g;

/** The clause that introduced it, found by walking back from the specifier. */
const CLAUSE_START = /\b(?:import|require)\b(?![\s\S]*\b(?:import|require)\b)/;

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index && cursor < text.length; cursor += 1) {
    if (text[cursor] === '\n') line += 1;
  }
  return line;
}

/**
 * Every reference to the engine in a source text, classified.
 *
 * Works backwards from the specifier to the `import` or `require` that introduced
 * it, rather than forwards from the keyword, because an import list is free to wrap
 * across lines and a line-oriented rule would read a wrapped one as no import at
 * all. A specifier with no keyword before it is not an import — a rendered string,
 * a comment, this file's own prose — and is not reported.
 */
export function animejsImports(text: string): AnimejsImport[] {
  const found: AnimejsImport[] = [];
  for (const match of text.matchAll(SPECIFIER)) {
    const specifier = match[2] ?? '';
    const at = match.index ?? 0;
    const prefix = text.slice(0, at);
    const keyword = CLAUSE_START.exec(prefix);
    if (keyword === null) continue;
    const clause = prefix.slice(keyword.index);
    /* a statement ended between the keyword and this specifier, so the specifier
       belongs to something else — a rendered string, a comment, a table of names */
    if (clause.includes(';')) continue;
    const kind = classify(clause);
    if (kind === null) continue;
    found.push({ specifier, kind, line: lineOf(text, at) });
  }
  return found;
}

function classify(clause: string): ImportKind | null {
  if (/^require\s*\(/.test(clause)) return 'require';
  if (/^import\s*\(/.test(clause)) return 'dynamic';
  if (/^import\s*$/.test(clause)) return 'bare';
  if (!/\bfrom\s*$/.test(clause)) return null;
  const bindings = clause.replace(/^import\b/, '').replace(/\bfrom\s*$/, '').trim();
  if (/^\*\s*as\b/.test(bindings)) return 'namespace';
  if (/^(?:type\s+)?\{/.test(bindings)) return 'named';
  if (bindings === '') return 'bare';
  return 'default';
}

/** Where an import is permitted to live. */
export function locationAllowed(path: string): boolean {
  return path === GATE || path.startsWith(COMPONENTS);
}

function report(offences: readonly string[], rule: string): void {
  expect(
    offences,
    offences.length === 0
      ? ''
      : `animejs import scan — ${rule} (design §10.6.4, §2.2, R10.4).\n${offences.join('\n')}`,
  ).toEqual([]);
}

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
}

const MANIFEST: PackageManifest = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'),
) as PackageManifest;

const DEPENDENCIES: Readonly<Record<string, string>> = MANIFEST.dependencies ?? {};

/* ───────────────────────────────── meta-tests ──────────────────────────────── */

describe('the animejs import scan is not a no-op', () => {
  it('scanned shipped Ledger code with its own fixtures excluded, and says which', () => {
    expect(SHIPPED.length, 'no shipped code file was scanned').toBeGreaterThan(0);
    expect(SHIPPED.every((file) => !file.path.startsWith(TEST_DIRECTORY))).toBe(true);
  });

  it('throws rather than passing when a scan root yields no files', () => {
    expect(() => scanLedger(['.no-such-extension'])).toThrow(/no-op guard/);
  });

  it('found the gate, and found a real named import inside it', () => {
    const gate = SHIPPED.find((file) => file.path === GATE);
    expect(
      gate,
      `${GATE} was not scanned. It is the one module permitted to import ${PACKAGE}, so ` +
        `its absence would make every rule below pass by inspecting nothing.`,
    ).toBeDefined();
    const imports = animejsImports(gate?.text ?? '');
    expect(imports.length, `${GATE} imports ${PACKAGE} zero times`).toBeGreaterThan(0);
    expect(imports.every((entry) => entry.kind === 'named')).toBe(true);
    expect(imports.every((entry) => entry.specifier === PACKAGE)).toBe(true);
  });

  it('classifies every import shape, and reads a wrapped list correctly', () => {
    const cases: readonly { readonly source: string; readonly kind: ImportKind }[] = [
      { source: `import { animate } from '${PACKAGE}';`, kind: 'named' },
      { source: `import type { Timeline } from '${PACKAGE}';`, kind: 'named' },
      { source: `import anime from '${PACKAGE}';`, kind: 'default' },
      { source: `import anime, { animate } from '${PACKAGE}';`, kind: 'default' },
      { source: `import * as anime from '${PACKAGE}';`, kind: 'namespace' },
      { source: `import '${PACKAGE}';`, kind: 'bare' },
      { source: `const engine = await import('${PACKAGE}');`, kind: 'dynamic' },
      { source: `const engine = require('${PACKAGE}');`, kind: 'require' },
    ];
    for (const example of cases) {
      const found = animejsImports(example.source);
      expect(found.length, `missed an import in: ${example.source}`).toBe(1);
      expect(found[0]?.kind, `misread: ${example.source}`).toBe(example.kind);
    }

    const wrapped = `import {\n  animate,\n  utils,\n} from '${PACKAGE}';`;
    const found = animejsImports(wrapped);
    expect(found.length).toBe(1);
    expect(found[0]?.kind).toBe('named');
    expect(found[0]?.line).toBe(4);
  });

  it('reports a deep path verbatim and ignores a specifier that is not an import', () => {
    const deep = animejsImports(`import { animate } from '${PACKAGE}/lib/anime.es.js';`);
    expect(deep[0]?.specifier).toBe(`${PACKAGE}/lib/anime.es.js`);

    expect(animejsImports(`const label = '${PACKAGE}';`)).toEqual([]);
    expect(animejsImports(`/* the engine is ${PACKAGE} */`)).toEqual([]);

    /* the case a keyword-only rule gets wrong: a real import above, and the package
       named as data below. Only the first is an import. */
    const mixed = `import { animate } from '${PACKAGE}';\n\nconst engine = '${PACKAGE}';\n`;
    const found = animejsImports(mixed);
    expect(found.length, 'a package name used as data was read as an import').toBe(1);
    expect(found[0]?.line).toBe(1);
  });

  it('allows only the two locations task 17.2 names', () => {
    expect(locationAllowed(GATE)).toBe(true);
    expect(locationAllowed(`${COMPONENTS}PromiseNode.tsx`)).toBe(true);
    expect(locationAllowed('apps/ledger/lib/layout.ts')).toBe(false);
    expect(locationAllowed('apps/ledger/app/page.tsx')).toBe(false);
  });
});

/* ─────────────────────── rule 1 — named imports, nothing else ──────────────── */

describe('the engine is imported by name or not at all', () => {
  const WHY: Readonly<Record<Exclude<ImportKind, 'named'>, string>> = {
    default: `a default import binds the whole engine; §10.6 names the symbols it uses`,
    namespace: `a namespace import binds the whole engine, including the entry points §10.6.3 refuses`,
    bare: `an import with no bindings narrows nothing and runs the module for its side effects`,
    dynamic: `a dynamic import yields the whole namespace at runtime, past every static rule here`,
    require: `a require() yields the whole module and is not how this repository imports anything`,
  };

  it('never imports the engine as a default, a namespace, a bare module or a require', () => {
    const offences: string[] = [];
    for (const file of SHIPPED) {
      for (const entry of animejsImports(file.text)) {
        if (entry.kind === 'named') continue;
        offences.push(`${file.path}:${entry.line}  ${entry.kind} import — ${WHY[entry.kind]}`);
      }
    }
    report(offences, 'named imports are what make the forbidden list enforceable by absence');
  });

  it('never reaches inside the package for a deep path', () => {
    const offences: string[] = [];
    for (const file of SHIPPED) {
      for (const entry of animejsImports(file.text)) {
        if (entry.specifier === PACKAGE) continue;
        offences.push(
          `${file.path}:${entry.line}  imports "${entry.specifier}"; the package's own ` +
            `exports map is the contract, and a path inside its dist is not`,
        );
      }
    }
    report(offences, 'the bare specifier is the only supported one');
  });
});

/* ──────────────────────── rule 2 — one door, and one only ──────────────────── */

describe('the gate is the only way in', () => {
  it('imports the engine nowhere outside the gate and the components tree', () => {
    const offences: string[] = [];
    for (const file of SHIPPED) {
      if (locationAllowed(file.path)) continue;
      for (const entry of animejsImports(file.text)) {
        offences.push(
          `${file.path}:${entry.line}  imports ${PACKAGE}. Every orchestration goes ` +
            `through play() in ${GATE} (§10.6.4); that gate is what makes each of the ` +
            `five flourishes individually droppable (§18.1)`,
        );
      }
    }
    report(offences, 'the reduced-motion state is a property of the gate, so nothing bypasses it');
  });

  it('keeps the gate the single importer the design claims it is', () => {
    const importers = SHIPPED.filter((file) => animejsImports(file.text).length > 0).map(
      (file) => file.path,
    );
    expect(
      importers,
      `Design §10.6.4 states that ${GATE} is the *only* module that imports ${PACKAGE}. ` +
        `Task 17.2 allowlists components/** as well, so a component importing it is not ` +
        `a scan failure — it is a design decision, and this is where it gets recorded. ` +
        `Before making it: the gate re-exports stagger and drawable and wraps the ` +
        `timeline and animation factories with loop pinned off, so an orchestration ` +
        `should not need the engine directly.`,
    ).toEqual([GATE]);
  });
});

/* ─────────────────── rule 3 — the exact pin and the closed budget ──────────── */

describe('the dependency is pinned exactly, inside a budget of nine', () => {
  it(`pins ${PACKAGE} to the exact string ${EXACT_VERSION}`, () => {
    expect(
      DEPENDENCIES[PACKAGE],
      `${PACKAGE} must be pinned to the exact string "${EXACT_VERSION}" — no caret, no ` +
        `tilde, no range. §18.1's cut of last resort deletes the five flourishes and this ` +
        `dependency; a range would make that cut a version decision as well.`,
    ).toBe(EXACT_VERSION);
  });

  it('carries exactly nine runtime dependencies, and they are the budgeted nine', () => {
    const declared = Object.keys(DEPENDENCIES).sort();
    expect(
      declared.length,
      `the runtime budget of design §2.2 is nine packages against roughly 7 GB of free ` +
        `disk. Declared: ${declared.join(', ')}`,
    ).toBe(RUNTIME_BUDGET.length);
    expect(declared).toEqual([...RUNTIME_BUDGET].sort());
  });

  it('pins no runtime dependency to a version this scan cannot read', () => {
    const offences: string[] = [];
    for (const [name, range] of Object.entries(DEPENDENCIES)) {
      if (!/^[\^~]?\d+\.\d+\.\d+/.test(range)) {
        offences.push(`${name} is "${range}", which is not a version this budget can audit`);
      }
    }
    report(offences, 'a dependency the manifest cannot state precisely is not budgeted');
  });
});
