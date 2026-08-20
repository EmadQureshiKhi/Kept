import { describe, expect, it } from 'vitest';

import {
  SNAPSHOT_SCHEMA_VERSION,
  SnapshotParseError,
  canonicaliseSnapshot,
  documentId,
  parseSnapshot,
  promiseId,
  serialiseSnapshot,
  type LedgerSnapshot,
} from '@kept/core';

/**
 * Canonical snapshot serialisation (design §9.2, R1.8, R8.8).
 *
 * `ledger.snapshot.json` is committed, so the bytes are part of the deliverable.
 * These tests pin the three things that make the committed file reviewable — key
 * order, indent, array order — and the three things that would silently break
 * the round trip if `JSON.stringify` were used instead: a `Date` becoming a
 * string, an `undefined` key vanishing, a non-finite number becoming `null`.
 */

const DOC = 'apps/fixture/README.md';
const CLAIM_A = '- The Cart screen shows a running subtotal.';
const CLAIM_B = '- The Checkout button is disabled while the cart is empty.';
const AT = '2026-08-20T18:41:02.118Z';
const PACK = 'ev_20260820T184011Z';

function emptySnapshot(): LedgerSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: AT,
    generator: { kept: '0.0.0', kaneCli: null },
    degraded: false,
    degradedReasons: [],
    freshness: { terminalEventAt: null, terminalEventType: null, commandFamily: null },
    metrics: {
      totalPromises: 0,
      designedCount: 0,
      provenCount: 0,
      redCount: 0,
      staleCount: 0,
      undesignedCount: 0,
      designedCoverage: null,
      provenCoverage: null,
    },
    promises: [],
    edges: [],
    documents: [],
    evidence: [],
    runs: [],
    reviewCards: [],
    amendments: [],
    diagnostics: [],
  };
}

function promiseEntry(claim: string): LedgerSnapshot['promises'][number] {
  return {
    id: promiseId(DOC, claim),
    claim,
    citation: { file: DOC, line: 16, text: claim },
    designedTest: null,
    verdict: 'undesigned',
    verdictSource: null,
    repair: null,
    evidencePackId: null,
    providers: ['baseline'],
    credits: null,
  };
}

/** Two promises, three edges, one pack with two artefacts, all sorted. */
function twoPromiseSnapshot(): LedgerSnapshot {
  const a = promiseEntry(CLAIM_A);
  const b = promiseEntry(CLAIM_B);
  const promises = [a, b].sort((left, right) => (left.id < right.id ? -1 : 1));
  const doc = documentId(DOC);
  const edges = [
    { from: doc, to: a.id, kind: 'cites' as const },
    { from: doc, to: b.id, kind: 'cites' as const },
  ].sort((left, right) => (left.to < right.to ? -1 : 1));
  return {
    ...emptySnapshot(),
    metrics: {
      totalPromises: 2,
      designedCount: 0,
      provenCount: 0,
      redCount: 0,
      staleCount: 0,
      undesignedCount: 2,
      designedCoverage: 0,
      provenCoverage: 0,
    },
    promises,
    edges,
    documents: [{ id: doc, file: DOC, claimCount: 2 }],
    evidence: [
      {
        id: PACK,
        kind: 'testrun',
        sealedAt: AT,
        publicPath: `/evidence/${PACK}/`,
        artifacts: [
          {
            kind: 'annotated',
            name: 'annotated.png',
            publicPath: `/evidence/${PACK}/annotated.png`,
            bytes: 10,
          },
          {
            kind: 'failure-yaml',
            name: 'failure.yaml',
            publicPath: `/evidence/${PACK}/failure.yaml`,
            bytes: 20,
          },
        ],
      },
    ],
  };
}

describe('Feature: kept, canonical snapshot serialisation (design §9.2)', () => {
  it('sorts keys recursively and indents with two spaces', () => {
    const text = serialiseSnapshot(emptySnapshot());
    const lines = text.split('\n');
    expect(lines[0]).toBe('{');
    // Top-level keys, in sorted order, at one indent level.
    const topLevel = lines
      .filter((line) => /^ {2}"/.test(line))
      .map((line) => line.slice(3, line.indexOf('"', 3)));
    expect(topLevel).toEqual([...topLevel].sort());
    expect(topLevel).toContain('schemaVersion');
    expect(topLevel[0]).toBe('amendments');
    // Nested keys sit at two indent levels; no tabs anywhere.
    expect(text).toContain('\n    "commandFamily": null');
    expect(text).not.toContain('\t');
  });

  it('ends with exactly one trailing newline', () => {
    const text = serialiseSnapshot(emptySnapshot());
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('}\n\n')).toBe(false);
  });

  it('emits empty arrays and objects compactly', () => {
    const text = serialiseSnapshot(emptySnapshot());
    expect(text).toContain('"promises": []');
    expect(text).not.toMatch(/"promises": \[\n\s*\]/);
  });

  it('round-trips the empty graph — the zero-promise edge case', () => {
    const snapshot = emptySnapshot();
    const text = serialiseSnapshot(snapshot);
    expect(parseSnapshot(text)).toEqual(snapshot);
    expect(serialiseSnapshot(parseSnapshot(text))).toBe(text);
  });

  it('round-trips a populated snapshot', () => {
    const snapshot = twoPromiseSnapshot();
    const text = serialiseSnapshot(snapshot);
    expect(parseSnapshot(text)).toEqual(snapshot);
    expect(serialiseSnapshot(parseSnapshot(text))).toBe(text);
  });

  it('produces identical bytes for arrays supplied in a different order', () => {
    const snapshot = twoPromiseSnapshot();
    const expected = serialiseSnapshot(snapshot);
    const shuffled: LedgerSnapshot = {
      ...snapshot,
      promises: [...snapshot.promises].reverse(),
      edges: [...snapshot.edges].reverse(),
      evidence: snapshot.evidence.map((pack) => ({
        ...pack,
        artifacts: [...pack.artifacts].reverse(),
      })),
    };
    expect(serialiseSnapshot(shuffled)).toBe(expected);
  });

  it('produces identical bytes for keys inserted in a different order', () => {
    const snapshot = emptySnapshot();
    const reversed = Object.fromEntries(
      Object.entries(snapshot).reverse(),
    ) as unknown as LedgerSnapshot;
    expect(serialiseSnapshot(reversed)).toBe(serialiseSnapshot(snapshot));
  });

  it('leaves runs, members and diagnostics in the order they arrive', () => {
    // `runs` is newest-first and `diagnostics` is report order (design §9.1,
    // §14); sorting either would destroy information the Ledger renders.
    const snapshot: LedgerSnapshot = {
      ...emptySnapshot(),
      degradedReasons: ['second reason', 'first reason'],
      diagnostics: [
        { code: 'b-code', severity: 'warn', message: 'b', file: null, line: null, at: AT },
        { code: 'a-code', severity: 'info', message: 'a', file: null, line: null, at: AT },
      ],
    };
    const canonical = canonicaliseSnapshot(snapshot);
    expect(canonical.diagnostics.map((entry) => entry.code)).toEqual(['b-code', 'a-code']);
    expect(canonical.degradedReasons).toEqual(['second reason', 'first reason']);
  });

  it('canonicaliseSnapshot is the fixed point of the round trip', () => {
    const snapshot = twoPromiseSnapshot();
    const shuffled: LedgerSnapshot = { ...snapshot, promises: [...snapshot.promises].reverse() };
    const canonical = canonicaliseSnapshot(shuffled);
    expect(canonical).toEqual(snapshot);
    expect(canonicaliseSnapshot(canonical)).toEqual(canonical);
    expect(parseSnapshot(serialiseSnapshot(shuffled))).toEqual(canonical);
  });

  describe('values JSON would carry dishonestly', () => {
    it('throws naming the path on a Date', () => {
      const bad = { ...emptySnapshot(), generatedAt: new Date(AT) } as unknown as LedgerSnapshot;
      expect(() => serialiseSnapshot(bad)).toThrow(/generatedAt: a Date must not appear/);
    });

    it('throws naming the path on an undefined value', () => {
      const bad = {
        ...emptySnapshot(),
        generator: { kept: '0.0.0', kaneCli: undefined },
      } as unknown as LedgerSnapshot;
      expect(() => serialiseSnapshot(bad)).toThrow(
        /generator\.kaneCli: undefined is not serialisable/,
      );
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY])('throws on %s', (value) => {
      const bad = emptySnapshot();
      bad.metrics.designedCoverage = value;
      expect(() => serialiseSnapshot(bad)).toThrow(
        /metrics\.designedCoverage: .* is not representable in JSON/,
      );
    });

    it('throws naming the path on a Map, which JSON would flatten to {}', () => {
      const bad = { ...emptySnapshot(), generator: new Map() } as unknown as LedgerSnapshot;
      expect(() => serialiseSnapshot(bad)).toThrow(/generator: Map is not serialisable/);
    });

    it('names an array index in the path', () => {
      const bad = twoPromiseSnapshot();
      const first = bad.promises[0];
      if (first) first.credits = Number.NaN;
      expect(() => serialiseSnapshot(bad)).toThrow(/promises\[0\]\.credits/);
    });
  });

  describe('parseSnapshot throws with a field path (R8.8)', () => {
    it('names the invalid field in the message and in paths', () => {
      const snapshot = twoPromiseSnapshot();
      snapshot.metrics.undesignedCount = 0;
      const text = serialiseSnapshot(snapshot);
      let caught: unknown;
      try {
        parseSnapshot(text);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(SnapshotParseError);
      const error = caught as SnapshotParseError;
      expect(error.paths).toContain('metrics.undesignedCount');
      expect(error.message).toMatch(/metrics\.undesignedCount/);
    });

    it('names a nested array path', () => {
      const snapshot = twoPromiseSnapshot();
      const first = snapshot.promises[0];
      if (first) first.providers = [];
      let caught: unknown;
      try {
        parseSnapshot(JSON.stringify(snapshot));
      } catch (error) {
        caught = error;
      }
      expect((caught as SnapshotParseError).paths).toContain('promises[0].providers');
    });

    it('reports malformed JSON as a root failure rather than crashing', () => {
      expect(() => parseSnapshot('{ not json')).toThrow(SnapshotParseError);
      expect(() => parseSnapshot('{ not json')).toThrow(/not valid JSON/);
    });

    it('rejects a snapshot whose keys were stripped by JSON.stringify', () => {
      // The undefined-drops-keys hazard, from the reading side: a writer that
      // let `designedTest` go undefined produces JSON with the key missing.
      const snapshot = twoPromiseSnapshot();
      const loose = snapshot.promises.map((promise) => {
        const copy: Record<string, unknown> = { ...promise };
        copy['designedTest'] = undefined;
        return copy;
      });
      const text = JSON.stringify({ ...snapshot, promises: loose });
      expect(text).not.toContain('designedTest');
      expect(() => parseSnapshot(text)).toThrow(/promises\[0\]\.designedTest/);
    });
  });
});
