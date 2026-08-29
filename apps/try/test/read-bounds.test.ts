/**
 * The bounds and the retry policy: what this page will read, and what it does when GitHub wobbles.
 *
 * These are the numbers and rules that stand in for having a login. There is no account, no
 * rate-limit table and no store, so `limits.ts` is the whole abuse story and the retry policy is
 * the whole resilience story. Both are worth testing directly rather than through a fetch, because
 * the interesting decisions are arithmetic and classification rather than transport.
 *
 * The classification is the part that matters most. A page that retries a 404 turns one refusal
 * into three requests and then reports a rate limit it caused itself.
 */

import { describe, expect, it } from 'vitest';

import { backoffFor, failureMessage, isRetryableStatus } from '../lib/github.js';
import {
  DOCUMENT_EXTENSIONS,
  FETCH_CONCURRENCY,
  LIMIT_MESSAGES,
  MAX_ATTEMPTS,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  READ_BUDGET_MS,
  REQUEST_TIMEOUT_MS,
  RETRY_BACKOFF_MS,
  TREE_TIMEOUT_MS,
  isDocumentPath,
} from '../lib/limits.js';

describe('a failure is retried and an answer is not', () => {
  it('retries the statuses that mean the request reached no decision', () => {
    /* A 429 is "not now" and a 5xx is "something upstream broke". Both are worth asking again. */
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status), `${String(status)} should be retried`).toBe(true);
    }
  });

  it('never retries a status that is GitHub deciding', () => {
    /* Each of these is an answer. Repeating it gets the same answer and spends another of the
       sixty requests an unauthenticated caller is allowed in an hour, which is how a page
       manufactures the rate limit it then reports. */
    for (const status of [200, 301, 400, 401, 403, 404, 410, 451]) {
      expect(isRetryableStatus(status), `${String(status)} must not be retried`).toBe(false);
    }
  });

  it('backs off by doubling, and starts short', () => {
    expect(backoffFor(1)).toBe(RETRY_BACKOFF_MS);
    expect(backoffFor(2)).toBe(RETRY_BACKOFF_MS * 2);
    expect(backoffFor(3)).toBe(RETRY_BACKOFF_MS * 4);
    /* Total waiting across every retry stays a small fraction of the read budget, so a backoff can
       never be the reason a read runs out of time. */
    const waited = [1, 2].reduce((sum, attempt) => sum + backoffFor(attempt), 0);
    expect(waited).toBeLessThan(READ_BUDGET_MS / 4);
  });

  it('is total over nonsense attempt numbers', () => {
    /* Called in a loop, so a negative or zero attempt must not produce a negative sleep. */
    for (const attempt of [-5, -1, 0]) expect(backoffFor(attempt)).toBe(RETRY_BACKOFF_MS);
  });

  it('gives up after a bounded number of attempts', () => {
    expect(MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(MAX_ATTEMPTS).toBeLessThanOrEqual(4);
  });
});

describe('the budgets fit inside each other', () => {
  it('reads for less time than the route is allowed to run', () => {
    /* `maxDuration` on the route is 60 seconds. The read has to stop early enough that the gate can
       run and the answer can serialise, so the reader meets this page's sentence rather than the
       platform's blank timeout. */
    expect(READ_BUDGET_MS).toBeLessThan(60_000);
    expect(READ_BUDGET_MS).toBeGreaterThan(TREE_TIMEOUT_MS);
  });

  it('gives one request less time than the whole read', () => {
    expect(REQUEST_TIMEOUT_MS).toBeLessThan(READ_BUDGET_MS);
    /* The tree listing gets more than a document does: it is one request and can be tens of
       megabytes, and abandoning it would abandon exactly the large repositories this page wants to
       be able to read. */
    expect(TREE_TIMEOUT_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS);
  });

  it('keeps the caps in a sane relationship to each other', () => {
    expect(MAX_FILE_BYTES).toBeLessThan(MAX_TOTAL_BYTES);
    expect(FETCH_CONCURRENCY).toBeGreaterThan(1);
    expect(FETCH_CONCURRENCY).toBeLessThan(MAX_FILES);
  });
});

describe('which paths are documents', () => {
  it('takes markdown and nothing else', () => {
    expect(isDocumentPath('README.md')).toBe(true);
    expect(isDocumentPath('docs/guide.markdown')).toBe(true);
    expect(isDocumentPath('README.MD')).toBe(true);
    for (const path of ['src/index.ts', 'package.json', 'LICENSE', 'docs/', '']) {
      expect(isDocumentPath(path), path).toBe(false);
    }
    expect(DOCUMENT_EXTENSIONS).toContain('.md');
  });

  it('never descends into a dependency or into build output', () => {
    /* A promise found in a dependency's README is not a promise this repository makes, and a
       README copied into `dist` is the same claim counted twice. */
    for (const path of [
      'node_modules/react/README.md',
      'a/node_modules/b/README.md',
      '.next/x.md',
      'dist/README.md',
      'out/README.md',
      'build/README.md',
      'vendor/thing/README.md',
      'coverage/README.md',
      '.testmuai/tests/a_test.md',
    ]) {
      expect(isDocumentPath(path), path).toBe(false);
    }
  });
});

describe('every bound explains itself in a sentence', () => {
  it('names the file it skipped and the size it skipped it for', () => {
    const said = LIMIT_MESSAGES.fileTooLarge('CHANGELOG.md');
    expect(said).toContain('CHANGELOG.md');
    expect(said).toContain(String(Math.round(MAX_FILE_BYTES / 1024)));
    /* Says what the reader loses, because a skipped document may have stated a claim. */
    expect(said).toContain('missing from the graph');
  });

  it('counts documents it could not transfer, singular and plural', () => {
    expect(LIMIT_MESSAGES.unreadable(1)).toContain('1 document could not');
    expect(LIMIT_MESSAGES.unreadable(3)).toContain('3 documents could not');
  });

  it('says a slow read was slow rather than leaving it a mystery', () => {
    expect(LIMIT_MESSAGES.retried(1)).toContain('1 request had to be retried');
    expect(LIMIT_MESSAGES.retried(4)).toContain('4 requests had to be retried');
    /* And says nothing is missing, because a retry that succeeded cost time and no content. */
    expect(LIMIT_MESSAGES.retried(2)).toContain('Nothing is missing');
  });

  it('points at the CLI wherever a bound is the reason a graph is short', () => {
    for (const said of [
      LIMIT_MESSAGES.tooManyFiles,
      LIMIT_MESSAGES.tooLarge,
      LIMIT_MESSAGES.budgetSpent,
    ]) {
      expect(said, said).toContain('CLI');
    }
  });
});

describe('every way GitHub can decline gets its own sentence', () => {
  it('tells a reader what to do about each one', () => {
    /* A 404 is most often a private repository, and saying so is the difference between a useful
       page and one that implies the reader mistyped. */
    expect(failureMessage(404, 'owner/repo')).toContain('private');
    expect(failureMessage(404, 'owner/repo')).toContain('owner/repo');
    expect(failureMessage(403, 'owner/repo')).toContain('rate limiting');
    expect(failureMessage(429, 'owner/repo')).toContain('rate limiting');
    expect(failureMessage(451, 'owner/repo')).toContain('legal');
    expect(failureMessage(503, 'owner/repo')).toContain('their side');
  });

  it('says something useful even for a status it did not expect', () => {
    const said = failureMessage(418, 'owner/repo');
    expect(said).toContain('418');
    expect(said).toContain('owner/repo');
  });

  it('never leaks a stack trace or an internal path', () => {
    for (const status of [404, 403, 451, 500, 418]) {
      const said = failureMessage(status, 'owner/repo');
      /* A stack frame shape rather than the word "at", which appears legitimately in "repository
         at owner/repo". What must never appear is a frame, an absolute path or a module. */
      expect(said, said).not.toMatch(/\bat\s+\S+\s*\(/);
      expect(said).not.toContain('/Users/');
      expect(said).not.toContain('node_modules');
      expect(said).not.toContain('.ts:');
    }
  });
});
