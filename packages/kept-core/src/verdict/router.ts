/**
 * The verdict router: the strategy interface, the normalised verdict object, the
 * failure context, and the one selection door (design §6.1, §6.4, R6.1, R6.10,
 * R6.14).
 *
 * ## Why this is a strategy interface at all
 *
 * At the time this module was designed, one empirical question was still open
 * (R6.12): does a failing **cached replay** carry the confirmed-bug code and an
 * inline `verdict` object, or only a bare failure? The whole three-way repair
 * branch keys off the answer. Rather than guess, the design fenced the answer
 * behind an interface with two implementations and a single configuration
 * string, so that when the spike answers, exactly one string in
 * `.kept/config.json` changes and nothing else in the repository does. That
 * fence is enforced mechanically: nothing outside `src/verdict/` imports a
 * concrete implementation, and {@link selectRouter} is the only door in.
 *
 * ## The relationship to `kane/events.ts`
 *
 * `kane/events.ts` owns the name `VerdictObject`, and what it owns is the **raw
 * wire shape**: every field optional, `confirmed` typed as
 * `boolean | string | number | null`, `confidence` as `number | string | null`.
 * That widening is deliberate — Kane has shown us this object once, in a
 * reference document rather than in a run, so the compiler refuses to let a
 * branch treat `confirmed` as a boolean without normalising it first.
 *
 * Design §6.1 describes the router-facing view, which is settled: `confirmed` is
 * a `boolean`, the strings are strings, `confidence` is a number or null. Two
 * different types with one job each, and this module owns the crossing:
 * {@link normaliseVerdictObject} takes the raw wire shape and answers
 * {@link NormalisedVerdict}. The name differs because the barrel can carry only
 * one `VerdictObject` and `events.ts` already has it — and because a reader
 * seeing `NormalisedVerdict` in a router knows, without checking, that the
 * coercion already happened.
 *
 * ## Totality
 *
 * `route` returns a `RoutedRepair` for every input. It never throws, never
 * returns null, never returns two branches, and defaults to `docs-lie` when no
 * rule matched (R6.9). {@link docsLieRepair} is the single construction site for
 * that default, so "the residue is the documentation's problem" is one function
 * rather than a habit repeated in two strategies.
 *
 * ## Module graph
 *
 * This file value-imports the two concrete strategies because `selectRouter`
 * must return them, and they import their shared helpers back from here. The
 * cycle is safe by construction: everything they import from here is either a
 * type (erased entirely) or a hoisted `function` declaration, and every strategy
 * is a plain object literal whose methods run only when called. No top-level
 * evaluation in either direction reads a binding from the other.
 */

import { isAbsolute, relative, resolve } from 'node:path';

import type { DiagnosticSink } from '../diagnostics.js';
import { isVerdictObject, type VerdictObject } from '../kane/events.js';
import type { EvidenceListing, EvidencePack } from '../kane/evidence.js';
import {
  findFailureYamlArtifact,
  loadFailureYaml,
  type FailureYaml,
  type FailureYamlFileSystem,
} from '../kane/failureYaml.js';
import type { CommandFamily } from '../kane/family.js';
import type { SealedTriageNote } from '../kane/packTriage.js';
import type { RepairAnnotation, RepairBranch, RepairStrategy } from '../model/promise.js';

import type { MemberStatus } from './memberStatus.js';
import { failureYamlTriageRouter } from './failureYamlTriage.js';
import { resultCode740Router } from './resultCode740.js';

/**
 * The three repair branches, and the two strategy names.
 *
 * Re-exported from `model/promise.ts` rather than restated, because
 * `RepairAnnotation` — the field the snapshot carries — is declared against the
 * model's unions, and two spellings of one vocabulary is how a router branch
 * becomes unassignable to the record that stores it.
 */
export type { RepairBranch, RepairStrategy } from '../model/promise.js';

/**
 * The router's answer, which is **exactly** the annotation the snapshot carries.
 *
 * An alias, not a lookalike interface: `RoutedRepair` and `RepairAnnotation`
 * have the same seven fields, so aliasing them means the routed result can be
 * stored on a `PromiseRecord` with no translation step, and no translation step
 * means no table to drift. `evidenceRef` is repository-relative when a
 * repository root is known and absolute otherwise — in both cases a path that
 * was resolved from the command family, never one composed by hand (R6.11).
 */
export type RoutedRepair = RepairAnnotation;

/**
 * A `verdict` object after normalisation — the settled shape of design §6.1.
 *
 * Field names follow the wire (`one_liner`), so a reader comparing this against a
 * captured stream is comparing like with like. What changed from the wire shape
 * is only the *types*: every field is present, `confirmed` is a real boolean,
 * `severity` is a string or null even when Kane sent a number, and `confidence`
 * is a finite number or null even when Kane sent `" 0.42 "`.
 */
export interface NormalisedVerdict {
  /**
   * Whether Kane confirmed a product bug.
   *
   * False when the field was absent or unreadable, which is the conservative
   * reading: rule 1 of §6.2 then routes `test-drift` rather than `code-break`,
   * so an unreadable flag can never escalate into an automatic code repair.
   * {@link NormalisedVerdict.confirmedKnown} preserves the difference.
   */
  readonly confirmed: boolean;
  /** Whether `confirmed` was actually readable, as opposed to defaulted to false. */
  readonly confirmedKnown: boolean;
  readonly family: string | null;
  readonly category: string | null;
  readonly severity: string | null;
  readonly one_liner: string | null;
  readonly confidence: number | null;
}

/**
 * Everything a strategy is allowed to look at (design §6.1).
 *
 * Three properties of this shape are load-bearing:
 *
 * 1. **`terminal` is raw.** It is the failing terminal event as it parsed, and
 *    the result code inside it is read only through the coercing accessor of
 *    `kane/coerce.ts` — the one file permitted to compare that field, because
 *    Kane types it inconsistently within a single event.
 * 2. **The evidence paths are already resolved, and were resolved from the
 *    command family.** No strategy composes a path, and no strategy reads one
 *    off the event: `run_dir` is legacy and no longer created, and the pack hint
 *    reaches the terminal only on stderr. {@link createFailureContext} fills
 *    these from an `EvidenceListing`, which derives them from the family.
 * 3. **`loadFailureYaml` is lazy.** The primary signal is the inline verdict
 *    object, which arrives in the stream; a router that reached the disk before
 *    checking it would pay for a read it does not need on the common path. So
 *    the triage note is a thunk, and only the triage rung pulls it.
 */
export interface FailureContext {
  readonly family: CommandFamily;
  /**
   * The failing terminal event, raw. Read the result code only through
   * `resultCode()` from `kane/coerce.ts`.
   */
  readonly terminal: Record<string, unknown>;
  /** The inline `verdict` object, normalised, or null when none arrived. */
  readonly verdictObject: NormalisedVerdict | null;
  /** Absolute evidence directory, or null when the family cannot resolve one. */
  readonly evidenceDir: string | null;
  /**
   * Absolute directory of the newest sealed pack, or null. Resolved from the
   * family through `listArtifacts`, never from an event field.
   */
  readonly packDir?: string | null;
  /**
   * Absolute path of the artefact the triage note comes from, or null when there
   * is none: the pack's `failure.yaml` when the listing found a pack *directory*,
   * and otherwise the sealed `.evidence` **archive** the note was read out of
   * (`kane/packTriage.ts`). Both are real files that exist on disk; neither is
   * composed here (R6.11). Having it lets a strategy name the artefact without
   * loading it.
   */
  readonly failureYamlPath?: string | null;
  /** Repository root, so `evidenceRef` can be repo-relative. Absolute, or null. */
  readonly repoRoot?: string | null;
  /** Lazily loaded; null when absent or unparseable. */
  readonly loadFailureYaml: () => FailureYaml | null;
  /** ExecutionTestrun only. Always `failed` or `broken` — see `memberStatus.ts`. */
  readonly memberStatus?: MemberStatus | null;
  readonly promiseId: string;
}

/** One strategy (design §6.1, R6.1, R6.2). */
export interface VerdictRouter {
  readonly name: RepairStrategy;
  /** Total: exactly one branch for every input, and it never throws. */
  route(ctx: FailureContext): RoutedRepair;
}

/** The two legal `verdictRouter` configuration values (design §6.4). */
export const VERDICT_ROUTER_NAMES: readonly RepairStrategy[] = Object.freeze<RepairStrategy[]>([
  'resultCode740',
  'failureYamlTriage',
]);

/**
 * The fallback, and the value `.kept/config.json` ships with until the spike
 * says otherwise (R6.12). `failureYamlTriage` works regardless (R6.13), so this
 * choice is a default rather than a dependency.
 */
export const DEFAULT_VERDICT_ROUTER: RepairStrategy = 'resultCode740';

/** Diagnostic codes this module reports under. */
export const VERDICT_ROUTER_DIAGNOSTIC_CODES = Object.freeze({
  /** `verdictRouter` held a value that is not one of the two. */
  unknownRouter: 'verdict-router-unknown',
} as const);

/** Whether a value is one of the two legal strategy names. */
export function isVerdictRouterName(value: unknown): value is RepairStrategy {
  return typeof value === 'string' && (VERDICT_ROUTER_NAMES as readonly string[]).includes(value);
}

/** What `selectRouter` reads: the one configuration value of design §6.4. */
export interface VerdictRouterConfig {
  readonly verdictRouter?: string | null;
}

/**
 * The only door to a concrete strategy (design §6.4, R6.10).
 *
 * Unknown values **fall back with a diagnostic and never throw**. That is not
 * leniency: `.kept/config.json` is hand-edited, this is read once at CLI
 * startup, and refusing to start because a config string was misspelled would
 * take the ledger down over a typo. A recorded diagnostic plus a working default
 * is the honest trade — the run happens, and `/runs` says which strategy
 * actually ran and why.
 */
export function selectRouter(
  cfg: VerdictRouterConfig = {},
  diagnostics?: DiagnosticSink,
): VerdictRouter {
  const requested = cfg.verdictRouter;
  if (isVerdictRouterName(requested)) return routerNamed(requested);

  if (requested !== undefined && requested !== null) {
    diagnostics?.report({
      code: VERDICT_ROUTER_DIAGNOSTIC_CODES.unknownRouter,
      severity: 'warn',
      message:
        `Configuration value verdictRouter is "${String(requested)}", which is not one of ` +
        `${VERDICT_ROUTER_NAMES.join(' or ')}. Falling back to ${DEFAULT_VERDICT_ROUTER}.`,
      file: '.kept/config.json',
    });
  }
  return routerNamed(DEFAULT_VERDICT_ROUTER);
}

/** The name → implementation table. The only place either concrete name is bound. */
function routerNamed(name: RepairStrategy): VerdictRouter {
  return name === 'resultCode740' ? resultCode740Router : failureYamlTriageRouter;
}

// ---------------------------------------------------------------------------
// Normalisation: the raw wire shape → the settled router-facing one
// ---------------------------------------------------------------------------

/** Wire spellings of a true `confirmed`. Lower-cased before lookup. */
const CONFIRMED_TRUE: readonly string[] = Object.freeze(['true', 'yes', 'y', '1', 'confirmed']);

/** Wire spellings of a false `confirmed`. */
const CONFIRMED_FALSE: readonly string[] = Object.freeze([
  'false',
  'no',
  'n',
  '0',
  'unconfirmed',
  'not_confirmed',
]);

/** A trimmed non-empty string, or null. Numbers are stringified, booleans are not text. */
function text(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * A finite number, or null.
 *
 * Numeric strings are accepted because a JSON field Kane has shown us once may
 * well be quoted, and `" 0.42 "` is a confidence. Booleans are rejected:
 * `Number(true)` is `1`, and a flag read as full confidence is the kind of
 * silent escalation this whole layer exists to prevent.
 */
function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Coerce `confirmed`, reporting whether it was readable at all. */
function normaliseConfirmed(raw: unknown): { confirmed: boolean; known: boolean } {
  if (typeof raw === 'boolean') return { confirmed: raw, known: true };
  if (typeof raw === 'number') {
    if (raw === 1) return { confirmed: true, known: true };
    if (raw === 0) return { confirmed: false, known: true };
    return { confirmed: false, known: false };
  }
  if (typeof raw === 'string') {
    const token = raw.trim().toLowerCase();
    if (CONFIRMED_TRUE.includes(token)) return { confirmed: true, known: true };
    if (CONFIRMED_FALSE.includes(token)) return { confirmed: false, known: true };
    return { confirmed: false, known: false };
  }
  // Absent or null: recognisable as a verdict object by some other field, but
  // carrying no confirmation. Not confirmed, and we say we do not know.
  return { confirmed: false, known: false };
}

/**
 * The raw wire `verdict` object → the settled router-facing view.
 *
 * Returns null for anything that is not recognisably a verdict object, which is
 * decided by `isVerdictObject` from `kane/events.ts` — an object carrying at
 * least one of the six documented fields. `{}` is deliberately **not** a verdict
 * object: it would let rule 1 of §6.2 fire, because an absent `confirmed` reads
 * as not-confirmed, and routing `test-drift` off an empty object is a verdict
 * invented from nothing.
 */
export function normaliseVerdictObject(raw: unknown): NormalisedVerdict | null {
  if (!isVerdictObject(raw)) return null;
  const source = raw as VerdictObject;
  const confirmed = normaliseConfirmed(source.confirmed);
  return {
    confirmed: confirmed.confirmed,
    confirmedKnown: confirmed.known,
    family: text(source.family),
    category: text(source.category),
    severity: text(source.severity),
    one_liner: text(source.one_liner),
    confidence: finiteNumber(source.confidence),
  };
}

// ---------------------------------------------------------------------------
// Shared construction of the answer
// ---------------------------------------------------------------------------

/**
 * The evidence reference, resolved once for **every** rung of **every** strategy
 * (R6.11).
 *
 * Order: the pack's `failure.yaml` when the listing found one, else the pack
 * directory, else null. The evidence *directory* is deliberately not a fallback
 * — a directory that holds packs is not itself evidence for a verdict, and
 * naming it would dress up "we found nothing" as a reference.
 *
 * Computed identically on every rung on purpose, and it touches no disk. Both
 * consequences matter: the two strategies agree on `evidenceRef` for the same
 * context, which is what makes swapping strategies a change to the branch and
 * its rationale and to nothing else (R6.14); and the common path — an inline
 * verdict object — still names the real artefact without a read.
 */
export function resolveEvidenceRef(ctx: FailureContext): string | null {
  const candidate = ctx.failureYamlPath ?? ctx.packDir ?? null;
  return toRepoRelative(candidate, ctx.repoRoot);
}

/**
 * Make an absolute path repository-relative, or leave it exactly as it is.
 *
 * A path outside the repository root is returned untouched rather than rendered
 * as a `../../..` climb: it is still a real resolved path, and an escaping
 * relative path in the snapshot would read as a repository path that does not
 * exist. Nothing here invents a root — without one, the absolute path stands.
 */
function toRepoRelative(path: string | null, repoRoot: string | null | undefined): string | null {
  if (path === null) return null;
  if (typeof repoRoot !== 'string' || repoRoot.trim().length === 0) return path;
  const root = resolve(repoRoot);
  const relativePath = relative(root, resolve(path));
  if (relativePath.length === 0 || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return path;
  }
  return relativePath.split('\\').join('/');
}

/** What a strategy supplies to build its answer. */
export interface RoutedRepairInput {
  readonly branch: RepairBranch;
  readonly strategy: RepairStrategy;
  readonly rationale: string;
  readonly severity?: string | null;
  readonly category?: string | null;
  readonly confidence?: number | null;
}

/**
 * The single construction site for a `RoutedRepair`.
 *
 * Every absent field becomes an explicit `null` here, because this value is
 * stored on a `PromiseRecord` and serialised: `JSON.stringify` drops a key whose
 * value is `undefined`, which would change the snapshot's shape silently.
 */
export function routedRepair(ctx: FailureContext, input: RoutedRepairInput): RoutedRepair {
  return {
    branch: input.branch,
    strategy: input.strategy,
    severity: input.severity ?? null,
    category: input.category ?? null,
    confidence: input.confidence ?? null,
    evidenceRef: resolveEvidenceRef(ctx),
    rationale: input.rationale,
  };
}

/**
 * The default branch — the residue (R6.9).
 *
 * `docs-lie` is not "we gave up". `code-break` requires positive evidence of a
 * product fault and `test-drift` requires positive evidence of a test-mechanics
 * fault; when neither is present, the claim that failed is the thing least
 * supported by evidence, and the documentation is where the problem lives. It is
 * also the safest of the three by autonomy: a documentation amendment is
 * proposed as a rendered diff and never written silently, whereas a `code-break`
 * repair is applied automatically. Defaulting to the branch that touches nothing
 * without a human is the correct failure mode for a rule that did not match.
 */
export function docsLieRepair(
  ctx: FailureContext,
  strategy: RepairStrategy,
  rationale: string,
  extra: Omit<RoutedRepairInput, 'branch' | 'strategy' | 'rationale'> = {},
): RoutedRepair {
  return routedRepair(ctx, { ...extra, branch: 'docs-lie', strategy, rationale });
}

// ---------------------------------------------------------------------------
// Building a context
// ---------------------------------------------------------------------------

/** What {@link createFailureContext} needs. Note what is *not* here: any path. */
export interface FailureContextRequest {
  readonly family: CommandFamily;
  /** The failing terminal event, as parsed. */
  readonly terminal: Record<string, unknown>;
  readonly promiseId: string;
  /** ExecutionTestrun only. Pass only `failed` or `broken` (design §6.5). */
  readonly memberStatus?: MemberStatus | null;
  /**
   * The evidence listing from `listArtifacts`, which derived its paths from the
   * command family. Omit it for a family that seals no pack.
   */
  readonly evidence?: EvidenceListing | null;
  /** Absolute repository root, so `evidenceRef` can be repository-relative. */
  readonly repoRoot?: string | null;
  /**
   * The `verdict` object, when the caller read it off a member event rather than
   * off the terminal. Omitted, the terminal's own `verdict` field is used.
   */
  readonly verdictObject?: unknown;
  /** The `failure.yaml` read, injected. Defaults to the `node:fs` one. */
  readonly yaml?: FailureYamlFileSystem;
  /**
   * The triage note read out of this run's sealed `.evidence` archive and
   * attributed to *this* member by the test id the pack itself declares
   * (`kane/packTriage.ts`).
   *
   * Preferred over the listing's `failure.yaml` when both exist, because a
   * `.evidence` archive is what Kane actually seals: a pack *directory* under
   * `.testmuai/evidence/` is an extraction someone left behind, and it may well
   * belong to a different run. Passing it is how the note reaches the triage rung
   * at all — the rung reads text, and this is text, so nothing about the parser or
   * the ordering changes.
   */
  readonly sealedTriage?: SealedTriageNote | null;
  readonly diagnostics?: DiagnosticSink;
}

/**
 * Build a `FailureContext` — the recommended door, and the reason the two
 * strategies agree on everything except their own reasoning.
 *
 * It does three things a call site would otherwise repeat and eventually get
 * wrong: it normalises the raw wire verdict object once, it fills both evidence
 * paths from the listing rather than from the event, and it memoises the
 * `failure.yaml` load so a strategy that consults the triage note twice — or two
 * strategies consulting it in one comparison — reads the disk once and gets one
 * answer. That memoisation is what makes `route` deterministic across repeated
 * calls even though it can touch a filesystem.
 */
export function createFailureContext(request: FailureContextRequest): FailureContext {
  const pack: EvidencePack | null = request.evidence?.pack ?? null;
  const sealed = request.sealedTriage ?? null;
  // The sealed archive wins: it is the file Kane wrote, and the note inside it was
  // tied to this member by identifier. A pack directory is at best an extraction
  // of one, at worst another run's.
  const failureYamlPath = sealed?.archivePath ?? findFailureYamlArtifact(pack)?.path ?? null;

  let loaded: FailureYaml | null = null;
  let didLoad = false;
  const load = (): FailureYaml | null => {
    if (didLoad) return loaded;
    didLoad = true;
    loaded = loadFailureYaml({
      path: failureYamlPath,
      ...(sealed === null ? {} : { content: sealed.content }),
      fs: request.yaml,
      diagnostics: request.diagnostics,
    });
    return loaded;
  };

  const rawVerdict = request.verdictObject === undefined
    ? request.terminal['verdict']
    : request.verdictObject;

  return {
    family: request.family,
    terminal: request.terminal,
    verdictObject: normaliseVerdictObject(rawVerdict),
    evidenceDir: request.evidence?.dir ?? null,
    packDir: pack?.dir ?? null,
    failureYamlPath,
    repoRoot: request.repoRoot ?? null,
    loadFailureYaml: load,
    memberStatus: request.memberStatus ?? null,
    promiseId: request.promiseId,
  };
}
