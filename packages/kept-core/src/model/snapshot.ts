/**
 * The ledger snapshot schema — the CLI↔UI contract (design §9.1, R8.8).
 *
 * `apps/ledger/data/ledger.snapshot.json` is the single file that carries the
 * promise graph from the CLI to the deployed Ledger. It is committed, so the
 * deployed build needs no Kane, no Chrome, no credentials and no network
 * (design §9.3, R13.4). Everything a judge sees is a projection of this file.
 *
 * Three rules govern this module.
 *
 * **1. The schema is the authority, not the model's structural guards.**
 * `isPromiseGraph` (model/promise.ts) is a cheap in-process shape check;
 * {@link LedgerSnapshotSchema} is what a snapshot read off disk must satisfy.
 * R8.8 requires the Ledger build to *fail* with a diagnostic naming the invalid
 * field, so the schema is deliberately strict: unknown keys are an error, not
 * silently stripped, because an unknown key means the file was written by
 * something other than `kept snapshot` and its other fields are not to be
 * trusted either.
 *
 * **2. Explicit `null`, never `undefined`.** Every "absent" field is declared
 * `.nullable()` and never `.optional()`. In zod that distinction is exactly the
 * one this project needs: `.nullable()` still *requires the key to be present*,
 * so a record whose `designedTest` key was dropped by `JSON.stringify` (which
 * drops `undefined` values and keeps `null` ones) fails validation instead of
 * being read as a different state. This mirrors `isPromiseRecord`'s
 * `hasExplicitKey` check, and it is what makes the round-trip guarantee of §9.2
 * load-bearing rather than decorative.
 *
 * **3. Timestamps are strings.** No `Date` appears anywhere in the schema, so a
 * `Date` that leaked into a snapshot structure fails at the field rather than
 * silently becoming an ISO string on the way out and a string-not-Date on the
 * way back in. `serialiseSnapshot` (model/canonical.ts) rejects a `Date` value
 * outright, which is the other half of the same guarantee.
 *
 * Vocabularies are imported, never restated: `EXIT_MEANINGS`, `ARTIFACT_KINDS`,
 * `MEMBER_END_STATUSES`, `COMMAND_FAMILIES`, `VERDICTS`, `REPAIR_BRANCHES`,
 * `REPAIR_STRATEGIES`, `PROVIDER_NAMES`, `GRAPH_EDGE_KINDS` and
 * `DIAGNOSTIC_SEVERITIES` all live in one place each. A snapshot that
 * enumerated its own copy of the eight exit meanings would be a second
 * authority waiting to disagree with the first.
 */

import { z } from 'zod';

import { DIAGNOSTIC_SEVERITIES } from '../diagnostics.js';
import { MEMBER_END_STATUSES } from '../kane/events.js';
import { EXIT_MEANINGS } from '../kane/exit.js';
import { COMMAND_FAMILIES, contractFor } from '../kane/family.js';
/* `kane/vocabulary.js`, not `kane/evidence.js` and `kane/packTriage.js`, and the
   indirection is load-bearing rather than tidy: both of those modules walk
   directories, and this schema is what `apps/ledger` reaches through `parseSnapshot`.
   Importing the constants from their old homes put a filesystem walker in the
   read-only deployed bundle and produced four tracing warnings on every build. The
   vocabulary is still declared exactly once. See `kane/vocabulary.ts`. */
import { ARTIFACT_KINDS, SEALED_PACK_SUFFIX } from '../kane/vocabulary.js';
import { designedTestId, evidenceId, isNodeId } from './ids.js';
import {
  GRAPH_EDGE_KINDS,
  PROVIDER_NAMES,
  REPAIR_BRANCHES,
  REPAIR_STRATEGIES,
  VERDICTS,
} from './promise.js';

/** The only schema version this build reads or writes (design §9.1). */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/** `runs` is capped so the committed file stays reviewable (design §9.1). */
export const MAX_SNAPSHOT_RUNS = 20;

/**
 * The three terminal event types, derived from the contract table rather than
 * restated, so a fourth family could never be added without this union moving
 * with it (design §4.1).
 */
export const TERMINAL_EVENT_TYPES = Object.freeze(
  COMMAND_FAMILIES.map((family) => contractFor(family).terminalType),
);

/** What kind of Kane invocation an evidence pack came from (design §9.1). */
export const EVIDENCE_KINDS = Object.freeze(['run', 'testrun'] as const);

/** Review-card kinds (design §8.2). */
export const REVIEW_CARD_KINDS = Object.freeze(['test-drift', 'reconcile'] as const);

/** Review-card lifecycle (design §8.2). Never applied, only open or dismissed. */
export const REVIEW_CARD_STATUSES = Object.freeze(['open', 'dismissed'] as const);

/** Amendment lifecycle (design §8.3, §8.4). `stale` is the sha256 interlock. */
export const AMENDMENT_STATUSES = Object.freeze([
  'pending',
  'accepted',
  'rejected',
  'stale',
] as const);

// ---------------------------------------------------------------------------
// Leaf schemas
// ---------------------------------------------------------------------------

/**
 * An ISO 8601 instant, as a string.
 *
 * Deliberately validated by `Date.parse` rather than by `z.iso.datetime()`.
 * `at` values arrive from Kane's own wire output as well as from KEPT's clock,
 * and zod's ISO check rejects legitimate 8601 spellings (a `+05:00` offset, a
 * space separator) that `Date.parse` accepts. Rejecting a snapshot because Kane
 * spelled a timestamp differently would fail the Ledger build over a formatting
 * preference. The rule that actually matters here is "a string, and a real
 * instant" — which is what this checks. This is the same rule `isDiagnostic`
 * and `isVerdictSource` already apply, so the model and the schema agree.
 */
const isoTimestamp = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'expected an ISO 8601 timestamp string',
  });

/** `^p_[0-9a-f]{12}$` — the promise id rule of §9.1, enforced at the field. */
const promiseIdField = z.string().regex(/^p_[0-9a-f]{12}$/, {
  message: 'expected a promise id matching ^p_[0-9a-f]{12}$',
});

/** `^d_[0-9a-f]{12}$` — document node, graph lane 0. */
const documentIdField = z.string().regex(/^d_[0-9a-f]{12}$/, {
  message: 'expected a document id matching ^d_[0-9a-f]{12}$',
});

/**
 * `ev_` plus a path-safe stamp. Evidence ids are stamps, not hashes, because a
 * reviewer navigates the committed tree by them (`ids.ts`, design §9.1).
 */
const evidenceIdField = z.string().regex(/^ev_[A-Za-z0-9._-]+$/, {
  message: 'expected an evidence id matching ^ev_[A-Za-z0-9._-]+$',
});

/**
 * A static URL under `/evidence/`. The packs are committed to
 * `apps/ledger/public/evidence/`, so artefact links are plain static paths with
 * no route handler in front of them (design §9.3, R8.4). An absolute filesystem
 * path here would be the bug this rule exists to catch: `kane/evidence.ts`
 * returns absolute paths and the snapshot writer must rewrite them.
 */
const publicPathField = z.string().regex(/^\/evidence\/[^\\]*$/, {
  message: 'expected a public path under /evidence/ with POSIX separators',
});

/**
 * A repo-relative reference into a committed pack, e.g.
 * `evidence/ev_20260820T184011Z/failure.yaml`. Loose here on purpose — the
 * resolution rule below is what checks it names a pack the snapshot carries.
 */
const evidenceRefField = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('/') && !value.includes('\\'), {
    message: 'expected a repository-relative POSIX evidence reference',
  });

/** A repository-relative POSIX path. Never absolute, never backslashed. */
const repoRelativePath = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('/') && !value.includes('\\'), {
    message: 'expected a repository-relative POSIX path',
  });

const nonNegativeInt = z.number().int().min(0);

/** A coverage figure: a ratio in [0, 1], or null. Never a percentage. */
const coverageField = z.number().min(0).max(1).nullable();

// ---------------------------------------------------------------------------
// Component schemas
// ---------------------------------------------------------------------------

/** `Diagnostic` in exactly its wire shape (design §9.1, diagnostics.ts). */
export const SnapshotDiagnosticSchema = z.strictObject({
  code: z.string().min(1),
  severity: z.enum(DIAGNOSTIC_SEVERITIES),
  message: z.string().min(1),
  file: z.string().nullable(),
  line: z.number().int().min(1).nullable(),
  at: isoTimestamp,
});

/** Where a promise is claimed (R1.3): repo-relative path, one-based line. */
export const SnapshotCitationSchema = z.strictObject({
  file: repoRelativePath,
  line: z.number().int().min(1),
  text: z.string(),
});

/** The `*_test.md` that verifies a promise. `testId` is null until a plan runs. */
export const SnapshotDesignedTestSchema = z.strictObject({
  path: repoRelativePath,
  testId: z.string().min(1).nullable(),
});

/** Provenance of a verdict. Null for a promise no run has ever touched (§4.8). */
export const SnapshotVerdictSourceSchema = z.strictObject({
  runId: z.string().min(1),
  terminalEventType: z.string().min(1),
  at: isoTimestamp,
  memberStatus: z.enum(MEMBER_END_STATUSES).nullable(),
  resultCode: z.number().int().nullable(),
  reasonCode: z.string().nullable(),
});

/** Why a red promise is red, and what may be done about it (design §11). */
export const SnapshotRepairSchema = z.strictObject({
  branch: z.enum(REPAIR_BRANCHES),
  strategy: z.enum(REPAIR_STRATEGIES),
  severity: z.string().nullable(),
  category: z.string().nullable(),
  confidence: z.number().nullable(),
  evidenceRef: evidenceRefField.nullable(),
  rationale: z.string(),
});

/** One promise, as the Ledger renders it. */
export const SnapshotPromiseSchema = z.strictObject({
  id: promiseIdField,
  claim: z.string(),
  citation: SnapshotCitationSchema,
  designedTest: SnapshotDesignedTestSchema.nullable(),
  verdict: z.enum(VERDICTS),
  verdictSource: SnapshotVerdictSourceSchema.nullable(),
  repair: SnapshotRepairSchema.nullable(),
  evidencePackId: evidenceIdField.nullable(),
  /** Non-empty: a promise nobody supplied cannot exist (design §9.1). */
  providers: z.array(z.enum(PROVIDER_NAMES)).min(1),
  credits: z.number().min(0).nullable(),
});

/** An edge between two prefixed node ids. Endpoints are resolved below. */
export const SnapshotEdgeSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.enum(GRAPH_EDGE_KINDS),
});

/** Graph lane 0: one node per cited document. */
export const SnapshotDocumentSchema = z.strictObject({
  id: documentIdField,
  file: repoRelativePath,
  claimCount: nonNegativeInt,
});

/** One committed artefact inside a pack. Same vocabulary as `kane/evidence.ts`. */
export const SnapshotArtifactSchema = z.strictObject({
  kind: z.enum(ARTIFACT_KINDS),
  name: z.string().min(1),
  publicPath: publicPathField,
  bytes: nonNegativeInt.nullable(),
});

/** A sealed evidence pack: paths only, never the evidence (design §9.3). */
export const SnapshotEvidenceSchema = z.strictObject({
  id: evidenceIdField,
  /**
   * Kane's own name for the archive — a bare `execution_id` with a `.evidence`
   * suffix — beside the `ev_` node id KEPT mints from it.
   *
   * Both, because they answer different questions and conflating them cost this
   * project every evidence link it had. `id` has to match `^ev_[A-Za-z0-9._-]+$`
   * so the graph can lane a node by its prefix; Kane's name cannot satisfy that,
   * so a projection comparing raw pack ids against minted ones matched nothing and
   * dropped all of them silently. Keeping Kane's name means the snapshot still says
   * which archive a link came from rather than only what KEPT renamed it to.
   *
   * Nullable for a pack that reached the snapshot without one, and absent in
   * snapshots written before the field existed.
   */
  packId: z.string().min(1).nullable().optional(),
  kind: z.enum(EVIDENCE_KINDS),
  sealedAt: isoTimestamp.nullable(),
  publicPath: publicPathField,
  artifacts: z.array(SnapshotArtifactSchema),
});

/** The raw six-field verdict object, as the router settled it (design §9.1). */
export const SnapshotVerdictObjectSchema = z.strictObject({
  confirmed: z.boolean(),
  family: z.string().nullable(),
  category: z.string().nullable(),
  severity: z.string().nullable(),
  one_liner: z.string().nullable(),
  confidence: z.number().nullable(),
});

/** One member of a testrun, kept verbatim so `broken` stays distinguishable. */
export const SnapshotRunMemberSchema = z.strictObject({
  path: repoRelativePath,
  testId: z.string().min(1).nullable(),
  status: z.enum(MEMBER_END_STATUSES),
  verdict: z.enum(VERDICTS),
});

/**
 * One Kane invocation, as `/runs` renders it. Newest first, capped at 20.
 *
 * The three timing fields are nullable for the same reason `credits` is: a run
 * entry is projected from the persisted handoff (R11.7), and a handoff written
 * before the invoker's measurement was carried into it has no duration to report.
 * `/runs` renders that as `not reported`, never as `0 ms` — a zero is a figure a
 * run produced, and those runs produced none. `startedAt` is never *derived* from
 * `endedAt` minus a duration either: two of the three present and one null is a
 * more useful file than three fields where one is arithmetic dressed as a
 * measurement.
 */
export const SnapshotRunSchema = z.strictObject({
  id: z.string().min(1),
  family: z.enum(COMMAND_FAMILIES),
  command: z.string().min(1),
  startedAt: isoTimestamp.nullable(),
  endedAt: isoTimestamp.nullable(),
  durationMs: nonNegativeInt.nullable(),
  exitCode: z.number().int().nullable(),
  exitMeaning: z.enum(EXIT_MEANINGS),
  terminalSeen: z.boolean(),
  terminalEventType: z.string().min(1).nullable(),
  /** The terminal event's `status`, verbatim — Kane's vocabulary, not KEPT's. */
  status: z.string().nullable(),
  resultCode: z.number().int().nullable(),
  reasonCode: z.string().nullable(),
  credits: z.number().min(0).nullable(),
  verdictObject: SnapshotVerdictObjectSchema.nullable(),
  evidencePackId: evidenceIdField.nullable(),
  members: z.array(SnapshotRunMemberSchema),
  diagnostics: z.array(SnapshotDiagnosticSchema),
});

/** One proposed change on a review card. Never applied (R5.7, R7.2). */
export const SnapshotProposedChangeSchema = z.strictObject({
  file: repoRelativePath,
  summary: z.string().min(1),
  diff: z.string(),
});

/** A held change from `maintain reconcile` or `maintain evolve` (design §8.2). */
export const SnapshotReviewCardSchema = z.strictObject({
  id: z.string().regex(/^rc_[A-Za-z0-9._-]+$/, {
    message: 'expected a review-card id matching ^rc_[A-Za-z0-9._-]+$',
  }),
  createdAt: isoTimestamp,
  kind: z.enum(REVIEW_CARD_KINDS),
  promiseId: promiseIdField,
  branch: z.enum(REPAIR_BRANCHES),
  title: z.string().min(1),
  detail: z.string(),
  proposedChanges: z.array(SnapshotProposedChangeSchema),
  evidenceRef: evidenceRefField.nullable(),
  strategy: z.enum(REPAIR_STRATEGIES),
  status: z.enum(REVIEW_CARD_STATUSES),
});

/**
 * A proposed documentation edit (design §8.3). `expectedSha256` is the
 * staleness interlock: acceptance re-hashes the cited line and refuses to write
 * when it no longer matches, so an amendment can never silently overwrite an
 * edit made after it was proposed (design §8.4). Full 64-hex, because
 * `sha256Hex` returns the full digest and truncating an interlock weakens it.
 */
export const SnapshotAmendmentSchema = z.strictObject({
  id: z.string().regex(/^am_[0-9a-f]{8}$/, {
    message: 'expected an amendment id matching ^am_[0-9a-f]{8}$',
  }),
  createdAt: isoTimestamp,
  status: z.enum(AMENDMENT_STATUSES),
  promiseId: promiseIdField,
  citation: SnapshotCitationSchema,
  currentText: z.string(),
  proposedText: z.string(),
  expectedSha256: z.string().regex(/^[0-9a-f]{64}$/, {
    message: 'expected a lowercase 64-character sha256 digest',
  }),
  rationale: z.string(),
  evidenceRef: evidenceRefField.nullable(),
  /** Artefact label to public path. Sorted by key on the way out (§9.2). */
  artifacts: z.record(z.string().min(1), publicPathField),
  strategy: z.enum(REPAIR_STRATEGIES),
  appliedAt: isoTimestamp.nullable(),
});

/**
 * Freshness of the newest consumed terminal event (R9.6, R9.7). All three
 * fields move together — see the consistency rule below.
 */
export const SnapshotFreshnessSchema = z.strictObject({
  terminalEventAt: isoTimestamp.nullable(),
  terminalEventType: z.enum(TERMINAL_EVENT_TYPES).nullable(),
  commandFamily: z.enum(COMMAND_FAMILIES).nullable(),
});

/**
 * The metric rail (R5.8, R9.1–R9.3). Counts are integers over `promises`;
 * coverage figures are ratios in [0, 1] or null, never percentages — the badge
 * rounds to a whole-number percentage at render time (R9.4), not here, because
 * a rounded value in the file would make the count-agreement rule below
 * unenforceable.
 */
export const SnapshotMetricsSchema = z.strictObject({
  totalPromises: nonNegativeInt,
  designedCount: nonNegativeInt,
  provenCount: nonNegativeInt,
  redCount: nonNegativeInt,
  staleCount: nonNegativeInt,
  /** The suite debt: promises with no designed test (R5.8). */
  undesignedCount: nonNegativeInt,
  /** Null if and only if `totalPromises` is 0 — no division (R9.3). */
  designedCoverage: coverageField,
  /** Additionally null while `degraded` is true (R2.11). */
  provenCoverage: coverageField,
});

/* ── the Coverage_Axes (R9.10 through R9.15) ────────────────────────────────── */

/**
 * An `n/m` ratio, verbatim beside the pair it parses to (R9.10).
 *
 * `text` may be present with both numbers null: the string is what Kane said, and
 * refusing to carry it because this build could not parse it would lose information
 * for no gain. `denominator` is at least 1 when present, so nothing downstream can
 * reach a division by zero.
 */
export const SnapshotCoverageRatioSchema = z.strictObject({
  text: z.string().min(1).nullable(),
  numerator: nonNegativeInt.nullable(),
  denominator: z.number().int().min(1).nullable(),
});

/**
 * One axis of the ribbon: a whole-number percentage and its ratio.
 *
 * A **percentage** here, not a ratio in `[0, 1]`, unlike `metrics.designedCoverage`
 * and `metrics.provenCoverage`, which are ratios the badge rounds at render time.
 * The difference is deliberate and it is the point of R9.15: these two figures are
 * read verbatim out of Kane's payload and are not KEPT's own division, so storing
 * them in KEPT's units would mean converting a number this build did not compute.
 * `pct` is null when the payload carried nothing readable, never `0`.
 */
export const SnapshotCoverageAxisSchema = z.strictObject({
  pct: z.number().min(0).max(100).nullable(),
  ratio: SnapshotCoverageRatioSchema,
});

/**
 * The design-completeness axis, with the two figures that make it debt.
 *
 * `usecasesComplete` reads `1/9` on this repository and `ucsNeedingScenarios` reads
 * `8`. Both are carried because `acs_designed: 6/6` alone would report 100% of the
 * acceptance criteria that exist and say nothing about the eight use-case designs
 * the graph still owes. A ledger that shows what it owes is the product.
 */
export const SnapshotCoverageDesignAxisSchema = SnapshotCoverageAxisSchema.extend({
  usecasesComplete: SnapshotCoverageRatioSchema,
  ucsNeedingScenarios: nonNegativeInt.nullable(),
});

/**
 * The proven axis: **acceptance criteria Kane's graph holds execution facts for.**
 *
 * Not promises. `metrics.provenCoverage` counts promises this repository verified,
 * over a different denominator and about different objects. `source` and
 * `denominatorBasis` are carried verbatim, `graph_execution_facts` over
 * `current_live_acs`, so the page can state what the figure counts rather than
 * leaving a reader to assume it is the other one (R9.15).
 */
export const SnapshotCoverageProvenAxisSchema = SnapshotCoverageAxisSchema.extend({
  failing: nonNegativeInt.nullable(),
  blocked: nonNegativeInt.nullable(),
  notRun: nonNegativeInt.nullable(),
  latestRunExecutionId: z.string().min(1).nullable(),
  source: z.string().min(1).nullable(),
  denominatorBasis: z.string().min(1).nullable(),
});

/**
 * One pending item on a use-case row (R9.11).
 *
 * `readyCommand` is a literal `kane-cli …` string Kane composed. It is carried as
 * **text** and the Ledger renders it as text: the deployed app has no mutating route
 * (§9, R8.4), and a rendered control that spent credits would break that outright.
 */
export const SnapshotCoveragePendingSchema = z.strictObject({
  kind: z.string().min(1).nullable(),
  why: z.string().min(1).nullable(),
  risk: z.string().min(1).nullable(),
  stage: z.string().min(1).nullable(),
  tag: z.string().min(1).nullable(),
  /** Text only, never a control. */
  readyCommand: z.string().min(1).nullable(),
});

/** A per-use-case axis: the percentage and the word Kane put on it. */
export const SnapshotCoverageRowAxisSchema = z.strictObject({
  pct: z.number().min(0).max(100).nullable(),
  status: z.string().min(1).nullable(),
});

/** One row of the ribbon (R9.11). Ordered by risk band then identifier (R9.12). */
export const SnapshotCoverageRowSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string(),
  risk: z.string().min(1).nullable(),
  riskRank: nonNegativeInt,
  designCompleteness: SnapshotCoverageRowAxisSchema,
  proven: SnapshotCoverageRowAxisSchema,
  staleAcs: nonNegativeInt.nullable(),
  pending: z.array(SnapshotCoveragePendingSchema),
});

/**
 * The Coverage_Axes as the shareable page renders them, with Kane invoked zero
 * times (R9.14).
 *
 * `rows` is `.min(1)`: an axis block with no rows is exactly the state R9.13 calls
 * *withheld*, and the field is `null` for it. An empty ribbon reads as "nothing
 * owed", which on this repository would be false, so the schema makes it
 * unrepresentable rather than leaving it to a render-time check.
 */
export const SnapshotCoverageAxesSchema = z.strictObject({
  designCompleteness: SnapshotCoverageDesignAxisSchema,
  proven: SnapshotCoverageProvenAxisSchema,
  rows: z.array(SnapshotCoverageRowSchema).min(1),
});

/** Which `kept` and which `kane-cli` produced the file. */
export const SnapshotGeneratorSchema = z.strictObject({
  kept: z.string().min(1),
  kaneCli: z.string().min(1).nullable(),
});

/** The snapshot before the cross-field rules are applied. */
const LedgerSnapshotShape = z.strictObject({
  schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
  generatedAt: isoTimestamp,
  generator: SnapshotGeneratorSchema,
  degraded: z.boolean(),
  degradedReasons: z.array(z.string().min(1)),
  freshness: SnapshotFreshnessSchema,
  metrics: SnapshotMetricsSchema,
  /**
   * The dual coverage axes from `cover gaps`, or `null` when they were withheld
   * (R9.13, R9.14).
   *
   * `.optional()` as well as `.nullable()`, which breaks this module's own
   * explicit-null rule, and the exception is the same one `evidence[].packId` took:
   * a snapshot written before the field existed is a file this build must still be
   * able to read, and the alternative is a Ledger that fails its build on a
   * previously valid committed file. Every snapshot `kept snapshot` writes from here
   * on carries the key, `null` included, so the absent case is a migration path
   * rather than a state the writer can produce.
   */
  coverageAxes: SnapshotCoverageAxesSchema.nullable().optional(),
  promises: z.array(SnapshotPromiseSchema),
  edges: z.array(SnapshotEdgeSchema),
  documents: z.array(SnapshotDocumentSchema),
  evidence: z.array(SnapshotEvidenceSchema),
  /**
   * The terminal-event log. Capped, but the cap is checked as a cross-field rule in
   * {@link checkRunCap} rather than declared here, because it is not a flat bound.
   *
   * It was `.max(MAX_SNAPSHOT_RUNS)`, and that flatly contradicted the retention rule
   * the projection applies: every run a promise names as its verdict source is kept
   * regardless of age, so that no verdict points at a run the file does not carry. On a
   * repository with more cited runs than the cap, the two rules cannot both hold, and
   * the failure was silent in the worst way. `kept snapshot` would assemble the file,
   * fail its own schema check, decline to write, print an error diagnostic and **exit
   * zero**, so the previously committed snapshot would stand forever and the deployed
   * page would serve stale data with nothing red anywhere.
   *
   * Unreachable here at thirteen promises. Reachable on any host repository that
   * verifies twenty-one promises across separate runs, which is the ordinary case for
   * the portability stages 23 to 26 exist to support.
   */
  runs: z.array(SnapshotRunSchema),
  reviewCards: z.array(SnapshotReviewCardSchema),
  amendments: z.array(SnapshotAmendmentSchema),
  diagnostics: z.array(SnapshotDiagnosticSchema),
});

/** The snapshot as the field schemas alone describe it. */
export type LedgerSnapshotShape = z.infer<typeof LedgerSnapshotShape>;

// ---------------------------------------------------------------------------
// Cross-field rules (design §9.1, R8.8)
// ---------------------------------------------------------------------------

/**
 * Float comparison slack for the coverage identities. Division is exact in
 * IEEE-754 for a single operation, so an honest writer computing
 * `designedCount / totalPromises` lands on the same double this rule computes;
 * the tolerance only forgives a different-but-equivalent evaluation order. It
 * is far too tight to forgive rounding, which is the mistake worth catching:
 * a coverage figure rounded to four decimals in the file would make the badge
 * and the metric rail disagree with the promise list.
 */
const COVERAGE_TOLERANCE = 1e-12;

/**
 * The **node id** a repo-relative evidence reference names, or null.
 *
 * Two spellings reach this, and for a long time only one was recognised.
 *
 * A reference minted inside the snapshot names an `ev_`-prefixed segment:
 * `evidence/ev_20260820T184011Z/failure.yaml`. Every fixture in the suite was
 * written that way, so the rule looked right.
 *
 * A reference the **verdict router** wrote names the archive Kane actually sealed:
 * `.testmuai/evidence/<execution_id>.evidence`, where the pack is the segment
 * carrying the suffix and there is no `ev_` anywhere. Those were reported as naming
 * "no evidence pack segment", which failed the whole snapshot's schema check — so on
 * the first run that produced a real `evidenceRef`, `kept snapshot` refused to write
 * and the previously committed file stood. Silently, from a judge's point of view:
 * the Ledger simply went on showing an older state.
 *
 * The archive spelling is mapped through {@link evidenceId}, so both spellings
 * answer the same node id and a caller can compare the result against
 * `evidence[].id` without knowing which shape it started from. `evidenceId` is
 * idempotent, so an already-minted id passes through unchanged.
 *
 * Resolution is at pack granularity because that is what §9.1 asks for ("resolves to
 * an entry in `evidence`"); whether the *file* exists in the committed tree is
 * Property 28's business, and it needs a filesystem this module must not have.
 */
export function evidencePackIdFromRef(ref: string): string | null {
  const segments = ref.split('/');
  for (const segment of segments) {
    if (segment.startsWith('ev_') && segment.length > 3) return segment;
  }
  for (const segment of segments) {
    if (segment.endsWith(SEALED_PACK_SUFFIX) && segment.length > SEALED_PACK_SUFFIX.length) {
      return evidenceId(segment);
    }
  }
  return null;
}

/** Dotted path with `[i]` indices, for a human-readable message (R8.8). */
function formatPath(path: readonly (string | number)[]): string {
  let text = '';
  for (const key of path) {
    if (typeof key === 'number') text += `[${key}]`;
    else text += text.length === 0 ? key : `.${key}`;
  }
  return text;
}

/**
 * Every node id the snapshot declares.
 *
 * Designed-test node ids are *derived* rather than listed, because §9.1 gives
 * the snapshot no `designedTests` array: the tests are named by
 * `promises[].designedTest.path`, and `designedTestId` is the one function that
 * turns a path into the `t_` node the Ledger lanes at x=760 (design §10.3). If
 * the graph and the snapshot ever disagreed about that derivation, an edge would
 * point at nothing and this rule is where it surfaces.
 */
function collectNodeIds(snapshot: LedgerSnapshotShape): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const promise of snapshot.promises) {
    ids.add(promise.id);
    if (promise.designedTest !== null) ids.add(designedTestId(promise.designedTest.path));
  }
  for (const document of snapshot.documents) ids.add(document.id);
  for (const pack of snapshot.evidence) ids.add(pack.id);
  return ids;
}

/** The five metric fields that are counts over `promises`. */
type CountField = 'designedCount' | 'provenCount' | 'redCount' | 'staleCount' | 'undesignedCount';

type RefinementContext = z.RefinementCtx<LedgerSnapshotShape>;

/** Record a cross-field violation, naming the offending path (R8.8). */
function violation(
  ctx: RefinementContext,
  path: readonly (string | number)[],
  message: string,
): void {
  ctx.addIssue({
    code: 'custom',
    path: [...path],
    message: `${formatPath(path)}: ${message}`,
  });
}

/**
 * Rule 1 — count agreement. Each metric count equals the corresponding count
 * over `promises`. The metric rail is the headline of the Ledger; a count that
 * disagrees with the list below it is the one lie this file must never tell.
 */
function checkCounts(snapshot: LedgerSnapshotShape, ctx: RefinementContext): void {
  const { metrics, promises } = snapshot;
  if (metrics.totalPromises !== promises.length) {
    violation(
      ctx,
      ['metrics', 'totalPromises'],
      `expected ${promises.length} (promises.length), received ${metrics.totalPromises}`,
    );
  }
  const designed = promises.filter((promise) => promise.designedTest !== null).length;
  const counts: readonly (readonly [CountField, number, string])[] = [
    ['designedCount', designed, 'promises with a non-null designedTest'],
    [
      'provenCount',
      promises.filter((promise) => promise.verdict === 'proven').length,
      "promises with verdict 'proven'",
    ],
    [
      'redCount',
      promises.filter((promise) => promise.verdict === 'red').length,
      "promises with verdict 'red'",
    ],
    [
      'staleCount',
      promises.filter((promise) => promise.verdict === 'stale').length,
      "promises with verdict 'stale'",
    ],
    [
      'undesignedCount',
      promises.filter((promise) => promise.verdict === 'undesigned').length,
      "promises with verdict 'undesigned'",
    ],
  ];
  for (const [field, expected, description] of counts) {
    if (metrics[field] !== expected) {
      violation(
        ctx,
        ['metrics', field],
        `expected ${expected} (${description}), received ${metrics[field]}`,
      );
    }
  }
}

/**
 * Rule 2 — coverage nullability and value.
 *
 * `designedCoverage` is null exactly when there are no promises, because R9.3
 * forbids the division rather than asking for a zero. `provenCoverage` is
 * additionally null while `degraded` is true: with the enrichment axis
 * discarded, a proven figure would be a number KEPT cannot stand behind, and
 * R2.11 has the Ledger omit it entirely.
 */
function checkCoverage(snapshot: LedgerSnapshotShape, ctx: RefinementContext): void {
  const { metrics, degraded } = snapshot;
  const empty = metrics.totalPromises === 0;

  if (empty !== (metrics.designedCoverage === null)) {
    violation(
      ctx,
      ['metrics', 'designedCoverage'],
      empty
        ? 'expected null because totalPromises is 0 (R9.3 performs no division)'
        : `expected a ratio because totalPromises is ${metrics.totalPromises}, received null`,
    );
  } else if (metrics.designedCoverage !== null) {
    const expected = metrics.designedCount / metrics.totalPromises;
    if (Math.abs(metrics.designedCoverage - expected) > COVERAGE_TOLERANCE) {
      violation(
        ctx,
        ['metrics', 'designedCoverage'],
        `expected designedCount / totalPromises = ${expected}, received ${metrics.designedCoverage}`,
      );
    }
  }

  const provenMustBeNull = empty || degraded;
  if (provenMustBeNull !== (metrics.provenCoverage === null)) {
    violation(
      ctx,
      ['metrics', 'provenCoverage'],
      provenMustBeNull
        ? empty
          ? 'expected null because totalPromises is 0 (R9.3 performs no division)'
          : 'expected null because degraded is true (R2.11 omits the proven figure)'
        : `expected a ratio because totalPromises is ${metrics.totalPromises} and degraded is false, received null`,
    );
  } else if (metrics.provenCoverage !== null) {
    const expected = metrics.provenCount / metrics.totalPromises;
    if (Math.abs(metrics.provenCoverage - expected) > COVERAGE_TOLERANCE) {
      violation(
        ctx,
        ['metrics', 'provenCoverage'],
        `expected provenCount / totalPromises = ${expected}, received ${metrics.provenCoverage}`,
      );
    }
  }
}

/**
 * Rule 3 — evidence-reference resolution. Every `promises[].evidencePackId` and
 * every `promises[].repair.evidenceRef` names a pack the snapshot carries.
 *
 * This is the rule that keeps a dead artefact link out of the deployed Ledger.
 * The Ledger renders evidence links straight from these fields with no
 * filesystem access at all (design §9.3), so an unresolvable reference is not a
 * missing file at runtime — it is a link a judge clicks and gets a 404 from.
 */
function checkEvidenceReferences(snapshot: LedgerSnapshotShape, ctx: RefinementContext): void {
  const packs = new Set(snapshot.evidence.map((pack) => pack.id));
  for (const [index, promise] of snapshot.promises.entries()) {
    if (promise.evidencePackId !== null && !packs.has(promise.evidencePackId)) {
      violation(
        ctx,
        ['promises', index, 'evidencePackId'],
        `'${promise.evidencePackId}' does not resolve to an entry in evidence`,
      );
    }
    const ref = promise.repair?.evidenceRef ?? null;
    if (ref === null) continue;
    const packId = evidencePackIdFromRef(ref);
    if (packId === null) {
      violation(
        ctx,
        ['promises', index, 'repair', 'evidenceRef'],
        `'${ref}' names no evidence pack segment (expected a path containing 'ev_…')`,
      );
    } else if (!packs.has(packId)) {
      violation(
        ctx,
        ['promises', index, 'repair', 'evidenceRef'],
        `'${ref}' resolves to '${packId}', which is not an entry in evidence`,
      );
    }
  }
}

/**
 * Rule 4 — edge endpoint resolution. Every endpoint is a node the snapshot
 * declares: a promise, a document, a designed test or an evidence pack.
 *
 * Checked in two steps so the message distinguishes the two ways it fails.
 * `isNodeId` catches an endpoint that is not a node id *at all* — a bare file
 * path, a Kane `test_id`, an unprefixed hash — which is a wiring bug in whoever
 * built the edge. A well-formed id that is absent from the snapshot is the
 * other bug: a node that was dropped by a filter, or an edge built against a
 * previous graph.
 */
function checkEdgeEndpoints(snapshot: LedgerSnapshotShape, ctx: RefinementContext): void {
  const nodes = collectNodeIds(snapshot);
  for (const [index, edge] of snapshot.edges.entries()) {
    for (const end of ['from', 'to'] as const) {
      const id = edge[end];
      if (!isNodeId(id)) {
        violation(
          ctx,
          ['edges', index, end],
          `'${id}' is not a graph node id (expected a d_, p_, t_ or ev_ prefixed id)`,
        );
      } else if (!nodes.has(id)) {
        violation(
          ctx,
          ['edges', index, end],
          `'${id}' does not resolve to a promise, document, designed test or evidence node`,
        );
      }
    }
  }
}

/**
 * Rule 5 — freshness type/family consistency, per the contract table of §4.1.
 *
 * The three freshness fields describe one thing: the newest terminal event KEPT
 * consumed. So they are present together or absent together — a family with no
 * terminal event, or an instant with no family, is not a state the freshness
 * chip can render (R9.6), and it would leave a reader unable to tell "nothing
 * has run" from "something ran and we lost track of it". When they are present,
 * the type must be the one that family's contract fixes: `run_end` for
 * ExecutionRun, `testrun_done` for ExecutionTestrun, `done` for Assurance.
 * That table is encoded once, in `kane/family.ts`, and read here.
 */
function checkFreshness(snapshot: LedgerSnapshotShape, ctx: RefinementContext): void {
  const { terminalEventAt, terminalEventType, commandFamily } = snapshot.freshness;
  const present = [terminalEventAt, terminalEventType, commandFamily].filter(
    (field) => field !== null,
  ).length;
  if (present !== 0 && present !== 3) {
    if (terminalEventType === null || commandFamily === null) {
      violation(
        ctx,
        ['freshness', 'terminalEventType'],
        'freshness fields are present together or absent together; ' +
          `received terminalEventAt=${JSON.stringify(terminalEventAt)}, ` +
          `terminalEventType=${JSON.stringify(terminalEventType)}, ` +
          `commandFamily=${JSON.stringify(commandFamily)}`,
      );
    } else {
      violation(
        ctx,
        ['freshness', 'terminalEventAt'],
        `expected the instant of the newest consumed ${terminalEventType} event, received null`,
      );
    }
    return;
  }
  if (commandFamily === null || terminalEventType === null) return;
  const expected = contractFor(commandFamily).terminalType;
  if (terminalEventType !== expected) {
    violation(
      ctx,
      ['freshness', 'terminalEventType'],
      `expected '${expected}' for command family '${commandFamily}', received '${terminalEventType}'`,
    );
  }
}

/**
 * Rule 6, the Coverage_Axes are present exactly when the graph is not degraded,
 * and both axis ratios agree on one live acceptance-criteria count (R9.13, R9.15).
 *
 * The first half is R9.13 made structural. `degraded` is `!enrichment.ok` and the
 * axes come from that same provider's accepting path, so the two cannot honestly
 * disagree: a degraded snapshot carrying axes would be publishing figures from a run
 * whose outcome was discarded, and a clean snapshot with no axes would be withholding
 * figures it has. Both are caught here rather than at the render, where the failure
 * mode is a page that reads as "nothing owed".
 *
 * The second half is the one way a *dual*-axis ribbon can mislead while every single
 * figure in it is right: two ratios shown side by side over different denominators
 * are measuring different populations. `6/6` designed against `6/6` proven is one
 * population of six live acceptance criteria; `6/6` against `6/8` would not be, and
 * the ribbon has no way to say so. A denominator this build could not parse is not a
 * violation, the ratio string is still carried verbatim and the provider has already
 * said it claims no shared count.
 */
function checkCoverageAxes(snapshot: LedgerSnapshotShape, ctx: RefinementContext): void {
  const axes = snapshot.coverageAxes ?? null;
  if (snapshot.degraded && axes !== null) {
    violation(
      ctx,
      ['coverageAxes'],
      'expected null because degraded is true: R9.13 withholds the coverage axes rather ' +
        'than rendering figures from a run whose outcome was discarded',
    );
    return;
  }
  if (axes === null) return;

  const designed = axes.designCompleteness.ratio.denominator;
  const proven = axes.proven.ratio.denominator;
  if (designed !== null && proven !== null && designed !== proven) {
    violation(
      ctx,
      ['coverageAxes', 'proven', 'ratio', 'denominator'],
      `expected ${designed}, the live acceptance-criteria count the design-completeness ` +
        `ratio reports, received ${proven}. Two axes over two denominators cannot be read ` +
        `side by side (R9.15).`,
    );
  }

  for (const [index, row] of axes.rows.entries()) {
    const expected = row.risk === null ? null : row.risk;
    if (expected === null && row.riskRank === 0) {
      violation(
        ctx,
        ['coverageAxes', 'rows', index, 'riskRank'],
        'a row with no risk band cannot rank first; an unrecognised risk sorts after ' +
          'every known band rather than claiming to be the most urgent',
      );
    }
  }
}

/**
 * Rule 7: the run log is capped, and provenance raises the cap rather than breaking it.
 *
 * The log carries at most {@link MAX_SNAPSHOT_RUNS} entries **or as many as the promises
 * require, whichever is larger**. A run a promise names as its verdict source has to be
 * in the file, because a verdict whose provenance cannot be opened is not traceable and
 * the run id is recorded for no other purpose.
 *
 * Stated this way round on purpose. A flat `max` and the projection's retention rule are
 * in direct conflict once the cited count passes the cap, and of the two possible
 * resolutions, dropping cited runs to satisfy a bound publishes a dangling reference,
 * while carrying a longer log costs bytes. §9.1 already refuses dangling references in
 * three other places, so bytes lose.
 *
 * The excess is bounded by the promise count rather than unbounded, which is what keeps
 * this a cap at all: a file cannot grow a run log longer than the graph it explains.
 */
function checkRunCap(snapshot: LedgerSnapshotShape, ctx: z.RefinementCtx): void {
  const cited = new Set(
    snapshot.promises
      .map((promise) => promise.verdictSource?.runId)
      .filter((id): id is string => typeof id === 'string' && id !== ''),
  );
  const allowed = Math.max(MAX_SNAPSHOT_RUNS, cited.size);
  if (snapshot.runs.length <= allowed) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['runs'],
    message:
      `carries ${snapshot.runs.length} runs, and at most ${allowed} are allowed: the cap is ` +
      `${MAX_SNAPSHOT_RUNS}, raised to the ${cited.size} run(s) the promises name as verdict ` +
      `sources when that is larger. Drop the oldest run no promise cites.`,
  });
}

/**
 * The snapshot schema, cross-field rules included.
 *
 * `superRefine` rather than `refine` because every rule reports a *path*: R8.8
 * requires the failing build to name the invalid field, and "the snapshot is
 * invalid" is not a diagnostic anybody can act on. All seven rules run on every
 * parse, so one call reports every disagreement rather than the first.
 */
export const LedgerSnapshotSchema = LedgerSnapshotShape.superRefine((snapshot, ctx) => {
  checkCounts(snapshot, ctx);
  checkCoverage(snapshot, ctx);
  checkEvidenceReferences(snapshot, ctx);
  checkEdgeEndpoints(snapshot, ctx);
  checkFreshness(snapshot, ctx);
  checkCoverageAxes(snapshot, ctx);
  checkRunCap(snapshot, ctx);
});

/** The CLI↔UI contract, inferred from the schema so the two cannot drift. */
export type LedgerSnapshot = z.infer<typeof LedgerSnapshotSchema>;

/** Component types, inferred for the same reason. */
export type SnapshotPromise = z.infer<typeof SnapshotPromiseSchema>;
export type SnapshotEdge = z.infer<typeof SnapshotEdgeSchema>;
export type SnapshotDocument = z.infer<typeof SnapshotDocumentSchema>;
export type SnapshotEvidence = z.infer<typeof SnapshotEvidenceSchema>;
export type SnapshotArtifact = z.infer<typeof SnapshotArtifactSchema>;
export type SnapshotRun = z.infer<typeof SnapshotRunSchema>;
export type SnapshotRunMember = z.infer<typeof SnapshotRunMemberSchema>;
export type SnapshotReviewCard = z.infer<typeof SnapshotReviewCardSchema>;
export type SnapshotAmendment = z.infer<typeof SnapshotAmendmentSchema>;
export type SnapshotDiagnostic = z.infer<typeof SnapshotDiagnosticSchema>;
export type SnapshotMetrics = z.infer<typeof SnapshotMetricsSchema>;
export type SnapshotFreshness = z.infer<typeof SnapshotFreshnessSchema>;
export type SnapshotVerdictObject = z.infer<typeof SnapshotVerdictObjectSchema>;
export type SnapshotCoverageAxes = z.infer<typeof SnapshotCoverageAxesSchema>;
export type SnapshotCoverageRow = z.infer<typeof SnapshotCoverageRowSchema>;
export type SnapshotCoveragePending = z.infer<typeof SnapshotCoveragePendingSchema>;
export type SnapshotCoverageRatio = z.infer<typeof SnapshotCoverageRatioSchema>;

/**
 * Non-throwing check, for a caller that wants to report rather than fail. The
 * Ledger build uses `parseSnapshot` (model/canonical.ts) instead, because a
 * malformed snapshot there *must* fail the build (R8.8).
 */
export function isLedgerSnapshot(value: unknown): value is LedgerSnapshot {
  return LedgerSnapshotSchema.safeParse(value).success;
}
