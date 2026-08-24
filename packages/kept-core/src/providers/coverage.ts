/**
 * Tolerant projection of the Assurance `coverage` payload (design §5.3).
 *
 * The parser hands `providers/enrichment.ts` the **whole raw `coverage` event**,
 * deep-equal to `JSON.parse` of the line that carried it, because the payload's
 * internal schema is not pinned by observation. That is the honest thing for a
 * parser to do and it makes this module's job the interesting one: turn an
 * unpinned wire shape into axis overlays without ever pretending to know more
 * than arrived.
 *
 * The rule is stated in §5.3 and implemented literally here: **walk the payload
 * for any array of objects**, and accept an entry when it carries a recognisable
 * test identity and/or a path. The one recorded payload happens to keep its array
 * at `coverage.tests`, and a reader that hard-coded that path would be over-fitting
 * a single capture — a nested envelope, a renamed key or an extra wrapper level
 * would silently project zero entries, and zero entries is a *degraded build*
 * (`coverage-payload-unreadable`). So the walk is structural rather than
 * positional, key spellings are accepted in families rather than singly, and
 * everything unrecognised becomes a diagnostic instead of a failure.
 *
 * Two boundaries keep tolerance from becoming credulity:
 *
 * 1. **An entry with neither an identity nor a path is refused**, and its
 *    location in the payload is reported. Accepting it would produce an overlay
 *    that could not be keyed to any promise, which is worse than not having it.
 * 2. **Nothing here decides the build's fate.** Zero projected entries is a fact
 *    this module reports; the *decision* that zero entries degrades the run
 *    belongs to `enrichment.ts`, which owns the acceptance gate of §5.3.
 *
 * Keying is the other half (§5.3): `test_id` matched against a candidate's
 * `designedTest.testId` first, then normalised `path` against `designedTest.path`.
 * A single test document legitimately verifies many promises, so a match is a
 * *set* of targets and not one — an overlay from one coverage entry can land on
 * every promise that cites the same `*_test.md`.
 */

import { toPosix } from '../model/ids.js';
import { evidencePackIdFromRef } from '../model/snapshot.js';
import type { DesignedTest, Verdict } from '../model/promise.js';

import type { ProviderAxes, ProviderAxisOverlay } from './adapter.js';

/**
 * Keys read as a test identity, in precedence order (§5.3).
 *
 * `test_id` first because that is the spelling Kane uses in both the recorded
 * `coverage` payload and in `testrun_plan.members[]`, which §3.4 makes the
 * authority on the value.
 */
export const COVERAGE_TEST_ID_KEYS: readonly string[] = Object.freeze([
  'test_id',
  'testId',
  'testID',
  'id',
]);

/** Keys read as a test-document path, in precedence order (§5.3). */
export const COVERAGE_PATH_KEYS: readonly string[] = Object.freeze([
  'path',
  'file',
  'test_path',
  'testPath',
  'test_file',
]);

/** Keys read as "this promise has a designed test", in precedence order. */
export const COVERAGE_DESIGNED_KEYS: readonly string[] = Object.freeze([
  'designed',
  'is_designed',
  'isDesigned',
  'has_test',
]);

/** Keys read as "a real run proved it", in precedence order. */
export const COVERAGE_PROVEN_KEYS: readonly string[] = Object.freeze([
  'proven',
  'is_proven',
  'passed',
  'passing',
]);

/** Keys read as a coarse status enum, in precedence order. */
export const COVERAGE_STATUS_KEYS: readonly string[] = Object.freeze([
  'status',
  'state',
  'result',
  'outcome',
]);

/**
 * Keys read as an evidence-pack reference anywhere in the payload.
 *
 * The recorded envelope carries `pack: ".testmuai/evidence/ev_20260820T183041Z"`,
 * a *path*, so the value is run through `evidencePackIdFromRef` to recover the
 * `ev_…` segment. `.testmuai/evidence/` is gitignored and the location itself is
 * derived from the command family (§4.6, A12) — this is the pack **identity**,
 * never a path anything opens.
 */
export const COVERAGE_PACK_KEYS: readonly string[] = Object.freeze([
  'pack',
  'pack_id',
  'packId',
  'evidence_pack',
  'evidence_pack_id',
  'evidencePackId',
]);

/**
 * How deep the walk descends. A JSON payload has no cycles, so this is not a
 * loop guard — it is a bound on how much of an unexpectedly deep document is
 * searched before the projection reports `truncated` and stops. Eight levels
 * clears the recorded envelope (`event → coverage → tests → entry` is three) with
 * room for wrappers a future release might add.
 */
export const MAX_COVERAGE_WALK_DEPTH = 8;

/** Upper bound on projected entries, so a hostile payload cannot exhaust memory. */
export const MAX_COVERAGE_ENTRIES = 10_000;

/** Status strings read as `proven`. Compared lowercased and trimmed. */
export const COVERAGE_PROVEN_STATUSES: readonly string[] = Object.freeze([
  'passed',
  'pass',
  'passing',
  'proven',
  'green',
  'ok',
  'success',
  'succeeded',
]);

/** Status strings read as `red`. */
export const COVERAGE_RED_STATUSES: readonly string[] = Object.freeze([
  'failed',
  'fail',
  'failing',
  'red',
  'broken',
  'error',
  'errored',
]);

/** Status strings read as `undesigned`. */
export const COVERAGE_UNDESIGNED_STATUSES: readonly string[] = Object.freeze([
  'undesigned',
  'undesign',
  'missing',
  'uncovered',
  'none',
  'absent',
]);

/** Status strings read as `stale`. */
export const COVERAGE_STALE_STATUSES: readonly string[] = Object.freeze([
  'stale',
  'skipped',
  'skip',
  'pending',
  'unknown',
  'not_run',
  'notrun',
]);

/**
 * One entry projected out of the payload.
 *
 * Every field is an explicit `null` when the payload did not carry it, which is
 * what lets `coverageVerdict` distinguish "this run says the test failed" from
 * "this run said nothing about whether it passed". A dropped key would collapse
 * those two into one.
 */
export interface CoverageEntry {
  /** Kane's test identity, trimmed. Null when the entry carried none. */
  readonly testId: string | null;
  /** Test-document path, POSIX-normalised and `./`-stripped. Null when absent. */
  readonly path: string | null;
  /** Whether a designed test exists, when the payload said so. */
  readonly designed: boolean | null;
  /** Whether a run proved it, when the payload said so. */
  readonly proven: boolean | null;
  /** Coarse status, lowercased and trimmed. Null when absent or not a string. */
  readonly status: string | null;
  /** Dotted location this entry was found at, e.g. `coverage.tests[3]`. */
  readonly at: string;
}

/** What {@link projectCoverage} made of a payload. */
export interface CoverageProjection {
  /** Accepted entries, in walk order, deduplicated on identity plus path. */
  readonly entries: readonly CoverageEntry[];
  /** How many arrays containing at least one object were walked. */
  readonly arrays: number;
  /** How many objects inside those arrays were examined. */
  readonly examined: number;
  /** Locations of objects that carried neither an identity nor a path. */
  readonly refused: readonly string[];
  /** Locations dropped because an identical entry was already projected. */
  readonly duplicates: readonly string[];
  /** The evidence-pack id, when the envelope named one. */
  readonly packId: string | null;
  /** True when the depth or entry bound stopped the walk. */
  readonly truncated: boolean;
}

const EMPTY_PROJECTION: CoverageProjection = Object.freeze({
  entries: Object.freeze([]) as readonly CoverageEntry[],
  arrays: 0,
  examined: 0,
  refused: Object.freeze([]) as readonly string[],
  duplicates: Object.freeze([]) as readonly string[],
  packId: null,
  truncated: false,
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read the first present key of a family. Own properties only. */
function firstPresent(
  source: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const value = source[key];
      if (value !== undefined && value !== null) return value;
    }
  }
  return undefined;
}

/**
 * Normalise a test-document path for matching against `designedTest.path`.
 *
 * POSIX separators, no leading `./`, no surrounding whitespace, and no trailing
 * slash. Nothing else: the value is a repository-relative path and this module
 * has no business resolving it. Anything that is not a non-empty string is null.
 */
export function normaliseCoveragePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let path = toPosix(value).trim();
  while (path.startsWith('./')) path = path.slice(2);
  while (path.endsWith('/')) path = path.slice(0, -1);
  return path.length === 0 ? null : path;
}

/** Read a test identity: a non-empty trimmed string, or a finite number's decimal form. */
function readTestId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Read a boolean tolerantly. `true`/`false`, the strings `"true"`/`"false"`
 * (any case), and the numbers one and zero. Anything else is null — an
 * unrecognised value must not read as `false`, because `false` on the proven
 * axis means "a run said this is not proven" and that is a claim.
 */
function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'true' || text === 'yes') return true;
    if (text === 'false' || text === 'no') return false;
  }
  return null;
}

function readStatus(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  return text.length === 0 ? null : text;
}

/** Project one object, or refuse it for carrying no way to be keyed. */
function projectEntry(source: Record<string, unknown>, at: string): CoverageEntry | null {
  const testId = readTestId(firstPresent(source, COVERAGE_TEST_ID_KEYS));
  const path = normaliseCoveragePath(firstPresent(source, COVERAGE_PATH_KEYS));
  // §5.3: "a recognisable test identity **and/or** a path". Neither means the
  // entry cannot be keyed to a promise, so it is refused and reported.
  if (testId === null && path === null) return null;
  return {
    testId,
    path,
    designed: readBoolean(firstPresent(source, COVERAGE_DESIGNED_KEYS)),
    proven: readBoolean(firstPresent(source, COVERAGE_PROVEN_KEYS)),
    status: readStatus(firstPresent(source, COVERAGE_STATUS_KEYS)),
    at,
  };
}

function identityKey(entry: CoverageEntry): string {
  return `${entry.testId ?? ''}\u0000${entry.path ?? ''}`;
}

/**
 * Walk a payload for coverage entries (design §5.3).
 *
 * Structural, not positional: every array reachable within
 * {@link MAX_COVERAGE_WALK_DEPTH} levels is inspected, and any of its members
 * that is an object is offered to {@link projectEntry}. The walk continues *into*
 * those members too, so an array of wrappers each holding the real array still
 * projects. Junk members — strings, numbers, nulls, nested arrays — are ignored
 * rather than refused, because they were never candidates.
 *
 * Total over every input, including `null`, a primitive, and a deeply nested
 * document. Never throws.
 */
export function projectCoverage(payload: unknown): CoverageProjection {
  if (!isPlainObject(payload) && !Array.isArray(payload)) return EMPTY_PROJECTION;

  const entries: CoverageEntry[] = [];
  const seen = new Set<string>();
  const refused: string[] = [];
  const duplicates: string[] = [];
  let arrays = 0;
  let examined = 0;
  let truncated = false;
  let packId: string | null = null;

  const notePack = (value: unknown): void => {
    if (packId !== null || typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    packId = evidencePackIdFromRef(trimmed) ?? (trimmed.includes('/') ? null : trimmed);
  };

  const walk = (node: unknown, at: string, depth: number): void => {
    if (depth > MAX_COVERAGE_WALK_DEPTH) {
      truncated = true;
      return;
    }
    if (Array.isArray(node)) {
      let holdsObject = false;
      for (let index = 0; index < node.length; index += 1) {
        const member = node[index];
        const location = `${at}[${index}]`;
        if (isPlainObject(member)) {
          holdsObject = true;
          examined += 1;
          if (entries.length >= MAX_COVERAGE_ENTRIES) {
            truncated = true;
          } else {
            const projected = projectEntry(member, location);
            if (projected === null) {
              refused.push(location);
            } else {
              const key = identityKey(projected);
              if (seen.has(key)) duplicates.push(location);
              else {
                seen.add(key);
                entries.push(projected);
              }
            }
          }
        }
        walk(member, location, depth + 1);
      }
      if (holdsObject) arrays += 1;
      return;
    }
    if (!isPlainObject(node)) return;
    for (const key of Object.keys(node)) {
      const value = node[key];
      const location = at.length === 0 ? key : `${at}.${key}`;
      if (COVERAGE_PACK_KEYS.includes(key)) notePack(value);
      walk(value, location, depth + 1);
    }
  };

  walk(payload, '', 0);

  return { entries, arrays, examined, refused, duplicates, packId, truncated };
}

/**
 * The verdict one entry implies, or null when it implies none (R2.5).
 *
 * Explicit booleans outrank the status string, because a boolean is a field the
 * payload chose to state while a status is a free-text enum this module is
 * guessing at. Precedence:
 *
 * 1. `designed === false` → `undesigned`. Nothing else can be true of a promise
 *    with no test, and R5.5 fixes that verdict.
 * 2. `proven === true` → `proven`.
 * 3. `proven === false` → `red`.
 * 4. a recognised status → its verdict.
 * 5. otherwise **null**, which the merge reads as "leave whatever baseline had".
 *
 * Returning null rather than a default is the load-bearing part: a coverage entry
 * that says nothing about the proven axis must not move a verdict, or a payload
 * shape this module does not understand would quietly mark real promises stale.
 */
export function coverageVerdict(entry: CoverageEntry): Verdict | null {
  if (entry.designed === false) return 'undesigned';
  if (entry.proven === true) return 'proven';
  if (entry.proven === false) return 'red';
  const status = entry.status;
  if (status === null) return null;
  if (COVERAGE_PROVEN_STATUSES.includes(status)) return 'proven';
  if (COVERAGE_RED_STATUSES.includes(status)) return 'red';
  if (COVERAGE_UNDESIGNED_STATUSES.includes(status)) return 'undesigned';
  if (COVERAGE_STALE_STATUSES.includes(status)) return 'stale';
  return null;
}

/**
 * One promise a coverage entry can be keyed to.
 *
 * The promise id is derived by the caller from the baseline candidate it came
 * from, so this module never mints an identity: it only decides which existing
 * one an entry belongs to.
 */
export interface CoverageAxisTarget {
  readonly promiseId: string;
  readonly designedTest: DesignedTest | null;
}

/** How a matched entry found its targets, for the diagnostic that says so. */
export type CoverageMatchKind = 'test-id' | 'path';

/** One entry, and the promises it landed on. */
export interface CoverageMatch {
  readonly entry: CoverageEntry;
  readonly kind: CoverageMatchKind;
  /** Promise ids the overlay was written for, in target order. */
  readonly promiseIds: readonly string[];
}

/** What {@link buildCoverageAxes} made of a projection. */
export interface CoverageAxesResult {
  /** Overlays by promise id — exactly `ProviderResult.axes` (§5.1). */
  readonly axes: ProviderAxes;
  /** Entries that keyed to at least one promise, in entry order. */
  readonly matched: readonly CoverageMatch[];
  /** Entries that keyed to nothing. Diagnosed by the caller, never fatal (§5.3). */
  readonly unmatched: readonly CoverageEntry[];
  /** Promise ids whose overlay was replaced by a later, differing entry. */
  readonly overwritten: readonly string[];
}

/** {@link buildCoverageAxes}'s input. */
export interface CoverageAxesRequest {
  readonly entries: readonly CoverageEntry[];
  readonly targets: readonly CoverageAxisTarget[];
  /** Attached to every overlay when present, from the payload envelope. */
  readonly packId?: string | null;
}

/**
 * Key projected entries onto promises and build the overlay map (§5.3).
 *
 * Two-step keying, in the order the design fixes: `test_id` against
 * `designedTest.testId` first, then normalised `path` against `designedTest.path`.
 * Path matching is *not* attempted when the identity matched — an entry that
 * named a test id KEPT knows is already keyed, and falling through would let a
 * renamed document double-apply.
 *
 * A match is a set. One `*_test.md` verifies as many promises as cite it, so an
 * entry naming that document overlays every one of them; that is what makes a
 * `cover` payload keyed by test document usable against a graph keyed by claim.
 *
 * A target whose `designedTest` is null matches nothing, and that is correct
 * rather than a gap: a coverage entry names a test document, and only baseline
 * knows which claim a test document verifies (through its `@verifies` tag). So
 * enrichment can fill in Kane's authoritative `test_id` and the proven axis for a
 * promise baseline already designed, and it cannot invent a design binding
 * baseline never saw. Entries matching nothing are returned in `unmatched` for
 * the caller to diagnose — §5.3 makes them diagnostics, never failures.
 *
 * Later entries win, matching the "newest fact" convention of `applyRun`; a
 * replacement that changes the overlay is reported in `overwritten` so the
 * caller can say so.
 */
export function buildCoverageAxes(request: CoverageAxesRequest): CoverageAxesResult {
  const byTestId = new Map<string, CoverageAxisTarget[]>();
  const byPath = new Map<string, CoverageAxisTarget[]>();
  for (const target of request.targets) {
    const designed = target.designedTest;
    if (designed === null) continue;
    const testId = designed.testId;
    if (typeof testId === 'string' && testId.trim().length > 0) {
      const key = testId.trim();
      const bucket = byTestId.get(key);
      if (bucket === undefined) byTestId.set(key, [target]);
      else bucket.push(target);
    }
    const path = normaliseCoveragePath(designed.path);
    if (path !== null) {
      const bucket = byPath.get(path);
      if (bucket === undefined) byPath.set(path, [target]);
      else bucket.push(target);
    }
  }

  const axes = new Map<string, ProviderAxisOverlay>();
  const matched: CoverageMatch[] = [];
  const unmatched: CoverageEntry[] = [];
  const overwritten: string[] = [];
  const packId =
    typeof request.packId === 'string' && request.packId.length > 0 ? request.packId : null;

  for (const entry of request.entries) {
    let kind: CoverageMatchKind = 'test-id';
    let targets: readonly CoverageAxisTarget[] | undefined =
      entry.testId === null ? undefined : byTestId.get(entry.testId);
    if (targets === undefined || targets.length === 0) {
      kind = 'path';
      targets = entry.path === null ? undefined : byPath.get(entry.path);
    }
    if (targets === undefined || targets.length === 0) {
      unmatched.push(entry);
      continue;
    }

    const verdict = coverageVerdict(entry);
    const promiseIds: string[] = [];
    for (const target of targets) {
      // A target with no designed test never enters the keying maps above, so
      // `designedTest` is non-null here by construction; the `?? null` keeps the
      // expression total rather than relying on that.
      const designedPath = entry.path ?? target.designedTest?.path ?? null;
      const overlay: ProviderAxisOverlay = {
        // A missing key means "leave whatever baseline had" (§5.1), so each field
        // is written only when this entry actually carried it.
        ...(designedPath === null
          ? {}
          : {
              designedTest: {
                path: designedPath,
                testId: entry.testId ?? target.designedTest?.testId ?? null,
              },
            }),
        ...(verdict === null ? {} : { verdict }),
        ...(packId === null ? {} : { evidencePackId: packId }),
      };
      const previous = axes.get(target.promiseId);
      if (previous !== undefined && !sameOverlay(previous, overlay)) {
        overwritten.push(target.promiseId);
      }
      axes.set(target.promiseId, overlay);
      promiseIds.push(target.promiseId);
    }
    matched.push({ entry, kind, promiseIds });
  }

  return { axes, matched, unmatched, overwritten };
}

function sameOverlay(left: ProviderAxisOverlay, right: ProviderAxisOverlay): boolean {
  return (
    left.verdict === right.verdict &&
    left.evidencePackId === right.evidencePackId &&
    (left.designedTest?.path ?? null) === (right.designedTest?.path ?? null) &&
    (left.designedTest?.testId ?? null) === (right.designedTest?.testId ?? null)
  );
}

// ---------------------------------------------------------------------------
// The `gaps` payload — the axes as they actually arrive (design §5.3.0)
// ---------------------------------------------------------------------------

/**
 * Everything below this line reads the **`gaps`** payload rather than the
 * singular `coverage` one, and the split is the whole content of §5.3.0.
 *
 * `cover --json` reads its depth axis out of a sealed Evidence_Pack and refuses at
 * exit 2 with `carries no coverage/usecases.yaml` on a **replay** pack, which is
 * every pack this repository seals. So the projection above can never be handed a
 * payload here, and it stays in the codebase for the repository whose packs *are*
 * authored — the documented first choice, with its refusal committed as a
 * regression fixture (§5.3.1).
 *
 * `cover gaps` answers the same two axes from the live assurance graph instead:
 * `design_completeness.pct` with its `acs_designed` ratio, `proven.pct` with its
 * `acs_proven` ratio, `proven.config.source: graph_execution_facts` over
 * `denominator: current_live_acs`, and a per-use-case dossier. Exit 0, `done` with
 * `status: complete`, and free to read.
 *
 * The reading rules are the same three the coverage projection follows, for the
 * same reason — the payload's schema is observed, not documented:
 *
 * 1. **Percentages and ratio strings are carried verbatim.** `acs_designed` is
 *    published as the string `6/6` that arrived, *and* as a parsed numerator and
 *    denominator beside it. Both, because the string is what a reader checks and
 *    the pair is what a property can quantify over: R9.10 says "read verbatim", and
 *    an axis whose denominator nothing ever compared would be a figure with no
 *    denominator at all.
 * 2. **A value this module cannot read becomes `null`, never `0`.** A percentage
 *    outside `[0, 100]`, a non-finite one, a ratio that is not `n/m` — each is
 *    withheld. Zero on the proven axis is a claim that nothing is proven, and this
 *    module has no business making it on a payload it did not understand.
 * 3. **Nothing here decides the build's fate.** Zero projected rows is a fact this
 *    module reports; `enrichment.ts` owns the gate that turns it into
 *    `gaps-payload-unreadable`.
 *
 * And one rule that belongs to this payload alone. `pending[].ready_command` is a
 * literal `kane-cli design tests --use-case uc-1` string Kane composed. It is
 * projected as **text** and it is never anything else: the Ledger has no mutating
 * route (§9, R8.4), and a rendered control that spends credits would break that
 * outright. Nothing in this module or downstream of it executes the value, and the
 * field name says what it is rather than what it could do.
 */

/**
 * Risk bands, in the order the ribbon renders them (R9.12).
 *
 * Observed values, in descending severity: the recorded payload carries `high`,
 * `med` and `low`. A band this list does not know sorts **after** all three rather
 * than being dropped or silently re-labelled — an unrecognised risk is still a row
 * a reader is owed, and putting it last is the only placement that does not claim
 * to know how urgent it is.
 */
export const COVERAGE_RISK_BANDS: readonly string[] = Object.freeze(['high', 'med', 'low']);

/** Where a band outside {@link COVERAGE_RISK_BANDS} sorts: after every known one. */
export const UNKNOWN_RISK_RANK = COVERAGE_RISK_BANDS.length;

/** How deep {@link projectGaps} descends before it reports `truncated`. */
export const MAX_GAPS_WALK_DEPTH = 8;

/** Upper bound on projected use-case rows, so a hostile payload cannot exhaust memory. */
export const MAX_GAPS_ROWS = 2_000;

/**
 * An `n/m` ratio, kept as the string that arrived **and** as the pair it parses to.
 *
 * `text` is verbatim, which is what R9.10 asks for and what a reader checks against
 * the graph. `numerator` and `denominator` are the same fact in a form a property
 * can quantify over — a denominator nothing can read is a denominator nothing can
 * agree with. All three are null together when the payload carried no ratio, and
 * `text` may be present with the pair null when the string was not `n/m`: the
 * string is still what Kane said, and refusing to publish it because this module
 * could not parse it would lose information for no gain.
 */
export interface CoverageRatio {
  /** Verbatim, e.g. `6/6` or `1/9`. Null when the payload carried none. */
  readonly text: string | null;
  readonly numerator: number | null;
  /** At least 1 when present. A zero denominator is refused, never divided by. */
  readonly denominator: number | null;
}

/** The empty ratio: nothing arrived, and nothing is claimed. */
export const NO_COVERAGE_RATIO: CoverageRatio = Object.freeze({
  text: null,
  numerator: null,
  denominator: null,
});

/** One axis: a whole-number percentage and the ratio behind it. */
export interface CoverageAxisFigure {
  /** `0` to `100`, verbatim from the payload. Null when unreadable (rule 2). */
  readonly pct: number | null;
  readonly ratio: CoverageRatio;
}

/**
 * The design-completeness axis, plus the two figures that make it *debt*.
 *
 * `usecasesComplete` reads `1/9` on this repository and `ucsNeedingScenarios` reads
 * `8`. Those are carried because they are the honest number: the graph genuinely
 * owes eight use-case designs, and a ribbon that showed only `acs_designed: 6/6`
 * would report 100% of the criteria that exist while saying nothing about the ones
 * that do not. Both figures are published so the page can show the debt rather
 * than round it away.
 */
export interface CoverageDesignAxis extends CoverageAxisFigure {
  /** `usecases_complete`, verbatim. `1/9` today. */
  readonly usecasesComplete: CoverageRatio;
  /** `ucs_needing_scenarios`. `8` today. */
  readonly ucsNeedingScenarios: number | null;
}

/**
 * The proven axis: **acceptance criteria Kane's graph holds execution facts for.**
 *
 * Not promises. `metrics.provenCoverage` counts promises this repository verified,
 * over a different denominator and about different objects, and R9.15 exists
 * because the two will disagree. `source` and `denominatorBasis` are carried
 * verbatim (`graph_execution_facts` over `current_live_acs`) so the page can state
 * what this figure is counting rather than leaving a reader to assume.
 */
export interface CoverageProvenAxis extends CoverageAxisFigure {
  readonly failing: number | null;
  readonly blocked: number | null;
  readonly notRun: number | null;
  /** `proven.latest_run.execution_id` — this repository's own newest run. */
  readonly latestRunExecutionId: string | null;
  /** `proven.config.source`, verbatim. Observed: `graph_execution_facts`. */
  readonly source: string | null;
  /** `proven.config.denominator`, verbatim. Observed: `current_live_acs`. */
  readonly denominatorBasis: string | null;
}

/**
 * One pending item on a use-case row.
 *
 * `readyCommand` is text. See the note at the head of this section: it is a literal
 * `kane-cli …` string, it is published so a reader knows what would close the gap,
 * and nothing anywhere executes it or offers it as a control.
 */
export interface CoveragePendingItem {
  readonly kind: string | null;
  readonly why: string | null;
  readonly risk: string | null;
  readonly stage: string | null;
  readonly tag: string | null;
  /** A literal `kane-cli …` string. **Text only, never a control.** */
  readonly readyCommand: string | null;
}

/** A per-use-case axis: the percentage and the word Kane put on it. */
export interface CoverageRowAxis {
  readonly pct: number | null;
  /** e.g. `undesigned`, `complete`, `not_run`, `proven`. Verbatim, lowercased. */
  readonly status: string | null;
}

/** One row of the ribbon: a use case, both its axes, and what it still owes. */
export interface CoverageRow {
  readonly id: string;
  readonly title: string;
  /** Verbatim band, e.g. `high`. Null when the payload named none. */
  readonly risk: string | null;
  /** Index into {@link COVERAGE_RISK_BANDS}, or {@link UNKNOWN_RISK_RANK}. */
  readonly riskRank: number;
  readonly designCompleteness: CoverageRowAxis;
  readonly proven: CoverageRowAxis;
  readonly staleAcs: number | null;
  readonly pending: readonly CoveragePendingItem[];
}

/** Both axes and every row: the Coverage_Axes of R9.10 through R9.12. */
export interface CoverageAxes {
  readonly designCompleteness: CoverageDesignAxis;
  readonly proven: CoverageProvenAxis;
  /** One row per use case, ordered by risk band then identifier (R9.12). */
  readonly rows: readonly CoverageRow[];
}

/** What {@link projectGaps} made of a payload. */
export interface GapsProjection {
  readonly axes: CoverageAxes;
  /** Locations of use-case objects that carried no identifier. Reported, not fatal. */
  readonly refused: readonly string[];
  /** How many use-case objects were examined. */
  readonly examined: number;
  /** True when the depth or row bound stopped the walk. */
  readonly truncated: boolean;
}

const EMPTY_DESIGN_AXIS: CoverageDesignAxis = Object.freeze({
  pct: null,
  ratio: NO_COVERAGE_RATIO,
  usecasesComplete: NO_COVERAGE_RATIO,
  ucsNeedingScenarios: null,
});

const EMPTY_PROVEN_AXIS: CoverageProvenAxis = Object.freeze({
  pct: null,
  ratio: NO_COVERAGE_RATIO,
  failing: null,
  blocked: null,
  notRun: null,
  latestRunExecutionId: null,
  source: null,
  denominatorBasis: null,
});

/** Both axes withheld and no rows: what an unreadable payload projects to. */
export const NO_COVERAGE_AXES: CoverageAxes = Object.freeze({
  designCompleteness: EMPTY_DESIGN_AXIS,
  proven: EMPTY_PROVEN_AXIS,
  rows: Object.freeze([]) as readonly CoverageRow[],
});

const EMPTY_GAPS_PROJECTION: GapsProjection = Object.freeze({
  axes: NO_COVERAGE_AXES,
  refused: Object.freeze([]) as readonly string[],
  examined: 0,
  truncated: false,
});

/**
 * A whole-number percentage in `[0, 100]`, or null.
 *
 * Strings are accepted because the wire has already shown two typings of one field
 * elsewhere (`result_code` is a number at the top level and a string inside
 * `per_flow_metadata`), and a percentage that arrived as `"100"` is still a
 * percentage. Anything outside the closed interval is **withheld rather than
 * clamped**: a figure above 100 means the upstream count is wrong, and clamping it
 * to 100 would publish the wrong count as a right-looking number.
 */
export function readPercent(value: unknown): number | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isFinite(numeric)) return null;
  if (numeric < 0 || numeric > 100) return null;
  return numeric;
}

/** A non-negative integer count, or null. Never coerced from a bad value to zero. */
function readCount(value: unknown): number | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isInteger(numeric) || numeric < 0) return null;
  return numeric;
}

/** A non-empty trimmed string, or null. */
function readText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * An `n/m` ratio string, kept verbatim and parsed alongside (R9.10).
 *
 * A denominator of zero is refused: it is the one value that could reach a
 * division, and `0/0` is not a ratio. A numerator above the denominator is refused
 * too — `7/6` acceptance criteria proven is an upstream miscount, and publishing
 * the pair would let a property that checks "in range" pass on it.
 */
export function readCoverageRatio(value: unknown): CoverageRatio {
  const text = readText(value);
  if (text === null) return NO_COVERAGE_RATIO;
  const match = /^(\d+)\s*\/\s*(\d+)$/u.exec(text);
  if (match === null) return { text, numerator: null, denominator: null };
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    return { text, numerator: null, denominator: null };
  }
  if (denominator < 1 || numerator > denominator) {
    return { text, numerator: null, denominator: null };
  }
  return { text, numerator, denominator };
}

/** Where a band sorts. Unknown bands go after every known one, never first. */
export function coverageRiskRank(risk: string | null): number {
  if (risk === null) return UNKNOWN_RISK_RANK;
  const index = COVERAGE_RISK_BANDS.indexOf(risk);
  return index === -1 ? UNKNOWN_RISK_RANK : index;
}

/**
 * Compare two use-case identifiers the way a reader reads them.
 *
 * Digit runs compare numerically, so `uc-3` precedes `uc-10`. A plain lexicographic
 * compare would put `uc-10` second in the list and `uc-3` seventh, which is not
 * "ordered by identifier" to anyone looking at the page — it is ordered by
 * character code, and the two only agree while every identifier has the same digit
 * count. Ties fall back to a plain compare so the order is total.
 */
export function compareCoverageRowIds(left: string, right: string): number {
  const pattern = /(\d+)|(\D+)/gu;
  const l = left.match(pattern) ?? [];
  const r = right.match(pattern) ?? [];
  for (let index = 0; index < Math.min(l.length, r.length); index += 1) {
    const a = l[index] as string;
    const b = r[index] as string;
    const aNumeric = /^\d+$/u.test(a);
    const bNumeric = /^\d+$/u.test(b);
    if (aNumeric && bNumeric) {
      const difference = Number(a) - Number(b);
      if (difference !== 0) return difference < 0 ? -1 : 1;
      continue;
    }
    if (a !== b) return a < b ? -1 : 1;
  }
  if (l.length !== r.length) return l.length < r.length ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Canonical ribbon order: risk band first, then identifier (R9.12). */
export function compareCoverageRows(left: CoverageRow, right: CoverageRow): number {
  if (left.riskRank !== right.riskRank) return left.riskRank - right.riskRank;
  return compareCoverageRowIds(left.id, right.id);
}

/** Read one `pending[]` entry. Every field is optional and every absence is null. */
function projectPending(source: Record<string, unknown>): CoveragePendingItem {
  return {
    kind: readText(source['kind']),
    why: readText(source['why']),
    risk: readText(source['risk']),
    stage: readText(source['stage']),
    tag: readText(source['tag']),
    // Text. Read as a string, published as a string, executed by nothing.
    readyCommand: readText(source['ready_command'] ?? source['readyCommand']),
  };
}

/** Read a per-use-case axis block: `{pct, status}`. */
function projectRowAxis(value: unknown): CoverageRowAxis {
  if (!isPlainObject(value)) return { pct: null, status: null };
  const status = readText(value['status']);
  return {
    pct: readPercent(value['pct']),
    status: status === null ? null : status.toLowerCase(),
  };
}

/**
 * Read one use-case object, or refuse it for carrying no identifier.
 *
 * The identifier is the only required field: it is what the row is keyed and
 * ordered by, and a row nothing can name is a row nothing can be checked against.
 * Everything else — title, risk, both axes, the stale count, the pending list — is
 * absent-as-null, because a use case that has not been designed yet legitimately
 * has no proven percentage and a row that hid itself over that would hide the debt.
 */
function projectRow(source: Record<string, unknown>): CoverageRow | null {
  const id = readText(source['id']) ?? readText(source['ref']);
  if (id === null) return null;
  const risk = readText(source['risk']);
  const pending = Array.isArray(source['pending'])
    ? (source['pending'] as readonly unknown[])
        .filter(isPlainObject)
        .map((entry) => projectPending(entry))
    : [];
  return {
    id,
    title: readText(source['title']) ?? '',
    risk,
    riskRank: coverageRiskRank(risk),
    designCompleteness: projectRowAxis(source['design_completeness']),
    proven: projectRowAxis(source['proven']),
    staleAcs: readCount(source['stale_acs']),
    pending,
  };
}

/**
 * Find the `usecases` array by shape rather than by position.
 *
 * The recorded payload keeps it at `gaps.usecases`, and a reader that hard-coded
 * that path would over-fit one capture: an extra envelope level, a renamed key or a
 * wrapper would project zero rows, and zero rows is a *degraded build*. So the walk
 * is structural, exactly as the coverage walk above is, and it accepts the first
 * array whose members project to at least one row.
 *
 * The `other[]` list of the recorded payload is deliberately **not** a source of
 * rows. Its entries carry `ref`/`id` values like `gap-1` and a `question` block, and
 * they are corpus gaps rather than use cases — folding them into the ribbon would
 * publish five extra rows with both axes null and make the debt look like something
 * it is not. Ordering the search by key name is what keeps them out: `usecases` is
 * looked for first, by name, before the structural fallback runs.
 */
function findRows(payload: Record<string, unknown>): {
  readonly rows: readonly CoverageRow[];
  readonly refused: readonly string[];
  readonly examined: number;
  readonly truncated: boolean;
} {
  const refused: string[] = [];
  let examined = 0;
  let truncated = false;

  const readArray = (
    node: readonly unknown[],
    at: string,
  ): readonly CoverageRow[] => {
    const rows: CoverageRow[] = [];
    for (let index = 0; index < node.length; index += 1) {
      const member = node[index];
      if (!isPlainObject(member)) continue;
      examined += 1;
      if (rows.length >= MAX_GAPS_ROWS) {
        truncated = true;
        break;
      }
      const row = projectRow(member);
      if (row === null) refused.push(`${at}[${index}]`);
      else rows.push(row);
    }
    return rows;
  };

  // By name first, so the corpus-gap list can never be read as the use-case list.
  const named = payload['usecases'] ?? payload['use_cases'] ?? payload['useCases'];
  if (Array.isArray(named)) {
    const rows = readArray(named, 'gaps.usecases');
    if (rows.length > 0 || named.length > 0) {
      return { rows, refused, examined, truncated };
    }
  }

  // Structural fallback, for an envelope this capture does not show us.
  let found: readonly CoverageRow[] = [];
  const walk = (node: unknown, at: string, depth: number): void => {
    if (found.length > 0) return;
    if (depth > MAX_GAPS_WALK_DEPTH) {
      truncated = true;
      return;
    }
    if (Array.isArray(node)) {
      const rows = readArray(node, at);
      if (rows.length > 0) {
        found = rows;
        return;
      }
      for (let index = 0; index < node.length; index += 1) {
        walk(node[index], `${at}[${index}]`, depth + 1);
      }
      return;
    }
    if (!isPlainObject(node)) return;
    for (const key of Object.keys(node)) {
      // `other[]` is corpus gaps, not use cases. Never a source of rows.
      if (key === 'other') continue;
      walk(node[key], at.length === 0 ? key : `${at}.${key}`, depth + 1);
    }
  };
  walk(payload, '', 0);
  return { rows: found, refused, examined, truncated };
}

/**
 * Find a nested block by key anywhere in the payload, within the depth bound.
 *
 * `design_completeness` and `proven` sit at the top level of the recorded event, and
 * they are looked for structurally for the same reason the arrays are: this is one
 * capture of an undocumented shape, and an extra wrapper level must degrade the
 * *figure* to null rather than degrade the whole build.
 */
function findBlock(payload: unknown, key: string, depth = 0): Record<string, unknown> | null {
  if (depth > MAX_GAPS_WALK_DEPTH) return null;
  if (Array.isArray(payload)) {
    for (const member of payload) {
      const found = findBlock(member, key, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isPlainObject(payload)) return null;
  const direct = payload[key];
  if (isPlainObject(direct)) return direct;
  for (const name of Object.keys(payload)) {
    // Never descend into the per-use-case dossier: every row carries its own
    // `design_completeness` and `proven` block, and returning one of those as the
    // repository-wide axis would publish one use case's figure as the whole graph's.
    if (name === 'usecases' || name === 'use_cases' || name === 'useCases') continue;
    if (name === 'other') continue;
    const found = findBlock(payload[name], key, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Project the `gaps` payload into the Coverage_Axes (design §5.3.0, R9.10, R9.11).
 *
 * Total over every input, including `null`, a primitive and a deeply nested
 * document. Never throws. An input it cannot read projects to
 * {@link NO_COVERAGE_AXES} — both percentages withheld and no rows — which is what
 * `enrichment.ts` turns into `gaps-payload-unreadable`, because a visibly
 * baseline-only ledger beats a silently wrong proven number.
 */
export function projectGaps(payload: unknown): GapsProjection {
  if (!isPlainObject(payload)) return EMPTY_GAPS_PROJECTION;

  const design = findBlock(payload, 'design_completeness');
  const proven = findBlock(payload, 'proven');
  const provenConfig = proven === null ? null : findBlock(proven, 'config');
  const latestRun = proven === null ? null : findBlock(proven, 'latest_run');

  const designCompleteness: CoverageDesignAxis =
    design === null
      ? EMPTY_DESIGN_AXIS
      : {
          pct: readPercent(design['pct']),
          ratio: readCoverageRatio(design['acs_designed']),
          usecasesComplete: readCoverageRatio(design['usecases_complete']),
          ucsNeedingScenarios: readCount(design['ucs_needing_scenarios']),
        };

  const provenAxis: CoverageProvenAxis =
    proven === null
      ? EMPTY_PROVEN_AXIS
      : {
          pct: readPercent(proven['pct']),
          ratio: readCoverageRatio(proven['acs_proven']),
          failing: readCount(proven['failing']),
          blocked: readCount(proven['blocked']),
          notRun: readCount(proven['not_run']),
          latestRunExecutionId:
            latestRun === null ? null : readText(latestRun['execution_id']),
          source: provenConfig === null ? null : readText(provenConfig['source']),
          denominatorBasis:
            provenConfig === null ? null : readText(provenConfig['denominator']),
        };

  const { rows, refused, examined, truncated } = findRows(payload);

  return {
    axes: {
      designCompleteness,
      proven: provenAxis,
      // Canonical order here rather than at the render, so the snapshot carries the
      // order the page shows and the Ledger sorts nothing (R9.12, §9.2).
      rows: Object.freeze([...rows].sort(compareCoverageRows)),
    },
    refused,
    examined,
    truncated,
  };
}

/**
 * Do both axis ratios agree on a denominator?
 *
 * The live acceptance-criteria count is one number: `acs_designed` and `acs_proven`
 * are both `n/6` on this repository because both are counted over
 * `current_live_acs`. Two different denominators would mean the two axes are
 * measuring different populations while being shown side by side, which is the one
 * way a dual-axis ribbon can mislead without any single figure being wrong.
 *
 * Answers null when either denominator is absent — that is "no claim", not
 * "disagreement", and the caller withholds rather than reporting a mismatch it
 * cannot substantiate.
 */
export function coverageAxesDenominator(axes: CoverageAxes): number | null {
  const designed = axes.designCompleteness.ratio.denominator;
  const proven = axes.proven.ratio.denominator;
  if (designed === null || proven === null) return null;
  return designed === proven ? designed : null;
}

/**
 * Structural guard for a {@link CoverageAxes} value read back off disk.
 *
 * Recognition rather than validation, on the same terms as `isPromiseGraph`: the
 * authority on a coverage-axes value is `SnapshotCoverageAxesSchema` (§9.1), and
 * this is the cheap in-process check `.kept/state.json` is loaded through so that
 * axes this build cannot read never reach the snapshot writer.
 *
 * Every field is required to be *present*, `null` included, because the state file
 * is written by `serialiseSnapshot`'s sibling path and a dropped key means the value
 * was produced by something other than this build. `rows` must be non-empty for the
 * same reason the schema requires it: an axes value with no rows is the withheld
 * state, and the withheld state is spelled `null`.
 */
export function isCoverageAxes(value: unknown): value is CoverageAxes {
  if (!isPlainObject(value)) return false;
  const design = value['designCompleteness'];
  const proven = value['proven'];
  const rows = value['rows'];
  if (!isPlainObject(design) || !isPlainObject(proven)) return false;
  if (!isRatio(design['ratio']) || !isRatio(design['usecasesComplete'])) return false;
  if (!isRatio(proven['ratio'])) return false;
  if (!isNullableNumber(design['pct']) || !isNullableNumber(proven['pct'])) return false;
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.every((row) => isCoverageRow(row));
}

function isNullableNumber(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isRatio(value: unknown): value is CoverageRatio {
  if (!isPlainObject(value)) return false;
  return (
    isNullableString(value['text']) &&
    isNullableNumber(value['numerator']) &&
    isNullableNumber(value['denominator'])
  );
}

function isRowAxis(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return isNullableNumber(value['pct']) && isNullableString(value['status']);
}

function isCoverageRow(value: unknown): value is CoverageRow {
  if (!isPlainObject(value)) return false;
  if (typeof value['id'] !== 'string' || value['id'].length === 0) return false;
  if (typeof value['title'] !== 'string') return false;
  if (!isNullableString(value['risk'])) return false;
  if (typeof value['riskRank'] !== 'number') return false;
  if (!isRowAxis(value['designCompleteness']) || !isRowAxis(value['proven'])) return false;
  if (!isNullableNumber(value['staleAcs'])) return false;
  const pending = value['pending'];
  if (!Array.isArray(pending)) return false;
  return pending.every(
    (item) =>
      isPlainObject(item) &&
      isNullableString(item['kind']) &&
      isNullableString(item['why']) &&
      isNullableString(item['risk']) &&
      isNullableString(item['stage']) &&
      isNullableString(item['tag']) &&
      isNullableString(item['readyCommand']),
  );
}
