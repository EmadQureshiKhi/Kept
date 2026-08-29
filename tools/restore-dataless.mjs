/**
 * Restore iCloud-evicted files from git rather than waiting for Apple to hand them back.
 *
 * macOS "Optimise Mac Storage" evicts a file's contents and leaves its metadata, flagged
 * `dataless`. A directory walk still finds it, its size still looks right to `stat`, and any read
 * blocks on an on-demand download that can fail outright with `ECANCELED`. That is why `tsc -b`
 * hangs and why the read-only scan died without naming a file.
 *
 * This repository's git directory is at `~/kept-git`, outside iCloud, so every tracked file's bytes
 * are already on this disk in the object store. Deleting the dataless placeholder and checking it
 * out again is therefore instant and needs no network, which beats waiting on a sync.
 *
 * It reports rather than touches anything it cannot restore that way: an untracked dataless file has
 * no copy in git, so it either has to come back from iCloud or be regenerated.
 *
 * Usage: node tools/restore-dataless.mjs [--apply]
 */

import { execFileSync } from 'node:child_process';

const apply = process.argv.includes('--apply');

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
}

/** Every dataless path in the working tree, skipping build output and dependencies. */
function datalessPaths() {
  const found = execFileSync('/usr/bin/find', ['.', '-flags', '+dataless'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });
  return found
    .split('\n')
    .map((line) => line.replace(/^\.\//, '').trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith('node_modules/') && !line.includes('/node_modules/'))
    .filter((line) => !line.startsWith('.next/') && !line.includes('/.next/'));
}

const paths = datalessPaths();
console.log(`dataless files in the working tree: ${String(paths.length)}`);

/** Which of them git knows about. One call rather than one per file. */
const tracked = new Set(
  git(['ls-files', '--', ...paths])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0),
);

const restorable = paths.filter((path) => tracked.has(path));
const orphans = paths.filter((path) => !tracked.has(path));

console.log(`  tracked in git, restorable offline: ${String(restorable.length)}`);
console.log(`  untracked, not in git:              ${String(orphans.length)}`);

if (orphans.length > 0) {
  console.log('\nuntracked and evicted (these need iCloud, or are regenerated output):');
  const byDir = new Map();
  for (const path of orphans) {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
  }
  for (const [dir, count] of [...byDir].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)}  ${dir}/`);
  }
}

if (!apply) {
  console.log('\nnothing changed. Re-run with --apply to restore the tracked ones from git.');
  process.exit(0);
}

if (restorable.length === 0) {
  console.log('\nno tracked dataless files to restore.');
  process.exit(0);
}

/* Deleted first, then checked out. `git checkout --` on a dataless file would otherwise see a file
   whose metadata matches the index and leave the placeholder in place. */
console.log('\nrestoring from git:');
const { rmSync } = await import('node:fs');
let restored = 0;
for (const path of restorable) {
  try {
    rmSync(path);
  } catch (error) {
    console.log(`  SKIP ${path}  ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  restored += 1;
}
git(['checkout', '--', ...restorable]);
console.log(`  restored ${String(restored)} files`);

/* Proof, rather than a claim: read every one of them and report any that still cannot be read. */
const { readFileSync } = await import('node:fs');
const stillBad = [];
for (const path of restorable) {
  try {
    readFileSync(path);
  } catch (error) {
    stillBad.push(`${path}  ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`  verified readable: ${String(restorable.length - stillBad.length)}/${String(restorable.length)}`);
for (const bad of stillBad) console.log(`  STILL UNREADABLE ${bad}`);
