/**
 * `RunLog` — the terminal-event log's interactive shell. Design §10.1, §10.8,
 * §10.10, §14.1, R8.4, R8.6, R10.7.
 *
 * The one client boundary on `/runs`, and the whole of it. `app/runs/page.tsx`
 * stays a server component exporting `dynamic = 'force-static'`: it reads the
 * committed snapshot, decides the page copy, renders the rows, and hands all three
 * to this component as props. Everything that needs `useState` lives here — two
 * `<select>`s and the count in the heading — and nothing else moved.
 *
 * ── This module imports react, one stylesheet, and nothing else ───────────────
 *
 * That is a hard rule rather than tidiness, and it is the reason the rows arrive as
 * elements. A `'use client'` module is the root of a browser bundle: every module it
 * reaches at runtime is chunked for the browser, transitively. `runVocabulary` and
 * `RunRow` both read the CLI-and-UI contract package at runtime, and that package's
 * barrel re-exports modules that open files — a Node built-in no browser chunk can
 * contain. Importing either of them from here therefore does not merely bloat the
 * bundle, it fails the build outright with a chunking error naming `node:fs`.
 *
 * So the boundary carries values instead of code. The server renders one `RunRow` per
 * run and passes the rendered elements down as `rows`; the vocabulary that decides a
 * run's outcome tone runs on the server too, and arrives as `facts` — three strings
 * per run, the only three either axis needs. The columns arrive the same way, as
 * `columns`. Passing server-rendered elements to a client component is ordinary App
 * Router practice: they serialise across the boundary already rendered, so this
 * component can choose *which* rows to place without holding any of the code that
 * decides what a row says.
 *
 * `facts` and `rows` are index-aligned — `facts[i]` describes `rows[i]` — which is
 * what lets the filter select rows without reading them.
 *
 * **The filter spends nothing and fetches nothing.** It is `Array.prototype.filter`
 * over data the server already handed down, so there is no request, no route, no
 * handler and no invocation behind it (R8.4, R8.6). A reader narrowing fifteen runs to
 * one is doing arithmetic in their own browser over data that was committed to the
 * repository.
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
 * The options are derived from the facts actually present: the command families are
 * the distinct `fact.family` values, and the outcome tones the distinct `fact.tone`
 * values — the same tone the server put in the row's `data-tone`, so a filter option
 * and the rows it selects can never disagree. A hardcoded list would offer a reader an
 * option that matches nothing, or hide a family the snapshot grew.
 *
 * A filter that yields nothing renders the dashed empty state of `runs.css` and names
 * what is selected (§10.10). An empty table under a heading reading `(0 of 15)` would
 * be the page implying the log is empty when it is the filter that is narrow.
 *
 * The `<tbody>` grouping, the sticky ink header, the labelled focusable scroll frame,
 * the `newest` mark and the table's accessible name are all unchanged — and all of
 * them are now decided on the server. This component decides which rows go in, and
 * nothing about how one is laid out.
 */

'use client';

import { useState, type ChangeEvent, type ReactNode } from 'react';

import '../styles/runs.css';

/**
 * What the filter needs to know about a run, and the whole of it.
 *
 * Three strings, declared here rather than imported: the shape is small enough to
 * state, and stating it is what keeps this module free of the contract package the
 * server reads. The server derives `tone` through the same function that put it in
 * the row's `data-tone`, so the fact and the row it describes cannot drift.
 */
export interface RunFact {
  readonly id: string;
  readonly family: string;
  readonly tone: string;
}

/** One column of the log. The array arrives as a prop, for the same reason. */
export interface RunColumn {
  readonly key: string;
  readonly label: string;
  readonly numeric: boolean;
}

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

/** The command families present, sorted. Derived from the facts, never declared. */
export function familyOptions(facts: readonly RunFact[]): readonly string[] {
  return [...new Set<string>(facts.map((fact) => fact.family))].sort();
}

/**
 * The outcome tones present, sorted.
 *
 * A tone is a conclusion about a run rather than a value the run reports, which is why
 * it is decided by the vocabulary on the server and arrives here as a fact.
 */
export function toneOptions(facts: readonly RunFact[]): readonly string[] {
  return [...new Set<string>(facts.map((fact) => fact.tone))].sort();
}

/** Whether both axes admit one run. `EVERY` on an axis admits everything on it. */
function admits(fact: RunFact, family: string, tone: string): boolean {
  return (family === EVERY || fact.family === family) && (tone === EVERY || fact.tone === tone);
}

/** The runs both axes admit. */
export function filterRuns(
  facts: readonly RunFact[],
  family: string,
  tone: string,
): readonly RunFact[] {
  return facts.filter((fact) => admits(fact, family, tone));
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
  /** One per run, index-aligned with `rows`: the three strings the two axes read. */
  readonly facts: readonly RunFact[];
  /** The rows, rendered on the server. One `<tbody>` each; already keyed. */
  readonly rows: readonly ReactNode[];
  /** The columns, in the order design §10.1 lists the fields. */
  readonly columns: readonly RunColumn[];
  /** The heading's `id`; the table borrows its accessible name from it. */
  readonly headingId: string;
  /** The scroll region's accessible name. */
  readonly regionLabel: string;
  /** The log's reading note, and the accessible name of the `?` that holds it. */
  readonly note: string;
  readonly noteLabel: string;
  /** The two lines an empty log says, decided by the page. */
  readonly emptyHeadline: string;
  readonly emptyDetail: string;
}

export function RunLog({
  facts,
  rows,
  columns,
  headingId,
  regionLabel,
  note,
  noteLabel,
  emptyHeadline,
  emptyDetail,
}: RunLogProps) {
  const [family, setFamily] = useState<string>(EVERY);
  const [tone, setTone] = useState<string>(EVERY);

  const chooseFamily = (event: ChangeEvent<HTMLSelectElement>): void => {
    setFamily(event.target.value);
  };
  const chooseTone = (event: ChangeEvent<HTMLSelectElement>): void => {
    setTone(event.target.value);
  };

  const filtered = isFiltered(family, tone);
  /* Selected by position, because `facts[i]` describes `rows[i]`: the filter reads the
     facts and places the matching elements untouched. The `newest` mark is already
     inside those elements, pinned by the server to the first entry of the whole log
     rather than to whichever row happens to be at the top of a view — so it disappears
     under a filter that excludes it instead of migrating to a run that is not the most
     recent. */
  const shown = rows.filter((_row, index) => {
    const fact = facts[index];
    return fact !== undefined && admits(fact, family, tone);
  });

  return (
    <>
      {/* The heading and the `?` share one line and one 3px rule (`.section-head-line` in
          `shell.css`). The `<details>` stays outside the scroll frame below: its panel is
          absolutely positioned, and an absolutely positioned panel inside a scroll
          container is clipped by it. */}
      <div className="section-head-line">
        <h2 className="section-head" id={headingId}>
          {terminalEventsHeading(shown.length, facts.length, filtered)}
        </h2>
        <details className="hint">
          <summary aria-label={noteLabel} className="hint__summary">
            ?
          </summary>
          <div className="hint__panel surface-raised-2">{note}</div>
        </details>
      </div>

      {facts.length === 0 ? (
        /* No `.surface-well` here: an empty region is marked by the one dashed border in
           the system rather than by depth, so "specified and empty" looks the same on
           every page (§10.10). */
        <div className="runs-empty">
          <p className="runs-empty__headline">{emptyHeadline}</p>
          <p className="runs-empty__detail">{emptyDetail}</p>
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
                {familyOptions(facts).map((option) => (
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
                {toneOptions(facts).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            {/* The heading's count changes without saying so, which is silent to a screen
                reader. This is the same fact in a live region. */}
            <p aria-live="polite" className="runs-filter__status" role="status">
              {filterStatus(shown.length, facts.length)}
            </p>
          </div>

          {shown.length === 0 ? (
            /* The same dashed treatment as an empty log, saying a different thing: the
               log is not empty, this filter is. */
            <div className="runs-empty">
              <p className="runs-empty__headline">{NO_MATCH_HEADLINE}</p>
              <p className="runs-empty__detail">{noMatchDetail(family, tone, facts.length)}</p>
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
                    {columns.map((column) => (
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
                {/* One `<tbody>` per run, emitted on the server by `RunRow` — see its
                    header for why the grouping is what makes the banding honest. */}
                {shown}
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
