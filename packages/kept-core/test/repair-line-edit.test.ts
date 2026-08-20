import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { splitLines } from '../src/model/admission.js';
import {
  applyLineEdit,
  documentLineCount,
  dominantLineEnding,
  hasTrailingNewline,
  joinDocument,
  replaceLine,
  splitDocument,
  tempPathFor,
  type LineEditFileSystem,
} from '../src/repair/lineEdit.js';

import { arbDoc } from './arbitraries.js';

/**
 * The surgical write — task 14.4's `lineEdit.ts` (design §8.4).
 *
 * Two laws carry the whole file, and both are asserted over generated documents
 * rather than over hand-picked strings:
 *
 * 1. `joinDocument(splitDocument(text)) === text` for **every** string. The split
 *    is only safe to build a write on if it is lossless.
 * 2. This module counts the same lines the citation admission gate counts. A
 *    citation's line number comes from `splitLines`; if the two splitters
 *    disagreed by one, an amendment would replace the wrong line and every
 *    assertion about "exactly one line" would still pass.
 */

const NASTY_DOCUMENTS: readonly string[] = [
  '',
  '\n',
  '\r\n',
  'a',
  'a\n',
  'a\r\n',
  'a\n\n',
  'a\r\nb',
  'a\nb\r\nc',
  '\ufeffa\nb\n',
  'a\rb\n',
  '   \n\t\n',
];

describe('splitting and rejoining is lossless', () => {
  it('round-trips every generated document', () => {
    fc.assert(
      fc.property(arbDoc, (doc) => {
        expect(joinDocument(splitDocument(doc.content))).toBe(doc.content);
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it('round-trips the awkward hand-written cases too', () => {
    for (const content of NASTY_DOCUMENTS) {
      expect(joinDocument(splitDocument(content)), JSON.stringify(content)).toBe(content);
    }
  });

  it('counts the lines the citation admission gate counts', () => {
    fc.assert(
      fc.property(arbDoc, (doc) => {
        expect(documentLineCount(doc.content)).toBe(splitLines(doc.content).length);
        expect(splitDocument(doc.content).lines.map((line) => line.text)).toEqual([
          ...splitLines(doc.content),
        ]);
        return true;
      }),
      { numRuns: 200 },
    );
    for (const content of NASTY_DOCUMENTS) {
      expect(documentLineCount(content), JSON.stringify(content)).toBe(splitLines(content).length);
    }
  });

  it('derives the trailing-newline state from the last terminator', () => {
    fc.assert(
      fc.property(arbDoc, (doc) => {
        const model = splitDocument(doc.content);
        expect(hasTrailingNewline(model)).toBe(doc.lineCount > 0 && doc.trailingNewline);
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it('treats a lone carriage return as content, not a terminator', () => {
    const model = splitDocument('a\rb\n');
    expect(model.lines).toEqual([{ text: 'a\rb', terminator: '\n' }]);
  });

  it('reports the dominant ending without ever writing with it', () => {
    expect(dominantLineEnding(splitDocument('a\r\nb\r\nc\n'))).toBe('\r\n');
    expect(dominantLineEnding(splitDocument('a\nb\n'))).toBe('\n');
    expect(dominantLineEnding(splitDocument(''))).toBe('\n');
  });
});

describe('replaceLine changes exactly one line', () => {
  /**
   * The byte offset at which a one-based line's text starts, and the offset just
   * after it. Derived from the model rather than by searching for the text, so a
   * document with two identical lines cannot make the assertion measure the wrong
   * one.
   */
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

  it('changes only the bytes of the cited line', () => {
    fc.assert(
      fc.property(
        arbDoc.filter((doc) => doc.lineCount > 0),
        fc.integer({ min: 1, max: 8 }),
        fc.constantFrom('replaced', '', '   ', 'caf\u00e9 r\u00e9sum\u00e9'),
        (doc, seed, text) => {
          const line = ((seed - 1) % doc.lineCount) + 1;
          const result = replaceLine(doc.content, line, text);
          expect(result.ok).toBe(true);
          if (!result.ok) return true;

          // The statement with teeth: every byte before the cited line's text and
          // every byte from its terminator onward is identical, and the bytes in
          // between are exactly the replacement. Endings and trailing-newline state
          // are preserved as a consequence rather than as separate claims.
          const { start, end } = boundsOf(doc.content, line);
          expect(result.content).toBe(
            doc.content.slice(0, start) + text + doc.content.slice(end),
          );
          expect(result.previous).toBe(doc.content.slice(start, end));
          expect(splitDocument(result.content).bom).toBe(splitDocument(doc.content).bom);
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('keeps the line count, except when the whole document becomes empty', () => {
    fc.assert(
      fc.property(
        arbDoc.filter((doc) => doc.lineCount > 0),
        fc.integer({ min: 1, max: 8 }),
        fc.constantFrom('replaced', '', '   '),
        (doc, seed, text) => {
          const line = ((seed - 1) % doc.lineCount) + 1;
          const result = replaceLine(doc.content, line, text);
          expect(result.ok).toBe(true);
          if (!result.ok) return true;

          const before = splitDocument(doc.content);
          const after = splitDocument(result.content);

          // The one carve-out, and it belongs to the counting rule rather than to the
          // edit: emptying a **final unterminated** line removes it, because a final
          // empty segment with no terminator is not a citable line. `splitLines` says
          // so and this module agrees with it, which is the agreement that matters —
          // there is no byte sequence that spells "an empty last line with no newline
          // after it". Every other line is still byte-identical.
          const emptiedFinalLine =
            text === '' && line === before.lines.length && !hasTrailingNewline(before);
          if (emptiedFinalLine) {
            expect(after.lines).toHaveLength(before.lines.length - 1);
            for (const [index, current] of after.lines.entries()) {
              expect(current).toEqual(before.lines[index]);
            }
            return true;
          }

          expect(after.lines).toHaveLength(before.lines.length);
          expect(hasTrailingNewline(after)).toBe(hasTrailingNewline(before));
          for (const [index, current] of after.lines.entries()) {
            expect(current.terminator).toBe(before.lines[index]?.terminator);
            if (index === line - 1) expect(current.text).toBe(text);
            else expect(current.text).toBe(before.lines[index]?.text);
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('refuses a line that does not exist and an invalid one', () => {
    expect(replaceLine('a\nb\n', 3, 'x')).toEqual({ ok: false, reason: 'line-out-of-range' });
    expect(replaceLine('', 1, 'x')).toEqual({ ok: false, reason: 'line-out-of-range' });
    for (const line of [0, -1, 1.5, Number.NaN]) {
      expect(replaceLine('a\n', line, 'x')).toEqual({ ok: false, reason: 'invalid-line' });
    }
  });

  it('refuses a replacement carrying a line terminator', () => {
    for (const text of ['a\nb', 'a\r\nb', 'a\r']) {
      expect(replaceLine('x\ny\n', 1, text)).toEqual({
        ok: false,
        reason: 'text-contains-newline',
      });
    }
  });
});

describe('applyLineEdit stages then renames', () => {
  function fileSystemWith(seed: Record<string, string>): {
    readonly fileSystem: LineEditFileSystem;
    readonly files: Map<string, string>;
    readonly writes: string[];
    readonly renames: [string, string][];
  } {
    const files = new Map(Object.entries(seed));
    const writes: string[] = [];
    const renames: [string, string][] = [];
    return {
      files,
      writes,
      renames,
      fileSystem: {
        readFile: (path) => files.get(path) ?? null,
        writeFile: (path, contents) => {
          writes.push(path);
          files.set(path, contents);
        },
      },
    };
  }

  it('writes the temporary file, renames it over the original, and leaves nothing behind', () => {
    const path = '/repo/apps/fixture/README.md';
    const store = fileSystemWith({ [path]: 'one\r\ntwo\r\nthree' });
    const result = applyLineEdit({
      absolutePath: path,
      line: 2,
      text: 'TWO',
      fileSystem: store.fileSystem,
      rename: (from, to) => {
        store.renames.push([from, to]);
        const contents = store.files.get(from);
        if (contents !== undefined) {
          store.files.set(to, contents);
          store.files.delete(from);
        }
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(store.writes).toEqual([tempPathFor(path)]);
    expect(store.renames).toEqual([[tempPathFor(path), path]]);
    expect(store.files.has(tempPathFor(path))).toBe(false);
    // CRLF preserved, and the missing final newline is still missing.
    expect(store.files.get(path)).toBe('one\r\nTWO\r\nthree');
    expect(result.previous).toBe('two');
  });

  it('creates no staging file when the replacement is refused', () => {
    const path = '/repo/a.md';
    const store = fileSystemWith({ [path]: 'one\n' });
    const result = applyLineEdit({
      absolutePath: path,
      line: 9,
      text: 'x',
      fileSystem: store.fileSystem,
      rename: () => {
        throw new Error('must not be reached');
      },
    });
    expect(result.ok).toBe(false);
    expect(store.writes).toEqual([]);
    expect(store.files.get(path)).toBe('one\n');
  });

  it('leaves the original untouched when the rename fails', () => {
    const path = '/repo/a.md';
    const store = fileSystemWith({ [path]: 'one\n' });
    const result = applyLineEdit({
      absolutePath: path,
      line: 1,
      text: 'two',
      fileSystem: store.fileSystem,
      rename: () => {
        throw new Error('read-only filesystem');
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('write-failed');
    expect(store.files.get(path)).toBe('one\n');
  });

  it('reports a missing file rather than creating one', () => {
    const store = fileSystemWith({});
    const result = applyLineEdit({
      absolutePath: '/repo/gone.md',
      line: 1,
      text: 'x',
      fileSystem: store.fileSystem,
      rename: () => undefined,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('file-missing');
    expect(store.files.size).toBe(0);
  });
});
