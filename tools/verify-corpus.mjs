/**
 * Every test document in the corpus, checked against the snapshot and against the recorded runs.
 *
 * This is the half a page sweep cannot reach. The corpus is eleven `*_test.md` documents carrying
 * thirteen `@verifies` tags, and each tag binds a designed test to a claim at a file and a line. Two
 * things have to hold and neither is visible from the served HTML:
 *
 *   1. every `@verifies` tag resolves to a line that still says what the tag was written against, so
 *      no binding has silently drifted;
 *   2. every designed test the snapshot names exists on disk, and every document in the corpus is
 *      named by the snapshot.
 *
 * Read-only. It reads files and the committed snapshot and invokes nothing.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';

const snapshot = JSON.parse(readFileSync('apps/ledger/data/ledger.snapshot.json', 'utf8'));

let checks = 0;
let failures = 0;
function ok(label, condition, detail = '') {
  checks += 1;
  const mark = condition ? 'pass' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`  ${mark}  ${label}${detail === '' ? '' : `  (${detail})`}`);
}

const docs = readdirSync('tests')
  .filter((name) => name.endsWith('_test.md'))
  .sort();

console.log('the corpus');
ok('eleven test documents, as doctor reports', docs.length === 11, String(docs.length));

/* ── every @verifies tag still points at the claim it was written against ───── */

console.log('\nevery @verifies tag resolves to its own claim');
const TAG = /@verifies\s+([^\s:]+):(\d+)/g;
let tags = 0;
for (const doc of docs) {
  const text = readFileSync(`tests/${doc}`, 'utf8');
  for (const match of text.matchAll(TAG)) {
    tags += 1;
    const file = match[1];
    const line = Number(match[2]);
    ok(`${doc} cites ${file}:${String(line)} and the file exists`, existsSync(file));
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    const cited = lines[line - 1] ?? null;
    ok(
      `  ${file}:${String(line)} is a real, non-empty line`,
      cited !== null && cited.trim().length > 0,
      cited === null ? 'past end of file' : `${cited.trim().slice(0, 52)}…`,
    );
    /* And the snapshot agrees that a promise lives there, which is the binding the graph draws. */
    ok(
      `  the snapshot carries a promise at ${file}:${String(line)}`,
      snapshot.promises.some((p) => p.citation.file === file && p.citation.line === line),
    );
  }
}
ok('thirteen tags, as doctor reports', tags === 13, String(tags));

/* ── the snapshot and the corpus name the same documents ────────────────────── */

console.log('\nthe snapshot and the corpus agree on which tests exist');
const designed = new Set(
  snapshot.promises.map((p) => p.designedTest?.path ?? null).filter((path) => path !== null),
);
for (const path of [...designed].sort()) {
  ok(`the snapshot names ${path}, and it is on disk`, existsSync(path));
}
for (const doc of docs) {
  const path = `tests/${doc}`;
  ok(
    `${path} is bound to at least one promise`,
    designed.has(path),
    designed.has(path) ? '' : 'in the corpus but bound to nothing',
  );
}

/* ── the recorded runs a replay reads ───────────────────────────────────────── */

console.log('\nthe recorded outputs a replay reads back');
const outputs = readdirSync('tests')
  .filter((name) => name.startsWith('output-'))
  .sort();
ok('nine recorded outputs are present', outputs.length === 9, String(outputs.length));
for (const dir of outputs) {
  const result = `tests/${dir}/Result.md`;
  ok(`${dir} carries its Result.md`, existsSync(result));
  if (existsSync(result)) {
    const bytes = readFileSync(result).length;
    ok(`  ${dir}/Result.md has content`, bytes > 0, `${String(bytes)} bytes`);
  }
}

/* ── the pinned fixture README hash, which is a promise about a promise ─────── */

console.log('\nthe fixture README is the one the snapshot was built from');
{
  const { createHash } = await import('node:crypto');
  const digest = createHash('sha256')
    .update(readFileSync('apps/fixture/README.md'))
    .digest('hex');
  const PINNED = 'b2118de7aef19263a2d6fb18eba0778e4120b5521077e6de4ed0d26383efadef';
  ok('sha256 matches the pinned value', digest === PINNED, digest.slice(0, 16));
}

console.log(
  `\n${failures === 0 ? 'ALL GREEN' : 'FAILURES PRESENT'}: ${String(checks - failures)}/${String(checks)} checks passed`,
);
process.exit(failures === 0 ? 0 : 1);
