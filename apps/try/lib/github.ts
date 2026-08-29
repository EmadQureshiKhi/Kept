/**
 * Reading a public repository's documentation over HTTP, without cloning it.
 *
 * The obvious way to graph a stranger's repository is to clone it, install it and read the
 * working copy. That is minutes of work, needs a writable disk and a package manager, and does
 * not fit in a serverless invocation. It is also unnecessary: the admission gate needs *text*,
 * not a checkout.
 *
 * So this makes exactly one API call to list the tree, then fetches the markdown files it named
 * from `raw.githubusercontent.com`. Two consequences worth stating:
 *
 *   - **It is fast.** A couple of seconds for a documentation tree, against minutes for a clone
 *     and an install.
 *   - **It needs no credential.** Unauthenticated GitHub allows sixty API requests an hour per
 *     address and this spends one of them per read; the raw host is not part of that budget. So
 *     nobody has to trust this deployment with a token, and there is no token here to leak.
 *
 * ## Everything is bounded, because nothing is authenticated
 *
 * There is no login and no rate-limit table, so `limits.ts` is the whole defence: a cap on
 * files, on total bytes, on any single file, on concurrency, and a wall-clock budget under the
 * platform's own timeout so a reader meets a sentence rather than a blank gateway error. Each
 * bound reports itself as a note rather than failing the read, because a partial graph with an
 * explanation is more useful than an error page.
 *
 * ## Failures are values
 *
 * Nothing here throws. GitHub answering 404, 403, 451 or 500 is a normal thing that happens to a
 * public endpoint, and each becomes a sentence a reader can act on. A page whose error state is
 * a stack trace is a page that tells a stranger about its internals and tells them nothing about
 * their repository.
 */

import {
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
} from './limits.js';
import { repoSlug, type RepoRef } from './repo.js';

/** What a read produced: the bytes, and everything the reader has to be told about them. */
export interface RepoRead {
  readonly ok: true;
  /** Repository-relative POSIX path to file contents. The map the gate reads. */
  readonly files: ReadonlyMap<string, string>;
  /** The commit the tree was listed at, so a result can be attributed and cached. */
  readonly sha: string;
  /** The branch actually read, which may be the repository's default rather than a request. */
  readonly branch: string;
  /** How many markdown documents the tree offered, before any cap. */
  readonly offered: number;
  /** Bounds that were reached, in the words of `limits.ts`. Empty on a complete read. */
  readonly notes: readonly string[];
}

/** Why a read could not happen, in a sentence rather than a status code. */
export interface RepoReadFailure {
  readonly ok: false;
  readonly status: number;
  readonly message: string;
}

export type RepoReadResult = RepoRead | RepoReadFailure;

/** The user agent GitHub asks unauthenticated callers to identify themselves with. */
export const USER_AGENT = 'kept-try (+https://github.com/EmadQureshiKhi/Kept)';

/** What a reader is told for each way GitHub can decline. */
export function failureMessage(status: number, slug: string): string {
  if (status === 404) {
    return (
      `GitHub has no public repository at ${slug}. Check the spelling, and note that this page ` +
      `reads public repositories only: a private one is invisible to it because it holds no ` +
      `credential to see one with.`
    );
  }
  if (status === 403 || status === 429) {
    return (
      'GitHub is rate limiting this page. It reads repositories without a token, which allows ' +
      'sixty requests an hour from one address, and that budget is currently spent. It refills ' +
      'within the hour. The CLI on your own machine has no such limit.'
    );
  }
  if (status === 451) {
    return `GitHub has made ${slug} unavailable for legal reasons, so there is nothing to read.`;
  }
  if (status >= 500) {
    return `GitHub answered ${String(status)} for ${slug}, which is a fault on their side rather than in this page. Worth trying again shortly.`;
  }
  return `GitHub answered ${String(status)} for ${slug}, which this page did not expect.`;
}

interface TreeEntry {
  readonly path?: unknown;
  readonly type?: unknown;
  readonly size?: unknown;
}

/**
 * `true` when asking again could plausibly get a different answer.
 *
 * The distinction is between a *failure* and an *answer*. A timeout, a dropped socket, a 502 from
 * a load balancer and a 429 are failures: the request never reached a decision, so repeating it is
 * reasonable. A 404, a 403 or a 451 is GitHub deciding, and asking a second time gets the same
 * decision while spending another of the sixty requests this page is allowed in an hour. Retrying
 * an answer is how a page turns one refusal into three and then reports a rate limit.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** How long to wait before attempt `attempt`, counting from one. Doubles, and never negative. */
export function backoffFor(attempt: number): number {
  return RETRY_BACKOFF_MS * 2 ** Math.max(0, attempt - 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** What one bounded, retried request produced. Never throws. */
interface Attempted {
  readonly response: Response | null;
  /** The last status seen, or 0 when no attempt ever got a response at all. */
  readonly status: number;
  /** Attempts beyond the first. Reported to the reader, because a slow read wants explaining. */
  readonly retries: number;
}

/**
 * One request, with a per-attempt timeout, bounded retries and an overall deadline.
 *
 * Every fetch in this module goes through here, which is the point: a timeout or a retry policy
 * that only some requests get is a policy that fails on whichever request somebody forgot.
 *
 * `AbortSignal.timeout` rather than a `setTimeout` and a manual controller, because the platform
 * has the primitive and a hand-rolled one leaks a timer on the success path. Deliberately *not*
 * combined with a caller's signal: the deadline below is a cheaper way to say the same thing and
 * `AbortSignal.any` is newer than the Node floor this repository builds on.
 */
async function attempt(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  deadline: number,
): Promise<Attempted> {
  let status = 0;
  let retries = 0;

  for (let n = 1; n <= MAX_ATTEMPTS; n += 1) {
    /* Checked before every attempt, so a retry cannot walk past the budget the reader is waiting
       on. A read that has run out of time reports what it has rather than starting more work. */
    if (Date.now() > deadline) break;
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      status = res.status;
      if (res.ok || !isRetryableStatus(res.status)) return { response: res, status, retries };
      /* A retryable status still has a body, and leaving it undrained holds the socket. */
      await res.arrayBuffer().catch(() => undefined);
    } catch {
      /* A timeout, a reset, a DNS failure. Indistinguishable here and treated alike: the request
         reached no decision, so it is worth one more go. */
      status = status === 0 ? 0 : status;
    }
    if (n < MAX_ATTEMPTS && Date.now() + backoffFor(n) < deadline) {
      retries += 1;
      await sleep(backoffFor(n));
      continue;
    }
    break;
  }

  return { response: null, status, retries };
}

/** The sentence for a request that never got an answer at all, as against one that was refused. */
function unreachableMessage(slug: string): string {
  return (
    `This page could not reach GitHub to read ${slug}. It tried ${String(MAX_ATTEMPTS)} times. ` +
    `That is usually a passing network fault rather than anything about your repository, so it is ` +
    `worth trying again. The CLI reads your working copy and needs no network at all.`
  );
}

/** The default branch of a repository, or a failure. One API call. */
async function readRepoMeta(
  ref: RepoRef,
  deadline: number,
): Promise<{ branch: string; retries: number } | RepoReadFailure> {
  const url = `https://api.github.com/repos/${ref.owner}/${ref.repo}`;
  const got = await attempt(
    url,
    { accept: 'application/vnd.github+json', 'user-agent': USER_AGENT },
    REQUEST_TIMEOUT_MS,
    deadline,
  );
  if (got.response === null) {
    return got.status === 0
      ? { ok: false, status: 504, message: unreachableMessage(repoSlug(ref)) }
      : { ok: false, status: got.status, message: failureMessage(got.status, repoSlug(ref)) };
  }
  if (!got.response.ok) {
    return {
      ok: false,
      status: got.response.status,
      message: failureMessage(got.response.status, repoSlug(ref)),
    };
  }
  const body = (await got.response.json()) as { default_branch?: unknown };
  const branch = typeof body.default_branch === 'string' ? body.default_branch : 'main';
  return { branch, retries: got.retries };
}

/**
 * The whole read.
 *
 * The budget is checked between fetches rather than enforced with a timeout on each, because the
 * thing worth bounding is the reader's wait rather than any single request. A read that runs out
 * returns what it has with `LIMIT_MESSAGES.budgetSpent` attached, which is a more useful answer
 * than an abort.
 */
export async function readRepository(ref: RepoRef): Promise<RepoReadResult> {
  const started = Date.now();
  const deadline = started + READ_BUDGET_MS;
  const slug = repoSlug(ref);
  const notes: string[] = [];
  let retries = 0;

  let branch = ref.ref;
  if (branch === null) {
    const meta = await readRepoMeta(ref, deadline);
    if ('ok' in meta && meta.ok === false) return meta;
    branch = (meta as { branch: string }).branch;
    retries += (meta as { retries: number }).retries;
  }

  const treeUrl =
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/git/trees/` +
    `${encodeURIComponent(branch)}?recursive=1`;
  const gotTree = await attempt(
    treeUrl,
    { accept: 'application/vnd.github+json', 'user-agent': USER_AGENT },
    TREE_TIMEOUT_MS,
    deadline,
  );
  retries += gotTree.retries;
  if (gotTree.response === null) {
    return gotTree.status === 0
      ? { ok: false, status: 504, message: unreachableMessage(slug) }
      : { ok: false, status: gotTree.status, message: failureMessage(gotTree.status, slug) };
  }
  if (!gotTree.response.ok) {
    return {
      ok: false,
      status: gotTree.response.status,
      message: failureMessage(gotTree.response.status, slug),
    };
  }

  const tree = (await gotTree.response.json()) as {
    sha?: unknown;
    truncated?: unknown;
    tree?: unknown;
  };
  if (tree.truncated === true) notes.push(LIMIT_MESSAGES.treeTruncated);

  const entries = Array.isArray(tree.tree) ? (tree.tree as TreeEntry[]) : [];
  const documents = entries
    .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string')
    .map((entry) => ({
      path: entry.path as string,
      size: typeof entry.size === 'number' ? entry.size : 0,
    }))
    .filter((entry) => isDocumentPath(entry.path))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  const offered = documents.length;
  let selected = documents;
  if (selected.length > MAX_FILES) {
    selected = selected.slice(0, MAX_FILES);
    notes.push(LIMIT_MESSAGES.tooManyFiles);
  }

  const files = new Map<string, string>();
  let totalBytes = 0;
  let budgetSpent = false;
  let sizeCapped = false;
  let unreadable = 0;

  /* Fetched in bounded batches: sequential would exceed the budget on a large tree, and
     unbounded would open a socket per document and invite GitHub to refuse them all. */
  for (let at = 0; at < selected.length; at += FETCH_CONCURRENCY) {
    if (Date.now() > deadline) {
      budgetSpent = true;
      break;
    }
    const batch = selected.slice(at, at + FETCH_CONCURRENCY);
    const fetched = await Promise.all(
      batch.map(async (entry) => {
        if (entry.size > MAX_FILE_BYTES) {
          return { path: entry.path, text: null, tooLarge: true, retries: 0 };
        }
        const raw =
          `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/` +
          `${encodeURIComponent(branch as string)}/${entry.path.split('/').map(encodeURIComponent).join('/')}`;
        const got = await attempt(
          raw,
          { 'user-agent': USER_AGENT },
          REQUEST_TIMEOUT_MS,
          deadline,
        );
        if (got.response === null || !got.response.ok) {
          /* A single document failing to transfer is not a failed read of the repository. It is
             counted, though, and said out loud: a claim silently missing from a graph is the
             failure mode this whole project exists to prevent. */
          return { path: entry.path, text: null, tooLarge: false, retries: got.retries };
        }
        try {
          return {
            path: entry.path,
            text: await got.response.text(),
            tooLarge: false,
            retries: got.retries,
          };
        } catch {
          return { path: entry.path, text: null, tooLarge: false, retries: got.retries };
        }
      }),
    );

    for (const entry of fetched) {
      retries += entry.retries;
      if (entry.tooLarge) {
        notes.push(LIMIT_MESSAGES.fileTooLarge(entry.path));
        continue;
      }
      if (entry.text === null) {
        unreadable += 1;
        continue;
      }
      const bytes = Buffer.byteLength(entry.text, 'utf8');
      if (totalBytes + bytes > MAX_TOTAL_BYTES) {
        sizeCapped = true;
        continue;
      }
      totalBytes += bytes;
      files.set(entry.path, entry.text);
    }
  }

  if (sizeCapped) notes.push(LIMIT_MESSAGES.tooLarge);
  if (budgetSpent) notes.push(LIMIT_MESSAGES.budgetSpent);
  if (unreadable > 0) notes.push(LIMIT_MESSAGES.unreadable(unreadable));
  if (retries > 0) notes.push(LIMIT_MESSAGES.retried(retries));

  /**
   * A tree that listed documents and a read that got none of them is a failure, not a graph.
   *
   * Without this the reader is told "no claims found, which is a real answer" when the truth is
   * that nothing could be transferred, and those two are not the same thing at all. The first is
   * about their repository; the second is about this page's afternoon.
   */
  if (files.size === 0 && offered > 0) {
    return { ok: false, status: 504, message: unreachableMessage(slug) };
  }

  return {
    ok: true,
    files,
    sha: typeof tree.sha === 'string' ? tree.sha : branch,
    branch,
    offered,
    notes,
  };
}
