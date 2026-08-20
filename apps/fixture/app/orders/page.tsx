'use client';

/**
 * Orders — every completed order, newest first, read from `localStorage`.
 *
 * Because the list *is* the stored value, a full page reload re-reads it and
 * renders the same orders. The loading region below matters: it keeps "No orders
 * yet" off the screen until the store has actually been read, so a reload never
 * flashes an empty history.
 */

import Link from 'next/link';

import { itemCount } from '../../lib/cart';
import { newestFirst } from '../../lib/orders';
import { Price } from '../components/price';
import { useStore } from '../providers';

function formatPlacedAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function OrdersPage() {
  const { orders, hydrated } = useStore();
  const listed = newestFirst(orders);

  return (
    <section aria-labelledby="orders-heading">
      <h1 id="orders-heading">Your orders</h1>

      {!hydrated ? (
        <p className="loading" role="status" aria-busy="true" data-testid="orders-loading">
          Loading your orders&hellip;
        </p>
      ) : listed.length === 0 ? (
        <div data-testid="orders-empty">
          <p className="empty">No orders yet.</p>
          <Link className="button" href="/shop">
            Start with a bag
          </Link>
        </div>
      ) : (
        <>
          <p className="meta" data-testid="orders-count">
            {listed.length} {listed.length === 1 ? 'order' : 'orders'}
          </p>
          <ul className="stack" data-testid="orders-list">
            {listed.map((order) => (
              <li
                key={order.id}
                className="panel"
                data-testid="order-card"
                data-order-id={order.id}
              >
                <h2>Order {order.id}</h2>
                <p className="meta" data-testid={`order-placed-${order.id}`}>
                  Placed {formatPlacedAt(order.placedAt)} &middot; {itemCount(order.lines)}{' '}
                  {itemCount(order.lines) === 1 ? 'bag' : 'bags'}
                </p>
                <ul className="meta">
                  {order.lines.map((line) => (
                    <li key={line.slug}>
                      {line.qty} &times; {line.name}
                    </li>
                  ))}
                </ul>
                <p>
                  <strong>Total </strong>
                  <Price
                    usd={order.total}
                    testId={`order-total-${order.id}`}
                    label={`Total for order ${order.id}`}
                  />
                </p>
                <p className="meta">
                  Shipping to {order.name}, {order.address}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
