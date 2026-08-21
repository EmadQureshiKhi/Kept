/**
 * The `[member]` stream — where the classification signal actually lives
 * (design §4.1, §6.2, §7.4, R4.12, R6.4, R6.5).
 *
 * ## The measurement this module exists because of
 *
 * `testrun_member_end` carries `path`, `test_id` and `status`, and **nothing
 * else**. No `result_code`, no `reason_code`, no `verdict` object. That was
 * assumed rather than measured until the closed loop was driven live, and the
 * consequence is severe: `resultCode740`'s object rung (rule 1 and 2) and numeric
 * rung (rule 3) both have nothing to read, so every failing member delegates to
 * the triage note; the triage note lives inside a sealed `.evidence` **zip** that
 * `listArtifacts` does not open; and the delegate therefore answers `docs-lie`
 * every single time. The three-way branch was a one-way branch, and it looked
 * like it was working.
 *
 * With `KANE_TESTRUN_MEMBER_DEBUG=1`, each member's own `testmd` stream is echoed
 * on **stderr**, one line per event, prefixed `[member] `. The member's `run_end`
 * there carries all of it — the code Kane assigned, the reason code, the full
 * `verdict` object with `confirmed`, `family`, `category`, `severity`,
 * `confidence` and `root_cause`, and the credits the judgement cost:
 *
 * ```
 * [member] {"type":"run_end","status":"failed","result_code":740,
 *   "reason_code":"assertion_error.confirmed_product_bug",
 *   "verdict":{"confirmed":true,"family":"application_issue",
 *              "category":"functional_defect","severity":"major","confidence":0.92,…},
 *   "credits_consumed":10.84068}
 * ```
 *
 * So this is not a debugging convenience. It is R4.12, and it is the only route to
 * the primary signal R6.4 says outranks everything else.
 *
 * ## How a line is tied to a member, and why it is by order
 *
 * The member `run_end` carries `run_id: "run-4"` — an index within Kane's own
 * session, not a testcase id, and not unique across the two sessions a nine-member
 * suite happens to use. It carries no path and no `test_id`. There is nothing on
 * the line that names the member.
 *
 * What is reliable is **order**. KEPT never passes `--parallel`, whose default is
 * 1, so members execute one at a time: the *k*th member `run_end` on stderr is the
 * *k*th `testrun_member_end` on stdout. {@link pairMemberDebug} pairs them that
 * way and then insists on two agreements before it hands anything to the router —
 * the two sequences must be the same length, and each pair's `status` must match.
 * A disagreement means the assumption broke (a parallel run, a dropped line, a
 * later Kane that interleaves) and the answer is **no attribution at all** rather
 * than a signal attached to the wrong member. A verdict object on the wrong
 * failure would authorise an automatic source patch against a promise nobody
 * tested, which is worse than falling back to the triage rung.
 *
 * Cross-stream interleaving is never assumed. Only the order *within* each stream
 * is used, and Node guarantees that per stream.
 */

import type { Diagnostic, DiagnosticSink } from '../diagnostics.js';

/** The prefix Kane puts on every echoed member event. */
export const MEMBER_DEBUG_PREFIX = '[member] ';

/**
 * The event that ends one **step group** inside a member's replay.
 *
 * Not the member's terminal, which is the mistake worth documenting: nine members
 * of the committed suite replay emitted **forty** `run_end` events, because Kane
 * replays a `*_test.md` as a series of runs — `run-0`, `run-1`, … — one per step
 * group, and restarts the numbering for every member. Pairing these one-to-one with
 * `testrun_member_end` gives forty terminals for nine members and attributes
 * nothing at all.
 *
 * It is still the event that matters, because the classification signal is on it:
 * `result_code`, `reason_code`, the `verdict` object and `credits_consumed` all
 * ride on the `run_end` of the step group that failed.
 */
export const STEP_GROUP_TERMINAL_TYPE = 'run_end';

/**
 * The event that ends one **member**, and therefore delimits a segment.
 *
 * `{type, overall_status, duration_s, session_id}` — exactly nine of them for the
 * nine-member suite, and the only per-member boundary in the stream. It carries no
 * code and no verdict object of its own, which is why a segment needs both events:
 * this one says where a member ended and how it ended, and the step group's
 * `run_end` says why.
 */
export const MEMBER_TERMINAL_TYPE = 'test_md_done';

/** Diagnostic codes this module reports. Stable; `/runs` keys off them. */
export const MEMBER_DEBUG_DIAGNOSTIC_CODES = Object.freeze({
  /** How many member terminals were captured, and what they carried (R4.12). */
  captured: 'member-debug-captured',
  /** A `[member]` line that is not JSON. Skipped; the rest are unaffected. */
  unparsed: 'member-debug-line-unparsed',
  /** The two sequences disagree, so nothing is attributed. */
  unpaired: 'member-debug-unpaired',
} as const);

/** The codes as a list, so a test can enumerate them. */
export const MEMBER_DEBUG_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(MEMBER_DEBUG_DIAGNOSTIC_CODES),
);

/** One event, as it arrived. Untouched: the router reads it. */
export type MemberTerminal = Record<string, unknown>;

/** One member's slice of the stream, delimited by its `test_md_done`. */
export interface MemberSegment {
  /** The member's own terminal. Null for a trailing segment that never ended. */
  readonly done: MemberTerminal | null;
  /**
   * The step-group `run_end` the classification signal is on: the **failing** one
   * when the member had one, and the last otherwise. A member that failed failed at
   * one step group, and that group's terminal is the one Kane investigated.
   */
  readonly terminal: MemberTerminal | null;
  /** How many step groups the member ran. Diagnostic value only. */
  readonly stepGroups: number;
}

/** What {@link parseMemberDebug} found. */
export interface MemberDebugCapture {
  /** One per member, in arrival order. */
  readonly segments: readonly MemberSegment[];
  /** The chosen `run_end` per member, positionally — `segments[i].terminal`. */
  readonly terminals: readonly (MemberTerminal | null)[];
  /** How many `[member]` lines were seen at all, terminal or not. */
  readonly lines: number;
  /** How many carried the prefix but were not JSON. */
  readonly unparsed: number;
  readonly diagnostics: readonly Diagnostic[];
}

/** A string field off an unknown record, or null. */
function readString(source: MemberTerminal, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Collect the member terminals out of a stderr stream.
 *
 * Total: every input produces a capture. A line without the prefix is not a member
 * event and is ignored silently — the evidence hint and Kane's own warnings arrive
 * on the same pipe, and treating them as damage would fill the diagnostics with
 * noise on every successful run.
 */
export function parseMemberDebug(
  lines: readonly string[],
  sink?: DiagnosticSink | undefined,
): MemberDebugCapture {
  const diagnostics: Diagnostic[] = [];
  const segments: MemberSegment[] = [];
  let seen = 0;
  let unparsed = 0;

  // The open segment: every step group seen since the last `test_md_done`.
  let stepGroups: MemberTerminal[] = [];

  const close = (done: MemberTerminal | null): void => {
    const failing = stepGroups.find((event) => readString(event, 'status') === 'failed') ?? null;
    segments.push({
      done,
      terminal: failing ?? stepGroups[stepGroups.length - 1] ?? null,
      stepGroups: stepGroups.length,
    });
    stepGroups = [];
  };

  for (const raw of lines) {
    const line = typeof raw === 'string' ? raw : '';
    const cut = line.indexOf(MEMBER_DEBUG_PREFIX);
    if (cut < 0) continue;
    seen += 1;
    const payload = line.slice(cut + MEMBER_DEBUG_PREFIX.length).trim();
    if (!payload.startsWith('{')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      unparsed += 1;
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const event = parsed as MemberTerminal;
    if (event['type'] === STEP_GROUP_TERMINAL_TYPE) stepGroups.push(event);
    else if (event['type'] === MEMBER_TERMINAL_TYPE) close(event);
  }
  // A member whose `test_md_done` never arrived still had step groups, and losing
  // them would shift every later member by one. It is closed with a null `done`,
  // which pairing treats as "no status to agree with" rather than as agreement.
  if (stepGroups.length > 0) close(null);

  if (unparsed > 0 && sink !== undefined) {
    diagnostics.push(
      sink.report({
        code: MEMBER_DEBUG_DIAGNOSTIC_CODES.unparsed,
        severity: 'warn',
        message:
          `${unparsed} of ${seen} '[member]' line(s) were not readable JSON and were skipped. ` +
          `Every other member event was captured.`,
      }),
    );
  }

  return Object.freeze({
    segments: Object.freeze(segments),
    terminals: Object.freeze(segments.map((segment) => segment.terminal)),
    lines: seen,
    unparsed,
    diagnostics: Object.freeze(diagnostics),
  });
}

/** One `testrun_member_end`, as much of it as pairing needs. */
export interface PairableMember {
  /** Verbatim from the wire. `passed | failed | broken | interrupted`. */
  readonly status: string;
  /** Repository-relative path, for the diagnostic. */
  readonly path: string | null;
}

/** What {@link pairMemberDebug} concluded. */
export interface MemberDebugPairing {
  /**
   * The member terminal for each `testrun_member_end`, positionally. `null` at a
   * position means no signal is attributed to that member — either because the
   * capture was empty or because the two sequences disagreed.
   */
  readonly terminals: readonly (MemberTerminal | null)[];
  /** Whether the two sequences agreed and the pairing is trusted. */
  readonly paired: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Pair captured member terminals with the suite's member events, by order.
 *
 * Refuses on any disagreement, and says which one: a length mismatch, or a status
 * that differs at a position. Both mean the ordering assumption does not hold for
 * this run, and an unattributed failure still routes — through the triage rung,
 * conservatively — whereas a misattributed one authorises the wrong repair.
 */
export function pairMemberDebug(
  members: readonly PairableMember[],
  capture: MemberDebugCapture,
  sink?: DiagnosticSink | undefined,
): MemberDebugPairing {
  const diagnostics: Diagnostic[] = [];
  const refuse = (reason: string): MemberDebugPairing => {
    if (sink !== undefined) {
      diagnostics.push(
        sink.report({
          code: MEMBER_DEBUG_DIAGNOSTIC_CODES.unpaired,
          severity: 'warn',
          message:
            `The captured '[member]' segments could not be tied to the suite's members: ` +
            `${reason}. No classification signal was attributed, so every failing member is ` +
            `routed from the triage note instead — a signal on the wrong member would ` +
            `authorise the wrong repair.`,
        }),
      );
    }
    return {
      terminals: Object.freeze(members.map(() => null)),
      paired: false,
      diagnostics: Object.freeze(diagnostics),
    };
  };

  if (capture.segments.length === 0) {
    return { terminals: Object.freeze(members.map(() => null)), paired: false, diagnostics: [] };
  }
  if (capture.segments.length !== members.length) {
    return refuse(
      `${capture.segments.length} member segment(s) were captured for ` +
        `${members.length} member event(s)`,
    );
  }

  for (let index = 0; index < members.length; index += 1) {
    const member = members[index] as PairableMember;
    const segment = capture.segments[index] as MemberSegment;
    const status = segment.done === null ? null : readString(segment.done, 'overall_status');
    // `broken` and `interrupted` are the suite's readings of a member that never
    // produced a terminal of its own, so a disagreement there is expected rather
    // than suspicious; only two *reported* statuses contradicting each other mean
    // the ordering assumption has broken.
    if (status === 'passed' || status === 'failed') {
      if (member.status === 'passed' || member.status === 'failed') {
        if (status !== member.status) {
          return refuse(
            `member ${index + 1}${member.path === null ? '' : ` (${member.path})`} reported ` +
              `'${member.status}' and the captured segment at that position reported ` +
              `'${status}'`,
          );
        }
      }
    }
  }

  if (sink !== undefined) {
    const failing = capture.segments.filter(
      (segment) =>
        segment.terminal !== null && readString(segment.terminal, 'status') === 'failed',
    );
    const withObject = failing.filter(
      (segment) =>
        typeof segment.terminal?.['verdict'] === 'object' && segment.terminal['verdict'] !== null,
    );
    diagnostics.push(
      sink.report({
        code: MEMBER_DEBUG_DIAGNOSTIC_CODES.captured,
        severity: 'info',
        message:
          `Captured ${capture.segments.length} member segment(s) from the '[member]' stream ` +
          `(${capture.lines} line(s), ` +
          `${capture.segments.reduce((count, segment) => count + segment.stepGroups, 0)} step ` +
          `group(s)), ${failing.length} failing, ${withObject.length} carrying an inline ` +
          `verdict object. testrun_member_end carries no result code, no reason code and no ` +
          `verdict object, so this is the only place the primary classification signal exists ` +
          `(R4.12, R6.4).`,
      }),
    );
  }

  return {
    terminals: Object.freeze(capture.segments.map((segment) => segment.terminal)),
    paired: true,
    diagnostics: Object.freeze(diagnostics),
  };
}
