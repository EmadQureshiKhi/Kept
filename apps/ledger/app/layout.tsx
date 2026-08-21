/**
 * The Ledger's root layout — design §10.2, §10.4.3, §10.8, R10.1, R10.4, R10.7.
 *
 * Stylesheet order is load-bearing and is the reason all three imports sit here
 * rather than in the pages: `tokens.css` declares the custom properties,
 * `surfaces.css` composes the elevation ramp out of them, and `shell.css` paints
 * the page, draws the grid and parks the skip link. Reverse any pair and a later
 * file resolves a token that does not exist yet.
 *
 * The shell itself is at `--elev-0`, which is `none`: it authors no depth. The
 * three surface classes of `surfaces.css` are the only place depth is written
 * (§10.5), which is why the skip link asks for `.surface-raised` rather than
 * describing a slab of its own.
 *
 * Three elements sit outside the page column, in this order and for this reason:
 *
 *   1. *The skip link*, first focusable element in the document (§10.8, R10.7).
 *      `<main>` carries `tabIndex={-1}` so following the link actually moves
 *      focus rather than only scrolling — several browsers will not focus a
 *      non-interactive target otherwise, and a skip link that does not move focus
 *      is decoration. It stays first in the document even though the masthead is
 *      now a component: the boundary moved, the document order did not.
 *   2. *The drawn grid*, a viewport-pinned inert layer. Presentational and
 *      nothing else, so it is hidden from assistive technology outright: a
 *      reader who cannot see the ruling gains nothing from being told it is
 *      there.
 *   3. *The masthead*, sticky under a 3px ink rule, carrying the logo lockup and
 *      one link per section of the Ledger.
 *
 * And one inside it, at the other end: *the colophon*, a thin band after `<main>` holding
 * two links and the product's one-line claim. It is rendered here rather than per page for
 * the same reason the masthead is — a band five pages have to remember to include is a
 * band four of them eventually do not.
 *
 * Every page under this shell is statically rendered from the imported snapshot
 * (§10.1). This file holds no provider and no state, and it stays a server
 * component: the one client boundary in the shell is `components/Masthead.tsx`,
 * which owns the nav because the current-route highlight has to be derived from
 * the pathname and a layout cannot read it. That was the one thing this file
 * previously reported it could not finish; the component is the finish.
 *
 * ── The browser tab ──────────────────────────────────────────────────────────
 *
 * `title` is an object, not a string, and the distinction is the whole fix. The
 * tab used to read the full sentence — a description in the place a label belongs,
 * which truncates to something like "KEPT — the promises this codebase" in a
 * narrow tab and tells a reader with nine tabs open nothing at all. So `default`
 * is the product's name and nothing else, `template` composes a sub-route's short
 * name onto it, and the sentence stays as `description`, where it is what search
 * results and link previews want and what a tab strip does not.
 *
 * The separator is a middle dot rather than a hyphen because a hyphen inside a
 * title that already contains an em dash reads as part of the sentence. Each
 * sub-route exports a one-word `title` and Next composes it: `KEPT · Coverage`,
 * `KEPT · Runs`, and so on. `/` deliberately exports no `title`, so the home page
 * falls through to `default` and reads plain `KEPT` rather than announcing an
 * internal section name for the root of the site.
 *
 * No `icons` entry: `app/icon.svg` is picked up by convention, and naming it here
 * as well would override the convention with a second source of truth for the
 * same file.
 */

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Masthead } from '../components/Masthead.js';

import '../styles/tokens.css';
import '../styles/surfaces.css';
import '../styles/shell.css';

/**
 * The colophon's content, exported so the words are asserted rather than read off a
 * render. Two links and one line: where the source is, where the design is written down,
 * and what the product claims in a sentence. Deliberately not a sitemap — the masthead is
 * the navigation, and a second copy of it at the foot of the page is a second thing to
 * keep in step with the routes.
 */
export const REPOSITORY_HREF = 'https://github.com/EmadQureshiKhi/Kept';
export const DOCS_HREF = 'https://github.com/EmadQureshiKhi/Kept/tree/main/docs';

/** Names the pair of links, so a screen reader does not announce an unlabelled nav. */
export const FOOTER_LABEL = 'Elsewhere';

export const FOOTER_TAGLINE =
  'Every promise your product makes, and continuous proof it is still kept.';

export const metadata: Metadata = {
  title: {
    default: 'KEPT',
    template: 'KEPT · %s',
  },
  description:
    'A living ledger of every promise the repository states, the designed test that proves it, ' +
    'and the verdict of the last verification run.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link surface-raised" href="#main">
          Skip to main content
        </a>
        <div aria-hidden="true" className="page-grid" />
        <div className="page-shell">
          <Masthead />
          <main className="page-main" id="main" tabIndex={-1}>
            {children}
          </main>
          {/* The colophon, inside the shell and after `main`, so it is the last thing in
              the document on all five routes and is reached by scrolling to the bottom
              rather than by a scroll listener — see the note over `.page-footer` in
              `shell.css` for why that is a property of the flow rather than a trick. The
              two links are external and open in place; nothing here writes anything. */}
          <footer className="page-footer">
            <nav aria-label={FOOTER_LABEL} className="page-footer__links">
              <a className="page-footer__link" href={REPOSITORY_HREF}>
                Repository
              </a>
              <a className="page-footer__link" href={DOCS_HREF}>
                Docs
              </a>
            </nav>
            <p className="page-footer__tagline">{FOOTER_TAGLINE}</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
