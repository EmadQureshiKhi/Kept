import type { LedgerSnapshot, PromiseRecord, SnapshotEvidence } from '@kept/core';
import {
  SNAPSHOT_SCHEMA_VERSION,
  createDiagnosticSink,
  createKeptState,
  createPromiseGraph,
  createPromiseRecord,
  designedTestId,
  documentId,
  inMemoryStateFileSystem,
  parseSnapshot,
  serialiseSnapshot,
} from '@kept/core';
import { describe, expect, it } from 'vitest';

import { deriveDocuments, deriveEdges } from '../src/graph.js';
import {
  SNAPSHOT_DIAGNOSTIC_CODES,
  SNAPSHOT_FILE_RELATIVE_PATH,
  buildSnapshot,
  writeSnapshot,
} from '../src/snapshot.js';
import {
  SNAPSHOT_COMMAND_DIAGNOSTIC_CODES,
  runSnapshot,
} from '../src/commands/snapshot.js';

/**
 * `kept snapshot` — the committed CLI↔UI file (design §9.1, §9.2, R1.8, R8.8).
 *
 * The assertions that matter are all about *not lying*: the counts agree with the
 * promise list, the proven figure is withheld while degraded, a reference to a
 * pack that is not committed is cleared rather than published as a dead link, and
 * a snapshot that cannot be made valid is not written at all.
 */
const REPO = '/repo';
const DOC = 'apps/fixture/README.md';
const AT = '2026-08-20T12:00:00.000Z';

function promise(overrides: Partial<Parameters<typeof createPromiseRecord>[0]> = {}): PromiseRecord {
  return createPromiseRecord({
    claim: 'The Cart screen shows a running subtotal.',
    citation: { file: DOC, line: 3, text: '- a claim' },
    designedTest: { path: 'tests/cart_subtotal_test.md', testId: 'T-3' },
    verdict: 'proven',
    providers: ['baseline'],
    ...overrides,
  });
}

function stateOf(promises: readonly PromiseRecord[], degraded = false) {
  const graph = createPromiseGraph({
    promises,
    edges: deriveEdges(promises),
    degraded,
    degradedReasons: degraded ? ['assurance-status:refused'] : [],
  });
  return createKeptState({ updatedAt: AT, graph });
}

describe('the derived lane-0 documents', () => {
  it('is one node per cited file, counting the promises that cite it', () => {
    const promises = [
      promise({ claim: 'one', citation: { file: DOC, line: 3, text: 'a' } }),
      promise({ claim: 'two', citation: { file: DOC, line: 4, text: 'b' } }),
      promise({ claim: 'three', citation: { file: 'docs/other.md', line: 1, text: 'c' } }),
    ];
    const documents = deriveDocuments(promises);
    expect(documents).toHaveLength(2);
    const readme = documents.find((document) => document.file === DOC);
    expect(readme?.id).toBe(documentId(DOC));
    expect(readme?.claimCount).toBe(2);
  });

  it('is sorted by id, so the committed file is byte-stable', () => {
    const documents = deriveDocuments([
      promise({ claim: 'a', citation: { file: 'z.md', line: 1, text: 'a' } }),
      promise({ claim: 'b', citation: { file: 'a.md', line: 1, text: 'b' } }),
    ]);
    expect([...documents].map((d) => d.id)).toEqual(
      [...documents].map((d) => d.id).sort(),
    );
  });

  it('is empty for an empty graph', () => {
    expect(deriveDocuments([])).toEqual([]);
  });
});

describe('the derived edges', () => {
  it('emits cites, designed and evidence edges', () => {
    const record = promise({ evidencePackId: 'ev_20260820T184011Z' });
    const edges = deriveEdges([record]);
    expect(edges).toEqual([
      { from: documentId(DOC), to: record.id, kind: 'cites' },
      { from: record.id, to: designedTestId('tests/cart_subtotal_test.md'), kind: 'designed' },
      { from: record.id, to: 'ev_20260820T184011Z', kind: 'evidence' },
    ]);
  });

  it('emits no designed edge for an undesigned promise', () => {
    const record = promise({ designedTest: null, verdict: 'undesigned' });
    expect(deriveEdges([record]).map((edge) => edge.kind)).toEqual(['cites']);
  });
});

describe('buildSnapshot projects the state faithfully', () => {
  it('produces a schema-valid snapshot whose counts agree with the promises', () => {
    const built = buildSnapshot({ state: stateOf([promise()]), generatedAt: AT });
    expect(built.valid).toBe(true);
    expect(built.error).toBeNull();
    expect(built.snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(built.snapshot.generatedAt).toBe(AT);
    expect(built.snapshot.metrics.totalPromises).toBe(1);
    expect(built.snapshot.metrics.designedCount).toBe(1);
    expect(built.snapshot.metrics.provenCount).toBe(1);
    expect(built.snapshot.metrics.designedCoverage).toBe(1);
    expect(built.snapshot.metrics.provenCoverage).toBe(1);
    expect(built.snapshot.documents).toHaveLength(1);
    expect(built.snapshot.edges).toHaveLength(2);
  });

  it('withholds the proven figure while degraded (R2.11)', () => {
    const built = buildSnapshot({ state: stateOf([promise()], true), generatedAt: AT });
    expect(built.valid).toBe(true);
    expect(built.snapshot.degraded).toBe(true);
    expect(built.snapshot.degradedReasons).toEqual(['assurance-status:refused']);
    expect(built.snapshot.metrics.provenCoverage).toBeNull();
    expect(built.snapshot.metrics.designedCoverage).toBe(1);
  });

  it('reports both coverage figures as null for an empty graph, with no division', () => {
    const built = buildSnapshot({ state: stateOf([]), generatedAt: AT });
    expect(built.valid).toBe(true);
    expect(built.snapshot.metrics).toEqual({
      totalPromises: 0,
      designedCount: 0,
      provenCount: 0,
      redCount: 0,
      staleCount: 0,
      undesignedCount: 0,
      designedCoverage: null,
      provenCoverage: null,
    });
  });

  it('round-trips through the canonical serialiser (§9.2, R1.8)', () => {
    const built = buildSnapshot({ state: stateOf([promise()]), generatedAt: AT });
    const parsed: LedgerSnapshot = parseSnapshot(built.text);
    expect(parsed).toEqual(built.snapshot);
    expect(serialiseSnapshot(parsed)).toBe(built.text);
  });

  it('carries the graph diagnostics into the file, oldest first', () => {
    const sink = createDiagnosticSink();
    const recorded = sink.report({ code: 'merge-degraded', severity: 'warn', message: 'because' });
    const graph = createPromiseGraph({ promises: [promise()], diagnostics: [recorded] });
    const built = buildSnapshot({
      state: createKeptState({ updatedAt: AT, graph }),
      generatedAt: AT,
    });
    expect(built.snapshot.diagnostics[0]).toEqual(recorded);
  });
});

describe('references buildSnapshot cannot honour', () => {
  const PACK: SnapshotEvidence = {
    id: 'ev_20260820T184011Z',
    kind: 'testrun',
    sealedAt: AT,
    publicPath: '/evidence/ev_20260820T184011Z/',
    artifacts: [],
  };

  it('keeps an evidencePackId that names a committed pack', () => {
    const built = buildSnapshot({
      state: stateOf([promise({ evidencePackId: PACK.id })]),
      evidence: [PACK],
      generatedAt: AT,
    });
    expect(built.valid).toBe(true);
    expect(built.snapshot.promises[0]?.evidencePackId).toBe(PACK.id);
    // The evidence edge resolves, so it survives.
    expect(built.snapshot.edges.filter((edge) => edge.kind === 'evidence')).toHaveLength(1);
  });

  it('clears one that does not, and says which pack', () => {
    const built = buildSnapshot({
      state: stateOf([promise({ evidencePackId: PACK.id })]),
      generatedAt: AT,
    });
    expect(built.valid).toBe(true);
    expect(built.snapshot.promises[0]?.evidencePackId).toBeNull();
    const reported = built.diagnostics.filter(
      (entry) => entry.code === SNAPSHOT_DIAGNOSTIC_CODES.evidenceUnresolved,
    );
    expect(reported).toHaveLength(1);
    expect(reported[0]?.message).toContain(PACK.id);
    // And the edge to the missing pack is dropped rather than published.
    expect(built.snapshot.edges.filter((edge) => edge.kind === 'evidence')).toEqual([]);
    expect(
      built.diagnostics.some(
        (entry) => entry.code === SNAPSHOT_DIAGNOSTIC_CODES.edgeUnresolved,
      ),
    ).toBe(true);
  });

  it('clears an unresolvable repair evidenceRef', () => {
    const built = buildSnapshot({
      state: stateOf([
        promise({
          verdict: 'red',
          repair: {
            branch: 'code-break',
            strategy: 'resultCode740',
            severity: 'high',
            category: 'assertion',
            confidence: 0.9,
            evidenceRef: 'evidence/ev_missing/failure.yaml',
            rationale: 'the subtotal disagreed',
          },
        }),
      ]),
      generatedAt: AT,
    });
    expect(built.valid).toBe(true);
    expect(built.snapshot.promises[0]?.repair?.evidenceRef).toBeNull();
    expect(
      built.diagnostics.some(
        (entry) => entry.code === SNAPSHOT_DIAGNOSTIC_CODES.repairEvidenceUnresolved,
      ),
    ).toBe(true);
  });
});

describe('writeSnapshot', () => {
  it('writes the canonical bytes under apps/ledger/data/', () => {
    const fileSystem = inMemoryStateFileSystem();
    const result = writeSnapshot({ repoRoot: REPO, text: '{}\n', fileSystem });
    expect(result.path).toBe(`${REPO}/${SNAPSHOT_FILE_RELATIVE_PATH}`);
    expect(result.changed).toBe(true);
    expect(fileSystem.readFile(result.path)).toBe('{}\n');
  });

  it('skips an identical write, so the file mtime does not move', () => {
    const path = `${REPO}/${SNAPSHOT_FILE_RELATIVE_PATH}`;
    const fileSystem = inMemoryStateFileSystem({ [path]: '{}\n' });
    const result = writeSnapshot({ repoRoot: REPO, text: '{}\n', fileSystem });
    expect(result.changed).toBe(false);
  });
});

describe('the kept snapshot command', () => {
  it('loads the state, writes the file, and reports what it wrote', () => {
    const fileSystem = inMemoryStateFileSystem();
    const sink = createDiagnosticSink();
    const result = runSnapshot({
      repoRoot: REPO,
      fileSystem,
      state: stateOf([promise()]),
      generatedAt: AT,
      diagnostics: sink,
    });

    expect(result.valid).toBe(true);
    expect(result.written).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
    expect(sink.has(SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.written)).toBe(true);
    const onDisk = fileSystem.readFile(result.path);
    expect(onDisk).not.toBeNull();
    expect(parseSnapshot(onDisk as string).promises).toHaveLength(1);
  });

  it('reports unchanged on a second identical run', () => {
    const fileSystem = inMemoryStateFileSystem();
    const state = stateOf([promise()]);
    runSnapshot({ repoRoot: REPO, fileSystem, state, generatedAt: AT });
    const sink = createDiagnosticSink();
    const second = runSnapshot({
      repoRoot: REPO,
      fileSystem,
      state,
      generatedAt: AT,
      diagnostics: sink,
    });
    expect(second.written).toBe(false);
    expect(sink.has(SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.unchanged)).toBe(true);
  });

  it('writes a valid empty snapshot when there is no state file at all', () => {
    const fileSystem = inMemoryStateFileSystem();
    const result = runSnapshot({ repoRoot: REPO, fileSystem, generatedAt: AT });
    expect(result.valid).toBe(true);
    expect(result.snapshot.promises).toEqual([]);
    expect(result.snapshot.metrics.designedCoverage).toBeNull();
  });

  it('does not write when the assembled snapshot fails its own schema check', () => {
    // A promise whose `providers` list is empty cannot satisfy the schema's
    // `min(1)` rule. It is reachable only past the model's factory, which is what
    // makes it the right stand-in for "the CLI produced something invalid".
    const broken = { ...promise(), providers: [] } as unknown as PromiseRecord;
    const fileSystem = inMemoryStateFileSystem();
    const sink = createDiagnosticSink();
    const result = runSnapshot({
      repoRoot: REPO,
      fileSystem,
      state: createKeptState({
        updatedAt: AT,
        graph: createPromiseGraph({ promises: [broken] }),
      }),
      generatedAt: AT,
      diagnostics: sink,
    });

    expect(result.valid).toBe(false);
    expect(result.written).toBe(false);
    expect(result.error).not.toBeNull();
    expect(fileSystem.readFile(result.path)).toBeNull();
    expect(sink.has(SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.notWritten)).toBe(true);
    expect(sink.has(SNAPSHOT_DIAGNOSTIC_CODES.invalid)).toBe(true);
  });
});

/**
 * The terminal-event log and the amendment surface, projected off `.kept/` (15.6).
 *
 * Both fields existed and nothing ever filled them, so `/runs` and `/amendments`
 * published their empty states on a repository that had recorded a red verdict and
 * a routed docs-lie. These assertions are about the projection being a projection:
 * it reads records `kept verify` and `kept amend propose` already wrote, it leaves
 * out a handoff that is not a run, and it reports rather than invents a figure the
 * handoff never carried.
 */
describe('runs and amendments, projected off the persisted records', () => {
  const RUN_ID = '108dbb62-4f20-46ec-abbd-3b8be6c6e13c';

  function handoffOf(
    overrides: Record<string, unknown> = {},
    outcomeOverrides: Record<string, unknown> = {},
  ): string {
    const { outcome: _ignored, ...rest } = overrides;
    return `${JSON.stringify({
      schemaVersion: 1,
      runId: RUN_ID,
      writtenAt: AT,
      trigger: { hook: 'kept-code-verify', event: 'fileEdited', paths: ['apps/fixture/lib/cart.ts'] },
      command: {
        family: 'ExecutionTestrun',
        argv: ['testrun', 'run', 'tests/cart_subtotal_test.md', '--on-failure', 'continue'],
        ndjsonEnabledBy: 'piped-stdout',
        invoked: true,
      },
      outcome: {
        terminalSeen: true,
        terminalEventType: 'testrun_done',
        exitCode: 1,
        exitMeaning: 'failure',
        timedOut: false,
        resumable: false,
        verdictsPermitted: true,
        status: 'failed',
        resultCode: 740,
        reasonCode: 'assertion_error.confirmed_product_bug',
        credits: 10.84068,
        durationMs: 113_402,
        ...outcomeOverrides,
      },
      blastRadius: { testIds: ['T-3'], promiseIds: [], unmatchedPaths: [], skippedNoTestId: [] },
      results: [
        {
          promiseId: 'p_45ccecba7aa5',
          testId: 'T-3',
          designedTest: 'tests/cart_subtotal_test.md',
          memberStatus: 'failed',
          verdict: 'red',
          citation: { file: DOC, line: 20, text: '- a claim' },
          repair: null,
          verdictObject: null,
          evidenceDir: null,
          evidencePackId: null,
          artifacts: { annotated: null, failureYaml: null, screenshots: [], other: [] },
        },
      ],
      nextAction: {
        branch: 'code-break',
        autonomy: 'auto',
        artefact: 'patch',
        instruction: 'fix the product code',
        allowedPaths: ['apps/fixture/lib/**'],
        forbiddenPaths: ['tests/**'],
        command: null,
      },
      diagnostics: [
        { code: 'verify-started', severity: 'info', message: 'started', file: null, line: null, at: AT },
        { code: 'verify-member-unattributed', severity: 'warn', message: 'no promise', file: null, line: null, at: AT },
      ],
      ...rest,
    })}\n`;
  }

  function projected(files: Record<string, string>) {
    const fileSystem = inMemoryStateFileSystem(files);
    const sink = createDiagnosticSink();
    const result = runSnapshot({
      repoRoot: REPO,
      fileSystem,
      state: stateOf([promise()]),
      generatedAt: AT,
      evidence: [],
      readDirectory: (path: string): readonly string[] => {
        const prefix = path.endsWith('/') ? path : `${path}/`;
        return Object.keys(files)
          .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
          .map((key) => key.slice(prefix.length));
      },
      diagnostics: sink,
    });
    return { result, sink };
  }

  it('publishes one run entry per invoked handoff, newest first', () => {
    const older = handoffOf({ runId: 'run_older', writtenAt: '2026-08-20T09:00:00.000Z' });
    const { result } = projected({
      [`${REPO}/.kept/handoff/${RUN_ID}.json`]: handoffOf(),
      [`${REPO}/.kept/handoff/run_older.json`]: older,
    });

    expect(result.valid).toBe(true);
    expect(result.snapshot.runs.map((run) => run.id)).toEqual([RUN_ID, 'run_older']);
    const run = result.snapshot.runs[0];
    expect(run?.family).toBe('ExecutionTestrun');
    expect(run?.command).toBe('testrun run tests/cart_subtotal_test.md --on-failure continue');
    expect(run?.terminalEventType).toBe('testrun_done');
    expect(run?.resultCode).toBe(740);
    expect(run?.credits).toBe(10.84068);
    expect(run?.durationMs).toBe(113_402);
    // Verbatim from the wire, so `failed` never reads as `broken` (R4.9).
    expect(run?.members).toEqual([
      {
        path: 'tests/cart_subtotal_test.md',
        testId: 'T-3',
        status: 'failed',
        verdict: 'red',
      },
    ]);
    // `/runs` heads this section "reasons and diagnostics", and an info progress
    // note is neither.
    expect(run?.diagnostics.map((entry) => entry.code)).toEqual(['verify-member-unattributed']);
  });

  it('reports a duration the handoff never measured rather than calling it zero', () => {
    const { result } = projected({
      [`${REPO}/.kept/handoff/${RUN_ID}.json`]: handoffOf({}, { durationMs: undefined }),
    });
    expect(result.snapshot.runs[0]?.durationMs).toBeNull();
    // And it never derives a start instant from an end instant minus a duration.
    expect(result.snapshot.runs[0]?.startedAt).toBeNull();
    expect(result.snapshot.runs[0]?.endedAt).toBe(AT);
  });

  it('leaves out a handoff that is not a run, and says nothing about it', () => {
    // An empty blast radius writes a handoff and starts no process (R4.5). It is
    // not a terminal event, so the terminal-event log does not carry it.
    const { result } = projected({
      [`${REPO}/.kept/handoff/${RUN_ID}.json`]: handoffOf({
        command: {
          family: null,
          argv: [],
          ndjsonEnabledBy: null,
          invoked: false,
        },
        nextAction: {
          branch: null,
          autonomy: 'hold',
          artefact: 'none',
          instruction: 'nothing to repair',
          allowedPaths: [],
          forbiddenPaths: [],
          command: null,
        },
      }),
    });
    expect(result.snapshot.runs).toEqual([]);
  });

  it('skips a file it cannot read as a handoff and keeps the rest of the log', () => {
    const { result, sink } = projected({
      [`${REPO}/.kept/handoff/${RUN_ID}.json`]: handoffOf(),
      [`${REPO}/.kept/handoff/broken.json`]: '{ not json',
    });
    expect(result.snapshot.runs.map((run) => run.id)).toEqual([RUN_ID]);
    expect(sink.has(SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.runUnreadable)).toBe(true);
  });

  it('clears a run reference to a pack that is not committed', () => {
    // The id Kane sealed on this machine is `… 2.evidence`, an iCloud duplicate with
    // a literal space in it: not committed, and not even spellable as a snapshot
    // evidence id. Publishing it would be a dead link.
    const { result, sink } = projected({
      [`${REPO}/.kept/handoff/${RUN_ID}.json`]: handoffOf({
        results: [
          {
            promiseId: 'p_45ccecba7aa5',
            testId: 'T-3',
            designedTest: 'tests/cart_subtotal_test.md',
            memberStatus: 'failed',
            verdict: 'red',
            citation: { file: DOC, line: 20, text: '- a claim' },
            repair: null,
            verdictObject: null,
            evidenceDir: null,
            evidencePackId: 'a1039478-409c-4213-a5e8-fcf8480a56f8 2.evidence',
            artifacts: { annotated: null, failureYaml: null, screenshots: [], other: [] },
          },
        ],
      }),
    });
    expect(result.valid).toBe(true);
    expect(result.snapshot.runs[0]?.evidencePackId).toBeNull();
    expect(sink.has(SNAPSHOT_DIAGNOSTIC_CODES.evidenceUnresolved)).toBe(true);
  });

  it('projects the staged amendments too, and reads neither directory when told not to', () => {
    const { result } = projected({
      [`${REPO}/.kept/handoff/${RUN_ID}.json`]: handoffOf(),
    });
    expect(result.snapshot.amendments).toEqual([]);

    const fileSystem = inMemoryStateFileSystem();
    const passed = runSnapshot({
      repoRoot: REPO,
      fileSystem,
      state: stateOf([promise()]),
      generatedAt: AT,
      evidence: [],
      runs: [],
      amendments: [],
      readDirectory: () => {
        throw new Error('the projection read a directory it was handed the answer for');
      },
    });
    expect(passed.valid).toBe(true);
    expect(passed.snapshot.runs).toEqual([]);
  });
});
