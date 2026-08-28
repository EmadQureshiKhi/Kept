/**
 * `/amendments` — design §10.1, §8.3, §8.5, §10.9, §10.10, R7.3, R7.5, R8.4.
 *
 * The docs-lie branch's surface, and the product's differentiator: this is where a
 * reader sees that the *documentation* was wrong rather than the code, sees the exact
 * replacement proposed for one line of one file, and sees the command that applies it.
 * Every other verification tool tells you a test failed. This page tells you a sentence
 * a README makes is not true, quotes both versions, and hands over the interlock that
 * makes accepting it safe.
 *
 * **Pending first, then everything else.** A pending amendment is a decision waiting on
 * a human; an accepted, rejected or stale one is a record. Sorting by that rather than
 * by time puts the thing to act on at the top, which is the same argument §10.3 makes
 * for sorting red promises to the top of the graph. Within each group the order is by
 * `createdAt` then id, so the page is byte-identical on every machine and in every
 * screenshot.
 *
 * **The Ledger still writes nothing.** No `POST`, no server action, no route handler:
 * `AcceptControl` copies `kept amend accept <id>` and reveals it inline (§8.5), and the
 * write lives in the CLI where it has an audit trail. `scripts/check-readonly.mjs`
 * asserts that over this directory with eleven rules, and it runs both in the test suite
 * and in the build.
 *
 * Statically rendered from the committed snapshot, like every other route. That snapshot
 * carries one amendment now, the staged `docs-lie` stage 15.5 proposed off T-7's red
 * verdict, so the page a reader meets is a pending card rather than the empty state. The
 * empty state is still specified (§10.10) rather than left as a blank, because a
 * repository on its first build has nothing to show here, and the copy names what would
 * put a card on the page instead of shrugging.
 */

import type { Metadata } from 'next';
import type { SnapshotAmendment } from 'kept-core';

import { AmendmentCard, PENDING_STATUS } from '../../components/AmendmentCard.js';
import { snapshot } from '../../lib/snapshot.js';

import '../../styles/amendments.css';

/**
 * Statically rendered, stated rather than inferred. The page reads one imported JSON
 * module and nothing else; this export is the assertion that it stays that way (§10.1).
 */
export const dynamic = 'force-static';

/** The short name only; the root layout's template composes `KEPT · Amendments`. */
export const metadata: Metadata = {
  title: 'Amendments',
  description:
    'Documentation claims this repository can no longer keep, each with the exact ' +
    'replacement proposed for the cited line and the command that applies it.',
};

/** What the page says when nothing is proposed (§10.10). */
export const AMENDMENTS_EMPTY =
  'No documentation amendment is on file. One appears here when a verification run shows ' +
  'that the documentation, rather than the code, is what is wrong — the router settles that ' +
  'on the docs-lie branch, and `kept amend propose` records the proposed replacement without ' +
  'writing a single byte of the document.';

/**
 * The empty state, split into the line that states the fact and the line that explains
 * it — a lead line alone is a shrug, and a detail line alone buries the answer.
 *
 * Split at render time rather than authored as two constants, so `AMENDMENTS_EMPTY`
 * stays the one place the words live. The cut keeps the space at the head of the
 * remainder, which is what makes the two elements' combined `textContent`
 * character-identical to the constant.
 */
export function splitEmptyState(text: string): readonly [string, string] {
  const boundary = text.indexOf('. ');
  if (boundary < 0) return [text, ''];
  return [text.slice(0, boundary + 1), text.slice(boundary + 1)];
}

/** The lede, in prose, so the page explains its own autonomy rule (§8.1). */
export const AMENDMENTS_LEDE =
  'Each of these is a sentence the documentation states and the application does not keep. ' +
  'Nothing here has been applied: this branch is never silent, so KEPT proposes and a human ' +
  'accepts. The Ledger writes nothing at all — acceptance is a command you run against the ' +
  'repository, and the sha256 interlock on each card refuses the write if the cited line ' +
  'moved after the proposal.';

/**
 * Pending first, then `createdAt`, then id.
 *
 * Exported as a function rather than written inline so the ordering can be asserted
 * over inputs a test chooses: the page reads the module-scope snapshot, and a test that
 * proved ordering by rendering cards in the order it already put them in would prove
 * nothing at all.
 */
export function amendmentOrder(
  amendments: readonly SnapshotAmendment[],
): readonly SnapshotAmendment[] {
  return [...amendments].sort((left, right) => {
    const leftPending = left.status === PENDING_STATUS ? 0 : 1;
    const rightPending = right.status === PENDING_STATUS ? 0 : 1;
    if (leftPending !== rightPending) return leftPending - rightPending;
    if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

export default function AmendmentsPage() {
  const pendingFirst = amendmentOrder(snapshot.amendments);
  const pending = pendingFirst.filter((amendment) => amendment.status === PENDING_STATUS).length;
  const [emptyLead, emptyDetail] = splitEmptyState(AMENDMENTS_EMPTY);

  return (
    <div className="amendments-page">
      <header>
        {/* The title in its solid ink slab — the plane from `.surface-slab-ink`, the box
            from `.page-title__slab`, the type from `shell.css`'s `h1` clamp — over the
            shared `.page-standfirst`. */}
        <h1 className="amendments-page__title">
          <span className="page-title__slab surface-slab-ink">Amendments</span>
        </h1>
        <p className="page-standfirst">{AMENDMENTS_LEDE}</p>
      </header>

      <p className="amendments-page__measured">
        {`${pendingFirst.length} amendment${pendingFirst.length === 1 ? '' : 's'} on file, `}
        {`${pending} pending. Measured from the snapshot generated at `}
        <span className="amendments-page__instant">{snapshot.generatedAt}</span>
        {'.'}
      </p>

      {pendingFirst.length === 0 ? (
        /* No `.surface-well` here: an empty region is marked by the one dashed border
           in the system rather than by depth, so "specified and holding nothing" looks
           the same on every page (§10.10). */
        <div className="amendments-page__empty">
          <p className="amendments-page__empty-lead">{emptyLead}</p>
          <p className="amendments-page__empty-detail">{emptyDetail}</p>
        </div>
      ) : (
        <ul className="amendments-page__list">
          {pendingFirst.map((amendment) => (
            <li key={amendment.id}>
              <AmendmentCard amendment={amendment} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
