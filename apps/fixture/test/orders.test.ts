import { describe, expect, it } from 'vitest';

import type { CartLine } from '../lib/cart';
import { createOrder, newestFirst, nextOrderId, type Order } from '../lib/orders';

const LINES: CartLine[] = [
  { slug: 'orion-house-blend', name: 'Orion House Blend', price: 18.0, qty: 2 },
  { slug: 'kepler-reserve', name: 'Kepler Reserve', price: 24.0, qty: 1 },
];

const DETAILS = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  address: '12 Dover Street, London',
};

const PLACED_AT = '2025-04-01T09:30:00.000Z';

describe('nextOrderId', () => {
  it('starts at KC-1001 and counts up', () => {
    expect(nextOrderId([])).toBe('KC-1001');
    const one = createOrder([], LINES, DETAILS, PLACED_AT);
    expect(nextOrderId([one])).toBe('KC-1002');
  });
});

describe('createOrder', () => {
  it('captures the total at placement, with no discount applied', () => {
    const order = createOrder([], LINES, DETAILS, PLACED_AT);
    expect(order.total).toBe(60.0);
  });

  it('copies the lines so a later cart edit cannot change a placed order', () => {
    const lines = [...LINES];
    const order = createOrder([], lines, DETAILS, PLACED_AT);
    lines[0] = { ...LINES[0]!, qty: 99 };
    expect(order.lines[0]?.qty).toBe(2);
  });

  it('keeps the delivery details and the placement timestamp', () => {
    const order = createOrder([], LINES, DETAILS, PLACED_AT);
    expect(order.email).toBe('ada@example.com');
    expect(order.placedAt).toBe(PLACED_AT);
  });
});

describe('newestFirst', () => {
  it('reverses the stored order without mutating it', () => {
    const first = createOrder([], LINES, DETAILS, PLACED_AT);
    const second = createOrder([first], LINES, DETAILS, PLACED_AT);
    const stored: Order[] = [first, second];
    expect(newestFirst(stored).map((order) => order.id)).toEqual([second.id, first.id]);
    expect(stored.map((order) => order.id)).toEqual([first.id, second.id]);
  });
});
