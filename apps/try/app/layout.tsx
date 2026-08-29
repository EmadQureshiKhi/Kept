/**
 * The root layout for the `try` application.
 *
 * Deliberately thinner than the Ledger's. That app has five routes, a sticky masthead with a
 * current-route highlight, a drawn grid and a colophon; this has one route and one job, so it has
 * a masthead that is a wordmark and a link home, and nothing else.
 *
 * ## Why this is a separate application at all
 *
 * `apps/ledger` states, in its own README and enforced by `scripts/check-readonly.mjs` over eleven
 * rules, that the deployed artefact holds no non-GET handler, no server action and no auth. That
 * statement is a promise in KEPT's own graph, cited to a line, bound to a designed test, and
 * currently proven. Adding a `POST` route to that application would break it, and the red would be
 * KEPT reporting on itself correctly.
 *
 * So the thing that needs a handler lives here instead: its own directory, its own Next build, its
 * own Vercel project. The Ledger keeps its guarantee byte for byte, and this page is free to have
 * a form. Two deployments is the cost of not weakening a claim to fit a feature.
 *
 * ## The stylesheet is a deliberate copy, and the Ledger is the source of truth
 *
 * `styles/try.css` restates the tokens rather than importing `apps/ledger/styles/tokens.css`. A
 * relative import across two Next applications resolves for a bundler but not reliably for both
 * type checkers and both dev servers, and a shared package for eleven custom properties would be a
 * package to version. The copy is small, it is annotated with where it came from, and the values
 * are the palette of design §10.4 unchanged. If the two ever disagree, the Ledger is right.
 */

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { FOOTER_NOTE, TAGLINE, TITLE } from '../lib/copy.js';

import '../styles/try.css';

/** Where the wordmark points: the ledger, which is what this page is a front door to. */
export const LEDGER_HREF = 'https://withkept.app';

export const metadata: Metadata = {
  title: {
    default: TITLE,
    template: `${TITLE} · %s`,
  },
  description: TAGLINE,
};

export default function TryLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* First focusable element in the document, as on the Ledger. `main` takes `tabIndex={-1}`
            so following it moves focus rather than only scrolling: several browsers will not focus
            a non-interactive target otherwise, and a skip link that does not move focus is
            decoration. */}
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <div className="try-shell">
          <header className="try-masthead">
            <a className="try-masthead__home" href={LEDGER_HREF}>
              KEPT
            </a>
            <span className="try-masthead__where">try</span>
            <a className="try-masthead__back" href={LEDGER_HREF}>
              the ledger
            </a>
          </header>
          <main className="try-main" id="main" tabIndex={-1}>
            {children}
          </main>
          <footer className="try-footer">
            <p className="try-footer__note">{FOOTER_NOTE}</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
