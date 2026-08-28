import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  COMMAND_FAMILIES,
  DEFAULT_VERDICT_ROUTER,
  REPAIR_BRANCHES,
  RESULT_CODE_FIELD,
  VERDICT_ROUTER_NAMES,
  createDiagnosticSink,
  createFailureContext,
  isRepairAnnotation,
  resolveEvidenceRef,
  selectRouter,
  type CommandFamily,
  type FailureContext,
  type RepairStrategy,
} from 'kept-core';

import { arbUnrecognisableVerdictObject, arbVerdictObject } from './arbitraries.js';
import {
  REPO_ROOT,
  TESTRUN_EVIDENCE_ROOT,
  buildEvidenceTree,
  testrunListing,
  type EvidenceTree,
} from './verdict-evidence-tree.js';

/**
 * Feature: kept, Property 17: The verdict router is total, deterministic and
 * strategy-isolated (design §Correctness Properties, §6.1, §6.4, R6.1, R6.2, R6.7,
 * R6.9, R6.10, R6.13, R6.14).
 *
 * *For any* failing terminal event of any family, the selected router returns
 * exactly one repair branch from `code-break`, `test-drift` and `docs-lie`, never
 * throws, returns the same branch on repeated calls with the same input, defaults
 * to `docs-lie` when no rule matches, and returns an evidence reference that either
 * points at an artefact that exists or is null; and running the whole pipeline with
 * each implementation selected produces snapshots that differ only in the repair
 * branch, strategy, severity, category, confidence and rationale fields.
 *
 * ## How the four clauses are encoded
 *
 * **Totality** is the reason the strategy interface can be depended on at all.
 * Every consumer — the handoff file, the review cards, the Ledger's repair rail —
 * assumes a branch exists. A router that returned `null` for an event shape nobody
 * anticipated would push that `null` into the snapshot, and the snapshot schema
 * would fail the Ledger build over a state of the world. So the generators reach
 * deliberately past the plausible: all three families (including the one that seals
 * no evidence pack at all), events with no code and no object, packs with no note,
 * notes that do not parse, and objects that are not objects.
 *
 * **Determinism** is asserted across repeated calls on one context, which is
 * sharper than it sounds: the triage rung reads a file, so a router without a
 * memoised load could answer differently on the second call if the disk moved
 * underneath it. The context factory's memoisation is what makes this hold, and
 * the read counter proves the second call did not repeat the read.
 *
 * **The evidence reference** clause is a negative — never a fabricated path
 * (R6.11) — so it is encoded as membership: a non-null reference must resolve to a
 * path the generated tree actually holds. A router that composed
 * `<pack>/failure.yaml` by hand would pass an existence check against a tree that
 * happens to hold one and fail this one against a tree that does not.
 *
 * **Strategy isolation** is R6.14 and is the whole justification for the interface.
 * The full pipeline does not exist yet (`kept verify` is task 11.11), so the clause
 * is encoded one level down, where it is stronger and cheaper: for the same failure
 * context, the two implementations' answers agree on every field *except* the six
 * the design permits to differ. Since a `RoutedRepair` is exactly the
 * `RepairAnnotation` the snapshot carries, "two annotations differing only in those
 * six fields" *is* "two snapshots differing only in those six fields" for the one
 * record a failure touches.
 *
 * **Validates: Requirements 6.1, 6.2, 6.7, 6.9, 6.10, 6.13, 6.14**
 */

const NUM_RUNS = 500;

/** The six fields design §Property 17 permits to differ between strategies. */
const MAY_DIFFER: readonly string[] = [
  'branch',
  'strategy',
  'severity',
  'category',
  'confidence',
  'rationale',
];

/** Therefore the one field that may not. */
const MUST_AGREE: readonly string[] = ['evidenceRef'];

const arbFamily: fc.Arbitrary<CommandFamily> = fc.constantFrom(...COMMAND_FAMILIES);

/** Notes covering every row of design §6.3, plus shapes a real file can take. */
const arbNote: fc.Arbitrary<string | null> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.constantFrom<string | null>(
      'triage:\n  category: product_bug\n  severity: high\n  confidence: 0.9\n',
      'category: selector_not_found\nseverity: medium\n',
      'classification: assertion\nresult_code: "742"\n',
      'reason: "console_error"\n',
      'category: gremlins\n',
    ),
  },
  {
    weight: 3,
    arbitrary: fc.constantFrom<string | null>(
      null,
      '',
      'a bare scalar note\n',
      '- one\n- two\n',
      'triage:\n  category: "unclosed\n',
      'triage: null\n',
    ),
  },
);

/** Whether a pack exists at all, and whether it holds a note. */
const arbPacks: fc.Arbitrary<{ readonly note: string | null; readonly withPack: boolean }> = fc
  .record({ note: arbNote, withPack: fc.boolean() });

const arbCodeWire: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 2, arbitrary: fc.constantFrom<unknown>(740, '740', ' 740') },
  { weight: 3, arbitrary: fc.integer({ min: -5, max: 900 }) },
  { weight: 2, arbitrary: fc.constantFrom<unknown>('715', '742', 500, 130, 2) },
  { weight: 2, arbitrary: fc.constantFrom<unknown>(undefined, null, '', 'n/a', {}, true, []) },
);

/** Either a recognisable object, something that is not one, or nothing at all. */
const arbVerdictSlot: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 4, arbitrary: arbVerdictObject },
  { weight: 2, arbitrary: arbUnrecognisableVerdictObject },
  { weight: 3, arbitrary: fc.constantFrom<unknown>(undefined, null, 'confirmed', 42) },
);

interface Built {
  readonly ctx: FailureContext;
  readonly tree: EvidenceTree;
}

function build(
  family: CommandFamily,
  codeWire: unknown,
  verdict: unknown,
  packs: { readonly note: string | null; readonly withPack: boolean },
): Built {
  const files: Record<string, string> = { 'annotated.png': 'x' };
  if (packs.note !== null) files['failure.yaml'] = packs.note;
  const tree = buildEvidenceTree(packs.withPack ? [{ id: 'ev_1', files }] : []);

  const terminal: Record<string, unknown> = { type: 'terminal' };
  if (verdict !== undefined) terminal['verdict'] = verdict;
  if (codeWire !== undefined) terminal[RESULT_CODE_FIELD] = codeWire;

  return {
    tree,
    ctx: createFailureContext({
      family,
      terminal,
      promiseId: 'p_000000000000',
      // Only `failed` and `broken` ever reach the router (design §6.5).
      memberStatus: family === 'ExecutionTestrun' ? 'failed' : null,
      evidence: family === 'ExecutionTestrun' ? testrunListing(tree) : null,
      repoRoot: REPO_ROOT,
      yaml: tree.yaml,
    }),
  };
}

/** Every path a reference is allowed to name, repository-relative. */
function permittedRefs(tree: EvidenceTree): readonly string[] {
  return [...tree.filePaths, ...tree.dirPaths]
    .filter((path) => path.startsWith(`${REPO_ROOT}/`))
    .map((path) => path.slice(REPO_ROOT.length + 1));
}

describe('Property 17: The verdict router is total, deterministic and strategy-isolated', () => {
  it('returns exactly one branch, for either strategy, for every generated failure', () => {
    fc.assert(
      fc.property(
        arbFamily,
        arbCodeWire,
        arbVerdictSlot,
        arbPacks,
        fc.constantFrom<RepairStrategy>(...VERDICT_ROUTER_NAMES),
        (family, codeWire, verdict, packs, strategy) => {
          const { ctx } = build(family, codeWire, verdict, packs);
          const routed = selectRouter({ verdictRouter: strategy }).route(ctx);
          expect(REPAIR_BRANCHES).toContain(routed.branch);
          expect(VERDICT_ROUTER_NAMES).toContain(routed.strategy);
          expect(isRepairAnnotation(routed)).toBe(true);
          expect(typeof routed.rationale).toBe('string');
          expect(routed.rationale.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('is deterministic: repeated calls on one context answer identically', () => {
    fc.assert(
      fc.property(
        arbFamily,
        arbCodeWire,
        arbVerdictSlot,
        arbPacks,
        fc.constantFrom<RepairStrategy>(...VERDICT_ROUTER_NAMES),
        (family, codeWire, verdict, packs, strategy) => {
          const { ctx, tree } = build(family, codeWire, verdict, packs);
          const router = selectRouter({ verdictRouter: strategy });
          const first = router.route(ctx);
          const second = router.route(ctx);
          expect(second).toEqual(first);
          // At most one read, however many times the note was consulted.
          expect(tree.reads()).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('names an artefact the tree actually holds, or nothing at all (R6.11)', () => {
    fc.assert(
      fc.property(
        arbFamily,
        arbCodeWire,
        arbVerdictSlot,
        arbPacks,
        fc.constantFrom<RepairStrategy>(...VERDICT_ROUTER_NAMES),
        (family, codeWire, verdict, packs, strategy) => {
          const { ctx, tree } = build(family, codeWire, verdict, packs);
          const routed = selectRouter({ verdictRouter: strategy }).route(ctx);
          if (routed.evidenceRef === null) return;
          expect(permittedRefs(tree)).toContain(routed.evidenceRef);
          // And never the directory that merely holds packs.
          expect(routed.evidenceRef).not.toBe(
            TESTRUN_EVIDENCE_ROOT.slice(REPO_ROOT.length + 1),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('defaults to docs-lie when no rule matches (R6.9)', () => {
    fc.assert(
      fc.property(
        arbFamily,
        fc.constantFrom<RepairStrategy>(...VERDICT_ROUTER_NAMES),
        fc.constantFrom<string | null>(null, '', 'category: gremlins\n', 'a bare note\n'),
        (family, strategy, note) => {
          // No verdict object, no code, and nothing in the note that is positive
          // evidence of either a product fault or a mechanics fault.
          const { ctx } = build(family, undefined, undefined, { note, withPack: true });
          expect(selectRouter({ verdictRouter: strategy }).route(ctx).branch).toBe('docs-lie');
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('lets the two strategies differ only in the six permitted fields (R6.14)', () => {
    fc.assert(
      fc.property(arbFamily, arbCodeWire, arbVerdictSlot, arbPacks, (family, codeWire, verdict, packs) => {
        const primary = selectRouter({ verdictRouter: 'resultCode740' }).route(
          build(family, codeWire, verdict, packs).ctx,
        );
        const fallback = selectRouter({ verdictRouter: 'failureYamlTriage' }).route(
          build(family, codeWire, verdict, packs).ctx,
        );

        const keys = Object.keys(primary).sort();
        expect(Object.keys(fallback).sort()).toEqual(keys);
        expect(keys).toEqual([...MAY_DIFFER, ...MUST_AGREE].sort());

        for (const field of MUST_AGREE) {
          expect(fallback[field as keyof typeof fallback]).toEqual(
            primary[field as keyof typeof primary],
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('resolves the same evidence reference whichever strategy asked (R6.14)', () => {
    fc.assert(
      fc.property(arbFamily, arbCodeWire, arbVerdictSlot, arbPacks, (family, codeWire, verdict, packs) => {
        const { ctx } = build(family, codeWire, verdict, packs);
        const reference = resolveEvidenceRef(ctx);
        for (const strategy of VERDICT_ROUTER_NAMES) {
          expect(selectRouter({ verdictRouter: strategy }).route(ctx).evidenceRef).toBe(reference);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is selected by one configuration value, and an unknown one never throws (R6.10)', () => {
    fc.assert(
      fc.property(fc.string(), (configured) => {
        const sink = createDiagnosticSink();
        const router = selectRouter({ verdictRouter: configured }, sink);
        expect(VERDICT_ROUTER_NAMES).toContain(router.name);
        if ((VERDICT_ROUTER_NAMES as readonly string[]).includes(configured)) {
          expect(router.name).toBe(configured);
          expect(sink.size).toBe(0);
        } else {
          expect(router.name).toBe(DEFAULT_VERDICT_ROUTER);
          expect(sink.size).toBe(1);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('ships the fallback working regardless of the spike (R6.7, R6.13)', () => {
    // The fallback must classify from the note alone, with no inline object and
    // no numeric code anywhere in the event.
    fc.assert(
      fc.property(
        fc.constantFrom(
          { note: 'triage:\n  category: product_bug\n', branch: 'code-break' },
          { note: 'category: selector_not_found\n', branch: 'test-drift' },
          { note: 'classification: assertion\nresult_code: "742"\n', branch: 'docs-lie' },
        ),
        ({ note, branch }) => {
          const { ctx } = build('ExecutionTestrun', undefined, undefined, {
            note,
            withPack: true,
          });
          expect(selectRouter({ verdictRouter: 'failureYamlTriage' }).route(ctx).branch).toBe(branch);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
