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

/**
 * Where the lockup points: the Ledger, which is what this page is a front door to.
 *
 * An environment override with the production host as its fallback, the same shape and for the same
 * reason as the Ledger's own link back here. A preview of one side should be able to point at a
 * preview of the other, and the fallback is what keeps the link working with nothing configured.
 */
export const LEDGER_HREF = process.env.NEXT_PUBLIC_LEDGER_URL ?? 'https://withkept.vercel.app';

/**
 * The lockup's box, the same measured numbers the Ledger's masthead uses.
 *
 * `Assets/Kept logo.png` trims to its own ink at 849x400, an aspect of 2.1225, and the stylesheet
 * shows it 34px tall: 34 x 2.1225 is 72.2, so 72 by 34. Stated on the element so the row reserves
 * its space before the file lands and nothing shifts when it does.
 */
const LOGO_WIDTH = 72;
const LOGO_HEIGHT = 34;

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
            {/* No `aria-label` on the link: an accessible name there would override the image's
                `alt` and leave the artwork's own name unused. The alt *is* this link's name, which
                is the same decision the Ledger's masthead makes and for the same reason. */}
            <a className="try-masthead__home" href={LEDGER_HREF}>
              <img
                alt="KEPT"
                className="try-masthead__logo"
                decoding="async"
                fetchPriority="high"
                height={LOGO_HEIGHT}
                src="/brand/kept-wordmark.png"
                width={LOGO_WIDTH}
              />
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
