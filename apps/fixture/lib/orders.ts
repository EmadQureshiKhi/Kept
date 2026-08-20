/**
 * Placed orders.
 *
 * An order is a frozen copy of the cart lines plus the delivery details, stored
 * under `kepler.orders`. Nothing recalculates a placed order's total later — the
 * total is captured at the moment of placing, which is why `/orders` still shows
 * the right numbers after a reload and after a catalogue price change.
 */

import { subtotal, type CartLine } from './cart';

export interface DeliveryDetails {
  readonly name: string;
  readonly email: string;
  readonly address: string;
}

export interface Order extends DeliveryDetails {
  readonly id: string;
  /** ISO 8601, captured in the submit handler — never during render. */
  readonly placedAt: string;
  readonly lines: readonly CartLine[];
  /** USD, captured at placement. */
  readonly total: number;
}

const FIRST_ORDER_NUMBER = 1001;

/** `KC-1001`, `KC-1002`, … — short enough to read aloud on camera. */
export function nextOrderId(existing: readonly Order[]): string {
  return `KC-${FIRST_ORDER_NUMBER + existing.length}`;
}

export function createOrder(
  existing: readonly Order[],
  lines: readonly CartLine[],
  details: DeliveryDetails,
  placedAt: string,
): Order {
  return {
    id: nextOrderId(existing),
    placedAt,
    name: details.name,
    email: details.email,
    address: details.address,
    lines: lines.map((line) => ({ ...line })),
    total: subtotal(lines),
  };
}

/** Newest first, which is the order `/orders` renders in. */
export function newestFirst(orders: readonly Order[]): readonly Order[] {
  return [...orders].reverse();
}
