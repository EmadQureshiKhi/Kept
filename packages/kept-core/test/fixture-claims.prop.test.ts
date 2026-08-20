import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  buildBaselineOnlyGraph,
  collectBaseline,
  inMemoryBaselineFileSystem,
  inMemoryCitationSource,
  lineCount,
  normaliseClaim,
  promiseId,
  splitLines,
  type PromiseRecord,
} from '@kept/core';

import { arbWhitespaceNoise } from './arbitraries.js';

/**
 * Feature: kept, Property 29: Fixture claims are one-to-one with promises
 * (design §Correctness Properties, §12.2, §12.6, §12.7, R12.4, R12.5).
 *
 * *For any* line of the fixture README claims block, that line yields exactly one
 * promise whose citation names that file and that line number, no line yields two
 * promises, every claim names one of the fixture's screens, and the claim count is
 * at least six.
 *
 * The subject is the **committed corpus**, not a generated stand-in: the real
 * `apps/fixture/README.md` and the real `tests/*_test.md` files, read off disk and
 * pushed through the real baseline provider and the real admission gate. A
 * generated README would prove the provider is a bijection on synthetic input and
 * say nothing about whether the eight promises the demo depends on actually exist,
 * which is the claim R12.4 and R12.5 make about *this repository*.
 *
 * So the property is asserted in two halves.
 *
 * **The bijection, on the committed bytes.** The claims block is located
 * independently of the provider — by its heading and its contiguous run of list
 * items — and the expected line numbers come from that scan. Then both directions
 * are required: every claim line is cited by exactly one promise (no claim without
 * a promise), and every README-citing promise lands on a claim line (no promise
 * without a claim, and no line yielding two). A provider that admitted nothing
 * would satisfy "no line yields two" trivially, which is why the forward
 * direction is asserted line by line.
 *
 * **Its stability, quantified.** The bijection has to survive the edits that are
 * not semantic — a paragraph inserted above the block, a list marker changed, a
 * reflow, CRLF checkout, free text after the tag — because `promiseId` is keyed on
 * file plus normalised claim and never on the line (§3.2). Those are the
 * quantifiers, run over repositories synthesised from the committed bytes so the
 * input space is the space of *edits to the real corpus*. The negative direction
 * is quantified too: rewording a claim must re-key exactly that one promise. A
 * stability property with no negative half is satisfied by a hash that ignores its
 * input.
 */

const NUM_RUNS = 500;

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The one cited document. Repository-relative POSIX, as every citation is. */
const README = 'apps/fixture/README.md';

/** The heading that opens the claims block (design §12.2). */
const CLAIMS_HEADING = '## What Kepler Coffee promises';

/** The seven screens of §12.1. Every claim must name one of them (Property 29). */
const SCREENS = ['Home', 'Shop', 'Product', 'Cart', 'Checkout', 'Orders', 'Settings'] as const;

/** R12.4's floor. The design commits to eight; the requirement demands six. */
const MIN_CLAIMS = 6;

/**
 * The designed corpus, path → frontmatter `test_id`. The mapping is fixed by the
 * fixture register (`test/fixtures/README.md`) and reused by every committed
 * NDJSON fixture, so a renamed id here would desynchronise the whole set.
 */
const EXPECTED_CORPUS: Readonly<Record<string, string>> = Object.freeze({
  'tests/home_cta_test.md': 'T-2',
  'tests/shop_filter_test.md': 'T-1',
  'tests/product_currency_test.md': 'T-8',
  'tests/cart_subtotal_test.md': 'T-3',
  'tests/checkout_validation_test.md': 'T-4',
  'tests/orders_persist_test.md': 'T-5',
  'tests/settings_currency_test.md': 'T-6',
  'tests/cart_discount_test.md': 'T-7',
});

const CORPUS_PATHS = Object.keys(EXPECTED_CORPUS);

const readRepoFile = (file: string): string =>
  readFileSync(resolve(REPO_ROOT, file), { encoding: 'utf8' });

const README_TEXT = readRepoFile(README);
const README_LINES = splitLines(README_TEXT);
const CORPUS_TEXT: ReadonlyMap<string, string> = new Map(
  CORPUS_PATHS.map((path) => [path, readRepoFile(path)]),
);

/** One claim, as the independent scan of the README sees it. */
interface Claim {
  /** One-based README line. */
  readonly line: number;
  /** The line verbatim, list marker included. */
  readonly text: string;
}

/**
 * Locate the claims block without consulting the provider: find the heading, skip
 * blanks, then take the contiguous run of `- ` list items. Independent of the code
 * under test, which is what makes the expected line numbers an oracle rather than
 * a restatement.
 */
function scanClaims(lines: readonly string[]): readonly Claim[] {
  const headingIndex = lines.findIndex((line) => line.trim() === CLAIMS_HEADING);
  if (headingIndex < 0) return [];
  const claims: Claim[] = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const text = lines[index] as string;
    if (text.startsWith('- ')) {
      claims.push({ line: index + 1, text });
      continue;
    }
    if (claims.length > 0) break;
    if (text.trim().length !== 0) break;
  }
  return claims;
}

const CLAIMS = scanClaims(README_LINES);

/** Every `@verifies` tag line in a test document, rewritten by `shift`. */
function shiftTagLines(document: string, shift: number): string {
  return document.replace(
    /(@verifies\s+[^\s:]+:)(\d+)/g,
    (_all, head: string, digits: string) => `${head}${Number.parseInt(digits, 10) + shift}`,
  );
}

/** Replace one README line, keeping every other byte. */
function withLine(lines: readonly string[], oneBasedLine: number, text: string): string {
  const next = [...lines];
  next[oneBasedLine - 1] = text;
  return `${next.join('\n')}\n`;
}

/** Run the real provider and gate over a synthesised repository. */
async function graphOf(files: ReadonlyMap<string, string>): Promise<readonly PromiseRecord[]> {
  const fs = inMemoryBaselineFileSystem(files);
  const citations = inMemoryCitationSource(files);
  const { batch } = await buildBaselineOnlyGraph({ repoRoot: '/synthetic', fs, citations });
  expect(batch.rejected).toEqual([]);
  return batch.graph.promises;
}

/** The committed corpus plus a possibly-edited README. */
function repositoryWith(readmeText: string, shift = 0): ReadonlyMap<string, string> {
  const files = new Map<string, string>([[README, readmeText]]);
  for (const [path, text] of CORPUS_TEXT) files.set(path, shiftTagLines(text, shift));
  return files;
}

/** Promise ids keyed by cited line, for comparing two runs. */
function idsByLine(promises: readonly PromiseRecord[]): ReadonlyMap<number, string> {
  return new Map(promises.map((promise) => [promise.citation.line, promise.id]));
}

describe('Feature: kept, Property 29: Fixture claims are one-to-one with promises', () => {
  it('the committed README states one claim per line, each naming a fixture screen (R12.4, R12.5)', () => {
    expect(CLAIMS.length).toBeGreaterThanOrEqual(MIN_CLAIMS);
    expect(CLAIMS.length).toBe(8);

    // Contiguous, one per line: consecutive line numbers, no gaps, no two claims
    // sharing a line.
    const lines = CLAIMS.map((claim) => claim.line);
    expect(lines).toEqual(lines.map((_line, index) => (lines[0] as number) + index));
    expect(new Set(lines).size).toBe(CLAIMS.length);

    for (const claim of CLAIMS) {
      const normalised = normaliseClaim(claim.text);
      expect(normalised.length).toBeGreaterThan(0);
      // Property 29: "every claim names one of the fixture's screens". That is a
      // membership requirement — the claim must be about a screen the fixture
      // actually has — and not an exclusivity one. R12.4 asks for "a specific
      // observable behaviour of a named screen", which fixes the claim's
      // *subject*; it does not forbid naming a second screen to say where the
      // behaviour's input comes from, and the verbatim block of §12.2 uses
      // exactly that: "The Product screen shows the price in the currency
      // selected on the Settings screen." Asserting one screen per line would
      // put this test in contradiction with the block the design pins, so the
      // count is a floor.
      const named = SCREENS.filter((screen) => normalised.includes(`${screen} screen`));
      expect(named.length).toBeGreaterThanOrEqual(1);
      // A claim is one line, so it cannot carry a line terminator.
      expect(normalised).not.toContain('\n');
    }

    // Two claims that normalise identically would be one promise, which would make
    // the mapping many-to-one however the provider behaves.
    const normalised = CLAIMS.map((claim) => normaliseClaim(claim.text));
    expect(new Set(normalised).size).toBe(CLAIMS.length);

    // The two claims the demo turns on, at the lines the design cites (§3.4, §8.3).
    expect(README_LINES[15]).toBe(
      '- The Cart screen shows a running subtotal that updates immediately when a quantity changes.',
    );
    expect(README_LINES[19]).toBe(
      '- The Cart screen applies a 10 percent discount automatically when the subtotal exceeds 50 dollars.',
    );
  });

  it('every claim line yields exactly one promise, and every promise lands on a claim line', async () => {
    const { result, batch } = await buildBaselineOnlyGraph({ repoRoot: REPO_ROOT });

    // The eight designed tests are all present and all readable — a skipped
    // document would silently drop a promise (R2.3).
    for (const path of CORPUS_PATHS) expect(result.files).toContain(path);
    expect(result.skipped).toEqual([]);

    const promises = batch.graph.promises.filter(
      (promise) => promise.citation.file === README,
    );
    expect(promises.length).toBe(CLAIMS.length);
    expect(batch.rejected).toEqual([]);

    const byLine = new Map<number, PromiseRecord[]>();
    for (const promise of promises) {
      const bucket = byLine.get(promise.citation.line) ?? [];
      bucket.push(promise);
      byLine.set(promise.citation.line, bucket);
    }

    // Forward: each claim line is cited by exactly one promise, whose claim, id and
    // citation text all come from that line.
    for (const claim of CLAIMS) {
      const bucket = byLine.get(claim.line) ?? [];
      expect(bucket.length).toBe(1);
      const promise = bucket[0] as PromiseRecord;
      expect(promise.citation.file).toBe(README);
      expect(promise.citation.line).toBe(claim.line);
      expect(promise.citation.text).toBe(claim.text);
      expect(promise.claim).toBe(normaliseClaim(claim.text));
      expect(promise.id).toBe(promiseId(README, claim.text));
      expect(claim.line).toBeGreaterThanOrEqual(1);
      expect(claim.line).toBeLessThanOrEqual(lineCount(README_TEXT));
    }

    // Backward: no promise cites a line outside the block, so nothing was minted
    // from prose, from the tests table, or from a stale tag.
    const claimLines = new Set(CLAIMS.map((claim) => claim.line));
    for (const promise of promises) expect(claimLines.has(promise.citation.line)).toBe(true);

    // Eight distinct promises and eight distinct designed tests, with the frontmatter
    // ids the fixture register fixes.
    expect(new Set(promises.map((promise) => promise.id)).size).toBe(CLAIMS.length);
    const bindings = promises.map((promise) => promise.designedTest);
    expect(new Set(bindings.map((binding) => binding?.path)).size).toBe(CLAIMS.length);
    for (const binding of bindings) {
      const path = binding?.path as string;
      expect(EXPECTED_CORPUS[path]).toBe(binding?.testId);
    }
  });

  it('one tag per test document, so no document can mint two promises', async () => {
    const result = await collectBaseline({ repoRoot: REPO_ROOT });
    for (const path of CORPUS_PATHS) {
      const derived = result.candidates.filter(
        (candidate) => candidate.designedTest?.path === path,
      );
      expect(derived.length).toBe(1);
      expect((derived[0] as { citation: { file: string } }).citation.file).toBe(README);
    }
  });

  it('the bijection survives an insertion above the block when the citations move with it', async () => {
    const baseline = idsByLine(await graphOf(repositoryWith(README_TEXT)));
    const headingIndex = README_LINES.findIndex((line) => line.trim() === CLAIMS_HEADING);

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom('', 'A paragraph inserted above the block.', '> a note'), {
          minLength: 1,
          maxLength: 6,
        }),
        async (inserted) => {
          const lines = [
            ...README_LINES.slice(0, headingIndex),
            ...inserted,
            ...README_LINES.slice(headingIndex),
          ];
          const shifted = await graphOf(
            repositoryWith(`${lines.join('\n')}\n`, inserted.length),
          );
          // Same eight promises, same ids, each now citing a line further down.
          expect(new Set(shifted.map((promise) => promise.id))).toEqual(
            new Set(baseline.values()),
          );
          for (const promise of shifted) {
            expect(baseline.get(promise.citation.line - inserted.length)).toBe(promise.id);
            expect(promise.citation.text).toBe(
              README_LINES[promise.citation.line - inserted.length - 1],
            );
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('the bijection survives markup, reflow, CRLF and free text after the tag', async () => {
    const baseline = idsByLine(await graphOf(repositoryWith(README_TEXT)));

    // The shared generator for exactly this: the markers, indentation, tab and
    // multi-space reflow, NFD decomposition and zero-width characters that
    // `normaliseClaim` is specified to absorb (§3.2). Using it here rather than a
    // local one keeps this file's notion of "cosmetic" identical to the
    // normaliser's own property suite.
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...CLAIMS),
        arbWhitespaceNoise,
        fc.constantFrom('', ' — the claim under test', ' see §12.2'),
        fc.boolean(),
        async (claim, noise, trailing, crlf) => {
          const body = noise(claim.text.replace(/^- /, ''));
          // A stray CR on the line *and* a CRLF checkout would put `\r\r\n` on
          // one line, which no checkout produces. One or the other.
          fc.pre(!(crlf && body.endsWith('\r')));
          const readme = withLine(README_LINES, claim.line, body);
          const files = new Map(repositoryWith(crlf ? readme.replace(/\n/g, '\r\n') : readme));
          if (trailing.length > 0) {
            for (const [path, text] of files) {
              if (path === README) continue;
              files.set(
                path,
                text.replace(/(@verifies\s+[^\s:]+:\d+)/g, (_all, tag: string) => `${tag}${trailing}`),
              );
            }
          }

          const promises = await graphOf(files);
          // The edit is cosmetic, so every id — including the edited claim's — is
          // unchanged, and no promise was lost or gained.
          expect(new Set(promises.map((promise) => promise.id))).toEqual(
            new Set(baseline.values()),
          );
          for (const promise of promises) {
            expect(baseline.get(promise.citation.line)).toBe(promise.id);
            // A CRLF checkout must not leak a carriage return into the snapshot.
            expect(promise.citation.text).not.toContain('\r');
            expect(promise.claim).not.toContain('\r');
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('rewording one claim re-keys exactly that one promise, and the mapping stays one-to-one', async () => {
    const baseline = idsByLine(await graphOf(repositoryWith(README_TEXT)));

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...CLAIMS),
        fc.constantFrom<(text: string) => string>(
          (text) => text.replace(/\.$/, ' every time.'),
          (text) => text.replace(/screen/, '**screen**'),
          (text) => text.replace(/^- The /, '- the '),
          (text) => `${text} No exceptions.`,
        ),
        async (claim, reword) => {
          const edited = reword(claim.text);
          fc.pre(normaliseClaim(edited) !== normaliseClaim(claim.text));

          const promises = await graphOf(
            repositoryWith(withLine(README_LINES, claim.line, edited)),
          );
          expect(promises.length).toBe(CLAIMS.length);

          const after = idsByLine(promises);
          expect(after.get(claim.line)).toBe(promiseId(README, edited));
          expect(after.get(claim.line)).not.toBe(baseline.get(claim.line));
          // Every other claim keeps its promise: the edit is local to one line.
          for (const other of CLAIMS) {
            if (other.line === claim.line) continue;
            expect(after.get(other.line)).toBe(baseline.get(other.line));
          }
          // Still one promise per line.
          expect(new Set(after.keys()).size).toBe(CLAIMS.length);
          expect(new Set(after.values()).size).toBe(CLAIMS.length);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
