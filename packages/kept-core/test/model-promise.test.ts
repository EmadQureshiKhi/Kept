import { describe, expect, it } from 'vitest';

import {
  GRAPH_EDGE_KINDS,
  PROVIDER_NAMES,
  REPAIR_BRANCHES,
  REPAIR_STRATEGIES,
  VERDICTS,
  createDiagnosticSink,
  createPromiseGraph,
  createPromiseRecord,
  designedTestId,
  documentId,
  evidenceId,
  isCitation,
  isDesignedTest,
  isGraphEdge,
  isGraphEdgeKind,
  isPromiseGraph,
  isPromiseRecord,
  isProviderName,
  isRepairAnnotation,
  isRepairBranch,
  isRepairStrategy,
  isVerdict,
  isVerdictSource,
  promiseId,
  type Citation,
  type DesignedTest,
  type GraphEdge,
  type PromiseRecord,
  type RepairAnnotation,
  type Verdict,
  type VerdictSource,
} from '@kept/core';

/**
 * Unit tests for the promise model (design §3.1, R1.1, R1.6).
 *
 * The load-bearing one is the JSON round trip: `designedTest` is explicit `null`
 * and never `undefined` precisely because `JSON.stringify` drops an `undefined`
 * value's key, and the snapshot contract of §9.1 requires
 * `parse(serialise(x))` to deep-equal `x`.
 */

/** Named so the assertions below read as verdict comparisons, typed as verdicts. */
const RED: Verdict = 'red';
const UNDESIGNED: Verdict = 'undesigned';
const STALE: Verdict = 'stale';

const citation: Citation = {
  file: 'apps/fixture/README.md',
  line: 16,
  text: 'The cart subtotal updates on quantity change.',
};

const designedTest: DesignedTest = { path: 'tests/cart_subtotal_test.md', testId: 'T-3' };

const verdictSource: VerdictSource = {
  runId: 'run-1',
  terminalEventType: 'testrun_done',
  at: '2026-08-20T18:40:11.000Z',
  memberStatus: 'failed',
  resultCode: 740,
  reasonCode: 'assertion_failed',
};

const repair: RepairAnnotation = {
  branch: 'code-break',
  strategy: 'resultCode740',
  severity: 'high',
  category: 'functional',
  confidence: 0.9,
  evidenceRef: 'evidence/ev_20260820T184011Z/failure.yaml',
  rationale: 'Verdict object confirmed a product bug.',
};

describe('vocabularies', () => {
  it('supports the four verdict values and no others (R1.6)', () => {
    expect([...VERDICTS]).toEqual(['proven', 'red', 'undesigned', 'stale']);
    expect(VERDICTS).toHaveLength(4);
    for (const verdict of VERDICTS) expect(isVerdict(verdict)).toBe(true);
    for (const other of ['green', 'PROVEN', '', null, 0, undefined]) {
      expect(isVerdict(other)).toBe(false);
    }
  });

  it('fixes the repair branches, strategies, providers and edge kinds', () => {
    expect([...REPAIR_BRANCHES]).toEqual(['code-break', 'test-drift', 'docs-lie']);
    expect([...REPAIR_STRATEGIES]).toEqual(['resultCode740', 'failureYamlTriage']);
    expect([...PROVIDER_NAMES]).toEqual(['baseline', 'enrichment']);
    expect([...GRAPH_EDGE_KINDS]).toEqual(['cites', 'designed', 'evidence']);
    expect(isRepairBranch('docs-lie')).toBe(true);
    expect(isRepairBranch('doc-lie')).toBe(false);
    expect(isRepairStrategy('failureYamlTriage')).toBe(true);
    expect(isRepairStrategy('resultCode741')).toBe(false);
    expect(isProviderName('enrichment')).toBe(true);
    expect(isProviderName('baselines')).toBe(false);
    expect(isGraphEdgeKind('cites')).toBe(true);
    expect(isGraphEdgeKind('cite')).toBe(false);
  });
});

describe('createPromiseRecord', () => {
  it('constructs every field of a promise as design §3.1 specifies (R1.1)', () => {
    const record = createPromiseRecord({
      claim: '- The cart   subtotal updates on quantity change.\r',
      citation,
      designedTest,
      verdict: 'red',
      verdictSource,
      repair,
      evidencePackId: evidenceId('20260820T184011Z'),
      providers: ['baseline', 'enrichment'],
      credits: 0,
    });

    expect(record.id).toBe(promiseId(citation.file, citation.text));
    expect(record.claim).toBe('The cart subtotal updates on quantity change.');
    expect(record.citation).toEqual(citation);
    expect(record.designedTest).toEqual(designedTest);
    expect(record.verdict).toBe(RED);
    expect(record.verdictSource).toEqual(verdictSource);
    expect(record.repair).toEqual(repair);
    expect(record.evidencePackId).toBe('ev_20260820T184011Z');
    expect(record.providers).toEqual(['baseline', 'enrichment']);
    expect(record.credits).toBe(0);
    expect(isPromiseRecord(record)).toBe(true);
  });

  it('derives the id, so it can never disagree with the citation and claim', () => {
    const record = createPromiseRecord({ claim: citation.text, citation, providers: ['baseline'] });
    const moved = createPromiseRecord({
      claim: citation.text,
      citation: { ...citation, line: 92 },
      providers: ['baseline'],
    });
    expect(moved.id).toBe(record.id);
  });

  it('normalises the citation path to POSIX', () => {
    const record = createPromiseRecord({
      claim: citation.text,
      citation: { ...citation, file: './apps\\fixture/README.md' },
      providers: ['baseline'],
    });
    expect(record.citation.file).toBe('apps/fixture/README.md');
    expect(isCitation(record.citation)).toBe(true);
  });

  it('writes explicit nulls for every absent field, never undefined', () => {
    const record = createPromiseRecord({ claim: citation.text, citation, providers: ['baseline'] });
    expect(record.designedTest).toBeNull();
    expect(record.verdictSource).toBeNull();
    expect(record.repair).toBeNull();
    expect(record.evidencePackId).toBeNull();
    expect(record.credits).toBeNull();
    for (const key of [
      'designedTest',
      'verdictSource',
      'repair',
      'evidencePackId',
      'credits',
    ] as const) {
      expect(Object.hasOwn(record, key), key).toBe(true);
      expect(record[key], key).not.toBeUndefined();
    }
  });

  it('coerces an explicitly undefined designedTest to null (R1.1)', () => {
    const record = createPromiseRecord({
      claim: citation.text,
      citation,
      designedTest: undefined,
      providers: ['baseline'],
    });
    expect(record.designedTest).toBeNull();
    expect(JSON.parse(JSON.stringify(record))).toHaveProperty('designedTest', null);
  });

  it('defaults undesigned without a test and stale with one but no verdict', () => {
    expect(
      createPromiseRecord({ claim: citation.text, citation, providers: ['baseline'] }).verdict,
    ).toBe(UNDESIGNED);
    expect(
      createPromiseRecord({ claim: citation.text, citation, designedTest, providers: ['baseline'] })
        .verdict,
    ).toBe(STALE);
  });

  it('deduplicates providers into baseline-then-enrichment order', () => {
    const record = createPromiseRecord({
      claim: citation.text,
      citation,
      providers: ['enrichment', 'baseline', 'enrichment'],
      });
    expect(record.providers).toEqual(['baseline', 'enrichment']);
  });

  it('throws on an empty provider list, a programming error not a world state', () => {
    expect(() => createPromiseRecord({ claim: citation.text, citation, providers: [] })).toThrow(
      TypeError,
    );
  });
});

describe('designedTest is explicit null, never undefined', () => {
  it('survives a JSON round trip with the key intact', () => {
    const record = createPromiseRecord({ claim: citation.text, citation, providers: ['baseline'] });
    const serialised = JSON.stringify(record);
    expect(serialised).toContain('"designedTest":null');

    const parsed: unknown = JSON.parse(serialised);
    expect(parsed).toEqual(record);
    expect(isPromiseRecord(parsed)).toBe(true);
    expect(Object.keys(parsed as object).sort()).toEqual(Object.keys(record).sort());
  });

  it('proves the counterfactual: an undefined designedTest loses its key', () => {
    // This is the whole reason for the rule. The `undefined` shape below is what
    // the model refuses to produce, and the guard refuses to accept.
    const wrong = { ...createPromiseRecord({ claim: citation.text, citation, providers: ['baseline'] }), designedTest: undefined };
    const round: unknown = JSON.parse(JSON.stringify(wrong));
    expect(Object.hasOwn(round as object, 'designedTest')).toBe(false);
    expect(isPromiseRecord(round)).toBe(false);
    // …and the correct shape keeps it.
    expect(isPromiseRecord(JSON.parse(JSON.stringify({ ...wrong, designedTest: null })))).toBe(true);
  });

  it('rejects a dropped key for every nullable field, rather than defaulting it', () => {
    const record = createPromiseRecord({ claim: citation.text, citation, providers: ['baseline'] });
    for (const key of [
      'designedTest',
      'verdictSource',
      'repair',
      'evidencePackId',
      'credits',
    ] as const) {
      const stripped: Record<string, unknown> = { ...record };
      delete stripped[key];
      expect(isPromiseRecord(stripped), key).toBe(false);
    }
  });
});

describe('createPromiseGraph', () => {
  const claims = ['Checkout is fast.', 'The cart subtotal updates.', 'Shipping is free.'];
  const records: PromiseRecord[] = claims.map((claim, index) =>
    createPromiseRecord({
      claim,
      citation: { file: 'apps/fixture/README.md', line: index + 1, text: claim },
      providers: ['baseline'],
    }),
  );
  const edges: GraphEdge[] = [
    { from: documentId('apps/fixture/README.md'), to: records[0]!.id, kind: 'cites' },
    { from: records[0]!.id, to: designedTestId('tests/a_test.md'), kind: 'designed' },
    { from: records[0]!.id, to: evidenceId('20260820T184011Z'), kind: 'evidence' },
  ];

  it('sorts promises by id and edges by (kind, from, to), whatever the input order', () => {
    const graph = createPromiseGraph({ promises: [...records].reverse(), edges: [...edges].reverse() });
    expect(graph.promises.map((p) => p.id)).toEqual(
      [...records.map((p) => p.id)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    expect(graph.edges.map((e) => e.kind)).toEqual(['cites', 'designed', 'evidence']);
    expect(isPromiseGraph(graph)).toBe(true);
  });

  it('produces the same graph whichever order the promises were discovered in', () => {
    const forward = createPromiseGraph({ promises: records, edges });
    const backward = createPromiseGraph({ promises: [...records].reverse(), edges: [...edges].reverse() });
    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward));
  });

  it('collapses exactly duplicate edges', () => {
    const graph = createPromiseGraph({ promises: records, edges: [...edges, ...edges] });
    expect(graph.edges).toHaveLength(edges.length);
  });

  it('defaults to an empty, non-degraded graph', () => {
    const graph = createPromiseGraph();
    expect(graph).toEqual({
      promises: [],
      edges: [],
      degraded: false,
      degradedReasons: [],
      diagnostics: [],
    });
    expect(isPromiseGraph(graph)).toBe(true);
  });

  it('carries degradation reasons and diagnostics through a JSON round trip', () => {
    const sink = createDiagnosticSink({ clock: () => new Date('2026-08-20T18:40:11.000Z') });
    sink.report({ code: 'kane-not-found', severity: 'warn', message: 'kane-cli was not found' });
    const graph = createPromiseGraph({
      promises: records,
      edges,
      degraded: true,
      degradedReasons: ['kane-not-found'],
      diagnostics: sink.entries,
    });
    const round: unknown = JSON.parse(JSON.stringify(graph));
    expect(round).toEqual(graph);
    expect(isPromiseGraph(round)).toBe(true);
  });

  it('rejects an unsorted graph at the boundary', () => {
    const graph = createPromiseGraph({ promises: records, edges });
    expect(isPromiseGraph({ ...graph, promises: [...graph.promises].reverse() })).toBe(false);
    expect(isPromiseGraph({ ...graph, edges: [...graph.edges].reverse() })).toBe(false);
    expect(isPromiseGraph({ ...graph, degraded: 'yes' })).toBe(false);
    expect(isPromiseGraph(null)).toBe(false);
  });
});

describe('boundary guards', () => {
  it('accepts the valid sub-records and rejects malformed ones', () => {
    expect(isCitation(citation)).toBe(true);
    expect(isCitation({ ...citation, line: 0 })).toBe(false);
    expect(isCitation({ ...citation, line: 1.5 })).toBe(false);
    expect(isCitation({ ...citation, file: 'apps\\fixture\\README.md' })).toBe(false);
    expect(isCitation({ ...citation, text: undefined })).toBe(false);

    expect(isDesignedTest(designedTest)).toBe(true);
    expect(isDesignedTest({ path: 'tests/a_test.md', testId: null })).toBe(true);
    expect(isDesignedTest({ path: 'tests/a_test.md' })).toBe(false);

    expect(isVerdictSource(verdictSource)).toBe(true);
    expect(isVerdictSource({ ...verdictSource, memberStatus: 'skipped' })).toBe(false);
    expect(isVerdictSource({ ...verdictSource, at: 'not-a-date' })).toBe(false);

    expect(isRepairAnnotation(repair)).toBe(true);
    expect(isRepairAnnotation({ ...repair, branch: 'doc-lie' })).toBe(false);
    expect(isRepairAnnotation({ ...repair, rationale: undefined })).toBe(false);

    expect(isGraphEdge({ from: 'p_000000000000', to: 'd_000000000000', kind: 'cites' })).toBe(true);
    expect(isGraphEdge({ from: '', to: 'd_000000000000', kind: 'cites' })).toBe(false);
  });

  it('rejects a promise record whose id is not p_ plus twelve lowercase hex', () => {
    const record = createPromiseRecord({ claim: citation.text, citation, providers: ['baseline'] });
    expect(isPromiseRecord({ ...record, id: 'promise-1' })).toBe(false);
    expect(isPromiseRecord({ ...record, id: record.id.toUpperCase() })).toBe(false);
    expect(isPromiseRecord({ ...record, providers: [] })).toBe(false);
    expect(isPromiseRecord({ ...record, verdict: 'green' })).toBe(false);
  });
});
