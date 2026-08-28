import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  COVER_SINGULAR_ARGV,
  ENRICHMENT_ARGV,
  ENRICHMENT_DEGRADED_REASONS,
  ENRICHMENT_DEGRADED_REASON_VALUES,
  ENRICHMENT_DIAGNOSTIC_CODES,
  ENRICHMENT_FAMILY,
  ENRICHMENT_PROVIDER_NAME,
  KaneInvoker,
  MAX_COVERAGE_WALK_DEPTH,
  assuranceStatusReason,
  buildCoverageAxes,
  collectEnrichment,
  contractFor,
  coverageVerdict,
  createDiagnosticSink,
  createEnrichmentProvider,
  enrichmentTargetsFromCandidates,
  enrichmentTargetsFromPromises,
  createPromiseRecord,
  normaliseAssuranceStatus,
  normaliseCoveragePath,
  parseStream,
  projectCoverage,
  type ChildProcessLike,
  type CollectingDiagnosticSink,
  type CoverageEntry,
  type EnrichmentContext,
  type EnrichmentTarget,
  type PromiseCandidate,
} from 'kept-core';

/**
 * Task 3.7 — the enrichment provider and the tolerant coverage projection
 * (design §5.3, §5.3.1, R2.5–R2.9, R2.12).
 *
 * No test here starts a Kane process. The invoker's `spawn` and `resolveBinary`
 * are both injected, so the acceptance gate, every degradation reason and the
 * timeout kill are exercised deterministically with no credit spent.
 *
 * ### The debt task 2.16 left here, closed
 *
 * `test/cover-refusal-regression.test.ts` pins every **input** the
 * `degradedReason` mapping consumes against the real captured refusal — a
 * `complete` stream, `status: 'refused'`, the event's own exit code, the process
 * exit meaning, and Kane's verbatim message — and deliberately stops one step
 * short of asserting the reason string, because at the time nothing owned the
 * mapping. Its note says task 3.7 closes the hole by asserting `ok === false` and
 * the reason string against that same fixture. The
 * `degradedReason: assurance-status:refused` block below is that assertion, read
 * from the same committed bytes.
 */

const FIXTURES = new URL('./fixtures/', import.meta.url);

function fixtureLines(name: string): readonly string[] {
  return readFileSync(new URL(name, FIXTURES), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
}

const COVER_DONE_LINES = fixtureLines('assurance-cover-done.ndjson');
const COVER_REFUSED_LINES = fixtureLines('assurance-cover-refused.ndjson');
const PAUSED_LINES = fixtureLines('assurance-paused.ndjson');

/**
 * The `cover gaps` fixtures (§5.3.0). `assurance-gaps-complete.ndjson` and
 * `assurance-gaps-refused.ndjson` are both **real captured stdout** from
 * `kane-cli cover gaps --json --mode agent`, the first in this repository, the
 * second in an empty directory with no `.context/` store. The other three are
 * derived from the first line of the real capture and say so in the fixtures README:
 * Kane does not pause or truncate this command here, and a degradation path asserted
 * against a stream nobody ever produced is still the degradation path that has to
 * hold.
 */
const GAPS_COMPLETE_LINES = fixtureLines('assurance-gaps-complete.ndjson');
const GAPS_REFUSED_LINES = fixtureLines('assurance-gaps-refused.ndjson');
const GAPS_PAUSED_LINES = fixtureLines('assurance-gaps-paused.ndjson');
const GAPS_TRUNCATED_LINES = fixtureLines('assurance-gaps-truncated.ndjson');
const GAPS_NO_ROWS_LINES = fixtureLines('assurance-gaps-no-rows.ndjson');

/** The recorded refusal, decoded without the parser's help. */
const REFUSAL_OBJECTS = COVER_REFUSED_LINES.map(
  (line) => JSON.parse(line) as Record<string, unknown>,
);
const REFUSAL_MESSAGE = REFUSAL_OBJECTS[0]?.['message'] as string;

const GAPS_REFUSAL_OBJECTS = GAPS_REFUSED_LINES.map(
  (line) => JSON.parse(line) as Record<string, unknown>,
);
const GAPS_REFUSAL_MESSAGE = GAPS_REFUSAL_OBJECTS[0]?.['message'] as string;

/** The recorded success payload's own `coverage` event, decoded independently. */
const DONE_COVERAGE_EVENT = JSON.parse(COVER_DONE_LINES[0] as string) as Record<string, unknown>;

/** The recorded `gaps` event, decoded independently of the parser. */
const GAPS_PAYLOAD_EVENT = JSON.parse(GAPS_COMPLETE_LINES[0] as string) as Record<
  string,
  unknown
>;

const BIN = '/stub/bin/kane-cli';
const REPO = '/repo';

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
 * A stub child. `kill` closes it immediately, which is what lets the timeout path
 * be driven on real timers: the invoker's timer fires, sends SIGTERM, and the
 * process is gone — exactly the sequence, with no fake-clock coordination.
 */
class FakeChild {
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  readonly signals: string[] = [];
  private readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  on(event: string, listener: (...args: unknown[]) => void): unknown {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  kill(signal?: string): boolean {
    this.signals.push(signal ?? 'SIGTERM');
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

interface Stub {
  readonly invoker: KaneInvoker;
  readonly sink: CollectingDiagnosticSink;
  readonly argv: string[][];
}

/**
 * An invoker that replays `lines` on stdout and exits `exitCode`. `hang: true`
 * emits nothing and never closes on its own, so the budget is what ends it.
 */
function stub(options: {
  readonly lines?: readonly string[];
  readonly exitCode?: number | null;
  readonly binary?: string | null;
  readonly hang?: boolean;
}): Stub {
  const sink = createDiagnosticSink();
  const argv: string[][] = [];
  const invoker = new KaneInvoker({
    sink,
    resolveBinary: () => options.binary ?? (options.binary === null ? null : BIN),
    spawn: (_command, args) => {
      argv.push([...args]);
      const child = new FakeChild();
      if (options.hang !== true) {
        queueMicrotask(() => {
          for (const line of options.lines ?? []) child.stdout.emit(`${line}\n`);
          child.emitClose(options.exitCode ?? 0);
        });
      }
      return child.asChild();
    },
  });
  return { invoker, sink, argv };
}

/** The budget every test passes explicitly — never read from a default (§5.3). */
const BUDGET_MS = 60_000;

/** Two promises verified by one test document, plus one verified by another. */
function targets(): readonly EnrichmentTarget[] {
  return [
    { promiseId: 'p_aaaaaaaaaaaa', designedTest: { path: 'tests/cart_subtotal_test.md', testId: null } },
    { promiseId: 'p_bbbbbbbbbbbb', designedTest: { path: 'tests/cart_subtotal_test.md', testId: null } },
    { promiseId: 'p_cccccccccccc', designedTest: { path: 'tests/home_cta_test.md', testId: 'T-2' } },
    { promiseId: 'p_dddddddddddd', designedTest: null },
  ];
}

// ---------------------------------------------------------------------------
// coverage.ts — the tolerant projection
// ---------------------------------------------------------------------------

describe('the coverage payload projects tolerantly (§5.3)', () => {
  it('projects every entry of the recorded payload and recovers the pack id', () => {
    const projection = projectCoverage(DONE_COVERAGE_EVENT);

    expect(projection.entries).toHaveLength(7);
    expect(projection.entries.map((entry) => entry.testId)).toEqual([
      'T-1',
      'T-2',
      'T-3',
      'T-4',
      'T-5',
      'T-6',
      'T-7',
    ]);
    expect(projection.refused).toEqual([]);
    expect(projection.truncated).toBe(false);
    // `pack` is a path; the identity is the `ev_…` segment (§4.6, A12).
    expect(projection.packId).toBe('ev_20260820T183041Z');
    // The array lives at `coverage.tests` in this capture, and the walk found it
    // by shape. Locations are reported so a diagnostic can name one.
    expect(projection.entries[0]?.at).toBe('coverage.tests[0]');
  });

  it('agrees with the payload’s own totals without reading them', () => {
    const projection = projectCoverage(DONE_COVERAGE_EVENT);
    const proven = projection.entries.filter((entry) => coverageVerdict(entry) === 'proven');
    const red = projection.entries.filter((entry) => coverageVerdict(entry) === 'red');
    // `totals.proven` is 5 in the capture; counted from the entries, never read.
    expect(proven).toHaveLength(5);
    expect(red).toHaveLength(2);
  });

  it('finds the array through an extra envelope and a renamed key', () => {
    // The fixtures README warns that hard-coding `coverage.tests` is over-fitting.
    const wrapped = {
      type: 'coverage',
      payload: { result: { items: [{ testId: 'T-9', file: './tests/a_test.md', passed: true }] } },
    };
    const projection = projectCoverage(wrapped);
    expect(projection.entries).toHaveLength(1);
    expect(projection.entries[0]).toMatchObject({
      testId: 'T-9',
      path: 'tests/a_test.md',
      proven: true,
    });
  });

  it('refuses an entry with neither an identity nor a path, and names where it was', () => {
    const projection = projectCoverage({ coverage: { tests: [{ designed: true }, 'junk', 7] } });
    expect(projection.entries).toEqual([]);
    expect(projection.refused).toEqual(['coverage.tests[0]']);
    // Non-objects were never candidates, so they are not refusals either.
    expect(projection.examined).toBe(1);
  });

  it('deduplicates entries reached twice and stops at the depth bound', () => {
    const entry = { test_id: 'T-1', path: 'tests/a_test.md' };
    const twice = projectCoverage({ coverage: { tests: [entry] }, mirror: { tests: [entry] } });
    expect(twice.entries).toHaveLength(1);
    expect(twice.duplicates).toHaveLength(1);

    // Bury an array deeper than the bound: reported as truncated, not projected.
    let deep: unknown = { tests: [entry] };
    for (let level = 0; level <= MAX_COVERAGE_WALK_DEPTH; level += 1) deep = { down: deep };
    const bounded = projectCoverage(deep);
    expect(bounded.entries).toEqual([]);
    expect(bounded.truncated).toBe(true);
  });

  it('is total over payloads that are not objects at all', () => {
    for (const payload of [null, undefined, 7, 'text', true]) {
      const projection = projectCoverage(payload);
      expect(projection.entries).toEqual([]);
      expect(projection.truncated).toBe(false);
    }
  });

  it('normalises paths for matching and nothing more', () => {
    expect(normaliseCoveragePath('./tests/a_test.md')).toBe('tests/a_test.md');
    expect(normaliseCoveragePath('  tests\\a_test.md  ')).toBe('tests/a_test.md');
    expect(normaliseCoveragePath('tests/')).toBe('tests');
    expect(normaliseCoveragePath('')).toBeNull();
    expect(normaliseCoveragePath(7)).toBeNull();
  });
});

describe('a coverage entry implies a verdict only when it said something', () => {
  const entry = (over: Partial<CoverageEntry>): CoverageEntry => ({
    testId: 'T-1',
    path: 'tests/a_test.md',
    designed: null,
    proven: null,
    status: null,
    at: 'coverage.tests[0]',
    ...over,
  });

  it('reads the explicit booleans first', () => {
    expect(coverageVerdict(entry({ designed: false, proven: true }))).toBe('undesigned');
    expect(coverageVerdict(entry({ proven: true }))).toBe('proven');
    expect(coverageVerdict(entry({ proven: false }))).toBe('red');
  });

  it('falls back to a recognised status', () => {
    expect(coverageVerdict(entry({ status: 'passed' }))).toBe('proven');
    expect(coverageVerdict(entry({ status: 'failed' }))).toBe('red');
    expect(coverageVerdict(entry({ status: 'skipped' }))).toBe('stale');
    expect(coverageVerdict(entry({ status: 'missing' }))).toBe('undesigned');
  });

  it('answers null when it said nothing this module understands', () => {
    // The load-bearing case: an unrecognised shape must not move a verdict, or a
    // payload nobody anticipated would quietly restate the whole ledger.
    expect(coverageVerdict(entry({}))).toBeNull();
    expect(coverageVerdict(entry({ status: 'quantum' }))).toBeNull();
  });
});

describe('entries key onto promises by test id, then by normalised path (§5.3)', () => {
  it('prefers the test id and does not also try the path', () => {
    const keyed = buildCoverageAxes({
      entries: projectCoverage({
        tests: [{ test_id: 'T-2', path: 'tests/cart_subtotal_test.md', proven: true }],
      }).entries,
      targets: targets(),
    });
    // `T-2` belongs to the home-CTA promise; the path names the cart document.
    // Identity wins, and falling through to the path would have double-applied.
    expect(keyed.matched).toHaveLength(1);
    expect(keyed.matched[0]?.kind).toBe('test-id');
    expect(keyed.matched[0]?.promiseIds).toEqual(['p_cccccccccccc']);
  });

  it('overlays every promise that cites the same test document', () => {
    const keyed = buildCoverageAxes({
      entries: projectCoverage({
        tests: [{ test_id: 'T-3', path: 'tests/cart_subtotal_test.md', proven: false }],
      }).entries,
      targets: targets(),
      packId: 'ev_x',
    });
    expect(keyed.matched[0]?.kind).toBe('path');
    expect(keyed.matched[0]?.promiseIds).toEqual(['p_aaaaaaaaaaaa', 'p_bbbbbbbbbbbb']);
    // Kane's authoritative `test_id` is what enrichment adds to a binding
    // baseline found by path (§3.4).
    expect(keyed.axes.get('p_aaaaaaaaaaaa')).toEqual({
      designedTest: { path: 'tests/cart_subtotal_test.md', testId: 'T-3' },
      verdict: 'red',
      evidencePackId: 'ev_x',
    });
  });

  it('leaves an entry that keys to nothing unmatched rather than failing', () => {
    const keyed = buildCoverageAxes({
      entries: projectCoverage({ tests: [{ test_id: 'T-99', path: 'tests/gone_test.md' }] }).entries,
      targets: targets(),
    });
    expect(keyed.axes.size).toBe(0);
    expect(keyed.unmatched).toHaveLength(1);
  });

  it('cannot design a promise baseline never designed', () => {
    // `p_dddddddddddd` has no designed test, so no coverage entry can key to it:
    // an entry names a test document, and only baseline knows which claim a
    // document verifies.
    const keyed = buildCoverageAxes({
      entries: projectCoverage({ tests: [{ test_id: 'T-1', path: 'tests/anything_test.md' }] })
        .entries,
      targets: targets(),
    });
    expect([...keyed.axes.keys()]).not.toContain('p_dddddddddddd');
  });
});

// ---------------------------------------------------------------------------
// enrichment.ts, the acceptance gate, over the `gaps` payload (§5.3.0)
// ---------------------------------------------------------------------------

describe('the invocation is `cover gaps --json` under the Assurance family (R9.9)', () => {
  it('lets the invoker append --mode agent, and never --agent', async () => {
    const { invoker, argv } = stub({ lines: GAPS_COMPLETE_LINES, exitCode: 0 });
    const result = await collectEnrichment({
      repoRoot: REPO,
      invoker,
      timeoutMs: BUDGET_MS,
    });

    expect(ENRICHMENT_ARGV).toEqual(['cover', 'gaps', '--json']);
    expect(ENRICHMENT_FAMILY).toBe('Assurance');
    expect(contractFor(ENRICHMENT_FAMILY).terminalType).toBe('done');
    expect(argv[0]).toEqual(['cover', 'gaps', '--json', '--mode', 'agent']);
    expect(result.effectiveArgv).toEqual(['cover', 'gaps', '--json', '--mode', 'agent']);
    expect(result.provider).toBe(ENRICHMENT_PROVIDER_NAME);
  });

  it('keeps the singular `cover` argv spelled once, as the documented first choice', () => {
    // §5.3.0: `cover` is right for a repository whose packs were *authored*. It is
    // not invoked here, and the constant exists so the choice survives as code
    // rather than only as prose, and so the committed refusal fixture has
    // something to name.
    expect(COVER_SINGULAR_ARGV).toEqual(['cover', '--json']);
    expect(ENRICHMENT_ARGV).not.toEqual(COVER_SINGULAR_ARGV);
  });
});

describe('the gate accepts only complete + done + status complete + rows (§5.3.0)', () => {
  it('accepts the recorded `cover gaps` stream and reads both axes verbatim', async () => {
    const { invoker } = stub({ lines: GAPS_COMPLETE_LINES, exitCode: 0 });
    const sink = createDiagnosticSink();
    const result = await collectEnrichment({
      repoRoot: REPO,
      invoker,
      diagnostics: sink,
      timeoutMs: BUDGET_MS,
    });

    expect(result.ok).toBe(true);
    expect(result.degradedReason).toBeNull();
    // Enrichment supplies no candidates, so it can supply no citations (§5.4).
    expect(result.candidates).toEqual([]);
    // And no per-promise overlay: `gaps` names use cases, not test documents.
    expect(result.axes.size).toBe(0);

    const axes = result.coverageAxes;
    expect(axes).not.toBeNull();
    if (axes === null) throw new Error('expected the axes on the accepting path');

    // Verbatim, compared against the bytes on disk rather than against a literal
    // written here.
    const design = GAPS_PAYLOAD_EVENT['design_completeness'] as Record<string, unknown>;
    const proven = GAPS_PAYLOAD_EVENT['proven'] as Record<string, unknown>;
    expect(axes.designCompleteness.pct).toBe(design['pct']);
    expect(axes.designCompleteness.ratio.text).toBe(design['acs_designed']);
    expect(axes.designCompleteness.usecasesComplete.text).toBe(design['usecases_complete']);
    expect(axes.designCompleteness.ucsNeedingScenarios).toBe(design['ucs_needing_scenarios']);
    expect(axes.proven.pct).toBe(proven['pct']);
    expect(axes.proven.ratio.text).toBe(proven['acs_proven']);
    expect(axes.proven.source).toBe('graph_execution_facts');
    expect(axes.proven.denominatorBasis).toBe('current_live_acs');
    expect(axes.rows).toHaveLength((GAPS_PAYLOAD_EVENT['usecases'] as unknown[]).length);
    expect(sink.has(ENRICHMENT_DIAGNOSTIC_CODES.accepted)).toBe(true);
  });

  it('publishes the debt rather than rounding it away', async () => {
    const { invoker } = stub({ lines: GAPS_COMPLETE_LINES, exitCode: 0 });
    const result = await collectEnrichment({ repoRoot: REPO, invoker, timeoutMs: BUDGET_MS });
    const axes = result.coverageAxes;
    if (axes === null) throw new Error('expected the axes on the accepting path');

    // `1/9` use cases complete with eight needing scenarios: the honest number, and
    // the whole reason the ribbon exists. A projection that dropped it would report
    // 100% of the acceptance criteria that exist and nothing about the designs owed.
    expect(axes.designCompleteness.usecasesComplete.text).toBe('1/9');
    expect(axes.designCompleteness.usecasesComplete.numerator).toBe(1);
    expect(axes.designCompleteness.usecasesComplete.denominator).toBe(9);
    expect(axes.designCompleteness.ucsNeedingScenarios).toBe(8);
    expect(
      axes.rows.filter((row) => row.designCompleteness.status === 'undesigned'),
    ).toHaveLength(8);
  });

  it('degrades when a complete, accepting stream carried no gaps event', async () => {
    const { invoker } = stub({
      lines: ['{"type":"done","v":1,"verb":"gaps","status":"complete","exit_code":0}'],
      exitCode: 0,
    });
    const sink = createDiagnosticSink();
    const result = await collectEnrichment({
      repoRoot: REPO,
      invoker,
      diagnostics: sink,
      timeoutMs: BUDGET_MS,
    });

    expect(result.ok).toBe(false);
    expect(result.degradedReason).toBe(ENRICHMENT_DEGRADED_REASONS.gapsPayloadUnreadable);
    expect(sink.has(ENRICHMENT_DIAGNOSTIC_CODES.gapsMissing)).toBe(true);
    expect(result.coverageAxes).toBeNull();
  });

  it('degrades when the payload projects zero rows, withholding rather than zeroing', async () => {
    const { invoker } = stub({ lines: GAPS_NO_ROWS_LINES, exitCode: 0 });
    const sink = createDiagnosticSink();
    const result = await collectEnrichment({
      repoRoot: REPO,
      invoker,
      diagnostics: sink,
      timeoutMs: BUDGET_MS,
    });

    // The payload's own axes read 100 and 100 in this fixture, which is exactly the
    // trap: an empty ribbon under a green pair of figures reads as "nothing owed".
    expect(result.degradedReason).toBe(ENRICHMENT_DEGRADED_REASONS.gapsPayloadUnreadable);
    expect(sink.has(ENRICHMENT_DIAGNOSTIC_CODES.gapsUnprojectable)).toBe(true);
    expect(result.coverageAxes).toBeNull();
    expect(result.gaps?.axes.rows).toEqual([]);
  });

  it('degrades when a payload arrived but the stream never reached done (R2.7)', async () => {
    const { invoker } = stub({ lines: GAPS_TRUNCATED_LINES, exitCode: 0 });
    const sink = createDiagnosticSink();
    const result = await collectEnrichment({
      repoRoot: REPO,
      invoker,
      diagnostics: sink,
      timeoutMs: BUDGET_MS,
    });

    expect(result.degradedReason).toBe(ENRICHMENT_DEGRADED_REASONS.crashedStream);
    expect(result.stream?.kind).toBe('crashed');
    expect(sink.has(ENRICHMENT_DIAGNOSTIC_CODES.crashedStream)).toBe(true);
    // A perfectly readable payload is still discarded: the outcome is unknown.
    expect(result.coverageAxes).toBeNull();
    expect(result.gaps).toBeNull();
  });

  it('degrades when the gaps run pauses at exit 3, and moves nothing (R2.9)', async () => {
    const { invoker } = stub({ lines: GAPS_PAUSED_LINES, exitCode: 3 });
    const sink = createDiagnosticSink();
    const result = await collectEnrichment({
      repoRoot: REPO,
      invoker,
      diagnostics: sink,
      timeoutMs: BUDGET_MS,
    });

    expect(result.degradedReason).toBe(ENRICHMENT_DEGRADED_REASONS.pausedResumable);
    expect(result.exitMeaning).toBe('paused-resumable');
    expect(result.coverageAxes).toBeNull();
    expect(sink.hasSeverity('error')).toBe(false);
  });
});

describe('degradedReason: assurance-status:refused, for `cover gaps` too (§5.3.1)', () => {
  it('maps the real captured gaps refusal to ok false and that exact reason', async () => {
    const { invoker } = stub({ lines: GAPS_REFUSED_LINES, exitCode: 2 });
    const sink = createDiagnosticSink();
    const result = await collectEnrichment({
      repoRoot: REPO,
      invoker,
      diagnostics: sink,
      timeoutMs: BUDGET_MS,
    });

    expect(result.ok).toBe(false);
    expect(result.degradedReason).toBe('assurance-status:refused');
    expect(result.coverageAxes).toBeNull();

    // A *complete* stream, `done` arrived, whose status is `refused`, and a
    // process exit that means only the generic `failure`. Both read from the
    // fixture, whose `verb` is `gaps`: the envelope §5.3.1 verified for `cover`,
    // observed for the command KEPT now runs.
    expect(result.stream?.kind).toBe('complete');
    expect(result.exitMeaning).toBe('failure');
    expect(GAPS_REFUSAL_OBJECTS.every((event) => event['verb'] === 'gaps')).toBe(true);
    const parsed = parseStream(contractFor('Assurance'), GAPS_REFUSED_LINES);
    if (parsed.kind !== 'complete') throw new Error('expected a complete stream');
    expect(assuranceStatusReason(parsed.terminal.status as string)).toBe(result.degradedReason);
  });

  it('quotes Kane’s own remedy verbatim so the reviewer is told what to run', async () => {
    const { invoker } = stub({ lines: GAPS_REFUSED_LINES, exitCode: 2 });
    const sink = createDiagnosticSink();
    await collectEnrichment({
      repoRoot: REPO,
      invoker,
      diagnostics: sink,
      timeoutMs: BUDGET_MS,
    });

    const reported = sink.withCode(ENRICHMENT_DIAGNOSTIC_CODES.status);
    expect(reported).toHaveLength(1);
    // Verbatim by construction: compared against the bytes on disk.
    expect(reported[0]?.message).toContain(GAPS_REFUSAL_MESSAGE);
    expect(reported[0]?.message).toContain('context ingest');
  });

  it('keeps the singular `cover` refusal a passing regression (§5.3.1)', () => {
    // `assurance-cover-refused.ndjson` is the envelope the singular command produced
    // with no `.context/` store. Nothing invokes `cover` any more, and the
    // classification of its stream must not have moved: still a *complete* stream
    // carrying `refused`, and still read that way, because `providers/coverage.ts`
    // has to stay usable by a repository whose packs *are* authored.
    const parsed = parseStream(contractFor('Assurance'), COVER_REFUSED_LINES);
    expect(parsed.kind).toBe('complete');
    if (parsed.kind !== 'complete') return;
    expect(parsed.terminal.status).toBe('refused');
    expect(parsed.coverage).toBeNull();
    expect(parsed.gaps).toBeNull();
    expect(REFUSAL_MESSAGE).toContain('context ingest');
  });
});

describe('every other observation gets its own reason from §5.3', () => {
  it('kane-not-found when no invoker was supplied at all (R2.12)', async () => {
    const sink = createDiagnosticSink();
    const result = await collectEnrichment({
      repoRoot: REPO,
      diagnostics: sink,
      timeoutMs: BUDGET_MS,
    });
    expect(result.degradedReason).toBe(ENRICHMENT_DEGRADED_REASONS.kaneNotFound);
    expect(result.exitMeaning).toBe('kane-not-found');
    expect(result.stream).toBeNull();
    expect(result.coverageAxes).toBeNull();
    expect(sink.has(ENRICHMENT_DIAGNOSTIC_CODES.kaneNotFound)).toBe(true);
  });

  it('kane-not-found when the binary is absent from the environment (R2.12)', async () => {
    const { invoker } = stub({ binary: null });
    const result = await collectEnrichment({ repoRoot: REPO, invoker, timeoutMs: BUDGET_MS });
    expect(result.degradedReason).toBe(ENRICHMENT_DEGRADED_REASONS.kaneNotFound);
    expect(result.stream).toBeNull();
  });

  it('paused-resumable for a paused done event, and never a failure (R2.9)', async () => {
    const { invoker } = stub({ lines: PAUSED_LINES, exitCode: 3 });
    const sink = createDiagnosticSink();
    const result = await collectEnrichment({
      repoRoot: REPO,
      invoker,
      diagnostics: sink,
      timeoutMs: BUDGET_MS,
    });
    expect(result.degradedReason).toBe(ENRICHMENT_DEGRADED_REASONS.pausedResumable);
    // Exit 3 under Assurance is resumable, never failure — the single most
    // damaging thing to misread in this codebase.
    expect(result.exitMeaning).toBe('paused-resumable');
    expect(sink.has(ENRICHMENT_DIAGNOSTIC_CODES.paused)).toBe(true);
    expect(sink.hasSeverity('error')).toBe(false);
  });

  it('assurance-status:<status> for each of the four failing statuses', async () => {
    for (const status of ['error', 'refused', 'interrupted', 'aborted'] as const) {
      const { invoker } = stub({
        lines: [`{"type":"done","v":1,"verb":"gaps","status":"${status}","exit_code":2}`],
        exitCode: 2,
      });
      const result = await collectEnrichment({ repoRoot: REPO, invoker, timeoutMs: BUDGET_MS });
      expect(result.degradedReason).toBe(`assurance-status:${status}`);
      expect(result.coverageAxes).toBeNull();
    }
  });

  it('assurance-status:unknown when done carried no readable status', async () => {
    const { invoker } = stub({
      lines: ['{"type":"done","v":1,"verb":"gaps","exit_code":0}'],
      exitCode: 0,
    });
    const result = await collectEnrichment({ repoRoot: REPO, invoker, timeoutMs: BUDGET_MS });
    // Never the accepting branch: an unreadable status is not `complete`.
    expect(result.degradedReason).toBe('assurance-status:unknown');
    expect(normaliseAssuranceStatus(undefined)).toBe('unknown');
  });

  it('assurance-exit:<meaning> for a failing exit under an accepting envelope (R2.8)', async () => {
    const { invoker } = stub({ lines: GAPS_COMPLETE_LINES, exitCode: 130 });
    const result = await collectEnrichment({
      repoRoot: REPO,
      invoker,
      timeoutMs: BUDGET_MS,
    });
    expect(result.degradedReason).toBe('assurance-exit:force-interrupted');
    expect(result.coverageAxes).toBeNull();
  });

  it('enrichment-timeout when the budget elapses, using the budget it was given', async () => {
    const { invoker } = stub({ hang: true });
    const sink = createDiagnosticSink();
    const provider = createEnrichmentProvider({ timeoutMs: 5 });
    const result = await provider.collect({ repoRoot: REPO, invoker, diagnostics: sink });

    expect(result.ok).toBe(false);
    expect(result.degradedReason).toBe(ENRICHMENT_DEGRADED_REASONS.timeout);
    // The number came from the caller, not from a constant in the provider: the
    // budget lives in `.kept/config.json` and nowhere else.
    expect(sink.withCode(ENRICHMENT_DIAGNOSTIC_CODES.timeout)[0]?.message).toContain('5 ms');
  });

  it('a per-call budget overrides the one the provider was built with', async () => {
    const { invoker } = stub({ hang: true });
    const sink = createDiagnosticSink();
    const provider = createEnrichmentProvider({ timeoutMs: 60_000 });
    // An `EnrichmentContext` is a `ProviderContext`, so the extra seam travels
    // through the adapter interface without a cast.
    const context: EnrichmentContext = { repoRoot: REPO, invoker, diagnostics: sink, timeoutMs: 3 };
    await provider.collect(context);
    expect(sink.withCode(ENRICHMENT_DIAGNOSTIC_CODES.timeout)[0]?.message).toContain('3 ms');
  });

  it('gaps-payload-unreadable when lines failed JSON parsing and no payload arrived', async () => {
    const { invoker } = stub({
      lines: [
        '{"type":"gaps","v":1',
        '{"type":"done","v":1,"verb":"gaps","status":"complete","exit_code":0}',
      ],
      exitCode: 0,
    });
    const sink = createDiagnosticSink();
    const result = await collectEnrichment({
      repoRoot: REPO,
      invoker,
      diagnostics: sink,
      timeoutMs: BUDGET_MS,
    });
    expect(result.degradedReason).toBe(ENRICHMENT_DEGRADED_REASONS.gapsPayloadUnreadable);
    expect(sink.has(ENRICHMENT_DIAGNOSTIC_CODES.streamLinesUnparsed)).toBe(true);
  });

  it('names the reason `gaps-payload-unreadable`, and the old spelling is gone', () => {
    // The rename is part of the contract: the string reaches `graph.degradedReasons`,
    // the committed snapshot and a page a reviewer reads, and telling them a
    // `coverage` payload was unreadable when the run was `cover gaps` sends them to
    // read the wrong output.
    expect(ENRICHMENT_DEGRADED_REASON_VALUES).toContain('gaps-payload-unreadable');
    expect(ENRICHMENT_DEGRADED_REASON_VALUES).not.toContain('coverage-payload-unreadable');
  });
});

describe('keying targets are derived, never invented', () => {
  const citation = { file: 'apps/fixture/README.md', line: 3, text: 'the subtotal updates' };

  it('derives a candidate’s id exactly as the record factory will', () => {
    const candidate: PromiseCandidate = {
      claim: 'the subtotal updates',
      citation,
      provider: 'baseline',
      designedTest: { path: 'tests/cart_subtotal_test.md', testId: 'T-3' },
    };
    const record = createPromiseRecord({
      claim: candidate.claim,
      citation,
      designedTest: candidate.designedTest,
      providers: ['baseline'],
    });

    expect(enrichmentTargetsFromCandidates([candidate])).toEqual([
      { promiseId: record.id, designedTest: candidate.designedTest },
    ]);
    expect(enrichmentTargetsFromPromises([record])).toEqual([
      { promiseId: record.id, designedTest: record.designedTest },
    ]);
  });

  it('drops a candidate with no citation rather than giving it an identity', () => {
    expect(
      enrichmentTargetsFromCandidates([
        { claim: 'uncited', citation: null, provider: 'baseline' },
      ]),
    ).toEqual([]);
  });
});
