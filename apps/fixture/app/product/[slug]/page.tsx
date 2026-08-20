import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CATALOG, findCoffee, ROAST_LABELS } from '../../../lib/catalog';
import { Price } from '../../components/price';
import { AddToCart } from './add-to-cart';

interface ProductRouteProps {
  params: Promise<{ slug: string }>;
}

/** All six slugs are known at build time, so all six pages are prerendered. */
export function generateStaticParams() {
  return CATALOG.map((coffee) => ({ slug: coffee.slug }));
}

export async function generateMetadata({ params }: ProductRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const coffee = findCoffee(slug);
  return { title: coffee ? `${coffee.name} — Kepler Coffee` : 'Not found' };
}

export default async function ProductPage({ params }: ProductRouteProps) {
  const { slug } = await params;
  const coffee = findCoffee(slug);
  if (!coffee) notFound();

  return (
    <article className="product">
      <div>
        <p className="meta">
          <Link href="/shop">Back to the shelf</Link>
        </p>
        <h1>{coffee.name}</h1>
        <p className="meta" data-testid="product-roast">
          {ROAST_LABELS[coffee.roast]} roast &middot; {coffee.origin}
        </p>
        <p>{coffee.blurb}</p>
        <div className="notes">
          <h2>Tasting notes</h2>
          <p data-testid="product-notes">{coffee.notes}</p>
          <h2>What you get</h2>
          <p>
            One 340&nbsp;g bag, roasted to order and shipped within two days. Whole bean
            unless you tell us otherwise in the checkout notes.
          </p>
        </div>
      </div>

      <aside className="product-aside" aria-label={`Buy ${coffee.name}`}>
        <Price
          usd={coffee.price}
          testId="product-price"
          className="product-price"
          label={`Price of ${coffee.name}`}
        />
        <p className="meta">
          Priced per 340&nbsp;g bag, in the currency you chose in{' '}
          <Link href="/settings">Settings</Link>.
        </p>
        <AddToCart
          product={{ slug: coffee.slug, name: coffee.name, price: coffee.price }}
        />
      </aside>
    </article>
  );
}
