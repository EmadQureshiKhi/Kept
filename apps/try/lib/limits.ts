/**
 * What this page will read, and what it refuses to.
 *
 * The bounds live in their own module because they are the whole abuse story of an
 * unauthenticated public endpoint. There is no login, no rate-limit table and no database, so
 * these numbers are the entire defence: a repository is either small enough to read inside a
 * serverless invocation or it is declined with a sentence saying so.
 *
 * Every number is justified rather than round. A limit nobody can explain is a limit somebody
 * eventually raises to make a bug report go away.
 */

/**
 * How many documents are read.
 *
 * The admission gate cares about `*_test.md` documents and the files their `@verifies` tags
 * cite. This repository has eleven of the former and two of the latter, and a documentation
 * tree ten times that size is still a tree this can read. Two hundred is high enough to be
 * invisible for anything a person would paste, and low enough that two hundred sequential
 * fetches finish inside a function's budget.
 */
export const MAX_FILES = 200;

/**
 * Total bytes read across all documents.
 *
 * Two megabytes of markdown is roughly half a million words. A repository whose documentation
 * exceeds that is not the case this page is for, and reading it would spend the whole
 * invocation on transfer rather than on the graph.
 */
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

/**
 * Bytes read from any single document.
 *
 * A generated changelog or a vendored licence bundle can be enormous on its own, and one such
 * file should not consume the whole budget and starve the documents that matter. Skipping it is
 * reported rather than silent.
 */
export const MAX_FILE_BYTES = 512 * 1024;

/**
 * How many documents are fetched at once.
 *
 * Sequential fetches of two hundred files would exceed any function budget; unbounded parallel
 * fetches would open two hundred sockets and invite GitHub to refuse them. Eight is the usual
 * shape of this trade and leaves plenty of headroom on both sides.
 */
export const FETCH_CONCURRENCY = 8;

/**
 * The whole read, end to end.
 *
 * Held well under the route's own `maxDuration`, so the failure a reader meets is this module's
 * sentence rather than the platform's blank timeout. A page that dies without explaining itself is
 * the one outcome worth spending a budget to avoid, and the gap between the two numbers is the
 * room the handler needs to run the gate and serialise an answer after reading stops.
 *
 * Twenty five seconds rather than the eight it started at, measured rather than guessed. Listing a
 * large repository's tree is the single most expensive step: `vercel/next.js` answers a 12.5 MB
 * recursive listing in about 3.3 seconds, and the two hundred documents after it are another ten
 * or so. At eight seconds every large repository returned a partial graph with a note explaining
 * that it had run out of time, which was honest and useless.
 */
export const READ_BUDGET_MS = 25_000;

/**
 * How long any single request is given before it is abandoned and retried.
 *
 * A hung socket is the failure mode this exists for. Without a per-attempt timeout one
 * unresponsive document holds the whole read until the platform kills the function, and the reader
 * sees a page that spins and then says nothing. The number is generous enough that a slow but
 * working transfer is not mistaken for a dead one.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * How long the tree listing gets, which is more than anything else.
 *
 * It is one request and it can be tens of megabytes. Giving it the same allowance as a README
 * would abandon exactly the repositories this page most wants to be able to read.
 */
export const TREE_TIMEOUT_MS = 20_000;

/**
 * How many times a request is retried before it is given up on.
 *
 * Two retries, so three attempts in all. Retried: a network error, a timeout, a 5xx, and a 429.
 * Not retried: a 404, a 403 or a 451, because those are answers rather than failures and asking
 * again produces the same one while spending another of the hour's sixty requests.
 */
export const MAX_ATTEMPTS = 3;

/**
 * The wait before retrying, doubling per attempt.
 *
 * Short, because the whole read has a budget and a reader is waiting. This is a backoff to let a
 * blip pass, not to wait out an outage.
 */
export const RETRY_BACKOFF_MS = 400;

/** Extensions the admission gate can read. Markdown, and nothing else. */
export const DOCUMENT_EXTENSIONS: readonly string[] = Object.freeze(['.md', '.markdown']);

/**
 * Directories never descended into.
 *
 * `node_modules` and build output hold other people's documentation, and a promise found in a
 * dependency's README is not a promise this repository makes. The list mirrors the one
 * `kept-core`'s own baseline walk uses, for the same reason.
 */
export const SKIPPED_DIRECTORIES: readonly string[] = Object.freeze([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'out',
  'build',
  'vendor',
  'coverage',
  '.testmuai',
]);

/** `true` when a repository-relative POSIX path is a document worth reading. */
export function isDocumentPath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0) return false;
  const segments = path.split('/');
  if (segments.some((segment) => SKIPPED_DIRECTORIES.includes(segment))) return false;
  const lower = path.toLowerCase();
  return DOCUMENT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** The sentences the reader sees when a bound is reached. One author for the copy. */
export const LIMIT_MESSAGES = {
  tooManyFiles:
    `This repository holds more than ${String(MAX_FILES)} markdown documents. The graph below ` +
    `covers the first ${String(MAX_FILES)} the tree listed, so it may be incomplete. The CLI ` +
    `has no such limit: it reads your working copy directly.`,
  tooLarge:
    `Reading stopped at ${String(Math.round(MAX_TOTAL_BYTES / 1024))} KB of markdown, so the ` +
    `graph below may be incomplete. The CLI has no such limit.`,
  fileTooLarge: (path: string): string =>
    `${path} is larger than ${String(Math.round(MAX_FILE_BYTES / 1024))} KB and was skipped, ` +
    `so any claim it states is missing from the graph below.`,
  budgetSpent:
    'Reading ran out of time before the whole tree was read, so the graph below may be ' +
    'incomplete. This page has a few seconds; the CLI runs on your machine and has as long ' +
    'as it needs.',
  treeTruncated:
    'GitHub truncated its own listing of this repository, which it does for very large trees, ' +
    'so some documents were never offered to be read. The graph below is what the partial ' +
    'listing held.',
  retried: (count: number): string =>
    `${String(count)} request${count === 1 ? '' : 's'} had to be retried before GitHub answered. ` +
    `Nothing is missing because of it, but the read took longer than it usually does.`,
  unreadable: (count: number): string =>
    `${String(count)} document${count === 1 ? ' could' : 's could'} not be transferred even after ` +
    `retrying, so any claim ${count === 1 ? 'it states is' : 'they state are'} missing from the ` +
    `graph below.`,
} as const;
