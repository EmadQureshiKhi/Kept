import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  COMMAND_FAMILIES,
  EXIT_MEANINGS,
  VERDICTS,
  WRITE_PERMITTING_EXIT_MEANINGS,
  applyRun,
  contractFor,
  createDiagnosticSink,
  createKeptState,
  createPromiseGraph,
  createPromiseRecord,
  exitMeaning,
  mayWriteVerdicts,
  parseStream,
  permitsVerdictWrite,
  writeRefusals,
  type CommandFamily,
  type ExitMeaning,
  type KeptState,
  type MemberEndStatus,
  type ParsedStream,
  type PromiseRecord,
  type RunOutcome,
  type StateFreshness,
  type Verdict,
  type VerdictSource,
  type VerdictWrite,
} from '@kept/core';

/**
 * Feature: kept, Property 9 (state clause): Verdicts and freshness move only on
 * a proven outcome (design §Correctness Properties, §4.8, §14.1, R2.10, R3.7,
 * R5.3, R5.4, R11.8–R11.11).
 *
 * *For any* prior state and *for any* invocation result, the promise verdicts and
 * the freshness timestamp in the new state are identical to the prior state
 * unless the stream is `complete` **and** the exit meaning is `success` or
 * `failure`.
 *
 * Both halves are quantified over, and over the whole vocabulary rather than over
 * a sample of it: all three command families, all eight `ExitMeaning` members,
 * both arms of `ParsedStream`. The truth table is also stated *exhaustively* over
 * `EXIT_MEANINGS × {complete, crashed}` and pinned by cell count, so a ninth
 * exit meaning cannot silently join the writable side — adding one fails the
 * table's arity assertion before it can reach the ledger.
 *
 * The hazards the requirements name individually are asserted individually as
 * well as universally, because each is a *specific* misreading somebody could
 * reintroduce: an Assurance pause (exit 3, R2.9, R5.4, R11.10), a timeout kill
 * (R11.8), a preflight rejection with nothing run at all (R4.11), a missing
 * binary (R2.12), and a crashed stream that nonetheless carried plausible-looking
 * events including another family's terminal event (R3.6, R3.7). The last is the
 * one a shape-based test misses: the events look like a finished run, and the
 * outcome is still unknown.
 *
 * The deep-freeze clause is here rather than in the unit suite because it is the
 * runtime half of "by construction": an untouched record is carried across by
 * reference and frozen, so a downstream mutation is a `TypeError` instead of
 * silent ledger corruption.
 *
 * **Validates: Requirements 3.7, 5.3, 11.8, 11.9**
 */

/** Design §Testing Strategy floor is 100 runs; stated so it cannot regress. */
const NUM_RUNS = 500;

// ---------------------------------------------------------------------------
// Generators. All local; task 2.11 should absorb every one marked below.
// ---------------------------------------------------------------------------

/** All three families, every run. 2.11 should absorb this as `arbFamily`. */
const arbFamily: fc.Arbitrary<CommandFamily> = fc.constantFrom(...COMMAND_FAMILIES);

/** The whole exit vocabulary, never a sample. 2.11: `arbExitMeaning`. */
const arbExitMeaning: fc.Arbitrary<ExitMeaning> = fc.constantFrom(...EXIT_MEANINGS);

/** 2.11: `arbVerdict`. */
const arbVerdict: fc.Arbitrary<Verdict> = fc.constantFrom(...VERDICTS);

/** 2.11: `arbMemberStatus`. */
const arbMemberStatus: fc.Arbitrary<MemberEndStatus | null> = fc.constantFrom<
  MemberEndStatus | null
>('passed', 'failed', 'broken', 'interrupted', null);

/**
 * An ISO 8601 instant as a string, over a band a ledger plausibly spans.
 * Generated from milliseconds rather than from `fc.date` so no unrepresentable
 * date can reach `toISOString`. 2.11: `arbIsoInstant`.
 */
const arbIsoInstant: fc.Arbitrary<string> = fc
  .integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2027, 0, 1) })
  .map((ms) => new Date(ms).toISOString());

/** The terminal line each family ends with, per the contract table of §4.1. */
const TERMINAL_LINE: { readonly [F in CommandFamily]: string } = {
  ExecutionRun: JSON.stringify({ type: 'run_end', status: 'passed', result_code: 0 }),
  ExecutionTestrun: JSON.stringify({ type: 'testrun_done', status: 'passed' }),
  Assurance: JSON.stringify({ type: 'done', status: 'complete', exit_code: 0 }),
};

/**
 * Lines that look like a finished, successful run and are **not** the terminal
 * event of the family being parsed — progress chatter, passing members, a
 * summary with green totals, and (added per family below) the terminal events of
 * the *other two* families. A crashed stream assembled from these is the
 * dangerous case R3.7 is about: everything reads like a pass and the outcome is
 * unknown. 2.11: `arbPlausibleNonTerminalLines`.
 */
const GENERIC_PLAUSIBLE_LINES: readonly string[] = [
  JSON.stringify({ step: 'plan', status: 'ok', remark: 'resolved 3 members' }),
  JSON.stringify({ step: 'execute', status: 'ok' }),
  JSON.stringify({ type: 'testrun_member_end', path: 'a_test.md', status: 'passed' }),
  JSON.stringify({ type: 'testrun_member_end', path: 'b_test.md', status: 'passed' }),
  JSON.stringify({ type: 'testrun_summary', totals: { passed: 2, failed: 0 } }),
  JSON.stringify({ type: 'nothing_documented_anywhere', note: 'kane vocabulary is open' }),
];

function plausibleLinesFor(family: CommandFamily): readonly string[] {
  const otherTerminals = COMMAND_FAMILIES.filter((other) => other !== family).map(
    (other) => TERMINAL_LINE[other],
  );
  return [...GENERIC_PLAUSIBLE_LINES, ...otherTerminals];
}

/**
 * A parsed stream, built by parsing real NDJSON rather than by hand-rolling a
 * `CompleteStream` literal. A fabricated object could claim `kind: 'complete'`
 * while carrying a terminal event the parser would never have produced, which
 * would test the guard against a shape that cannot occur.
 *
 * Typed at `CommandFamily` rather than at a literal so no clause below can be
 * proven for one contract only.
 */
function streamFor(
  family: CommandFamily,
  complete: boolean,
  noise: readonly string[],
): ParsedStream<CommandFamily> {
  const lines = complete ? [...noise, TERMINAL_LINE[family]] : noise;
  return parseStream(contractFor(family), lines);
}

interface OutcomeShape {
  readonly family: CommandFamily;
  readonly complete: boolean;
  readonly meaning: ExitMeaning;
  readonly noise: readonly string[];
}

/** 2.11: `arbRunOutcome`, the pairing of an exit meaning with a parsed stream. */
const arbOutcomeShape: fc.Arbitrary<OutcomeShape> = arbFamily.chain((family) =>
  fc.record({
    family: fc.constant(family),
    complete: fc.boolean(),
    meaning: arbExitMeaning,
    noise: fc.array(fc.constantFrom(...plausibleLinesFor(family)), { maxLength: 6 }),
  }),
);

function outcomeOf(shape: OutcomeShape, runId = 'run_generated'): RunOutcome<CommandFamily> {
  return {
    runId,
    exitMeaning: shape.meaning,
    stream: streamFor(shape.family, shape.complete, shape.noise),
  };
}

/**
 * Eight distinct claims, so a generated graph cannot contain two promises whose
 * ids collide. Promise ids key on the citation file plus the *normalised* claim,
 * so freely generated strings would collapse together and "find the promise by
 * id" would stop being well defined. 2.11: `arbPromiseRecord` should take the
 * same approach.
 */
const CLAIMS: readonly string[] = [
  'The cart subtotal equals the sum of the line totals.',
  'Adding the same coffee twice increases its quantity rather than its line count.',
  'Checkout applies a ten percent discount to orders over fifty units.',
  'Settings persist across a page reload.',
  'The orders screen lists the newest order first.',
  'A product page shows the roast level for every coffee.',
  'Removing the last item empties the cart.',
  'Currency is rendered with exactly two decimal places.',
];

interface PromiseShape {
  readonly index: number;
  readonly verdict: Verdict;
  readonly withSource: boolean;
}

const arbPromiseShape: fc.Arbitrary<PromiseShape> = fc.record({
  index: fc.integer({ min: 0, max: CLAIMS.length - 1 }),
  verdict: arbVerdict,
  withSource: fc.boolean(),
});

function recordOf(shape: PromiseShape): PromiseRecord {
  const claim = CLAIMS[shape.index] ?? CLAIMS[0] ?? '';
  const source: VerdictSource = {
    runId: `run_prior_${shape.index}`,
    terminalEventType: 'testrun_done',
    at: '2026-08-01T00:00:00.000Z',
    memberStatus: 'passed',
    resultCode: 0,
    reasonCode: null,
  };
  return createPromiseRecord({
    claim,
    citation: { file: 'apps/fixture/README.md', line: shape.index + 3, text: claim },
    designedTest: { path: 'tests/cart_test.md', testId: `T-${shape.index}` },
    verdict: shape.verdict,
    verdictSource: shape.withSource ? source : null,
    providers: ['baseline'],
  });
}

/**
 * A prior state: a graph of distinct promises, and freshness that is either
 * wholly absent or wholly present with the type its family's contract fixes —
 * the all-three-or-none rule the snapshot schema enforces (§9.1 rule 5).
 * 2.11: `arbKeptState`.
 */
const arbPriorState: fc.Arbitrary<KeptState> = fc
  .record({
    shapes: fc.uniqueArray(arbPromiseShape, {
      selector: (shape) => shape.index,
      maxLength: 6,
    }),
    freshFamily: fc.option(arbFamily, { nil: null }),
    freshAt: arbIsoInstant,
    updatedAt: arbIsoInstant,
    degraded: fc.boolean(),
  })
  .map(({ shapes, freshFamily, freshAt, updatedAt, degraded }) => {
    const freshness: StateFreshness =
      freshFamily === null
        ? { terminalEventAt: null, terminalEventType: null, commandFamily: null }
        : {
            terminalEventAt: freshAt,
            terminalEventType: contractFor(freshFamily).terminalType,
            commandFamily: freshFamily,
          };
    return createKeptState({
      updatedAt,
      freshness,
      graph: createPromiseGraph({
        promises: shapes.map(recordOf),
        degraded,
        degradedReasons: degraded ? ['enrichment-crashed'] : [],
      }),
    });
  });

/**
 * Writes aimed at a state: mostly at promises that exist, sometimes at an id the
 * graph has never heard of, because a write for an unknown promise must be
 * declined rather than invented. 2.11: `arbVerdictWrite`.
 */
function arbWrites(state: KeptState): fc.Arbitrary<readonly VerdictWrite[]> {
  const ids = state.graph.promises.map((entry) => entry.id);
  const arbId =
    ids.length === 0
      ? fc.constant('p_000000000000')
      : fc.oneof(
          { weight: 5, arbitrary: fc.constantFrom(...ids) },
          { weight: 1, arbitrary: fc.constant('p_000000000000') },
        );
  return fc.array(
    fc.record({
      promiseId: arbId,
      verdict: arbVerdict,
      memberStatus: arbMemberStatus,
      resultCode: fc.option(fc.integer({ min: 0, max: 999 }), { nil: null }),
      reasonCode: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
    }),
    { maxLength: 6 },
  );
}

/** A prior state together with writes aimed at the promises it actually holds. */
const arbStateAndWrites: fc.Arbitrary<{
  readonly prior: KeptState;
  readonly writes: readonly VerdictWrite[];
}> = arbPriorState.chain((prior) =>
  arbWrites(prior).map((writes) => ({ prior, writes })),
);

/** The verdict-and-freshness projection Property 9 quantifies over. */
function projection(state: KeptState): string {
  return JSON.stringify({
    freshness: state.freshness,
    verdicts: state.graph.promises.map((entry) => ({
      id: entry.id,
      verdict: entry.verdict,
      verdictSource: entry.verdictSource,
    })),
  });
}

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

describe('Feature: kept, Property 9 (state clause): Verdicts and freshness move only on a proven outcome', () => {
  it('leaves verdicts and freshness identical unless the stream completed and the exit proved an outcome', () => {
    fc.assert(
      fc.property(
        arbStateAndWrites,
        arbOutcomeShape,
        arbIsoInstant,
        ({ prior, writes }, shape, at) => {
          const outcome = outcomeOf(shape);
          const before = projection(prior);
          const sink = createDiagnosticSink();
          const result = applyRun(prior, { outcome, writes, at, sink });

          const proven = shape.complete && WRITE_PERMITTING_EXIT_MEANINGS.has(shape.meaning);
          expect(result.wrote).toBe(proven);
          expect(mayWriteVerdicts(outcome)).toBe(proven);

          if (!proven) {
            // The whole property, in three lines: the prior state itself came
            // back, its verdict-and-freshness projection is untouched, and
            // nothing was recorded as updated.
            expect(result.state).toBe(prior);
            expect(projection(result.state)).toBe(before);
            expect(result.updatedPromiseIds).toEqual([]);
            expect(result.refusals.length).toBeGreaterThan(0);
            expect(result.refusals).toEqual(writeRefusals(outcome));
            // Refusals are recorded, never thrown, and never folded into the
            // state — appending to the state would mean it had changed.
            expect(sink.size).toBeGreaterThan(0);
            return;
          }

          // The converse, so the property cannot be satisfied by a store that
          // simply never writes: on a proven outcome freshness moves to this
          // run's terminal event, all three fields together.
          expect(result.refusals).toEqual([]);
          expect(result.state.freshness).toEqual({
            terminalEventAt: at,
            terminalEventType: contractFor(shape.family).terminalType,
            commandFamily: shape.family,
          });

          const touched = new Set(result.updatedPromiseIds);
          for (const [index, entry] of result.state.graph.promises.entries()) {
            const priorEntry = prior.graph.promises[index];
            expect(entry.id).toBe(priorEntry?.id);
            if (touched.has(entry.id)) {
              expect(entry.verdictSource?.runId).toBe(outcome.runId);
              expect(entry.verdictSource?.at).toBe(at);
              expect(entry.verdictSource?.terminalEventType).toBe(
                contractFor(shape.family).terminalType,
              );
            } else {
              // Untouched: the prior record itself, not a copy of it.
              expect(entry).toBe(priorEntry);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('states the guard exhaustively over every exit meaning and both stream arms', () => {
    // The writable set is asserted by name and by size, so a ninth ExitMeaning
    // member cannot join it silently.
    expect([...WRITE_PERMITTING_EXIT_MEANINGS].sort()).toEqual(['failure', 'success']);
    expect(WRITE_PERMITTING_EXIT_MEANINGS.size).toBe(2);
    expect(EXIT_MEANINGS).toHaveLength(8);

    const table: { cell: string; writable: boolean }[] = [];
    for (const family of COMMAND_FAMILIES) {
      for (const meaning of EXIT_MEANINGS) {
        for (const complete of [true, false]) {
          const outcome = outcomeOf({ family, complete, meaning, noise: [] });
          const writable = mayWriteVerdicts(outcome);
          const cell = `${meaning}/${complete ? 'complete' : 'crashed'}`;
          expect(writable, `${family} ${cell}`).toBe(
            complete && permitsVerdictWrite(meaning),
          );
          if (family === COMMAND_FAMILIES[0]) table.push({ cell, writable });
        }
      }
    }

    // Sixteen cells, exactly two writable. Both numbers move if a meaning is
    // added, which is what makes the writable side tamper-evident.
    expect(table).toHaveLength(EXIT_MEANINGS.length * 2);
    expect(table.filter((entry) => entry.writable).map((entry) => entry.cell)).toEqual([
      'success/complete',
      'failure/complete',
    ]);
  });

  it('refuses every hazard the requirements name, for every family', () => {
    fc.assert(
      fc.property(
        arbPriorState,
        arbFamily,
        fc.boolean(),
        arbIsoInstant,
        (prior, family, complete, at) => {
          const noise = [...plausibleLinesFor(family)];
          const hazards: readonly (readonly [string, ExitMeaning])[] = [
            // An Assurance pause is exit 3 read against the Assurance contract:
            // resumable, and the single most damaging thing to misread (R11.10).
            ['assurance pause', exitMeaning('Assurance', 3, false)],
            // Our own 300 s hook budget elapsed (R11.8).
            ['timeout kill', exitMeaning(family, 0, true)],
            // testrun_plan.valid false: nothing ran at all (R4.11).
            ['preflight rejection', exitMeaning('ExecutionTestrun', 2, false)],
            // Binary absent; no process, no outcome (R2.12).
            ['missing binary', exitMeaning(family, 127, false)],
            // Signalled death, and 130 (R11.11).
            ['force interrupt', exitMeaning(family, null, false)],
            ['ctrl-c', exitMeaning(family, 130, false)],
          ];

          const before = projection(prior);
          for (const [label, meaning] of hazards) {
            const outcome = outcomeOf({ family, complete, meaning, noise });
            expect(mayWriteVerdicts(outcome), `${label} on ${family}`).toBe(false);
            const result = applyRun(prior, {
              outcome,
              writes: prior.graph.promises.map((entry) => ({
                promiseId: entry.id,
                verdict: 'red' as Verdict,
              })),
              at,
            });
            expect(result.state, `${label} on ${family}`).toBe(prior);
            expect(projection(result.state)).toBe(before);
            expect(result.wrote).toBe(false);
          }

          // And the crashed-stream hazard on its own: a stream carrying passing
          // members, a green summary and another family's terminal event, paired
          // with a clean success exit, still proves nothing.
          const crashed = outcomeOf({ family, complete: false, meaning: 'success', noise });
          expect(crashed.stream.kind).toBe('crashed');
          expect(mayWriteVerdicts(crashed)).toBe(false);
          expect(applyRun(prior, { outcome: crashed, at }).state).toBe(prior);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('deep-freezes what it returns, so a downstream mutation is an error', () => {
    fc.assert(
      fc.property(arbPriorState, arbOutcomeShape, arbIsoInstant, (prior, shape, at) => {
        fc.pre(prior.graph.promises.length > 0);
        const result = applyRun(prior, { outcome: outcomeOf(shape), at });
        const record = result.state.graph.promises[0];
        expect(record).toBeDefined();
        expect(Object.isFrozen(result.state)).toBe(true);
        expect(Object.isFrozen(result.state.graph)).toBe(true);
        expect(Object.isFrozen(result.state.graph.promises)).toBe(true);
        expect(Object.isFrozen(record)).toBe(true);
        expect(Object.isFrozen(record?.citation)).toBe(true);
        expect(() => {
          (record as unknown as { verdict: Verdict }).verdict = 'proven';
        }).toThrow(TypeError);
        expect(() => {
          (record as unknown as { citation: { line: number } }).citation.line = 999;
        }).toThrow(TypeError);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
