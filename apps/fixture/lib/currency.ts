/**
 * Money formatting for Kepler Coffee.
 *
 * Every price in the catalogue is stored once, in US dollars. The currency the
 * shopper picks on `/settings` is a *presentation* choice: it is applied at the
 * moment of rendering through `format`, never written back into the catalogue or
 * the cart. That keeps cart arithmetic in a single unit and means a currency
 * switch can never change what a shopper owes.
 *
 * The rate table is static and committed. There is no exchange-rate service and
 * no `fetch` anywhere in this app (R12.2).
 */

export const CURRENCIES = ['USD', 'EUR', 'GBP'] as const;

export type CurrencyCode = (typeof CURRENCIES)[number];

export const DEFAULT_CURRENCY: CurrencyCode = 'USD';

/** Units of `code` per 1 USD. Static, deliberately unrealistic in its stability. */
export const RATES: Record<CurrencyCode, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
};

export const SYMBOLS: Record<CurrencyCode, string> = {
  USD: '$',
  EUR: '\u20ac',
  GBP: '\u00a3',
};

export const CURRENCY_NAMES: Record<CurrencyCode, string> = {
  USD: 'US dollars',
  EUR: 'Euros',
  GBP: 'Pounds sterling',
};

/** Narrows anything read back out of `localStorage` to a known currency. */
export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
}

/**
 * Rounds to whole cents, half away from zero, and flattens anything
 * non-finite to 0 so a corrupted stored value can never render as `NaN`.
 */
export function roundMoney(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  const cents = Math.round(Math.abs(amount) * 100);
  return (amount < 0 ? -cents : cents) / 100;
}

/** Converts a USD amount into `code`, rounded to whole minor units. */
export function convert(usd: number, code: CurrencyCode = DEFAULT_CURRENCY): number {
  return roundMoney(roundMoney(usd) * RATES[code]);
}

/**
 * Renders a USD amount in `code` as a symbol followed by two decimal places —
 * `$18.00`, `€16.56`, `£14.22`. Always two decimals, so a Kane assertion on the
 * rendered text is comparing a stable string and not a locale's opinion.
 */
export function format(usd: number, code: CurrencyCode = DEFAULT_CURRENCY): string {
  const value = convert(usd, code);
  const sign = value < 0 ? '-' : '';
  return `${sign}${SYMBOLS[code]}${Math.abs(value).toFixed(2)}`;
}
