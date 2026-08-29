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
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  READ_BUDGET_MS,
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

/** The default branch of a repository, or a failure. One API call. */
async function readRepoMeta(ref: RepoRef): Promise<{ branch: string } | RepoReadFailure> {
  const url = `https://api.github.com/repos/${ref.owner}/${ref.repo}`;
  const res = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': USER_AGENT },
  });
  if (!res.ok) {
    return { ok: false, status: res.status, message: failureMessage(res.status, repoSlug(ref)) };
  }
  const body = (await res.json()) as { default_branch?: unknown };
  const branch = typeof body.default_branch === 'string' ? body.default_branch : 'main';
  return { branch };
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
  const slug = repoSlug(ref);
  const notes: string[] = [];

  let branch = ref.ref;
  if (branch === null) {
    const meta = await readRepoMeta(ref);
    if ('ok' in meta && meta.ok === false) return meta;
    branch = (meta as { branch: string }).branch;
  }

  const treeUrl =
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/git/trees/` +
    `${encodeURIComponent(branch)}?recursive=1`;
  const treeRes = await fetch(treeUrl, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': USER_AGENT },
  });
  if (!treeRes.ok) {
    return {
      ok: false,
      status: treeRes.status,
      message: failureMessage(treeRes.status, slug),
    };
  }

  const tree = (await treeRes.json()) as {
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

  /* Fetched in bounded batches: sequential would exceed the budget on a large tree, and
     unbounded would open a socket per document and invite GitHub to refuse them all. */
  for (let at = 0; at < selected.length; at += FETCH_CONCURRENCY) {
    if (Date.now() - started > READ_BUDGET_MS) {
      budgetSpent = true;
      break;
    }
    const batch = selected.slice(at, at + FETCH_CONCURRENCY);
    const fetched = await Promise.all(
      batch.map(async (entry) => {
        if (entry.size > MAX_FILE_BYTES) {
          return { path: entry.path, text: null, tooLarge: true };
        }
        const raw =
          `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/` +
          `${encodeURIComponent(branch as string)}/${entry.path.split('/').map(encodeURIComponent).join('/')}`;
        try {
          const res = await fetch(raw, { headers: { 'user-agent': USER_AGENT } });
          if (!res.ok) return { path: entry.path, text: null, tooLarge: false };
          return { path: entry.path, text: await res.text(), tooLarge: false };
        } catch {
          /* A single document failing to transfer is not a failed read of the repository. */
          return { path: entry.path, text: null, tooLarge: false };
        }
      }),
    );

    for (const entry of fetched) {
      if (entry.tooLarge) {
        notes.push(LIMIT_MESSAGES.fileTooLarge(entry.path));
        continue;
      }
      if (entry.text === null) continue;
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

  return {
    ok: true,
    files,
    sha: typeof tree.sha === 'string' ? tree.sha : branch,
    branch,
    offered,
    notes,
  };
}
