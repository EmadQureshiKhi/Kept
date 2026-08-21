import { describe, expect, it } from 'vitest';

import {
  BRANCH_FENCES,
  FIXTURE_DOC_GLOBS,
  FIXTURE_SOURCE_GLOBS,
  HANDOFF_DIAGNOSTIC_CODES,
  HANDOFF_DIRECTORY_RELATIVE_PATH,
  HANDOFF_FILE_RELATIVE_PATH,
  HANDOFF_SCHEMA_VERSION,
  KEPT_LAUNCHER,
  KEPT_OWN_GLOBS,
  NEXT_ACTION_BRANCH_PRECEDENCE,
  REPAIR_BRANCHES,
  TEST_CORPUS_GLOBS,
  buildHandoff,
  contractFor,
  createPromiseRecord,
  exitMeaning,
  fenceFor,
  handoffArchiveFileName,
  handoffPaths,
  inMemoryStateFileSystem,
  isHandoffFile,
  parseHandoff,
  parseStream,
  readNewestHandoff,
  serialiseHandoff,
  writeHandoff,
  type CommandFamily,
  type EvidenceListing,
  type HandoffResultInput,
  type ParsedStream,
  type PromiseRecord,
  type RepairBranch,
  type RoutedRepair,
  type RunOutcome,
} from '@kept/core';

/**
 * The handoff file — the closed-loop contract (design §11.2, §11.3, §8.1, §14.1,
 * R7.1, R11.4, R11.7).
 *
 * Two things are being pinned here, and the second one is the reason the file
 * exists. First, that the file is *complete for every run* — including the ones
 * that produced no verdict, where a silent handoff would leave the agent reading
 * the previous run's instruction. Second, that the fence is *by branch*: on
 * `code-break` the agent may edit fixture source and nothing else, so the loop
 * cannot repair a red promise by editing the claim, by weakening the test, or by
 * touching KEPT itself.
 *
 * Property 26 (`handoff-completeness.prop.test.ts`) quantifies both over
 * generated outcomes. This suite pins the exact sets and the specific adversity
 * rows of §14.1 by name, because a generator can prove a fence is disjoint
 * without proving it is the *right* fence.
 *
 * No disk anywhere: the filesystem seam is `inMemoryStateFileSystem`, the same
 * one `state.ts` uses.
 */

const REPO_ROOT = '/repo';
const AT = '2026-08-20T18:40:44.902Z';

const CLAIM =
  '- The Cart screen shows a running subtotal that updates immediately when a quantity changes.';

function promiseOf(overrides: Partial<Parameters<typeof createPromiseRecord>[0]> = {}): PromiseRecord {
  return createPromiseRecord({
    claim: CLAIM,
    citation: { file: 'apps/fixture/README.md', line: 16, text: CLAIM },
    designedTest: { path: 'tests/cart_subtotal_test.md', testId: 'T-3' },
    verdict: 'red',
    providers: ['baseline'],
    ...overrides,
  });
}

function repairOf(branch: RepairBranch): RoutedRepair {
  return {
    branch,
    strategy: 'resultCode740',
    severity: 'high',
    category: 'functional',
    confidence: 0.9,
    evidenceRef: '.testmuai/evidence/ev_20260820T184011Z/failure.yaml',
    rationale: 'Verdict object confirmed a product bug.',
  };
}

/** A real parsed stream, never a hand-rolled `CompleteStream` literal. */
function streamOf(family: CommandFamily, lines: readonly string[]): ParsedStream<CommandFamily> {
  return parseStream(contractFor(family), lines);
}

const FAILING_TESTRUN_LINES: readonly string[] = [
  JSON.stringify({ type: 'testrun_plan', valid: true, members: [{ path: 'tests/cart_subtotal_test.md', test_id: 'T-3' }] }),
  JSON.stringify({ type: 'testrun_member_end', path: 'tests/cart_subtotal_test.md', status: 'failed' }),
  JSON.stringify({
    type: 'testrun_done',
    status: 'failed',
    // The code arrives as a string here on purpose: Kane types the field
    // inconsistently, and the handoff must read it through the coercing accessor.
    result_code: ' 740',
    reason_code: 'failure.product_bug',
    credits_consumed: 0,
  }),
];

function testrunOutcome(
  lines: readonly string[] = FAILING_TESTRUN_LINES,
  code: number | null = 1,
  killed = false,
): RunOutcome<CommandFamily> {
  return {
    runId: 'tr_20260820T184011Z',
    exitMeaning: exitMeaning('ExecutionTestrun', code, killed),
    stream: streamOf('ExecutionTestrun', lines),
  };
}

const LISTING: EvidenceListing = {
  dir: '/repo/.testmuai/evidence',
  pack: {
    id: 'ev_20260820T184011Z',
    dir: '/repo/.testmuai/evidence/ev_20260820T184011Z',
    sealedAt: '2026-08-20T18:40:40.000Z',
    artifacts: [
      {
        kind: 'annotated',
        name: 'annotated.png',
        path: '/repo/.testmuai/evidence/ev_20260820T184011Z/annotated.png',
        bytes: 10,
        modifiedAt: null,
      },
      {
        kind: 'failure-yaml',
        name: 'failure.yaml',
        path: '/repo/.testmuai/evidence/ev_20260820T184011Z/failure.yaml',
        bytes: 20,
        modifiedAt: null,
      },
      {
        kind: 'screenshot',
        name: 'steps/step-3.png',
        path: '/repo/.testmuai/evidence/ev_20260820T184011Z/steps/step-3.png',
        bytes: 30,
        modifiedAt: null,
      },
      {
        kind: 'har',
        name: 'network.har',
        path: '/repo/.testmuai/evidence/ev_20260820T184011Z/network.har',
        bytes: 40,
        modifiedAt: null,
      },
    ],
  },
  packIds: ['ev_20260820T184011Z'],
};

function resultInput(branch: RepairBranch): HandoffResultInput {
  return {
    promise: promiseOf(),
    memberStatus: 'failed',
    verdict: 'red',
    repair: repairOf(branch),
    verdictObject: {
      confirmed: true,
      family: 'functional',
      category: 'state_not_updated',
      severity: 'high',
      one_liner: 'subtotal did not change after quantity increment',
      confidence: 0.9,
    },
    evidence: LISTING,
  };
}

// ---------------------------------------------------------------------------
// The fence
// ---------------------------------------------------------------------------

describe('the handoff fence is by branch (design §8.1, §11.2, R7.1)', () => {
  it('lets a code-break repair touch fixture source and nothing else', () => {
    const fence = fenceFor('code-break');
    expect(fence.allowedPaths).toEqual([
      'apps/fixture/app/**',
      'apps/fixture/components/**',
      'apps/fixture/lib/**',
    ]);
    expect(fence.allowedPaths).toEqual(FIXTURE_SOURCE_GLOBS);
    expect(fence.forbiddenPaths).toEqual([
      'apps/fixture/README.md',
      'apps/fixture/docs/**',
      'tests/**',
      'apps/ledger/**',
      'packages/**',
    ]);
  });

  it('forbids the four things a code-break repair must never reach', () => {
    const forbidden = fenceFor('code-break').forbiddenPaths;
    // The fixture's own documentation: editing the claim to match broken code is
    // the one failure mode that would make the ledger worthless.
    for (const glob of FIXTURE_DOC_GLOBS) expect(forbidden).toContain(glob);
    // The Kane corpus at the repository root — not `apps/fixture/tests/`.
    expect(forbidden).toContain('tests/**');
    expect(TEST_CORPUS_GLOBS).toEqual(['tests/**']);
    // KEPT's own code is never the repair target.
    for (const glob of KEPT_OWN_GLOBS) expect(forbidden).toContain(glob);
  });

  it('holds test-drift and never writes docs-lie silently, per §8.1', () => {
    expect(fenceFor('test-drift').allowedPaths).toEqual([]);
    expect(fenceFor('test-drift').autonomy).toBe('hold');
    expect(fenceFor('test-drift').artefact).toBe('review-card');

    expect(fenceFor('docs-lie').allowedPaths).toEqual([]);
    expect(fenceFor('docs-lie').autonomy).toBe('propose');
    expect(fenceFor('docs-lie').artefact).toBe('amendment');

    // And the difference from `code-break`, which is applied automatically.
    expect(fenceFor('code-break').autonomy).toBe('apply');
    expect(fenceFor('code-break').artefact).toBe('patch');
  });

  it('answers a fence for a null branch rather than an absent one', () => {
    const fence = fenceFor(null);
    expect(fence).toBe(BRANCH_FENCES.none);
    expect(fence.allowedPaths).toEqual([]);
    expect(fence.autonomy).toBe('none');
    expect(fence.artefact).toBeNull();
    expect(fence.instruction).toContain('change nothing');
  });

  it('never lists a path as both allowed and forbidden, on any branch', () => {
    for (const branch of [...REPAIR_BRANCHES, null]) {
      const fence = fenceFor(branch);
      for (const allowed of fence.allowedPaths) {
        expect(fence.forbiddenPaths, `${String(branch)} allows and forbids ${allowed}`).not.toContain(
          allowed,
        );
      }
      expect(fence.instruction.length).toBeGreaterThan(0);
    }
  });

  it('covers every branch in the table and in the precedence list', () => {
    expect(Object.keys(BRANCH_FENCES).sort()).toEqual(
      [...REPAIR_BRANCHES, 'none'].sort(),
    );
    expect([...NEXT_ACTION_BRANCH_PRECEDENCE].sort()).toEqual([...REPAIR_BRANCHES].sort());
    // `code-break` first: it is the branch whose save re-fires the hook, and it is
    // also the narrowest fence, so preferring it grants nothing extra.
    expect(NEXT_ACTION_BRANCH_PRECEDENCE[0]).toBe('code-break');
  });
});

// ---------------------------------------------------------------------------
// Completeness on the adversity rows of §14.1
// ---------------------------------------------------------------------------

describe('the handoff is written for every run (design §14.1, R11.4)', () => {
  it('describes a run that never started, with a null branch and a reason', () => {
    const handoff = buildHandoff({ runId: 'no_spawn_1', at: AT });
    expect(isHandoffFile(handoff)).toBe(true);
    expect(handoff.schemaVersion).toBe(HANDOFF_SCHEMA_VERSION);
    expect(handoff.command.invoked).toBe(false);
    expect(handoff.command.family).toBeNull();
    expect(handoff.command.ndjsonEnabledBy).toBeNull();
    expect(handoff.outcome.exitMeaning).toBeNull();
    expect(handoff.outcome.terminalSeen).toBe(false);
    expect(handoff.outcome.verdictsPermitted).toBe(false);
    expect(handoff.blastRadius).toEqual({
      testIds: [],
      promiseIds: [],
      unmatchedPaths: [],
      skippedNoTestId: [],
    });
    expect(handoff.nextAction.branch).toBeNull();
    expect(handoff.diagnostics.map((entry) => entry.code)).toContain(
      HANDOFF_DIAGNOSTIC_CODES.noInvocation,
    );
  });

  it('records a crashed stream as outcome-unknown and authorises no repair', () => {
    // Everything but the terminal event: a plan, a failing member, plausible
    // chatter. It looks like a finished run and the outcome is unknown (R3.6).
    const handoff = buildHandoff({
      runId: 'tr_crashed',
      at: AT,
      run: testrunOutcome(FAILING_TESTRUN_LINES.slice(0, 2), 1),
      results: [resultInput('code-break')],
    });
    expect(handoff.outcome.terminalSeen).toBe(false);
    // The type is still recorded: "we waited for testrun_done and it never came"
    // is the diagnosis, and a null here would throw away half of it.
    expect(handoff.outcome.terminalEventType).toBe('testrun_done');
    expect(handoff.outcome.verdictsPermitted).toBe(false);
    expect(handoff.nextAction.branch).toBeNull();
    expect(handoff.nextAction.allowedPaths).toEqual([]);
    // The result is still reported — the facts survive; only the authorisation dies.
    expect(handoff.results).toHaveLength(1);
    expect(handoff.results[0]?.repair?.branch).toBe('code-break');
    expect(handoff.diagnostics.map((entry) => entry.code)).toContain(
      HANDOFF_DIAGNOSTIC_CODES.outcomeUnknown,
    );
  });

  it('records an Assurance pause as resumable, with no branch (R11.10)', () => {
    const paused = JSON.stringify({ type: 'done', status: 'paused', exit_code: 3 });
    const handoff = buildHandoff({
      runId: 'as_paused',
      at: AT,
      exitCode: 3,
      run: {
        runId: 'as_paused',
        exitMeaning: exitMeaning('Assurance', 3, false),
        stream: streamOf('Assurance', [paused]),
      },
      results: [resultInput('docs-lie')],
    });
    expect(handoff.outcome.exitMeaning).toBe('paused-resumable');
    expect(handoff.outcome.resumable).toBe(true);
    expect(handoff.outcome.terminalSeen).toBe(true);
    expect(handoff.outcome.status).toBe('paused');
    expect(handoff.outcome.verdictsPermitted).toBe(false);
    expect(handoff.nextAction.branch).toBeNull();
    expect(handoff.diagnostics.map((entry) => entry.code)).toContain(
      HANDOFF_DIAGNOSTIC_CODES.exitUnproven,
    );
  });

  it('records a preflight rejection, where nothing ran at all (R4.11)', () => {
    const rejected = [
      JSON.stringify({ type: 'testrun_plan', valid: false, members: [] }),
      JSON.stringify({ type: 'testrun_done', status: 'invalid' }),
    ];
    const handoff = buildHandoff({
      runId: 'tr_preflight',
      at: AT,
      exitCode: 2,
      run: testrunOutcome(rejected, 2),
    });
    expect(handoff.outcome.exitMeaning).toBe('preflight-rejected');
    expect(handoff.nextAction.branch).toBeNull();
    expect(handoff.diagnostics.length).toBeGreaterThan(0);
  });

  it('records our own timeout kill as timed out (R11.8)', () => {
    const handoff = buildHandoff({
      runId: 'tr_timeout',
      at: AT,
      run: testrunOutcome(FAILING_TESTRUN_LINES, null, true),
    });
    expect(handoff.outcome.exitMeaning).toBe('killed-by-timeout');
    expect(handoff.outcome.timedOut).toBe(true);
    expect(handoff.nextAction.branch).toBeNull();
  });

  it('carries a source-unresolved refusal verbatim and adds no branch (§13.2.4)', () => {
    // The reconcile ladder resolves nothing, spawns nothing, and hands its own
    // diagnostic to the handoff. The handoff keeps that reason first.
    const handoff = buildHandoff({
      runId: 'rc_unresolved',
      at: AT,
      trigger: { hook: 'kept-docs-reconcile', event: 'fileEdited', paths: ['apps/fixture/README.md'] },
      command: { family: 'Assurance', argv: [], invoked: false },
      diagnostics: [
        {
          code: 'reconcile-source-unresolved',
          severity: 'warn',
          message: 'no ingested source matches apps/fixture/README.md; run `context ingest` first',
          file: 'apps/fixture/README.md',
          line: null,
          at: AT,
        },
      ],
    });
    expect(handoff.nextAction.branch).toBeNull();
    expect(handoff.diagnostics[0]?.code).toBe('reconcile-source-unresolved');
    expect(handoff.diagnostics.map((entry) => entry.code)).toContain(
      HANDOFF_DIAGNOSTIC_CODES.noInvocation,
    );
    // The family is still recorded even though nothing was invoked, so `/runs`
    // can say what would have run.
    expect(handoff.command.family).toBe('Assurance');
    expect(handoff.command.ndjsonEnabledBy).toBe('mode-agent');
  });

  it('says so explicitly when a proven run has nothing to repair', () => {
    const passed = [JSON.stringify({ type: 'testrun_done', status: 'passed', result_code: 100 })];
    const handoff = buildHandoff({
      runId: 'tr_green',
      at: AT,
      exitCode: 0,
      run: testrunOutcome(passed, 0),
      results: [{ promise: promiseOf({ verdict: 'proven' }), verdict: 'proven', memberStatus: 'passed' }],
    });
    expect(handoff.outcome.verdictsPermitted).toBe(true);
    expect(handoff.nextAction.branch).toBeNull();
    expect(handoff.diagnostics.map((entry) => entry.code)).toEqual([
      HANDOFF_DIAGNOSTIC_CODES.noRepairNeeded,
    ]);
  });
});

// ---------------------------------------------------------------------------
// A proven failing run: the design §11.2 example, field by field
// ---------------------------------------------------------------------------

describe('a proven failing run produces the instruction of design §11.2', () => {
  const handoff = buildHandoff({
    runId: 'tr_20260820T184011Z',
    at: AT,
    exitCode: 1,
    trigger: { hook: 'kept-code-verify', event: 'fileEdited', paths: ['apps/fixture/lib/cart.ts'] },
    command: {
      family: 'ExecutionTestrun',
      argv: ['testrun', 'run', '--from-context', 'T-3', '--on-failure', 'continue'],
    },
    run: testrunOutcome(),
    radius: {
      testIds: ['T-3'],
      promiseIds: [promiseOf().id],
      coveringTests: ['tests/cart_subtotal_test.md'],
      skippedNoTestId: [],
      unmatchedPaths: [],
      diagnostics: [],
    },
    results: [resultInput('code-break')],
  });

  it('names the run, the trigger and the command', () => {
    expect(handoff.runId).toBe('tr_20260820T184011Z');
    expect(handoff.writtenAt).toBe(AT);
    expect(handoff.trigger).toEqual({
      hook: 'kept-code-verify',
      event: 'fileEdited',
      paths: ['apps/fixture/lib/cart.ts'],
    });
    expect(handoff.command.family).toBe('ExecutionTestrun');
    // The testrun family has no `--agent` flag at all; NDJSON is piped stdout,
    // and the enabler is read from the contract rather than restated.
    expect(handoff.command.ndjsonEnabledBy).toBe('piped-stdout');
    expect(handoff.command.argv).toContain('--from-context');
    expect(handoff.command.invoked).toBe(true);
  });

  it('reads the code through the coercing accessor, whitespace and all', () => {
    // The stream carried the code as the string with a leading space. A raw
    // comparison would have read one of Kane's two typings and missed this one.
    expect(handoff.outcome.resultCode).toBe(740);
    expect(handoff.outcome.reasonCode).toBe('failure.product_bug');
    expect(handoff.outcome.credits).toBe(0);
    expect(handoff.outcome.status).toBe('failed');
    expect(handoff.outcome.terminalSeen).toBe(true);
    expect(handoff.outcome.terminalEventType).toBe('testrun_done');
    expect(handoff.outcome.exitMeaning).toBe('failure');
    expect(handoff.outcome.timedOut).toBe(false);
    expect(handoff.outcome.resumable).toBe(false);
    expect(handoff.outcome.verdictsPermitted).toBe(true);
  });

  it('reads the status `testrun_done` actually carries, which is `overall_status`', () => {
    // The live terminal event is `{type, execution_id, overall_status}` and carries
    // no `status` key at all — observed, and recorded in
    // `docs/kane/command-surface.md`. Reading only `status` published
    // `not reported` for a status Kane had reported one key over.
    const live = buildHandoff({
      runId: 'a1039478-409c-4213-a5e8-fcf8480a56f8',
      run: testrunOutcome([
        JSON.stringify({ type: 'testrun_plan', valid: true, members: [] }),
        JSON.stringify({
          type: 'testrun_done',
          execution_id: 'a1039478-409c-4213-a5e8-fcf8480a56f8',
          overall_status: 'failed',
        }),
      ]),
      exitCode: 1,
      durationMs: 240_712,
      at: AT,
    });
    expect(live.outcome.status).toBe('failed');
    // And the invoker's measurement is carried rather than derived from two
    // timestamps, so `/runs` can publish a duration it did not compute.
    expect(live.outcome.durationMs).toBe(240_712);
    // Absent when nothing measured it: a zero would be a figure the run produced.
    expect(handoff.outcome.durationMs).toBeNull();
  });

  it('carries the citation verbatim, which is the specification the agent repairs against', () => {
    const result = handoff.results[0];
    expect(result?.citation).toEqual({ file: 'apps/fixture/README.md', line: 16, text: CLAIM });
    expect(result?.testId).toBe('T-3');
    expect(result?.designedTest).toBe('tests/cart_subtotal_test.md');
    expect(result?.memberStatus).toBe('failed');
    expect(result?.verdict).toBe('red');
    expect(result?.repair?.branch).toBe('code-break');
    expect(result?.repair?.evidenceRef).toBe(
      '.testmuai/evidence/ev_20260820T184011Z/failure.yaml',
    );
  });

  it('projects the verdict object into the six fields the snapshot carries', () => {
    expect(handoff.results[0]?.verdictObject).toEqual({
      confirmed: true,
      family: 'functional',
      category: 'state_not_updated',
      severity: 'high',
      one_liner: 'subtotal did not change after quantity increment',
      confidence: 0.9,
    });
  });

  it('resolves every evidence path from the listing, dropping nothing', () => {
    const result = handoff.results[0];
    expect(result?.evidenceDir).toBe('/repo/.testmuai/evidence');
    expect(result?.evidencePackId).toBe('ev_20260820T184011Z');
    expect(result?.artifacts.annotated).toBe(
      '/repo/.testmuai/evidence/ev_20260820T184011Z/annotated.png',
    );
    expect(result?.artifacts.failureYaml).toBe(
      '/repo/.testmuai/evidence/ev_20260820T184011Z/failure.yaml',
    );
    expect(result?.artifacts.screenshots).toEqual([
      '/repo/.testmuai/evidence/ev_20260820T184011Z/steps/step-3.png',
    ]);
    // The HAR is an artefact `listArtifacts` classified and nobody named in the
    // design example. It is still listed, because a pack file is never dropped.
    expect(result?.artifacts.other).toEqual([
      '/repo/.testmuai/evidence/ev_20260820T184011Z/network.har',
    ]);
  });

  it('fences the agent into fixture source and asks for an edit, not a command', () => {
    expect(handoff.nextAction.branch).toBe('code-break');
    expect(handoff.nextAction.autonomy).toBe('apply');
    expect(handoff.nextAction.artefact).toBe('patch');
    expect(handoff.nextAction.instruction).toBe(
      'Restore the behaviour the cited claim describes. Edit product source only.',
    );
    expect(handoff.nextAction.allowedPaths).toEqual(FIXTURE_SOURCE_GLOBS);
    expect(handoff.nextAction.command).toBeNull();
    expect(handoff.diagnostics).toEqual([]);
    expect(handoff.blastRadius.testIds).toEqual(['T-3']);
  });

  it('hands back the evolve command on test-drift and the amend command on docs-lie', () => {
    const drift = buildHandoff({
      runId: 'tr_drift',
      at: AT,
      run: testrunOutcome(),
      results: [resultInput('test-drift')],
    });
    expect(drift.nextAction.branch).toBe('test-drift');
    expect(drift.nextAction.command).toBe(
      `${KEPT_LAUNCHER} evolve tests/cart_subtotal_test.md`,
    );
    expect(drift.nextAction.allowedPaths).toEqual([]);

    const lie = buildHandoff({
      runId: 'tr_lie',
      at: AT,
      run: testrunOutcome(),
      results: [resultInput('docs-lie')],
    });
    expect(lie.nextAction.branch).toBe('docs-lie');
    expect(lie.nextAction.command).toBe(`${KEPT_LAUNCHER} amend propose --run tr_lie`);
    expect(lie.nextAction.allowedPaths).toEqual([]);
  });

  it('prefers code-break when one run failed promises on several branches', () => {
    const mixed = buildHandoff({
      runId: 'tr_mixed',
      at: AT,
      run: testrunOutcome(),
      results: [resultInput('docs-lie'), resultInput('test-drift'), resultInput('code-break')],
    });
    expect(mixed.nextAction.branch).toBe('code-break');
  });
});

// ---------------------------------------------------------------------------
// Writing, and the immutable copy
// ---------------------------------------------------------------------------

describe('writeHandoff lands both files (R11.7)', () => {
  it('writes the newest and the immutable per-run copy, byte-identical', () => {
    const fileSystem = inMemoryStateFileSystem();
    const written = writeHandoff({
      repoRoot: REPO_ROOT,
      runId: 'tr_20260820T184011Z',
      at: AT,
      run: testrunOutcome(),
      results: [resultInput('code-break')],
      fileSystem,
    });

    expect(written.paths).toEqual({
      newest: `${REPO_ROOT}/${HANDOFF_FILE_RELATIVE_PATH}`,
      archive: `${REPO_ROOT}/${HANDOFF_DIRECTORY_RELATIVE_PATH}/tr_20260820T184011Z.json`,
    });
    expect(written.archived).toBe(true);
    expect(fileSystem.files.get(written.paths.newest)).toBe(written.contents);
    expect(fileSystem.files.get(written.paths.archive)).toBe(written.contents);
    expect(written.contents.endsWith('\n')).toBe(true);
    expect(written.contents).toBe(serialiseHandoff(written.handoff));
  });

  it('round-trips through the guard, so the hook can read what was written', () => {
    const fileSystem = inMemoryStateFileSystem();
    const written = writeHandoff({
      repoRoot: REPO_ROOT,
      runId: 'tr_round',
      at: AT,
      run: testrunOutcome(),
      results: [resultInput('code-break')],
      fileSystem,
    });
    const parsed = parseHandoff(written.contents);
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(written.handoff);
    expect(readNewestHandoff(REPO_ROOT, fileSystem)).toEqual(written.handoff);
  });

  it('never rewrites an existing per-run copy, and says it did not', () => {
    const fileSystem = inMemoryStateFileSystem();
    const first = writeHandoff({
      repoRoot: REPO_ROOT,
      runId: 'tr_same_id',
      at: AT,
      run: testrunOutcome(),
      results: [resultInput('code-break')],
      fileSystem,
    });
    const second = writeHandoff({
      repoRoot: REPO_ROOT,
      runId: 'tr_same_id',
      at: '2026-08-20T19:00:00.000Z',
      run: testrunOutcome(),
      results: [resultInput('code-break')],
      fileSystem,
    });

    expect(second.archived).toBe(false);
    // The archive is exactly the first write. The newest file moved on.
    expect(fileSystem.files.get(first.paths.archive)).toBe(first.contents);
    expect(fileSystem.files.get(first.paths.newest)).toBe(second.contents);
    expect(second.handoff.diagnostics.map((entry) => entry.code)).toContain(
      HANDOFF_DIAGNOSTIC_CODES.archiveExists,
    );
  });

  it('cannot be talked out of `.kept/handoff/` by a hostile run id', () => {
    expect(handoffArchiveFileName('tr_20260820T184011Z')).toBe('tr_20260820T184011Z.json');
    expect(handoffArchiveFileName('a/b')).toBe('a_b.json');
    expect(handoffArchiveFileName('   ')).toBe('run_unknown.json');
    expect(handoffArchiveFileName('')).toBe('run_unknown.json');
    // A run id arrives from Kane, so it is untrusted input about to become a path
    // segment. Whatever it holds, the file lands inside `.kept/handoff/`.
    for (const hostile of ['../../etc/passwd', 'a/b', '..', './x', '~/.ssh/id_rsa', 'a b\tc']) {
      const name = handoffArchiveFileName(hostile);
      expect(name).not.toContain('/');
      expect(name.startsWith('.')).toBe(false);
      expect(name.endsWith('.json')).toBe(true);
      const paths = handoffPaths(REPO_ROOT, hostile);
      expect(paths.archive).toBe(`${REPO_ROOT}/${HANDOFF_DIRECTORY_RELATIVE_PATH}/${name}`);
      expect(paths.archive).not.toContain('/../');
    }
  });

  it('writes for a crashed run too — the whole point of the contract', () => {
    const fileSystem = inMemoryStateFileSystem();
    const written = writeHandoff({
      repoRoot: REPO_ROOT,
      runId: 'tr_crashed_write',
      at: AT,
      run: testrunOutcome(FAILING_TESTRUN_LINES.slice(0, 1), 1),
      fileSystem,
    });
    expect(fileSystem.files.size).toBe(2);
    expect(written.handoff.nextAction.branch).toBeNull();
    expect(written.handoff.diagnostics.length).toBeGreaterThan(0);
    expect(isHandoffFile(parseHandoff(written.contents))).toBe(true);
  });
});

describe('the guard refuses a handoff the loop could not act on', () => {
  const good = buildHandoff({
    runId: 'tr_guard',
    at: AT,
    run: testrunOutcome(),
    results: [resultInput('code-break')],
  });

  it('accepts what this module writes', () => {
    expect(isHandoffFile(good)).toBe(true);
  });

  it('refuses a null branch with no reason attached', () => {
    const silent = { ...buildHandoff({ runId: 'tr_silent', at: AT }), diagnostics: [] };
    expect(silent.nextAction.branch).toBeNull();
    expect(isHandoffFile(silent)).toBe(false);
  });

  it('refuses a wrong version, a missing block and a bad branch', () => {
    expect(isHandoffFile({ ...good, schemaVersion: 99 })).toBe(false);
    expect(isHandoffFile({ ...good, runId: '' })).toBe(false);
    expect(isHandoffFile({ ...good, outcome: { terminalSeen: true } })).toBe(false);
    expect(
      isHandoffFile({ ...good, nextAction: { ...good.nextAction, branch: 'code_break' } }),
    ).toBe(false);
    expect(isHandoffFile({ ...good, blastRadius: { testIds: ['T-3'] } })).toBe(false);
    expect(isHandoffFile(null)).toBe(false);
    expect(parseHandoff('{not json')).toBeNull();
    expect(parseHandoff('{"schemaVersion":1}')).toBeNull();
  });
});
