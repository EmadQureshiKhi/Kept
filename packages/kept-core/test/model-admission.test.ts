import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ADMISSION_DIAGNOSTIC_CODES,
  ADMISSION_REJECTION_REASONS,
  admitPromise,
  admitPromises,
  citedLine,
  createDiagnosticSink,
  inMemoryCitationSource,
  isCitationPathSafe,
  lineCount,
  nodeCitationSource,
  promiseId,
  splitLines,
  type Admission,
  type PromiseCandidate,
} from 'kept-core';

/**
 * The citation admission gate (design §3.3, R1.3, R1.4, R1.5).
 *
 * These are the examples behind Property 2: the off-by-one at the end of a file,
 * the three rejection payloads, and the overwrite of `citation.text` from disk.
 * The last block runs the same gate against real files in a temporary directory,
 * because "resolves to a real line in a real file" has to be true of a real
 * filesystem and not only of the in-memory reader the property suite uses.
 */

const README = 'apps/fixture/README.md';

/** A three-line document that ends with a newline — the off-by-one fixture. */
const THREE_LINES_TRAILING_NEWLINE = 'Cart updates instantly\nCheckout is fast\nShipping is free\n';

function source(documents: Record<string, string>) {
  return inMemoryCitationSource(documents);
}

function candidate(overrides: Partial<PromiseCandidate> = {}): PromiseCandidate {
  return {
    claim: 'Checkout is fast',
    citation: { file: README, line: 2, text: 'Checkout is fast' },
    provider: 'baseline',
    ...overrides,
  };
}

function expectRejected(admission: Admission): Extract<Admission, { ok: false }> {
  expect(admission.ok).toBe(false);
  if (admission.ok) throw new Error('expected a rejection');
  return admission;
}

describe('splitLines / lineCount / citedLine', () => {
  it('is one-based and drops no real line', () => {
    expect(splitLines('a\nb\nc')).toEqual(['a', 'b', 'c']);
    expect(citedLine('a\nb\nc', 1)).toBe('a');
    expect(citedLine('a\nb\nc', 3)).toBe('c');
  });

  it('gives a file ending in a newline no phantom final line', () => {
    expect(lineCount(THREE_LINES_TRAILING_NEWLINE)).toBe(3);
    expect(citedLine(THREE_LINES_TRAILING_NEWLINE, 3)).toBe('Shipping is free');
    expect(citedLine(THREE_LINES_TRAILING_NEWLINE, 4)).toBeNull();
  });

  it('keeps a genuinely blank line before the terminator', () => {
    // Only the terminator's own empty element is dropped, so `"a\n\n"` is two
    // lines and the second one is empty.
    expect(splitLines('a\n\n')).toEqual(['a', '']);
    expect(lineCount('a\n\n')).toBe(2);
  });

  it('counts an empty file as zero lines', () => {
    expect(splitLines('')).toEqual([]);
    expect(lineCount('')).toBe(0);
    expect(citedLine('', 1)).toBeNull();
  });

  it('counts a file with no trailing newline the same as one with', () => {
    expect(lineCount('a\nb\nc')).toBe(3);
    expect(lineCount('a\nb\nc\n')).toBe(3);
    expect(citedLine('a\nb\nc', 3)).toBe(citedLine('a\nb\nc\n', 3));
  });

  it('removes the carriage return of a CRLF terminator and nothing else', () => {
    expect(splitLines('a\r\nb\r\n')).toEqual(['a', 'b']);
    expect(lineCount('a\r\nb\r\n')).toBe(2);
    // A `\r` that is not a terminator, mid-line, is content and survives.
    expect(citedLine('a\rb\n', 1)).toBe('a\rb');
  });

  it('does not trim: indentation, trailing spaces and whitespace-only lines survive', () => {
    const document = '  indented claim  \n\t\t\nplain\n';
    expect(citedLine(document, 1)).toBe('  indented claim  ');
    expect(citedLine(document, 2)).toBe('\t\t');
    expect(lineCount(document)).toBe(3);
  });

  it('rejects a line that is not a positive integer', () => {
    for (const line of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(citedLine('a\nb\n', line)).toBeNull();
    }
  });

  it('strips a leading byte-order mark from line 1', () => {
    expect(citedLine('\ufeffCart updates\n', 1)).toBe('Cart updates');
  });
});

describe('isCitationPathSafe', () => {
  it('accepts repository-relative paths, including an inner ..', () => {
    expect(isCitationPathSafe(README)).toBe(true);
    expect(isCitationPathSafe('./README.md')).toBe(true);
    expect(isCitationPathSafe('apps\\fixture\\README.md')).toBe(true);
    expect(isCitationPathSafe('apps/fixture/../README.md')).toBe(true);
  });

  it('refuses an empty, absolute or escaping path', () => {
    expect(isCitationPathSafe('')).toBe(false);
    expect(isCitationPathSafe('   ')).toBe(false);
    expect(isCitationPathSafe('/etc/passwd')).toBe(false);
    expect(isCitationPathSafe('C:/Windows/system.ini')).toBe(false);
    expect(isCitationPathSafe('../secrets.env')).toBe(false);
    expect(isCitationPathSafe('apps/../../secrets.env')).toBe(false);
  });
});

describe('admitPromise: admission overwrites citation text from disk (R1.3)', () => {
  it('takes the verbatim line from the file, not from the provider', () => {
    const admission = admitPromise({
      candidate: candidate({
        // The provider paraphrased and went stale. Disk wins.
        citation: { file: README, line: 2, text: 'checkout is quick' },
      }),
      source: source({ [README]: THREE_LINES_TRAILING_NEWLINE }),
    });
    expect(admission.ok).toBe(true);
    if (!admission.ok) return;
    expect(admission.promise.citation.text).toBe('Checkout is fast');
    expect(admission.promise.citation.line).toBe(2);
    expect(admission.promise.citation.file).toBe(README);
    expect(admission.promise.providers).toEqual(['baseline']);
    expect(admission.promise.id).toBe(promiseId(README, 'Checkout is fast'));
  });

  it('admits a whitespace-only cited line with its whitespace intact', () => {
    const admission = admitPromise({
      candidate: candidate({ citation: { file: README, line: 2, text: 'invented' } }),
      source: source({ [README]: 'first\n   \t \nthird\n' }),
    });
    expect(admission.ok).toBe(true);
    if (!admission.ok) return;
    expect(admission.promise.citation.text).toBe('   \t ');
  });

  it('admits the line exactly at EOF and refuses the one past it', () => {
    const documents = source({ [README]: THREE_LINES_TRAILING_NEWLINE });
    const atEof = admitPromise({
      candidate: candidate({ citation: { file: README, line: 3, text: '' } }),
      source: documents,
    });
    expect(atEof.ok).toBe(true);
    const pastEof = expectRejected(
      admitPromise({
        candidate: candidate({ citation: { file: README, line: 4, text: '' } }),
        source: documents,
      }),
    );
    expect(pastEof.reason).toBe('line-out-of-range');
  });

  it('normalises a Windows-separated citation path on admission', () => {
    const admission = admitPromise({
      candidate: candidate({
        citation: { file: 'apps\\fixture\\README.md', line: 1, text: 'x' },
      }),
      source: source({ [README]: THREE_LINES_TRAILING_NEWLINE }),
    });
    expect(admission.ok).toBe(true);
    if (!admission.ok) return;
    expect(admission.promise.citation.file).toBe(README);
  });

  it('reports no diagnostic when it admits', () => {
    const sink = createDiagnosticSink();
    admitPromise({
      candidate: candidate(),
      source: source({ [README]: THREE_LINES_TRAILING_NEWLINE }),
      diagnostics: sink,
    });
    expect(sink.size).toBe(0);
  });
});

describe('admitPromise: no-citation names the supplying provider (R1.5)', () => {
  it.each(['baseline', 'enrichment'] as const)('names the %s provider', (provider) => {
    const sink = createDiagnosticSink();
    const rejection = expectRejected(
      admitPromise({
        candidate: candidate({ citation: null, provider, claim: 'Checkout is fast' }),
        source: source({}),
        diagnostics: sink,
      }),
    );
    expect(rejection.reason).toBe('no-citation');
    expect(rejection.provider).toBe(provider);
    expect(rejection.diagnostic.code).toBe(ADMISSION_DIAGNOSTIC_CODES.noCitation);
    expect(rejection.diagnostic.message).toContain(provider);
    expect(rejection.diagnostic.message).toContain('Checkout is fast');
    // Exactly one diagnostic, and the rejection carries the record that was stored.
    expect(sink.entries).toEqual([rejection.diagnostic]);
  });

  it('needs no reader at all to refuse an uncited candidate', () => {
    // No `source`, no `repoRoot`: the gate must answer before it needs to read.
    const rejection = expectRejected(admitPromise({ candidate: candidate({ citation: null }) }));
    expect(rejection.reason).toBe('no-citation');
  });
});

describe('admitPromise: line-out-of-range carries the line and the count (R1.4)', () => {
  it('carries the requested line and the actual line count', () => {
    const sink = createDiagnosticSink();
    const rejection = expectRejected(
      admitPromise({
        candidate: candidate({ citation: { file: README, line: 41, text: 'x' } }),
        source: source({ [README]: THREE_LINES_TRAILING_NEWLINE }),
        diagnostics: sink,
      }),
    );
    expect(rejection.reason).toBe('line-out-of-range');
    if (rejection.reason !== 'line-out-of-range') return;
    expect(rejection.requestedLine).toBe(41);
    expect(rejection.lineCount).toBe(3);
    expect(rejection.file).toBe(README);
    expect(rejection.diagnostic.code).toBe(ADMISSION_DIAGNOSTIC_CODES.lineOutOfRange);
    expect(rejection.diagnostic.message).toContain('41');
    expect(rejection.diagnostic.message).toContain('3 lines');
    expect(rejection.diagnostic.message).toContain('baseline');
    expect(sink.size).toBe(1);
  });

  it('refuses line 1 of an empty file, reporting a count of zero', () => {
    const rejection = expectRejected(
      admitPromise({
        candidate: candidate({ citation: { file: README, line: 1, text: '' } }),
        source: source({ [README]: '' }),
      }),
    );
    expect(rejection.reason).toBe('line-out-of-range');
    if (rejection.reason !== 'line-out-of-range') return;
    expect(rejection.lineCount).toBe(0);
    expect(rejection.diagnostic.message).toContain('0 lines');
  });

  it('refuses a line that is not a position in a file', () => {
    for (const line of [0, -3, 2.5]) {
      const rejection = expectRejected(
        admitPromise({
          candidate: candidate({ citation: { file: README, line, text: 'x' } }),
          source: source({ [README]: THREE_LINES_TRAILING_NEWLINE }),
        }),
      );
      expect(rejection.reason).toBe('line-out-of-range');
      if (rejection.reason !== 'line-out-of-range') return;
      expect(rejection.requestedLine).toBe(line);
    }
  });
});

describe('admitPromise: file-missing', () => {
  it('refuses a citation whose file is not there', () => {
    const rejection = expectRejected(
      admitPromise({ candidate: candidate(), source: source({ 'other.md': 'x\n' }) }),
    );
    expect(rejection.reason).toBe('file-missing');
    if (rejection.reason !== 'file-missing') return;
    expect(rejection.file).toBe(README);
    expect(rejection.diagnostic.code).toBe(ADMISSION_DIAGNOSTIC_CODES.fileMissing);
    expect(rejection.diagnostic.message).toContain('baseline');
  });

  it('treats a reader that throws as a missing file, not as a crash', () => {
    const rejection = expectRejected(
      admitPromise({
        candidate: candidate(),
        source: {
          read(): string {
            throw new Error('EIO');
          },
        },
      }),
    );
    expect(rejection.reason).toBe('file-missing');
  });

  it('refuses an unsafe path without reading anything', () => {
    let reads = 0;
    for (const file of ['/etc/passwd', '../../secrets.env', '   ']) {
      const rejection = expectRejected(
        admitPromise({
          candidate: candidate({ citation: { file, line: 1, text: 'x' } }),
          source: {
            read(): string | null {
              reads += 1;
              return 'secret\n';
            },
          },
        }),
      );
      expect(rejection.reason).toBe('file-missing');
      expect(rejection.diagnostic.code).toBe(ADMISSION_DIAGNOSTIC_CODES.pathUnsafe);
    }
    expect(reads).toBe(0);
  });
});

describe('admitPromises: the graph is exactly what the gate admitted', () => {
  it('keeps admitted promises, drops rejected ones, and attaches the diagnostics', () => {
    const batch = admitPromises({
      candidates: [
        candidate({ claim: 'Cart updates instantly', citation: { file: README, line: 1, text: '' } }),
        candidate({ claim: 'unresolvable', citation: { file: README, line: 99, text: '' } }),
        candidate({ claim: 'uncited', citation: null, provider: 'enrichment' }),
        candidate({ claim: 'elsewhere', citation: { file: 'missing.md', line: 1, text: '' } }),
        candidate({ claim: 'Shipping is free', citation: { file: README, line: 3, text: '' } }),
      ],
      source: source({ [README]: THREE_LINES_TRAILING_NEWLINE }),
    });

    expect(batch.admitted.map((promise) => promise.claim).sort()).toEqual([
      'Cart updates instantly',
      'Shipping is free',
    ]);
    expect(batch.graph.promises).toEqual(
      [...batch.admitted].sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
    expect(batch.rejected.map((rejection) => rejection.reason)).toEqual([
      'line-out-of-range',
      'no-citation',
      'file-missing',
    ]);
    expect(batch.admissions).toHaveLength(5);
    // One diagnostic per rejection, none for an admission.
    expect(batch.graph.diagnostics).toHaveLength(3);
    expect(new Set(batch.graph.diagnostics.map((d) => d.code)).size).toBe(3);
  });

  it('collapses two candidates that derive the same identifier', () => {
    const batch = admitPromises({
      candidates: [
        // Same file, same claim, different lines: the id ignores the line, so
        // these are one promise (design §3.2).
        candidate({ claim: 'Checkout is fast', citation: { file: README, line: 2, text: '' } }),
        candidate({
          claim: 'Checkout is fast',
          provider: 'enrichment',
          citation: { file: README, line: 2, text: '' },
        }),
      ],
      source: source({ [README]: THREE_LINES_TRAILING_NEWLINE }),
    });
    expect(batch.admissions.every((admission) => admission.ok)).toBe(true);
    expect(batch.graph.promises).toHaveLength(1);
  });

  it('builds an empty graph from an empty candidate list', () => {
    const batch = admitPromises({ candidates: [], source: source({}) });
    expect(batch.graph.promises).toEqual([]);
    expect(batch.graph.diagnostics).toEqual([]);
    expect(batch.rejected).toEqual([]);
  });

  it('passes the degraded flag through untouched', () => {
    const batch = admitPromises({
      candidates: [],
      source: source({}),
      degraded: true,
      degradedReasons: ['cover-crashed-stream'],
    });
    expect(batch.graph.degraded).toBe(true);
    expect(batch.graph.degradedReasons).toEqual(['cover-crashed-stream']);
  });

  it('exposes exactly three rejection reasons', () => {
    expect([...ADMISSION_REJECTION_REASONS]).toEqual([
      'no-citation',
      'line-out-of-range',
      'file-missing',
    ]);
  });
});

describe('admitPromise: against real files on disk', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'kept-admission-'));
    mkdirSync(join(root, 'apps', 'fixture'), { recursive: true });
    writeFileSync(join(root, 'apps', 'fixture', 'README.md'), THREE_LINES_TRAILING_NEWLINE, 'utf8');
    writeFileSync(join(root, 'crlf.md'), 'Cart updates\r\nCheckout is fast\r\n', 'utf8');
    writeFileSync(join(root, 'no-newline.md'), 'first\nlast line', 'utf8');
    writeFileSync(join(root, 'empty.md'), '', 'utf8');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads the verbatim line through nodeCitationSource', () => {
    const admission = admitPromise({
      candidate: candidate({ citation: { file: README, line: 1, text: 'stale copy' } }),
      repoRoot: root,
    });
    expect(admission.ok).toBe(true);
    if (!admission.ok) return;
    expect(admission.promise.citation.text).toBe('Cart updates instantly');
  });

  it('refuses line 4 of the three-line file on disk', () => {
    const rejection = expectRejected(
      admitPromise({
        candidate: candidate({ citation: { file: README, line: 4, text: '' } }),
        source: nodeCitationSource(root),
      }),
    );
    expect(rejection.reason).toBe('line-out-of-range');
    if (rejection.reason !== 'line-out-of-range') return;
    expect(rejection.lineCount).toBe(3);
  });

  it('handles a CRLF file, a file with no trailing newline, and an empty file', () => {
    const reader = nodeCitationSource(root);
    const crlf = admitPromise({
      candidate: candidate({ citation: { file: 'crlf.md', line: 2, text: '' } }),
      source: reader,
    });
    expect(crlf.ok).toBe(true);
    if (crlf.ok) expect(crlf.promise.citation.text).toBe('Checkout is fast');

    const lastLine = admitPromise({
      candidate: candidate({ citation: { file: 'no-newline.md', line: 2, text: '' } }),
      source: reader,
    });
    expect(lastLine.ok).toBe(true);
    if (lastLine.ok) expect(lastLine.promise.citation.text).toBe('last line');

    expect(
      expectRejected(
        admitPromise({
          candidate: candidate({ citation: { file: 'empty.md', line: 1, text: '' } }),
          source: reader,
        }),
      ).reason,
    ).toBe('line-out-of-range');
  });

  it('refuses a path that escapes the repository root, and never reads it', () => {
    const rejection = expectRejected(
      admitPromise({
        candidate: candidate({ citation: { file: '../../etc/hosts', line: 1, text: '' } }),
        repoRoot: root,
      }),
    );
    expect(rejection.reason).toBe('file-missing');
    expect(rejection.diagnostic.code).toBe(ADMISSION_DIAGNOSTIC_CODES.pathUnsafe);
  });
});
