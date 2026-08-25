/**
 * The badge, asserted. Design §10.11, §10.4.2, R9.3, R9.4, R9.5.
 *
 * Four halves, since the shields treatment landed.
 *
 * The **string** half pins what §10.11 fixes: a 110×20 SVG, the words
 * `promises kept` on the paper plate, the figure on a verdict fill chosen by band,
 * the figure's text in `--ink-000`, and no gradient, no shadow and no logo. §18
 * names badge polish as the place a gradient would try to arrive later, so the
 * absence is asserted rather than assumed, and now the `style` attribute the
 * numerals travel in is enumerated too, because an attribute that can hold one CSS
 * declaration can hold a gradient.
 *
 * The **geometry** half is new, and it is the point of the treatment. The plates,
 * the seam, the baseline and both text anchors are *derived* from a glyph-advance
 * table, so this half asserts the derivation rather than the numbers: the frame is
 * one unit of ink on every side, the plates are square where they meet it, the
 * label is held to its tabulated advance by `textLength` so it cannot cross the
 * seam on a machine with a wider sans, and, the assertion the brief turns on,
 * `9%`, `88%`, `100%` and `n/a` produce byte-identical geometry, differing only in
 * the value's own characters and its fill.
 *
 * The **band** half walks the boundaries of the four bands from both sides. Eighty
 * is proven and seventy-nine is not; forty is stale and thirty-nine is not. The
 * comparison is made on the percentage the badge *displays*, which is the detail
 * worth a test of its own: a ratio a hair under 0.8 displays as `80%`, so it has to
 * be green, or a reader who checks the arithmetic finds a badge that disagrees with
 * itself.
 *
 * The **endpoint** half calls the route directly. It exports `GET` and nothing else
 * (R9.4), answers `image/svg+xml` (R9.5), and reports whatever the committed
 * snapshot's proven figure actually is, a whole-number percentage while the graph
 * is clean, and `n/a` rather than `0%` whenever the figure is withheld. Both arms
 * are asserted, and which one the committed file is in is read from the file rather
 * than pinned here: the state moves with Kane, and a test that pinned it would fail
 * for the wrong reason on the day it moved. Both arms are also parsed, so
 * well-formedness is checked on the figure a reader meets first *and* on the
 * fallback rather than on whichever one happens to be live.
 *
 * Property 25 lives in `badge.prop.test.ts`; this file is the examples and the
 * edges.
 */

import { SnapshotMetricsSchema } from '@kept/core';
import { describe, expect, it } from 'vitest';

import * as badgeRoute from '../app/badge.svg/route.js';
import {
  BADGE_CACHE_CONTROL,
  BADGE_CONTENT_TYPE,
  BADGE_EDGE,
  BADGE_HEIGHT,
  BADGE_LABEL,
  BADGE_LABEL_WEIGHT,
  BADGE_NUMERIC_STYLE,
  BADGE_RADIUS,
  BADGE_VALUE_WEIGHT,
  BADGE_WIDEST_VALUE,
  BADGE_WIDTH,
  badgeFillToken,
  badgeFontSize,
  badgeGeometry,
  badgeHeaders,
  badgeSvg,
  badgeTitle,
  badgeValue,
  escapeXml,
  textWidth,
} from '../lib/badge.js';
import { NOT_APPLICABLE, formatMetricFigure } from '../lib/metricRail.js';
import { snapshot } from '../lib/snapshot.js';
import { TOKENS } from '../lib/tokens.js';

/** Every digit count the badge can be asked to draw, plus the withheld arm. */
const EVERY_STATE: readonly (readonly [string, number | null])[] = [
  ['9%', 0.09],
  ['88%', 0.875],
  ['100%', 1],
  [NOT_APPLICABLE, null],
];

/** The `d` attribute of every path in a badge, in document order. */
function paths(svg: string): string[] {
  return [...svg.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1] ?? '');
}

/** One `<text>` element's markup, found by the characters it sets. */
function textRun(svg: string, content: string): string {
  const match = new RegExp(`<text\\b[^>]*>${content.replace(/[/%]/g, '\\$&')}</text>`).exec(svg);
  expect(match, `no <text> run setting "${content}"`).not.toBeNull();
  return match?.[0] ?? '';
}

/**
 * The environment's XML parser, reached through the same narrow structural type
 * `badge.prop.test.ts` uses: this file is compiled by the repository's no-DOM root
 * program as well as by the ledger's own, and only the second declares `DOMParser`.
 */
interface ParsedElement {
  readonly nodeName: string;
  readonly textContent: string | null;
  getElementsByTagName(name: string): { readonly length: number };
}
const parserFactory = (
  globalThis as {
    DOMParser?: new () => { parseFromString(text: string, type: string): { documentElement: ParsedElement | null } };
  }
).DOMParser;

function parseSvg(text: string): ParsedElement {
  expect(parserFactory, 'no XML parser here, so well-formedness would go unchecked').toBeDefined();
  if (parserFactory === undefined) throw new Error('no DOMParser');
  const root = new parserFactory().parseFromString(text, BADGE_CONTENT_TYPE).documentElement;
  expect(root, 'the badge did not parse to a root element').not.toBeNull();
  return root as ParsedElement;
}

describe('the badge is the 110 by 20 plate design §10.11 specifies', () => {
  it('declares that geometry once, in the attributes and in the viewBox', () => {
    const svg = badgeSvg(0.875);
    expect(BADGE_WIDTH).toBe(110);
    expect(BADGE_HEIGHT).toBe(20);
    expect(svg).toContain(`width="${BADGE_WIDTH}"`);
    expect(svg).toContain(`height="${BADGE_HEIGHT}"`);
    expect(svg).toContain(`viewBox="0 0 ${BADGE_WIDTH} ${BADGE_HEIGHT}"`);
  });

  it('carries the label on the paper plate and the figure in inverted ink', () => {
    const svg = badgeSvg(0.875);
    expect(svg).toContain(`>${BADGE_LABEL}</text>`);
    expect(svg).toContain(`fill="${TOKENS['--ink-100']}"`);
    expect(svg).toContain(`fill="${TOKENS['--text-100']}"`);
    expect(svg).toContain(`fill="${TOKENS['--ink-000']}"`);
  });

  it('is flat: no gradient, no shadow, no filter, no image and no script', () => {
    for (const [, ratio] of EVERY_STATE) {
      const svg = badgeSvg(ratio);
      for (const forbidden of [
        'Gradient',
        'gradient',
        'filter',
        'feDropShadow',
        'script',
        '<image',
        'href',
        'opacity',
      ]) {
        expect(svg, `the badge should not contain "${forbidden}"`).not.toContain(forbidden);
      }
    }
  });

  it('paints from four token values and invents none of them', () => {
    /* The frame reuses the label's own ink rather than reaching for --text-000, so
       the whole image is four values and every one of them is a §10.4.2 cell. */
    for (const [, ratio] of EVERY_STATE) {
      const fills = [...badgeSvg(ratio).matchAll(/fill="([^"]+)"/g)].map((match) => match[1] ?? '');
      const permitted = new Set<string>([
        TOKENS['--ink-000'],
        TOKENS['--ink-100'],
        TOKENS['--text-100'],
        TOKENS[badgeFillToken(ratio)],
      ]);
      expect(permitted.size).toBe(4);
      for (const fill of fills) expect(permitted.has(fill), `invented fill ${fill}`).toBe(true);
      expect(new Set(fills).size, 'a token value went unused').toBe(4);
    }
  });

  it('opens exactly one style attribute, and it holds the numerals and nothing else', () => {
    /* A style attribute is the one place in this image a gradient could still arrive,
       so its contents are enumerated rather than trusted. */
    const styles = [...badgeSvg(0.875).matchAll(/style="([^"]*)"/g)].map((match) => match[1] ?? '');
    expect(styles).toEqual([BADGE_NUMERIC_STYLE]);
    expect(BADGE_NUMERIC_STYLE).toBe('font-variant-numeric: tabular-nums lining-nums');
    expect(badgeSvg(0.875)).not.toContain('<style');
  });

  it('takes its type size from --fs-micro rather than from a number typed here', () => {
    expect(TOKENS['--fs-micro']).toBe('0.6875rem');
    expect(badgeFontSize()).toBe(11);
    expect(badgeSvg(0.875)).toContain(`font-size="${badgeFontSize()}"`);
  });

  it('names an accessible title matching the figure it draws', () => {
    expect(badgeTitle(0.875)).toBe('promises kept: 88%');
    expect(badgeTitle(null)).toBe(`promises kept: ${NOT_APPLICABLE}`);
    expect(badgeSvg(null)).toContain(`<title>promises kept: ${NOT_APPLICABLE}</title>`);
  });
});

describe('the geometry is derived from the metrics, not typed in', () => {
  const geometry = badgeGeometry();

  it('measures the glyphs it sets, and refuses the ones it has never measured', () => {
    /* Helvetica advances, which is the reference for the whole stack: `promises kept`
       is 6.224 em and `100%` is 2.557 em. Both are checked as arithmetic so a table
       edit shows up here rather than as a figure sitting off centre in a README. */
    expect(textWidth(BADGE_LABEL, 1000)).toBeCloseTo(6224, 6);
    expect(textWidth(BADGE_WIDEST_VALUE, 1000)).toBeCloseTo(2557, 6);
    expect(textWidth(NOT_APPLICABLE, 1000)).toBeCloseTo(1390, 6);
    /* every digit shares one advance, which is what makes the tabular request honest */
    const advances = new Set([...'0123456789'].map((digit) => textWidth(digit, 1000)));
    expect(advances.size).toBe(1);

    expect(() => textWidth('Q', 11)).toThrow(/glyph-advance table/);
    expect(() => textWidth('promises kept.', 11)).toThrow(/cannot measure "\."/);
  });

  it('frames the badge in one unit of ink on all four sides', () => {
    expect(BADGE_EDGE).toBe(1);
    expect(geometry.edge).toBe(BADGE_EDGE);
    expect(geometry.label.x).toBe(BADGE_EDGE);
    expect(geometry.value.x + geometry.value.width).toBe(BADGE_WIDTH - BADGE_EDGE);
    /* the frame is the full-bleed rect; the plates sit inside it, so it is also the seam */
    expect(badgeSvg(0.875)).toContain(
      `<rect width="${BADGE_WIDTH}" height="${BADGE_HEIGHT}" rx="${BADGE_RADIUS}" ` +
        `fill="${TOKENS['--text-100']}"/>`,
    );
    expect(geometry.value.x - (geometry.label.x + geometry.label.width)).toBe(BADGE_EDGE);
    expect(geometry.splitX).toBe(geometry.label.x + geometry.label.width);
  });

  it('keeps the plates concentric with the frame: rx 2 outside, rx 1 within', () => {
    expect(BADGE_RADIUS).toBe(2);
    expect(geometry.radius).toBe(BADGE_RADIUS);
    expect(geometry.innerRadius).toBe(BADGE_RADIUS - BADGE_EDGE);
  });

  it('draws two plates and one frame, and no other shape', () => {
    const svg = badgeSvg(0.875);
    expect((svg.match(/<rect\b/g) ?? []).length).toBe(1);
    expect(paths(svg).length).toBe(2);
    for (const shape of ['<circle', '<ellipse', '<line', '<polygon', '<polyline', '<use', '<g id']) {
      expect(svg, `the badge should not contain "${shape}"`).not.toContain(shape);
    }
  });

  it('rounds each plate on its outer corners only, so the seam is a straight line', () => {
    const [label, value] = paths(badgeSvg(0.875));
    const r = geometry.innerRadius;
    const top = BADGE_EDGE;
    const bottom = BADGE_HEIGHT - BADGE_EDGE;

    /* The label plate arcs on the left and runs square down the seam at splitX; the
       value plate does the mirror. Two facing curves would leave the frame showing
       through as a notch, which is the defect the old square patch existed to undo. */
    expect(label).toBe(
      `M${BADGE_EDGE + r} ${top}H${geometry.splitX}V${bottom}H${BADGE_EDGE + r}` +
        `A${r} ${r} 0 0 1 ${BADGE_EDGE} ${bottom - r}V${top + r}A${r} ${r} 0 0 1 ${BADGE_EDGE + r} ${top}Z`,
    );
    expect(value).toBe(
      `M${geometry.value.x} ${top}H${BADGE_WIDTH - BADGE_EDGE - r}` +
        `A${r} ${r} 0 0 1 ${BADGE_WIDTH - BADGE_EDGE} ${top + r}V${bottom - r}` +
        `A${r} ${r} 0 0 1 ${BADGE_WIDTH - BADGE_EDGE - r} ${bottom}H${geometry.value.x}Z`,
    );
    /* two arcs per plate, both sweeping clockwise into the plate */
    for (const plate of [label, value]) {
      expect((plate?.match(/A/g) ?? []).length).toBe(2);
      expect((plate?.match(/0 0 1/g) ?? []).length).toBe(2);
    }
  });

  it('divides the slack into four equal paddings, and refuses to run out of it', () => {
    /* 110 units, less the frame and the seam, less the label and the widest bold
       value, leaves nine units; a quarter of that inside each plate edge. The seam
       lands on a whole unit so a one-unit ink line is not antialiased into two grey
       ones, which is the whole of the difference between the two paddings. */
    expect(geometry.label.padding).toBeGreaterThan(2);
    expect(geometry.value.padding).toBeGreaterThan(2);
    expect(Math.abs(geometry.label.padding - geometry.value.padding)).toBeLessThan(0.1);
    expect(Number.isInteger(geometry.splitX)).toBe(true);
    expect(Number.isInteger(geometry.label.width)).toBe(true);
    expect(Number.isInteger(geometry.value.width)).toBe(true);
  });

  it('sits both runs on one baseline, placed on the digits’ cap height', () => {
    /* Two baselines on a 20-unit strip read as a fault. One, and it is derived: at
       --fs-micro the digits stand 7.89 units tall, so centring them in the plate
       interior puts the baseline at 13.94, and a change to the token moves it
       rather than stranding a hardcoded 14. */
    expect(geometry.baselineY).toBeCloseTo(
      BADGE_EDGE + (BADGE_HEIGHT - 2 * BADGE_EDGE + 0.717 * badgeFontSize()) / 2,
      2,
    );
    const svg = badgeSvg(0.875);
    expect((svg.match(new RegExp(`y="${geometry.baselineY}"`, 'g')) ?? []).length).toBe(2);
  });

  it('holds the label to its tabulated advance, so it cannot cross the seam', () => {
    /* textLength is what makes the derivation safe across operating systems: the
       plate is sized to the tabulated figure, and lengthAdjust="spacing" makes the
       renderer meet that figure by moving the gaps and never the glyphs. */
    const run = textRun(badgeSvg(0.875), BADGE_LABEL);
    expect(run).toContain(`textLength="${geometry.labelWidth}"`);
    expect(run).toContain('lengthAdjust="spacing"');
    expect(run).toContain(`x="${geometry.label.centreX}"`);
    expect(geometry.labelWidth).toBeCloseTo(textWidth(BADGE_LABEL, badgeFontSize()), 2);
    expect(geometry.labelWidth + 2 * geometry.label.padding).toBeCloseTo(geometry.label.width, 2);
  });

  it('leaves the value free, because forcing four glyphs would close their gaps', () => {
    /* `9%` has one inter-glyph gap, so a forced advance would spend the whole
       correction on it. The value is centred instead, with tabular figures. */
    for (const [text, ratio] of EVERY_STATE) {
      const run = textRun(badgeSvg(ratio), text);
      expect(run, `${text} must not carry a forced advance`).not.toContain('textLength');
      expect(run).toContain(BADGE_NUMERIC_STYLE);
      expect(run).toContain(`x="${geometry.value.centreX}"`);
    }
  });

  it('weights the figure above the label, in the two faces every stack ships', () => {
    expect(BADGE_LABEL_WEIGHT).toBe('400');
    expect(BADGE_VALUE_WEIGHT).toBe('700');
    expect(textRun(badgeSvg(0.875), BADGE_LABEL)).toContain(`font-weight="${BADGE_LABEL_WEIGHT}"`);
    expect(textRun(badgeSvg(0.875), '88%')).toContain(`font-weight="${BADGE_VALUE_WEIGHT}"`);
  });
});

describe('the geometry does not wobble as the digit count changes', () => {
  it('draws 9%, 88%, 100% and n/a on identical plates, seam and baseline', () => {
    const skeletons = EVERY_STATE.map(([text, ratio]) =>
      badgeSvg(ratio)
        /* everything that is allowed to differ: the figure's characters and its band */
        .split(`>${text}</text>`)
        .join('>VALUE</text>')
        .split(`: ${text}`)
        .join(': VALUE')
        .split(TOKENS[badgeFillToken(ratio)])
        .join('VERDICT'),
    );
    for (const skeleton of skeletons) {
      expect(
        skeleton,
        'a digit count changed something other than the figure and its fill',
      ).toBe(skeletons[0]);
    }
  });

  it('centres every value in its plate, with clearance on both sides', () => {
    const geometry = badgeGeometry();
    const bold = 1.05;
    for (const [text] of EVERY_STATE) {
      const drawn = textWidth(text, badgeFontSize()) * bold;
      const clearance = (geometry.value.width - drawn) / 2;
      expect(clearance, `${text} does not clear its plate`).toBeGreaterThan(2);
      /* text-anchor="middle" at the plate's own midpoint, so the two clearances are
         equal by construction rather than by arithmetic that could drift */
      expect(geometry.value.centreX).toBe(geometry.value.x + geometry.value.width / 2);
      /* the reported allowance is rounded to a hundredth of a unit, so that is the
         tolerance the comparison is entitled to */
      expect(drawn - geometry.valueWidth).toBeLessThanOrEqual(0.01);
    }
  });

  it('leaves the widest value the tightest, and still inside its plate', () => {
    const geometry = badgeGeometry();
    const widest = EVERY_STATE.map(([text]) => textWidth(text, badgeFontSize())).sort(
      (left, right) => right - left,
    )[0];
    expect(widest).toBeCloseTo(textWidth(BADGE_WIDEST_VALUE, badgeFontSize()), 6);
    expect(geometry.valueWidth).toBeGreaterThan(widest ?? 0);
    expect(geometry.valueWidth).toBeLessThan(geometry.value.width);
  });
});

describe('the figure is a whole-number percentage, or n/a', () => {
  it('reads the same formatter the metric rail reads', () => {
    for (const ratio of [0, 0.005, 0.5, 0.874, 0.999, 1]) {
      expect(badgeValue(ratio)).toBe(formatMetricFigure(ratio));
    }
    expect(badgeValue(null)).toBe(formatMetricFigure(null));
  });

  it('never renders a fraction', () => {
    for (const ratio of [0.874, 0.3333, 0.66666, 0.005, 0.995]) {
      expect(badgeValue(ratio)).toMatch(/^\d{1,3}%$/);
      expect(badgeValue(ratio)).not.toContain('.');
    }
  });

  it('rounds 0.875 to 88% and 0.5384 to 54%, never to a decimal place (R9.4)', () => {
    /* The badge is a glance. Half a point of proven coverage is a precision the
       ratio does not carry, so the half rounds up and the decimal never appears.
       Both ratios are figures the committed snapshot has actually carried, which is
       the point of not pinning one of them as *the* figure anywhere in this file. */
    expect(badgeValue(0.875)).toBe('88%');
    expect(badgeValue(0.5384615384615384)).toBe('54%');
    for (const ratio of [0.875, 0.5384615384615384]) {
      expect(parseSvg(badgeSvg(ratio)).textContent ?? '').not.toContain('.');
    }
  });

  it('withholds rather than reporting zero when there is no figure (R9.3)', () => {
    expect(badgeValue(null)).toBe(NOT_APPLICABLE);
    expect(badgeValue(null)).not.toBe('0%');
  });

  it('throws on a ratio outside the unit interval rather than clamping it', () => {
    for (const impossible of [1.01, -0.01, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => badgeSvg(impossible), `${impossible} should not render`).toThrow(RangeError);
    }
  });
});

describe('the verdict fill follows the bands of §10.11, on the displayed figure', () => {
  it('places each band and each boundary on the right side of it', () => {
    const cases: readonly (readonly [number | null, string])[] = [
      [null, '--verdict-undesigned'],
      [0, '--verdict-red'],
      [0.39, '--verdict-red'],
      [0.394, '--verdict-red'],
      [0.395, '--verdict-stale'],
      [0.4, '--verdict-stale'],
      [0.79, '--verdict-stale'],
      [0.794, '--verdict-stale'],
      [0.795, '--verdict-proven'],
      [0.8, '--verdict-proven'],
      [1, '--verdict-proven'],
    ];
    for (const [ratio, token] of cases) {
      expect(badgeFillToken(ratio), `ratio ${String(ratio)} landed in the wrong band`).toBe(token);
    }
  });

  it('paints whatever band the committed snapshot is in, and names it', () => {
    /* Read from the file rather than pinned: the figure moves with every run, and a
       test that hardcoded today's band would fail for the wrong reason tomorrow. */
    const ratio = snapshot.metrics.provenCoverage;
    const token = badgeFillToken(ratio);
    expect(
      ['--verdict-proven', '--verdict-stale', '--verdict-red', '--verdict-undesigned'],
    ).toContain(token);
    expect(badgeSvg(ratio)).toContain(`fill="${TOKENS[token]}"`);
    /* and the two bands the endpoint can actually be in today, asserted as examples */
    expect(badgeFillToken(0.875)).toBe('--verdict-proven');
    expect(badgeFillToken(0.5384615384615384)).toBe('--verdict-stale');
  });

  it('agrees with the number beside it at every rounding boundary', () => {
    /* 0.7996 displays as 80%, so it must be green: the colour is a function of the
       displayed figure, never of the raw ratio. */
    expect(badgeValue(0.7996)).toBe('80%');
    expect(badgeFillToken(0.7996)).toBe('--verdict-proven');
    expect(badgeValue(0.3951)).toBe('40%');
    expect(badgeFillToken(0.3951)).toBe('--verdict-stale');
  });

  it('paints the withheld figure in the neutral token, not in red', () => {
    expect(badgeFillToken(null)).toBe('--verdict-undesigned');
    expect(badgeSvg(null)).toContain(`fill="${TOKENS['--verdict-undesigned']}"`);
    expect(badgeSvg(null)).not.toContain(TOKENS['--verdict-red']);
  });
});

describe('the badge escapes what it embeds', () => {
  it('escapes all five predefined entities, ampersand first', () => {
    expect(escapeXml('a & b')).toBe('a &amp; b');
    expect(escapeXml('<tag>')).toBe('&lt;tag&gt;');
    expect(escapeXml('"quoted"')).toBe('&quot;quoted&quot;');
    expect(escapeXml("it's")).toBe('it&apos;s');
    expect(escapeXml('&lt;')).toBe('&amp;lt;');
  });

  it('escapes the font stack, which quotes a family name', () => {
    expect(TOKENS['--font-ui']).toContain('"Segoe UI"');
    const svg = badgeSvg(0.875);
    expect(svg).toContain('&quot;Segoe UI&quot;');
    /* no raw double quote may survive inside an attribute value */
    expect(svg).not.toContain('"Segoe UI"');
  });
});

describe('both states are well-formed SVG, the live one and the fallback', () => {
  it('parses the figure a reader meets first and the withheld fallback alike', () => {
    for (const [text, ratio] of EVERY_STATE) {
      const root = parseSvg(badgeSvg(ratio));
      expect(root.nodeName, `${text} did not parse to an svg root`).toBe('svg');
      expect(root.nodeName).not.toContain('parsererror');
      expect(root.getElementsByTagName('svg').length, 'nested svg root').toBe(0);
      expect(root.textContent ?? '').toBe(`${badgeTitle(ratio)}${BADGE_LABEL}${text}`);
    }
  });

  it('makes the fallback the same badge, not a smaller or emptier one', () => {
    /* `n/a` is the secondary state now that the snapshot carries a figure, and it has
       to look like a decision. Same frame, same plates, same seam, same baseline;
       only the stone fill and three characters differ. */
    const withheld = badgeSvg(null);
    const proven = badgeSvg(0.875);
    expect(withheld.length).toBeGreaterThan(0);
    expect(paths(withheld)).toEqual(paths(proven));
    expect(textRun(withheld, BADGE_LABEL)).toBe(textRun(proven, BADGE_LABEL));
    expect(withheld).toContain(`>${NOT_APPLICABLE}</text>`);
    expect(withheld).not.toContain('>0%</text>');
  });
});

describe('the endpoint answers an SVG image, and answers nothing else', () => {
  it('exports GET and no other verb, no server action and no default', () => {
    const exported = Object.keys(badgeRoute).sort();
    expect(exported).toEqual(['GET', 'dynamic']);
    expect(typeof badgeRoute.GET).toBe('function');
    for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'default']) {
      expect(verb in badgeRoute, `${verb} must not be exported (R9.4)`).toBe(false);
    }
  });

  it('is force-static, so the response is a build artefact and not a handler call', () => {
    expect(badgeRoute.dynamic).toBe('force-static');
  });

  it('responds with image/svg+xml and the cache policy §10.11 fixes (R9.5)', async () => {
    const response = badgeRoute.GET();
    expect(response.headers.get('content-type')).toBe(BADGE_CONTENT_TYPE);
    expect(response.headers.get('cache-control')).toBe(BADGE_CACHE_CONTROL);
    expect(badgeHeaders()).toEqual({
      'content-type': BADGE_CONTENT_TYPE,
      'cache-control': BADGE_CACHE_CONTROL,
    });
    expect(await response.text()).toBe(badgeSvg(snapshot.metrics.provenCoverage));
  });

  it('reports the committed snapshot’s own proven figure, whichever state it is in', async () => {
    const ratio = SnapshotMetricsSchema.parse(snapshot.metrics).provenCoverage;
    const body = await badgeRoute.GET().text();

    if (ratio === null) {
      // Withheld: `n/a` on the undesigned band, and never a zero (R2.11).
      expect(body).toContain(`>${NOT_APPLICABLE}</text>`);
      expect(body).not.toContain('>0%</text>');
      expect(body).toContain(TOKENS['--verdict-undesigned']);
      return;
    }
    // Present: the whole-number percentage of the ratio in the file, and nothing
    // rounded on the way through, `badgeSvg` is the one formatter.
    expect(body).toContain(`>${String(Math.round(ratio * 100))}%</text>`);
    expect(body).not.toContain(`>${NOT_APPLICABLE}</text>`);
    expect(body).toBe(badgeSvg(ratio));
    expect(parseSvg(body).nodeName).toBe('svg');
  });

  it('withholds rather than zeroing when the proven figure is absent', async () => {
    // The other arm, asserted directly rather than left to whichever state the
    // committed file happens to be in: a withheld figure is `n/a`, never `0%`.
    const withheld = badgeSvg(null);
    expect(withheld).toContain(`>${NOT_APPLICABLE}</text>`);
    expect(withheld).not.toContain('>0%</text>');
    expect(withheld).toContain(TOKENS['--verdict-undesigned']);
  });
});
