/**
 * Member status → verdict (design §6.5, R3.20, R4.8, R4.9).
 *
 * One switch, and the reason it is a module of its own is that it is the seam
 * where Kane's four-valued execution vocabulary becomes KEPT's four-valued
 * ledger vocabulary — and the two are **not** the same four. Kane reports
 * `passed`, `failed`, `broken`, `interrupted`; the ledger records `proven`,
 * `red`, `undesigned`, `stale`. The mapping is deliberately lossy in one place
 * and deliberately lossless in another:
 *
 * - **Lossy on purpose:** `failed` and `broken` both become `red`. A member that
 *   asserted and lost and a member whose harness fell over are both "not proven
 *   right now", and the ledger has no fifth colour for the difference.
 * - **Lossless where it matters:** the distinction the verdict throws away is
 *   preserved verbatim in the run diagnostics (R4.9), so a reviewer reading
 *   `/runs` can still tell a broken member from an asserted failure after the
 *   fact. {@link reportMemberStatus} is what makes that true, and it quotes the
 *   status string **exactly as it arrived**, including a casing or a trailing
 *   space we did not expect.
 *
 * Two further rules, both load-bearing:
 *
 * 1. **The mapping is total.** `memberStatusToVerdict` takes `string`, not
 *    `MemberStatus`, because the value arrives from another process and a fifth
 *    status from a later Kane release is a state of the world, not a programming
 *    error (design §14.2). An unrecognised value maps to `stale` — the verdict
 *    that claims nothing — and is flagged `known: false` so the caller can
 *    diagnose it rather than silently treating it as proof or as failure.
 * 2. **Only `failed` and `broken` reach the router.** `interrupted` proved
 *    nothing, so there is nothing to triage and no repair branch to choose;
 *    `passed` is not a failure at all. {@link entersVerdictRouter} is the single
 *    statement of that, so no call site re-derives it — sending an `interrupted`
 *    member to the router would manufacture a repair branch out of an absence of
 *    evidence, which is exactly the dishonesty the ledger exists to avoid.
 */

import type { DiagnosticSink } from '../diagnostics.js';
import { MEMBER_END_STATUSES, type MemberEndStatus } from '../kane/events.js';
import type { Verdict } from '../model/promise.js';

/**
 * The four observed member statuses (design §6.5).
 *
 * An alias of the parser's own `MemberEndStatus` rather than a second union
 * spelling the same four strings: `testrun_member_end.status` has exactly one
 * vocabulary and `kane/events.ts` owns it. A restatement here could drift, and
 * the drift would be invisible until a status stopped mapping.
 */
export type MemberStatus = MemberEndStatus;

/** The four statuses, in the order design §6.5 lists them. */
export const MEMBER_STATUSES: readonly MemberStatus[] = MEMBER_END_STATUSES;

/**
 * The statuses that reach the `VerdictRouter` — `failed` and `broken`, and no
 * others (design §6.5).
 */
export const ROUTER_MEMBER_STATUSES: readonly MemberStatus[] = Object.freeze<MemberStatus[]>([
  'failed',
  'broken',
]);

/** Diagnostic codes this module reports under. */
export const MEMBER_STATUS_DIAGNOSTIC_CODES = Object.freeze({
  /** A recognised non-passing status, recorded verbatim (R4.9). */
  recorded: 'member-status',
  /** A status outside the four. Mapped to `stale`, never guessed at. */
  unknown: 'member-status-unknown',
} as const);

/** The codes as a list, so tests can enumerate rather than hand-list them. */
export const MEMBER_STATUS_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(MEMBER_STATUS_DIAGNOSTIC_CODES),
);

/** What {@link memberStatusToVerdict} answers: the verdict, and whether it was recognised. */
export interface MemberStatusMapping {
  readonly verdict: Verdict;
  /** False for a status outside the four — the caller diagnoses, never guesses. */
  readonly known: boolean;
}

/**
 * Map a member status onto a verdict. Total over every string, never throws
 * (design §6.5, R3.20, R4.8).
 *
 * The `default` arm is the whole point of taking a `string`: it answers `stale`,
 * which is the verdict that asserts nothing about the promise, and it reports
 * `known: false`. `undesigned` would be wrong — the promise plainly *has* a
 * designed test, since a member ran for it — and `proven` or `red` would be a
 * claim invented out of a value we do not understand.
 */
export function memberStatusToVerdict(status: string): MemberStatusMapping {
  switch (status) {
    case 'passed':
      return { verdict: 'proven', known: true };
    case 'failed':
      return { verdict: 'red', known: true };
    case 'broken':
      return { verdict: 'red', known: true };
    case 'interrupted':
      return { verdict: 'stale', known: true };
    default:
      return { verdict: 'stale', known: false };
  }
}

/** Whether a status is one of the four (design §6.5). */
export function isMemberStatus(value: unknown): value is MemberStatus {
  return typeof value === 'string' && (MEMBER_STATUSES as readonly string[]).includes(value);
}

/**
 * Whether this status enters the `VerdictRouter` — `failed` or `broken` only.
 *
 * `interrupted` is excluded because it proved nothing: there is no failure to
 * triage, so there is no branch to choose. `passed` is excluded because it is
 * not a failure. An unrecognised status is excluded for the same reason the
 * mapping answers `stale` for it — we do not know what happened, and routing it
 * would invent a repair branch from that ignorance.
 */
export function entersVerdictRouter(status: string): boolean {
  return (ROUTER_MEMBER_STATUSES as readonly string[]).includes(status);
}

/** What {@link reportMemberStatus} is told about the member it is recording. */
export interface MemberStatusReport {
  /** The status exactly as it arrived on the wire. Never normalised here. */
  readonly status: string;
  /** Kane's assurance-graph identifier for the member, when the plan carried one. */
  readonly testId?: string | null;
  /** Repository-relative path of the member's `*_test.md`, when known. */
  readonly path?: string | null;
}

/** Render an identity for the diagnostic message, or a plain statement of absence. */
function describeMember(report: MemberStatusReport): string {
  const testId = typeof report.testId === 'string' && report.testId.trim().length > 0
    ? report.testId.trim()
    : null;
  const path = typeof report.path === 'string' && report.path.trim().length > 0
    ? report.path.trim()
    : null;
  if (testId !== null && path !== null) return `${testId} (${path})`;
  if (testId !== null) return testId;
  if (path !== null) return path;
  return 'a member the plan did not identify';
}

/**
 * Map a status **and** record it, which is the pairing R4.9 actually asks for.
 *
 * Every non-passing status is diagnosed, and the message carries the status
 * string verbatim inside double quotes. That verbatim copy is the requirement:
 * once `broken` and `failed` have both become `red`, the diagnostic is the only
 * surviving evidence of which one happened, and a reviewer deciding whether to
 * trust a red promise needs it. `passed` records nothing — a diagnostic per
 * passing member would bury the ones that matter.
 *
 * Returns the same mapping {@link memberStatusToVerdict} would, so a caller
 * never has to choose between mapping and recording.
 */
export function reportMemberStatus(
  report: MemberStatusReport,
  diagnostics?: DiagnosticSink,
): MemberStatusMapping {
  const mapping = memberStatusToVerdict(report.status);
  if (report.status === 'passed') return mapping;

  const member = describeMember(report);
  const file = typeof report.path === 'string' && report.path.trim().length > 0
    ? report.path.trim()
    : null;

  if (!mapping.known) {
    diagnostics?.report({
      code: MEMBER_STATUS_DIAGNOSTIC_CODES.unknown,
      severity: 'warn',
      message:
        `testrun_member_end reported status "${report.status}" for ${member}, which is ` +
        `outside the four statuses Kane documents. Recorded as verdict ` +
        `${mapping.verdict}; nothing is proven and nothing is claimed failed.`,
      file,
    });
    return mapping;
  }

  diagnostics?.report({
    code: MEMBER_STATUS_DIAGNOSTIC_CODES.recorded,
    severity: report.status === 'failed' ? 'info' : 'warn',
    message:
      `testrun_member_end reported status "${report.status}" for ${member}, mapped to ` +
      `verdict ${mapping.verdict}. Recorded verbatim so a ${report.status} member stays ` +
      `distinguishable from an asserted failure.`,
    file,
  });
  return mapping;
}
