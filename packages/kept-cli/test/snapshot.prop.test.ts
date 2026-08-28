import type { PromiseRecord, Verdict } from 'kept-core';
import {
  createKeptState,
  createPromiseGraph,
  createPromiseRecord,
  designedTestId,
  isLedgerSnapshot,
  parseSnapshot,
  serialiseSnapshot,
} from 'kept-core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { deriveDocuments, deriveEdges } from '../src/graph.js';
import { buildSnapshot } from '../src/snapshot.js';

/**
 * Property tests for the snapshot projection.
 *
 * The invariant under test is the one the deployed Ledger depends on: **whatever
 * `kept build` puts in `.kept/state.json`, `kept snapshot` turns into a file that
 * satisfies the schema** — counts agreeing with the promise list, coverage null
 * exactly where R9.3 and R2.11 say so, every edge endpoint resolving, every
 * evidence reference resolving. Design §9.1 makes those five rules the difference
 * between a Ledger build that succeeds and one that fails naming a field path, and
 * the CLI is the only writer.
 *
 * These are local invariants of this module rather than numbered design
 * properties, generated over the same 500-case budget as the rest of the suite.
 */
const NUM_RUNS = 500;

const VERDICTS: readonly Verdict[] = ['proven', 'red', 'stale', 'undesigned'];

const arbClaim = fc
  .string({ minLength: 1, maxLength: 60 })
  .filter((text) => text.trim().length > 0);

const arbFile = fc.constantFrom(
  'apps/fixture/README.md',
  'docs/promises.md',
  'apps/fixture/app/cart/page.tsx',
);

const arbDesignedTest = fc.option(
  fc.record({
    path: fc.constantFrom('tests/cart_subtotal_test.md', 'tests/home_cta_test.md'),
    testId: fc.option(fc.constantFrom('T-1', 'T-3'), { nil: null }),
  }),
  { nil: null },
);

/**
 * A promise built through the model's own factory, so the id derivation and the
 * explicit-null discipline are the production ones. The verdict is generated
 * freely, including the combinations the merge would never produce — a `proven`
 * promise with no designed test, for instance — because the schema's count
 * agreement rule must hold for whatever a caller hands the writer.
 */
const arbPromise = fc
  .record({
    claim: arbClaim,
    file: arbFile,
    line: fc.integer({ min: 1, max: 40 }),
    text: fc.string({ maxLength: 80 }),
    designedTest: arbDesignedTest,
    verdict: fc.constantFrom(...VERDICTS),
    credits: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: null }),
  })
  .map(
    (input): PromiseRecord =>
      createPromiseRecord({
        claim: input.claim,
        citation: { file: input.file, line: input.line, text: input.text },
        designedTest: input.designedTest,
        verdict: input.verdict,
        providers: ['baseline'],
        credits: input.credits,
      }),
  );

const arbState = fc
  .record({
    promises: fc.array(arbPromise, { maxLength: 8 }),
    degraded: fc.boolean(),
  })
  .map((input) => {
    const graph = createPromiseGraph({
      promises: input.promises,
      edges: deriveEdges(input.promises),
      degraded: input.degraded,
      degradedReasons: input.degraded ? ['assurance-status:refused'] : [],
    });
    return createKeptState({ updatedAt: '2026-08-20T12:00:00.000Z', graph });
  });

describe('every state projects into a schema-valid snapshot', () => {
  it('holds over generated graphs, degraded and not', () => {
    fc.assert(
      fc.property(arbState, (state) => {
        const built = buildSnapshot({ state, generatedAt: '2026-08-20T12:00:00.000Z' });
        expect(built.error).toBeNull();
        expect(built.valid).toBe(true);
        expect(isLedgerSnapshot(built.snapshot)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('agrees with its own promise list on every count', () => {
    fc.assert(
      fc.property(arbState, (state) => {
        const { snapshot } = buildSnapshot({ state, generatedAt: '2026-08-20T12:00:00.000Z' });
        const { metrics, promises } = snapshot;
        expect(metrics.totalPromises).toBe(promises.length);
        expect(metrics.designedCount).toBe(
          promises.filter((promise) => promise.designedTest !== null).length,
        );
        for (const verdict of VERDICTS) {
          const field = `${verdict}Count` as
            | 'provenCount'
            | 'redCount'
            | 'staleCount'
            | 'undesignedCount';
          expect(metrics[field]).toBe(
            promises.filter((promise) => promise.verdict === verdict).length,
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('nulls the coverage figures exactly where R9.3 and R2.11 require', () => {
    fc.assert(
      fc.property(arbState, (state) => {
        const { snapshot } = buildSnapshot({ state, generatedAt: '2026-08-20T12:00:00.000Z' });
        const empty = snapshot.metrics.totalPromises === 0;
        expect(snapshot.metrics.designedCoverage === null).toBe(empty);
        expect(snapshot.metrics.provenCoverage === null).toBe(empty || snapshot.degraded);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('declares a node for every edge endpoint it publishes', () => {
    fc.assert(
      fc.property(arbState, (state) => {
        const { snapshot } = buildSnapshot({ state, generatedAt: '2026-08-20T12:00:00.000Z' });
        const nodes = new Set<string>([
          ...snapshot.promises.map((promise) => promise.id),
          ...snapshot.documents.map((document) => document.id),
          ...snapshot.evidence.map((pack) => pack.id),
        ]);
        for (const promise of snapshot.promises) {
          // Derived exactly as the schema's own endpoint rule derives it: the
          // snapshot carries no `designedTests` array, so the `t_` node is a
          // function of the path.
          if (promise.designedTest !== null) {
            nodes.add(designedTestId(promise.designedTest.path));
          }
        }
        for (const edge of snapshot.edges) {
          expect(nodes.has(edge.from)).toBe(true);
          expect(nodes.has(edge.to)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('re-serialises byte-identically after a parse (§9.2)', () => {
    fc.assert(
      fc.property(arbState, (state) => {
        const built = buildSnapshot({ state, generatedAt: '2026-08-20T12:00:00.000Z' });
        expect(serialiseSnapshot(parseSnapshot(built.text))).toBe(built.text);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('the derived documents partition the promises', () => {
  it('claimCount sums to the promise count, one node per distinct cited file', () => {
    fc.assert(
      fc.property(fc.array(arbPromise, { maxLength: 8 }), (promises) => {
        const documents = deriveDocuments(promises);
        const total = documents.reduce((sum, document) => sum + document.claimCount, 0);
        expect(total).toBe(promises.length);
        expect(documents).toHaveLength(
          new Set(promises.map((promise) => promise.citation.file)).size,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
