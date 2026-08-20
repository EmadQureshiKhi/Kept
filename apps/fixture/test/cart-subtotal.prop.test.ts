import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { lineTotal, setQuantity, subtotal, type CartLine } from '../lib/cart';

const NUM_RUNS = 500;

/**
 * Slugs are drawn from the real catalogue so generated carts look like carts the
 * app can actually produce, and so `setQuantity`'s by-slug semantics are
 * exercised against unique keys.
 */
const SLUGS = [
  'orion-house-blend',
  'kepler-reserve',
  'halley-light-roast',
  'cassini-ethiopia',
  'meridian-espresso',
  'titan-decaf',
] as const;

/** Prices are whole cents, which is the only kind of price the catalogue has. */
const priceArb = fc.integer({ min: 100, max: 5000 }).map((cents) => cents / 100);

const cartArb: fc.Arbitrary<CartLine[]> = fc
  .uniqueArray(fc.constantFrom(...SLUGS), { minLength: 0, maxLength: SLUGS.length })
  .chain((slugs) =>
    fc.tuple(
      fc.constant(slugs),
      fc.array(fc.tuple(priceArb, fc.integer({ min: 1, max: 20 })), {
        minLength: slugs.length,
        maxLength: slugs.length,
      }),
    ),
  )
  .map(([slugs, pairs]) =>
    slugs.map((slug, index) => {
      const pair = pairs[index] ?? [18, 1];
      return { slug, name: slug, price: pair[0], qty: pair[1] };
    }),
  );

describe('Feature: kept fixture cart, Property F1: the subtotal is the sum of the line totals', () => {
  it('holds for any cart of catalogue-shaped lines', () => {
    fc.assert(
      fc.property(cartArb, (items) => {
        const summed = items.reduce((total, line) => total + lineTotal(line), 0);
        expect(subtotal(items)).toBeCloseTo(summed, 2);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Feature: kept fixture cart, Property F2: the subtotal does not depend on line order', () => {
  it('is unchanged by any permutation of the lines', () => {
    fc.assert(
      fc.property(cartArb, fc.integer({ min: 0, max: 1000 }), (items, rotation) => {
        const offset = items.length === 0 ? 0 : rotation % items.length;
        const rotated = [...items.slice(offset), ...items.slice(0, offset)];
        expect(subtotal(rotated)).toBeCloseTo(subtotal(items), 2);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Feature: kept fixture cart, Property F3: raising a quantity never lowers the subtotal', () => {
  it('is monotonic in every line quantity', () => {
    fc.assert(
      fc.property(
        cartArb.filter((items) => items.length > 0),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 1, max: 20 }),
        (items, index, increase) => {
          const target = items[index % items.length];
          if (!target) return;
          const raised = setQuantity(items, target.slug, target.qty + increase);
          expect(subtotal(raised)).toBeGreaterThanOrEqual(subtotal(items));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
