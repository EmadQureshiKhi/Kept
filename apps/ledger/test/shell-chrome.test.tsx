/**
 * The shell's chrome — the masthead at the top of every page and the colophon at the
 * bottom of it. Design §10.2, §10.7, §10.8, R10.1, R10.7, R10.8.
 *
 * Two pieces of furniture that are on all five routes and were, until now, on none of
 * the tests. That is the gap this file closes, and it is the gap that let the masthead
 * ship with its lockup a descender's depth too high: nothing rendered `Masthead`, so
 * nothing could notice.
 *
 * What is asserted here is deliberately what a *render* can prove — the elements exist,
 * they are in the right order in the document, the links go where they claim and every
 * one of them has an accessible name. The parts that are pure geometry are asserted where
 * geometry can be read: the alignment of the lockup and the shape of the footer band are
 * arithmetic over `shell.css`, in the second half of the file, because jsdom does no
 * layout and a width read from it is a fiction.
 *
 * `RootLayout` renders `<html>` and `<body>`, which React will happily mount inside a
 * container div while telling us it is unusual. That warning is noise rather than a
 * finding: the tree under `.page-shell` is the tree the browser gets, and it is the only
 * part any assertion below touches.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import RootLayout, {
  DOCS_HREF,
  FOOTER_LABEL,
  FOOTER_TAGLINE,
  REPOSITORY_HREF,
} from '../app/layout.js';
import { SECTIONS, TRY_HREF, TRY_LABEL, isCurrentSection } from '../components/Masthead.js';

import {
  STYLE_EXTENSIONS,
  normaliseCssValue,
  parseCss,
  scanLedger,
  type CssRule,
} from './_scan.js';

/** The ledger project shares one jsdom across suites, so unmount explicitly. */
afterEach(cleanup);

const SHELL_CSS = 'apps/ledger/styles/shell.css';

const STYLESHEETS = scanLedger(STYLE_EXTENSIONS);

function shellRules(): CssRule[] {
  const file = STYLESHEETS.find((candidate) => candidate.path === SHELL_CSS);
  expect(file, `${SHELL_CSS} was not scanned — a renamed stylesheet parses to zero rules`).toBeDefined();
  return parseCss(file?.text ?? '');
}

const SHELL_RULES = shellRules();

/** The value of `property` in the rule whose prelude is exactly `prelude`, or `null`. */
function declared(prelude: string, property: string, inside?: RegExp): string | null {
  const rule = SHELL_RULES.find(
    (candidate) =>
      candidate.prelude === prelude &&
      (inside === undefined
        ? candidate.ancestors.length === 0
        : candidate.ancestors.some((ancestor) => inside.test(ancestor))),
  );
  const found = rule?.declarations.find(
    (candidate) => candidate.property.toLowerCase() === property,
  );
  return found === undefined ? null : normaliseCssValue(found.value);
}

function renderShell() {
  return render(
    <RootLayout>
      <p>page content</p>
    </RootLayout>,
  );
}

/* ─────────────────────────── the masthead, rendered ────────────────────────── */

describe('the masthead is the same on every route', () => {
  it('carries the lockup as a link home, named by the artwork\u2019s own alt text', () => {
    const { container, unmount } = renderShell();
    try {
      const home = container.querySelector('a.masthead-home');
      expect(home?.getAttribute('href')).toBe('/');
      const logo = home?.querySelector('img.masthead-logo');
      expect(logo, 'the lockup is not rendered').not.toBeNull();
      /* the alt *is* the link's accessible name, so the link is named whether or not the
         file arrives — there is deliberately no aria-label on the anchor to override it */
      expect(logo?.getAttribute('alt')).toBe('KEPT');
      expect(home?.getAttribute('aria-label')).toBeNull();
      /* the box is reserved from the ratio, so the row does not shift when the file lands */
      expect(logo?.getAttribute('width')).toBe('72');
      expect(logo?.getAttribute('height')).toBe('34');
    } finally {
      unmount();
    }
  });

  it('offers one named link per section, in reading order, then the one that leaves', () => {
    /* This used to assert that the masthead's links were *exactly* SECTIONS. That was right while
       every link in the row was a route on this deployment, and it is wrong now: the row ends with
       a link to `apps/try`, which is a separate application on a separate deployment because it
       holds a POST handler this one promises not to have. So the assertion splits in two. The
       section links are still exactly SECTIONS, in order, which is the part that was ever load
       bearing; the outbound link is asserted separately, and asserted to be last, so it cannot
       drift into the middle of the sections or quietly become a sixth one. */
    const { container, unmount } = renderShell();
    try {
      const nav = container.querySelector('nav.masthead-nav');
      expect(nav?.getAttribute('aria-label')).toBe('Ledger sections');

      const sections = [
        ...container.querySelectorAll<HTMLAnchorElement>('a.masthead-link:not([data-external])'),
      ];
      expect(sections.map((link) => link.getAttribute('href'))).toEqual(
        SECTIONS.map((section) => section.href),
      );
      expect(sections.map((link) => link.textContent)).toEqual(
        SECTIONS.map((section) => section.label),
      );

      const links = [...container.querySelectorAll<HTMLAnchorElement>('a.masthead-link')];
      expect(links.length, 'the row holds the sections and exactly one outbound link').toBe(
        SECTIONS.length + 1,
      );
      const outbound = links[links.length - 1];
      expect(outbound?.getAttribute('data-external')).toBe('true');
      expect(outbound?.textContent).toBe(TRY_LABEL);
      expect(outbound?.getAttribute('href')).toBe(TRY_HREF);
      /* This used to assert `target` was null, on the reasoning that a reader who wants a new tab
         has a browser that gives them one. That was wrong for this particular link. It leaves for a
         different deployment, and a reader following it has usually been reading a promise here and
         wants to come back to it: this site keeps the open panel and the verdict filter in the URL,
         so a document navigation away and back means the back button and a re-render rather than
         the page they left. So it opens a tab, and `noreferrer` joins `noopener` because a new tab
         is the case both attributes were written for. */
      expect(outbound?.getAttribute('target')).toBe('_blank');
      expect(outbound?.getAttribute('rel')).toBe('noopener noreferrer');
      /* Both halves of `rel` matter and neither is decoration: `noopener` denies the new tab a
         handle back onto this window, `noreferrer` withholds the address it came from. */
      for (const token of ['noopener', 'noreferrer']) {
        expect(outbound?.getAttribute('rel')?.split(' ')).toContain(token);
      }
      /* It can never be the current page here, so it must never claim to be. */
      expect(outbound?.getAttribute('aria-current')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('keeps the outbound link out of the section list', () => {
    /* SECTIONS drives `aria-current`, and a cross-deployment URL in it would be a path
       `isCurrentSection` can never own. Asserted on the data rather than the render because that
       is where the mistake would be made. */
    expect(SECTIONS.map((section) => section.href).includes(TRY_HREF)).toBe(false);
    for (const section of SECTIONS) expect(section.href.startsWith('/')).toBe(true);
  });

  it('marks at most one link current, whatever the path', () => {
    /* the rule itself, over paths a test chooses rather than the one jsdom happens to be at */
    for (const path of ['/', '/coverage', '/runs', '/reviews', '/amendments', '/reviewsomething']) {
      const current = SECTIONS.filter((section) => isCurrentSection(section.href, path));
      expect(
        current.length,
        `${path} lights ${current.length} links; aria-current on two is a lie read aloud`,
      ).toBeLessThanOrEqual(1);
    }
  });
});

/* ──────────────── the lockup's alignment, as arithmetic over the CSS ──────────── */

describe('the lockup lines up with the nav, and the row cannot resize', () => {
  /**
   * The bug, and why this assertion is the fix rather than a description of it.
   *
   * `align-items: baseline` on a row containing an `<img>` aligns the image's *bottom
   * margin edge* — the baseline CSS synthesises for a replaced element — with the text
   * baseline of the type beside it. The nav links are type, and their baseline sits a
   * descender above their own bottom edge, so every pixel of the lockup was pushed up by
   * that difference. Centring is what removes the synthetic baseline from the arithmetic;
   * a larger negative offset would only have cancelled it at one font size.
   */
  it('centres the masthead row rather than sharing a baseline with a picture', () => {
    expect(
      declared('.masthead', 'align-items'),
      'a baseline-aligned row lines the bottom of the artwork up with the nav baseline, ' +
        'which is what pushed the lockup above the links',
    ).toBe('center');
    /* the nav's own items really are five runs of type, so they keep their shared baseline */
    expect(declared('.masthead-nav', 'align-items')).toBe('baseline');
  });

  it('nudges the mark with a relative offset, never with a margin', () => {
    expect(declared('.masthead-logo', 'position')).toBe('relative');
    const top = declared('.masthead-logo', 'top');
    expect(top, 'the cap-height correction is gone').not.toBeNull();
    expect(
      Number.parseFloat(top ?? 'NaN'),
      `${top ?? ''} is a large offset, which means it is standing in for the alignment ` +
        `mode rather than correcting a font metric`,
    ).toBeGreaterThanOrEqual(-4);
    expect(Number.parseFloat(top ?? 'NaN')).toBeLessThanOrEqual(0);
    for (const property of ['margin', 'margin-top', 'margin-bottom']) {
      expect(
        declared('.masthead-logo', property),
        `a ${property} on the lockup moves its flow box and takes the sticky masthead's ` +
          `own height with it`,
      ).toBeNull();
    }
  });

  it('states the lockup height here and steps it down under the breakpoint', () => {
    expect(declared('.masthead-logo', 'height')).toBe('34px');
    expect(declared('.masthead-logo', 'width')).toBe('auto');
    expect(declared('.masthead-logo', 'display')).toBe('block');
    /* the clear space is padding, because the artwork is trimmed to its own ink */
    expect(declared('.masthead-logo', 'padding')).toBe('0 var(--s-1)');
    expect(
      declared('.masthead-logo', 'height', /^@media\s*\(\s*max-width/),
      'the lockup keeps its desktop height on a phone',
    ).toBe('26px');
  });

  it('leaves no rule for the text wordmark the lockup replaced', () => {
    const dead = SHELL_RULES.filter((rule) => rule.prelude.includes('.masthead-wordmark'));
    expect(
      dead.map((rule) => rule.prelude),
      'a rule for an element nothing renders is the next author\u2019s dead end',
    ).toEqual([]);
  });
});

/* ─────────────────────────── the colophon, rendered ───────────────────────────── */

describe('the colophon closes every page', () => {
  it('is the last thing in the shell, after main', () => {
    const { container, unmount } = renderShell();
    try {
      const shell = container.querySelector('.page-shell');
      expect(shell, 'no page shell was rendered').not.toBeNull();
      const footer = shell?.querySelector(':scope > footer.page-footer');
      expect(footer, 'the footer is not a child of the page shell').not.toBeNull();
      /* order is the whole of how it "appears at the bottom": main grows, this follows it */
      const children = [...(shell?.children ?? [])];
      expect(children[children.length - 1]).toBe(footer);
      expect(children[children.length - 2]?.tagName).toBe('MAIN');
    } finally {
      unmount();
    }
  });

  it('holds two named links and the one-line claim, and no sitemap', () => {
    const { container, unmount } = renderShell();
    try {
      const footer = container.querySelector('footer.page-footer');
      const nav = footer?.querySelector('nav.page-footer__links');
      expect(nav?.getAttribute('aria-label')).toBe(FOOTER_LABEL);

      const links = [...(footer?.querySelectorAll<HTMLAnchorElement>('a.page-footer__link') ?? [])];
      expect(
        links.map((link) => link.getAttribute('href')),
        'the colophon is the repository and the docs, not a second navigation',
      ).toEqual([REPOSITORY_HREF, DOCS_HREF]);
      for (const link of links) {
        expect(
          link.textContent?.trim(),
          'a link with no text has no accessible name',
        ).toBeTruthy();
      }

      expect(footer?.querySelector('.page-footer__tagline')?.textContent).toBe(FOOTER_TAGLINE);
      expect(FOOTER_TAGLINE).toBe(
        'Every promise your product makes, and continuous proof it is still kept.',
      );
    } finally {
      unmount();
    }
  });

  it('is drawn as a paper band under a hairline, and cannot overflow a phone', () => {
    /* A band: one hairline above it, a recessed paper fill, and no depth of its own —
       depth is authored in `surfaces.css` alone (§10.5) and a colophon asks for none. */
    expect(declared('.page-footer', 'border-top')).toBe('1px solid var(--hairline)');
    expect(declared('.page-footer', 'background-color')).toBe('var(--ink-050)');

    /* R10.8 at the narrowest width this product reasons about: the band is a wrapping flex
       row and nothing in it carries a width, so at 320px the tagline drops under the links
       and the page has nothing to overflow with. */
    expect(declared('.page-footer', 'display')).toBe('flex');
    expect(declared('.page-footer', 'flex-wrap')).toBe('wrap');
    expect(declared('.page-footer__links', 'flex-wrap')).toBe('wrap');
    for (const prelude of ['.page-footer__links', '.page-footer__tagline']) {
      expect(
        declared(prelude, 'min-width'),
        `${prelude} keeps an auto minimum, which is how a flex child pushes a page wider ` +
          `than the window`,
      ).toBe('0');
    }
    /* and it is not sticky, so it cannot argue with the masthead over a z-index */
    expect(declared('.page-footer', 'position')).toBeNull();
    expect(declared('.page-footer', 'z-index')).toBeNull();
  });

  it('is hidden in print, because paper does not need a colophon', () => {
    const print = SHELL_RULES.filter(
      (rule) =>
        rule.ancestors.some((ancestor) => /^@media\s+print$/.test(ancestor)) &&
        rule.prelude.split(',').some((selector) => selector.trim() === '.page-footer'),
    );
    expect(
      print.length,
      'the print block stopped hiding the footer, so every printed page ends in two links',
    ).toBeGreaterThan(0);
    expect(
      print.some((rule) =>
        rule.declarations.some(
          (entry) =>
            entry.property.toLowerCase() === 'display' &&
            normaliseCssValue(entry.value) === 'none',
        ),
      ),
    ).toBe(true);
  });
});
