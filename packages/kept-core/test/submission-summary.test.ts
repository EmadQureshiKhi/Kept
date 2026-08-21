import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The written project summary, pinned to its limit (task 19.4, R14.5).
 *
 * R14.5 asks for a single-paragraph summary of 120 words or fewer. A limit stated
 * in prose is a limit that drifts on the next edit, and the edit that pushes it to
 * 121 words is the same edit that adds the sentence someone thought was worth
 * adding — so the count is asserted here, against the file itself, rather than
 * trusted.
 *
 * `docs/submission-summary.md` holds **only** the paragraph. No heading, no
 * preamble, no trailing note. That is deliberate on two counts: the file is what
 * gets pasted into the submission form, so anything else in it would have to be
 * deleted by hand at the worst possible moment; and "120 words" then has exactly
 * one meaning — every word in the file — instead of needing a rule about which
 * part of the document counts. The README links it rather than restating it, for
 * the same reason.
 *
 * ## What counts as a word
 *
 * Whitespace-separated runs containing at least one letter or digit. So
 * `re-verifies` is one word, as a reader would count it, and a stray punctuation
 * mark standing alone is none. Markdown emphasis would be counted with the word it
 * wraps, which is why the paragraph contains none: a summary of 120 words should
 * not need any.
 *
 * ## What else is asserted
 *
 * The three subjects task 19.4 requires — the promise graph, the citation
 * discipline, the three-way repair branch — are each checked for by name. A
 * summary can pass a word count and still leave out the differentiator, and the
 * third branch is the differentiator: patch the code, evolve the test, or amend
 * the documentation. Only the third is unusual, and a reader who does not reach it
 * has not been told what this project is.
 */

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SUMMARY_PATH = 'docs/submission-summary.md';
const SUMMARY = readFileSync(resolve(REPO_ROOT, SUMMARY_PATH), 'utf8');

/** R14.5's ceiling, and the only place the number is written. */
const WORD_LIMIT = 120;

/**
 * A floor as well as a ceiling.
 *
 * Not a requirement — a guard against the other failure mode. A summary trimmed to
 * a sentence would pass a word *limit* while telling a judge nothing, and the
 * cheapest way to make a failing count pass is to delete text.
 */
const WORD_FLOOR = 90;

function words(text: string): string[] {
  return text.split(/\s+/).filter((token) => /[A-Za-z0-9]/.test(token));
}

describe('the project summary fits R14.5', () => {
  it('is 120 words or fewer', () => {
    const counted = words(SUMMARY);
    expect(
      counted.length,
      `${SUMMARY_PATH} is ${counted.length} words and R14.5 allows ${WORD_LIMIT}. The last ` +
        `${Math.max(0, counted.length - WORD_LIMIT)} word(s) have to go somewhere else.`,
    ).toBeLessThanOrEqual(WORD_LIMIT);
  });

  it('still says something', () => {
    expect(words(SUMMARY).length).toBeGreaterThanOrEqual(WORD_FLOOR);
  });

  it('counts words the way a reader would', () => {
    expect(words('re-verifies the promises')).toEqual(['re-verifies', 'the', 'promises']);
    expect(words('one, two.  three\nfour')).toEqual(['one,', 'two.', 'three', 'four']);
    expect(words('  —  ')).toEqual([]);
  });

  it('is a single paragraph, and the whole file is that paragraph', () => {
    const blocks = SUMMARY.trim().split(/\n\s*\n/);
    expect(
      blocks.length,
      `${SUMMARY_PATH} has ${blocks.length} paragraphs. R14.5 asks for one, and this file ` +
        `is what gets pasted into the submission form.`,
    ).toBe(1);
    expect(SUMMARY.trimStart().startsWith('#'), 'a heading would be pasted in too').toBe(false);
    expect(SUMMARY).not.toContain('```');
    expect(SUMMARY).not.toMatch(/^\s*[-*]\s/m);
  });
});

describe('the project summary covers what task 19.4 requires', () => {
  const lower = SUMMARY.toLowerCase();

  it('names the promise graph', () => {
    expect(lower).toContain('graph');
    expect(lower).toContain('promise');
  });

  it('names the citation discipline, not just the word', () => {
    expect(lower).toContain('cited');
    expect(lower).toMatch(/file and line/);
    expect(
      lower,
      'the discipline is that an unresolvable citation is refused admission, which is ' +
        'the part a reader cannot infer',
      ).toMatch(/does not resolve|unresolv|never enters/);
  });

  it('names all three repair branches, including the one that amends the docs', () => {
    expect(lower).toContain('patch the code');
    expect(lower).toContain('evolve the test');
    expect(lower).toContain('amend the documentation');
    expect(lower).toContain('three');
  });

  it('credits Kane with selecting the branch', () => {
    expect(SUMMARY).toContain('Kane');
    expect(lower).toContain('verdict');
  });
});

describe('the summary is reachable', () => {
  it('is linked from the README rather than restated in it', () => {
    const readme = readFileSync(resolve(REPO_ROOT, 'README.md'), 'utf8');
    expect(
      readme,
      `README.md does not link ${SUMMARY_PATH}. A summary nobody can find is not a ` +
        `deliverable, and a second copy of it in the README would drift from this one.`,
    ).toContain(SUMMARY_PATH);
  });
});
