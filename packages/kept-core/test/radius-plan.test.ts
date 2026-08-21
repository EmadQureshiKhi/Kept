import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  AGENT_FLAG,
  KaneInvoker,
  PLAN_DIAGNOSTIC_CODES,
  PLAN_FAMILY,
  PLAN_FILE_RELATIVE_PATH,
  PLAN_MAX_AGE_MS,
  PLAN_REFRESH_ARGV,
  PLAN_REFRESH_TIMEOUT_MS,
  TEST_DOCUMENT_ROOT,
  contractFor,
  createDiagnosticSink,
  inMemoryPlanFileSystem,
  isTestrunPlan,
  newestTestDocument,
  normalisePlanEvent,
  parseStream,
  planStaleness,
  readPlan,
  serialisePlan,
  type ChildProcessLike,
  type CollectingDiagnosticSink,
  type PlanFileSystem,
  type TestrunPlan,
  type TestrunPlanEvent,
} from '@kept/core';

/**
 * Task 11.8 — the testrun plan cache (design §7.2, R4.4).
 *
 * No test here starts a Kane process: the invoker's `spawn` and `resolveBinary`
 * are both injected, and the filesystem is in-memory. The three things being
 * pinned are the argv (an `ExecutionTestrun` invocation with **no** `--agent`),
 * the conjunctive trust gate (`testrun_done` reached **and** a `testrun_plan`
 * carried), and the behaviour that makes the gate safe: on refusal the previous
 * `.kept/plan.json` is left byte-identical.
 */

const FIXTURES = new URL('./fixtures/', import.meta.url);

function fixtureLines(name: string): readonly string[] {
  return readFileSync(new URL(name, FIXTURES), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
}

const MIXED_LINES = fixtureLines('testrun-mixed.ndjson');
const CRASHED_LINES = fixtureLines('testrun-crashed.ndjson');
const PREFLIGHT_LINES = fixtureLines('testrun-preflight-invalid.ndjson');

const BIN = '/stub/bin/kane-cli';
const REPO = '/repo';
const NOW = Date.parse('2026-08-20T18:00:00.000Z');

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

interface Stub {
  readonly invoker: KaneInvoker;
  readonly sink: CollectingDiagnosticSink;
  /** Every argv the invoker actually passed, enabler included. */
  readonly argv: string[][];
}

function stub(options: {
  readonly lines?: readonly string[];
  readonly exitCode?: number | null;
  readonly binary?: string | null;
}): Stub {
  const sink = createDiagnosticSink();
  const argv: string[][] = [];
  const invoker = new KaneInvoker({
    sink,
    resolveBinary: () => (options.binary === null ? null : options.binary ?? BIN),
    spawn: (_command, args) => {
      argv.push([...args]);
      const child = new FakeChild();
      queueMicrotask(() => {
        for (const line of options.lines ?? []) child.stdout.emit(`${line}\n`);
        child.emitClose(options.exitCode ?? 0);
      });
      return child.asChild();
    },
  });
  return { invoker, sink, argv };
}

/** A plan on disk, captured `ageMs` before {@link NOW}. */
function cachedPlan(ageMs: number, testId: string | null = 'CACHED-1'): TestrunPlan {
  return {
    valid: true,
    capturedAt: new Date(NOW - ageMs).toISOString(),
    members: [{ path: 'tests/cart_subtotal_test.md', testId, tags: ['cart'], failure: null }],
  };
}

function fsWith(plan: TestrunPlan | null, extra: Record<string, { text: string; mtimeMs?: number }> = {}): PlanFileSystem & {
  readonly files: Map<string, { text: string; mtimeMs: number }>;
} {
  const seed: Record<string, { text: string; mtimeMs?: number }> = { ...extra };
  if (plan !== null) {
    seed[PLAN_FILE_RELATIVE_PATH] = { text: serialisePlan(plan), mtimeMs: Date.parse(plan.capturedAt) };
  }
  return inMemoryPlanFileSystem(seed);
}

// ---------------------------------------------------------------------------
// The refresh invocation
// ---------------------------------------------------------------------------

describe('the plan refresh is an ExecutionTestrun invocation (§7.2, R3.5)', () => {
  it('issues `testrun run --dry-run` with no NDJSON flag appended', async () => {
    const kane = stub({ lines: MIXED_LINES });
    const plan = await readPlan({
      invoker: kane.invoker,
      cwd: REPO,
      fs: fsWith(null),
      sink: kane.sink,
      now: () => NOW,
    });

    expect(plan).not.toBeNull();
    expect(kane.argv).toHaveLength(1);
    // The enabler for this family is piped stdout, so the argv is unchanged.
    expect(kane.argv[0]).toEqual([...PLAN_REFRESH_ARGV]);
    expect(kane.argv[0]?.join(' ')).not.toContain(AGENT_FLAG);
  });

  it('declares the family whose terminal event is testrun_done', () => {
    expect(PLAN_FAMILY).toBe('ExecutionTestrun');
    expect(contractFor(PLAN_FAMILY).terminalType).toBe('testrun_done');
    expect(contractFor(PLAN_FAMILY).ndjson).toBe('piped-stdout');
  });

  it('defaults to the ten-minute window and the sixty-second budget', () => {
    expect(PLAN_MAX_AGE_MS).toBe(600_000);
    expect(PLAN_REFRESH_TIMEOUT_MS).toBe(60_000);
  });
});

// ---------------------------------------------------------------------------
// The trust gate
// ---------------------------------------------------------------------------

describe('a plan is trusted when the refresh ended cleanly and carried one (§7.2)', () => {
  it('caches the members of a complete stream', async () => {
    const kane = stub({ lines: MIXED_LINES });
    const fs = fsWith(null);
    const plan = await readPlan({
      invoker: kane.invoker,
      cwd: REPO,
      fs,
      sink: kane.sink,
      now: () => NOW,
    });

    // Whatever the fixture's plan event carries, read independently of the module.
    const wire = parseStream(contractFor(PLAN_FAMILY), MIXED_LINES).plan as TestrunPlanEvent;
    const expected = (wire.members ?? []).filter((member) => typeof member.path === 'string');

    expect(plan?.members).toHaveLength(expected.length);
    expect(plan?.capturedAt).toBe(new Date(NOW).toISOString());
    expect(fs.files.has(PLAN_FILE_RELATIVE_PATH)).toBe(true);
    expect(isTestrunPlan(JSON.parse(fs.files.get(PLAN_FILE_RELATIVE_PATH)?.text ?? 'null'))).toBe(
      true,
    );
    expect(kane.sink.has(PLAN_DIAGNOSTIC_CODES.refreshed)).toBe(true);
  });

  it('caches a dry run that carried a plan and exited cleanly without a terminal', async () => {
    // What `kane-cli` 0.8.4 actually emits: `testrun run --dry-run` prints one
    // line — the `testrun_plan` event — and exits 0. There is no `testrun_done`,
    // because a dry run executes nothing, so there is no execution to report done.
    // Requiring one rejected every plan the installed CLI can produce, and left
    // `kept verify` reporting an empty radius on a suite of thirteen members (15.3).
    const fs = fsWith(null);
    const kane = stub({ lines: CRASHED_LINES });

    const plan = await readPlan({
      invoker: kane.invoker,
      cwd: REPO,
      fs,
      sink: kane.sink,
      now: () => NOW,
    });

    const wire = parseStream(contractFor(PLAN_FAMILY), CRASHED_LINES).plan as TestrunPlanEvent;
    const expected = (wire.members ?? []).filter((member) => typeof member.path === 'string');

    expect(plan?.members).toHaveLength(expected.length);
    expect(fs.files.has(PLAN_FILE_RELATIVE_PATH)).toBe(true);
    expect(kane.sink.has(PLAN_DIAGNOSTIC_CODES.refreshedWithoutTerminal)).toBe(true);
    expect(kane.sink.has(PLAN_DIAGNOSTIC_CODES.refreshCrashed)).toBe(false);
  });

  it('leaves the previous cache byte-identical when the refresh exits badly', async () => {
    const previous = cachedPlan(PLAN_MAX_AGE_MS * 2);
    const fs = fsWith(previous);
    const before = fs.files.get(PLAN_FILE_RELATIVE_PATH)?.text;
    // Truncated **and** a bad exit: nothing about this run is trustworthy, so the
    // plan it half-carried is discarded and the cache stands.
    const kane = stub({ lines: CRASHED_LINES, exitCode: 1 });

    const plan = await readPlan({
      invoker: kane.invoker,
      cwd: REPO,
      fs,
      sink: kane.sink,
      now: () => NOW,
    });

    expect(plan).toEqual(previous);
    expect(fs.files.get(PLAN_FILE_RELATIVE_PATH)?.text).toBe(before);
    expect(kane.sink.has(PLAN_DIAGNOSTIC_CODES.refreshCrashed)).toBe(true);
    expect(kane.sink.has(PLAN_DIAGNOSTIC_CODES.refreshed)).toBe(false);
  });

  it('leaves the previous cache in place when a complete stream carries no plan event', async () => {
    const previous = cachedPlan(PLAN_MAX_AGE_MS * 2);
    const fs = fsWith(previous);
    const kane = stub({ lines: [JSON.stringify({ type: 'testrun_done', status: 'passed' })] });

    const plan = await readPlan({
      invoker: kane.invoker,
      cwd: REPO,
      fs,
      sink: kane.sink,
      now: () => NOW,
    });

    expect(plan).toEqual(previous);
    expect(kane.sink.has(PLAN_DIAGNOSTIC_CODES.planEventAbsent)).toBe(true);
  });

  it('answers null and says so when there is no cache and the refresh crashed', async () => {
    const kane = stub({ lines: CRASHED_LINES, exitCode: 1 });
    const plan = await readPlan({
      invoker: kane.invoker,
      cwd: REPO,
      fs: fsWith(null),
      sink: kane.sink,
      now: () => NOW,
    });

    expect(plan).toBeNull();
    expect(kane.sink.has(PLAN_DIAGNOSTIC_CODES.unavailable)).toBe(true);
  });

  it('caches a preflight-rejected plan as-is, exit 2 and all', async () => {
    // For this family exit 2 means preflight-rejected, not generic failure: the
    // members are real and each carries its reason (R4.11).
    const kane = stub({ lines: PREFLIGHT_LINES, exitCode: 2 });
    const fs = fsWith(null);
    const plan = await readPlan({
      invoker: kane.invoker,
      cwd: REPO,
      fs,
      sink: kane.sink,
      now: () => NOW,
    });

    expect(plan?.valid).toBe(false);
    expect(plan?.members.some((member) => member.failure !== null)).toBe(true);
    // A rejected member with no id is cached as `null`, never as a guess.
    expect(plan?.members.some((member) => member.testId === null)).toBe(true);
    expect(kane.sink.has(PLAN_DIAGNOSTIC_CODES.preflightInvalid)).toBe(true);
    expect(fs.files.has(PLAN_FILE_RELATIVE_PATH)).toBe(true);
  });

  it('does not run Kane at all when the binary is absent, and keeps the cache', async () => {
    const previous = cachedPlan(PLAN_MAX_AGE_MS * 2);
    const fs = fsWith(previous);
    const kane = stub({ binary: null });

    const plan = await readPlan({
      invoker: kane.invoker,
      cwd: REPO,
      fs,
      sink: kane.sink,
      now: () => NOW,
    });

    expect(plan).toEqual(previous);
    expect(kane.argv).toEqual([]);
    expect(kane.sink.has(PLAN_DIAGNOSTIC_CODES.kaneNotFound)).toBe(true);
  });

  it('records that no invoker was supplied rather than pretending it refreshed', async () => {
    const sink = createDiagnosticSink();
    const plan = await readPlan({ cwd: REPO, fs: fsWith(null), sink, now: () => NOW });

    expect(plan).toBeNull();
    expect(sink.has(PLAN_DIAGNOSTIC_CODES.refreshUnavailable)).toBe(true);
    expect(sink.has(PLAN_DIAGNOSTIC_CODES.unavailable)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

describe('the three refresh triggers (§7.2)', () => {
  it('is not stale inside the window with no newer test document', () => {
    const decision = planStaleness({
      plan: cachedPlan(1_000),
      nowMs: NOW,
      maxAgeMs: PLAN_MAX_AGE_MS,
    });
    expect(decision.stale).toBe(false);
    expect(decision.reason).toBeNull();
  });

  it('is stale when absent, when malformed, and when expired', () => {
    expect(planStaleness({ plan: null, nowMs: NOW, maxAgeMs: PLAN_MAX_AGE_MS }).reason).toBe(
      'missing',
    );
    expect(
      planStaleness({ plan: null, malformed: true, nowMs: NOW, maxAgeMs: PLAN_MAX_AGE_MS }).reason,
    ).toBe('malformed');
    expect(
      planStaleness({
        plan: cachedPlan(PLAN_MAX_AGE_MS + 1),
        nowMs: NOW,
        maxAgeMs: PLAN_MAX_AGE_MS,
      }).reason,
    ).toBe('expired');
  });

  it('is stale when a test document is newer than the cache', () => {
    const plan = cachedPlan(1_000);
    const decision = planStaleness({
      plan,
      cacheMtimeMs: Date.parse(plan.capturedAt),
      newestTestDocument: { path: 'tests/cart_subtotal_test.md', mtimeMs: NOW },
      nowMs: NOW,
      maxAgeMs: PLAN_MAX_AGE_MS,
    });
    expect(decision.reason).toBe('test-document-newer');
    expect(decision.detail).toContain('tests/cart_subtotal_test.md');
  });

  it('refreshes on a newly saved test document even inside the window', async () => {
    const previous = cachedPlan(1_000);
    const fs = fsWith(previous, {
      [`${TEST_DOCUMENT_ROOT}/cart_subtotal_test.md`]: { text: '---\n---\n', mtimeMs: NOW },
    });
    const kane = stub({ lines: MIXED_LINES });

    const plan = await readPlan({
      invoker: kane.invoker,
      cwd: REPO,
      fs,
      sink: kane.sink,
      now: () => NOW,
    });

    expect(kane.argv).toHaveLength(1);
    expect(plan?.capturedAt).toBe(new Date(NOW).toISOString());
  });

  it('does not refresh a current cache at all', async () => {
    const previous = cachedPlan(1_000);
    const fs = fsWith(previous, {
      [`${TEST_DOCUMENT_ROOT}/cart_subtotal_test.md`]: { text: '---\n---\n', mtimeMs: NOW - 5_000 },
    });
    const kane = stub({ lines: MIXED_LINES });

    const plan = await readPlan({
      invoker: kane.invoker,
      cwd: REPO,
      fs,
      sink: kane.sink,
      now: () => NOW,
    });

    expect(kane.argv).toEqual([]);
    expect(plan).toEqual(previous);
  });

  it('walks tests/ for the newest document and ignores everything else', () => {
    const fs = inMemoryPlanFileSystem({
      'tests/a_test.md': { text: '', mtimeMs: 10 },
      'tests/nested/b_test.md': { text: '', mtimeMs: 40 },
      'tests/notes.md': { text: '', mtimeMs: 90 },
      'tests/node_modules/c_test.md': { text: '', mtimeMs: 99 },
    });
    expect(newestTestDocument(fs)).toEqual({ path: 'tests/nested/b_test.md', mtimeMs: 40 });
    expect(newestTestDocument(inMemoryPlanFileSystem({}))).toBeNull();
  });

  it('discards a cache that is not the shape this version writes', async () => {
    const fs = inMemoryPlanFileSystem({
      [PLAN_FILE_RELATIVE_PATH]: { text: '{"members":[{"path":"tests/a_test.md"}]}' },
    });
    const kane = stub({ lines: MIXED_LINES });
    await readPlan({ invoker: kane.invoker, cwd: REPO, fs, sink: kane.sink, now: () => NOW });
    expect(kane.sink.has(PLAN_DIAGNOSTIC_CODES.cacheMalformed)).toBe(true);
    expect(kane.argv).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

describe('a wire plan event becomes the settled cache shape', () => {
  it('keeps ids verbatim, blanks to null, and drops a member with no path', () => {
    const sink = createDiagnosticSink();
    const event: TestrunPlanEvent = {
      type: 'testrun_plan',
      valid: true,
      members: [
        { path: 'tests/cart_subtotal_test.md', test_id: 'T-3', tags: ['cart'], failure: null },
        { path: 'tests/cart_discount_test.md', test_id: '   ', tags: [], failure: 'missing_meta' },
        { test_id: 'T-9' },
      ],
    };
    const plan = normalisePlanEvent(event, { capturedAt: new Date(NOW).toISOString(), sink });

    expect(plan.members.map((member) => member.testId)).toEqual(['T-3', null]);
    expect(plan.members[1]?.failure).toBe('missing_meta');
    expect(sink.has(PLAN_DIAGNOSTIC_CODES.memberPathMissing)).toBe(true);
  });

  it('treats a missing `valid` as false rather than assuming the suite is runnable', () => {
    const plan = normalisePlanEvent({ type: 'testrun_plan' }, { capturedAt: 'x' });
    expect(plan.valid).toBe(false);
    expect(plan.members).toEqual([]);
  });

  it('round-trips through the cache bytes with members sorted by path', () => {
    const plan: TestrunPlan = {
      valid: true,
      capturedAt: new Date(NOW).toISOString(),
      members: [
        { path: 'tests/z_test.md', testId: 'T-9', tags: [], failure: null },
        { path: 'tests/a_test.md', testId: null, tags: ['cart'], failure: null },
      ],
    };
    const text = serialisePlan(plan);
    const parsed: unknown = JSON.parse(text);
    expect(isTestrunPlan(parsed)).toBe(true);
    expect((parsed as TestrunPlan).members.map((member) => member.path)).toEqual([
      'tests/a_test.md',
      'tests/z_test.md',
    ]);
    expect(serialisePlan(parsed as TestrunPlan)).toBe(text);
  });

  it('refuses a plan whose member carries a blank id, so absence has one form', () => {
    expect(
      isTestrunPlan({
        valid: true,
        capturedAt: new Date(NOW).toISOString(),
        members: [{ path: 'tests/a_test.md', testId: '', tags: [], failure: null }],
      }),
    ).toBe(false);
  });
});
