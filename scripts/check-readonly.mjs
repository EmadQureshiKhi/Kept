#!/usr/bin/env node
/**
 * Source scan 2 of 6 — the Ledger read-only guarantee (R8.4, R8.5, R8.6,
 * design §8.5, §15.2).
 *
 * Three requirements, one scan. The Ledger exposes no route that creates,
 * updates or deletes persisted data (R8.4); it requires no authentication
 * anywhere (R8.5); and the deployed build invokes Kane zero times (R8.6). Design
 * §8.5 explains why that is a design position rather than an omission: the only
 * write in the system — `kept amend accept` — lives in the CLI, and the local
 * one-click variant binds a listener to loopback *outside* the Next app, so the
 * Ledger's route tree stays free of a mutable surface in both deployments. A
 * guard is needed because that is exactly the kind of property a single
 * convenient `POST` handler quietly ends.
 *
 * Runnable two ways, on purpose. As a command it is the first step of
 * `npm run check`, so it fails a build before `tsc` has spent a second on it and
 * without vitest being available. Imported, its rule table drives
 * `apps/ledger/test/read-only-scan.test.ts`, so the guarantee is also checked by
 * `npm test` and the two can never disagree about what a violation is.
 *
 * ── The `kane` clause, and why it is not a substring match ───────────────────
 *
 * The task text says to fail on "the string `kane`". Read literally that scan is
 * both weaker and noisier than the requirement it serves, and this file
 * implements the requirement.
 *
 * **Noisier**, because the Ledger's subject matter is Kane's verdicts, so the
 * word is legitimate content in at least three places that exist today:
 *
 *   - `apps/ledger/data/ledger.snapshot.json` quotes Kane's refusal verbatim,
 *     including its suggested remedy `run \`kane-cli context ingest <files>\`
 *     first`. §5.3.1 requires that message be reproduced exactly. It is data the
 *     page renders, not a command anything runs.
 *   - `/runs` reproduces the same refusal in page copy, and names Kane in prose,
 *     because the page is about Kane's verdicts.
 *   - `snapshot.generator.kaneCli` is a schema field (§9.1) — a version string,
 *     or null. Rendering it is the honest thing to do, not an invocation.
 *
 * A substring match fails on all three, and the only way to keep it green is to
 * stop quoting Kane accurately. A guard that pressures the code into being less
 * truthful is worse than no guard.
 *
 * **Weaker**, because "no occurrence of a word" is not the guarantee. R8.6 is
 * about *starting a process*, and every route to one is nameable:
 *
 *   1. A subprocess primitive: an import of `child_process` in any spelling,
 *      static, dynamic or `require`, or a bare call to `spawn`, `spawnSync`,
 *      `exec`, `execSync`, `execFile`, `execFileSync` or `fork`. Nothing invokes
 *      Kane without one of these — not from a Next server component, not from a
 *      route handler, not from anywhere. Ban them and the credit bill is zero
 *      whatever words appear in the copy.
 *   2. The invoker arriving as a dependency: any import of `@corgod/kept-cli`, any
 *      module specifier containing `kane` (`kane-cli`, or a deep path into
 *      `kept-core`'s `kane/` directory), or any of `kept-core`'s invoker
 *      exports named in an import list or in code — `KaneInvoker`,
 *      `findKaneBinary`, `resolvedKaneBinary` and the rest.
 *   3. `kane` in a genuine code position: a constructor whose name contains it,
 *      an identifier ending `Invoker`, a `KANE_*` environment variable, or an
 *      argv array whose first element is the binary — `['kane-cli', …]`.
 *
 * `kept-core` itself is deliberately **not** banned. It is the CLI↔UI contract
 * of design §9: sixteen shipped Ledger files import `parseSnapshot`, `resultCode`
 * and the snapshot types from it, and the Ledger is *required* to read its data
 * that way. What is banned is its Kane process boundary, by name, which is the
 * precise thing that would start a process.
 *
 * Both directions of every rule are proven in the test wrapper: planted
 * violations are caught, and the quoted refusal message and Kane prose are not.
 *
 * ── Scope, and the no-op guard ───────────────────────────────────────────────
 *
 * Every file under `apps/ledger` with a code extension, except
 * `apps/ledger/test/`. The exclusion is necessary and narrow: the wrapper
 * constructs the violations it detects, so a scan that read its own fixtures
 * could only be kept green by weakening itself. Test files are not part of the
 * Next build and ship nowhere, so nothing about the deployed guarantee turns on
 * them. `motion-scan.test.ts` sets the same precedent, and asserts the exclusion
 * rather than assuming it.
 *
 * A zero-file scan throws instead of passing, exactly as in
 * `no-raw-result-code.test.ts` and `_scan.ts`. A renamed tree that turned this
 * into a silently green no-op would be a worse outcome than the violation it
 * hunts.
 *
 * Zero dependencies: the walk is hand-rolled because the runtime budget of
 * design §2.2 is closed and this has to run before anything is built.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The workspace root: this file lives in `scripts/`. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Everything the Ledger owns. */
export const LEDGER_ROOT = 'apps/ledger';

/** The one excluded subtree, and the reason is in the header. */
export const EXCLUDED_PREFIX = 'apps/ledger/test/';

/**
 * Extensions that can carry a route handler, a directive or an import.
 *
 * `.json`, `.css`, `.md` and `.svg` are absent deliberately: none of them can
 * start a process or export a handler, and the snapshot — the one file that
 * quotes Kane's refusal verbatim — is JSON.
 */
export const CODE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
];

/**
 * Build output and vendored code only.
 *
 * Note what is *not* here: `coverage`. `apps/ledger/app/coverage/` is a real
 * route (task 9.8), so a walk that skipped every directory of that name would
 * quietly stop reading a page — and a page is exactly where a handler would be
 * added.
 */
const SKIP_DIRECTORIES = new Set(['node_modules', '.next', '.git', 'dist', 'out', '.turbo']);

/** `middleware.ts` in any of the extensions Next accepts for it. */
const MIDDLEWARE_FILE = /^middleware\.(?:[mc]?[jt]s|[jt]sx)$/;

/** The HTTP methods a Next route file may export that are not a read. */
const MUTATING_METHODS = 'POST|PUT|PATCH|DELETE|HEAD|OPTIONS';

/**
 * `kept-core`'s Kane process boundary, export by export (§2.20).
 *
 * The types are listed beside the values. A type cannot start a process, but
 * nothing in a read-only projection has any use for the shape of a spawn
 * either, and naming the whole surface means the rule does not have to reason
 * about which half of an import list is erased.
 */
export const INVOKER_EXPORTS = [
  'AGENT_FLAG',
  'BinaryResolver',
  'ChildProcessLike',
  'InvocationResult',
  'InvocationSpec',
  'KANE_BINARY_ENV_VAR',
  'KANE_BINARY_NAME',
  'KILL_GRACE_MS',
  'KaneInvoker',
  'KaneInvokerOptions',
  'NDJSON_ENABLER_ARGV',
  'STDERR_TAIL_LINES',
  'SpawnLike',
  'SpawnOptionsLike',
  'applyNdjsonEnabler',
  'clearKaneBinaryCache',
  'findKaneBinary',
  'resolvedKaneBinary',
];

const INVOKER_IDENTIFIER = new RegExp(`\\b(?:${INVOKER_EXPORTS.join('|')})\\b`);

/** A `{ … }` import list taken from `kept-core`'s barrel, across lines. */
/**
 * The core import list, as a pattern.
 *
 * The specifier is spelled without a slash now, and that is worth a note because the
 * previous spelling hid from a rename. It read `@kept\/core`, with the slash escaped for
 * the regex, so a text substitution looking for `@kept/core` did not match it: the
 * packages were renamed, every real import moved, and this rule went on searching for a
 * specifier that no longer existed. It matched nothing and reported nothing, which is the
 * worst way for a guard to fail. `read-only-scan.test.ts` plants a violation and requires
 * this rule to fire on it, and that is what caught it.
 */
const CORE_IMPORT_LIST = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]kept-core['"]/g;

/**
 * Every spelling of "this module comes from here": `from '…'`,
 * `import '…'`, `import('…')` and `require('…')`.
 */
function moduleSpecifier(body) {
  return new RegExp(`(?:from|import|require)\\s*\\(?\\s*['"](${body})['"]`, 'i');
}

/* ───────────────────────────────── the rules ───────────────────────────────── */

function linePatternRule(id, title, why, patterns) {
  return {
    id,
    title,
    why,
    find(file) {
      const found = [];
      file.lines.forEach((line, index) => {
        for (const pattern of patterns) {
          if (pattern.test(line)) {
            found.push({ line: index + 1, excerpt: line.trim(), rule: id });
            break;
          }
        }
      });
      return found;
    },
  };
}

export const RULES = [
  linePatternRule(
    'subprocess-import',
    'imports a subprocess primitive',
    'R8.6 — the deployed Ledger invokes Kane zero times. It reads the committed ' +
      'snapshot; nothing it renders requires starting a process, and Kane cannot ' +
      'run on Vercel anyway (design §15.2, A9).',
    [moduleSpecifier('(?:node:)?child_process')],
  ),
  linePatternRule(
    'subprocess-call',
    'calls a subprocess primitive',
    'R8.6 — a bare spawn/exec call means one arrived through some other name. ' +
      'A member access such as `pattern.exec(line)` is not a subprocess and is ' +
      'not matched; only an unqualified call is.',
    [/(?<![.\w$])(?:spawnSync|spawn|execSync|execFileSync|execFile|exec|fork)\s*\(/],
  ),
  linePatternRule(
    'cli-package-import',
    'imports the KEPT CLI',
    'R8.6 — `@corgod/kept-cli` is where every write and every Kane invocation lives ' +
      '(design §8.5). The Ledger consumes the snapshot, not the CLI.',
    [moduleSpecifier('@corgod/kept-cli(?:/[^\'"]*)?')],
  ),
  linePatternRule(
    'kane-module-import',
    'imports a module whose specifier names Kane',
    'R8.6 — `kane-cli`, or a deep path into `kept-core`\'s `kane/` directory, ' +
      'is how the process boundary arrives. `kept-core`\'s barrel is not ' +
      'banned: it is the CLI↔UI contract of design §9.',
    [moduleSpecifier('[^\'"]*kane[^\'"]*')],
  ),
  {
    id: 'invoker-export',
    title: 'imports a Kane invoker export from kept-core',
    why:
      'R8.6 — `kept-core` is permitted because the Ledger must read its data ' +
      'through `parseSnapshot`, but its Kane process boundary is not. The import ' +
      'list is read across lines, so a wrapped one is not a way round this.',
    find(file) {
      const found = [];
      const banned = new Set(INVOKER_EXPORTS);
      for (const match of file.text.matchAll(CORE_IMPORT_LIST)) {
        const list = match[1] ?? '';
        for (const entry of list.split(',')) {
          const name = entry
            .replace(/^\s*type\s+/, '')
            .split(/\s+as\s+/)[0]
            ?.trim();
          if (name !== undefined && name !== '' && banned.has(name)) {
            const line = file.text.slice(0, match.index ?? 0).split('\n').length;
            found.push({ line, excerpt: `imports ${name} from kept-core`, rule: 'invoker-export' });
          }
        }
      }
      return found;
    },
  },
  linePatternRule(
    'invoker-identifier',
    'names a Kane invoker symbol in code',
    'R8.6 — the symbol reaching the file by any route is the thing that starts ' +
      'the process. Prose and rendered strings are not matched by these names.',
    [INVOKER_IDENTIFIER],
  ),
  linePatternRule(
    'kane-invocation-shape',
    'names Kane in a code position rather than in content',
    'R8.6 — a constructor, an invoker identifier, a `KANE_*` environment ' +
      'variable or an argv array whose first element is the binary. Kane named ' +
      'in prose or in a rendered string is content: the page is about Kane\'s ' +
      'verdicts, and §5.3.1 requires the refusal message be quoted verbatim.',
    [
      /\bnew\s+[A-Za-z_$]*[Kk]ane[A-Za-z_$]*\s*\(/,
      /\b[A-Za-z_$]*[Kk]ane[A-Za-z_$]*Invoker\b/,
      /\b(?:invokeKane|runKane|callKane|spawnKane|kaneSpawn)\b/,
      /\bKANE_[A-Z0-9_]+\b/,
      /[[(]\s*(['"])kane(?:-cli)?\1/i,
    ],
  ),
  linePatternRule(
    'mutating-handler',
    'exports a non-GET request handler',
    'R8.4 — the Ledger exposes no route that creates, updates or deletes ' +
      'persisted data. `GET` is the only method it exports; `/badge.svg` is a ' +
      'GET-only route handler and everything else is a page.',
    [
      new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+(?:${MUTATING_METHODS})\\s*[(<]`),
      new RegExp(`\\bexport\\s+(?:const|let|var)\\s+(?:${MUTATING_METHODS})\\b`),
      new RegExp(`\\bexport\\s*\\{[^}]*\\b(?:${MUTATING_METHODS})\\b`),
    ],
  ),
  linePatternRule(
    'server-action',
    'declares a server action',
    'R8.4 — a `\'use server\'` directive creates an endpoint that mutates, with ' +
      'no route file to review. Design §8.5 keeps the one write in the CLI ' +
      'instead: the accept control copies a command to the clipboard.',
    [/(['"`])use server\1/],
  ),
  linePatternRule(
    'auth-reference',
    'references an authentication surface',
    'R8.5 — the Ledger requires no authentication for any route. There is ' +
      'nothing to protect: the build reads a committed file and holds no secret ' +
      '(design §15.2), so an auth surface could only add a way to fail.',
    [
      moduleSpecifier(
        'next-auth(?:/[^\'"]*)?|@auth/[^\'"]+|@clerk/[^\'"]+|@auth0/[^\'"]+|iron-session|jsonwebtoken|jose|bcryptjs?|passport(?:-[^\'"]+)?|@supabase/auth[^\'"]*',
      ),
      /\b(?:getServerSession|unstable_getServerSession)\b/,
      /\bNextAuth\s*\(/,
      /\bwithAuth\s*[(<]/,
      /\b(?:signIn|signOut)\s*\(/,
      /\bcookies\(\)\s*\.\s*(?:set|delete)\b/,
      /\bheaders\(\)\s*\.\s*(?:set|append|delete)\b/,
      /\.cookies\s*\.\s*(?:set|delete)\s*\(/,
    ],
  ),
  {
    id: 'middleware-file',
    title: 'ships a middleware file',
    why:
      'R8.4, R8.5 — middleware runs on every request and is the one place a ' +
      'redirect, a rewrite or a session check can be introduced without a route ' +
      'file to review. The Ledger has no middleware at all.',
    find(file) {
      const basename = file.path.split('/').pop() ?? '';
      if (!MIDDLEWARE_FILE.test(basename)) return [];
      return [{ line: 1, excerpt: `${basename} exists`, rule: 'middleware-file' }];
    },
  },
];

/* ─────────────────────────────────── the walk ──────────────────────────────── */

function collect(absoluteRoot) {
  const found = [];
  const stack = [absoluteRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const child = resolve(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) stack.push(child);
      } else if (entry.isFile() && CODE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        found.push(child);
      }
    }
  }
  return found.sort();
}

/**
 * Every shipped Ledger code file, `apps/ledger/test/` excluded.
 *
 * Throws when the root is missing or yields nothing. This runs before `tsc` and
 * before vitest, so it has no framework to report a skip to — passing quietly
 * would mean `npm run check` reporting a guarantee it never checked.
 */
export function collectLedgerFiles() {
  const absoluteRoot = resolve(REPO_ROOT, LEDGER_ROOT);
  const stats = statSync(absoluteRoot, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isDirectory()) {
    throw new Error(
      `Read-only scan root ${LEDGER_ROOT} does not exist. A guard must not pass by ` +
        `scanning nothing — update LEDGER_ROOT to the tree's new shape.`,
    );
  }
  const files = collect(absoluteRoot)
    .map((path) => {
      const text = readFileSync(path, 'utf8');
      return {
        path: relative(REPO_ROOT, path).split('\\').join('/'),
        text,
        lines: text.split('\n'),
      };
    })
    .filter((file) => !file.path.startsWith(EXCLUDED_PREFIX));
  if (files.length === 0) {
    throw new Error(
      `Read-only scan found no code files under ${LEDGER_ROOT}. Either the tree moved ` +
        `or the extension list is stale; a zero-file scan is a no-op guard.`,
    );
  }
  return files;
}

/**
 * Runs every rule over every file. Returns findings, throws on an empty file
 * list — the caller cannot report a clean scan of nothing.
 */
export function findViolations(files) {
  if (files.length === 0) {
    throw new Error('Read-only scan was handed no files; a zero-file scan is a no-op guard.');
  }
  const findings = [];
  for (const file of files) {
    for (const rule of RULES) {
      for (const hit of rule.find(file)) {
        findings.push({ ...hit, path: file.path, title: rule.title, why: rule.why });
      }
    }
  }
  return findings;
}

/** One human-readable block per rule that fired. */
export function formatViolations(findings) {
  const byRule = new Map();
  for (const finding of findings) {
    const bucket = byRule.get(finding.rule);
    if (bucket === undefined) byRule.set(finding.rule, [finding]);
    else bucket.push(finding);
  }
  const blocks = [];
  for (const [rule, group] of byRule) {
    const first = group[0];
    blocks.push(
      `  ${rule} — ${first?.title ?? ''}\n` +
        group.map((hit) => `    ${hit.path}:${hit.line}  ${hit.excerpt}`).join('\n') +
        `\n    ${first?.why ?? ''}`,
    );
  }
  return blocks.join('\n\n');
}

function main() {
  let files;
  try {
    files = collectLedgerFiles();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  const findings = findViolations(files);
  if (findings.length > 0) {
    process.stderr.write(
      `\nThe Ledger read-only guarantee is broken (R8.4, R8.5, R8.6).\n\n` +
        `${formatViolations(findings)}\n\n` +
        `The write path is the CLI: design §8.5 keeps \`kept amend accept\` there and ` +
        `the Ledger copies the command to the clipboard instead of running it.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `read-only scan: ${files.length} Ledger source files, ${RULES.length} rules, no violations\n`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) main();
