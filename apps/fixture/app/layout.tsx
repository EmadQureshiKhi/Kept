import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { SiteHeader } from './components/site-header';
import { StoreProvider } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kepler Coffee',
  description:
    'A small coffee subscription shop. Six coffees, no accounts, no server — everything lives in your browser.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StoreProvider>
          <SiteHeader />
          <main id="main">{children}</main>
          <footer className="site-footer">
            <p>
              Kepler Coffee — roasted in small batches. This shop keeps your cart and
              orders in your own browser.
            </p>
          </footer>
        </StoreProvider>
      </body>
    </html>
  );
}
