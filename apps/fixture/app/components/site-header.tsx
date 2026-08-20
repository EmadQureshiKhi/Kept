'use client';

/**
 * Persistent navigation. Real `<a>` elements via `next/link`, real accessible
 * names, one nav landmark — so every screen is reachable by name from any other.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { itemCount } from '../../lib/cart';
import { useStore } from '../providers';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/shop', label: 'Shop' },
  { href: '/cart', label: 'Cart' },
  { href: '/orders', label: 'Orders' },
  { href: '/settings', label: 'Settings' },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const { cart, hydrated } = useStore();
  const count = itemCount(cart);

  return (
    <header className="site-header">
      <Link className="brand" href="/">
        <span aria-hidden="true" className="brand-mark">
          ◗
        </span>
        Kepler Coffee
      </Link>
      <nav aria-label="Main">
        <ul>
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={pathname === link.href ? 'page' : undefined}
              >
                {link.label}
                {link.href === '/cart' && hydrated && count > 0 ? (
                  <span className="badge" data-testid="header-cart-count">
                    {count}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
