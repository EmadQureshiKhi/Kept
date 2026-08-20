/**
 * The canonical provider merge (design §5.4, R1.7, R2.1, R5.5).
 *
 * One function, six rules, and every one of them is a rule about *who is allowed
 * to say what*:
 *
 * 1. The admission gate (§3.3) runs over **baseline** candidates first. Baseline
 *    is the sole citation authority, so a Kane outage can never move a citation.
 * 2. Union by promise id. On a collision (R1.7): baseline keeps `citation` and
 *    `claim`; `designedTest` and `verdict` come from enrichment when it supplied
 *    them; `providers` is the union; diagnostics are concatenated.
 * 3. Enrichment axis overlays are applied to matching promises.
 * 4. Any promise still without a designed test gets `verdict = 'undesigned'`
 *    (R5.5) — and this rule runs *after* step 2, so it outranks an enrichment
 *    verdict for a promise enrichment also un-designed.
 * 5. `degraded = !enrichment.ok`; `degradedReasons` is the reason it gave.
 * 6. Promises sorted by id, edges by `(kind, from, to)`.
 *
 * Step 6 needs no code here: `createPromiseGraph` establishes both orders at
 * construction and collapses duplicate edges, so building the graph through it is
 * what satisfies the requirement. Restating the comparators would be a second
 * authority on canonical order, and the committed snapshot's byte stability (§9.2)
 * depends on there being one.
 *
 * The division of labour is worth stating plainly, because it is what makes the
 * ledger honest under an outage. Baseline decides **which promises exist and what
 * they claim**. Enrichment decides **what is designed and what is proven**. Those
 * two sets of fields do not overlap, so degradation costs exactly the second set
 * and nothing else: `degraded` becomes true, `computeMetrics` withholds
 * `provenCoverage` rather than reporting zero (R2.11), and every citation, claim
 * and identifier is untouched.
 *
 * An enrichment candidate whose id matches no baseline promise is **dropped**, not
 * admitted. That follows from rule 1 rather than being an extra policy: enrichment
 * supplies no citations, so such a candidate has nothing for the gate to resolve,
 * and admitting it would put an uncited promise in a graph whose whole claim is
 * that there are none. It is reported so the drop is visible.
 */

import {
  createDiagnosticSink,
  type Diagnostic,
  type DiagnosticSink,
} from '../diagnostics.js';
import {
  admitPromises,
  type AdmissionBatch,
  type CitationSource,
  type PromiseCandidate,
} from '../model/admission.js';
import { promiseId, toPosix } from '../model/ids.js';
import {
  createPromiseGraph,
  createPromiseRecord,
  type DesignedTest,
  type GraphEdge,
  type PromiseGraph,
  type PromiseRecord,
  type ProviderName,
  type Verdict,
} from '../model/promise.js';

import type { ProviderAxisOverlay, ProviderResult } from './adapter.js';

/**
 * Diagnostic codes the merge reports. Stable strings — the Ledger's `/runs` page
 * and the property suite both key off them.
 *
 * Nothing here duplicates an admission or a provider code. A citation that did
 * not resolve is the gate's diagnostic (§3.3) and a degraded enrichment run is
 * the provider's (§5.3); this module only reports what *merging* observed.
 */
export const MERGE_DIAGNOSTIC_CODES = Object.freeze({
  /** An enrichment candidate whose id matches no baseline promise. Dropped. */
  enrichmentUncited: 'merge-enrichment-uncited',
  /** An axis overlay keyed to an id no promise in the graph has. Ignored. */
  overlayUnmatched: 'merge-overlay-unmatched',
  /** A promise ended with no designed test, so its verdict is `undesigned` (R5.5). */
  undesigned: 'merge-undesigned',
  /** The enrichment axis was discarded; the graph is baseline-only (R2.8). */
  degraded: 'merge-degraded',
} as const);

/** Every code above, for tests and for the Ledger's filter list. */
export const MERGE_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(MERGE_DIAGNOSTIC_CODES),
);

/** {@link mergeGraph}'s input. */
export interface MergeRequest {
  /**
   * The baseline result. `BaselineResult` types `ok` as the literal `true` and
   * `degradedReason` as the literal `null` (§5.2, R2.4), so a baseline that
   * degraded the graph is unrepresentable — which is why rule 5 reads the flag
   * from enrichment alone and this field is the general result type.
   */
  readonly baseline: ProviderResult;
  /**
   * The enrichment result, or null/omitted when no enrichment axis was attempted
   * at all.
   *
   * Omitting it is **not** the R2.12 path. "Kane is absent" is an enrichment
   * result carrying `ok: false` and `kane-not-found`, because that is a fact about
   * a run and the ledger has to show it. Omitting it means the caller is building
   * a baseline-only graph deliberately — `buildBaselineOnlyGraph` (§5.5) — and
   * nothing was discarded, so nothing is degraded.
   */
  readonly enrichment?: ProviderResult | null | undefined;
  /**
   * Cited-document reads for the gate. Should be the **same instance** the
   * baseline provider used, so the admitted citation text and the derived claim
   * came from the same bytes (§5.2).
   */
  readonly citations?: CitationSource | undefined;
  /** Used to build a `nodeCitationSource` when `citations` is omitted. */
  readonly repoRoot?: string | undefined;
  /** Where the merge's own observations are recorded. */
  readonly diagnostics?: DiagnosticSink | undefined;
  /** Edges to carry onto the graph. Sorted and deduplicated by the constructor. */
  readonly edges?: readonly GraphEdge[] | undefined;
}

/** What {@link mergeGraph} did. */
export interface MergeResult {
  /** The canonical graph: sorted, degraded flag set, diagnostics concatenated. */
  readonly graph: PromiseGraph;
  /** The gate's own answer over baseline candidates, for callers that want it. */
  readonly batch: AdmissionBatch;
  /** Promise ids an enrichment candidate contributed a field to, sorted. */
  readonly mergedIds: readonly string[];
  /** Promise ids an axis overlay was applied to, sorted. */
  readonly overlaidIds: readonly string[];
  /** Overlay keys matching no promise in the graph, sorted. */
  readonly unmatchedOverlayIds: readonly string[];
  /** Enrichment candidates dropped for having no baseline promise, in input order. */
  readonly uncitedEnrichmentClaims: readonly string[];
  /** Promise ids that ended with no designed test, so are `undesigned`, sorted. */
  readonly undesignedIds: readonly string[];
  /** Mirrors `graph.degraded`. `!enrichment.ok`, and nothing else (§5.4 step 5). */
  readonly degraded: boolean;
  /** Mirrors `graph.degradedReasons`. */
  readonly degradedReasons: readonly string[];
  /** Only what the merge itself recorded, in report order. */
  readonly diagnostics: readonly Diagnostic[];
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

/** The id a candidate will derive, without minting a record for it. */
function candidateId(candidate: PromiseCandidate): string | null {
  const citation = candidate.citation;
  if (citation === null) return null;
  return promiseId(toPosix(citation.file), candidate.claim);
}

function sortedUnique(ids: Iterable<string>): readonly string[] {
  return [...new Set(ids)].sort();
}

/**
 * What the merge decided for one promise, before the record is rebuilt. Held as
 * a mutable draft so that steps 2, 3 and 4 can each contribute without three
 * intermediate `PromiseRecord` allocations — and so that the *order* of those
 * steps, which is load-bearing, is visible as three assignments in one place.
 */
interface Draft {
  readonly base: PromiseRecord;
  designedTest: DesignedTest | null;
  verdict: Verdict;
  verdictSource: PromiseRecord['verdictSource'];
  repair: PromiseRecord['repair'];
  evidencePackId: string | null;
  credits: number | null;
  providers: Set<ProviderName>;
}

/**
 * Merge the two providers into one canonical graph (design §5.4).
 *
 * Never throws for any provider result. The only exception reachable from here is
 * `createPromiseRecord`'s `TypeError` on an empty provider list, and that cannot
 * happen: every draft starts from an admitted record whose `providers` is already
 * non-empty, and this function only ever adds to that set.
 */
export function mergeGraph(request: MergeRequest): MergeResult {
  const sink = request.diagnostics ?? createDiagnosticSink();
  const diagnostics: Diagnostic[] = [];
  const report = recording(sink, diagnostics);

  const enrichment = request.enrichment ?? null;
  // Rule 5, decided up front so the gate can attach it to the graph it builds and
  // the flag is never computed twice.
  const degraded = enrichment !== null && !enrichment.ok;
  const degradedReasons: readonly string[] =
    enrichment !== null && enrichment.degradedReason !== null
      ? [enrichment.degradedReason]
      : [];

  // ── Rule 1. Baseline is the sole citation authority. ──────────────────────
  const batch = admitPromises({
    candidates: request.baseline.candidates,
    ...(request.citations === undefined ? {} : { source: request.citations }),
    ...(request.repoRoot === undefined ? {} : { repoRoot: request.repoRoot }),
    diagnostics: sink,
    degraded,
    degradedReasons,
  });

  const drafts = new Map<string, Draft>();
  for (const promise of batch.admitted) {
    drafts.set(promise.id, {
      base: promise,
      designedTest: promise.designedTest,
      verdict: promise.verdict,
      verdictSource: promise.verdictSource,
      repair: promise.repair,
      evidencePackId: promise.evidencePackId,
      credits: promise.credits,
      providers: new Set<ProviderName>(promise.providers),
    });
  }

  // ── Rule 2. Union by id; enrichment wins the assurance axes only. ─────────
  const mergedIds: string[] = [];
  const uncitedEnrichmentClaims: string[] = [];
  const enrichmentCandidates = enrichment?.candidates ?? [];
  for (const candidate of enrichmentCandidates) {
    const id = candidateId(candidate);
    const draft = id === null ? undefined : drafts.get(id);
    if (draft === undefined) {
      uncitedEnrichmentClaims.push(candidate.claim);
      report.report({
        code: MERGE_DIAGNOSTIC_CODES.enrichmentUncited,
        severity: 'warn',
        message:
          `The ${candidate.provider} provider supplied a claim that matches no baseline ` +
          `promise, and baseline is the only citation authority, so it was not admitted: ` +
          `"${clip(candidate.claim)}".`,
        file: candidate.citation === null ? null : toPosix(candidate.citation.file),
        line: candidate.citation?.line ?? null,
      });
      continue;
    }
    // `citation` and `claim` are never read off the candidate. That is rule 2's
    // whole content, and it is enforced by there being no assignment for them.
    if (candidate.designedTest !== undefined) draft.designedTest = candidate.designedTest;
    if (candidate.verdict !== undefined) draft.verdict = candidate.verdict;
    if (candidate.verdictSource !== undefined) draft.verdictSource = candidate.verdictSource;
    if (candidate.repair !== undefined) draft.repair = candidate.repair;
    if (candidate.evidencePackId !== undefined) draft.evidencePackId = candidate.evidencePackId;
    if (candidate.credits !== undefined) draft.credits = candidate.credits;
    draft.providers.add(candidate.provider);
    mergedIds.push(draft.base.id);
  }

  // ── Rule 3. Axis overlays. ────────────────────────────────────────────────
  const overlaidIds: string[] = [];
  const unmatchedOverlayIds: string[] = [];
  const axes = enrichment?.axes;
  if (axes !== undefined) {
    for (const [id, overlay] of axes) {
      const draft = drafts.get(id);
      if (draft === undefined) {
        unmatchedOverlayIds.push(id);
        report.report({
          code: MERGE_DIAGNOSTIC_CODES.overlayUnmatched,
          severity: 'info',
          message:
            `The ${enrichment?.provider ?? 'enrichment'} provider supplied an axis overlay for ` +
            `promise '${id}', which is not in the graph, so it was ignored.`,
          file: null,
        });
        continue;
      }
      applyOverlay(draft, overlay);
      // The overlay is a fact this provider contributed about the promise, so it
      // joins the provider list — provenance is what `providers` is for.
      if (enrichment !== null) draft.providers.add(enrichment.provider);
      overlaidIds.push(id);
    }
  }

  // ── Rule 4. No designed test ⇒ undesigned (R5.5). ─────────────────────────
  const undesignedIds: string[] = [];
  const promises: PromiseRecord[] = [];
  for (const draft of drafts.values()) {
    if (draft.designedTest === null) {
      undesignedIds.push(draft.base.id);
      if (draft.verdict !== 'undesigned') {
        report.report({
          code: MERGE_DIAGNOSTIC_CODES.undesigned,
          severity: 'info',
          message:
            `Promise '${draft.base.id}' has no designed test, so its verdict is 'undesigned' ` +
            `rather than '${draft.verdict}' (R5.5).`,
          file: draft.base.citation.file,
          line: draft.base.citation.line,
        });
      }
      draft.verdict = 'undesigned';
    }
    promises.push(
      createPromiseRecord({
        // Baseline's claim and citation, in every case. The record factory
        // re-derives the id from exactly these two, so a merged promise keeps the
        // identity the gate admitted (R1.2).
        claim: draft.base.claim,
        citation: draft.base.citation,
        designedTest: draft.designedTest,
        verdict: draft.verdict,
        verdictSource: draft.verdictSource,
        repair: draft.repair,
        evidencePackId: draft.evidencePackId,
        providers: [...draft.providers],
        credits: draft.credits,
      }),
    );
  }

  if (degraded) {
    report.report({
      code: MERGE_DIAGNOSTIC_CODES.degraded,
      severity: 'warn',
      message:
        `The enrichment axis was discarded (${
          degradedReasons[0] ?? 'no reason given'
        }), so this graph carries baseline data only: every promise, citation and designed-test ` +
        `binding is present and the proven figure is withheld rather than reported as zero ` +
        `(R2.8, R2.11).`,
      file: null,
    });
  }

  // ── Rule 6. Canonical order, established by the constructor. ──────────────
  const graph = createPromiseGraph({
    promises,
    edges: request.edges ?? [],
    degraded,
    degradedReasons,
    // §5.4 step 2: concatenated, in provider order, gate before merge — which is
    // the order they happened.
    diagnostics: [
      ...request.baseline.diagnostics,
      ...(enrichment?.diagnostics ?? []),
      ...batch.graph.diagnostics,
      ...diagnostics,
    ],
  });

  return {
    graph,
    batch,
    mergedIds: sortedUnique(mergedIds),
    overlaidIds: sortedUnique(overlaidIds),
    unmatchedOverlayIds: sortedUnique(unmatchedOverlayIds),
    uncitedEnrichmentClaims,
    undesignedIds: sortedUnique(undesignedIds),
    degraded,
    degradedReasons,
    diagnostics,
  };
}

/**
 * Apply one overlay (§5.1, §5.4 step 3).
 *
 * Only keys that are **present** are written. A missing key means "leave whatever
 * baseline had" and never "clear it", which is what stops a coverage payload that
 * omitted a test from silently un-designing it.
 */
function applyOverlay(draft: Draft, overlay: ProviderAxisOverlay): void {
  if (overlay.designedTest !== undefined) draft.designedTest = overlay.designedTest;
  if (overlay.verdict !== undefined) draft.verdict = overlay.verdict;
  if (overlay.evidencePackId !== undefined) draft.evidencePackId = overlay.evidencePackId;
}

function clip(text: string, limit = 80): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length <= limit ? single : `${single.slice(0, limit - 1)}…`;
}
