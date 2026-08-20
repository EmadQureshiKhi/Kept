import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { CREDITS_FIELDS, credits } from '@kept/core';

/**
 * Feature: kept, Property 11: The credits accessor prefers `credits_consumed`
 * and accepts `credits` (design §Correctness Properties, R3.10, R14.7).
 *
 * *For any* event, the consumed-credits accessor returns the value of
 * `credits_consumed` when that field holds a finite number, returns the value of
 * `credits` when `credits_consumed` is absent and `credits` holds a finite
 * number, and returns null when neither field holds a finite number.
 *
 * R14.7 is what makes the fall-through worth a property rather than a pair of
 * examples: the submission evidence is "the measured credits of at least one
 * authored run, read from `credits_consumed` **or** from `credits`". Kane 0.8.4
 * emits the first name and skill v0.0.17 documents the second, so whichever one
 * a recorded run happens to carry has to produce the same measured number.
 *
 * **Validates: Requirements 3.10, 14.7**
 */

/** Design §Testing Strategy floor is 100 runs; stated explicitly so it cannot regress to a default. */
const NUM_RUNS = 500;

/**
 * One field's state on the wire, as an intent the property can predict from.
 *
 * `absent` means the key is not present at all — distinct from `unusable`,
 * because the accessor falls through on usability rather than on presence, and
 * distinct from a `0` reading, which is a real free replay (R4.6).
 *
 * 2.11 should absorb this trio as the credits slot of `arbTerminalEvent(family)`
 * — its named edge case "`credits_consumed` absent with `credits` present" is
 * one draw of `arbCreditsFields` below.
 */
type UsableState = { readonly kind: 'usable'; readonly wire: number | string; readonly value: number };

type FieldState =
  | { readonly kind: 'absent' }
  | UsableState
  | { readonly kind: 'unusable'; readonly wire: unknown };

/**
 * A finite credit reading in either wire type. Fractional values are the norm:
 * the recorded smoke run reports `10.351184999999997`, and `0` is a free replay
 * rather than a missing reading.
 */
const arbUsableCredits: fc.Arbitrary<UsableState> = fc
  .oneof(
    { weight: 3, arbitrary: fc.double({ noNaN: true, noDefaultInfinity: true }) },
    { weight: 1, arbitrary: fc.constantFrom(0, 1, 10.351184999999997) },
  )
  // Negative zero is normalised away: `String(-0)` is `'0'`, so the wire can only
  // ever carry `-0` as a number, and "minus zero credits" is not a fact Kane
  // reports. Keeping it would test `Object.is` rather than the accessor.
  .map((value) => (Object.is(value, -0) ? 0 : value))
  .chain((value) =>
    fc.constantFrom<UsableState>(
      { kind: 'usable', wire: value, value },
      { kind: 'usable', wire: String(value), value },
      { kind: 'usable', wire: `  ${String(value)}  `, value },
    ),
  );

/**
 * Present but unreadable — the shapes that must hand over to the sibling field
 * instead of answering null while a readable value sits next door.
 */
const arbUnusableCredits: fc.Arbitrary<FieldState> = fc
  .oneof(
    fc.constantFrom<unknown>(null, undefined, '', '   ', 'n/a', 'free', true, false, Number.NaN, [
      1,
    ]),
    fc.string().filter((raw) => {
      const trimmed = raw.trim();
      return trimmed === '' || !Number.isFinite(Number(trimmed));
    }),
  )
  .map((wire) => ({ kind: 'unusable', wire }) as FieldState);

const arbFieldState: fc.Arbitrary<FieldState> = fc.oneof(
  { weight: 2, arbitrary: arbUsableCredits },
  { weight: 1, arbitrary: arbUnusableCredits },
  { weight: 1, arbitrary: fc.constant<FieldState>({ kind: 'absent' }) },
);

/** An event carrying each credit field in an independently chosen state. */
const arbCreditsFields: fc.Arbitrary<readonly [FieldState, FieldState]> = fc.tuple(
  arbFieldState,
  arbFieldState,
);

function buildEvent(states: readonly [FieldState, FieldState]): Record<string, unknown> {
  const event: Record<string, unknown> = {};
  CREDITS_FIELDS.forEach((field, index) => {
    const state = states[index];
    if (state !== undefined && state.kind !== 'absent') event[field] = state.wire;
  });
  return event;
}

/** The first usable reading in preference order, or null. */
function expected(states: readonly [FieldState, FieldState]): number | null {
  for (const state of states) {
    if (state.kind === 'usable') return state.value;
  }
  return null;
}

describe('Feature: kept, Property 11: The credits accessor prefers `credits_consumed` and accepts `credits`', () => {
  it('reads credits_consumed first, credits next, and null only when neither is usable', () => {
    fc.assert(
      fc.property(arbCreditsFields, (states) => {
        expect(credits(buildEvent(states))).toBe(expected(states));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('prefers credits_consumed even when credits also holds a finite number', () => {
    fc.assert(
      fc.property(arbUsableCredits, arbUsableCredits, (preferred, sibling) => {
        const event = buildEvent([preferred, sibling]);
        expect(credits(event)).toBe(preferred.value);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('accepts credits whenever credits_consumed yields nothing', () => {
    fc.assert(
      fc.property(
        fc.oneof(arbUnusableCredits, fc.constant<FieldState>({ kind: 'absent' })),
        arbUsableCredits,
        (missing, fallback) => {
          expect(credits(buildEvent([missing, fallback]))).toBe(fallback.value);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('keeps an unreported reading distinguishable from a free replay', () => {
    fc.assert(
      fc.property(
        fc.oneof(arbUnusableCredits, fc.constant<FieldState>({ kind: 'absent' })),
        fc.oneof(arbUnusableCredits, fc.constant<FieldState>({ kind: 'absent' })),
        (first, second) => {
          const unreported = credits(buildEvent([first, second]));
          expect(unreported).toBeNull();
          expect(unreported).not.toBe(0);
          // And the free replay of R4.6 still reads as the number zero.
          expect(credits({ [CREDITS_FIELDS[0]]: 0 })).toBe(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('never throws, whatever the event turns out to be', () => {
    fc.assert(
      fc.property(fc.anything(), (source) => {
        const measured = credits(source);
        expect(measured === null || Number.isFinite(measured)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
