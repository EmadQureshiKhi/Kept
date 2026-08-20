import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  REPAIR_BRANCHES,
  RESULT_CODE_FIELD,
  createDiagnosticSink,
  createFailureContext,
  selectRouter,
  type FailureContext,
  type RepairBranch,
} from '@kept/core';

import { REPO_ROOT, buildEvidenceTree, testrunListing } from './verdict-evidence-tree.js';

/**
 * The `failureYamlTriage` strategy (task 11.4, design §6.3, R6.7, R6.13).
 *
 * Two halves. The first is the requirement that this ships working regardless of
 * the verdict spike's outcome, tested against **all four** committed
 * `failure-*.yaml` fixtures — one per triage class, including the deliberately
 * invalid one. The second is the ordering argument: a test-mechanics signal
 * outranks the assertion-class band, which is what stops an ordinary stale
 * selector being filed as a lie in the README.
 *
 * Reached through `selectRouter`, like every consumer (R6.10). The concrete module
 * is deliberately not imported: nothing outside `src/verdict/` may name it, and a
 * suite that reached around the door would be modelling a call site the source
 * scan forbids.
 */

const router = selectRouter({ verdictRouter: 'failureYamlTriage' });

/** The four committed fixtures, and the branch design §6.3 requires for each. */
const COMMITTED_FIXTURES: readonly {
  readonly file: string;
  readonly branch: RepairBranch;
  readonly because: string;
}[] = [
  {
    file: 'failure-product-bug.yaml',
    branch: 'code-break',
    because: 'nested triage.category is product_bug — positive evidence of a product fault',
  },
  {
    file: 'failure-selector.yaml',
    branch: 'test-drift',
    because: 'top-level category is selector_not_found, and it outranks the code band',
  },
  {
    file: 'failure-assertion.yaml',
    branch: 'docs-lie',
    because: 'classification is assertion with a code inside the band — a claim never true',
  },
  {
    file: 'failure-unparseable.yaml',
    branch: 'docs-lie',
    because: 'the note does not parse, so no signal exists and the residue is the default',
  },
];

function fixtureText(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

function build(
  note: string | null,
  terminal: Record<string, unknown> = { type: 'testrun_done' },
): { readonly ctx: FailureContext; readonly reads: () => number } {
  const files: Record<string, string> = { 'annotated.png': 'x' };
  if (note !== null) files['failure.yaml'] = note;
  const tree = buildEvidenceTree([{ id: 'ev_1', files }]);
  return {
    ctx: createFailureContext({
      family: 'ExecutionTestrun',
      terminal,
      promiseId: 'p_000000000000',
      memberStatus: 'failed',
      evidence: testrunListing(tree),
      repoRoot: REPO_ROOT,
      yaml: tree.yaml,
      diagnostics: createDiagnosticSink(),
    }),
    reads: tree.reads,
  };
}

describe('the four committed failure.yaml fixtures each route to their class', () => {
  for (const fixture of COMMITTED_FIXTURES) {
    it(`${fixture.file} routes ${fixture.branch} — ${fixture.because}`, () => {
      const { ctx } = build(fixtureText(fixture.file));
      const routed = router.route(ctx);
      expect(routed.branch).toBe(fixture.branch);
      expect(routed.strategy).toBe('failureYamlTriage');
      expect(routed.evidenceRef).toBe('.testmuai/evidence/ev_1/failure.yaml');
    });
  }

  it('surfaces the note\'s own severity, category and confidence', () => {
    const { ctx } = build(fixtureText('failure-product-bug.yaml'));
    const routed = router.route(ctx);
    expect(routed.severity).toBe('high');
    expect(routed.category).toBe('product_bug');
    expect(routed.confidence).toBe(0.9);
  });

  it('reads the assertion fixture\'s code through the coercing accessor', () => {
    // The fixture quotes it as the string "742"; the band check still sees a
    // number, and the rationale says so in words rather than as a range.
    const { ctx } = build(fixtureText('failure-assertion.yaml'));
    expect(router.route(ctx).rationale).toContain('seven hundred');
  });

  it('claims nothing about severity when the note never parsed', () => {
    const { ctx } = build(fixtureText('failure-unparseable.yaml'));
    const routed = router.route(ctx);
    expect(routed.severity).toBeNull();
    expect(routed.category).toBeNull();
    expect(routed.confidence).toBeNull();
    expect(routed.rationale).toContain('unparseable');
  });
});

describe('the signal lists of design §6.3', () => {
  const cases: readonly { readonly signal: string; readonly branch: RepairBranch }[] = [
    { signal: 'product_bug', branch: 'code-break' },
    { signal: 'app_error', branch: 'code-break' },
    { signal: 'server_error', branch: 'code-break' },
    { signal: 'http_5xx', branch: 'code-break' },
    { signal: 'crash', branch: 'code-break' },
    { signal: 'console_error', branch: 'code-break' },
    { signal: 'selector_not_found', branch: 'test-drift' },
    { signal: 'locator', branch: 'test-drift' },
    { signal: 'element_not_found', branch: 'test-drift' },
    { signal: 'stale_element', branch: 'test-drift' },
    { signal: 'timeout', branch: 'test-drift' },
    { signal: 'navigation', branch: 'test-drift' },
    { signal: 'flaky', branch: 'test-drift' },
    { signal: 'timing', branch: 'test-drift' },
    { signal: 'assertion', branch: 'docs-lie' },
    { signal: 'expectation_mismatch', branch: 'docs-lie' },
    { signal: 'value_mismatch', branch: 'docs-lie' },
  ];

  for (const { signal, branch } of cases) {
    it(`maps ${signal} to ${branch}`, () => {
      const { ctx } = build(`category: ${signal}\n`);
      expect(router.route(ctx).branch).toBe(branch);
    });
  }

  it('reads the signal from all four accepted fields, precedence first', () => {
    const notes = [
      'triage:\n  category: product_bug\n',
      'category: product_bug\n',
      'classification: product_bug\n',
      'reason: product_bug\n',
    ];
    for (const note of notes) {
      const { ctx } = build(note);
      expect(router.route(ctx).branch).toBe('code-break');
    }
  });

  it('lets the higher-precedence field win when two disagree', () => {
    const { ctx } = build('triage:\n  category: product_bug\nclassification: selector_not_found\n');
    expect(router.route(ctx).branch).toBe('code-break');
  });

  it('is case-insensitive, because the note is hand-authored text', () => {
    const { ctx } = build('category: Product_Bug\n');
    expect(router.route(ctx).branch).toBe('code-break');
  });
});

describe('the ordering argument (design §6.3)', () => {
  it('lets a mechanics signal outrank a code inside the assertion band', () => {
    // The committed selector fixture is the discriminator for this: it carries a
    // code inside the band on purpose.
    const { ctx } = build('category: selector_not_found\n', {
      type: 'testrun_done',
      [RESULT_CODE_FIELD]: 715,
    });
    const routed = router.route(ctx);
    expect(routed.branch).toBe('test-drift');
    expect(routed.rationale).toContain('outranks');
  });

  it('lets a product-fault signal outrank a code inside the band too', () => {
    const { ctx } = build('category: product_bug\n', {
      type: 'testrun_done',
      [RESULT_CODE_FIELD]: '742',
    });
    expect(router.route(ctx).branch).toBe('code-break');
  });

  it('resolves a compound signal by the strongest positive evidence in it', () => {
    const { ctx } = build('category: assertion_timeout\n');
    expect(router.route(ctx).branch).toBe('test-drift');
  });

  it('routes docs-lie for an assertion signal with no code at all', () => {
    const { ctx } = build('category: assertion\n');
    const routed = router.route(ctx);
    expect(routed.branch).toBe('docs-lie');
    expect(routed.rationale).toContain('none reported');
  });

  it('prefers the terminal event\'s code over the note\'s copy of one', () => {
    const { ctx } = build('classification: assertion\nresult_code: "999"\n', {
      type: 'testrun_done',
      [RESULT_CODE_FIELD]: 742,
    });
    expect(router.route(ctx).rationale).toContain('742');
  });
});

describe('absent, unrecognised, and shapes a real file can take', () => {
  it('routes docs-lie with no note in the pack at all', () => {
    const { ctx } = build(null);
    const routed = router.route(ctx);
    expect(routed.branch).toBe('docs-lie');
    expect(routed.rationale).toContain('absent');
    expect(routed.evidenceRef).toBe('.testmuai/evidence/ev_1');
  });

  it('routes docs-lie for an unrecognised signal, and says what it read', () => {
    const { ctx } = build('category: gremlins\n');
    const routed = router.route(ctx);
    expect(routed.branch).toBe('docs-lie');
    expect(routed.rationale).toContain('gremlins');
    expect(routed.category).toBe('gremlins');
  });

  it('routes docs-lie for an empty document, a bare scalar and a sequence', () => {
    for (const note of ['', 'a bare note with no fields\n', '- first\n- second\n']) {
      const { ctx } = build(note);
      expect(router.route(ctx).branch).toBe('docs-lie');
    }
  });

  it('returns one of the three branches for every one of these notes', () => {
    for (const note of ['', '{}\n', 'category: ""\n', 'triage: null\n', 'reason: "  "\n']) {
      const { ctx } = build(note);
      expect(REPAIR_BRANCHES).toContain(router.route(ctx).branch);
    }
  });

  it('reads the note once even when routed twice', () => {
    const { ctx, reads } = build(fixtureText('failure-selector.yaml'));
    const first = router.route(ctx);
    const second = router.route(ctx);
    expect(reads()).toBe(1);
    expect(second).toEqual(first);
  });
});
