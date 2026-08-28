/**
 * The dual-axis coverage ribbon, design §5.3.0, §10.1, R9.10 through R9.15.
 *
 * Two axes over one population, and a row per use case underneath them. The axes
 * come from `kane-cli cover gaps`, are projected in `kept-core` and are recorded in
 * the committed snapshot, so this component renders them with Kane invoked zero
 * times (R9.14). It computes nothing: every percentage, every `n/m` ratio and every
 * word of status is a field of `snapshot.coverageAxes`, read verbatim.
 *
 * Four decisions carry the weight here.
 *
 * **1. The two proven figures are labelled apart, in the words a reader sees.**
 * The metric rail's tile is `proven coverage` and it counts *promises this
 * repository verified*, seven of eight. This ribbon's axis is
 * `proven, acceptance criteria` and it counts *acceptance criteria Kane's assurance
 * graph holds execution facts for*, six of six. Different denominators over
 * different objects, so they will disagree, and R9.15 exists precisely so that
 * disagreement cannot read as a bug. The page states both denominators in prose
 * before either figure appears, every ribbon figure carries the words
 * `acceptance criteria` in its own label, and no label on this page is `proven
 * coverage` except the rail's own. {@link RIBBON_PROVEN_LABEL} and
 * {@link RAIL_PROVEN_LABEL} are exported so a test can assert the two never
 * collide rather than a reviewer having to notice.
 *
 * **2. `readyCommand` reaches the DOM as text and nothing else.** It is a literal
 * `kane-cli design tests --use-case uc-1` string Kane composed. It is rendered
 * inside a `<span>`, in a list item, with no `onClick`, no `href`, no `<button>`, no
 * `<form>` and no `role`. The deployed Ledger has no mutating route at all (§9,
 * R8.4) and a control here that spent credits would break that outright, so the
 * rule is not "we chose not to wire it up", it is "there is nothing to wire".
 *
 * **3. The debt is shown, not rounded away.** `usecases_complete` reads `1/9` with
 * eight use cases needing scenarios. The graph owes eight designs. It is rendered
 * beside the `6/6` acceptance-criteria ratio with its own label, because `6/6` alone
 * reports 100% of the criteria that exist and says nothing about the ones that do not.
 *
 * **3a. That denominator is Kane's count, and Kane's count is inflated.** Driving the
 * documentation trigger live at task 22.2 established that `maintain reconcile`
 * **appends** use cases rather than matching them, so reconciling one unchanged document
 * three times took the graph from nine to thirteen by re-extracting the same three. Those
 * four were reverted. Four duplicate pairs remain below the nine from an earlier round,
 * so the graph describes five distinct use cases and reports nine, and eight of the nine
 * genuinely carry no scenario.
 *
 * The figure is published as Kane reports it anyway, and that is a decision rather than an
 * oversight. §5.3.0's rule is that this ribbon quotes Kane's report verbatim, and the
 * moment KEPT deduplicates Kane's graph on the way to the page it stops quoting a source
 * and starts editing one, which is a worse property for a ledger than a denominator that
 * runs high. What a reader is owed is the caveat, not a quieter number, so
 * {@link ribbonUsecaseNote} says it on the page beside the figure. Recorded in
 * `docs/checkpoints.md` and at task 22.2.
 *
 * **The caveat is computed from the rows, and the first version of it was not.** It was a
 * fixed sentence reading "four of these nine", under a heading that reads its own count
 * off the data, in a file whose header claims it computes nothing. Had the duplication
 * recurred, the page would have said "13 use cases" above "four of these nine". That is
 * the same fault as the two summary lines which hard-coded a count of zero while nine
 * items existed, and it was caught by an audit rather than by a test, which is why
 * {@link usecaseDuplication} exists and why the repetition clause disappears entirely
 * when there is no repetition.
 *
 * **4. Withheld is a statement, never an empty list.** When the axes are absent,
 * every degraded path leaves them so (R9.13), this renders the one dashed empty
 * state in the system with a lead line, the reason verbatim, and what would change
 * it. A ribbon with no rows and two green figures above it would read as "nothing
 * owed", which is the exact failure this product exists to prevent.
 *
 * Server component: no hooks, no handlers, no client boundary. The class names are
 * the ones `styles/coverage.css` and `styles/shell.css` already define; this file
 * authors no colour, no depth and no stylesheet of its own.
 */

import type { SnapshotCoverageAxes, SnapshotCoverageRatio, SnapshotCoverageRow } from 'kept-core';

import '../../styles/coverage.css';

/** The rail's own label for the figure that counts **promises** (R9.15). */
export const RAIL_PROVEN_LABEL = 'proven coverage';

/** This ribbon's label for the figure that counts **acceptance criteria** (R9.15). */
export const RIBBON_PROVEN_LABEL = 'proven, acceptance criteria';

/** The design axis's label. Also acceptance criteria, and it says so. */
export const RIBBON_DESIGN_LABEL = 'designed, acceptance criteria';

/** The label on the use-case debt figure, which is a different population again. */
export const RIBBON_USECASE_LABEL = 'use cases with scenarios';

/** What the rows say about repetition in the graph's own use-case list. */
export interface UsecaseDuplication {
  readonly total: number;
  /** Rows with a distinct title. */
  readonly distinct: number;
  /** Rows repeating a title an earlier row already used. */
  readonly repeated: number;
}

/**
 * Counts repetition in the published rows, by title.
 *
 * Derived rather than stated, and the first version of this was **not**, which is the
 * whole reason it is a function now. It was a fixed sentence saying "four of these nine",
 * sitting directly under a heading that read its own count off the data, in a file whose
 * header claims it computes nothing and quotes every figure verbatim. The trigger is
 * documented as real: `maintain reconcile` appends use cases rather than matching them and
 * has already moved this count from nine to thirteen once. The page would then have read
 * "13 use cases" above prose saying "four of these nine", which is the same defect as the
 * two summary lines that hard-coded a count of zero while nine items existed, one step
 * earlier in its life.
 *
 * Title equality is the right test here because that is what the duplication actually is:
 * re-extracting one document mints a fresh id for a use case whose description is
 * word-for-word the one already in the graph.
 */
export function usecaseDuplication(
  rows: readonly { readonly title: string }[],
): UsecaseDuplication {
  const seen = new Set<string>();
  let repeated = 0;
  for (const row of rows) {
    if (seen.has(row.title)) repeated += 1;
    else seen.add(row.title);
  }
  return { total: rows.length, distinct: seen.size, repeated };
}

/**
 * The caveat on that denominator, stated on the page rather than only in a document.
 *
 * See note 3a in the header. The count is Kane's, `maintain reconcile` appends rather
 * than matches, and some of the rows repeat another row's description. Saying so is
 * cheaper than either publishing a number a reader cannot interpret or quietly editing a
 * source this page claims to quote.
 *
 * Every figure comes from {@link usecaseDuplication}, and the sentence about repetition
 * is omitted entirely when there is none, so a graph that stops duplicating stops being
 * described as if it did.
 */
export function ribbonUsecaseNote(counts: UsecaseDuplication): string {
  const lead =
    `This denominator is the assurance graph\u2019s own count of use cases, ` +
    `${String(counts.total)} of them, published as Kane reports it.`;
  if (counts.repeated === 0) {
    return (
      `${lead} Every one of them describes something different, and the debt shown against ` +
      `each is real.`
    );
  }
  return (
    `${lead} Reconciling a document re-designs a use case as a fresh successor rather than ` +
    `editing the original, and the graph keeps both, so ${String(counts.repeated)} of these ` +
    `${String(counts.total)} rows carry the same description as a row they superseded and only ` +
    `${String(counts.distinct)} distinct use cases are described. The debt shown against each ` +
    `row is real; the total runs high, and it is not corrected here because this ribbon quotes ` +
    `the graph rather than editing it.`
  );
}

/** What a figure reads when the payload carried nothing readable (R9.13). */
export const WITHHELD = 'withheld';

/** Lead line of the withheld state. States the fact before the reason. */
export const AXES_WITHHELD_LEAD =
  'Coverage against acceptance criteria is withheld for this build.';

/** Detail line of the withheld state. Says what would change it. */
export const AXES_WITHHELD_DETAIL =
  'The assurance graph was not read, so there is no design-completeness figure and no proven ' +
  'figure to report. Nothing here is zero and nothing is owed-free. The run that would have ' +
  'answered did not reach a clean terminal event, and a ribbon showing no rows under two ' +
  'percentages would read as nothing owed. Re-running the build against a reachable assurance ' +
  'graph is what fills it in.';

/** What a ratio reads when the payload carried none. A word, not a dash. */
export const RATIO_ABSENT = 'not reported';

/** A percentage as the page prints it: verbatim, or the word `withheld` (R9.13). */
export function renderPercent(pct: number | null): string {
  return pct === null ? WITHHELD : `${String(pct)}%`;
}

/**
 * A ratio as the page prints it: the string Kane sent, or {@link RATIO_ABSENT}.
 *
 * A word rather than a glyph, for the same reason `n/a` is a word on the rail: a
 * punctuation mark standing in for a missing denominator is a thing a reader has to
 * interpret, and this page has one job, which is to not need interpreting.
 */
export function renderRatio(ratio: SnapshotCoverageRatio): string {
  return ratio.text ?? RATIO_ABSENT;
}

interface AxisFigureProps {
  readonly figure: string;
  readonly label: string;
  readonly ratio: string;
  readonly detail: string;
}

/**
 * One axis figure with its label and its denominator.
 *
 * The label is carried as `data-axis-label` as well as rendered, so the
 * never-the-same-label property of R9.15 can be quantified over the DOM rather
 * than over this file's source.
 */
function AxisFigure({ figure, label, ratio, detail }: AxisFigureProps) {
  return (
    <li className="coverage-axis" data-axis-label={label}>
      <span className="coverage-page__figure">{figure}</span>
      <span className="label">{label}</span>
      <span className="coverage-axis__ratio">{ratio}</span>
      <span className="coverage-axis__detail">{detail}</span>
    </li>
  );
}

interface RowProps {
  readonly row: SnapshotCoverageRow;
}

/**
 * One use case: both axes, the stale count, and every pending item.
 *
 * Laid out on `.promise-list__item`, the same two-track row the promise list uses,
 * so the ribbon reads as a list on the same sheet rather than as a second visual
 * language. It is keyed by `data-usecase` rather than by `data-promise`, which is
 * what keeps the two lists distinguishable to anything reading the DOM: a use case
 * is not a promise and the page must never let one be counted as the other.
 */
function CoverageRibbonRow({ row }: RowProps) {
  return (
    <li
      className="promise-list__item"
      data-usecase={row.id}
      data-risk={row.risk ?? 'unranked'}
    >
      <span className="promise-list__verdict">
        <span className="coverage-page__reason">{row.risk ?? 'risk not stated'}</span>
      </span>
      <div className="promise-list__body">
        <p className="promise-list__claim">{row.title.length === 0 ? row.id : row.title}</p>
        <p className="promise-list__meta">
          <span className="promise-list__id">{row.id}</span>
          <span className="promise-list__separator">·</span>
          <span className="promise-list__test" data-axis-label={RIBBON_DESIGN_LABEL}>
            {`designed ${renderPercent(row.designCompleteness.pct)}`}
            {row.designCompleteness.status === null
              ? ''
              : ` (${row.designCompleteness.status})`}
          </span>
          <span className="promise-list__separator">·</span>
          <span className="promise-list__test" data-axis-label={RIBBON_PROVEN_LABEL}>
            {`proven ${renderPercent(row.proven.pct)}`}
            {row.proven.status === null ? '' : ` (${row.proven.status})`}
          </span>
          <span className="promise-list__separator">·</span>
          <span className="promise-list__citation">
            {`stale acceptance criteria ${row.staleAcs === null ? WITHHELD : String(row.staleAcs)}`}
          </span>
        </p>
        {row.pending.length === 0 ? null : (
          <ul className="coverage-pending">
            {row.pending.map((item, index) => (
              <li
                className="coverage-pending__item"
                key={`${row.id}-${item.kind ?? 'pending'}-${String(index)}`}
              >
                <span className="coverage-pending__why">
                  {item.why ?? item.kind ?? 'outstanding'}
                </span>
                {item.stage === null && item.tag === null ? null : (
                  <span className="coverage-pending__stage">
                    {[item.stage, item.tag].filter((part) => part !== null).join(' · ')}
                  </span>
                )}
                {item.readyCommand === null ? null : (
                  /* Text. Not a button, not a link, no handler: the Ledger has no
                     mutating route and this string spends credits when a human runs
                     it in a terminal. `data-ready-command` is a handle for the test
                     that proves no control ever wraps it. */
                  <span className="coverage-page__reason" data-ready-command="text">
                    {item.readyCommand}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

export interface CoverageRibbonProps {
  /** From `snapshot.coverageAxes`. Null is the withheld state (R9.13). */
  readonly axes: SnapshotCoverageAxes | null;
  /** From `snapshot.degradedReasons`, quoted verbatim in the withheld state. */
  readonly degradedReasons: readonly string[];
  /** The rail's own figures, so the page can state both denominators (R9.15). */
  readonly promiseCounts: { readonly proven: number; readonly total: number };
}

export function CoverageRibbon({ axes, degradedReasons, promiseCounts }: CoverageRibbonProps) {
  const rows = axes?.rows ?? [];

  return (
    <section aria-labelledby="coverage-axes-heading">
      <h2 className="section-head" id="coverage-axes-heading">
        {axes === null
          ? 'Coverage against acceptance criteria'
          : `Coverage against acceptance criteria (${String(rows.length)} use cases)`}
      </h2>

      {/* The disambiguation R9.15 asks for, before either figure appears. Both
          denominators are named, and the sentence says outright that the two will
          disagree, so a reader who notices the difference has already been told
          why it is not a defect. */}
      <p className="page-standfirst">
        {'The rail above counts promises: '}
        <span className="coverage-page__figure">{promiseCounts.proven}</span>
        {' of '}
        <span className="coverage-page__figure">{promiseCounts.total}</span>
        {' promises this repository verified. This ribbon counts something else: acceptance '}
        {'criteria the assurance graph holds execution facts for, read from '}
        <span className="coverage-page__reason">kane-cli cover gaps</span>
        {'. Different denominators over different objects, so the two figures disagree without '}
        {'either being wrong. Every command below is text: this page runs nothing.'}
      </p>

      {axes === null ? (
        /* The one dashed border in the system marks a region that is specified and
           holding nothing (§10.10). Never a zero, and never an empty row list. */
        <div className="promise-list__empty" data-coverage-axes="withheld">
          <p className="promise-list__empty-lead">{AXES_WITHHELD_LEAD}</p>
          <p className="promise-list__empty-detail">
            {AXES_WITHHELD_DETAIL}
            {degradedReasons.length === 0 ? null : (
              <>
                {' Reason'}
                {degradedReasons.length === 1 ? ' ' : 's '}
                {degradedReasons.map((reason, index) => (
                  <span key={reason}>
                    {index === 0 ? '' : ', '}
                    <span className="coverage-page__reason">{reason}</span>
                  </span>
                ))}
                {'.'}
              </>
            )}
          </p>
        </div>
      ) : (
        <>
          <ul aria-label="coverage against acceptance criteria" className="coverage-axes">
            <AxisFigure
              detail="acceptance criteria bound to a designed scenario in the assurance graph"
              figure={renderPercent(axes.designCompleteness.pct)}
              label={RIBBON_DESIGN_LABEL}
              ratio={renderRatio(axes.designCompleteness.ratio)}
            />
            <AxisFigure
              detail={
                axes.proven.source === null
                  ? 'acceptance criteria the assurance graph holds execution facts for'
                  : `acceptance criteria with execution facts, counted from ${axes.proven.source} over ${axes.proven.denominatorBasis ?? 'the live criteria'}`
              }
              figure={renderPercent(axes.proven.pct)}
              label={RIBBON_PROVEN_LABEL}
              ratio={renderRatio(axes.proven.ratio)}
            />
            {/* The debt, given a figure of its own rather than folded into the two
                above. `1/9` is what the graph owes and it is not rounded away. */}
            <AxisFigure
              detail={
                axes.designCompleteness.ucsNeedingScenarios === null
                  ? 'use cases carrying at least one designed scenario'
                  : `${String(axes.designCompleteness.ucsNeedingScenarios)} use cases still owe a designed scenario`
              }
              figure={renderRatio(axes.designCompleteness.usecasesComplete)}
              label={RIBBON_USECASE_LABEL}
              ratio={
                axes.designCompleteness.ucsNeedingScenarios === null
                  ? RATIO_ABSENT
                  : `${String(axes.designCompleteness.ucsNeedingScenarios)} owed`
              }
            />
          </ul>

          {/* Note 3a, on the page rather than only in a document. A denominator a
              reader cannot interpret is not a published figure, it is a decoration.
              `.coverage-page__measured` is the existing statement block for prose that
              accounts for the figures above it, which is exactly what this is: no class
              is authored here and no stylesheet is added. */}
          <p className="coverage-page__measured" data-usecase-note="">
            {ribbonUsecaseNote(usecaseDuplication(rows))}
          </p>

          {/* Ordered by risk band then identifier upstream, in the projection, so
              this renders the snapshot's own order and sorts nothing (R9.12). */}
          <div className="promise-list-frame surface-raised">
            <ul className="promise-list">
              {rows.map((row) => (
                <CoverageRibbonRow key={row.id} row={row} />
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
