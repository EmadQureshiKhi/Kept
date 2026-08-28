/**
 * `.kept/config.json` — the one committed file under `.kept/` (design §13.1,
 * §6.4, and the `!.kept/config.json` negation in `.gitignore`).
 *
 * Everything else under `.kept/` is regenerable single-writer state. This file is
 * configuration and is reviewable in history, because it carries the one string
 * the verdict spike is allowed to change:
 *
 * ```json
 * { "verdictRouter": "resultCode740", "memberDebug": false,
 *   "timeouts": { "hookMs": 300000, "enrichmentMs": 60000 } }
 * ```
 *
 * Two rules govern this module.
 *
 * **The committed file is the authority; the constants below are the fallback.**
 * `timeouts.enrichmentMs` deliberately has no default inside
 * `providers/enrichment.ts` — a default there would be a second home for the 60 s
 * budget, which is why the provider is a factory that takes the number. This is
 * the *first* home: the value a caller passes comes from here, and here reads the
 * committed file. {@link DEFAULT_CONFIG} exists only for a tree where the file was
 * deleted, and every use of it is announced by a diagnostic naming the field, so
 * "the config was missing" never looks like "the config said this".
 *
 * **A malformed config is a state of the world, not a programming error.**
 * `kept build` on a repository whose config is truncated mid-key must still
 * produce a ledger from the baseline provider (§14.2, R2.12), so every field is
 * read defensively and a bad one falls back with a `warn`. Nothing here throws.
 *
 * ## The portability keys, and the one dangerous one (§20.1, R15.1)
 *
 * `corpus.root`, `subject.source`, `subject.docs`, `subject.baseUrl`,
 * `timeouts.doctorMs` and `fences.<branch>.allow` are the values that used to be
 * literals in four different modules. Every one of them is optional, every one
 * resolves to the fail-closed default of §20.4, and every applied default is
 * announced with `config-default-applied` naming the key and the value used: a
 * tool that silently invents a corpus root scans the wrong directory and reports
 * zero promises, and "zero promises" is indistinguishable from "your repository
 * makes no claims" unless the diagnostic says where it looked.
 *
 * `fences` is the dangerous one, and it is read to a different standard. It
 * declares only `allow`, {@link derivedForbidden} computes the other half, and
 * {@link fenceFindings} decides at load time whether a `code-break` allow glob can
 * reach the corpus or the documentation. When it can, that branch's allow set is
 * emptied and `config-fence-intersects-claims` is reported at `error`. The
 * refusal is an empty set rather than an exception because nothing in this module
 * throws: the branch keeps its verdict and loses its autonomy, which is the
 * narrowest refusal that still makes the fence unbreakable (§20.3, R15.8).
 *
 * The zod shape §20.1 sketches is deliberately **not** how this is implemented. A
 * schema validator answers "this document is invalid" for the whole file, and this
 * loader's contract is the opposite: read every field on its own, fall back on its
 * own, and name it on its own, so one bad key never costs a ledger.
 */

import type {
  CollectingDiagnosticSink,
  Diagnostic,
  DiagnosticSink,
  FenceSurfaces,
} from 'kept-core';
import { createDiagnosticSink, matchesGlob, type StateFileSystem } from 'kept-core';

/** Where the config lives, relative to the repository root. */
export const CONFIG_FILE_RELATIVE_PATH = '.kept/config.json';

/** The two routers of design §6.4. Exactly these; `--router` accepts no other. */
export const VERDICT_ROUTER_NAMES = Object.freeze([
  'resultCode740',
  'failureYamlTriage',
] as const);

/** One router name. */
export type VerdictRouterName = (typeof VERDICT_ROUTER_NAMES)[number];

/** Is this string one of the two routers? */
export function isVerdictRouterName(value: unknown): value is VerdictRouterName {
  return typeof value === 'string' && (VERDICT_ROUTER_NAMES as readonly string[]).includes(value);
}

/**
 * The three repair branches, as this file spells them (design §8.1, §20.1).
 *
 * Named here rather than imported from the core's `REPAIR_BRANCHES` because these
 * are *key names in a JSON document a stranger types by hand*. If the branch
 * vocabulary ever gains a member, the config key set is a separate decision from
 * the router's, and a shared constant would make that decision silently.
 */
export type RepairBranchName = 'code-break' | 'test-drift' | 'docs-lie';

/** The branch keys `fences` accepts, in the order diagnostics report them. */
export const REPAIR_BRANCH_NAMES: readonly RepairBranchName[] = Object.freeze([
  'code-break',
  'test-drift',
  'docs-lie',
] as const);

/** The Kane and doctor budgets, in milliseconds (design §13.1 timeout column). */
export interface KeptTimeouts {
  /** Hook-path budget: `verify`, `reconcile`, `evolve`. 300 000. */
  readonly hookMs: number;
  /** Enrichment budget: `cover --json`. 60 000. */
  readonly enrichmentMs: number;
  /** `kept doctor` budget (R18.2). 10 000. */
  readonly doctorMs: number;
}

/** Where the promise corpus lives in this repository (design §20.1). */
export interface KeptCorpus {
  /** Repository-relative POSIX directory the baseline provider scans. */
  readonly root: string;
}

/** The repository under test: its source, its documentation, its origin. */
export interface KeptSubject {
  /** Globs a `code-break` repair may be fenced into. Empty means no autonomy. */
  readonly source: readonly string[];
  /** Globs that may state a claim. A repair may never edit one of these. */
  readonly docs: readonly string[];
  /** Origin the reachability probe uses, or null for "not configured". */
  readonly baseUrl: string | null;
}

/**
 * One branch's fence, as configuration.
 *
 * `allow` and nothing else. The forbidden set is {@link derivedForbidden}, because
 * a fence a user can spell is a fence a user can leave a hole in, and a hole in
 * this one fence is the failure mode that would make the project worthless
 * (design §7.1, §20.1).
 */
export interface KeptFence {
  readonly allow: readonly string[];
}

/** The config, every field present. */
export interface KeptConfig {
  readonly verdictRouter: VerdictRouterName;
  readonly memberDebug: boolean;
  readonly timeouts: KeptTimeouts;
  readonly corpus: KeptCorpus;
  readonly subject: KeptSubject;
  readonly fences: Readonly<Record<RepairBranchName, KeptFence>>;
}

/**
 * The fallback for a tree with no `.kept/config.json`. Every use is diagnosed, so
 * this is never silently in force.
 *
 * Every default here fails *closed* (design §20.4). An empty `subject.source` is
 * an empty blast radius, which is honest; a guessed `src/**` would fence a repair
 * into a directory that may not exist. An empty `allow` grants no autonomy until
 * autonomy is granted on purpose. A null `baseUrl` reports "not configured"
 * rather than probing a port on a stranger's machine.
 */
export const DEFAULT_CONFIG: KeptConfig = Object.freeze({
  verdictRouter: 'resultCode740',
  memberDebug: false,
  timeouts: Object.freeze({ hookMs: 300_000, enrichmentMs: 60_000, doctorMs: 10_000 }),
  corpus: Object.freeze({ root: 'tests' }),
  subject: Object.freeze({
    source: Object.freeze([] as readonly string[]),
    docs: Object.freeze(['README.md'] as readonly string[]),
    baseUrl: null,
  }),
  fences: Object.freeze({
    'code-break': Object.freeze({ allow: Object.freeze([] as readonly string[]) }),
    'test-drift': Object.freeze({ allow: Object.freeze([] as readonly string[]) }),
    'docs-lie': Object.freeze({ allow: Object.freeze([] as readonly string[]) }),
  }),
});

/**
 * Both package roots, forbidden to every branch.
 *
 * A repair that edits the engine is a repair that changes the meaning of the
 * verdict it was answering, so this glob is in every derived forbidden set and is
 * never configurable.
 */
export const PACKAGE_ROOT_GLOB = 'packages/**';

/** Diagnostic codes this module reports. Stable; the Ledger keys off them. */
export const CONFIG_DIAGNOSTIC_CODES = Object.freeze({
  absent: 'config-absent',
  unreadable: 'config-unreadable',
  fieldInvalid: 'config-field-invalid',
  routerOverride: 'config-router-override',
  routerOverrideInvalid: 'config-router-override-invalid',
  defaultApplied: 'config-default-applied',
  fenceForbidRejected: 'config-fence-forbid-rejected',
  fenceIntersectsClaims: 'config-fence-intersects-claims',
} as const);

/** The codes as a list, so a test can enumerate them. */
export const CONFIG_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(CONFIG_DIAGNOSTIC_CODES),
);

// ---------------------------------------------------------------------------
// Glob intersection: the fence guard's decision procedure (design §20.3)
// ---------------------------------------------------------------------------

/**
 * The one segment a witness path invents when both globs will take anything.
 *
 * A witness is a *concrete path*, not a pattern, because the guard's answer has to
 * be checkable: every finding this module reports is backed by a path that
 * `matchesGlob` confirms both globs match. That is what keeps the guard from
 * refusing a config on a hunch.
 */
const WITNESS_SEGMENT = 'x';

/** Repository-relative POSIX segments, with `.` dropped and `..` collapsed. */
function globSegments(glob: string): readonly string[] {
  const raw = glob
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.');
  const stack: string[] = [];
  for (const segment of raw) {
    const previous = stack[stack.length - 1];
    // `**/..` is not collapsible: `**` may stand for zero segments, so the parent
    // it walks out of is unknown. Only a literal segment is popped, and anything
    // else leaves the `..` in place for {@link escapesRepositoryRoot} to condemn.
    if (
      segment === '..' &&
      previous !== undefined &&
      previous !== '..' &&
      previous !== '**' &&
      !previous.includes('*')
    ) {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack;
}

/**
 * Does a `..` survive collapsing?
 *
 * Such a glob leaves the repository root, and a glob that leaves the root can
 * re-enter it anywhere, including the corpus. The guard cannot bound where it
 * lands, so it treats it as reaching everything. Fail closed: the alternative is
 * a fence whose escape hatch is three characters wide.
 */
function escapesRepositoryRoot(glob: string): boolean {
  return globSegments(glob).includes('..');
}

/** A concrete segment that `pattern` matches, for a `**` that has to absorb one. */
function concreteSegment(pattern: string): string {
  return pattern.includes('*') ? pattern.split('*').join(WITNESS_SEGMENT) : pattern;
}

/** Is every character from `from` onwards a `*`? Then the pattern accepts nothing. */
function onlyStars(pattern: string, from: number): boolean {
  for (let index = from; index < pattern.length; index += 1) {
    if (pattern[index] !== '*') return false;
  }
  return true;
}

/**
 * A concrete segment matched by both single-segment patterns, or null.
 *
 * Memoised on the index pair so a pattern like `a*a*a*a*b` cannot make the guard
 * exponential. A guard that can be made slow by a config file is a guard a config
 * file can switch off.
 */
function segmentWitness(left: string, right: string): string | null {
  const memo = new Map<number, string | null>();
  const walk = (i: number, j: number): string | null => {
    const key = i * (right.length + 1) + j;
    if (memo.has(key)) return memo.get(key) ?? null;
    const answer = compute(i, j);
    memo.set(key, answer);
    return answer;
  };
  const compute = (i: number, j: number): string | null => {
    if (i >= left.length && j >= right.length) return '';
    if (i >= left.length) return onlyStars(right, j) ? '' : null;
    if (j >= right.length) return onlyStars(left, i) ? '' : null;
    const a = left[i] as string;
    const b = right[j] as string;
    if (a === '*') {
      const zero = walk(i + 1, j);
      if (zero !== null) return zero;
      if (b === '*') return walk(i, j + 1);
      const absorbed = walk(i, j + 1);
      return absorbed === null ? null : b + absorbed;
    }
    if (b === '*') {
      const zero = walk(i, j + 1);
      if (zero !== null) return zero;
      const absorbed = walk(i + 1, j);
      return absorbed === null ? null : a + absorbed;
    }
    return a === b ? prefixed(a, walk(i + 1, j + 1)) : null;
  };
  return walk(0, 0);
}

/** `head + tail`, or null when there was no tail. */
function prefixed(head: string, tail: string | null): string | null {
  return tail === null ? null : head + tail;
}

/**
 * Segments of a path both glob segment lists match, or null.
 *
 * Same recursion as the core matcher, run against a second *pattern* instead of a
 * path: a `**` either stands for nothing or absorbs one segment of the other side
 * and the witness records what it absorbed.
 */
function pathWitness(left: readonly string[], right: readonly string[]): readonly string[] | null {
  const memo = new Map<number, readonly string[] | null>();
  const walk = (i: number, j: number): readonly string[] | null => {
    const key = i * (right.length + 1) + j;
    if (memo.has(key)) return memo.get(key) ?? null;
    const answer = compute(i, j);
    memo.set(key, answer);
    return answer;
  };
  const compute = (i: number, j: number): readonly string[] | null => {
    if (i >= left.length && j >= right.length) return [];
    if (i >= left.length) return right.slice(j).every((s) => s === '**') ? [] : null;
    if (j >= right.length) return left.slice(i).every((s) => s === '**') ? [] : null;
    const a = left[i] as string;
    const b = right[j] as string;
    if (a === '**') {
      const zero = walk(i + 1, j);
      if (zero !== null) return zero;
      if (b === '**') return walk(i, j + 1);
      const absorbed = walk(i, j + 1);
      return absorbed === null ? null : [concreteSegment(b), ...absorbed];
    }
    if (b === '**') {
      const zero = walk(i, j + 1);
      if (zero !== null) return zero;
      const absorbed = walk(i + 1, j);
      return absorbed === null ? null : [concreteSegment(a), ...absorbed];
    }
    const segment = segmentWitness(a, b);
    if (segment === null) return null;
    const rest = walk(i + 1, j + 1);
    if (rest === null) return null;
    // An empty witness segment means both patterns were made only of `*`, which
    // also accept a non-empty one. A path cannot carry an empty segment.
    return [segment.length === 0 ? WITNESS_SEGMENT : segment, ...rest];
  };
  return walk(0, 0);
}

/**
 * A concrete path both globs match, or null when no such path exists.
 *
 * The witness is verified with the repository's own {@link matchesGlob}, the same
 * thirty lines the blast radius uses (design §3.18, §7.3). There is no second glob
 * grammar in this repository and there is no `micromatch` in the dependency budget
 * of §2.2, so the guard cannot answer a question about `apps/**` differently from
 * the code that later enforces it.
 */
function intersectionWitness(left: string, right: string): string | null {
  if (escapesRepositoryRoot(left) || escapesRepositoryRoot(right)) return null;
  const leftSegments = globSegments(left);
  const rightSegments = globSegments(right);
  // The matcher never matches with an empty pattern or an empty path, so neither
  // can appear in a witness.
  if (leftSegments.length === 0 || rightSegments.length === 0) return null;
  const segments = pathWitness(leftSegments, rightSegments);
  if (segments === null) return null;
  const witness = (segments.length === 0 ? [WITNESS_SEGMENT] : segments).join('/');
  const leftGlob = leftSegments.join('/');
  const rightGlob = rightSegments.join('/');
  if (!matchesGlob(leftGlob, witness) || !matchesGlob(rightGlob, witness)) return null;
  return witness;
}

/**
 * One way a branch's allow set can reach something it must never write.
 *
 * `collidesWith` is the configured value the collision was against, so a
 * diagnostic can name both halves: the glob the user wrote and the claim surface
 * it reaches.
 */
export interface FenceFinding {
  readonly branch: RepairBranchName;
  readonly allowGlob: string;
  readonly collidesWith: string;
  readonly kind: 'corpus' | 'docs';
}

/**
 * Every case where an allow glob could match a path under `corpus.root` or a path
 * a `subject.docs` glob matches (design §20.3, R15.8).
 *
 * Reported for **all three branches**, enforced for one. `test-drift`'s whole job
 * is editing the corpus, so a finding on that branch is information rather than a
 * violation; `code-break` intersecting either surface is the one configuration
 * that lets a red promise be turned green by rewriting the claim, and
 * {@link loadConfig} empties that branch's allow set when it happens.
 *
 * Pure, and total. A branch with no allow globs yields nothing, which is why the
 * fail-closed default of §20.4 is also the quiet one.
 */
export function fenceFindings(config: KeptConfig): readonly FenceFinding[] {
  const findings: FenceFinding[] = [];
  const corpusRoot = globSegments(config.corpus.root).join('/');
  // A directory reaches everything beneath it, and `**` matches zero segments in
  // this grammar, so one glob covers both the corpus root and its contents.
  const corpusClaim = corpusRoot.length === 0 ? null : `${corpusRoot}/**`;
  for (const branch of REPAIR_BRANCH_NAMES) {
    // Cast then default: a `KeptConfig` reaching this function from a JSON boundary
    // may be missing a branch the type says is present, and the guard must answer
    // for that shape too rather than throwing on the way to a safety decision.
    const fence = config.fences[branch] as KeptFence | undefined;
    for (const allowGlob of fence?.allow ?? []) {
      if (escapesRepositoryRoot(allowGlob)) {
        // Where it lands cannot be bounded, so it is treated as landing on the
        // corpus. The message names the traversal; that is what a reader needs.
        findings.push({
          branch,
          allowGlob,
          collidesWith: config.corpus.root,
          kind: 'corpus',
        });
        continue;
      }
      if (corpusClaim !== null && intersectionWitness(allowGlob, corpusClaim) !== null) {
        findings.push({ branch, allowGlob, collidesWith: config.corpus.root, kind: 'corpus' });
      }
      for (const docsGlob of config.subject.docs) {
        if (intersectionWitness(allowGlob, docsGlob) !== null) {
          findings.push({ branch, allowGlob, collidesWith: docsGlob, kind: 'docs' });
        }
      }
    }
  }
  return Object.freeze(findings);
}

/**
 * What a branch may never write, derived and never authored (design §20.1).
 *
 * The corpus root, every documentation glob, both package roots, and every
 * `subject.source` glob this branch was not granted. Membership in the allow set
 * is compared as written rather than semantically, because both lists are authored
 * from the same source globs and identity is the comparison that cannot silently
 * drop an entry from the forbidden side.
 */
export function derivedForbidden(
  config: KeptConfig,
  branch: RepairBranchName,
): readonly string[] {
  const fence = config.fences[branch] as KeptFence | undefined;
  const allowed = new Set(fence?.allow ?? []);
  const forbidden: string[] = [];
  const push = (glob: string): void => {
    if (glob.length > 0 && !forbidden.includes(glob)) forbidden.push(glob);
  };
  push(config.corpus.root);
  // The root *and* everything beneath it. `matchesGlob` treats a bare directory as a
  // literal path and matches nothing under it (§3.18), so a forbidden set carrying
  // only `tests` names the directory and none of the `*_test.md` files inside it —
  // and the whole reason the corpus is forbidden is the files. The bare root stays
  // too, because §20.5 asserts it and because "the corpus root" is the fact a reader
  // is looking for.
  if (config.corpus.root.length > 0) push(`${config.corpus.root}/**`);
  for (const docsGlob of config.subject.docs) push(docsGlob);
  push(PACKAGE_ROOT_GLOB);
  for (const sourceGlob of config.subject.source) {
    if (!allowed.has(sourceGlob)) push(sourceGlob);
  }
  return Object.freeze(forbidden);
}

/**
 * The glob pair the handoff writer needs, resolved from this configuration
 * (design §20.1, §8.1, R15.7).
 *
 * One function, called once per command, because `handoff.ts` lives in `kept-core`
 * and this loader lives in `@corgod/kept-cli`: the dependency runs cli to core, so core
 * cannot read the config and every fence glob has to arrive as an argument. This is
 * the only place that composition is written.
 *
 * The `code-break` allow set is the whole story on the allowed side, and that is
 * §8.1 rather than an omission: `test-drift` and `docs-lie` are *held* branches, so
 * their allowed side is empty in the fence table regardless of what a configuration
 * says, and passing a per-branch map would invite a caller to widen one of them.
 * `derivedForbidden` supplies the other side, so the corpus root, every
 * documentation glob and both package roots are named on it whichever branch a run
 * lands on.
 *
 * By the time this runs, {@link loadConfig} has already emptied a `code-break` allow
 * set that could reach a claim (§20.3). So the surfaces handed to the handoff are
 * provably unable to authorise editing the document that states the promise.
 */
export function handoffFenceSurfaces(config: KeptConfig): FenceSurfaces {
  const fence = config.fences['code-break'] as KeptFence | undefined;
  return Object.freeze({
    allow: Object.freeze([...(fence?.allow ?? [])]),
    forbid: derivedForbidden(config, 'code-break'),
  });
}

/** {@link loadConfig}'s input. */
export interface LoadConfigRequest {
  /** Absolute repository root. `.kept/config.json` sits under it. */
  readonly repoRoot: string;
  /** Reuses the state store's filesystem seam, so a test needs no disk. */
  readonly fileSystem: StateFileSystem;
  readonly diagnostics?: DiagnosticSink | undefined;
}

/** What {@link loadConfig} answers. */
export interface LoadConfigResult {
  readonly config: KeptConfig;
  /** True when the file was present, parsed, and every field was usable. */
  readonly loaded: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

/** A positive finite integer millisecond budget, or null. */
function readTimeout(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

/**
 * Is this an absolute URL?
 *
 * Parsed by the platform rather than by a pattern, because the only question worth
 * asking is whether the value the reachability probe will hand to a request is a
 * value a request can be made from. A relative path is rejected: there is nothing
 * for it to be relative to on a stranger's machine.
 */
function isAbsoluteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol.length > 0;
  } catch {
    return false;
  }
}

/** A JSON object, or null for anything else including an array. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** What a glob list read amounted to: the usable entries, and what was dropped. */
interface GlobListRead {
  readonly globs: readonly string[];
  /** Entries that were not non-empty strings, in the order they appeared. */
  readonly rejected: readonly unknown[];
}

/**
 * Read a glob array entry by entry.
 *
 * One bad entry loses one glob rather than the whole list, for the same reason
 * every other field here falls back alone: `kept build` has to answer on a
 * repository whose config was edited badly, and a list that collapses because its
 * third element is a number is a list that silently changes the blast radius.
 */
function readGlobList(value: unknown): GlobListRead | null {
  if (!Array.isArray(value)) return null;
  const globs: string[] = [];
  const rejected: unknown[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      rejected.push(entry);
      continue;
    }
    const glob = entry.trim().replace(/\\/g, '/');
    if (!globs.includes(glob)) globs.push(glob);
  }
  return { globs, rejected };
}

/**
 * Read `.kept/config.json`.
 *
 * Never throws. An absent file, a file that is not JSON, a file that is a JSON
 * array, and a file whose `timeouts.enrichmentMs` is the string `"60s"` all
 * answer a complete {@link KeptConfig} plus the diagnostics explaining which
 * fields came from {@link DEFAULT_CONFIG} and why.
 */
export function loadConfig(request: LoadConfigRequest): LoadConfigResult {
  const sink: CollectingDiagnosticSink = createDiagnosticSink();
  const report = (draft: Parameters<DiagnosticSink['report']>[0]): void => {
    const diagnostic = sink.report(draft);
    request.diagnostics?.report({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      file: diagnostic.file,
      line: diagnostic.line,
    });
  };

  const path = joinPath(request.repoRoot, CONFIG_FILE_RELATIVE_PATH);
  const text = request.fileSystem.readFile(path);
  if (text === null) {
    report({
      code: CONFIG_DIAGNOSTIC_CODES.absent,
      severity: 'info',
      message:
        `${CONFIG_FILE_RELATIVE_PATH} is absent, so the built-in defaults are in force: ` +
        `router '${DEFAULT_CONFIG.verdictRouter}', enrichment budget ` +
        `${DEFAULT_CONFIG.timeouts.enrichmentMs} ms, hook budget ` +
        `${DEFAULT_CONFIG.timeouts.hookMs} ms`,
      file: CONFIG_FILE_RELATIVE_PATH,
    });
    return { config: DEFAULT_CONFIG, loaded: false, diagnostics: sink.entries };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    report({
      code: CONFIG_DIAGNOSTIC_CODES.unreadable,
      severity: 'warn',
      message:
        `${CONFIG_FILE_RELATIVE_PATH} is not valid JSON (` +
        `${error instanceof Error ? error.message : String(error)}), so the built-in defaults ` +
        `are in force`,
      file: CONFIG_FILE_RELATIVE_PATH,
    });
    return { config: DEFAULT_CONFIG, loaded: false, diagnostics: sink.entries };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    report({
      code: CONFIG_DIAGNOSTIC_CODES.unreadable,
      severity: 'warn',
      message:
        `${CONFIG_FILE_RELATIVE_PATH} is not a JSON object, so the built-in defaults are in force`,
      file: CONFIG_FILE_RELATIVE_PATH,
    });
    return { config: DEFAULT_CONFIG, loaded: false, diagnostics: sink.entries };
  }

  const record = raw as Record<string, unknown>;
  let clean = true;

  let verdictRouter = DEFAULT_CONFIG.verdictRouter;
  if (isVerdictRouterName(record['verdictRouter'])) {
    verdictRouter = record['verdictRouter'];
  } else {
    clean = false;
    report({
      code: CONFIG_DIAGNOSTIC_CODES.fieldInvalid,
      severity: 'warn',
      message:
        `${CONFIG_FILE_RELATIVE_PATH}: verdictRouter is ` +
        `${JSON.stringify(record['verdictRouter'])}, which is not one of ` +
        `${VERDICT_ROUTER_NAMES.join(' | ')}; using '${DEFAULT_CONFIG.verdictRouter}'`,
      file: CONFIG_FILE_RELATIVE_PATH,
    });
  }

  let memberDebug = DEFAULT_CONFIG.memberDebug;
  if (typeof record['memberDebug'] === 'boolean') {
    memberDebug = record['memberDebug'];
  } else if (record['memberDebug'] !== undefined) {
    clean = false;
    report({
      code: CONFIG_DIAGNOSTIC_CODES.fieldInvalid,
      severity: 'warn',
      message:
        `${CONFIG_FILE_RELATIVE_PATH}: memberDebug is ` +
        `${JSON.stringify(record['memberDebug'])}, which is not a boolean; using ` +
        `${String(DEFAULT_CONFIG.memberDebug)}`,
      file: CONFIG_FILE_RELATIVE_PATH,
    });
  }

  const rawTimeouts = record['timeouts'];
  const timeoutRecord: Record<string, unknown> = asRecord(rawTimeouts) ?? {};
  const timeouts: { hookMs: number; enrichmentMs: number; doctorMs: number } = {
    hookMs: DEFAULT_CONFIG.timeouts.hookMs,
    enrichmentMs: DEFAULT_CONFIG.timeouts.enrichmentMs,
    doctorMs: DEFAULT_CONFIG.timeouts.doctorMs,
  };
  for (const field of ['hookMs', 'enrichmentMs'] as const) {
    const value = readTimeout(timeoutRecord[field]);
    if (value !== null) {
      timeouts[field] = value;
      continue;
    }
    clean = false;
    report({
      code: CONFIG_DIAGNOSTIC_CODES.fieldInvalid,
      severity: 'warn',
      message:
        `${CONFIG_FILE_RELATIVE_PATH}: timeouts.${field} is ` +
        `${JSON.stringify(timeoutRecord[field])}, which is not a positive integer number of ` +
        `milliseconds; using ${DEFAULT_CONFIG.timeouts[field]}`,
      file: CONFIG_FILE_RELATIVE_PATH,
    });
  }

  // ── The optional keys of §20.4 ────────────────────────────────────────────
  //
  // Two reporters, used for every one of them. `defaultApplied` is `info` and
  // leaves `loaded` true: an omitted key is a repository that has not said yet,
  // not a repository that said something wrong. `invalid` is `warn` and clears
  // `loaded`, because R15.6 wants the offending field path and the expected type
  // named, and a caller that reads `loaded` is asking "did this file mean what it
  // says".
  const defaultApplied = (key: string, used: string): void => {
    report({
      code: CONFIG_DIAGNOSTIC_CODES.defaultApplied,
      severity: 'info',
      message:
        `${CONFIG_FILE_RELATIVE_PATH}: ${key} is absent, so the documented default ${used} ` +
        `is in force`,
      file: CONFIG_FILE_RELATIVE_PATH,
    });
  };
  const invalid = (key: string, saw: unknown, expected: string, used: string): void => {
    clean = false;
    report({
      code: CONFIG_DIAGNOSTIC_CODES.fieldInvalid,
      severity: 'warn',
      message:
        `${CONFIG_FILE_RELATIVE_PATH}: ${key} is ${JSON.stringify(saw) ?? String(saw)}, which is ` +
        `not ${expected}; using ${used}`,
      file: CONFIG_FILE_RELATIVE_PATH,
    });
  };

  // `doctorMs` is optional where the two Kane budgets are not. §13.1 states the
  // hook and enrichment numbers as the committed file's business and this loader
  // has always warned when either is missing; §20.4 introduces `doctorMs` as a
  // key with a documented default, so an absent one is announced rather than
  // scolded.
  if (timeoutRecord['doctorMs'] === undefined) {
    defaultApplied('timeouts.doctorMs', `${DEFAULT_CONFIG.timeouts.doctorMs} ms`);
  } else {
    const doctorMs = readTimeout(timeoutRecord['doctorMs']);
    if (doctorMs !== null) {
      timeouts.doctorMs = doctorMs;
    } else {
      invalid(
        'timeouts.doctorMs',
        timeoutRecord['doctorMs'],
        'a positive integer number of milliseconds',
        `${DEFAULT_CONFIG.timeouts.doctorMs}`,
      );
    }
  }

  const corpusRecord = asRecord(record['corpus']);
  let corpusRoot = DEFAULT_CONFIG.corpus.root;
  if (record['corpus'] === undefined || corpusRecord?.['root'] === undefined) {
    if (record['corpus'] !== undefined && corpusRecord === null) {
      invalid('corpus', record['corpus'], 'a JSON object', `'${DEFAULT_CONFIG.corpus.root}'`);
    } else {
      defaultApplied('corpus.root', `'${DEFAULT_CONFIG.corpus.root}'`);
    }
  } else {
    const raw = corpusRecord['root'];
    const candidate = typeof raw === 'string' ? raw.trim() : '';
    const segments = globSegments(candidate);
    // A wildcard or a traversal here would make the guard's corpus surface
    // unbounded, and the corpus root is also a *directory the provider scans*.
    const usable =
      candidate.length > 0 &&
      segments.length > 0 &&
      !segments.includes('..') &&
      !candidate.includes('*');
    if (usable) {
      corpusRoot = segments.join('/');
    } else {
      invalid(
        'corpus.root',
        raw,
        'a repository-relative directory path with no wildcard and no parent traversal',
        `'${DEFAULT_CONFIG.corpus.root}'`,
      );
    }
  }

  const subjectRecord = asRecord(record['subject']);
  if (record['subject'] !== undefined && subjectRecord === null) {
    invalid('subject', record['subject'], 'a JSON object', 'the documented defaults');
  }
  const readSubjectGlobs = (field: 'source' | 'docs'): readonly string[] => {
    const fallback = DEFAULT_CONFIG.subject[field];
    const raw = subjectRecord === null ? undefined : subjectRecord[field];
    if (raw === undefined) {
      defaultApplied(`subject.${field}`, JSON.stringify(fallback));
      return fallback;
    }
    const read = readGlobList(raw);
    if (read === null) {
      invalid(`subject.${field}`, raw, 'an array of glob strings', JSON.stringify(fallback));
      return fallback;
    }
    for (const entry of read.rejected) {
      invalid(
        `subject.${field}[]`,
        entry,
        'a non-empty glob string',
        'nothing: the entry was dropped',
      );
    }
    return Object.freeze([...read.globs]);
  };
  const source = readSubjectGlobs('source');
  const docs = readSubjectGlobs('docs');

  let baseUrl = DEFAULT_CONFIG.subject.baseUrl;
  const rawBaseUrl = subjectRecord === null ? undefined : subjectRecord['baseUrl'];
  if (rawBaseUrl === undefined) {
    defaultApplied('subject.baseUrl', 'null, so reachability reports "not configured"');
  } else if (rawBaseUrl === null) {
    // The explicit spelling of the default. Recorded by its silence: the user said
    // "there is no origin", which is a decision and not an omission.
    baseUrl = null;
  } else if (typeof rawBaseUrl === 'string' && isAbsoluteUrl(rawBaseUrl.trim())) {
    baseUrl = rawBaseUrl.trim();
  } else {
    invalid('subject.baseUrl', rawBaseUrl, 'an absolute URL or null', 'null');
  }

  const fencesRecord = asRecord(record['fences']);
  if (record['fences'] !== undefined && fencesRecord === null) {
    invalid(
      'fences',
      record['fences'],
      `a JSON object keyed by ${REPAIR_BRANCH_NAMES.join(' | ')}`,
      'an empty allow set for every branch',
    );
  }
  const fences: Record<RepairBranchName, KeptFence> = {
    'code-break': { allow: Object.freeze([] as readonly string[]) },
    'test-drift': { allow: Object.freeze([] as readonly string[]) },
    'docs-lie': { allow: Object.freeze([] as readonly string[]) },
  };
  for (const branch of REPAIR_BRANCH_NAMES) {
    const rawBranch = fencesRecord === null ? undefined : fencesRecord[branch];
    const branchRecord = asRecord(rawBranch);
    if (rawBranch !== undefined && branchRecord === null) {
      invalid(`fences.${branch}`, rawBranch, 'a JSON object with an `allow` array', '[]');
      continue;
    }

    if (branchRecord !== null) {
      for (const key of Object.keys(branchRecord)) {
        if (key === 'allow') continue;
        if (key === 'forbid') {
          // The whole point of §20.1: the forbidden set is derived, so a hand
          // written one is an unknown field rather than a stricter fence. A user
          // who can spell `forbid` can leave a hole in it, and the hole would be
          // invisible next to a plausible-looking list.
          clean = false;
          report({
            code: CONFIG_DIAGNOSTIC_CODES.fenceForbidRejected,
            severity: 'warn',
            message:
              `${CONFIG_FILE_RELATIVE_PATH}: fences.${branch}.forbid is not a key this schema ` +
              `accepts and was ignored. The forbidden set is derived from corpus.root, ` +
              `subject.docs, ${PACKAGE_ROOT_GLOB} and every subject.source glob this branch ` +
              `does not allow, so it can never be spelled with a hole in it`,
            file: CONFIG_FILE_RELATIVE_PATH,
          });
          continue;
        }
        invalid(
          `fences.${branch}.${key}`,
          branchRecord[key],
          'a key this schema accepts: `allow` is the only one',
          'nothing: the key was ignored',
        );
      }
    }

    const rawAllow = branchRecord === null ? undefined : branchRecord['allow'];
    if (rawAllow === undefined) {
      // An absent allow set and an explicit `[]` resolve identically and are
      // reported differently (§20.1): "I forgot to configure this branch" and
      // "this branch may write nothing" have opposite meanings and the same
      // spelling, so only the diagnostic can tell them apart.
      defaultApplied(`fences.${branch}.allow`, '[], which grants no write autonomy');
      continue;
    }
    const read = readGlobList(rawAllow);
    if (read === null) {
      invalid(`fences.${branch}.allow`, rawAllow, 'an array of glob strings', '[]');
      continue;
    }
    for (const entry of read.rejected) {
      invalid(
        `fences.${branch}.allow[]`,
        entry,
        'a non-empty glob string',
        'nothing: the entry was dropped',
      );
    }
    fences[branch] = { allow: Object.freeze([...read.globs]) };
  }

  const resolved: KeptConfig = {
    verdictRouter,
    memberDebug,
    timeouts: Object.freeze(timeouts),
    corpus: Object.freeze({ root: corpusRoot }),
    subject: Object.freeze({ source, docs, baseUrl }),
    fences: Object.freeze({ ...fences }),
  };

  // ── The fence intersection guard (§20.3, R15.8) ───────────────────────────
  //
  // Load time, never run time: a fence that is checked when it is used has
  // already been trusted once. The refusal is *an empty allow set*, not an
  // exception and not an early return, because this module never throws and
  // because a `code-break` verdict still has to be reported. The branch keeps
  // everything it says and loses only its authority to write.
  const offending = fenceFindings(resolved).filter((finding) => finding.branch === 'code-break');
  if (offending.length === 0) return { config: resolved, loaded: clean, diagnostics: sink.entries };

  for (const finding of offending) {
    report({
      code: CONFIG_DIAGNOSTIC_CODES.fenceIntersectsClaims,
      severity: 'error',
      message:
        `${CONFIG_FILE_RELATIVE_PATH}: fences.code-break.allow contains ` +
        `'${finding.allowGlob}', which can match a path ` +
        (finding.kind === 'corpus'
          ? `under the corpus root '${finding.collidesWith}'`
          : `matched by the documentation glob '${finding.collidesWith}'`) +
        `. A code-break repair that can edit the claim or the test can turn a promise ` +
        `green by redefining it, so this fence is refused: fences.code-break.allow is ` +
        `empty for this run and no path is writable`,
      file: CONFIG_FILE_RELATIVE_PATH,
    });
  }

  return {
    config: {
      ...resolved,
      fences: Object.freeze({
        ...fences,
        'code-break': { allow: Object.freeze([] as readonly string[]) },
      }),
    },
    loaded: false,
    diagnostics: sink.entries,
  };
}

/**
 * Layer one invocation's flags over the loaded config (design §13.1).
 *
 * `--router` overrides for one invocation and nothing else; `--member-debug`
 * turns member capture on and, deliberately, cannot turn it off — the flag's
 * presence is the whole signal, so a config that already says `true` stays true.
 * A `--router` naming a router that does not exist is **ignored with a warning**
 * rather than being a usage error: §14.2 keeps the exit code a statement about
 * whether KEPT worked, and a hook that starts failing over a typo is a hook
 * somebody disables.
 */
export function applyOverrides(
  config: KeptConfig,
  overrides: { readonly router?: string | null; readonly memberDebug?: boolean },
  diagnostics?: DiagnosticSink,
): KeptConfig {
  let verdictRouter = config.verdictRouter;
  const router = overrides.router ?? null;
  if (router !== null) {
    if (isVerdictRouterName(router)) {
      verdictRouter = router;
      diagnostics?.report({
        code: CONFIG_DIAGNOSTIC_CODES.routerOverride,
        severity: 'info',
        message: `--router '${router}' overrides the configured '${config.verdictRouter}' for this invocation`,
      });
    } else {
      diagnostics?.report({
        code: CONFIG_DIAGNOSTIC_CODES.routerOverrideInvalid,
        severity: 'warn',
        message:
          `--router '${router}' is not one of ${VERDICT_ROUTER_NAMES.join(' | ')}, so the ` +
          `configured '${config.verdictRouter}' stays in force`,
      });
    }
  }
  // Spread rather than rebuilt field by field: `--router` and `--member-debug` are
  // the only two flags §13.1 grants, so every other key carries through untouched
  // and a key added to the schema cannot be silently dropped here. In particular
  // no flag can widen a fence.
  return {
    ...config,
    verdictRouter,
    memberDebug: config.memberDebug || overrides.memberDebug === true,
  };
}

/**
 * The environment overrides one invocation needs (R4.12).
 *
 * A pure function of the resolved config so the wiring can be asserted without a
 * process anywhere: `KANE_TESTRUN_MEMBER_DEBUG=1` when member capture is on, and
 * an empty record otherwise — never `KANE_TESTRUN_MEMBER_DEBUG=0`, because Kane
 * reads the variable's presence.
 */
export function memberDebugEnv(config: KeptConfig): Readonly<Record<string, string>> {
  return config.memberDebug ? Object.freeze({ KANE_TESTRUN_MEMBER_DEBUG: '1' }) : Object.freeze({});
}

/** POSIX join, matching the state store's own path handling. */
export function joinPath(root: string, relative: string): string {
  return root.endsWith('/') ? `${root}${relative}` : `${root}/${relative}`;
}
