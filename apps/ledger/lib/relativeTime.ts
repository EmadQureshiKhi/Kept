/**
 * Freshness as a string and a tone — design §10.10, R9.6, R9.7, Property 24.
 *
 * One function decides how old the newest consumed terminal event is, how that
 * age reads in words, and which side of the 24-hour boundary it falls on.
 * `FreshnessChip` renders what this returns and decides nothing, so there is
 * exactly one authority on the boundary.
 *
 * Four rules, each of them load-bearing:
 *
 * 1. **The boundary is strict.** Ochre begins *above* 24 hours (R9.7), so an age
 *    of exactly 24 h is current and 24 h plus one millisecond is stale. A `>=`
 *    here would make a run that just crossed a day read as stale a millisecond
 *    early, and the direction of that error matters: the ledger should never call
 *    something stale it cannot show is stale, and never call something current it
 *    cannot show is current.
 * 2. **`null` is a state, not a missing value.** No terminal event has ever been
 *    consumed, so the chip reads `never verified` (§10.10) and no age is computed.
 *    There is no fabricated timestamp and no "just now" for a run that never ran.
 * 3. **`now` is a parameter.** Nothing here reads the clock. Two calls with the
 *    same arguments produce the same output on every machine, which is what keeps
 *    a static render, a screenshot and a test agreeing about what the page says.
 * 4. **The words are monotone in the age.** The unit ladder is
 *    second → minute → hour → day with each step's value floored, so as a
 *    timestamp recedes the rendered pair `(unit, value)` never moves backwards.
 *    Property 24 asserts that, which is why the pair is returned alongside the
 *    string instead of being formatted away.
 *
 * Units stop at days. `3 months ago` would need calendar arithmetic — months are
 * not a fixed number of milliseconds — and a wrong month boundary is a worse lie
 * than `94 days ago` is a mouthful.
 */

import type { SnapshotFreshness } from 'kept-core';

import type { TokenName } from './tokens.js';

/**
 * The tone the chip renders, and the only three states freshness has.
 *
 * Mirrored by `components/FreshnessChip.tsx`, which maps each to a class. Kept as
 * a plain string union rather than an enum so the two declarations are
 * structurally identical and neither can drift into being the authority.
 */
export type FreshnessTone = 'current' | 'stale' | 'unverified';

/** Exactly 24 hours, in milliseconds. The threshold, not an approximation. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** What the chip reads when no terminal event has ever been consumed (§10.10). */
export const NEVER_VERIFIED = 'never verified';

/**
 * What the chip reads when a timestamp is present but unreadable.
 *
 * The snapshot schema validates ISO 8601, so a valid snapshot cannot reach this —
 * it exists because the alternative to a total function is a page that renders
 * `NaN days ago`. It is deliberately **not** ochre: ochre means "older than a
 * day", and an unreadable timestamp is not a measured age.
 */
export const UNREADABLE_TIMESTAMP = 'verified at an unreadable time';

/** The ladder, coarsest last. Index order is the monotonicity Property 24 uses. */
export const RELATIVE_UNITS = ['second', 'minute', 'hour', 'day'] as const;

export type RelativeUnit = (typeof RELATIVE_UNITS)[number];

const UNIT_MS: Readonly<Record<RelativeUnit, number>> = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

/** Below this the age is not worth a number, and reads `just now`. */
export const JUST_NOW_BELOW_MS = UNIT_MS.second * 5;

/** What `just now` renders as. Carries no unit, which is why `parts` is null. */
export const JUST_NOW = 'just now';

/** The rendered numeral and its unit — the pair Property 24 checks for monotonicity. */
export interface RelativeTimeParts {
  /** Index into `RELATIVE_UNITS`. Never decreases as the age grows. */
  readonly unitIndex: number;
  readonly unit: RelativeUnit;
  /** Whole units, floored. `1` renders singular, everything else plural. */
  readonly value: number;
}

export interface FreshnessRendering {
  /** Non-empty, and never containing `NaN` or `Invalid Date`. */
  readonly text: string;
  readonly tone: FreshnessTone;
  /** The colour token the tone resolves to. Ochre iff the age exceeds 24 h. */
  readonly token: TokenName;
  /** Milliseconds since the terminal event, or null when there is no age to state. */
  readonly ageMs: number | null;
  /** The numeral and unit behind `text`, or null for `just now` and the two null states. */
  readonly parts: RelativeTimeParts | null;
  /** The ISO string this was derived from, for the chip's `title`. */
  readonly at: string | null;
}

/**
 * Tone → colour token.
 *
 * `stale` is the one place a verdict token lands on a non-verdict element, which
 * §10.4.2 allows by name ("freshness > 24 h"). `current` is secondary body text
 * rather than the proven hue: a recent run is not a proven promise, and colouring
 * it green would claim a verdict the chip is not reporting. `unverified` is the
 * label ramp, as §10.10 specifies.
 */
export const FRESHNESS_TOKENS: Readonly<Record<FreshnessTone, TokenName>> = {
  current: '--text-100',
  stale: '--verdict-stale',
  unverified: '--text-200',
};

/** Epoch milliseconds for an instant, or `null` when it cannot be read. */
export function toEpochMs(instant: string | number | Date): number | null {
  if (typeof instant === 'number') return Number.isFinite(instant) ? instant : null;
  const parsed = instant instanceof Date ? instant.getTime() : Date.parse(instant);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * The unit and whole-unit count for an age, or `null` below the `just now` floor.
 *
 * Chooses the coarsest unit that yields at least one whole unit, so the ladder is
 * walked from days downwards and the result is the largest unit that still says
 * something true.
 */
export function relativeTimeParts(ageMs: number): RelativeTimeParts | null {
  if (ageMs < JUST_NOW_BELOW_MS) return null;
  for (let index = RELATIVE_UNITS.length - 1; index >= 0; index -= 1) {
    const unit = RELATIVE_UNITS[index];
    if (unit === undefined) continue;
    const value = Math.floor(ageMs / UNIT_MS[unit]);
    if (value >= 1) return { unitIndex: index, unit, value };
  }
  return null;
}

/** `3 minutes` / `1 hour` — the numeral with a unit pluralised to match it. */
export function formatParts(parts: RelativeTimeParts): string {
  return `${parts.value} ${parts.unit}${parts.value === 1 ? '' : 's'}`;
}

/**
 * How old a terminal-event timestamp is, in words and in tone (R9.6, R9.7).
 *
 * `null` answers `never verified`. An unreadable timestamp answers its own text
 * and neither of the measured tones. A timestamp in the future — clock skew
 * between the machine that recorded the run and the one rendering the page —
 * clamps to an age of zero and reads `just now`, because the honest thing to
 * report is "no measurable age", not a negative one.
 */
export function formatFreshness(
  at: string | null,
  now: string | number | Date,
): FreshnessRendering {
  if (at === null) {
    return {
      text: NEVER_VERIFIED,
      tone: 'unverified',
      token: FRESHNESS_TOKENS.unverified,
      ageMs: null,
      parts: null,
      at: null,
    };
  }

  const then = toEpochMs(at);
  const reference = toEpochMs(now);
  if (then === null || reference === null) {
    return {
      text: UNREADABLE_TIMESTAMP,
      tone: 'unverified',
      token: FRESHNESS_TOKENS.unverified,
      ageMs: null,
      parts: null,
      at,
    };
  }

  const ageMs = Math.max(0, reference - then);
  const parts = relativeTimeParts(ageMs);
  const tone: FreshnessTone = ageMs > STALE_AFTER_MS ? 'stale' : 'current';
  return {
    text: parts === null ? JUST_NOW : `${formatParts(parts)} ago`,
    tone,
    token: FRESHNESS_TOKENS[tone],
    ageMs,
    parts,
    at,
  };
}

/** The same, read straight off a snapshot's freshness block. */
export function renderFreshness(
  freshness: SnapshotFreshness,
  now: string | number | Date,
): FreshnessRendering {
  return formatFreshness(freshness.terminalEventAt, now);
}
