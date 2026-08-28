import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ENRICHMENT_DEGRADED_REASONS,
  ENRICHMENT_FAMILY,
  KaneInvoker,
  NO_PROVIDER_AXES,
  VERDICTS,
  applyRun,
  collectEnrichment,
  computeMetrics,
  contractFor,
  createDiagnosticSink,
  createKeptState,
  inMemoryCitationSource,
  mayWriteVerdicts,
  mergeGraph,
  parseStream,
  promiseId,
  type ChildProcessLike,
  type PromiseCandidate,
  type ProviderResult,
  type RunOutcome,
  type StateFreshness,
  type Verdict,
} from 'kept-core';

/**
 * Feature: kept, Property 6: Degradation preserves state and never fails the build
 * (design §Correctness Properties, §5.3, §5.4, §5.5, R2.7–R2.10, R2.12).
 *
 * *For any* prior promise graph and *for any* enrichment failure cause — Kane
 * absent, non-zero exit for the invoked family, a `done` status of error, refused,
 * interrupted or aborted, a paused status with exit code 3, a stream lacking
 * `done`, unparseable output, or exceeding the 60 second budget — the resulting
 * graph equals the baseline-only graph, the degraded flag is true with a reason
 * recorded, every pre-existing verdict and the freshness timestamp are unchanged,
 * and the CLI process exit code is 0.
 *
 * ### How the property is encoded
 *
 * The cause list is a **closed union**, one arm per clause the requirement names,
 * and each arm carries the stdout lines, the process exit code and the reason
 * §5.3 fixes for it. Nothing is inferred from the implementation: the expected
 * `degradedReason` is written in the generator, so a mapping that drifts fails
 * here rather than agreeing with itself.
 *
 * "Equals the baseline-only graph" is checked against a graph built by the *same*
 * merge with no enrichment result at all, over the same candidates and the same
 * citation source. That is the strongest available form of the claim: not "looks
 * plausible", but deep-equal promises and edges, so a degradation that quietly
 * dropped a promise or moved a citation is a failure.
 *
 * The prior verdicts are generated **non-default** — `proven` and `red` among
 * them — because a degradation that reset everything to `stale` would pass a test
 * whose fixtures were all `stale` anyway. Every one of them has to survive.
 *
 * Two statements about state, kept apart on purpose:
 *
 * - The merge is pure with respect to `.kept/state.json`: the prior
 *   {@link createKeptState} value is deep-frozen and still carries its freshness
 *   triple afterwards, by identity.
 * - A degraded enrichment run produces **no verdict to write** — `axes` is empty
 *   in every arm — so `applyRun` moves nothing whether the write guard admits the
 *   outcome or refuses it. Where it refuses (a crashed stream, a pause, a missing
 *   binary, our own timeout kill) the prior state comes back *by reference*, which
 *   is freshness preserved by construction (§4.8). Where it does not refuse — a
 *   *complete* stream with a failing exit, which is exactly the verified refusal
 *   envelope — the guard is satisfied and there is still nothing to apply, so no
 *   verdict moves. That asymmetry is the honest one: the guard is about whether an
 *   outcome is *proven*, and this property is about whether an outcome carried
 *   anything to say.
 *
 * The exit-code clause (R2.10) is asserted at the level core can honestly reach:
 * every arm resolves rather than throwing or rejecting, and no arm records an
 * `error`-severity diagnostic, so there is nothing on the degradation path for a
 * build to fail on. The `process.exit(0)` half belongs to `kept build` and is
 * asserted with the CLI command table in task 3.18, where a process exists.
 *
 * No test here starts a Kane process: `spawn` and `resolveBinary` are injected.
 *
 * **Validates: Requirements 2.7, 2.8, 2.9, 2.10, 2.12**
 */

/** Design's testing-strategy floor is 100 runs; stated so it cannot regress. */
const NUM_RUNS = 500;

/** `timeouts.enrichmentMs` from `.kept/config.json`, passed as a parameter. */
const BUDGET_MS = 60_000;

const DOC = 'apps/fixture/README.md';

const CLAIMS: readonly string[] = [
  'Every cart subtotal updates on quantity change',
  'Orders survive a page reload',
  'Checkout rejects an empty postcode',
  'The shop filter narrows by roast',
  'Settings persist the display currency',
];

/**
 * A prior freshness triple that is *not* empty, so "unchanged" is observable.
 * The three fields move together or not at all (§9.1 rule 5), which is exactly
 * what a degraded run must not disturb.
 */
const FRESHNESS: StateFreshness = Object.freeze({
  terminalEventAt: '2026-08-20T18:36:02Z',
  terminalEventType: 'done',
  commandFamily: 'Assurance',
});

// ---------------------------------------------------------------------------
// The stub process boundary
// ---------------------------------------------------------------------------

class FakeStream {
  private listener: ((chunk: string) => void) | undefined;
  setEncoding(): unknown {
    return this;
  }
  on(_event: string, listener: (chunk: string) => void): unknown {
    this.listener = listener;
    return this;
  }
  emit(chunk: string): void {
    this.listener?.(chunk);
  }
}

/**
 * `kill` closes the process immediately, which is what lets the budget arm run on
 * real timers: the invoker's timer fires, it signals, and the child is gone.
 */
class FakeChild {
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  private readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  on(event: string, listener: (...args: unknown[]) => void): unknown {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  kill(): boolean {
    queueMicrotask(() => {
      this.emitClose(null);
    });
    return true;
  }

  emitClose(code: number | null): void {
    for (const listener of this.listeners.get('close') ?? []) listener(code, null);
  }

  asChild(): ChildProcessLike {
    return this as unknown as ChildProcessLike;
  }
}

// ---------------------------------------------------------------------------
// The closed cause union — one arm per clause R2.7 to R2.12 names
// ---------------------------------------------------------------------------

const DONE = (status: string, exitCode: number): string =>
  `{"type":"done","v":1,"verb":"gaps","status":"${status}","exit_code":${exitCode}}`;

/**
 * A `gaps` payload with `usecases` set to whatever is passed. The axes are the ones
 * the real capture carries, so the "projects nothing" arm below is the honest trap:
 * two green figures over an empty row list, which is exactly the shape that would
 * read as "nothing owed" if it were ever accepted.
 */
const GAPS = (usecases: string): string =>
  `{"type":"gaps","v":1,"verb":"gaps","stage":"all",` +
  `"design_completeness":{"pct":100,"acs_designed":"6/6","usecases_complete":"1/9","ucs_needing_scenarios":8},` +
  `"proven":{"pct":100,"acs_proven":"6/6","failing":0,"blocked":0,"not_run":0,` +
  `"config":{"source":"graph_execution_facts","denominator":"current_live_acs"}},` +
  `"usecases":${usecases}}`;

const PAYLOAD = GAPS(
  '[{"id":"uc-2","title":"Manage cart pricing and discounts","risk":"high",' +
    '"design_completeness":{"pct":100,"status":"complete"},"stale_acs":0,' +
    '"proven":{"pct":100,"status":"proven"},"pending":[]}]',
);

interface Cause {
  /** What the requirement calls this failure. Used only in test names. */
  readonly label: string;
  readonly lines: readonly string[];
  readonly exitCode: number | null;
  /** null models "no binary in the environment at all". */
  readonly binary: string | null;
  /** true models a process that never speaks and never exits. */
  readonly hang: boolean;
  /** The §5.3 reason. Written here, never read from the implementation. */
  readonly reason: string;
  /** true when the provider should not even have been handed an invoker (R2.12). */
  readonly withoutInvoker: boolean;
}

function cause(over: Partial<Cause> & Pick<Cause, 'label' | 'reason'>): Cause {
  return {
    lines: [],
    exitCode: 0,
    binary: '/stub/bin/kane-cli',
    hang: false,
    withoutInvoker: false,
    ...over,
  };
}

const CAUSES: readonly Cause[] = [
  cause({
    label: 'Kane absent from the environment',
    binary: null,
    reason: ENRICHMENT_DEGRADED_REASONS.kaneNotFound,
  }),
  cause({
    label: 'no Kane invoker at all',
    withoutInvoker: true,
    reason: ENRICHMENT_DEGRADED_REASONS.kaneNotFound,
  }),
  cause({
    label: 'done status error',
    lines: [DONE('error', 2)],
    exitCode: 2,
    reason: 'assurance-status:error',
  }),
  cause({
    label: 'done status refused — the verified envelope',
    lines: [
      '{"type":"error","v":1,"verb":"gaps","message":"error: no context store here (run `kane-cli context ingest <files>` first)"}',
      DONE('refused', 2),
    ],
    exitCode: 2,
    reason: 'assurance-status:refused',
  }),
  cause({
    label: 'done status interrupted',
    lines: [DONE('interrupted', 130)],
    exitCode: 130,
    reason: 'assurance-status:interrupted',
  }),
  cause({
    label: 'done status aborted',
    lines: [DONE('aborted', 2)],
    exitCode: 2,
    reason: 'assurance-status:aborted',
  }),
  cause({
    label: 'done status paused with exit code 3',
    lines: [DONE('paused', 3)],
    exitCode: 3,
    reason: ENRICHMENT_DEGRADED_REASONS.pausedResumable,
  }),
  cause({
    label: 'a payload arrived but the stream lacks done',
    lines: [PAYLOAD],
    exitCode: 0,
    reason: ENRICHMENT_DEGRADED_REASONS.crashedStream,
  }),
  cause({
    label: 'nothing on stdout at all',
    lines: [],
    exitCode: 0,
    reason: ENRICHMENT_DEGRADED_REASONS.crashedStream,
  }),
  cause({
    label: 'unparseable output and no payload',
    lines: ['{"type":"gaps","v":1', '{{{', DONE('complete', 0)],
    exitCode: 0,
    reason: ENRICHMENT_DEGRADED_REASONS.gapsPayloadUnreadable,
  }),
  cause({
    label: 'a payload that projects no use-case rows',
    lines: [GAPS('[]'), DONE('complete', 0)],
    exitCode: 0,
    reason: ENRICHMENT_DEGRADED_REASONS.gapsPayloadUnreadable,
  }),
  cause({
    label: 'a complete envelope with a non-zero exit for the family',
    lines: [PAYLOAD, DONE('complete', 0)],
    exitCode: 2,
    reason: 'assurance-exit:failure',
  }),
  cause({
    label: 'exceeding the budget',
    hang: true,
    reason: ENRICHMENT_DEGRADED_REASONS.timeout,
  }),
];

function invokerFor(drawn: Cause): KaneInvoker {
  return new KaneInvoker({
    sink: createDiagnosticSink(),
    resolveBinary: () => drawn.binary,
    spawn: () => {
      const child = new FakeChild();
      if (!drawn.hang) {
        queueMicrotask(() => {
          for (const line of drawn.lines) child.stdout.emit(`${line}\n`);
          child.emitClose(drawn.exitCode);
        });
      }
      return child.asChild();
    },
  });
}

// ---------------------------------------------------------------------------
// The prior graph
// ---------------------------------------------------------------------------

interface PriorRepo {
  readonly claims: readonly string[];
  readonly verdicts: readonly Verdict[];
  readonly designed: readonly boolean[];
}

const arbPrior: fc.Arbitrary<PriorRepo> = fc
  .shuffledSubarray([...CLAIMS], { minLength: 0, maxLength: 5 })
  .chain((claims) =>
    fc.record({
      claims: fc.constant(claims),
      // Non-default on purpose: `proven` and `red` have to survive a degradation.
      verdicts: fc.array(fc.constantFrom(...VERDICTS), {
        minLength: claims.length,
        maxLength: claims.length,
      }),
      designed: fc.array(fc.boolean(), {
        minLength: claims.length,
        maxLength: claims.length,
      }),
    }),
  );

function documentFor(claims: readonly string[]): string {
  return ['# Kepler Coffee promises', ...claims, ''].join('\n');
}

function baselineFor(prior: PriorRepo): ProviderResult {
  const candidates: PromiseCandidate[] = prior.claims.map((claim, index) => ({
    claim,
    citation: { file: DOC, line: index + 2, text: claim },
    provider: 'baseline',
    designedTest:
      prior.designed[index] === true
        ? { path: `tests/doc_${index}_test.md`, testId: `T-${index}` }
        : null,
    verdict: prior.verdicts[index] as Verdict,
  }));
  return {
    provider: 'baseline',
    candidates,
    axes: NO_PROVIDER_AXES,
    ok: true,
    degradedReason: null,
    diagnostics: [],
  };
}

describe('Feature: kept, Property 6: Degradation preserves state and never fails the build', () => {
  for (const drawn of CAUSES) {
    it(`degrades on ${drawn.label} without losing the graph or a verdict`, async () => {
      await fc.assert(
        fc.asyncProperty(arbPrior, async (prior) => {
          const citations = inMemoryCitationSource({ [DOC]: documentFor(prior.claims) });
          const baseline = baselineFor(prior);
          const sink = createDiagnosticSink();

          // ── The provider resolves. Never throws, never rejects. ───────────
          const enrichment = await collectEnrichment({
            repoRoot: '/repo',
            ...(drawn.withoutInvoker ? {} : { invoker: invokerFor(drawn) }),
            diagnostics: sink,
            timeoutMs: drawn.hang ? 5 : BUDGET_MS,
          });

          expect(enrichment.ok).toBe(false);
          expect(enrichment.degradedReason).toBe(drawn.reason);
          // The enriched axes are discarded, whole. There is nothing to overlay
          // and therefore nothing that could move a verdict.
          expect(enrichment.axes.size).toBe(0);
          expect(enrichment.candidates).toEqual([]);
          // Nothing on this path is an error: a build that fails on
          // error-severity diagnostics still exits 0 (R2.10).
          expect(enrichment.diagnostics.every((entry) => entry.severity !== 'error')).toBe(true);

          // ── The resulting graph equals the baseline-only graph. ───────────
          const baselineOnly = mergeGraph({ baseline, citations });
          const degraded = mergeGraph({ baseline, enrichment, citations });

          expect(degraded.graph.promises).toEqual(baselineOnly.graph.promises);
          expect(degraded.graph.edges).toEqual(baselineOnly.graph.edges);

          // ── Degraded, with the reason recorded. ───────────────────────────
          expect(baselineOnly.graph.degraded).toBe(false);
          expect(degraded.graph.degraded).toBe(true);
          expect(degraded.graph.degradedReasons).toEqual([drawn.reason]);
          // And the metric rail withholds rather than reporting zero (R2.11).
          expect(computeMetrics(degraded.graph).provenCoverage).toBeNull();

          // ── Every pre-existing verdict is unchanged. ──────────────────────
          const expectedVerdicts: readonly (readonly [string, Verdict])[] = prior.claims
            .map(
              (claim, index): readonly [string, Verdict] => [
                promiseId(DOC, claim),
                prior.designed[index] === true
                  ? (prior.verdicts[index] as Verdict)
                  : 'undesigned',
              ],
            )
            .sort((left, right) => (left[0] < right[0] ? -1 : 1));
          expect(
            degraded.graph.promises.map(
              (promise): readonly [string, Verdict] => [promise.id, promise.verdict],
            ),
          ).toEqual(expectedVerdicts);

          // ── The freshness triple is unchanged. ────────────────────────────
          const state = createKeptState({ graph: baselineOnly.graph, freshness: FRESHNESS });
          // The merge never touches state: the prior value still carries its
          // triple, by value and by identity.
          expect(state.freshness).toEqual(FRESHNESS);

          const outcome: RunOutcome<'Assurance'> = {
            runId: 'run_enrichment',
            exitMeaning: enrichment.exitMeaning,
            stream:
              enrichment.stream ??
              parseStream(contractFor(ENRICHMENT_FAMILY), [], { sink: createDiagnosticSink() }),
          };
          const applied = applyRun(state, { outcome, writes: [], sink: createDiagnosticSink() });
          // No verdict moves in any arm, because there is nothing to write.
          expect(applied.updatedPromiseIds).toEqual([]);
          expect(applied.state.graph.promises.map((promise) => promise.verdict)).toEqual(
            state.graph.promises.map((promise) => promise.verdict),
          );
          if (!mayWriteVerdicts(outcome)) {
            // Refused: the prior state comes back by reference, which is the
            // freshness triple preserved by construction (§4.8).
            expect(applied.state).toBe(state);
            expect(applied.state.freshness).toEqual(FRESHNESS);
            expect(applied.wrote).toBe(false);
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });
  }

  it('is total over the cause list: every clause the requirement names has an arm', () => {
    // The requirement enumerates its causes, so the arms are enumerated too and
    // the reason vocabulary is asserted as a set rather than case by case.
    expect(new Set(CAUSES.map((entry) => entry.reason))).toEqual(
      new Set([
        'kane-not-found',
        'crashed-stream: outcome unknown',
        'paused-resumable',
        'enrichment-timeout',
        'gaps-payload-unreadable',
        'assurance-status:error',
        'assurance-status:refused',
        'assurance-status:interrupted',
        'assurance-status:aborted',
        'assurance-exit:failure',
      ]),
    );
  });
});
