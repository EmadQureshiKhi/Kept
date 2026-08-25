/**
 * **Property 25: The badge is valid SVG reporting a whole-number percentage**
 *
 * **Validates: Requirements 9.4, 9.5**
 *
 * Design's statement: *for any* proven-coverage value, the badge response is
 * well-formed XML with a single `svg` root element whose text content includes that
 * value rounded to a whole-number percentage followed by a percent sign, or the
 * literal `n/a` when coverage is null.
 *
 * Three decisions about how that is tested.
 *
 * **The generator is over snapshots, not over ratios.** `arbSnapshot` is always
 * schema-valid and weights in both structural edge cases — the empty graph, whose
 * coverage figures are null because no division may be performed (R9.3), and the
 * graph with promises but no designed tests. A generator over bare ratios would
 * miss the way a null actually arises, and that is precisely why the null has to be
 * generated rather than observed: the committed snapshot is clean, `degraded: false`
 * with a real `provenCoverage`, so today's badge reads a percentage and the withheld
 * arm has no live example to lean on. Generating snapshots also means the property
 * exercises the same field the route reads rather than a number invented beside it,
 * and the clause below asserts that both a null and a numeric ratio were actually
 * drawn, so the `n/a` path cannot quietly stop being covered.
 *
 * **Well-formedness is checked by a parser, not by a regular expression.** The
 * ledger project runs under jsdom, which supplies `DOMParser`; a malformed document
 * comes back with a `parsererror` root, which is asserted against directly. The
 * global is reached through a narrow structural type rather than a DOM type because
 * this file is also compiled by the repository's no-DOM root project — and the
 * parser's presence is asserted rather than assumed, since a property that silently
 * skipped its only real check would be worse than no property.
 *
 * **The percentage is checked as arithmetic, not as a shape.** Matching `\d+%`
 * would pass for a badge that rendered a different number correctly formatted, so
 * the digits are compared against `Math.round(ratio * 100)` computed here, from the
 * ratio the snapshot carries.
 */

import type { LedgerSnapshot } from '@kept/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { arbSnapshot } from '../../../packages/kept-core/test/arbitraries.js';
import * as badgeRoute from '../app/badge.svg/route.js';
import {
  BADGE_CONTENT_TYPE,
  BADGE_HEIGHT,
  BADGE_LABEL,
  BADGE_WIDTH,
  badgeFillToken,
  badgeSvg,
} from '../lib/badge.js';
import { NOT_APPLICABLE } from '../lib/metricRail.js';
import { TOKENS } from '../lib/tokens.js';

/** Every property in this repository runs this many cases. */
const NUM_RUNS = 500;

/* ───────────────────────────── the XML parser seam ─────────────────────────── */

interface ParsedElement {
  readonly nodeName: string;
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
  getElementsByTagName(name: string): { readonly length: number };
}

interface ParsedDocument {
  readonly documentElement: ParsedElement | null;
}

interface XmlParser {
  parseFromString(text: string, contentType: string): ParsedDocument;
}

/**
 * The environment's XML parser.
 *
 * Read off `globalThis` through a structural type: this file is compiled by both
 * the browser-facing ledger program and the repository's no-DOM root program, and
 * only the first of those declares `DOMParser`. Narrowing to the four members used
 * below keeps the seam honest — nothing here can quietly start relying on the whole
 * DOM.
 */
const parserFactory = (globalThis as { DOMParser?: new () => XmlParser }).DOMParser;

function parseXml(text: string): ParsedDocument {
  if (parserFactory === undefined) {
    throw new Error(
      'No XML parser is available in this environment, so well-formedness would go ' +
        'unchecked and this property would pass by not looking. The ledger project runs ' +
        'under jsdom precisely so that it can look.',
    );
  }
  return new parserFactory().parseFromString(text, BADGE_CONTENT_TYPE);
}

/** The whole-number percentage the badge must display, computed independently. */
function expectedText(ratio: number | null): string {
  return ratio === null ? NOT_APPLICABLE : `${Math.round(ratio * 100)}%`;
}

/** Every proven-coverage value a schema-valid snapshot can carry. */
const arbProvenCoverage: fc.Arbitrary<number | null> = arbSnapshot.map(
  (snapshot: LedgerSnapshot) => snapshot.metrics.provenCoverage,
);

describe('the property has a parser and something to parse', () => {
  it('found an XML parser, and it rejects malformed input', () => {
    expect(parserFactory, 'no DOMParser in this environment').toBeDefined();
    const broken = parseXml('<svg><rect></svg>');
    expect(broken.documentElement?.nodeName ?? '').toContain('parsererror');
  });

  it('generates both a null coverage and a numeric one', () => {
    const drawn = fc.sample(arbProvenCoverage, 200);
    expect(drawn.some((ratio) => ratio === null), 'no null coverage was generated').toBe(true);
    expect(
      drawn.some((ratio) => typeof ratio === 'number'),
      'no numeric coverage was generated',
    ).toBe(true);
  });
});

describe('Property 25: the badge is valid SVG reporting a whole-number percentage', () => {
  it('is well-formed XML with a single svg root, at exactly 110 by 20', () => {
    fc.assert(
      fc.property(arbProvenCoverage, (ratio) => {
        const svg = badgeSvg(ratio);
        const document = parseXml(svg);
        const root = document.documentElement;

        expect(root, 'the badge did not parse to a root element').not.toBeNull();
        expect(root?.nodeName).toBe('svg');
        expect(root?.nodeName ?? '').not.toContain('parsererror');
        expect(root?.getElementsByTagName('svg').length, 'nested svg root').toBe(0);

        expect(root?.getAttribute('width')).toBe(String(BADGE_WIDTH));
        expect(root?.getAttribute('height')).toBe(String(BADGE_HEIGHT));
        expect(root?.getAttribute('viewBox')).toBe(`0 0 ${BADGE_WIDTH} ${BADGE_HEIGHT}`);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reports the coverage as a whole-number percentage, or the literal n/a', () => {
    fc.assert(
      fc.property(arbProvenCoverage, (ratio) => {
        const text = parseXml(badgeSvg(ratio)).documentElement?.textContent ?? '';
        const expected = expectedText(ratio);

        expect(text, `the badge does not report ${expected}`).toContain(expected);
        expect(text).toContain(BADGE_LABEL);

        if (ratio === null) {
          expect(text).toContain(NOT_APPLICABLE);
          expect(text, 'a withheld figure must never be reported as zero').not.toContain('0%');
        } else {
          const percent = Math.round(ratio * 100);
          expect(Number.isInteger(percent)).toBe(true);
          expect(percent).toBeGreaterThanOrEqual(0);
          expect(percent).toBeLessThanOrEqual(100);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never renders a fraction, an exponent or a signed figure', () => {
    fc.assert(
      fc.property(arbProvenCoverage, (ratio) => {
        /* The document's whole text is the title, the label and the figure, so a
           decimal point, an exponent or a sign anywhere in it is a figure that
           escaped rounding. */
        const text = parseXml(badgeSvg(ratio)).documentElement?.textContent ?? '';
        expect(text).not.toMatch(/\d\.\d/);
        expect(text).not.toMatch(/e[+-]?\d/i);
        expect(text).not.toMatch(/[+-]\d+%/);
        expect(text.endsWith(`${Math.round((ratio ?? 0) * 100)}%`) || text.endsWith(NOT_APPLICABLE)).toBe(
          true,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('paints a fill from the verdict palette and nothing outside it', () => {
    const permitted = new Set<string>(
      (['--verdict-proven', '--verdict-stale', '--verdict-red', '--verdict-undesigned'] as const).map(
        (token) => TOKENS[token],
      ),
    );

    fc.assert(
      fc.property(arbProvenCoverage, (ratio) => {
        const svg = badgeSvg(ratio);
        const chosen = TOKENS[badgeFillToken(ratio)];
        expect(permitted.has(chosen)).toBe(true);
        expect(svg).toContain(`fill="${chosen}"`);

        /* the plate, the label text and the inverted figure text, plus one verdict
           fill used twice: five fills, four distinct values, none invented */
        const fills = [...svg.matchAll(/fill="([^"]+)"/g)].map((match) => match[1] ?? '');
        const known = new Set<string>([
          TOKENS['--ink-000'],
          TOKENS['--ink-100'],
          TOKENS['--text-100'],
          chosen,
        ]);
        for (const fill of fills) expect(known.has(fill), `unknown fill ${fill}`).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('answers image/svg+xml, and the body is that same well-formed document (R9.5)', async () => {
    const response = badgeRoute.GET();
    expect(response.headers.get('content-type')).toBe(BADGE_CONTENT_TYPE);
    const body = await response.text();
    expect(parseXml(body).documentElement?.nodeName).toBe('svg');
  });
});
