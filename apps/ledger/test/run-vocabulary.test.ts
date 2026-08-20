/**
 * The failure and degradation matrix, row by row — design §14.1, §4.1, §4.5,
 * §5.3.1, §13.2.2, R4.9, R4.11, R5.3.
 *
 * `/runs` has nothing to list today: the committed snapshot carries `runs: []`.
 * That is precisely why this suite constructs the runs instead of reading them.
 * Stage 15 will fill the page with recorded invocations and it has to render them
 * correctly the first time, so every row of §14.1 gets a `SnapshotRun` built here
 * and asserted against the words it must produce.
 *
 * Each constructed run is **parsed by the snapshot schema** before it is used. A
 * run shape the schema would reject proves nothing about a page that only ever
 * receives shapes it accepted, and building the fixtures through
 * `SnapshotRunSchema` means a field renamed upstream fails these tests rather than
 * quietly leaving them testing a shape that no longer exists.
 *
 * The load-bearing assertion is the exhaustive one at the end: over every
 * combination of the eight exit meanings, the presence or absence of a terminal
 * event, and the six assurance statuses, no run reaches a label that claims an
 * outcome — `completed` or `failed` — unless the write guard of §4.8 permitted it.
 * A single one of these reading as success would be the one dishonest thing in the
 * product, so it is checked over the whole cross product rather than sampled.
 */

import type { AssuranceStatus, CommandFamily, ExitMeaning, SnapshotRun } from '@kept/core';
import {
  ASSURANCE_STATUSES,
  EXIT_MEANINGS,
  SnapshotRunSchema,
  contractFor,
  permitsVerdictWrite,
} from '@kept/core';
import { describe, expect, it } from 'vitest';

import {
  EXIT_MEANING_OUTCOMES,
  OUTCOME_CLAIMING_LABELS,
  OUTCOME_UNKNOWN,
  PAUSED_RESUMABLE,
  RECONCILE_FORKED_CODE,
  RECONCILE_UNRESOLVED_CODE,
  REFUSED_STATUS,
  TIMED_OUT,
  coercedResultCode,
  diagnosticPresentation,
  messageSegments,
  quotedRuns,
  runOutcome,
  terminalContract,
  verdictSentence,
} from '../lib/runVocabulary.js';

const AT = '2026-08-20T16:17:09.800Z';
const ENDED = '2026-08-20T16:19:41.200Z';

interface RunDraft {
  readonly family?: CommandFamily;
  readonly command?: string;
  readonly exitCode?: number | null;
  readonly exitMeaning: ExitMeaning;
  readonly terminalSeen?: boolean;
  readonly terminalEventType?: string | null;
  readonly status?: string | null;
  readonly resultCode?: number | null;
  readonly reasonCode?: string | null;
  readonly credits?: number | null;
  readonly members?: SnapshotRun['members'];
  readonly diagnostics?: SnapshotRun['diagnostics'];
}

/**
 * A schema-valid `SnapshotRun`.
 *
 * `terminalEventType` defaults to the type the family's contract declares when a
 * terminal event was seen, and to `null` when it was not — the same rule §9.1's
 * freshness clause applies, so a fixture cannot accidentally claim a family
 * terminated with another family's event.
 */
function run(draft: RunDraft): SnapshotRun {
  const family: CommandFamily = draft.family ?? 'Assurance';
  const terminalSeen = draft.terminalSeen ?? false;
  return SnapshotRunSchema.parse({
    id: 'tr_20260820T161709Z',
    family,
    command: draft.command ?? 'cover --json',
    startedAt: AT,
    endedAt: ENDED,
    durationMs: 151_400,
    exitCode: draft.exitCode === undefined ? 0 : draft.exitCode,
    exitMeaning: draft.exitMeaning,
    terminalSeen,
    terminalEventType:
      draft.terminalEventType === undefined
        ? terminalSeen
          ? contractFor(family).terminalType
          : null
        : draft.terminalEventType,
    status: draft.status === undefined ? null : draft.status,
    resultCode: draft.resultCode === undefined ? null : draft.resultCode,
    reasonCode: draft.reasonCode === undefined ? null : draft.reasonCode,
    credits: draft.credits === undefined ? null : draft.credits,
    verdictObject: null,
    evidencePackId: null,
    members: draft.members ?? [],
    diagnostics: draft.diagnostics ?? [],
  });
}

function diagnostic(code: string, message: string, severity: 'info' | 'warn' | 'error' = 'warn') {
  return { code, severity, message, file: null, line: null, at: AT };
}

/* ─────────────────────── the vocabulary is complete at all ─────────────────── */

describe('the run vocabulary covers every exit meaning', () => {
  it('has words for all eight, and no empty ones', () => {
    expect(EXIT_MEANING_OUTCOMES.size).toBe(EXIT_MEANINGS.length);
    for (const meaning of EXIT_MEANINGS) {
      const row = EXIT_MEANING_OUTCOMES.get(meaning);
      expect(row, `no words for ${meaning}`).toBeDefined();
      expect((row?.label ?? '').length, `${meaning} has an empty label`).toBeGreaterThan(0);
    }
  });

  it('reserves the proven tone for the one meaning that earns it', () => {
    const complete = [...EXIT_MEANING_OUTCOMES.entries()].filter(
      ([, row]) => row.tone === 'complete',
    );
    expect(complete.map(([meaning]) => meaning)).toEqual(['success']);
  });
});

/* ────────────────────────── §14.1, one row at a time ───────────────────────── */

describe('§14.1 — a crashed stream is never a pass and never a failure', () => {
  it('reads "outcome unknown" when a zero exit produced no terminal event', () => {
    const outcome = runOutcome(run({ exitMeaning: 'success', exitCode: 0, terminalSeen: false }));
    expect(outcome.label).toBe(OUTCOME_UNKNOWN);
    expect(outcome.tone).toBe('unknown');
    expect(outcome.outcomeKnown).toBe(false);
    expect(outcome.verdictWritePermitted).toBe(false);
    expect(verdictSentence(outcome)).toBe('no verdict moved');
  });

  it('reads "outcome unknown" for a non-zero exit with no terminal event too', () => {
    const outcome = runOutcome(run({ exitMeaning: 'failure', exitCode: 1, terminalSeen: false }));
    expect(outcome.label).toBe(OUTCOME_UNKNOWN);
    expect(OUTCOME_CLAIMING_LABELS.has(outcome.label)).toBe(false);
  });

  it('names the terminal event the family waited for, per family', () => {
    for (const family of ['ExecutionRun', 'ExecutionTestrun', 'Assurance'] as const) {
      const crashed = run({ family, exitMeaning: 'success', terminalSeen: false });
      const outcome = runOutcome(crashed);
      expect(outcome.detail).toContain(contractFor(family).terminalType);

      const contract = terminalContract(crashed);
      expect(contract.expected).toBe(contractFor(family).terminalType);
      expect(contract.seen).toBeNull();
      expect(contract.agrees).toBe(false);
    }
  });
});

describe('§14.1 — an assurance pause is resumable, not a failure', () => {
  it('reads "paused, resumable" and moves nothing', () => {
    const outcome = runOutcome(
      run({
        family: 'Assurance',
        exitCode: 3,
        exitMeaning: 'paused-resumable',
        terminalSeen: true,
        status: 'paused',
      }),
    );
    expect(outcome.label).toBe(PAUSED_RESUMABLE);
    expect(outcome.tone).toBe('paused');
    expect(outcome.outcomeKnown).toBe(true);
    expect(outcome.verdictWritePermitted).toBe(false);
  });

  it('never lets exit 3 from the assurance family read as a failure', () => {
    const assurance = contractFor('Assurance');
    expect(assurance.exit3).toBe('paused-resumable');
    const outcome = runOutcome(
      run({ family: 'Assurance', exitCode: 3, exitMeaning: assurance.exit3, terminalSeen: true }),
    );
    expect(outcome.label).not.toBe('failed');
    expect(outcome.tone).not.toBe('failed');
  });
});

describe('§14.1 — timeouts, cancellations and interrupts', () => {
  it('reads "timed out" when our own budget elapsed', () => {
    const outcome = runOutcome(
      run({ exitMeaning: 'killed-by-timeout', exitCode: null, terminalSeen: false }),
    );
    expect(outcome.label).toBe(TIMED_OUT);
    expect(outcome.tone).toBe('unknown');
    expect(outcome.verdictWritePermitted).toBe(false);
  });

  it('distinguishes the upstream timeout or cancellation from ours', () => {
    const outcome = runOutcome(
      run({ family: 'ExecutionRun', exitCode: 3, exitMeaning: 'timeout-or-cancelled' }),
    );
    expect(outcome.label).toBe('timed out or cancelled');
    expect(outcome.label).not.toBe(TIMED_OUT);
  });

  it('reads a signalled process as force-interrupted, not as a failure', () => {
    const outcome = runOutcome(run({ exitCode: 130, exitMeaning: 'force-interrupted' }));
    expect(outcome.label).toBe('force-interrupted');
    expect(outcome.verdictWritePermitted).toBe(false);
  });
});

describe('§14.1 — a preflight rejection ran nothing at all', () => {
  it('reads "preflight rejected" and lists each reason from the run diagnostics', () => {
    const rejected = run({
      family: 'ExecutionTestrun',
      command: 'testrun run --from-context T-3',
      exitCode: 2,
      exitMeaning: 'preflight-rejected',
      terminalSeen: false,
      diagnostics: [
        diagnostic('testrun-preflight', 'T-3 was rejected: no selector matched the step.'),
        diagnostic('testrun-preflight', 'T-7 was rejected: the flow names no starting url.'),
      ],
    });
    const outcome = runOutcome(rejected);
    expect(outcome.label).toBe('preflight rejected');
    expect(outcome.tone).toBe('rejected');
    expect(outcome.verdictWritePermitted).toBe(false);
    expect(rejected.diagnostics.map((entry) => diagnosticPresentation(entry).segments.length)).toEqual(
      [1, 1],
    );
  });
});

describe('§14.1 — the verified refusal envelope is a complete stream, not a crash', () => {
  const refusal =
    "`cover --json` finished with status 'refused', which the acceptance gate does not " +
    'accept, so the graph is built from the baseline provider alone. It reported: error: no ' +
    'context store here (run `context ingest <files>` first)';

  it('reads "refused" rather than "failed", with the terminal event seen', () => {
    const refused = run({
      family: 'Assurance',
      exitCode: 2,
      exitMeaning: 'failure',
      terminalSeen: true,
      status: REFUSED_STATUS,
      diagnostics: [diagnostic('enrichment-assurance-status', refusal)],
    });
    const outcome = runOutcome(refused);
    expect(outcome.label).toBe(REFUSED_STATUS);
    expect(outcome.tone).toBe('refused');
    expect(outcome.outcomeKnown).toBe(true);
    expect(outcome.verdictWritePermitted).toBe(false);
    expect(terminalContract(refused).agrees).toBe(true);
  });

  it('quotes the message verbatim, fences included and nothing edited', () => {
    const presented = diagnosticPresentation(diagnostic('enrichment-assurance-status', refusal));
    const rejoined = presented.segments.map((segment) => segment.text).join('');
    expect(rejoined).toBe(refusal.split('`').join(''));
    expect(rejoined).toContain('error: no context store here');
    expect(presented.quoted).toContain('context ingest <files>');
  });
});

describe('§14.1 — member statuses stay distinguishable', () => {
  it('keeps broken and interrupted separate from an asserted failure', () => {
    const withMembers = run({
      family: 'ExecutionTestrun',
      command: 'testrun run --from-context T-3',
      exitCode: 1,
      exitMeaning: 'failure',
      terminalSeen: true,
      members: [
        { path: 'tests/cart_subtotal_test.md', testId: 'T-3', status: 'broken', verdict: 'red' },
        {
          path: 'tests/orders_persist_test.md',
          testId: 'T-5',
          status: 'interrupted',
          verdict: 'stale',
        },
        { path: 'tests/home_cta_test.md', testId: 'T-2', status: 'failed', verdict: 'red' },
      ],
    });
    expect(withMembers.members.map((member) => member.status)).toEqual([
      'broken',
      'interrupted',
      'failed',
    ]);
    const outcome = runOutcome(withMembers);
    expect(outcome.label).toBe('failed');
    expect(outcome.verdictWritePermitted).toBe(true);
    expect(verdictSentence(outcome)).toBe('this run was allowed to move verdicts');
  });
});

describe('§14.1 — the absent binary is a supported state', () => {
  it('says nothing started, in the neutral tone', () => {
    const absent = EXIT_MEANINGS.filter((meaning) => meaning.endsWith('-not-found'));
    expect(absent.length).toBe(1);
    const meaning = absent[0] as ExitMeaning;
    const outcome = runOutcome(run({ exitCode: 127, exitMeaning: meaning, terminalSeen: false }));
    expect(outcome.label).toBe('binary not found');
    expect(outcome.tone).toBe('absent');
    expect(outcome.verdictWritePermitted).toBe(false);
  });
});

describe('§14.1 — a completed run is the only one that may say so', () => {
  it('reads "completed" only with a terminal event and a permitting exit', () => {
    const outcome = runOutcome(
      run({ family: 'Assurance', exitCode: 0, exitMeaning: 'success', terminalSeen: true, status: 'complete' }),
    );
    expect(outcome.label).toBe('completed');
    expect(outcome.tone).toBe('complete');
    expect(outcome.outcomeKnown).toBe(true);
    expect(outcome.verdictWritePermitted).toBe(true);
  });
});

/* ──────────────────── the coerced code, read through one door ──────────────── */

describe('the result code is read through the coercing accessor', () => {
  it('answers the code when there is one, and null when there is not', () => {
    expect(coercedResultCode(run({ exitMeaning: 'failure', resultCode: 740 }))).toBe(740);
    expect(coercedResultCode(run({ exitMeaning: 'failure', resultCode: 0 }))).toBe(0);
    expect(coercedResultCode(run({ exitMeaning: 'failure', resultCode: null }))).toBeNull();
  });

  it('keeps the process exit code and the result code apart (R3.14)', () => {
    const both = run({ exitMeaning: 'failure', exitCode: 2, resultCode: 100 });
    expect(both.exitCode).toBe(2);
    expect(coercedResultCode(both)).toBe(100);
  });
});

/* ──────────────────────── messages, split but not edited ───────────────────── */

describe('a diagnostic message is split on its own fences and never edited', () => {
  it('is lossless: the segments rejoin to the message with paired fences removed', () => {
    /* An unpaired backtick is not a fence, so it survives as the character it is —
       which is the difference between quoting a message and editing one. */
    const cases: readonly (readonly [string, string])[] = [
      [
        'no ingested source matches docs/README.md — run `context ingest docs/README.md` first.',
        'no ingested source matches docs/README.md — run context ingest docs/README.md first.',
      ],
      ['plain prose with no fence at all', 'plain prose with no fence at all'],
      ['`leading fence` then prose', 'leading fence then prose'],
      ['prose then `a trailing fence`', 'prose then a trailing fence'],
      ['an unclosed `fence stays prose', 'an unclosed `fence stays prose'],
      ['``', ''],
      ['`one` and `two` and a stray `', 'one and two and a stray `'],
    ];
    for (const [message, expected] of cases) {
      const rejoined = messageSegments(message)
        .map((segment) => segment.text)
        .join('');
      expect(rejoined, `lost or invented characters in: ${message}`).toBe(expected);
    }
  });

  it('treats an unclosed fence as prose rather than guessing where it ended', () => {
    expect(quotedRuns('an unclosed `fence stays prose')).toEqual([]);
    expect(messageSegments('an unclosed `fence stays prose').map((part) => part.kind)).toEqual([
      'prose',
    ]);
  });

  it('collects every fenced run in order', () => {
    expect(quotedRuns('run `one` then `two`')).toEqual(['one', 'two']);
  });
});

describe('§14.1 — the reconcile ladder gets the surface the matrix asks for', () => {
  it('names the ingest remedy for an unresolved source, from the message itself', () => {
    const message =
      'no ingested source matches apps/fixture/README.md — run `context ingest ' +
      'apps/fixture/README.md` first. `maintain reconcile` was not invoked, no review card was ' +
      'created, and every verdict is unchanged.';
    const presented = diagnosticPresentation(diagnostic(RECONCILE_UNRESOLVED_CODE, message));
    expect(presented.emphasis).toBe('remedy');
    expect(presented.quoted[0]).toBe('context ingest apps/fixture/README.md');
    expect(presented.segments.map((segment) => segment.text).join('')).toContain(
      'every verdict is unchanged',
    );
  });

  it('leads a fork with the conflict, and keeps both source ids in the message', () => {
    const message =
      'apps/fixture/README.md already backs a different live source: src_9f21 and src_4b70 ' +
      'both point at it, so moving a head would fork the graph. Nothing was invoked.';
    const presented = diagnosticPresentation(diagnostic(RECONCILE_FORKED_CODE, message, 'error'));
    expect(presented.emphasis).toBe('conflict');
    const rejoined = presented.segments.map((segment) => segment.text).join('');
    expect(rejoined).toContain('src_9f21');
    expect(rejoined).toContain('src_4b70');
    expect(presented.severity).toBe('error');
  });

  it('renders a code it has never been compiled against, whole', () => {
    const message = 'a reason this build has never heard of, stated in full.';
    const presented = diagnosticPresentation(diagnostic('some-future-code', message, 'info'));
    expect(presented.emphasis).toBeNull();
    expect(presented.code).toBe('some-future-code');
    expect(presented.segments.map((segment) => segment.text).join('')).toBe(message);
  });

  it('carries a malformed-line diagnostic without touching the run outcome', () => {
    const noisy = run({
      exitMeaning: 'success',
      terminalSeen: true,
      status: 'complete',
      diagnostics: [diagnostic('ndjson-parse', 'line 12 did not parse as JSON: {"step":')],
    });
    expect(runOutcome(noisy).label).toBe('completed');
    expect(diagnosticPresentation(noisy.diagnostics[0] ?? diagnostic('x', 'y')).code).toBe(
      'ndjson-parse',
    );
  });
});

/* ───────── the invariant, over the whole cross product rather than sampled ──── */

describe('no run claims an outcome the write guard did not permit', () => {
  it('holds for every exit meaning, terminal-event state and terminal status', () => {
    const statuses: readonly (string | null)[] = [null, ...ASSURANCE_STATUSES];
    const families: readonly CommandFamily[] = ['ExecutionRun', 'ExecutionTestrun', 'Assurance'];
    let checked = 0;

    for (const family of families) {
      for (const meaning of EXIT_MEANINGS) {
        for (const terminalSeen of [true, false]) {
          for (const status of statuses) {
            const outcome = runOutcome(
              run({
                family,
                exitMeaning: meaning,
                terminalSeen,
                status: terminalSeen ? status : null,
              }),
            );
            checked += 1;

            expect(outcome.label.length, 'every combination gets words').toBeGreaterThan(0);
            expect(outcome.outcomeKnown).toBe(terminalSeen);
            expect(outcome.verdictWritePermitted).toBe(
              terminalSeen && permitsVerdictWrite(meaning) && status !== REFUSED_STATUS,
            );

            if (OUTCOME_CLAIMING_LABELS.has(outcome.label)) {
              expect(
                terminalSeen && permitsVerdictWrite(meaning),
                `${family}/${meaning}/terminalSeen=${String(terminalSeen)}/status=${String(
                  status,
                )} reads "${outcome.label}" without having reached its terminal event or ` +
                  `without a write-permitting exit`,
              ).toBe(true);
            }

            if (outcome.tone === 'complete') {
              expect(outcome.verdictWritePermitted).toBe(true);
            }
          }
        }
      }
    }

    expect(checked).toBe(families.length * EXIT_MEANINGS.length * 2 * statuses.length);
  });

  it('never reads a refused status as completed, whatever the exit said', () => {
    for (const meaning of EXIT_MEANINGS) {
      const outcome = runOutcome(
        run({ exitMeaning: meaning, terminalSeen: true, status: REFUSED_STATUS }),
      );
      expect(OUTCOME_CLAIMING_LABELS.has(outcome.label)).toBe(false);
      expect(outcome.verdictWritePermitted).toBe(false);
    }
  });

  it('treats every assurance status as a string the snapshot may carry', () => {
    const seen = new Set<AssuranceStatus>(ASSURANCE_STATUSES);
    expect(seen.has(REFUSED_STATUS)).toBe(true);
    expect(seen.size).toBe(ASSURANCE_STATUSES.length);
  });
});
