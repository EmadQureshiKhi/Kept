/**
 * `AmendmentCard` — design §8.3, §8.4, §8.5, §10.5, §10.7, §10.9, R7.3, R7.5, R7.6.
 *
 * One proposed documentation edit, in the order a sceptic asks about it: *what is
 * written now*, *what is proposed instead*, *why*, *what proves it*, and *how to apply
 * it*. `.surface-raised-2` is the elevation §10.5 reserves by name for the promise panel
 * and the amendment cards, and the diff inside it is `.surface-well` — so the bytes read
 * as cut into the card that argues about them.
 *
 * ## An accepted amendment retires one promise and creates another
 *
 * This is the fact the card exists to make visible, and it is easy to render wrongly.
 * A promise's identity is its file plus its **normalised claim** (§3.2), and accepting
 * an amendment replaces that claim — so `p_old` leaves the graph and a *different*
 * promise enters it, with no verdict, because carrying the old verdict across would
 * assert that Kane proved a sentence it never saw. `amendedPromiseId` names the
 * successor, and both ends are linked: the promise this amendment retires and the
 * promise it creates. A card that showed only one id would quietly imply the verdict
 * survives the edit.
 *
 * ## The interlock is shown, in full
 *
 * `expectedSha256` is the staleness guard of §8.4 step 3: acceptance re-hashes the cited
 * line and refuses to write when it no longer matches, which is what makes it impossible
 * for an amendment to silently overwrite an edit made after it was proposed. It is
 * rendered rather than hidden because it is checkable — a reader can hash the line
 * themselves — and a guard nobody can see is a guard nobody trusts. Full 64 hex, never
 * truncated, for the reason `model/snapshot.ts` gives: truncating an interlock weakens it,
 * and displaying a truncation invites reproducing one.
 *
 * ## Deep links are fragments, not query state
 *
 * The card's DOM id is the amendment id, so `/amendments#am_3b9d21f0` reaches one card.
 * A fragment costs no client JavaScript and no dynamic render — `?p=` would make this
 * page read `searchParams` and stop being statically rendered (§10.1) — and it degrades
 * exactly the way `resolveSelection` makes a stale `?p=` degrade: an id this snapshot no
 * longer carries matches nothing and the reader lands on the list, rather than on a card
 * asserting something about an amendment the ledger has never seen.
 *
 * Server component. The one client boundary on this route is `AcceptControl`, which
 * copies a command and writes nothing (§8.5, R8.4).
 */

import clsx from 'clsx';
import type { SnapshotAmendment } from '@kept/core';
import { amendedPromiseId } from '@kept/core';

import { diffLines } from '../lib/diff.js';
import { SELECTION_PARAM } from '../lib/graphNav.js';

import { AcceptControl } from './AcceptControl.js';
import { DiffView } from './DiffView.js';

import '../styles/amendments.css';

/** Every heading and sentence the card says. Tests assert the words, not the shape. */
export const AMENDMENT_WORDS = {
  /** What the id under it is the id of. Without this the card opens on a bare hash. */
  eyebrow: 'amendment',
  /** The verb in front of the instant. An ISO stamp with no verb is a number. */
  proposedAt: 'proposed',
  citation: 'cited in',
  diff: 'proposed replacement',
  rationale: 'why',
  facts: 'provenance',
  artifacts: 'artefacts',
  accept: 'how to apply it',
  retires: 'retires promise',
  creates: 'creates promise',
  noRationale:
    'No rationale was recorded for this amendment, so there is nothing here explaining why ' +
    'the claim is wrong. The diff and the evidence reference are what it rests on.',
  noArtifacts:
    'No artefacts were attached to this amendment, so there is nothing to open. Screenshots ' +
    'and annotated captures appear here when the run that produced it sealed them.',
  notPending:
    'This amendment is no longer pending, so there is no command to run. The diff below is ' +
    'the record of what was proposed.',
  stale:
    'The cited line changed after this amendment was proposed, so the interlock no longer ' +
    'matches and acceptance would refuse to write. Re-propose it against the line as it now ' +
    'stands.',
} as const;

/** The status that carries an accept control (§8.4 step 1). */
export const PENDING_STATUS = 'pending';

export interface AmendmentCardProps {
  readonly amendment: SnapshotAmendment;
  readonly className?: string;
}

/** One `term`/`value` row of the provenance grid. `null` values are not rendered. */
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
      <dt className="amendment-card__term">{term}</dt>
      <dd className="amendment-card__value">
        {/* The scroll box is on the `dd`'s child, never on the `dd` itself. A 64-character
            interlock and a promise id each belong on one line, and a scroller wrapped
            around the cell would swallow the link inside it — a pointer would scroll the
            box instead of following the href. On the child, the link is still a link and
            the value is still whole and selectable end to end. */}
        {href === undefined ? (
          <span className="amendment-card__value-inner">{value}</span>
        ) : (
          <a className="amendment-card__link amendment-card__value-inner" href={href}>
            {value}
          </a>
        )}
      </dd>
    </>
  );
}

export function AmendmentCard({ amendment, className }: AmendmentCardProps) {
  const headingId = `${amendment.id}-heading`;
  const successor = amendedPromiseId(amendment);
  const artifacts = Object.entries(amendment.artifacts).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  // The amendment cites exactly one line (§8.3), so the gutter starts there — a
  // single-line diff numbered `1` would print a number the file contradicts.
  const rows = diffLines(amendment.currentText, amendment.proposedText, {
    firstLine: amendment.citation.line,
  });

  return (
    <article
      aria-labelledby={headingId}
      className={clsx('amendment-card', 'surface-raised-2', className)}
      data-amendment={amendment.id}
      data-status={amendment.status}
      id={amendment.id}
    >
      {/* Three ranks rather than three runs on one baseline: the identity with an eyebrow
          naming it, the status in its own corner, and the instant preceded by the verb it
          is the instant of. See the note over `.amendment-card__head` in
          `amendments.css` for what this replaced and why. The `id` attribute stays on the
          id run itself, because that is what `aria-labelledby` names the card by. */}
      <div className="amendment-card__head">
        <span className="amendment-card__identity">
          <span className="amendment-card__eyebrow">{AMENDMENT_WORDS.eyebrow}</span>
          <span className="amendment-card__id" id={headingId}>
            {amendment.id}
          </span>
        </span>
        <span className="amendment-card__status">{amendment.status}</span>
        <span className="amendment-card__stamp">
          <span className="amendment-card__stamp-label">{AMENDMENT_WORDS.proposedAt}</span>
          <span className="amendment-card__instant">{amendment.createdAt}</span>
        </span>
      </div>

      <section className="amendment-card__section">
        <h3 className="amendment-card__heading">{AMENDMENT_WORDS.citation}</h3>
        <span className="amendment-card__ident">
          {`${amendment.citation.file}:${amendment.citation.line}`}
        </span>
      </section>

      <section className="amendment-card__section">
        <h3 className="amendment-card__heading">{AMENDMENT_WORDS.diff}</h3>
        <DiffView
          label={`Proposed replacement for ${amendment.citation.file} line ${amendment.citation.line}`}
          rows={rows}
        />
      </section>

      <section className="amendment-card__section">
        <h3 className="amendment-card__heading">{AMENDMENT_WORDS.rationale}</h3>
        <p className="amendment-card__prose">
          {amendment.rationale.trim().length === 0
            ? AMENDMENT_WORDS.noRationale
            : amendment.rationale}
        </p>
        {amendment.status === 'stale' ? (
          <p className="amendment-card__prose">{AMENDMENT_WORDS.stale}</p>
        ) : null}
      </section>

      <section className="amendment-card__section">
        <h3 className="amendment-card__heading">{AMENDMENT_WORDS.facts}</h3>
        <dl className="amendment-card__facts">
          <Fact
            term={AMENDMENT_WORDS.retires}
            value={amendment.promiseId}
            href={`/?${SELECTION_PARAM}=${amendment.promiseId}`}
          />
          <Fact
            term={AMENDMENT_WORDS.creates}
            value={successor}
            href={`/?${SELECTION_PARAM}=${successor}`}
          />
          <Fact term="strategy" value={amendment.strategy} />
          <Fact term="evidence" value={amendment.evidenceRef} />
          <Fact term="expected_sha256" value={amendment.expectedSha256} />
          <Fact term="applied_at" value={amendment.appliedAt} />
        </dl>
      </section>

      <section className="amendment-card__section">
        <h3 className="amendment-card__heading">{AMENDMENT_WORDS.artifacts}</h3>
        {artifacts.length === 0 ? (
          <p className="amendment-card__prose">{AMENDMENT_WORDS.noArtifacts}</p>
        ) : (
          <ul className="amendment-card__artifacts">
            {artifacts.map(([label, publicPath]) => (
              <li className="amendment-card__artifact-item" key={label}>
                <span className="amendment-card__artifact-kind">{label}</span>
                <a className="amendment-card__artifact" href={publicPath}>
                  {publicPath}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="amendment-card__section">
        <h3 className="amendment-card__heading">{AMENDMENT_WORDS.accept}</h3>
        {amendment.status === PENDING_STATUS ? (
          <AcceptControl amendment={amendment} />
        ) : (
          <p className="amendment-card__prose">{AMENDMENT_WORDS.notPending}</p>
        )}
      </section>
    </article>
  );
}
