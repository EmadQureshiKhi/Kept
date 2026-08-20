/**
 * Cart arithmetic for Kepler Coffee.
 *
 * Pure functions over a plain array of lines. No React, no storage, no clock —
 * so the arithmetic the whole demonstration turns on is unit-testable on its own
 * (`apps/fixture/test/cart.test.ts`).
 *
 * Amounts are USD, as stored in the catalogue. Presentation currency is applied
 * later by `lib/currency.ts#format`.
 */

import { roundMoney } from './currency';

export interface CartLine {
  readonly slug: string;
  readonly name: string;
  /** Unit price in USD. */
  readonly price: number;
  readonly qty: number;
}

/** The minimum a caller needs to put something in the cart. */
export interface CartAddition {
  readonly slug: string;
  readonly name: string;
  readonly price: number;
}

export const MAX_QUANTITY = 99;

function clampQuantity(qty: number): number {
  if (!Number.isFinite(qty)) return 0;
  return Math.min(MAX_QUANTITY, Math.max(0, Math.trunc(qty)));
}

/**
 * Adds `qty` of a product, merging into an existing line for the same slug
 * rather than appending a duplicate. Line order is preserved, so the cart never
 * reshuffles under a shopper's cursor. A non-positive `qty` is a no-op.
 */
export function addItem(
  items: readonly CartLine[],
  product: CartAddition,
  qty = 1,
): CartLine[] {
  const wanted = clampQuantity(qty);
  if (wanted === 0) return [...items];

  const existing = items.find((line) => line.slug === product.slug);
  if (existing) {
    return items.map((line) =>
      line.slug === product.slug
        ? { ...line, qty: clampQuantity(line.qty + wanted) }
        : line,
    );
  }

  return [
    ...items,
    { slug: product.slug, name: product.name, price: product.price, qty: wanted },
  ];
}

/**
 * Sets the quantity of one line. A quantity of 0 or less removes the line
 * entirely — that is how the Cart screen's "Remove" button is implemented, so
 * there is one code path for both.
 */
export function setQuantity(
  items: readonly CartLine[],
  slug: string,
  qty: number,
): CartLine[] {
  const wanted = clampQuantity(qty);
  if (wanted === 0) return items.filter((line) => line.slug !== slug);
  return items.map((line) => (line.slug === slug ? { ...line, qty: wanted } : line));
}

/** Removes a line regardless of its quantity. */
export function removeItem(items: readonly CartLine[], slug: string): CartLine[] {
  return setQuantity(items, slug, 0);
}

/** Unit price times quantity, for one line. */
export function lineTotal(line: CartLine): number {
  return roundMoney(line.price * line.qty);
}

/** How many individual bags are in the cart. */
export function itemCount(items: readonly CartLine[]): number {
  return items.reduce((count, line) => count + line.qty, 0);
}

/**
 * The running subtotal: every line's unit price multiplied by its quantity.
 *
 * The single `return` below is the one line the `code-break` demonstration
 * disables (design §12.7, task 6.2). It is deliberately a one-line body so the
 * break, and the agent's repair, are each a single-line diff:
 *
 *   return roundMoney(items[0]?.price ?? 0);   // ← the break: ignores quantity
 *
 * Do not inline `roundMoney` or split this expression across lines.
 */
export function subtotal(items: readonly CartLine[]): number {
  return roundMoney(items.reduce((total, line) => total + line.price * line.qty, 0));
}
