/**
 * The promise model (design §3.1, R1.1, R1.6).
 *
 * This and the snapshot schema of §9.1 are the two data contracts of the system;
 * everything else is a function between them. Every type here is serialised into
 * `ledger.snapshot.json` and read back, so two rules govern the file:
 *
 * **1. Plain JSON, no branding.** §9.1 requires `parse(serialise(x))` to
 * deep-equal `x`. A phantom brand would type a parsed value as carrying a
 * property that does not exist at runtime — a lie in the one file a judge reads
 * to check the ledger is real. So `PromiseRecord` and `PromiseGraph` are
 * structural, exactly as `Diagnostic` is, and for the same reason. Shape is
 * guaranteed at the construction site ({@link createPromiseRecord},
 * {@link createPromiseGraph}) and re-established at the process edge by the
 * structural guards at the bottom of this file. (`FamilyContract` is branded
 * because contracts are runtime-only and never serialised; that argument does
 * not transfer here.)
 *
 * **2. Explicit `null`, never `undefined`.** `designedTest`, `verdictSource`,
 * `repair`, `evidencePackId` and `credits` are all "absent" states, and
 * `JSON.stringify` *drops* a key whose value is `undefined` while it *keeps* a
 * key whose value is `null`. An undefined `designedTest` would therefore change
 * the shape of the snapshot silently: the schema of §9.1 would reject the file,
 * or worse, a reader would treat a missing key as a different state from an
 * explicit null. So the fields are declared non-optional with `| null`, the
 * factory writes the null itself, and {@link isPromiseRecord} rejects a record
 * whose `designedTest` key is missing or `undefined` rather than coercing it.
 *
 * `RepairBranch` and `ProviderName` are declared here rather than in
 * `verdict/router.ts` and `providers/adapter.ts` because `RepairAnnotation` and
 * `PromiseRecord` need them and the model is the lower layer; those modules
 * should re-export from here rather than restate the unions.
 */

import type { Diagnostic } from '../diagnostics.js';
import { normaliseClaim, promiseId, toPosix } from './ids.js';

/** The four verdict values, and no others (R1.6). */
export type Verdict = 'proven' | 'red' | 'undesigned' | 'stale';

/**
 * The verdict vocabulary. Exactly four members; R1.6 says "and no others", so
 * tests enumerate this rather than hand-listing literals.
 */
export const VERDICTS: readonly Verdict[] = Object.freeze([
  'proven',
  'red',
  'undesigned',
  'stale',
]);

/** The three repair branches (design §11, R6.1). */
export type RepairBranch = 'code-break' | 'test-drift' | 'docs-lie';

/** The repair-branch vocabulary. */
export const REPAIR_BRANCHES: readonly RepairBranch[] = Object.freeze([
  'code-break',
  'test-drift',
  'docs-lie',
]);

/** The two verdict-router implementations (design §11.1, R6.2). */
export type RepairStrategy = 'resultCode740' | 'failureYamlTriage';

/** The strategy vocabulary. */
export const REPAIR_STRATEGIES: readonly RepairStrategy[] = Object.freeze([
  'resultCode740',
  'failureYamlTriage',
]);

/** Which provider supplied or enriched a promise (design §5.1). */
export type ProviderName = 'baseline' | 'enrichment';

/** The provider vocabulary, baseline first — the order merges prefer (§5.4). */
export const PROVIDER_NAMES: readonly ProviderName[] = Object.freeze(['baseline', 'enrichment']);

/** Edge kinds in the promise graph (design §3.1). */
export type GraphEdgeKind = 'cites' | 'designed' | 'evidence';

/** The edge-kind vocabulary, in sort order. */
export const GRAPH_EDGE_KINDS: readonly GraphEdgeKind[] = Object.freeze([
  'cites',
  'designed',
  'evidence',
]);

/** Where a promise is claimed (design §3.1, R1.3). */
export interface Citation {
  /** Repository-relative, POSIX separators, never absolute. */
  readonly file: string;
  /**
   * One-based. Carried for display and for the amendment path, and deliberately
   * **not** part of the promise id — see `ids.ts`.
   */
  readonly line: number;
  /** Verbatim content of that line, as read from disk (§3.3 overwrites it). */
  readonly text: string;
}

/** The `*_test.md` that verifies a promise (design §3.1, §3.4). */
export interface DesignedTest {
  /** Repository-relative path of the `*_test.md` that verifies the promise. */
  readonly path: string;
  /** Kane assurance-graph id, e.g. "T-3". Null until a `testrun_plan` supplies it. */
  readonly testId: string | null;
}

/**
 * Provenance of the current verdict (design §9.1). Null for a promise no run has
 * ever touched — which is exactly the state the write guard of §4.8 preserves
 * when a stream crashes, pauses or times out.
 */
export interface VerdictSource {
  /** Kane's `run_id`, or the synthetic id of the invocation that produced it. */
  readonly runId: string;
  /** The terminal event this verdict came from: `run_end`, `testrun_done`, `done`. */
  readonly terminalEventType: string;
  /** ISO 8601 instant. A string, never a `Date` — §9.1 round-trips through JSON. */
  readonly at: string;
  /**
   * The member status for a testrun verdict, null for other families. Kept
   * verbatim so a `broken` or `interrupted` member stays distinguishable from an
   * asserted failure even though both map to a verdict (R4.9).
   */
  readonly memberStatus: 'passed' | 'failed' | 'broken' | 'interrupted' | null;
  /** The coerced result code, already through `resultCode()` (design §4.4). */
  readonly resultCode: number | null;
  readonly reasonCode: string | null;
}

/** Why a red promise is red, and what may be done about it (design §3.1, §11). */
export interface RepairAnnotation {
  readonly branch: RepairBranch;
  readonly strategy: RepairStrategy;
  readonly severity: string | null;
  readonly category: string | null;
  readonly confidence: number | null;
  /** Repo-relative path into a committed pack, or null. */
  readonly evidenceRef: string | null;
  readonly rationale: string;
}

/** One promise: a claim, where it is claimed, what verifies it, and its state. */
export interface PromiseRecord {
  /** `"p_"` + 12 hex. Derived from citation file plus normalised claim only. */
  readonly id: string;
  /** Normalised claim text (`normaliseClaim`), which is also half the id key. */
  readonly claim: string;
  readonly citation: Citation;
  /** Explicit null, never undefined — see the file header. */
  readonly designedTest: DesignedTest | null;
  readonly verdict: Verdict;
  readonly verdictSource: VerdictSource | null;
  readonly repair: RepairAnnotation | null;
  readonly evidencePackId: string | null;
  /** Non-empty: a promise nobody supplied cannot exist (§9.1). */
  readonly providers: readonly ProviderName[];
  /** Credits attributed to the newest run for this promise. */
  readonly credits: number | null;
}

/** An edge between two prefixed node ids (design §3.1). */
export interface GraphEdge {
  /** Node id: `d_`, `p_`, `t_` or `ev_` prefixed. */
  readonly from: string;
  readonly to: string;
  readonly kind: GraphEdgeKind;
}

/** The whole graph. Sorted, always — see {@link createPromiseGraph}. */
export interface PromiseGraph {
  /** Sorted by id, always. */
  readonly promises: readonly PromiseRecord[];
  /** Sorted by (kind, from, to), always. */
  readonly edges: readonly GraphEdge[];
  /** True when the enrichment axis was discarded (R2.8, R2.9, R2.12). */
  readonly degraded: boolean;
  readonly degradedReasons: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * What a caller supplies to build a promise. `id` is absent on purpose: it is
 * derived, so no call site can hand the graph an id that disagrees with the
 * citation and the claim it was supposedly keyed on.
 */
export interface PromiseRecordInput {
  /** Raw or already-normalised claim text; normalised here either way. */
  readonly claim: string;
  readonly citation: Citation;
  readonly designedTest?: DesignedTest | null;
  readonly verdict?: Verdict;
  readonly verdictSource?: VerdictSource | null;
  readonly repair?: RepairAnnotation | null;
  readonly evidencePackId?: string | null;
  /** Required and non-empty: every promise names who supplied it. */
  readonly providers: readonly ProviderName[];
  readonly credits?: number | null;
}

/** Deduplicate provider names, keeping the canonical baseline-then-enrichment order. */
function normaliseProviders(providers: readonly ProviderName[]): readonly ProviderName[] {
  return PROVIDER_NAMES.filter((name) => providers.includes(name));
}

/**
 * Build a promise record.
 *
 * The single construction site for a promise, which is what makes the two file
 * rules structural rather than remembered: the id is always derived by
 * {@link promiseId}, the claim is always normalised, the citation path is always
 * POSIX, and every absent field is written as an explicit `null` so the record
 * survives `JSON.stringify` with its shape intact.
 *
 * The default verdict is `undesigned` when there is no designed test (R5.5), and
 * `stale` when there is one but no run has reported on it — "designed but not
 * backed by evidence" is precisely what stale means, and both defaults sit
 * outside `proven`/`red`, so a record can never claim proof or a failure it has
 * no verdict source for. Callers with a real verdict pass it explicitly.
 *
 * Throws `TypeError` on an empty `providers` list, which is a programming error
 * rather than a state of the world: the supplying provider is always known at
 * the call site (design §14.2 reserves exceptions for exactly this).
 */
export function createPromiseRecord(input: PromiseRecordInput): PromiseRecord {
  const providers = normaliseProviders(input.providers);
  if (providers.length === 0) {
    throw new TypeError('PromiseRecord requires at least one supplying provider');
  }
  const designedTest = input.designedTest ?? null;
  const claim = normaliseClaim(input.claim);
  const file = toPosix(input.citation.file);
  return {
    id: promiseId(file, input.claim),
    claim,
    citation: { file, line: input.citation.line, text: input.citation.text },
    designedTest,
    verdict: input.verdict ?? (designedTest === null ? 'undesigned' : 'stale'),
    verdictSource: input.verdictSource ?? null,
    repair: input.repair ?? null,
    evidencePackId: input.evidencePackId ?? null,
    providers,
    credits: input.credits ?? null,
  };
}

/** Sort promises by id. Total and stable: ids are unique per promise. */
export function comparePromiseRecords(left: PromiseRecord, right: PromiseRecord): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** Sort edges by (kind, from, to), the order design §3.1 fixes. */
export function compareGraphEdges(left: GraphEdge, right: GraphEdge): number {
  const byKind = GRAPH_EDGE_KINDS.indexOf(left.kind) - GRAPH_EDGE_KINDS.indexOf(right.kind);
  if (byKind !== 0) return byKind;
  if (left.from !== right.from) return left.from < right.from ? -1 : 1;
  if (left.to !== right.to) return left.to < right.to ? -1 : 1;
  return 0;
}

/** What a caller supplies to build a graph. Ordering is not one of them. */
export interface PromiseGraphInput {
  readonly promises?: readonly PromiseRecord[];
  readonly edges?: readonly GraphEdge[];
  readonly degraded?: boolean;
  readonly degradedReasons?: readonly string[];
  readonly diagnostics?: readonly Diagnostic[];
}

/**
 * Build a graph, sorted.
 *
 * `promises` sorted by id and `edges` sorted by (kind, from, to) is stated as an
 * always-true property of the type in design §3.1, so it is established here at
 * construction rather than left to the canonical serialiser (task 3.14), which
 * then only has to worry about key order and byte formatting. Sorting here also
 * means two builds that discovered the same promises in a different order
 * produce an identical graph — the graph-level companion to the id stability
 * rule, and what keeps a committed snapshot's diff empty when nothing changed.
 *
 * Exactly duplicate edges are collapsed. A claim discovered by both providers,
 * or a promise cited twice from the same document, would otherwise carry the
 * same `(from, to, kind)` triple twice and render as a double line in the
 * Ledger; the second copy conveys nothing the first does not.
 */
export function createPromiseGraph(input: PromiseGraphInput = {}): PromiseGraph {
  const promises = [...(input.promises ?? [])].sort(comparePromiseRecords);
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const edge of input.edges ?? []) {
    const key = `${edge.kind}\u0000${edge.from}\u0000${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from: edge.from, to: edge.to, kind: edge.kind });
  }
  edges.sort(compareGraphEdges);
  return {
    promises,
    edges,
    degraded: input.degraded ?? false,
    degradedReasons: [...(input.degradedReasons ?? [])],
    diagnostics: [...(input.diagnostics ?? [])],
  };
}

/** Boundary guard for a verdict read back from JSON (R1.6). */
export function isVerdict(value: unknown): value is Verdict {
  return typeof value === 'string' && (VERDICTS as readonly string[]).includes(value);
}

/** Boundary guard for a repair branch. */
export function isRepairBranch(value: unknown): value is RepairBranch {
  return typeof value === 'string' && (REPAIR_BRANCHES as readonly string[]).includes(value);
}

/** Boundary guard for a router strategy name. */
export function isRepairStrategy(value: unknown): value is RepairStrategy {
  return typeof value === 'string' && (REPAIR_STRATEGIES as readonly string[]).includes(value);
}

/** Boundary guard for a provider name. */
export function isProviderName(value: unknown): value is ProviderName {
  return typeof value === 'string' && (PROVIDER_NAMES as readonly string[]).includes(value);
}

/** Boundary guard for an edge kind. */
export function isGraphEdgeKind(value: unknown): value is GraphEdgeKind {
  return typeof value === 'string' && (GRAPH_EDGE_KINDS as readonly string[]).includes(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Whether a key is present *and* not `undefined`. This is the runtime half of
 * "explicit null, never undefined": a record whose `designedTest` key was
 * dropped by `JSON.stringify` fails here instead of being read as null.
 */
function hasExplicitKey(record: Record<string, unknown>, key: string): boolean {
  return key in record && record[key] !== undefined;
}

/** Boundary guard for a citation: repo-relative POSIX path, one-based line. */
export function isCitation(value: unknown): value is Citation {
  const candidate = asRecord(value);
  if (candidate === null) return false;
  const file = candidate['file'];
  if (typeof file !== 'string' || file.length === 0 || file.includes('\\')) return false;
  const line = candidate['line'];
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) return false;
  return typeof candidate['text'] === 'string';
}

/** Boundary guard for a designed-test reference. */
export function isDesignedTest(value: unknown): value is DesignedTest {
  const candidate = asRecord(value);
  if (candidate === null) return false;
  if (typeof candidate['path'] !== 'string' || candidate['path'].length === 0) return false;
  if (!hasExplicitKey(candidate, 'testId')) return false;
  const testId = candidate['testId'];
  return testId === null || typeof testId === 'string';
}

/** Boundary guard for verdict provenance. */
export function isVerdictSource(value: unknown): value is VerdictSource {
  const candidate = asRecord(value);
  if (candidate === null) return false;
  if (typeof candidate['runId'] !== 'string') return false;
  if (typeof candidate['terminalEventType'] !== 'string') return false;
  if (typeof candidate['at'] !== 'string' || Number.isNaN(Date.parse(candidate['at']))) return false;
  if (!hasExplicitKey(candidate, 'memberStatus')) return false;
  const memberStatus = candidate['memberStatus'];
  if (
    memberStatus !== null &&
    !(
      typeof memberStatus === 'string' &&
      ['passed', 'failed', 'broken', 'interrupted'].includes(memberStatus)
    )
  ) {
    return false;
  }
  if (!hasExplicitKey(candidate, 'resultCode')) return false;
  const code = candidate['resultCode'];
  if (code !== null && typeof code !== 'number') return false;
  if (!hasExplicitKey(candidate, 'reasonCode')) return false;
  const reason = candidate['reasonCode'];
  return reason === null || typeof reason === 'string';
}

/** Boundary guard for a repair annotation. */
export function isRepairAnnotation(value: unknown): value is RepairAnnotation {
  const candidate = asRecord(value);
  if (candidate === null) return false;
  if (!isRepairBranch(candidate['branch'])) return false;
  if (!isRepairStrategy(candidate['strategy'])) return false;
  for (const key of ['severity', 'category', 'evidenceRef'] as const) {
    if (!hasExplicitKey(candidate, key)) return false;
    const held = candidate[key];
    if (held !== null && typeof held !== 'string') return false;
  }
  if (!hasExplicitKey(candidate, 'confidence')) return false;
  const confidence = candidate['confidence'];
  if (confidence !== null && typeof confidence !== 'number') return false;
  return typeof candidate['rationale'] === 'string';
}

/**
 * Boundary guard for a promise record — the shape check at the process edge that
 * type-level guarantees stop short of. Rejects a missing or `undefined`
 * `designedTest`, `verdictSource`, `repair`, `evidencePackId` or `credits`
 * rather than defaulting it, because a dropped key means the file being read was
 * not written by the canonical serialiser and its other fields are not to be
 * trusted either.
 *
 * It checks the id's *form*, not its derivation. Re-deriving here would require
 * the raw cited line, which the snapshot does not carry once §3.3 has overwritten
 * `citation.text`; the id/claim agreement is asserted by Property 1 at the point
 * where both are known.
 */
export function isPromiseRecord(value: unknown): value is PromiseRecord {
  const candidate = asRecord(value);
  if (candidate === null) return false;
  const id = candidate['id'];
  if (typeof id !== 'string' || !/^p_[0-9a-f]{12}$/.test(id)) return false;
  if (typeof candidate['claim'] !== 'string') return false;
  if (!isCitation(candidate['citation'])) return false;

  if (!hasExplicitKey(candidate, 'designedTest')) return false;
  const designedTest = candidate['designedTest'];
  if (designedTest !== null && !isDesignedTest(designedTest)) return false;

  if (!isVerdict(candidate['verdict'])) return false;

  if (!hasExplicitKey(candidate, 'verdictSource')) return false;
  const verdictSource = candidate['verdictSource'];
  if (verdictSource !== null && !isVerdictSource(verdictSource)) return false;

  if (!hasExplicitKey(candidate, 'repair')) return false;
  const repair = candidate['repair'];
  if (repair !== null && !isRepairAnnotation(repair)) return false;

  if (!hasExplicitKey(candidate, 'evidencePackId')) return false;
  const packId = candidate['evidencePackId'];
  if (packId !== null && typeof packId !== 'string') return false;

  const providers = candidate['providers'];
  if (!Array.isArray(providers) || providers.length === 0) return false;
  if (!providers.every((name) => isProviderName(name))) return false;

  if (!hasExplicitKey(candidate, 'credits')) return false;
  const credits = candidate['credits'];
  return credits === null || typeof credits === 'number';
}

/** Boundary guard for an edge. */
export function isGraphEdge(value: unknown): value is GraphEdge {
  const candidate = asRecord(value);
  if (candidate === null) return false;
  if (typeof candidate['from'] !== 'string' || candidate['from'].length === 0) return false;
  if (typeof candidate['to'] !== 'string' || candidate['to'].length === 0) return false;
  return isGraphEdgeKind(candidate['kind']);
}

/**
 * Boundary guard for a whole graph, sort order included. The zod schema of task
 * 3.13 is the authority for a snapshot read off disk; this is the cheap
 * structural check the model itself can offer, and it is what the round-trip
 * test asserts against.
 */
export function isPromiseGraph(value: unknown): value is PromiseGraph {
  const candidate = asRecord(value);
  if (candidate === null) return false;
  const promises = candidate['promises'];
  if (!Array.isArray(promises) || !promises.every((entry) => isPromiseRecord(entry))) return false;
  const edges = candidate['edges'];
  if (!Array.isArray(edges) || !edges.every((entry) => isGraphEdge(entry))) return false;
  if (typeof candidate['degraded'] !== 'boolean') return false;
  const reasons = candidate['degradedReasons'];
  if (!Array.isArray(reasons) || !reasons.every((entry) => typeof entry === 'string')) return false;
  const diagnostics = candidate['diagnostics'];
  if (!Array.isArray(diagnostics)) return false;
  // Sorted, always (design §3.1).
  const sortedPromises = [...(promises as PromiseRecord[])].sort(comparePromiseRecords);
  if (sortedPromises.some((entry, index) => entry !== promises[index])) return false;
  const sortedEdges = [...(edges as GraphEdge[])].sort(compareGraphEdges);
  return !sortedEdges.some((entry, index) => entry !== edges[index]);
}
