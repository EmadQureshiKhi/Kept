import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSnapshot } from '@kept/core';
import { describe, expect, it } from 'vitest';

import { SERVICES, assertNoKaneInvocation, nextArgv } from '../../../scripts/demo.mjs';

/**
 * The judge path is Kane-free and credential-free (task 19.3, R13.1–R13.3,
 * design §15.1, §15.2).
 *
 * `demo-script.test.ts` already asserts what `scripts/demo.mjs` decides: two
 * ports, `next dev` argv, the line framing, and that `assertNoKaneInvocation`
 * rejects a Kane binary handed to it. That is a claim about one file. R13.2 and
 * R13.3 are claims about a **process tree**: zero Kane invocations, zero credits,
 * zero credentials, nothing off localhost, for the whole of what `npm run demo`
 * causes to run. A guard that only read the launcher would miss a `fetch` added to
 * a page, and the page is by far the likelier place for one to appear.
 *
 * So this file scans the transitive spawn closure of the demo command:
 *
 *   npm run demo
 *     → node scripts/demo.mjs                      (asserted to be the whole script)
 *         → node next dev -p 3000  in apps/ledger  (executes every file in that tree)
 *         → node next dev -p 3100  in apps/fixture (executes every file in that tree)
 *
 * Next itself is not scanned: it is a pinned dependency of the nine-package budget,
 * not repository source, and no assertion here would survive its next release. What
 * is scanned is everything Next is pointed at, which is what a later commit can
 * change. Each app's own `test/` directory is left out on purpose — Next never
 * executes them, and `read-only-scan.test.ts` plants subprocess and Kane-binary
 * fixtures inside `apps/ledger/test/` deliberately, so reading them would report
 * another suite's evidence as this suite's violation.
 *
 * Six rules, each proven to fire and proven to stay quiet:
 *
 *   1. `kane-binary-argv`   — a quoted string naming a Kane executable
 *   2. `subprocess`         — any way for an app to start a process at all
 *   3. `kane-environment`   — a `KANE_*` variable read
 *   4. `credential-read`    — a key, token or secret pulled from the environment
 *   5. `off-origin`         — an absolute URL whose host is not localhost
 *   6. `network-api`        — a request made by API rather than by URL literal
 *
 * The quiet direction is not decoration. The Ledger quotes Kane's refusal message
 * verbatim, including the `kane-cli context ingest` command inside it, because a
 * paraphrase would be a lie about what Kane said; the fixture's comments name Kane
 * and name `fetch` while having neither; the badge carries the SVG XML namespace,
 * which is an identifier that is never resolved. A rule that pressured any of
 * those into being less accurate would be worse than no rule, so each is asserted
 * to pass.
 *
 * The measured time to the rendered landing view lives in `docs/judge-path.md`,
 * and the last describe block reads the figures back out of that file and checks
 * them against R13.1's thirty seconds. Prose that carries a number drifts; prose
 * that a test parses cannot.
 */

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** Repo-relative, forward-slashed — the one spelling every path here uses. */
function repoRelative(absolute: string): string {
  return relative(REPO_ROOT, absolute).split('\\').join('/');
}

/* ─────────────────────────── the spawn closure ─────────────────────────────── */

/** The launcher, and the two trees the launcher points Next at. */
const DEMO_SCRIPT = 'scripts/demo.mjs';
const APP_TREES = ['apps/ledger', 'apps/fixture'] as const;

/** Build output and vendored code, by directory name, wherever it appears. */
const SKIP_NAMES = new Set(['node_modules', '.next', '.git', 'dist', 'out', 'build']);

/**
 * Skipped by **path**, not by name.
 *
 * `apps/ledger/app/coverage` is a shipped route and `apps/ledger/coverage` would be
 * reporter output; `_scan.ts` and `scripts/check-readonly.mjs` both learned that a
 * name-based skip silently stops reading a real page. The test directories are
 * excluded here for the reason given in the header.
 */
const SKIP_PATHS = new Set([
  'apps/ledger/coverage',
  'apps/fixture/coverage',
  'apps/ledger/test',
  'apps/fixture/test',
]);

/** Anything Node or Next can execute. */
const CODE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.cjs', '.json'] as const;

/** Everything a URL can hide in, code included. */
const TEXT_EXTENSIONS = [...CODE_EXTENSIONS, '.css', '.svg', '.html'] as const;

interface ScannedFile {
  readonly path: string;
  readonly text: string;
  readonly lines: readonly string[];
}

function read(absolute: string): ScannedFile {
  const text = readFileSync(absolute, 'utf8');
  return { path: repoRelative(absolute), text, lines: text.split('\n') };
}

/** Hand-rolled walk. No glob dependency — the runtime budget is closed (§2.2). */
function collect(absoluteRoot: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  const stack: string[] = [absoluteRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const child = resolve(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_NAMES.has(entry.name) && !SKIP_PATHS.has(repoRelative(child))) stack.push(child);
      } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
        found.push(child);
      }
    }
  }
  return found.sort();
}

/**
 * Every file in one app tree, asserting the tree exists and is not empty.
 *
 * Throws rather than returning nothing. A renamed directory and a stale extension
 * list both present as an empty result, and an empty result is a guard that passes
 * without looking at anything — the worst outcome available here.
 */
function scanTree(tree: string, extensions: readonly string[]): ScannedFile[] {
  const absoluteRoot = resolve(REPO_ROOT, tree);
  const stats = statSync(absoluteRoot, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isDirectory()) {
    throw new Error(
      `Judge-path scan root ${tree} does not exist. The demo spawns Next against it, ` +
        `so a scan that cannot find it is a no-op guard — update APP_TREES.`,
    );
  }
  const files = collect(absoluteRoot, extensions);
  if (files.length === 0) {
    throw new Error(
      `Judge-path scan root ${tree} contains no ${extensions.join('/')} files. Either ` +
        `the tree moved or the extension list is stale; a zero-file scan is a no-op guard.`,
    );
  }
  return files.map(read);
}

/** The closure: the launcher plus everything Next executes on its behalf. */
function scanClosure(): ScannedFile[] {
  const launcher = resolve(REPO_ROOT, DEMO_SCRIPT);
  if (!existsSync(launcher)) {
    throw new Error(
      `${DEMO_SCRIPT} does not exist, so npm run demo has no launcher to scan and this ` +
        `guard would pass by inspecting nothing.`,
    );
  }
  return [read(launcher), ...APP_TREES.flatMap((tree) => scanTree(tree, CODE_EXTENSIONS))];
}

const CLOSURE = scanClosure();
const LEDGER_TEXT = scanTree('apps/ledger', TEXT_EXTENSIONS);

/* ──────────────────────────────── the rules ────────────────────────────────── */

/**
 * Where a rule applies.
 *
 * `closure` is everything the demo causes to run. `apps` is the two application
 * trees only, which is where the subprocess ban belongs: the launcher's whole job
 * is to spawn two Next processes.
 */
type Scope = 'closure' | 'apps';

interface Rule {
  readonly id: string;
  readonly why: string;
  readonly scope: Scope;
  /** Files exempt by path, each with a stated reason in the header or below. */
  readonly exempt?: readonly string[];
  readonly pattern: RegExp;
}

const RULES: readonly Rule[] = [
  {
    id: 'kane-binary-argv',
    why: 'R13.2 — the demo invokes Kane zero times and consumes zero credits',
    scope: 'closure',
    /* `scripts/demo.mjs` is the one file allowed to name the binaries: its
       KANE_BINARIES set is what makes the ban mechanical instead of reviewed. */
    exempt: [DEMO_SCRIPT],
    /* A quoted string whose basename *is* the executable, optionally with a
       leading path. Deliberately not a substring match: a directory called
       `kane-evidence`, and the refusal message that names a whole `kane-cli`
       command line, are both content rather than an argv element. */
    pattern: /(['"`])(?:[^'"`\s]*[\\/])?kane(?:-cli)?(?:\.cmd)?\1/i,
  },
  {
    id: 'subprocess',
    why: 'R13.2 — neither application may start a process, Kane or otherwise',
    scope: 'apps',
    /* `exec` and `spawn` are matched only when they are not property reads, so
       `pattern.exec(line)` in lib/citation.ts stays quiet while a bare `exec()`
       does not. */
    pattern:
      /from\s*['"]node:child_process['"]|require\(\s*['"]child_process['"]\s*\)|(?<![.\w$])(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(/,
  },
  {
    id: 'kane-environment',
    why: 'R13.2, R13.3 — no Kane variable is read, so none can be required',
    scope: 'closure',
    /* An environment *read*, not the name. `scripts/demo.mjs` holds a
       `KANE_BINARIES` set — the guard's own table of spellings to refuse — and a
       rule that fired on the identifier would have to exempt the one file whose
       job is to name them, which would exempt the interesting file. */
    pattern: /(?:process\.)?env(?:\.|\[\s*['"])KANE_[A-Z0-9_]+/,
  },
  {
    id: 'credential-read',
    why: 'R13.3 — the demo succeeds with no credentials and no API keys',
    scope: 'closure',
    pattern:
      /process\.env\.[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)|(?:from|import)\s*['"]dotenv/i,
  },
  {
    id: 'network-api',
    why: 'R13.3 — no network beyond localhost, including requests made by API',
    scope: 'closure',
    pattern:
      /(?<![.\w$])fetch\s*\(|\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource)\b|sendBeacon\s*\(|from\s*['"]node:(?:http|https|net|dns|tls|dgram)['"]|from\s*['"]next\/font|rel=["'](?:preconnect|dns-prefetch)/,
  },
];

function inScope(file: ScannedFile, rule: Rule): boolean {
  if (rule.exempt?.includes(file.path) === true) return false;
  return rule.scope === 'closure' || file.path.startsWith('apps/');
}

interface Offence {
  readonly rule: string;
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

function findOffences(files: readonly ScannedFile[], rules: readonly Rule[] = RULES): Offence[] {
  if (files.length === 0) {
    throw new Error(
      'findOffences was handed no files. A clean report over an empty closure is a ' +
        'no-op guard, so this throws instead of returning success.',
    );
  }
  const offences: Offence[] = [];
  for (const file of files) {
    for (const rule of rules) {
      if (!inScope(file, rule)) continue;
      file.lines.forEach((line, index) => {
        if (rule.pattern.test(line)) {
          offences.push({ rule: rule.id, path: file.path, line: index + 1, text: line.trim() });
        }
      });
    }
  }
  return offences;
}

function formatOffences(offences: readonly Offence[]): string {
  return offences
    .map((offence) => `${offence.path}:${offence.line}  ${offence.rule}\n    ${offence.text}`)
    .join('\n');
}

/* ──────────────────────── the localhost-only origin rule ───────────────────── */

/**
 * The single allowlisted absolute URL in the Ledger.
 *
 * `http://www.w3.org/2000/svg` is an XML namespace identifier on the badge's root
 * element. Nothing resolves it — it is a name that happens to be spelled as a URL,
 * and omitting it would make the badge invalid SVG rather than make it offline.
 */
const ALLOWED_ABSOLUTE_URLS = new Set(['http://www.w3.org/2000/svg']);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const ABSOLUTE_URL = /https?:\/\/[^\s"'`)<>\\]+/g;

interface Origin {
  readonly path: string;
  readonly line: number;
  readonly url: string;
  readonly host: string;
  /** Prose rather than program text. See {@link isCommentLine}. */
  readonly comment: boolean;
}

/** Every absolute URL in a file set, with its host split out. */
function originsIn(files: readonly ScannedFile[]): Origin[] {
  const found: Origin[] = [];
  for (const file of files) {
    file.lines.forEach((line, index) => {
      for (const match of line.matchAll(ABSOLUTE_URL)) {
        const url = match[0];
        const authority = url.replace(/^https?:\/\//, '').split(/[/?#]/)[0] ?? '';
        found.push({
          path: file.path,
          line: index + 1,
          url,
          host: authority.split(':')[0] ?? '',
          comment: isCommentLine(line),
        });
      }
    });
  }
  return found;
}

/**
 * `true` for a line that is prose rather than program text.
 *
 * A URL in a comment cannot be dereferenced, and the generated
 * `apps/ledger/next-env.d.ts` carries a link to Next's TypeScript documentation
 * that no build ever reads. Banning it would mean either editing a generated file
 * on every install or forbidding a reference in a comment, and neither has
 * anything to do with whether the page reaches the network. What does is the shape
 * of the *call*, and `network-api` matches that whatever the URL beside it looks
 * like — a commented URL with a live `fetch` on the same line is still caught.
 */
function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('<!--')
  );
}

function offOrigin(files: readonly ScannedFile[]): Origin[] {
  return originsIn(files).filter(
    (origin) =>
      !LOCAL_HOSTS.has(origin.host) &&
      !ALLOWED_ABSOLUTE_URLS.has(origin.url) &&
      !origin.comment,
  );
}

/* ───────────────────────────── meta: not a no-op ───────────────────────────── */

describe('the judge-path scan reads the whole spawn closure', () => {
  it('read the launcher and both application trees', () => {
    expect(CLOSURE.some((file) => file.path === DEMO_SCRIPT)).toBe(true);
    for (const tree of APP_TREES) {
      expect(
        CLOSURE.some((file) => file.path.startsWith(`${tree}/`)),
        `nothing under ${tree} was scanned, yet the demo spawns Next against it`,
      ).toBe(true);
    }
    expect(CLOSURE.length).toBeGreaterThan(20);
    expect(LEDGER_TEXT.length).toBeGreaterThan(20);
  });

  it('read the files a judge actually looks at', () => {
    for (const anchor of [
      'apps/ledger/app/page.tsx',
      'apps/ledger/lib/snapshot.ts',
      'apps/ledger/data/ledger.snapshot.json',
      'apps/fixture/app/page.tsx',
      'apps/fixture/next.config.mjs',
      'apps/fixture/package.json',
    ]) {
      expect(
        CLOSURE.some((file) => file.path === anchor),
        `${anchor} was not scanned — has the tree moved?`,
      ).toBe(true);
    }
  });

  it('reads the stylesheets too, where a font or an image could reach out', () => {
    expect(LEDGER_TEXT.some((file) => file.path.endsWith('.css'))).toBe(true);
  });

  it('leaves the suites that plant violations on purpose out of scope', () => {
    expect(CLOSURE.every((file) => !file.path.startsWith('apps/ledger/test/'))).toBe(true);
    expect(LEDGER_TEXT.every((file) => !file.path.startsWith('apps/ledger/test/'))).toBe(true);
  });

  it('still descends into a route whose name looks like tool output', () => {
    if (!existsSync(resolve(REPO_ROOT, 'apps/ledger/app/coverage'))) return;
    expect(
      CLOSURE.some((file) => file.path.startsWith('apps/ledger/app/coverage/')),
      'apps/ledger/app/coverage is a shipped route and nothing under it was read',
    ).toBe(true);
  });

  it('refuses to report a clean closure of nothing', () => {
    expect(() => findOffences([])).toThrow(/no-op guard/);
    expect(() => scanTree('apps/nowhere', CODE_EXTENSIONS)).toThrow(/no-op guard/);
  });
});

describe('every judge-path rule is proven to fire', () => {
  const plants: readonly { readonly what: string; readonly line: string; readonly rule: string }[] = [
    {
      what: 'a Kane binary as the command of a spawn',
      line: "const child = launch('kane-cli', ['run', 'tests/home_cta_test.md']);",
      rule: 'kane-binary-argv',
    },
    {
      what: 'a Kane binary reached by absolute path',
      line: "const argv = ['/opt/homebrew/bin/kane', 'testrun'];",
      rule: 'kane-binary-argv',
    },
    {
      what: 'the Windows spelling',
      line: 'const bin = "kane-cli.cmd";',
      rule: 'kane-binary-argv',
    },
    {
      what: 'a subprocess import',
      line: "import { spawn } from 'node:child_process';",
      rule: 'subprocess',
    },
    { what: 'a bare subprocess call', line: "execSync('kept verify --all');", rule: 'subprocess' },
    { what: 'a process fork', line: 'fork(worker);', rule: 'subprocess' },
    {
      what: 'a Kane environment variable',
      line: 'const bin = process.env.KANE_BINARY ?? "kane";',
      rule: 'kane-environment',
    },
    {
      what: 'the member-debug variable',
      line: 'env.KANE_TESTRUN_MEMBER_DEBUG = "1";',
      rule: 'kane-environment',
    },
    {
      what: 'an API key read from the environment',
      line: 'const key = process.env.ANTHROPIC_API_KEY;',
      rule: 'credential-read',
    },
    {
      what: 'a token read from the environment',
      line: 'headers.authorization = `Bearer ${process.env.KEPT_TOKEN}`;',
      rule: 'credential-read',
    },
    { what: 'a dotenv import', line: "import 'dotenv/config';", rule: 'credential-read' },
    { what: 'a request', line: 'const res = await fetch(endpoint);', rule: 'network-api' },
    { what: 'a socket', line: 'const socket = new WebSocket(url);', rule: 'network-api' },
    {
      what: 'a Node http import',
      line: "import { request } from 'node:https';",
      rule: 'network-api',
    },
    {
      what: 'a font fetched at build time',
      line: "import { Inter } from 'next/font/google';",
      rule: 'network-api',
    },
    {
      what: 'a preconnect hint',
      line: '<link rel="preconnect" href="https://fonts.gstatic.com" />',
      rule: 'network-api',
    },
  ];

  for (const plant of plants) {
    it(`fires on ${plant.what}`, () => {
      const planted: ScannedFile = {
        path: 'apps/ledger/lib/planted.ts',
        text: plant.line,
        lines: [plant.line],
      };
      expect(
        findOffences([planted]).map((offence) => offence.rule),
        `the closure scan let through ${plant.what}: ${plant.line}`,
      ).toContain(plant.rule);
    });
  }

  it('covers every rule in the table with a planted violation', () => {
    const covered = new Set(plants.map((plant) => plant.rule));
    const uncovered = RULES.map((rule) => rule.id).filter((id) => !covered.has(id));
    expect(
      uncovered,
      `these rules are never proven to fire, so they could be broken and stay green: ` +
        `${uncovered.join(', ')}`,
    ).toEqual([]);
  });

  it('names the file, the line and the rule when it fires', () => {
    const planted: ScannedFile = {
      path: 'apps/ledger/app/page.tsx',
      text: '// nothing wrong here\nconst data = await fetch(remote);',
      lines: ['// nothing wrong here', 'const data = await fetch(remote);'],
    };
    const report = formatOffences(findOffences([planted]));
    expect(report).toContain('apps/ledger/app/page.tsx:2');
    expect(report).toContain('network-api');
  });

  it('reports a URL off localhost, and says which host', () => {
    const planted: ScannedFile = {
      path: 'apps/ledger/styles/hero.css',
      text: "@import url('https://fonts.googleapis.com/css2?family=Inter');",
      lines: ["@import url('https://fonts.googleapis.com/css2?family=Inter');"],
    };
    const found = offOrigin([planted]);
    expect(found.length).toBe(1);
    expect(found[0]?.host).toBe('fonts.googleapis.com');
    expect(found[0]?.line).toBe(1);
  });

  it('reports a remote host in a string but not one in a comment', () => {
    const inCode = 'const badge = "https://kept.vercel.app/badge.svg";';
    const inProse = ' * The deployed Ledger lives at https://kept.vercel.app (R14.6).';
    expect(
      offOrigin([{ path: 'apps/ledger/lib/x.ts', text: inCode, lines: [inCode] }]).length,
    ).toBe(1);
    expect(
      offOrigin([{ path: 'apps/ledger/lib/x.ts', text: inProse, lines: [inProse] }]),
      'a URL in a comment cannot be dereferenced, and the generated next-env.d.ts ' +
        'carries one on every install',
    ).toEqual([]);
    expect(
      originsIn([{ path: 'apps/ledger/lib/x.ts', text: inProse, lines: [inProse] }]).length,
      'the commented URL should still be seen, only not counted',
    ).toBe(1);
  });

  it('catches a request whose URL is only in the comment beside it', () => {
    const line = 'const res = await fetch(REMOTE); // https://kept.vercel.app/api';
    expect(
      findOffences([{ path: 'apps/ledger/lib/x.ts', text: line, lines: [line] }]).map(
        (offence) => offence.rule,
      ),
    ).toContain('network-api');
  });
});

describe('the judge-path rules stay quiet on legitimate content', () => {
  /** §5.3.1's refusal, verbatim. The Ledger renders it; it names a Kane command. */
  const REFUSAL = 'error: no context store here (run `kane-cli context ingest <files>` first)';

  const legitimate: readonly { readonly what: string; readonly line: string }[] = [
    { what: 'the refusal message quoted verbatim', line: `export const REFUSAL = '${REFUSAL}';` },
    {
      what: 'prose naming Kane in a comment',
      line: ' * `$18.00`, `€16.56`, `£14.22`. Always two decimals, so a Kane assertion on the',
    },
    { what: 'prose naming fetch in a comment', line: ' * no database and no `fetch` (R12.2) —' },
    { what: 'the snapshot generator field', line: '<span>{snapshot.generator.kaneCli ?? "not run"}</span>' },
    { what: 'a regular expression being executed', line: 'const match = PATTERN.exec(reference);' },
    { what: 'a directory that merely contains the letters', line: "const DIR = 'public/evidence/kane-packs';" },
    { what: 'a localhost URL', line: "const fixture = 'http://localhost:3100/cart';" },
    { what: 'the SVG namespace on the badge root', line: '`<svg xmlns="http://www.w3.org/2000/svg" width="${w}"` +' },
    { what: 'a promise verdict named after a proven run', line: "const verdict = 'proven';" },
  ];

  for (const entry of legitimate) {
    it(`stays quiet on ${entry.what}`, () => {
      const planted: ScannedFile = {
        path: 'apps/ledger/lib/legitimate.ts',
        text: entry.line,
        lines: [entry.line],
      };
      expect(
        findOffences([planted]).map((offence) => offence.rule),
        `false-positived on ${entry.what}. A guard that pressures the page into ` +
          `quoting Kane less accurately is worse than no guard.`,
      ).toEqual([]);
      expect(offOrigin([planted])).toEqual([]);
    });
  }
});

/* ───────────────────────── the closure as it ships ─────────────────────────── */

describe('npm run demo spawns no Kane and needs no credentials', () => {
  it('is the launcher and nothing else, with no npm lifecycle hook alongside it', () => {
    const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = manifest.scripts ?? {};
    expect(scripts['demo']).toBe(`node ${DEMO_SCRIPT}`);
    for (const hook of ['predemo', 'postdemo']) {
      expect(
        scripts[hook],
        `${hook} would run inside npm run demo without appearing in the demo script, ` +
          `which is exactly how a Kane invocation would hide from this scan`,
      ).toBeUndefined();
    }
  });

  it('spawns exactly the two Next processes, both through the R13.2 guard', () => {
    const launcher = CLOSURE.find((file) => file.path === DEMO_SCRIPT);
    expect(launcher).toBeDefined();
    const source = launcher?.text ?? '';
    const spawns = [...source.matchAll(/(?<![.\w$])spawn\s*\(/g)];
    expect(spawns.length, 'the launcher performs a spawn this suite has not read').toBe(1);
    expect(source).toContain('assertNoKaneInvocation(process.execPath, argv)');
    expect(source.indexOf('assertNoKaneInvocation(process.execPath, argv)')).toBeLessThan(
      source.indexOf('spawn(process.execPath, argv'),
    );
    expect(SERVICES.map((service) => nextArgv(service))).toEqual([
      ['dev', '-p', '3000'],
      ['dev', '-p', '3100'],
    ]);
    expect(() => assertNoKaneInvocation('kane-cli', ['run'])).toThrow(/zero times/);
  });

  it('breaks none of the closure rules (R13.2, R13.3)', () => {
    const offences = findOffences(CLOSURE);
    expect(
      offences,
      offences.length === 0
        ? ''
        : `npm run demo must invoke Kane zero times, consume zero credits and need no ` +
          `credentials (R13.2, R13.3). The live loop is npm run loop, documented with ` +
          `its prerequisites of local Chrome and Kane credentials.\n\n${formatOffences(offences)}`,
    ).toEqual([]);
  });

  it('carries no environment file either application could require', () => {
    for (const tree of APP_TREES) {
      for (const name of ['.env', '.env.local', '.env.production']) {
        expect(
          existsSync(resolve(REPO_ROOT, tree, name)),
          `${tree}/${name} exists, so the demo has a credential to forget to document`,
        ).toBe(false);
      }
    }
    const ignore = readFileSync(resolve(REPO_ROOT, '.gitignore'), 'utf8');
    expect(ignore).toMatch(/^\.env$/m);
  });
});

describe('the Ledger reaches nothing beyond localhost (R13.3)', () => {
  it('names no absolute URL outside localhost and the XML namespace', () => {
    const found = offOrigin(LEDGER_TEXT);
    expect(
      found,
      found.length === 0
        ? ''
        : `every figure the Ledger renders comes from the committed snapshot, so it has ` +
          `no reason to name a remote host:\n` +
          found.map((origin) => `${origin.path}:${origin.line}  ${origin.url}`).join('\n'),
    ).toEqual([]);
  });

  it('found the URLs it does allow, so the check is looking at something', () => {
    const all = originsIn(LEDGER_TEXT);
    expect(all.length, 'no absolute URL at all — has the badge lost its namespace?').toBeGreaterThan(
      0,
    );
    expect(all.some((origin) => ALLOWED_ABSOLUTE_URLS.has(origin.url))).toBe(true);
  });
});

describe('the Ledger resolves all its data from the committed snapshot', () => {
  const SNAPSHOT = 'apps/ledger/data/ledger.snapshot.json';

  it('parses the committed file through the schema authority', () => {
    const snapshot = parseSnapshot(readFileSync(resolve(REPO_ROOT, SNAPSHOT), 'utf8'));
    expect(snapshot.promises.length).toBeGreaterThan(0);
    expect(snapshot.generator.kaneCli).toBeNull();
  });

  it('is committed rather than generated at demo time (R13.4)', () => {
    const ignore = readFileSync(resolve(REPO_ROOT, '.gitignore'), 'utf8');
    expect(ignore).toMatch(/^!apps\/ledger\/data\/ledger\.snapshot\.json$/m);
  });

  it('loads it as a module, from the one file allowed to name it', () => {
    const namers = LEDGER_TEXT.filter(
      (file) => file.path !== SNAPSHOT && file.text.includes('ledger.snapshot.json'),
    ).map((file) => file.path);
    expect(namers).toEqual(['apps/ledger/lib/snapshot.ts']);
    const loader = LEDGER_TEXT.find((file) => file.path === 'apps/ledger/lib/snapshot.ts');
    expect(loader?.text).toContain("../data/ledger.snapshot.json' with { type: 'json' }");
  });

  it('reads no file at request time, so there is nothing to serve stale', () => {
    const readers = LEDGER_TEXT.filter((file) => /from\s*['"]node:fs(\/promises)?['"]/.test(file.text));
    expect(readers.map((file) => file.path)).toEqual([]);
  });
});

/* ─────────────────── the measured time to the landing view ─────────────────── */

describe('the measured time to the rendered landing view is recorded', () => {
  const DOC = 'docs/judge-path.md';
  const text = readFileSync(resolve(REPO_ROOT, DOC), 'utf8');

  /** `- Ledger landing view: **3.6 s** …` — the figure, in seconds. */
  function recordedSeconds(label: string): number {
    const match = new RegExp(`^- ${label} landing view: \\*\\*([0-9]+(?:\\.[0-9]+)?) s\\*\\*`, 'm').exec(
      text,
    );
    expect(
      match,
      `${DOC} no longer records the measured time to the ${label} landing view. R13.1 is ` +
        `a claim about a clock and it has to stay pinned to a number a reader can check.`,
    ).not.toBeNull();
    return Number(match?.[1]);
  }

  it('records a landing-view figure for each application the demo starts', () => {
    for (const label of ['Ledger', 'Fixture']) {
      expect(recordedSeconds(label)).toBeGreaterThan(0);
    }
  });

  it('keeps both figures inside R13.1 and R12.8 — thirty seconds', () => {
    for (const label of ['Ledger', 'Fixture']) {
      const seconds = recordedSeconds(label);
      expect(
        seconds,
        `${DOC} records ${seconds} s to the ${label.toLowerCase()} landing view, and R13.1 ` +
          `gives the judge path thirty. Either the demo regressed or the figure is stale.`,
      ).toBeLessThanOrEqual(30);
    }
  });

  it('states what was measured and that nothing was spent', () => {
    expect(text).toContain('npm run demo');
    expect(text).toContain('zero credits');
    expect(text).toContain('R13.1');
  });
});
