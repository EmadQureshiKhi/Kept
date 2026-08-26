import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ACCEPTED_ASSURANCE_STATUS,
  BRANCH_FENCES,
  KEPT_DIRECTORY_NAME,
  REVIEW_CARD_DIAGNOSTIC_CODES,
  createDiagnosticSink,
  inMemoryStateFileSystem,
  mirrorReconcileStagedChanges,
  normaliseAssuranceStatus,
  promiseId,
  testDriftReviewCard,
  writeReviewCard,
  type ReviewCard,
  type ReviewCardContext,
  type StateFileSystem,
} from '../src/index.js';

/**
 * **Property 20: Reconciliation and evolution only ever produce held review cards**
 *
 * **Validates: Requirements 5.5, 5.6, 5.7, 7.2, 7.7**
 *
 * Design §8.1 gives `test-drift` autonomy `hold` and §8.2 says every change
 * `maintain reconcile` or `maintain evolve` produces "lands here and is never
 * applied". Two things have to be true of that for it to mean anything, and both
 * are asserted here over generated outcomes rather than over one happy path.
 *
 * **No file outside `.kept/` is written.** This is the clause with teeth. The
 * filesystem below records *every* call — `writeFile` and `ensureDir` both, so a
 * directory created outside the fence is caught even if nothing was ever written
 * into it — and the assertion is over that log, not over what the code says it
 * intends. A reconciliation that edited a `*_test.md` to make a promise green
 * would be the same dishonesty as a system that edited its own documentation, and
 * this is the assertion that would catch it.
 *
 * **The artefact is a held card.** Every produced card carries a branch whose
 * fence says `autonomy: 'hold'` and `artefact: 'review-card'` — read off
 * `BRANCH_FENCES` rather than compared against a literal, so §8.1's table is the
 * single source of the claim — and a status in the two-value vocabulary of §8.2,
 * which has no "applied" in it at all.
 *
 * The outcome generator reaches crashed, paused and refused streams deliberately.
 * R5.3 and R5.4 both say that a reconciliation which did not reach an accepting
 * `done` creates **no** card, and "accepted" is derived here through the product's
 * own `normaliseAssuranceStatus` and `ACCEPTED_ASSURANCE_STATUS` rather than by a
 * second copy of that rule — a property that re-implements the thing it is
 * checking is a property that agrees with itself.
 */

const REPO_ROOT = '/repo';
const KEPT_PREFIX = `${REPO_ROOT}/${KEPT_DIRECTORY_NAME}/`;

/** Every write this filesystem was asked to perform, in order. */
interface RecordingFileSystem {
  readonly fileSystem: StateFileSystem;
  readonly writes: readonly string[];
  readonly directories: readonly string[];
  readonly files: Map<string, string>;
}

/**
 * A filesystem that records what it was asked to touch. Seeded with a fixture
 * README and a designed test so "nothing outside `.kept/` was written" is a claim
 * about files that actually exist and could have been clobbered.
 */
function recordingFileSystem(): RecordingFileSystem {
  const base = inMemoryStateFileSystem({
    [`${REPO_ROOT}/apps/fixture/README.md`]:
      '- The Cart screen shows a running subtotal.\n- A ten percent discount applies.\n',
    [`${REPO_ROOT}/tests/cart_subtotal_test.md`]: '# T-3\n',
  });
  const writes: string[] = [];
  const directories: string[] = [];
  return {
    files: base.files,
    writes,
    directories,
    fileSystem: {
      readFile: (path) => base.readFile(path),
      ensureDir: (path) => {
        directories.push(path);
        base.ensureDir(path);
      },
      writeFile: (path, contents) => {
        writes.push(path);
        base.writeFile(path, contents);
      },
    },
  };
}

/** How an Assurance run can end (§5.3.1, §14.1, R5.3, R5.4). */
type OutcomeKind = 'accepted' | 'refused' | 'paused' | 'error' | 'crashed';

const arbOutcome: fc.Arbitrary<{ kind: OutcomeKind; status: string | null }> = fc.oneof(
  { weight: 4, arbitrary: fc.constant({ kind: 'accepted' as const, status: 'complete' }) },
  {
    weight: 2,
    arbitrary: fc
      .constantFrom(' Complete ', 'COMPLETE')
      .map((status) => ({ kind: 'accepted' as const, status })),
  },
  { weight: 3, arbitrary: fc.constant({ kind: 'refused' as const, status: 'refused' }) },
  { weight: 3, arbitrary: fc.constant({ kind: 'paused' as const, status: 'paused' }) },
  {
    weight: 2,
    arbitrary: fc
      .constantFrom('error', 'failed', 'something-new-kane-invented', '')
      .map((status) => ({ kind: 'error' as const, status })),
  },
  // A crashed stream never reached its terminal event, so there is no status at all.
  { weight: 3, arbitrary: fc.constant({ kind: 'crashed' as const, status: null }) },
);

const CLAIM_POOL: readonly string[] = [
  '- The Cart screen shows a running subtotal.',
  '- The Cart screen applies a 10 percent discount automatically.',
  '- Checkout is disabled while the cart is empty.',
];

const arbPromiseId: fc.Arbitrary<string> = fc
  .constantFrom(...CLAIM_POOL)
  .map((claim) => promiseId('apps/fixture/README.md', claim));

/**
 * A staged `review_card` event, reaching the shapes a projection has to survive:
 * Kane's alternative field spellings, a bare path instead of a change record, an
 * absolute path that must be dropped, an item with no text at all, and an item
 * echoing its own promise id.
 */
const arbStagedItem: fc.Arbitrary<Record<string, unknown>> = fc.oneof(
  fc.record({
    type: fc.constant('review_card'),
    title: fc.constantFrom('step 3 selector drifted', 'a use case gained a step'),
    detail: fc.constantFrom('', 'the page no longer renders that node'),
    proposed_changes: fc.array(
      fc.record({
        file: fc.constantFrom('tests/cart_subtotal_test.md', 'tests/shop_filter_test.md'),
        summary: fc.constantFrom('', 'retarget the step'),
        diff: fc.constantFrom('', '-a\n+b'),
      }),
      { maxLength: 3 },
    ),
  }),
  fc.record({
    type: fc.constant('review_card'),
    one_liner: fc.constant('reconcile staged a change'),
    changes: fc.array(fc.constantFrom('tests/a_test.md', '/etc/passwd', '../escape.md'), {
      maxLength: 3,
    }),
  }),
  fc.record({
    type: fc.constant('review_card'),
    message: fc.constant('staged'),
    promise_id: arbPromiseId,
  }),
  // No recognisable text and no changes: still an item, and still must not apply.
  fc.constant<Record<string, unknown>>({ type: 'review_card' }),
);

function contextFor(
  promise: string,
  diagnostics: ReturnType<typeof createDiagnosticSink>,
): ReviewCardContext {
  return {
    promiseId: promise,
    createdAt: '2026-08-20T18:41:02.118Z',
    strategy: 'resultCode740',
    evidenceRef: 'evidence/ev_20260820T184011Z/failure.yaml',
    diagnostics,
  };
}

/** Assert the two invariants over one batch of produced cards. */
function assertHeld(cards: readonly ReviewCard[], recorder: RecordingFileSystem): void {
  for (const card of cards) {
    const fence = BRANCH_FENCES[card.branch];
    expect(fence.autonomy).toBe('hold');
    expect(fence.artefact).toBe('review-card');
    // The table carries no glob any more (§20.1): `grantsAllow` is the bit that
    // decides whether a row is handed the configured allow set, and a held branch
    // is never handed it.
    expect(fence.grantsAllow).toBe(false);
    expect(['open', 'dismissed']).toContain(card.status);
    expect(card.status).toBe('open');
  }
  for (const path of [...recorder.writes, ...recorder.directories]) {
    expect(path.startsWith(KEPT_PREFIX), `wrote outside .kept/: ${path}`).toBe(true);
  }
  // And the seeded files are byte-identical: nothing was applied to either.
  expect(recorder.files.get(`${REPO_ROOT}/apps/fixture/README.md`)).toBe(
    '- The Cart screen shows a running subtotal.\n- A ten percent discount applies.\n',
  );
  expect(recorder.files.get(`${REPO_ROOT}/tests/cart_subtotal_test.md`)).toBe('# T-3\n');
}

describe('Property 20: reconciliation and evolution only ever produce held review cards', () => {
  it('holds every reconciliation outcome, and writes nothing outside .kept/', () => {
    fc.assert(
      fc.property(
        arbOutcome,
        fc.array(arbStagedItem, { maxLength: 4 }),
        arbPromiseId,
        (outcome, staged, promise) => {
          const sink = createDiagnosticSink();
          const recorder = recordingFileSystem();

          // Derived through the product's own vocabulary, never re-implemented.
          const accepted =
            outcome.status !== null &&
            normaliseAssuranceStatus(outcome.status) === ACCEPTED_ASSURANCE_STATUS;

          const mirrored = mirrorReconcileStagedChanges({
            accepted,
            staged,
            outcome: outcome.kind,
            context: contextFor(promise, sink),
          });

          for (const card of mirrored.cards) {
            writeReviewCard({
              repoRoot: REPO_ROOT,
              card,
              fileSystem: recorder.fileSystem,
              diagnostics: sink,
            });
          }

          // R5.3 and R5.4: a stream that did not reach an accepting `done` yields
          // no card at all, so nothing at all is written.
          expect(mirrored.mirrored).toBe(accepted);
          if (!accepted) {
            expect(mirrored.cards).toEqual([]);
            expect(recorder.writes).toEqual([]);
            if (staged.length > 0) {
              expect(sink.entries.map((entry) => entry.code)).toContain(
                REVIEW_CARD_DIAGNOSTIC_CODES.outcomeUnproven,
              );
            }
          }

          assertHeld(mirrored.cards, recorder);

          // Every written path is a card in the card directory, and every card
          // that was produced landed. `outcome-unproven` is the only way to have
          // staged items and no cards.
          expect(recorder.writes).toHaveLength(mirrored.cards.length);
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('re-mirroring the same outcome accumulates no second card', () => {
    fc.assert(
      fc.property(fc.array(arbStagedItem, { maxLength: 4 }), arbPromiseId, (staged, promise) => {
        const sink = createDiagnosticSink();
        const recorder = recordingFileSystem();
        const context = contextFor(promise, sink);

        const write = (): number => {
          const mirrored = mirrorReconcileStagedChanges({ accepted: true, staged, context });
          let wrote = 0;
          for (const card of mirrored.cards) {
            const result = writeReviewCard({
              repoRoot: REPO_ROOT,
              card,
              fileSystem: recorder.fileSystem,
              diagnostics: sink,
            });
            if (result.wrote) wrote += 1;
          }
          return wrote;
        };

        const first = write();
        const second = write();
        expect(second).toBe(0);
        expect(recorder.writes).toHaveLength(first);
        assertHeld([], recorder);
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it('holds an evolve card built from failure context alone', () => {
    fc.assert(
      fc.property(
        arbPromiseId,
        fc.constantFrom(
          'maintain evolve does not accept --mode agent on this build',
          'the evolve stream never reached its done event',
          'evolve paused with exit three and is resumable',
        ),
        (promise, title) => {
          const sink = createDiagnosticSink();
          const recorder = recordingFileSystem();
          const draft = testDriftReviewCard({
            title,
            detail: 'No change was proposed, because none was produced.',
            context: contextFor(promise, sink),
          });
          expect(draft.ok).toBe(true);
          if (!draft.ok) return true;

          writeReviewCard({
            repoRoot: REPO_ROOT,
            card: draft.card,
            fileSystem: recorder.fileSystem,
            diagnostics: sink,
          });

          expect(draft.card.kind).toBe('test-drift');
          expect(draft.card.proposedChanges).toEqual([]);
          assertHeld([draft.card], recorder);
          expect(recorder.writes).toHaveLength(1);
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
});
