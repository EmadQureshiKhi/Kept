/**
 * `/runs`, rendered — design §10.1, §10.7, §14.1, R4.9, R4.11, R5.3.
 *
 * Three halves, and the middle one is the point of the page.
 *
 * The **empty** half is no longer the live path: since 15.6 the committed snapshot
 * projects a real log off the persisted handoffs, so the route renders a table and
 * the empty state is what a repository sees on its first build. It is still asserted
 * to state the fact rather than shrug, and to keep saying so with a stylesheet's
 * worth of colour taken away, since jsdom applies none of the CSS.
 *
 * The **populated** half renders `RunRow` against runs constructed here, one per
 * row of §14.1. Stage 15 fills this page with real recorded runs and it has to
 * render them right the first time, so the words the vocabulary chooses are checked
 * as DOM text and not only as return values: a run that crashed says
 * `outcome unknown`, a paused assurance run says `paused, resumable`, a refusal
 * quotes the tool's own message unedited, and nothing that failed to reach a
 * terminal event carries a word that claims an outcome.
 *
 * The **verbatim** half checks that quoting is not editing: the fenced command in
 * an unresolved-source diagnostic reaches the DOM intact and both ids of a fork
 * survive to the page. A truncated message on this page would be worse than no
 * message, because a reviewer would act on the half they were shown.
 *
 * The **filter** half is driven against runs constructed here rather than against the
 * committed snapshot, and that is a fact about the snapshot rather than a shortcut: it
 * holds seventeen runs of one family with one outcome tone, so a filter exercised on it
 * could only prove that selecting the single option keeps every row. The two things a
 * filter must never do are checked instead — narrowing to nothing renders the dashed
 * empty state naming what is selected, and the heading's count follows the view rather
 * than the log. Every row's anchor and the `newest` mark are checked against the real
 * page, because those are claims about the committed data.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { CommandFamily, ExitMeaning, SnapshotDiagnostic, SnapshotRun } from 'kept-core';
import { SnapshotRunSchema, contractFor } from 'kept-core';
import { afterEach, describe, expect, it } from 'vitest';

import { DiagnosticBlock } from '../app/runs/DiagnosticBlock.js';
import {
  NEWEST_LABEL,
  NOT_REPORTED,
  RUN_COLUMNS,
  RunRow,
  detailSummary,
} from '../app/runs/RunRow.js';
import RunsPage, {
  NO_DIAGNOSTICS_DETAIL,
  RUNS_TABLE_HEADING_ID,
  RUNS_TABLE_NOTE,
  RUNS_TABLE_NOTE_LABEL,
  RUNS_TABLE_REGION_LABEL,
  dynamic,
} from '../app/runs/page.js';
import {
  EVERY,
  FAMILY_FILTER_ID,
  FAMILY_FILTER_LABEL,
  NO_MATCH_HEADLINE,
  RunLog,
  TONE_FILTER_ID,
  TONE_FILTER_LABEL,
} from '../components/RunLog.js';
import {
  NO_DIAGNOSTICS,
  NO_RUNS_DETAIL,
  NO_RUNS_HEADLINE,
  OUTCOME_UNKNOWN,
  PAUSED_RESUMABLE,
  RECONCILE_FORKED_CODE,
  RECONCILE_UNRESOLVED_CODE,
  REFUSED_STATUS,
  TIMED_OUT,
  runOutcome,
} from '../lib/runVocabulary.js';
import { snapshot } from '../lib/snapshot.js';

/** The ledger project shares one jsdom across suites, so unmount explicitly. */
afterEach(cleanup);

const AT = '2026-08-20T16:17:09.800Z';

interface RunDraft {
  readonly id?: string;
  readonly family?: CommandFamily;
  readonly command?: string;
  readonly exitCode?: number | null;
  readonly exitMeaning: ExitMeaning;
  readonly terminalSeen?: boolean;
  readonly status?: string | null;
  readonly resultCode?: number | null;
  readonly credits?: number | null;
  readonly members?: SnapshotRun['members'];
  readonly diagnostics?: SnapshotRun['diagnostics'];
}

function makeRun(draft: RunDraft): SnapshotRun {
  const family: CommandFamily = draft.family ?? 'Assurance';
  const terminalSeen = draft.terminalSeen ?? false;
  return SnapshotRunSchema.parse({
    id: draft.id ?? 'tr_20260820T161709Z',
    family,
    command: draft.command ?? 'cover --json',
    startedAt: AT,
    endedAt: '2026-08-20T16:19:41.200Z',
    durationMs: 151_400,
    exitCode: draft.exitCode === undefined ? 0 : draft.exitCode,
    exitMeaning: draft.exitMeaning,
    terminalSeen,
    terminalEventType: terminalSeen ? contractFor(family).terminalType : null,
    status: draft.status === undefined ? null : draft.status,
    resultCode: draft.resultCode === undefined ? null : draft.resultCode,
    reasonCode: null,
    credits: draft.credits === undefined ? null : draft.credits,
    verdictObject: null,
    evidencePackId: null,
    members: draft.members ?? [],
    diagnostics: draft.diagnostics ?? [],
  });
}

function makeDiagnostic(
  code: string,
  message: string,
  severity: SnapshotDiagnostic['severity'] = 'warn',
): SnapshotDiagnostic {
  return { code, severity, message, file: null, line: null, at: AT };
}

/**
 * One run, in the table it belongs to — a `<tr>` outside one is not valid DOM.
 *
 * `RunRow` supplies its own `<tbody>`: one group per run, so that `runs.css` can band
 * and highlight a run *and its detail row* as one object. So the helper renders it as
 * a direct child of `<table>` rather than nesting it inside a `<tbody>` of its own.
 */
function renderRow(run: SnapshotRun) {
  return render(
    <table>
      <RunRow run={run} />
    </table>,
  );
}

/**
 * The log's interactive shell, given exactly what the page gives it.
 *
 * `RunLog` is the route's one client component, and nothing that reaches the CLI-and-UI
 * contract package may be imported by it: a client module is the root of a browser
 * bundle, and that package's barrel reaches modules that open files. So the page
 * renders the rows itself and passes the *elements* across, alongside one
 * `{ id, family, tone }` fact per run — index-aligned with the rows — the columns, and
 * the copy. This helper does the same, which is what keeps it a test of the boundary
 * the route actually has.
 *
 * Rendering it directly is what lets the filter be exercised against runs constructed
 * here: the committed snapshot happens to hold one family and one outcome tone, so a
 * filter test driven off it could only ever prove that selecting the single option
 * keeps all fifteen rows.
 */
function renderLog(runs: readonly SnapshotRun[]) {
  const newestId = runs[0]?.id;
  return render(
    <RunLog
      columns={RUN_COLUMNS}
      emptyDetail={NO_RUNS_DETAIL}
      emptyHeadline={NO_RUNS_HEADLINE}
      facts={runs.map((run) => ({
        id: run.id,
        family: run.family,
        tone: runOutcome(run).tone,
      }))}
      headingId={RUNS_TABLE_HEADING_ID}
      note={RUNS_TABLE_NOTE}
      noteLabel={RUNS_TABLE_NOTE_LABEL}
      regionLabel={RUNS_TABLE_REGION_LABEL}
      rows={runs.map((run) => (
        <RunRow key={run.id} newest={run.id === newestId} run={run} />
      ))}
    />,
  );
}

/** Two families and three tones, so both axes have something to narrow. */
const MIXED_RUNS: readonly SnapshotRun[] = [
  makeRun({
    id: 'tr_failed',
    family: 'ExecutionTestrun',
    exitCode: 1,
    exitMeaning: 'failure',
    terminalSeen: true,
    status: 'failed',
  }),
  makeRun({
    id: 'tr_paused',
    family: 'Assurance',
    exitCode: 3,
    exitMeaning: 'paused-resumable',
    terminalSeen: true,
    status: 'paused',
  }),
  makeRun({
    id: 'tr_complete',
    family: 'Assurance',
    exitCode: 0,
    exitMeaning: 'success',
    terminalSeen: true,
  }),
];

/** A `<select>`, changed the way a reader changes one. */
function choose(select: HTMLSelectElement | null, value: string): void {
  expect(select, 'the control is not in the document').not.toBeNull();
  act(() => {
    fireEvent.change(select as HTMLSelectElement, { target: { value } });
  });
}

function control(container: HTMLElement, id: string): HTMLSelectElement | null {
  return container.querySelector<HTMLSelectElement>(`#${id}`);
}

function headingText(container: HTMLElement): string {
  return container.querySelector(`#${RUNS_TABLE_HEADING_ID}`)?.textContent ?? '';
}

/* ─────────────────────── the log, now that it has entries ──────────────────── */

describe('/runs — the recorded terminal events', () => {
  it('renders one row per recorded run, with the empty state gone', () => {
    // The invitation the previous version of this test left — "the committed
    // snapshot has gained runs — good, widen this" — was taken up in 15.6, when
    // `kept snapshot` began projecting `/runs` off the persisted handoffs.
    expect(snapshot.runs.length).toBeGreaterThan(0);
    const { container, unmount } = render(<RunsPage />);
    const text = container.textContent ?? '';

    expect(text).not.toContain(NO_RUNS_HEADLINE);
    expect(text).not.toContain(NO_RUNS_DETAIL);
    expect(text).toContain(`Terminal events (${snapshot.runs.length})`);
    expect(container.querySelector('.runs-table'), 'a table for a populated log').not.toBeNull();
    expect(container.querySelectorAll('.runs-table__row')).toHaveLength(snapshot.runs.length);
    /* one group per run, so the banding and the hover tint cover a run and its detail
       as one object rather than striping the two apart */
    expect(container.querySelectorAll('.runs-table__group')).toHaveLength(snapshot.runs.length);
    /* The frame is the scroll container, so seven columns never overflow the page —
       and a bounded scroller has to be reachable and named, or it is a region of the
       document only a pointer can read (§10.8, R10.7). */
    const frame = container.querySelector('.runs-table-frame');
    expect(frame, 'the table is not inside a scroll frame').not.toBeNull();
    expect(frame?.classList.contains('surface-raised')).toBe(true);
    expect(frame?.getAttribute('role')).toBe('region');
    expect(frame?.getAttribute('aria-label')).toBe(RUNS_TABLE_REGION_LABEL);
    expect(frame?.getAttribute('tabindex')).toBe('0');
    for (const run of snapshot.runs) {
      expect(text, `${run.id} is not on the page`).toContain(run.command);
      // A figure the run never reported reads `not reported`, never `0`.
      if (run.durationMs === null) expect(text).toContain(NOT_REPORTED);
    }
    unmount();
  });

  /**
   * The caption that scrolled, and the two halves of the fix.
   *
   * A `<caption>` is part of the table box, so it scrolls with the table — and this table
   * is inside a frame that scrolls in both axes, which is how a sentence of prose came to
   * slide up into the middle of the log under the sticky header. Both halves are asserted
   * here rather than trusted:
   *
   *   1. **the sentence is out of the scroll frame.** Not merely "no caption element" —
   *      that would still pass if the words were moved to another element *inside* the
   *      frame, which is the same bug with a different tag. So the frame's own subtree is
   *      searched for the words and required not to contain them, and the disclosure that
   *      does hold them is required to be outside it;
   *   2. **the table still has an accessible name.** Removing a caption removes a name, and
   *      an unnamed table is a regression in exactly the population that could not see the
   *      caption move. The name is `aria-labelledby` the section heading, and the id is
   *      resolved rather than compared: an `aria-labelledby` pointing at nothing is worse
   *      than no attribute, because it presents as done.
   */
  it('keeps the log note out of the scroll frame and still names the table', () => {
    const { container, unmount } = render(<RunsPage />);

    /* the words are on the page, and nowhere inside the thing that scrolls */
    expect(container.textContent).toContain(RUNS_TABLE_NOTE);
    const frame = container.querySelector('.runs-table-frame');
    expect(frame).not.toBeNull();
    expect(
      frame?.textContent,
      'the note is back inside the scroll frame, so it will scroll into the log again',
    ).not.toContain(RUNS_TABLE_NOTE);
    expect(
      container.querySelector('caption'),
      'a caption is part of the table box and scrolls with it',
    ).toBeNull();

    /* it is a native disclosure, focusable and named without a line of JavaScript */
    const hint = container.querySelector('details.hint');
    expect(hint, 'the note is not behind a disclosure').not.toBeNull();
    expect(hint?.tagName).toBe('DETAILS');
    expect(frame?.contains(hint ?? null), 'the disclosure is inside the scroller').toBe(false);
    const summary = hint?.querySelector('summary');
    expect(summary?.getAttribute('aria-label')).toBe(RUNS_TABLE_NOTE_LABEL);
    expect(summary?.textContent).toBe('?');
    expect(hint?.querySelector('.hint__panel')?.textContent).toBe(RUNS_TABLE_NOTE);

    /* and the table's name resolves to the heading a sighted reader sees over it */
    const table = container.querySelector('.runs-table');
    const labelledBy = table?.getAttribute('aria-labelledby');
    expect(labelledBy, 'the table lost its accessible name with its caption').toBe(
      RUNS_TABLE_HEADING_ID,
    );
    const heading = container.querySelector(`#${RUNS_TABLE_HEADING_ID}`);
    expect(heading, 'aria-labelledby points at nothing, so the table has no name').not.toBeNull();
    expect(heading?.textContent).toBe(`Terminal events (${snapshot.runs.length})`);

    unmount();
  });

  it('says nothing about the furniture: the scroll hint sentence is gone', () => {
    /* "The log scrolls sideways and down; the column headings stay put." described the box
       rather than the data. The affordance is the frame's own treatment now — a reserved
       scrollbar gutter, the ink border, the sticky header and the region's focus ring — so
       the sentence is asserted absent rather than merely deleted, and the table sits
       directly under the heading rule with nothing between them. */
    const { container, unmount } = render(<RunsPage />);
    const text = container.textContent ?? '';
    expect(text).not.toContain('scrolls sideways');
    expect(text).not.toContain('the column headings stay put');
    expect(container.querySelector('.runs-page__hint')).toBeNull();

    const line = container.querySelector('.section-head-line');
    expect(line, 'the heading and its disclosure do not share a line').not.toBeNull();
    /* One thing now stands between the heading rule and the table, and it is the filter
       bar rather than a sentence about scrolling: an instrument, not a description of the
       furniture. Nothing else is admitted between them. */
    const filter = line?.nextElementSibling;
    expect(filter?.classList.contains('runs-filter'), 'the filter bar is not under the heading rule').toBe(
      true,
    );
    expect(
      filter?.nextElementSibling?.classList.contains('runs-table-frame'),
      'something stands between the filter bar and the table',
    ).toBe(true);
    unmount();
  });

  it('still renders the snapshot-level diagnostics, refusal and all', () => {
    const { container, unmount } = render(<RunsPage />);
    const text = container.textContent ?? '';

    expect(snapshot.diagnostics.length).toBeGreaterThan(0);
    expect(text).toContain(`Diagnostics (${snapshot.diagnostics.length})`);
    for (const diagnostic of snapshot.diagnostics) {
      expect(text, `${diagnostic.code} is not on the page`).toContain(diagnostic.code);
      /* the message reaches the DOM with only its fences removed */
      expect(text).toContain(diagnostic.message.split('`').join(''));
    }
    unmount();
  });

  it('keeps a two-line empty state ready for a snapshot that reports none', () => {
    /* The committed snapshot carries diagnostics, so this path is not rendered today.
       The copy still has to exist and still has to be two lines: a lead line that
       states the fact and a lighter one that says what would put a diagnostic here.
       A lead line alone is a shrug, and a detail line alone buries the answer. */
    expect(NO_DIAGNOSTICS.length).toBeGreaterThan(0);
    expect(NO_DIAGNOSTICS_DETAIL).not.toBe(NO_DIAGNOSTICS);
    expect(NO_DIAGNOSTICS_DETAIL.length).toBeGreaterThan(NO_DIAGNOSTICS.length);
  });

  it('is a static render with no props, and keeps its client boundary in one component', () => {
    /* `dynamic` is the only route-segment config the page exports, and it is the
       static one. A page that quietly became dynamic would still render here, so
       the claim is asserted rather than assumed (§10.1, R8.6).

       The filter needs `useState`, and the temptation the filter creates is to make this
       page a client component. It is not one: the interactive shell is `RunLog`, and the
       page still takes no props, so it can still take no request. */
    expect(RunsPage.length, 'the page takes no props, so it can take no request').toBe(0);
    expect(dynamic).toBe('force-static');
  });
});

/* ──────────────── the filter, and the anchors that make a run linkable ─────── */

describe('/runs — the log can be narrowed, and never lies while narrowed', () => {
  it('offers only the families and tones the runs carry, and narrows the rows to them', () => {
    const { container, unmount } = renderLog(MIXED_RUNS);

    /* Both option lists are derived from the runs, so an option can never select
       nothing and a family the snapshot grew cannot go missing. */
    const family = control(container, FAMILY_FILTER_ID);
    const tone = control(container, TONE_FILTER_ID);
    expect([...(family?.options ?? [])].map((option) => option.value)).toEqual([
      EVERY,
      'Assurance',
      'ExecutionTestrun',
    ]);
    expect([...(tone?.options ?? [])].map((option) => option.value)).toEqual([
      EVERY,
      'complete',
      'failed',
      'paused',
    ]);

    /* unfiltered: the plain count, and every run */
    expect(headingText(container)).toBe('Terminal events (3)');
    expect(container.querySelectorAll('.runs-table__row')).toHaveLength(3);

    /* one axis */
    choose(family, 'Assurance');
    expect(headingText(container)).toBe('Terminal events (2 of 3)');
    expect([...container.querySelectorAll('.runs-table__row')].map((row) => row.id)).toEqual([
      'tr_paused',
      'tr_complete',
    ]);

    /* and both, down to the single run that satisfies them */
    choose(tone, 'paused');
    expect(headingText(container)).toBe('Terminal events (1 of 3)');
    const rows = container.querySelectorAll('.runs-table__row');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('tr_paused');
    /* the table survives the filter: same grouping, same sticky header, same name */
    expect(container.querySelectorAll('.runs-table__group')).toHaveLength(1);
    expect(container.querySelector('.runs-table')?.getAttribute('aria-labelledby')).toBe(
      RUNS_TABLE_HEADING_ID,
    );
    expect(container.querySelectorAll('.runs-table__head-cell')).toHaveLength(RUN_COLUMNS.length);

    unmount();
  });

  it('renders the dashed empty state, naming the filter, rather than an empty table', () => {
    const { container, unmount } = renderLog(MIXED_RUNS);
    /* no run is an ExecutionTestrun that paused, so this combination selects nothing */
    choose(control(container, FAMILY_FILTER_ID), 'ExecutionTestrun');
    choose(control(container, TONE_FILTER_ID), 'paused');

    expect(container.querySelectorAll('.runs-table__row')).toHaveLength(0);
    expect(
      container.querySelector('.runs-table'),
      'an empty table under a narrow filter reads as an empty log',
    ).toBeNull();

    const empty = container.querySelector('.runs-empty');
    expect(empty, 'a zero-result filter renders no empty state at all').not.toBeNull();
    const words = empty?.textContent ?? '';
    expect(words).toContain(NO_MATCH_HEADLINE);
    /* it says which filter is in force, and how many runs it is hiding */
    expect(words).toContain('ExecutionTestrun');
    expect(words).toContain('paused');
    expect(words).toContain(String(MIXED_RUNS.length));
    /* and the heading agrees with the empty state rather than with the log */
    expect(headingText(container)).toBe('Terminal events (0 of 3)');

    unmount();
  });

  it('gives both controls a real label and puts them on a paper slab', () => {
    const { container, unmount } = renderLog(MIXED_RUNS);
    for (const [id, words] of [
      [FAMILY_FILTER_ID, FAMILY_FILTER_LABEL],
      [TONE_FILTER_ID, TONE_FILTER_LABEL],
    ] as const) {
      const label = container.querySelector(`label[for="${id}"]`);
      expect(label, `${id} has no label pointing at it`).not.toBeNull();
      expect(label?.textContent).toBe(words);
      expect(control(container, id)?.tagName).toBe('SELECT');
    }
    expect(container.querySelector('.runs-filter')?.classList.contains('surface-raised')).toBe(true);
    /* the count is announced, because the heading's own count changes silently */
    const status = container.querySelector('.runs-filter__status');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.textContent).toContain(`${MIXED_RUNS.length}`);
    unmount();
  });

  it('anchors every row on its own run id, and marks only the newest one', () => {
    const { container, unmount } = render(<RunsPage />);

    for (const run of snapshot.runs) {
      const row = container.querySelector(`[data-run="${run.id}"]`);
      expect(row, `${run.id} is not in the log`).not.toBeNull();
      /* the id is the run id unchanged, so `/runs#<id>` addresses this row */
      expect(row?.getAttribute('id'), `${run.id} carries no anchor id`).toBe(run.id);
      const anchor = row?.querySelector('.runs-table__anchor');
      expect(anchor?.getAttribute('href')).toBe(`#${run.id}`);
      expect(anchor?.textContent, 'the affordance is the identifier itself').toBe(run.id);
    }

    /* newest first, so exactly one mark and it is on the first row */
    const marks = container.querySelectorAll('.runs-table__newest');
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe(NEWEST_LABEL);
    expect(marks[0]?.closest('tr')?.id).toBe(snapshot.runs[0]?.id);

    unmount();
  });
});

/* ─────────────────────── the vocabulary, as DOM text ───────────────────────── */

describe('/runs — a crashed run reads as unknown, in the DOM', () => {
  it('says "outcome unknown" for a zero exit with no terminal event', () => {
    const { container, unmount } = renderRow(
      makeRun({ exitMeaning: 'success', exitCode: 0, terminalSeen: false }),
    );
    const label = container.querySelector('.run-outcome__label');
    expect(label?.textContent).toBe(OUTCOME_UNKNOWN);
    expect(container.querySelector('.run-outcome')?.getAttribute('data-tone')).toBe('unknown');
    expect(container.textContent).toContain('no verdict moved');
    expect(container.textContent).toContain('none arrived');
    unmount();
  });

  it('never renders a word that claims an outcome for such a run', () => {
    const { container, unmount } = renderRow(
      makeRun({ exitMeaning: 'success', exitCode: 0, terminalSeen: false }),
    );
    const label = container.querySelector('.run-outcome__label')?.textContent ?? '';
    expect(label).not.toBe('completed');
    expect(label).not.toBe('failed');
    unmount();
  });
});

describe('/runs — the rest of the vocabulary reaches the DOM', () => {
  it('renders "paused, resumable" for an assurance pause', () => {
    const { container, unmount } = renderRow(
      makeRun({
        family: 'Assurance',
        exitCode: 3,
        exitMeaning: 'paused-resumable',
        terminalSeen: true,
        status: 'paused',
      }),
    );
    expect(container.querySelector('.run-outcome__label')?.textContent).toBe(PAUSED_RESUMABLE);
    expect(container.querySelector('.run-outcome')?.getAttribute('data-tone')).toBe('paused');
    expect(container.textContent).toContain('no verdict moved');
    unmount();
  });

  it('renders "timed out" for our own budget, and the exit meaning beside it', () => {
    const { container, unmount } = renderRow(
      makeRun({ exitMeaning: 'killed-by-timeout', exitCode: null, terminalSeen: false }),
    );
    expect(container.querySelector('.run-outcome__label')?.textContent).toBe(TIMED_OUT);
    expect(container.querySelector('.runs-table__code')?.textContent).toBe('killed-by-timeout');
    expect(container.textContent).toContain('signalled rather than exited');
    unmount();
  });

  it('renders "refused" and quotes the message verbatim beneath the run', () => {
    const message =
      'error: no context store here (run `context ingest apps/fixture/README.md` first)';
    const { container, unmount } = renderRow(
      makeRun({
        family: 'Assurance',
        exitCode: 2,
        exitMeaning: 'failure',
        terminalSeen: true,
        status: REFUSED_STATUS,
        diagnostics: [makeDiagnostic('enrichment-assurance-status', message)],
      }),
    );
    expect(container.querySelector('.run-outcome__label')?.textContent).toBe(REFUSED_STATUS);
    expect(container.textContent).toContain('error: no context store here');
    expect(container.querySelector('.diagnostic__quoted')?.textContent).toBe(
      'context ingest apps/fixture/README.md',
    );
    unmount();
  });

  it('lists every preflight rejection reason under the rejected run', () => {
    const { container, unmount } = renderRow(
      makeRun({
        family: 'ExecutionTestrun',
        command: 'testrun run --from-context T-3',
        exitCode: 2,
        exitMeaning: 'preflight-rejected',
        diagnostics: [
          makeDiagnostic('testrun-preflight', 'T-3 was rejected: no selector matched the step.'),
          makeDiagnostic('testrun-preflight', 'T-7 was rejected: the flow names no starting url.'),
        ],
      }),
    );
    expect(container.querySelector('.run-outcome__label')?.textContent).toBe('preflight rejected');
    expect(container.textContent).toContain('T-3 was rejected');
    expect(container.textContent).toContain('T-7 was rejected');
    expect(container.querySelectorAll('.diagnostic').length).toBe(2);
    unmount();
  });

  it('keeps a broken member distinguishable from a failed one', () => {
    const { container, unmount } = renderRow(
      makeRun({
        family: 'ExecutionTestrun',
        exitCode: 1,
        exitMeaning: 'failure',
        terminalSeen: true,
        members: [
          { path: 'tests/cart_subtotal_test.md', testId: 'T-3', status: 'broken', verdict: 'red' },
          { path: 'tests/home_cta_test.md', testId: 'T-2', status: 'failed', verdict: 'red' },
        ],
      }),
    );
    const statuses = [...container.querySelectorAll('.run-member__status')].map(
      (element) => element.textContent,
    );
    expect(statuses).toEqual(['broken', 'failed']);
    expect(container.textContent).toContain('this run was allowed to move verdicts');
    unmount();
  });

  it('renders every field design §10.1 lists for a run', () => {
    const { container, unmount } = renderRow(
      makeRun({
        family: 'ExecutionTestrun',
        command: 'testrun run --from-context T-3',
        exitCode: 1,
        exitMeaning: 'failure',
        terminalSeen: true,
        status: 'complete',
        resultCode: 740,
        credits: 12,
      }),
    );
    const text = container.textContent ?? '';
    expect(text).toContain('ExecutionTestrun');
    expect(text).toContain('testrun run --from-context T-3');
    expect(text).toContain('complete');
    expect(text).toContain('740');
    expect(text).toContain('12');
    expect(text).toContain('151400 ms');
    expect(text).toContain('failure');
    expect(container.querySelector('.credits-column')?.textContent).toBe('12');
    unmount();
  });

  it('says "not reported" rather than zero for a figure the run never produced', () => {
    const { container, unmount } = renderRow(
      makeRun({ exitMeaning: 'failure', exitCode: 1, credits: null, resultCode: null }),
    );
    const credits = container.querySelector('.credits-column')?.textContent ?? '';
    expect(credits).toBe('not reported');
    expect(credits).not.toBe('0');
    unmount();
  });

  it('gives a run with nothing more to say no detail row', () => {
    const { container, unmount } = renderRow(makeRun({ exitMeaning: 'success', terminalSeen: true }));
    expect(container.querySelector('.runs-table__detail-row')).toBeNull();
    unmount();
  });
});

/* ───────────────────────── quoting is never editing ────────────────────────── */

describe('/runs — a diagnostic reaches the page whole', () => {
  it('names the remedy for an unresolved source, and keeps the sentence around it', () => {
    const message =
      'no ingested source matches apps/fixture/README.md — run `context ingest ' +
      'apps/fixture/README.md` first. `maintain reconcile` was not invoked, no review card was ' +
      'created, and every verdict is unchanged.';
    const { container, unmount } = render(
      <DiagnosticBlock diagnostic={makeDiagnostic(RECONCILE_UNRESOLVED_CODE, message)} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('remedy');
    expect(text).toContain('no ingested source matches apps/fixture/README.md');
    expect(text).toContain('every verdict is unchanged');
    expect(container.querySelector('.diagnostic__remedy')?.textContent).toBe(
      'context ingest apps/fixture/README.md',
    );
    unmount();
  });

  it('shows both conflicting source ids for a fork', () => {
    const message =
      'apps/fixture/README.md already backs a different live source: src_9f21 and src_4b70 both ' +
      'point at it, so moving a head would fork the graph. Nothing was invoked.';
    const { container, unmount } = render(
      <DiagnosticBlock diagnostic={makeDiagnostic(RECONCILE_FORKED_CODE, message, 'error')} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('conflicting sources');
    expect(text).toContain('src_9f21');
    expect(text).toContain('src_4b70');
    expect(container.querySelector('.diagnostic')?.getAttribute('data-code')).toBe(
      RECONCILE_FORKED_CODE,
    );
    unmount();
  });

  it('renders a code it was never compiled against, with no heading and no loss', () => {
    const message = 'a reason this build has never heard of, stated in full.';
    const { container, unmount } = render(
      <DiagnosticBlock diagnostic={makeDiagnostic('some-future-code', message, 'info')} />,
    );
    expect(container.querySelector('.diagnostic__emphasis')).toBeNull();
    expect(container.querySelector('.diagnostic__message')?.textContent).toBe(message);
    unmount();
  });
});

/* ───────────────────────────── the table's shape ───────────────────────────── */

describe('/runs — the log is a table, and its headings sit over their columns', () => {
  it('gives every column a scoped heading and every row that many cells', () => {
    expect(RUN_COLUMNS.length).toBeGreaterThanOrEqual(6);
    const { container, unmount } = renderRow(makeRun({ exitMeaning: 'success', terminalSeen: true }));
    expect(container.querySelectorAll('tbody tr').length).toBe(1);
    /* One of the seven is a `<th scope="row">` — the command family, which is what the
       row is about — so the cell count is counted over both element types. The
       guarantee is unchanged: a row has exactly as many cells as there are columns. */
    expect(container.querySelectorAll('tbody th, tbody td').length).toBe(RUN_COLUMNS.length);
    unmount();
  });

  it('marks the family cell as the row header, so a row announces its subject', () => {
    const { container, unmount } = renderRow(
      makeRun({ family: 'ExecutionTestrun', exitMeaning: 'success', terminalSeen: true }),
    );
    const header = container.querySelector('.runs-table__row-header');
    expect(header?.tagName).toBe('TH');
    expect(header?.getAttribute('scope')).toBe('row');
    /* The cell is the row's identity block now — family, then the run id as its anchor —
       so the family is asserted on its own element rather than as the whole cell. It is
       still the first thing in the cell and still what the row is about. */
    expect(header?.querySelector('.runs-table__family')?.textContent).toBe('ExecutionTestrun');
    unmount();
  });

  it('groups each run and its detail row into one tbody, so banding cannot split them', () => {
    const { container, unmount } = renderRow(
      makeRun({
        exitMeaning: 'failure',
        exitCode: 1,
        diagnostics: [makeDiagnostic('ndjson-parse', 'line 12 did not parse as JSON')],
      }),
    );
    const groups = container.querySelectorAll('.runs-table__group');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.tagName).toBe('TBODY');
    /* the run's own row and its detail row, in that order, inside one group */
    expect(groups[0]?.querySelectorAll('tr')).toHaveLength(2);
    expect(groups[0]?.querySelector('.runs-table__row')).not.toBeNull();
    expect(groups[0]?.querySelector('.runs-table__detail-row')).not.toBeNull();
    unmount();
  });

  it('spans the whole grid with a detail row rather than breaking the columns', () => {
    const { container, unmount } = renderRow(
      makeRun({
        exitMeaning: 'failure',
        exitCode: 1,
        diagnostics: [makeDiagnostic('ndjson-parse', 'line 12 did not parse as JSON')],
      }),
    );
    const detail = container.querySelector('.runs-table__detail-row td');
    expect(detail?.getAttribute('colspan')).toBe(String(RUN_COLUMNS.length));
    unmount();
  });
});

/* ────────────── the detail row is shut, and shutting it hides nothing ────────────── */

/**
 * The log used to render every run's detail open, which turned twenty invocations into
 * several screens of member paths. The detail now sits behind a native `<details>`, shut,
 * and these are the two things that has to be true of: a shut row still says what it holds,
 * and shutting it takes nothing out of the document.
 *
 * The second is the one worth a test. `<details>` is a *presentation* boundary, not a
 * content one: the children stay in the tree when it is closed, which is why the browser's
 * own find still matches them and why a screen reader can still reach them. A collapse
 * implemented with `useState` and a conditional would not have that property, would need a
 * client boundary on a `force-static` page, and would put a `<button>` in the log. So these
 * tests also assert the absence of one.
 */
describe('/runs: a run\u2019s detail collapses without going missing', () => {
  it('states the counts it holds, pluralised, and omits an axis that is empty', () => {
    expect(detailSummary(9, 8)).toBe('9 members, 8 diagnostics');
    expect(detailSummary(1, 1)).toBe('1 member, 1 diagnostic');
    expect(detailSummary(2, 0)).toBe('2 members');
    expect(detailSummary(0, 3)).toBe('3 diagnostics');
  });

  it('renders the detail shut, with the counts on the outside of it', () => {
    const { container, unmount } = renderRow(
      makeRun({
        exitMeaning: 'failure',
        exitCode: 1,
        members: [
          { path: 'tests/cart_discount_test.md', testId: null, status: 'failed', verdict: 'red' },
          { path: 'tests/kept_self_claims_test.md', testId: null, status: 'passed', verdict: 'proven' },
        ],
        diagnostics: [makeDiagnostic('ndjson-parse', 'line 12 did not parse as JSON')],
      }),
    );
    const disclosure = container.querySelector('details.run-detail-disclosure');
    expect(disclosure, 'the detail is not behind a disclosure at all').not.toBeNull();
    expect((disclosure as HTMLDetailsElement).open, 'the detail row renders open').toBe(false);

    const summary = disclosure?.querySelector('summary');
    expect(summary?.textContent).toBe(detailSummary(2, 1));
    expect(summary?.textContent).toContain('2 members');
    expect(summary?.textContent).toContain('1 diagnostic');
    unmount();
  });

  it('keeps every member and every quoted reason in the document while shut', () => {
    const { container, unmount } = renderRow(
      makeRun({
        exitMeaning: 'failure',
        exitCode: 1,
        members: [{ path: 'tests/cart_discount_test.md', testId: 'tc_44', status: 'broken', verdict: 'red' }],
        diagnostics: [makeDiagnostic('ndjson-parse', 'line 12 did not parse as JSON')],
      }),
    );
    const disclosure = container.querySelector('details.run-detail-disclosure');
    expect((disclosure as HTMLDetailsElement).open).toBe(false);

    /* Shut, and all of it still here: the verbatim member status, the path, the test id and
       the diagnostic's own words. This is the whole argument for `<details>` over state. */
    const text = disclosure?.textContent ?? '';
    expect(text).toContain('broken');
    expect(text).toContain('tests/cart_discount_test.md');
    expect(text).toContain('tc_44');
    expect(text).toContain('line 12 did not parse as JSON');
    expect(disclosure?.querySelector('.run-detail__title')?.textContent).toBe('Members (1)');
    unmount();
  });

  it('opens on the summary, and needs no button to do it', () => {
    const { container, unmount } = renderRow(
      makeRun({
        exitMeaning: 'failure',
        exitCode: 1,
        members: [{ path: 'tests/cart_discount_test.md', testId: null, status: 'failed', verdict: 'red' }],
      }),
    );
    const disclosure = container.querySelector('details.run-detail-disclosure');
    const summary = disclosure?.querySelector('summary');
    expect(summary?.tagName).toBe('SUMMARY');

    act(() => {
      fireEvent.click(summary as Element);
    });
    expect((disclosure as HTMLDetailsElement).open, 'clicking the summary did not open it').toBe(
      true,
    );

    /* No control was added to the log to get this. A `<summary>` is focusable and operable
       from the keyboard because it is a `<summary>`, so the row stays server-rendered and
       `/runs` stays `force-static`. */
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelectorAll('input')).toHaveLength(0);
    unmount();
  });

  it('shuts every detail row on the committed page, and leaves the runs visible', () => {
    const withDetail = snapshot.runs.filter(
      (run) => run.members.length > 0 || run.diagnostics.length > 0,
    );
    if (withDetail.length === 0) return;

    const { container, unmount } = render(<RunsPage />);
    try {
      const disclosures = [...container.querySelectorAll('details.run-detail-disclosure')];
      expect(disclosures).toHaveLength(withDetail.length);
      for (const disclosure of disclosures) {
        expect(
          (disclosure as HTMLDetailsElement).open,
          'a run on the committed page renders its detail open',
        ).toBe(false);
        /* Never a bare `show details`: a shut disclosure that does not say what it holds
           makes a reader open all twenty to find the one that matters. */
        expect(disclosure.querySelector('summary')?.textContent).toMatch(
          /\d+ (member|diagnostic)/,
        );
      }
    } finally {
      unmount();
    }
  });
});
