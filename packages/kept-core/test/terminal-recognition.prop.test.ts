import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  COMMAND_FAMILIES,
  NDJSON_CRASHED_DIAGNOSTIC_CODE,
  PROGRESS_KEY,
  contractFor,
  parseStream,
  type CommandFamily,
  type KaneEvent,
} from '@kept/core';

import {
  arbFamily,
  arbKaneEvent,
  arbMalformedLine,
  arbNoisyPrefix,
  arbStream,
  arbTerminalEvent,
  arbTruncatedStream,
} from './arbitraries.js';

/**
 * Feature: kept, Property 8: Terminal-event recognition is family-determined and
 * crash classification is exhaustive (design §Correctness Properties, §4.1,
 * §4.2, §4.3; R2.6, R2.7, R3.2, R3.6, R4.7, R5.2).
 *
 * *For any* command family and *for any* event stream, the parser expects
 * exactly the terminal type `run_end` for Execution_Run, `testrun_done` for
 * Execution_Testrun and `done` for Assurance; the parsed result is `complete` if
 * and only if at least one event of that type is present, and `crashed`
 * otherwise; and every `crashed` result reports the outcome as unknown, names the
 * family and the expected terminal type in a diagnostic, and exposes no terminal
 * event.
 *
 * This is the property that catches the failure this whole design is shaped
 * around. Kane 0.8.4 has **three** terminal events, and the two that are not
 * `run_end` are the two paths KEPT actually depends on: blast-radius
 * verification ends on `testrun_done` (R4.7) and the Ledger's own data source
 * ends on `done` (R2.6, R5.2). A parser built on `run_end` alone reports
 * *nothing, silently* on both — the stream simply never carries the event it is
 * waiting for, so there is no error to notice. Clause one below is the only test
 * shape that fails for that parser rather than passing vacuously.
 *
 * ## How the four clauses are encoded
 *
 * 1. **Expected type per family** — against an explicit literal table written
 *    out in this file, not read back from `contractFor`. Reading the contract to
 *    check the contract would pass for any table at all. The literal narrowing is
 *    also asserted at the type level, so `TerminalType<'Assurance'>` staying
 *    `'done'` is enforced by `tsc -b`.
 * 2. **Complete iff present** — over streams of arbitrary events mixed with
 *    arbitrary noise, and asserted **for all three families over the same
 *    stream**, which is what "family-determined" means: one byte sequence, three
 *    answers, each decided by the declared family alone. No eligibility model is
 *    needed for the *iff*, because neither a noise line nor a malformed line can
 *    ever contribute a JSON object, and no event line can ever be skipped as
 *    leading noise (every one starts with `{`, so the first of them opens the
 *    fence and is itself processed).
 * 3. **Crashed reports the outcome as unknown** — exactly one diagnostic under
 *    `ndjson-crashed-stream`, at `warn`, carrying no line number, naming both the
 *    family and the type that never arrived; and a complete stream carries none.
 * 4. **Exposes no terminal event** — both halves. At runtime the key is absent
 *    from the object, not present-and-undefined; at compile time reading it is an
 *    error, which is the half that actually protects the state writers of §4.7
 *    (R2.7, R4.10) and it is enforced by `tsc -b` rather than by this runner.
 *
 * The crash clause is quantified **exhaustively over every cut** of one concrete
 * stream rather than only over the cut that was drawn: `arbTruncatedStream`
 * carries `full`, so every prefix of a stream that *would* have been complete is
 * checked to be crashed, and the uncut stream is checked to be complete — which
 * is what makes the cuts, rather than an absent terminal event, the thing being
 * proven.
 *
 * ## The one caveat: `step` beats a terminal `type`
 *
 * Classification in `kane/ndjson.ts` tests the `step` own-key **first** (R3.8),
 * so an event carrying both `step` and a terminal `type` classifies as *progress*
 * and its stream reads crashed. That is deliberate — outcome-unknown is the safe
 * direction, and the alternative is reading a verdict off a progress line — but
 * it means a literal reading of "at least one event of that type is present"
 * would be false for such a stream. Rather than keep those events out of the
 * generators and leave the collision undocumented, this suite states the *iff*
 * with an explicit `step`-key carve-out, generates the colliding event on
 * purpose, and pins the precedence in its own clause. `arbTerminalEvent` never
 * emits `step` itself, so nothing else here is affected.
 *
 * **Validates: Requirements 2.6, 2.7, 3.2, 3.6, 4.7, 5.2**
 */

/** Design §Testing Strategy floor is 100 runs; stated so it cannot regress to a default. */
const NUM_RUNS = 500;

/** Own-key test, safe on any parsed value. */
function hasOwn(source: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

/**
 * The three-contract table, written out here as literals.
 *
 * Deliberately **not** derived from `contractFor`: this is the independent copy
 * that makes clause one a test rather than a tautology. Kane has exactly three
 * terminal contracts, so this table has exactly three rows.
 */
const EXPECTED_TERMINAL_TYPE: { readonly [F in CommandFamily]: string } = {
  ExecutionRun: 'run_end',
  ExecutionTestrun: 'testrun_done',
  Assurance: 'done',
};

/** One line of a generated stream, and whether it carries an event at all. */
type Slot =
  | { readonly kind: 'event'; readonly wire: Record<string, unknown>; readonly line: string }
  | { readonly kind: 'noise'; readonly line: string };

/** An event slot, labelled with the wire value the parser will see. */
function eventSlot(event: KaneEvent): Slot {
  const line = JSON.stringify(event);
  return { kind: 'event', wire: JSON.parse(line) as Record<string, unknown>, line };
}

/**
 * An event line. All three terminal shapes are weighted in heavily so that both
 * directions of the *iff* are dense — a generator that rarely produced the
 * expected terminal type would prove the crashed direction and nothing else.
 *
 * The last arm is the precedence collision, generated on purpose: a terminal
 * event with a `step` key bolted on. It classifies as progress, so it does *not*
 * complete a stream, and the carve-out in {@link carriesTerminal} is what says so.
 */
const arbEventSlot: fc.Arbitrary<Slot> = fc
  .oneof(
    { weight: 4, arbitrary: arbKaneEvent },
    { weight: 3, arbitrary: arbTerminalEvent('ExecutionRun').map((event): KaneEvent => event) },
    {
      weight: 3,
      arbitrary: arbTerminalEvent('ExecutionTestrun').map((event): KaneEvent => event),
    },
    { weight: 3, arbitrary: arbTerminalEvent('Assurance').map((event): KaneEvent => event) },
    {
      weight: 1,
      arbitrary: fc
        .tuple(
          arbFamily.chain((family) => arbTerminalEvent(family)),
          fc.oneof(fc.integer({ min: 1, max: 9 }), fc.constantFrom('1', 'step-2')),
        )
        .map(([terminal, step]): KaneEvent => ({ ...terminal, [PROGRESS_KEY]: step })),
    },
  )
  .map(eventSlot);

/** A line that carries no event: leading chatter, or an unreadable line. */
const arbNoiseSlot: fc.Arbitrary<Slot> = fc
  .oneof(
    { weight: 2, arbitrary: arbNoisyPrefix },
    { weight: 3, arbitrary: arbMalformedLine },
  )
  .map((line): Slot => ({ kind: 'noise', line }));

/**
 * A stream of arbitrary events and arbitrary noise, in arbitrary order.
 *
 * Order is arbitrary rather than structured because clause two is stated over
 * *any* event stream. The empty array is included: an empty stream is crashed,
 * never an empty success.
 */
const arbMixedSlots: fc.Arbitrary<readonly Slot[]> = fc.array(
  fc.oneof({ weight: 5, arbitrary: arbEventSlot }, { weight: 2, arbitrary: arbNoiseSlot }),
  { maxLength: 9 },
);

/**
 * Is an event of this terminal type present, in the sense classification uses?
 *
 * The `step` carve-out is the documented precedence of R3.8, not a workaround:
 * an object carrying the key is a progress line whatever its `type` says.
 */
function carriesTerminal(slots: readonly Slot[], terminalType: string): boolean {
  return slots.some(
    (slot) =>
      slot.kind === 'event' &&
      !hasOwn(slot.wire, PROGRESS_KEY) &&
      slot.wire['type'] === terminalType,
  );
}

function linesOf(slots: readonly Slot[]): readonly string[] {
  return slots.map((slot) => slot.line);
}

/** The three terminal type values, as strings. Read off the literal table. */
const ALL_TERMINAL_TYPES: readonly string[] = COMMAND_FAMILIES.map(
  (family) => EXPECTED_TERMINAL_TYPE[family],
);

/**
 * Would this line end *some* family's stream? Used to build a stream that is
 * inert for all three, so that one appended line is the only deciding factor.
 */
function carriesAnyTerminalType(line: string): boolean {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return false;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (hasOwn(record, PROGRESS_KEY)) return false;
  const type = record['type'];
  return typeof type === 'string' && ALL_TERMINAL_TYPES.includes(type);
}

describe('Feature: kept, Property 8: Terminal-event recognition is family-determined and crash classification is exhaustive', () => {
  it('generates both directions of the iff, for every family', () => {
    // An *iff* proven in one direction only is half a property, and the crashed
    // direction is the easy one to hit by accident — most arbitrary streams do
    // not end on a given family's terminal event. So both truth values are
    // asserted reachable per family before the clauses that depend on them, and
    // the colliding `step`-plus-terminal event is asserted reachable too.
    const samples = fc.sample(arbMixedSlots, 400);
    for (const family of COMMAND_FAMILIES) {
      const expected = EXPECTED_TERMINAL_TYPE[family];
      const outcomes = new Set(samples.map((slots) => carriesTerminal(slots, expected)));
      expect(outcomes.has(true), `never reached a complete ${family} stream`).toBe(true);
      expect(outcomes.has(false), `never reached a crashed ${family} stream`).toBe(true);
    }
    const collided = samples.some((slots) =>
      slots.some(
        (slot) =>
          slot.kind === 'event' &&
          hasOwn(slot.wire, PROGRESS_KEY) &&
          ALL_TERMINAL_TYPES.includes(String(slot.wire['type'])),
      ),
    );
    expect(collided, 'never generated a terminal event carrying a step key').toBe(true);
  });

  it('expects run_end, testrun_done and done, one per family (R3.2)', () => {
    // Not a property: three families, three rows, checked directly against the
    // literal table. The type-level half is the load-bearing one — the literal
    // annotations below fail `tsc -b` if `TerminalType<F>` ever widens.
    const run: 'run_end' = contractFor('ExecutionRun').terminalType;
    const testrun: 'testrun_done' = contractFor('ExecutionTestrun').terminalType;
    const assurance: 'done' = contractFor('Assurance').terminalType;
    expect([run, testrun, assurance]).toEqual([
      EXPECTED_TERMINAL_TYPE.ExecutionRun,
      EXPECTED_TERMINAL_TYPE.ExecutionTestrun,
      EXPECTED_TERMINAL_TYPE.Assurance,
    ]);
    // And the table is exhaustive over the vocabulary, so no fourth family can
    // be added without this suite noticing.
    expect(Object.keys(EXPECTED_TERMINAL_TYPE).sort()).toEqual([...COMMAND_FAMILIES].sort());
  });

  it('reports the expected terminal type from the family, never from the stream (R3.2)', () => {
    fc.assert(
      fc.property(arbFamily, arbMixedSlots, (family, slots) => {
        const parsed = parseStream(contractFor(family), linesOf(slots));
        expect(parsed.family).toBe(family);
        if (parsed.kind === 'crashed') {
          expect(parsed.expectedTerminal).toBe(EXPECTED_TERMINAL_TYPE[family]);
        } else {
          // The winning terminal event is of exactly the declared family's type,
          // whatever other terminal shapes the stream happened to carry.
          expect(parsed.terminal.type).toBe(EXPECTED_TERMINAL_TYPE[family]);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is complete if and only if an event of the family’s terminal type is present', () => {
    fc.assert(
      fc.property(arbMixedSlots, (slots) => {
        const lines = linesOf(slots);
        // One stream, three families, three independently determined answers.
        for (const family of COMMAND_FAMILIES) {
          const expected = EXPECTED_TERMINAL_TYPE[family];
          const present = carriesTerminal(slots, expected);
          const parsed = parseStream(contractFor(family), lines);
          expect(parsed.kind === 'complete').toBe(present);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reads the same stream as complete for one family and crashed for another', () => {
    // The sharp form of family-determination: a stream ending on exactly one
    // family's terminal event is crashed for the other two, and the parser never
    // infers its way out of that. This is the shape that a `run_end`-only parser
    // gets wrong in the silent direction — it answers "nothing happened" for a
    // testrun that ran and a `cover` that reported.
    fc.assert(
      fc.property(arbFamily, arbTruncatedStream('ExecutionRun'), (family, truncated) => {
        // The body of a truncated stream may itself carry another family's
        // terminal event — `arbNonTerminalEvent` only excludes its own — so those
        // lines are dropped here. What is left is inert for every family, which is
        // what makes the single appended line the only thing that decides.
        const inert = truncated.lines.filter((line) => !carriesAnyTerminalType(line));
        const lines = [
          ...inert,
          JSON.stringify({ type: EXPECTED_TERMINAL_TYPE[family], status: 'passed' }),
        ];

        expect(parseStream(contractFor(family), lines).kind).toBe('complete');
        for (const other of COMMAND_FAMILIES.filter((candidate) => candidate !== family)) {
          const parsed = parseStream(contractFor(other), lines);
          expect(parsed.kind).toBe('crashed');
          if (parsed.kind === 'crashed') {
            expect(parsed.expectedTerminal).toBe(EXPECTED_TERMINAL_TYPE[other]);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('names the family and the expected type in one outcome-unknown diagnostic (R3.6)', () => {
    fc.assert(
      fc.property(
        arbFamily.chain((family) =>
          arbTruncatedStream(family).map((stream) => ({ family, stream })),
        ),
        ({ family, stream }) => {
          const parsed = parseStream(contractFor(family), stream.lines);
          expect(parsed.kind).toBe('crashed');

          const crashes = parsed.diagnostics.filter(
            (entry) => entry.code === NDJSON_CRASHED_DIAGNOSTIC_CODE,
          );
          expect(crashes).toHaveLength(1);
          const crash = crashes[0];
          expect(crash).toBeDefined();
          if (crash === undefined) return;
          expect(crash.severity).toBe('warn');
          // The whole stream is what is unknown, so no single line owns it.
          expect(crash.line).toBeNull();
          expect(crash.message).toContain(family);
          expect(crash.message).toContain(EXPECTED_TERMINAL_TYPE[family]);
          expect(crash.message).toContain('outcome unknown');
          // Never a pass, never a failure (R2.7, R4.10): the message says so in
          // as many words, because the Ledger renders it to a reviewer.
          expect(crash.message).toContain('neither a pass nor a failure');
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('records no crash diagnostic when the stream did reach its terminal event', () => {
    fc.assert(
      fc.property(
        arbFamily.chain((family) => arbStream(family).map((stream) => ({ family, stream }))),
        ({ family, stream }) => {
          const parsed = parseStream(contractFor(family), stream.lines);
          expect(parsed.kind).toBe('complete');
          expect(
            parsed.diagnostics.filter((entry) => entry.code === NDJSON_CRASHED_DIAGNOSTIC_CODE),
          ).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('exposes no terminal event on a crashed result, at every cut of one stream', () => {
    fc.assert(
      fc.property(
        arbFamily.chain((family) =>
          arbTruncatedStream(family).map((stream) => ({ family, stream })),
        ),
        ({ family, stream }) => {
          const contract = contractFor(family);

          // Exhaustive over the cuts: every prefix of a stream that *would* have
          // been complete is crashed, so the missing line is what made the
          // difference rather than the stream never having had a verdict.
          for (let cut = 0; cut < stream.full.length; cut += 1) {
            const parsed = parseStream(contract, stream.full.slice(0, cut));
            expect(parsed.kind).toBe('crashed');
            // Absent, not present-and-undefined: `'terminal' in parsed` is the
            // runtime half of the type fence, and `Object.keys` is the half a
            // serialiser would see.
            expect(hasOwn(parsed, 'terminal')).toBe(false);
            expect(Object.keys(parsed)).not.toContain('terminal');
            if (parsed.kind === 'crashed') {
              expect(parsed.expectedTerminal).toBe(EXPECTED_TERMINAL_TYPE[family]);
            }
          }

          // And the uncut stream is complete, which is what makes the loop above
          // a statement about truncation rather than about this generator.
          expect(parseStream(contract, stream.full).kind).toBe('complete');
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('makes reading a terminal event off a crashed stream a compile error (§4.2)', () => {
    // The type half of clause four. An empty stream is the simplest crashed one,
    // and the assertion is not the expectation below — it is that `tsc -b` fails
    // if `terminal` ever appears on this arm, since an unused `@ts-expect-error`
    // is itself an error.
    const crashed = parseStream(contractFor('ExecutionTestrun'), []);
    expect(crashed.kind).toBe('crashed');
    if (crashed.kind !== 'crashed') return;
    // @ts-expect-error `terminal` exists only on the complete arm
    void crashed.terminal;
    const expected: 'testrun_done' = crashed.expectedTerminal;
    expect(expected).toBe('testrun_done');
  });

  it('classifies a terminal event carrying a step key as progress, so its stream is crashed', () => {
    // The documented precedence collision, pinned rather than avoided (R3.8).
    // `step` is genuinely first, and outcome-unknown is the safe direction: the
    // alternative is reading a verdict off a progress line. No observed terminal
    // event carries the key, and `arbTerminalEvent` never emits one.
    fc.assert(
      fc.property(
        arbFamily.chain((family) =>
          arbTerminalEvent(family).map((terminal) => ({ family, terminal })),
        ),
        ({ family, terminal }) => {
          const clean = JSON.stringify(terminal);
          const stepped = JSON.stringify({ ...terminal, [PROGRESS_KEY]: 3 });

          expect(parseStream(contractFor(family), [clean]).kind).toBe('complete');

          const parsed = parseStream(contractFor(family), [stepped]);
          expect(parsed.kind).toBe('crashed');
          expect(parsed.progress).toHaveLength(1);
          expect(parsed.events).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
