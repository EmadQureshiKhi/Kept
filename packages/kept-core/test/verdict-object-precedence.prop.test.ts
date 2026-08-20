import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  RESULT_CODE_FIELD,
  createFailureContext,
  normaliseVerdictObject,
  resultCode,
  selectRouter,
  type FailureContext,
  type VerdictObject,
} from '@kept/core';

import { arbTerminalEvent, arbUnrecognisableVerdictObject, arbVerdictObject } from './arbitraries.js';
import { REPO_ROOT, buildEvidenceTree, testrunListing } from './verdict-evidence-tree.js';

/**
 * Feature: kept, Property 18: The verdict object outranks the result code
 * (design §Correctness Properties, §6.2, R6.3, R6.4, R6.5, R6.6).
 *
 * *For any* failing terminal event carrying a verdict object, the returned branch
 * is `test-drift` when `confirmed` is false and `code-break` when `confirmed` is
 * true, regardless of the accompanying `result_code` value or its type; the
 * object's severity, category and confidence are exposed alongside the branch; and
 * *for any* failing terminal event carrying no verdict object, a coerced
 * `result_code` of 740 returns `code-break` while any other failing code delegates
 * to the `failure.yaml` triage.
 *
 * ## Why this is a property and not three examples
 *
 * The precedence question is the one place in this design where two requirements
 * genuinely collide: R6.3 says the confirmed-bug code means `code-break`, and R6.5
 * says an object reporting `confirmed: false` means `test-drift`. A single event
 * can carry both. An implementation that checks the code first passes every
 * example test anyone would think to write for R6.3, and silently mis-routes every
 * *investigated* failure into an automatic code repair — the most damaging of the
 * three branches, because it is the only one applied without a human.
 *
 * So the encoding is adversarial on purpose: the code is generated **freely and
 * independently** of the object, in both of Kane's typings, and is spread onto the
 * event *after* the object. If precedence were the other way round, the confirmed
 * flag would stop deciding as soon as the generator drew the bug code, which it
 * does often.
 *
 * The second clause — the object's grades are surfaced — is asserted against the
 * *normalised* object rather than against the wire one, because the wire shape
 * types `severity` as `string | number | null` and `confidence` as
 * `number | string | null`. The router's answer must carry the settled values, and
 * comparing against the normalisation is what pins "surfaced" to "surfaced
 * correctly" rather than merely "non-null".
 *
 * **Validates: Requirements 6.3, 6.4, 6.5, 6.6**
 */

const NUM_RUNS = 500;

const router = selectRouter({ verdictRouter: 'resultCode740' });

/** The confirmed-product-bug code. Compared only against a coerced value. */
const BUG_CODE = 740;

const PRODUCT_BUG_NOTE = 'triage:\n  category: product_bug\n  severity: high\n';
const SELECTOR_NOTE = 'category: selector_not_found\nseverity: medium\n';

/**
 * Every wire form the code can take, including the two the design names: the
 * number, the plain string, and the whitespace-padded string. Values that coerce
 * to nothing are in scope too — an absent code is a shape a real failing event
 * takes.
 */
const arbCodeWire: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom<unknown>(BUG_CODE, '740', ' 740', '740.0') },
  { weight: 3, arbitrary: fc.constantFrom<unknown>(715, '715', 742, 500, 1, 130, 740.4, 7400) },
  { weight: 2, arbitrary: fc.integer({ min: -5, max: 900 }) },
  { weight: 1, arbitrary: fc.constantFrom<unknown>(null, undefined, '', 'seven-forty', {}, true) },
);

/** The triage note the delegation rung would find, or none at all. */
const arbNote: fc.Arbitrary<string | null> = fc.constantFrom<string | null>(
  PRODUCT_BUG_NOTE,
  SELECTOR_NOTE,
  'classification: assertion\n',
  'category: gremlins\n',
  null,
);

interface Built {
  readonly ctx: FailureContext;
  readonly terminal: Record<string, unknown>;
}

/**
 * Build the context the way a real caller does: through `createFailureContext`,
 * over a family-derived evidence listing, with the code spread on last so it can
 * never be mistaken for something the object influenced.
 */
function build(
  terminalEvent: unknown,
  codeWire: unknown,
  verdict: unknown,
  note: string | null,
): Built {
  const files: Record<string, string> = { 'annotated.png': 'x' };
  if (note !== null) files['failure.yaml'] = note;
  const tree = buildEvidenceTree([{ id: 'ev_1', files }]);

  const terminal: Record<string, unknown> = {
    ...(terminalEvent as Record<string, unknown>),
  };
  if (verdict === undefined) delete terminal['verdict'];
  else terminal['verdict'] = verdict;
  if (codeWire === undefined) delete terminal[RESULT_CODE_FIELD];
  else terminal[RESULT_CODE_FIELD] = codeWire;

  return {
    terminal,
    ctx: createFailureContext({
      family: 'ExecutionTestrun',
      terminal,
      promiseId: 'p_000000000000',
      memberStatus: 'failed',
      evidence: testrunListing(tree),
      repoRoot: REPO_ROOT,
      yaml: tree.yaml,
    }),
  };
}

describe('Property 18: The verdict object outranks the result code', () => {
  it('routes on confirmed, whatever code accompanies it and whatever its type', () => {
    fc.assert(
      fc.property(
        arbTerminalEvent('ExecutionTestrun'),
        arbCodeWire,
        arbVerdictObject,
        arbNote,
        (event, codeWire, verdict, note) => {
          const { ctx } = build(event, codeWire, verdict, note);
          const normalised = normaliseVerdictObject(verdict);
          // The generator always emits a recognisable object.
          expect(normalised).not.toBeNull();

          const routed = router.route(ctx);
          expect(routed.branch).toBe(normalised?.confirmed === true ? 'code-break' : 'test-drift');
          expect(routed.strategy).toBe('resultCode740');
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('is unmoved by the code even when the code is exactly the bug code', () => {
    // The sharp case: R6.3 and R6.5 both apply, and R6.4 says the object wins.
    fc.assert(
      fc.property(
        arbTerminalEvent('ExecutionTestrun'),
        fc.constantFrom<unknown>(BUG_CODE, '740', ' 740'),
        arbVerdictObject,
        arbNote,
        (event, codeWire, verdict, note) => {
          const { ctx, terminal } = build(event, codeWire, verdict, note);
          expect(resultCode(terminal)).toBe(BUG_CODE);
          const confirmed = normaliseVerdictObject(verdict)?.confirmed === true;
          expect(router.route(ctx).branch).toBe(confirmed ? 'code-break' : 'test-drift');
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('surfaces the object\'s severity, category and confidence alongside the branch', () => {
    fc.assert(
      fc.property(
        arbTerminalEvent('ExecutionTestrun'),
        arbCodeWire,
        arbVerdictObject,
        arbNote,
        (event, codeWire, verdict, note) => {
          const { ctx } = build(event, codeWire, verdict, note);
          const normalised = normaliseVerdictObject(verdict);
          const routed = router.route(ctx);
          expect(routed.severity).toBe(normalised?.severity ?? null);
          expect(routed.category).toBe(normalised?.category ?? null);
          expect(routed.confidence).toBe(normalised?.confidence ?? null);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('gives the same branch for the number, the string and the padded string', () => {
    fc.assert(
      fc.property(arbTerminalEvent('ExecutionTestrun'), arbNote, (event, note) => {
        const branches = [BUG_CODE, '740', ' 740'].map(
          (wire) => router.route(build(event, wire, undefined, note).ctx).branch,
        );
        expect(new Set(branches).size).toBe(1);
        expect(branches[0]).toBe('code-break');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('with no object, routes code-break on the bug code and delegates otherwise', () => {
    fc.assert(
      fc.property(
        arbTerminalEvent('ExecutionTestrun'),
        arbCodeWire,
        arbNote,
        (event, codeWire, note) => {
          const { ctx, terminal } = build(event, codeWire, undefined, note);
          expect(ctx.verdictObject).toBeNull();

          const routed = router.route(ctx);
          if (resultCode(terminal) === BUG_CODE) {
            expect(routed.branch).toBe('code-break');
            expect(routed.strategy).toBe('resultCode740');
          } else {
            // Delegated, so the answer is the triage note's, verbatim — which is
            // what makes the recorded strategy name the rung that decided.
            expect(routed.strategy).toBe('failureYamlTriage');
            expect(routed.branch).toBe(
              note === PRODUCT_BUG_NOTE
                ? 'code-break'
                : note === SELECTOR_NOTE
                  ? 'test-drift'
                  : 'docs-lie',
            );
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('treats an object carrying none of the six fields as no object at all', () => {
    fc.assert(
      fc.property(
        arbTerminalEvent('ExecutionTestrun'),
        arbUnrecognisableVerdictObject,
        arbNote,
        (event, notAVerdict, note) => {
          const withIt = build(event, BUG_CODE, notAVerdict, note);
          const without = build(event, BUG_CODE, undefined, note);
          expect(withIt.ctx.verdictObject).toBeNull();
          // Rule 3 decides both, identically: an empty object must not be able to
          // fire rule 1 on the strength of an absent confirmed flag.
          expect(router.route(withIt.ctx)).toEqual(router.route(without.ctx));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('reads the raw wire object through one normalisation, never twice differently', () => {
    fc.assert(
      fc.property(arbVerdictObject, (verdict: VerdictObject) => {
        const first = normaliseVerdictObject(verdict);
        const second = normaliseVerdictObject(verdict);
        expect(second).toEqual(first);
        expect(typeof first?.confirmed).toBe('boolean');
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
