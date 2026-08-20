/**
 * One diagnostic, verbatim — design §14.1, §13.2.2, R4.9, R5.3.
 *
 * Colocated beside the route that uses it rather than in `components/`, because it
 * is the run log's own vocabulary made visible and has no second consumer. Next
 * treats only a handful of filenames under `app/` as routes, so a component here is
 * a module like any other — and being a module rather than a closure inside
 * `page.tsx` is what lets it be rendered against constructed diagnostics instead of
 * only against whatever the committed snapshot happens to contain.
 *
 * The rule this component exists to keep: **nothing is paraphrased and nothing is
 * dropped.** The message is split only on the backtick fences its producer already
 * wrote, so a command a reader may need to type is set in mono and the sentence
 * around it is not (§10.7), and the split is lossless — quoting is never editing.
 * A code this build has never been compiled against still renders its code, its
 * severity, its instant and its whole message; the two codes §14.1 singles out add
 * a heading on top of that and take nothing away.
 *
 * The remedy block is the fenced run the unresolved-source message already
 * carries. That is how "naming the `context ingest` remedy" is satisfied without
 * this page inventing a command of its own — a command the Ledger composed would
 * be the Ledger's guess, and a guess is exactly what a reviewer cannot act on.
 */

import type { SnapshotDiagnostic } from '@kept/core';

import { EMPHASIS_HEADINGS, diagnosticPresentation } from '../../lib/runVocabulary.js';

import '../../styles/runs.css';

export interface DiagnosticBlockProps {
  readonly diagnostic: SnapshotDiagnostic;
}

export function DiagnosticBlock({ diagnostic }: DiagnosticBlockProps) {
  const presented = diagnosticPresentation(diagnostic);
  /* The first fenced run is the remedy: the producer writes the command first and
     the explanation after it. When a message fences nothing there is no remedy to
     show, and inventing one is the failure this guards against. */
  const remedy = presented.emphasis === 'remedy' ? presented.quoted[0] : undefined;

  return (
    <div className="diagnostic surface-well" data-code={presented.code}>
      <p className="diagnostic__title">
        <span className="diagnostic__code">{presented.code}</span>
        <span className="diagnostic__severity">{presented.severity}</span>
        <span className="diagnostic__at">{presented.at}</span>
        {presented.file === null ? null : (
          <span className="diagnostic__severity">
            {presented.line === null ? presented.file : `${presented.file}:${presented.line}`}
          </span>
        )}
      </p>
      {presented.emphasis === null ? null : (
        <span className="diagnostic__emphasis">{EMPHASIS_HEADINGS[presented.emphasis]}</span>
      )}
      <p className="diagnostic__message">
        {presented.segments.map((segment, index) =>
          segment.kind === 'quoted' ? (
            <span className="diagnostic__quoted" key={index}>
              {segment.text}
            </span>
          ) : (
            <span key={index}>{segment.text}</span>
          ),
        )}
      </p>
      {remedy === undefined ? null : <span className="diagnostic__remedy">{remedy}</span>}
    </div>
  );
}
