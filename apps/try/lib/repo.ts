/**
 * Turning whatever a reader pastes into an owner and a repository name.
 *
 * People paste what they have. A browser address bar gives
 * `https://github.com/owner/repo`, a deep link gives
 * `https://github.com/owner/repo/tree/main/docs`, a clone dialog gives
 * `git@github.com:owner/repo.git`, and somebody typing from memory gives `owner/repo`. All
 * four name the same repository, so all four are accepted, and everything else is refused with
 * a sentence rather than silently coerced into a request that will 404.
 *
 * ## Refusing is the interesting half
 *
 * This page fetches whatever it is pointed at, so the parser is the boundary that decides what
 * it may be pointed at. It admits **github.com only**. Not because other hosts are
 * unimportant, but because a field that accepts any URL is a server-side request forgery hole:
 * a reader could paste an internal address and use this deployment as a proxy to reach it. A
 * closed host list is the whole mitigation, and it belongs here where it is testable rather
 * than in the fetching code where it would be one condition among several.
 *
 * Owner and repository names are checked against GitHub's own rule (alphanumerics, hyphen,
 * underscore, dot) so a path segment cannot smuggle a `..` or a slash into the API URL that is
 * built from it.
 *
 * Pure and DOM-free: no fetch, no environment, no filesystem. Every rule below is a string
 * decision, which is why it can be proven over arbitrary input rather than demonstrated on a
 * handful of examples.
 */

/** A repository this page is willing to read. */
export interface RepoRef {
  readonly owner: string;
  readonly repo: string;
  /** The branch or tag, when the pasted URL named one. `null` means the default branch. */
  readonly ref: string | null;
}

/** Why a paste was refused, in words a reader can act on. */
export type RepoParseError =
  | 'empty'
  | 'not-a-github-url'
  | 'no-repository-in-path'
  | 'invalid-name';

/** The outcome of reading a paste. A discriminated union, so a caller cannot ignore failure. */
export type RepoParse =
  | { readonly ok: true; readonly ref: RepoRef }
  | { readonly ok: false; readonly error: RepoParseError; readonly message: string };

/** The only host this page will fetch from. See the header for why the list is closed. */
export const ALLOWED_HOSTS: readonly string[] = Object.freeze(['github.com', 'www.github.com']);

/** GitHub's own rule for an owner or repository name. */
const NAME = /^[A-Za-z0-9._-]+$/;

/** The sentence each refusal says. Exported so the copy has one author. */
export const PARSE_MESSAGES: Readonly<Record<RepoParseError, string>> = {
  empty: 'Paste a public GitHub repository, for example github.com/EmadQureshiKhi/Kept.',
  'not-a-github-url':
    'This reads public repositories on github.com only. That is a deliberate limit rather ' +
    'than an oversight: a field that fetched any address could be used to reach one that is ' +
    'not yours.',
  'no-repository-in-path':
    'That looks like a GitHub URL but names no repository. The shape is ' +
    'github.com/owner/repository.',
  'invalid-name':
    'An owner or repository name may hold letters, digits, hyphens, underscores and dots, ' +
    'and nothing else.',
};

function fail(error: RepoParseError): RepoParse {
  return { ok: false, error, message: PARSE_MESSAGES[error] };
}

/**
 * The `owner/repo[/tree/ref/…]` segments of a path, whatever wrapped them.
 *
 * `.git` is stripped from the repository name because a clone URL carries it and the API does
 * not want it. A `tree` or `blob` segment names a ref, which is kept: somebody who pasted a
 * link to a branch meant that branch.
 */
function fromSegments(segments: readonly string[]): RepoParse {
  const parts = segments.filter((segment) => segment.length > 0);
  const owner = parts[0];
  const rawRepo = parts[1];
  if (owner === undefined || rawRepo === undefined) return fail('no-repository-in-path');

  const repo = rawRepo.endsWith('.git') ? rawRepo.slice(0, -4) : rawRepo;
  if (!NAME.test(owner) || !NAME.test(repo)) return fail('invalid-name');

  /* `/tree/<ref>` and `/blob/<ref>` both name a ref. Anything else after the repository is a
     path inside it, which this page has no use for: it reads the whole documentation tree. */
  const marker = parts[2];
  const named = marker === 'tree' || marker === 'blob' ? parts[3] ?? null : null;
  const ref = named !== null && NAME.test(named) ? named : null;

  return { ok: true, ref: { owner, repo, ref } };
}

/**
 * Read a paste into a repository reference.
 *
 * Total: every input produces either a reference or a refusal with a sentence, and nothing
 * throws. A caller that forgets to check `ok` gets a type error rather than a bad request.
 */
export function parseRepoInput(input: string): RepoParse {
  const trimmed = typeof input === 'string' ? input.trim() : '';
  if (trimmed.length === 0) return fail('empty');

  /* The SSH clone spelling, which is not a URL and so cannot be given to `URL`. */
  const ssh = /^git@([^:]+):(.+)$/.exec(trimmed);
  if (ssh !== null) {
    const host = (ssh[1] ?? '').toLowerCase();
    if (!ALLOWED_HOSTS.includes(host)) return fail('not-a-github-url');
    return fromSegments((ssh[2] ?? '').split('/'));
  }

  /* A bare `owner/repo`, which is what somebody typing from memory produces. Recognised only
     when it holds exactly one slash and no scheme, so a stray path is not mistaken for one. */
  if (!trimmed.includes('://') && !trimmed.includes('.')) {
    const bare = trimmed.split('/');
    if (bare.length === 2) return fromSegments(bare);
  }

  let url: URL;
  try {
    /* A scheme is added rather than required, because `github.com/owner/repo` is what a reader
       copies out of a browser that hides the protocol. */
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return fail('not-a-github-url');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return fail('not-a-github-url');
  if (!ALLOWED_HOSTS.includes(url.hostname.toLowerCase())) return fail('not-a-github-url');

  return fromSegments(url.pathname.split('/'));
}

/** `owner/repo`, the one spelling used in copy, in cache keys and in headings. */
export function repoSlug(ref: RepoRef): string {
  return `${ref.owner}/${ref.repo}`;
}

/** The repository's page, so a reader can check what was read. */
export function repoUrl(ref: RepoRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}`;
}
