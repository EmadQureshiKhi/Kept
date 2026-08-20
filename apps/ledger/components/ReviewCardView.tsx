/**
 * `ReviewCardView` — design §8.1, §8.2, §10.5, §10.7, §10.9, R5.7, R7.2, R7.7.
 *
 * One held change. R7.7 is specific about what a review card must render — the
 * originating **promise identifier**, the **repair branch**, and the **Kane evidence
 * reference** — so those three are a facts grid rather than prose, in the same `dl`
 * grammar `PromisePanel` uses for a verdict source. They are the three things that make
 * a card traceable: which claim it is about, what class of repair it is, and what run
 * produced it.
 *
 * `kind` and `branch` are both shown, because they answer different questions and §8.2
 * carries both for that reason. `kind` is provenance — which command staged this,
 * `reconcile` or `test-drift` — and `branch` is the class of repair, which for both
 * commands is a held change to the designed-test corpus. A reviewer sorting `/reviews`
 * wants the first; a reviewer asking what autonomy this card has wants the second.
 *
 * **The status vocabulary has no "applied", and the card says so.** Every card is `open`
 * or `dismissed` (§8.2); nothing here can be accepted, because R5.7 holds every change
 * reconciliation and evolution produce and the Ledger writes nothing at all (R8.4). So
 * unlike `/amendments`, this surface carries no control — a card with an accept button
 * would advertise an autonomy §8.1 explicitly withholds from this branch.
 *
 * A card whose proposed changes carry no diff is normal and is stated as such: the
 * degradation path of `kept evolve` records a drift Kane never got to propose a repair
 * for, and that card legitimately has an empty `proposedChanges` list. An empty section
 * and a withheld one must not look the same (§10.10).
 *
 * Server component: no hooks, no handlers, no client boundary.
 */

import clsx from 'clsx';
import type { SnapshotReviewCard } from '@kept/core';

import { parseUnifiedDiff } from '../lib/diff.js';
import { SELECTION_PARAM } from '../lib/graphNav.js';

import { DiffView } from './DiffView.js';

import '../styles/reviews.css';

/** Every heading and sentence the card says. Tests assert the words. */
export const REVIEW_WORDS = {
  facts: 'provenance',
  changes: 'held changes',
  promise: 'promise',
  branch: 'branch',
  evidence: 'evidence',
  noDetail:
    'No further detail was recorded for this card beyond its title, so the proposed changes ' +
    'below are the whole of what was staged.',
  noChanges:
    'This card records a drift with no proposed change, because none was rendered. Nothing ' +
    'was staged and nothing was applied; a human decides what the repair should be.',
  noEvidence:
    'No evidence pack is referenced by this card, so there is no sealed run to inspect behind ' +
    'it. The card is the record of what was proposed, not of what was proven.',
  held: 'Held, never applied. Changes on this branch wait for a human decision.',
} as const;

export interface ReviewCardViewProps {
  readonly card: SnapshotReviewCard;
  readonly className?: string;
}

/** One `term`/`value` row. `null` values are not rendered. */
function Fact({
  term,
  value,
  href,
}: {
  readonly term: string;
  readonly value: string | null;
  readonly href?: string;
}) {
  if (value === null) return null;
  return (
    <>
      <dt className="review-card__term">{term}</dt>
      <dd className="review-card__value">
        {href === undefined ? value : <a className="review-card__link" href={href}>{value}</a>}
      </dd>
    </>
  );
}

export function ReviewCardView({ card, className }: ReviewCardViewProps) {
  const headingId = `${card.id}-heading`;

  return (
    <article
      aria-labelledby={headingId}
      className={clsx('review-card', 'surface-raised-2', className)}
      data-branch={card.branch}
      data-kind={card.kind}
      data-review-card={card.id}
      id={card.id}
    >
      <div className="review-card__head">
        <span className="review-card__id">{card.id}</span>
        <span className="review-card__status">{card.status}</span>
        <span className="review-card__instant">{card.createdAt}</span>
      </div>

      <h3 className="review-card__title" id={headingId}>
        {card.title}
      </h3>

      <p className="review-card__prose">
        {card.detail.trim().length === 0 ? REVIEW_WORDS.noDetail : card.detail}
      </p>

      <section className="review-card__section">
        <h4 className="review-card__heading">{REVIEW_WORDS.facts}</h4>
        <dl className="review-card__facts">
          {/* The three fields R7.7 names, first and together. */}
          <Fact
            term={REVIEW_WORDS.promise}
            value={card.promiseId}
            href={`/?${SELECTION_PARAM}=${card.promiseId}`}
          />
          <Fact term={REVIEW_WORDS.branch} value={card.branch} />
          <Fact term={REVIEW_WORDS.evidence} value={card.evidenceRef} />
          <Fact term="kind" value={card.kind} />
          <Fact term="strategy" value={card.strategy} />
        </dl>
        {card.evidenceRef === null ? (
          <p className="review-card__prose">{REVIEW_WORDS.noEvidence}</p>
        ) : null}
      </section>

      <section className="review-card__section">
        <h4 className="review-card__heading">{REVIEW_WORDS.changes}</h4>
        {card.proposedChanges.length === 0 ? (
          <p className="review-card__prose">{REVIEW_WORDS.noChanges}</p>
        ) : (
          <ul className="review-card__changes">
            {card.proposedChanges.map((change, index) => (
              <li className="review-card__change" key={`${index}:${change.file}`}>
                <span className="review-card__ident">{change.file}</span>
                <p className="review-card__prose">{change.summary}</p>
                <DiffView
                  label={`Held change to ${change.file}`}
                  rows={parseUnifiedDiff(change.diff)}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="review-card__prose">{REVIEW_WORDS.held}</p>
      </section>
    </article>
  );
}
