/**
 * The proven-coverage badge, as a string. Design §10.11, §10.4.2 (the measured
 * inversion), §10.7, R9.3, R9.4, R9.5, and Property 25.
 *
 * A hand-written 110×20 SVG in the shields idiom: a label half reading
 * `promises kept` on paper, a value half carrying proven coverage as a
 * whole-number percentage on a verdict fill, and a 1px ink frame that also forms
 * the seam between them. That is the whole of it. No gradient, no logo, no shadow:
 * an SVG served as an image cannot rely on the page's light model (§10.5), so it
 * is deliberately flat, and §18 names badge polish as the kind of thing that must
 * not introduce a gradient later either. **All the polish here is geometry, weight and
 * spacing; not one new colour enters the image.**
 *
 * The generator lives here rather than in the route for one reason: a route is a
 * request boundary and this is a pure function of one ratio, so Property 25 can
 * generate a thousand snapshots and assert the output parses as XML without a
 * request or a server anywhere. The route becomes four lines that export `GET` and
 * nothing else (R9.4).
 *
 * Five things this module refuses to do:
 *
 * 1. **Format the percentage itself.** The text comes from `formatMetricFigure`,
 *    the same formatter the metric rail's figure runs through, so the badge and the
 *    rail cannot disagree about a number a reader sees in both places. A ratio of
 *    `null` (no promises at all, or a degraded graph withholding the proven axis)
 *    is the literal `n/a` with no division performed (R9.3). The committed snapshot
 *    carries a figure rather than withholding one, so a percentage is the state a
 *    reader meets first and `n/a` is the fallback; both are drawn by the same
 *    geometry, which is what keeps the fallback looking deliberate.
 * 2. **Clamp a ratio outside the unit interval.** `wholePercent` throws, and this
 *    module does not catch it. A ratio above one is a promise counted twice
 *    upstream, and rendering `100%` for it would hide exactly the sort of
 *    dishonest number the product exists to refuse.
 * 3. **Invent a colour.** Every fill resolves through `TOKENS`, and the image is
 *    closed at four values: `--ink-100` paper under the label, `--text-100` ink for
 *    the frame and the label, one verdict fill, and `--ink-000` for the figure on
 *    it. The frame reuses the label's own ink rather than reaching for
 *    `--text-000`, because a 110×20 image gains nothing from a third grey and the
 *    four values here are exactly the four §10.4.2 measures by name. The lowest of
 *    them is 5.51:1, and the contrast suite asserts all four in both directions.
 * 4. **Invent a type size.** The size is `--fs-micro`, the tag size of §10.4.1,
 *    converted from rem once, because a badge is a tag that happens to be an image, and
 *    two sources for one size is how they drift.
 * 5. **Guess where the text ends.** Every plate edge, every centre and the shared
 *    baseline are derived from a glyph-advance table (see `GLYPH_ADVANCE`) rather
 *    than typed in. That is what keeps `9%`, `88%`, `100%` and `n/a` all sitting
 *    correctly instead of only the one that happened to be measured by eye.
 *
 * DOM-free and dependency-free: it builds a string. The repository's no-DOM root
 * project type-checks it, and a Node test can compare bytes without a browser.
 */

import { formatMetricFigure, wholePercent } from './metricRail.js';
import { TOKENS, type TokenName } from './tokens.js';

/** Verbatim from design §10.11. Both are user units in the badge's own viewBox. */
export const BADGE_WIDTH = 110;
export const BADGE_HEIGHT = 20;

/** The words on the label plate. Verbatim from §10.11. */
export const BADGE_LABEL = 'promises kept';

/** What the endpoint answers with (R9.5). */
export const BADGE_CONTENT_TYPE = 'image/svg+xml';

/**
 * Five minutes, verbatim from §10.11.
 *
 * Short enough that a re-deployed ledger shows its new figure while a reader is
 * still looking at the README, long enough that a badge embedded in a busy page is
 * not re-fetched on every view. The response is statically generated either way,
 * so this governs caches rather than any work of ours.
 */
export const BADGE_CACHE_CONTROL = 'public, max-age=300';

/** The outer corner radius, from `--r-chip`: a badge is a chip that is an image. */
export const BADGE_RADIUS = 2;

/**
 * The ink frame, in user units, and the width of the seam, which is the same ink
 * showing through the gap between the two plates.
 *
 * A badge is embedded in a README, which is white. `--ink-100` is `#FCFCF9`, so
 * without an edge the label half dissolves into the page and the badge reads as a
 * loose coloured chip with some words floating beside it. One unit of ink is what
 * makes it a plate. It is deliberately *not* `--line`'s 2px: on a 20-unit strip a
 * 2px frame plus 2px of padding leaves the eleven-pixel type nothing to sit in,
 * and the structural border of §10.4.1 is sized for a card, not for an image the
 * size of a word.
 *
 * The frame is drawn as a **fill** (one rect under both plates) rather than as a
 * stroke. A stroke would need `fill="none"`, and the fills of this image are
 * enumerated by Property 25 precisely so that no colour can arrive unnoticed; a
 * value that is not a colour has no business in that list.
 */
export const BADGE_EDGE = 1;

/**
 * Root font size a standalone SVG resolves `rem` against in every user agent.
 */
const ROOT_FONT_PX = 16;

/**
 * Advance widths in units per 1000 em, for the glyphs this badge can render and no
 * others.
 *
 * Measuring text properly needs a font engine, and the badge has to be identical
 * on every machine that builds it, so the widths are tabulated here instead. That is
 * the approach shields.io takes, for the same reason. The values are the
 * Helvetica/Arial advances, which is the right reference for a stack that resolves
 * to San Francisco, Segoe UI or Roboto: those three sit within about two percent of
 * it over this glyph set, and the label's advance is *forced* to the tabulated
 * figure by `textLength` anyway (see {@link badgeSvg}), so a small error moves
 * letter-spacing rather than moving a plate edge.
 *
 * The set is closed by construction: the label is a constant and the value is
 * `formatMetricFigure`'s output, which is `n/a` or one to three digits and a
 * percent sign. {@link textWidth} throws on anything else rather than substituting
 * a default width. A badge that silently mis-measured would still render, which is
 * the worst way for this to fail.
 */
const GLYPH_ADVANCE: Readonly<Record<string, number>> = {
  ' ': 278,
  '%': 889,
  '/': 278,
  '0': 556,
  '1': 556,
  '2': 556,
  '3': 556,
  '4': 556,
  '5': 556,
  '6': 556,
  '7': 556,
  '8': 556,
  '9': 556,
  a: 556,
  e: 556,
  i: 222,
  k: 500,
  m: 833,
  n: 556,
  o: 556,
  p: 556,
  r: 333,
  s: 500,
  t: 278,
};

/** Helvetica's cap height, per 1000 em. The digits' height, and so the baseline's. */
const CAP_HEIGHT = 717;

/**
 * How much wider the bold face sets than the regular one, as a multiplier.
 *
 * Used as an **allowance**, not as a measurement. The value is the one run in the
 * image whose advance is not forced, because forcing it would spend the whole
 * correction closing the single inter-glyph gap of `9%` (see {@link badgeSvg}), so
 * the plate that holds it is sized for the widest value *as bold*. Five percent is the spread
 * these families show across digits and a percent sign; erring high costs a fraction
 * of a unit of padding, erring low costs a clipped figure.
 */
const BOLD_ALLOWANCE = 1.05;

/**
 * The label's weight, and the value's.
 *
 * The badge cannot use the one device shields uses to make eleven-pixel type carry
 * on a coloured plate: a second text run offset a pixel down at thirty percent
 * opacity, which is a shadow, and shadows are `--occlude` or nothing here (§10.4).
 * Weight is the substitute, and it costs no colour: the figure goes bold so it is
 * the loudest thing in the image and the label stays regular under it, which is a
 * wider separation than a step of medium would have bought.
 *
 * Regular and bold specifically, and no intermediate weight, because those are the
 * two faces every family `--font-ui` names actually ships. Segoe UI has no 500 and
 * Roboto has no 600, so a middle weight resolves to a different face on Windows than
 * on Android, sometimes synthesised, and a badge whose weight changes by operating
 * system is a badge whose tabulated advances are wrong on one of them.
 */
export const BADGE_LABEL_WEIGHT = '400';
export const BADGE_VALUE_WEIGHT = '700';

/**
 * Tabular, lining numerals on the figure. Design §10.7, non-negotiable there and
 * for the same reason here.
 *
 * `9%`, `88%` and `100%` are the same badge in three digit counts. With
 * proportional figures the `1` of `100%` is narrower than the `8` of `88%`, so a
 * centred value drifts as the number moves and two screenshots of the same badge do
 * not line up. Tabular advances make the run grow in exact digit steps about its own
 * centre.
 *
 * Carried in a `style` attribute rather than as a presentation attribute:
 * `font-variant-numeric` only became one in SVG 2 and support for it in that form
 * is uneven, while a style attribute is honoured by every renderer that draws an
 * `<img>`.
 */
export const BADGE_NUMERIC_STYLE = 'font-variant-numeric: tabular-nums lining-nums';

/**
 * The badge's type size in user units, from `--fs-micro`.
 *
 * An SVG served as an image has no document to inherit a scale from, so the size
 * has to be absolute, and taking it from the token rather than typing `11` means
 * the badge is the same size as a verdict tag by construction. Throws rather than
 * guessing if the token stops being expressed in rem: a silently mis-sized badge
 * would still render, which is the worst way for this to fail.
 */
export function badgeFontSize(): number {
  const declared = TOKENS['--fs-micro'];
  const match = /^([0-9.]+)rem$/.exec(declared.trim());
  const rem = match === null ? Number.NaN : Number(match[1]);
  if (!Number.isFinite(rem)) {
    throw new Error(
      `--fs-micro is "${declared}", which is not a rem length. The badge is an image with ` +
        `no document to inherit a scale from, so its size must be absolute. Convert the ` +
        `token here deliberately rather than letting the badge guess.`,
    );
  }
  return rem * ROOT_FONT_PX;
}

/** Two decimal places. One hundredth of a user unit is finer than any renderer. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The advance width of `text` at `fontSize`, in user units.
 *
 * Throws on a glyph the table does not carry. The alternative, a default width,
 * would let a new character through at whatever the default happened to be, and the
 * first sign of it would be a figure sitting off centre in a README somewhere.
 */
export function textWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const glyph of text) {
    const advance = GLYPH_ADVANCE[glyph];
    if (advance === undefined) {
      throw new Error(
        `The badge cannot measure "${glyph}" (in "${text}"): it is not in the badge's ` +
          `glyph-advance table. The label is a constant and the value is a percentage or ` +
          `"n/a", so a new glyph means a deliberate change: add its advance to ` +
          `GLYPH_ADVANCE rather than letting the layout guess at it.`,
      );
    }
    units += advance;
  }
  return (units / 1000) * fontSize;
}

/** The widest string the value plate ever has to hold. */
export const BADGE_WIDEST_VALUE = '100%';

/** One plate: where it starts and how wide it is, in user units. */
export interface BadgePlate {
  readonly x: number;
  readonly width: number;
  /** The plate's own midpoint, which is where its text is anchored. */
  readonly centreX: number;
  /** Clear space between the text and the plate's edge, on each side. */
  readonly padding: number;
}

/** Everything the badge's geometry is, derived rather than typed. */
export interface BadgeGeometry {
  readonly fontSize: number;
  /** The frame, and the seam: one unit of ink, drawn as a fill. */
  readonly edge: number;
  readonly radius: number;
  /** The plates' radius: the outer one less the frame it sits inside. */
  readonly innerRadius: number;
  readonly label: BadgePlate;
  readonly value: BadgePlate;
  /** Where the label plate ends and the seam begins. */
  readonly splitX: number;
  /** The advance the label is held to, whatever font the renderer resolves. */
  readonly labelWidth: number;
  /** The widest value's advance, with the bold allowance applied. */
  readonly valueWidth: number;
  /** The one baseline both runs sit on. */
  readonly baselineY: number;
}

/**
 * The badge's geometry, in one place, computed from the type size and the metrics.
 *
 * The layout is a division of a fixed 110 units. `promises kept` at eleven pixels
 * needs 68.46 of them and `100%` bold needs 29.53, the frame and the seam take
 * three between them, and what is left, nine units, is split four ways as equal
 * padding inside the two plates. That lands the seam at 74, which is where it was
 * chosen by eye before this function existed; the point is not that the number
 * moved but that it is now a consequence of the type size rather than a constant
 * that would quietly stop being right if `--fs-micro` did.
 *
 * The seam is snapped to a whole unit deliberately. A one-unit ink line at a
 * fractional x is antialiased into two grey lines, and at this size that reads as a
 * rendering fault rather than as a rule; a third of a unit of padding asymmetry is
 * invisible by comparison.
 *
 * Throws if either run no longer fits. A badge whose text has crossed its own seam
 * is broken in a way no reader can diagnose, so it fails at build time instead.
 */
export function badgeGeometry(): BadgeGeometry {
  const fontSize = badgeFontSize();
  const edge = BADGE_EDGE;
  const labelWidth = textWidth(BADGE_LABEL, fontSize);
  const valueWidth = textWidth(BADGE_WIDEST_VALUE, fontSize) * BOLD_ALLOWANCE;

  /* Two plates and a seam sit inside the frame; the slack left over is four equal
     paddings, and the seam falls at the whole unit nearest that division. */
  const textSpace = BADGE_WIDTH - 2 * edge - edge;
  const padding = (textSpace - labelWidth - valueWidth) / 4;
  const splitX = Math.round(edge + labelWidth + 2 * padding);

  const labelPlateWidth = splitX - edge;
  const valuePlateX = splitX + edge;
  const valuePlateWidth = BADGE_WIDTH - edge - valuePlateX;

  const label: BadgePlate = {
    x: edge,
    width: labelPlateWidth,
    centreX: round2(edge + labelPlateWidth / 2),
    padding: round2((labelPlateWidth - labelWidth) / 2),
  };
  const value: BadgePlate = {
    x: valuePlateX,
    width: valuePlateWidth,
    centreX: round2(valuePlateX + valuePlateWidth / 2),
    padding: round2((valuePlateWidth - valueWidth) / 2),
  };

  for (const [plate, name] of [
    [label, BADGE_LABEL],
    [value, BADGE_WIDEST_VALUE],
  ] as const) {
    if (plate.padding <= 0) {
      throw new Error(
        `"${name}" no longer fits its plate: ${plate.width} units of plate for ` +
          `${round2(plate.width - 2 * plate.padding)} units of text. The badge is fixed at ` +
          `${BADGE_WIDTH}×${BADGE_HEIGHT} by design §10.11, so a type size that outgrows it ` +
          `is a decision to take in the design, not a value to clip here.`,
      );
    }
  }

  /* One baseline for both runs, since two would read as a fault, placed so the digits,
     which stand exactly one cap height tall, are optically centred in the plate
     interior. Derived, so a change to --fs-micro moves it rather than stranding it. */
  const capHeight = (CAP_HEIGHT / 1000) * fontSize;
  const interiorHeight = BADGE_HEIGHT - 2 * edge;

  return {
    fontSize,
    edge,
    radius: BADGE_RADIUS,
    innerRadius: BADGE_RADIUS - edge,
    label,
    value,
    splitX,
    labelWidth: round2(labelWidth),
    valueWidth: round2(valueWidth),
    baselineY: round2(edge + (interiorHeight + capHeight) / 2),
  };
}

/**
 * The verdict band a proven-coverage ratio falls in. Verbatim from §10.11.
 *
 * Eighty and above is proven, forty to seventy-nine is stale, below forty is red,
 * and a withheld figure is the neutral `undesigned` token. The bands are compared
 * on the **whole-number percentage the badge displays**, not on the raw ratio, so
 * the colour can never disagree with the number beside it: a ratio of 0.7996
 * displays as `80%` and is therefore green, and a reader who checks the arithmetic
 * finds the badge right rather than off by a rounding.
 */
export function badgeFillToken(ratio: number | null): TokenName {
  if (ratio === null) return '--verdict-undesigned';
  const percent = wholePercent(ratio);
  if (percent >= 80) return '--verdict-proven';
  if (percent >= 40) return '--verdict-stale';
  return '--verdict-red';
}

/** The value text: a whole-number percentage, or the literal `n/a` (R9.3, R9.4). */
export function badgeValue(ratio: number | null): string {
  return formatMetricFigure(ratio);
}

/** The badge's accessible name, and its `<title>`. */
export function badgeTitle(ratio: number | null): string {
  return `${BADGE_LABEL}: ${badgeValue(ratio)}`;
}

/**
 * XML-escapes a value for an attribute or for text.
 *
 * `--font-ui` names `"Segoe UI"` in double quotes, so the family list cannot go
 * into a double-quoted attribute unescaped, and an escaper that handled only that
 * one case would be a note to a future reader that the next value is on its own.
 * All five predefined entities, ampersand first so the replacements cannot cascade.
 */
export function escapeXml(value: string): string {
  return value
    .split('&')
    .join('&amp;')
    .split('<')
    .join('&lt;')
    .split('>')
    .join('&gt;')
    .split('"')
    .join('&quot;')
    .split("'")
    .join('&apos;');
}

/** A token's value, escaped for use in an attribute. */
function attr(token: TokenName): string {
  return escapeXml(TOKENS[token]);
}

/**
 * A plate with two of its corners rounded and two square, as a path.
 *
 * The two plates meet at the seam, and a seam between two facing curves is not a
 * seam. `rx` on a rect rounds all four corners, so the plate that abuts the seam
 * has to be drawn rather than declared: `side` names which pair of corners keeps
 * the radius, and the other pair is a right angle. This replaces the square patch
 * the flat version drew over the seam, a shape whose only job was to undo the
 * radius of the shape beneath it.
 */
function platePath(
  plate: BadgePlate,
  side: 'left' | 'right',
  top: number,
  bottom: number,
  radius: number,
): string {
  const left = plate.x;
  const right = plate.x + plate.width;
  /* Arcs sweep clockwise in a y-down viewport, which is sweep-flag 1 throughout. */
  const arc = (x: number, y: number): string => `A${radius} ${radius} 0 0 1 ${x} ${y}`;

  if (side === 'left') {
    return (
      `M${left + radius} ${top}H${right}V${bottom}H${left + radius}` +
      `${arc(left, bottom - radius)}V${top + radius}${arc(left + radius, top)}Z`
    );
  }
  return (
    `M${left} ${top}H${right - radius}${arc(right, top + radius)}V${bottom - radius}` +
    `${arc(right - radius, bottom)}H${left}Z`
  );
}

/**
 * The badge, as SVG.
 *
 * Three shapes and two text runs:
 *
 *   1. the full-bleed ink plate at `--text-100`, rounded at `--r-chip`. Everything
 *      else sits one unit inside it, so this single fill is both the frame and the
 *      seam: the ink between the plates is this rect showing through;
 *   2. the label plate at `--ink-100`, rounded on its left corners and square
 *      against the seam;
 *   3. the value plate on its verdict fill, square against the seam and rounded on
 *      its right corners.
 *
 * The label carries `textLength`, which is the whole reason the geometry holds:
 * `promises kept` is thirteen glyphs measured from a table against a font stack
 * that resolves differently on every operating system, and its plate is sized to
 * the tabulated figure exactly. `lengthAdjust="spacing"` makes the renderer meet
 * that figure by adjusting the gaps between glyphs and never the glyphs, so the run
 * cannot cross the seam on a machine whose sans is two percent wide.
 *
 * The **value deliberately does not** carry one. It is one to four glyphs, so
 * `9%` has a single inter-glyph gap and forcing its advance would spend the whole
 * correction closing that one gap. It is centred in its plate instead, with tabular
 * figures so the three digit counts grow in equal steps about that centre, and the
 * plate is sized for the widest of them at the weight it is set in.
 *
 * `viewBox` matches the width and height exactly, so the badge scales cleanly
 * wherever it is embedded and Property 25 can assert one geometry rather than two.
 */
export function badgeSvg(ratio: number | null): string {
  const value = badgeValue(ratio);
  const fill = badgeFillToken(ratio);
  const geometry = badgeGeometry();
  const { edge, fontSize, innerRadius, baselineY } = geometry;
  const top = edge;
  const bottom = BADGE_HEIGHT - edge;
  const title = escapeXml(badgeTitle(ratio));

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BADGE_WIDTH}" height="${BADGE_HEIGHT}" ` +
    `viewBox="0 0 ${BADGE_WIDTH} ${BADGE_HEIGHT}" role="img" ` +
    `aria-label="${title}">` +
    `<title>${title}</title>` +
    `<rect width="${BADGE_WIDTH}" height="${BADGE_HEIGHT}" rx="${geometry.radius}" ` +
    `fill="${attr('--text-100')}"/>` +
    `<path d="${platePath(geometry.label, 'left', top, bottom, innerRadius)}" ` +
    `fill="${attr('--ink-100')}"/>` +
    `<path d="${platePath(geometry.value, 'right', top, bottom, innerRadius)}" ` +
    `fill="${attr(fill)}"/>` +
    `<g font-family="${attr('--font-ui')}" font-size="${fontSize}" text-anchor="middle">` +
    `<text x="${geometry.label.centreX}" y="${baselineY}" ` +
    `font-weight="${BADGE_LABEL_WEIGHT}" textLength="${geometry.labelWidth}" ` +
    `lengthAdjust="spacing" fill="${attr('--text-100')}">` +
    `${escapeXml(BADGE_LABEL)}</text>` +
    `<text x="${geometry.value.centreX}" y="${baselineY}" ` +
    `font-weight="${BADGE_VALUE_WEIGHT}" style="${escapeXml(BADGE_NUMERIC_STYLE)}" ` +
    `fill="${attr('--ink-000')}">` +
    `${escapeXml(value)}</text>` +
    `</g>` +
    `</svg>`
  );
}

/** The headers §10.11 fixes, as one object the route hands to `Response`. */
export function badgeHeaders(): Record<string, string> {
  return { 'content-type': BADGE_CONTENT_TYPE, 'cache-control': BADGE_CACHE_CONTROL };
}
