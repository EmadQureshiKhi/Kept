/**
 * The blast radius (design §7.1, §7.3, R4.2, R4.3, R4.5).
 *
 * The chain, and the one authority in it:
 *
 * ```
 * changed paths (from the hook)
 *   → tests whose frontmatter `covers:` globs match a changed path   [authored metadata]
 *   → promises whose designedTest.path is one of those tests
 *   → test_id for each of those tests, from testrun_plan.members[]   [KANE IS AUTHORITY]
 *   → kane-cli testrun run --from-context <ids>
 * ```
 *
 * ## Identifiers come from the plan, and from nowhere else
 *
 * Every identifier this module returns is a `testId` read off a
 * {@link TestrunPlan} member (R4.3, R4.4). Not derived from the document's
 * filename, not read from its frontmatter, not taken from a promise's
 * `designedTest.testId`, not synthesised from a member's position in the plan.
 * Three structural choices make that hard to undo rather than merely true today:
 *
 * 1. {@link collectTestCoverage} — the only thing in this module that reads a
 *    `*_test.md` — returns **`path` and `covers` only**. It reads the frontmatter
 *    through the baseline provider's reader, which does surface `test_id`, and
 *    then deliberately drops it. A future refactor cannot start trusting
 *    frontmatter ids without first widening a return type, in a file whose whole
 *    header says not to.
 * 2. {@link computeBlastRadius} takes the plan as a parameter and has no
 *    filesystem, no invoker and no fallback. With `plan: null` it answers zero
 *    identifiers, because "Kane has not told us the ids" and "we can guess the
 *    ids" are different states and only one of them is honest.
 * 3. A member present in the plan **without** a `testId` is excluded and
 *    diagnosed, listed in `skippedNoTestId` — never given an id by inference.
 *
 * ## An empty radius is the common case and must cost nothing
 *
 * A changed path no test covers yields **zero** identifiers, and a radius with
 * zero identifiers means **no Kane invocation at all** (R4.5): the caller checks
 * {@link shouldInvokeKane}, exits 0, and one `radius-path-uncovered` diagnostic is
 * recorded per uncovered path so a reviewer sees exactly which edit nothing
 * verifies. Most edits in a repository are of that kind, and a loop that spent a
 * process on each of them would be abandoned within a day.
 *
 * ## Glob matching, hand-rolled
 *
 * `covers:` globs are matched by {@link matchesGlob}: literal segments, `*` within
 * one segment, `**` across any number of segments, over repository-relative POSIX
 * paths. There is no `micromatch` — the runtime dependency budget of design §2.2
 * is closed at nine packages and it is not one of them. The grammar is
 * deliberately small; what it does not do is treat a bare directory path as a
 * prefix, so `apps/fixture/app/cart` matches that path and nothing beneath it,
 * and a document that means the subtree writes `apps/fixture/app/cart/**` — as the
 * committed corpus does.
 */

import type { Diagnostic, DiagnosticDraft, DiagnosticSink } from '../diagnostics.js';
import { createDiagnosticSink } from '../diagnostics.js';
import { toPosix } from '../model/ids.js';
import type { PromiseGraph } from '../model/promise.js';
import { readDocumentCovers } from '../providers/baseline.js';

import type { PlanMember, TestrunPlan } from './plan.js';

/** Diagnostic codes this module reports. Stable strings; the Ledger keys off them. */
export const RADIUS_DIAGNOSTIC_CODES = Object.freeze({
  /** No designed test covers a changed path (R4.5). One per uncovered path. */
  pathUncovered: 'radius-path-uncovered',
  /** A covering test is present in the plan but carries no `test_id` (R4.3). */
  memberNoTestId: 'radius-member-no-test-id',
  /** A covering test is absent from the plan, so Kane knows no id for it. */
  testAbsentFromPlan: 'radius-test-absent-from-plan',
  /** There is no plan at all, so no identifier can be derived from one. */
  planUnavailable: 'radius-plan-unavailable',
  /** The radius is empty, so no Kane process is started. */
  empty: 'radius-empty',
  /** A `*_test.md` could not be read while collecting its `covers:` globs. */
  coversUnreadable: 'radius-covers-unreadable',
  /** A `*_test.md` declares no `covers:` globs, so no edit can select it. */
  coversAbsent: 'radius-covers-absent',
} as const);

/** Every code above, for tests and for the Ledger's filter list. */
export const RADIUS_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(RADIUS_DIAGNOSTIC_CODES),
);

// ---------------------------------------------------------------------------
// The glob matcher (design §7.3)
// ---------------------------------------------------------------------------

/** Does `pattern` match `segment`, with `*` standing for any run of characters? */
function matchSegment(pattern: string, segment: string): boolean {
  if (!pattern.includes('*')) return pattern === segment;
  const parts = pattern.split('*');
  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  if (!segment.startsWith(first) || !segment.endsWith(last)) return false;
  // The head and the tail may not overlap: `a*a` does not match `a`.
  if (first.length + last.length > segment.length) return false;
  let at = first.length;
  for (let index = 1; index < parts.length - 1; index += 1) {
    const part = parts[index] as string;
    if (part.length === 0) continue;
    const found = segment.indexOf(part, at);
    if (found < 0 || found + part.length > segment.length - last.length) return false;
    at = found + part.length;
  }
  return true;
}

/** Segment-wise match, with `**` consuming zero or more whole segments. */
function matchFrom(pattern: readonly string[], path: readonly string[]): boolean {
  if (pattern.length === 0) return path.length === 0;
  const head = pattern[0] as string;
  const rest = pattern.slice(1);
  if (head === '**') {
    for (let skip = 0; skip <= path.length; skip += 1) {
      if (matchFrom(rest, path.slice(skip))) return true;
    }
    return false;
  }
  const segment = path[0];
  if (segment === undefined) return false;
  return matchSegment(head, segment) && matchFrom(rest, path.slice(1));
}

/** Split a repository-relative POSIX path into its non-empty segments. */
function segmentsOf(value: string): readonly string[] {
  return toPosix(value)
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.');
}

/**
 * Whether `path` matches `pattern`, both repository-relative POSIX.
 *
 * Supports literal segments, `*` inside one segment and `**` across any number of
 * segments including none — so `apps/**` matches `apps/x`, `apps/x/y` and `apps`
 * itself. Case-sensitive, like the `covers:` entries and like CI.
 */
export function matchesGlob(pattern: string, path: string): boolean {
  const patternSegments = segmentsOf(pattern);
  const pathSegments = segmentsOf(path);
  if (patternSegments.length === 0 || pathSegments.length === 0) return false;
  return matchFrom(patternSegments, pathSegments);
}

/** Whether any of `patterns` matches `path`. Empty list matches nothing. */
export function matchesAnyGlob(patterns: readonly string[], path: string): boolean {
  return patterns.some((pattern) => matchesGlob(pattern, path));
}

// ---------------------------------------------------------------------------
// `covers:` collection
// ---------------------------------------------------------------------------

/**
 * What a `*_test.md` contributes to radius selection: its path and its `covers:`
 * globs. **Deliberately not its `test_id`** — see the module header.
 */
export interface TestCoverage {
  /** Repository-relative POSIX path of the `*_test.md`. */
  readonly path: string;
  /** The frontmatter `covers:` globs, POSIX-normalised, in document order. */
  readonly covers: readonly string[];
}

/** The narrowest read seam that will do. `BaselineFileSystem` satisfies it. */
export interface TestDocumentSource {
  /** Repository-relative read, or null when the file cannot be read. */
  readFile(path: string): string | null;
}

/** What {@link collectTestCoverage} takes. */
export interface CollectTestCoverageRequest {
  readonly source: TestDocumentSource;
  /** The `*_test.md` paths to read — from the baseline scan, or from the plan. */
  readonly paths: readonly string[];
  readonly sink?: DiagnosticSink | undefined;
}

/** Split for the frontmatter reader: `\r\n` and `\n` both terminate. */
function documentLines(content: string): readonly string[] {
  const text = content.startsWith('\ufeff') ? content.slice(1) : content;
  const parts = text.split('\n');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

/**
 * Read the `covers:` globs of each test document.
 *
 * Uses the baseline provider's own reader rather than a second parser, so the two
 * can never disagree about what a document declares — and discards the id that
 * reader also surfaces, because it is a cache and the plan is the authority
 * (§3.4, R4.4).
 *
 * Both homes for the globs are read: the root frontmatter `covers:` key, and the
 * `<!-- @covers a, b -->` body annotation the committed corpus uses because
 * `covers` is not a frontmatter key `kane-cli` accepts.
 *
 * Total. An unreadable document and a document with no `covers:` are both
 * diagnosed and contribute an entry with no globs, which selects nothing.
 */
export function collectTestCoverage(
  request: CollectTestCoverageRequest,
): readonly TestCoverage[] {
  const sink = request.sink;
  const seen = new Set<string>();
  const collected: TestCoverage[] = [];

  for (const raw of request.paths) {
    const path = toPosix(typeof raw === 'string' ? raw.trim() : '');
    if (path.length === 0 || seen.has(path)) continue;
    seen.add(path);

    let content: string | null;
    try {
      content = request.source.readFile(path);
    } catch {
      content = null;
    }
    if (content === null) {
      sink?.report({
        code: RADIUS_DIAGNOSTIC_CODES.coversUnreadable,
        severity: 'warn',
        message:
          `${path} could not be read, so its \`covers:\` globs are unknown and no changed ` +
          `file can select it for verification.`,
        file: path,
        line: null,
      });
      collected.push({ path, covers: Object.freeze([]) });
      continue;
    }

    const covers = readDocumentCovers(documentLines(content))
      .map((glob) => toPosix(glob.trim()))
      .filter((glob) => glob.length > 0);

    if (covers.length === 0) {
      sink?.report({
        code: RADIUS_DIAGNOSTIC_CODES.coversAbsent,
        severity: 'info',
        message:
          `${path} declares no \`covers:\` globs, so no source edit selects it: it runs only ` +
          `under \`kept verify --all\`.`,
        file: path,
        line: null,
      });
    }
    collected.push({ path, covers: Object.freeze(covers) });
  }

  return Object.freeze(collected);
}

// ---------------------------------------------------------------------------
// Radius computation (design §7.3)
// ---------------------------------------------------------------------------

/** The selected set, plus everything that was deliberately left out of it. */
export interface BlastRadius {
  /**
   * Deduped, sorted, and a **subset of the plan's member ids** — the identifiers
   * handed to `kane-cli testrun run --from-context` (R4.2, R4.3).
   */
  readonly testIds: readonly string[];
  /** Promises verified by a selected test. The only promises a run may move. */
  readonly promiseIds: readonly string[];
  /** Test documents a changed path selected, whether or not they yielded an id. */
  readonly coveringTests: readonly string[];
  /** Selected test paths present in the plan with no `test_id` (R4.3). */
  readonly skippedNoTestId: readonly string[];
  /** Changed paths no designed test covers (R4.5). */
  readonly unmatchedPaths: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
}

/** What {@link computeBlastRadius} takes. Pure: no filesystem, no process. */
export interface BlastRadiusRequest {
  /** Changed paths from the hook. Absolute paths are relativised when possible. */
  readonly changed: readonly string[];
  readonly graph: PromiseGraph;
  /** Kane's plan. `null` yields zero identifiers, never a guess (R4.4). */
  readonly plan: TestrunPlan | null;
  /** `covers:` globs per test document, from {@link collectTestCoverage}. */
  readonly covers: readonly TestCoverage[];
  /** Used only to relativise an absolute changed path. */
  readonly repoRoot?: string | undefined;
  readonly sink?: DiagnosticSink | undefined;
}

/** Best-effort normalisation of a hook-supplied path to repository-relative POSIX. */
export function normaliseChangedPath(value: string, repoRoot?: string | undefined): string {
  let path = toPosix(typeof value === 'string' ? value.trim() : '');
  if (repoRoot !== undefined) {
    const root = toPosix(repoRoot).replace(/\/+$/, '');
    if (root.length > 0 && path.startsWith(`${root}/`)) path = path.slice(root.length + 1);
  }
  while (path.startsWith('./')) path = path.slice(2);
  return path.replace(/^\/+/, '');
}

/**
 * Compute the blast radius (§7.3).
 *
 * Deterministic and pure. It starts no process and reads no file: an identifier
 * can only come from the `plan` it was handed, which is what makes "no
 * identifier was synthesised" checkable by reading one function.
 *
 * Blank changed paths are ignored, duplicates collapse to one entry, and every
 * remaining path that no `covers:` glob matches is reported exactly once as
 * `radius-path-uncovered` — the diagnostic R4.5 requires.
 */
export function computeBlastRadius(request: BlastRadiusRequest): BlastRadius {
  const sink = request.sink ?? createDiagnosticSink();
  const diagnostics: Diagnostic[] = [];
  const report = (draft: DiagnosticDraft): void => {
    diagnostics.push(sink.report(draft));
  };

  const changed: string[] = [];
  const seenChanged = new Set<string>();
  for (const raw of request.changed) {
    const path = normaliseChangedPath(raw, request.repoRoot);
    if (path.length === 0 || seenChanged.has(path)) continue;
    seenChanged.add(path);
    changed.push(path);
  }

  const coveringTests = new Set<string>();
  const unmatchedPaths: string[] = [];
  for (const path of changed) {
    const covering = request.covers.filter((entry) => matchesAnyGlob(entry.covers, path));
    if (covering.length === 0) {
      unmatchedPaths.push(path);
      report({
        code: RADIUS_DIAGNOSTIC_CODES.pathUncovered,
        severity: 'info',
        message: `no designed test covers ${path}`,
        file: path,
        line: null,
      });
      continue;
    }
    for (const entry of covering) coveringTests.add(entry.path);
  }

  const selectedTests: string[] = [];
  const skippedNoTestId: string[] = [];
  const testIds = new Set<string>();
  const orderedCovering = [...coveringTests].sort();

  if (request.plan === null) {
    if (orderedCovering.length > 0) {
      report({
        code: RADIUS_DIAGNOSTIC_CODES.planUnavailable,
        severity: 'warn',
        message:
          `${orderedCovering.length} test document(s) cover the changed files, but there is no ` +
          `testrun plan to read their assurance-graph identifiers from, and an identifier is ` +
          `never inferred from a path. Nothing is handed to Kane.`,
        file: null,
        line: null,
      });
    }
  } else {
    const members = new Map<string, PlanMember>();
    for (const member of request.plan.members) members.set(toPosix(member.path), member);

    for (const testPath of orderedCovering) {
      const member = members.get(testPath);
      if (member === undefined) {
        report({
          code: RADIUS_DIAGNOSTIC_CODES.testAbsentFromPlan,
          severity: 'warn',
          message:
            `${testPath} covers a changed file but is absent from the testrun plan, so Kane ` +
            `knows no identifier for it and it is excluded from the blast radius.`,
          file: testPath,
          line: null,
        });
        continue;
      }
      if (member.testId === null) {
        skippedNoTestId.push(testPath);
        report({
          code: RADIUS_DIAGNOSTIC_CODES.memberNoTestId,
          severity: 'warn',
          message:
            `${testPath} is in the testrun plan with no test_id${
              member.failure === null ? '' : ` (${member.failure})`
            }, so it is excluded from the blast radius: an identifier is only ever taken from ` +
            `the plan, never guessed from a path or a filename.`,
          file: testPath,
          line: null,
        });
        continue;
      }
      selectedTests.push(testPath);
      testIds.add(member.testId);
    }
  }

  const selected = new Set(selectedTests);
  const promiseIds = new Set<string>();
  for (const promise of request.graph.promises) {
    const designed = promise.designedTest;
    if (designed === null) continue;
    if (selected.has(toPosix(designed.path))) promiseIds.add(promise.id);
  }

  if (testIds.size === 0) {
    report({
      code: RADIUS_DIAGNOSTIC_CODES.empty,
      severity: 'info',
      message:
        `The blast radius is empty${
          changed.length === 0 ? '' : ` for ${changed.length} changed path(s)`
        }, so no Kane process is started and every existing verdict is preserved.`,
      file: null,
      line: null,
    });
  }

  return Object.freeze({
    testIds: Object.freeze([...testIds].sort()),
    promiseIds: Object.freeze([...promiseIds].sort()),
    coveringTests: Object.freeze(orderedCovering),
    skippedNoTestId: Object.freeze(skippedNoTestId),
    unmatchedPaths: Object.freeze(unmatchedPaths),
    diagnostics: Object.freeze(diagnostics),
  });
}

/**
 * Whether a Kane process should be started for this radius.
 *
 * The statement of R4.5, in one place: zero identifiers means zero invocations.
 * Callers ask this rather than testing `testIds.length` themselves, so the rule
 * has one home and `kept verify` cannot drift from it.
 */
export function shouldInvokeKane(radius: BlastRadius): boolean {
  return radius.testIds.length > 0;
}
