/**
 * `resultCode740` — the primary strategy (design §6.2, R6.3, R6.4, R6.5, R6.6,
 * R6.8, R6.11).
 *
 * ## The precedence question this module answers
 *
 * R6.3 and R6.5 can both apply to a single event: a failing terminal can carry
 * the confirmed-bug code **and** an inline verdict object whose `confirmed` flag
 * is false. Read one way that is a product bug; read the other it is a test that
 * drifted. R6.4 settles it — the verdict object is the *primary* classification
 * signal, so the object outranks the numeric code, always. It is the richer
 * signal and the more recent one: Kane investigated, and the object is what it
 * concluded, whereas the code is a coarse bucket assigned before the
 * investigation.
 *
 * The full ladder of design §6.2, in order:
 *
 * | # | Condition | Branch |
 * |---|---|---|
 * | 1 | object present, not confirmed | `test-drift` |
 * | 2 | object present, confirmed | `code-break` |
 * | 3 | no object, coerced code is the confirmed-bug code | `code-break` |
 * | 4 | no object, code inside the assertion-class band | delegate to triage |
 * | 5 | no object, any other failing code | delegate to triage |
 * | 6 | delegation produced nothing | `docs-lie` |
 *
 * Rules 4 and 5 are one branch in code and two rows in the table because they
 * are two readings of the same instruction: R6.6 conditions the fall-back on the
 * *absence of the object* and says nothing about the code at all. So anything
 * that is not the confirmed-bug code delegates — including a terminal event
 * carrying no readable code, which is the row the table calls residue. Triage is
 * itself total and defaults to `docs-lie`, so that residue still answers
 * `docs-lie`; rule 6 survives as a real guard rather than a comment, catching a
 * delegate that returned nothing or threw, which is what keeps `route` total
 * even against a future strategy this module has never seen.
 *
 * ## Delegation returns the delegate's answer verbatim
 *
 * When this strategy delegates, the `RoutedRepair` it returns names
 * `failureYamlTriage` as the strategy. That is deliberate: `strategy` records
 * **which rung actually decided**, and on rules 4 and 5 the deciding signal is
 * the triage note, not the code. It also means that for every failure carrying
 * no inline verdict object the two configurations produce byte-identical
 * annotations, which is a stronger form of R6.14 than the requirement asks for.
 *
 * ## Two things this module never does
 *
 * It never compares the raw result field — every read goes through the coercing
 * accessor of `kane/coerce.ts`, so the string form and the number form of the
 * confirmed-bug code land on the same rung (R6.8). And it never touches the disk
 * on rules 1 to 3: the evidence reference is resolved from paths the evidence
 * listing already produced, so the common path — an inline verdict object — costs
 * no read, and the reference is still a real resolved path rather than a
 * fabricated one (R6.11).
 */

import { resultCode } from '../kane/coerce.js';

import { failureYamlTriageRouter } from './failureYamlTriage.js';
import {
  docsLieRepair,
  routedRepair,
  type FailureContext,
  type NormalisedVerdict,
  type RoutedRepair,
  type VerdictRouter,
} from './router.js';

/** This strategy's name, as it appears in `RoutedRepair.strategy` and in config. */
export const RESULT_CODE_740_NAME = 'resultCode740' as const;

/**
 * The confirmed-product-bug code, seven hundred and forty.
 *
 * Named rather than inlined because it is the single number the whole three-way
 * branch keys off, and because it is only ever compared against the *output* of
 * the coercing accessor — never against the raw field, which Kane types
 * inconsistently within one event.
 */
export const CONFIRMED_BUG_CODE = 740;

/**
 * Rules 1 and 2: the object decides (R6.4, R6.5).
 *
 * Both rules read `severity`, `category` and `confidence` off the object into the
 * answer, which is R6.4's second clause — the branch alone is not enough for a
 * reviewer to judge a repair, and Kane already did the work of grading it.
 */
function routeFromVerdictObject(
  ctx: FailureContext,
  verdict: NormalisedVerdict,
): RoutedRepair {
  const shared = {
    strategy: RESULT_CODE_740_NAME,
    severity: verdict.severity,
    category: verdict.category,
    confidence: verdict.confidence,
  };
  const oneLiner = verdict.one_liner === null ? '' : ` Kane reported: "${verdict.one_liner}".`;

  if (!verdict.confirmed) {
    return routedRepair(ctx, {
      ...shared,
      branch: 'test-drift',
      rationale:
        (verdict.confirmedKnown
          ? 'The inline verdict object reports confirmed as false: Kane investigated and did ' +
            'not confirm a product bug, so the failure is the test\'s own.'
          : 'The inline verdict object carries no readable confirmed flag, which is not a ' +
            'confirmation, so the failure is treated as the test\'s own rather than ' +
            'escalated into an automatic code repair.') +
        ' The object outranks the numeric code (R6.4).' +
        oneLiner,
    });
  }

  return routedRepair(ctx, {
    ...shared,
    branch: 'code-break',
    rationale:
      'The inline verdict object reports confirmed as true: Kane confirmed a product bug, ' +
      'and the object outranks the numeric code (R6.4).' +
      oneLiner,
  });
}

/**
 * Rules 4, 5 and 6: hand over to the triage note, and stay total if that fails.
 *
 * The delegate is called through this wrapper rather than directly so that rule
 * 6 is real code. A strategy is contracted never to throw, but this one is the
 * *default* strategy and it must not be brought down by a co-operating module's
 * bug — so a throw or an absent answer becomes the documented residue, with a
 * rationale that says the delegation is what failed. That distinction matters:
 * `docs-lie` because the triage note said nothing is a statement about the
 * product; `docs-lie` because the delegate broke is a statement about KEPT.
 */
function delegateToTriage(ctx: FailureContext, why: string): RoutedRepair {
  let delegated: RoutedRepair | null = null;
  try {
    delegated = failureYamlTriageRouter.route(ctx) ?? null;
  } catch (cause) {
    return docsLieRepair(
      ctx,
      RESULT_CODE_740_NAME,
      `${why} Delegation to failureYamlTriage did not complete ` +
        `(${cause instanceof Error ? cause.message : String(cause)}), so no rule matched and ` +
        `the default branch applies.`,
    );
  }
  if (delegated === null) {
    return docsLieRepair(
      ctx,
      RESULT_CODE_740_NAME,
      `${why} Delegation to failureYamlTriage returned nothing, so no rule matched and the ` +
        `default branch applies.`,
    );
  }
  return delegated;
}

/**
 * The strategy (design §6.2). Total, never throws, exactly one branch.
 */
export const resultCode740Router: VerdictRouter = {
  name: RESULT_CODE_740_NAME,
  route(ctx: FailureContext): RoutedRepair {
    // Rules 1 and 2 — the object outranks everything, and cost no disk read.
    const verdict = ctx.verdictObject;
    if (verdict !== null) return routeFromVerdictObject(ctx, verdict);

    // The only read of the field in this module, through the only accessor
    // permitted to read it, so both of Kane's typings land here (R6.8).
    const code = resultCode(ctx.terminal);

    // Rule 3 — a confirmed-bug code with no inline object to elaborate on it.
    if (code === CONFIRMED_BUG_CODE) {
      return routedRepair(ctx, {
        branch: 'code-break',
        strategy: RESULT_CODE_740_NAME,
        rationale:
          `The terminal event carries no inline verdict object and its coerced code is ` +
          `${String(CONFIRMED_BUG_CODE)}, the confirmed-product-bug code, so the product is ` +
          `at fault even though no object elaborated on it.`,
        category: 'product_bug',
      });
    }

    // Rules 4 and 5 — no object, so the triage note decides (R6.6). Rule 6 is
    // inside the delegation wrapper.
    return delegateToTriage(
      ctx,
      code === null
        ? 'The terminal event carries no inline verdict object and no readable code, so there ' +
          'is nothing numeric to route on.'
        : `The terminal event carries no inline verdict object and its coerced code is ` +
          `${String(code)}, which is not the confirmed-product-bug code.`,
    );
  },
};
