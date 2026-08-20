/**
 * `failureYamlTriage` — the fallback strategy (design §6.3, R6.7, R6.13).
 *
 * It reads the triage note Kane seals inside the newest evidence pack and maps
 * its category-ish field onto a repair branch. Two things make it worth having
 * even if the inline verdict object turns out to be always present:
 *
 * 1. **It ships working regardless of the spike (R6.13).** If a failing cached
 *    replay carries no inline verdict object, this is the strategy that does the
 *    whole job, selected by one string in `.kept/config.json`. If it does carry
 *    one, this is still the rung `resultCode740` delegates to when the object is
 *    missing, which is every failure that is not a confirmed product bug.
 * 2. **It is where the third branch actually fires.** The fixture's never-true
 *    discount claim fails with an assertion signal while the application behaves
 *    correctly and every selector resolves. Nothing about the numeric code says
 *    "the documentation is wrong"; the triage note's classification does.
 *
 * ## The ordering, and why `assertion` means `docs-lie`
 *
 * Design §6.3 orders the signals: product-fault signals first, test-mechanics
 * signals second, assertion-class signals third, everything else last. The
 * ordering is the argument. `code-break` requires positive evidence of a product
 * fault. `test-drift` requires positive evidence of a test-mechanics fault. An
 * assertion that failed while the application behaved normally and the selector
 * resolved is neither — it is the signature of a claim that was never true, so
 * the residue is the documentation's problem.
 *
 * That ordering also decides a case the fixtures pin deliberately: the committed
 * `failure-selector.yaml` carries a selector signal **and** a code inside the
 * seven-hundred band. The signal outranks the band, so it routes `test-drift`.
 * Had the band been checked first, a perfectly ordinary stale selector would
 * have been filed as a lie in the README.
 *
 * ## Never throws, never guesses a path
 *
 * The note is reached only through `FailureContext.loadFailureYaml`, which is
 * lazy and already family-derived, and which answers null for an absent,
 * unreadable or unparseable file. All three of those are `docs-lie` by design
 * §6.3's last row — with a rationale that says which one happened, because
 * "there was no triage note" and "the note said something we do not recognise"
 * are different facts about a run even though they route the same way.
 */

import { resultCode } from '../kane/coerce.js';
import type { FailureYaml } from '../kane/failureYaml.js';

import {
  docsLieRepair,
  routedRepair,
  type FailureContext,
  type RoutedRepair,
  type VerdictRouter,
} from './router.js';

/** This strategy's name, as it appears in `RoutedRepair.strategy` and in config. */
export const FAILURE_YAML_TRIAGE_NAME = 'failureYamlTriage' as const;

/**
 * Signals that are positive evidence of a product fault (design §6.3 row 1).
 *
 * These are the only signals that earn `code-break`, and `code-break` is the one
 * branch whose repair is applied automatically, so the list is deliberately a
 * closed set of product-fault vocabulary rather than anything that merely sounds
 * severe.
 */
export const CODE_BREAK_SIGNALS: readonly string[] = Object.freeze([
  'product_bug',
  'app_error',
  'server_error',
  'http_5xx',
  'crash',
  'console_error',
]);

/** Signals that are positive evidence of a test-mechanics fault (row 2). */
export const TEST_DRIFT_SIGNALS: readonly string[] = Object.freeze([
  'selector_not_found',
  'locator',
  'element_not_found',
  'stale_element',
  'timeout',
  'navigation',
  'flaky',
  'timing',
]);

/** Assertion-class signals (row 3): the app behaved, the assertion still lost. */
export const ASSERTION_SIGNALS: readonly string[] = Object.freeze([
  'assertion',
  'expectation_mismatch',
  'value_mismatch',
]);

/**
 * The assertion-class band, inclusive — seven hundred through seven ninety-nine.
 *
 * Written as two named numbers rather than as a literal range so the bound is
 * greppable and so no comparison operator ever appears beside the raw field
 * name; the value compared is always the output of the coercing accessor, which
 * is the only thing in the repository permitted to read that field.
 */
export const ASSERTION_BAND_FLOOR = 700;

/** Upper bound of the assertion-class band, inclusive. */
export const ASSERTION_BAND_CEILING = 799;

/** Whether a coerced code sits inside the assertion-class band. */
export function isAssertionBandCode(code: number | null): boolean {
  if (code === null) return false;
  return code >= ASSERTION_BAND_FLOOR && code <= ASSERTION_BAND_CEILING;
}

/** Which list a signal matched, and how. */
export type TriageSignalClass = 'code-break' | 'test-drift' | 'assertion' | 'unrecognised';

/** The outcome of classifying one signal string. */
export interface TriageClassification {
  readonly signalClass: TriageSignalClass;
  /** The list entry that matched, or null when nothing did. */
  readonly token: string | null;
  /** Whether the match was exact rather than a containment match. */
  readonly exact: boolean;
}

/** The three lists in the precedence order design §6.3 sets out. */
const SIGNAL_GROUPS: readonly { readonly signalClass: TriageSignalClass; readonly tokens: readonly string[] }[] =
  Object.freeze([
    { signalClass: 'code-break' as const, tokens: CODE_BREAK_SIGNALS },
    { signalClass: 'test-drift' as const, tokens: TEST_DRIFT_SIGNALS },
    { signalClass: 'assertion' as const, tokens: ASSERTION_SIGNALS },
  ]);

/**
 * Classify a lower-cased signal string.
 *
 * Exact matches are tried across all three lists **before** any containment
 * match, so a signal that is exactly `timeout` cannot be captured by a
 * containment rule from a higher list, and a compound signal like
 * `selector_timeout` still lands on test-drift. Containment then runs in
 * precedence order, which is what makes `assertion_timeout` a test-mechanics
 * fault rather than a documentation lie: a timeout is positive evidence about
 * the mechanism, and positive evidence outranks the residue.
 */
export function classifyTriageSignal(signal: string | null): TriageClassification {
  if (signal === null || signal.length === 0) {
    return { signalClass: 'unrecognised', token: null, exact: false };
  }
  for (const group of SIGNAL_GROUPS) {
    for (const token of group.tokens) {
      if (signal === token) return { signalClass: group.signalClass, token, exact: true };
    }
  }
  for (const group of SIGNAL_GROUPS) {
    for (const token of group.tokens) {
      if (signal.includes(token)) return { signalClass: group.signalClass, token, exact: false };
    }
  }
  return { signalClass: 'unrecognised', token: null, exact: false };
}

/**
 * The code this strategy reasons about: the terminal event's, else the triage
 * note's own.
 *
 * Both readings go through the coercing accessor, which is the only site in the
 * repository permitted to read that field — Kane types it inconsistently within
 * a single event, so an un-coerced read fires on one typing and silently never
 * fires on the other. The terminal event wins because it is what the run
 * actually reported; the note's copy is the fallback for a triage-only context,
 * which is exactly the shape the committed fixtures have.
 */
function codeFor(ctx: FailureContext, note: FailureYaml | null): number | null {
  return resultCode(ctx.terminal) ?? note?.resultCode ?? null;
}

/** Route from a loaded note. Exported so `resultCode740` can delegate into it. */
export function triageFromNote(ctx: FailureContext, note: FailureYaml | null): RoutedRepair {
  if (note === null) {
    return docsLieRepair(
      ctx,
      FAILURE_YAML_TRIAGE_NAME,
      'No readable failure.yaml in the resolved evidence pack — absent, unreadable or ' +
        'unparseable — so no positive evidence of a product fault or a test-mechanics ' +
        'fault exists and the claim itself is what is left in doubt.',
    );
  }

  const code = codeFor(ctx, note);
  const classification = classifyTriageSignal(note.signal);
  const matchNote = classification.exact ? 'exactly' : 'by containment of';
  const shared = {
    severity: note.severity,
    category: note.signal,
    confidence: note.confidence,
  };

  switch (classification.signalClass) {
    case 'code-break':
      return routedRepair(ctx, {
        ...shared,
        branch: 'code-break',
        strategy: FAILURE_YAML_TRIAGE_NAME,
        rationale:
          `failure.yaml ${note.signalField ?? 'triage'} is "${note.signal ?? ''}", matching ` +
          `${matchNote} the product-fault signal "${classification.token ?? ''}" — positive ` +
          `evidence that the product is at fault.`,
      });

    case 'test-drift':
      return routedRepair(ctx, {
        ...shared,
        branch: 'test-drift',
        strategy: FAILURE_YAML_TRIAGE_NAME,
        rationale:
          `failure.yaml ${note.signalField ?? 'triage'} is "${note.signal ?? ''}", matching ` +
          `${matchNote} the test-mechanics signal "${classification.token ?? ''}" — positive ` +
          `evidence that the test, not the product, drifted. A mechanics signal outranks ` +
          `the assertion-class band, so a code inside it does not change this.`,
      });

    case 'assertion':
      return docsLieRepair(
        ctx,
        FAILURE_YAML_TRIAGE_NAME,
        isAssertionBandCode(code)
          ? `failure.yaml ${note.signalField ?? 'triage'} is "${note.signal ?? ''}" and the ` +
            `coerced code ${String(code)} sits inside the assertion-class band, seven hundred ` +
            `through seven ninety-nine. An assertion that failed with no product-fault and no ` +
            `selector signal is the signature of a claim that was never true.`
          : `failure.yaml ${note.signalField ?? 'triage'} is "${note.signal ?? ''}", an ` +
            `assertion-class signal, with no code inside the assertion band ` +
            `(${code === null ? 'none reported' : String(code)}). Still neither a product ` +
            `fault nor a mechanics fault, so the claim is what is in doubt.`,
        shared,
      );

    case 'unrecognised':
      return docsLieRepair(
        ctx,
        FAILURE_YAML_TRIAGE_NAME,
        note.signal === null
          ? 'failure.yaml carried none of the accepted triage fields, so it names no ' +
            'product-fault and no test-mechanics signal.'
          : `failure.yaml ${note.signalField ?? 'triage'} is "${note.signal}", which matches ` +
            `no product-fault and no test-mechanics signal.`,
        shared,
      );
  }
}

/**
 * The strategy (design §6.3).
 *
 * `route` pulls the lazy note exactly once and delegates to
 * {@link triageFromNote}, so the ordering lives in one function whichever
 * direction the router was reached from.
 */
export const failureYamlTriageRouter: VerdictRouter = {
  name: FAILURE_YAML_TRIAGE_NAME,
  route(ctx: FailureContext): RoutedRepair {
    return triageFromNote(ctx, ctx.loadFailureYaml());
  },
};
