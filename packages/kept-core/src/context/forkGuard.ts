/**
 * The fork guard — check seven of the fail-fast ladder (design §13.2.4, R5.2).
 *
 * `maintain reconcile` validates in a fixed order and exits two with nothing
 * mutated on the first failure. KEPT mirrors every check it can perform locally
 * *before* spawning, so the common refusals cost no process at all, and this is
 * the last and subtlest of them:
 *
 * > the file does not already back a **different live source** — a second
 * > non-retired listing entry whose path or digest matches `--from` while its id
 * > differs from the resolved id.
 *
 * When one file has been ingested twice it now backs two live sources, and moving
 * a head would silently fork the graph. Kane refuses. KEPT detects the same
 * condition from the listing it already read and reports it as
 * `reconcile-source-forked` with **both** conflicting source ids, because which
 * two ids collided is exactly the information a human needs in order to retire
 * one of them.
 *
 * ## Why this is not the ladder's `ambiguous`
 *
 * They look like the same question and they are not. `ambiguous` is what the
 * ladder answers when it cannot choose: two live candidates tie at the rung it is
 * standing on, so there is no resolution at all. The fork guard runs **after** a
 * resolution succeeded, and asks whether some *other* live entry is backed by the
 * same file. Two ways that happens with no tie anywhere:
 *
 * 1. **The rungs disagree.** First-hit-wins stops at rung one, so a file whose
 *    path matches exactly one live entry resolves — even when a *different* live
 *    entry records the same digest under another path. Nothing tied; the ladder
 *    simply never looked past the rung that answered.
 * 2. **The resolution came from the cache.** A `byPath` hit bypasses the ladder
 *    entirely (§13.2.2), so a fork that appeared in the store since the entry was
 *    recorded is invisible to it. The guard is the only thing that sees it.
 *
 * ## Which rungs count as "the same file"
 *
 * The path rungs and the digest rung, and deliberately **not** the basename rung.
 * §13.2.4 says "whose path or digest matches", and a shared basename is not a
 * shared file: `docs/pricing.md` and `apps/fixture/docs/pricing.md` are two
 * documents, and treating them as a fork would refuse a save over a filename
 * coincidence. The rung sets themselves come from `matchStoreSources`, so the
 * guard and the ladder can never disagree about what "matches" means.
 *
 * A retired entry is never a conflict: retirement is what a human does to resolve
 * a fork, and a retired source cannot fork a graph.
 *
 * ## What it does not do
 *
 * It starts no process, reads no file, and does not decide what happens next. A
 * fork is a refusal like every other row of §14.1 — a diagnostic, no spawn, no
 * review card, verdicts and freshness untouched, `degraded` still **false**
 * because no proven data was lost, a handoff with `branch: null`, and exit zero.
 * Wiring those six steps to a command is `kept reconcile`'s job; deciding whether
 * the condition holds is this file's, and nothing else's.
 */

import type { Diagnostic, DiagnosticSink } from '../diagnostics.js';

import {
  matchStoreSources,
  type LadderRung,
  type SourceMatchRequest,
  type StoreSource,
} from './sources.js';

/** The diagnostic code §13.2.4 fixes for this check. The Ledger keys off it. */
export const FORK_GUARD_DIAGNOSTIC_CODE = 'reconcile-source-forked';

/**
 * The rungs that mean "the same file" for the purposes of the guard.
 *
 * `unique-basename` is absent on purpose: §13.2.4 asks whether the *path or
 * digest* matches, and two documents sharing a filename are two documents.
 */
export const FORK_GUARD_RUNGS: readonly LadderRung[] = Object.freeze([
  'exact-path',
  'abs-path',
  'digest',
]);

/** One live entry that is backed by the same file as the resolved source. */
export interface ForkConflict {
  readonly source: StoreSource;
  /** The rung on which it collided with the resolved source. */
  readonly rung: LadderRung;
}

/**
 * The guard's answer.
 *
 * A discriminated union rather than a boolean, so the conflicting ids are
 * reachable only on the arm that found some — a caller cannot report a fork
 * without the two ids the diagnostic exists to carry.
 */
export type ForkGuardResult =
  | { readonly forked: false }
  | {
      readonly forked: true;
      /** Every other live entry the file backs, in listing order. Never empty. */
      readonly conflicts: readonly ForkConflict[];
      readonly diagnostic: Diagnostic;
    };

/** What {@link forkGuard} needs: a match request plus the resolution to check. */
export interface ForkGuardRequest extends SourceMatchRequest {
  /** The source the resolution settled on, however it was reached. */
  readonly resolved: StoreSource;
  /** Where the diagnostic is recorded. The same record is embedded in the result. */
  readonly diagnostics: DiagnosticSink;
}

/**
 * Run check seven over an already-projected listing (§13.2.4).
 *
 * Total over every input, including a listing that does not contain the resolved
 * source at all — which is not a fork, and is the cache-inconsistency case
 * `.kept/sources.json` handles by refreshing rather than by refusing. Never
 * throws, and never spawns.
 */
export function forkGuard(request: ForkGuardRequest): ForkGuardResult {
  const matches = matchStoreSources(request);
  const conflicts: ForkConflict[] = [];
  const seen = new Set<string>([request.resolved.sourceId]);

  for (const rung of matches.rungs) {
    if (!FORK_GUARD_RUNGS.includes(rung.rung)) continue;
    for (const candidate of rung.live) {
      if (seen.has(candidate.sourceId)) continue;
      seen.add(candidate.sourceId);
      conflicts.push({ source: candidate, rung: rung.rung });
    }
  }

  if (conflicts.length === 0) return { forked: false };

  const named = matches.relPath ?? request.file;
  const others = conflicts.map((conflict) => `${conflict.source.sourceId} (${conflict.rung})`);
  const diagnostic = request.diagnostics.report({
    code: FORK_GUARD_DIAGNOSTIC_CODE,
    severity: 'warn',
    message:
      `${named} already backs ${conflicts.length === 1 ? 'another live source' : 'other live sources'}: ` +
      `it resolved to ${request.resolved.sourceId}, and ${others.join(', ')} ` +
      `${conflicts.length === 1 ? 'is' : 'are'} live and backed by the same file. Moving a head ` +
      `now would fork the assurance graph, so \`maintain reconcile\` was not invoked: nothing ` +
      `was mutated and no verdict moved. Retire all but one of ` +
      `${[request.resolved.sourceId, ...conflicts.map((conflict) => conflict.source.sourceId)].join(', ')}, ` +
      `then reconcile again.`,
    file: matches.relPath,
  });

  return { forked: true, conflicts, diagnostic };
}
