import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_KINDS,
  COMMAND_FAMILIES,
  EXIT_MEANINGS,
  LedgerSnapshotSchema,
  MAX_SNAPSHOT_RUNS,
  SNAPSHOT_SCHEMA_VERSION,
  TERMINAL_EVENT_TYPES,
  contractFor,
  designedTestId,
  documentId,
  evidencePackIdFromRef,
  isLedgerSnapshot,
  promiseId,
  type LedgerSnapshot,
} from 'kept-core';

/**
 * The ledger snapshot schema — the CLI↔UI seam (design §9.1, R8.8).
 *
 * The five cross-field rules are the point of this suite. Field-level types keep
 * a malformed value out; the cross-field rules keep an *internally inconsistent*
 * snapshot out, which is the failure that would otherwise reach a judge: a
 * metric rail that disagrees with the promise list under it, an evidence link
 * that 404s, an edge pointing at a node that is not there. Every rule is asserted
 * to name its offending path, because R8.8 asks the failing build to name the
 * field and "the snapshot is invalid" is not a diagnostic anybody can act on.
 */

const DOC = 'apps/fixture/README.md';
const CLAIM = '- The Cart screen shows a running subtotal that updates immediately.';
const TEST_PATH = 'tests/cart_subtotal_test.md';
const PACK = 'ev_20260820T184011Z';
const AT = '2026-08-20T18:40:11.000Z';

const PID = promiseId(DOC, CLAIM);
const DID = documentId(DOC);
const TID = designedTestId(TEST_PATH);

/** The empty graph: zero promises, both coverage figures null (R9.3). */
function emptySnapshot(): LedgerSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: '2026-08-20T18:41:02.118Z',
    generator: { kept: '0.0.0', kaneCli: null },
    degraded: false,
    degradedReasons: [],
    freshness: { terminalEventAt: null, terminalEventType: null, commandFamily: null },
    metrics: {
      totalPromises: 0,
      designedCount: 0,
      provenCount: 0,
      redCount: 0,
      staleCount: 0,
      undesignedCount: 0,
      designedCoverage: null,
      provenCoverage: null,
    },
    promises: [],
    edges: [],
    documents: [],
    evidence: [],
    runs: [],
    reviewCards: [],
    amendments: [],
    diagnostics: [],
  };
}

/** One red promise with a designed test, an evidence pack, and all three edges. */
function fullSnapshot(): LedgerSnapshot {
  return {
    ...emptySnapshot(),
    freshness: {
      terminalEventAt: AT,
      terminalEventType: 'testrun_done',
      commandFamily: 'ExecutionTestrun',
    },
    metrics: {
      totalPromises: 1,
      designedCount: 1,
      provenCount: 0,
      redCount: 1,
      staleCount: 0,
      undesignedCount: 0,
      designedCoverage: 1,
      provenCoverage: 0,
    },
    promises: [
      {
        id: PID,
        claim: CLAIM,
        citation: { file: DOC, line: 16, text: CLAIM },
        designedTest: { path: TEST_PATH, testId: 'T-3' },
        verdict: 'red',
        verdictSource: {
          runId: 'tr_20260820T184011Z',
          terminalEventType: 'testrun_done',
          at: AT,
          memberStatus: 'failed',
          resultCode: 740,
          reasonCode: 'failure.product_bug',
        },
        repair: {
          branch: 'code-break',
          strategy: 'resultCode740',
          severity: 'high',
          category: 'functional',
          confidence: 0.9,
          evidenceRef: `evidence/${PACK}/failure.yaml`,
          rationale: 'Verdict object confirmed a product bug (result_code 740).',
        },
        evidencePackId: PACK,
        providers: ['baseline', 'enrichment'],
        credits: 0,
      },
    ],
    edges: [
      { from: DID, to: PID, kind: 'cites' },
      { from: PID, to: TID, kind: 'designed' },
      { from: PID, to: PACK, kind: 'evidence' },
    ],
    documents: [{ id: DID, file: DOC, claimCount: 1 }],
    evidence: [
      {
        id: PACK,
        kind: 'testrun',
        sealedAt: '2026-08-20T18:40:20.000Z',
        publicPath: `/evidence/${PACK}/`,
        artifacts: [
          {
            kind: 'annotated',
            name: 'annotated.png',
            publicPath: `/evidence/${PACK}/annotated.png`,
            bytes: null,
          },
          {
            kind: 'failure-yaml',
            name: 'failure.yaml',
            publicPath: `/evidence/${PACK}/failure.yaml`,
            bytes: 1024,
          },
        ],
      },
    ],
  };
}

/** Parse and return the dotted paths of every issue, in report order. */
function issuePaths(value: unknown): string[] {
  const result = LedgerSnapshotSchema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) =>
    issue.path.map((key) => String(key)).join('.'),
  );
}

/** Every issue message, joined — used to assert a path is named in the text. */
function issueMessages(value: unknown): string {
  const result = LedgerSnapshotSchema.safeParse(value);
  if (result.success) return '';
  return result.error.issues.map((issue) => issue.message).join(' | ');
}

/** Mutate a deep clone of a valid snapshot, so no test leaks into another. */
function broken(mutate: (snapshot: LedgerSnapshot) => void): LedgerSnapshot {
  const copy = structuredClone(fullSnapshot());
  mutate(copy);
  return copy;
}

describe('Feature: kept, ledger snapshot schema (design §9.1)', () => {
  it('accepts the empty graph with both coverage figures null', () => {
    expect(isLedgerSnapshot(emptySnapshot())).toBe(true);
  });

  it('accepts a fully populated snapshot', () => {
    const result = LedgerSnapshotSchema.safeParse(fullSnapshot());
    expect(result.success).toBe(true);
  });

  it('pins schemaVersion to the one version this build reads', () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(issuePaths(broken((s) => Object.assign(s, { schemaVersion: 2 })))).toContain(
      'schemaVersion',
    );
  });

  it('derives the terminal event vocabulary from the contract table', () => {
    expect([...TERMINAL_EVENT_TYPES]).toEqual(
      COMMAND_FAMILIES.map((family) => contractFor(family).terminalType),
    );
    expect([...TERMINAL_EVENT_TYPES]).toEqual(['run_end', 'testrun_done', 'done']);
  });

  it('reuses the artefact and exit vocabularies rather than restating them', () => {
    // A snapshot that enumerated its own copy would be a second authority.
    expect(ARTIFACT_KINDS).toContain('failure-yaml');
    expect(EXIT_MEANINGS).toHaveLength(8);
    const runs = broken((s) => {
      s.runs = [
        {
          id: 'tr_1',
          family: 'ExecutionTestrun',
          command: 'testrun run --from-context T-3',
          startedAt: AT,
          endedAt: AT,
          durationMs: 0,
          exitCode: 1,
          exitMeaning: 'failure',
          terminalSeen: true,
          terminalEventType: 'testrun_done',
          status: 'failed',
          resultCode: 740,
          reasonCode: 'failure.product_bug',
          credits: 0,
          verdictObject: null,
          evidencePackId: PACK,
          members: [
            { path: TEST_PATH, testId: 'T-3', status: 'failed', verdict: 'red' },
          ],
          diagnostics: [],
        },
      ];
    });
    expect(LedgerSnapshotSchema.safeParse(runs).success).toBe(true);
  });

  describe('the run cap, which provenance raises rather than breaks (rule 7)', () => {
    /** `count` runs with distinct ids, valid against the run schema. */
    function runsOf(count: number): readonly Record<string, unknown>[] {
      return Array.from({ length: count }, (_unused, index) => ({
        id: `tr_${String(index).padStart(3, '0')}`,
        family: 'ExecutionTestrun',
        command: 'testrun run',
        startedAt: null,
        endedAt: AT,
        durationMs: null,
        exitCode: 0,
        exitMeaning: 'success',
        terminalSeen: true,
        terminalEventType: 'testrun_done',
        status: 'passed',
        resultCode: null,
        reasonCode: null,
        credits: null,
        verdictObject: null,
        evidencePackId: null,
        members: [],
        diagnostics: [],
      }));
    }

    it('caps the run log so the committed file stays reviewable', () => {
      expect(MAX_SNAPSHOT_RUNS).toBe(20);
      expect(
        issuePaths(
          broken((s) => {
            s.runs = runsOf(MAX_SNAPSHOT_RUNS + 1) as never;
          }),
        ),
        'a log longer than the cap, cited by nothing, is still refused',
      ).toContain('runs');
    });

    it('accepts exactly the cap', () => {
      const value = broken((s) => {
        s.runs = runsOf(MAX_SNAPSHOT_RUNS) as never;
      });
      expect(issuePaths(value)).not.toContain('runs');
    });

    /**
     * The scenario that used to make `kept snapshot` refuse to write and exit zero.
     *
     * The projection keeps every run a promise names as its verdict source, regardless of
     * age, so that no verdict points at a run the file does not carry. A flat `max` on
     * this field contradicted that outright: past the cap the two rules could not both
     * hold, the self-check failed, the file was never written, the previously committed
     * snapshot stood forever, and the command exited zero with nothing red anywhere. It
     * is unreachable at thirteen promises and ordinary on a host repository that verifies
     * twenty-one of them across separate runs.
     *
     * So the cap is raised to the cited count when the cited count is larger, and this
     * asserts the raise rather than the absence of a bound: one run past the raised
     * allowance is still refused, and it is refused naming `runs`.
     */
    it('raises the cap to the number of runs the promises cite', () => {
      const cited = MAX_SNAPSHOT_RUNS + 5;
      const withCitations = (count: number) =>
        broken((s) => {
          const runs = runsOf(count);
          s.runs = runs as never;
          // One promise per run, each citing its own, so the cited count is the log length.
          const template = s.promises[0];
          if (template === undefined) throw new Error('the fixture carries no promise to clone');
          s.promises = runs.map((run, index) => ({
            ...template,
            id: `p_${String(index).padStart(12, '0')}`,
            verdict: 'proven',
            verdictSource: {
              runId: String(run['id']),
              terminalEventType: 'testrun_done',
              at: AT,
              memberStatus: 'passed',
              resultCode: null,
              reasonCode: null,
            },
            repair: null,
            evidencePackId: null,
          })) as never;
          // The counts rule is independent of this one and would otherwise mask it.
          s.metrics = {
            totalPromises: count,
            designedCount: count,
            undesignedCount: 0,
            provenCount: count,
            redCount: 0,
            staleCount: 0,
            designedCoverage: 1,
            provenCoverage: 1,
          } as never;
          s.edges = [] as never;
          s.documents = [] as never;
          s.coverageAxes = null as never;
        });

      expect(
        issuePaths(withCitations(cited)),
        'a log of cited runs longer than the flat cap must be accepted, or no verdict is openable',
      ).not.toContain('runs');

      // And it is still a cap: one uncited run past the raised allowance is refused.
      const overrun = withCitations(cited) as unknown as { runs: unknown[] };
      overrun.runs = [...overrun.runs, ...runsOf(1).map((run) => ({ ...run, id: 'tr_extra' }))];
      expect(issuePaths(overrun)).toContain('runs');
    });

    it('names the arithmetic in the message, so a build says what to drop', () => {
      const value = broken((s) => {
        s.runs = runsOf(MAX_SNAPSHOT_RUNS + 2) as never;
      });
      const result = LedgerSnapshotSchema.safeParse(value);
      expect(result.success).toBe(false);
      if (result.success) return;
      const issue = result.error.issues.find((entry) => entry.path[0] === 'runs');
      expect(issue?.message).toContain(`at most ${MAX_SNAPSHOT_RUNS} are allowed`);
      expect(issue?.message).toContain('Drop the oldest run no promise cites.');
    });
  });

  describe('explicit null, never undefined (design §9.1)', () => {
    it('rejects a promise whose designedTest key was dropped', () => {
      const value = structuredClone(fullSnapshot()) as unknown as {
        promises: Array<Record<string, unknown>>;
      };
      delete value.promises[0]?.['designedTest'];
      expect(issuePaths(value)).toContain('promises.0.designedTest');
    });

    it.each(['verdictSource', 'repair', 'evidencePackId', 'credits'])(
      'rejects a promise whose %s key was dropped',
      (field) => {
        const value = structuredClone(fullSnapshot()) as unknown as {
          promises: Array<Record<string, unknown>>;
        };
        delete value.promises[0]?.[field];
        expect(issuePaths(value)).toContain(`promises.0.${field}`);
      },
    );

    it('rejects an unknown key rather than silently stripping it', () => {
      const paths = issuePaths(broken((s) => Object.assign(s, { extra: 1 })));
      // A strict-object violation is reported at the containing object, and the
      // message names the offending key.
      expect(paths).toContain('');
      expect(issueMessages(broken((s) => Object.assign(s, { extra: 1 })))).toMatch(/extra/);
    });

    it('rejects a Date where an ISO 8601 string belongs', () => {
      expect(
        issuePaths(broken((s) => Object.assign(s, { generatedAt: new Date(AT) }))),
      ).toContain('generatedAt');
    });
  });

  describe('rule 1: count agreement', () => {
    it('names metrics.totalPromises when it disagrees with promises.length', () => {
      const value = broken((s) => {
        s.metrics.totalPromises = 4;
      });
      expect(issuePaths(value)).toContain('metrics.totalPromises');
      expect(issueMessages(value)).toMatch(/metrics\.totalPromises: expected 1/);
    });

    it.each([
      ['designedCount', 0],
      ['provenCount', 1],
      ['redCount', 0],
      ['staleCount', 1],
      ['undesignedCount', 1],
    ] as const)('names metrics.%s when it disagrees with the promise list', (field, wrong) => {
      const value = broken((s) => {
        s.metrics[field] = wrong;
      });
      expect(issuePaths(value)).toContain(`metrics.${field}`);
    });
  });

  describe('rule 2: coverage nullability', () => {
    it('requires designedCoverage null exactly when there are no promises', () => {
      const nonNull = structuredClone(emptySnapshot());
      nonNull.metrics.designedCoverage = 0;
      expect(issuePaths(nonNull)).toContain('metrics.designedCoverage');
      expect(issueMessages(nonNull)).toMatch(/R9\.3/);

      const nulled = broken((s) => {
        s.metrics.designedCoverage = null;
      });
      expect(issuePaths(nulled)).toContain('metrics.designedCoverage');
    });

    it('requires designedCoverage to equal designedCount / totalPromises', () => {
      const value = broken((s) => {
        s.metrics.designedCoverage = 0.5;
      });
      expect(issuePaths(value)).toContain('metrics.designedCoverage');
    });

    it('requires provenCoverage null while degraded, and only then', () => {
      const degraded = broken((s) => {
        s.degraded = true;
        s.degradedReasons = ['kane-cli not found'];
      });
      expect(issuePaths(degraded)).toContain('metrics.provenCoverage');
      expect(issueMessages(degraded)).toMatch(/R2\.11/);

      const fixed = broken((s) => {
        s.degraded = true;
        s.degradedReasons = ['kane-cli not found'];
        s.metrics.provenCoverage = null;
      });
      expect(LedgerSnapshotSchema.safeParse(fixed).success).toBe(true);
    });

    it('requires provenCoverage to equal provenCount / totalPromises', () => {
      const value = broken((s) => {
        s.metrics.provenCoverage = 1;
      });
      expect(issuePaths(value)).toContain('metrics.provenCoverage');
    });

    it('rejects a coverage figure expressed as a percentage', () => {
      // 100 is not a ratio. Caught at the field, before the identity rule runs.
      expect(issuePaths(broken((s) => Object.assign(s.metrics, { designedCoverage: 100 })))).toContain(
        'metrics.designedCoverage',
      );
    });
  });

  describe('rule 3: evidence-reference resolution', () => {
    it('names promises[i].evidencePackId when the pack is absent', () => {
      const value = broken((s) => {
        s.evidence = [];
        s.edges = s.edges.filter((edge) => edge.to !== PACK);
      });
      expect(issuePaths(value)).toContain('promises.0.evidencePackId');
    });

    it('names promises[i].repair.evidenceRef when it points at another pack', () => {
      const value = broken((s) => {
        if (s.promises[0]?.repair) {
          s.promises[0].repair.evidenceRef = 'evidence/ev_other/failure.yaml';
        }
      });
      expect(issuePaths(value)).toContain('promises.0.repair.evidenceRef');
    });

    it('names promises[i].repair.evidenceRef when it names no pack at all', () => {
      const value = broken((s) => {
        if (s.promises[0]?.repair) s.promises[0].repair.evidenceRef = 'notes/failure.yaml';
      });
      expect(issuePaths(value)).toContain('promises.0.repair.evidenceRef');
    });

    it('extracts the pack from a repo-relative reference', () => {
      expect(evidencePackIdFromRef(`evidence/${PACK}/failure.yaml`)).toBe(PACK);
      expect(evidencePackIdFromRef('notes/failure.yaml')).toBeNull();
    });

    it('rejects an absolute evidence reference', () => {
      // `kane/evidence.ts` returns absolute paths; the snapshot writer must
      // rewrite them to repo-relative, and mixing the two inside one value is
      // the bug this catches.
      const value = broken((s) => {
        if (s.promises[0]?.repair) {
          s.promises[0].repair.evidenceRef = `/Users/x/.testmuai/evidence/${PACK}/failure.yaml`;
        }
      });
      expect(issuePaths(value)).toContain('promises.0.repair.evidenceRef');
    });
  });

  describe('rule 4: edge endpoint resolution', () => {
    it('names edges[i].from when the endpoint is not a node id at all', () => {
      const value = broken((s) => {
        if (s.edges[0]) s.edges[0].from = TEST_PATH;
      });
      expect(issuePaths(value)).toContain('edges.0.from');
      expect(issueMessages(value)).toMatch(/not a graph node id/);
    });

    it('names edges[i].from when a well-formed id is absent from the snapshot', () => {
      const value = broken((s) => {
        if (s.edges[0]) s.edges[0].from = 'd_ffffffffffff';
      });
      expect(issuePaths(value)).toContain('edges.0.from');
      expect(issueMessages(value)).toMatch(/does not resolve/);
    });

    it('names edges[i].to when the designed-test node it points at is gone', () => {
      const value = broken((s) => {
        if (s.promises[0]) s.promises[0].designedTest = null;
        s.metrics.designedCount = 0;
        s.metrics.designedCoverage = 0;
      });
      expect(issuePaths(value)).toContain('edges.1.to');
    });

    it('resolves a designed-test endpoint derived from the promise it verifies', () => {
      expect(designedTestId(TEST_PATH)).toBe(TID);
      expect(LedgerSnapshotSchema.safeParse(fullSnapshot()).success).toBe(true);
    });
  });

  describe('rule 5: freshness type/family consistency', () => {
    it('rejects a terminal type the family contract does not fix', () => {
      const value = broken((s) => {
        s.freshness.terminalEventType = 'run_end';
      });
      expect(issuePaths(value)).toContain('freshness.terminalEventType');
      expect(issueMessages(value)).toMatch(/expected 'testrun_done'/);
    });

    it.each(COMMAND_FAMILIES)('accepts the contract terminal type for %s', (family) => {
      const value = broken((s) => {
        s.freshness.commandFamily = family;
        s.freshness.terminalEventType = contractFor(family).terminalType;
      });
      expect(LedgerSnapshotSchema.safeParse(value).success).toBe(true);
    });

    it('rejects a terminal type with no family', () => {
      const value = broken((s) => {
        s.freshness.commandFamily = null;
      });
      expect(issuePaths(value)).toContain('freshness.terminalEventType');
    });

    it('rejects a family with no terminal instant', () => {
      const value = broken((s) => {
        s.freshness.terminalEventAt = null;
      });
      expect(issuePaths(value)).toContain('freshness.terminalEventAt');
    });

    it('accepts all three absent — nothing has run yet', () => {
      expect(isLedgerSnapshot(emptySnapshot())).toBe(true);
    });
  });

  it('reports every disagreement in one parse, not just the first', () => {
    const value = broken((s) => {
      s.metrics.provenCount = 9;
      if (s.edges[0]) s.edges[0].from = 'd_ffffffffffff';
      s.freshness.terminalEventType = 'done';
    });
    const paths = issuePaths(value);
    expect(paths).toContain('metrics.provenCount');
    expect(paths).toContain('edges.0.from');
    expect(paths).toContain('freshness.terminalEventType');
  });
});
