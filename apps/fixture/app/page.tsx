import Link from 'next/link';

import { featuredCoffees, ROAST_LABELS } from '../lib/catalog';
import { Price } from './components/price';

/**
 * Home — deliberately static. No data fetching, no awaited params, no dynamic
 * segment: everything below comes from a committed module, so this route is
 * prerendered at build time and painted on the first response (R12.8).
 */
export default function HomePage() {
  const featured = featuredCoffees();

  return (
    <>
      <section className="hero" aria-labelledby="hero-heading">
        <h1 id="hero-heading">Coffee worth the second cup.</h1>
        <p className="lede">
          Six coffees, roasted the week you order them, ground to your brewer or left
          whole. No accounts, no upsells, and no server keeping notes on you — your cart
          lives in your own browser.
        </p>
        <div className="hero-actions">
          <Link className="button" href="/shop" data-testid="home-primary-cta">
            Shop all six coffees
          </Link>
          <Link className="button secondary" href="/settings">
            Choose your currency
          </Link>
        </div>
      </section>

      <section aria-labelledby="featured-heading">
        <div className="section-head">
          <h2 id="featured-heading">This week&rsquo;s three</h2>
          <Link href="/shop">See the whole shelf</Link>
        </div>
        <ul className="card-grid" data-testid="featured-list">
          {featured.map((coffee) => (
            <li key={coffee.slug} className="coffee-card" data-testid="featured-card">
              <h3>
                <Link href={`/product/${coffee.slug}`}>{coffee.name}</Link>
              </h3>
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
    </>
  );
}
