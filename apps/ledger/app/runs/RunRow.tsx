/**
 * One run in the terminal-event log — design §10.1, §14.1, §4.1, §4.5, §5.3.1,
 * §10.7, R4.9, R4.11, R5.3.
 *
 * One `<tbody>` per run, holding one or two `<tr>`s: the seven aligned facts §10.1
 * names, and a detail row beneath them carrying the matrix's longer answers — each
 * preflight rejection reason, each member's verbatim status, the quoted refusal
 * message. A second row rather than a nested table, so the columns above it stay one
 * grid.
 *
 * **The `<tbody>` is the run, and that is a layout claim as much as a semantic one.**
 * Several `<tbody>` elements in one table is ordinary HTML, and grouping this way is
 * what lets `runs.css` band and highlight per *run* instead of per row: a detail row
 * belongs to the run above it, so striping it separately would visually detach the
 * evidence from the invocation it is evidence for. It also makes the hover tint cover
 * a run and its detail as one object, which is the object a reader is pointing at.
 *
 * The command family is the row's `<th scope="row">`. It is what the row is *about* —
 * which contract the invocation ends with, and therefore which terminal event the
 * whole row is judged against — and marking it up as the row header gives a screen
 * reader the association it otherwise has to guess at when reading the seventh cell
 * of an unlabelled row.
 *
 * This component decides no vocabulary. `runOutcome` decides what a run reads as,
 * `terminalContract` decides which terminal event the family declares, and
 * `coercedResultCode` decides how the code is read; all three are pure functions in
 * `lib/runVocabulary.ts` with unit tests over every row of §14.1. What is left here
 * is layout, which is why the honesty rules are testable without a DOM and the DOM
 * is testable without re-deciding them.
 *
 * Three things the row shows that a log usually leaves to be inferred:
 *
 * 1. **The exit meaning and the outcome, side by side.** `killed-by-timeout` is
 *    the machine's word and `timed out` is the reader's; showing one without the
 *    other either hides the mechanism or hides the meaning.
 * 2. **Which terminal event was expected, and whether it arrived.** The expected
 *    type comes from the contract table and never from the event, so the row cannot
 *    become a second authority on which of the three contracts a family ends with.
 * 3. **Whether the write guard let this run move a verdict.** That is the
 *    `Verdicts` column of §14.1, and leaving it to be inferred from a colour is how
 *    a reader ends up believing a crashed run changed something.
 *
 * A figure that was never reported reads `not reported`, never `0`: a zero is a
 * number the run produced, and none of these runs produced one.
 *
 * Two additions make a run addressable rather than merely visible. The row carries
 * its run id as its `id`, so `/runs#<run id>` scrolls to it and the address is
 * shareable — and the id is rendered as a link to that same fragment in the row
 * header, because the identifier is the affordance and a separate glyph would be a
 * second name for one thing. `runs.css` gives the row a `scroll-margin-top`, since a
 * bare fragment jump lands the row under the sticky masthead. The first row of a
 * newest-first log is marked `newest`, so which run is most recent is readable
 * without comparing fifteen timestamps.
 */

import type { SnapshotRun, SnapshotRunMember } from '@kept/core';

import {
  coercedResultCode,
  runOutcome,
  terminalContract,
  verdictSentence,
} from '../../lib/runVocabulary.js';

import { DiagnosticBlock } from './DiagnosticBlock.js';

import '../../styles/runs.css';

/** The columns, in the order design §10.1 lists the fields. */
export const RUN_COLUMNS: readonly {
  readonly key: string;
  readonly label: string;
  readonly numeric: boolean;
}[] = [
  { key: 'family', label: 'family', numeric: false },
  { key: 'command', label: 'command', numeric: false },
  { key: 'status', label: 'status', numeric: false },
  { key: 'result', label: 'result code', numeric: false },
  { key: 'credits', label: 'credits', numeric: true },
  { key: 'duration', label: 'duration', numeric: true },
  { key: 'outcome', label: 'exit meaning and outcome', numeric: false },
];

/** What a field the run never reported reads as. Not a zero, and not blank. */
export const NOT_REPORTED = 'not reported';

/** What the first row of a newest-first log is marked with. */
export const NEWEST_LABEL = 'newest';

/**
 * The fragment that addresses a run, and the whole of the anchor scheme.
 *
 * The run's own id, unchanged and unencoded. That is the point rather than laziness:
 * the fragment a reader copies out of the address bar is the identifier they can grep
 * the snapshot for, and any transform — a prefix, a slug, a hash — would make the two
 * different strings for the same run and put the burden of translating between them on
 * whoever is reading. HTML permits any non-whitespace character in an `id`, and the two
 * shapes the committed snapshot carries are a UUID and a `kept-verify:<instant>` pair;
 * both address cleanly.
 */
export function runAnchorHref(id: string): string {
  return `#${id}`;
}

function Absent() {
  return <span className="runs-table__absent">{NOT_REPORTED}</span>;
}

/**
 * One member of a testrun.
 *
 * The status is verbatim from the wire, because `broken` and `interrupted` are not
 * `failed`: §14.1 routes a broken member to a repair branch and an interrupted one
 * to no branch at all, and collapsing the three into one word throws away the
 * distinction the matrix is built on.
 */
function MemberItem({ member }: { readonly member: SnapshotRunMember }) {
  return (
    <li className="run-detail__item">
      {/* `data-status` is what the badge grammar selects through: `broken` and
          `failed` take the ink fill, everything else keeps the paper edge. The word
          itself is unchanged either way, so the fill is a second channel and never
          the only one (R10.5). */}
      <span className="run-member__status" data-status={member.status}>
        {member.status}
      </span>
      <span className="run-member__path">
        {member.testId === null ? member.path : `${member.path} ${member.testId}`}
      </span>
    </li>
  );
}

export interface RunRowProps {
  readonly run: SnapshotRun;
  /** `true` for the most recent run in the log. Newest first, so that is the first row. */
  readonly newest?: boolean;
}

export function RunRow({ run, newest = false }: RunRowProps) {
  const outcome = runOutcome(run);
  const contract = terminalContract(run);
  const code = coercedResultCode(run);
  const hasDetail = run.members.length > 0 || run.diagnostics.length > 0;

  return (
    <tbody className="runs-table__group" data-group={run.id}>
      {/* `id` is the run's own id, so `/runs#<id>` scrolls to this row and the address is
          shareable. `data-run` is kept beside it: the attribute is the machine handle the
          tests and the stylesheet select through, and an `id` is a document-wide name — the
          two are not the same thing even when they hold the same string. */}
      <tr
        className="runs-table__row"
        data-run={run.id}
        data-tone={outcome.tone}
        id={run.id}
      >
        <th className="runs-table__row-header" scope="row">
          {/* The row header is the run's identity: which contract it ends with, which run
              it is, and whether it is the most recent one. The family is still what the
              row is *about* and still the first thing in the cell; the id under it is the
              anchor's affordance, and a link to a fragment on the page a reader is already
              on is the smallest control that can be. */}
          <span className="runs-table__family">{run.family}</span>
          <a className="runs-table__anchor" href={runAnchorHref(run.id)}>
            {run.id}
          </a>
          {newest ? <span className="runs-table__newest">{NEWEST_LABEL}</span> : null}
        </th>
        <td className="runs-table__cell runs-table__cell--mono runs-table__command">
          {run.command}
        </td>
        <td className="runs-table__cell runs-table__cell--mono">
          {run.status === null ? <Absent /> : run.status}
        </td>
        <td className="runs-table__cell runs-table__cell--mono">
          {code === null ? <Absent /> : String(code)}
        </td>
        <td className="runs-table__cell credits-column">
          {run.credits === null ? <Absent /> : String(run.credits)}
        </td>
        <td className="runs-table__cell run-duration">
          {run.durationMs === null ? <Absent /> : `${run.durationMs} ms`}
        </td>
        <td className="runs-table__cell">
          <span className="run-outcome" data-tone={outcome.tone}>
            <span className="run-outcome__label">{outcome.label}</span>
            <span className="run-outcome__detail">
              <span className="runs-table__code">{run.exitMeaning}</span>
              {run.exitCode === null
                ? ', signalled rather than exited. '
                : `, exit ${run.exitCode}. `}
              {contract.agrees
                ? `Terminated with ${contract.expected}. `
                : contract.seen === null
                  ? `Expected ${contract.expected}; none arrived. `
                  : `Expected ${contract.expected}; saw ${contract.seen}. `}
              {outcome.detail}
            </span>
            <span className="run-outcome__verdicts">{verdictSentence(outcome)}</span>
          </span>
        </td>
      </tr>
      {hasDetail ? (
        <tr className="runs-table__detail-row" data-detail={run.id}>
          <td className="runs-table__cell" colSpan={RUN_COLUMNS.length}>
            <div className="run-detail surface-well">
              {run.members.length === 0 ? null : (
                <>
                  <p className="run-detail__title">{`Members (${run.members.length})`}</p>
                  <ul className="run-detail__list">
                    {run.members.map((member) => (
                      <MemberItem key={`${member.path}-${member.testId ?? ''}`} member={member} />
                    ))}
                  </ul>
                </>
              )}
              {run.diagnostics.length === 0 ? null : (
                <>
                  <p className="run-detail__title">
                    {`Reasons and diagnostics (${run.diagnostics.length})`}
                  </p>
                  {run.diagnostics.map((diagnostic, index) => (
                    <DiagnosticBlock diagnostic={diagnostic} key={`${diagnostic.code}-${index}`} />
                  ))}
                </>
              )}
            </div>
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}
