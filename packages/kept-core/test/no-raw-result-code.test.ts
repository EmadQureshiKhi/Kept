import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Source scan 1 of 6 — no raw `result_code` comparison (design §4.4, R3.12).
 *
 * An architectural guard, not coverage. Kane 0.8.4 types the field
 * inconsistently *within a single event*: our recorded smoke run carries the
 * number `100` at the top level and the string `"100"` inside
 * `per_flow_metadata[0]`. A comparison against an un-coerced value therefore
 * fires on one path and silently never fires on the other — and 740 is the code
 * the whole three-way repair branch keys off, so the branch would look alive
 * while never routing anything. No unit test catches that; only a ban on the
 * syntax does.
 *
 * `kane/coerce.ts` is the single exemption. Everything else reads the field
 * through `resultCode()`.
 *
 * Comments are deliberately in scope. Prose that spells out a banned comparison
 * is how the banned comparison gets copied into code later, so ranges are
 * written as words ("the 700 to 799 band") rather than as operators anywhere
 * outside the exempt file.
 */

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** Both published source trees. Anything outside them is not shipped logic. */
const SCAN_ROOTS = ['packages/kept-core/src', 'packages/kept-cli/src'] as const;

/** The one file permitted to name the field beside a comparison operator. */
const EXEMPT = 'packages/kept-core/src/kane/coerce.ts';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'] as const;
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', '.next', 'coverage']);

/**
 * The floor, from the design document:
 *
 *     /result_code\s*(===|!==|==|!=)/
 *
 * widened in three ways that each close an obvious evasion of the same spirit
 * while staying mechanical:
 *
 * 1. **Closing punctuation between the field and the operator.** Bracket access
 *    and a wrapping call both defeat the floor pattern, and both are raw
 *    comparisons: an indexed read followed by strict equality, or a hand-rolled
 *    numeric conversion of the field followed by strict equality. Optional
 *    quote and closer runs are tolerated before the operator.
 * 2. **Relational operators.** The router's assertion-class rung tests whether a
 *    coerced code falls in the 700 to 799 band. Doing that against a raw value
 *    works by accident of JS coercion on one typing and misreads the other, so
 *    the ordering operators are banned beside the raw field too.
 * 3. **The reversed ordering**, where the literal is written first and the field
 *    second.
 *
 * `=>` is excluded from pattern 3 by lookbehind, so an arrow function returning
 * an indexed read is not mistaken for a comparison, and bare ordering operators
 * are left out of pattern 3 so a generic type argument naming the field is not
 * either.
 */
const RAW_COMPARISON_PATTERNS: readonly { readonly name: string; readonly re: RegExp }[] = [
  {
    name: 'comparison operator after a raw result_code read',
    re: /result_code\s*(?:['"]\s*)?(?:[)\]]\s*)*(?:[=!]==?|[<>]=?)/,
  },
  {
    name: 'comparison operator before a raw result_code read',
    re: /(?<![=!<>+\-*/%&|^])(?:===|!==|==|!=|>=|<=)\s*[\w$.[\]'"()]{0,40}result_code/,
  },
];

function isSourceFile(name: string): boolean {
  return SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/**
 * Hand-rolled recursive walk. No glob dependency — the runtime budget is closed
 * at the nine packages of design §2.2 and `micromatch` is explicitly not in it.
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

interface ScannedFile {
  readonly path: string;
  readonly lines: readonly string[];
}

/**
 * Scan every root once, asserting as it goes that each root exists and yields at
 * least one file. A refactor that moves or renames `src/` would otherwise turn
 * this whole guard into a silently green no-op, which is a worse outcome than
 * the violation it exists to catch.
 */
function scanAllRoots(): ScannedFile[] {
  const files: ScannedFile[] = [];
  for (const root of SCAN_ROOTS) {
    const absoluteRoot = resolve(REPO_ROOT, root);
    const stats = statSync(absoluteRoot, { throwIfNoEntry: false });
    if (stats === undefined || !stats.isDirectory()) {
      throw new Error(
        `Source-scan root ${root} does not exist. The guard cannot be allowed to ` +
          `pass by scanning nothing — update SCAN_ROOTS to the tree's new shape.`,
      );
    }
    const rootFiles = collectSourceFiles(absoluteRoot);
    if (rootFiles.length === 0) {
      throw new Error(
        `Source-scan root ${root} contains no TypeScript files. Either the tree ` +
          `moved or the extension list is stale; a zero-file scan is a no-op guard.`,
      );
    }
    for (const path of rootFiles) {
      files.push({
        path: relative(REPO_ROOT, path).split('\\').join('/'),
        lines: readFileSync(path, 'utf8').split('\n'),
      });
    }
  }
  return files;
}

const SCANNED = scanAllRoots();

describe('source scan 1 of 6 — the scan itself is not a no-op', () => {
  it('found source files under every scan root', () => {
    expect(SCANNED.length).toBeGreaterThanOrEqual(SCAN_ROOTS.length);
    for (const root of SCAN_ROOTS) {
      expect(SCANNED.some((file) => file.path.startsWith(`${root}/`))).toBe(true);
    }
  });

  it('found the exempt file, and it is the file that reads the field', () => {
    const exempt = SCANNED.find((file) => file.path === EXEMPT);
    expect(exempt, `${EXEMPT} was not scanned — has it moved?`).toBeDefined();
    expect(exempt?.lines.join('\n')).toContain('result_code');
  });

  it('trips on each banned form when handed one', () => {
    const evasions = [
      "if (terminal.result_code === 740) return 'code-break';",
      "if (terminal['result_code'] === '740') return 'code-break';",
      'if (Number(terminal.result_code) >= 700) triage();',
      'if (740 === terminal.result_code) fire();',
      'if (raw.result_code != null) read();',
    ];
    for (const line of evasions) {
      expect(
        RAW_COMPARISON_PATTERNS.some(({ re }) => re.test(line)),
        `pattern set failed to catch: ${line}`,
      ).toBe(true);
    }
  });

  it('does not trip on the shapes that are allowed', () => {
    const allowed = [
      'const code = resultCode(terminal);',
      "if (resultCode(terminal) === 740) return 'code-break';",
      "readonly result_code?: number | string;",
      "const raw = readField(source, 'result_code');",
      "const codes = flows.map((flow) => flow['result_code']);",
      'export const RESULT_CODE_FIELD = \'result_code\';',
    ];
    for (const line of allowed) {
      expect(
        RAW_COMPARISON_PATTERNS.some(({ re }) => re.test(line)),
        `pattern set false-positived on: ${line}`,
      ).toBe(false);
    }
  });
});

describe('source scan 1 of 6 — no raw result_code comparison outside coerce.ts', () => {
  it('finds no banned comparison in any shipped source file', () => {
    const offences: string[] = [];
    for (const file of SCANNED) {
      if (file.path === EXEMPT) continue;
      file.lines.forEach((line, index) => {
        for (const { name, re } of RAW_COMPARISON_PATTERNS) {
          if (re.test(line)) {
            offences.push(`${file.path}:${index + 1}  ${name}\n    ${line.trim()}`);
          }
        }
      });
    }

    expect(
      offences,
      offences.length === 0
        ? ''
        : `result_code must only be compared through resultCode() from @kept/core ` +
          `(design §4.4, R3.12). Kane types the field inconsistently within one ` +
          `event, so a raw comparison silently never fires on one of the two ` +
          `typings. Offending lines:\n${offences.join('\n')}`,
    ).toEqual([]);
  });
});
