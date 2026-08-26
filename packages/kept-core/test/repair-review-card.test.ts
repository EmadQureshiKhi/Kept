import { describe, expect, it } from 'vitest';

import {
  BRANCH_FENCES,
  REVIEW_CARDS_DIRECTORY_RELATIVE_PATH,
  REVIEW_CARD_BRANCH,
  REVIEW_CARD_BRANCHES,
  REVIEW_CARD_DIAGNOSTIC_CODES,
  buildReviewCard,
  createDiagnosticSink,
  inMemoryRepairFileSystem,
  isKeptWritePath,
  isReviewCard,
  keptWritePath,
  listReviewCards,
  parseReviewCard,
  promiseId,
  reviewCardFromStagedItem,
  reviewCardPath,
  reviewCardsDirectory,
  reviewCardsFromStagedItems,
  serialiseReviewCard,
  testDriftReviewCard,
  toSnapshotReviewCard,
  writeReviewCard,
  type ReviewCard,
  type ReviewCardContext,
} from '../src/index.js';
import { SnapshotReviewCardSchema } from '../src/model/snapshot.js';

/**
 * Review cards — task 14.1 (design §8.1, §8.2, R5.7, R7.7).
 *
 * The unit half of the held-change discipline. Property 20 asserts the invariant
 * over generated outcomes; these assert the specific shapes: that a mirrored card
 * satisfies the strict snapshot schema, that the fence table and the card agree,
 * that re-mirroring is idempotent, and that the `.kept/` fence refuses the paths a
 * caller might plausibly compose.
 */

const REPO_ROOT = '/repo';
const PROMISE = promiseId('apps/fixture/README.md', '- The Cart screen shows a running subtotal.');

function contextFor(overrides: Partial<ReviewCardContext> = {}): ReviewCardContext {
  return {
    promiseId: PROMISE,
    createdAt: '2026-08-20T18:41:02.118Z',
    strategy: 'resultCode740',
    evidenceRef: 'evidence/ev_20260820T184011Z/failure.yaml',
    ...overrides,
  };
}

describe('the card is the snapshot’s own review-card shape', () => {
  it('parses under the strict snapshot schema, field for field', () => {
    const draft = buildReviewCard({
      kind: 'test-drift',
      title: 'cart_subtotal_test.md step 3 selector no longer resolves',
      detail: 'The step targeted [data-testid="subtotal"], which the page no longer renders.',
      proposedChanges: [
        {
          file: 'tests/cart_subtotal_test.md',
          summary: 'retarget step 3 at the running-total row',
          diff: '-  assert [data-testid="subtotal"]\n+  assert [data-testid="cart-total"]',
        },
      ],
      context: contextFor(),
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    // A strict object: an extra field or a missing one fails here, which is what
    // makes the projection an identity function rather than a translation.
    const parsed = SnapshotReviewCardSchema.parse(toSnapshotReviewCard(draft.card));
    expect(parsed.id).toBe(draft.card.id);
    expect(Object.keys(JSON.parse(serialiseReviewCard(draft.card)) as object).sort()).toEqual(
      Object.keys(parsed).sort(),
    );
  });

  it('round-trips through its canonical bytes', () => {
    const draft = buildReviewCard({
      kind: 'reconcile',
      title: 'a held change',
      context: contextFor(),
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const text = serialiseReviewCard(draft.card);
    expect(text.endsWith('}\n')).toBe(true);
    const read = parseReviewCard(text, { file: 'a.json' });
    expect(read).toEqual(draft.card);
    expect(isReviewCard(read)).toBe(true);
  });
});

describe('the branch is read off the fence table, never passed in', () => {
  it('names exactly the branches §8.1 pairs with the review-card artefact', () => {
    expect(REVIEW_CARD_BRANCHES).toEqual(['test-drift']);
    expect(REVIEW_CARD_BRANCH).toBe('test-drift');
  });

  it('gives every card a branch whose autonomy is hold and artefact a review card', () => {
    for (const kind of ['reconcile', 'test-drift'] as const) {
      const draft = buildReviewCard({ kind, title: 't', context: contextFor() });
      expect(draft.ok).toBe(true);
      if (!draft.ok) continue;
      const fence = BRANCH_FENCES[draft.card.branch];
      expect(fence.autonomy).toBe('hold');
      expect(fence.artefact).toBe('review-card');
      // Nothing writable on the allowed side: §8.1's held branches fence everything,
      // which is `grantsAllow: false` now that the globs live in the config (§20.1).
      expect(fence.grantsAllow).toBe(false);
      expect(draft.card.status).toBe('open');
    }
  });
});

describe('mirroring Kane’s staged plan items', () => {
  it('reads Kane’s own field spellings rather than insisting on ours', () => {
    const draft = reviewCardFromStagedItem(
      {
        type: 'review_card',
        one_liner: 'the shop filter use case gained a step',
        description: 'reconcile staged an added step after the README claim moved',
        changes: [
          { path: 'tests/shop_filter_test.md', reason: 'add the new step', patch: '+ step 4' },
        ],
      },
      contextFor(),
    );
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.card.kind).toBe('reconcile');
    expect(draft.card.title).toBe('the shop filter use case gained a step');
    expect(draft.card.proposedChanges).toEqual([
      { file: 'tests/shop_filter_test.md', summary: 'add the new step', diff: '+ step 4' },
    ]);
  });

  it('prefers a promise id Kane echoed back over the caller’s', () => {
    const echoed = promiseId('apps/fixture/README.md', '- Checkout is disabled while empty.');
    const draft = reviewCardFromStagedItem(
      { type: 'review_card', title: 't', promise_id: echoed },
      contextFor(),
    );
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.card.promiseId).toBe(echoed);
  });

  it('creates no card for an item it cannot attribute, and says so', () => {
    const sink = createDiagnosticSink();
    const draft = reviewCardFromStagedItem(
      { type: 'review_card', title: 't' },
      contextFor({ promiseId: 'not-a-promise-id', diagnostics: sink }),
    );
    expect(draft.ok).toBe(false);
    expect(sink.entries.map((entry) => entry.code)).toContain(
      REVIEW_CARD_DIAGNOSTIC_CODES.unattributed,
    );
  });

  it('drops a proposed change whose path is not repository-relative', () => {
    const sink = createDiagnosticSink();
    const draft = buildReviewCard({
      kind: 'reconcile',
      title: 't',
      proposedChanges: [
        { file: '/etc/passwd', summary: 's', diff: '' },
        { file: '../outside/thing.md', summary: 's', diff: '' },
        { file: 'tests/ok_test.md', summary: 's', diff: '' },
      ],
      context: contextFor({ diagnostics: sink }),
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.card.proposedChanges.map((change) => change.file)).toEqual(['tests/ok_test.md']);
    expect(
      sink.entries.filter((entry) => entry.code === REVIEW_CARD_DIAGNOSTIC_CODES.changeDropped),
    ).toHaveLength(2);
  });

  it('mirrors the same staged items to the same single card, twice over', () => {
    const staged = [
      { type: 'review_card', title: 'one', changes: [{ file: 'tests/a_test.md', diff: 'x' }] },
      { type: 'review_card', title: 'one', changes: [{ file: 'tests/a_test.md', diff: 'x' }] },
    ];
    const first = reviewCardsFromStagedItems(staged, contextFor());
    const second = reviewCardsFromStagedItems(staged, contextFor());
    expect(first.cards).toHaveLength(1);
    expect(first.unattributed).toBe(0);
    expect(second.cards[0]?.id).toBe(first.cards[0]?.id);
  });

  it('counts the items it could not attribute rather than losing them silently', () => {
    const result = reviewCardsFromStagedItems(
      [{ type: 'review_card', title: 'a' }, { type: 'review_card', title: 'b' }],
      contextFor({ promiseId: 'p_nope' }),
    );
    expect(result.cards).toEqual([]);
    expect(result.unattributed).toBe(2);
  });

  it('builds a test-drift card from failure context alone, with no proposed change', () => {
    const draft = testDriftReviewCard({
      title: 'maintain evolve does not accept --mode agent on this build',
      detail: 'The flag probe failed, so the card carries the failure context only.',
      context: contextFor(),
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.card.kind).toBe('test-drift');
    expect(draft.card.proposedChanges).toEqual([]);
    expect(draft.card.status).toBe('open');
  });
});

describe('the .kept/ fence', () => {
  it('admits a card path and refuses everything else', () => {
    expect(keptWritePath(REPO_ROOT, `${REPO_ROOT}/.kept/review-cards/rc_1.json`)).not.toBeNull();
    for (const outside of [
      `${REPO_ROOT}/apps/fixture/README.md`,
      `${REPO_ROOT}/.keptx/review-cards/rc_1.json`,
      `${REPO_ROOT}/.kept/../apps/fixture/README.md`,
      `${REPO_ROOT}/.kept`,
      '/elsewhere/.kept/review-cards/rc_1.json',
    ]) {
      expect(isKeptWritePath(REPO_ROOT, outside), outside).toBe(false);
    }
  });

  it('refuses to write a card whose destination escaped the fence', () => {
    const sink = createDiagnosticSink();
    const fileSystem = inMemoryRepairFileSystem();
    const card: ReviewCard = {
      // An id carrying a separator and a traversal did not come from `reviewCardId`,
      // and a path composed from one is refused before anything is opened.
      id: 'rc_../../apps/fixture/README.md',
      createdAt: '2026-08-20T18:41:02.118Z',
      kind: 'reconcile',
      promiseId: PROMISE,
      branch: 'test-drift',
      title: 't',
      detail: '',
      proposedChanges: [],
      evidenceRef: null,
      strategy: 'resultCode740',
      status: 'open',
    };
    const result = writeReviewCard({ repoRoot: REPO_ROOT, card, fileSystem, diagnostics: sink });
    expect(result.wrote).toBe(false);
    expect(fileSystem.files.size).toBe(0);
    expect(sink.entries.map((entry) => entry.code)).toContain(
      REVIEW_CARD_DIAGNOSTIC_CODES.writeRefused,
    );
  });
});

describe('persistence', () => {
  it('writes one file, under .kept/review-cards, and nothing else', () => {
    const fileSystem = inMemoryRepairFileSystem({
      [`${REPO_ROOT}/apps/fixture/README.md`]: '- a claim\n',
    });
    const before = new Map(fileSystem.files);
    const draft = buildReviewCard({ kind: 'reconcile', title: 't', context: contextFor() });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    const result = writeReviewCard({ repoRoot: REPO_ROOT, card: draft.card, fileSystem });
    expect(result.wrote).toBe(true);
    expect(result.path).toBe(reviewCardPath(REPO_ROOT, draft.card.id));
    expect(result.path.startsWith(`${REPO_ROOT}/${REVIEW_CARDS_DIRECTORY_RELATIVE_PATH}/`)).toBe(
      true,
    );

    const written = [...fileSystem.files.keys()].filter((path) => !before.has(path));
    expect(written).toEqual([result.path]);
    // The README is byte-identical: a card records, it never applies.
    expect(fileSystem.files.get(`${REPO_ROOT}/apps/fixture/README.md`)).toBe('- a claim\n');
  });

  it('leaves an existing card exactly as it was, dismissal included', () => {
    const draft = buildReviewCard({ kind: 'reconcile', title: 't', context: contextFor() });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const dismissed: ReviewCard = { ...draft.card, status: 'dismissed' };
    const fileSystem = inMemoryRepairFileSystem({
      [reviewCardPath(REPO_ROOT, draft.card.id)]: serialiseReviewCard(dismissed),
    });
    const sink = createDiagnosticSink();

    const result = writeReviewCard({
      repoRoot: REPO_ROOT,
      card: draft.card,
      fileSystem,
      diagnostics: sink,
    });
    expect(result.wrote).toBe(false);
    expect(result.existed).toBe(true);
    expect(result.card.status).toBe('dismissed');
    expect(sink.entries.map((entry) => entry.code)).toContain(REVIEW_CARD_DIAGNOSTIC_CODES.exists);
  });

  it('lists the store sorted by id and skips a malformed file', () => {
    const drafts = [
      buildReviewCard({ kind: 'reconcile', title: 'a', context: contextFor() }),
      buildReviewCard({
        kind: 'test-drift',
        title: 'b',
        proposedChanges: [{ file: 'tests/b_test.md', summary: 's', diff: 'd' }],
        context: contextFor(),
      }),
    ];
    const seed: Record<string, string> = {
      [`${reviewCardsDirectory(REPO_ROOT)}/rc_broken.json`]: '{ not json',
    };
    for (const draft of drafts) {
      if (draft.ok) seed[reviewCardPath(REPO_ROOT, draft.card.id)] = serialiseReviewCard(draft.card);
    }
    const fileSystem = inMemoryRepairFileSystem(seed);
    const sink = createDiagnosticSink();

    const listed = listReviewCards(REPO_ROOT, {
      fileSystem,
      readDirectory: fileSystem.readDirectory,
      diagnostics: sink,
    });
    expect(listed).toHaveLength(2);
    expect([...listed].map((card) => card.id)).toEqual(
      [...listed].map((card) => card.id).sort(),
    );
    expect(sink.entries.map((entry) => entry.code)).toContain(
      REVIEW_CARD_DIAGNOSTIC_CODES.malformed,
    );
  });
});
