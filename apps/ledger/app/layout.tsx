/**
 * The Ledger's root layout — design §10.2, §10.4.3, §10.8, R10.1, R10.4, R10.7.
 *
 * Stylesheet order is load-bearing and is the reason all three imports sit here
 * rather than in the pages: `tokens.css` declares the custom properties,
 * `surfaces.css` composes the elevation ramp out of them, and `shell.css` paints
 * the page and parks the skip link. Reverse any pair and a later file resolves a
 * token that does not exist yet.
 *
 * The shell itself is at `--elev-0`, which is `none`: it authors no depth. The
 * three surface classes of `surfaces.css` are the only place depth is written
 * (§10.5), and the forbidden-palette scan holds that line.
 *
 * The skip link is the first focusable element in the document (§10.8, R10.7).
 * `<main>` carries `tabIndex={-1}` so following the link actually moves focus
 * rather than only scrolling — several browsers will not focus a non-interactive
 * target otherwise, and a skip link that does not move focus is decoration.
 *
 * Every page under this shell is statically rendered from the imported snapshot
 * (§10.1). There is no provider, no client boundary and no state here, so the
 * layout stays a server component and ships no JavaScript of its own.
 */

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '../styles/tokens.css';
import '../styles/surfaces.css';
import '../styles/shell.css';

export const metadata: Metadata = {
  title: 'KEPT — the promises this codebase makes, and whether they hold',
  description:
    'A living ledger of every promise the repository states, the designed test that proves it, ' +
    'and the verdict of the last verification run.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <div className="page-shell">
          <main className="page-main" id="main" tabIndex={-1}>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
