import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  PLAN_FILE_RELATIVE_PATH,
  PLAN_MAX_AGE_MS,
  RADIUS_DIAGNOSTIC_CODES,
  collectTestCoverage,
  computeBlastRadius,
  createDiagnosticSink,
  createPromiseGraph,
  createPromiseRecord,
  inMemoryPlanFileSystem,
  readPlan,
  serialisePlan,
  shouldInvokeKane,
  type BlastRadius,
  type ChildProcessLike,
  type PromiseRecord,
  type TestrunPlan,
  KaneInvoker,
} from 'kept-core';

/**
 * Feature: kept, Property 16: Blast-radius identifiers come only from the plan
 * (design §Correctness Properties, §7.1, §7.2, §7.3, R4.3, R4.4, R4.5).
 *
 * *For any* plan and *for any* set of changed paths, every test identifier handed
 * to Kane is a member identifier present in that plan, no identifier is
 * synthesised from a file path, every plan member lacking a `test_id` is excluded
 * and diagnosed, and a radius containing zero identifiers results in zero Kane
 * invocations plus one diagnostic per uncovered changed path.
 *
 * **Validates: Requirements 4.3, 4.4, 4.5**
 *
 * ## What makes this a provenance property rather than three examples
 *
 * Every draw is **adversarial about provenance**. Each generated `*_test.md`
 * carries a frontmatter `test_id`, a filename, a position in the corpus and a
 * promise whose `designedTest.testId` is set — four plausible sources of an
 * identifier, and every one of them is a decoy drawn from a vocabulary that is
 * *disjoint* from the plan's. The plan's ids live in their own namespace, so the
 * assertion "no returned id is any decoy" is mechanical rather than a judgement:
 * an implementation that started inferring an id from a filename, from
 * frontmatter, from a path or from an ordinal would return a `T-…`, a `D-…` or a
 * bare number, and the property fails on the first draw that exercises it.
 *
 * The plan itself is obtained the way §7.2 obtains it — through `readPlan`, over a
 * generated `--dry-run` stream, with a stub spawn — so the R4.4 clause is
 * exercised end to end, including the draws where the stream is truncated before
 * `testrun_done` and the ids of record therefore come from the previous cache.
 *
 * Zero Kane processes are started anywhere in this file: `spawn` and
 * `resolveBinary` are both injected, and every invocation is counted so the R4.5
 * clause ("zero Kane invocations") is asserted rather than assumed.
 */

const NUM_RUNS = 500;

const REPO = '/repo';
const NOW = Date.parse('2026-08-20T18:00:00.000Z');

// ---------------------------------------------------------------------------
// Vocabularies: the plan's namespace, and four decoy namespaces disjoint from it
// ---------------------------------------------------------------------------

/** The only shape a legitimate identifier has in this suite. */
function planIdFor(slug: string): string {
  return `PLAN-${slug.toUpperCase()}`;
}

/** What a filename-inferring implementation would produce. */
function filenameDecoys(slug: string, path: string, index: number): readonly string[] {
  return [
    `T-${index + 1}`,
    `${index + 1}`,
    slug,
    `${slug}_test`,
    `${slug}_test.md`,
    path,
    `tests/${slug}_test.md`,
  ];
}

/** What a frontmatter-trusting implementation would produce. */
function frontmatterDecoy(index: number): string {
  return `T-${index + 1}`;
}

/** What a `designedTest.testId`-trusting implementation would produce. */
function designedDecoy(slug: string): string {
  return `D-${slug.toUpperCase()}`;
}

const SLUGS = [
  'cart_subtotal',
  'home_cta',
  'shop_filter',
  'checkout_validation',
  'orders_persist',
] as const;

/** Source files the generated `covers:` globs are drawn over. */
const SOURCE_FILES = [
  'apps/fixture/lib/cart.ts',
  'apps/fixture/lib/currency.ts',
  'apps/fixture/lib/orders.ts',
  'apps/fixture/app/cart/page.tsx',
  'apps/fixture/app/checkout/page.tsx',
  'apps/fixture/app/page.tsx',
  'apps/fixture/app/settings/page.tsx',
  'apps/fixture/README.md',
  'packages/kept-core/src/state.ts',
] as const;

/** Globs an author would write, including the two forms the corpus uses. */
const GLOBS = [
  'apps/fixture/lib/cart.ts',
  'apps/fixture/lib/*.ts',
  'apps/fixture/app/cart/**',
  'apps/fixture/app/**',
  'apps/fixture/**',
  '**/orders.ts',
  'apps/ledger/**',
] as const;

/** How a generated document appears in the plan, if at all. */
type MemberState = 'with-id' | 'without-id' | 'absent';

interface GeneratedDocument {
  readonly slug: string;
  readonly index: number;
  /** Repository-relative path of the `*_test.md`. */
  readonly path: string;
  readonly covers: readonly string[];
  /** The frontmatter this document actually carries, decoy id included. */
  readonly text: string;
  readonly memberState: MemberState;
}

/** What one document's shape is drawn from. The slug and index come from position. */
interface DocumentSeed {
  readonly covers: readonly string[];
  readonly memberState: MemberState;
  readonly inlineList: boolean;
  readonly tags: readonly string[];
}

const arbDocumentSeed: fc.Arbitrary<DocumentSeed> = fc.record({
  covers: fc.uniqueArray(fc.constantFrom(...GLOBS), { minLength: 0, maxLength: 3 }),
  memberState: fc.constantFrom<MemberState>('with-id', 'with-id', 'without-id', 'absent'),
  inlineList: fc.boolean(),
  tags: fc.uniqueArray(fc.constantFrom('cart', 'smoke', 'currency'), { maxLength: 2 }),
});

/** Both `covers:` forms the frontmatter reader supports are generated. */
function buildDocument(slug: string, index: number, seed: DocumentSeed): GeneratedDocument {
  const path = `tests/${slug}_test.md`;
  const coversBlock =
    seed.covers.length === 0
      ? ''
      : seed.inlineList
        ? `covers: [${seed.covers.join(', ')}]\n`
        : `covers:\n${seed.covers.map((glob) => `  - ${glob}\n`).join('')}`;
  const text =
    `---\n` +
    // The decoy that matters most: the document names an id, in the very field the
    // baseline frontmatter reader surfaces and this chain deliberately discards.
    `test_id: ${frontmatterDecoy(index)}\n` +
    `tags: [${seed.tags.join(', ')}]\n` +
    coversBlock +
    `---\n\n` +
    `# ${slug}\n\n<!-- @verifies apps/fixture/README.md:16 -->\n`;
  return { slug, index, path, covers: seed.covers, text, memberState: seed.memberState };
}

/** A whole draw: a corpus, a plan over it, a changed set, and a stream shape. */
interface Scenario {
  readonly documents: readonly GeneratedDocument[];
  readonly changed: readonly string[];
  /**
   * What the `--dry-run` refresh looks like on the wire.
   *
   * - `complete` — a `testrun_plan` and a `testrun_done`, exit 0.
   * - `dry-run` — a `testrun_plan` and **no** `testrun_done`, exit 0. This is what
   *   `kane-cli` 0.8.4 actually emits: a dry run plans and validates, executes
   *   nothing, and so reports no execution done (15.3). The plan is accepted.
   * - `crashed` — a truncated stream that also exited badly. Nothing is accepted,
   *   and the cache, or `null`, is what a caller gets.
   */
  readonly refresh: 'complete' | 'dry-run' | 'crashed';
  /** Whether a previous plan is already cached. */
  readonly cachePresent: boolean;
  /** Kane's own preflight verdict on the suite. */
  readonly valid: boolean;
  /** Members in the plan that no generated document corresponds to. */
  readonly extraMembers: readonly string[];
}

const arbScenario: fc.Arbitrary<Scenario> = fc
  .record({
    seeds: fc.array(arbDocumentSeed, { minLength: 1, maxLength: SLUGS.length }),
    changed: fc.array(
      fc.oneof(
        fc.constantFrom(...SOURCE_FILES),
        // Paths a hook can legitimately hand over: absolute, dot-prefixed, blank.
        fc.constantFrom(...SOURCE_FILES).map((file) => `${REPO}/${file}`),
        fc.constantFrom(...SOURCE_FILES).map((file) => `./${file}`),
        fc.constantFrom('', '   ', 'apps/fixture/lib/absent.ts'),
      ),
      { maxLength: 5 },
    ),
    refresh: fc.constantFrom('complete' as const, 'dry-run' as const, 'crashed' as const),
    cachePresent: fc.boolean(),
    valid: fc.boolean(),
    extraMembers: fc.uniqueArray(fc.constantFrom('tests/settings_currency_test.md', 'tests/product_currency_test.md'), {
      maxLength: 2,
    }),
  })
  .map(
    (seed): Scenario => ({
      documents: seed.seeds.map((document, index) =>
        buildDocument(SLUGS[index] ?? `extra_${index}`, index, document),
      ),
      changed: seed.changed,
      refresh: seed.refresh,
      cachePresent: seed.cachePresent,
      valid: seed.valid,
      extraMembers: seed.extraMembers,
    }),
  );

// ---------------------------------------------------------------------------
// The world one scenario describes
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
    queueMicrotask(() => this.close(null));
    return true;
  }
  close(code: number | null): void {
    for (const listener of this.listeners.get('close') ?? []) listener(code, null);
  }
  asChild(): ChildProcessLike {
    return this as unknown as ChildProcessLike;
  }
}

/** The `--dry-run` stream a scenario would produce, terminal event included or not. */
function streamLines(scenario: Scenario): readonly string[] {
  const members = [
    ...scenario.documents
      .filter((document) => document.memberState !== 'absent')
      .map((document) => ({
        path: document.path,
        test_id: document.memberState === 'with-id' ? planIdFor(document.slug) : null,
        tags: [],
        failure: document.memberState === 'without-id' ? 'not_authored' : null,
      })),
    ...scenario.extraMembers.map((path) => ({
      path,
      test_id: planIdFor(path.replace(/^tests\/|_test\.md$/g, '')),
      tags: [],
      failure: null,
    })),
  ];
  const lines = [
    'kane-cli 0.8.4 — enumerating suite',
    JSON.stringify({ type: 'testrun_plan', valid: scenario.valid, members }),
  ];
  if (scenario.refresh !== 'complete') return lines;
  return [...lines, JSON.stringify({ type: 'testrun_done', status: 'complete', exit_code: 0 })];
}

/** A plan already on disk, in the same namespace, so a cache hit is still legal. */
function cachedPlan(scenario: Scenario): TestrunPlan {
  return {
    valid: true,
    // Deliberately older than the window, so a refresh is always attempted.
    capturedAt: new Date(NOW - PLAN_MAX_AGE_MS * 3).toISOString(),
    members: scenario.documents.map((document) => ({
      path: document.path,
      testId: planIdFor(`cached-${document.slug}`),
      tags: [],
      failure: null,
    })),
  };
}

/** Promises designed by each document, each carrying a decoy `designedTest.testId`. */
function promisesFor(scenario: Scenario): readonly PromiseRecord[] {
  return scenario.documents.map((document) =>
    createPromiseRecord({
      claim: `${document.slug} claim`,
      citation: { file: 'apps/fixture/README.md', line: 16, text: `${document.slug} claim` },
      designedTest: { path: document.path, testId: designedDecoy(document.slug) },
      providers: ['baseline'],
    }),
  );
}

interface Outcome {
  readonly radius: BlastRadius;
  readonly planOfRecord: TestrunPlan | null;
  /** Every argv Kane was actually spawned with, in order. */
  readonly invocations: readonly string[][];
  readonly scenario: Scenario;
}

/**
 * Run the whole §7 chain for one scenario: refresh the plan through a stub Kane,
 * read the `covers:` globs from the generated documents, compute the radius, and
 * then invoke Kane again **only if** {@link shouldInvokeKane} says so — which is
 * how the "zero Kane invocations" clause of R4.5 is measured rather than assumed.
 */
async function run(scenario: Scenario): Promise<Outcome> {
  const invocations: string[][] = [];
  const sink = createDiagnosticSink();
  const invoker = new KaneInvoker({
    sink,
    resolveBinary: () => '/stub/bin/kane-cli',
    spawn: (_command, args) => {
      invocations.push([...args]);
      const child = new FakeChild();
      const refresh = invocations.length === 1;
      const lines = refresh ? streamLines(scenario) : [];
      queueMicrotask(() => {
        for (const line of lines) child.stdout.emit(`${line}\n`);
        // A crashed refresh is a truncated stream that *also* exited badly. Exit 0
        // with a plan and no terminal event is a completed dry run, and accepting
        // it is the corrected rule of §7.2 (15.3).
        child.close(refresh && scenario.refresh === 'crashed' ? 1 : 0);
      });
      return child.asChild();
    },
  });

  const files: Record<string, { text: string; mtimeMs?: number }> = {};
  for (const document of scenario.documents) {
    files[document.path] = { text: document.text, mtimeMs: NOW - 1_000 };
  }
  if (scenario.cachePresent) {
    files[PLAN_FILE_RELATIVE_PATH] = {
      text: serialisePlan(cachedPlan(scenario)),
      mtimeMs: NOW - PLAN_MAX_AGE_MS * 3,
    };
  }
  const fs = inMemoryPlanFileSystem(files);

  const planOfRecord = await readPlan({
    invoker,
    cwd: REPO,
    // `corpus.root`, required rather than guessed since §20.1 moved it into the
    // config: the mtime walk has to be told where this repository's corpus is.
    corpusRoot: 'tests',
    fs,
    sink,
    now: () => NOW,
  });

  const covers = collectTestCoverage({
    source: fs,
    paths: scenario.documents.map((document) => document.path),
    sink,
  });

  const radius = computeBlastRadius({
    changed: scenario.changed,
    graph: createPromiseGraph({ promises: promisesFor(scenario) }),
    plan: planOfRecord,
    covers,
    repoRoot: REPO,
    sink,
  });

  // The gate, exercised: a caller starts a verification process only when the
  // radius is non-empty. Nothing else in this function invokes Kane.
  if (shouldInvokeKane(radius)) {
    await invoker.invoke({
      family: 'ExecutionTestrun',
      argv: ['testrun', 'run', '--from-context', radius.testIds.join(','), '--on-failure', 'continue'],
      cwd: REPO,
      timeoutMs: 300_000,
    });
  }

  return { radius, planOfRecord, invocations, scenario };
}

/** Every identifier the plan of record legitimately offers. */
function legitimateIds(plan: TestrunPlan | null): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const member of plan?.members ?? []) if (member.testId !== null) ids.add(member.testId);
  return ids;
}

/** Every identifier a path-, frontmatter-, ordinal- or promise-inferring reader would mint. */
function decoyIds(scenario: Scenario): ReadonlySet<string> {
  const decoys = new Set<string>();
  for (const document of scenario.documents) {
    for (const decoy of filenameDecoys(document.slug, document.path, document.index)) {
      decoys.add(decoy);
    }
    decoys.add(frontmatterDecoy(document.index));
    decoys.add(designedDecoy(document.slug));
  }
  return decoys;
}

function countOf(radius: BlastRadius, code: string): number {
  return radius.diagnostics.filter((diagnostic) => diagnostic.code === code).length;
}

// ---------------------------------------------------------------------------
// Property 16
// ---------------------------------------------------------------------------

describe('Property 16: Blast-radius identifiers come only from the plan', () => {
  it('the generator reaches every branch the property quantifies over', async () => {
    // A provenance property is worthless if every draw happens to select nothing:
    // the "no decoy was returned" clause would hold vacuously. So the generator is
    // checked for reach, the way the source scans check they are not no-ops.
    const outcomes = await Promise.all(fc.sample(arbScenario, 80).map((scenario) => run(scenario)));
    expect(outcomes.some((outcome) => outcome.radius.testIds.length > 0)).toBe(true);
    expect(outcomes.some((outcome) => outcome.radius.testIds.length === 0)).toBe(true);
    expect(outcomes.some((outcome) => outcome.radius.skippedNoTestId.length > 0)).toBe(true);
    expect(outcomes.some((outcome) => outcome.radius.unmatchedPaths.length > 0)).toBe(true);
    expect(outcomes.some((outcome) => outcome.planOfRecord === null)).toBe(true);
    expect(
      outcomes.some((outcome) =>
        outcome.radius.diagnostics.some(
          (diagnostic) => diagnostic.code === RADIUS_DIAGNOSTIC_CODES.testAbsentFromPlan,
        ),
      ),
    ).toBe(true);
  });

  it('returns only identifiers present in the plan of record', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario, async (scenario) => {
        const { radius, planOfRecord } = await run(scenario);
        const legitimate = legitimateIds(planOfRecord);
        for (const id of radius.testIds) expect(legitimate.has(id)).toBe(true);
        // And the plan of record is Kane's: either the stream's, or the cache's.
        expect(radius.testIds.length).toBeLessThanOrEqual(legitimate.size);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('synthesises no identifier from a filename, a path, frontmatter or a position', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario, async (scenario) => {
        const { radius } = await run(scenario);
        const decoys = decoyIds(scenario);
        for (const id of radius.testIds) {
          expect(
            decoys.has(id),
            `identifier ${id} was inferred from a document rather than read from the plan`,
          ).toBe(false);
          expect(id.startsWith('PLAN-')).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('excludes and diagnoses every covering member that carries no test_id', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario, async (scenario) => {
        const { radius, planOfRecord } = await run(scenario);
        const withoutId = new Set(
          (planOfRecord?.members ?? [])
            .filter((member) => member.testId === null)
            .map((member) => member.path),
        );

        const expected = radius.coveringTests.filter((path) => withoutId.has(path));
        expect([...radius.skippedNoTestId].sort()).toEqual([...expected].sort());
        // Excluded is not enough: each exclusion is named in a diagnostic.
        for (const path of radius.skippedNoTestId) {
          expect(
            radius.diagnostics.some(
              (diagnostic) =>
                diagnostic.code === RADIUS_DIAGNOSTIC_CODES.memberNoTestId &&
                diagnostic.file === path,
            ),
          ).toBe(true);
        }
        expect(countOf(radius, RADIUS_DIAGNOSTIC_CODES.memberNoTestId)).toBe(
          radius.skippedNoTestId.length,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('costs zero Kane invocations when empty, and diagnoses each uncovered path once', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario, async (scenario) => {
        const { radius, invocations } = await run(scenario);

        // One invocation is the plan refresh itself; a verification invocation is
        // the second, and it happens only for a non-empty radius.
        const verifications = invocations.slice(1);
        if (radius.testIds.length === 0) {
          expect(shouldInvokeKane(radius)).toBe(false);
          expect(verifications).toEqual([]);
          expect(countOf(radius, RADIUS_DIAGNOSTIC_CODES.empty)).toBe(1);
        } else {
          expect(verifications).toHaveLength(1);
          // Whatever is handed over is the radius, verbatim — no id is added here.
          expect(verifications[0]).toContain(radius.testIds.join(','));
        }

        // Exactly one "no designed test covers <path>" per uncovered path (R4.5).
        expect(countOf(radius, RADIUS_DIAGNOSTIC_CODES.pathUncovered)).toBe(
          radius.unmatchedPaths.length,
        );
        for (const path of radius.unmatchedPaths) {
          const named = radius.diagnostics.filter(
            (diagnostic) =>
              diagnostic.code === RADIUS_DIAGNOSTIC_CODES.pathUncovered && diagnostic.file === path,
          );
          expect(named).toHaveLength(1);
          expect(named[0]?.message).toBe(`no designed test covers ${path}`);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
