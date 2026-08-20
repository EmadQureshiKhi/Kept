import { describe, expect, it } from 'vitest';

import {
  addItem,
  itemCount,
  lineTotal,
  MAX_QUANTITY,
  removeItem,
  setQuantity,
  subtotal,
  type CartLine,
} from '../lib/cart';

const ORION = { slug: 'orion-house-blend', name: 'Orion House Blend', price: 18.0 };
const KEPLER = { slug: 'kepler-reserve', name: 'Kepler Reserve', price: 24.0 };
const MERIDIAN = { slug: 'meridian-espresso', name: 'Meridian Espresso', price: 16.75 };

const line = (
  product: { slug: string; name: string; price: number },
  qty: number,
): CartLine => ({ ...product, qty });

describe('addItem', () => {
  it('appends a new line with the requested quantity', () => {
    expect(addItem([], ORION, 2)).toEqual([line(ORION, 2)]);
  });

  it('defaults to one bag', () => {
    expect(addItem([], ORION)).toEqual([line(ORION, 1)]);
  });

  it('merges into the existing line instead of duplicating the slug', () => {
    const items = addItem(addItem([], ORION, 2), ORION, 3);
    expect(items).toHaveLength(1);
    expect(items[0]?.qty).toBe(5);
  });

  it('preserves line order when merging', () => {
    const items = addItem(addItem(addItem([], ORION), KEPLER), ORION, 4);
    expect(items.map((item) => item.slug)).toEqual([ORION.slug, KEPLER.slug]);
    expect(items[0]?.qty).toBe(5);
  });

  it('ignores a non-positive quantity and does not mutate the input', () => {
    const items = [line(ORION, 1)];
    expect(addItem(items, KEPLER, 0)).toEqual(items);
    expect(items).toHaveLength(1);
  });

  it('clamps to the maximum quantity', () => {
    expect(addItem([], ORION, 500)[0]?.qty).toBe(MAX_QUANTITY);
  });
});

describe('setQuantity', () => {
  it('replaces the quantity of the named line only', () => {
    const items = setQuantity([line(ORION, 1), line(KEPLER, 1)], KEPLER.slug, 4);
    expect(items).toEqual([line(ORION, 1), line(KEPLER, 4)]);
  });

  it('removes the line at zero', () => {
    expect(setQuantity([line(ORION, 3)], ORION.slug, 0)).toEqual([]);
  });

  it('removes the line for a negative quantity', () => {
    expect(setQuantity([line(ORION, 3)], ORION.slug, -2)).toEqual([]);
  });

  it('is a no-op for an unknown slug', () => {
    const items = [line(ORION, 2)];
    expect(setQuantity(items, 'not-a-coffee', 9)).toEqual(items);
  });

  it('truncates a fractional quantity', () => {
    expect(setQuantity([line(ORION, 1)], ORION.slug, 2.9)[0]?.qty).toBe(2);
  });
});

describe('removeItem', () => {
  it('drops the line whatever its quantity', () => {
    expect(removeItem([line(ORION, 7), line(KEPLER, 1)], ORION.slug)).toEqual([
      line(KEPLER, 1),
    ]);
  });
});

describe('subtotal', () => {
  it('is zero for an empty cart', () => {
    expect(subtotal([])).toBe(0);
  });

  it('is the unit price for a single bag', () => {
    expect(subtotal([line(ORION, 1)])).toBe(18.0);
  });

  it('multiplies price by quantity', () => {
    expect(subtotal([line(ORION, 3)])).toBe(54.0);
  });

  it('sums multiple line items', () => {
    expect(subtotal([line(ORION, 2), line(KEPLER, 1), line(MERIDIAN, 2)])).toBe(93.5);
  });

  it('follows a quantity change immediately', () => {
    let items = addItem([], ORION, 1);
    expect(subtotal(items)).toBe(18.0);
    items = setQuantity(items, ORION.slug, 2);
    expect(subtotal(items)).toBe(36.0);
    items = setQuantity(items, ORION.slug, 5);
    expect(subtotal(items)).toBe(90.0);
  });

  it('drops the removed line from the total', () => {
    const items = [line(ORION, 2), line(KEPLER, 2)];
    expect(subtotal(items)).toBe(84.0);
    expect(subtotal(removeItem(items, KEPLER.slug))).toBe(36.0);
  });

  it('equals the sum of the line totals', () => {
    const items = [line(ORION, 3), line(MERIDIAN, 4), line(KEPLER, 1)];
    const summed = items.reduce((total, item) => total + lineTotal(item), 0);
    expect(subtotal(items)).toBeCloseTo(summed, 10);
  });

  it('rounds binary floating-point drift back to whole cents', () => {
    // 19.99 * 3 is 59.970000000000006 in IEEE 754.
    expect(subtotal([{ slug: 'x', name: 'X', price: 19.99, qty: 3 }])).toBe(59.97);
  });

  it('applies no discount at any subtotal — including above 50 dollars', () => {
    // Guards the never-true README claim (design §12.7): the total is the plain
    // sum. If this ever fails, someone has added discount logic.
    expect(subtotal([line(KEPLER, 3)])).toBe(72.0);
    expect(subtotal([line(ORION, 4)])).toBe(72.0);
  });
});

describe('itemCount', () => {
  it('counts bags, not lines', () => {
    expect(itemCount([line(ORION, 2), line(KEPLER, 3)])).toBe(5);
  });

  it('is zero for an empty cart', () => {
    expect(itemCount([])).toBe(0);
  });
});
