/**
 * The one promise-provider interface (design §5.1, R2.1).
 *
 * Both providers implement this and nothing else, which is the point: the graph
 * builder holds a list of `PromiseAdapter`s and knows nothing about `*_test.md`
 * files or about `kane-cli cover`. Adding a third source of promises later is
 * adding an implementation, not editing the builder.
 *
 * The load-bearing detail is the shape of {@link ProviderResult}: **failure is a
 * field, not a throw.** `collect` never rejects and never throws, so a provider
 * that could not do its job returns `ok: false` with a `degradedReason` and the
 * build continues on whatever the other provider produced. That is what makes
 * graceful degradation (R2.8, R2.10, R2.12) a data path the type system can see
 * rather than a `catch` block somebody has to remember to write. `ok` is a plain
 * boolean here because the *interface* admits both answers — the baseline
 * implementation narrows it to the literal `true`, which is how "this provider
 * cannot fail" becomes a compile-time fact rather than a comment (§5.2, R2.4).
 *
 * Providers report **candidates**, not promises. The citation admission gate of
 * §3.3 is the single funnel into the graph, so a provider cannot mint a
 * graph-bound `PromiseRecord` even by accident — the strongest available form of
 * "every promise in the graph has a resolvable citation" (R1.3).
 *
 * `axes` carries per-promise-id overlays and is empty for the baseline provider.
 * It lives on the shared result rather than on the enrichment result alone
 * because §5.4's merge applies overlays uniformly and should not have to ask
 * which implementation it is holding.
 */

import type { Diagnostic, DiagnosticSink } from '../diagnostics.js';
import type { PromiseCandidate } from '../model/admission.js';
import type { DesignedTest, ProviderName, Verdict } from '../model/promise.js';
import type { KaneInvoker } from '../kane/invoker.js';

/**
 * One promise-id-keyed axis overlay (design §5.1, §5.3).
 *
 * Fields are optional rather than nullable, and that is the one place in the
 * model where optional is right: an overlay says "set this axis", and a *missing*
 * key must mean "leave whatever the baseline had" rather than "clear it". An
 * explicit `null` here would let a coverage payload that omitted a test silently
 * un-design it, which is the opposite of §5.4's rule that enrichment absence
 * costs nothing.
 */
export interface ProviderAxisOverlay {
  readonly designedTest?: DesignedTest;
  readonly verdict?: Verdict;
  readonly evidencePackId?: string;
}

/** Overlays by promise id. Read-only: the merge reads it, nobody mutates it. */
export type ProviderAxes = ReadonlyMap<string, ProviderAxisOverlay>;

/** The empty overlay map, for providers that contribute no axes. */
export const NO_PROVIDER_AXES: ProviderAxes = new Map<string, ProviderAxisOverlay>();

/**
 * What a provider answers (design §5.1).
 *
 * Every field is required. A provider that has nothing to say about `axes` says
 * so with {@link NO_PROVIDER_AXES}, and one that succeeded says so with
 * `degradedReason: null` — the same "explicit null, never a dropped key" rule the
 * promise model follows (§9.1), for the same reason: a forgotten field and a
 * deliberate absence must not look alike.
 */
export interface ProviderResult {
  readonly provider: ProviderName;
  /** Candidates, pre-admission. The graph builder runs the citation gate (§3.3). */
  readonly candidates: readonly PromiseCandidate[];
  /** Per-promise-id axis overlays; enrichment only. */
  readonly axes: ProviderAxes;
  /** `false` contributes `degraded` to the graph (R2.8). */
  readonly ok: boolean;
  /** Why it degraded, from the fixed vocabulary of §5.3. Null when `ok`. */
  readonly degradedReason: string | null;
  /** Everything the provider observed, in report order. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * What `collect` is given (design §5.1).
 *
 * `invoker` is optional for one reason: R2.12 makes a run with no Kane at all a
 * supported state of the world, and the baseline provider needs nothing but the
 * filesystem (§5.5). A required field would force every baseline caller — and
 * every baseline test — to construct a Kane process boundary it will never use,
 * which is exactly the coupling §5.5 exists to deny. An enrichment provider
 * handed no invoker is entitled to treat that as `kane-not-found`.
 *
 * `diagnostics` is a shared sink so one build collects every provider's
 * observations in one ordered list for the snapshot. Omit it and a provider keeps
 * its own; either way the provider's own diagnostics come back on the result.
 */
export interface ProviderContext {
  /** Absolute path to the repository root. `process.cwd()` is never substituted. */
  readonly repoRoot: string;
  /** The Kane process boundary, when this environment has one. */
  readonly invoker?: KaneInvoker | undefined;
  /** Where observations are recorded. Omit and the provider keeps a private sink. */
  readonly diagnostics?: DiagnosticSink | undefined;
}

/**
 * The interface both providers implement (R2.1).
 *
 * `collect` **never throws and never rejects.** Failure is expressed in
 * {@link ProviderResult.ok}.
 */
export interface PromiseAdapter {
  readonly name: ProviderName;
  collect(context: ProviderContext): Promise<ProviderResult>;
}
