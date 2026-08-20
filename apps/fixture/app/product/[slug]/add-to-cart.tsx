'use client';

/**
 * Add-to-cart control. A real `<button type="button">` with a real accessible
 * name, and a `role="status"` confirmation so a browser-driven test can observe
 * the effect without reading the cart badge.
 */

import Link from 'next/link';
import { useState } from 'react';

import type { CartAddition } from '../../../lib/cart';
import { useStore } from '../../providers';

const QUANTITIES = [1, 2, 3, 4, 5] as const;

export function AddToCart({ product }: { product: CartAddition }) {
  const { addToCart } = useStore();
  const [qty, setQty] = useState(1);
  const [confirmation, setConfirmation] = useState('');

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="quantity">Quantity</label>
        <select
          id="quantity"
          name="quantity"
          value={qty}
          onChange={(event) => setQty(Number(event.target.value))}
          data-testid="product-quantity"
        >
          {QUANTITIES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        className="button"
        data-testid="add-to-cart"
        onClick={() => {
          addToCart(product, qty);
          setConfirmation(
            `Added ${qty} ${qty === 1 ? 'bag' : 'bags'} of ${product.name} to your cart.`,
          );
        }}
      >
        Add to cart
      </button>

      <p className="status" role="status" data-testid="add-to-cart-status">
        {confirmation}
      </p>

      {confirmation === '' ? null : <Link href="/cart">Go to your cart</Link>}
    </div>
  );
}
