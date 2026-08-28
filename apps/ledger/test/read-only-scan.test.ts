/**
 * Source scan 2 of 6 — the Ledger read-only guarantee, under Vitest
 * (R8.4, R8.5, R8.6; design §8.5, §15.2).
 *
 * The rules live in `scripts/check-readonly.mjs` because that script is the first
 * step of `npm run check` and has to run before `tsc` and without Vitest. This
 * file is the other half of the task's wiring requirement: importing the same
 * rule table means the guarantee is also checked by `npm test`, on every run,
 * with no second `node` invocation prefixed to the `test` script and no chance of
 * the two definitions of "violation" drifting apart.
 *
 * What it adds beyond re-running the scan:
 *
 *   1. **Both directions, per rule.** A scan is only as good as its precision.
 *      Every rule is fired at a planted violation *and* at the legitimate
 *      content it must stay quiet about — the verbatim Kane refusal message,
 *      prose naming Kane, `snapshot.generator.kaneCli`, the `kept-core` imports
 *      sixteen shipped files depend on, and `pattern.exec(line)`.
 *   2. **The walks agree.** The shared walk in `_scan.ts` and the script's own
 *      hand-rolled walk are asserted to see the same files, so the standalone
 *      command cannot inspect a smaller tree than the suite does.
 *   3. **The wiring is asserted.** `npm run check` must still name the script.
 *
 * The planted fixtures are plain objects rather than files on disk, so nothing is
 * written and no temporary tree can be left behind. Two of them name the
 * subprocess module through a variable rather than as one literal, because the
 * narrower loading-seam check in `snapshot-load.test.ts` scans test files too and
 * matches that import spelled out — it would read our fixture as a real
 * violation. Composing the specifier keeps both guards honest, and this comment
 * has to describe the spelling rather than reproduce it for the same reason.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CODE_EXTENSIONS,
  EXCLUDED_PREFIX,
  INVOKER_EXPORTS,
  REPO_ROOT,
  RULES,
  collectLedgerFiles,
  findViolations,
  formatViolations,
  type ScannedSource,
} from '../../../scripts/check-readonly.mjs';
import { scanLedger } from './_scan.js';

const SHIPPED: ScannedSource[] = collectLedgerFiles();

/** Builds a fixture file the rules can be run over. */
function fixture(path: string, source: string): ScannedSource {
  return { path, text: source, lines: source.split('\n') };
}

/** Which rules fire on one fixture. */
function rulesFiring(file: ScannedSource): string[] {
  return [...new Set(findViolations([file]).map((finding) => finding.rule))].sort();
}

/* Assembled so this file does not read as a violation to the narrower
   child_process check in `snapshot-load.test.ts`, which scans test files too. */
const CHILD_PROCESS = ['node', 'child_process'].join(':');
const SPAWN_IMPORT = `import { spawn } from '${CHILD_PROCESS}';`;

/* ───────────────────────────────── meta-tests ──────────────────────────────── */

describe('the read-only scan is not a no-op', () => {
  it('scanned the shipped Ledger tree', () => {
    expect(SHIPPED.length, 'no Ledger source file was scanned at all').toBeGreaterThan(0);
    expect(RULES.length).toBeGreaterThanOrEqual(10);
    for (const anchor of [
      'apps/ledger/app/layout.tsx',
      'apps/ledger/lib/snapshot.ts',
      'apps/ledger/components/VerdictTag.tsx',
    ]) {
      expect(
        SHIPPED.some((file) => file.path === anchor),
        `${anchor} was not scanned — has the tree moved?`,
      ).toBe(true);
    }
  });

  it('reads its own fixtures out of scope, and says which', () => {
    expect(SHIPPED.every((file) => !file.path.startsWith(EXCLUDED_PREFIX))).toBe(true);
    expect(EXCLUDED_PREFIX).toBe('apps/ledger/test/');
  });

  it('sees every file the shared walk sees', () => {
    const shared = scanLedger(CODE_EXTENSIONS)
      .map((file) => file.path)
      .filter((path) => !path.startsWith(EXCLUDED_PREFIX));
    expect(shared.length, 'the shared walk found no shipped code file').toBeGreaterThan(0);
    const scanned = new Set(SHIPPED.map((file) => file.path));
    for (const path of shared) {
      expect(
        scanned.has(path),
        `${path} is read by the shared walk but not by scripts/check-readonly.mjs, so ` +
          `npm run check inspects less than npm test does`,
      ).toBe(true);
    }
  });

  it('does not skip a route directory whose name collides with a tool output name', () => {
    const route = resolve(REPO_ROOT, 'apps/ledger/app/coverage');
    if (!existsSync(route)) return;
    expect(
      SHIPPED.some((file) => file.path.startsWith('apps/ledger/app/coverage/')),
      'apps/ledger/app/coverage exists but nothing under it was scanned. A walk that ' +
        'skips every directory called "coverage" stops reading a real page — and a ' +
        'page is exactly where a handler would be added.',
    ).toBe(true);
  });

  it('refuses to report a clean scan of nothing', () => {
    expect(() => findViolations([])).toThrow(/no-op guard/);
  });

  it('stays wired into npm run check', () => {
    const manifest = readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8');
    const scripts = JSON.parse(manifest) as { scripts?: Record<string, string> };
    expect(scripts.scripts?.['check']).toContain('node scripts/check-readonly.mjs');
  });
});

/* ───────────────────────── direction one: it catches ───────────────────────── */

describe('the scan catches a planted violation', () => {
  const plants: readonly { readonly what: string; readonly file: ScannedSource; readonly rule: string }[] = [
    {
      what: 'a subprocess import',
      file: fixture('apps/ledger/lib/danger.ts', `${SPAWN_IMPORT}\nexport const go = () => spawn('ls');`),
      rule: 'subprocess-import',
    },
    {
      what: 'a bare subprocess call',
      file: fixture('apps/ledger/lib/danger.ts', "export const go = () => execSync('kept verify');"),
      rule: 'subprocess-call',
    },
    {
      what: 'a dynamic subprocess import',
      file: fixture(
        'apps/ledger/lib/danger.ts',
        `const cp = await import('${CHILD_PROCESS}');\nexport const go = () => cp;`,
      ),
      rule: 'subprocess-import',
    },
    {
      what: 'an import of the CLI package',
      file: fixture('apps/ledger/lib/danger.ts', "import { amend } from '@corgod/kept-cli';"),
      rule: 'cli-package-import',
    },
    {
      what: 'a deep import of the Kane process boundary',
      file: fixture(
        'apps/ledger/lib/danger.ts',
        "import { KaneInvoker } from 'kept-core/dist/kane/invoker.js';",
      ),
      rule: 'kane-module-import',
    },
    {
      what: 'the invoker taken from the barrel',
      file: fixture('apps/ledger/lib/danger.ts', "import { KaneInvoker } from 'kept-core';"),
      rule: 'invoker-export',
    },
    {
      what: 'the invoker taken from the barrel across several lines',
      file: fixture(
        'apps/ledger/lib/danger.ts',
        "import {\n  parseSnapshot,\n  findKaneBinary,\n} from 'kept-core';",
      ),
      rule: 'invoker-export',
    },
    {
      what: 'an invoker export named in code, however it got there',
      file: fixture('apps/ledger/lib/danger.ts', 'export const bin = findKaneBinary();'),
      rule: 'invoker-identifier',
    },
    {
      what: 'the invoker constructed',
      file: fixture('apps/ledger/lib/danger.ts', 'export const invoker = new KaneInvoker({});'),
      rule: 'kane-invocation-shape',
    },
    {
      what: 'an invoker identifier by another name',
      file: fixture('apps/ledger/lib/danger.ts', 'export const invoker = new LocalKaneInvoker();'),
      rule: 'kane-invocation-shape',
    },
    {
      what: 'a Kane binary as the first element of an argv array',
      file: fixture('apps/ledger/lib/danger.ts', "export const argv = ['kane-cli', 'run', '--agent'];"),
      rule: 'kane-invocation-shape',
    },
    {
      what: 'a Kane environment variable',
      file: fixture('apps/ledger/lib/danger.ts', 'export const bin = process.env.KANE_BINARY;'),
      rule: 'kane-invocation-shape',
    },
    {
      what: 'a mutating route handler',
      file: fixture(
        'apps/ledger/app/accept/route.ts',
        'export async function POST(request: Request) {\n  return new Response(null);\n}',
      ),
      rule: 'mutating-handler',
    },
    {
      what: 'a mutating handler exported as a const',
      file: fixture('apps/ledger/app/accept/route.ts', 'export const DELETE = handler;'),
      rule: 'mutating-handler',
    },
    {
      what: 'a mutating handler exported from a list',
      file: fixture('apps/ledger/app/accept/route.ts', 'export { GET, PATCH };'),
      rule: 'mutating-handler',
    },
    {
      what: 'a server action',
      file: fixture(
        'apps/ledger/app/accept/actions.ts',
        "'use server';\n\nexport async function accept(id: string) {\n  return id;\n}",
      ),
      rule: 'server-action',
    },
    {
      what: 'a server action declared inside a function body',
      file: fixture(
        'apps/ledger/components/Accept.tsx',
        'export function Accept() {\n  async function submit() {\n    "use server";\n  }\n  return submit;\n}',
      ),
      rule: 'server-action',
    },
    {
      what: 'an auth dependency',
      file: fixture('apps/ledger/lib/danger.ts', "import NextAuth from 'next-auth';"),
      rule: 'auth-reference',
    },
    {
      what: 'a session read',
      file: fixture(
        'apps/ledger/app/page.tsx',
        'const session = await getServerSession(options);\nexport default function Page() {\n  return session;\n}',
      ),
      rule: 'auth-reference',
    },
    {
      what: 'a cookie write',
      file: fixture('apps/ledger/app/page.tsx', "cookies().set('kept-session', token);"),
      rule: 'auth-reference',
    },
    {
      what: 'a middleware file',
      file: fixture('apps/ledger/middleware.ts', 'export function middleware() {}'),
      rule: 'middleware-file',
    },
  ];

  for (const plant of plants) {
    it(`fires on ${plant.what}`, () => {
      expect(
        rulesFiring(plant.file),
        `the scan let through ${plant.what}: ${plant.file.text.split('\n')[0] ?? ''}`,
      ).toContain(plant.rule);
    });
  }

  it('names the file, the line and the requirement when it fires', () => {
    const findings = findViolations([
      fixture('apps/ledger/app/accept/route.ts', '// a handler follows\nexport async function POST() {}'),
    ]);
    expect(findings.length).toBe(1);
    expect(findings[0]?.path).toBe('apps/ledger/app/accept/route.ts');
    expect(findings[0]?.line).toBe(2);
    const report = formatViolations(findings);
    expect(report).toContain('apps/ledger/app/accept/route.ts:2');
    expect(report).toContain('R8.4');
  });

  it('covers every rule in the table with at least one planted violation', () => {
    const covered = new Set(plants.map((plant) => plant.rule));
    const uncovered = RULES.map((rule) => rule.id).filter((id) => !covered.has(id));
    expect(
      uncovered,
      `these rules are never proven to fire, so they could be broken and stay green: ` +
        `${uncovered.join(', ')}`,
    ).toEqual([]);
  });
});

/* ────────────── direction two: it stays quiet on legitimate content ────────── */

describe('the scan does not fire on Kane as content', () => {
  /**
   * The refusal message of §5.3.1, verbatim. The Ledger quotes it because a
   * paraphrase would be a lie about what Kane said — `/runs` renders it and the
   * committed snapshot stores it. It names `kane-cli` and a command to run, and
   * it is data.
   */
  const REFUSAL =
    'error: no context store here (run `kane-cli context ingest <files>` first)';

  const legitimate: readonly { readonly what: string; readonly file: ScannedSource }[] = [
    {
      what: 'the refusal message quoted verbatim in a string',
      file: fixture('apps/ledger/lib/runVocabulary.ts', `export const REFUSAL = '${REFUSAL}';`),
    },
    {
      what: 'the refusal message rendered as page copy',
      file: fixture(
        'apps/ledger/app/runs/page.tsx',
        `export default function Runs() {\n  return <pre>${REFUSAL}</pre>;\n}`,
      ),
    },
    {
      what: 'prose naming Kane in a comment',
      file: fixture(
        'apps/ledger/lib/runVocabulary.ts',
        '/**\n * Kane refused the plan, so the graph is built from the baseline provider\n * alone and no kane-cli run moved a verdict. See design §5.3.1.\n */\nexport const NOTE = 1;',
      ),
    },
    {
      what: "the snapshot's kaneCli generator field, read and rendered",
      file: fixture(
        'apps/ledger/components/Generator.tsx',
        'export function Generator({ snapshot }: Props) {\n  return <span>{snapshot.generator.kaneCli ?? "not run"}</span>;\n}',
      ),
    },
    {
      what: 'the kept-core imports sixteen shipped files depend on',
      file: fixture(
        'apps/ledger/lib/snapshot.ts',
        "import type { LedgerSnapshot } from 'kept-core';\nimport { parseSnapshot, resultCode } from 'kept-core';",
      ),
    },
    {
      what: 'a multi-line kept-core type import',
      file: fixture(
        'apps/ledger/lib/layout.ts',
        "import type {\n  LedgerSnapshot,\n  SnapshotPromise,\n  Verdict,\n} from 'kept-core';",
      ),
    },
    {
      what: 'a regular expression being executed',
      file: fixture(
        'apps/ledger/lib/citation.ts',
        'const match = /^(?<file>.+):(?<line>\\d+)$/.exec(reference);\nexport const found = match;',
      ),
    },
    {
      what: 'the GET-only badge route',
      file: fixture(
        'apps/ledger/app/badge.svg/route.ts',
        "export const dynamic = 'force-static';\n\nexport function GET() {\n  return new Response(svg, { headers: { 'content-type': 'image/svg+xml' } });\n}",
      ),
    },
    {
      what: 'a client component directive',
      file: fixture(
        'apps/ledger/components/PromiseGraph.tsx',
        "'use client';\n\nexport function PromiseGraph() {\n  return null;\n}",
      ),
    },
    {
      what: 'a cookie read, which cannot require authentication',
      file: fixture(
        'apps/ledger/app/page.tsx',
        "const theme = cookies().get('kept-theme');\nexport default function Page() {\n  return theme;\n}",
      ),
    },
    {
      what: 'a directory that merely contains the letters',
      file: fixture(
        'apps/ledger/lib/evidence.ts',
        "export const EVIDENCE_DIR = 'public/evidence/kane-packs';",
      ),
    },
  ];

  for (const entry of legitimate) {
    it(`stays quiet on ${entry.what}`, () => {
      expect(
        rulesFiring(entry.file),
        `the scan false-positived on ${entry.what}. A guard that pressures the page ` +
          `into quoting Kane less accurately is worse than no guard.`,
      ).toEqual([]);
    });
  }

  it('bans the invoker exports by name rather than banning the barrel', () => {
    expect(INVOKER_EXPORTS).toContain('KaneInvoker');
    expect(INVOKER_EXPORTS).toContain('findKaneBinary');
    expect(INVOKER_EXPORTS).not.toContain('parseSnapshot');
    expect(INVOKER_EXPORTS).not.toContain('resultCode');
  });
});

/* ─────────────────────────── the shipped tree itself ───────────────────────── */

describe('the shipped Ledger is read-only, unauthenticated and Kane-free', () => {
  it('breaks none of the rules (R8.4, R8.5, R8.6)', () => {
    const findings = findViolations(SHIPPED);
    expect(
      findings,
      findings.length === 0
        ? ''
        : `The Ledger read-only guarantee is broken. The write path is the CLI: ` +
          `design §8.5 keeps \`kept amend accept\` there and the accept control copies ` +
          `the command to the clipboard instead of running it.\n\n${formatViolations(findings)}`,
    ).toEqual([]);
  });
});
