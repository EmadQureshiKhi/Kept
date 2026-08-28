import { describe, expect, it } from 'vitest';

import {
  DIAGNOSTIC_SEVERITIES,
  createDiagnosticSink,
  isDiagnostic,
  type Diagnostic,
  type DiagnosticSeverity,
} from 'kept-core';

/** A clock frozen at a readable instant, so `at` is assertable. */
const FROZEN = '2025-08-20T08:30:00.000Z';
const frozenClock = (): Date => new Date(FROZEN);

describe('createDiagnosticSink — the record', () => {
  it('stamps every field of the snapshot shape', () => {
    const sink = createDiagnosticSink({ clock: frozenClock });

    const d = sink.report({
      code: 'ndjson-parse',
      severity: 'warn',
      message: 'line 7 is not JSON',
      file: 'docs/kane/smoke-run.ndjson',
      line: 7,
    });

    expect(d).toEqual({
      code: 'ndjson-parse',
      severity: 'warn',
      message: 'line 7 is not JSON',
      file: 'docs/kane/smoke-run.ndjson',
      line: 7,
      at: FROZEN,
    });
  });

  it('defaults file and line to null rather than leaving them undefined', () => {
    const sink = createDiagnosticSink({ clock: frozenClock });

    const d = sink.report({ code: 'kane-not-found', severity: 'error', message: 'kane-cli absent' });

    expect(d.file).toBeNull();
    expect(d.line).toBeNull();
    expect(Object.keys(d).sort()).toEqual(['at', 'code', 'file', 'line', 'message', 'severity']);
  });

  it('returns the very record it stored, so a result can embed what it reported', () => {
    const sink = createDiagnosticSink({ clock: frozenClock });

    const returned = sink.report({ code: 'no-citation', severity: 'error', message: 'baseline' });

    expect(sink.entries[0]).toBe(returned);
  });

  it('normalises file paths to trimmed POSIX, empty becomes null', () => {
    const sink = createDiagnosticSink({ clock: frozenClock });

    expect(sink.report({ code: 'c', severity: 'info', message: 'm', file: '  tests/a_test.md ' }).file).toBe(
      'tests/a_test.md',
    );
    expect(sink.report({ code: 'c', severity: 'info', message: 'm', file: 'apps\\fixture\\lib\\cart.ts' }).file).toBe(
      'apps/fixture/lib/cart.ts',
    );
    expect(sink.report({ code: 'c', severity: 'info', message: 'm', file: '   ' }).file).toBeNull();
    expect(sink.report({ code: 'c', severity: 'info', message: 'm', file: null }).file).toBeNull();
  });

  it('keeps only one-based integer line numbers and drops the rest to null', () => {
    const sink = createDiagnosticSink({ clock: frozenClock });
    const lineOf = (line: number | null): number | null =>
      sink.report({ code: 'c', severity: 'info', message: 'm', line }).line;

    expect(lineOf(1)).toBe(1);
    expect(lineOf(4211)).toBe(4211);
    expect(lineOf(0)).toBeNull();
    expect(lineOf(-3)).toBeNull();
    expect(lineOf(1.5)).toBeNull();
    expect(lineOf(Number.NaN)).toBeNull();
    expect(lineOf(Number.POSITIVE_INFINITY)).toBeNull();
    expect(lineOf(null)).toBeNull();
  });

  it('falls back to the code when the interpolated message came out empty', () => {
    const sink = createDiagnosticSink({ clock: frozenClock });

    expect(sink.report({ code: 'coverage-payload-unreadable', severity: 'warn', message: '   ' }).message).toBe(
      'coverage-payload-unreadable',
    );
  });

  it('throws on an empty code, because a code is a literal and a programming error', () => {
    const sink = createDiagnosticSink({ clock: frozenClock });

    expect(() => sink.report({ code: '   ', severity: 'error', message: 'm' })).toThrow(TypeError);
  });
});

describe('createDiagnosticSink — the clock', () => {
  it('stamps at from the injected clock, in ISO 8601', () => {
    let tick = 0;
    const sink = createDiagnosticSink({ clock: () => new Date(Date.UTC(2025, 7, 20, 8, 30, tick++)) });

    const first = sink.report({ code: 'a', severity: 'info', message: 'first' });
    const second = sink.report({ code: 'b', severity: 'info', message: 'second' });

    expect(first.at).toBe('2025-08-20T08:30:00.000Z');
    expect(second.at).toBe('2025-08-20T08:30:01.000Z');
    expect(Date.parse(second.at)).toBeGreaterThan(Date.parse(first.at));
  });

  it('survives a clock that throws or returns an invalid date', () => {
    const throwing = createDiagnosticSink({
      clock: () => {
        throw new Error('clock unavailable');
      },
    });
    const invalid = createDiagnosticSink({ clock: () => new Date(Number.NaN) });

    for (const sink of [throwing, invalid]) {
      const d = sink.report({ code: 'clock', severity: 'warn', message: 'still recorded' });
      expect(Number.isNaN(Date.parse(d.at))).toBe(false);
    }
  });

  it('uses the wall clock when none is injected', () => {
    const before = Date.now();
    const d = createDiagnosticSink().report({ code: 'a', severity: 'info', message: 'm' });

    expect(Date.parse(d.at)).toBeGreaterThanOrEqual(before - 1);
    expect(Date.parse(d.at)).toBeLessThanOrEqual(Date.now() + 1);
  });
});

describe('createDiagnosticSink — collection', () => {
  it('keeps report order and counts', () => {
    const sink = createDiagnosticSink({ clock: frozenClock });

    sink.report({ code: 'first', severity: 'info', message: '1' });
    sink.report({ code: 'second', severity: 'warn', message: '2' });
    sink.report({ code: 'first', severity: 'error', message: '3' });

    expect(sink.size).toBe(3);
    expect(sink.entries.map((d) => d.message)).toEqual(['1', '2', '3']);
  });

  it('hands out a copy, so a consumer cannot rewrite the record of what happened', () => {
    const sink = createDiagnosticSink({ clock: frozenClock });
    sink.report({ code: 'first', severity: 'info', message: '1' });

    const taken = sink.entries as Diagnostic[];
    taken.pop();

    expect(sink.size).toBe(1);
    expect(sink.entries).toHaveLength(1);
  });

  it('queries by code and by severity', () => {
    const sink = createDiagnosticSink({ clock: frozenClock });
    sink.report({ code: 'ndjson-parse', severity: 'warn', message: 'a', line: 3 });
    sink.report({ code: 'ndjson-parse', severity: 'warn', message: 'b', line: 9 });
    sink.report({ code: 'kane-not-found', severity: 'error', message: 'c' });

    expect(sink.withCode('ndjson-parse').map((d) => d.line)).toEqual([3, 9]);
    expect(sink.withCode('nothing-like-this')).toEqual([]);
    expect(sink.has('kane-not-found')).toBe(true);
    expect(sink.has('reconcile-source-forked')).toBe(false);
    expect(sink.hasSeverity('error')).toBe(true);
    expect(sink.hasSeverity('info')).toBe(false);
  });

  it('clears back to empty', () => {
    const sink = createDiagnosticSink({ clock: frozenClock });
    sink.report({ code: 'a', severity: 'info', message: 'm' });

    sink.clear();

    expect(sink.size).toBe(0);
    expect(sink.entries).toEqual([]);
    expect(sink.has('a')).toBe(false);
  });

  it('starts empty', () => {
    const sink = createDiagnosticSink();

    expect(sink.size).toBe(0);
    expect(sink.entries).toEqual([]);
  });
});

describe('the record is JSON, not an object graph', () => {
  it('round-trips through JSON unchanged, as the snapshot contract requires', () => {
    const sink = createDiagnosticSink({ clock: frozenClock });
    sink.report({ code: 'ndjson-parse', severity: 'warn', message: 'bad line', file: 'a/b.ndjson', line: 12 });
    sink.report({ code: 'kane-not-found', severity: 'error', message: 'absent' });

    const entries = sink.entries;
    const revived: unknown = JSON.parse(JSON.stringify(entries));

    expect(revived).toEqual(entries);
    expect(Array.isArray(revived) && revived.every(isDiagnostic)).toBe(true);
  });

  it('accepts every severity in the published vocabulary', () => {
    const sink = createDiagnosticSink({ clock: frozenClock });

    for (const severity of DIAGNOSTIC_SEVERITIES) {
      expect(isDiagnostic(sink.report({ code: 'a', severity, message: severity }))).toBe(true);
    }
    expect(DIAGNOSTIC_SEVERITIES).toEqual(['info', 'warn', 'error']);
  });
});

describe('isDiagnostic', () => {
  const valid: Diagnostic = {
    code: 'ndjson-parse',
    severity: 'warn',
    message: 'bad line',
    file: 'a/b.ndjson',
    line: 12,
    at: FROZEN,
  };

  it('accepts a well-formed record', () => {
    expect(isDiagnostic(valid)).toBe(true);
    expect(isDiagnostic({ ...valid, file: null, line: null })).toBe(true);
  });

  it('rejects anything that is not one', () => {
    const rejects: unknown[] = [
      null,
      undefined,
      'ndjson-parse',
      42,
      [],
      { ...valid, code: '' },
      { ...valid, severity: 'fatal' as DiagnosticSeverity },
      { ...valid, message: '' },
      { ...valid, file: 7 },
      { ...valid, line: 0 },
      { ...valid, line: 2.5 },
      { ...valid, at: 'not a date' },
      { ...valid, at: 1_755_678_000_000 },
    ];

    for (const candidate of rejects) {
      expect(isDiagnostic(candidate), JSON.stringify(candidate ?? null)).toBe(false);
    }
  });

  it('rejects a record missing a field, which is how a stale snapshot reads', () => {
    const { at: _at, ...missingAt } = valid;
    const { line: _line, ...missingLine } = valid;

    expect(isDiagnostic(missingAt)).toBe(false);
    expect(isDiagnostic(missingLine)).toBe(false);
  });
});
