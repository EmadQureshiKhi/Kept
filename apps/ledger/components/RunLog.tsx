/**
 * `RunLog` — the terminal-event log's interactive shell. Design §10.1, §10.8,
 * §10.10, §14.1, R8.4, R8.6, R10.7.
 *
 * The one client boundary on `/runs`, and the whole of it. `app/runs/page.tsx`
 * stays a server component exporting `dynamic = 'force-static'`: it reads the
 * committed snapshot, decides the page copy, and hands both to this component as
 * props. Everything that needs `useState` lives here — two `<select>`s and the
 * count in the heading — and nothing else moved.
 *
 * **The filter spends nothing and fetches nothing.** It is `Array.prototype.filter`
 * over an array the server already handed down, so there is no request, no route,
 * no handler and no invocation behind it (R8.4, R8.6). A reader narrowing fifteen
 * runs to one is doing arithmetic in their own browser over data that was committed
 * to the repository.
 *
 * ── Why the heading is in here, and the copy is not ───────────────────────────
 *
 * The heading carries the count, and under a filter the count is state — so
 * `Terminal events (4 of 15)` cannot be rendered by a server component. The heading
 * therefore moved across the boundary with the controls that change it, and it keeps
 * its `id` so the table's `aria-labelledby` still resolves to the words a sighted
 * reader sees over it.
 *
 * The *strings* did not move. A `'use client'` module's exports arrive in a server
 * component as client references rather than as values, so copy declared here could
 * not be read by the page, by the route's metadata, or by anything else on the
 * server. It stays in `page.tsx` and travels as props, which also keeps one file
 * answering "what does this page say".
 *
 * ── Two axes, and neither of them is a list this file knows ───────────────────
 *
 * The options are derived from the runs actually present: the command families are
 * the distinct `run.family` values, and the outcome tones are the distinct
 * `runOutcome(run).tone` values — the same function `RunRow` puts in `data-tone`, so
 * a filter option and the rows it selects can never disagree. A hardcoded list would
 * offer a reader an option that matches nothing, or hide a family the snapshot grew.
 *
 * A filter that yields nothing renders the dashed empty state of `runs.css` and names
 * what is selected (§10.10). An empty table under a heading reading `(0 of 15)` would
 * be the page implying the log is empty when it is the filter that is narrow.
 *
 * `RunRow` is imported from beside the route rather than the other way round: it is
 * the route's own row and has no second consumer, and this component is under
 * `components/` because it is the one thing on the page that has to be a client
 * module. The `<tbody>` grouping, the sticky ink header, the labelled focusable
 * scroll frame and the table's accessible name are all unchanged — this component
 * decides which runs go in, and nothing about how one is laid out.
 */

'use client';

import { useState, type ChangeEvent } from 'react';
import type { SnapshotRun } from '@kept/core';

import { NO_RUNS_DETAIL, NO_RUNS_HEADLINE, runOutcome } from '../lib/runVocabulary.js';

import { RUN_COLUMNS, RunRow } from '../app/runs/RunRow.js';

import '../styles/runs.css';

/** The value of "do not narrow this axis". Empty, so it is never a family or a tone. */
export const EVERY = '';

/** The first option on each axis. Named for the axis, so the pair reads as a sentence. */
export const EVERY_FAMILY_OPTION = 'every family';
export const EVERY_TONE_OPTION = 'every outcome';

/** Each `<select>` has a real `<label>`, and these are the words in it. */
export const FAMILY_FILTER_LABEL = 'command family';
export const TONE_FILTER_LABEL = 'outcome';

/** The ids the two labels point at. Stated once, so a label cannot drift off its control. */
export const FAMILY_FILTER_ID = 'runs-filter-family';
export const TONE_FILTER_ID = 'runs-filter-tone';

/** What the first row of a newest-first log is marked with. */
export const NEWEST_LABEL = 'newest';

/** The command families present, sorted. Derived from the runs, never declared. */
export function familyOptions(runs: readonly SnapshotRun[]): readonly string[] {
  return [...new Set<string>(runs.map((run) => run.family))].sort();
}

/**
 * The outcome tones present, sorted.
 *
 * Read through `runOutcome` rather than off a field, because a tone is a conclusion
 * about a run and not a value the run reports — which is the same reason `RunRow`
 * reads it that way for `data-tone`.
 */
export function toneOptions(runs: readonly SnapshotRun[]): readonly string[] {
  return [...new Set<string>(runs.map((run) => runOutcome(run).tone))].sort();
}

/** The runs both axes admit. `EVERY` on an axis admits everything on it. */
export function filterRuns(
  runs: readonly SnapshotRun[],
  family: string,
  tone: string,
): readonly SnapshotRun[] {
  return runs.filter(
    (run) =>
      (family === EVERY || run.family === family) &&
      (tone === EVERY || runOutcome(run).tone === tone),
  );
}

/** `true` when either axis is narrowed. */
export function isFiltered(family: string, tone: string): boolean {
  return family !== EVERY || tone !== EVERY;
}

/**
 * The section heading, and the reason it is a function.
 *
 * `Terminal events (15)` is the whole log; `Terminal events (4 of 15)` is a view of
 * it. The two are distinguished by whether a filter is set rather than by whether
 * the counts differ, so a filter that happens to admit every run still says so —
 * `15 of 15` is a true statement about a narrowed log, and a bare `15` would not be.
 */
export function terminalEventsHeading(shown: number, total: number, filtered: boolean): string {
  return filtered ? `Terminal events (${shown} of ${total})` : `Terminal events (${total})`;
}

/** The axes in force, in words, for the empty state and the live region. */
export function activeFilterSentence(family: string, tone: string): string {
  const axes: string[] = [];
  if (family !== EVERY) axes.push(`command family ${family}`);
  if (tone !== EVERY) axes.push(`outcome ${tone}`);
  return axes.join(' and ');
}

/** The lead line of the zero-result state. The fact, and nothing else. */
export const NO_MATCH_HEADLINE = 'No run matches this filter.';

/**
 * The second line: which filter is in force, and how to leave it.
 *
 * A filter must never read as an empty log, so the total is restated here — the
 * reader is told how many runs the log holds *and* what is currently selecting none
 * of them.
 */
export function noMatchDetail(family: string, tone: string, total: number): string {
  return (
    `The log holds ${total} recorded runs and none of them is a match for ` +
    `${activeFilterSentence(family, tone)}. Nothing has been hidden or withheld: set both ` +
    `controls back to ${EVERY_FAMILY_OPTION} and ${EVERY_TONE_OPTION} to read the whole log.`
  );
}

/** What the live region says when the count changes, since a heading changes silently. */
export function filterStatus(shown: number, total: number): string {
  return `Showing ${shown} of ${total} recorded runs.`;
}

export interface RunLogProps {
  readonly runs: readonly SnapshotRun[];
  /** The heading's `id`; the table borrows its accessible name from it. */
  readonly headingId: string;
  /** The scroll region's accessible name. */
  readonly regionLabel: string;
  /** The log's reading note, and the accessible name of the `?` that holds it. */
  readonly note: string;
  readonly noteLabel: string;
}

export function RunLog({ runs, headingId, regionLabel, note, noteLabel }: RunLogProps) {
  const [family, setFamily] = useState<string>(EVERY);
  const [tone, setTone] = useState<string>(EVERY);

  const chooseFamily = (event: ChangeEvent<HTMLSelectElement>): void => {
    setFamily(event.target.value);
  };
  const chooseTone = (event: ChangeEvent<HTMLSelectElement>): void => {
    setTone(event.target.value);
  };

  const filtered = isFiltered(family, tone);
  const shown = filterRuns(runs, family, tone);
  /* The newest run is the newest run, filtered or not: the marker is pinned to the
     first entry of the whole log rather than to whichever row happens to be at the
     top of a view. So it disappears under a filter that excludes it instead of
     migrating to a run that is not the most recent. */
  const newestId = runs[0]?.id;

  return (
    <>
      {/* The heading and the `?` share one line and one 3px rule (`.section-head-line` in
          `shell.css`). The `<details>` stays outside the scroll frame below: its panel is
          absolutely positioned, and an absolutely positioned panel inside a scroll
          container is clipped by it. */}
      <div className="section-head-line">
        <h2 className="section-head" id={headingId}>
          {terminalEventsHeading(shown.length, runs.length, filtered)}
        </h2>
        <details className="hint">
          <summary aria-label={noteLabel} className="hint__summary">
            ?
          </summary>
          <div className="hint__panel surface-raised-2">{note}</div>
        </details>
      </div>

      {runs.length === 0 ? (
        /* No `.surface-well` here: an empty region is marked by the one dashed border in
           the system rather than by depth, so "specified and empty" looks the same on
           every page (§10.10). */
        <div className="runs-empty">
          <p className="runs-empty__headline">{NO_RUNS_HEADLINE}</p>
          <p className="runs-empty__detail">{NO_RUNS_DETAIL}</p>
        </div>
      ) : (
        <>
          {/* The filter bar: a paper slab above the table, one labelled control per axis.
              Both are native `<select>`s, so they are keyboard operable and announced as
              controls without a line of `aria`, and the shell's focus ring lands on them
              for free. */}
          <div className="runs-filter surface-raised">
            <div className="runs-filter__field">
              <label htmlFor={FAMILY_FILTER_ID}>{FAMILY_FILTER_LABEL}</label>
              <select
                className="runs-filter__select"
                id={FAMILY_FILTER_ID}
                onChange={chooseFamily}
                value={family}
              >
                <option value={EVERY}>{EVERY_FAMILY_OPTION}</option>
                {familyOptions(runs).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div className="runs-filter__field">
              <label htmlFor={TONE_FILTER_ID}>{TONE_FILTER_LABEL}</label>
              <select
                className="runs-filter__select"
                id={TONE_FILTER_ID}
                onChange={chooseTone}
                value={tone}
              >
                <option value={EVERY}>{EVERY_TONE_OPTION}</option>
                {toneOptions(runs).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            {/* The heading's count changes without saying so, which is silent to a screen
                reader. This is the same fact in a live region. */}
            <p aria-live="polite" className="runs-filter__status" role="status">
              {filterStatus(shown.length, runs.length)}
            </p>
          </div>

          {shown.length === 0 ? (
            /* The same dashed treatment as an empty log, saying a different thing: the
               log is not empty, this filter is. */
            <div className="runs-empty">
              <p className="runs-empty__headline">{NO_MATCH_HEADLINE}</p>
              <p className="runs-empty__detail">{noMatchDetail(family, tone, runs.length)}</p>
            </div>
          ) : (
            /* A labelled, focusable scroll region, unchanged from before the filter
               existed: the frame bounds the log in both axes, which is what makes the
               sticky header a header, and a bounded scroller a keyboard cannot reach is a
               region only a pointer can read (§10.8, R10.7). */
            <div
              aria-label={regionLabel}
              className="runs-table-frame surface-raised"
              role="region"
              tabIndex={0}
            >
              {/* No `<caption>`: it scrolled with the table. The name comes from the
                  section heading above the frame instead. */}
              <table aria-labelledby={headingId} className="runs-table">
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
                {/* One `<tbody>` per run, emitted by `RunRow` — see its header for why the
                    grouping is what makes the banding honest. */}
                {shown.map((run) => (
                  <RunRow key={run.id} newest={run.id === newestId} run={run} />
                ))}
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
