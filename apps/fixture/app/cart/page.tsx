'use client';

/**
 * Cart — quantity steppers, a running subtotal, and one remove control per line.
 *
 * The subtotal is derived from state on every render (`subtotal(cart)`), never
 * cached, so a quantity change updates it in the same paint as the number in the
 * stepper. That immediacy is the promise the `code-break` demonstration breaks.
 *
 * Nothing here reduces the total. The total is the subtotal.
 */

import Link from 'next/link';

import { lineTotal, MAX_QUANTITY, subtotal } from '../../lib/cart';
import { Price } from '../components/price';
import { useStore } from '../providers';

export default function CartPage() {
  const { cart, hydrated, setLineQuantity, removeLine } = useStore();
  const amount = subtotal(cart);

  return (
    <section aria-labelledby="cart-heading">
      <h1 id="cart-heading">Your cart</h1>

      {!hydrated ? (
        <p className="loading" role="status" aria-busy="true" data-testid="cart-loading">
          Loading your cart&hellip;
        </p>
      ) : cart.length === 0 ? (
        <div data-testid="cart-empty">
          <p className="empty">Your cart is empty.</p>
          <Link className="button" href="/shop">
            Pick a coffee
          </Link>
        </div>
      ) : (
        <>
          <table data-testid="cart-table">
            <caption className="visually-hidden">
              Coffees in your cart, with quantity and line total
            </caption>
            <thead>
              <tr>
                <th scope="col">Coffee</th>
                <th scope="col" className="numeric">
                  Price
                </th>
                <th scope="col">Quantity</th>
                <th scope="col" className="numeric">
                  Line total
                </th>
                <th scope="col">
                  <span className="visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {cart.map((line) => (
                <tr key={line.slug} data-testid="cart-line" data-slug={line.slug}>
                  <th scope="row">
                    <Link href={`/product/${line.slug}`}>{line.name}</Link>
                  </th>
                  <td className="numeric">
                    <Price usd={line.price} label={`Unit price of ${line.name}`} />
                  </td>
                  <td>
                    <div
                      className="stepper"
                      role="group"
                      aria-label={`Quantity of ${line.name}`}
                    >
                      <button
                        type="button"
                        aria-label={`Decrease quantity of ${line.name}`}
                        data-testid={`cart-decrease-${line.slug}`}
                        disabled={line.qty <= 1}
                        onClick={() => setLineQuantity(line.slug, line.qty - 1)}
                      >
                        &minus;
                      </button>
                      <output
                        aria-label={`Quantity of ${line.name} in your cart`}
                        data-testid={`cart-quantity-${line.slug}`}
                      >
                        {line.qty}
                      </output>
                      <button
                        type="button"
                        aria-label={`Increase quantity of ${line.name}`}
                        data-testid={`cart-increase-${line.slug}`}
                        disabled={line.qty >= MAX_QUANTITY}
                        onClick={() => setLineQuantity(line.slug, line.qty + 1)}
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="numeric">
                    <Price
                      usd={lineTotal(line)}
                      testId={`cart-line-total-${line.slug}`}
                      label={`Line total for ${line.name}`}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      aria-label={`Remove ${line.name} from your cart`}
                      data-testid={`cart-remove-${line.slug}`}
                      onClick={() => removeLine(line.slug)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="totals">
            <dl>
              <dt>Subtotal</dt>
              <dd>
                <Price usd={amount} testId="cart-subtotal" label="Cart subtotal" />
              </dd>
              <dt>Shipping</dt>
              <dd data-testid="cart-shipping">Free</dd>
              <dt className="grand">Total</dt>
              <dd className="grand">
                <Price usd={amount} testId="cart-total" label="Cart total" />
              </dd>
            </dl>
            <Link className="button" href="/checkout" data-testid="cart-checkout">
              Checkout
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
