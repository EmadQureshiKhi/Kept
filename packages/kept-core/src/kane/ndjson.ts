/**
 * The family-gated NDJSON parser (design §4.2, §4.3, R3.1, R3.3, R3.6, R3.8,
 * R3.9, R3.23, R3.24, R3.25).
 *
 * `parseStream(contract, lines)` is the **only** exported parse entry point.
 * There is no overload without a contract, no default first parameter and no
 * `parseAny`, and `FamilyContract` has no public constructor — `contractFor()`
 * in `kane/family.ts` is the only way to obtain one, and its brand is
 * module-private, so a structural object literal is a compile error wherever a
 * contract is expected. The consequence is the point: **a parse call cannot
 * exist in this codebase without a family named at the call site.**
 *
 * That fence exists because Kane 0.8.4 has three terminal events, not one:
 * `run_end` ends an `ExecutionRun`, `testrun_done` ends an `ExecutionTestrun`,
 * `done` ends an `Assurance` command. A parser that waited for `run_end` alone
 * would report *nothing, silently* on blast-radius verification and on the
 * Ledger's own data source — the two paths KEPT actually depends on — because
 * neither stream ever carries the event it was waiting for. So the expected
 * terminal type is read off `contract.terminalType` and never re-derived here.
 *
 * It composes with the process boundary directly:
 *
 * ```ts
 * const result = await invoker.invoke(spec);
 * const stream = parseStream(contractFor(spec.family), result.stdoutLines);
 * ```
 *
 * `KaneInvoker` deliberately returns `stdoutLines: readonly string[]` rather
 * than a `ParsedStream`, which keeps the spawn layer independent of event types;
 * this module is where the two meet.
 *
 * ## The type decision that carries the most weight
 *
 * `terminal` exists **only** on the `complete` arm of {@link ParsedStream}. That
 * is not stylistic. A stream truncated before its terminal event has a genuinely
 * unknown outcome — never a pass, never a failure — and every state writer
 * refuses one (§4.7). Fencing the field to one arm turns "read the verdict off a
 * crashed stream" into a compile error instead of an `undefined` that flows
 * downstream and reads as a pass. The `crashed` arm carries `expectedTerminal`
 * instead, so a reviewer is told *what was waited for*, plus an
 * outcome-unknown diagnostic naming both the family and that type (R3.6).
 *
 * A refusal is the mirror image and just as load-bearing: `cover` with no
 * `.context/` store emits `done` with `status: 'refused'`, so it is a
 * **complete** stream (§5.3.1). Reading it as crashed would turn "there is no
 * context store" into "Kane crashed" — one of those two knows what happened.
 *
 * ## Where this is a superset of the design sketch
 *
 * §4.2 draws the `crashed` arm thinly, with only `events` and `diagnostics`.
 * Correctness property 7 quantifies the per-line losslessness rules — one event
 * per JSON line, `step`-first classification, unknown-type retention — over
 * *arbitrary* line sequences, and most arbitrary sequences are crashed. So the
 * per-line views (`events`, `progress`, `unknown`, `members`, `plan`,
 * `coverage`, `gaps`) are shared by both arms, and the sole asymmetry is the one
 * that has to be asymmetric: `terminal` against `expectedTerminal`.
 */

import type { Diagnostic, DiagnosticDraft, DiagnosticSink } from '../diagnostics.js';
import { createDiagnosticSink } from '../diagnostics.js';
import type {
  KaneEvent,
  MemberEndEvent,
  ProgressEvent,
  TerminalEvent,
  TestrunPlanEvent,
} from './events.js';
import { isKnownEventType } from './events.js';
import type { CommandFamily, FamilyContract, TerminalType } from './family.js';

/** Diagnostic code for a line that failed strict JSON parsing (§4.3, R3.24). */
export const NDJSON_PARSE_DIAGNOSTIC_CODE = 'ndjson-parse';

/**
 * Diagnostic code for a stream that ended without its family's terminal event
 * (R3.6). Distinct from {@link NDJSON_PARSE_DIAGNOSTIC_CODE} because the two say
 * completely different things: one line was unreadable, versus the whole outcome
 * is unknown.
 */
export const NDJSON_CRASHED_DIAGNOSTIC_CODE = 'ndjson-crashed-stream';

/** How much of an unreadable line is quoted into its diagnostic (§4.3). */
export const NDJSON_SNIPPET_LENGTH = 120;

/**
 * The key whose mere presence makes an event a progress event (R3.8).
 *
 * Structural, not nominal, because the documented `run_start` / `step_start` /
 * `step_end` events **do not exist** in 0.8.4. What a real stream carries is
 * eight untyped `{step, status, remark}` objects with no `type` field at all, so
 * there is nothing else to classify them by.
 */
export const PROGRESS_KEY = 'step';

/** Wire type names this module routes into their own typed bucket. */
const MEMBER_END_TYPE = 'testrun_member_end';
const TESTRUN_PLAN_TYPE = 'testrun_plan';
const COVERAGE_TYPE = 'coverage';
const GAPS_TYPE = 'gaps';

/**
 * Everything both arms expose: the lossless, per-line view of the stream.
 *
 * `events` and `progress` are **disjoint and jointly exhaustive** over the lines
 * that parsed as a JSON object, so `events.length + progress.length` is exactly
 * that count (R3.1). The winning terminal event is in `events` as well as in
 * `terminal`; `unknown` and `members` and `plan` and `coverage` are *views* into
 * `events`, not removals from it — nothing is ever moved out of the stream.
 */
export interface ParsedStreamShared<F extends CommandFamily> {
  /** The family this stream was parsed against. Never inferred (R3.2). */
  readonly family: F;
  /** Every non-progress event, in wire order, terminal included. */
  readonly events: readonly KaneEvent[];
  /** Every event carrying a `step` key, in wire order (R3.8). */
  readonly progress: readonly ProgressEvent[];
  /** Events whose `type` is outside the recognised set. Retained (R3.9). */
  readonly unknown: readonly KaneEvent[];
  /** `testrun_member_end` events, in wire order. ExecutionTestrun in practice. */
  readonly members: readonly MemberEndEvent[];
  /** The last `testrun_plan` event, or null. */
  readonly plan: TestrunPlanEvent | null;
  /**
   * The last `coverage` event, exposed **raw** — the whole event, exactly as it
   * arrived.
   *
   * Nothing is lifted out of it and nothing is projected. The payload's internal
   * schema is not pinned by observation (§5.3), so deciding that the payload is
   * the nested `coverage` key rather than the event would be this module
   * inventing a schema and dropping `pack` and `generated_at` on the way. The
   * event is the superset: a consumer that wants the nested view can take it,
   * and `providers/coverage.ts` reads it tolerantly by walking for arrays of
   * objects rather than hard-coding a path. Reading any field answers `unknown`
   * through the index signature, which is the friction that keeps a guess
   * deliberate.
   */
  readonly coverage: KaneEvent | null;
  /**
   * The last `gaps` event, exposed **raw**, on exactly the terms `coverage` is.
   *
   * `cover gaps` is where the dual coverage axes actually come from on this
   * repository (§5.3.0): the singular `cover` reads its depth axis out of a sealed
   * Evidence_Pack and refuses on a replay pack, which is every pack here. So this
   * is the payload `providers/enrichment.ts` gates on, and it is exposed as its own
   * view rather than being left for a consumer to fish out of `events`, the same
   * reason `coverage` has one.
   *
   * Raw, and for the same reason: the payload's internal schema is observed rather
   * than documented, so lifting the nested `design_completeness` and `proven`
   * blocks out here would be this module inventing a schema and dropping `stage`,
   * `rollup_version` and the per-use-case dossier on the way. `providers/coverage.ts`
   * reads it tolerantly.
   */
  readonly gaps: KaneEvent | null;
  /** Everything recorded while parsing, in report order. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * A stream that reached the terminal event its family expects. The **only** arm
 * carrying `terminal`.
 */
export interface CompleteStream<F extends CommandFamily> extends ParsedStreamShared<F> {
  readonly kind: 'complete';
  /**
   * The terminal event, typed by family: `run_end` for `ExecutionRun`,
   * `testrun_done` for `ExecutionTestrun`, `done` for `Assurance`.
   *
   * The **last** event of that type wins; earlier ones stay in `events`.
   * `complete` says the stream ended properly, not that it succeeded, a refusal
   * and a failure are both complete. The verdict is `terminal.status`, and the
   * exit-code half of the story is `exitMeaning()` in `kane/exit.ts`.
   */
  readonly terminal: TerminalEvent<F>;
}

/**
 * A stream that ended without its family's terminal event: **outcome unknown**,
 * never a pass, never a failure (R3.6, R3.7).
 *
 * Carries no `terminal` at all, which is what makes reading a verdict off it a
 * compile error rather than a runtime `undefined`.
 */
export interface CrashedStream<F extends CommandFamily> extends ParsedStreamShared<F> {
  readonly kind: 'crashed';
  /**
   * The terminal type that never arrived, from the contract — so a reviewer is
   * told what was being waited for instead of just that something is missing.
   */
  readonly expectedTerminal: TerminalType<F>;
}

/**
 * The parse result. Discriminated on `kind`, and the discriminant has to be
 * checked before a terminal event can be read.
 */
export type ParsedStream<F extends CommandFamily> = CompleteStream<F> | CrashedStream<F>;

/** Optional wiring. Both members are additive; neither changes classification. */
export interface ParseStreamOptions {
  /**
   * Where diagnostics are also reported, so a whole run collects into one sink
   * for the snapshot. They are returned on the result either way — `report()`
   * hands back the record it stored, so one call does both jobs.
   */
  readonly sink?: DiagnosticSink;
  /** Repository-relative path to attribute diagnostics to, when there is one. */
  readonly file?: string | null;
}

/** Own-property test that is safe on any parsed value. */
function hasOwn(source: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

/**
 * Is this parsed value an event at all?
 *
 * A JSON scalar or array is well-formed JSON and still not an event. Admitting
 * one would mean `events` contained a number typed as a `KaneEvent`, which is a
 * lie the whole event module exists to avoid, so it is diagnosed like any other
 * unreadable line and parsing continues.
 */
function isEventObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What a non-event line actually was, for its diagnostic message. */
function describeNonEvent(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

/** The quoted fragment of an unreadable line. Whitespace collapsed to one line. */
function snippetOf(line: string): string {
  const flat = line.trim().replace(/\s+/gu, ' ');
  return flat.length <= NDJSON_SNIPPET_LENGTH
    ? flat
    : `${flat.slice(0, NDJSON_SNIPPET_LENGTH)}…`;
}

/** The reason `JSON.parse` refused, without assuming what was thrown. */
function parseFailureReason(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : 'invalid JSON';
}

/**
 * Parse an NDJSON stream against a declared command family.
 *
 * Never throws for the state of the world — a malformed line, a truncated
 * stream, an empty iterable and a wall of human-readable preamble are all
 * outcomes, recorded as data (§14.2). The one thing that does throw is being
 * handed something that is not a contract, which is unreachable without a cast
 * and is a programming error.
 *
 * Line handling, over the raw input with **one-based** line numbers (§4.3):
 *
 * 1. Before the first line whose trimmed form starts with `{`, every line is
 *    skipped **silently** — no diagnostic, no event (R3.23). Kane prints banners
 *    and progress chatter before the stream begins, and diagnosing those would
 *    bury the diagnostics that matter.
 * 2. A blank line is skipped silently. NDJSON ends with a newline.
 * 3. A line that fails strict JSON parsing, or parses to something that is not
 *    an object, records one `ndjson-parse` diagnostic carrying its one-based
 *    line number and a snippet, then parsing **continues** (R3.24).
 *
 * Classification of each parsed object, in this order:
 *
 * 1. A `step` own-key makes it a progress event, whether or not `type` is
 *    present (R3.8). This test is genuinely first, so an event carrying both
 *    `step` and a terminal `type` is progress and the stream reads crashed.
 *    Deliberate: no observed terminal event carries `step`, and if one ever did,
 *    "outcome unknown" is the safe direction — the alternative is reading a
 *    verdict off a progress line.
 * 2. `type === contract.terminalType` makes it the terminal candidate. The last
 *    such event wins; earlier ones are retained in `events`.
 * 3. `testrun_member_end`, `testrun_plan`, `coverage` and `gaps` additionally
 *    land in their own typed bucket. Unconditionally, not gated on family: only an
 *    `ExecutionTestrun` stream carries members in practice, and R3.3's rule that
 *    verdict data comes from the terminal event plus this family's members is
 *    enforced by the verdict layer naming a family, not by this module silently
 *    emptying an array.
 * 4. Anything whose `type` is outside the recognised set is retained in
 *    `unknown` and processing continues (R3.9). The vocabulary is open by Kane's
 *    own documentation — two of the twelve lines of the recorded smoke run are
 *    documented nowhere — so recognition never gates retention.
 */
export function parseStream<F extends CommandFamily>(
  contract: FamilyContract<F>,
  lines: Iterable<string>,
  options: ParseStreamOptions = {},
): ParsedStream<F> {
  const sink = options.sink ?? createDiagnosticSink();
  const file = options.file ?? null;
  const diagnostics: Diagnostic[] = [];
  const report = (draft: DiagnosticDraft): void => {
    diagnostics.push(sink.report(draft));
  };

  // Read once. The contract is the single source of the expected terminal type;
  // widened to `string` because a deferred conditional type cannot be compared
  // against an arbitrary wire value.
  const terminalType = contract.terminalType as string;

  const events: KaneEvent[] = [];
  const progress: ProgressEvent[] = [];
  const unknown: KaneEvent[] = [];
  const members: MemberEndEvent[] = [];
  let plan: TestrunPlanEvent | null = null;
  let coverage: KaneEvent | null = null;
  let gaps: KaneEvent | null = null;
  let terminal: KaneEvent | null = null;

  let seenFirstBrace = false;
  let lineNumber = 0;

  for (const rawLine of lines) {
    lineNumber += 1;
    const line = typeof rawLine === 'string' ? rawLine : String(rawLine);

    if (!seenFirstBrace) {
      if (!line.trimStart().startsWith('{')) continue;
      seenFirstBrace = true;
    }
    if (line.trim().length === 0) continue;

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      report({
        code: NDJSON_PARSE_DIAGNOSTIC_CODE,
        severity: 'warn',
        message:
          `line ${lineNumber} is not valid NDJSON (${parseFailureReason(error)}); ` +
          `skipped, parsing continued: ${snippetOf(line)}`,
        file,
        line: lineNumber,
      });
      continue;
    }

    if (!isEventObject(value)) {
      report({
        code: NDJSON_PARSE_DIAGNOSTIC_CODE,
        severity: 'warn',
        message:
          `line ${lineNumber} parsed as JSON but is ${describeNonEvent(value)}, ` +
          `not a Kane event; skipped, parsing continued: ${snippetOf(line)}`,
        file,
        line: lineNumber,
      });
      continue;
    }

    // Classification step 1 (R3.8): structural, and genuinely first.
    if (hasOwn(value, PROGRESS_KEY)) {
      progress.push(value as ProgressEvent);
      continue;
    }

    const event = value as KaneEvent;
    events.push(event);
    const type = value['type'];

    // Step 2: the last terminal-type event wins.
    if (type === terminalType) terminal = event;

    // Step 3: typed buckets that are not the terminal event.
    if (type === MEMBER_END_TYPE) members.push(value as MemberEndEvent);
    if (type === TESTRUN_PLAN_TYPE) plan = value as TestrunPlanEvent;
    if (type === COVERAGE_TYPE) coverage = event;
    if (type === GAPS_TYPE) gaps = event;

    // Step 4: recognition, not an allow-list. Retention is unconditional.
    if (!isKnownEventType(type)) unknown.push(event);
  }

  const shared = {
    family: contract.family,
    events: Object.freeze(events),
    progress: Object.freeze(progress),
    unknown: Object.freeze(unknown),
    members: Object.freeze(members),
    plan,
    coverage,
    gaps,
  } as const;

  if (terminal === null) {
    report({
      code: NDJSON_CRASHED_DIAGNOSTIC_CODE,
      severity: 'warn',
      message:
        `${contract.family} stream ended without its terminal ${terminalType} event: ` +
        `outcome unknown, neither a pass nor a failure`,
      file,
      line: null,
    });
    const crashed: CrashedStream<F> = {
      kind: 'crashed',
      ...shared,
      expectedTerminal: contract.terminalType,
      diagnostics: Object.freeze(diagnostics),
    };
    return Object.freeze(crashed);
  }

  const complete: CompleteStream<F> = {
    kind: 'complete',
    ...shared,
    // The single cast in this module. Classification established that this
    // event's `type` is the family's terminal type, which is precisely what
    // `TerminalEvent<F>` encodes — and `KaneEvent` is a tolerant union, so
    // `type` narrowing cannot do it for us (see `kane/events.ts`).
    terminal: terminal as unknown as TerminalEvent<F>,
    diagnostics: Object.freeze(diagnostics),
  };
  return Object.freeze(complete);
}
