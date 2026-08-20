/**
 * `/runs` — design §10.1, §14.1 (the failure and degradation matrix), §4.1 (the
 * three terminal-event contracts), §5.3.1 (the verified refusal envelope),
 * §13.2.2, R4.9, R4.11, R5.3.
 *
 * The terminal-event log, and the page this product's honesty is easiest to check
 * on. One row per invocation, newest first, carrying the six facts §10.1 lists —
 * family, command, status, result code, credits, exit meaning — plus the sentence
 * §14.1 assigns to that combination and whether any verdict was allowed to move
 * because of it.
 *
 * Every word of that vocabulary is decided in `lib/runVocabulary.ts` and laid out
 * by `RunRow`, neither of them here. The split matters: the rule that a crashed
 * stream reads `outcome unknown` rather than `passed` is a pure function of a
 * `SnapshotRun`, so it is unit-tested against constructed runs for every row of the
 * matrix, and a page that decided it inline could only be tested by rendering
 * whatever the committed snapshot happened to contain.
 *
 * **The log is empty today, and the page says so precisely.** The committed
 * snapshot carries `runs: []`, because no verification run has been recorded
 * against this repository yet. That is a fact about the repository rather than a
 * gap in the page, so the empty state states it and connects it to the two other
 * places the same fact surfaces — the withheld proven figure and the
 * `never verified` freshness chip. Those three are one fact seen from three angles,
 * and a page that shrugged here would leave a reader to guess which.
 *
 * Snapshot-level diagnostics are rendered below the log, in full and verbatim,
 * whatever their code. Today that is where a reader finds the refusal quoted in the
 * upstream tool's own words, which is the reason the proven figure is withheld at
 * all.
 *
 * Server component: no hooks, no handlers, no client boundary.
 */

import type { Metadata } from 'next';

import {
  NO_DIAGNOSTICS,
  NO_RUNS_DETAIL,
  NO_RUNS_HEADLINE,
} from '../../lib/runVocabulary.js';
import { snapshot } from '../../lib/snapshot.js';

import { DiagnosticBlock } from './DiagnosticBlock.js';
import { RUN_COLUMNS, RunRow } from './RunRow.js';

import '../../styles/runs.css';

/**
 * Statically rendered, stated rather than inferred. The page reads one imported
 * JSON module and nothing else, so there is nothing here that could make it
 * dynamic — this export is what keeps it that way (§10.1, R8.6).
 */
export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Runs — KEPT',
  description:
    'One entry per verification invocation: family, command, terminal event, exit meaning, ' +
    'and what the ledger was allowed to conclude from it.',
};

export default function RunsPage() {
  const { runs, diagnostics } = snapshot;

  return (
    <div className="runs-page">
      <header>
        <h1 className="runs-page__title">Runs</h1>
        <p className="runs-page__lede">
          One entry per verification invocation. A run that did not reach the terminal event its
          command family ends with reports its outcome as unknown, never as a pass and never as a
          failure, and moves no verdict — which is the only reason a figure on this site can be
          trusted.
        </p>
      </header>

      <section>
        <h2 className="runs-page__section-title">{`Terminal events (${runs.length})`}</h2>
        {runs.length === 0 ? (
          <div className="runs-empty surface-well">
            <p className="runs-empty__headline">{NO_RUNS_HEADLINE}</p>
            <p className="runs-empty__detail">{NO_RUNS_DETAIL}</p>
          </div>
        ) : (
          <table className="runs-table">
            <thead>
              <tr>
                {RUN_COLUMNS.map((column) => (
                  <th
                    className={
                      column.numeric
                        ? 'runs-table__head-cell runs-table__head-cell--numeric'
                        : 'runs-table__head-cell'
                    }
                    key={column.key}
                    scope="col"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="runs-page__section-title">{`Diagnostics (${diagnostics.length})`}</h2>
        {diagnostics.length === 0 ? (
          <p className="runs-empty__detail">{NO_DIAGNOSTICS}</p>
        ) : (
          diagnostics.map((diagnostic, index) => (
            <DiagnosticBlock diagnostic={diagnostic} key={`${diagnostic.code}-${index}`} />
          ))
        )}
      </section>
    </div>
  );
}
