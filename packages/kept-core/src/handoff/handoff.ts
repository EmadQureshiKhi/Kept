/**
 * The handoff file — the closed-loop contract (design §11.2, §11.3, §8.1,
 * §14.1, R7.1, R11.4, R11.7).
 *
 * This is the file that makes the loop real rather than claimed. KEPT writes it,
 * the Kiro hook's agent prompt reads it, the agent repairs inside the fence it
 * declares, saving that repair re-fires the hook, and the verdict moves. Every
 * other artefact in the system is a *record*; this one is an *instruction*, and
 * two properties of it carry the whole weight.
 *
 * ## One: it is written for every run
 *
 * A crashed stream, a paused Assurance run, a preflight rejection, a missing
 * binary, an unresolved reconcile source, a blast radius that selected nothing —
 * every one of those writes a handoff, with `nextAction.branch: null` and a
 * populated `diagnostics` array. That is not defensive padding. If a failure path
 * wrote nothing, the agent would open `.kept/handoff.json` and read the
 * *previous* run's instruction: it would repair a promise that is no longer red,
 * inside a fence derived from a run that has already been superseded. A run that
 * produced no verdict still produced a fact, and the loop has to be able to read
 * it (§14.1 puts "written, `branch: null`" in the Handoff column of almost every
 * adversity row for exactly this reason).
 *
 * The invariant is therefore stated positively and mechanically: **`branch` is
 * `null` only together with at least one diagnostic**. {@link buildHandoff}
 * synthesises the diagnostic itself when the caller supplied none, so a future
 * refactor that starts returning early on a crash path cannot produce a silent
 * handoff — there is no code path through this module that emits a null branch
 * with an empty `diagnostics`.
 *
 * ## Two: the fence is by branch
 *
 * `nextAction.allowedPaths` and `forbiddenPaths` are what make branch-specific
 * autonomy (§8.1) real rather than rhetorical.
 *
 * On `code-break` the product is wrong, so the agent may edit the configured
 * subject source and **nothing else**. Not the documentation the claim is written
 * in — that would let the loop "fix" a red promise by editing the claim, which is
 * the precise dishonesty this product exists to prevent. Not the corpus root,
 * where the designed tests live — that would let it weaken the test instead of
 * fixing the bug. Not the engine's own package roots — KEPT's code is never the
 * repair target.
 *
 * Which paths those are is **not decided here** (§20.1, R15.2, R15.7). This module
 * used to spell three fixture source globs, two fixture documentation paths, a
 * corpus root and two package roots, every one of them a fact about a single
 * repository sitting in a package a stranger installs. They arrive now as
 * {@link FenceSurfaces}, resolved by the CLI from `.kept/config.json` and already
 * past the intersection guard of §20.3. The dependency direction forces it as much
 * as the design does: `kept-cli` depends on `kept-core`, so core cannot read the
 * config and must be handed what it may not invent.
 *
 * On `test-drift` and `docs-lie` the fence is empty on the allowed side, because
 * §8.1 says those repairs are *held* and *never silent*: `kept evolve` produces a
 * review card and `kept amend propose` produces an amendment carrying a rendered
 * diff, and a human decides. So the difference between the branches is encoded
 * three ways at once — in `allowedPaths` (non-empty only for `code-break`), in
 * {@link HandoffNextAction.autonomy} and {@link HandoffNextAction.artefact},
 * which are §8.1's own two columns, and in `command`, the exact CLI invocation
 * §11.1's prompt tells the agent to run.
 *
 * ## What this module does not do
 *
 * It never decides whether a verdict moved. `mayWriteVerdicts` in `state.ts` is
 * the single write guard, and {@link HandoffOutcome.verdictsPermitted} *reads*
 * it — one call, no second copy of the rule. It never composes an evidence path
 * either: every path in a result comes from an {@link EvidenceListing}, which
 * derived it from the command family (§4.6). An `evidenceRef` is a real resolved
 * path or it is `null`; there is no third option.
 */

import type { Diagnostic, DiagnosticClock, DiagnosticSink } from '../diagnostics.js';
import { createDiagnosticSink } from '../diagnostics.js';
import { credits, resultCode } from '../kane/coerce.js';
import type { MemberEndStatus } from '../kane/events.js';
import type { EvidenceListing } from '../kane/evidence.js';
import { permitsVerdictWrite, type ExitMeaning } from '../kane/exit.js';
import { contractFor, type CommandFamily, type NdjsonEnabler } from '../kane/family.js';
import type { Citation, PromiseRecord, RepairBranch, Verdict } from '../model/promise.js';
import { isRepairBranch, isVerdict } from '../model/promise.js';
import type { BlastRadius } from '../radius/radius.js';
import { mayWriteVerdicts, type RunOutcome, type StateFileSystem } from '../state.js';
import { nodeStateFileSystem } from '../state.js';
import { normaliseVerdictObject, type RoutedRepair } from '../verdict/router.js';

// ---------------------------------------------------------------------------
// Where it lives
// ---------------------------------------------------------------------------

/** The only handoff schema version this build writes or recognises. */
export const HANDOFF_SCHEMA_VERSION = 1;

/** The newest handoff, always. What the hook prompts of §11.1 read (R11.4). */
export const HANDOFF_FILE_RELATIVE_PATH = '.kept/handoff.json';

/** Where the immutable per-run copies live (R11.7). */
export const HANDOFF_DIRECTORY_RELATIVE_PATH = '.kept/handoff';

/**
 * The two hooks that can trigger a run (§11.1). `null` on the trigger means a
 * human ran the CLI directly, which is a legitimate state and not a missing
 * field — `kept verify --all` and `kept reconcile apply` are both human-only.
 */
export const HANDOFF_HOOKS = Object.freeze(['kept-code-verify', 'kept-docs-reconcile'] as const);

/** One of the two hook names. */
export type HandoffHook = (typeof HANDOFF_HOOKS)[number];

/** Diagnostic codes this module reports. Stable; the Ledger keys off them. */
export const HANDOFF_DIAGNOSTIC_CODES = Object.freeze({
  /** No Kane process was started at all — an empty radius, or a refusal before spawn. */
  noInvocation: 'handoff-no-invocation',
  /** The stream ended without its family's terminal event, so the outcome is unknown. */
  outcomeUnknown: 'handoff-outcome-unknown',
  /** The exit meaning does not prove an outcome, so no verdict could move. */
  exitUnproven: 'handoff-exit-unproven',
  /** The run proved an outcome and there is nothing to repair. */
  noRepairNeeded: 'handoff-no-repair-branch',
  /**
   * A `code-break` names a promise KEPT has never proven, so automatic repair was
   * withheld for it (§8.1.1). Reported per promise, and reported whether or not the
   * grant happened overall — a radius holding one regression beside one never-proven
   * promise still keeps the record of which was which.
   */
  codeBreakUnproven: 'handoff-code-break-unproven',
  /** The immutable per-run copy already existed and was left exactly as it was. */
  archiveExists: 'handoff-archive-exists',
} as const);

/** Every code above, so a test can enumerate them and the Ledger can filter. */
export const HANDOFF_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(HANDOFF_DIAGNOSTIC_CODES),
);

// ---------------------------------------------------------------------------
// The fence (design §8.1, §11.2, R7.1)
// ---------------------------------------------------------------------------

/**
 * The two glob sets every fence in this module is made of, **resolved by the
 * caller from `Kept_Config` and never spelled here** (design §20.1, R15.2, R15.7).
 *
 * This module used to declare four constants: the three fixture source trees, the
 * two fixture documentation paths, `tests/**` and KEPT's own package roots. All
 * seven were facts about *one repository*, sitting in a package a host repository
 * installs as a dependency, which made the fence table a lie the moment the engine
 * ran anywhere else. They are now parameters, for a reason the dependency graph
 * decides rather than taste: `handoff.ts` lives in `kept-core` and the config
 * loader lives in `kept-cli`, so core *cannot* read the config. Values it must not
 * invent have to arrive as arguments.
 *
 * `allow` is `fences['code-break'].allow` as the loader resolved it — already past
 * the intersection guard of §20.3, so by the time it reaches here it provably
 * cannot reach the corpus or the documentation. `forbid` is `derivedForbidden`:
 * the corpus root, every documentation glob, both package roots and every
 * `subject.source` glob this branch was not granted.
 *
 * Both are required, everywhere, with no default in this module. A fail-closed
 * `{ allow: [], forbid: [] }` default would be tempting and is exactly wrong: a
 * caller that forgot to thread the config would silently hand the agent an empty
 * fence, `code-break` would stop repairing anything, and the loop would look alive
 * while doing nothing. A missing argument should be a compile error.
 */
export interface FenceSurfaces {
  /** Globs a `code-break` repair may write. Empty means no autonomy is granted. */
  readonly allow: readonly string[];
  /** Globs no branch may ever write. Disjoint from `allow`, by derivation. */
  readonly forbid: readonly string[];
}

/** What the agent is permitted to do about a branch — §8.1's Autonomy column. */
export type HandoffAutonomy = 'apply' | 'hold' | 'propose' | 'none';

/** What the repair produces — §8.1's Artefact column. */
export type HandoffArtefact = 'patch' | 'review-card' | 'amendment' | null;

/** One branch's fence, plus the autonomy and artefact §8.1 pairs with it. */
export interface HandoffFence {
  readonly autonomy: HandoffAutonomy;
  readonly artefact: HandoffArtefact;
  readonly instruction: string;
  /** Globs the agent may write. Non-empty **only** for `code-break`. */
  readonly allowedPaths: readonly string[];
  /** Globs the agent may never write. Disjoint from `allowedPaths`, always. */
  readonly forbiddenPaths: readonly string[];
}

/**
 * One row of §8.1's table: what a branch is permitted to do, what it produces,
 * what the agent is told, and whether it is the branch that receives the
 * configured allow set.
 *
 * **No glob appears here**, which is the whole point of the split. Autonomy,
 * artefact and instruction are facts about the *mechanism* and are the same in
 * every repository; the paths are facts about *this* repository and arrive as
 * {@link FenceSurfaces}. `grantsAllow` is the one bit of the table that decides
 * which side of that line a row falls on, and it is true for exactly one branch.
 */
export interface BranchFenceRow {
  readonly autonomy: HandoffAutonomy;
  readonly artefact: HandoffArtefact;
  readonly instruction: string;
  /**
   * Whether this row is handed `surfaces.allow`. `code-break` only.
   *
   * §8.1 makes `test-drift` and `docs-lie` *held*, so their allowed side is empty
   * regardless of what a configuration says — a user who writes an allow set under
   * a held branch has expressed a wish the design already answered, and the loader
   * reports it while this table keeps refusing it (§20.1, R15.7).
   */
  readonly grantsAllow: boolean;
}

/**
 * The fence table. Every branch-dependent autonomy fact is written here once,
 * which is what lets the hook prompts of §11.1 be prose about a mechanism rather
 * than a second copy of it.
 *
 * `none` is a real row, not a fallback: a crashed, paused, preflight-rejected or
 * source-unresolved run has no branch, and the honest instruction for it is
 * "report the diagnostic and change nothing" — which is a fence with nothing
 * allowed, not an absent fence.
 */
export const BRANCH_FENCES: {
  readonly [B in RepairBranch | 'none']: BranchFenceRow;
} = Object.freeze({
  'code-break': Object.freeze({
    autonomy: 'apply',
    artefact: 'patch',
    // Verbatim from design §11.2.
    instruction: 'Restore the behaviour the cited claim describes. Edit product source only.',
    grantsAllow: true,
  }),
  'test-drift': Object.freeze({
    autonomy: 'hold',
    artefact: 'review-card',
    instruction:
      'The test mechanics drifted, not the product. Run the evolve command and stop: the ' +
      'proposed change is held as a review card for a human. Write no file yourself.',
    grantsAllow: false,
  }),
  'docs-lie': Object.freeze({
    autonomy: 'propose',
    artefact: 'amendment',
    instruction:
      'The documentation claims something the product never did. Run the amend command and ' +
      'stop: the replacement text is proposed as a rendered diff and is never written until a ' +
      'human accepts it. Never edit documentation directly.',
    grantsAllow: false,
  }),
  none: Object.freeze({
    autonomy: 'none',
    artefact: null,
    instruction:
      'This run proved nothing that can be repaired automatically. Report the diagnostics and ' +
      'change nothing.',
    grantsAllow: false,
  }),
});

/** Deduplicate, preserving first-seen order, and freeze. */
function globSet(globs: readonly string[]): readonly string[] {
  const seen: string[] = [];
  for (const glob of globs) {
    if (glob.length > 0 && !seen.includes(glob)) seen.push(glob);
  }
  return Object.freeze(seen);
}

/**
 * Compose one row against one repository's surfaces.
 *
 * The granted row gets `allow` on the allowed side and `forbid` on the other, with
 * any glob that appears in both dropped from the forbidden side — disjointness is
 * Property 26's clause and it must hold as *written*, not merely as intended, so it
 * is enforced here rather than assumed of the loader.
 *
 * Every other row gets nothing allowed and **`forbid` unioned with `allow`**, which
 * is what makes a withheld repair strictly narrower than a granted one: the globs
 * the granted row would have handed over are named on the forbidden side instead.
 */
function composeFence(row: BranchFenceRow, surfaces: FenceSurfaces): HandoffFence {
  const allow = globSet(surfaces.allow);
  const forbid = globSet(surfaces.forbid);
  return Object.freeze({
    autonomy: row.autonomy,
    artefact: row.artefact,
    instruction: row.instruction,
    allowedPaths: row.grantsAllow ? allow : Object.freeze([]),
    forbiddenPaths: row.grantsAllow
      ? Object.freeze(forbid.filter((glob) => !allow.includes(glob)))
      : globSet([...forbid, ...allow]),
  });
}

/**
 * The fence for a branch against one repository's configured surfaces, with `null`
 * answering the `none` row. Total.
 *
 * `surfaces` is required and there is no overload without it. That is the design
 * decision of §20.1 made unforgeable: a default here would be the second home for
 * the values the config is supposed to be the only home for.
 */
export function fenceFor(branch: RepairBranch | null, surfaces: FenceSurfaces): HandoffFence {
  return composeFence(BRANCH_FENCES[branch ?? 'none'], surfaces);
}

/**
 * The fence a `code-break` gets when **KEPT has never proven the promise it would
 * repair** — design §8.1.1, the one condition on automatic repair.
 *
 * ## Why this row exists
 *
 * `code-break` means *the product regressed*, and its fence is the only one that
 * hands an agent a write path. Deciding it requires positive evidence of a product
 * fault, and the only such evidence that survives to KEPT is the category in Kane's
 * sealed triage note (`kane/packTriage.ts`). That category cannot carry the
 * distinction the branch needs, and this is measured rather than feared:
 *
 * **Kane treats the test document as the specification.** So for the fixture's
 * deliberately never-true discount claim it reports
 * `application_issue/ui_data_defect` at confidence 0.89, with
 * `suggested_fix: Check the cart's discount calculation … verify the total updates
 * to 10% below the subtotal` — a correct description, on Kane's own terms, of a
 * discount the cart never applies, written with no way to know the sentence was
 * invented to be false. The genuinely broken `subtotal` earns the *same* category
 * at 0.96. One token, two opposite meanings, and no third token that means "the
 * claim itself is wrong" — because from where Kane stands the claim is the spec.
 *
 * Read off three committed packs, for one unchanged T-7 failure: `57591bff` says
 * `application_issue/ui_data_defect`, `108dbb62` says
 * `automation_bug/state_transition_bug`, and the `[member]` streams have said
 * `confirmed: true`, nothing at all, and `confirmed: false` across four more runs.
 * Kane's vocabulary is not a discriminator here, and no amount of widening
 * `CODE_BREAK_SIGNALS` makes it one.
 *
 * ## The discriminator KEPT has and Kane does not
 *
 * The promise's **own prior verdict**. `proven` means KEPT itself witnessed the
 * behaviour, with a terminal event and a sealed pack behind it; that promise going
 * red is a regression, and restoring it is exactly what `code-break` authorises.
 * A promise that has never been `proven` has no such witness — nothing established
 * that it ever worked, so nothing can have broken.
 *
 * **You cannot break what was never proven to work.** Automatic repair is therefore
 * granted only to restore behaviour KEPT has observed, which is a property this
 * repository can enforce rather than a claim about another tool's word choice. It is
 * also the difference between an agent *restoring* a `subtotal` and an agent
 * *implementing* a discount nobody designed — the second being a strictly worse
 * failure than the routing bug this gate exists beside.
 *
 * ## Why it is a fence and not a branch
 *
 * The branch stays `code-break`. R6.3, R6.4 and R6.5 say what the router must return
 * for a coerced `740`, for a verdict object and for `confirmed: false`, and the
 * router keeps returning it — the Ledger, the snapshot and `/runs` all go on
 * reporting Kane's actual conclusion, which is the honest thing to publish. What the
 * gate withholds is *autonomy*, which is §8.1's column and this module's business.
 * So this row **narrows**: `allowedPaths` empties, nothing is added anywhere, and
 * Property 26's containment holds more strictly than before.
 *
 * `hold` with no artefact, because the honest action is neither a patch (unproven),
 * nor a review card (the test mechanics are not implicated), nor an amendment (the
 * documentation may well be right and the product may well be at fault — a human
 * has to look). The instruction says which promise and why.
 */
export const UNPROVEN_CODE_BREAK_ROW: BranchFenceRow = Object.freeze({
  autonomy: 'hold',
  artefact: null,
  instruction:
    'Kane reports a product fault, but KEPT has never proven this promise: no run has ' +
    'ever observed the cited behaviour working, so there is no earlier state to restore ' +
    'and an automatic patch would be implementing the claim rather than repairing a ' +
    'regression. Report the diagnostics and change nothing. Automatic repair resumes for ' +
    'this promise once a verification has proven it once.',
  grantsAllow: false,
});

/**
 * The withheld `code-break` fence for one repository's surfaces.
 *
 * `grantsAllow: false` is doing all the work: {@link composeFence} empties the
 * allowed side and moves the globs the granted row would have handed over onto the
 * forbidden side. So the withheld fence is a strict narrowing of the granted one by
 * construction, which is the direction Property 31 asserts, and no second list is
 * maintained anywhere to make it so.
 */
export function unprovenCodeBreakFence(surfaces: FenceSurfaces): HandoffFence {
  return composeFence(UNPROVEN_CODE_BREAK_ROW, surfaces);
}

/**
 * The prior verdict that earns a promise automatic repair. One value, named once,
 * because "previously proven" is the whole rule.
 */
export const AUTOMATIC_REPAIR_REQUIRES_VERDICT: Verdict = 'proven';

/**
 * Whether this run's `code-break` may be applied automatically (§8.1.1).
 *
 * True only when at least one result carrying the `code-break` branch was
 * {@link AUTOMATIC_REPAIR_REQUIRES_VERDICT} before this run. "At least one" rather
 * than "all", deliberately: a radius can hold one regressed promise beside one that
 * was never proven, and restoring the regression is legitimate work that the second
 * promise's history has no standing to forbid. The fence is glob-scoped to the
 * grant widens nothing beyond the one branch that already had it.
 *
 * Total, and `false` for every branch that is not `code-break` — those never had
 * automatic autonomy to grant.
 */
export function grantsAutomaticRepair(
  branch: RepairBranch | null,
  results: readonly HandoffResult[],
): boolean {
  if (branch !== 'code-break') return false;
  return results.some(
    (result) =>
      result.repair?.branch === 'code-break' &&
      result.previousVerdict === AUTOMATIC_REPAIR_REQUIRES_VERDICT,
  );
}

/**
 * The fence this run actually hands back: {@link fenceFor} for every branch, except
 * a `code-break` whose promises KEPT has never proven, which gets
 * {@link unprovenCodeBreakFence}.
 *
 * This is the single site the handoff reads, so the condition cannot be forgotten by
 * a second caller — and `fenceFor` stays exactly what §8.1's table says, so a test
 * can still assert the table without knowing about the gate.
 */
export function fenceForResults(
  branch: RepairBranch | null,
  results: readonly HandoffResult[],
  surfaces: FenceSurfaces,
): HandoffFence {
  if (branch === 'code-break' && !grantsAutomaticRepair(branch, results)) {
    return unprovenCodeBreakFence(surfaces);
  }
  return fenceFor(branch, surfaces);
}

/**
 * Which branch wins when one run failed several promises on different branches.
 *
 * `code-break` first, deliberately. It is the only branch whose repair is
 * applied and whose save re-fires the hook, so it is the branch that closes the
 * loop — and it is also the *narrowest* fence, so preferring it grants no access
 * the other two would have withheld. `docs-lie` is last because it is the
 * residue (§6.1): the branch a rule reaches when nothing positive matched.
 */
export const NEXT_ACTION_BRANCH_PRECEDENCE: readonly RepairBranch[] = Object.freeze([
  'code-break',
  'test-drift',
  'docs-lie',
]);

// ---------------------------------------------------------------------------
// The file's shape (design §11.2)
// ---------------------------------------------------------------------------

/** What caused the run. `hook: null` means a human ran the CLI. */
export interface HandoffTrigger {
  readonly hook: HandoffHook | null;
  /** The Kiro event, e.g. `fileEdited`. Null when there was no hook. */
  readonly event: string | null;
  /** The saved paths the hook reported, repository-relative. */
  readonly paths: readonly string[];
}

/**
 * What KEPT asked Kane to do.
 *
 * `ndjsonEnabledBy` is read from the family contract, never restated: the three
 * enablers are `--agent`, piped stdout with **no flag at all**, and
 * `--mode agent`, and a second copy of that mapping is how the loop ends up
 * passing `--agent` to a testrun that has no such flag (§4.7, R3.4, R3.5).
 */
export interface HandoffCommand {
  readonly family: CommandFamily | null;
  /** argv as KEPT composed it, enabler included. Empty when nothing was invoked. */
  readonly argv: readonly string[];
  readonly ndjsonEnabledBy: NdjsonEnabler | null;
  /**
   * Whether a Kane process was started at all. `false` is a first-class outcome:
   * an empty blast radius (R4.5) and every rung of the reconcile fail-fast
   * ladder (§13.2.4) spend no process and no credit, and still write a handoff.
   */
  readonly invoked: boolean;
}

/**
 * What happened, in the vocabulary of the family that ran (§4.5, §14.1).
 *
 * Every field is present on every run. `exitMeaning: null` means no process ran;
 * it never means "we did not look".
 */
export interface HandoffOutcome {
  /** Whether the family's terminal event arrived (R3.6). */
  readonly terminalSeen: boolean;
  /**
   * The event type that ends this family's stream — `run_end`, `testrun_done` or
   * `done`. Recorded whether or not it was *seen*, because "we waited for
   * `testrun_done` and it never came" is the diagnosis, and a null here would
   * throw away the half of it that matters.
   */
  readonly terminalEventType: string | null;
  readonly exitCode: number | null;
  readonly exitMeaning: ExitMeaning | null;
  /** Our own budget elapsed, or Kane reported a timeout or cancellation. */
  readonly timedOut: boolean;
  /** An Assurance pause: exit three, resumable, no verdict moved (§14.1, R11.10). */
  readonly resumable: boolean;
  /**
   * Whether the single write guard admitted this run — `mayWriteVerdicts` from
   * `state.ts`, called, not re-derived. This module records what the guard said;
   * it never decides it.
   */
  readonly verdictsPermitted: boolean;
  /** The terminal event's own `status`, verbatim. Kane's vocabulary, not KEPT's. */
  readonly status: string | null;
  /** Already through the coercing accessor of `kane/coerce.ts` (§4.4, R3.12). */
  readonly resultCode: number | null;
  readonly reasonCode: string | null;
  /** Through `credits()`, which prefers `credits_consumed` (§4.4, R14.7). */
  readonly credits: number | null;
  /**
   * Wall-clock milliseconds the invocation took, as the invoker measured it.
   *
   * Optional, and the only optional field in the file: handoffs written before
   * this field existed carry no key, and `/runs` renders that as `not reported`
   * rather than as a zero — a zero is a number a run produced, and those runs
   * produced none. A present value is always a measurement; nothing here derives
   * one from two timestamps.
   */
  readonly durationMs?: number | null;
}

/** The radius the run was scoped to (§7.3, R4.5). Empty lists, never absent. */
export interface HandoffBlastRadius {
  readonly testIds: readonly string[];
  readonly promiseIds: readonly string[];
  readonly unmatchedPaths: readonly string[];
  readonly skippedNoTestId: readonly string[];
}

/**
 * The inline `verdict` object, normalised — the six fields the snapshot carries
 * (§9.1), so the handoff and `ledger.snapshot.json` describe one triage in one
 * shape. `confirmedKnown` from `NormalisedVerdict` is deliberately not carried:
 * the conservative reading of an unreadable flag is already encoded in the
 * branch the router chose, and a seventh field here would be a second place to
 * get that reading wrong.
 */
export interface HandoffVerdictObject {
  readonly confirmed: boolean;
  readonly family: string | null;
  readonly category: string | null;
  readonly severity: string | null;
  readonly one_liner: string | null;
  readonly confidence: number | null;
}

/**
 * The pack's artefacts, keyed the way §11.2 shows them.
 *
 * `other` exists because `listArtifacts` classifies seven kinds and never drops
 * a file it did not recognise (§4.6). Naming only the three the design example's
 * pack happened to hold would silently discard a HAR, a console log or an
 * unannounced artefact — and the agent reading this file is exactly who would
 * have wanted it.
 */
export interface HandoffArtifacts {
  readonly annotated: string | null;
  readonly failureYaml: string | null;
  readonly screenshots: readonly string[];
  readonly other: readonly string[];
}

/**
 * One promise the run reported on.
 *
 * `citation` is required rather than nullable, and that is structural: a result
 * is built from a {@link PromiseRecord}, and a record cannot enter the graph
 * without a citation the admission gate resolved to a real line in a real file
 * (§3.3, R1.3). So R11.4's "the citation" is guaranteed by the type, not by a
 * caller remembering to pass it — and `citation.text` is the verbatim line, which
 * §11.1's prompt names as the specification the agent repairs against.
 */
export interface HandoffResult {
  readonly promiseId: string;
  /** Kane's assurance-graph id, from the plan. Null when the plan knows none. */
  readonly testId: string | null;
  /** Repository-relative path of the `*_test.md`, or null when undesigned. */
  readonly designedTest: string | null;
  readonly memberStatus: MemberEndStatus | null;
  readonly verdict: Verdict;
  /**
   * The verdict this promise carried **before** this run — the graph record's own,
   * which is what makes `code-break` autonomy decidable (§8.1.1,
   * {@link grantsAutomaticRepair}).
   *
   * Recorded on every result, not only failing ones, because it is also the only
   * thing in the file that says whether `verdict` is a *transition*. A judge reading
   * `/runs` can see `proven → red` and `stale → red` as the different events they
   * are, and the second one is the one no agent may patch.
   */
  readonly previousVerdict: Verdict;
  readonly citation: Citation;
  /** The router's answer, stored unchanged — `RoutedRepair` is `RepairAnnotation`. */
  readonly repair: RoutedRepair | null;
  readonly verdictObject: HandoffVerdictObject | null;
  /** Absolute, family-derived (§4.6). Never lifted off an event field. */
  readonly evidenceDir: string | null;
  readonly evidencePackId: string | null;
  readonly artifacts: HandoffArtifacts;
}

/** The instruction: one branch, one fence, one command (§8.1, §11.2, R7.1). */
export interface HandoffNextAction {
  readonly branch: RepairBranch | null;
  readonly autonomy: HandoffAutonomy;
  readonly artefact: HandoffArtefact;
  readonly instruction: string;
  readonly allowedPaths: readonly string[];
  readonly forbiddenPaths: readonly string[];
  /**
   * The exact command §11.1's prompt tells the agent to run, precomputed so the
   * prompt cannot mis-spell it — the evolve invocation on `test-drift`, the
   * amend invocation on `docs-lie`, and null on `code-break`, where the action is
   * an edit rather than a command.
   */
  readonly command: string | null;
}

/** The whole file. Plain JSON: no `Date`, no `undefined`, explicit nulls. */
export interface HandoffFile {
  readonly schemaVersion: number;
  readonly runId: string;
  readonly writtenAt: string;
  readonly trigger: HandoffTrigger;
  readonly command: HandoffCommand;
  readonly outcome: HandoffOutcome;
  readonly blastRadius: HandoffBlastRadius;
  readonly results: readonly HandoffResult[];
  readonly nextAction: HandoffNextAction;
  readonly diagnostics: readonly Diagnostic[];
}

// ---------------------------------------------------------------------------
// Building it
// ---------------------------------------------------------------------------

/**
 * How the hook prompts spell an invocation (§11.1). One constant, so the command
 * the handoff hands back and the command the prompt quotes cannot diverge.
 */
export const KEPT_LAUNCHER = 'node bin/kept';

/** The exit meanings that mean a clock ran out — ours, or Kane's own (§14.1). */
const TIMED_OUT_MEANINGS: ReadonlySet<ExitMeaning> = new Set<ExitMeaning>([
  'killed-by-timeout',
  'timeout-or-cancelled',
]);

/** One promise the run reported on, as a caller supplies it. */
export interface HandoffResultInput {
  /**
   * The graph record. Supplying the record rather than loose fields is what makes
   * `citation` structurally present in the written file.
   */
  readonly promise: PromiseRecord;
  /** Kane's id for the covering test, from the plan. Defaults to the record's. */
  readonly testId?: string | null;
  readonly memberStatus?: MemberEndStatus | null;
  /** The verdict this run produced. Defaults to the record's current verdict. */
  readonly verdict?: Verdict;
  /**
   * The verdict the promise held before this run. Defaults to the supplied record's
   * own, which is the right answer for every caller that loads state before it
   * writes — `runVerify` routes off `prior.graph.promises`, so the record it passes
   * *is* the pre-run one. Stating it explicitly is for tests and for any future
   * caller that has already mutated its copy.
   */
  readonly previousVerdict?: Verdict;
  /**
   * The router's answer for this promise. **Absent and `null` mean different
   * things**: absent defers to the record's existing annotation, `null` states that
   * this run routed nothing — which is what a member that *passed* reports, and
   * which must not be overwritten by the branch the promise carried before.
   */
  readonly repair?: RoutedRepair | null;
  /** The raw wire `verdict` object; normalised here. Absent is fine. */
  readonly verdictObject?: unknown;
  /** From `listArtifacts` — the family derived it. Never a hand-composed path. */
  readonly evidence?: EvidenceListing | null;
}

/**
 * What {@link buildHandoff} takes. Everything but `runId` and `fences` has an
 * honest default.
 */
export interface BuildHandoffRequest<F extends CommandFamily = CommandFamily> {
  /** Kane's `run_id`, or the synthetic id of the invocation. */
  readonly runId: string;
  /**
   * The repository's fence surfaces, from `Kept_Config` (§20.1, R15.7).
   *
   * Required, and deliberately not defaulted. A `{ allow: [], forbid: [] }` fallback
   * would make a forgotten thread look like a repository that granted no autonomy,
   * and the loop would go quiet instead of failing to compile.
   */
  readonly fences: FenceSurfaces;
  /**
   * The finished run: the exit meaning paired with the parsed stream. `null` or
   * absent means no process was started, which is a supported outcome and not a
   * missing argument.
   */
  readonly run?: RunOutcome<F> | null;
  readonly trigger?: {
    readonly hook?: HandoffHook | null;
    readonly event?: string | null;
    readonly paths?: readonly string[];
  };
  readonly command?: {
    readonly family?: CommandFamily | null;
    readonly argv?: readonly string[];
    readonly invoked?: boolean;
  };
  /** The raw process exit code, from the invoker. */
  readonly exitCode?: number | null;
  /** Wall-clock milliseconds the invoker measured. Absent means unmeasured. */
  readonly durationMs?: number | null;
  /** Triage reason code, when one was read. Defaults to the terminal's own. */
  readonly reasonCode?: string | null;
  readonly radius?: BlastRadius | null;
  readonly results?: readonly HandoffResultInput[];
  /** Everything already reported for this run — the radius's, the router's, ours. */
  readonly diagnostics?: readonly Diagnostic[];
  /** The instant written into the file. Defaults to the clock. */
  readonly at?: string;
  readonly clock?: DiagnosticClock;
  /** Where synthesised diagnostics are also reported. Defaults to a throwaway. */
  readonly sink?: DiagnosticSink;
}

/** Read a string field off an unknown record, or null. */
function readString(source: unknown, key: string): string | null {
  if (typeof source !== 'object' || source === null) return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Read the clock defensively: a broken clock must not take the process down. */
function stampIso(clock: DiagnosticClock | undefined): string {
  if (clock === undefined) return new Date().toISOString();
  let value: Date;
  try {
    value = clock();
  } catch {
    value = new Date();
  }
  const ms = value instanceof Date ? value.getTime() : Number.NaN;
  return new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString();
}

/** Project an evidence listing into the artefact block. Nothing is dropped. */
function artifactsOf(listing: EvidenceListing | null | undefined): HandoffArtifacts {
  const pack = listing?.pack ?? null;
  if (pack === null) {
    return {
      annotated: null,
      failureYaml: null,
      screenshots: Object.freeze([]),
      other: Object.freeze([]),
    };
  }
  let annotated: string | null = null;
  let failureYaml: string | null = null;
  const screenshots: string[] = [];
  const other: string[] = [];
  for (const artifact of pack.artifacts) {
    if (artifact.kind === 'annotated') {
      annotated ??= artifact.path;
      continue;
    }
    if (artifact.kind === 'failure-yaml') {
      failureYaml ??= artifact.path;
      continue;
    }
    if (artifact.kind === 'screenshot') {
      screenshots.push(artifact.path);
      continue;
    }
    other.push(artifact.path);
  }
  return {
    annotated,
    failureYaml,
    screenshots: Object.freeze(screenshots),
    other: Object.freeze(other),
  };
}

/** Build one result. Every field derives from the record or from the listing. */
function resultOf(input: HandoffResultInput): HandoffResult {
  const promise = input.promise;
  const designed = promise.designedTest;
  return {
    promiseId: promise.id,
    testId: input.testId ?? designed?.testId ?? null,
    designedTest: designed?.path ?? null,
    memberStatus: input.memberStatus ?? promise.verdictSource?.memberStatus ?? null,
    verdict: input.verdict ?? promise.verdict,
    // The record is the pre-run one, so its own verdict is the previous verdict.
    previousVerdict: input.previousVerdict ?? promise.verdict,
    citation: promise.citation,
    // `undefined` means "the caller has no opinion, use the record's annotation";
    // `null` means "this run routed nothing for this promise". `??` conflated them,
    // and the consequence was visible the first time `code-break` fired live: a
    // member that *passed* carried the previous run's branch into the handoff,
    // because `applyRun` clears `repair` on a proven verdict but the pre-run record
    // handed to this builder still had it. The handoff is an instruction, so that
    // read as "repair this promise" about a promise that had just gone green.
    repair: input.repair !== undefined ? input.repair : promise.repair ?? null,
    verdictObject: verdictObjectOf(input.verdictObject),
    evidenceDir: input.evidence?.dir ?? null,
    evidencePackId: input.evidence?.pack?.id ?? promise.evidencePackId ?? null,
    artifacts: artifactsOf(input.evidence),
  };
}

/** The raw wire object through the router's normaliser, projected to six fields. */
function verdictObjectOf(raw: unknown): HandoffVerdictObject | null {
  if (raw === undefined || raw === null) return null;
  const normalised = normaliseVerdictObject(raw);
  if (normalised === null) return null;
  return {
    confirmed: normalised.confirmed,
    family: normalised.family,
    category: normalised.category,
    severity: normalised.severity,
    one_liner: normalised.one_liner,
    confidence: normalised.confidence,
  };
}

/**
 * The branch of the next action, or null.
 *
 * Two gates, in this order. First, the run must have **proved** something: the
 * single write guard has to admit it, so a crashed, paused, timed-out,
 * preflight-rejected or never-started run yields `null` no matter what repairs a
 * caller passed. Authorising an automatic source patch off a run whose outcome is
 * unknown is the one thing this file must never do. Second, among the repairs
 * that are present, precedence picks one deterministically.
 */
function branchOf<F extends CommandFamily>(
  run: RunOutcome<F> | null | undefined,
  results: readonly HandoffResult[],
): RepairBranch | null {
  if (run === null || run === undefined) return null;
  if (!mayWriteVerdicts(run)) return null;
  const present = new Set<RepairBranch>();
  for (const result of results) {
    if (result.repair !== null) present.add(result.repair.branch);
  }
  return NEXT_ACTION_BRANCH_PRECEDENCE.find((branch) => present.has(branch)) ?? null;
}

/** The command §11.1's prompt runs for this branch, or null. */
function commandFor(
  branch: RepairBranch | null,
  runId: string,
  results: readonly HandoffResult[],
): string | null {
  if (branch === 'test-drift') {
    const drifted = results.find(
      (result) => result.repair?.branch === 'test-drift' && result.designedTest !== null,
    );
    return drifted === undefined ? null : `${KEPT_LAUNCHER} evolve ${drifted.designedTest ?? ''}`;
  }
  if (branch === 'docs-lie') return `${KEPT_LAUNCHER} amend propose --run ${runId}`;
  return null;
}

/**
 * Build the handoff. Pure, total, and the only construction site.
 *
 * Total in the strong sense: there is no input for which this returns nothing
 * and no input for which it throws. A request naming only a `runId` describes a
 * run that never started, and that produces a complete file — an outcome block of
 * honest nulls, an empty radius, a null branch, and a diagnostic saying so.
 */
export function buildHandoff<F extends CommandFamily = CommandFamily>(
  request: BuildHandoffRequest<F>,
): HandoffFile {
  const sink = request.sink ?? createDiagnosticSink({ clock: request.clock });
  const run = request.run ?? null;
  const stream = run?.stream ?? null;
  const terminalSeen = stream !== null && stream.kind === 'complete';
  const terminal = stream !== null && stream.kind === 'complete' ? stream.terminal : null;

  const family = stream?.family ?? request.command?.family ?? null;
  const invoked = request.command?.invoked ?? run !== null;
  const exitMeaning = run?.exitMeaning ?? null;

  const command: HandoffCommand = {
    family,
    argv: Object.freeze([...(request.command?.argv ?? [])]),
    ndjsonEnabledBy: family === null ? null : contractFor(family).ndjson,
    invoked,
  };

  const outcome: HandoffOutcome = {
    terminalSeen,
    terminalEventType: family === null ? null : contractFor(family).terminalType,
    exitCode: request.exitCode ?? null,
    exitMeaning,
    timedOut: exitMeaning !== null && TIMED_OUT_MEANINGS.has(exitMeaning),
    resumable: exitMeaning === 'paused-resumable',
    verdictsPermitted: run !== null && mayWriteVerdicts(run),
    // `status` on the two other families; `overall_status` on `testrun_done`, which
    // is `{type, execution_id, overall_status}` and carries no `status` key at all
    // (observed on the live stream, recorded in `docs/kane/command-surface.md`).
    // Reading only the first spelling made `/runs` publish `not reported` for a
    // status Kane had reported one key over — the exact silent wrong answer the
    // three-terminal-contract table exists to prevent.
    status: readString(terminal, 'status') ?? readString(terminal, 'overall_status'),
    resultCode: terminal === null ? null : resultCode(terminal),
    reasonCode: request.reasonCode ?? readString(terminal, 'reason_code'),
    credits: terminal === null ? null : credits(terminal),
    durationMs: request.durationMs ?? null,
  };

  const radius = request.radius ?? null;
  const blastRadius: HandoffBlastRadius = {
    testIds: Object.freeze([...(radius?.testIds ?? [])]),
    promiseIds: Object.freeze([...(radius?.promiseIds ?? [])]),
    unmatchedPaths: Object.freeze([...(radius?.unmatchedPaths ?? [])]),
    skippedNoTestId: Object.freeze([...(radius?.skippedNoTestId ?? [])]),
  };

  const results = Object.freeze((request.results ?? []).map(resultOf));
  const branch = branchOf(run, results);
  // §8.1.1: `code-break` keeps its branch and loses its write path when KEPT has
  // never proven the promise it would repair. `fenceForResults` is the only site
  // that decides it, so a second caller cannot forget the condition.
  const fence = fenceForResults(branch, results, request.fences);

  const nextAction: HandoffNextAction = {
    branch,
    autonomy: fence.autonomy,
    artefact: fence.artefact,
    instruction: fence.instruction,
    allowedPaths: fence.allowedPaths,
    forbiddenPaths: fence.forbiddenPaths,
    command: commandFor(branch, request.runId, results),
  };

  // ── The totality invariant: a null branch always carries a reason. ──────────
  //
  // Synthesised *after* the caller's own diagnostics and only for reasons no
  // caller diagnostic already covers, so the specific message a module reported
  // (the refusal reason, the uncovered path, the unresolved source id) stays
  // first and stays the one a reviewer reads.
  const diagnostics: Diagnostic[] = [...(request.diagnostics ?? [])];
  if (branch === null) {
    if (!invoked) {
      diagnostics.push(
        sink.report({
          code: HANDOFF_DIAGNOSTIC_CODES.noInvocation,
          severity: 'info',
          message:
            `run ${request.runId}: no Kane process was started, so no verdict moved and there ` +
            `is nothing to repair. Report the diagnostics above and change nothing.`,
        }),
      );
    } else {
      if (!terminalSeen) {
        diagnostics.push(
          sink.report({
            code: HANDOFF_DIAGNOSTIC_CODES.outcomeUnknown,
            severity: 'warn',
            message:
              `run ${request.runId}: the ${String(family)} stream ended without its ` +
              `${outcome.terminalEventType ?? 'terminal'} event, so the outcome is unknown. ` +
              `Prior verdicts are preserved and no repair is authorised.`,
          }),
        );
      }
      if (exitMeaning !== null && !permitsVerdictWrite(exitMeaning)) {
        diagnostics.push(
          sink.report({
            code: HANDOFF_DIAGNOSTIC_CODES.exitUnproven,
            severity: 'warn',
            message:
              `run ${request.runId}: exit meaning '${exitMeaning}' does not prove an outcome` +
              `${outcome.resumable ? ' and the run is resumable' : ''}, so prior verdicts are ` +
              `preserved and no repair is authorised.`,
          }),
        );
      }
      if (diagnostics.length === 0) {
        diagnostics.push(
          sink.report({
            code: HANDOFF_DIAGNOSTIC_CODES.noRepairNeeded,
            severity: 'info',
            message:
              `run ${request.runId}: the outcome is proven and no promise in the blast radius ` +
              `carries a repair branch, so there is nothing to repair.`,
          }),
        );
      }
    }
  }

  // ── §8.1.1: every code-break on a never-proven promise, named. ──────────────
  //
  // Reported per promise and independently of whether the grant happened overall,
  // because a radius can hold one regression beside one never-proven promise and
  // the useful record is which was which. Reported *after* the null-branch block so
  // an unauthorised run still leads with the reason it was unauthorised.
  for (const result of results) {
    if (result.repair?.branch !== 'code-break') continue;
    if (result.previousVerdict === AUTOMATIC_REPAIR_REQUIRES_VERDICT) continue;
    diagnostics.push(
      sink.report({
        code: HANDOFF_DIAGNOSTIC_CODES.codeBreakUnproven,
        severity: 'warn',
        message:
          `promise ${result.promiseId} routed 'code-break' and KEPT has never proven it — its ` +
          `verdict before this run was '${result.previousVerdict}', not ` +
          `'${AUTOMATIC_REPAIR_REQUIRES_VERDICT}'. There is no observed earlier state to ` +
          `restore, so an automatic patch would implement the claim rather than repair a ` +
          `regression, and no path is authorised for it` +
          `${branch === 'code-break' && nextAction.allowedPaths.length > 0
            ? ' — though another promise in this radius was proven, so the run does carry a write fence'
            : ''}.`,
        file: result.citation.file,
        line: result.citation.line,
      }),
    );
  }

  return Object.freeze({
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    runId: request.runId,
    writtenAt: request.at ?? stampIso(request.clock),
    trigger: Object.freeze({
      hook: request.trigger?.hook ?? null,
      event: request.trigger?.event ?? null,
      paths: Object.freeze([...(request.trigger?.paths ?? [])]),
    }),
    command,
    outcome,
    blastRadius,
    results,
    nextAction,
    diagnostics: Object.freeze(diagnostics),
  });
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * The filesystem seam — `StateFileSystem`, reused rather than redeclared, so
 * `inMemoryStateFileSystem` serves this module's tests too and there is one
 * seam to stub in the CLI. Existence is `readFile(path) !== null`, which is all
 * the immutability check needs.
 */
export type HandoffFileSystem = StateFileSystem;

/** Join two fragments with a POSIX separator, without importing `node:path`. */
function joinPath(root: string, relativePath: string): string {
  return root.endsWith('/') ? `${root}${relativePath}` : `${root}/${relativePath}`;
}

/** The directory part of a path, or the path itself when it has no separator. */
function dirOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? path : path.slice(0, cut);
}

/**
 * The archive file name for a run id.
 *
 * `runId` arrives from Kane, so it is untrusted input that is about to become a
 * path segment. Everything outside a conservative set becomes an underscore,
 * which collapses a separator or a parent reference into a harmless character
 * rather than letting it escape `.kept/handoff/`. An id that sanitises away
 * entirely answers a fixed fallback, because a run with an unusable id still has
 * to leave a record.
 */
export function handoffArchiveFileName(runId: string): string {
  const safe = (typeof runId === 'string' ? runId : '')
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '_');
  return `${safe.length === 0 ? 'run_unknown' : safe}.json`;
}

/** Both absolute paths a write touches. */
export interface HandoffPaths {
  /** `.kept/handoff.json` — always the newest. */
  readonly newest: string;
  /** `.kept/handoff/<runId>.json` — written once, never rewritten (R11.7). */
  readonly archive: string;
}

/** Resolve both paths under a repository root. Pure. */
export function handoffPaths(repoRoot: string, runId: string): HandoffPaths {
  return {
    newest: joinPath(repoRoot, HANDOFF_FILE_RELATIVE_PATH),
    archive: joinPath(
      joinPath(repoRoot, HANDOFF_DIRECTORY_RELATIVE_PATH),
      handoffArchiveFileName(runId),
    ),
  };
}

/**
 * How the file is spelled: two-space JSON, one trailing newline, keys in the
 * order {@link buildHandoff} writes them — which is design §11.2's order.
 *
 * Stability is the point rather than an accident. `.kept/` is gitignored except
 * for `config.json`, so these files are regenerable single-writer state; but task
 * 15.6 force-adds two `.kept/handoff/<runId>.json` files as the persisted
 * closed-loop record (R11.7), and those are read by a human as evidence. One
 * construction site plus a fixed spelling means the two committed files differ
 * only where the two runs differed.
 */
export function serialiseHandoff(handoff: HandoffFile): string {
  return `${JSON.stringify(handoff, null, 2)}\n`;
}

/** Options for {@link writeHandoff}: the build request plus where it lands. */
export interface WriteHandoffRequest<F extends CommandFamily = CommandFamily>
  extends BuildHandoffRequest<F> {
  /** Absolute repository root. Both paths sit under `.kept/`. */
  readonly repoRoot: string;
  readonly fileSystem?: HandoffFileSystem;
}

/** What one write did. */
export interface WriteHandoffResult {
  readonly handoff: HandoffFile;
  readonly paths: HandoffPaths;
  /** Exactly the bytes written to both files. */
  readonly contents: string;
  /**
   * Whether the immutable copy was created by this call. `false` means a file for
   * this run id already existed and was left byte-for-byte alone.
   */
  readonly archived: boolean;
  /** The file's own diagnostics, including any this call added. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Write the handoff — `.kept/handoff.json`, plus the immutable
 * `.kept/handoff/<runId>.json` (R11.7).
 *
 * Called for **every** run. Crashed, paused, preflight-rejected, timed out,
 * source-unresolved, radius-empty, never-invoked: all of them land here, because
 * an agent that reads a stale handoff repairs the wrong thing, and silence is the
 * one thing the loop cannot interpret.
 *
 * The newest file is always refreshed; the archive copy is written once and never
 * rewritten, which is what "immutable" means. A second run reusing an id refreshes
 * `handoff.json`, leaves the archive intact and records a diagnostic saying so —
 * rather than quietly overwriting the record R11.7 asks the repository to keep.
 *
 * Never throws for a state of the world. A filesystem that refuses the write is
 * the caller's problem to report; nothing here interprets it.
 */
export function writeHandoff<F extends CommandFamily = CommandFamily>(
  request: WriteHandoffRequest<F>,
): WriteHandoffResult {
  const sink = request.sink ?? createDiagnosticSink({ clock: request.clock });
  const built = buildHandoff({ ...request, sink });
  const paths = handoffPaths(request.repoRoot, request.runId);
  const fileSystem = request.fileSystem ?? nodeStateFileSystem();

  const existed = fileSystem.readFile(paths.archive) !== null;
  const diagnostics: Diagnostic[] = [...built.diagnostics];
  if (existed) {
    diagnostics.push(
      sink.report({
        code: HANDOFF_DIAGNOSTIC_CODES.archiveExists,
        severity: 'info',
        message:
          `${HANDOFF_DIAGNOSTIC_CODES.archiveExists}: a handoff for run ${request.runId} is ` +
          `already recorded, so the immutable copy was left exactly as it was; ` +
          `${HANDOFF_FILE_RELATIVE_PATH} was refreshed.`,
        file: HANDOFF_DIRECTORY_RELATIVE_PATH,
      }),
    );
  }

  // The diagnostic about the archive belongs in the file it describes, so the
  // handoff is rebuilt with it rather than the note being lost to the sink.
  const handoff: HandoffFile = existed
    ? Object.freeze({ ...built, diagnostics: Object.freeze(diagnostics) })
    : built;
  const contents = serialiseHandoff(handoff);

  fileSystem.ensureDir(dirOf(paths.newest));
  fileSystem.writeFile(paths.newest, contents);
  if (!existed) {
    fileSystem.ensureDir(dirOf(paths.archive));
    fileSystem.writeFile(paths.archive, contents);
  }

  return { handoff, paths, contents, archived: !existed, diagnostics: handoff.diagnostics };
}

// ---------------------------------------------------------------------------
// Reading it back
// ---------------------------------------------------------------------------

/**
 * Structural guard for a handoff read back off disk.
 *
 * The hook's agent action reads this file across a process boundary, and type
 * guarantees stop at that boundary. This is where they are re-established — and
 * it is deliberately a hand-rolled guard rather than a zod schema, because unlike
 * `ledger.snapshot.json` (§9.1, where an unknown key means the file was not
 * written by `kept snapshot` and the Ledger build must fail) a handoff that
 * carries an extra key is still readable, and refusing it would break the loop
 * over a field a later version added.
 *
 * What it does insist on is everything the loop keys off: the run's identity, a
 * complete outcome block, a `nextAction` whose branch is one of the three or
 * `null`, both fences present as arrays, and the invariant that a null branch
 * carries a reason.
 */
export function isHandoffFile(value: unknown): value is HandoffFile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['schemaVersion'] !== HANDOFF_SCHEMA_VERSION) return false;
  if (typeof candidate['runId'] !== 'string' || candidate['runId'].length === 0) return false;
  const writtenAt = candidate['writtenAt'];
  if (typeof writtenAt !== 'string' || Number.isNaN(Date.parse(writtenAt))) return false;
  if (!isTriggerBlock(candidate['trigger'])) return false;
  if (!isCommandBlock(candidate['command'])) return false;
  if (!isOutcomeBlock(candidate['outcome'])) return false;
  if (!isRadiusBlock(candidate['blastRadius'])) return false;
  if (!Array.isArray(candidate['results'])) return false;
  if (!candidate['results'].every(isResultBlock)) return false;
  if (!isNextActionBlock(candidate['nextAction'])) return false;
  const diagnostics = candidate['diagnostics'];
  if (!Array.isArray(diagnostics)) return false;
  // The totality invariant, checked on the way in as well as on the way out.
  const branch = (candidate['nextAction'] as Record<string, unknown>)['branch'];
  if (branch === null && diagnostics.length === 0) return false;
  return true;
}

/** Every element is a string. */
function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** A string, or null. Never `undefined`: the key must be present. */
function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** A finite number, or null. */
function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isTriggerBlock(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const block = value as Record<string, unknown>;
  const hook = block['hook'];
  if (hook !== null && !(HANDOFF_HOOKS as readonly string[]).includes(hook as string)) return false;
  return isNullableString(block['event']) && isStringArray(block['paths']);
}

function isCommandBlock(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const block = value as Record<string, unknown>;
  if (!isNullableString(block['family'])) return false;
  if (!isStringArray(block['argv'])) return false;
  if (!isNullableString(block['ndjsonEnabledBy'])) return false;
  return typeof block['invoked'] === 'boolean';
}

function isOutcomeBlock(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const block = value as Record<string, unknown>;
  if (typeof block['terminalSeen'] !== 'boolean') return false;
  if (!isNullableString(block['terminalEventType'])) return false;
  if (!isNullableNumber(block['exitCode'])) return false;
  if (!isNullableString(block['exitMeaning'])) return false;
  if (typeof block['timedOut'] !== 'boolean') return false;
  if (typeof block['resumable'] !== 'boolean') return false;
  if (typeof block['verdictsPermitted'] !== 'boolean') return false;
  if (!isNullableString(block['status'])) return false;
  if (!isNullableNumber(block['resultCode'])) return false;
  if (!isNullableString(block['reasonCode'])) return false;
  return isNullableNumber(block['credits']);
}

function isRadiusBlock(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const block = value as Record<string, unknown>;
  return (
    isStringArray(block['testIds']) &&
    isStringArray(block['promiseIds']) &&
    isStringArray(block['unmatchedPaths']) &&
    isStringArray(block['skippedNoTestId'])
  );
}

function isResultBlock(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const block = value as Record<string, unknown>;
  if (typeof block['promiseId'] !== 'string' || block['promiseId'].length === 0) return false;
  if (!isNullableString(block['testId'])) return false;
  if (!isNullableString(block['designedTest'])) return false;
  if (!isNullableString(block['memberStatus'])) return false;
  if (!isVerdict(block['verdict'])) return false;
  // Optional in the validator and required in the type, deliberately: handoffs
  // written before §8.1.1 existed carry no key, and refusing to read those would
  // make an old run entry unparseable rather than merely older. A present value
  // must still be a real verdict.
  if (block['previousVerdict'] !== undefined && !isVerdict(block['previousVerdict'])) {
    return false;
  }
  const citation = block['citation'];
  if (typeof citation !== 'object' || citation === null) return false;
  const cited = citation as Record<string, unknown>;
  if (typeof cited['file'] !== 'string' || cited['file'].length === 0) return false;
  if (typeof cited['line'] !== 'number' || !Number.isInteger(cited['line'])) return false;
  if (typeof cited['text'] !== 'string') return false;
  const repair = block['repair'];
  if (repair !== null) {
    if (typeof repair !== 'object') return false;
    if (!isRepairBranch((repair as Record<string, unknown>)['branch'])) return false;
  }
  if (!isNullableString(block['evidenceDir'])) return false;
  if (!isNullableString(block['evidencePackId'])) return false;
  const artifacts = block['artifacts'];
  if (typeof artifacts !== 'object' || artifacts === null) return false;
  const pack = artifacts as Record<string, unknown>;
  return (
    isNullableString(pack['annotated']) &&
    isNullableString(pack['failureYaml']) &&
    isStringArray(pack['screenshots']) &&
    isStringArray(pack['other'])
  );
}

function isNextActionBlock(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const block = value as Record<string, unknown>;
  const branch = block['branch'];
  if (branch !== null && !isRepairBranch(branch)) return false;
  if (typeof block['instruction'] !== 'string' || block['instruction'].length === 0) return false;
  if (!isStringArray(block['allowedPaths'])) return false;
  if (!isStringArray(block['forbiddenPaths'])) return false;
  if (!isNullableString(block['command'])) return false;
  if (typeof block['autonomy'] !== 'string') return false;
  const artefact = block['artefact'];
  return artefact === null || typeof artefact === 'string';
}

/**
 * Parse a handoff from the bytes on disk, or null.
 *
 * Null for anything unreadable, in either sense — bad JSON or a payload that does
 * not satisfy the guard. A hook agent that cannot read the handoff must report
 * that and change nothing, which is a state of the world and never an exception
 * (§14.2).
 */
export function parseHandoff(contents: string): HandoffFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    return null;
  }
  return isHandoffFile(raw) ? raw : null;
}

/**
 * Read the newest handoff under a repository root, or null when there is none.
 *
 * The read side of the loop, exported so the CLI's `kept handoff` command (§13.1)
 * and any consumer share one reader with the writer's own spelling of the path.
 */
export function readNewestHandoff(
  repoRoot: string,
  fileSystem: HandoffFileSystem = nodeStateFileSystem(),
): HandoffFile | null {
  const contents = fileSystem.readFile(joinPath(repoRoot, HANDOFF_FILE_RELATIVE_PATH));
  return contents === null ? null : parseHandoff(contents);
}
