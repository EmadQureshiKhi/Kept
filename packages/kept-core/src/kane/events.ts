/**
 * The Kane 0.8.4 event surface — one typed module for all three terminal
 * contracts (design §4.3, §5.3.1, R3.16 through R3.22).
 *
 * This file is a **type surface plus one open vocabulary**. It holds no parsing
 * logic: classification lives in `kane/ndjson.ts` (§4.3) and every numeric read
 * of `result_code` or credits goes through `kane/coerce.ts` (§4.4). What it does
 * hold is the shape of what Kane actually emitted on this machine, and the
 * fences that stop a plausible-but-wrong field from being trusted.
 *
 * Three facts drive every decision below.
 *
 * **1. Three terminal events, not one.** `run_end` ends an `ExecutionRun`,
 * `testrun_done` ends an `ExecutionTestrun`, `done` ends an `Assurance` command.
 * {@link TerminalEvent} indexes the three shapes by family through
 * `TerminalType<F>`, so `TerminalEvent<'ExecutionRun'>` is the `run_end` shape
 * and nothing else. A parser typed against one shape would report *nothing*,
 * silently, on both of the paths KEPT actually depends on.
 *
 * **2. The vocabulary is open, by Kane's own documentation** — "new event types
 * and fields may appear in any release". Two of the twelve lines of our recorded
 * smoke run (`recording_state`, `skill_update_available`) are documented
 * nowhere at all. So {@link KNOWN_EVENT_TYPES} is a *recognition* list, never an
 * allow-list: an unrecognised `type` is retained and processing continues
 * (R3.9), and every event interface here carries an index signature so an
 * unannounced field survives the trip rather than being a type error. The
 * flip side of that tolerance is that reading an undeclared key yields
 * `unknown`, which is exactly the friction we want — a new field has to be
 * narrowed deliberately before anything keys off it.
 *
 * **3. The wire is untrusted and internally inconsistent.** Our own smoke run
 * carries the result code as the number `100` at the top level and as the string
 * `"100"` inside `per_flow_metadata[0]` — two types in one event. Every field a
 * branch could key on is therefore typed as the widest plausible wire union, so
 * the compiler forces a normalising step instead of letting a raw comparison
 * look correct. Nothing here validates; validation would imply we know the
 * schema, and for the nested payloads (`context`, `final_state`, `coverage`) we
 * demonstrably do not.
 *
 * The documented `run_start`, `step_start` and `step_end` events **do not exist**
 * in 0.8.4 and are deliberately absent. Progress is identified structurally, by
 * the presence of a `step` key (R3.8, {@link ProgressEvent}).
 */

import type { CommandFamily } from './family.js';

/**
 * A known literal vocabulary that stays open to values Kane has not shown us.
 *
 * `WireEnum<'passed' | 'failed'>` still completes and compares against the
 * literals, but an unrecognised string is not a type error — because on the wire
 * it is not an error, it is Tuesday. Exhaustive `switch` narrowing is
 * intentionally *not* available on these; every consumer needs a default arm,
 * and the mapping functions that read them (`memberStatusToVerdict`, §6.5) are
 * written total for that reason.
 */
export type WireEnum<Known extends string> = Known | (string & {});

/**
 * Every event type named by the verified surface (design §4.3), in that order.
 *
 * A recognition list, not an allow-list — see the module note. Exported so the
 * classifier of task 2.9 and the generators of task 2.11 read the same twenty-two
 * strings this module does.
 */
export const KNOWN_EVENT_TYPES = [
  'recording_state',
  'skill_update_available',
  'bifurcation',
  'project_folder_auto_defaulted',
  'child_agent_start',
  'child_agent_end',
  'ask_user',
  'error',
  'test_md_evidence_ingest',
  'test_md_bundle_sync',
  'run_end',
  'testrun_plan',
  'testrun_start',
  'testrun_member_start',
  'testrun_member_end',
  'testrun_investigations_wait',
  'testrun_evidence_ingest',
  'testrun_summary',
  'testrun_done',
  'coverage',
  'gaps',
  'done',
] as const;

/** One of the twenty-two recognised type values. */
export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];

/** A `type` value on the wire: recognised, or something new (R3.9). */
export type EventType = WireEnum<KnownEventType>;

const KNOWN_EVENT_TYPE_SET: ReadonlySet<string> = new Set(KNOWN_EVENT_TYPES);

/**
 * Is this a type value we recognise? Used by classification step 3 of §4.3 to
 * decide between "typed event" and "retain as unknown" — never to decide whether
 * to keep the event, which is always yes.
 */
export function isKnownEventType(value: unknown): value is KnownEventType {
  return typeof value === 'string' && KNOWN_EVENT_TYPE_SET.has(value);
}

/**
 * What every parsed Kane event has in common: an optional `type`, and whatever
 * else the release felt like sending.
 *
 * `type` is optional because progress events genuinely omit it — the eight
 * `{step, status, remark}` lines of our smoke run carry no `type` at all. The
 * index signature is the tolerance mechanism of R3.9, and it is also what makes
 * every event assignable to the `Record<string, unknown>` that
 * `FailureContext.terminal` (§6.1) takes.
 */
export interface KaneEventBase {
  readonly type?: EventType;
  readonly [key: string]: unknown;
}

/**
 * The Assurance envelope, **verified rather than assumed** (§5.3.1).
 *
 * Running `cover` with no `.context/` store emitted `{"type":"error","v":1,
 * "verb":"cover",…}` followed by the terminal `done`, which is what pins this
 * shape: every Assurance event carries `type`, `v` and `verb`. Both extra
 * members are typed **present-and-optional** — observed, so declared; not
 * guaranteed by any contract, so not required. `v` has only ever been `1`; it is
 * typed `number` because a version field that cannot change is not a version
 * field, and a consumer that cares must compare rather than assume.
 */
export interface AssuranceEnvelope extends KaneEventBase {
  /** Envelope version. Observed value: `1`. */
  readonly v?: number;
  /** The command word: `extract`, `design`, `reconcile`, `cover`, `gaps`. */
  readonly verb?: string;
}

/**
 * A progress line (R3.8). Identified by the presence of `step`, with or without
 * a `type` — the eight in our smoke run have none.
 *
 * `step` is `number | string` because only one typing has been observed and the
 * release notes reserve the right to change it; nothing routes off this value.
 */
export interface ProgressEvent extends KaneEventBase {
  readonly step: number | string;
  readonly status?: string;
  readonly remark?: string;
}

/**
 * A `verdict` object as it arrives on the wire — the raw shape, untrusted.
 *
 * Under bug detection a confirmed product bug carries this inline on the
 * terminal event alongside result code 740, which makes it structured triage
 * delivered in the stream: richer than reading `failure.yaml`, and the primary
 * router signal by R6.4.
 *
 * **This is the wire view, and stage 11 normalises it into its own.** The
 * verdict router (§6.1) works with a settled shape — `confirmed: boolean`,
 * plain strings — that it derives from this one. So `confirmed` and
 * `confidence`, the two fields a repair branch keys on, are deliberately typed
 * as the widest plausible wire unions: the compiler refuses to let a branch
 * treat `confirmed` as a boolean without normalising it first. That is the whole
 * point of the widening. Kane has shown us this object exactly once, in a
 * reference document rather than a run, so trusting its typing would be
 * trusting a screenshot.
 *
 * Every field is optional, including `confirmed`: an object missing it is a
 * shape we have to handle, not a crash.
 */
export interface VerdictObject {
  /** Widened deliberately — normalise, never trust (R6.4). */
  readonly confirmed?: boolean | string | number | null;
  readonly family?: string | null;
  readonly category?: string | null;
  readonly severity?: string | number | null;
  readonly one_liner?: string | null;
  /** Widened deliberately — coerce before comparing to any threshold. */
  readonly confidence?: number | string | null;
  readonly [key: string]: unknown;
}

/** The six field names R3.16 requires a Verdict_Object to expose. */
export const VERDICT_OBJECT_FIELDS = [
  'confirmed',
  'family',
  'category',
  'severity',
  'one_liner',
  'confidence',
] as const;

/**
 * Structural guard: does this value look like a `verdict` object?
 *
 * Recognition, not validation — it answers "is there something here worth
 * normalising", which is the only question the parser and the router ask. An
 * object carrying at least one of the six known fields qualifies; `{}`, `null`,
 * an array and a string do not, because handing an empty object to the router
 * would let rule 1 of §6.2 fire (`confirmed` absent reads as not-confirmed) on
 * no evidence at all.
 */
export function isVerdictObject(value: unknown): value is VerdictObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return VERDICT_OBJECT_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(value, field),
  );
}

/**
 * One entry of `run_end.per_flow_metadata` — the second place the result code
 * appears, and the place it appears with a *different type* to the top level.
 * Read it only through `resultCode()` from `kane/coerce.ts`.
 */
export interface PerFlowMetadata {
  readonly result_code?: number | string | null;
  readonly reason_code?: string | null;
  readonly error_message?: string | null;
  readonly summary?: string | null;
  readonly one_liner?: string | null;
  readonly credits_consumed?: number | string | null;
  readonly credits?: number | string | null;
  readonly [key: string]: unknown;
}

/**
 * `run_end.context`. The three members are observed; their internal schemas are
 * not pinned by anything, so they stay `unknown` rather than acquiring a shape
 * we invented. Narrow at the point of use or leave them alone.
 */
export interface RunEndContext {
  readonly memory?: unknown;
  readonly variables?: unknown;
  readonly pointer?: unknown;
  readonly [key: string]: unknown;
}

/**
 * `run_end` — terminal event of the `ExecutionRun` family (R3.17).
 *
 * Field set taken from the recorded smoke run, which is the only `run_end` we
 * have actually seen. Two absences are load-bearing:
 *
 * - **No evidence-pack field, of any name.** The `kane-cli evidence serve <path>`
 *   hint is printed on **stderr**, never in the event, so a path is resolved
 *   from the family contract by `resolveEvidenceDir` and never read out of an
 *   event (§4.6, R3.19).
 * - **No readable `run_dir`.** See {@link RunEndEvent.runDirLegacy}.
 */
export interface RunEndEvent extends KaneEventBase {
  readonly type: 'run_end';
  /** Observed: `passed`. The full vocabulary is not pinned, so: a string. */
  readonly status?: string;
  readonly summary?: string;
  readonly one_liner?: string;
  readonly reason?: string;
  readonly duration?: number | string;
  readonly final_state?: unknown;
  readonly bifurcated?: boolean;
  readonly total_runs?: number | string;
  readonly run_id?: string;
  readonly context?: RunEndContext;
  /** Observed field name. Read through `credits()` — never directly. */
  readonly credits_consumed?: number | string | null;
  /** Documented by skill v0.0.17, never observed. Accepted as a fallback. */
  readonly credits?: number | string | null;
  /** Number here, string in `per_flow_metadata`. Read through `resultCode()`. */
  readonly result_code?: number | string | null;
  readonly reason_code?: string | null;
  readonly per_flow_metadata?: readonly PerFlowMetadata[];
  /** Root of the session tree. The only path in the event we ever use. */
  readonly session_dir?: string;
  readonly test_url?: string;
  /** Present under bug detection, absent otherwise (R3.16). */
  readonly verdict?: VerdictObject;
  /**
   * The legacy run directory, deliberately renamed and deliberately unusable.
   *
   * Kane no longer creates this directory, but the key is still emitted — our
   * smoke run carries it. It is declared under a name that no evidence-resolution
   * code would ever reach for, so that a stream carrying the key type-checks
   * while nobody can mistake the value for somewhere files exist (R3.18, §4.6).
   *
   * **No filesystem call may ever take this value.** Evidence locations come
   * from the family contract, never from an event. The wire key itself is not
   * declared on this interface at all: reading it goes through the index
   * signature and answers `unknown`, so it cannot be passed anywhere a path is
   * expected without an explicit cast.
   */
  readonly runDirLegacy?: string;
}

/** The `run_end` fields this module declares as readable, in wire order. */
export const RUN_END_WIRE_FIELDS = [
  'type',
  'status',
  'summary',
  'one_liner',
  'reason',
  'duration',
  'final_state',
  'bifurcated',
  'total_runs',
  'run_id',
  'context',
  'credits_consumed',
  'credits',
  'result_code',
  'reason_code',
  'per_flow_metadata',
  'session_dir',
  'test_url',
  'verdict',
] as const;

/**
 * One member of `testrun_plan.members[]` (R3.21).
 *
 * `test_id` here is **the authority** for the path-to-assurance-id mapping the
 * blast-radius selector hands to `--from-context` (§7.1). Frontmatter is a cache;
 * this is the source. A member whose `test_id` is absent or null is never
 * selected — `string | null | undefined` keeps that case visible in the type
 * rather than letting an empty string masquerade as an id.
 */
export interface TestrunPlanMember {
  readonly path?: string;
  readonly test_id?: string | null;
  readonly tags?: readonly string[];
  readonly failure?: string | null;
  readonly [key: string]: unknown;
}

/**
 * `testrun_plan` — the first event of a `testrun` stream, and the only one a
 * `--dry-run` invocation exists to collect (§7.2).
 *
 * `valid: false` means nothing ran and the process exits 2 (preflight-rejected
 * for this family). The normalised cache written to `.kept/plan.json` is a
 * *different*, settled type (`TestrunPlan` in `radius/plan.ts`, §7.2); this is
 * the wire shape it is built from.
 */
export interface TestrunPlanEvent extends KaneEventBase {
  readonly type: 'testrun_plan';
  readonly valid?: boolean;
  readonly members?: readonly TestrunPlanMember[];
}

/**
 * The four values `testrun_member_end.status` takes (R3.20) — four, not two.
 *
 * `broken` and `interrupted` are the two that a pass/fail model loses: a broken
 * member is not an asserted failure, and an interrupted member proved nothing at
 * all. `verdict/memberStatus.ts` (§6.5) maps these to verdicts totally, and
 * records the last two verbatim in diagnostics (R4.9).
 */
export const MEMBER_END_STATUSES = ['passed', 'failed', 'broken', 'interrupted'] as const;

/** One of the four observed member statuses. */
export type MemberEndStatus = (typeof MEMBER_END_STATUSES)[number];

/**
 * `testrun_member_end` — per-member outcome of a `testrun` stream. Together with
 * the terminal `testrun_done`, the only source of verdict data for this family
 * (R3.3).
 *
 * Only `status` is pinned by observation. `path` and `test_id` are declared
 * because the member has to be tied back to a promise and Kane's plan carries
 * both under these names; treat a missing one as "cannot attribute", never as a
 * reason to guess.
 */
export interface MemberEndEvent extends KaneEventBase {
  readonly type: 'testrun_member_end';
  readonly status?: WireEnum<MemberEndStatus>;
  readonly path?: string;
  readonly test_id?: string | null;
  /** Present under bug detection on a failing member (R3.16). */
  readonly verdict?: VerdictObject;
}

/**
 * `testrun_summary.totals`. The one testrun payload shape the verified surface
 * pins, and the counts stage 7 reports.
 */
export interface TestrunTotals {
  readonly tests?: number | string;
  readonly passed?: number | string;
  readonly failed?: number | string;
  readonly broken?: number | string;
  readonly skipped?: number | string;
  readonly [key: string]: unknown;
}

/** `testrun_summary` — precedes the terminal event, carries the counts. */
export interface TestrunSummaryEvent extends KaneEventBase {
  readonly type: 'testrun_summary';
  readonly totals?: TestrunTotals;
}

/**
 * `testrun_done` — terminal event of the `ExecutionTestrun` family.
 *
 * There is no `--agent` flag on `testrun run`; NDJSON appears because stdout is
 * a pipe (R3.5). We have not captured one of these yet, so the shape is
 * deliberately thin: `status` and `totals` are declared as tolerated-if-present
 * echoes of the summary, everything else arrives through the index signature.
 * Declaring fields we have not seen would be inventing a contract, and this
 * module's whole value is that it does not.
 */
export interface TestrunDoneEvent extends KaneEventBase {
  readonly type: 'testrun_done';
  readonly status?: string;
  readonly totals?: TestrunTotals;
}

/**
 * The six `done.status` values of the Assurance family (R3.22). `refused` is
 * observed, not merely documented (§5.3.1).
 */
export const ASSURANCE_STATUSES = [
  'complete',
  'paused',
  'error',
  'refused',
  'interrupted',
  'aborted',
] as const;

/** One of the six documented Assurance terminal statuses. */
export type AssuranceStatus = (typeof ASSURANCE_STATUSES)[number];

/**
 * `error` inside an Assurance stream — the first of the two verified refusal
 * lines. `message` is quoted verbatim into a diagnostic so the Ledger tells a
 * reviewer the actual remedy ("run `kane-cli context ingest` first") instead of
 * a generic failure (§5.3). An `error` event can also appear in a `run` stream,
 * where the envelope members are simply absent.
 */
export interface KaneErrorEvent extends AssuranceEnvelope {
  readonly type: 'error';
  readonly message?: string;
}

/**
 * `done` — terminal event of the `Assurance` family, and the reason a refusal is
 * a **complete** stream rather than a crashed one (§5.3.1).
 *
 * `done` is emitted even when the command refused to do any work, so
 * `kind: 'complete'` with `status: 'refused'` is a different and much better
 * outcome than `kind: 'crashed'`: one of them knows what happened.
 *
 * `exit_code` here is the **event's own** exit code, carried inside the stream.
 * It is not the process exit code, and the two are never merged (R3.14): the
 * process code goes through `exitMeaning(family, code, killed)`, which is the
 * only thing that knows that 3 means paused-and-resumable for this family. Both
 * were 2 in the observed refusal, which is precisely why they are easy to
 * conflate and worth keeping apart. It is typed `number | string` and coerced
 * before comparison, on the same evidence that forced coercion on the result
 * code.
 */
export interface AssuranceDoneEvent extends AssuranceEnvelope {
  readonly type: 'done';
  readonly status?: WireEnum<AssuranceStatus>;
  /** The event's exit code. **Not** the process exit code (R3.14). */
  readonly exit_code?: number | string;
  readonly message?: string;
}

/**
 * Anything else: a recognised type with no dedicated interface
 * (`recording_state`, `bifurcation`, `coverage`, `gaps`, …) or a type from a
 * release newer than this file.
 *
 * Retention is unconditional (R3.9). Because the vocabulary is open, this arm
 * cannot be excluded by a `type` check, so `KaneEvent` is a tolerant union
 * rather than a discriminated one: narrowing to a typed arm is the classifier's
 * job (§4.3), and the typed shape it produces is reached by classification, not
 * by inspecting `type` at a random call site.
 */
export type OtherKaneEvent = KaneEventBase;

/** Every shape a parsed line can take. */
export type KaneEvent =
  | ProgressEvent
  | RunEndEvent
  | TestrunPlanEvent
  | MemberEndEvent
  | TestrunSummaryEvent
  | TestrunDoneEvent
  | KaneErrorEvent
  | AssuranceDoneEvent
  | OtherKaneEvent;

/**
 * The terminal event shape of a family, indexed by family so that it narrows
 * alongside `TerminalType<F>` from `kane/family.js`.
 *
 * `TerminalEvent<'ExecutionRun'>` is the `run_end` shape and `TerminalEvent<
 * 'Assurance'>` is the `done` shape, so `ParsedStream<F>.terminal` (§4.2) cannot
 * be read as the wrong family's event. That is the structural half of the
 * three-contract model: the other half is that `parseStream` takes a
 * `FamilyContract` it cannot be handed by accident.
 */
export type TerminalEvent<F extends CommandFamily> = F extends 'ExecutionRun'
  ? RunEndEvent
  : F extends 'ExecutionTestrun'
    ? TestrunDoneEvent
    : AssuranceDoneEvent;
