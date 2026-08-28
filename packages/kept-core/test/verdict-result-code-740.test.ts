import { describe, expect, it } from 'vitest';

import {
  REPAIR_BRANCHES,
  RESULT_CODE_FIELD,
  createFailureContext,
  isRepairAnnotation,
  selectRouter,
  type FailureContext,
} from 'kept-core';

import { REPO_ROOT, buildEvidenceTree, testrunListing } from './verdict-evidence-tree.js';

/**
 * The `resultCode740` strategy (task 11.3, design §6.2, R6.3–R6.6, R6.8, R6.11).
 *
 * The strategy is reached through `selectRouter` rather than by importing it,
 * which is the same door every consumer uses (R6.10) and the reason the spike's
 * outcome can only ever change one configuration string.
 *
 * The ladder under test, in the order precedence resolves it: the inline verdict
 * object outranks the numeric code, a confirmed-bug code with no object still
 * means the product is at fault, and everything else hands over to the triage
 * note.
 */

const router = selectRouter({ verdictRouter: 'resultCode740' });

const PRODUCT_BUG_YAML = 'triage:\n  category: product_bug\n  severity: high\n  confidence: 0.9\n';
const SELECTOR_YAML = 'category: selector_not_found\nseverity: medium\nconfidence: 0.72\n';
const ASSERTION_YAML = 'classification: assertion\nseverity: low\nconfidence: 0.95\n';

interface Built {
  readonly ctx: FailureContext;
  readonly reads: () => number;
}

function build(
  terminal: Record<string, unknown>,
  packs: readonly { id: string; files: Record<string, string> }[] = [],
): Built {
  const tree = buildEvidenceTree(packs);
  return {
    ctx: createFailureContext({
      family: 'ExecutionTestrun',
      terminal,
      promiseId: 'p_000000000000',
      memberStatus: 'failed',
      evidence: testrunListing(tree),
      repoRoot: REPO_ROOT,
      yaml: tree.yaml,
    }),
    reads: tree.reads,
  };
}

/** One pack holding the given note, so every rung has a real artefact to name. */
function packWith(note: string): readonly { id: string; files: Record<string, string> }[] {
  return [{ id: 'ev_1', files: { 'failure.yaml': note, 'annotated.png': 'x' } }];
}

describe('rules 1 and 2 — the verdict object outranks the code (R6.4, R6.5)', () => {
  it('routes test-drift on confirmed false, whatever the code says', () => {
    const { ctx, reads } = build(
      {
        type: 'testrun_done',
        [RESULT_CODE_FIELD]: 740,
        verdict: {
          confirmed: false,
          category: 'selector',
          severity: 'medium',
          confidence: 0.7,
          one_liner: 'the chip moved',
        },
      },
      packWith(PRODUCT_BUG_YAML),
    );
    const routed = router.route(ctx);
    expect(routed.branch).toBe('test-drift');
    expect(routed.strategy).toBe('resultCode740');
    expect(routed.severity).toBe('medium');
    expect(routed.category).toBe('selector');
    expect(routed.confidence).toBe(0.7);
    expect(routed.rationale).toContain('confirmed as false');
    expect(routed.rationale).toContain('the chip moved');
    // The object is in the stream, so the common path costs no disk read.
    expect(reads()).toBe(0);
  });

  it('routes code-break on confirmed true, even with a code outside the bug code', () => {
    const { ctx, reads } = build(
      {
        type: 'testrun_done',
        [RESULT_CODE_FIELD]: '715',
        verdict: { confirmed: 'true', category: 'product_bug', severity: 2, confidence: '0.9' },
      },
      packWith(SELECTOR_YAML),
    );
    const routed = router.route(ctx);
    expect(routed.branch).toBe('code-break');
    expect(routed.strategy).toBe('resultCode740');
    expect(routed.severity).toBe('2');
    expect(routed.category).toBe('product_bug');
    expect(routed.confidence).toBe(0.9);
    expect(reads()).toBe(0);
  });

  it('never escalates an unreadable confirmed flag into a code repair', () => {
    const { ctx } = build(
      { type: 'testrun_done', [RESULT_CODE_FIELD]: 740, verdict: { confirmed: 'perhaps' } },
      packWith(PRODUCT_BUG_YAML),
    );
    const routed = router.route(ctx);
    expect(routed.branch).toBe('test-drift');
    expect(routed.rationale).toContain('no readable confirmed flag');
  });

  it('ignores an object that carries none of the six recognised fields', () => {
    const { ctx } = build(
      { type: 'testrun_done', [RESULT_CODE_FIELD]: 740, verdict: {} },
      packWith(SELECTOR_YAML),
    );
    // `{}` is not a verdict object, so rule 3 decides rather than rule 1.
    expect(router.route(ctx).branch).toBe('code-break');
  });
});

describe('rule 3 — a confirmed-bug code with no object (R6.3, R6.8)', () => {
  it('routes code-break for the number, the string, and the padded string alike', () => {
    for (const wire of [740, '740', ' 740', '740.0']) {
      const { ctx } = build({ type: 'testrun_done', [RESULT_CODE_FIELD]: wire }, packWith(SELECTOR_YAML));
      const routed = router.route(ctx);
      expect(routed.branch, `wire form ${JSON.stringify(wire)}`).toBe('code-break');
      expect(routed.strategy).toBe('resultCode740');
      expect(routed.category).toBe('product_bug');
    }
  });

  it('does not treat a neighbouring value as the bug code', () => {
    for (const wire of [740.4, '7400', '74', 'seven hundred and forty']) {
      const { ctx } = build({ type: 'testrun_done', [RESULT_CODE_FIELD]: wire }, packWith(SELECTOR_YAML));
      expect(router.route(ctx).branch, `wire form ${JSON.stringify(wire)}`).not.toBe('code-break');
    }
  });
});

describe('rules 4 and 5 — no object, so the note decides (R6.6)', () => {
  it('delegates a code inside the assertion band and returns the delegate verbatim', () => {
    const { ctx } = build({ type: 'testrun_done', [RESULT_CODE_FIELD]: 715 }, packWith(SELECTOR_YAML));
    const routed = router.route(ctx);
    expect(routed.branch).toBe('test-drift');
    // `strategy` names the rung that actually decided, which was the note.
    expect(routed.strategy).toBe('failureYamlTriage');
    expect(routed.rationale).toContain('selector_not_found');
  });

  it('delegates any other failing code the same way', () => {
    const { ctx } = build({ type: 'testrun_done', [RESULT_CODE_FIELD]: 500 }, packWith(PRODUCT_BUG_YAML));
    const routed = router.route(ctx);
    expect(routed.branch).toBe('code-break');
    expect(routed.strategy).toBe('failureYamlTriage');
  });

  it('delegates a terminal event with no readable code at all', () => {
    const { ctx } = build({ type: 'testrun_done' }, packWith(ASSERTION_YAML));
    const routed = router.route(ctx);
    expect(routed.branch).toBe('docs-lie');
    expect(routed.strategy).toBe('failureYamlTriage');
  });

  it('routes docs-lie when there is no note to read either (R6.9)', () => {
    const { ctx } = build({ type: 'testrun_done', [RESULT_CODE_FIELD]: 715 });
    const routed = router.route(ctx);
    expect(routed.branch).toBe('docs-lie');
    expect(routed.evidenceRef).toBeNull();
    expect(routed.rationale).toContain('No readable failure.yaml');
  });
});

describe('the answer is a storable annotation with a real evidence reference', () => {
  it('is exactly a RepairAnnotation, so the snapshot needs no translation', () => {
    const { ctx } = build(
      { type: 'testrun_done', verdict: { confirmed: true } },
      packWith(PRODUCT_BUG_YAML),
    );
    const routed = router.route(ctx);
    expect(isRepairAnnotation(routed)).toBe(true);
    expect(Object.keys(routed).sort()).toEqual([
      'branch',
      'category',
      'confidence',
      'evidenceRef',
      'rationale',
      'severity',
      'strategy',
    ]);
  });

  it('names the resolved note on every rung, repository-relative', () => {
    for (const terminal of [
      { type: 'testrun_done', verdict: { confirmed: true } },
      { type: 'testrun_done', verdict: { confirmed: false } },
      { type: 'testrun_done', [RESULT_CODE_FIELD]: 740 },
      { type: 'testrun_done', [RESULT_CODE_FIELD]: 715 },
    ]) {
      const { ctx } = build(terminal, packWith(SELECTOR_YAML));
      expect(router.route(ctx).evidenceRef).toBe('.testmuai/evidence/ev_1/failure.yaml');
    }
  });

  it('falls back to the pack directory when the pack sealed no note', () => {
    const { ctx } = build({ type: 'testrun_done', [RESULT_CODE_FIELD]: 740 }, [
      { id: 'ev_1', files: { 'annotated.png': 'x' } },
    ]);
    expect(router.route(ctx).evidenceRef).toBe('.testmuai/evidence/ev_1');
  });

  it('returns one of the three branches for every one of these inputs', () => {
    for (const terminal of [
      {},
      { type: 'testrun_done' },
      { type: 'testrun_done', [RESULT_CODE_FIELD]: null },
      { type: 'testrun_done', verdict: null },
      { type: 'testrun_done', verdict: 'confirmed' },
      { type: 'testrun_done', verdict: [] },
    ]) {
      const { ctx } = build(terminal);
      expect(REPAIR_BRANCHES).toContain(router.route(ctx).branch);
    }
  });
});
