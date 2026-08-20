'use client';

/**
 * Shop — the whole shelf, exactly six coffees, filtered by roast in the browser.
 *
 * The filter is `useState` over a static array: clicking a roast re-renders this
 * component and navigates nowhere, so there is no reload and no request. The
 * catalogue does not come from storage, so nothing here waits on hydration.
 */

import Link from 'next/link';
import { useState } from 'react';

import { allCoffees, byRoast, ROAST_LABELS, ROASTS, type Roast } from '../../lib/catalog';
import { Price } from '../components/price';

export default function ShopPage() {
  const [roast, setRoast] = useState<Roast | null>(null);
  const total = allCoffees().length;
  const shown = byRoast(roast);

  return (
    <section aria-labelledby="shop-heading">
      <h1 id="shop-heading">The shelf</h1>
      <p className="lede">
        Six coffees, and only ever six. We drop one when we add one.
      </p>

      <div className="filters" role="group" aria-label="Filter by roast">
        <button
          type="button"
          className="chip"
          aria-pressed={roast === null}
          onClick={() => setRoast(null)}
          data-testid="roast-filter-all"
        >
          All roasts
        </button>
        {ROASTS.map((level) => (
          <button
            key={level}
            type="button"
            className="chip"
            aria-pressed={roast === level}
            onClick={() => setRoast(level)}
            data-testid={`roast-filter-${level}`}
          >
            {ROAST_LABELS[level]} roast
          </button>
        ))}
      </div>

      <p className="meta" data-testid="shop-count" role="status">
        Showing {shown.length} of {total} coffees
        {roast === null ? '' : ` · ${ROAST_LABELS[roast]} roast`}
      </p>

      <ul className="card-grid" data-testid="coffee-list">
        {shown.map((coffee) => (
          <li
            key={coffee.slug}
            className="coffee-card"
            data-testid="coffee-card"
            data-roast={coffee.roast}
            data-slug={coffee.slug}
          >
            <h2>
              <Link href={`/product/${coffee.slug}`}>{coffee.name}</Link>
            </h2>
            <p className="meta">
              {ROAST_LABELS[coffee.roast]} roast &middot; {coffee.origin}
            </p>
            <p className="meta">{coffee.notes}</p>
            <p className="price">
              <Price usd={coffee.price} label={`Price of ${coffee.name}`} />
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
