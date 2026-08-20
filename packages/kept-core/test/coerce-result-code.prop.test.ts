import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { RESULT_CODE_FIELD, resultCode } from '@kept/core';

/**
 * Feature: kept, Property 10: `result_code` coercion makes string and number
 * forms equivalent (design §Correctness Properties, R3.11, R3.12, R3.13, R6.8).
 *
 * *For any* integer value, an event carrying it as a number, as its decimal
 * string, or as that string with surrounding whitespace, yields the same coerced
 * result code, the same repair branch from either router implementation, and the
 * same recorded value in the snapshot; and a `result_code` that is absent or
 * non-numeric coerces to null rather than to zero or NaN.
 *
 * The router and snapshot clauses are not encodable yet — `kane/verdict.ts` and
 * the snapshot writer land in stages 6 and 11 — and both are re-stated there as
 * Property 17 (strategy isolation) and Property 18 ("*regardless of the
 * accompanying `result_code` value or its type*"). What is encodable now is the
 * clause both of those rest on: the three wire forms are **indistinguishable
 * after coercion**, so no downstream branch keyed on the coerced value can tell
 * them apart. Once the router exists, task 11.x extends this file rather than
 * restating the equivalence.
 *
 * **Validates: Requirements 3.11, 3.12, 3.13, 6.8**
 */

/** Design §Testing Strategy floor is 100 runs; stated explicitly so it cannot regress to a default. */
const NUM_RUNS = 500;

/**
 * Integers Kane could put in the field, biased towards the ones the router
 * ladder reads. 2.11 should absorb this as the numeric half of
 * `arbTerminalEvent(family)`'s `result_code` slot.
 */
const arbCode: fc.Arbitrary<number> = fc.oneof(
  { weight: 3, arbitrary: fc.integer() },
  // The observed and documented codes: smoke-run 100, confirmed product bug 740,
  // the 7xx assertion band, and 0 — which is what a naive `Number('')` invents.
  { weight: 2, arbitrary: fc.constantFrom(0, 100, 700, 740, 799, -1) },
  { weight: 1, arbitrary: fc.maxSafeInteger() },
);

/**
 * Whitespace padding, empty string included, so the unpadded string form is
 * covered by the same clause. `" 740"` is a named edge case of task 2.11, which
 * should absorb this generator.
 */
const arbPad: fc.Arbitrary<string> = fc.string({
  unit: fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'),
  maxLength: 3,
});

/**
 * Values that are not a number in any form Kane emits. The string filter is
 * written against `Number()` rather than against the accessor's own grammar, so
 * this generator cannot inherit a bug from the code under test: every string it
 * produces is one `Number()` itself reads as non-finite (or as the `0` that
 * makes `''` dangerous). 2.11 should absorb this as the unusable branch of the
 * shared field-value generators.
 */
const arbNonNumeric: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom<unknown>(
    null,
    undefined,
    true,
    false,
    '',
    '   ',
    'abc',
    '740abc',
    'NaN',
    'Infinity',
    '-Infinity',
    '0x2E4', // Number('0x2E4') is 740 — a hex literal must not read as the bug code.
    '0b1',
    '0o7',
    '1_000',
    '1e999', // Matches a decimal grammar but overflows to Infinity.
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ),
  fc.string().filter((raw) => {
    const trimmed = raw.trim();
    return trimmed === '' || !Number.isFinite(Number(trimmed));
  }),
  fc.array(fc.integer(), { maxLength: 2 }),
  fc.record({ value: fc.integer() }),
);

describe('Feature: kept, Property 10: `result_code` coercion makes string and number forms equivalent', () => {
  it('coerces the number, decimal-string and whitespace-padded forms to one value', () => {
    fc.assert(
      fc.property(arbCode, arbPad, arbPad, (code, left, right) => {
        const asNumber = resultCode({ [RESULT_CODE_FIELD]: code });
        const asString = resultCode({ [RESULT_CODE_FIELD]: String(code) });
        const asPadded = resultCode({ [RESULT_CODE_FIELD]: `${left}${String(code)}${right}` });

        expect(asNumber).toBe(code);
        expect(asString).toBe(code);
        expect(asPadded).toBe(code);
        // Stated as an equivalence too, because it is the equivalence — not the
        // individual readings — that every downstream comparison depends on.
        expect(asString).toBe(asNumber);
        expect(asPadded).toBe(asNumber);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('leaves no comparison able to tell the three forms apart', () => {
    fc.assert(
      fc.property(arbCode, arbCode, arbPad, (code, probe, pad) => {
        // A downstream rung of the router ladder is exactly this: one equality
        // against a coerced code. It must answer the same on all three forms,
        // for every probe — including the probe that matches and every one
        // that does not.
        const forms = [
          { [RESULT_CODE_FIELD]: code },
          { [RESULT_CODE_FIELD]: String(code) },
          { [RESULT_CODE_FIELD]: `${pad}${String(code)}${pad}` },
        ];
        const verdicts = forms.map((event) => resultCode(event) === probe);
        expect(verdicts).toEqual([code === probe, code === probe, code === probe]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('coerces an absent or non-numeric `result_code` to null, never to 0 or NaN', () => {
    fc.assert(
      fc.property(arbNonNumeric, (value) => {
        // Present-but-unusable, and absent in both its shapes.
        for (const source of [{ [RESULT_CODE_FIELD]: value }, {}, value]) {
          const coerced = resultCode(source);
          expect(coerced).toBeNull();
          expect(coerced).not.toBe(0);
          expect(Number.isNaN(coerced)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never throws, whatever the event turns out to be', () => {
    fc.assert(
      fc.property(fc.anything(), (source) => {
        const coerced = resultCode(source);
        expect(coerced === null || Number.isFinite(coerced)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
