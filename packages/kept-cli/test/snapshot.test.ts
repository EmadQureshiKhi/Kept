import type {
  LedgerSnapshot,
  PromiseRecord,
  ReviewCard,
  SnapshotEvidence,
  StateFileSystem,
} from 'kept-core';
import {
  REVIEW_CARDS_DIRECTORY_RELATIVE_PATH,
  REVIEW_CARD_DIAGNOSTIC_CODES,
  SNAPSHOT_SCHEMA_VERSION,
  buildReviewCard,
  createDiagnosticSink,
  createKeptState,
  createPromiseGraph,
  createPromiseRecord,
  designedTestId,
  documentId,
  inMemoryStateFileSystem,
  parseSnapshot,
  reviewCardPath,
  serialiseReviewCard,
  serialiseSnapshot,
  toSnapshotReviewCard,
} from 'kept-core';
import { describe, expect, it } from 'vitest';

import { deriveDocuments, deriveEdges } from '../src/graph.js';
import {
  SNAPSHOT_DIAGNOSTIC_CODES,
  SNAPSHOT_FILE_RELATIVE_PATH,
  buildSnapshot,
  writeSnapshot,
} from '../src/snapshot.js';
import type { SnapshotRequest } from '../src/commands/snapshot.js';
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

    // The wording and severity of that refusal, asserted here because here is where it is
    // produced. `apps/ledger/test/evidence-lane.test.tsx` used to assert both, over the
    // four diagnostics the committed snapshot happened to carry; it carries none now, so
    // the assertions moved to the projection rather than being deleted with the sample.
    //
    // `warn` and not `error`: dropping the edge is the correct outcome and the file is
    // still valid, so a reviewer needs to be told rather than stopped.
    const dropped = built.diagnostics.filter(
      (entry) => entry.code === SNAPSHOT_DIAGNOSTIC_CODES.edgeUnresolved,
    );
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.severity).toBe('warn');
    expect(
      dropped[0]?.message,
      'the diagnostic no longer says which kind of edge was dropped',
    ).toContain("'evidence' edge");
    expect(
      dropped[0]?.message,
      'the diagnostic no longer names the pack the dropped edge was reaching for, which is ' +
        'the only place a dropped edge survives at all',
    ).toContain(PACK.id);
    expect(
      dropped[0]?.message,
      'the diagnostic no longer says the edge was dropped rather than drawn, so a reader ' +
        'cannot tell a refusal from a line that failed to render',
    ).toContain('dropped rather than published as an edge to nothing');
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

  it('projects the staged amendments too, and reads no directory when told not to', () => {
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
      // `reviewCards: []` was missing here, and the omission is worth naming: this
      // test used to say "reads *neither* directory", counting two projections when
      // there are three, and it passed only because `listReviewCards` swallows a
      // throwing reader. So the held-change projection was reading a directory
      // under a test whose whole point was that no directory is read, and the
      // assertion could not tell. Three fields passed, three directories untouched.
      reviewCards: [],
      readDirectory: () => {
        throw new Error('the projection read a directory it was handed the answer for');
      },
    });
    expect(passed.valid).toBe(true);
    expect(passed.snapshot.runs).toEqual([]);
    expect(passed.snapshot.reviewCards).toEqual([]);
  });
});

/**
 * Held changes, projected off `.kept/review-cards/` (§8.1, §8.2, R5.7, task 22.2).
 *
 * This block exists because of a defect that shipped with every unit test green.
 * `runSnapshot` took `reviewCards` as an optional request field and had no
 * projection from the store, and neither `reconcile` nor `evolve` passed it, so the
 * committed snapshot carried `reviewCards: []` on every path a human could reach and
 * `/reviews` was structurally incapable of showing a held change. Both halves were
 * individually correct and individually tested: `listReviewCards` reads the store and
 * says in its own doc comment that it "is the seam `kept snapshot` fills its
 * `reviewCards` field from", and `toSnapshotReviewCard` projects a card into the
 * snapshot's shape. Nothing called either one. It was found by running the
 * docs-triggered loop live: a documentation edit made Kane stage nine changes, KEPT
 * mirrored nine cards to disk, the reconcile output reported nine, and the snapshot
 * written in the same second carried none.
 *
 * So the assertions here are about the wiring rather than about either part. The
 * store is read when the field is omitted; the reader is *not even asked* when the
 * field is passed, which is the symmetry `runs` and `amendments` already had; a card
 * this version cannot read is skipped with a diagnostic instead of taking the build
 * down; and the diagnostic a reader sees names the number of held changes rather than
 * counting only runs and amendments. A held change nobody can see is not held, it is
 * lost, and the ledger's whole claim is that it shows what it owes.
 */
describe('held changes, projected off .kept/review-cards/ (R5.7)', () => {
  const CARDS_DIR = `${REPO}/${REVIEW_CARDS_DIRECTORY_RELATIVE_PATH}`;
  /** The promise a held change points at. A card naming no `p_` id is refused. */
  const HELD = promise();

  /** One card, built through the only constructor, so the fixture cannot drift. */
  function cardOf(
    overrides: {
      readonly kind?: 'reconcile' | 'test-drift';
      readonly title?: string;
      readonly file?: string;
    } = {},
  ): ReviewCard {
    const draft = buildReviewCard({
      kind: overrides.kind ?? 'reconcile',
      title: overrides.title ?? 'a new claim on line 9 has no designed test',
      detail: 'reconcile staged the change into Kane’s own plan; nothing was applied',
      proposedChanges: [
        {
          file: overrides.file ?? 'tests/cart_subtotal_test.md',
          summary: 'ADD uc-10: cover the new claim',
          diff: '+ - The Shop screen lists eight roasts.',
        },
      ],
      context: {
        promiseId: HELD.id,
        createdAt: AT,
        strategy: 'resultCode740',
        // Null deliberately: `buildSnapshot` clears a reference to a pack that is
        // not committed, and a cleared reference would make these assertions about
        // evidence curation rather than about the projection.
        evidenceRef: null,
      },
    });
    if (!draft.ok) throw new Error('the fixture card could not be built');
    return draft.card;
  }

  /**
   * Run the command over a seeded store, recording **every directory the projection
   * asked about**. Recording rather than throwing is the point: `listReviewCards`
   * catches a throwing reader by design, so a reader that explodes cannot tell the
   * difference between "not asked" and "asked and swallowed".
   */
  function project(
    files: Record<string, string>,
    overrides: Partial<SnapshotRequest> = {},
  ): {
    readonly result: ReturnType<typeof runSnapshot>;
    readonly sink: ReturnType<typeof createDiagnosticSink>;
    readonly listed: readonly string[];
    readonly fileSystem: ReturnType<typeof inMemoryStateFileSystem>;
  } {
    const fileSystem = inMemoryStateFileSystem(files);
    const sink = createDiagnosticSink();
    const listed: string[] = [];
    const result = runSnapshot({
      repoRoot: REPO,
      fileSystem,
      state: stateOf([HELD]),
      generatedAt: AT,
      // The two projections this block is not about, answered so the only directory
      // anything could ask for is the review-card store.
      evidence: [],
      runs: [],
      amendments: [],
      readDirectory: (path: string): readonly string[] => {
        listed.push(path);
        const prefix = path.endsWith('/') ? path : `${path}/`;
        return Object.keys(files)
          .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
          .map((key) => key.slice(prefix.length));
      },
      diagnostics: sink,
      ...overrides,
    });
    return { result, sink, listed, fileSystem };
  }

  it('carries a card that is on disk into the committed file, so /reviews can render it', () => {
    const card = cardOf();
    const { result, listed, fileSystem } = project({
      [reviewCardPath(REPO, card.id)]: serialiseReviewCard(card),
    });

    expect(result.valid).toBe(true);
    // The projection is the identity function, so this is field for field.
    expect(result.snapshot.reviewCards).toEqual([toSnapshotReviewCard(card)]);
    // And it got there by reading the store, not by being handed the answer.
    expect(listed).toContain(CARDS_DIR);

    // The committed bytes are what the Ledger builds from, so the assertion that
    // matters is made against them rather than against the in-memory result.
    const text = fileSystem.readFile(result.path);
    expect(text).not.toBeNull();
    const committed = parseSnapshot(text as string);
    expect(committed.reviewCards.map((held) => held.id)).toEqual([card.id]);
    expect(committed.reviewCards[0]?.status).toBe('open');
    expect(committed.reviewCards[0]?.promiseId).toBe(HELD.id);
    expect(committed.reviewCards[0]?.proposedChanges[0]?.summary).toContain('ADD uc-10');
  });

  it('sorts the store by id, so two held changes are byte-stable in the committed file', () => {
    const first = cardOf({ title: 'one', file: 'tests/a_test.md' });
    const second = cardOf({ title: 'two', file: 'tests/b_test.md' });
    expect(first.id).not.toBe(second.id);
    const { result } = project({
      [reviewCardPath(REPO, first.id)]: serialiseReviewCard(first),
      [reviewCardPath(REPO, second.id)]: serialiseReviewCard(second),
    });
    const ids = result.snapshot.reviewCards.map((held) => held.id);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual([...ids].sort());
  });

  it('answers from the request when reviewCards is passed, and asks no directory at all', () => {
    const onDisk = cardOf({ title: 'the card the store holds' });
    const seed = { [reviewCardPath(REPO, onDisk.id)]: serialiseReviewCard(onDisk) };

    // Omitted: the store is read. This is the assertion whose absence let the
    // defect ship, and it fails on the old code, which answered `[]` here.
    const omitted = project(seed);
    expect(omitted.result.snapshot.reviewCards.map((held) => held.id)).toEqual([onDisk.id]);

    // Passed as `[]`: the same store, and nothing is projected out of it. The
    // symmetry `runs` and `amendments` already had, and the one every unit test of
    // this command relies on.
    const empty = project(seed, { reviewCards: [] });
    expect(empty.result.snapshot.reviewCards).toEqual([]);
    expect(empty.listed).toEqual([]);
    // Nothing was projected, so nothing is claimed to have been.
    expect(empty.sink.has(SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.recordsProjected)).toBe(false);

    // Passed non-empty: the request wins outright rather than merging with the
    // store, which is what lets `kept build` project a state it already has.
    const passed = cardOf({ title: 'the card the caller handed over', file: 'tests/z_test.md' });
    const handed = project(seed, { reviewCards: [toSnapshotReviewCard(passed)] });
    expect(handed.result.snapshot.reviewCards.map((held) => held.id)).toEqual([passed.id]);
    expect(handed.listed).toEqual([]);
  });

  it('skips a card this version cannot read and still writes the snapshot', () => {
    // Three kinds of unusable file, and one good card that must survive all three.
    // A malformed store is regenerable state; taking the whole build down over it
    // would trade a renderable ledger for a broken one.
    const good = cardOf();
    const shaped = { ...cardOf({ title: 'no status' }) } as Record<string, unknown>;
    delete shaped['status'];
    const { result, sink, listed } = project({
      [reviewCardPath(REPO, good.id)]: serialiseReviewCard(good),
      [`${CARDS_DIR}/rc_notjson.json`]: '{ not json',
      [`${CARDS_DIR}/rc_wrongshape.json`]: `${JSON.stringify(shaped)}\n`,
      // Not a card id and not a `.json` file: skipped without a word, because a
      // stray note in the directory is not a held change that went missing.
      [`${CARDS_DIR}/README.txt`]: 'the cards live here',
    });

    expect(listed).toContain(CARDS_DIR);
    expect(result.valid).toBe(true);
    expect(result.written).toBe(true);
    expect(result.snapshot.reviewCards.map((held) => held.id)).toEqual([good.id]);
    // Skipped *with a diagnostic naming the file*, which is the promise
    // `listReviewCards` makes and this is the new call site keeping it.
    const malformed = sink.entries.filter(
      (entry) => entry.code === REVIEW_CARD_DIAGNOSTIC_CODES.malformed,
    );
    expect(malformed).toHaveLength(2);
    expect(malformed.map((entry) => entry.file).sort()).toEqual([
      `${REVIEW_CARDS_DIRECTORY_RELATIVE_PATH}/rc_notjson.json`,
      `${REVIEW_CARDS_DIRECTORY_RELATIVE_PATH}/rc_wrongshape.json`,
    ]);
    for (const entry of malformed) expect(entry.severity).toBe('warn');
  });

  it('treats a card it cannot read at all as absent, says so, and keeps the rest', () => {
    // The other half of the promise: not "the bytes are wrong" but "the read threw".
    // A permission error on one file in a gitignored directory is not a reason to
    // publish no ledger.
    const good = cardOf();
    const seed = {
      [reviewCardPath(REPO, good.id)]: serialiseReviewCard(good),
      [reviewCardPath(REPO, 'rc_locked')]: serialiseReviewCard(cardOf({ title: 'locked' })),
    };
    const base = inMemoryStateFileSystem(seed);
    const fileSystem: StateFileSystem = {
      readFile(path: string): string | null {
        if (path.endsWith('rc_locked.json')) throw new Error('EACCES: permission denied');
        return base.readFile(path);
      },
      ensureDir(path: string): void {
        base.ensureDir(path);
      },
      writeFile(path: string, contents: string): void {
        base.writeFile(path, contents);
      },
    };
    const sink = createDiagnosticSink();
    const result = runSnapshot({
      repoRoot: REPO,
      fileSystem,
      state: stateOf([HELD]),
      generatedAt: AT,
      evidence: [],
      runs: [],
      amendments: [],
      readDirectory: (path: string): readonly string[] => {
        const prefix = path.endsWith('/') ? path : `${path}/`;
        return Object.keys(seed)
          .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
          .map((key) => key.slice(prefix.length));
      },
      diagnostics: sink,
    });

    expect(result.valid).toBe(true);
    expect(result.snapshot.reviewCards.map((held) => held.id)).toEqual([good.id]);
    expect(sink.has(REVIEW_CARD_DIAGNOSTIC_CODES.unreadable)).toBe(true);
  });

  it('counts the held changes in the diagnostic, not only the runs and amendments', () => {
    // The message a reader sees is the only place the three projections are
    // reconciled against each other, and it named two of them while the third was
    // silently absent. Singular first, because the plural was the easy case to get
    // right and the singular is the one a first held change hits.
    const one = cardOf();
    const single = project({ [reviewCardPath(REPO, one.id)]: serialiseReviewCard(one) });
    const reported = single.sink.entries.find(
      (entry) => entry.code === SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.recordsProjected,
    );
    expect(reported).toBeDefined();
    expect(reported?.message).toContain('1 held change from');
    expect(reported?.message).toContain(`${REVIEW_CARDS_DIRECTORY_RELATIVE_PATH}/`);
    expect(reported?.message).not.toContain('1 held changes');

    const second = cardOf({ title: 'two', file: 'tests/b_test.md' });
    const pair = project({
      [reviewCardPath(REPO, one.id)]: serialiseReviewCard(one),
      [reviewCardPath(REPO, second.id)]: serialiseReviewCard(second),
    });
    expect(
      pair.sink.entries.find(
        (entry) => entry.code === SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.recordsProjected,
      )?.message,
    ).toContain('2 held changes from');
  });

  it('is an empty array for a store that has never held a change, which is not the same claim', () => {
    // Worth pinning next to everything above: `[]` is still the honest answer for an
    // empty directory, and it was also the answer the defect gave for a full one. The
    // difference is observable only in whether the store was read, so that is what is
    // asserted rather than the array alone.
    const { result, listed } = project({});
    expect(result.valid).toBe(true);
    expect(result.snapshot.reviewCards).toEqual([]);
    expect(listed).toContain(CARDS_DIR);
  });
});
