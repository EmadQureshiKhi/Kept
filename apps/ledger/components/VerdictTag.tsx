/**
 * `VerdictTag` — design §10.4.3, §10.5, R10.2, R10.3, R10.5, and the presentation
 * clause of Property 22.
 *
 * One rule, stated three ways because it is the rule the whole visual system is
 * built to keep: **a verdict always carries a word.** The colour is the fast
 * channel and the word is the true one, so the word is rendered text — never a
 * `title`, never an `aria-label` over a coloured square, never a legend somewhere
 * else on the page. Strip every stylesheet out and the tag still says `proven`.
 *
 * The DOM is deliberately two elements, and the split is load-bearing rather than
 * decorative:
 *
 * - the **box** carries the 1px `--wash-*` edge, which design §10.4.3 permits on
 *   a tag border and nowhere near text;
 * - the **word** carries the `--verdict-*` hue.
 *
 * Written that way, no CSS rule can ever set a wash and a `color` together, so the
 * exclusion Property 22's contrast clause depends on — washes contribute no
 * foreground/background pair, so the matrix stays finite — holds *structurally*
 * instead of by an author remembering. `test/typography-discipline.test.ts` fails
 * on any rule that declares both, and the split means such a rule cannot be
 * written here without also moving the markup.
 *
 * `undesigned` maps to `--verdict-undesigned`, the unsaturated stone-sage, because
 * an undesigned promise is an *absence of a test*, not a warning about one (R10.3).
 * The token measures below the achromatic threshold, so it belongs to no hue
 * family at all — asserted in the property test rather than asserted in a comment.
 *
 * Server component: no hooks, no handlers, no client boundary. Stage 17's verdict
 * flip (§10.6.3) animates the box's transform and the word's colour, both already
 * on the motion allowlist, and needs no change to this markup.
 */

import clsx from 'clsx';
import type { Verdict } from 'kept-core';

import type { TokenName } from '../lib/tokens.js';

import '../styles/verdict-tag.css';

/**
 * The verdict → hue mapping of design §10.4.1, as the one place it is written.
 *
 * Typed `Record<Verdict, TokenName>` so the four keys are checked against
 * `kept-core`'s vocabulary and the four values against the declared palette: a
 * fifth verdict fails to compile here rather than rendering an unstyled tag, and a
 * renamed token fails here rather than resolving to nothing in the browser.
 */
export const VERDICT_TOKENS: Readonly<Record<Verdict, TokenName>> = {
  proven: '--verdict-proven',
  red: '--verdict-red',
  stale: '--verdict-stale',
  undesigned: '--verdict-undesigned',
};

/** The 1px border wash for each verdict — the tag's edge, never behind its text. */
export const VERDICT_WASHES: Readonly<Record<Verdict, TokenName>> = {
  proven: '--wash-proven',
  red: '--wash-red',
  stale: '--wash-stale',
  undesigned: '--wash-undesigned',
};

/** The four verdicts, in the order design §10.3 ranks them: red first. */
export const VERDICT_RANK: readonly Verdict[] = ['red', 'stale', 'undesigned', 'proven'];

export interface VerdictTagProps {
  readonly verdict: Verdict;
  /** Composed onto the tag box, for callers that need to place it. */
  readonly className?: string;
}

/**
 * The verdict word, in the verdict's colour, inside a hairline wash edge.
 *
 * The word rendered *is* the verdict value — no lookup table between the data and
 * the label, so the two cannot drift apart and a screen reader, a `textContent`
 * assertion and a judge's eye all read the same four strings.
 */
export function VerdictTag({ verdict, className }: VerdictTagProps) {
  return (
    <span className={clsx('verdict-tag', className)} data-verdict={verdict}>
      <span className="verdict-tag__word">{verdict}</span>
    </span>
  );
}
