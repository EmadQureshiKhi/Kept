/**
 * Codepoint check for em and en dashes on the added lines of the working diff.
 *
 * Reading a diff by eye does not distinguish U+2014 from a hyphen at small sizes, so this
 * greps by codepoint. Only added lines are checked: a dash that was already in the file on a
 * line nobody touched is not this run's problem.
 *
 * Usage: node tools/dash-check.mjs [pathspec...]
 */

import { execFileSync } from 'node:child_process';

const paths = process.argv.slice(2);
const diff = execFileSync('git', ['diff', '-U0', '--', ...paths], {
  maxBuffer: 1024 * 1024 * 128,
}).toString();

const added = diff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++'));
const bad = added.filter((line) => /[\u2014\u2013]/.test(line));

console.log(`added lines: ${String(added.length)}, with em or en dash: ${String(bad.length)}`);
for (const line of bad) console.log(JSON.stringify(line.slice(0, 160)));
process.exit(bad.length === 0 ? 0 : 1);
