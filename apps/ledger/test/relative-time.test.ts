/**
 * Freshness formatting — task 9.2, design §10.10, R9.6, R9.7.
 *
 * The examples that matter are the three the design document names by hand: the
 * null state, the exact 24-hour instant, and the millisecond past it. Property 24
 * (`relative-time.prop.test.ts`) generalises the ordering; this file pins the
 * boundary and the words.
 */

import { describe, expect, it } from 'vitest';

import {
  FRESHNESS_TOKENS,
  JUST_NOW,
  NEVER_VERIFIED,
  RELATIVE_UNITS,
  STALE_AFTER_MS,
  UNREADABLE_TIMESTAMP,
  formatFreshness,
  formatParts,
  relativeTimeParts,
  renderFreshness,
  toEpochMs,
} from '../lib/relativeTime.js';
import { snapshot } from '../lib/snapshot.js';

const NOW = '2026-08-20T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);

/** The rendering for an age in milliseconds, measured back from `NOW`. */
function aged(ageMs: number) {
  return formatFreshness(new Date(NOW_MS - ageMs).toISOString(), NOW);
}

describe('the null state', () => {
  it('reads `never verified` and invents no age', () => {
    const rendering = formatFreshness(null, NOW);
    expect(rendering.text).toBe(NEVER_VERIFIED);
    expect(rendering.tone).toBe('unverified');
    expect(rendering.token).toBe('--text-200');
    expect(rendering.ageMs).toBeNull();
    expect(rendering.parts).toBeNull();
    expect(rendering.at).toBeNull();
  });

  it('is what the committed snapshot renders, because nothing has run yet', () => {
    const rendering = renderFreshness(snapshot.freshness, NOW);
    expect(rendering.text).toBe(NEVER_VERIFIED);
    expect(rendering.tone).toBe('unverified');
  });
});

describe('the 24-hour boundary is strict (R9.7)', () => {
  it('is not ochre at exactly 24 hours', () => {
    const rendering = aged(STALE_AFTER_MS);
    expect(rendering.ageMs).toBe(STALE_AFTER_MS);
    expect(rendering.tone).toBe('current');
    expect(rendering.token).toBe('--text-100');
    expect(rendering.text).toBe('1 day ago');
  });

  it('is ochre one millisecond later', () => {
    const rendering = aged(STALE_AFTER_MS + 1);
    expect(rendering.tone).toBe('stale');
    expect(rendering.token).toBe('--verdict-stale');
  });

  it('is not ochre one millisecond earlier', () => {
    expect(aged(STALE_AFTER_MS - 1).tone).toBe('current');
  });

  it('maps every tone to a distinct token, with ochre reserved for stale', () => {
    expect(FRESHNESS_TOKENS.stale).toBe('--verdict-stale');
    expect(FRESHNESS_TOKENS.current).not.toBe('--verdict-stale');
    expect(FRESHNESS_TOKENS.unverified).not.toBe('--verdict-stale');
  });
});

describe('the words', () => {
  it('reads `just now` below the five-second floor, with no unit', () => {
    expect(aged(0).text).toBe(JUST_NOW);
    expect(aged(4_999).text).toBe(JUST_NOW);
    expect(aged(0).parts).toBeNull();
  });

  it('walks second → minute → hour → day, coarsest unit that is still true', () => {
    expect(aged(5_000).text).toBe('5 seconds ago');
    expect(aged(59_999).text).toBe('59 seconds ago');
    expect(aged(60_000).text).toBe('1 minute ago');
    expect(aged(2 * 60_000).text).toBe('2 minutes ago');
    expect(aged(59 * 60_000 + 59_999).text).toBe('59 minutes ago');
    expect(aged(60 * 60_000).text).toBe('1 hour ago');
    expect(aged(23 * 3_600_000).text).toBe('23 hours ago');
    expect(aged(47 * 3_600_000).text).toBe('1 day ago');
    expect(aged(94 * 86_400_000).text).toBe('94 days ago');
  });

  it('pluralises on the numeral, not on the unit', () => {
    expect(formatParts({ unitIndex: 1, unit: 'minute', value: 1 })).toBe('1 minute');
    expect(formatParts({ unitIndex: 1, unit: 'minute', value: 0 })).toBe('0 minutes');
    expect(formatParts({ unitIndex: 3, unit: 'day', value: 2 })).toBe('2 days');
  });

  it('names the units in ascending coarseness', () => {
    expect(RELATIVE_UNITS).toStrictEqual(['second', 'minute', 'hour', 'day']);
    expect(relativeTimeParts(STALE_AFTER_MS)).toStrictEqual({
      unitIndex: 3,
      unit: 'day',
      value: 1,
    });
  });
});

describe('adversity', () => {
  it('clamps a future timestamp to no measurable age rather than a negative one', () => {
    const rendering = aged(-60 * 60_000);
    expect(rendering.ageMs).toBe(0);
    expect(rendering.text).toBe(JUST_NOW);
    expect(rendering.tone).toBe('current');
  });

  it('never renders an invalid date', () => {
    const rendering = formatFreshness('not a timestamp', NOW);
    expect(rendering.text).toBe(UNREADABLE_TIMESTAMP);
    expect(rendering.text).not.toMatch(/NaN|Invalid/);
    expect(rendering.tone).toBe('unverified');
    expect(rendering.token).not.toBe('--verdict-stale');
    expect(rendering.ageMs).toBeNull();
    // The timestamp is still surfaced, so a reader can see what could not be read.
    expect(rendering.at).toBe('not a timestamp');
  });

  it('treats an unreadable reference time the same way', () => {
    expect(formatFreshness(NOW, 'later').text).toBe(UNREADABLE_TIMESTAMP);
  });

  it('reads an instant from a string, a number or a Date', () => {
    expect(toEpochMs(NOW)).toBe(NOW_MS);
    expect(toEpochMs(NOW_MS)).toBe(NOW_MS);
    expect(toEpochMs(new Date(NOW_MS))).toBe(NOW_MS);
    expect(toEpochMs('nonsense')).toBeNull();
    expect(toEpochMs(Number.NaN)).toBeNull();
  });

  it('reads the clock from its argument and never from the host', () => {
    const first = formatFreshness('2026-08-19T12:00:00.000Z', NOW);
    const second = formatFreshness('2026-08-19T12:00:00.000Z', NOW);
    expect(first).toStrictEqual(second);
  });
});
