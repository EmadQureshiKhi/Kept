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
