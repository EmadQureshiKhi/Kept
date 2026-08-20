/**
 * Property 24: Freshness rendering is monotone with a hard 24-hour threshold.
 *
 * *For any* ISO 8601 terminal-event timestamp and reference time, the freshness
 * string is non-empty and never reports an invalid date, becomes monotonically
 * older as the timestamp recedes, and is rendered in the amber verdict colour
 * exactly when the age exceeds 24 hours.
 *
 * **Validates: Requirements 9.6, 9.7**
 *
 * Three clauses, tested as three properties over one generator, because they fail
 * in different ways: a formatter can be total and still non-monotone (a bucket
 * ladder that skips), monotone and still dishonest at the boundary (a `>=`), and
 * correct at the boundary while rendering `NaN days ago` for input the schema
 * happens to allow.
 *
 * "Monotone" is asserted on what is *rendered* — the numeral and its unit — not on
 * an internal age. A formatter that computed a perfectly ordered `ageMs` and then
 * printed a non-monotone string would satisfy the weaker claim and still show a
 * reader a run getting newer as it ages. The rendered pair `(unitIndex, value)`
 * compares lexicographically, and `just now` is the bottom of that order.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  FRESHNESS_TOKENS,
  JUST_NOW,
  NEVER_VERIFIED,
  STALE_AFTER_MS,
  formatFreshness,
} from '../lib/relativeTime.js';
import type { FreshnessRendering } from '../lib/relativeTime.js';

/** Every property in this repository runs this many cases. */
const NUM_RUNS = 500;

/** The reference instant. Fixed, because `now` is an input and not a clock. */
const NOW_MS = Date.parse('2026-08-20T12:00:00.000Z');

/**
 * Ages spanning every rung of the ladder and both sides of the threshold.
 *
 * Weighted rather than uniform: a uniform draw over ten years would put almost
 * every case in the `days` bucket and would land on the 24-hour boundary never.
 */
const arbAgeMs: fc.Arbitrary<number> = fc.oneof(
  { weight: 2, arbitrary: fc.integer({ min: 0, max: 4_999 }) }, // `just now`
  { weight: 3, arbitrary: fc.integer({ min: 5_000, max: 59_999 }) }, // seconds
  { weight: 3, arbitrary: fc.integer({ min: 60_000, max: 3_599_999 }) }, // minutes
  { weight: 3, arbitrary: fc.integer({ min: 3_600_000, max: STALE_AFTER_MS - 1 }) }, // hours
  { weight: 3, arbitrary: fc.integer({ min: STALE_AFTER_MS + 1, max: 3_650 * 86_400_000 }) }, // days
  // The boundary itself and its immediate neighbourhood, drawn often enough that
  // an off-by-one in either direction cannot hide.
  {
    weight: 4,
    arbitrary: fc
      .integer({ min: -3, max: 3 })
      .map((offset) => STALE_AFTER_MS + offset),
  },
);

/** The ISO timestamp an age corresponds to, measured back from `NOW_MS`. */
function isoAtAge(ageMs: number): string {
  return new Date(NOW_MS - ageMs).toISOString();
}

function render(ageMs: number): FreshnessRendering {
  return formatFreshness(isoAtAge(ageMs), NOW_MS);
}

/**
 * The rendered age as an order key: `[unitIndex, value]`, with `just now` below
 * every numbered rung. Lexicographic comparison over this pair is exactly "reads
 * as older".
 */
function renderedOrder(rendering: FreshnessRendering): readonly [number, number] {
  return rendering.parts === null ? [-1, 0] : [rendering.parts.unitIndex, rendering.parts.value];
}

function comparedOrder(
  left: readonly [number, number],
  right: readonly [number, number],
): number {
  return left[0] === right[0] ? left[1] - right[1] : left[0] - right[0];
}

describe('Property 24: Freshness rendering is monotone with a hard 24-hour threshold', () => {
  it('renders a non-empty string that never reports an invalid date', () => {
    fc.assert(
      fc.property(arbAgeMs, (ageMs) => {
        const rendering = render(ageMs);
        expect(rendering.text.length).toBeGreaterThan(0);
        expect(rendering.text.trim()).toBe(rendering.text);
        expect(rendering.text).not.toMatch(/NaN|Invalid|undefined|null/);
        expect(rendering.ageMs).toBe(ageMs);
        expect(rendering.at).toBe(isoAtAge(ageMs));
        // A numbered rung always names its unit; `just now` never does.
        if (rendering.parts === null) expect(rendering.text).toBe(JUST_NOW);
        else expect(rendering.text).toContain(rendering.parts.unit);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reads monotonically older as the timestamp recedes', () => {
    fc.assert(
      fc.property(arbAgeMs, arbAgeMs, (first, second) => {
        const [younger, older] = first <= second ? [first, second] : [second, first];
        const orderOfYounger = renderedOrder(render(younger));
        const orderOfOlder = renderedOrder(render(older));
        expect(comparedOrder(orderOfYounger, orderOfOlder)).toBeLessThanOrEqual(0);
        // And the tone can only travel one way: current → stale, never back.
        if (render(younger).tone === 'stale') expect(render(older).tone).toBe('stale');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is amber exactly when the age exceeds 24 hours', () => {
    fc.assert(
      fc.property(arbAgeMs, (ageMs) => {
        const rendering = render(ageMs);
        const shouldBeAmber = ageMs > STALE_AFTER_MS;
        expect(rendering.tone).toBe(shouldBeAmber ? 'stale' : 'current');
        expect(rendering.token === FRESHNESS_TOKENS.stale).toBe(shouldBeAmber);
        expect(rendering.token === '--verdict-stale').toBe(shouldBeAmber);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never renders a measured age, or amber, for the null state', () => {
    fc.assert(
      fc.property(arbAgeMs, (ageMs) => {
        // `now` varies, the answer does not: no terminal event has been consumed,
        // so there is nothing to be old (§10.10).
        const rendering = formatFreshness(null, NOW_MS - ageMs);
        expect(rendering.text).toBe(NEVER_VERIFIED);
        expect(rendering.tone).toBe('unverified');
        expect(rendering.token).not.toBe(FRESHNESS_TOKENS.stale);
        expect(rendering.ageMs).toBeNull();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is total over any ISO 8601 instant, at any reference time', () => {
    // The generator here is the schema's own input space: real ISO 8601 strings,
    // in both directions relative to `now`, so clock skew is covered rather than
    // assumed away.
    //
    // `noInvalidDate` is required, not tidying. `fc.date()` will happily produce
    // `new Date(NaN)`, and an invalid Date has no ISO 8601 representation —
    // `toISOString()` throws `RangeError` before the formatter is ever called. That
    // input is outside this property's domain by its own wording ("for any ISO 8601
    // timestamp"), and the unreadable-string case is covered by name in
    // `relative-time.test.ts` instead.
    fc.assert(
      fc.property(
        fc.date({ min: new Date(0), max: new Date(4_000_000_000_000), noInvalidDate: true }),
        fc.date({ min: new Date(0), max: new Date(4_000_000_000_000), noInvalidDate: true }),
        (at, now) => {
          const rendering = formatFreshness(at.toISOString(), now);
          expect(rendering.text.length).toBeGreaterThan(0);
          expect(rendering.text).not.toMatch(/NaN|Invalid/);
          expect(rendering.ageMs).not.toBeNull();
          expect(rendering.ageMs ?? -1).toBeGreaterThanOrEqual(0);
          const amber = rendering.token === '--verdict-stale';
          expect(amber).toBe((rendering.ageMs ?? 0) > STALE_AFTER_MS);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
