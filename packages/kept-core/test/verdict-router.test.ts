import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VERDICT_ROUTER,
  RESULT_CODE_FIELD,
  VERDICT_ROUTER_DIAGNOSTIC_CODES,
  VERDICT_ROUTER_NAMES,
  createDiagnosticSink,
  createFailureContext,
  isVerdictRouterName,
  normaliseVerdictObject,
  resolveEvidenceRef,
  selectRouter,
} from 'kept-core';

import { REPO_ROOT, buildEvidenceTree, testrunListing } from './verdict-evidence-tree.js';

/**
 * The verdict-router interface (task 11.1, design §6.1, §6.4, R6.1, R6.10, R6.14).
 *
 * Three things are under test here and none of them is a branch: the selection
 * door, the crossing from the raw wire verdict object to the settled one, and the
 * context factory's two promises — that the triage note is read lazily and at most
 * once, and that the evidence reference is a real resolved path or null.
 */

const PRODUCT_BUG_YAML = 'triage:\n  category: product_bug\n  severity: high\n  confidence: 0.9\n';

function contextWith(
  terminal: Record<string, unknown>,
  packs: readonly { id: string; files: Record<string, string> }[],
): { ctx: ReturnType<typeof createFailureContext>; reads: () => number } {
  const tree = buildEvidenceTree(packs);
  const ctx = createFailureContext({
    family: 'ExecutionTestrun',
    terminal,
    promiseId: 'p_000000000000',
    memberStatus: 'failed',
    evidence: testrunListing(tree),
    repoRoot: REPO_ROOT,
    yaml: tree.yaml,
  });
  return { ctx, reads: tree.reads };
}

describe('selectRouter is the only door (R6.10)', () => {
  it('returns the implementation each legal value names', () => {
    for (const name of VERDICT_ROUTER_NAMES) {
      expect(selectRouter({ verdictRouter: name }).name).toBe(name);
    }
  });

  it('knows exactly two legal values', () => {
    expect(VERDICT_ROUTER_NAMES).toEqual(['resultCode740', 'failureYamlTriage']);
    expect(DEFAULT_VERDICT_ROUTER).toBe('resultCode740');
    for (const name of VERDICT_ROUTER_NAMES) expect(isVerdictRouterName(name)).toBe(true);
    for (const other of ['ResultCode740', 'failureyamltriage', '', 'resultCode741']) {
      expect(isVerdictRouterName(other)).toBe(false);
    }
  });

  it('falls back with a diagnostic on an unknown value, and never throws', () => {
    for (const value of ['resultCode741', 'ResultCode740', '', 'failure-yaml-triage']) {
      const sink = createDiagnosticSink();
      const router = selectRouter({ verdictRouter: value }, sink);
      expect(router.name).toBe(DEFAULT_VERDICT_ROUTER);
      const entry = sink.withCode(VERDICT_ROUTER_DIAGNOSTIC_CODES.unknownRouter)[0];
      expect(entry?.severity).toBe('warn');
      expect(entry?.message).toContain(value);
      expect(entry?.file).toBe('.kept/config.json');
    }
  });

  it('says nothing when the value is simply absent', () => {
    // Absent is "not configured", which is not the same as misconfigured; a
    // diagnostic on every default start would be noise.
    for (const cfg of [{}, { verdictRouter: undefined }, { verdictRouter: null }]) {
      const sink = createDiagnosticSink();
      expect(selectRouter(cfg, sink).name).toBe(DEFAULT_VERDICT_ROUTER);
      expect(sink.size).toBe(0);
    }
    expect(selectRouter().name).toBe(DEFAULT_VERDICT_ROUTER);
  });
});

describe('normaliseVerdictObject crosses from the wire shape to the settled one', () => {
  it('refuses anything that is not recognisably a verdict object', () => {
    // `{}` in particular: an absent `confirmed` reads as not-confirmed, so
    // admitting an empty object would let rule 1 fire on no evidence at all.
    for (const value of [{}, null, undefined, [], 'confirmed', 42, { note: 'nothing here' }]) {
      expect(normaliseVerdictObject(value)).toBeNull();
    }
  });

  it('coerces every wire spelling of confirmed, and says when it could not', () => {
    for (const wire of [true, 'true', 'TRUE', ' yes ', '1', 1, 'confirmed']) {
      expect(normaliseVerdictObject({ confirmed: wire })).toMatchObject({
        confirmed: true,
        confirmedKnown: true,
      });
    }
    for (const wire of [false, 'false', 'no', '0', 0, 'unconfirmed']) {
      expect(normaliseVerdictObject({ confirmed: wire })).toMatchObject({
        confirmed: false,
        confirmedKnown: true,
      });
    }
    for (const wire of [null, 'maybe', 7, {}]) {
      expect(normaliseVerdictObject({ confirmed: wire, category: 'assertion' })).toMatchObject({
        confirmed: false,
        confirmedKnown: false,
      });
    }
  });

  it('settles severity into a string and confidence into a finite number', () => {
    expect(
      normaliseVerdictObject({
        confirmed: true,
        family: ' functional ',
        category: 'product_bug',
        severity: 2,
        one_liner: 'the subtotal does not update',
        confidence: ' 0.42 ',
      }),
    ).toEqual({
      confirmed: true,
      confirmedKnown: true,
      family: 'functional',
      category: 'product_bug',
      severity: '2',
      one_liner: 'the subtotal does not update',
      confidence: 0.42,
    });
  });

  it('answers null for a confidence that is not a number, and never 1 for a flag', () => {
    expect(normaliseVerdictObject({ confirmed: true, confidence: 'high' })?.confidence).toBeNull();
    expect(normaliseVerdictObject({ confirmed: true, confidence: true })?.confidence).toBeNull();
    expect(normaliseVerdictObject({ confirmed: true, confidence: '' })?.confidence).toBeNull();
    expect(normaliseVerdictObject({ confirmed: true, severity: '   ' })?.severity).toBeNull();
  });
});

describe('createFailureContext fills the context from the family, not the event', () => {
  it('resolves both evidence paths and the triage note from the newest pack', () => {
    const { ctx } = contextWith({ type: 'testrun_done' }, [
      { id: 'ev_older', files: { 'failure.yaml': 'category: selector\n' } },
      { id: 'ev_newest', files: { 'failure.yaml': PRODUCT_BUG_YAML, 'annotated.png': 'x' } },
    ]);
    expect(ctx.evidenceDir).toBe(`${REPO_ROOT}/.testmuai/evidence`);
    expect(ctx.packDir).toBe(`${REPO_ROOT}/.testmuai/evidence/ev_newest`);
    expect(ctx.failureYamlPath).toBe(`${REPO_ROOT}/.testmuai/evidence/ev_newest/failure.yaml`);
    expect(ctx.loadFailureYaml()?.signal).toBe('product_bug');
  });

  it('reads no disk until the note is pulled, and reads once however often it is', () => {
    const { ctx, reads } = contextWith({ type: 'testrun_done' }, [
      { id: 'ev_1', files: { 'failure.yaml': PRODUCT_BUG_YAML } },
    ]);
    expect(reads()).toBe(0);
    const first = ctx.loadFailureYaml();
    const second = ctx.loadFailureYaml();
    expect(reads()).toBe(1);
    expect(second).toBe(first);
  });

  it('normalises the terminal event\'s own verdict object', () => {
    const { ctx } = contextWith(
      { type: 'testrun_done', verdict: { confirmed: 'false', category: 'selector' } },
      [],
    );
    expect(ctx.verdictObject).toMatchObject({ confirmed: false, category: 'selector' });
  });

  it('accepts a verdict object read off a member event instead', () => {
    const { ctx } = contextWith({ type: 'testrun_done' }, []);
    expect(ctx.verdictObject).toBeNull();
    const withMember = createFailureContext({
      family: 'ExecutionTestrun',
      terminal: { type: 'testrun_done' },
      promiseId: 'p_000000000000',
      verdictObject: { confirmed: true, severity: 'high' },
    });
    expect(withMember.verdictObject).toMatchObject({ confirmed: true, severity: 'high' });
  });

  it('carries no path at all when the family seals no pack', () => {
    const context = createFailureContext({
      family: 'Assurance',
      terminal: { type: 'done' },
      promiseId: 'p_000000000000',
    });
    expect(context.evidenceDir).toBeNull();
    expect(context.packDir).toBeNull();
    expect(context.failureYamlPath).toBeNull();
    expect(context.loadFailureYaml()).toBeNull();
    expect(resolveEvidenceRef(context)).toBeNull();
  });
});

describe('resolveEvidenceRef never fabricates a path (R6.11)', () => {
  it('prefers the resolved failure.yaml, repository-relative', () => {
    const { ctx } = contextWith({ type: 'testrun_done' }, [
      { id: 'ev_1', files: { 'failure.yaml': PRODUCT_BUG_YAML } },
    ]);
    expect(resolveEvidenceRef(ctx)).toBe('.testmuai/evidence/ev_1/failure.yaml');
  });

  it('falls back to the pack directory when the pack holds no note', () => {
    const { ctx } = contextWith({ type: 'testrun_done' }, [
      { id: 'ev_1', files: { 'annotated.png': 'x' } },
    ]);
    expect(resolveEvidenceRef(ctx)).toBe('.testmuai/evidence/ev_1');
  });

  it('answers null rather than naming the directory that merely holds packs', () => {
    const { ctx } = contextWith({ type: 'testrun_done' }, []);
    expect(ctx.evidenceDir).not.toBeNull();
    expect(resolveEvidenceRef(ctx)).toBeNull();
  });

  it('leaves the path absolute when no repository root is known', () => {
    const tree = buildEvidenceTree([{ id: 'ev_1', files: { 'failure.yaml': PRODUCT_BUG_YAML } }]);
    const ctx = createFailureContext({
      family: 'ExecutionTestrun',
      terminal: { type: 'testrun_done' },
      promiseId: 'p_000000000000',
      evidence: testrunListing(tree),
      yaml: tree.yaml,
    });
    expect(resolveEvidenceRef(ctx)).toBe(`${REPO_ROOT}/.testmuai/evidence/ev_1/failure.yaml`);
  });

  it('is independent of the result code and of any tempting event field', () => {
    // No event field is ever consulted for a path: the pack hint reaches the
    // terminal on stderr only, and `run_dir` is legacy and no longer created.
    const { ctx } = contextWith(
      {
        type: 'testrun_done',
        [RESULT_CODE_FIELD]: 740,
        run_dir: '/trap/run',
        evidence_path: '/trap/evidence',
      },
      [{ id: 'ev_1', files: { 'failure.yaml': PRODUCT_BUG_YAML } }],
    );
    expect(resolveEvidenceRef(ctx)).toBe('.testmuai/evidence/ev_1/failure.yaml');
  });
});
