/**
 * Reading whatever a reader pasted, and refusing everything else.
 *
 * `parseRepoInput` is the security boundary of this application, not merely a convenience. The page
 * fetches what it is pointed at, so the parser decides what it may be pointed at, and the closed
 * host list is the whole mitigation against being used as a proxy to reach an address that is not
 * the reader's. That is why the refusals get more tests here than the successes.
 *
 * The four shapes accepted are the four shapes people actually have to hand: a browser address bar,
 * a deep link into a branch, a clone dialog, and something typed from memory.
 */

import { describe, expect, it } from 'vitest';

import {
  ALLOWED_HOSTS,
  PARSE_MESSAGES,
  parseRepoInput,
  repoSlug,
  repoUrl,
} from '../lib/repo.js';

/** The reference, or a failure with the assertion message naming what came back. */
function refOf(input: string) {
  const parsed = parseRepoInput(input);
  expect(parsed.ok, `refused ${JSON.stringify(input)}: ${parsed.ok ? '' : parsed.message}`).toBe(
    true,
  );
  return parsed.ok ? parsed.ref : null;
}

describe('the shapes a reader actually pastes', () => {
  it('reads a browser address bar, with or without the scheme or a trailing slash', () => {
    for (const input of [
      'https://github.com/EmadQureshiKhi/Kept',
      'http://github.com/EmadQureshiKhi/Kept',
      'github.com/EmadQureshiKhi/Kept',
      'https://github.com/EmadQureshiKhi/Kept/',
      '  https://github.com/EmadQureshiKhi/Kept  ',
      'https://www.github.com/EmadQureshiKhi/Kept',
    ]) {
      const ref = refOf(input);
      expect(ref?.owner).toBe('EmadQureshiKhi');
      expect(ref?.repo).toBe('Kept');
    }
  });

  it('reads a deep link and keeps the branch it names', () => {
    /* Somebody who pasted a link to a branch meant that branch, so the ref is kept rather than
       silently replaced with the default. */
    expect(refOf('https://github.com/owner/repo/tree/develop')?.ref).toBe('develop');
    expect(refOf('https://github.com/owner/repo/tree/develop/docs/guide')?.ref).toBe('develop');
    expect(refOf('https://github.com/owner/repo/blob/v2/README.md')?.ref).toBe('v2');
  });

  it('reads a clone URL, and drops the .git a clone dialog adds', () => {
    expect(refOf('git@github.com:owner/repo.git')?.repo).toBe('repo');
    expect(refOf('https://github.com/owner/repo.git')?.repo).toBe('repo');
  });

  it('reads a bare owner/repo, which is what somebody types from memory', () => {
    const ref = refOf('EmadQureshiKhi/Kept');
    expect(ref?.owner).toBe('EmadQureshiKhi');
    expect(ref?.repo).toBe('Kept');
    expect(ref?.ref).toBeNull();
  });

  it('reads a bare owner/repo whose repository name holds a dot', () => {
    /* A real bug this is the regression test for. The bare form used to be recognised only when the
       whole paste held no dot, on the reasoning that a dot meant a hostname. A repository name is
       perfectly entitled to one, so `vercel/next.js` fell through to the URL branch, was read as
       the host `vercel`, and came back refused as not being a GitHub URL. It is one of the three
       examples printed on the page, so the first thing a curious reader pressed did not work.

       The test is on the segment before the slash now, which is the part that could be a host. */
    for (const [input, owner, repo] of [
      ['vercel/next.js', 'vercel', 'next.js'],
      ['owner/some.thing.md', 'owner', 'some.thing.md'],
      ['owner/repo.js', 'owner', 'repo.js'],
    ] as const) {
      const ref = refOf(input);
      expect(ref?.owner).toBe(owner);
      expect(ref?.repo).toBe(repo);
    }
  });

  it('still prefers the host reading when the first segment looks like one', () => {
    /* The remaining ambiguity, decided on purpose. An owner may hold a dot, so `a.b/c` could be a
       bare paste, but it is shaped exactly like a host and this page fetches what it is pointed at.
       Refusing costs a reader one more paste of the full URL; guessing "owner" for something shaped
       like a host is how a field starts reaching addresses nobody meant. */
    const parsed = parseRepoInput('a.b/c');
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.error).toBe('not-a-github-url');
    /* And the unambiguous spelling of the same thing is accepted. */
    expect(refOf('https://github.com/a.b/c')?.owner).toBe('a.b');
  });

  it('reports no branch when the paste named none', () => {
    /* `null` rather than a guessed `main`: the default branch is the repository's to state, and
       `github.ts` asks it. Guessing here would 404 on anything using `master` or `trunk`. */
    expect(refOf('github.com/owner/repo')?.ref).toBeNull();
  });
});

describe('everything else is refused, with a sentence', () => {
  it('refuses any host but github.com, which is the whole SSRF mitigation', () => {
    /* A field that fetched any address could be pointed at an internal one and turn this
       deployment into a proxy for reaching it. The host list is closed for that reason. */
    for (const input of [
      'https://gitlab.com/owner/repo',
      'https://bitbucket.org/owner/repo',
      'https://github.evil.com/owner/repo',
      'https://notgithub.com/owner/repo',
      'http://localhost:3000/owner/repo',
      'http://127.0.0.1/owner/repo',
      'http://169.254.169.254/latest/meta-data',
      'https://raw.githubusercontent.com/owner/repo/main/README.md',
      'git@gitlab.com:owner/repo.git',
    ]) {
      const parsed = parseRepoInput(input);
      expect(parsed.ok, `admitted ${input}`).toBe(false);
      if (!parsed.ok) expect(parsed.error).toBe('not-a-github-url');
    }
  });

  it('refuses a scheme that is not http or https', () => {
    for (const input of [
      'file:///etc/passwd',
      'ftp://github.com/owner/repo',
      'javascript:alert(1)',
      'data:text/html,hello',
    ]) {
      expect(parseRepoInput(input).ok, `admitted ${input}`).toBe(false);
    }
  });

  it('refuses a github URL that names no repository', () => {
    for (const input of ['https://github.com', 'https://github.com/', 'https://github.com/owner']) {
      const parsed = parseRepoInput(input);
      expect(parsed.ok, `admitted ${input}`).toBe(false);
      if (!parsed.ok) expect(parsed.error).toBe('no-repository-in-path');
    }
  });

  it('refuses a name that could smuggle a path segment into the API URL', () => {
    /* The owner and repository are interpolated into an api.github.com URL, so a segment holding
       a slash or a `..` would reach a different endpoint than the one intended. */
    for (const input of [
      'https://github.com/owner/..',
      'https://github.com/../repo',
      'https://github.com/ow ner/repo',
      'https://github.com/owner/re$po',
    ]) {
      const parsed = parseRepoInput(input);
      expect(parsed.ok, `admitted ${input}`).toBe(false);
    }
  });

  it('refuses an empty paste with the sentence that says what to do instead', () => {
    for (const input of ['', '   ', '\n\t']) {
      const parsed = parseRepoInput(input);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error).toBe('empty');
        expect(parsed.message).toBe(PARSE_MESSAGES.empty);
      }
    }
  });

  it('never throws, whatever it is handed', () => {
    /* Total, because this runs on a public endpoint and an exception here would be a stack trace
       in a response. */
    for (const input of [
      'https://',
      '://',
      '/////',
      'github.com/'.repeat(50),
      '\u0000',
      'https://github.com/owner/repo?a=1#b',
      '%%%',
    ]) {
      expect(() => parseRepoInput(input)).not.toThrow();
    }
  });

  it('says something a reader can act on for every failure mode', () => {
    for (const [error, message] of Object.entries(PARSE_MESSAGES)) {
      expect(message.length, `${error} has no message`).toBeGreaterThan(30);
      /* A sentence, not a code: this text is shown to somebody who pasted the wrong thing. */
      expect(message).toMatch(/[.!]$/);
    }
  });
});

describe('the spellings the rest of the app builds from', () => {
  it('has exactly two admitted hosts, both github.com', () => {
    expect([...ALLOWED_HOSTS]).toEqual(['github.com', 'www.github.com']);
  });

  it('spells the slug and the URL one way', () => {
    const ref = { owner: 'EmadQureshiKhi', repo: 'Kept', ref: null };
    expect(repoSlug(ref)).toBe('EmadQureshiKhi/Kept');
    expect(repoUrl(ref)).toBe('https://github.com/EmadQureshiKhi/Kept');
  });
});
