import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Source scan 7 of 7 — no repository-specific literal in the engine
 * (design §20.1, §20.2, R15.2, R15.3).
 *
 * An architectural guard, not coverage, and the sibling of `no-raw-result-code.test.ts`
 * in every respect: it reads shipped source, it bans a *syntax* rather than checking a
 * behaviour, and it exists because the defect it catches is invisible to every other
 * test in the repository.
 *
 * ## Why a literal is the one defect a unit test cannot see
 *
 * `kept-core` and `@corgod/kept-cli` are packages a stranger installs. Every path this
 * repository uses resolves here whether or not it was read from configuration, so a
 * hard-coded `apps/fixture/lib/**` inside the fence table passes every test, renders a
 * correct ledger, and closes the loop — right up until someone runs `kept verify` in a
 * repository that has no `apps/fixture`. Then the blast radius selects nothing, the
 * fence grants nothing, and the tool reports success on a repository it never looked
 * at. "Zero promises" and "the engine is looking in the wrong place" are the same
 * output. Nothing but a ban on the syntax distinguishes them ahead of time.
 *
 * §20.2 puts it plainly: **this scan failed on its first run, and that was its point.**
 * The literals existed — three fixture source globs and two documentation paths in
 * `handoff/handoff.ts`, `TEST_DOCUMENT_ROOT` in `radius/plan.ts`, `DEFAULT_CORPUS_ROOT`
 * in `commands/init.ts`. The commit that added this file is the commit that moved them
 * into `Kept_Config`, so the guard and the compliance landed together.
 *
 * ## The four bans
 *
 * 1. **Any string containing `apps/fixture`.** The fixture is one repository's demo
 *    application. The engine may not know its name.
 * 2. **`3100` anywhere in code.** The fixture's dev-server port. Banned as a bare
 *    token rather than only beside the word "port", because `:3100` in a template
 *    literal and `3100` handed to a `URL` constructor are the same defect and neither
 *    spells the word.
 * 3. **A path-shaped `tests` literal.** The corpus root is `corpus.root`, and the
 *    conventional value is spelled in exactly one place (see {@link ALLOWANCES}).
 * 4. **`localhost:` followed by a digit.** A base URL the engine invented is a probe
 *    against a port on a stranger's machine, which `subject.baseUrl: null` exists to
 *    refuse (§20.4).
 *
 * ## What is permitted, and why each permission is narrow
 *
 * **Comments.** The scan strips them before looking. A comment recording *why* a value
 * used to be a literal is documentation, and this file is the reason those comments
 * exist — `handoff.ts` and `plan.ts` both carry a paragraph naming what left and what
 * would go wrong if it came back. Banning the prose would delete the explanation and
 * keep only the rule.
 *
 * **`packages/*​/test/**` and `test/fixtures/**`.** Not by exception but by
 * construction: {@link SCAN_ROOTS} is the two `src` trees and nothing else. A fixture
 * naming a path is a fixture, and a test that cannot name the tree it exercises cannot
 * exercise it.
 *
 * **Three named allowances**, each with a reason and each checked to still match
 * something, so a stale allowance fails rather than quietly widening the guard.
 *
 * ## The one distinction the scan has to draw
 *
 * `kane/family.ts` contains `['design', 'tests']`. That is an **argv array** — the two
 * words of the `kane-cli design tests` subcommand — and not a directory. It is not
 * fixed and it is not exempted; it simply is not what the scan bans. A `tests` literal
 * counts as path-shaped when it carries a `/`, or when it is assigned to a name that
 * says it is a location: `root`, `dir`, `directory`, `path`, `corpus`. An element of an
 * array literal preceded by a comma is none of those. That is the whole discriminator,
 * and {@link ALLOWANCES} deliberately contains no entry for `family.ts`, because an
 * exemption there would be the scan admitting it cannot tell a path from a word.
 */

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** Both published source trees. Anything outside them is not shipped logic. */
const SCAN_ROOTS = ['packages/kept-core/src', 'packages/kept-cli/src'] as const;

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'] as const;
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', '.next', 'coverage']);

/**
 * One permitted occurrence: a file, the text that identifies the line, and why.
 *
 * Three entries, and each is a *different kind* of reason rather than three of the
 * same. The scan asserts every one still matches, because an allowance for a line that
 * no longer exists is a hole nobody is watching.
 */
interface Allowance {
  readonly file: string;
  /** A substring of the offending line, precise enough to identify one line. */
  readonly line: string;
  readonly why: string;
}

const ALLOWANCES: readonly Allowance[] = Object.freeze([
  {
    file: 'packages/kept-cli/src/config.ts',
    line: "corpus: Object.freeze({ root: 'tests' })",
    why:
      "§20.4's documented default for `corpus.root`, inside `DEFAULT_CONFIG`. A " +
      'documented default has to be spelled somewhere or it is not a default, and this ' +
      'is the one home: `init` reads it from here rather than declaring its own, which ' +
      'is the duplicate this scan was written to delete.',
  },
  {
    file: 'packages/kept-core/src/kane/packTriage.ts',
    line: "export const PACK_TESTS_PREFIX = 'tests/'",
    why:
      "A path *inside a Kane sealed pack archive*, not a directory in the host " +
      "repository. Kane lays a pack out as `tests/<slug>/result.yaml`, and that layout " +
      'is Kane 0.8.4\u2019s to decide. Making it configurable would let a config change ' +
      'what KEPT believes another tool\u2019s archive format to be.',
  },
  {
    file: 'packages/kept-core/src/providers/baseline.ts',
    line: "export const TEST_DOCUMENT_SUFFIX = '_test.md'",
    why:
      'A filename suffix, not a directory. `*_test.md` is the Kane document convention ' +
      'the whole product is built on and it is the same in every repository, so it is ' +
      'not a portability fact. Listed because the scan sees the word `test` here and a ' +
      'reader should know it was looked at rather than missed.',
  },
]);

function isSourceFile(name: string): boolean {
  return SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/**
 * Hand-rolled recursive walk. No glob dependency — the runtime budget is closed at the
 * nine packages of design §2.2 and `micromatch` is explicitly not in it.
 */
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
      } else if (entry.isFile() && isSourceFile(entry.name)) {
        found.push(child);
      }
    }
  }
  return found.sort();
}

/**
 * Replace every comment with spaces, leaving the code and the line structure intact.
 *
 * A state machine rather than a regular expression, and that is not fussiness: a
 * pattern that removes `//` to end-of-line also removes the tail of every line
 * containing a URL, and a pattern that removes `/* ... *␌/` spans also eats any string
 * holding those two characters. Both mistakes fail *open*, hiding a real literal.
 *
 * Comment bytes become spaces rather than being deleted, so a reported column and line
 * still point where a reader can look.
 */
export function stripComments(source: string): string {
  const out: string[] = [];
  let index = 0;
  const blank = (text: string): void => {
    for (const character of text) out.push(character === '\n' ? '\n' : ' ');
  };

  while (index < source.length) {
    const character = source[index] as string;
    const next = source[index + 1];

    if (character === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      const stop = end < 0 ? source.length : end;
      blank(source.slice(index, stop));
      index = stop;
      continue;
    }
    if (character === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end < 0 ? source.length : end + 2;
      blank(source.slice(index, stop));
      index = stop;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      // Copy the whole literal verbatim, escapes included, so a `//` or a `/*` inside
      // it is never mistaken for the start of a comment.
      out.push(character);
      index += 1;
      while (index < source.length) {
        const inner = source[index] as string;
        out.push(inner);
        index += 1;
        if (inner === '\\') {
          if (index < source.length) {
            out.push(source[index] as string);
            index += 1;
          }
          continue;
        }
        if (inner === character) break;
      }
      continue;
    }
    out.push(character);
    index += 1;
  }
  return out.join('');
}

/** One string literal found in code, with what preceded it on its line. */
interface Literal {
  readonly value: string;
  /** Everything on the line before the opening quote, trimmed of trailing space. */
  readonly before: string;
}

/** Every quoted or backticked literal on one line of comment-free code. */
export function literalsOn(line: string): readonly Literal[] {
  const found: Literal[] = [];
  let index = 0;
  while (index < line.length) {
    const quote = line[index] as string;
    if (quote !== "'" && quote !== '"' && quote !== '`') {
      index += 1;
      continue;
    }
    const before = line.slice(0, index).trimEnd();
    let cursor = index + 1;
    let value = '';
    while (cursor < line.length) {
      const inner = line[cursor] as string;
      if (inner === '\\') {
        cursor += 2;
        continue;
      }
      if (inner === quote) break;
      value += inner;
      cursor += 1;
    }
    found.push({ value, before });
    index = cursor + 1;
  }
  return found;
}

/** Names that mean "this string is a location". The whole argv discriminator. */
const LOCATION_NAME = /(root|dir|directory|path|corpus)$/i;

/**
 * Is this `tests` literal path-shaped, as opposed to a word in an argv array?
 *
 * Two ways to qualify. Carrying a `/` with `tests` as the first segment is a path by
 * spelling. Being assigned to a name that ends in `root`, `dir`, `directory`, `path` or
 * `corpus` is a path by declaration — `TEST_DOCUMENT_ROOT = 'tests'` and
 * `{ root: 'tests' }` both say what the string is for.
 *
 * `['design', 'tests']` qualifies under neither, which is the point: the scan does not
 * exempt Kane's subcommand pair, it simply does not consider a comma-preceded array
 * element to be a directory.
 */
export function isPathShapedTestsLiteral(literal: Literal): boolean {
  const value = literal.value.replace(/\\/g, '/');
  if (value === 'tests/' || value.startsWith('tests/')) return true;
  if (value !== 'tests') return false;
  const before = literal.before;
  if (!/[=:]$/.test(before)) return false;
  const name = before.slice(0, -1).trimEnd();
  return LOCATION_NAME.test(name.replace(/[^\w$]+$/, ''));
}

/** One thing the scan found. */
interface Offence {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly text: string;
}

/** Scan one file's comment-free code. */
function offencesIn(file: string, source: string): readonly Offence[] {
  const offences: Offence[] = [];
  const lines = stripComments(source).split('\n');
  lines.forEach((line, index) => {
    const at = index + 1;
    const record = (rule: string): void => {
      offences.push({ file, line: at, rule, text: line.trim() });
    };

    if (line.includes('apps/fixture')) record('a fixture path literal (`apps/fixture`)');
    // A bare numeric token, so `31000` and `13100` are not false positives while
    // `:3100`, `3100`, `3_100` and `port=3100` all are.
    if (/(?<![\w.])3_?100(?![\w.])/.test(line)) record('the fixture port literal (`3100`)');
    if (/localhost:\d/.test(line)) record('a `localhost:<port>` literal');
    for (const literal of literalsOn(line)) {
      if (isPathShapedTestsLiteral(literal)) record('a corpus-root literal (`tests`)');
    }
  });
  return offences;
}

interface ScannedFile {
  readonly path: string;
  readonly source: string;
}

/**
 * Scan every root once, asserting as it goes that each root exists and yields at least
 * one file. A refactor that moved or renamed `src/` would otherwise turn this whole
 * guard into a silently green no-op, which is a worse outcome than the violation it
 * exists to catch.
 */
function scanAllRoots(): ScannedFile[] {
  const files: ScannedFile[] = [];
  for (const root of SCAN_ROOTS) {
    const absoluteRoot = resolve(REPO_ROOT, root);
    const stats = statSync(absoluteRoot, { throwIfNoEntry: false });
    if (stats === undefined || !stats.isDirectory()) {
      throw new Error(
        `Source-scan root ${root} does not exist. The guard cannot be allowed to pass ` +
          `by scanning nothing — update SCAN_ROOTS to the tree's new shape.`,
      );
    }
    const rootFiles = collectSourceFiles(absoluteRoot);
    if (rootFiles.length === 0) {
      throw new Error(
        `Source-scan root ${root} contains no TypeScript files. Either the tree moved ` +
          `or the extension list is stale; a zero-file scan is a no-op guard.`,
      );
    }
    for (const path of rootFiles) {
      files.push({
        path: relative(REPO_ROOT, path).split('\\').join('/'),
        source: readFileSync(path, 'utf8'),
      });
    }
  }
  return files;
}

const SCANNED = scanAllRoots();

/** Whether an offence is one of the three named allowances. */
function allowanceFor(offence: Offence): Allowance | undefined {
  return ALLOWANCES.find(
    (allowance) => allowance.file === offence.file && offence.text.includes(allowance.line),
  );
}

const OFFENCES = SCANNED.flatMap((file) => offencesIn(file.path, file.source));

describe('source scan 7 of 7 — the scan itself is not a no-op', () => {
  it('found source files under every scan root', () => {
    expect(SCANNED.length).toBeGreaterThanOrEqual(SCAN_ROOTS.length);
    for (const root of SCAN_ROOTS) {
      expect(SCANNED.some((file) => file.path.startsWith(`${root}/`))).toBe(true);
    }
  });

  it('scans only shipped source, so tests and fixtures are permitted by construction', () => {
    // §20.2 permits all four literals inside `packages/*​/test/**` and
    // `test/fixtures/**`. That permission is the shape of `SCAN_ROOTS` rather than an
    // exception list, which is why no test file can be forgotten off it.
    for (const file of SCANNED) {
      expect(file.path).not.toContain('/test/');
      expect(file.path).toContain('/src/');
    }
  });

  it('trips on each banned form when handed one', () => {
    const evasions: readonly [string, string][] = [
      ["  allowedPaths: ['apps/fixture/lib/**'],", 'fixture path'],
      ['  const url = `http://localhost:3100/cart`;', 'localhost port'],
      ['  const port = 3100;', 'bare port'],
      ["  export const TEST_DOCUMENT_ROOT = 'tests';", 'corpus root by name'],
      ["  export const CORPUS_DIR = 'tests';", 'corpus root by name'],
      ["  const glob = 'tests/**';", 'corpus root by slash'],
      ["  scan({ root: 'tests' });", 'corpus root as a property'],
    ];
    for (const [line, label] of evasions) {
      expect(
        offencesIn('probe.ts', line).length,
        `the scan failed to catch ${label}: ${line}`,
      ).toBeGreaterThan(0);
    }
  });

  it('does not trip on the shapes that are allowed', () => {
    const allowed: readonly string[] = [
      "  const suffix = '_test.md';",
      "  const argv = ['design', 'tests'];",
      "  const pair: readonly string[] = ['tests', 'design'];",
      '  const budget = 31000;',
      '  const other = 13100;',
      "  const marker = '@verifies';",
      "  const glob = config.corpus.root + '/**';",
      "  if (name.endsWith('_test.md')) return true;",
      "  const attempts = 'tested';",
    ];
    for (const line of allowed) {
      expect(offencesIn('probe.ts', line), `false positive on: ${line}`).toEqual([]);
    }
  });

  it('strips comments without eating the code beside them', () => {
    // The failure mode a regular expression would have: a URL in a string, and a
    // comment on the same line as real code.
    const stripped = stripComments("const a = 'http://x/y'; // tests/ and apps/fixture\n");
    expect(stripped).toContain("'http://x/y'");
    expect(stripped).not.toContain('apps/fixture');
    expect(stripped.split('\n')).toHaveLength(2);

    const block = stripComments("/* apps/fixture */ const b = 'ok';");
    expect(block).not.toContain('apps/fixture');
    expect(block).toContain("const b = 'ok';");

    // And a `/*` living inside a string must not open a comment that swallows the
    // rest of the file — which is how a naive stripper hides every later literal.
    const inString = stripComments("const c = '/*'; const d = 'apps/fixture/lib/x.ts';");
    expect(inString).toContain('apps/fixture/lib/x.ts');
  });

  it('permits a documentation comment that names a fixture path', () => {
    // The permission of §20.2, exercised against the real prose rather than a probe.
    // Several modules illustrate a `@verifies` tag or a `covers:` glob with the
    // fixture's own paths, because an example of a tag with no path in it teaches
    // nothing. Every one of those files is clean.
    const documenting = SCANNED.filter((file) => file.source.includes('apps/fixture'));
    expect(
      documenting.length,
      'no shipped file mentions the fixture even in prose, so the comment permission is ' +
        'untested — either the examples were deleted or the scan is reading the wrong tree',
    ).toBeGreaterThan(0);
    for (const file of documenting) {
      expect(offencesIn(file.path, file.source), `${file.path} is not clean`).toEqual([]);
    }
  });
});

describe('source scan 7 of 7 — every allowance is live and reasoned', () => {
  it.each(ALLOWANCES.map((allowance) => [allowance.file, allowance] as const))(
    '%s still contains the line its allowance names',
    (_file, allowance) => {
      const file = SCANNED.find((scanned) => scanned.path === allowance.file);
      expect(file, `${allowance.file} was not scanned — has it moved?`).toBeDefined();
      expect(
        file?.source.includes(allowance.line),
        `the allowance for ${allowance.file} names a line that is no longer there, so it ` +
          `is a hole nobody is watching. Delete it, or point it at the line that replaced ` +
          `it. Reason on record: ${allowance.why}`,
      ).toBe(true);
      expect(allowance.why.length).toBeGreaterThan(40);
    },
  );

  it('holds no allowance for the Kane subcommand pair in family.ts', () => {
    // `['design', 'tests']` is an argv element and the scan distinguishes it by shape,
    // so exempting it would be the guard admitting it cannot tell a path from a word.
    expect(ALLOWANCES.some((allowance) => allowance.file.endsWith('kane/family.ts'))).toBe(
      false,
    );
    const family = SCANNED.find(
      (file) => file.path === 'packages/kept-core/src/kane/family.ts',
    );
    expect(family?.source).toContain("['design', 'tests']");
    expect(offencesIn('family.ts', family?.source ?? '')).toEqual([]);
  });
});

describe('source scan 7 of 7 — no repository-specific literal in the shipped engine', () => {
  it('finds no fixture path, no fixture port and no corpus root outside the allowances', () => {
    const unexcused = OFFENCES.filter((offence) => allowanceFor(offence) === undefined);

    expect(
      unexcused.map((offence) => `${offence.file}:${offence.line}  ${offence.rule}\n    ${offence.text}`),
      unexcused.length === 0
        ? ''
        : `Repository-specific values belong in .kept/config.json, not in the engine ` +
          `(design §20.1, §20.2, R15.2, R15.3). corpus.root, subject.source, ` +
          `subject.docs and subject.baseUrl are the four keys; the fence surfaces reach ` +
          `kept-core as parameters because @corgod/kept-cli depends on kept-core and not the ` +
          `other way round. A literal here is invisible until someone runs kept in a ` +
          `repository that does not have it, and then the tool reports success on a ` +
          `tree it never looked at. Offending lines:\n` +
          unexcused
            .map((offence) => `${offence.file}:${offence.line}  ${offence.rule}\n    ${offence.text}`)
            .join('\n'),
    ).toEqual([]);
  });

  it('names no fixture path in either published tree', () => {
    for (const file of SCANNED) {
      expect(
        stripComments(file.source).includes('apps/fixture'),
        `${file.path} names the fixture in executable code`,
      ).toBe(false);
    }
  });

  it('carries no port literal and no localhost origin at all', () => {
    for (const file of SCANNED) {
      const code = stripComments(file.source);
      expect(/(?<![\w.])3_?100(?![\w.])/.test(code), `${file.path} spells 3100`).toBe(false);
      expect(/localhost:\d/.test(code), `${file.path} spells a localhost port`).toBe(false);
    }
  });
});
