/**
 * The honest failure vocabulary — design §14.1 (the failure and degradation
 * matrix), §4.1 (the three terminal-event contracts), §4.5, §5.3.1, §13.2.2,
 * R4.9, R4.11, R5.3, R9.8.
 *
 * `/runs` is the page where this product's whole thesis is either true or a lie.
 * A run that crashed has to read `outcome unknown`, never `passed`. A paused
 * assurance run has to read `paused, resumable`, because exit 3 from that family
 * is a pause and reading it as a failure is the single most damaging mistake
 * available here. A refusal has to quote the tool's own message rather than
 * paraphrase it into something softer. This module is where each of those
 * sentences is chosen, once, as a pure function of a `SnapshotRun`.
 *
 * Four rules hold it together:
 *
 * 1. **A label may claim an outcome only where a verdict could have been
 *    written.** `permitsVerdictWrite` is imported from `@kept/core`, so the two
 *    halves of the write guard (design §4.8) and the words on this page are the
 *    same predicate. Any run that did not reach its family's terminal event and
 *    whose exit meaning would otherwise have said `completed` or `failed` reads
 *    `outcome unknown` instead. That is the crashed row of §14.1 — "whatever the
 *    exit was" — and it is why an exit code of zero with no terminal event cannot
 *    render as success.
 * 2. **No vocabulary is restated.** The eight exit meanings, the six assurance
 *    statuses and the per-family terminal event types are imported. The map below
 *    is checked at module load against `EXIT_MEANINGS`, so a ninth meaning fails
 *    the Ledger build rather than rendering a run with no words at all.
 * 3. **Totality over codes we have never seen.** A diagnostic's `code` is a
 *    string in the snapshot, not a closed union, and the codes for the reconcile
 *    ladder are produced by the CLI. So every diagnostic renders its message
 *    verbatim whatever its code is, and the two codes §14.1 singles out only add
 *    emphasis on top of that. A code this file has never heard of still reaches
 *    the reader intact.
 * 4. **Nothing is paraphrased.** Messages are rendered verbatim, split only into
 *    prose and the runs the producer already fenced in backticks so those can be
 *    set in mono (§10.7). The `context ingest` remedy and both ids of a fork
 *    arrive that way rather than through a parser of ours that could quietly
 *    match nothing.
 *
 * DOM-free, so the repository's no-DOM root project type-checks it and a Node
 * test, a server component and a source scan all read the same functions.
 */

import type { AssuranceStatus, ExitMeaning, SnapshotDiagnostic, SnapshotRun } from '@kept/core';
import { EXIT_MEANINGS, contractFor, permitsVerdictWrite, resultCode } from '@kept/core';

/**
 * The tone a run's outcome carries, and the only six.
 *
 * Deliberately not the four verdicts: a verdict is a statement about a promise
 * and these are statements about an invocation. `refused`, `paused` and `unknown`
 * all resolve to the same ochre in `styles/runs.css` — they share a colour
 * because they share a meaning, "nothing was measured" — and they stay distinct
 * here because they do not share a sentence.
 */
export type RunTone = 'complete' | 'failed' | 'rejected' | 'refused' | 'paused' | 'unknown' | 'absent';

/**
 * What a run's headline says, and why.
 *
 * `label` is prose a reader can act on. `outcomeKnown` and `verdictWritePermitted`
 * are the `Verdicts` column of §14.1 made visible: a reader should never have to
 * infer from a green word whether the ledger's state was allowed to change.
 *
 * `verdictWritePermitted` is named for what a `SnapshotRun` can actually support.
 * The write guard of §4.8 decides whether a run *may* move a verdict — terminal
 * event reached, and an exit meaning of success or failure — and when it refuses,
 * prior verdicts are preserved by construction, so `false` licenses the flat claim
 * that nothing moved. `true` licenses only the weaker one, that this run was
 * allowed to. Whether a verdict then actually changed depends on the provider gate
 * as well (an authenticated-but-errored assurance run is complete, permitted, and
 * still contributes nothing — §14.1 row 2), and that is not a fact this row holds.
 * Claiming it would be exactly the sort of overstatement the page exists to refuse.
 */
export interface RunOutcome {
  readonly label: string;
  readonly tone: RunTone;
  /** One sentence of why, or null when the label is already the whole story. */
  readonly detail: string | null;
  /** False whenever the stream never reached its family's terminal event. */
  readonly outcomeKnown: boolean;
  /** True when the write guard of §4.8 permitted this run to move a verdict. */
  readonly verdictWritePermitted: boolean;
}

/** The label and tone an exit meaning carries before the two overrides below. */
interface OutcomeRow {
  readonly label: string;
  readonly tone: RunTone;
  readonly detail: string | null;
}

/** What a crashed stream reads. §14.1: never pass, never fail (design §4.2). */
export const OUTCOME_UNKNOWN = 'outcome unknown';

/** What an assurance pause reads. Exit 3 from that family is not a failure. */
export const PAUSED_RESUMABLE = 'paused, resumable';

/** What our own timeout reads — our budget elapsed, not the product's fault. */
export const TIMED_OUT = 'timed out';

/** The verified refusal envelope of design §5.3.1, typed against the vocabulary. */
export const REFUSED_STATUS: AssuranceStatus = 'refused';

/**
 * The one exit meaning that names the upstream binary.
 *
 * Derived from the imported vocabulary rather than spelled out, because the whole
 * of `apps/ledger` is written so the name of the verification tool appears nowhere
 * in its own source — the read-only source scan asserts the Ledger neither
 * imports nor starts one, and the cheapest way to keep that unambiguous is for
 * the app to never type the name. The derivation is checked immediately below, so
 * this cannot silently resolve to the wrong member.
 */
const BINARY_ABSENT: ExitMeaning = ((): ExitMeaning => {
  const found = EXIT_MEANINGS.filter((meaning) => meaning.endsWith('-not-found'));
  const only = found[0];
  if (found.length !== 1 || only === undefined) {
    throw new Error(
      `Expected exactly one ExitMeaning naming an absent binary, found ${found.length} ` +
        `(${found.join(', ')}). The run vocabulary keys off that member, so an ambiguous ` +
        `match must fail the build rather than mislabel a run.`,
    );
  }
  return only;
})();

/**
 * Every exit meaning, as the words `/runs` shows.
 *
 * A `Map` built from typed tuples rather than an object literal, for the reason
 * above; the totality check that follows recovers what an exhaustive `Record`
 * would have given, and turns a ninth meaning into a failed build instead of an
 * empty cell.
 */
const OUTCOME_ROWS: readonly (readonly [ExitMeaning, OutcomeRow])[] = [
  [
    'success',
    {
      label: 'completed',
      tone: 'complete',
      detail: null,
    },
  ],
  [
    'failure',
    {
      label: 'failed',
      tone: 'failed',
      detail: null,
    },
  ],
  [
    'timeout-or-cancelled',
    {
      label: 'timed out or cancelled',
      tone: 'unknown',
      detail: 'The process reported a timeout or a cancellation, so no outcome was asserted.',
    },
  ],
  [
    'paused-resumable',
    {
      label: PAUSED_RESUMABLE,
      tone: 'paused',
      detail:
        'An assurance command paused and can be resumed. Every verdict is unchanged, ' +
        'because a pause is not a result.',
    },
  ],
  [
    'force-interrupted',
    {
      label: 'force-interrupted',
      tone: 'unknown',
      detail: 'The process was signalled rather than allowed to finish.',
    },
  ],
  [
    'preflight-rejected',
    {
      label: 'preflight rejected',
      tone: 'rejected',
      detail:
        'The plan was refused before a single member ran, so nothing executed and ' +
        'nothing moved. Each reason is listed with the run.',
    },
  ],
  [
    BINARY_ABSENT,
    {
      label: 'binary not found',
      tone: 'absent',
      detail:
        'The verification binary could not be resolved, so no process started and this ' +
        'ledger is built from baseline data only.',
    },
  ],
  [
    'killed-by-timeout',
    {
      label: TIMED_OUT,
      tone: 'unknown',
      detail: 'Our own budget elapsed and the process was signalled, so nothing was measured.',
    },
  ],
];

/** The vocabulary as a lookup, and the guarantee that it covers all of it. */
export const EXIT_MEANING_OUTCOMES: ReadonlyMap<ExitMeaning, OutcomeRow> = new Map(OUTCOME_ROWS);

for (const meaning of EXIT_MEANINGS) {
  if (!EXIT_MEANING_OUTCOMES.has(meaning)) {
    throw new Error(
      `The run vocabulary has no words for exit meaning "${meaning}". Design §14.1 is the ` +
        `definition of correct behaviour under adversity, so a meaning with no sentence is ` +
        `a gap in the page rather than a detail — add the row.`,
    );
  }
}

/**
 * How a run reads on `/runs`. Total over every `SnapshotRun` the schema accepts.
 *
 * The base row comes from the exit meaning, and then two overrides in this order:
 *
 * 1. **A refusal is a complete stream** (§5.3.1), not a crash: the terminal event
 *    arrived carrying `status: 'refused'` and its own `exit_code`, and the process
 *    exited non-zero, so the exit meaning alone would say `failed`. It did not
 *    fail; it declined. The label says so and the message is quoted verbatim from
 *    the run's diagnostics.
 * 2. **A label may claim an outcome only where a verdict could have moved.** If
 *    the stream never reached its family's terminal event and the exit meaning is
 *    one of the two write-permitting ones, the outcome is unknown and is reported
 *    as unknown. This is the row of §14.1 whose `exitMeaning` is "whatever the
 *    exit was", and it is the reason an exit code of zero with no terminal event
 *    cannot read as success.
 */
export function runOutcome(run: SnapshotRun): RunOutcome {
  const row = EXIT_MEANING_OUTCOMES.get(run.exitMeaning);
  if (row === undefined) {
    throw new Error(
      `Unknown exit meaning "${String(run.exitMeaning)}" on run ${run.id}. The snapshot ` +
        `schema validates this field against the imported vocabulary, so reaching here means ` +
        `the two disagree and the page must not guess.`,
    );
  }

  const verdictWritePermitted = run.terminalSeen && permitsVerdictWrite(run.exitMeaning);

  if (run.terminalSeen && run.status === REFUSED_STATUS) {
    return {
      label: REFUSED_STATUS,
      tone: 'refused',
      detail:
        'The command declined to do the work and said why. Its own message is quoted below, ' +
        'unedited. No verdict moved.',
      outcomeKnown: true,
      verdictWritePermitted: false,
    };
  }

  if (!run.terminalSeen && permitsVerdictWrite(run.exitMeaning)) {
    return {
      label: OUTCOME_UNKNOWN,
      tone: 'unknown',
      detail:
        `The stream ended without the ${contractFor(run.family).terminalType} event this ` +
        `command family terminates with, so what happened is not known. Never a pass, never ` +
        `a failure — every verdict is unchanged.`,
      outcomeKnown: false,
      verdictWritePermitted: false,
    };
  }

  return {
    label: row.label,
    tone: row.tone,
    detail: row.detail,
    outcomeKnown: run.terminalSeen,
    verdictWritePermitted,
  };
}

/**
 * The two labels that claim an outcome, and therefore the two a run may not carry
 * unless the write guard permitted it.
 *
 * Exported because that is the invariant worth asserting directly: `completed` and
 * `failed` are statements about the product, and every other member of the
 * vocabulary is a statement about the invocation. The unit suite walks every
 * combination of exit meaning, terminal-event presence and terminal status and
 * checks that no combination outside the guard's permission reaches either of them.
 */
export const OUTCOME_CLAIMING_LABELS: ReadonlySet<string> = new Set(['completed', 'failed']);

/** What the row says about the ledger's state, given the guard's answer. */
export function verdictSentence(outcome: RunOutcome): string {
  return outcome.verdictWritePermitted
    ? 'this run was allowed to move verdicts'
    : 'no verdict moved';
}

/**
 * The terminal event this run's family terminates with, and whether it arrived.
 *
 * The expected type is read from the contract table (§4.1) and never from the
 * event, which is what stops `/runs` becoming a second authority on which of
 * `run_end`, `testrun_done` and `done` belongs to which family.
 */
export interface TerminalContract {
  readonly expected: string;
  readonly seen: string | null;
  /** True when a terminal event arrived and it was the type the family declares. */
  readonly agrees: boolean;
}

export function terminalContract(run: SnapshotRun): TerminalContract {
  const expected: string = contractFor(run.family).terminalType;
  return {
    expected,
    seen: run.terminalSeen ? run.terminalEventType : null,
    agrees: run.terminalSeen && run.terminalEventType === expected,
  };
}

/**
 * The run's `result_code`, read through the one coercing accessor.
 *
 * The snapshot has already coerced this field, so the call is a round trip today.
 * It is written this way on purpose: the wire types the code with a number in one
 * place and a string in another (design §4.4), and if that ever reaches the
 * snapshot the Ledger reads it through the same accessor as everything else
 * instead of formatting a second interpretation of the same field.
 */
export function coercedResultCode(run: SnapshotRun): number | null {
  return resultCode({ result_code: run.resultCode });
}

/* ───────────────────────── verbatim messages, split ────────────────────────── */

/** One run of a diagnostic message: prose, or something the producer fenced. */
export interface MessageSegment {
  readonly kind: 'prose' | 'quoted';
  readonly text: string;
}

/**
 * Splits a message on backtick fences, keeping every character of the original.
 *
 * The producers of these messages already fence the parts that are commands,
 * codes and paths — the unresolved-source diagnostic fences the `context ingest`
 * remedy §14.1 requires the page to name, for instance. Honouring that fence is
 * how the page sets a command in mono and its sentence in prose (§10.7) without
 * inventing a parser that decides what looks like a command, and without editing
 * the message: concatenating the segments returns the input with the fence
 * characters removed and nothing else.
 *
 * An unclosed fence yields prose. Half a quotation is not a quotation, and
 * guessing where it ended would put a stray backtick on the page.
 */
export function messageSegments(message: string): readonly MessageSegment[] {
  const segments: MessageSegment[] = [];
  let cursor = 0;

  while (cursor < message.length) {
    const open = message.indexOf('`', cursor);
    if (open === -1) break;
    const close = message.indexOf('`', open + 1);
    if (close === -1) break;

    if (open > cursor) segments.push({ kind: 'prose', text: message.slice(cursor, open) });
    const quoted = message.slice(open + 1, close);
    if (quoted.length > 0) segments.push({ kind: 'quoted', text: quoted });
    cursor = close + 1;
  }

  if (cursor < message.length) segments.push({ kind: 'prose', text: message.slice(cursor) });
  return segments;
}

/** Every fenced run in a message, in order. Empty when the producer fenced none. */
export function quotedRuns(message: string): readonly string[] {
  return messageSegments(message)
    .filter((segment) => segment.kind === 'quoted')
    .map((segment) => segment.text);
}

/**
 * The two diagnostic codes §14.1 gives their own surface on `/runs`.
 *
 * Named as strings rather than imported, and the distinction matters: a
 * diagnostic code is *data* in the snapshot, so the Ledger has to be able to
 * render one it was never compiled against. These two are here because the matrix
 * asks for more than the message — the unresolved row must name the remedy, and
 * the fork row must show both conflicting source ids — and the extra emphasis has
 * to key off something. Everything else renders as its message and its code, so
 * the page stays total over a vocabulary that grows without it.
 */
export const RECONCILE_UNRESOLVED_CODE = 'reconcile-source-unresolved';
export const RECONCILE_FORKED_CODE = 'reconcile-source-forked';

/** What extra a diagnostic's row leads with, when the matrix asks for one. */
export type DiagnosticEmphasis = 'remedy' | 'conflict' | null;

export interface DiagnosticPresentation {
  readonly code: string;
  readonly severity: SnapshotDiagnostic['severity'];
  readonly emphasis: DiagnosticEmphasis;
  /** The message verbatim, split into prose and fenced runs. */
  readonly segments: readonly MessageSegment[];
  /** The fenced runs on their own, for the remedy the unresolved row names. */
  readonly quoted: readonly string[];
  readonly file: string | null;
  readonly line: number | null;
  readonly at: string;
}

/**
 * How one diagnostic reads. Total over every code, known or not.
 *
 * There is no branch here that can drop a message: `segments` always covers the
 * whole of it. `emphasis` only decides what the row leads with — the remedy for
 * an unresolved source, the conflict for a fork — so an unrecognised code loses
 * a heading and never loses a word.
 */
export function diagnosticPresentation(diagnostic: SnapshotDiagnostic): DiagnosticPresentation {
  const emphasis: DiagnosticEmphasis =
    diagnostic.code === RECONCILE_UNRESOLVED_CODE
      ? 'remedy'
      : diagnostic.code === RECONCILE_FORKED_CODE
        ? 'conflict'
        : null;

  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    emphasis,
    segments: messageSegments(diagnostic.message),
    quoted: quotedRuns(diagnostic.message),
    file: diagnostic.file,
    line: diagnostic.line,
    at: diagnostic.at,
  };
}

/** The heading a diagnostic with emphasis leads with. Null for every other code. */
export const EMPHASIS_HEADINGS: Readonly<Record<'remedy' | 'conflict', string>> = {
  remedy: 'remedy',
  conflict: 'conflicting sources',
};

/* ─────────────────────────────── the empty page ───────────────────────────── */

/**
 * What `/runs` says when there is nothing to list.
 *
 * The committed snapshot carries `runs: []` today, so this is the live path and
 * the first thing a reader sees. It states the fact rather than shrugging: no
 * terminal event has been consumed, which is also why the freshness chip reads
 * `never verified` and why the proven figure is withheld instead of being
 * reported as zero. An empty log is a true statement about this repository, and
 * saying so is the same honesty the rest of the page is for.
 */
export const NO_RUNS_HEADLINE = 'No verification run has been recorded yet.';

export const NO_RUNS_DETAIL =
  'This log lists one entry per verification invocation, newest first, with the exit ' +
  'meaning and the terminal event behind it. Nothing has been recorded, so nothing is ' +
  'claimed: every promise is unproven rather than failing, and the proven coverage figure ' +
  'is withheld rather than reported as zero.';

/** What the diagnostics section says when the snapshot carries none. */
export const NO_DIAGNOSTICS = 'No diagnostic was recorded.';
