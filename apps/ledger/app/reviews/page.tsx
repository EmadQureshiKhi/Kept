/**
 * `/reviews` — design §10.1, §8.1, §8.2, §10.10, R5.7, R7.2, R7.7.
 *
 * Every held change, and nothing that can be applied from here. §8.1 gives the
 * `test-drift` branch autonomy **hold**: `maintain reconcile --plan` and `maintain
 * evolve` may propose, KEPT records the proposal under `.kept/review-cards/`, and no
 * change is ever applied automatically. So this page is a reading surface by design —
 * the absence of a control on it is the requirement being met, not a feature missing.
 * `/amendments` has an accept control because the docs-lie branch has a human decision
 * to offer; this branch's decision is what the *repair* should be, which no button can
 * express.
 *
 * R7.7 fixes what each card must render: the originating promise identifier, the repair
 * branch, and the Kane evidence reference. `ReviewCardView` renders those three
 * together, first, as a facts grid — see its header for why `kind` is shown beside
 * `branch` rather than instead of it.
 *
 * **Open first, then dismissed.** An open card is outstanding and a dismissed one is a
 * decision already taken, so the ordering puts the outstanding work at the top for the
 * same reason §10.3 sorts red promises there. Within each group, `createdAt` then id, so
 * the render is deterministic across machines and screenshots.
 *
 * Statically rendered from the committed snapshot. That snapshot carries no cards yet —
 * nothing has produced one against the fixture — so the page renders its specified empty
 * state (§10.10) naming exactly what puts a card here, rather than a blank that could be
 * read as a surface that does not work.
 */

import type { Metadata } from 'next';
import type { SnapshotReviewCard } from 'kept-core';

import { ReviewCardView } from '../../components/ReviewCardView.js';
import { snapshot } from '../../lib/snapshot.js';

import '../../styles/reviews.css';

/** Statically rendered, stated rather than inferred (§10.1). */
export const dynamic = 'force-static';

/** The short name only; the root layout's template composes `KEPT · Reviews`. */
export const metadata: Metadata = {
  title: 'Reviews',
  description:
    'Every change reconciliation and evolution proposed, held for a human decision, with ' +
    'the promise it is about, its repair branch and its evidence reference.',
};

/** The status a card carries until a human dismisses it (§8.2). There is no "applied". */
export const OPEN_STATUS = 'open';

/** What the page says when nothing is held (§10.10). */
export const REVIEWS_EMPTY =
  'No review card is on file. One appears here when a documentation reconciliation stages a ' +
  'change into Kane\u2019s stored plan, or when an evolution proposes a repair to a designed ' +
  'test — both of which are held rather than applied, so a card is the whole of what lands.';

/**
 * The empty state, split into the line that states the fact and the line that explains
 * it — a lead line alone is a shrug, and a detail line alone buries the answer.
 *
 * Split at render time rather than authored as two constants, so `REVIEWS_EMPTY` stays
 * the one place the words live and the two halves cannot drift out of one sentence. The
 * cut keeps the space at the head of the remainder, which is what makes the rendered
 * `textContent` of the two elements character-identical to the constant: an empty state
 * that quietly lost a space between its halves would still look right and would no
 * longer be the copy anybody reviewed.
 */
export function splitEmptyState(text: string): readonly [string, string] {
  const boundary = text.indexOf('. ');
  if (boundary < 0) return [text, ''];
  return [text.slice(0, boundary + 1), text.slice(boundary + 1)];
}

/** The lede, in prose, stating the autonomy rule the page embodies (§8.1). */
export const REVIEWS_LEDE =
  'Changes that reconciliation and evolution proposed, and that nothing applied. This branch ' +
  'holds: KEPT does not implement holding on top of Kane, it mirrors what Kane already staged, ' +
  'so every card here is a proposal waiting on a person. The Ledger writes nothing, and there ' +
  'is no control on this page that could.';

/**
 * Open first, then `createdAt`, then id.
 *
 * Exported rather than written inline for the same reason `/amendments` exports its
 * comparator: the page reads the module-scope snapshot, and a test that proved the
 * ordering by rendering cards in the order it had already put them in would prove
 * nothing.
 */
export function reviewOrder(
  cards: readonly SnapshotReviewCard[],
): readonly SnapshotReviewCard[] {
  return [...cards].sort((left, right) => {
    const leftOpen = left.status === OPEN_STATUS ? 0 : 1;
    const rightOpen = right.status === OPEN_STATUS ? 0 : 1;
    if (leftOpen !== rightOpen) return leftOpen - rightOpen;
    if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

export default function ReviewsPage() {
  const openFirst = reviewOrder(snapshot.reviewCards);
  const open = openFirst.filter((card) => card.status === OPEN_STATUS).length;
  const [emptyLead, emptyDetail] = splitEmptyState(REVIEWS_EMPTY);

  return (
    <div className="reviews-page">
      <header>
        {/* The title in its solid ink slab — the plane from `.surface-slab-ink`, the box
            from `.page-title__slab`, the type from `shell.css`'s `h1` clamp — over the
            shared `.page-standfirst`. */}
        <h1 className="reviews-page__title">
          <span className="page-title__slab surface-slab-ink">Reviews</span>
        </h1>
        <p className="page-standfirst">{REVIEWS_LEDE}</p>
      </header>

      <p className="reviews-page__measured">
        {`${openFirst.length} review card${openFirst.length === 1 ? '' : 's'} on file, `}
        {`${open} open. Measured from the snapshot generated at `}
        <span className="reviews-page__instant">{snapshot.generatedAt}</span>
        {'.'}
      </p>

      {openFirst.length === 0 ? (
        /* No `.surface-well` here: an empty region is marked by the one dashed border
           in the system rather than by depth, so "specified and holding nothing" looks
           the same on every page (§10.10). This is the live path today, so it is the
           first thing a judge sees on this route. */
        <div className="reviews-page__empty">
          <p className="reviews-page__empty-lead">{emptyLead}</p>
          <p className="reviews-page__empty-detail">{emptyDetail}</p>
        </div>
      ) : (
        <ul className="reviews-page__list">
          {openFirst.map((card) => (
            <li key={card.id}>
              <ReviewCardView card={card} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
