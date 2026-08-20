import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ADMISSION_DIAGNOSTIC_CODE_VALUES,
  admitPromises,
  createDiagnosticSink,
  inMemoryCitationSource,
  lineCount,
  promiseId,
  toPosix,
  type AdmissionRejectionReason,
  type PromiseCandidate,
} from '@kept/core';

/**
 * Feature: kept, Property 2: Graph admission requires a resolvable citation
 * (design §Correctness Properties, §3.3, R1.3, R1.4, R1.5).
 *
 * *For any* mixture of promise candidates from either provider, every promise
 * present in the built graph has a citation whose one-based line number is within
 * the line count of an existing cited file and whose text equals that line
 * verbatim; every candidate lacking a citation or citing a line beyond the end of
 * its file is absent from the graph and has produced exactly one diagnostic
 * naming the supplying provider.
 *
 * Both directions are asserted, and both are needed. A gate that admits nothing
 * satisfies the first half trivially — an empty graph has no unresolvable
 * citation in it — so the second half is what gives the property teeth: every
 * resolvable candidate *must* arrive, and every unresolvable one must be absent
 * *and accounted for*. Together they say the graph's promises are exactly the
 * admitted ones, for any mixture of resolvable and unresolvable inputs.
 *
 * The oracle is independent of the implementation. Documents are generated as an
 * array of lines plus a terminator style and only then joined into text, so the
 * expected line count is `lines.length` — known by construction — and the
 * expected citation text is `lines[line - 1]`. Nothing in the expectation is
 * computed by the code under test. That is what makes the no-phantom-final-line
 * rule genuinely checked rather than asserted against itself: a three-line
 * document ending in `\n` is generated as three lines, and line 4 is required to
 * be refused.
 *
 * **Validates: Requirements 1.3, 1.4, 1.5**
 */

/** Design's testing-strategy floor is 100 runs; stated so it cannot regress. */
const NUM_RUNS = 500;

/** Repository-relative POSIX paths that documents are generated for. */
const arbFile: fc.Arbitrary<string> = fc.constantFrom(
  'apps/fixture/README.md',
  'apps/fixture/CHANGELOG.md',
  'README.md',
  'docs/promises.md',
);

/** Paths no document is ever generated for, so a citation to one cannot resolve. */
const ABSENT_FILES: readonly string[] = ['docs/absent.md', 'apps/fixture/GONE.md'];

/**
 * Paths the gate refuses to read at all: absolute, Windows-absolute, and escaping
 * the repository root. 2.11 should absorb this as `arbUnsafePath`.
 */
const UNSAFE_PATHS: readonly string[] = [
  '/etc/passwd',
  'C:/Windows/system.ini',
  '../../secrets.env',
  'apps/../../secrets.env',
  '   ',
];

/**
 * One line of a document. Includes the named edge cases: a whitespace-only line,
 * an indented line, a line with trailing spaces, markdown decoration, and a
 * genuinely empty line. No `\n` or `\r`, because those are terminators and the
 * generator owns terminators. 2.11 should absorb this as part of `arbDocument`.
 */
const arbLineText: fc.Arbitrary<string> = fc.constantFrom(
  'Cart updates instantly',
  '- Checkout is fast',
  '## Shipping is free',
  '  indented claim  ',
  '\t\t',
  '   ',
  '',
  '3.5x faster checkout',
  'caf\u00e9 orders never drop',
);

/** A non-empty final line: see {@link arbDocument} for why the last line matters. */
const arbFinalLineText: fc.Arbitrary<string> = arbLineText.filter((line) => line.length > 0);

/** How a generated document terminates. All four combinations are exercised. */
type Ending = 'lf' | 'lf-no-trailing' | 'crlf' | 'crlf-no-trailing';

const arbEnding: fc.Arbitrary<Ending> = fc.constantFrom(
  'lf',
  'lf-no-trailing',
  'crlf',
  'crlf-no-trailing',
);

/** A generated document: the lines it has, and the text those lines serialise to. */
interface Document {
  /** The truth. `lines.length` is the expected line count, by construction. */
  readonly lines: readonly string[];
  /** What a reader sees. */
  readonly content: string;
}

/**
 * Documents, built lines-first.
 *
 * The final line is generated non-empty on purpose, and it is the only
 * restriction: a document whose last line is empty *and* which has no trailing
 * terminator is not expressible on disk — `"a\n"` is one line followed by a
 * terminator, not two lines the second of which is empty. Allowing it would make
 * the generator, not the gate, wrong. Empty lines anywhere else are generated
 * freely, and the zero-line document (an empty file) is generated too.
 *
 * 2.11 should absorb this as the document half of `arbCitation`.
 */
const arbDocument: fc.Arbitrary<Document> = fc
  .tuple(
    fc.array(arbLineText, { minLength: 0, maxLength: 5 }),
    arbFinalLineText,
    arbEnding,
    fc.boolean(),
  )
  .map(([leading, final, ending, empty]) => {
    if (empty) return { lines: [], content: '' };
    const lines = [...leading, final];
    const eol = ending === 'crlf' || ending === 'crlf-no-trailing' ? '\r\n' : '\n';
    const trailing = ending === 'lf' || ending === 'crlf' ? eol : '';
    return { lines, content: lines.join(eol) + trailing };
  });

/** One generated document, under its path. */
interface DocumentEntry {
  readonly file: string;
  readonly document: Document;
}

/**
 * A document set, possibly empty — a repository with no cited files at all is a
 * state the gate has to survive.
 */
const arbDocumentSet: fc.Arbitrary<readonly DocumentEntry[]> = fc
  .uniqueArray(arbFile, { minLength: 0, maxLength: 4 })
  .chain((files) =>
    fc
      .tuple(...files.map(() => arbDocument))
      .map((documents) =>
        files.map((file, index) => ({ file, document: documents[index] as Document })),
      ),
  );

const arbProvider = fc.constantFrom('baseline' as const, 'enrichment' as const);

/** Claim text as a provider would report it. Independent of the cited line. */
const arbClaim: fc.Arbitrary<string> = fc.constantFrom(
  'Cart updates instantly',
  'Checkout is fast',
  'Shipping is free',
  'Orders never drop',
  '',
);

/**
 * A candidate paired with the truth about it: what the gate must answer, and — on
 * admission — the exact text it must produce. Built by construction, never by
 * asking the implementation.
 */
interface TaggedCandidate {
  readonly candidate: PromiseCandidate;
  readonly expected: 'admit' | AdmissionRejectionReason;
  /** The verbatim line, when this candidate must be admitted. */
  readonly expectedText: string | null;
}

function tag(
  claim: string,
  provider: 'baseline' | 'enrichment',
  citation: { file: string; line: number; text: string } | null,
  expected: 'admit' | AdmissionRejectionReason,
  expectedText: string | null = null,
): TaggedCandidate {
  return { candidate: { claim, citation, provider }, expected, expectedText };
}

/**
 * Provider-supplied citation text, deliberately wrong most of the time: the gate
 * has to overwrite it with what is on disk, so a generator that supplied the
 * right text would never notice if it did not.
 */
const arbSuppliedText: fc.Arbitrary<string> = fc.constantFrom(
  'stale paraphrase',
  '',
  'Checkout is quick',
  'invented line',
);

/** Candidates that need no document to classify. */
function arbUngroundedCandidate(): fc.Arbitrary<TaggedCandidate> {
  return fc.oneof(
    // Uncited (R1.5).
    fc
      .tuple(arbClaim, arbProvider)
      .map(([claim, provider]) => tag(claim, provider, null, 'no-citation')),
    // Cited file absent.
    fc
      .tuple(arbClaim, arbProvider, fc.constantFrom(...ABSENT_FILES), fc.integer({ min: 1, max: 9 }), arbSuppliedText)
      .map(([claim, provider, file, line, text]) =>
        tag(claim, provider, { file, line, text }, 'file-missing'),
      ),
    // Cited path the gate refuses to read.
    fc
      .tuple(arbClaim, arbProvider, fc.constantFrom(...UNSAFE_PATHS), fc.integer({ min: 1, max: 9 }), arbSuppliedText)
      .map(([claim, provider, file, line, text]) =>
        tag(claim, provider, { file, line, text }, 'file-missing'),
      ),
  );
}

/** Candidates whose classification depends on a generated document. */
function arbGroundedCandidate(entry: DocumentEntry): fc.Arbitrary<TaggedCandidate> {
  const { file, document } = entry;
  const count = document.lines.length;
  const options: fc.Arbitrary<TaggedCandidate>[] = [
    // One past the end — the off-by-one this rule exists for. For a document
    // ending in `\n`, `count + 1` is the phantom line that must not exist.
    fc
      .tuple(arbClaim, arbProvider, arbSuppliedText)
      .map(([claim, provider, text]) =>
        tag(claim, provider, { file, line: count + 1, text }, 'line-out-of-range'),
      ),
    // Far past the end.
    fc
      .tuple(arbClaim, arbProvider, fc.integer({ min: 2, max: 500 }), arbSuppliedText)
      .map(([claim, provider, beyond, text]) =>
        tag(claim, provider, { file, line: count + beyond, text }, 'line-out-of-range'),
      ),
    // Not a position in a file at all.
    fc
      .tuple(arbClaim, arbProvider, fc.constantFrom(0, -1, -42, 1.5, 2.5), arbSuppliedText)
      .map(([claim, provider, line, text]) =>
        tag(claim, provider, { file, line, text }, 'line-out-of-range'),
      ),
  ];

  if (count > 0) {
    // Any line in range, and the line exactly at EOF, which must be admitted.
    options.push(
      fc
        .tuple(arbClaim, arbProvider, fc.integer({ min: 1, max: count }), arbSuppliedText)
        .map(([claim, provider, line, text]) =>
          tag(claim, provider, { file, line, text }, 'admit', document.lines[line - 1] as string),
        ),
      fc
        .tuple(arbClaim, arbProvider, arbSuppliedText)
        .map(([claim, provider, text]) =>
          tag(claim, provider, { file, line: count, text }, 'admit', document.lines[count - 1] as string),
        ),
    );
  }

  return fc.oneof(...options);
}

/** A whole run: some documents, and a mixture of candidates over them. */
interface Scenario {
  readonly entries: readonly DocumentEntry[];
  readonly tagged: readonly TaggedCandidate[];
}

const arbScenario: fc.Arbitrary<Scenario> = arbDocumentSet.chain((entries) => {
  const candidates: fc.Arbitrary<TaggedCandidate>[] = [arbUngroundedCandidate()];
  for (const entry of entries) candidates.push(arbGroundedCandidate(entry));
  return fc
    .array(fc.oneof(...candidates), { minLength: 0, maxLength: 10 })
    .map((tagged) => ({ entries, tagged }));
});

function sourceFor(entries: readonly DocumentEntry[]) {
  return inMemoryCitationSource(
    new Map(entries.map((entry) => [entry.file, entry.document.content])),
  );
}

function documentMap(entries: readonly DocumentEntry[]): Map<string, Document> {
  return new Map(entries.map((entry) => [toPosix(entry.file), entry.document]));
}

/** The id a candidate would derive if admitted. Keyed on file and claim only. */
function idOf(tagged: TaggedCandidate): string | null {
  const citation = tagged.candidate.citation;
  return citation === null ? null : promiseId(citation.file, tagged.candidate.claim);
}

describe('Feature: kept, Property 2: Graph admission requires a resolvable citation', () => {
  it('admits a candidate exactly when its citation resolves', () => {
    fc.assert(
      fc.property(arbScenario, ({ entries, tagged }) => {
        const batch = admitPromises({
          candidates: tagged.map((entry) => entry.candidate),
          source: sourceFor(entries),
        });
        tagged.forEach((entry, index) => {
          const admission = batch.admissions[index];
          if (admission === undefined) throw new Error('missing admission');
          expect(admission.ok).toBe(entry.expected === 'admit');
          if (!admission.ok) expect(admission.reason).toBe(entry.expected);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('gives every promise in the graph a citation resolving to that verbatim line', () => {
    fc.assert(
      fc.property(arbScenario, ({ entries, tagged }) => {
        const documents = documentMap(entries);
        const batch = admitPromises({
          candidates: tagged.map((entry) => entry.candidate),
          source: sourceFor(entries),
        });
        for (const promise of batch.graph.promises) {
          const document = documents.get(promise.citation.file);
          // The cited file exists...
          expect(document).toBeDefined();
          if (document === undefined) continue;
          // ...the one-based line is within its line count...
          expect(Number.isInteger(promise.citation.line)).toBe(true);
          expect(promise.citation.line).toBeGreaterThanOrEqual(1);
          expect(promise.citation.line).toBeLessThanOrEqual(document.lines.length);
          // ...and the text is that line, verbatim, whitespace included.
          expect(promise.citation.text).toBe(document.lines[promise.citation.line - 1]);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('keeps every unresolvable candidate out of the graph', () => {
    fc.assert(
      fc.property(arbScenario, ({ entries, tagged }) => {
        const batch = admitPromises({
          candidates: tagged.map((entry) => entry.candidate),
          source: sourceFor(entries),
        });
        const admittedIds = new Set(batch.graph.promises.map((promise) => promise.id));
        const resolvableIds = new Set(
          tagged.filter((entry) => entry.expected === 'admit').map((entry) => idOf(entry) as string),
        );
        // The graph's promises are exactly the admitted ones — no more, and no
        // fewer. This is the direction that makes the property meaningful: a gate
        // that admitted nothing would fail here.
        expect([...admittedIds].sort()).toEqual([...resolvableIds].sort());

        // And a rejected candidate is absent unless a *different*, resolvable
        // candidate happens to derive the same id (ids ignore the line, so a
        // valid citation and a stale one to the same claim share an id).
        for (const entry of tagged) {
          if (entry.expected === 'admit') continue;
          const id = idOf(entry);
          if (id === null || resolvableIds.has(id)) continue;
          expect(admittedIds.has(id)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reports exactly one diagnostic per rejection, naming the supplying provider', () => {
    fc.assert(
      fc.property(arbScenario, ({ entries, tagged }) => {
        const sink = createDiagnosticSink();
        const batch = admitPromises({
          candidates: tagged.map((entry) => entry.candidate),
          source: sourceFor(entries),
          diagnostics: sink,
        });
        const rejections = tagged.filter((entry) => entry.expected !== 'admit');
        // One per rejection, and none for an admission.
        expect(batch.rejected).toHaveLength(rejections.length);
        expect(sink.size).toBe(rejections.length);
        expect(batch.graph.diagnostics).toHaveLength(rejections.length);
        batch.rejected.forEach((rejection, index) => {
          const supplier = rejections[index]?.candidate.provider;
          expect(rejection.provider).toBe(supplier);
          // Named, in the message a reviewer reads.
          expect(rejection.diagnostic.message).toContain(supplier as string);
          expect(ADMISSION_DIAGNOSTIC_CODE_VALUES).toContain(rejection.diagnostic.code);
          expect(rejection.diagnostic.severity).toBe('error');
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('carries the requested line and the actual count on every range rejection', () => {
    fc.assert(
      fc.property(arbScenario, ({ entries, tagged }) => {
        const documents = documentMap(entries);
        const batch = admitPromises({
          candidates: tagged.map((entry) => entry.candidate),
          source: sourceFor(entries),
        });
        for (const rejection of batch.rejected) {
          if (rejection.reason !== 'line-out-of-range') continue;
          const document = documents.get(rejection.file);
          expect(document).toBeDefined();
          // The count is the document's own, by construction — not read back
          // from the code that produced it.
          expect(rejection.lineCount).toBe(document?.lines.length);
          expect(rejection.diagnostic.message).toContain(String(rejection.requestedLine));
          expect(rejection.diagnostic.message).toContain(`${rejection.lineCount} line`);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('counts lines with no phantom final line, whatever the terminator', () => {
    fc.assert(
      fc.property(arbDocument, (document) => {
        // The generator knows how many lines it wrote; the implementation must
        // agree, for LF and CRLF, with and without a trailing terminator, and for
        // the empty document.
        expect(lineCount(document.content)).toBe(document.lines.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('admits nothing at all when there are no documents to cite', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(arbClaim, arbProvider, arbFile, fc.integer({ min: 1, max: 20 })), {
          minLength: 1,
          maxLength: 8,
        }),
        (rows) => {
          const batch = admitPromises({
            candidates: rows.map(([claim, provider, file, line]) => ({
              claim,
              provider,
              citation: { file, line, text: 'anything' },
            })),
            source: inMemoryCitationSource({}),
          });
          expect(batch.graph.promises).toEqual([]);
          expect(batch.rejected).toHaveLength(rows.length);
          expect(
            batch.rejected.every((rejection) => rejection.reason === 'file-missing'),
          ).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
