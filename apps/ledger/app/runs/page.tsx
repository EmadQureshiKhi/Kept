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
 * **An empty log is still a specified state.** When the committed snapshot carries
 * no runs the log says so precisely and connects it to the two other places the same
 * fact surfaces — the withheld proven figure and the `never verified` freshness chip.
 * Those three are one fact seen from three angles, and a page that shrugged here
 * would leave a reader to guess which. That state, and the log itself, are rendered
 * by `RunLog`.
 *
 * Snapshot-level diagnostics are rendered below the log, in full and verbatim,
 * whatever their code. Today that is where a reader finds the refusal quoted in the
 * upstream tool's own words, which is the reason the proven figure is withheld at
 * all.
 *
 * **This file stays a server component**: no hooks, no handlers, no props, and
 * `dynamic = 'force-static'` below. The log's filter needs `useState`, so the
 * interactive shell is `components/RunLog.tsx` — a `'use client'` module. That is the
 * whole of the boundary: the page still reads the snapshot, still owns the route's
 * metadata, and still owns every word of copy on it, because a `'use client'` module's
 * exports reach a server component as client references rather than as values.
 *
 * **The rows are rendered here, not there.** A `'use client'` module is the root of a
 * browser bundle and everything it imports is chunked for the browser, transitively —
 * and `RunRow` and `runVocabulary` both read the CLI-and-UI contract package, whose barrel
 * reaches modules that open files. So the page renders one `RunRow` per run and hands
 * the *elements* across as `rows`, alongside `facts` — `{ id, family, tone }` per run,
 * the three strings the two filter axes read — and `columns`. Server-rendered elements
 * serialise across the boundary already rendered, so the client component chooses which
 * rows to place while every line of code that decides what a row *says* stays here.
 * `facts` and `rows` are index-aligned, which is what the filter selects through.
 */

import type { Metadata } from 'next';

import { RunLog, type RunFact } from '../../components/RunLog.js';
import {
  NO_DIAGNOSTICS,
  NO_RUNS_DETAIL,
  NO_RUNS_HEADLINE,
  runOutcome,
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

/** The short name only; the root layout's template composes `KEPT · Runs`. */
export const metadata: Metadata = {
  title: 'Runs',
  description:
    'One entry per verification invocation: family, command, terminal event, exit meaning, ' +
    'and what the ledger was allowed to conclude from it.',
};

/**
 * How the log is ordered and how a detail row belongs to its run.
 *
 * **This used to be a `<caption>`, and that was a bug rather than a stylistic choice.** A
 * `<caption>` is part of the table box, so it lives *inside* whatever scrolls the table —
 * and `.runs-table-frame` scrolls in both axes. Scrolling down through the runs therefore
 * dragged this sentence up into view from inside the frame, under the sticky header, as if
 * it were a row of data. A sentence that slides around inside a grid of facts reads as a
 * rendering fault, and no amount of `caption-side` fixes it: the caption scrolls because
 * the table scrolls.
 *
 * So the sentence moved *out* of the scroll frame, above it, behind a `?` disclosure — see
 * `RUNS_TABLE_NOTE_LABEL` and the `.hint` block in `shell.css`. It is page copy now rather
 * than table furniture: static, in the flow, and impossible to scroll into the middle of
 * the log.
 *
 * The table did not lose its accessible name in the trade. It is `aria-labelledby` the
 * section heading — `Terminal events (n)` — which is a better name than this sentence ever
 * was: a name says *which* table, and this says how to read it.
 */
export const RUNS_TABLE_NOTE =
  'Newest first. One row per invocation; a run with members or diagnostics carries a ' +
  'detail row directly beneath its own, inside the same group.';

/**
 * The disclosure's accessible name.
 *
 * The badge renders a `?`, which is a shape rather than a name — a screen reader announcing
 * "question mark, collapsed" tells a reader nothing about what would open. So the summary
 * carries this instead, and the visible glyph stays the small circle the layout wants.
 */
export const RUNS_TABLE_NOTE_LABEL = 'How to read the terminal event log';

/**
 * The accessible name of the scroll region the table sits in.
 *
 * A scrollable region needs a name as well as a role, or a screen reader announces
 * "region" and leaves the reader to work out which one. It is deliberately short, and
 * deliberately different from the table's own name: the region is the thing that scrolls,
 * the table is the thing inside it.
 */
export const RUNS_TABLE_REGION_LABEL = 'terminal event log';

/**
 * The id the table borrows its accessible name from.
 *
 * It is on the `Terminal events (n)` heading, so the name a screen reader announces for the
 * table is the same string a sighted reader sees over it — and it carries the count, which
 * is what makes the name checkable against the rows beneath it.
 */
export const RUNS_TABLE_HEADING_ID = 'runs-terminal-events';

/**
 * The second line of the diagnostics empty state.
 *
 * `NO_DIAGNOSTICS` states the fact; this says what would put one here, so an empty
 * region reads as specified rather than broken (§10.10). Both lines are needed: a
 * lead line alone is a shrug, and a detail line alone buries the answer.
 */
export const NO_DIAGNOSTICS_DETAIL =
  'A diagnostic appears here when a run reports a reason for what it did — a refusal in ' +
  'the upstream tool\u2019s own words, a preflight rejection, a stream that did not parse. ' +
  'Nothing was reported at the snapshot level, and nothing is being withheld.';

export default function RunsPage() {
  const { runs, diagnostics } = snapshot;

  /* The filter's whole view of a run: its id, its family, and the tone `runOutcome`
     concludes — read through the same function `RunRow` puts in `data-tone`, so a filter
     option and the rows it selects can never disagree. Three strings, so nothing about
     the contract package crosses the client boundary. */
  const facts: readonly RunFact[] = runs.map((run) => ({
    id: run.id,
    family: run.family,
    tone: runOutcome(run).tone,
  }));

  /* Newest first, so the mark belongs to the first entry of the whole log. It is pinned
     here rather than in the client shell, which means a filter that excludes the newest
     run shows no mark at all instead of moving it to a run that is not the most recent. */
  const newestId = runs[0]?.id;
  const rows = runs.map((run) => (
    <RunRow key={run.id} newest={run.id === newestId} run={run} />
  ));

  return (
    <div className="runs-page">
      <header>
        {/* The title in its solid ink slab: the plane and the offset shadow from
            `.surface-slab-ink`, the box from `.page-title__slab`, the type ramp from
            `shell.css`'s `h1` clamp. */}
        <h1 className="runs-page__title">
          <span className="page-title__slab surface-slab-ink">Runs</span>
        </h1>
        <p className="page-standfirst">
          One entry per verification invocation. A run that did not reach the terminal event its
          command family ends with reports its outcome as unknown, never as a pass and never as a
          failure, and moves no verdict — which is the only reason a figure on this site can be
          trusted.
        </p>
      </header>

      {/* The log, and the one client boundary on this route. The heading, the filter bar,
          the labelled scroll frame and the table shell live in `RunLog` because the
          heading's count is state the moment a filter exists — see that file's header for
          the split. Everything crossing the boundary is a string, a plain object read out
          of the committed snapshot, or a row this file already rendered: nothing is
          fetched, and there is no handler behind the controls (R8.4, R8.6). */}
      <section>
        <RunLog
          columns={RUN_COLUMNS}
          emptyDetail={NO_RUNS_DETAIL}
          emptyHeadline={NO_RUNS_HEADLINE}
          facts={facts}
          headingId={RUNS_TABLE_HEADING_ID}
          note={RUNS_TABLE_NOTE}
          noteLabel={RUNS_TABLE_NOTE_LABEL}
          regionLabel={RUNS_TABLE_REGION_LABEL}
          rows={rows}
        />
      </section>

      <section>
        <h2 className="section-head">{`Diagnostics (${diagnostics.length})`}</h2>
        {diagnostics.length === 0 ? (
          <div className="runs-empty">
            <p className="runs-empty__headline">{NO_DIAGNOSTICS}</p>
            <p className="runs-empty__detail">{NO_DIAGNOSTICS_DETAIL}</p>
          </div>
        ) : (
          /* One solid sheet under the whole list. Twenty-nine recessed blocks with page
             showing between them read as debris; inside a `.surface-raised` frame they read
             as cells cut into one record. */
          <div className="runs-diagnostics surface-raised">
            {diagnostics.map((diagnostic, index) => (
              <DiagnosticBlock diagnostic={diagnostic} key={`${diagnostic.code}-${index}`} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
