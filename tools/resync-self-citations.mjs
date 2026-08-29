/**
 * Re-point the self-citing `@verifies` tags after the README moves.
 *
 * ## The coupling this exists for
 *
 * A citation is a path and a line, and a `@verifies README.md:679` tag names the line its
 * claim sits on **today**. Insert a paragraph at the top of the README and every claim
 * below it moves down, the tags go on naming the old positions, and `kept build` admits
 * whatever now sits there instead. It does not error: it quietly admits a different line,
 * the promise that carried a verdict is no longer the promise being admitted, and the
 * proven figure falls. Measured: inserting two lines took proven coverage from 62% to 54%
 * and dropped an evidence edge, with nothing on stderr to say why.
 *
 * So this maps each tag to its claim by **text**, finds where that text lives now, and
 * rewrites the line number. The claim is the thing being verified; the number is only how
 * the graph reaches it.
 *
 * ## Usage
 *
 *     node tools/resync-self-citations.mjs          # report only
 *     node tools/resync-self-citations.mjs --apply  # rewrite the tags
 *
 * After `--apply`, run `npm run build:snapshot` and then `npm run check`.
 *
 * If a claim's *text* changed rather than moving, this reports it as unfindable and
 * changes nothing, because that is a decision about what the repository promises and not
 * a bookkeeping fix.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = '/Users/nokitha/Desktop/KEPT';
const README = `${ROOT}/README.md`;
const APPLY = process.argv.includes('--apply');

/**
 * Every self-citing tag, keyed by the document that carries it, with a fragment of the
 * claim it verifies. The fragment is what identifies the claim across a move; it is
 * matched as a substring of the whole line.
 */
const TAGS = [
  {
    document: 'tests/kept_self_claims_test.md',
    fragment: 'Kane is invoked zero times, zero credits are spent',
    note: 'the zero Kane invocations claim',
  },
  {
    document: 'tests/kept_demo_boot_test.md',
    fragment: 'npm run demo          # Ledger on :3000, fixture on :3100',
    note: 'the demo command claim',
  },
  {
    document: 'tests/kept_self_claims_test.md',
    fragment: 'No network, no credentials, no Kane.',
    note: 'the no network and no credentials claim',
  },
  {
    document: 'tests/kept_self_claims_test.md',
    fragment: 'No non-GET handler, no server action',
    note: 'the read-only deployment claim',
  },
  {
    document: 'tests/kept_badge_endpoint_test.md',
    fragment: '`/badge.svg` | GET only, `image/svg+xml`',
    note: 'the badge endpoint claim',
  },
];

const readmeLines = readFileSync(README, 'utf8').split('\n');

/** One-based line where a fragment lives, or null when it is nowhere. */
const lineOf = (fragment) => {
  const matches = [];
  for (const [index, line] of readmeLines.entries()) {
    if (line.includes(fragment)) matches.push(index + 1);
  }
  if (matches.length === 0) return { line: null, reason: 'not found' };
  if (matches.length > 1) return { line: null, reason: `ambiguous, ${matches.length} matches` };
  return { line: matches[0], reason: null };
};

/** document -> its text, edited in memory so one file with two tags is written once. */
const edited = new Map();
const rows = [];
let moved = 0;
let broken = 0;

for (const tag of TAGS) {
  const found = lineOf(tag.fragment);
  if (!edited.has(tag.document)) {
    edited.set(tag.document, readFileSync(`${ROOT}/${tag.document}`, 'utf8'));
  }
  const text = edited.get(tag.document);
  const pattern = new RegExp(
    `<!-- @verifies README\\.md:(\\d+) ${tag.note.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->`,
  );
  const current = pattern.exec(text);
  if (current === null) {
    rows.push(['NO TAG', tag.document, tag.note, '-', '-']);
    broken += 1;
    continue;
  }
  const was = Number(current[1]);
  if (found.line === null) {
    rows.push(['UNFINDABLE', tag.document, tag.note, String(was), found.reason ?? '?']);
    broken += 1;
    continue;
  }
  if (found.line === was) {
    rows.push(['ok', tag.document, tag.note, String(was), 'unchanged']);
    continue;
  }
  rows.push(['MOVED', tag.document, tag.note, String(was), `-> ${String(found.line)}`]);
  moved += 1;
  edited.set(
    tag.document,
    text.replace(pattern, `<!-- @verifies README.md:${String(found.line)} ${tag.note} -->`),
  );
}

for (const [status, document, note, was, now] of rows) {
  console.log(
    `${status.padEnd(11)} ${document.replace('tests/', '').padEnd(28)} ${note.padEnd(44)} ${was.padEnd(5)} ${now}`,
  );
}
console.log('');
console.log(`moved: ${moved}    unresolved: ${broken}`);

if (broken > 0) {
  console.log('');
  console.log('Nothing was written. An unfindable claim means its text changed, which is a');
  console.log('decision about what this repository promises rather than a line-number fix.');
  process.exitCode = 1;
} else if (moved === 0) {
  console.log('Every tag already names the line its claim sits on. Nothing to do.');
} else if (APPLY) {
  for (const [document, text] of edited) writeFileSync(`${ROOT}/${document}`, text);
  console.log(`Rewrote ${String(edited.size)} document(s).`);
  console.log('Now run: npm run build:snapshot && npm run check');
} else {
  console.log('Read-only. Re-run with --apply to rewrite the tags.');
}
