import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  NO_PROVIDER_AXES,
  admitPromises,
  computeMetrics,
  inMemoryCitationSource,
  mergeGraph,
  normaliseClaim,
  parseSnapshot,
  promiseId,
  type PromiseCandidate,
  type PromiseRecord,
  type ProviderResult,
} from '@kept/core';

/**
 * Feature: kept, Property 36: Self-cited promises are the same kind as fixture
 * promises (design §Correctness Properties, §23.1, §23.2, R19.1, R19.2, R19.3, R19.4).
 *
 * *For any* snapshot carrying promises cited to both the fixture documentation and
 * the repository's own root README, no promise record field distinguishes the two
 * other than the citation path, every self-cited promise without a designed test
 * carries verdict `undesigned` and is counted in the outstanding debt, and no code
 * path consulted while admitting them tests for either path.
 *
 * **Validates: Requirements 19.1, 19.2, 19.3, 19.4**
 *
 * ## Why this property and not a unit test of the new claims
 *
 * Task 26 admits five claims from this repository's own `README.md`, and the whole
 * value of doing it is the claim that **nothing had to be added to the engine**. That
 * claim is worth exactly as much as the guard behind it. A single special case is all
 * it takes for "portable" to stop being true while every other test stays green: a
 * `file === 'README.md'` branch in the gate, a self-cited promise carrying one extra
 * field, a metrics rule that skips a path. None of those would break the fixture, none
 * would break the Ledger, and none would be visible in a snapshot a reader skims.
 *
 * So the property is stated three ways, and the third is the load-bearing one.
 *
 * 1. **Parity by construction.** The same claim, the same document body and the same
 *    cited line are admitted twice, once under a fixture path and once under the root
 *    README. The two records must be identical in every field except `citation.file`
 *    and the derived `id`, and the id must be exactly `promiseId(path, claim)`, which
 *    is the one place the path is allowed to matter.
 * 2. **The undesigned arm, and that it is not path-conditioned.** A candidate with no
 *    designed test comes out `undesigned` and is counted in `undesignedCount`, and the
 *    count is the same whichever document the claim is cited to. This is R19.4 stated
 *    over the real merge and the real metrics rather than over the committed file,
 *    which matters here: the committed snapshot's `undesignedCount` is `0` because a
 *    promise enters *this* repository's graph only through a `@verifies` tag and the
 *    tag that admits a claim is the same tag that binds its designed test. The arm is
 *    still specified behaviour, and a host repository whose provider supplies an
 *    unbound claim gets it, so it is proven here where a provider can be generated.
 * 3. **Behavioural blindness, then syntactic.** For any two paths carrying the same
 *    bytes, admission answers the same thing: the same acceptance, the same refusal
 *    reason, the same citation text, the same claim. And the modules consulted while
 *    admitting carry no fixture path, no `README` literal and no citation-path
 *    comparison in executable code at all. The behavioural clause is the requirement;
 *    the scan is what catches a branch before it has a case that exercises it.
 *
 * Clause 3's scan strips comments first. Every module it reads names
 * `apps/fixture/README.md` in its prose, on purpose, because those paragraphs are the
 * record of what used to be a literal and what would go wrong if it came back
 * (§20.2). Banning the explanation and keeping the rule would be the wrong trade. The
 * stripper is local rather than imported from `no-repository-literals.test.ts`:
 * importing a suite to borrow a helper would register that suite's tests a second
 * time under this file's name.
 */

/** The design's testing-strategy floor is 100 runs. Stated so it cannot regress. */
const NUM_RUNS = 300;

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** The fixture's claim surface, and this repository's own. */
const FIXTURE_DOC = 'apps/fixture/README.md';
const SELF_DOC = 'README.md';

/**
 * The modules a candidate passes through between a `@verifies` tag and a
 * `PromiseRecord`. Nothing else is consulted while admitting, which is what makes the
 * list short enough to scan exhaustively.
 */
const ADMITTING_MODULES: readonly string[] = Object.freeze([
  'packages/kept-core/src/model/admission.ts',
  'packages/kept-core/src/model/ids.ts',
  'packages/kept-core/src/model/promise.ts',
  'packages/kept-core/src/model/metrics.ts',
  'packages/kept-core/src/providers/baseline.ts',
  'packages/kept-core/src/providers/merge.ts',
]);

/**
 * Remove line and block comments, leaving strings and template literals intact.
 *
 * Small state machine rather than a regular expression, for the two cases a regular
 * expression gets wrong in opposite directions: a `//` inside a string literal is not
 * a comment, and a `/*` inside a string must not open one that swallows the rest of
 * the file. Newlines are preserved so a reported line number still points where a
 * reader can look.
 */
function stripComments(source: string): string {
  let out = '';
  let index = 0;
  while (index < source.length) {
    const two = source.slice(index, index + 2);
    if (two === '//') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (two === '/*') {
      index += 2;
      while (index < source.length && source.slice(index, index + 2) !== '*/') {
        if (source[index] === '\n') out += '\n';
        index += 1;
      }
      index += 2;
      continue;
    }
    const character = source[index] as string;
    if (character === '"' || character === "'" || character === '`') {
      out += character;
      index += 1;
      while (index < source.length) {
        const inner = source[index] as string;
        out += inner;
        index += 1;
        if (inner === '\\') {
          if (index < source.length) {
            out += source[index] as string;
            index += 1;
          }
          continue;
        }
        if (inner === character) break;
      }
      continue;
    }
    out += character;
    index += 1;
  }
  return out;
}

/** One admitting module, comments removed. */
interface Module {
  readonly path: string;
  readonly code: string;
}

const MODULES: readonly Module[] = ADMITTING_MODULES.map((path) => ({
  path,
  code: stripComments(readFileSync(resolve(REPO_ROOT, path), 'utf8')),
}));

/** A claim body with no leading markdown decoration and no collapsible run. */
const arbClaim: fc.Arbitrary<string> = fc.constantFrom(
  'The Cart screen shows a running subtotal.',
  'npm run demo # Ledger on :3000, fixture on :3100',
  '| `/badge.svg` | GET only, `image/svg+xml` |',
  'No network, no credentials, no Kane.',
  '**The deployed artefact cannot spend or mutate.**',
  'a snapshot committed in this repository: Kane is invoked zero times,',
);

/** Filler so the cited line is never the only line in the document. */
const arbFiller: fc.Arbitrary<string> = fc.constantFrom(
  '',
  '## a heading',
  'prose nobody cites',
  '- an unrelated bullet',
);

/** A document body, and a one-based line inside it that carries the claim. */
interface Document {
  readonly lines: readonly string[];
  readonly line: number;
  readonly claim: string;
}

const arbDocument: fc.Arbitrary<Document> = fc
  .record({
    before: fc.array(arbFiller, { minLength: 0, maxLength: 4 }),
    after: fc.array(arbFiller, { minLength: 0, maxLength: 4 }),
    claim: arbClaim,
  })
  .map(({ before, after, claim }) => ({
    lines: [...before, claim, ...after],
    line: before.length + 1,
    claim,
  }));

/** A candidate citing `file` at `document.line`, with the fields a provider sets. */
function candidateFor(
  file: string,
  document: Document,
  designedTest: PromiseCandidate['designedTest'] = { path: 'tests/example_test.md', testId: null },
): PromiseCandidate {
  return {
    claim: document.claim,
    // A deliberately wrong `text`, so the gate overwriting it from disk is visible in
    // the parity comparison rather than inferable from a value that already agreed.
    citation: { file, line: document.line, text: 'a paraphrase the provider invented' },
    provider: 'baseline',
    designedTest,
    verdictSource: null,
    repair: null,
    evidencePackId: null,
    credits: null,
  };
}

/** A baseline provider result over these candidates, and nothing else. */
function baselineResult(candidates: readonly PromiseCandidate[]): ProviderResult {
  return {
    provider: 'baseline',
    candidates,
    axes: NO_PROVIDER_AXES,
    ok: true,
    degradedReason: null,
    diagnostics: [],
  };
}

/** A record with the two fields a citation path is allowed to move removed. */
function withoutPath(promise: PromiseRecord): Record<string, unknown> {
  const { id, citation, ...rest } = promise;
  void id;
  return { ...rest, citation: { line: citation.line, text: citation.text } };
}

describe('Feature: kept, Property 36: Self-cited promises are the same kind as fixture promises', () => {
  it('admits one claim identically from the fixture README and from its own', () => {
    fc.assert(
      fc.property(arbDocument, (document) => {
        const body = `${document.lines.join('\n')}\n`;
        // One body, two paths. The bytes are the same, so every difference in the
        // answer is attributable to the path and nothing else.
        const citations = inMemoryCitationSource({ [FIXTURE_DOC]: body, [SELF_DOC]: body });

        const admitted = [FIXTURE_DOC, SELF_DOC].map((file) => {
          const batch = admitPromises({
            candidates: [candidateFor(file, document)],
            source: citations,
          });
          expect(batch.rejected).toEqual([]);
          return batch.admitted[0] as PromiseRecord;
        });
        const [fixture, self] = admitted as [PromiseRecord, PromiseRecord];

        // R19.2: the same kind of promise, distinguished only by the citation path.
        expect(withoutPath(self)).toStrictEqual(withoutPath(fixture));
        expect(Object.keys(self).sort()).toEqual(Object.keys(fixture).sort());
        expect(Object.keys(self.citation).sort()).toEqual(Object.keys(fixture.citation).sort());

        // The path is allowed to key the identifier, and that is the whole of its
        // influence. Both ids are exactly what `promiseId` derives, and they differ,
        // because the same sentence in two files is two promises.
        expect(fixture.citation.file).toBe(FIXTURE_DOC);
        expect(self.citation.file).toBe(SELF_DOC);
        expect(fixture.id).toBe(promiseId(FIXTURE_DOC, document.claim));
        expect(self.id).toBe(promiseId(SELF_DOC, document.claim));
        expect(self.id).not.toBe(fixture.id);

        // Disk is the authority on both, so the invented paraphrase survives in
        // neither (R1.3), and the claim is the normalised line in both.
        expect(self.citation.text).toBe(document.claim);
        expect(fixture.citation.text).toBe(document.claim);
        expect(self.claim).toBe(normaliseClaim(document.claim));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('answers identically for any two paths carrying the same bytes', () => {
    fc.assert(
      fc.property(
        arbDocument,
        fc.constantFrom(
          SELF_DOC,
          FIXTURE_DOC,
          'docs/promises.md',
          'CHANGELOG.md',
          'apps/other/readme.txt',
          'content/help/refunds.mdx',
        ),
        fc.constantFrom(SELF_DOC, FIXTURE_DOC, 'docs/promises.md', 'CHANGELOG.md'),
        fc.integer({ min: -2, max: 6 }),
        (document, left, right, offset) => {
          const body = `${document.lines.join('\n')}\n`;
          const citations = inMemoryCitationSource({ [left]: body, [right]: body });
          // The line is offset so refusals are drawn too: line 0 and a line past the
          // end must be refused for the same reason under either path, which is the
          // half of blindness an acceptance-only generator would miss.
          const line = document.line + offset;

          const answers = [left, right].map((file) =>
            admitPromises({
              candidates: [
                { ...candidateFor(file, document), citation: { file, line, text: 'invented' } },
              ],
              source: citations,
            }),
          );
          const [first, second] = answers as [
            ReturnType<typeof admitPromises>,
            ReturnType<typeof admitPromises>,
          ];

          expect(second.rejected.length).toBe(first.rejected.length);
          expect(second.rejected.map((entry) => entry.reason)).toEqual(
            first.rejected.map((entry) => entry.reason),
          );
          expect(second.admitted.length).toBe(first.admitted.length);
          if (first.admitted.length === 1 && second.admitted.length === 1) {
            expect(withoutPath(second.admitted[0] as PromiseRecord)).toStrictEqual(
              withoutPath(first.admitted[0] as PromiseRecord),
            );
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('carries an unbound self-cited claim as undesigned, counted as debt (R19.4)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(arbDocument, fc.constantFrom(SELF_DOC, FIXTURE_DOC), fc.boolean()), {
          minLength: 1,
          maxLength: 6,
        }),
        (rows) => {
          const bodies = new Map<string, string>();
          const candidates: PromiseCandidate[] = [];
          for (const [document, file, bound] of rows) {
            const body = `${document.lines.join('\n')}\n`;
            // One body per path, so every citation in the batch resolves. A repeated
            // path keeps the first body, and the claim is read off whatever body won,
            // which is fine: the property is about the fields, not about the words.
            if (!bodies.has(file)) bodies.set(file, body);
            candidates.push(
              candidateFor(
                file,
                document,
                bound ? { path: 'tests/example_test.md', testId: 'T-1' } : null,
              ),
            );
          }
          const merged = mergeGraph({
            baseline: baselineResult(candidates),
            citations: inMemoryCitationSource(bodies),
          });
          const metrics = computeMetrics(merged.graph);

          const unbound = merged.graph.promises.filter(
            (promise) => promise.designedTest === null,
          );
          for (const promise of unbound) expect(promise.verdict).toBe('undesigned');
          // The debt is the count of them, and it is one field rather than two, so it
          // cannot drift from the graph it describes (R5.8).
          expect(metrics.undesignedCount).toBe(unbound.length);
          expect(metrics.designedCount).toBe(metrics.totalPromises - unbound.length);

          // And the arm is blind to the path: the same rows cited entirely to the
          // fixture produce the same counts as the same rows cited entirely to this
          // repository's own README.
          const counts = [SELF_DOC, FIXTURE_DOC].map((file) => {
            const single = rows.map(([document, , bound]) =>
              candidateFor(
                file,
                document,
                bound ? { path: 'tests/example_test.md', testId: 'T-1' } : null,
              ),
            );
            const body = `${(rows[0] as [Document, string, boolean])[0].lines.join('\n')}\n`;
            const graph = mergeGraph({
              baseline: baselineResult(single),
              citations: inMemoryCitationSource({ [file]: body }),
            }).graph;
            const measured = computeMetrics(graph);
            return `${measured.totalPromises}/${measured.designedCount}/${measured.undesignedCount}`;
          });
          expect(counts[1]).toBe(counts[0]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('consults no code path that tests for either citation path', () => {
    for (const module of MODULES) {
      expect(
        module.code.includes('apps/fixture'),
        `${module.path} names the fixture in executable code, so admitting a fixture claim ` +
          `and admitting one of ours are no longer the same code path.`,
      ).toBe(false);
      expect(
        /README/.test(module.code),
        `${module.path} spells README in executable code. A promise is a path and a line; ` +
          `nothing in the graph may know what a README is.`,
      ).toBe(false);
      // The general form of the same ban: no comparison of a citation path against a
      // literal at all. A branch on `citation.file` is how a special case starts.
      expect(
        /citation\.file\s*[=!]==?/.test(module.code),
        `${module.path} compares a citation path against something. The path keys the ` +
          `identifier and is otherwise carried, never inspected.`,
      ).toBe(false);
    }
  });

  it('found the modules it scanned, so the scan is not vacuous', () => {
    expect(MODULES).toHaveLength(ADMITTING_MODULES.length);
    for (const module of MODULES) expect(module.code.length).toBeGreaterThan(500);
    // The stripper is the thing that could silently make the scan pass: prove it
    // removes prose and keeps code, in the two directions a regular expression fails.
    expect(stripComments("const a = 'http://x'; // apps/fixture/README.md\n")).toContain(
      "'http://x'",
    );
    expect(stripComments('/* apps/fixture/README.md */ const b = 1;')).not.toContain('fixture');
    expect(stripComments("const c = '/*'; const d = 'apps/fixture/lib/x.ts';")).toContain(
      'apps/fixture/lib/x.ts',
    );
  });
});

describe('Property 36 over the committed snapshot', () => {
  const SNAPSHOT = parseSnapshot(
    readFileSync(resolve(REPO_ROOT, 'apps/ledger/data/ledger.snapshot.json'), 'utf8'),
  );

  const self = SNAPSHOT.promises.filter((promise) => promise.citation.file === SELF_DOC);
  const fixture = SNAPSHOT.promises.filter((promise) => promise.citation.file === FIXTURE_DOC);

  it('carries promises cited to both documents, so the comparison is real', () => {
    expect(self.length).toBeGreaterThan(0);
    expect(fixture.length).toBeGreaterThan(0);
  });

  it('gives a self-cited promise the same fields as a fixture one', () => {
    const shapeOf = (promise: (typeof SNAPSHOT.promises)[number]): readonly string[] =>
      Object.keys(promise).sort();
    const reference = shapeOf(fixture[0] as (typeof SNAPSHOT.promises)[number]);
    for (const promise of [...self, ...fixture]) {
      expect(shapeOf(promise), `promise ${promise.id} carries a different set of fields`).toEqual(
        reference,
      );
      expect(Object.keys(promise.citation).sort()).toEqual(['file', 'line', 'text']);
      // Every promise in the file was supplied by the same provider, under the same
      // name, whichever document it is cited to.
      expect(promise.providers).toContain('baseline');
    }
  });
});
