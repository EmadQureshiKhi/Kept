/**
 * The enrichment promise provider, `cover gaps`, gated on the Assurance `done`
 * event (design §5.3, §5.3.0, §5.3.1, R2.5 to R2.9, R2.12, R9.9 to R9.14).
 *
 * This provider contributes exactly one thing: the **Coverage_Axes**, design
 * completeness and proven, for the repository as a whole and per use case. It
 * contributes no candidates and no citations at all, §5.4 makes baseline the sole
 * citation authority, and the reason is this file: a Kane outage must never be able
 * to move a citation, and the cheapest way to guarantee that is for the
 * outage-prone provider to have no citation to move.
 *
 * ### Why `cover gaps` and not `cover`
 *
 * §5.3 was written against the singular `cover`, and against 0.8.4 it cannot
 * deliver the axes on this repository. It reads its depth axis out of a sealed
 * Evidence_Pack and refuses at exit 2:
 *
 * ```
 * {"type":"error","v":1,"verb":"cover","message":"error: ... carries no
 *   coverage/usecases.yaml \u2014 the pack predates coverage or its project had no
 *   .context at seal time"}
 * {"type":"done","v":1,"verb":"cover","status":"refused","exit_code":2}
 * ```
 *
 * A coverage document is minted at **authoring** time and every pack this
 * repository seals is a **replay** pack, so no amount of retrying changes that.
 * `cover gaps` answers the same two axes from the **live assurance graph**, and it
 * works today: exit 0, `done` with `status: complete`, `design_completeness` and
 * `proven` blocks with `source: graph_execution_facts` over
 * `denominator: current_live_acs`, plus a per-use-case dossier.
 *
 * So {@link ENRICHMENT_ARGV} is `['cover', 'gaps', '--json']`. The singular form
 * stays in this file as {@link COVER_SINGULAR_ARGV} and in `providers/coverage.ts`
 * as a whole projection, because it is the right first choice for a repository
 * whose packs *are* authored, and its refusal is committed as
 * `test/fixtures/assurance-cover-refused.ndjson`, which is still a regression this
 * codebase must keep passing.
 *
 * ### The acceptance gate, which is conjunctive and narrow
 *
 * Enriched axes are accepted **only** when all four of these hold (§5.3, §5.3.0):
 *
 * 1. `stream.kind === 'complete'`,
 * 2. a `done` event arrived, which for the `Assurance` family is what `complete`
 *    *means*, so this is the same fact stated from the contract's side,
 * 3. `terminal.status === 'complete'`, and
 * 4. a `gaps` payload event is present **and projects at least one use-case row**.
 *
 * Anything else degrades. The narrowness is the point. Every one of the four
 * near-misses is a stream that looks successful from one angle: a refusal is a
 * *complete* stream, a pause exits 3 and is *resumable*, a crashed run may have
 * emitted plenty of progress, and an empty payload parses perfectly. Accept any of
 * them and the ledger publishes coverage axes it did not earn, and R9.13 is
 * explicit that the axes are then **withheld**, never rendered as a zero.
 *
 * ### Every observation gets its own reason
 *
 * `degradedReason` comes from the fixed vocabulary of §5.3 and is never a generic
 * string, because the Ledger's `/runs` page renders it to tell a reviewer *why*
 * they are looking at baseline data only. The verified refusal envelope of §5.3.1
 * is the case that shows why it matters: `assurance-status:refused` plus a
 * diagnostic quoting Kane's own `message` tells the reviewer to run
 * `context ingest`. A generic failure would tell them nothing, and the remedy was
 * in the stream the whole time.
 *
 * ### Nothing here throws
 *
 * `collect` never throws and never rejects, per {@link PromiseAdapter}. Kane being
 * absent (R2.12), refusing, pausing, crashing, timing out or emitting an
 * unreadable payload are all *states of the world* (§14.2) and all arrive as
 * `ok: false` plus a reason. The Assurance exit-3 rule is not re-derived here
 * either: the exit meaning is read off the invocation result, which already applied
 * `exitMeaning(family, code, killed)`, so a paused run cannot be read as a failure
 * by this module even by accident.
 *
 * ### What this provider does *not* do any more
 *
 * It writes no per-promise axis overlay. The `gaps` payload names use cases, not
 * test documents: it carries no `test_id` and no path, so there is nothing to key
 * onto a promise, and inventing a keying would be the one thing this file exists to
 * refuse. {@link EnrichmentResult.axes} is therefore always empty, and the proven
 * *promise* verdicts on the graph come from real verification runs through the
 * write guard of §4.8, which is where they always belonged.
 */

import { createDiagnosticSink, type Diagnostic, type DiagnosticSink } from '../diagnostics.js';
import { contractFor, type CommandFamily } from '../kane/family.js';
import type { ExitMeaning } from '../kane/exit.js';
import { parseStream, type ParsedStream } from '../kane/ndjson.js';
import type { InvocationResult } from '../kane/invoker.js';
import { promiseId, toPosix } from '../model/ids.js';
import type { PromiseCandidate } from '../model/admission.js';
import type { PromiseRecord, ProviderName } from '../model/promise.js';

import {
  NO_PROVIDER_AXES,
  type PromiseAdapter,
  type ProviderContext,
  type ProviderResult,
} from './adapter.js';
import {
  projectGaps,
  type CoverageAxes,
  type CoverageAxisTarget,
  type GapsProjection,
} from './coverage.js';

/** This provider's name in `ProviderName` terms. */
export const ENRICHMENT_PROVIDER_NAME: ProviderName = 'enrichment';

/**
 * The family `cover gaps` belongs to (R2.5). Everything family-dependent reads this.
 *
 * `satisfies` rather than an annotation, deliberately: an annotation of
 * `CommandFamily` would widen the type and every downstream `ParsedStream<F>`
 * would lose the family that makes `terminal` an `AssuranceDoneEvent` (§4.2).
 */
export const ENRICHMENT_FAMILY = 'Assurance' satisfies CommandFamily;

/**
 * argv **without** the NDJSON enabler (design §5.3.0, R9.9).
 *
 * `cover gaps --json`, and nothing else. The `Assurance` family's enabler is
 * `--mode agent`, appended by the invoker from the contract table, never
 * `--agent`, which is `ExecutionRun`'s and which `applyNdjsonEnabler` throws on for
 * this family. Writing the enabler here would be a second encoding of the one fact
 * §4.7 exists to encode once.
 */
export const ENRICHMENT_ARGV: readonly string[] = Object.freeze(['cover', 'gaps', '--json']);

/**
 * The singular `cover` argv, kept because it is still the right first choice for a
 * repository whose Evidence_Packs were authored rather than replayed (§5.3.0).
 *
 * Nothing in this provider invokes it. It is here so the documented first choice is
 * spelled once, beside the argv KEPT actually reads, rather than surviving only in
 * prose, and so the committed refusal fixture has something to name.
 */
export const COVER_SINGULAR_ARGV: readonly string[] = Object.freeze(['cover', '--json']);

/** The one `done.status` the gate accepts (§5.3). */
export const ACCEPTED_ASSURANCE_STATUS = 'complete';

/** Prefix of the status-derived reasons, e.g. `assurance-status:refused` (§5.3). */
export const ASSURANCE_STATUS_REASON_PREFIX = 'assurance-status:';

/**
 * Prefix of the exit-derived reason, for the one row R2.8 states that §5.3's table
 * does not itemise: "exits with a process exit code that its Command_Family defines
 * as failure" while the stream nonetheless reported `status: 'complete'`.
 *
 * Kane does not produce that envelope, the verified refusal pairs exit 2 with
 * `status: 'refused'`, and the reason belongs in the status (§5.3.1). But the
 * classifier has to be total, and answering an inconsistent envelope with
 * `assurance-status:complete` would be a lie about a failing run. So the same
 * `prefix:value` shape is reused over the closed {@link ExitMeaning} vocabulary,
 * which keeps the string derived rather than invented.
 */
export const ASSURANCE_EXIT_REASON_PREFIX = 'assurance-exit:';

/**
 * The `degradedReason` vocabulary of design §5.3 as §5.3.0 amends it, verbatim.
 *
 * Fixed strings, because they travel into `graph.degradedReasons`, from there into
 * `ledger.snapshot.json`, and from there onto a page a reviewer reads. Renaming one
 * is a snapshot change, not a local edit.
 */
export const ENRICHMENT_DEGRADED_REASONS = Object.freeze({
  /** No Kane in the environment at all, or none was handed to us (R2.12). */
  kaneNotFound: 'kane-not-found',
  /** The stream ended without `done`; outcome unknown, never a verdict (R2.7). */
  crashedStream: 'crashed-stream: outcome unknown',
  /** `done.status === 'paused'`. Resumable, and never a failure (R2.9). */
  pausedResumable: 'paused-resumable',
  /** Our own timer fired at the configured budget (R2.8). */
  timeout: 'enrichment-timeout',
  /**
   * No `gaps` event, or one that projected zero use-case rows (R2.8, R9.13).
   *
   * Replaces `coverage-payload-unreadable`, which named the payload of a command
   * this provider no longer invokes. The rename is deliberate rather than
   * cosmetic: the reason string reaches a reviewer, and telling them a `coverage`
   * payload was unreadable when the run was `cover gaps` sends them to read the
   * wrong output.
   */
  gapsPayloadUnreadable: 'gaps-payload-unreadable',
} as const);

/** Every fixed reason above. The two prefixed families are derived per run. */
export const ENRICHMENT_DEGRADED_REASON_VALUES: readonly string[] = Object.freeze(
  Object.values(ENRICHMENT_DEGRADED_REASONS),
);

/**
 * Diagnostic codes this provider reports. Stable strings: the Ledger's `/runs`
 * page and the property suite both key off them.
 */
export const ENRICHMENT_DIAGNOSTIC_CODES = Object.freeze({
  /** No invoker, or the binary was not on PATH (R2.12). */
  kaneNotFound: 'enrichment-kane-not-found',
  /** The stream never reached `done`; states that the outcome is unknown (R2.7). */
  crashedStream: 'enrichment-crashed-stream',
  /** A non-accepting `done.status`. Quotes Kane's `message` verbatim (§5.3.1). */
  status: 'enrichment-assurance-status',
  /** `done.status === 'paused'`; recorded as paused and resumable (R2.9). */
  paused: 'enrichment-paused',
  /** The budget elapsed and we killed the process (R2.8). */
  timeout: 'enrichment-timeout',
  /** A failing exit meaning under an otherwise accepting envelope (R2.8). */
  exit: 'enrichment-exit-meaning',
  /** No `gaps` event arrived in a complete, accepting stream. */
  gapsMissing: 'enrichment-gaps-missing',
  /** A `gaps` event arrived but projected zero use-case rows (§5.3.0, R9.13). */
  gapsUnprojectable: 'enrichment-gaps-unprojectable',
  /** A use-case entry in the payload carried no identifier, so it was skipped. */
  gapsRowRefused: 'enrichment-gaps-row-refused',
  /** An axis arrived without a readable percentage, so that axis is withheld. */
  gapsAxisWithheld: 'enrichment-gaps-axis-withheld',
  /** The two axis ratios disagreed on a denominator, or one was unreadable. */
  gapsDenominatorUnconfirmed: 'enrichment-gaps-denominator-unconfirmed',
  /** Lines of the stream failed JSON parsing. Informational; the gate decides. */
  streamLinesUnparsed: 'enrichment-stream-lines-unparsed',
  /** The accepted path: how many rows projected and what the two axes read. */
  accepted: 'enrichment-accepted',
  /** Should be unreachable. Present because `collect` may not throw. */
  unexpected: 'enrichment-unexpected',
} as const);

/** Every code above, for tests and for the Ledger's filter list. */
export const ENRICHMENT_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(ENRICHMENT_DIAGNOSTIC_CODES),
);

/**
 * One promise a coverage payload can be keyed to. Re-exported shape of
 * {@link CoverageAxisTarget}.
 *
 * Unused by the `gaps` path, and that is a fact about the payload rather than an
 * omission: `gaps` names use cases, not test documents, so it carries nothing a
 * promise could be keyed by. The type and the two derivations below serve
 * `buildCoverageAxes`, which reads the singular `cover` payload of §5.3.
 */
export type EnrichmentTarget = CoverageAxisTarget;

/**
 * Derive keying targets from admitted promise records, the normal path for the
 * singular `cover` payload, since the merge of §5.4 runs the admission gate over
 * baseline candidates first and therefore already holds records with real ids.
 */
export function enrichmentTargetsFromPromises(
  promises: readonly PromiseRecord[],
): readonly EnrichmentTarget[] {
  return promises.map((promise) => ({
    promiseId: promise.id,
    designedTest: promise.designedTest,
  }));
}

/**
 * Derive keying targets from baseline *candidates*, for a caller that wants the
 * axes before admission.
 *
 * The id is derived with {@link promiseId} over the citation file and the claim,
 * the same derivation `createPromiseRecord` performs, so a target's id is the id
 * the record will have. A candidate with no citation cannot become a promise (§3.3)
 * and is dropped rather than given an invented identity.
 */
export function enrichmentTargetsFromCandidates(
  candidates: readonly PromiseCandidate[],
): readonly EnrichmentTarget[] {
  const targets: EnrichmentTarget[] = [];
  for (const candidate of candidates) {
    const citation = candidate.citation;
    if (citation === null) continue;
    targets.push({
      promiseId: promiseId(toPosix(citation.file), candidate.claim),
      designedTest: candidate.designedTest ?? null,
    });
  }
  return targets;
}

/** What {@link collectEnrichment} answers, on top of the shared provider result. */
export interface EnrichmentResult extends ProviderResult {
  readonly provider: 'enrichment';
  /**
   * Always empty. Enrichment supplies no citations, so it can supply no
   * candidates, typed as the empty tuple so that is a compile-time fact and not a
   * convention (§5.4 step 1).
   */
  readonly candidates: readonly [];
  /** True exactly when all four clauses of the §5.3 gate held. */
  readonly ok: boolean;
  /** Null when `ok`; otherwise one string from the §5.3 vocabulary. */
  readonly degradedReason: string | null;
  /** The exit meaning of the invocation, or `kane-not-found` when none ran. */
  readonly exitMeaning: ExitMeaning;
  /** The parsed stream, or null when no process ran at all. */
  readonly stream: ParsedStream<'Assurance'> | null;
  /** What the payload projected, or null when no `gaps` event arrived. */
  readonly gaps: GapsProjection | null;
  /**
   * The axes, **only** on the accepting path. Null on every degraded one, which is
   * R9.13 expressed in the type: there is no field here that could carry a zero
   * for a run that proved nothing.
   */
  readonly coverageAxes: CoverageAxes | null;
  /** argv actually passed, enabler included, `--mode agent`, never `--agent`. */
  readonly effectiveArgv: readonly string[];
}

/**
 * {@link collectEnrichment}'s input: the shared context plus this module's seams.
 *
 * `timeoutMs` is **required and has no default here**. The budget is
 * `timeouts.enrichmentMs` in `.kept/config.json` (60 000), and a default in this
 * file would be a second place that number lives, the one thing §5.3's "60 s
 * budget" must not become. A caller reads the config and passes it; that is also why
 * {@link createEnrichmentProvider} takes it at construction rather than pretending
 * `ProviderContext` carries it.
 */
export interface EnrichmentContext extends ProviderContext {
  /** Budget in milliseconds, from `.kept/config.json`. Never defaulted here. */
  readonly timeoutMs: number;
  /** Working directory for the invocation. Defaults to `repoRoot`. */
  readonly cwd?: string | undefined;
  /** Live tail, passed through to the invoker. */
  readonly onLine?: ((line: string) => void) | undefined;
}

/** A sink that also hands back what it recorded, so the result can carry it. */
function recording(sink: DiagnosticSink, into: Diagnostic[]): DiagnosticSink {
  return {
    report(draft): Diagnostic {
      const diagnostic = sink.report(draft);
      into.push(diagnostic);
      return diagnostic;
    },
  };
}

/**
 * Read `done.status` as a comparable string.
 *
 * `AssuranceDoneEvent.status` is `WireEnum<AssuranceStatus>`, the six documented
 * values *plus* any string a later release invents, and it is optional, because
 * nothing on the wire promises it. So the reason string is built from whatever
 * arrived, lowercased and trimmed, and an absent or non-string status becomes
 * `unknown`: `assurance-status:unknown` is a truthful reason, and defaulting to
 * `complete` would hand an unreadable envelope the accepting branch.
 */
export function normaliseAssuranceStatus(raw: unknown): string {
  if (typeof raw !== 'string') return 'unknown';
  const text = raw.trim().toLowerCase();
  return text.length === 0 ? 'unknown' : text;
}

/** `assurance-status:<status>` (§5.3). */
export function assuranceStatusReason(status: string): string {
  return `${ASSURANCE_STATUS_REASON_PREFIX}${normaliseAssuranceStatus(status)}`;
}

/** `assurance-exit:<meaning>`, see {@link ASSURANCE_EXIT_REASON_PREFIX}. */
export function assuranceExitReason(meaning: ExitMeaning): string {
  return `${ASSURANCE_EXIT_REASON_PREFIX}${meaning}`;
}

/** The command as a reviewer would type it, for a diagnostic to name. */
const COMMAND = ENRICHMENT_ARGV.join(' ');

/** The first `message` string in the stream, for a diagnostic to quote verbatim. */
function firstMessage(stream: ParsedStream<'Assurance'>): string | null {
  for (const event of stream.events) {
    const message = event['message'];
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  return null;
}

function failed(
  base: {
    readonly exitMeaning: ExitMeaning;
    readonly stream: ParsedStream<'Assurance'> | null;
    readonly gaps: GapsProjection | null;
    readonly effectiveArgv: readonly string[];
    readonly diagnostics: readonly Diagnostic[];
  },
  degradedReason: string,
): EnrichmentResult {
  return {
    provider: 'enrichment',
    candidates: [],
    axes: NO_PROVIDER_AXES,
    ok: false,
    degradedReason,
    // Withheld, on every degraded path, without exception (R9.13).
    coverageAxes: null,
    ...base,
  };
}

/**
 * Invoke `cover gaps --json` under the Assurance family and project its `gaps`
 * payload into the Coverage_Axes (design §5.3, §5.3.0).
 *
 * Resolves for every state of the world. The classification order below is
 * deliberate and each step earns its place:
 *
 * 1. **No invoker, or no binary** → `kane-not-found`. R2.12 makes "no Kane at all"
 *    a supported state, so it is answered before anything else happens.
 * 2. **Our timer fired** → `enrichment-timeout`. Checked before the stream is
 *    classified, because a killed process leaves a truncated stream that would
 *    otherwise read as a crash, and "we cut it off at the budget" is the more
 *    accurate fact, and the one we know from our own side.
 * 3. **The stream lacks `done`** → `crashed-stream: outcome unknown` (R2.7). Ahead
 *    of the status branch because a stream with no terminal event has no status to
 *    read.
 * 4. **`done.status` is not `complete`** → `paused-resumable` for a pause (R2.9),
 *    otherwise `assurance-status:<status>`. This is where a refusal lands as
 *    `assurance-status:refused` (§5.3.1), *after* the crash check and *before* the
 *    exit check, so the reason comes from the event, which is where §5.3.1 puts
 *    it, and never from the generic exit 2.
 * 5. **A non-success exit under an accepting envelope** → `assurance-exit:<meaning>`,
 *    the residual R2.8 row.
 * 6. **No `gaps` event** → `gaps-payload-unreadable`.
 * 7. **Zero projected rows** → `gaps-payload-unreadable`, because a visibly
 *    baseline-only ledger beats a silently wrong proven number (§5.3, R9.13).
 */
export async function collectEnrichment(
  context: EnrichmentContext,
): Promise<EnrichmentResult> {
  const sink = context.diagnostics ?? createDiagnosticSink();
  const diagnostics: Diagnostic[] = [];
  const report = recording(sink, diagnostics);
  const contract = contractFor(ENRICHMENT_FAMILY);
  // The enabler the invoker will append, read from the contract rather than
  // restated, so this result describes the real argv even on the paths where no
  // process runs.
  const declaredArgv: readonly string[] = [...ENRICHMENT_ARGV];

  try {
    const invoker = context.invoker;
    if (invoker === undefined) {
      report.report({
        code: ENRICHMENT_DIAGNOSTIC_CODES.kaneNotFound,
        severity: 'warn',
        message:
          `No Kane invoker was supplied, so \`${COMMAND}\` was not run; the graph is built ` +
          `from the baseline provider alone and the coverage axes are withheld.`,
        file: null,
      });
      return failed(
        {
          exitMeaning: 'kane-not-found',
          stream: null,
          gaps: null,
          effectiveArgv: declaredArgv,
          diagnostics,
        },
        ENRICHMENT_DEGRADED_REASONS.kaneNotFound,
      );
    }

    const invocation: InvocationResult<'Assurance'> = await invoker.invoke({
      family: ENRICHMENT_FAMILY,
      argv: ENRICHMENT_ARGV,
      cwd: context.cwd ?? context.repoRoot,
      timeoutMs: context.timeoutMs,
      onLine: context.onLine,
    });
    const effectiveArgv = invocation.effectiveArgv;

    if (invocation.exitMeaning === 'kane-not-found') {
      report.report({
        code: ENRICHMENT_DIAGNOSTIC_CODES.kaneNotFound,
        severity: 'warn',
        message:
          `kane-cli was not found, so \`${COMMAND}\` did not run; the graph is built from the ` +
          `baseline provider alone (R2.12).`,
        file: null,
      });
      return failed(
        {
          exitMeaning: invocation.exitMeaning,
          stream: null,
          gaps: null,
          effectiveArgv,
          diagnostics,
        },
        ENRICHMENT_DEGRADED_REASONS.kaneNotFound,
      );
    }

    const stream = parseStream(contract, invocation.stdoutLines, { sink: report });
    const unparsed = stream.diagnostics.length;
    if (unparsed > 0) {
      report.report({
        code: ENRICHMENT_DIAGNOSTIC_CODES.streamLinesUnparsed,
        severity: 'info',
        message:
          `${unparsed} diagnostic${unparsed === 1 ? '' : 's'} were recorded while parsing the ` +
          `\`${COMMAND}\` stream; the acceptance gate decides what that means.`,
        file: null,
      });
    }

    const base = {
      exitMeaning: invocation.exitMeaning,
      stream,
      gaps: null,
      effectiveArgv,
      diagnostics,
    } as const;

    if (invocation.timedOut || invocation.exitMeaning === 'killed-by-timeout') {
      report.report({
        code: ENRICHMENT_DIAGNOSTIC_CODES.timeout,
        severity: 'warn',
        message:
          `\`${COMMAND}\` did not finish within its ${context.timeoutMs} ms budget and was ` +
          `killed, so the coverage axes were withheld and every existing verdict is preserved.`,
        file: null,
      });
      return failed(base, ENRICHMENT_DEGRADED_REASONS.timeout);
    }

    if (stream.kind === 'crashed') {
      report.report({
        code: ENRICHMENT_DIAGNOSTIC_CODES.crashedStream,
        severity: 'warn',
        message:
          `The \`${COMMAND}\` stream ended without a '${stream.expectedTerminal}' event, so ` +
          `the outcome is unknown: the coverage axes were withheld and no verdict was moved ` +
          `(R2.7).`,
        file: null,
      });
      return failed(base, ENRICHMENT_DEGRADED_REASONS.crashedStream);
    }

    const status = normaliseAssuranceStatus(stream.terminal.status);
    if (status !== ACCEPTED_ASSURANCE_STATUS) {
      const message = firstMessage(stream);
      const quoted = message === null ? '' : ` Kane reported: ${message}`;
      if (status === 'paused') {
        report.report({
          code: ENRICHMENT_DIAGNOSTIC_CODES.paused,
          severity: 'info',
          message:
            `\`${COMMAND}\` paused and is resumable, so the coverage axes are withheld, every ` +
            `existing verdict is preserved and nothing is recorded as a failure (R2.9).${quoted}`,
          file: null,
        });
        return failed(base, ENRICHMENT_DEGRADED_REASONS.pausedResumable);
      }
      report.report({
        code: ENRICHMENT_DIAGNOSTIC_CODES.status,
        severity: 'warn',
        message:
          `\`${COMMAND}\` finished with status '${status}', which the acceptance gate does not ` +
          `accept, so the graph is built from the baseline provider alone.${quoted}`,
        file: null,
      });
      return failed(base, assuranceStatusReason(status));
    }

    if (invocation.exitMeaning !== 'success') {
      report.report({
        code: ENRICHMENT_DIAGNOSTIC_CODES.exit,
        severity: 'warn',
        message:
          `\`${COMMAND}\` reported status '${status}' but its process exit meant ` +
          `'${invocation.exitMeaning}'. The envelope is inconsistent, so the coverage axes ` +
          `were withheld rather than trusted (R2.8).`,
        file: null,
      });
      return failed(base, assuranceExitReason(invocation.exitMeaning));
    }

    if (stream.gaps === null) {
      report.report({
        code: ENRICHMENT_DIAGNOSTIC_CODES.gapsMissing,
        severity: 'warn',
        message:
          `\`${COMMAND}\` completed but emitted no 'gaps' event, so there is nothing to read ` +
          `the design-completeness and proven axes from (R2.5, R9.9).`,
        file: null,
      });
      return failed(base, ENRICHMENT_DEGRADED_REASONS.gapsPayloadUnreadable);
    }

    const gaps = projectGaps(stream.gaps);
    for (const location of gaps.refused) {
      report.report({
        code: ENRICHMENT_DIAGNOSTIC_CODES.gapsRowRefused,
        severity: 'info',
        message:
          `The gaps payload entry at ${location} carried no use-case identifier, so it could ` +
          `not be published as a row and was skipped.`,
        file: null,
      });
    }

    if (gaps.axes.rows.length === 0) {
      report.report({
        code: ENRICHMENT_DIAGNOSTIC_CODES.gapsUnprojectable,
        severity: 'warn',
        message:
          `The gaps payload projected no use-case rows (${gaps.examined} object` +
          `${gaps.examined === 1 ? '' : 's'} examined` +
          `${gaps.truncated ? ', walk truncated' : ''}), so the coverage axes were withheld: ` +
          `a visibly baseline-only ledger is better than a ribbon that reads as "nothing owed" ` +
          `(§5.3, R9.13).`,
        file: null,
      });
      return failed({ ...base, gaps }, ENRICHMENT_DEGRADED_REASONS.gapsPayloadUnreadable);
    }

    const axes = gaps.axes;

    // Two observations that are reported and do **not** degrade the build, because
    // each of them costs exactly one figure rather than the whole axis set. A
    // withheld percentage renders as "withheld" beside rows that are still useful,
    // and a build degraded over it would take the per-use-case debt off the page
    // along with it.
    for (const [name, pct] of [
      ['design completeness', axes.designCompleteness.pct],
      ['proven', axes.proven.pct],
    ] as const) {
      if (pct !== null) continue;
      report.report({
        code: ENRICHMENT_DIAGNOSTIC_CODES.gapsAxisWithheld,
        severity: 'warn',
        message:
          `The gaps payload carried no readable percentage for the ${name} axis, so that ` +
          `figure is withheld rather than published as a zero (R9.13).`,
        file: null,
      });
    }

    const designedRatio = axes.designCompleteness.ratio;
    const provenRatio = axes.proven.ratio;
    if (
      designedRatio.denominator === null ||
      provenRatio.denominator === null ||
      designedRatio.denominator !== provenRatio.denominator
    ) {
      report.report({
        code: ENRICHMENT_DIAGNOSTIC_CODES.gapsDenominatorUnconfirmed,
        severity: 'info',
        message:
          `The two axis ratios did not confirm one live acceptance-criteria count ` +
          `(designed '${designedRatio.text ?? 'absent'}', proven '${provenRatio.text ?? 'absent'}'), ` +
          `so the ribbon states each ratio as it arrived and claims no shared denominator.`,
        file: null,
      });
    }

    report.report({
      code: ENRICHMENT_DIAGNOSTIC_CODES.accepted,
      severity: 'info',
      message:
        `\`${COMMAND}\` completed with status '${status}': design completeness ` +
        `${axes.designCompleteness.pct ?? 'withheld'}% ` +
        `(${designedRatio.text ?? 'no ratio'} acceptance criteria designed, ` +
        `${axes.designCompleteness.usecasesComplete.text ?? 'no ratio'} use cases complete), ` +
        `proven ${axes.proven.pct ?? 'withheld'}% (${provenRatio.text ?? 'no ratio'} ` +
        `acceptance criteria with execution facts), ${axes.rows.length} use-case row` +
        `${axes.rows.length === 1 ? '' : 's'} published.`,
      file: null,
    });

    return {
      provider: 'enrichment',
      candidates: [],
      // The `gaps` payload names use cases, not test documents, so there is nothing
      // to key onto a promise and no overlay to write. Empty by fact, not by
      // omission, see the module note.
      axes: NO_PROVIDER_AXES,
      ok: true,
      degradedReason: null,
      exitMeaning: invocation.exitMeaning,
      stream,
      gaps,
      coverageAxes: axes,
      effectiveArgv,
      diagnostics,
    };
  } catch (cause) {
    // Unreachable by design: everything above returns rather than throws. Present
    // because `PromiseAdapter.collect` may not reject, and an outcome nobody
    // planned for is exactly an outcome nobody knows (R2.7's own words).
    report.report({
      code: ENRICHMENT_DIAGNOSTIC_CODES.unexpected,
      severity: 'error',
      message:
        `The enrichment provider raised ${cause instanceof Error ? cause.message : String(cause)}` +
        `, so the outcome is unknown and the graph is built from the baseline provider alone.`,
      file: null,
    });
    return failed(
      {
        exitMeaning: 'force-interrupted',
        stream: null,
        gaps: null,
        effectiveArgv: declaredArgv,
        diagnostics,
      },
      ENRICHMENT_DEGRADED_REASONS.crashedStream,
    );
  }
}

/**
 * Build the enrichment provider as a {@link PromiseAdapter}.
 *
 * A factory rather than a singleton because the 60 s budget is configuration, not a
 * constant: `timeouts.enrichmentMs` is read from `.kept/config.json` by the caller
 * and supplied here, so no default for it exists anywhere in this module.
 */
export function createEnrichmentProvider(options: {
  readonly timeoutMs: number;
}): PromiseAdapter {
  return {
    name: ENRICHMENT_PROVIDER_NAME,
    async collect(context: ProviderContext): Promise<ProviderResult> {
      const supplied = context as EnrichmentContext;
      return collectEnrichment({
        ...supplied,
        timeoutMs:
          typeof supplied.timeoutMs === 'number' ? supplied.timeoutMs : options.timeoutMs,
      });
    },
  };
}

/**
 * The axes an enrichment result carries, or null.
 *
 * `ProviderResult` does not declare `coverageAxes`, only {@link EnrichmentResult}
 * does, and the merge is deliberately blind to which implementation it holds (§5.1).
 * So the field is read through a widened view, exactly as `kept build` already reads
 * `stream` and `exitMeaning`, and a result that is not an accepting enrichment run
 * answers null.
 */
export function readCoverageAxes(result: ProviderResult): CoverageAxes | null {
  const value = (result as { readonly coverageAxes?: unknown }).coverageAxes;
  if (typeof value !== 'object' || value === null) return null;
  const axes = value as { readonly rows?: unknown };
  return Array.isArray(axes.rows) ? (value as CoverageAxes) : null;
}
