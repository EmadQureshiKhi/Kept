/**
 * `PromisePanel` — design §10.2, §10.5, §10.6.3, §10.7, §10.10, R8.2, R8.3, R10.7.
 *
 * 440px at `.surface-raised-2`: one promise, in the order a sceptic asks about it.
 * *What was promised* — the claim, in full, never the node's clamped two lines. *Where
 * it is written* — `path:line`, and beneath it the cited line quoted verbatim in a
 * `.surface-well`. *What would prove it* — the designed test. *What the last run said*
 * — the verdict and the terminal event behind it. *What to do about it* — the repair
 * annotation. *What can be inspected* — every artefact in the evidence pack, as a
 * plain static link.
 *
 * **Absence is stated, never omitted.** Today every promise in the committed snapshot
 * is `stale` with no verdict source and no evidence pack, because no verification run
 * has been recorded yet — so the sections that would carry a result code and a list of
 * artefacts say, in prose, that there is nothing sealed and why. That is the honest
 * state of the repository and it is the first thing a judge sees, so it is written as
 * a specified state (§10.10) rather than left as three empty headings. An empty
 * section and a withheld one must not look the same.
 *
 * **The quote is bytes, not prose we tidied.** `citation.text` is the line the
 * admission gate read off disk (R1.3), and it is rendered with `white-space: pre-wrap`
 * and no trimming, so leading space, trailing space and inner runs survive to the
 * page. That verbatim quality is the product's whole credibility claim: a ledger that
 * reformatted the line it quotes could not be checked against the file.
 *
 * **It is a panel, not a dialog.** No `role="dialog"`, no focus trap, no backdrop: the
 * graph beside it stays readable and operable, focus stays on the node that opened the
 * panel so `Escape` has somewhere to return to (§10.8), and the panel's own links and
 * close button are the next stops in the natural tab order. A modal here would take
 * the graph away to show a detail of it.
 *
 * Mono is texture (§10.7): ids, `path:line`, test ids, result and reason codes, member
 * statuses, credit figures and artefact names. The claim, the rationale and every
 * empty-state sentence are prose, in `--font-ui`.
 */

'use client';

import clsx from 'clsx';
import type { SnapshotEvidence, SnapshotPromise } from '@kept/core';

import { citationLabel, designedTestLabel } from '../lib/citation.js';

import { VerdictTag } from './VerdictTag.js';

import '../styles/promise-panel.css';

/**
 * Every sentence the panel says when something is absent, and the headings it says
 * it under.
 *
 * Exported because the tests assert the words rather than the shape — an empty state
 * that stopped explaining itself would still render, still pass a structural
 * assertion, and quietly become the blank the design forbids.
 */
export const PANEL_WORDS = {
  citation: 'cited in',
  designedTest: 'designed test',
  verdict: 'last verified by',
  repair: 'repair',
  evidence: 'evidence',
  noDesignedTest:
    'No designed test cites this claim yet, so the promise is stated but unproven and ' +
    'counts as suite debt.',
  noVerdictSource:
    'No terminal event has been consumed for this promise yet, so nothing has proven ' +
    'or broken it. The verdict above is what the ledger last knew.',
  noEvidence:
    'No evidence pack has been sealed for this promise yet, so there is nothing to ' +
    'inspect. Artefacts appear here once a verification run has recorded them.',
  noArtifacts:
    'The pack for this promise was sealed with no artefacts in it, so there is a run ' +
    'to point at and nothing of it to open.',
  close: 'close',
} as const;

export interface PromisePanelProps {
  readonly promise: SnapshotPromise;
  /**
   * The pack `promise.evidencePackId` resolves to, or `null` when the promise carries
   * no pack. Resolved by the caller against `snapshot.evidence`, so the panel never
   * searches the snapshot and cannot disagree with the graph about which pack this is.
   */
  readonly evidence?: SnapshotEvidence | null;
  /** Closes the panel. `PromiseGraph` restores focus to the node (§10.8). */
  readonly onClose?: () => void;
  readonly className?: string;
}

/** One `term`/`value` row of the facts grid. `null` values are not rendered. */
function Fact({ term, value }: { readonly term: string; readonly value: string | null }) {
  if (value === null) return null;
  return (
    <>
      <dt className="promise-panel__term">{term}</dt>
      <dd className="promise-panel__value">{value}</dd>
    </>
  );
}

export function PromisePanel({ promise, evidence = null, onClose, className }: PromisePanelProps) {
  const claimId = `${promise.id}-claim`;
  const designed = designedTestLabel(promise.designedTest);
  const source = promise.verdictSource;
  const repair = promise.repair;

  return (
    <aside
      aria-labelledby={claimId}
      className={clsx('promise-panel', 'surface-raised-2', className)}
      data-promise-panel={promise.id}
    >
      <div className="promise-panel__head">
        <span className="promise-panel__id">{promise.id}</span>
        <VerdictTag verdict={promise.verdict} />
        {onClose === undefined ? null : (
          <button
            aria-label={`Close detail for promise ${promise.id}`}
            className="promise-panel__close"
            onClick={onClose}
            type="button"
          >
            {PANEL_WORDS.close}
          </button>
        )}
      </div>

      <p className="promise-panel__claim" id={claimId}>
        {promise.claim}
      </p>

      <section className="promise-panel__section">
        <h3 className="promise-panel__heading">{PANEL_WORDS.citation}</h3>
        <div className={clsx('promise-panel__well', 'surface-well')}>
          <span className="promise-panel__ident">{citationLabel(promise.citation)}</span>
          <blockquote className="promise-panel__quote" cite={promise.citation.file}>
            {promise.citation.text}
          </blockquote>
        </div>
      </section>

      <section className="promise-panel__section">
        <h3 className="promise-panel__heading">{PANEL_WORDS.designedTest}</h3>
        {designed === null ? (
          <p className="promise-panel__prose">{PANEL_WORDS.noDesignedTest}</p>
        ) : (
          <span className="promise-panel__ident">{designed}</span>
        )}
      </section>

      <section className="promise-panel__section">
        <h3 className="promise-panel__heading">{PANEL_WORDS.verdict}</h3>
        {source === null ? (
          <p className="promise-panel__prose">{PANEL_WORDS.noVerdictSource}</p>
        ) : (
          <dl className="promise-panel__facts">
            <Fact term="run" value={source.runId} />
            <Fact term="event" value={source.terminalEventType} />
            <Fact term="at" value={source.at} />
            <Fact term="member" value={source.memberStatus} />
            <Fact
              term="result_code"
              value={source.resultCode === null ? null : String(source.resultCode)}
            />
            <Fact term="reason_code" value={source.reasonCode} />
            <Fact term="credits" value={promise.credits === null ? null : String(promise.credits)} />
          </dl>
        )}
      </section>

      {repair === null ? null : (
        <section className="promise-panel__section">
          <h3 className="promise-panel__heading">{PANEL_WORDS.repair}</h3>
          <dl className="promise-panel__facts">
            <Fact term="branch" value={repair.branch} />
            <Fact term="strategy" value={repair.strategy} />
            <Fact term="severity" value={repair.severity} />
            <Fact term="category" value={repair.category} />
            <Fact
              term="confidence"
              value={repair.confidence === null ? null : String(repair.confidence)}
            />
            <Fact term="evidence" value={repair.evidenceRef} />
          </dl>
          <p className="promise-panel__prose">{repair.rationale}</p>
        </section>
      )}

      <section className="promise-panel__section">
        <h3 className="promise-panel__heading">{PANEL_WORDS.evidence}</h3>
        {evidence === null ? (
          <p className="promise-panel__prose">{PANEL_WORDS.noEvidence}</p>
        ) : (
          <>
            <span className="promise-panel__ident">{evidence.id}</span>
            {evidence.artifacts.length === 0 ? (
              <p className="promise-panel__prose">{PANEL_WORDS.noArtifacts}</p>
            ) : (
              <ul className="promise-panel__artifacts">
                {evidence.artifacts.map((artifact, index) => (
                  <li key={`${index}:${artifact.publicPath}`}>
                    <span className="promise-panel__artifact-kind">{artifact.kind}</span>{' '}
                    <a className="promise-panel__artifact" href={artifact.publicPath}>
                      {artifact.name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </aside>
  );
}
