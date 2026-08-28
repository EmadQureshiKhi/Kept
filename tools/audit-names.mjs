/**
 * End-to-end audit of the package rename.
 *
 * Checks both directions, because a rename fails in two ways: a stale old name left
 * behind, and a path corrupted by rewriting a directory that happens to share the name.
 *
 * Read-only. Exits non-zero on any finding.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = '/Users/nokitha/Desktop/KEPT';
const SKIP_DIR = new Set([
  'node_modules', '.git', '.next', 'dist', '.tmp', '.testmuai', '.context', '.turbo',
]);
const KEEP_EXT = new Set(['.ts', '.tsx', '.json', '.md', '.mjs', '.js', '.sh', '.yml', '.yaml', '.svg']);

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile()) {
      if (!KEEP_EXT.has(extname(entry.name))) continue;
      if (statSync(path).size > 4_000_000) continue;
      files.push(path);
    }
  }
})(ROOT);

const findings = [];
const note = (label, detail) => findings.push(`${label}: ${detail}`);

/**
 * A line that only *talks about* the old names is not a stale reference.
 *
 * Four comments and two documentation sections deliberately quote `@kept/core`,
 * `@kept/cli` and the bare `kept-cli` while explaining why the packages are named what
 * they are and which traps the rename set. Reporting those is how an audit becomes noise
 * that everyone learns to skip, so prose is excluded and only live code is checked.
 *
 * The test is positional rather than a path allow-list: a comment marker or a Markdown
 * context, not "this file is exempt". A real stale import in one of these files is still
 * reported, because an import is not a comment.
 */
/**
 * Whether each line of a file is prose, tracked with block-comment state.
 *
 * A leading-marker test is not enough. This repository writes block comments whose
 * continuation lines carry no `*`, like:
 *
 *     &#47;* Two segments, not three. This read `join(...)` while the
 *        packages were scoped, and the string never appears in this file. *&#47;
 *
 * so the second line looks like code to a per-line test and produced exactly one false
 * finding. Open and close are counted instead, which is what makes the result trustworthy
 * enough to act on.
 */
const proseMap = (text, relative) => {
  const markdownOrDrawing = relative.endsWith('.md') || relative.endsWith('.svg');
  const lines = text.split('\n');
  const flags = [];
  let open = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const startsComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
    flags.push(markdownOrDrawing || open || startsComment);
    /* update state after classifying, so the opening line counts as prose too */
    const opens = (line.match(/\/\*/g) ?? []).length;
    const closes = (line.match(/\*\//g) ?? []).length;
    if (opens > closes) open = true;
    else if (closes > opens) open = false;
    else if (opens > 0 && closes > 0) open = line.lastIndexOf('/*') > line.lastIndexOf('*/');
  }
  return flags;
};

/** Every spelling of the CLI package that is legitimate, longest first. */
const LEGITIMATE_CLI = [
  'packages/kept-cli',      // the directory, which did not move
  '@corgod/kept-cli',       // the published name
  '@corgod\\/kept-cli',     // the same, escaped inside a regex literal
  "'kept-cli'",             // a directory argument in the packaging suites
  'packages/%s',            // a describe.each label over those directories
];

const stripLegitimate = (line) => {
  let out = line;
  for (const spelling of LEGITIMATE_CLI) out = out.split(spelling).join('');
  return out;
};

/* ── 1. no stale scoped names, and no corrupted paths, in live code ─────────── */
const FORBIDDEN = [
  ['@kept/core', 'the old scoped library name'],
  ['@kept/cli', 'the old scoped CLI name'],
  ['packages/@corgod', 'a directory path corrupted by the rename'],
  ['@corgod/@corgod', 'a doubled scope'],
];

/* ── 2. the unscoped CLI name must survive only as a directory ──────────────── */
for (const path of files) {
  const relative = path.slice(ROOT.length + 1);
  if (relative === 'tools/audit-names.mjs') continue;
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split('\n');
  const prose = proseMap(text, relative);
  for (const [index, line] of lines.entries()) {
    /* a corrupted path is always a defect, comment or not */
    for (const [needle, why] of FORBIDDEN) {
      if (!line.includes(needle)) continue;
      if (needle.startsWith('packages/') || needle.startsWith('@corgod/@corgod')) {
        note('CORRUPT', `${relative}:${index + 1} contains '${needle}' (${why})`);
      } else if (!prose[index]) {
        note('STALE', `${relative}:${index + 1} contains '${needle}' in code (${why})`);
      }
    }
    if (prose[index]) continue;
    if (/\bkept-cli\b/.test(stripLegitimate(line))) {
      note('CHECK', `${relative}:${index + 1} names bare 'kept-cli' in code`);
    }
  }
}

/* ── 3. the directories really are still there ──────────────────────────────── */
for (const dir of ['packages/kept-core', 'packages/kept-cli']) {
  if (!existsSync(join(ROOT, dir))) note('MISSING', `${dir} does not exist`);
}

/* ── 4. manifests agree with each other and with the version literal ───────── */
const core = JSON.parse(readFileSync(join(ROOT, 'packages/kept-core/package.json'), 'utf8'));
const cli = JSON.parse(readFileSync(join(ROOT, 'packages/kept-cli/package.json'), 'utf8'));
const versionSource = readFileSync(join(ROOT, 'packages/kept-cli/src/version.ts'), 'utf8');
const literal = /KEPT_VERSION\s*=\s*'([^']+)'/.exec(versionSource)?.[1] ?? '(none)';
const snapshot = JSON.parse(readFileSync(join(ROOT, 'apps/ledger/data/ledger.snapshot.json'), 'utf8'));

if (core.name !== 'kept-core') note('NAME', `core is '${core.name}', expected 'kept-core'`);
if (cli.name !== '@corgod/kept-cli') note('NAME', `cli is '${cli.name}', expected '@corgod/kept-cli'`);
if (core.version !== cli.version) note('VERSION', `core ${core.version} != cli ${cli.version}`);
if (literal !== cli.version) note('VERSION', `KEPT_VERSION '${literal}' != manifest ${cli.version}`);
if (snapshot.generator.kept !== literal) {
  note('VERSION', `snapshot generator.kept '${snapshot.generator.kept}' != KEPT_VERSION '${literal}'`);
}
const range = cli.dependencies?.['kept-core'];
if (range !== `^${core.version}`) note('DEP', `cli depends on kept-core '${range}', expected '^${core.version}'`);
if (cli.bin?.kept !== 'dist/index.js') note('BIN', `cli bin.kept is '${cli.bin?.kept}'`);
if (core.private === true) note('PRIVATE', 'kept-core is private and cannot publish');
if (cli.private === true) note('PRIVATE', 'the CLI is private and cannot publish');

/* ── 5. the apps must stay private ──────────────────────────────────────────── */
for (const app of ['apps/fixture/package.json', 'package.json']) {
  const manifest = JSON.parse(readFileSync(join(ROOT, app), 'utf8'));
  if (manifest.private !== true) note('PRIVATE', `${app} is not private and could be published`);
}

console.log(`files scanned: ${files.length}`);
console.log('');
console.log(`kept-core          ${core.name}@${core.version}`);
console.log(`cli                ${cli.name}@${cli.version}`);
console.log(`KEPT_VERSION       ${literal}`);
console.log(`snapshot generator ${snapshot.generator.kept}`);
console.log(`dependency range   kept-core ${range}`);
console.log(`bin                ${JSON.stringify(cli.bin)}`);
console.log('');
if (findings.length === 0) {
  console.log('AUDIT CLEAN: no stale names, no corrupted paths, every version agrees');
} else {
  for (const finding of findings) console.log(`  ${finding}`);
  console.log('');
  console.log(`${findings.length} finding(s)`);
  process.exitCode = 1;
}
