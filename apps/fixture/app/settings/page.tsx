'use client';

/**
 * Settings — one preference, the display currency, written to `localStorage` the
 * moment it changes. There is no Save button to forget to press, which is why the
 * choice survives a reload.
 *
 * The radio group is only rendered once the stored value is known, so the checked
 * radio is never briefly wrong.
 */

import {
  CURRENCIES,
  CURRENCY_NAMES,
  format,
  isCurrencyCode,
  SYMBOLS,
} from '../../lib/currency';
import { useStore } from '../providers';

const SAMPLE_USD = 18;

export default function SettingsPage() {
  const { currency, hydrated, chooseCurrency } = useStore();

  return (
    <section aria-labelledby="settings-heading">
      <h1 id="settings-heading">Settings</h1>
      <p className="lede">
        Prices across the shop are shown in the currency you pick here. Conversion uses a
        fixed rate table — we are a roastery, not a bank.
      </p>

      <div className="panel">
        <fieldset className="plain-fieldset">
          <legend>
            <h2>Display currency</h2>
          </legend>

          {!hydrated ? (
            <p
              className="loading"
              role="status"
              aria-busy="true"
              data-testid="settings-loading"
            >
              Loading your preferences&hellip;
            </p>
          ) : (
            <div data-testid="currency-options">
              {CURRENCIES.map((code) => (
                <div className="radio-row" key={code}>
                  <input
                    type="radio"
                    id={`currency-${code}`}
                    name="currency"
                    value={code}
                    checked={currency === code}
                    data-testid={`currency-${code}`}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (isCurrencyCode(next)) chooseCurrency(next);
                    }}
                  />
                  <label htmlFor={`currency-${code}`}>
                    {code} &mdash; {CURRENCY_NAMES[code]} ({SYMBOLS[code]})
                  </label>
                </div>
              ))}
            </div>
          )}
        </fieldset>
      </div>

      {hydrated ? (
        <p className="status" role="status" data-testid="currency-selected">
          Showing prices in {currency}. A {format(SAMPLE_USD, 'USD')} bag reads as{' '}
          {format(SAMPLE_USD, currency)}.
        </p>
      ) : null}
    </section>
  );
}
