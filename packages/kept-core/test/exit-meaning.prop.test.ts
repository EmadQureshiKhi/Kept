import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  COMMAND_FAMILIES,
  EXIT_MEANINGS,
  RESULT_CODE_FIELD,
  WRITE_PERMITTING_EXIT_MEANINGS,
  contractFor,
  exitMeaning,
  isExitMeaning,
  permitsVerdictWrite,
  resultCode,
  type CommandFamily,
  type ExitMeaning,
} from '@kept/core';

/**
 * Feature: kept, Property 12: Exit-code interpretation is total and
 * family-correct (design §Correctness Properties, §4.5, A14, R3.14, R3.15,
 * R4.11, R11.9, R11.10, R11.11).
 *
 * *For any* command family and *for any* process exit code including null, the
 * exit-meaning function returns exactly one defined meaning; exit code 3 with
 * the Assurance family always means paused and resumable and never means failure
 * or timeout; exit code 3 with either execution family always means timeout or
 * cancellation; exit code 130 always means force-interrupted; exit code 2 with
 * Execution_Testrun always means preflight rejection; and the process exit code
 * is never conflated with `result_code`.
 *
 * Every clause is encodable now, `exit.ts` being self-contained. Totality is the
 * load-bearing half: the function is the input to `mayWriteVerdicts()` (design
 * §4.8), so an input it answered `undefined` for would put an unclassified
 * outcome in front of the one guard that stops a run overwriting good verdicts.
 * The last clause is encoded as *independence* — `exitMeaning` is fed no event at
 * all, and a terminal event's `result_code` reads the same whatever the process
 * exit was — because R3.14's requirement is that the two values stay separate
 * all the way to the snapshot, and separateness is exactly the absence of any
 * function reading one from the other.
 *
 * **Validates: Requirements 3.14, 3.15, 4.11, 11.9, 11.10, 11.11**
 */

/** Design §Testing Strategy floor is 100 runs; stated explicitly so it cannot regress to a default. */
const NUM_RUNS = 500;

/** All three families, every run. 2.11 should absorb this as `arbFamily`. */
const arbFamily: fc.Arbitrary<CommandFamily> = fc.constantFrom(...COMMAND_FAMILIES);

/**
 * Every process exit code Node can report, and then some.
 *
 * `fc.integer()` alone spans the full signed 32-bit range including negatives,
 * which is what totality means here; the weighted constants keep the named rungs
 * of the table hit densely rather than by luck, and the POSIX 0–255 band is where
 * a real Kane exit actually lands. `null` is the signalled case — Node reports
 * `code: null, signal: <sig>` — and is in the same generator rather than a
 * separate one, so no clause below can accidentally be proven over integers only.
 * 2.11 should absorb this as `arbExitCode`.
 */
const arbExitCode: fc.Arbitrary<number | null> = fc.oneof(
  { weight: 3, arbitrary: fc.integer() },
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 255 }) },
  { weight: 3, arbitrary: fc.constantFrom(0, 1, 2, 3, 4, 126, 127, 130, 137, 143, 255, -1) },
  { weight: 2, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constantFrom(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) },
);

/** Whether *our* timeout killed it. 2.11 should absorb this alongside `arbExitCode`. */
const arbKilled: fc.Arbitrary<boolean> = fc.boolean();

/** Exit codes that are not `null` — for the clauses stated about integers. */
const arbIntegerExitCode: fc.Arbitrary<number> = arbExitCode.filter(
  (code): code is number => code !== null,
);

describe('Feature: kept, Property 12: Exit-code interpretation is total and family-correct', () => {
  it('returns exactly one defined meaning for every family, every code and null', () => {
    fc.assert(
      fc.property(arbFamily, arbExitCode, arbKilled, (family, code, killed) => {
        const meaning = exitMeaning(family, code, killed);

        // Defined, in the vocabulary, and exactly one member of it.
        expect(meaning).toBeDefined();
        expect(isExitMeaning(meaning)).toBe(true);
        expect(EXIT_MEANINGS.filter((candidate) => candidate === meaning)).toHaveLength(1);
        // Deterministic: the same inputs answer the same meaning.
        expect(exitMeaning(family, code, killed)).toBe(meaning);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('calls exit 3 with Assurance paused-and-resumable, never failure and never timeout', () => {
    // The single most damaging misreading available: a resumable pause read as a
    // failure would overwrite good verdicts, and the pause would be unrecoverable.
    fc.assert(
      fc.property(fc.constant(3), (code) => {
        const meaning = exitMeaning('Assurance', code, false);
        expect(meaning).toBe('paused-resumable');
        expect(meaning).not.toBe('failure');
        expect(meaning).not.toBe('timeout-or-cancelled');
        // And it is outside the writable set, which is the property that actually
        // protects the ledger (design §4.8, R11.10).
        expect(permitsVerdictWrite(meaning)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('calls exit 3 with either execution family timeout-or-cancelled', () => {
    fc.assert(
      fc.property(fc.constantFrom<CommandFamily>('ExecutionRun', 'ExecutionTestrun'), (family) => {
        const meaning = exitMeaning(family, 3, false);
        expect(meaning).toBe('timeout-or-cancelled');
        expect(meaning).not.toBe('paused-resumable');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('agrees with the family contract on exit 3, so the fact stays encoded once', () => {
    fc.assert(
      fc.property(arbFamily, (family) => {
        expect(exitMeaning(family, 3, false)).toBe(contractFor(family).exit3);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('calls exit 130 force-interrupted for every family (R11.11)', () => {
    fc.assert(
      fc.property(arbFamily, (family) => {
        expect(exitMeaning(family, 130, false)).toBe('force-interrupted');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('calls exit 2 with Execution_Testrun a preflight rejection, and nobody else’s (R4.11)', () => {
    fc.assert(
      fc.property(arbFamily, (family) => {
        const meaning = exitMeaning(family, 2, false);
        if (family === 'ExecutionTestrun') {
          expect(meaning).toBe('preflight-rejected');
          // A rejection is not a test failure: no member ran at all.
          expect(permitsVerdictWrite(meaning)).toBe(false);
        } else {
          expect(meaning).toBe('failure');
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never conflates the process exit code with `result_code` (R3.14)', () => {
    fc.assert(
      fc.property(
        arbFamily,
        arbIntegerExitCode,
        arbIntegerExitCode,
        fc.integer(),
        (family, code, otherCode, rc) => {
          // Independence, both directions. The exit meaning is the same whichever
          // `result_code` travelled with the run — including 740, the confirmed
          // product bug the whole repair ladder keys off — because `exitMeaning`
          // is handed no event and therefore cannot read one.
          const meaning: ExitMeaning = exitMeaning(family, code, false);
          for (const carried of [rc, 740, 100, -1]) {
            const event = { [RESULT_CODE_FIELD]: carried, exit_code: code };
            expect(resultCode(event)).toBe(carried);
            expect(exitMeaning(family, code, false)).toBe(meaning);
          }

          // And the coerced `result_code` is the same whichever code the process
          // exited with, including the event's own `exit_code` field — the
          // verified §5.3.1 refusal envelope carries both, and reading one from
          // the other is exactly the conflation R3.14 forbids.
          const first = { [RESULT_CODE_FIELD]: rc, exit_code: code };
          const second = { [RESULT_CODE_FIELD]: rc, exit_code: otherCode };
          expect(resultCode(first)).toBe(resultCode(second));

          // An event carrying only a process-style `exit_code` has no result code
          // at all: the exit code must never be read as one.
          expect(resultCode({ exit_code: code })).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('keeps everything except success and failure outside the writable set', () => {
    // Stated over the vocabulary as well as over inputs, so adding a member to
    // `ExitMeaning` cannot silently widen what may overwrite verdicts (§4.8).
    expect([...WRITE_PERMITTING_EXIT_MEANINGS].sort()).toEqual(['failure', 'success']);
    expect(WRITE_PERMITTING_EXIT_MEANINGS.size).toBe(2);

    fc.assert(
      fc.property(arbFamily, arbExitCode, arbKilled, (family, code, killed) => {
        const meaning = exitMeaning(family, code, killed);
        const writable = permitsVerdictWrite(meaning);
        expect(writable).toBe(meaning === 'success' || meaning === 'failure');
        // A pause, a preflight rejection, a timeout of either origin, a
        // force-interrupt and a missing binary must all be non-writable.
        if (killed || code === null || code === 3 || code === 127 || code === 130) {
          expect(writable).toBe(false);
        }
        if (code === 2 && family === 'ExecutionTestrun') expect(writable).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('calls only 0 a success, and calls a killed run no kind of success', () => {
    fc.assert(
      fc.property(arbFamily, arbExitCode, arbKilled, (family, code, killed) => {
        const meaning = exitMeaning(family, code, killed);
        expect(meaning === 'success').toBe(code === 0 && !killed);
        if (killed) expect(meaning).toBe('killed-by-timeout');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never throws, whatever the code turns out to be', () => {
    fc.assert(
      fc.property(
        arbFamily,
        fc.oneof(arbExitCode, fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, 2.5, -0)),
        arbKilled,
        (family, code, killed) => {
          expect(isExitMeaning(exitMeaning(family, code, killed))).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
