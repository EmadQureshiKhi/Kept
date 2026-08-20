import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  AMENDMENT_DIAGNOSTIC_CODES,
  KEPT_DIRECTORY_NAME,
  TEMP_FILE_SUFFIX,
  acceptAmendment,
  amendmentInterlockHash,
  amendmentPath,
  createDiagnosticSink,
  hasTrailingNewline,
  promiseId,
  proposeAmendment,
  rejectAmendment,
  splitDocument,
  type AtomicRenamer,
  type StateFileSystem,
} from '../src/index.js';

import { arbCitation, type CitationCase } from './arbitraries.js';

/**
 * **Property 19: A documentation amendment writes nothing until accepted, then
 * edits exactly one line**
 *
 * **Validates: Requirements 7.3, 7.4, 7.6**
 *
 * This is the property the third repair branch stands on. KEPT's claim is that when
 * a promise goes red one of the three repairs is *amend the documentation*, and the
 * only reason that is defensible is that KEPT never performs it on its own. So two
 * clauses, over generated documents rather than over one README:
 *
 * 1. **`propose()` and `reject()` write nothing outside `.kept/`.** Asserted against
 *    a filesystem that records every `writeFile` and every `ensureDir` it is asked
 *    for, and against the seeded document bytes themselves. A system that quietly
 *    edited documentation so its own tests would pass is the dishonesty this ledger
 *    exists to prevent; this is the assertion that would catch it.
 *
 * 2. **`accept()` with a matching hash changes exactly one line, and with a
 *    mismatched hash changes nothing.** The equality asserted is byte-level: the
 *    bytes before the cited line's text and the bytes from its terminator onward are
 *    identical, which subsumes "the line endings survived" and "the trailing-newline
 *    state survived" rather than restating them as separate hopes. `arbCitation`
 *    supplies the CRLF documents, the documents with no final newline, the cited
 *    lines of pure whitespace, and the citations exactly at and exactly one past EOF
 *    — which is exactly this property's material, so it is reused rather than
 *    re-generated.
 *
 * The replacement pool is deliberately non-empty. Emptying a **final unterminated**
 * line removes it, because there is no byte sequence spelling "an empty last line
 * with no newline after it" — `repair-line-edit.test.ts` states that carve-out
 * where it belongs, in the counting rule. An amendment replaces one claim with
 * another claim, so the case does not arise here.
 */

const REPO_ROOT = '/repo';
const KEPT_PREFIX = `${REPO_ROOT}/${KEPT_DIRECTORY_NAME}/`;

/** A filesystem that records everything it is asked to touch. */
interface Recorder {
  readonly fileSystem: StateFileSystem;
  readonly rename: AtomicRenamer;
  readonly writes: string[];
  readonly directories: string[];
  readonly renames: [string, string][];
  readonly files: Map<string, string>;
}

function recorderFor(documents: Readonly<Record<string, string>>): Recorder {
  const files = new Map<string, string>();
  for (const [file, content] of Object.entries(documents)) {
    files.set(`${REPO_ROOT}/${file}`, content);
  }
  const writes: string[] = [];
  const directories: string[] = [];
  const renames: [string, string][] = [];
  return {
    files,
    writes,
    directories,
    renames,
    fileSystem: {
      readFile: (path) => files.get(path) ?? null,
      ensureDir: (path) => {
        directories.push(path);
      },
      writeFile: (path, contents) => {
        writes.push(path);
        files.set(path, contents);
      },
    },
    rename: (from, to) => {
      renames.push([from, to]);
      const contents = files.get(from);
      if (contents === undefined) throw new Error(`no staging file at ${from}`);
      files.set(to, contents);
      files.delete(from);
    },
  };
}

/** Replacements: single-line, non-empty, and none equal to a generated claim. */
const arbReplacement: fc.Arbitrary<string> = fc.constantFrom(
  '- The Cart screen shows the order total with no automatic discounts.',
  'amended',
  '  indented replacement  ',
  '> a blockquote replacement',
  'caf\u00e9 r\u00e9sum\u00e9 \u2014 amended',
);

/** Replacements that must be refused outright: they would edit more than one line. */
const arbMultilineReplacement: fc.Arbitrary<string> = fc.constantFrom(
  'one\ntwo',
  'one\r\ntwo',
  'trailing\r',
);

/** What happens to the document between the proposal and the acceptance. */
type Tamper = 'none' | 'edit-cited-line' | 'edit-other-line' | 'truncate' | 'delete-file';

const arbTamper: fc.Arbitrary<Tamper> = fc.constantFrom(
  'none',
  'none',
  'edit-cited-line',
  'edit-other-line',
  'truncate',
  'delete-file',
);

/** The byte offsets of a one-based line's text, derived from the model. */
function boundsOf(content: string, line: number): { start: number; end: number } {
  const model = splitDocument(content);
  let start = model.bom.length;
  for (let index = 0; index < line - 1; index += 1) {
    const previous = model.lines[index];
    if (previous === undefined) break;
    start += previous.text.length + previous.terminator.length;
  }
  return { start, end: start + (model.lines[line - 1]?.text.length ?? 0) };
}

/** Every recorded path is inside the `.kept/` fence. The clause with teeth. */
function assertNothingOutsideKept(recorder: Recorder): void {
  for (const path of [...recorder.writes, ...recorder.directories]) {
    expect(path.startsWith(KEPT_PREFIX), `wrote outside .kept/: ${path}`).toBe(true);
  }
  expect(recorder.renames).toEqual([]);
  expect([...recorder.files.keys()].some((path) => path.endsWith(TEMP_FILE_SUFFIX))).toBe(false);
}

/** The seeded documents are byte-identical to what they were. */
function assertDocumentsUntouched(
  recorder: Recorder,
  documents: Readonly<Record<string, string>>,
): void {
  for (const [file, content] of Object.entries(documents)) {
    expect(recorder.files.get(`${REPO_ROOT}/${file}`), file).toBe(content);
  }
}

function proposeFor(
  generated: CitationCase,
  recorder: Recorder,
  proposedText: string,
  diagnostics = createDiagnosticSink(),
) {
  const claim = generated.citedLine ?? generated.citation.text;
  return proposeAmendment({
    repoRoot: REPO_ROOT,
    promiseId: promiseId(generated.citation.file, claim.length === 0 ? 'a claim' : claim),
    citation: generated.citation,
    proposedText,
    rationale: 'Kane observed the product never did what this line claims.',
    strategy: 'resultCode740',
    evidenceRef: 'evidence/ev_20260820T184011Z/failure.yaml',
    at: '2026-08-20T18:41:02.118Z',
    fileSystem: recorder.fileSystem,
    diagnostics,
  });
}

describe('Property 19: an amendment writes nothing until accepted, then edits one line', () => {
  it('propose() writes only under .kept/, whatever the citation resolves to', () => {
    fc.assert(
      fc.property(arbCitation, arbReplacement, (generated, replacement) => {
        const recorder = recorderFor(generated.documents);
        const sink = createDiagnosticSink();
        const proposed = proposeFor(generated, recorder, replacement, sink);

        assertNothingOutsideKept(recorder);
        assertDocumentsUntouched(recorder, generated.documents);

        if (!proposed.ok) {
          // Every refusal wrote nothing at all, not merely nothing dangerous.
          expect(recorder.writes).toEqual([]);
          return true;
        }
        expect(proposed.amendment.status).toBe('pending');
        expect(proposed.amendment.appliedAt).toBeNull();
        expect(recorder.writes).toEqual([amendmentPath(REPO_ROOT, proposed.amendment.id)]);
        // The record's interlock is the hash of the line that is actually on disk.
        expect(proposed.amendment.expectedSha256).toBe(
          amendmentInterlockHash(generated.citedLine ?? ''),
        );
        expect(proposed.amendment.currentText).toBe(generated.citedLine);
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it('refuses a replacement that would edit more than one line, and writes nothing', () => {
    fc.assert(
      fc.property(arbCitation, arbMultilineReplacement, (generated, replacement) => {
        const recorder = recorderFor(generated.documents);
        const sink = createDiagnosticSink();
        const proposed = proposeFor(generated, recorder, replacement, sink);
        expect(proposed.ok).toBe(false);
        if (proposed.ok) return true;
        expect(proposed.reason).toBe('multiline');
        expect(sink.entries.map((entry) => entry.code)).toContain(
          AMENDMENT_DIAGNOSTIC_CODES.multiline,
        );
        expect(recorder.writes).toEqual([]);
        assertDocumentsUntouched(recorder, generated.documents);
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it('reject() writes one record under .kept/ and touches nothing else', () => {
    fc.assert(
      fc.property(arbCitation, arbReplacement, (generated, replacement) => {
        const recorder = recorderFor(generated.documents);
        const proposed = proposeFor(generated, recorder, replacement);
        if (!proposed.ok) return true;

        const rejected = rejectAmendment({
          repoRoot: REPO_ROOT,
          id: proposed.amendment.id,
          fileSystem: recorder.fileSystem,
        });
        expect(rejected.outcome).toBe('rejected');
        expect(rejected.amendment?.status).toBe('rejected');
        assertNothingOutsideKept(recorder);
        assertDocumentsUntouched(recorder, generated.documents);
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it('accept() edits exactly one line on a match and nothing at all on a mismatch', () => {
    fc.assert(
      fc.property(arbCitation, arbReplacement, arbTamper, (generated, replacement, tamper) => {
        const recorder = recorderFor(generated.documents);
        const sink = createDiagnosticSink();
        const proposed = proposeFor(generated, recorder, replacement, sink);
        if (!proposed.ok) return true;

        const absolute = `${REPO_ROOT}/${generated.citation.file}`;
        const line = generated.citation.line;
        const before = recorder.files.get(absolute) as string;

        // Move the document under the proposal, in the ways a human actually would.
        let expectStale = false;
        switch (tamper) {
          case 'none':
            break;
          case 'edit-cited-line': {
            const { start, end } = boundsOf(before, line);
            recorder.files.set(absolute, `${before.slice(0, start)}edited${before.slice(end)}`);
            expectStale = true;
            break;
          }
          case 'edit-other-line': {
            const model = splitDocument(before);
            // Only meaningful when there *is* another line; otherwise this is a no-op
            // and the interlock legitimately still matches.
            const other = model.lines.length > 1 ? (line === 1 ? 2 : 1) : null;
            if (other !== null) {
              const { start, end } = boundsOf(before, other);
              recorder.files.set(absolute, `${before.slice(0, start)}other${before.slice(end)}`);
            }
            break;
          }
          case 'truncate':
            recorder.files.set(absolute, '');
            expectStale = true;
            break;
          case 'delete-file':
            recorder.files.delete(absolute);
            expectStale = true;
            break;
        }

        const documentBefore = recorder.files.get(absolute) ?? null;
        const writesBefore = recorder.writes.length;

        const accepted = acceptAmendment({
          repoRoot: REPO_ROOT,
          id: proposed.amendment.id,
          at: '2026-08-20T18:45:00.000Z',
          fileSystem: recorder.fileSystem,
          rename: recorder.rename,
          diagnostics: sink,
        });

        if (expectStale) {
          expect(accepted.outcome).toBe('stale');
          expect(accepted.applied).toBe(false);
          expect(accepted.rebuildRequired).toBe(false);
          expect(accepted.amendment?.status).toBe('stale');
          // Not one byte of the document, no staging file, no rename.
          expect(recorder.files.get(absolute) ?? null).toBe(documentBefore);
          expect(recorder.renames).toEqual([]);
          expect([...recorder.files.keys()].some((p) => p.endsWith(TEMP_FILE_SUFFIX))).toBe(false);
          // The only write was the record, and it is under `.kept/`.
          for (const path of recorder.writes.slice(writesBefore)) {
            expect(path.startsWith(KEPT_PREFIX), path).toBe(true);
          }
          return true;
        }

        expect(accepted.outcome).toBe('applied');
        expect(accepted.applied).toBe(true);
        expect(accepted.rebuildRequired).toBe(true);
        expect(accepted.amendment?.status).toBe('accepted');
        expect(accepted.amendment?.appliedAt).toBe('2026-08-20T18:45:00.000Z');

        // Exactly one line, at the byte level.
        const current = documentBefore as string;
        const { start, end } = boundsOf(current, line);
        const after = recorder.files.get(absolute) as string;
        expect(after).toBe(current.slice(0, start) + replacement + current.slice(end));
        expect(after).toBe(accepted.content);

        // Line endings and trailing-newline state, stated separately because the
        // requirement names them separately.
        const beforeModel = splitDocument(current);
        const afterModel = splitDocument(after);
        expect(afterModel.lines).toHaveLength(beforeModel.lines.length);
        expect(hasTrailingNewline(afterModel)).toBe(hasTrailingNewline(beforeModel));
        expect(afterModel.bom).toBe(beforeModel.bom);
        for (const [index, entry] of afterModel.lines.entries()) {
          expect(entry.terminator).toBe(beforeModel.lines[index]?.terminator);
          if (index === line - 1) expect(entry.text).toBe(replacement);
          else expect(entry.text).toBe(beforeModel.lines[index]?.text);
        }

        // Staged then renamed, with nothing left behind.
        expect(recorder.renames).toEqual([[`${absolute}${TEMP_FILE_SUFFIX}`, absolute]]);
        expect(recorder.files.has(`${absolute}${TEMP_FILE_SUFFIX}`)).toBe(false);

        // The successor promise id: a different claim is a different promise.
        expect(accepted.successorPromiseId).toBe(promiseId(generated.citation.file, replacement));

        // Every write outside the document went under `.kept/`, and the other
        // generated documents are untouched.
        for (const path of recorder.writes) {
          const inKept = path.startsWith(KEPT_PREFIX);
          const isStaging = path === `${absolute}${TEMP_FILE_SUFFIX}`;
          expect(inKept || isStaging, path).toBe(true);
        }
        for (const [file, content] of Object.entries(generated.documents)) {
          if (file === generated.citation.file) continue;
          expect(recorder.files.get(`${REPO_ROOT}/${file}`), file).toBe(content);
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it('re-proposing the same replacement stages no second record', () => {
    fc.assert(
      fc.property(arbCitation, arbReplacement, (generated, replacement) => {
        const recorder = recorderFor(generated.documents);
        const first = proposeFor(generated, recorder, replacement);
        if (!first.ok) return true;
        const writesAfterFirst = recorder.writes.length;

        const second = proposeFor(generated, recorder, replacement);
        expect(second.ok).toBe(true);
        if (!second.ok) return true;
        expect(second.wrote).toBe(false);
        expect(second.existed).toBe(true);
        expect(second.amendment.id).toBe(first.amendment.id);
        expect(recorder.writes).toHaveLength(writesAfterFirst);
        assertNothingOutsideKept(recorder);
        return true;
      }),
      { numRuns: 200 },
    );
  });
});
