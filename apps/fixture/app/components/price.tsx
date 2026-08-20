'use client';

/**
 * Renders a USD amount in the currency chosen on `/settings`.
 *
 * Before hydration the chosen currency is unknown, so this renders a dash rather
 * than guessing US dollars and then correcting itself. `data-ready` flips to
 * `true` in the same tick the price appears, which gives a browser-driven test a
 * stable thing to wait on.
 */

import { format } from '../../lib/currency';
import { useStore } from '../providers';

export function Price({
  usd,
  testId,
  className,
  label,
}: {
  usd: number;
  testId?: string;
  className?: string;
  label?: string;
}) {
  const { currency, hydrated } = useStore();
  return (
    <span
      className={className}
      data-testid={testId}
      data-ready={hydrated ? 'true' : 'false'}
      aria-busy={hydrated ? undefined : true}
      aria-label={label}
    >
      {hydrated ? format(usd, currency) : '\u2014'}
    </span>
  );
}
