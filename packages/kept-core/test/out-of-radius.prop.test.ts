import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  EXIT_MEANINGS,
  STATE_DIAGNOSTIC_CODES,
  applyRun,
  collectTestCoverage,
  computeBlastRadius,
  contractFor,
  createDiagnosticSink,
  createKeptState,
  createPromiseGraph,
  createPromiseRecord,
  parseStream,
  permitsVerdictWrite,
  type BlastRadius,
  type ExitMeaning,
  type KeptState,
  type MemberEndStatus,
  type ParsedStream,
  type PlanMember,
  type PromiseRecord,
  type RunOutcome,
  type TestDocumentSource,
  type TestrunPlan,
  type Verdict,
  type VerdictWrite,
} from 'kept-core';

import { arbInstant, arbMemberStatus, arbStream, arbTruncatedStream, arbVerdict } from './arbitraries.js';

/**
 * Feature: kept, Property 9 (radius clause): every promise outside the blast
 * radius is byte-identical before and after, including verdict source and
 * freshness (design §7.4 step 6, §4.8, R4.10, R4.15).
 *
 * *For any* prior state, *for any* set of changed paths, and *for any* finished
 * `testrun` run — proven or not — every promise the blast radius did not select
 * comes out of `applyRun` exactly as it went in.
 *
 * This is the clause that makes a blast radius *safe* rather than merely cheap.
 * Verifying three promises must not touch the other five, and "not touch" has to
 * mean more than "leave the verdict alone": a promise whose `verdictSource.at`
 * moved forward would advertise a freshness the run never established for it,
 * which is the same overstatement the ledger exists not to make. So the clause is
 * quantified over the **whole serialised record** — verdict, verdict source with
 * its instant and terminal event type, repair annotation, evidence reference,
 * credits — and the writes handed to the store deliberately name **every** promise
 * in the graph, including the ones outside the radius. A store that applied them
 * all would fail on the first draw.
 *
 * Byte identity is asserted two ways, and the second is the one with teeth.
 * Serialised equality is the requirement as written; **reference** identity is how
 * the requirement is *kept*, because `applyRun` carries an untouched record across
 * by reference rather than copying it (§4.8). A refactor that rebuilt every record
 * on every run — mapping over the promises and spreading each one, say — would
 * still serialise identically today and would break the moment any field acquired
 * a derived default. Asserting `Object.is` fails that refactor immediately, which
 * is the point.
 *
 * The converse is asserted too, so the property cannot be satisfied by a store
 * that simply never writes: on a proven outcome, every promise **inside** the
 * radius that a write named does move, and the state-level freshness triple
 * advances — while the out-of-radius records' own freshness evidence stays where
 * it was. Those two facts hold simultaneously, and that is exactly the pairing
 * R4.15 is about.
 *
 * The radius itself is never hand-written. It comes from `computeBlastRadius` over
 * generated changed paths, generated `covers:` frontmatter and a generated plan,
 * so the partition under test is the one the product computes — and the
 * identifiers in it can only have come from `testrun_plan.members[]`.
 *
 * **Validates: Requirements 4.10, 4.15**
 */

/** Design §Testing Strategy floor is 100 runs; stated so it cannot regress. */
const NUM_RUNS = 500;

/** The family under test. `kept verify` is `ExecutionTestrun` and nothing else. */
const FAMILY = 'ExecutionTestrun' as const;

// ---------------------------------------------------------------------------
// The corpus: the eight designed tests, their ids, and what each one covers
// ---------------------------------------------------------------------------

interface TestDoc {
  readonly path: string;
  readonly testId: string;
  /** Frontmatter `covers:` globs. */
  readonly covers: readonly string[];
  /** One path that matches those globs — the edit that selects this test. */
  readonly trigger: string;
  /** The claim the promise designed by this test carries. Distinct per document. */
  readonly claim: string;
}

/**
 * The committed corpus's own identifier map, so the plan this property generates
 * carries the ids the repository actually uses. `cart_discount` shares
 * `lib/cart.ts` with `cart_subtotal` on purpose: one edit legitimately selects two
 * tests, and a radius that assumed one-to-one would be wrong about the real tree.
 */
const CORPUS: readonly TestDoc[] = [
  {
    path: 'tests/shop_filter_test.md',
    testId: 'T-1',
    covers: ['apps/fixture/app/shop/**'],
    trigger: 'apps/fixture/app/shop/page.tsx',
    claim: 'The Shop screen lists exactly six coffees.',
  },
  {
    path: 'tests/home_cta_test.md',
    testId: 'T-2',
    covers: ['apps/fixture/app/page.tsx'],
    trigger: 'apps/fixture/app/page.tsx',
    claim: 'The landing screen offers one call to action above the fold.',
  },
  {
    path: 'tests/cart_subtotal_test.md',
    testId: 'T-3',
    covers: ['apps/fixture/lib/cart.ts', 'apps/fixture/app/cart/**'],
    trigger: 'apps/fixture/app/cart/page.tsx',
    claim: 'The Cart screen shows a running subtotal that updates immediately.',
  },
  {
    path: 'tests/checkout_validation_test.md',
    testId: 'T-4',
    covers: ['apps/fixture/app/checkout/**'],
    trigger: 'apps/fixture/app/checkout/page.tsx',
    claim: 'Checkout refuses an order with an empty delivery address.',
  },
  {
    path: 'tests/orders_persist_test.md',
    testId: 'T-5',
    covers: ['apps/fixture/lib/orders.ts'],
    trigger: 'apps/fixture/lib/orders.ts',
    claim: 'Orders persist across a page reload.',
  },
  {
    path: 'tests/settings_currency_test.md',
    testId: 'T-6',
    covers: ['apps/fixture/app/settings/**'],
    trigger: 'apps/fixture/app/settings/page.tsx',
    claim: 'The Settings screen changes the displayed currency everywhere.',
  },
  {
    path: 'tests/cart_discount_test.md',
    testId: 'T-7',
    covers: ['apps/fixture/lib/cart.ts'],
    trigger: 'apps/fixture/lib/cart.ts',
    claim: 'The Cart screen applies a ten percent discount over fifty dollars.',
  },
  {
    path: 'tests/product_currency_test.md',
    testId: 'T-8',
    covers: ['apps/fixture/lib/currency.ts', 'apps/fixture/app/product/**'],
    trigger: 'apps/fixture/lib/currency.ts',
    claim: 'Every price is rendered with exactly two decimal places.',
  },
];

/** Paths no `covers:` glob in the corpus matches. R4.5's uncovered-edit case. */
const UNCOVERED_PATHS: readonly string[] = [
  'README.md',
  'apps/ledger/app/page.tsx',
  'packages/kept-core/src/state.ts',
];

/** The `covers:` frontmatter of each document, read the way the product reads it. */
const TEST_DOCUMENTS: TestDocumentSource = (() => {
  const files = new Map<string, string>();
  for (const doc of CORPUS) {
    files.set(
      doc.path,
      [
        '---',
        `test_id: ${doc.testId}`,
        `covers: [${doc.covers.join(', ')}]`,
        '---',
        '',
        `# ${doc.claim}`,
        '',
      ].join('\n'),
    );
  }
  return { readFile: (path: string): string | null => files.get(path) ?? null };
})();

const COVERS = collectTestCoverage({
  source: TEST_DOCUMENTS,
  paths: CORPUS.map((doc) => doc.path),
});

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** One prior promise record, designed by `doc`. */
function recordFor(doc: TestDoc, index: number, verdict: Verdict, at: string): PromiseRecord {
  return createPromiseRecord({
    claim: doc.claim,
    citation: { file: 'apps/fixture/README.md', line: index + 3, text: doc.claim },
    designedTest: { path: doc.path, testId: doc.testId },
    verdict,
    // A full prior provenance, so "including verdict source" has something to be
    // about: an out-of-radius record must keep this instant, this run id and this
    // terminal event type even while the state-level triple moves on.
    verdictSource: {
      runId: `run_prior_${index}`,
      terminalEventType: contractFor(FAMILY).terminalType,
      at,
      memberStatus: verdict === 'proven' ? 'passed' : 'failed',
      resultCode: verdict === 'red' ? 740 : 100,
      reasonCode: verdict === 'red' ? 'failure.product_bug' : 'success.complete',
    },
    repair: null,
    evidencePackId: `ev_prior_${index}`,
    credits: 0,
    providers: ['baseline'],
  });
}

interface Case {
  readonly prior: KeptState;
  readonly plan: TestrunPlan;
  readonly changed: readonly string[];
  readonly writes: readonly VerdictWrite[];
  readonly stream: ParsedStream<typeof FAMILY>;
  readonly meaning: ExitMeaning;
  readonly at: string;
}

/** Which documents the plan knows an identifier for. Never all of them, sometimes. */
const arbNullIdIndexes: fc.Arbitrary<readonly number[]> = fc.subarray(
  CORPUS.map((_doc, index) => index),
  { maxLength: 3 },
);

/** A prior verdict per document, so the graph is not uniform. */
const arbVerdicts: fc.Arbitrary<readonly Verdict[]> = fc.array(arbVerdict, {
  minLength: CORPUS.length,
  maxLength: CORPUS.length,
});

/** Edits: some that select a test, some that select nothing at all. */
const arbChanged: fc.Arbitrary<readonly string[]> = fc.tuple(
  fc.subarray(
    CORPUS.map((doc) => doc.trigger),
    { minLength: 1, maxLength: 3 },
  ),
  fc.subarray([...UNCOVERED_PATHS], { maxLength: 2 }),
).map(([triggers, uncovered]) => [...triggers, ...uncovered]);

/**
 * A finished `testrun` run, parsed from real NDJSON rather than hand-rolled.
 *
 * Both arms, because the clause has to hold for a crashed stream too — and both
 * are drawn from the shared generators of task 2.11, so the terminal event
 * carries its result code as a number *or* a string and its credits under either
 * field name.
 */
const arbParsedStream: fc.Arbitrary<ParsedStream<typeof FAMILY>> = fc
  .oneof(
    { weight: 3, arbitrary: arbStream(FAMILY) },
    { weight: 1, arbitrary: arbTruncatedStream(FAMILY) },
  )
  .map((drawn) => parseStream(contractFor(FAMILY), drawn.lines));

/** The whole exit vocabulary, weighted towards the two that permit a write. */
const arbExitMeaning: fc.Arbitrary<ExitMeaning> = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom<ExitMeaning>('success', 'failure') },
  { weight: 2, arbitrary: fc.constantFrom(...EXIT_MEANINGS) },
);

const arbCase: fc.Arbitrary<Case> = fc
  .record({
    verdicts: arbVerdicts,
    nullIds: arbNullIdIndexes,
    changed: arbChanged,
    stream: arbParsedStream,
    meaning: arbExitMeaning,
    priorAt: arbInstant,
    at: arbInstant,
    writeVerdicts: fc.array(arbVerdict, {
      minLength: CORPUS.length,
      maxLength: CORPUS.length,
    }),
    statuses: fc.array(arbMemberStatus, {
      minLength: CORPUS.length,
      maxLength: CORPUS.length,
    }),
  })
  .map((drawn): Case => {
    const promises = CORPUS.map((doc, index) =>
      recordFor(doc, index, drawn.verdicts[index] ?? 'stale', drawn.priorAt),
    );
    const prior = createKeptState({
      updatedAt: drawn.priorAt,
      freshness: {
        terminalEventAt: drawn.priorAt,
        terminalEventType: contractFor(FAMILY).terminalType,
        commandFamily: FAMILY,
      },
      graph: createPromiseGraph({ promises }),
    });

    // The plan is the only authority on identifiers (R4.4). A member without one
    // is excluded from the radius by `computeBlastRadius`, which widens the
    // complement rather than narrowing it — exactly the direction that keeps this
    // property honest.
    const nullIds = new Set(drawn.nullIds);
    const members: PlanMember[] = CORPUS.map((doc, index) => ({
      path: doc.path,
      testId: nullIds.has(index) ? null : doc.testId,
      tags: [],
      failure: nullIds.has(index) ? 'missing_meta' : null,
    }));

    // Writes for **every** promise, including the ones outside the radius. The
    // store must decline those; a store that applied them fails on draw one.
    const writes: VerdictWrite[] = promises.map((promise, index) => {
      const status = drawn.statuses[index];
      return {
        promiseId: promise.id,
        verdict: drawn.writeVerdicts[index] ?? 'red',
        memberStatus:
          typeof status === 'string' ? (status as MemberEndStatus) : null,
        resultCode: 740,
        reasonCode: 'failure.product_bug',
        evidencePackId: 'ev_new',
        credits: 0,
      };
    });

    return {
      prior,
      plan: { valid: true, members, capturedAt: drawn.priorAt },
      changed: drawn.changed,
      writes,
      stream: drawn.stream,
      meaning: drawn.meaning,
      at: drawn.at,
    };
  });

/** The radius the product computes for a case. Never hand-written. */
function radiusOf(subject: Case): BlastRadius {
  return computeBlastRadius({
    changed: subject.changed,
    graph: subject.prior.graph,
    plan: subject.plan,
    covers: COVERS,
  });
}

function outcomeOf(subject: Case): RunOutcome<typeof FAMILY> {
  return { runId: 'run_verify', exitMeaning: subject.meaning, stream: subject.stream };
}

/** One record's whole serialised form — the "byte-identical" of the requirement. */
function bytesOf(record: PromiseRecord | undefined): string {
  return JSON.stringify(record ?? null);
}

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

describe('Feature: kept, Property 9 (radius clause): promises outside the blast radius are byte-identical', () => {
  it('leaves every out-of-radius promise identical, verdict source and freshness included', () => {
    fc.assert(
      fc.property(arbCase, (subject) => {
        const radius = radiusOf(subject);
        const inRadius = new Set(radius.promiseIds);
        const outside = subject.prior.graph.promises.filter(
          (promise) => !inRadius.has(promise.id),
        );
        // Not vacuous, and not trivial: some promises are selected and some are
        // not. Both halves matter — a radius that selected everything would prove
        // nothing here, and one that selected nothing would prove it by accident.
        fc.pre(inRadius.size > 0 && outside.length > 0);

        const before = new Map(
          subject.prior.graph.promises.map((promise) => [promise.id, promise]),
        );
        const sink = createDiagnosticSink();
        const result = applyRun(subject.prior, {
          outcome: outcomeOf(subject),
          writes: subject.writes,
          radius: radius.promiseIds,
          at: subject.at,
          sink,
        });

        const after = new Map(
          result.state.graph.promises.map((promise) => [promise.id, promise]),
        );

        // ── The clause itself ────────────────────────────────────────────────
        for (const promise of outside) {
          const now = after.get(promise.id);
          // Byte identity, as the requirement states it: the verdict, the whole
          // verdict source including its instant and terminal event type, the
          // repair annotation, the evidence reference and the credits.
          expect(bytesOf(now)).toBe(bytesOf(promise));
          // And reference identity, which is *how* it is kept: an untouched
          // record is carried across, never rebuilt.
          expect(now).toBe(promise);
          expect(result.updatedPromiseIds).not.toContain(promise.id);
        }

        // The partition is exhaustive: nothing appeared, nothing vanished, and
        // the order is the canonical one both states were built with.
        expect(result.state.graph.promises).toHaveLength(
          subject.prior.graph.promises.length,
        );
        expect([...after.keys()]).toEqual([...before.keys()]);

        const proven =
          subject.stream.kind === 'complete' && permitsVerdictWrite(subject.meaning);
        expect(result.wrote).toBe(proven);

        if (!proven) {
          // The stronger statement for an unproven run: the prior state itself
          // came back, so *every* promise is byte-identical, in or out.
          expect(result.state).toBe(subject.prior);
          expect(result.state.freshness).toEqual(subject.prior.freshness);
          return;
        }

        // ── The converse, so a store that never writes cannot pass ───────────
        expect(result.updatedPromiseIds).toEqual([...radius.promiseIds].sort());
        expect(result.state.freshness).toEqual({
          terminalEventAt: subject.at,
          terminalEventType: contractFor(FAMILY).terminalType,
          commandFamily: FAMILY,
        });

        for (const id of radius.promiseIds) {
          const moved = after.get(id);
          expect(moved).toBeDefined();
          expect(moved).not.toBe(before.get(id));
          expect(moved?.verdictSource?.runId).toBe('run_verify');
          expect(moved?.verdictSource?.at).toBe(subject.at);
        }

        // And the pairing R4.15 is really about: the state-level freshness moved
        // in the same call that left every out-of-radius promise's own freshness
        // evidence exactly where it was.
        for (const promise of outside) {
          expect(after.get(promise.id)?.verdictSource?.at).toBe(
            promise.verdictSource?.at,
          );
          expect(after.get(promise.id)?.verdictSource?.runId).toBe(
            promise.verdictSource?.runId,
          );
        }

        // Every declined write is reported, so an out-of-radius promise is not
        // silently skipped — the run says which ones it refused and why.
        const declined = outside
          .filter((promise) =>
            subject.writes.some((write) => write.promiseId === promise.id),
          )
          .map((promise) => promise.id);
        for (const id of declined) expect(result.skippedPromiseIds).toContain(id);
        if (declined.length > 0) {
          expect(sink.has(STATE_DIAGNOSTIC_CODES.outsideRadius)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('holds when the radius is empty: no promise moves at all', () => {
    fc.assert(
      fc.property(arbCase, (subject) => {
        // An edit no designed test covers (R4.5). The radius selects nothing, so
        // the complement is the whole graph.
        const radius = computeBlastRadius({
          changed: [...UNCOVERED_PATHS],
          graph: subject.prior.graph,
          plan: subject.plan,
          covers: COVERS,
        });
        expect(radius.testIds).toEqual([]);
        expect(radius.promiseIds).toEqual([]);

        const result = applyRun(subject.prior, {
          outcome: outcomeOf(subject),
          writes: subject.writes,
          radius: radius.promiseIds,
          at: subject.at,
        });

        expect(result.updatedPromiseIds).toEqual([]);
        for (const promise of subject.prior.graph.promises) {
          const now = result.state.graph.promises.find((entry) => entry.id === promise.id);
          expect(bytesOf(now)).toBe(bytesOf(promise));
          expect(now).toBe(promise);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('states the whole graph as the complement of the radius, for one concrete edit', () => {
    // A worked example alongside the quantified clause, because the numbers are
    // the ones §7.4 talks about: one edit to `lib/cart.ts` selects the two tests
    // that cover it, and the other six promises are untouched.
    const promises = CORPUS.map((doc, index) => recordFor(doc, index, 'proven', '2026-08-01T00:00:00.000Z'));
    const prior = createKeptState({
      updatedAt: '2026-08-01T00:00:00.000Z',
      graph: createPromiseGraph({ promises }),
    });
    const plan: TestrunPlan = {
      valid: true,
      members: CORPUS.map((doc) => ({
        path: doc.path,
        testId: doc.testId,
        tags: [],
        failure: null,
      })),
      capturedAt: '2026-08-01T00:00:00.000Z',
    };

    const radius = computeBlastRadius({
      changed: ['apps/fixture/lib/cart.ts'],
      graph: prior.graph,
      plan,
      covers: COVERS,
    });
    expect(radius.testIds).toEqual(['T-3', 'T-7']);
    expect(radius.promiseIds).toHaveLength(2);

    const stream = parseStream(contractFor(FAMILY), [
      JSON.stringify({ type: 'testrun_plan', valid: true, members: plan.members }),
      JSON.stringify({
        type: 'testrun_member_end',
        path: 'tests/cart_subtotal_test.md',
        test_id: 'T-3',
        status: 'failed',
        result_code: 740,
      }),
      JSON.stringify({ type: 'testrun_done', status: 'failed' }),
    ]);

    const result = applyRun(prior, {
      outcome: { runId: 'run_verify', exitMeaning: 'failure', stream },
      writes: promises.map((promise) => ({ promiseId: promise.id, verdict: 'red' as Verdict })),
      radius: radius.promiseIds,
      at: '2026-08-20T18:41:02.118Z',
    });

    expect(result.updatedPromiseIds).toEqual([...radius.promiseIds].sort());
    expect(result.skippedPromiseIds).toHaveLength(CORPUS.length - 2);
    const inRadius = new Set(radius.promiseIds);
    for (const promise of promises) {
      const now = result.state.graph.promises.find((entry) => entry.id === promise.id);
      if (inRadius.has(promise.id)) {
        expect(now?.verdict).toBe('red');
        continue;
      }
      expect(now).toBe(promise);
      expect(bytesOf(now)).toBe(bytesOf(promise));
      expect(now?.verdict).toBe('proven');
    }
  });
});
