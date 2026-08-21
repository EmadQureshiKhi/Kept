/**
 * `/runs`, rendered — design §10.1, §10.7, §14.1, R4.9, R4.11, R5.3.
 *
 * Three halves, and the middle one is the point of the page.
 *
 * The **empty** half renders the route against the committed snapshot, which
 * carries `runs: []`. That is the live path today and the first thing a reader
 * sees, so it is asserted to state the fact rather than shrug — and to keep saying
 * so with a stylesheet's worth of colour taken away, since jsdom applies none of
 * the CSS.
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
 */

import { cleanup, render } from '@testing-library/react';
import type { CommandFamily, ExitMeaning, SnapshotDiagnostic, SnapshotRun } from '@kept/core';
import { SnapshotRunSchema, contractFor } from '@kept/core';
import { afterEach, describe, expect, it } from 'vitest';

import { DiagnosticBlock } from '../app/runs/DiagnosticBlock.js';
import { NOT_REPORTED, RUN_COLUMNS, RunRow } from '../app/runs/RunRow.js';
import RunsPage from '../app/runs/page.js';
import {
  NO_RUNS_DETAIL,
  NO_RUNS_HEADLINE,
  OUTCOME_UNKNOWN,
  PAUSED_RESUMABLE,
  RECONCILE_FORKED_CODE,
  RECONCILE_UNRESOLVED_CODE,
  REFUSED_STATUS,
  TIMED_OUT,
} from '../lib/runVocabulary.js';
import { snapshot } from '../lib/snapshot.js';

/** The ledger project shares one jsdom across suites, so unmount explicitly. */
afterEach(cleanup);

const AT = '2026-08-20T16:17:09.800Z';

interface RunDraft {
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
    id: 'tr_20260820T161709Z',
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

/** One row, in the table it belongs to — a `<tr>` outside one is not valid DOM. */
function renderRow(run: SnapshotRun) {
  return render(
    <table>
      <tbody>
        <RunRow run={run} />
      </tbody>
    </table>,
  );
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
    for (const run of snapshot.runs) {
      expect(text, `${run.id} is not on the page`).toContain(run.command);
      // A figure the run never reported reads `not reported`, never `0`.
      if (run.durationMs === null) expect(text).toContain(NOT_REPORTED);
    }
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

  it('is a static render with no client boundary and no handler', () => {
    /* `dynamic` is the only route-segment config the page exports, and it is the
       static one. A page that quietly became dynamic would still render here, so
       the claim is asserted rather than assumed (§10.1, R8.6). */
    expect(RunsPage.length, 'the page takes no props, so it can take no request').toBe(0);
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
    expect(container.querySelectorAll('tbody td').length).toBe(RUN_COLUMNS.length);
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
