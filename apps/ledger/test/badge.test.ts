/**
 * The badge, asserted — design §10.11, §10.4.2, R9.3, R9.4, R9.5.
 *
 * Three halves.
 *
 * The **string** half pins what §10.11 fixes: a 110×20 flat SVG, the words
 * `promises kept` on the ink plate, the figure on a verdict fill chosen by band,
 * the figure's text in `--ink-000`, and no gradient, no shadow and no logo — §18
 * names badge polish as the place a gradient would try to arrive later, so the
 * absence is asserted rather than assumed.
 *
 * The **band** half walks the boundaries of the four bands from both sides. Eighty
 * is proven and seventy-nine is not; forty is stale and thirty-nine is not. The
 * comparison is made on the percentage the badge *displays*, which is the detail
 * worth a test of its own: a ratio a hair under 0.8 displays as `80%`, so it has to
 * be green, or a reader who checks the arithmetic finds a badge that disagrees with
 * itself.
 *
 * The **endpoint** half calls the route directly. It exports `GET` and nothing
 * else (R9.4), answers `image/svg+xml` (R9.5), and — the live path today — reports
 * `n/a` rather than `0%`, because the committed snapshot is degraded and withholds
 * the proven figure entirely.
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
  BADGE_HEIGHT,
  BADGE_LABEL,
  BADGE_RADIUS,
  BADGE_SPLIT_X,
  BADGE_WIDTH,
  badgeFillToken,
  badgeFontSize,
  badgeHeaders,
  badgeSvg,
  badgeTitle,
  badgeValue,
  escapeXml,
} from '../lib/badge.js';
import { NOT_APPLICABLE, formatMetricFigure } from '../lib/metricRail.js';
import { snapshot } from '../lib/snapshot.js';
import { TOKENS } from '../lib/tokens.js';

describe('the badge is the 110 by 20 flat plate design §10.11 specifies', () => {
  it('declares that geometry once, in the attributes and in the viewBox', () => {
    const svg = badgeSvg(0.87);
    expect(BADGE_WIDTH).toBe(110);
    expect(BADGE_HEIGHT).toBe(20);
    expect(svg).toContain(`width="${BADGE_WIDTH}"`);
    expect(svg).toContain(`height="${BADGE_HEIGHT}"`);
    expect(svg).toContain(`viewBox="0 0 ${BADGE_WIDTH} ${BADGE_HEIGHT}"`);
  });

  it('carries the label on the ink plate and the figure in inverted ink', () => {
    const svg = badgeSvg(0.87);
    expect(svg).toContain(`>${BADGE_LABEL}</text>`);
    expect(svg).toContain(`fill="${TOKENS['--ink-100']}"`);
    expect(svg).toContain(`fill="${TOKENS['--text-100']}"`);
    expect(svg).toContain(`fill="${TOKENS['--ink-000']}"`);
  });

  it('is flat: no gradient, no shadow, no filter, no image and no script', () => {
    const svg = badgeSvg(0.87);
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
  });

  it('splits the two plates and squares their seam, in three shapes and no more', () => {
    const svg = badgeSvg(0.87);
    const rects = svg.match(/<rect\b/g) ?? [];
    expect(rects.length).toBe(3);
    expect(svg).toContain(`x="${BADGE_SPLIT_X}"`);
    expect(svg).toContain(`rx="${BADGE_RADIUS}"`);
    /* the seam patch is the split's width and carries no radius of its own */
    expect(svg).toContain(`x="${BADGE_SPLIT_X}" width="${BADGE_RADIUS}"`);
  });

  it('takes its type size from --fs-micro rather than from a number typed here', () => {
    expect(TOKENS['--fs-micro']).toBe('0.6875rem');
    expect(badgeFontSize()).toBe(11);
    expect(badgeSvg(0.87)).toContain(`font-size="${badgeFontSize()}"`);
  });

  it('names an accessible title matching the figure it draws', () => {
    expect(badgeTitle(0.87)).toBe('promises kept: 87%');
    expect(badgeTitle(null)).toBe(`promises kept: ${NOT_APPLICABLE}`);
    expect(badgeSvg(null)).toContain(`<title>promises kept: ${NOT_APPLICABLE}</title>`);
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
    const svg = badgeSvg(0.87);
    expect(svg).toContain('&quot;Segoe UI&quot;');
    /* no raw double quote may survive inside an attribute value */
    expect(svg).not.toContain('"Segoe UI"');
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

  it('reports n/a for the committed snapshot, because the proven axis is withheld', async () => {
    expect(SnapshotMetricsSchema.parse(snapshot.metrics).provenCoverage).toBeNull();
    const body = await badgeRoute.GET().text();
    expect(body).toContain(`>${NOT_APPLICABLE}</text>`);
    expect(body).not.toContain('>0%</text>');
    expect(body).toContain(TOKENS['--verdict-undesigned']);
  });
});
