import { describe, expect, it } from 'vitest';

import {
  convert,
  CURRENCIES,
  DEFAULT_CURRENCY,
  format,
  isCurrencyCode,
  RATES,
  roundMoney,
} from '../lib/currency';

describe('CURRENCIES', () => {
  it('offers exactly the three currencies the Settings screen shows', () => {
    expect(CURRENCIES).toEqual(['USD', 'EUR', 'GBP']);
  });

  it('has a rate for every currency and identity for the base', () => {
    for (const code of CURRENCIES) expect(RATES[code]).toBeGreaterThan(0);
    expect(RATES[DEFAULT_CURRENCY]).toBe(1);
  });
});

describe('isCurrencyCode', () => {
  it('accepts the three known codes', () => {
    for (const code of CURRENCIES) expect(isCurrencyCode(code)).toBe(true);
  });

  it('rejects anything else that could come out of localStorage', () => {
    for (const value of ['usd', 'JPY', '', null, undefined, 42, {}, ['USD']]) {
      expect(isCurrencyCode(value)).toBe(false);
    }
  });
});

describe('roundMoney', () => {
  it('keeps two decimal places', () => {
    expect(roundMoney(18)).toBe(18);
    expect(roundMoney(59.970000000000006)).toBe(59.97);
  });

  it('rounds half away from zero, symmetrically', () => {
    expect(roundMoney(0.125)).toBe(0.13);
    expect(roundMoney(-0.125)).toBe(-0.13);
  });

  it('flattens non-finite values to zero rather than rendering NaN', () => {
    expect(roundMoney(Number.NaN)).toBe(0);
    expect(roundMoney(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('convert', () => {
  it('is the identity in the base currency', () => {
    expect(convert(18, 'USD')).toBe(18);
  });

  it('applies the static rate and rounds to minor units', () => {
    expect(convert(18, 'EUR')).toBe(16.56);
    expect(convert(18, 'GBP')).toBe(14.22);
    expect(convert(21.25, 'EUR')).toBe(19.55);
  });

  it('defaults to the base currency', () => {
    expect(convert(24)).toBe(convert(24, DEFAULT_CURRENCY));
  });

  it('maps zero to zero in every currency', () => {
    for (const code of CURRENCIES) expect(convert(0, code)).toBe(0);
  });
});

describe('format', () => {
  it('renders a symbol and always two decimal places', () => {
    expect(format(18, 'USD')).toBe('$18.00');
    expect(format(18, 'EUR')).toBe('\u20ac16.56');
    expect(format(18, 'GBP')).toBe('\u00a314.22');
  });

  it('keeps trailing zeros', () => {
    expect(format(16.5, 'USD')).toBe('$16.50');
    expect(format(0, 'USD')).toBe('$0.00');
  });

  it('places the sign before the symbol for a negative amount', () => {
    expect(format(-18, 'USD')).toBe('-$18.00');
  });

  it('defaults to US dollars', () => {
    expect(format(19.5)).toBe('$19.50');
  });
});
