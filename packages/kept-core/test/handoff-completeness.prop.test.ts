import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  AUTOMATIC_REPAIR_REQUIRES_VERDICT,
  BRANCH_FENCES,
  FIXTURE_DOC_GLOBS,
  FIXTURE_SOURCE_GLOBS,
  KEPT_LAUNCHER,
  KEPT_OWN_GLOBS,
  MEMBER_END_STATUSES,
  REPAIR_BRANCHES,
  REPAIR_STRATEGIES,
  TEST_CORPUS_GLOBS,
  UNPROVEN_CODE_BREAK_FENCE,
  WRITE_PERMITTING_EXIT_MEANINGS,
  buildHandoff,
  contractFor,
  exitMeaning,
  fenceFor,
  fenceForResults,
  grantsAutomaticRepair,
  handoffPaths,
  inMemoryStateFileSystem,
  isHandoffFile,
  matchesAnyGlob,
  mayWriteVerdicts,
  normaliseVerdictObject,
  parseHandoff,
  parseStream,
  writeHandoff,
  type CommandFamily,
  type EvidenceArtifact,
  type EvidenceListing,
  type HandoffResultInput,
  type MemberEndStatus,
  type RepairBranch,
  type RoutedRepair,
  type RunOutcome,
} from '@kept/core';

import {
  arbExitCode,
  arbFamily,
  arbInstant,
  arbKilled,
  arbPromise,
  arbStream,
  arbTruncatedStream,
  arbVerdict,
  arbVerdictObject,
  type StreamLines,
} from './arbitraries.js';

/**
 * Feature: kept, Property 26: The handoff file is complete for every run and
 * fences the agent by branch (design §Correctness Properties, §11.2, §8.1,
 * §14.1, R7.1, R11.4).
 *
 * *For any* completed hook-triggered invocation, the handoff validates against
 * its schema and records the outcome, the exit meaning, the terminal-event type
 * and whether a terminal event was seen; for every failing result it additionally
 * records the verdict, the repair branch, the verdict-object fields where
 * present, the citation and the resolved evidence path; and whenever the branch
 * is `code-break`, the allowed paths contain only fixture source globs while the
 * forbidden paths include the fixture documentation and the test corpus.
 *
 * ## What this property is actually about
 *
 * Totality and fencing, not shape. Two failure modes are being made unreachable,
 * and both are the kind a shape assertion misses.
 *
 * **A run that writes nothing.** If a crash path, a pause, a preflight rejection
 * or an unresolved source ever returns early without a handoff, the agent opens
 * `.kept/handoff.json` and reads the *previous* run's instruction: it repairs a
 * promise that is no longer red, inside a fence derived from a superseded run.
 * That is the worst thing this product can do. So the first clause quantifies over
 * every outcome the generators can reach — all three families, complete and
 * truncated streams, every exit code including `null`, our own timeout kill — and
 * asserts a *complete, parseable, schema-valid* file lands every single time, with
 * both files written. The truncation clause goes further and walks **every cut** of
 * one concrete stream, so a refactor that handled the empty stream and the
 * one-line-short stream differently cannot slip between them.
 *
 * **A fence that has drifted.** `code-break` means the product is wrong. If the
 * fence ever admitted the fixture's documentation, the loop could make the README
 * agree with broken code — which is precisely the dishonesty the ledger exists to
 * prevent. If it admitted `tests/**`, the loop could weaken the assertion instead
 * of fixing the bug. So the fence is not checked as a string list: it is checked
 * *semantically*, by running the same glob matcher the blast radius uses over
 * generated paths from all four trees, and asserting that a path is admitted only
 * if it is fixture source and is forbidden if it is documentation, corpus, Ledger
 * or package code.
 *
 * ## Why the branch cannot come from a caller's optimism
 *
 * `nextAction.branch` is gated on the single write guard: a run `mayWriteVerdicts`
 * refuses gets `branch: null` however many repairs are passed alongside it. That is
 * asserted here rather than only in the unit suite, because authorising an
 * automatic source patch off a run whose outcome is unknown is the specific
 * mistake that would look green in every other test.
 *
 * No process and no disk: streams are parsed from generated lines and the
 * filesystem seam is `inMemoryStateFileSystem`, the one `state.ts` established.
 *
 * **Validates: Requirements 7.1, 11.4**
 */

/** Design §Testing Strategy floor is 100 runs; stated so it cannot regress. */
const NUM_RUNS = 300;

const REPO_ROOT = '/repo';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * The four member statuses and null.
 *
 * Deliberately **not** `arbMemberStatus` from `arbitraries.ts`: that generator's
 * whole purpose is to reach values *outside* the four, which is right for the
 * status-mapping property and inexpressible here — `HandoffResult.memberStatus`
 * is typed at the closed vocabulary because by the time a member reaches a
 * handoff it has already been mapped (§6.5).
 */
const arbNarrowMemberStatus: fc.Arbitrary<MemberEndStatus | null> = fc.constantFrom<
  MemberEndStatus | null
>(...MEMBER_END_STATUSES, null);

/** A router answer. `RoutedRepair` is an alias of `RepairAnnotation` (§6.1). */
const arbRepair: fc.Arbitrary<RoutedRepair> = fc.record({
  branch: fc.constantFrom(...REPAIR_BRANCHES),
  strategy: fc.constantFrom(...REPAIR_STRATEGIES),
  severity: fc.option(fc.constantFrom('low', 'medium', 'high'), { nil: null }),
  category: fc.option(fc.constantFrom('functional', 'visual', 'state'), { nil: null }),
  confidence: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
  evidenceRef: fc.option(
    fc.constantFrom(
      '.testmuai/evidence/ev_20260820T184011Z/failure.yaml',
      '.testmuai/evidence/ev_20260821T090000Z',
    ),
    { nil: null },
  ),
  rationale: fc.constantFrom(
    'Verdict object confirmed a product bug.',
    'No rule matched; the residue is the documentation.',
  ),
});

/** A sealed pack, as `listArtifacts` would answer it — every path absolute. */
const arbEvidenceListing: fc.Arbitrary<EvidenceListing> = fc
  .record({
    packId: fc.constantFrom('ev_20260820T184011Z', 'ev_20260821T090000Z'),
    names: fc.uniqueArray(
      fc.constantFrom(
        'annotated.png',
        'failure.yaml',
        'steps/step-3.png',
        'steps/step-4.png',
        'network.har',
        'console.log',
        'mystery.bin',
      ),
      { maxLength: 5 },
    ),
  })
  .map(({ packId, names }): EvidenceListing => {
    const dir = `${REPO_ROOT}/.testmuai/evidence`;
    const packDir = `${dir}/${packId}`;
    const artifacts: EvidenceArtifact[] = names.map((name) => ({
      kind: kindOf(name),
      name,
      path: `${packDir}/${name}`,
      bytes: name.length,
      modifiedAt: null,
    }));
    return {
      dir,
      pack: { id: packId, dir: packDir, sealedAt: null, artifacts },
      packIds: [packId],
    };
  });

/** The classification `kane/evidence.ts` would have made. Kept in step by name. */
function kindOf(name: string): EvidenceArtifact['kind'] {
  if (name === 'annotated.png') return 'annotated';
  if (name === 'failure.yaml') return 'failure-yaml';
  if (name.endsWith('.png')) return 'screenshot';
  if (name.endsWith('.har')) return 'har';
  if (name.endsWith('.log')) return 'log';
  return 'other';
}

/** One result a caller hands the writer. */
const arbResultInput: fc.Arbitrary<HandoffResultInput> = fc.record({
  promise: arbPromise,
  memberStatus: arbNarrowMemberStatus,
  verdict: arbVerdict,
  // Drawn independently of `verdict`, and named rather than left to default off the
  // promise record, because §8.1.1 turns on it: a generator that only ever produced
  // one history would leave the withheld `code-break` fence — or the granted one —
  // unreached, and the fence clause below would be quantifying over nothing.
  previousVerdict: arbVerdict,
  repair: fc.option(arbRepair, { nil: null }),
  verdictObject: fc.option(arbVerdictObject, { nil: null }),
  evidence: fc.option(arbEvidenceListing, { nil: null }),
});

/** A finished run: an exit interpreted against its family, paired with a stream. */
interface RunCase {
  readonly family: CommandFamily;
  readonly stream: StreamLines;
  readonly exitCode: number | null;
  readonly killed: boolean;
}

/**
 * Every outcome the generators can reach: three families, complete and truncated
 * streams (including the empty one and the one-line-short one), every exit code
 * including `null`, and our own timeout kill.
 */
const arbRunCase: fc.Arbitrary<RunCase> = arbFamily.chain((family) =>
  fc.record({
    family: fc.constant(family),
    stream: fc.oneof(
      { weight: 5, arbitrary: arbStream(family) },
      { weight: 5, arbitrary: arbTruncatedStream(family) },
    ),
    exitCode: arbExitCode,
    killed: arbKilled,
  }),
);

/**
 * One family with one concrete truncated stream, so the cut-walking clause below
 * draws its stream from the property's own seed rather than from a sample taken
 * mid-test — a sample would make a failure unreproducible from the counterexample.
 */
const arbCutCase: fc.Arbitrary<{
  readonly family: CommandFamily;
  readonly drawn: StreamLines;
}> = arbFamily.chain((family) =>
  fc.record({ family: fc.constant(family), drawn: arbTruncatedStream(family) }),
);

function outcomeOf(runId: string, drawn: RunCase): RunOutcome<CommandFamily> {
  return {
    runId,
    exitMeaning: exitMeaning(drawn.family, drawn.exitCode, drawn.killed),
    stream: parseStream(contractFor(drawn.family), drawn.stream.lines),
  };
}

// ---------------------------------------------------------------------------
// Representative paths, for the semantic fence check
// ---------------------------------------------------------------------------

const arbFixtureSourcePath: fc.Arbitrary<string> = fc.constantFrom(
  'apps/fixture/app/page.tsx',
  'apps/fixture/app/cart/page.tsx',
  'apps/fixture/app/components/price.tsx',
  'apps/fixture/app/product/[slug]/add-to-cart.tsx',
  'apps/fixture/components/site-header.tsx',
  'apps/fixture/lib/cart.ts',
  'apps/fixture/lib/currency.ts',
);

const arbFixtureDocPath: fc.Arbitrary<string> = fc.constantFrom(
  'apps/fixture/README.md',
  'apps/fixture/docs/cart.md',
  'apps/fixture/docs/guides/checkout.md',
);

/** The Kane corpus at the repository root — never `apps/fixture/tests/`. */
const arbTestCorpusPath: fc.Arbitrary<string> = fc.constantFrom(
  'tests/cart_subtotal_test.md',
  'tests/cart_discount_test.md',
  'tests/nested/orders_persist_test.md',
);

const arbKeptOwnPath: fc.Arbitrary<string> = fc.constantFrom(
  'apps/ledger/components/VerdictTag.tsx',
  'apps/ledger/lib/tokens.ts',
  'apps/ledger/styles/tokens.css',
  'packages/kept-core/src/handoff/handoff.ts',
  'packages/kept-cli/src/index.ts',
);

type Tree = 'fixture-source' | 'fixture-docs' | 'test-corpus' | 'kept-own';

const arbTreePath: fc.Arbitrary<{ readonly tree: Tree; readonly path: string }> = fc.oneof(
  arbFixtureSourcePath.map((path) => ({ tree: 'fixture-source' as const, path })),
  arbFixtureDocPath.map((path) => ({ tree: 'fixture-docs' as const, path })),
  arbTestCorpusPath.map((path) => ({ tree: 'test-corpus' as const, path })),
  arbKeptOwnPath.map((path) => ({ tree: 'kept-own' as const, path })),
);

// ---------------------------------------------------------------------------
// Clause 1 — a complete file, for every run
// ---------------------------------------------------------------------------

describe('Feature: kept, Property 26: The handoff file is complete for every run and fences the agent by branch', () => {
  it('writes a complete, schema-valid handoff for every outcome a run can have', () => {
    fc.assert(
      fc.property(
        arbRunCase,
        fc.array(arbResultInput, { maxLength: 3 }),
        arbInstant,
        fc.array(arbFixtureSourcePath, { maxLength: 3 }),
        (drawn, results, at, changed) => {
          const runId = `run_${drawn.family}_${drawn.stream.shape}`;
          const outcome = outcomeOf(runId, drawn);
          const fileSystem = inMemoryStateFileSystem();

          const written = writeHandoff({
            repoRoot: REPO_ROOT,
            runId,
            at,
            run: outcome,
            exitCode: drawn.exitCode,
            trigger: { hook: 'kept-code-verify', event: 'fileEdited', paths: changed },
            command: { argv: ['testrun', 'run', '--from-context', 'T-3'] },
            results,
            fileSystem,
          });

          // Both files, every time. Not "usually", not "on the happy path".
          const paths = handoffPaths(REPO_ROOT, runId);
          expect(fileSystem.files.size).toBe(2);
          expect(fileSystem.files.get(paths.newest)).toBe(written.contents);
          expect(fileSystem.files.get(paths.archive)).toBe(written.contents);
          expect(written.archived).toBe(true);

          // It parses, and it validates.
          const parsed = parseHandoff(written.contents);
          expect(parsed).not.toBeNull();
          expect(isHandoffFile(parsed)).toBe(true);
          expect(parsed).toEqual(written.handoff);

          const handoff = written.handoff;

          // It names the run.
          expect(handoff.runId).toBe(runId);
          expect(handoff.writtenAt).toBe(at);
          expect(handoff.trigger.paths).toEqual(changed);

          // It records the outcome, the exit meaning, the terminal-event type and
          // whether a terminal event was seen — the four things the hook prompt of
          // §11.1 branches on.
          expect(handoff.outcome.exitMeaning).toBe(outcome.exitMeaning);
          expect(handoff.outcome.exitCode).toBe(drawn.exitCode);
          expect(handoff.outcome.terminalSeen).toBe(outcome.stream.kind === 'complete');
          expect(handoff.outcome.terminalEventType).toBe(contractFor(drawn.family).terminalType);
          expect(handoff.command.family).toBe(drawn.family);
          expect(handoff.command.ndjsonEnabledBy).toBe(contractFor(drawn.family).ndjson);
          expect(handoff.outcome.timedOut).toBe(
            outcome.exitMeaning === 'killed-by-timeout' ||
              outcome.exitMeaning === 'timeout-or-cancelled',
          );
          expect(handoff.outcome.resumable).toBe(outcome.exitMeaning === 'paused-resumable');

          // It records what the single write guard said, and never re-decides it.
          const proven = mayWriteVerdicts(outcome);
          expect(handoff.outcome.verdictsPermitted).toBe(proven);
          expect(proven).toBe(
            outcome.stream.kind === 'complete' &&
              WRITE_PERMITTING_EXIT_MEANINGS.has(outcome.exitMeaning),
          );

          // It states a next action, always — and a null branch always carries a
          // reason, so the agent never has to infer silence.
          // `fenceForResults`, not `fenceFor`: §8.1.1 withholds `code-break`'s write
          // path when KEPT never proved the promise, and the file is built from the
          // conditional row. `fenceFor` remains §8.1's table, unconditionally.
          const fence = fenceForResults(handoff.nextAction.branch, handoff.results);
          expect(handoff.nextAction.allowedPaths).toEqual(fence.allowedPaths);
          expect(handoff.nextAction.forbiddenPaths).toEqual(fence.forbiddenPaths);
          expect(handoff.nextAction.autonomy).toBe(fence.autonomy);
          expect(handoff.nextAction.artefact).toBe(fence.artefact);
          expect(handoff.nextAction.instruction.length).toBeGreaterThan(0);
          if (handoff.nextAction.branch === null) {
            expect(handoff.diagnostics.length).toBeGreaterThan(0);
          }

          // A run the guard refused can never authorise a repair, whatever
          // repairs the caller passed alongside it.
          if (!proven) expect(handoff.nextAction.branch).toBeNull();
          else {
            const offered = new Set(
              results.flatMap((input) =>
                input.repair === null || input.repair === undefined ? [] : [input.repair.branch],
              ),
            );
            if (offered.size === 0) expect(handoff.nextAction.branch).toBeNull();
            else expect(offered.has(handoff.nextAction.branch as RepairBranch)).toBe(true);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('records every result: verdict, branch, verdict-object fields, citation, evidence path', () => {
    fc.assert(
      fc.property(
        arbRunCase,
        fc.array(arbResultInput, { minLength: 1, maxLength: 4 }),
        arbInstant,
        (drawn, results, at) => {
          const handoff = buildHandoff({
            runId: 'run_results',
            at,
            run: outcomeOf('run_results', drawn),
            results,
          });

          expect(handoff.results).toHaveLength(results.length);
          for (const [index, input] of results.entries()) {
            const written = handoff.results[index];
            expect(written).toBeDefined();
            if (written === undefined) continue;

            expect(written.promiseId).toBe(input.promise.id);
            expect(written.verdict).toBe(input.verdict ?? input.promise.verdict);
            // The citation is structural: a result is built from a graph record,
            // and a record cannot exist without a citation the admission gate
            // resolved to a real line in a real file (§3.3).
            expect(written.citation).toEqual(input.promise.citation);
            expect(written.citation.file.length).toBeGreaterThan(0);
            expect(written.citation.line).toBeGreaterThanOrEqual(1);
            expect(written.designedTest).toBe(input.promise.designedTest?.path ?? null);
            expect(written.memberStatus).toBe(
              input.memberStatus ?? input.promise.verdictSource?.memberStatus ?? null,
            );

            // The repair branch, unchanged — `RoutedRepair` is `RepairAnnotation`,
            // so there is no translation step to drift.
            const repair = input.repair ?? input.promise.repair ?? null;
            expect(written.repair).toEqual(repair);
            if (written.repair !== null) {
              expect(REPAIR_BRANCHES).toContain(written.repair.branch);
            }

            // The verdict-object fields where present, compared against the
            // router's own normaliser so nothing here can invent one.
            const normalised = normaliseVerdictObject(input.verdictObject ?? null);
            if (normalised === null) {
              expect(written.verdictObject).toBeNull();
            } else {
              expect(written.verdictObject).toEqual({
                confirmed: normalised.confirmed,
                family: normalised.family,
                category: normalised.category,
                severity: normalised.severity,
                one_liner: normalised.one_liner,
                confidence: normalised.confidence,
              });
            }

            // The resolved evidence path — from the listing the family produced,
            // never composed here, and never fabricated when there is none.
            expect(written.evidenceDir).toBe(input.evidence?.dir ?? null);
            expect(written.evidencePackId).toBe(
              input.evidence?.pack?.id ?? input.promise.evidencePackId ?? null,
            );
            const listed = (input.evidence?.pack?.artifacts ?? []).map(
              (artifact) => artifact.path,
            );
            const emitted = [
              ...(written.artifacts.annotated === null ? [] : [written.artifacts.annotated]),
              ...(written.artifacts.failureYaml === null ? [] : [written.artifacts.failureYaml]),
              ...written.artifacts.screenshots,
              ...written.artifacts.other,
            ];
            // Nothing invented, and nothing dropped: `listArtifacts` never omits a
            // file it did not recognise, so neither may the handoff (§4.6).
            expect([...emitted].sort()).toEqual([...listed].sort());
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('writes a handoff at every cut of a truncated stream', () => {
    fc.assert(
      fc.property(arbCutCase, arbExitCode, arbInstant, ({ family, drawn }, exitCode, at) => {
        // One concrete stream, every cut of it. A refactor that handled the empty
        // stream and the one-line-short stream by different code paths cannot slip
        // between them here.
        for (let cut = 0; cut < drawn.full.length; cut += 1) {
          const runId = `run_cut_${cut}`;
          const fileSystem = inMemoryStateFileSystem();
          const outcome: RunOutcome<CommandFamily> = {
            runId,
            exitMeaning: exitMeaning(family, exitCode, false),
            stream: parseStream(contractFor(family), drawn.full.slice(0, cut)),
          };
          const written = writeHandoff({
            repoRoot: REPO_ROOT,
            runId,
            at,
            run: outcome,
            exitCode,
            fileSystem,
          });

          expect(outcome.stream.kind, `cut ${cut} of ${drawn.full.length}`).toBe('crashed');
          expect(fileSystem.files.size).toBe(2);
          expect(isHandoffFile(parseHandoff(written.contents))).toBe(true);
          expect(written.handoff.outcome.terminalSeen).toBe(false);
          // The type is still recorded: what was waited for is half the diagnosis.
          expect(written.handoff.outcome.terminalEventType).toBe(
            contractFor(family).terminalType,
          );
          expect(written.handoff.nextAction.branch).toBeNull();
          expect(written.handoff.diagnostics.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 60 },
    );
  });
});

// ---------------------------------------------------------------------------
// Clause 2 — the fence
// ---------------------------------------------------------------------------

describe('Feature: kept, Property 26 (fencing clause): a code-break repair reaches fixture source and nothing else', () => {
  it('admits a path only if it is fixture source, and forbids the other three trees', () => {
    fc.assert(
      fc.property(arbTreePath, fc.constantFrom(...REPAIR_BRANCHES, null), ({ tree, path }, branch) => {
        const fence = fenceFor(branch);
        const allowed = matchesAnyGlob(fence.allowedPaths, path);
        const forbidden = matchesAnyGlob(fence.forbiddenPaths, path);

        // Nothing is ever both. The glob matcher is the radius's own, so the
        // fence is checked the way an agent would actually test a path.
        expect(allowed && forbidden, `${String(branch)} both allows and forbids ${path}`).toBe(
          false,
        );

        if (branch === 'code-break') {
          // Admitted only if it is product source.
          expect(allowed, `${path} (${tree})`).toBe(tree === 'fixture-source');
          // Documentation, corpus, Ledger and packages are all fenced out. The
          // first is the load-bearing one: a red promise must never be repaired
          // by editing the claim that made it a promise.
          expect(forbidden, `${path} (${tree})`).toBe(tree !== 'fixture-source');
        } else {
          // Every held branch writes nothing at all (§8.1), so no path is
          // admitted and every one of the four trees is fenced.
          expect(allowed).toBe(false);
          expect(forbidden).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reaches both sides of the §8.1.1 grant, so the fence clause quantifies over both', () => {
    // A property that only ever drew one history would assert the conditional row
    // against itself and pass while testing half the rule. This walks the generator
    // and requires each side to be reached, the same way the other generator
    // meta-tests in this plan do.
    const outcomes: { granted: number; withheld: number } = { granted: 0, withheld: 0 };
    fc.assert(
      fc.property(fc.constantFrom(...REPAIR_BRANCHES), arbResultInput, (branch, input) => {
        const lines = [JSON.stringify({ type: 'testrun_done', status: 'failed' })];
        const handoff = buildHandoff({
          runId: 'run_reach',
          at: '2026-08-20T18:40:11.000Z',
          run: {
            runId: 'run_reach',
            exitMeaning: exitMeaning('ExecutionTestrun', 1, false),
            stream: parseStream(contractFor('ExecutionTestrun'), lines),
          },
          results: [{ ...input, repair: { ...arbRepairSeed(branch) } }],
        });
        if (branch !== 'code-break') return;
        if (handoff.nextAction.allowedPaths.length > 0) outcomes.granted += 1;
        else outcomes.withheld += 1;
      }),
      { numRuns: NUM_RUNS },
    );
    expect(outcomes.granted).toBeGreaterThan(0);
    expect(outcomes.withheld).toBeGreaterThan(0);
  });

  it('names the required globs on code-break, and never a path in both sets', () => {
    const fence = fenceFor('code-break');
    expect(fence.allowedPaths).toEqual(FIXTURE_SOURCE_GLOBS);
    for (const glob of [...FIXTURE_DOC_GLOBS, ...TEST_CORPUS_GLOBS, ...KEPT_OWN_GLOBS]) {
      expect(fence.forbiddenPaths).toContain(glob);
    }
    for (const branch of [...REPAIR_BRANCHES, null]) {
      const each = fenceFor(branch);
      for (const glob of each.allowedPaths) expect(each.forbiddenPaths).not.toContain(glob);
      // Non-empty allowed set **only** on `code-break`: it is the one branch §8.1
      // applies automatically, and the other two are held for a human.
      expect(each.allowedPaths.length > 0).toBe(branch === 'code-break');
    }
    expect(Object.keys(BRANCH_FENCES).sort()).toEqual([...REPAIR_BRANCHES, 'none'].sort());
  });

  it('hands the same fence to the file as the table declares, for every branch', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...REPAIR_BRANCHES),
        arbResultInput,
        arbInstant,
        (branch, input, at) => {
          // A proven testrun: the only kind of run that can carry a branch.
          const lines = [JSON.stringify({ type: 'testrun_done', status: 'failed' })];
          const handoff = buildHandoff({
            runId: 'run_fenced',
            at,
            run: {
              runId: 'run_fenced',
              exitMeaning: exitMeaning('ExecutionTestrun', 1, false),
              stream: parseStream(contractFor('ExecutionTestrun'), lines),
            },
            results: [{ ...input, repair: { ...arbRepairSeed(branch) } }],
          });

          expect(handoff.nextAction.branch).toBe(branch);

          // §8.1.1: the table is what a *granted* branch gets, and `code-break` is
          // granted only when KEPT had proven the promise it would repair. The
          // generated input carries whichever history it drew, so the expected row
          // is read off the same predicate the builder uses rather than assumed —
          // which is what makes this clause a statement about the rule instead of
          // about the generator.
          const expected = grantsAutomaticRepair(branch, handoff.results)
            ? BRANCH_FENCES[branch]
            : branch === 'code-break'
              ? UNPROVEN_CODE_BREAK_FENCE
              : BRANCH_FENCES[branch];
          expect(handoff.nextAction.allowedPaths).toEqual(expected.allowedPaths);
          expect(handoff.nextAction.forbiddenPaths).toEqual(expected.forbiddenPaths);
          expect(handoff.nextAction.autonomy).toBe(expected.autonomy);
          expect(handoff.nextAction.artefact).toBe(expected.artefact);

          // And the direction the safety argument depends on: a write path exists
          // only for a `code-break` restoring something KEPT observed working.
          if (handoff.nextAction.allowedPaths.length > 0) {
            expect(branch).toBe('code-break');
            expect(
              handoff.results.some(
                (result) =>
                  result.repair?.branch === 'code-break' &&
                  result.previousVerdict === AUTOMATIC_REPAIR_REQUIRES_VERDICT,
              ),
            ).toBe(true);
          }

          // `code-break` is an edit, so there is no command. The other two are a
          // command the agent runs and then stops — the exact invocation §11.1's
          // prompt quotes, so the prompt cannot mis-spell it.
          const command = handoff.nextAction.command;
          if (branch === 'code-break') {
            expect(command).toBeNull();
          } else if (branch === 'docs-lie') {
            expect(command).toBe(`${KEPT_LAUNCHER} amend propose --run run_fenced`);
          } else {
            const designed = handoff.results[0]?.designedTest ?? null;
            expect(command).toBe(
              designed === null ? null : `${KEPT_LAUNCHER} evolve ${designed}`,
            );
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

/** A fixed repair on a chosen branch, so the branch under test is the only variable. */
function arbRepairSeed(branch: RepairBranch): RoutedRepair {
  return {
    branch,
    strategy: 'resultCode740',
    severity: 'high',
    category: 'functional',
    confidence: 0.9,
    evidenceRef: null,
    rationale: 'fixed for the fencing clause',
  };
}
