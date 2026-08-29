'use client';

/**
 * The masthead — design §10.2, §10.8, R10.1, R10.7.
 *
 * This file exists for one reason, and the root layout's own comment used to name it
 * as the thing it could not finish: the current-route highlight has to come from the
 * pathname, and the pathname is only readable from a client component. A root layout
 * is a server component by definition — it exports `metadata`, which a client
 * component may not — and Next's layouts see neither the request nor the current path,
 * because they do not re-render on navigation. So the nav moves here, `usePathname`
 * supplies the truth, and `layout.tsx` stays a server component whose only client
 * boundary is this file.
 *
 * Deriving the active link from the path rather than from a per-page prop is the whole
 * point. A value only one renderer supplies is a value the other four pages do not
 * get, and a highlight that is right on the page you happened to test is worse than no
 * highlight: it reads as authoritative and is wrong.
 *
 * ── Four decisions worth stating ─────────────────────────────────────────────
 *
 * **`/` is matched exactly, everything else by prefix.** Every path begins with `/`,
 * so a prefix match on the root would mark the promises link current on all five
 * pages — `aria-current="page"` on five links at once is a lie a screen reader reads
 * out loud. The sub-sections match by prefix so a future `/runs/<id>` still lights its
 * own section, and the prefix is tested with a trailing separator so `/reviewsomething`
 * could not light `/reviews`.
 *
 * **The logo is a plain `<img>`, not `next/image`.** There is no `next.config` in this
 * repository, so the image optimiser runs on its defaults on the built site and not at
 * all in some local paths — a component that works in development and fails when
 * deployed is the worse of the two failure modes. There is also nothing for it to do
 * here: the served file is the trimmed lockup at 6.6 KB, already at the size the
 * masthead asks for. A plain element with explicit `width` and `height` reserves its box
 * from the ratio and shifts nothing, `decoding="async"` keeps the decode off the main
 * thread, and `fetchPriority="high"` says what is true of it — the lockup is above the
 * fold on all five pages. `alt="KEPT"` is the accessible name, so the link's name is
 * the product's name whether or not the artwork arrives — and `shell.css` styles that alt text as the
 * wordmark it replaced, for the request that does not.
 *
 * **`next/navigation.js` carries its extension.** This is `moduleResolution: NodeNext`
 * inside a `"type": "module"` workspace, so `apps/ledger` resolves like real ESM:
 * extensionless subpath specifiers are not searched for, and `next` publishes no
 * `exports` map to redirect them. Bare `next/navigation` therefore does not resolve and
 * `npm run typecheck:ledger` says so. With the extension it resolves to the shim Next
 * itself ships, which re-exports the same module the bundler would have given us, so
 * nothing about the runtime changes — this is only how the specifier has to be spelled
 * for the type checker to agree with it.
 *
 * **The links are `<a>`, not `next/link`, and that is a forced move rather than a
 * preference.** Under the resolution above, `next/link`'s published types and its
 * published runtime disagree: the shim is CommonJS, so under `esModuleInterop` the
 * *type* of its default export is the module namespace rather than the component, while
 * the *value* at runtime is the component. Every spelling that satisfies the checker
 * therefore reads the wrong thing at runtime, and every spelling that runs fails the
 * checker — the only ways out are a deep import into `next/dist`, which is a private
 * path, or a cast, which is asserting the checker is wrong about something it is right
 * about. So the masthead navigates with anchors. The cost is real and small: these five
 * links do a document navigation instead of a client transition, on a site whose pages
 * are static documents rendered from one committed snapshot with no client state to
 * preserve across them. Nothing else changes — `aria-current` still comes from
 * `usePathname`, and the styling in `shell.css` never depended on the element.
 */

import { usePathname } from 'next/navigation.js';

/**
 * The sections of the Ledger, in reading order: the promises themselves, then the
 * three views onto how they were judged, then the amendments that moved them.
 */
export const SECTIONS: readonly { readonly href: string; readonly label: string }[] = [
  { href: '/', label: 'Promises' },
  { href: '/coverage', label: 'Coverage' },
  { href: '/runs', label: 'Runs' },
  { href: '/reviews', label: 'Reviews' },
  { href: '/amendments', label: 'Amendments' },
];

/**
 * The one link in the masthead that leaves this deployment.
 *
 * `apps/try` is a separate application on a separate Vercel project, and it has to be: it holds a
 * `POST` handler that reads a repository somebody pastes, and this application states in its own
 * README that the deployed artefact carries no non-GET handler. That statement is a promise in
 * KEPT's own graph, cited to a line and bound to a designed test, so adding the handler here would
 * break it. Two deployments is the cost of not weakening a claim to fit a feature.
 *
 * It is therefore an absolute URL rather than a route, and it is kept out of {@link SECTIONS}
 * deliberately: those are sections of *this* site and every one of them takes an `aria-current`
 * when the pathname matches. A cross-deployment link can never be the current page here, so
 * putting it in that list would give `isCurrentSection` a path it can never own and invite a
 * future reader to add a matching route.
 *
 * Set at build time from the environment when one is given, so a preview deployment can point at a
 * preview of the other app, and falling back to the production host otherwise. That fallback is
 * what keeps the link working in `npm run demo`, where no environment is set at all.
 */
export const TRY_HREF = process.env.NEXT_PUBLIC_TRY_URL ?? 'https://kept-try.vercel.app';

/** The word on it. A verb, because it is the one thing on this masthead a reader can *do*. */
export const TRY_LABEL = 'Try your repo';

/**
 * `true` when `pathname` is the section at `href`.
 *
 * Exported so the rule can be asserted over paths a test chooses rather than only
 * through a render: the root's exact match and the sub-sections' prefix match are the
 * two halves of it, and both are easy to get quietly wrong.
 */
export function isCurrentSection(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The lockup's box, so the row reserves its space before the file lands.
 *
 * Both numbers are measured rather than chosen. `Assets/Kept logo.png` trims to its own
 * ink at 849x400, an aspect of 2.1225, and `shell.css` displays the lockup at 34px tall:
 * 34 x 2.1225 is 72.2, so 72 by 34. The served file is that box at 3x — 216x102 — so a
 * retina panel gets a whole pixel per device pixel and the browser only ever downscales.
 */
const LOGO_WIDTH = 72;
const LOGO_HEIGHT = 34;

export function Masthead() {
  /* Typed as possibly null for the pages router; under the app router it is always a
     string. The fallback keeps the exact-match branch honest rather than marking
     nothing current. */
  const pathname = usePathname() ?? '/';

  return (
    <header className="masthead">
      {/* No `aria-label` on the link: an accessible name there would override the
          image's `alt` and leave the artwork's own name unused and unverifiable.
          The alt *is* this link's name. */}
      <a className="masthead-home" href="/">
        <img
          alt="KEPT"
          className="masthead-logo"
          decoding="async"
          fetchPriority="high"
          height={LOGO_HEIGHT}
          src="/brand/kept-wordmark.png"
          width={LOGO_WIDTH}
        />
      </a>
      <nav aria-label="Ledger sections" className="masthead-nav">
        {SECTIONS.map((section) => (
          <a
            aria-current={isCurrentSection(section.href, pathname) ? 'page' : undefined}
            className="masthead-link"
            href={section.href}
            key={section.href}
          >
            {section.label}
          </a>
        ))}
        {/* The one link that leaves this deployment. Marked with `data-external` so the stylesheet
            can distinguish it without matching on the href, and carrying `rel` because it opens a
            different origin. No `target`: a reader who wants a new tab has a browser that gives
            them one, and taking the decision away is the kind of thing this site does not do
            elsewhere. */}
        <a className="masthead-link masthead-link--try" data-external="true" href={TRY_HREF} rel="noopener">
          {TRY_LABEL}
        </a>
      </nav>
    </header>
  );
}
