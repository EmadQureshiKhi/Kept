import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_KINDS,
  COMMAND_FAMILIES,
  MEMBER_END_STATUSES,
  PROVIDER_NAMES,
  REPAIR_BRANCHES,
  REPAIR_STRATEGIES,
  SNAPSHOT_SCHEMA_VERSION,
  VERDICTS,
  canonicaliseSnapshot,
  compareGraphEdges,
  comparePromiseRecords,
  contractFor,
  designedTestId,
  documentId,
  isLedgerSnapshot,
  parseSnapshot,
  promiseId,
  serialiseSnapshot,
  type LedgerSnapshot,
} from '@kept/core';

/**
 * Feature: kept, Property 3: Snapshot serialisation round-trips and is canonical
 * (design §Correctness Properties, §9.1, §9.2).
 *
 * *For any* valid promise graph, parsing its serialised snapshot yields a
 * snapshot whose promise identifiers, citations, verdicts, designed test
 * references, metrics and evidence references are deep-equal to the original;
 * and re-serialising that parsed value produces a byte-identical string.
 *
 * Both halves are needed, and they fail in different directions. Round-tripping
 * alone permits a serialiser that emits keys in whatever order the object was
 * built in: every parse would still return the right value, and every rebuild
 * would still produce a whole-file git diff, which destroys the reviewability of
 * the one artefact that proves this ledger is real. Canonicality alone permits a
 * serialiser that drops a field — the bytes would be perfectly stable and the
 * Ledger would render a lie.
 *
 * So the property is asserted in four parts:
 *
 * 1. `parse(serialise(x))` deep-equals `x` — nothing is lost or reshaped.
 * 2. `serialise(parse(serialise(x)))` is byte-identical to `serialise(x)`.
 * 3. The same logical snapshot assembled in a different insertion order — keys
 *    shuffled at every level, id-ordered arrays reversed — serialises to
 *    byte-identical output. This is what keeps the committed snapshot's diff
 *    empty when nothing has changed.
 * 4. Every generated snapshot is schema-valid, so the generator cannot pass by
 *    producing snapshots the schema would have rejected anyway.
 *
 * The **empty graph** is generated densely on purpose: zero promises is where a
 * divide-by-zero in coverage hides (R9.3), and it is the one input the plan names
 * as required.
 *
 * **Validates: Requirements 1.8, 8.8**
 */

/** Design's testing-strategy floor is 100 runs; stated so it cannot regress. */
const NUM_RUNS = 500;

// ---------------------------------------------------------------------------
// Generators. Task 2.11 should absorb these into test/arbitraries.ts as
// `arbSnapshot`, which the plan requires to be always schema-valid and to
// include the empty graph.
// ---------------------------------------------------------------------------

/** ISO 8601 instants, as strings. No `Date` ever enters the structure (§9.2). */
const arbInstant: fc.Arbitrary<string> = fc
  .integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2026, 11, 31) })
  .map((ms) => new Date(ms).toISOString());

/** Repository-relative POSIX document paths, drawn from a small pool. */
const arbDocFile: fc.Arbitrary<string> = fc.constantFrom(
  'apps/fixture/README.md',
  'apps/fixture/CHANGELOG.md',
  'README.md',
  'docs/promises.md',
);

/** `*_test.md` paths. */
const arbTestFile: fc.Arbitrary<string> = fc.constantFrom(
  'tests/cart_subtotal_test.md',
  'tests/cart_discount_test.md',
  'tests/checkout_test.md',
);

/**
 * Claim text. Awkward on purpose: quotes, a backslash, a newline, a tab, a
 * combining accent, an emoji and a `</script>` sequence all have to survive the
 * trip byte-for-byte, because the claim is rendered verbatim in the Ledger and
 * a mangled one is a promise the graph misquotes.
 */
const arbClaim: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    '- The Cart screen shows a running subtotal.',
    '- The Checkout button is disabled while the cart is empty.',
    'A claim with "quotes" and a \\ backslash',
    'A claim with a\ttab and a\nnewline',
    'Café résumé — naïve',
    'A claim with </script> and \u00e9\u0301 and 🧾',
    '',
  ),
  fc.string({ maxLength: 40 }),
);

const arbEvidencePackId: fc.Arbitrary<string> = fc.constantFrom(
  'ev_20260820T184011Z',
  'ev_20260821T090000Z',
);

function arbArtifact(packId: string): fc.Arbitrary<LedgerSnapshot['evidence'][number]['artifacts'][number]> {
  return fc.record({
    kind: fc.constantFrom(...ARTIFACT_KINDS),
    name: fc.constantFrom('annotated.png', 'failure.yaml', 'step-3.png', 'console.log'),
    bytes: fc.option(fc.nat({ max: 1_000_000 }), { nil: null }),
  }).map((artifact) => ({
    kind: artifact.kind,
    name: artifact.name,
    publicPath: `/evidence/${packId}/${artifact.name}`,
    bytes: artifact.bytes,
  }));
}

function arbEvidence(packId: string): fc.Arbitrary<LedgerSnapshot['evidence'][number]> {
  return fc
    .record({
      kind: fc.constantFrom('run' as const, 'testrun' as const),
      sealedAt: fc.option(arbInstant, { nil: null }),
      artifacts: fc.array(arbArtifact(packId), { maxLength: 4 }),
    })
    .map((pack) => ({
      id: packId,
      kind: pack.kind,
      sealedAt: pack.sealedAt,
      publicPath: `/evidence/${packId}/`,
      // Deduplicated on the canonical key so two artefacts never collide in a
      // way that makes the sort unstable between orderings of the same input,
      // and emitted in canonical order because `arbSnapshot` generates the
      // *canonical* form — the one `kept snapshot` writes.
      artifacts: dedupeBy(
        pack.artifacts,
        (artifact) => `${artifact.kind}\u0000${artifact.name}`,
      ).sort((left, right) =>
        left.kind !== right.kind
          ? left.kind < right.kind
            ? -1
            : 1
          : left.name < right.name
            ? -1
            : left.name > right.name
              ? 1
              : 0,
      ),
    }));
}

/** Keep the first occurrence of each key, in order. */
function dedupeBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

interface PromiseDraft {
  readonly file: string;
  readonly claim: string;
  readonly line: number;
  readonly designedTestPath: string | null;
  readonly testId: string | null;
  readonly verdict: (typeof VERDICTS)[number];
  readonly withVerdictSource: boolean;
  readonly withRepair: boolean;
  readonly packIndex: number | null;
  readonly credits: number | null;
  readonly providers: readonly (typeof PROVIDER_NAMES)[number][];
}

const arbPromiseDraft: fc.Arbitrary<PromiseDraft> = fc.record({
  file: arbDocFile,
  claim: arbClaim,
  line: fc.integer({ min: 1, max: 400 }),
  designedTestPath: fc.option(arbTestFile, { nil: null }),
  testId: fc.option(fc.constantFrom('T-1', 'T-3', 'T-7'), { nil: null }),
  verdict: fc.constantFrom(...VERDICTS),
  withVerdictSource: fc.boolean(),
  withRepair: fc.boolean(),
  packIndex: fc.option(fc.nat({ max: 1 }), { nil: null }),
  credits: fc.option(fc.nat({ max: 50 }), { nil: null }),
  providers: fc
    .subarray([...PROVIDER_NAMES], { minLength: 1 })
    .map((names) => PROVIDER_NAMES.filter((name) => names.includes(name))),
});

const arbDiagnostic: fc.Arbitrary<LedgerSnapshot['diagnostics'][number]> = fc.record({
  code: fc.constantFrom('ndjson-parse', 'kane-not-found', 'citation-out-of-range'),
  severity: fc.constantFrom('info' as const, 'warn' as const, 'error' as const),
  message: fc.string({ minLength: 1, maxLength: 40 }).map((text) => text.trim() || 'message'),
  file: fc.option(arbDocFile, { nil: null }),
  line: fc.option(fc.integer({ min: 1, max: 400 }), { nil: null }),
  at: arbInstant,
});

/**
 * A schema-valid snapshot.
 *
 * Everything derived is derived rather than generated: metric counts from the
 * promise list, coverage from the counts, edge endpoints from the nodes that
 * exist, evidence references from the packs the snapshot carries, the freshness
 * terminal type from the family contract. Generating those independently would
 * produce snapshots the five cross-field rules reject, and a property test whose
 * inputs are mostly invalid tests the rejection path, not the round trip.
 */
function snapshotArb(
  drafts: fc.Arbitrary<readonly PromiseDraft[]>,
): fc.Arbitrary<LedgerSnapshot> {
  return fc
    .record({
      drafts,
      packIds: fc.uniqueArray(arbEvidencePackId, { maxLength: 2 }),
      degraded: fc.boolean(),
      degradedReasons: fc.array(fc.constantFrom('kane-cli not found', 'stream crashed'), {
        maxLength: 2,
      }),
      fresh: fc.option(fc.constantFrom(...COMMAND_FAMILIES), { nil: null }),
      freshAt: arbInstant,
      generatedAt: arbInstant,
      kaneCli: fc.option(fc.constantFrom('0.8.4'), { nil: null }),
      diagnostics: fc.array(arbDiagnostic, { maxLength: 3 }),
    })
    .chain((seed) => {
      const packs: fc.Arbitrary<LedgerSnapshot['evidence']> =
        seed.packIds.length === 0
          ? fc.constant([])
          : fc.tuple(...seed.packIds.map((id) => arbEvidence(id)));
      return packs.map((evidence) => build(seed, evidence));
    });
}

const arbSnapshot: fc.Arbitrary<LedgerSnapshot> = snapshotArb(
  fc.array(arbPromiseDraft, { maxLength: 6 }),
);

/** The empty graph: zero promises, both coverage figures null (R9.3). */
const arbEmptySnapshot: fc.Arbitrary<LedgerSnapshot> = snapshotArb(fc.constant([]));

type SnapshotSeed = {
  readonly drafts: readonly PromiseDraft[];
  readonly packIds: readonly string[];
  readonly degraded: boolean;
  readonly degradedReasons: readonly string[];
  readonly fresh: (typeof COMMAND_FAMILIES)[number] | null;
  readonly freshAt: string;
  readonly generatedAt: string;
  readonly kaneCli: string | null;
  readonly diagnostics: readonly LedgerSnapshot['diagnostics'][number][];
};

function build(seed: SnapshotSeed, evidence: LedgerSnapshot['evidence']): LedgerSnapshot {
  const packIds = evidence.map((pack) => pack.id);

  const byId = new Map<string, LedgerSnapshot['promises'][number]>();
  for (const draft of seed.drafts) {
    const id = promiseId(draft.file, draft.claim);
    // A promise id is a function of (file, claim), so two drafts can collide.
    // The graph merges them into one promise; keeping the first is that merge.
    if (byId.has(id)) continue;
    const packId =
      draft.packIndex === null ? null : (packIds[draft.packIndex % Math.max(packIds.length, 1)] ?? null);
    const designedTest =
      draft.designedTestPath === null
        ? null
        : { path: draft.designedTestPath, testId: draft.testId };
    byId.set(id, {
      id,
      claim: draft.claim,
      citation: { file: draft.file, line: draft.line, text: draft.claim },
      designedTest,
      verdict: draft.verdict,
      verdictSource: draft.withVerdictSource
        ? {
            runId: 'tr_20260820T184011Z',
            terminalEventType: 'testrun_done',
            at: seed.freshAt,
            memberStatus: MEMBER_END_STATUSES[0],
            resultCode: 740,
            reasonCode: 'failure.product_bug',
          }
        : null,
      repair: draft.withRepair
        ? {
            branch: REPAIR_BRANCHES[0] ?? 'code-break',
            strategy: REPAIR_STRATEGIES[0] ?? 'resultCode740',
            severity: 'high',
            category: 'functional',
            confidence: 0.9,
            evidenceRef: packId === null ? null : `evidence/${packId}/failure.yaml`,
            rationale: 'generated',
          }
        : null,
      evidencePackId: packId,
      providers: [...draft.providers],
      credits: draft.credits,
    });
  }

  const promises = [...byId.values()].sort(comparePromiseRecords);

  const documents = dedupeBy(
    promises.map((promise) => promise.citation.file),
    (file) => file,
  )
    .map((file) => ({
      id: documentId(file),
      file,
      claimCount: promises.filter((promise) => promise.citation.file === file).length,
    }))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  const rawEdges = promises.flatMap((promise) => {
    const edges: LedgerSnapshot['edges'][number][] = [
      { from: documentId(promise.citation.file), to: promise.id, kind: 'cites' },
    ];
    if (promise.designedTest !== null) {
      edges.push({
        from: promise.id,
        to: designedTestId(promise.designedTest.path),
        kind: 'designed' as const,
      });
    }
    if (promise.evidencePackId !== null) {
      edges.push({ from: promise.id, to: promise.evidencePackId, kind: 'evidence' as const });
    }
    return edges;
  });
  const edges = dedupeBy(rawEdges, (edge) => `${edge.kind}\u0000${edge.from}\u0000${edge.to}`).sort(
    compareGraphEdges,
  );

  const total = promises.length;
  const designedCount = promises.filter((promise) => promise.designedTest !== null).length;
  const count = (verdict: (typeof VERDICTS)[number]): number =>
    promises.filter((promise) => promise.verdict === verdict).length;
  const provenCount = count('proven');

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: seed.generatedAt,
    generator: { kept: '0.0.0', kaneCli: seed.kaneCli },
    degraded: seed.degraded,
    degradedReasons: [...seed.degradedReasons],
    freshness:
      seed.fresh === null
        ? { terminalEventAt: null, terminalEventType: null, commandFamily: null }
        : {
            terminalEventAt: seed.freshAt,
            terminalEventType: contractFor(seed.fresh).terminalType,
            commandFamily: seed.fresh,
          },
    metrics: {
      totalPromises: total,
      designedCount,
      provenCount,
      redCount: count('red'),
      staleCount: count('stale'),
      undesignedCount: count('undesigned'),
      designedCoverage: total === 0 ? null : designedCount / total,
      provenCoverage: total === 0 || seed.degraded ? null : provenCount / total,
    },
    promises,
    edges,
    documents,
    evidence: [...evidence].sort((left, right) => (left.id < right.id ? -1 : 1)),
    runs: [],
    reviewCards: [],
    amendments: [],
    // Spread each entry: `fc.record` may hand back a null-prototype object, and
    // a snapshot's diagnostics are plain records.
    diagnostics: seed.diagnostics.map((entry) => ({ ...entry })),
  };
}

/** Rebuild a value with its object keys inserted in reverse-sorted order. */
function reorderKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderKeys);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort().reverse()) out[key] = reorderKeys(record[key]);
  return out;
}

/** Reverse every array the canonical order fixes, at every level it appears. */
function shuffleOrderedArrays(snapshot: LedgerSnapshot): LedgerSnapshot {
  return {
    ...snapshot,
    promises: [...snapshot.promises].reverse(),
    edges: [...snapshot.edges].reverse(),
    documents: [...snapshot.documents].reverse(),
    evidence: [...snapshot.evidence]
      .reverse()
      .map((pack) => ({ ...pack, artifacts: [...pack.artifacts].reverse() })),
  };
}

describe('Feature: kept, Property 3: Snapshot serialisation round-trips and is canonical', () => {
  it('parse(serialise(x)) deep-equals x, and re-serialising is byte-identical', () => {
    fc.assert(
      fc.property(arbSnapshot, (snapshot) => {
        // 4. The generator only produces snapshots the schema accepts.
        expect(isLedgerSnapshot(snapshot)).toBe(true);

        const text = serialiseSnapshot(snapshot);

        // 1. Nothing is lost or reshaped.
        const parsed = parseSnapshot(text);
        expect(parsed).toStrictEqual(snapshot);

        // The named fields of the property statement, asserted explicitly rather
        // than relying on the structural comparison above to have covered them.
        expect(parsed.promises.map((promise) => promise.id)).toEqual(
          snapshot.promises.map((promise) => promise.id),
        );
        expect(parsed.promises.map((promise) => promise.citation)).toEqual(
          snapshot.promises.map((promise) => promise.citation),
        );
        expect(parsed.promises.map((promise) => promise.verdict)).toEqual(
          snapshot.promises.map((promise) => promise.verdict),
        );
        expect(parsed.promises.map((promise) => promise.designedTest)).toEqual(
          snapshot.promises.map((promise) => promise.designedTest),
        );
        expect(parsed.metrics).toEqual(snapshot.metrics);
        expect(parsed.promises.map((promise) => promise.evidencePackId)).toEqual(
          snapshot.promises.map((promise) => promise.evidencePackId),
        );

        // 2. Byte-identical on re-serialisation.
        expect(serialiseSnapshot(parsed)).toBe(text);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('serialises byte-identically whatever order the same snapshot was built in', () => {
    fc.assert(
      fc.property(arbSnapshot, (snapshot) => {
        const expected = serialiseSnapshot(snapshot);

        // 3a. Key insertion order, at every level.
        const reordered = reorderKeys(snapshot) as LedgerSnapshot;
        expect(serialiseSnapshot(reordered)).toBe(expected);

        // 3b. Array order, for every array the canonical form fixes.
        const shuffled = shuffleOrderedArrays(snapshot);
        expect(serialiseSnapshot(shuffled)).toBe(expected);

        // 3c. Both at once, which is what two independent builds look like.
        expect(serialiseSnapshot(reorderKeys(shuffled) as LedgerSnapshot)).toBe(expected);

        // The canonical value is the round trip's fixed point.
        expect(canonicaliseSnapshot(shuffled)).toEqual(canonicaliseSnapshot(snapshot));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('holds for the empty graph, where a divide-by-zero in coverage would hide', () => {
    fc.assert(
      fc.property(arbEmptySnapshot, (snapshot) => {
        expect(snapshot.metrics.totalPromises).toBe(0);
        expect(snapshot.metrics.designedCoverage).toBeNull();
        expect(snapshot.metrics.provenCoverage).toBeNull();
        expect(isLedgerSnapshot(snapshot)).toBe(true);
        const text = serialiseSnapshot(snapshot);
        expect(parseSnapshot(text)).toStrictEqual(snapshot);
        expect(serialiseSnapshot(parseSnapshot(text))).toBe(text);
      }),
      { numRuns: 100 },
    );
  });

  it('serialises with a two-space indent, sorted keys and one trailing newline', () => {
    fc.assert(
      fc.property(arbSnapshot, (snapshot) => {
        const text = serialiseSnapshot(snapshot);
        expect(text.endsWith('}\n')).toBe(true);
        expect(text.endsWith('\n\n')).toBe(false);
        expect(text).not.toContain('\t');
        for (const line of text.split('\n')) {
          const leading = line.length - line.trimStart().length;
          expect(leading % 2).toBe(0);
        }
        const topLevel = text
          .split('\n')
          .filter((line) => /^ {2}"/.test(line))
          .map((line) => line.slice(3, line.indexOf('"', 3)));
        expect(topLevel).toEqual([...topLevel].sort());
        // No `Date` survived into the structure: every timestamp is a quoted
        // string on the way out and a string on the way back in.
        expect(typeof parseSnapshot(text).generatedAt).toBe('string');
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
