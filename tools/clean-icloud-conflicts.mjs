/**
 * Delete iCloud's conflict copies, and nothing else.
 *
 * iCloud resolves a sync conflict by leaving a second file beside the first with a number worked
 * into the name: `command-surface 2.md`, `BUILD_ID 6`, `Result 4.md`. On this repository it has
 * produced them in the hundreds, and they are worse than clutter. They arrive in two states, and
 * both cost real time:
 *
 *   - **Dataless.** The name is on disk and the bytes are not, so any tool that walks the tree and
 *     reads what it finds blocks on the first one. That is what wedged `vitest` for fifteen minutes
 *     with its workers alive and no progress, and what makes `shasum` hang rather than fail.
 *   - **A full copy.** Harmless to read, but it doubles every source file it touches, so a scan that
 *     counts files or greps for a pattern reports twice what is there.
 *
 * ## Why this is safe, stated rather than assumed
 *
 * Every file has to be **untracked** and **conflict-named**, and then satisfy one of two further
 * conditions. A file failing any of that is left alone and reported.
 *
 *   1. **Untracked.** Asked of git per path, not inferred from the name. A tracked file is never
 *      touched here; if a tracked file is ever dataless, `tools/restore-dataless.mjs` restores it
 *      from `~/kept-git` instead, which is the opposite operation and the right one.
 *   2. **Conflict-named.** The name ends in a space and a number, before or instead of the
 *      extension. A file iCloud did not rename is not a conflict copy.
 *   3. Then either **dataless**, so there is nothing in it to lose and nothing that could be
 *      compared even in principle; or **byte-identical to the file it duplicates**, which is the
 *      stronger of the two conditions because it proves rather than assumes that deleting loses
 *      nothing. A conflict copy that is neither is left alone: it holds bytes that differ from the
 *      original, which means it might be the version somebody wanted, and that is a decision for a
 *      person rather than a script.
 *
 * Dry by default. Pass `--apply` to delete.
 *
 *   node tools/clean-icloud-conflicts.mjs            # say what would go
 *   node tools/clean-icloud-conflicts.mjs --apply     # delete it
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, unlinkSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');

/** `name 2.md`, `routes.d 3.ts`, `BUILD_ID 6`: a space, digits, then the extension or the end. */
const CONFLICT_NAME = /\s\d+(\.[^./]+)?$/;

/** The path a conflict copy duplicates: the same name with the ` <n>` taken back out. */
function originalOf(path) {
  return path.replace(/\s\d+(\.[^./]+)?$/, (_, extension) => extension ?? '');
}

/** Every conflict-named path outside `node_modules`, which is not ours to reason about. */
function conflictNamedPaths() {
  const found = execFileSync('find', ['.', '-type', 'f', '-name', '* [0-9]*'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return found
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.includes('node_modules'))
    .filter((line) => CONFLICT_NAME.test(line));
}

/** `true` when the bytes are not local. Read from the flag rather than by attempting a read. */
function isDataless(path) {
  try {
    const found = execFileSync('find', [path, '-flags', '+dataless'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return found.trim().length > 0;
  } catch {
    return false;
  }
}

/** `true` when two paths hold the same bytes. Size first, so most comparisons cost one stat. */
function sameBytes(left, right) {
  try {
    if (statSync(left).size !== statSync(right).size) return false;
    return readFileSync(left).equals(readFileSync(right));
  } catch {
    return false;
  }
}

/** `true` when git is tracking this path. Asked, never guessed from the name. */
function isTracked(path) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', path.replace(/^\.\//, '')], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

const paths = conflictNamedPaths();
const conflicts = [];
const kept = [];

for (const path of paths) {
  if (isTracked(path)) {
    /* The interesting case, and the reason this is a per-file check. A tracked file that looks like
       a conflict copy is a file somebody committed under that name, so it is content. */
    kept.push([path, 'TRACKED, so it is content rather than a conflict copy']);
    continue;
  }
  if (isDataless(path)) {
    conflicts.push([path, 'dataless']);
    continue;
  }
  const original = originalOf(path);
  if (original !== path && sameBytes(path, original)) {
    conflicts.push([path, 'identical to ' + original]);
    continue;
  }
  kept.push([path, 'DIFFERS from its original, so a person should look at it']);
}

console.log(`conflict-named paths outside node_modules: ${String(paths.length)}`);
console.log(`safe to delete:                           ${String(conflicts.length)}`);
console.log(`left alone:                               ${String(kept.length)}`);

for (const [label, match] of [
  ['TRACKED', (why) => why.startsWith('TRACKED')],
  ['DIFFERS from its original', (why) => why.startsWith('DIFFERS')],
]) {
  const group = kept.filter(([, why]) => match(why));
  if (group.length === 0) continue;
  console.log(`\n  ${String(group.length)} left alone because ${label}:`);
  for (const [path] of group.slice(0, 20)) console.log(`    ${path}`);
}

if (!APPLY) {
  console.log(`\nDry run. Pass --apply to delete the ${String(conflicts.length)} conflict copies.`);
  for (const [path, why] of conflicts.slice(0, 15)) console.log(`  would delete  ${path}  (${why})`);
  if (conflicts.length > 15) console.log(`  ... and ${String(conflicts.length - 15)} more`);
  process.exit(0);
}

let deleted = 0;
const failed = [];
for (const [path] of conflicts) {
  try {
    unlinkSync(path);
    deleted += 1;
  } catch (cause) {
    failed.push([path, String(cause)]);
  }
}

console.log(`\ndeleted ${String(deleted)} conflict copies`);
if (failed.length > 0) {
  console.log(`${String(failed.length)} could not be deleted:`);
  for (const [path, why] of failed.slice(0, 10)) console.log(`  ${path}  ${why}`);
  process.exitCode = 1;
}
