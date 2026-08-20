/**
 * The proven-coverage badge, as a string — design §10.11, §10.4.2 (the measured
 * inversion), §10.7, R9.3, R9.4, R9.5, and Property 25.
 *
 * A hand-written 110×20 SVG: the words `promises kept` on `--ink-100`, and proven
 * coverage as a whole-number percentage on a verdict fill, in `--ink-000`. That is
 * the whole of it. No gradient, no logo, no shadow — an SVG served as an image
 * cannot rely on the page's light model (§10.5), so it is deliberately flat, and
 * §18 names badge polish as the kind of thing that must not introduce a gradient
 * later either.
 *
 * The generator lives here rather than in the route for one reason: a route is a
 * request boundary and this is a pure function of one ratio, so Property 25 can
 * generate a thousand snapshots and assert the output parses as XML without a
 * request or a server anywhere. The route becomes four lines that export `GET` and
 * nothing else (R9.4).
 *
 * Four things this module refuses to do:
 *
 * 1. **Format the percentage itself.** The text comes from `formatMetricFigure`,
 *    the same formatter the metric rail's figure runs through, so the badge and the
 *    rail cannot disagree about a number a reader sees in both places. A ratio of
 *    `null` — no promises at all, or a degraded graph withholding the proven axis —
 *    is the literal `n/a` with no division performed (R9.3). That is the live path
 *    today: the committed snapshot is degraded, so this badge reads `n/a`.
 * 2. **Clamp a ratio outside the unit interval.** `wholePercent` throws, and this
 *    module does not catch it. A ratio above one is a promise counted twice
 *    upstream, and rendering `100%` for it would hide exactly the sort of
 *    dishonest number the product exists to refuse.
 * 3. **Invent a colour.** Every fill and every text colour resolves through
 *    `TOKENS`, so the badge is painted from the same palette the pages are, and the
 *    four inverted pairs it produces are the four §10.4.2 measures by name — the
 *    lowest of them is 6.02:1, and the contrast suite asserts all four in both
 *    directions.
 * 4. **Invent a type size.** The size is `--fs-micro`, the tag size of §10.4.1,
 *    converted from rem once — a badge is a tag that happens to be an image, and
 *    two sources for one size is how they drift.
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

/**
 * Where the label plate ends and the value plate begins.
 *
 * Chosen rather than measured, because measuring text needs a font engine and the
 * badge has to be identical on every machine: `promises kept` at eleven pixels
 * occupies roughly sixty-eight user units in every stack `--font-ui` names, so
 * seventy-four leaves it a comfortable margin on both sides, and the remaining
 * thirty-six hold `100%` — the widest value — with the same margin. Both plates are
 * centred on their own midpoint, so a shorter value stays centred rather than
 * drifting left.
 */
export const BADGE_SPLIT_X = 74;

/** The baseline of both text runs, in user units from the top. */
export const BADGE_BASELINE_Y = 14;

/** The corner radius, from `--r-chip`: a badge is a chip that is also an image. */
export const BADGE_RADIUS = 2;

/** Root font size a standalone SVG resolves `rem` against in every user agent. */
const ROOT_FONT_PX = 16;

/**
 * The badge's type size in user units, from `--fs-micro`.
 *
 * An SVG served as an image has no document to inherit a scale from, so the size
 * has to be absolute — and taking it from the token rather than typing `11` means
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
        `no document to inherit a scale from, so its size must be absolute — convert the ` +
        `token here deliberately rather than letting the badge guess.`,
    );
  }
  return rem * ROOT_FONT_PX;
}

/**
 * The verdict band a proven-coverage ratio falls in — verbatim from §10.11.
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
 * into a double-quoted attribute unescaped — and an escaper that handled only that
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
 * The badge, as SVG.
 *
 * Three flat shapes and two text runs:
 *
 *   1. the full-width label plate at `--ink-100`, rounded on both ends;
 *   2. the value plate on its verdict fill, rounded the same way;
 *   3. a square patch over the value plate's left edge, so the seam between the
 *      two plates is a straight line rather than two facing curves. Drawing the
 *      patch in the value's own fill is what keeps the badge to three shapes; a
 *      `clipPath` would need an id, and an id in an SVG inlined twice on one page
 *      collides.
 *
 * `viewBox` matches the width and height exactly, so the badge scales cleanly
 * wherever it is embedded and Property 25 can assert one geometry rather than two.
 */
export function badgeSvg(ratio: number | null): string {
  const value = badgeValue(ratio);
  const fill = badgeFillToken(ratio);
  const fontSize = badgeFontSize();
  const valueWidth = BADGE_WIDTH - BADGE_SPLIT_X;
  const labelMid = BADGE_SPLIT_X / 2;
  const valueMid = BADGE_SPLIT_X + valueWidth / 2;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BADGE_WIDTH}" height="${BADGE_HEIGHT}" ` +
    `viewBox="0 0 ${BADGE_WIDTH} ${BADGE_HEIGHT}" role="img" ` +
    `aria-label="${escapeXml(badgeTitle(ratio))}">` +
    `<title>${escapeXml(badgeTitle(ratio))}</title>` +
    `<rect width="${BADGE_WIDTH}" height="${BADGE_HEIGHT}" rx="${BADGE_RADIUS}" ` +
    `fill="${attr('--ink-100')}"/>` +
    `<rect x="${BADGE_SPLIT_X}" width="${valueWidth}" height="${BADGE_HEIGHT}" ` +
    `rx="${BADGE_RADIUS}" fill="${attr(fill)}"/>` +
    `<rect x="${BADGE_SPLIT_X}" width="${BADGE_RADIUS}" height="${BADGE_HEIGHT}" ` +
    `fill="${attr(fill)}"/>` +
    `<g font-family="${attr('--font-ui')}" font-size="${fontSize}" text-anchor="middle">` +
    `<text x="${labelMid}" y="${BADGE_BASELINE_Y}" fill="${attr('--text-100')}">` +
    `${escapeXml(BADGE_LABEL)}</text>` +
    `<text x="${valueMid}" y="${BADGE_BASELINE_Y}" fill="${attr('--ink-000')}">` +
    `${escapeXml(value)}</text>` +
    `</g>` +
    `</svg>`
  );
}

/** The headers §10.11 fixes, as one object the route hands to `Response`. */
export function badgeHeaders(): Record<string, string> {
  return { 'content-type': BADGE_CONTENT_TYPE, 'cache-control': BADGE_CACHE_CONTROL };
}
