import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CREDITS_FIELDS, RESULT_CODE_FIELD, credits, resultCode } from 'kept-core';

/**
 * Unit coverage for the single coercion site (design §4.4, R3.10, R3.11, R3.13,
 * R3.14). The equivalence *property* over all integers is task 2.4 and the
 * credits property is 2.5; what is pinned here is the observed reality plus the
 * deliberate edge-case decisions, so that a future "simplification" to
 * `Number(ev.result_code)` fails loudly.
 */

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

describe('field names', () => {
  it('names the fields Kane actually emits, credits_consumed first', () => {
    expect(RESULT_CODE_FIELD).toBe('result_code');
    expect([...CREDITS_FIELDS]).toEqual(['credits_consumed', 'credits']);
  });
});

describe('resultCode — the three accepted forms (R3.13)', () => {
  it('reads a number, a decimal string and a whitespace-padded string alike', () => {
    expect(resultCode({ result_code: 740 })).toBe(740);
    expect(resultCode({ result_code: '740' })).toBe(740);
    expect(resultCode({ result_code: ' 740' })).toBe(740);
    expect(resultCode({ result_code: '\t740 \n' })).toBe(740);
  });

  it('agrees across every form of every code the router ladder reads', () => {
    for (const code of [100, 740, 700, 799, 0, -1]) {
      expect(resultCode({ result_code: code })).toBe(code);
      expect(resultCode({ result_code: String(code) })).toBe(code);
      expect(resultCode({ result_code: `  ${String(code)}  ` })).toBe(code);
    }
  });
});

describe('resultCode — absent and unusable answer null, never 0 or NaN', () => {
  it('returns null for absence in all its shapes', () => {
    expect(resultCode({})).toBeNull();
    expect(resultCode({ result_code: null })).toBeNull();
    expect(resultCode({ result_code: undefined })).toBeNull();
    expect(resultCode(null)).toBeNull();
    expect(resultCode(undefined)).toBeNull();
  });

  it('returns null for the two values a bare built-in gets wrong', () => {
    // Number('') is 0 — an empty field must not read as result code zero.
    expect(resultCode({ result_code: '' })).toBeNull();
    expect(resultCode({ result_code: '   ' })).toBeNull();
    // parseInt('740abc') is 740 — a concatenated field must not read as a
    // confirmed product bug.
    expect(resultCode({ result_code: '740abc' })).toBeNull();
    expect(resultCode({ result_code: 'abc' })).toBeNull();
  });

  it('rejects booleans, which Number() would turn into codes 1 and 0', () => {
    expect(resultCode({ result_code: true })).toBeNull();
    expect(resultCode({ result_code: false })).toBeNull();
  });

  it('rejects NaN and the infinities', () => {
    expect(resultCode({ result_code: Number.NaN })).toBeNull();
    expect(resultCode({ result_code: Number.POSITIVE_INFINITY })).toBeNull();
    expect(resultCode({ result_code: Number.NEGATIVE_INFINITY })).toBeNull();
    expect(resultCode({ result_code: 'Infinity' })).toBeNull();
    expect(resultCode({ result_code: 'NaN' })).toBeNull();
    // Overflows the grammar match into Infinity, so the finite guard catches it.
    expect(resultCode({ result_code: '1e999' })).toBeNull();
  });

  it('rejects alternate radixes and separators String(number) never produces', () => {
    expect(resultCode({ result_code: '0x2E4' })).toBeNull(); // Number('0x2E4') is 740
    expect(resultCode({ result_code: '0b1' })).toBeNull();
    expect(resultCode({ result_code: '0o7' })).toBeNull();
    expect(resultCode({ result_code: '1_000' })).toBeNull();
  });

  it('rejects composite values rather than guessing a field inside them', () => {
    expect(resultCode({ result_code: [740] })).toBeNull();
    expect(resultCode({ result_code: { value: 740 } })).toBeNull();
    expect(resultCode([{ result_code: 740 }])).toBeNull();
    expect(resultCode('740')).toBeNull();
    expect(resultCode(740)).toBeNull();
  });

  it('reads only own properties, so a prototype member is never a code', () => {
    expect(resultCode(Object.create({ result_code: 740 }) as unknown)).toBeNull();
  });
});

describe('resultCode — accepted-but-notable forms', () => {
  it('accepts an explicit leading plus', () => {
    expect(resultCode({ result_code: '+740' })).toBe(740);
  });

  it('accepts exponent notation, because String(number) can emit it', () => {
    expect(resultCode({ result_code: '7.4e2' })).toBe(740);
    expect(resultCode({ result_code: String(1e21) })).toBe(1e21);
  });

  it('never rounds a non-integer into a match against 740', () => {
    expect(resultCode({ result_code: 740.4 })).toBe(740.4);
    expect(resultCode({ result_code: '739.5' })).toBe(739.5);
    expect(resultCode({ result_code: 740.4 })).not.toBe(740);
  });
});

describe('credits (R3.10)', () => {
  it('prefers credits_consumed', () => {
    expect(credits({ credits_consumed: 10.35 })).toBe(10.35);
    expect(credits({ credits_consumed: 10.35, credits: 99 })).toBe(10.35);
  });

  it('accepts credits when credits_consumed is absent', () => {
    expect(credits({ credits: 10.35 })).toBe(10.35);
    expect(credits({ credits: '10.35' })).toBe(10.35);
    expect(credits({ credits: ' 0 ' })).toBe(0);
  });

  it('returns null when neither field is usable', () => {
    expect(credits({})).toBeNull();
    expect(credits({ credits_consumed: null })).toBeNull();
    expect(credits({ credits_consumed: 'free' })).toBeNull();
    expect(credits({ credits: true })).toBeNull();
    expect(credits(null)).toBeNull();
    expect(credits(undefined)).toBeNull();
  });

  it('falls through to credits when credits_consumed is present but unusable', () => {
    expect(credits({ credits_consumed: null, credits: 10.35 })).toBe(10.35);
    expect(credits({ credits_consumed: '', credits: 7 })).toBe(7);
  });

  it('distinguishes a free replay from an unreported one', () => {
    expect(credits({ credits_consumed: 0 })).toBe(0);
    expect(credits({})).toBeNull();
  });
});

describe('the recorded smoke run', () => {
  /**
   * The reason this file exists at all: one real `run_end` event carrying the
   * same code as a number at the top level and as a string in
   * `per_flow_metadata[0]`. Read from the pinned fixture, never restated inline,
   * so the assertion cannot drift away from what Kane emitted. Task 2.15 pins
   * the whole twelve-line stream once the parser exists.
   */
  const lines = readFileSync(`${REPO_ROOT}/docs/kane/smoke-run.ndjson`, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('{'));
  const runEnd = lines
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((event) => event['type'] === 'run_end');

  it('carries a run_end event with both typings of the same code', () => {
    expect(runEnd).toBeDefined();
    const flows = runEnd?.['per_flow_metadata'];
    expect(Array.isArray(flows)).toBe(true);
    const flow = (flows as unknown[])[0];

    // Number at the top level, string one level down — verbatim from Kane 0.8.4.
    expect(runEnd?.['result_code']).toBe(100);
    expect((flow as Record<string, unknown>)['result_code']).toBe('100');

    // And one value out of the accessor for both.
    expect(resultCode(runEnd)).toBe(100);
    expect(resultCode(flow)).toBe(100);
    expect(resultCode(runEnd)).toBe(resultCode(flow));
  });

  it('reports the measured credits from credits_consumed', () => {
    expect(credits(runEnd)).toBe(10.351184999999997);
  });
});
