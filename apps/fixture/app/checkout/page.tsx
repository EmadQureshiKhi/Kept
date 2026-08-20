'use client';

/**
 * Checkout — three fields, client-side validation, order written to
 * `localStorage`. No request leaves the page.
 *
 * Validation runs before anything else, including the cart check, so the screen's
 * promise ("refuses to submit while the email field is empty and names the
 * offending field") holds whatever else is true. A refusal produces three
 * observable things: a `role="alert"` summary naming each offending field, an
 * `aria-invalid` field with its own message, and focus moved to that field.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { itemCount, subtotal } from '../../lib/cart';
import { Price } from '../components/price';
import { useStore } from '../providers';

const FIELD_LABELS = {
  name: 'Full name',
  email: 'Email',
  address: 'Delivery address',
} as const;

type FieldName = keyof typeof FIELD_LABELS;

type Errors = Partial<Record<FieldName, string>>;

interface Values {
  name: string;
  email: string;
  address: string;
}

/** Pure, so the refusal rule is readable in one place. */
function validate(values: Values): Errors {
  const errors: Errors = {};
  if (values.name.trim() === '') errors.name = 'Full name is required.';
  if (values.email.trim() === '') {
    errors.email = 'Email is required.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = 'Email must look like name@example.com.';
  }
  if (values.address.trim() === '') errors.address = 'Delivery address is required.';
  return errors;
}

export default function CheckoutPage() {
  const router = useRouter();
  const { cart, hydrated, placeOrder } = useStore();
  const [values, setValues] = useState<Values>({ name: '', email: '', address: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const fields = useRef<Partial<Record<FieldName, HTMLElement | null>>>({});

  const update = (field: FieldName) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const invalidFields = (Object.keys(FIELD_LABELS) as FieldName[]).filter(
    (field) => errors[field] !== undefined,
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Never let the browser navigate: this app has no endpoint to post to.
    event.preventDefault();
    setSubmitted(true);

    const found = validate(values);
    setErrors(found);

    const firstInvalid = (Object.keys(FIELD_LABELS) as FieldName[]).find(
      (field) => found[field] !== undefined,
    );
    if (firstInvalid) {
      fields.current[firstInvalid]?.focus();
      return;
    }

    if (cart.length === 0) return;

    const placed = placeOrder({
      name: values.name.trim(),
      email: values.email.trim(),
      address: values.address.trim(),
    });
    if (placed) router.push('/orders');
  }

  return (
    <section aria-labelledby="checkout-heading">
      <h1 id="checkout-heading">Checkout</h1>
      <p className="lede">
        We keep this order in your browser. Nothing is sent anywhere.
      </p>

      <form className="form" onSubmit={handleSubmit} noValidate data-testid="checkout-form">
        {submitted && invalidFields.length > 0 ? (
          <div className="form-error" role="alert" data-testid="checkout-error-summary">
            <strong>We could not place your order.</strong>
            <ul>
              {invalidFields.map((field) => (
                <li key={field}>
                  {FIELD_LABELS[field]}: {errors[field]}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="name">{FIELD_LABELS.name}</label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            value={values.name}
            ref={(node) => {
              fields.current.name = node;
            }}
            aria-invalid={errors.name === undefined ? undefined : true}
            aria-describedby={errors.name === undefined ? undefined : 'name-error'}
            onChange={(event) => update('name')(event.target.value)}
          />
          {errors.name === undefined ? null : (
            <p className="field-error" id="name-error" data-testid="checkout-error-name">
              {errors.name}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="email">{FIELD_LABELS.email}</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={values.email}
            ref={(node) => {
              fields.current.email = node;
            }}
            aria-invalid={errors.email === undefined ? undefined : true}
            aria-describedby={errors.email === undefined ? undefined : 'email-error'}
            onChange={(event) => update('email')(event.target.value)}
          />
          {errors.email === undefined ? null : (
            <p className="field-error" id="email-error" data-testid="checkout-error-email">
              {errors.email}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="address">{FIELD_LABELS.address}</label>
          <textarea
            id="address"
            name="address"
            rows={3}
            autoComplete="street-address"
            value={values.address}
            ref={(node) => {
              fields.current.address = node;
            }}
            aria-invalid={errors.address === undefined ? undefined : true}
            aria-describedby={errors.address === undefined ? undefined : 'address-error'}
            onChange={(event) => update('address')(event.target.value)}
          />
          {errors.address === undefined ? null : (
            <p
              className="field-error"
              id="address-error"
              data-testid="checkout-error-address"
            >
              {errors.address}
            </p>
          )}
        </div>

        <div className="panel" aria-label="Order summary">
          <h2>Order summary</h2>
          {!hydrated ? (
            <p className="loading" role="status" aria-busy="true">
              Loading your cart&hellip;
            </p>
          ) : cart.length === 0 ? (
            <p className="empty" data-testid="checkout-empty-cart">
              Your cart is empty, so there is nothing to place.{' '}
              <Link href="/shop">Pick a coffee</Link>.
            </p>
          ) : (
            <p data-testid="checkout-summary">
              {itemCount(cart)} {itemCount(cart) === 1 ? 'bag' : 'bags'} &middot;{' '}
              <Price usd={subtotal(cart)} testId="checkout-total" label="Order total" />
            </p>
          )}
        </div>

        <button type="submit" className="button" data-testid="checkout-submit">
          Place order
        </button>
      </form>
    </section>
  );
}
