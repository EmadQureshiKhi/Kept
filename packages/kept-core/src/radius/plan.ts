/**
 * The testrun plan cache (design §7.2, R4.4).
 *
 * `testrun_plan.members[].test_id` is the **only** authority for the mapping
 * from a `*_test.md` path to an assurance-graph identifier (§7.1, R4.3, R4.4).
 * Frontmatter carries a `test_id` too and it is a cache of convenience; a
 * filename looks like an id; a member's position in the plan looks like an
 * ordinal. None of those may ever produce an identifier handed to Kane, so this
 * module exists to obtain the real ones and to keep them somewhere cheap:
 * `.kept/plan.json`, refreshed by asking Kane what it would run.
 *
 * ## The refresh invocation, and why it looks different to every other one
 *
 * ```
 * kane-cli testrun run --dry-run
 *    family: ExecutionTestrun
 *    stdio:  stdout piped   ← this is what enables NDJSON; there is no --agent flag
 *    budget: 60 s
 * ```
 *
 * `testrun run` belongs to the `ExecutionTestrun` family, whose NDJSON enabler is
 * **piped stdout**, not a flag (§4.1, R3.5). `--agent` does not exist on this
 * command: Kane rejects it and nothing runs. So {@link PLAN_REFRESH_ARGV} carries
 * no enabler at all, the invoker appends none, and `applyNdjsonEnabler` asserts
 * that no `--agent` reached the argv — the assertion is in the invoker rather than
 * here precisely so it cannot be forgotten at a new call site.
 *
 * The other family-specific fact worth stating: for this family a process exit of
 * 2 means *preflight rejected*, not "generic failure". A dry run whose members
 * were all rejected is a truthful plan of members that cannot execute, and it
 * exits 2. This module therefore reads the **stream**, not the exit code.
 *
 * ## Only `testrun_plan` is consumed, and yet `testrun_done` is required
 *
 * The plan event opens the stream, so it is tempting to take it and stop reading.
 * That would be trusting a fragment of a stream whose outcome is unknown: a
 * truncated `--dry-run` is a `crashed` stream by §4.2, and a plan lifted out of
 * one may be missing every member Kane had not enumerated yet. Under-enumerating
 * is the dangerous direction — a member absent from the plan contributes no
 * identifier, so the blast radius silently shrinks and `kept verify` becomes a
 * no-op that reports success. So the gate is conjunctive: the stream must reach
 * its family's terminal `testrun_done` event **and** carry a `testrun_plan`.
 *
 * When the gate refuses, **the previous cache stays exactly as it was.** Nothing
 * is deleted, nothing is written, and {@link readPlan} answers whatever was on
 * disk — possibly `null`, when there was nothing. A transient Kane hiccup must
 * not turn a working verify path into a no-op, and it must not turn a stale plan
 * into no plan.
 *
 * ## What "stale" means
 *
 * Three triggers, any of which refreshes (§7.2): the cache is missing (or
 * unreadable, or does not have the shape this module writes), it is older than
 * `maxAgeMs` (default ten minutes), or **any `*_test.md` is newer than it**. The
 * third is the one that matters in the loop: authoring or editing a test document
 * changes what Kane would run, and a ten-minute window would hand `--from-context`
 * an identifier set that predates the edit. Where those documents live is the host
 * repository's `corpus.root`, handed in rather than assumed, and it is what
 * {@link newestTestDocument} walks.
 *
 * Nothing here throws for the state of the world (§14.2): an unreadable cache, an
 * absent binary, a refusal, a crash, a timeout and an unwritable `.kept/` are all
 * diagnostics.
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { DiagnosticDraft, DiagnosticSink } from '../diagnostics.js';
import { createDiagnosticSink } from '../diagnostics.js';
import type { TestrunPlanEvent, TestrunPlanMember } from '../kane/events.js';
import type { CommandFamily } from '../kane/family.js';
import { contractFor } from '../kane/family.js';
import type { InvocationResult, KaneInvoker } from '../kane/invoker.js';
import { parseStream } from '../kane/ndjson.js';
import { toPosix, toRepoRelative } from '../model/ids.js';
import {
  isSkippedDirectoryName,
  isTestDocumentName,
  type BaselineDirEntry,
} from '../providers/baseline.js';

/** Where the cache lives. Gitignored: regenerable single-writer working state. */
export const PLAN_FILE_RELATIVE_PATH = '.kept/plan.json';

/** The family `testrun run` belongs to. Named once, read from here everywhere. */
export const PLAN_FAMILY = 'ExecutionTestrun' satisfies CommandFamily;

/**
 * The refresh argv, **without** an NDJSON enabler — this family has none to add.
 * The invoker appends nothing for `piped-stdout` and rejects an `--agent` here.
 */
export const PLAN_REFRESH_ARGV: readonly string[] = Object.freeze([
  'testrun',
  'run',
  '--dry-run',
]);

/** Default age at which the cache is refreshed (§7.2): ten minutes. */
export const PLAN_MAX_AGE_MS = 600_000;

/** The refresh budget (§7.2): 60 s. A dry run enumerates; it does not execute. */
export const PLAN_REFRESH_TIMEOUT_MS = 60_000;

/* Where Kane's Markdown test suite lives used to be declared here as the literal
   `tests`. It is `corpus.root` in `Kept_Config` now (§20.1, R15.2), and it reaches
   this module as a required argument on {@link newestTestDocument} and
   {@link ReadPlanRequest.corpusRoot}. A default here would be a second home for the
   value, and the failure it would cause is invisible: the mtime walk would look in a
   directory the host repository does not use, find nothing newer than the cache, and
   never refresh — so `--from-context` would keep spending identifiers that predate
   the edit that changed them. */

/** Depth cap on the `*_test.md` mtime walk. Insurance against a cyclic tree. */
export const MAX_TEST_DOCUMENT_DEPTH = 8;

/** Diagnostic codes this module reports. Stable strings; the Ledger keys off them. */
export const PLAN_DIAGNOSTIC_CODES = Object.freeze({
  /** The cache file could not be read. Treated as missing. */
  cacheUnreadable: 'plan-cache-unreadable',
  /** The cache file parsed but is not the shape this module writes. */
  cacheMalformed: 'plan-cache-malformed',
  /** The refreshed plan could not be written. The plan is still returned. */
  cacheWriteFailed: 'plan-cache-write-failed',
  /** A refresh was needed and no invoker was supplied. */
  refreshUnavailable: 'plan-refresh-unavailable',
  /** `kane-cli` is not on PATH, so no plan could be obtained (R2.12). */
  kaneNotFound: 'plan-kane-not-found',
  /** The `--dry-run` stream stopped early *and* exited badly. Cache left in place. */
  refreshCrashed: 'plan-refresh-crashed',
  /** A clean dry run with a plan and no `testrun_done` — what 0.8.4 emits (15.3). */
  refreshedWithoutTerminal: 'plan-refreshed-without-terminal',
  /** The stream completed but carried no `testrun_plan`. Cache left in place. */
  planEventAbsent: 'plan-event-absent',
  /** A plan member carried no usable `path`, so it cannot be tied to a document. */
  memberPathMissing: 'plan-member-path-missing',
  /** `valid: false` — the members exist but Kane would refuse to run them. */
  preflightInvalid: 'plan-preflight-invalid',
  /** A refresh succeeded. Informational, and the freshness a reviewer wants. */
  refreshed: 'plan-refreshed',
  /** No plan is available at all: no cache, and the refresh did not produce one. */
  unavailable: 'plan-unavailable',
} as const);

/** Every code above, for tests and for the Ledger's filter list. */
export const PLAN_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(PLAN_DIAGNOSTIC_CODES),
);

/**
 * One member of the cached plan — the **settled** shape, distinct from the wire
 * `TestrunPlanMember` of `kane/events.ts` where every field is optional.
 *
 * `testId` is `string | null` and never an empty string: "Kane has no identifier
 * for this document" has exactly one representation, so a caller cannot pass a
 * blank id to `--from-context` by forgetting to check for one.
 */
export interface PlanMember {
  /** Repository-relative POSIX path of the `*_test.md`. Never empty. */
  readonly path: string;
  /** Kane's assurance-graph id, or null. The only source of a radius identifier. */
  readonly testId: string | null;
  readonly tags: readonly string[];
  /** Preflight rejection reason, verbatim, or null. */
  readonly failure: string | null;
}

/** The cached plan (§7.2). Written to {@link PLAN_FILE_RELATIVE_PATH} as JSON. */
export interface TestrunPlan {
  /** Kane's own preflight verdict on the suite. `false` means nothing would run. */
  readonly valid: boolean;
  readonly members: readonly PlanMember[];
  /** ISO 8601 instant the plan was captured. A string, never a `Date`. */
  readonly capturedAt: string;
}

/** Why the cache is being refreshed, or `null` when it is not. */
export type PlanStaleReason = 'missing' | 'malformed' | 'expired' | 'test-document-newer';

/** The staleness verdict, with the evidence that produced it. */
export interface PlanStaleness {
  readonly stale: boolean;
  readonly reason: PlanStaleReason | null;
  /** Human-readable evidence, for the diagnostic the caller records. */
  readonly detail: string;
}

/** A `*_test.md` and its modification time, from the mtime walk. */
export interface TestDocumentStamp {
  readonly path: string;
  readonly mtimeMs: number;
}

/**
 * The filesystem seam, so every test in this module's suite runs without disk.
 *
 * Paths are **repository-relative POSIX**, matching `BaselineFileSystem` rather
 * than the absolute-path shape of `EvidenceFileSystem`: every path this module
 * reports — the cache, each test document — is repository-relative, and a
 * conversion on the way out is the kind of thing that goes wrong once and is then
 * wrong forever in a committed artefact.
 */
export interface PlanFileSystem {
  /** File contents, or null when absent or unreadable. */
  readFile(path: string): string | null;
  /** Create a directory and its parents. Never throws for existence. */
  ensureDir(path: string): void;
  writeFile(path: string, contents: string): void;
  /** Modification time in epoch milliseconds, or null when unavailable. */
  mtimeMs(path: string): number | null;
  /** List a directory; `''` is the root. May throw — callers treat that as absence. */
  readDirectory(dir: string): readonly BaselineDirEntry[];
}

/** The production filesystem, rooted at `repoRoot`. Nothing outside it is touched. */
export function nodePlanFileSystem(repoRoot: string): PlanFileSystem {
  const root = resolve(repoRoot);
  const absolute = (relativePath: string): string =>
    relativePath === '' ? root : join(root, relativePath);
  return {
    readFile(path: string): string | null {
      const target = absolute(path);
      const stats = statSync(target, { throwIfNoEntry: false });
      if (stats === undefined || !stats.isFile()) return null;
      try {
        return readFileSync(target, { encoding: 'utf8' });
      } catch {
        return null;
      }
    },
    ensureDir(path: string): void {
      mkdirSync(absolute(path), { recursive: true });
    },
    writeFile(path: string, contents: string): void {
      writeFileSync(absolute(path), contents, { encoding: 'utf8' });
    },
    mtimeMs(path: string): number | null {
      const stats = statSync(absolute(path), { throwIfNoEntry: false });
      if (stats === undefined) return null;
      return Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : null;
    },
    readDirectory(dir: string): readonly BaselineDirEntry[] {
      return readdirSync(absolute(dir), { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
      }));
    },
  };
}

/**
 * An in-memory filesystem over `path → { text, mtimeMs }`. The directory tree is
 * derived from the keys, so a test states the files it wants and nothing else.
 */
export function inMemoryPlanFileSystem(
  seed: Readonly<Record<string, { readonly text: string; readonly mtimeMs?: number }>> = {},
): PlanFileSystem & { readonly files: Map<string, { text: string; mtimeMs: number }> } {
  const files = new Map<string, { text: string; mtimeMs: number }>();
  for (const [path, entry] of Object.entries(seed)) {
    files.set(toPosix(path), { text: entry.text, mtimeMs: entry.mtimeMs ?? 0 });
  }

  const directories = (): Map<string, Map<string, boolean>> => {
    const children = new Map<string, Map<string, boolean>>();
    const childrenOf = (dir: string): Map<string, boolean> => {
      const existing = children.get(dir);
      if (existing !== undefined) return existing;
      const created = new Map<string, boolean>();
      children.set(dir, created);
      return created;
    };
    childrenOf('');
    for (const path of files.keys()) {
      const segments = path.split('/').filter((segment) => segment.length > 0);
      let dir = '';
      for (let index = 0; index < segments.length; index += 1) {
        const name = segments[index] as string;
        const isDirectory = index < segments.length - 1;
        childrenOf(dir).set(name, isDirectory);
        dir = dir === '' ? name : `${dir}/${name}`;
        if (isDirectory) childrenOf(dir);
      }
    }
    return children;
  };

  return {
    files,
    readFile(path: string): string | null {
      return files.get(toPosix(path))?.text ?? null;
    },
    ensureDir(): void {
      // Directories are implicit in a map.
    },
    writeFile(path: string, contents: string): void {
      const key = toPosix(path);
      files.set(key, { text: contents, mtimeMs: files.get(key)?.mtimeMs ?? 0 });
    },
    mtimeMs(path: string): number | null {
      return files.get(toPosix(path))?.mtimeMs ?? null;
    },
    readDirectory(dir: string): readonly BaselineDirEntry[] {
      const found = directories().get(toPosix(dir));
      if (found === undefined) {
        throw new Error(`ENOENT: no such directory ${dir === '' ? '(root)' : dir}`);
      }
      return [...found.entries()].map(([name, isDirectory]) => ({
        name,
        isDirectory,
        isFile: !isDirectory,
      }));
    },
  };
}

/** Trim a wire string, answering null for anything that is not usable text. */
function usableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Structural guard for one cached member. */
function isPlanMember(value: unknown): value is PlanMember {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['path'] !== 'string' || candidate['path'].length === 0) return false;
  if (!('testId' in candidate)) return false;
  const testId = candidate['testId'];
  if (testId !== null && (typeof testId !== 'string' || testId.length === 0)) return false;
  const tags = candidate['tags'];
  if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) return false;
  if (!('failure' in candidate)) return false;
  const failure = candidate['failure'];
  return failure === null || typeof failure === 'string';
}

/**
 * Structural guard for a plan read back off disk. Anything that fails it is
 * treated as a missing cache, because a file this module did not write is a file
 * whose members cannot be trusted to be Kane's.
 */
export function isTestrunPlan(value: unknown): value is TestrunPlan {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['valid'] !== 'boolean') return false;
  const capturedAt = candidate['capturedAt'];
  if (typeof capturedAt !== 'string' || Number.isNaN(Date.parse(capturedAt))) return false;
  const members = candidate['members'];
  return Array.isArray(members) && members.every((member) => isPlanMember(member));
}

/** Canonical bytes for the cache: sorted members, 2-space indent, one authority. */
export function serialisePlan(plan: TestrunPlan): string {
  const members = [...plan.members].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  return `${JSON.stringify(
    {
      valid: plan.valid,
      capturedAt: plan.capturedAt,
      members: members.map((member) => ({
        path: member.path,
        testId: member.testId,
        tags: [...member.tags],
        failure: member.failure,
      })),
    },
    null,
    2,
  )}\n`;
}

/**
 * Turn a wire `testrun_plan` event into the settled cache shape.
 *
 * A member with no usable `path` is dropped and diagnosed: the member exists only
 * to be tied back to a `*_test.md`, and without a path there is nothing to tie.
 * A blank `test_id` becomes `null` rather than an empty string, so "no identifier"
 * has one representation. Nothing is synthesised — not from the path, not from
 * the member's position, not from anywhere.
 *
 * `repoRoot` is the one conversion this projection performs. Kane 0.8.4 reports
 * `members[].path` **absolute** — observed, from a live `testrun run --dry-run`
 * against this repository — while {@link PlanMember.path} is documented as
 * repository-relative and every consumer keys on that form. Without the root the
 * paths are passed through unchanged, so a fixture that already writes relative
 * paths is unaffected.
 */
export function normalisePlanEvent(
  event: TestrunPlanEvent,
  options: {
    readonly capturedAt: string;
    readonly sink?: DiagnosticSink | undefined;
    readonly repoRoot?: string | undefined;
  } = {
    capturedAt: new Date(0).toISOString(),
  },
): TestrunPlan {
  const sink = options.sink;
  const wireMembers: readonly TestrunPlanMember[] = Array.isArray(event.members)
    ? event.members
    : [];
  const members: PlanMember[] = [];

  wireMembers.forEach((member, index) => {
    const path = usableString(member?.path);
    if (path === null) {
      sink?.report({
        code: PLAN_DIAGNOSTIC_CODES.memberPathMissing,
        severity: 'warn',
        message:
          `Plan member at position ${index + 1} carries no usable path, so it cannot be tied ` +
          `to a test document and is excluded from the plan.`,
        file: null,
        line: null,
      });
      return;
    }
    const tags = Array.isArray(member?.tags)
      ? member.tags.filter((tag): tag is string => typeof tag === 'string')
      : [];
    members.push({
      path: toRepoRelative(path, options.repoRoot),
      testId: usableString(member?.test_id),
      tags: Object.freeze([...tags]),
      failure: usableString(member?.failure),
    });
  });

  return Object.freeze({
    valid: event.valid === true,
    members: Object.freeze(members),
    capturedAt: options.capturedAt,
  });
}

/**
 * The newest `*_test.md` under `root`, or null when there is none.
 *
 * A depth-capped walk that skips the same directory names the baseline scan does,
 * and treats an unreadable directory as empty — a plan refresh must not fail
 * because a directory could not be listed, it should just not see a reason to
 * refresh from it.
 *
 * `root` is required: it is `corpus.root` from `Kept_Config`, and `''` is a
 * legitimate value meaning the whole repository. There is nothing sensible for this
 * function to guess, and a guess would refresh nothing rather than fail loudly.
 */
export function newestTestDocument(fs: PlanFileSystem, root: string): TestDocumentStamp | null {
  let newest: TestDocumentStamp | null = null;
  const queue: { readonly dir: string; readonly depth: number }[] = [
    { dir: toPosix(root), depth: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;

    let entries: readonly BaselineDirEntry[];
    try {
      entries = fs.readDirectory(current.dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const path = current.dir === '' ? entry.name : `${current.dir}/${entry.name}`;
      if (entry.isDirectory) {
        if (isSkippedDirectoryName(entry.name)) continue;
        if (current.depth + 1 > MAX_TEST_DOCUMENT_DEPTH) continue;
        queue.push({ dir: path, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile || !isTestDocumentName(entry.name)) continue;
      const mtimeMs = fs.mtimeMs(path);
      if (mtimeMs === null) continue;
      if (newest === null || mtimeMs > newest.mtimeMs) newest = { path, mtimeMs };
    }
  }

  return newest;
}

/** What {@link planStaleness} needs to decide. Pure — no filesystem, no clock. */
export interface PlanStalenessRequest {
  /** The cached plan, or null when there is none. */
  readonly plan: TestrunPlan | null;
  /** Whether a cache file existed but failed {@link isTestrunPlan}. */
  readonly malformed?: boolean;
  /** The cache file's own mtime, when known. Falls back to `capturedAt`. */
  readonly cacheMtimeMs?: number | null;
  /** The newest `*_test.md`, or null. */
  readonly newestTestDocument?: TestDocumentStamp | null;
  readonly nowMs: number;
  readonly maxAgeMs: number;
}

/**
 * The three refresh triggers of §7.2, decided in one place so the reason a
 * refresh happened can be reported rather than inferred.
 *
 * A non-finite or non-positive `maxAgeMs` disables the age trigger rather than
 * refreshing on every call: "no age limit" is a legitimate ask (a `--plan-cache`
 * override, an offline run), and the other two triggers still fire.
 */
export function planStaleness(request: PlanStalenessRequest): PlanStaleness {
  if (request.plan === null) {
    return request.malformed === true
      ? {
          stale: true,
          reason: 'malformed',
          detail: `${PLAN_FILE_RELATIVE_PATH} is not a plan this version wrote`,
        }
      : { stale: true, reason: 'missing', detail: `${PLAN_FILE_RELATIVE_PATH} is absent` };
  }

  const capturedAtMs = Date.parse(request.plan.capturedAt);
  const stampedAtMs =
    typeof request.cacheMtimeMs === 'number' && Number.isFinite(request.cacheMtimeMs)
      ? request.cacheMtimeMs
      : capturedAtMs;

  if (Number.isFinite(request.maxAgeMs) && request.maxAgeMs > 0) {
    const ageMs = request.nowMs - capturedAtMs;
    if (Number.isFinite(ageMs) && ageMs > request.maxAgeMs) {
      return {
        stale: true,
        reason: 'expired',
        detail: `captured ${Math.round(ageMs / 1000)} s ago, older than the ${request.maxAgeMs} ms window`,
      };
    }
  }

  const newest = request.newestTestDocument ?? null;
  if (newest !== null && Number.isFinite(stampedAtMs) && newest.mtimeMs > stampedAtMs) {
    return {
      stale: true,
      reason: 'test-document-newer',
      detail: `${newest.path} was modified after the plan was captured`,
    };
  }

  return { stale: false, reason: null, detail: 'the cached plan is current' };
}

/** What {@link readPlan} takes. Every default is production; every seam is a test. */
export interface ReadPlanRequest {
  /**
   * The Kane process boundary. Optional because a plan read with no invoker is a
   * supported state — it answers the cache, or null, and says which (R2.12).
   */
  readonly invoker?: KaneInvoker | undefined;
  /** Working directory for the refresh. Kane resolves the suite against it. */
  readonly cwd: string;
  /** Age at which the cache is refreshed. Defaults to {@link PLAN_MAX_AGE_MS}. */
  readonly maxAgeMs?: number | undefined;
  /** Refresh budget. Defaults to {@link PLAN_REFRESH_TIMEOUT_MS} (§7.2). */
  readonly timeoutMs?: number | undefined;
  /** Repository root for the default filesystem. Defaults to `cwd`. */
  readonly repoRoot?: string | undefined;
  readonly fs?: PlanFileSystem | undefined;
  readonly sink?: DiagnosticSink | undefined;
  /** Injected clock, so `capturedAt` and the age window are deterministic. */
  readonly now?: (() => number) | undefined;
  /**
   * Where Kane's test documents live — `corpus.root` from `Kept_Config` (§20.1).
   *
   * Required, because the staleness trigger that matters in the loop is "a
   * `*_test.md` is newer than the cache", and a walk rooted at the wrong directory
   * answers that question `no` forever without ever saying it looked in the wrong
   * place.
   */
  readonly corpusRoot: string;
  /** Force a refresh regardless of staleness. `kept verify --refresh-plan`. */
  readonly force?: boolean | undefined;
}

/** The cache as it was found on disk, before any refresh decision. */
interface CachedPlan {
  readonly plan: TestrunPlan | null;
  readonly malformed: boolean;
  readonly mtimeMs: number | null;
}

/** How every path in this module records adversity: one draft, never a throw. */
type Report = (draft: DiagnosticDraft) => void;

function readCache(fs: PlanFileSystem, report: Report): CachedPlan {
  let text: string | null;
  try {
    text = fs.readFile(PLAN_FILE_RELATIVE_PATH);
  } catch (cause) {
    report({
      code: PLAN_DIAGNOSTIC_CODES.cacheUnreadable,
      severity: 'warn',
      message:
        `${PLAN_FILE_RELATIVE_PATH} could not be read (${describe(cause)}), so it is treated ` +
        `as absent and the plan is refreshed.`,
      file: PLAN_FILE_RELATIVE_PATH,
    });
    return { plan: null, malformed: false, mtimeMs: null };
  }
  if (text === null) return { plan: null, malformed: false, mtimeMs: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    report({
      code: PLAN_DIAGNOSTIC_CODES.cacheMalformed,
      severity: 'warn',
      message:
        `${PLAN_FILE_RELATIVE_PATH} is not valid JSON (${describe(cause)}), so it is discarded ` +
        `and the plan is refreshed.`,
      file: PLAN_FILE_RELATIVE_PATH,
    });
    return { plan: null, malformed: true, mtimeMs: null };
  }

  if (!isTestrunPlan(parsed)) {
    report({
      code: PLAN_DIAGNOSTIC_CODES.cacheMalformed,
      severity: 'warn',
      message:
        `${PLAN_FILE_RELATIVE_PATH} is not the shape this version writes, so it is discarded ` +
        `and the plan is refreshed rather than trusted.`,
      file: PLAN_FILE_RELATIVE_PATH,
    });
    return { plan: null, malformed: true, mtimeMs: null };
  }

  let mtimeMs: number | null = null;
  try {
    mtimeMs = fs.mtimeMs(PLAN_FILE_RELATIVE_PATH);
  } catch {
    mtimeMs = null;
  }
  return { plan: parsed, malformed: false, mtimeMs };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Read the plan, refreshing when it is stale (§7.2, R4.4).
 *
 * Answers the plan Kane last enumerated, or `null` when there has never been one
 * and none could be obtained. Never throws for anything Kane or the filesystem
 * does.
 *
 * On a refused refresh — no invoker, no binary, a crashed stream, a stream with
 * no plan event — the previous cache is returned **untouched and unrewritten**.
 * That is the whole point of the module: a Kane hiccup must leave a working
 * verify path working, with the identifiers it had.
 */
export async function readPlan(request: ReadPlanRequest): Promise<TestrunPlan | null> {
  const sink = request.sink ?? createDiagnosticSink();
  const report: Report = (draft) => {
    sink.report(draft);
  };
  const fs = request.fs ?? nodePlanFileSystem(request.repoRoot ?? request.cwd);
  const nowMs = (request.now ?? Date.now)();
  const maxAgeMs = request.maxAgeMs ?? PLAN_MAX_AGE_MS;

  const cached = readCache(fs, report);
  const staleness = request.force === true
    ? { stale: true, reason: null, detail: 'a refresh was requested explicitly' }
    : planStaleness({
        plan: cached.plan,
        malformed: cached.malformed,
        cacheMtimeMs: cached.mtimeMs,
        newestTestDocument: newestTestDocument(fs, request.corpusRoot),
        nowMs,
        maxAgeMs,
      });

  if (!staleness.stale) return cached.plan;

  const invoker = request.invoker;
  if (invoker === undefined) {
    report({
      code: PLAN_DIAGNOSTIC_CODES.refreshUnavailable,
      severity: 'warn',
      message:
        `The testrun plan needs refreshing (${staleness.detail}) but no Kane invoker was ` +
        `supplied, so \`${PLAN_REFRESH_ARGV.join(' ')}\` did not run and the cached plan is ` +
        `left exactly as it was.`,
      file: PLAN_FILE_RELATIVE_PATH,
    });
    return keepCache(cached.plan, report);
  }

  const invocation: InvocationResult<typeof PLAN_FAMILY> = await invoker.invoke({
    family: PLAN_FAMILY,
    // No enabler: this family gets NDJSON from piped stdout, and `--agent` does
    // not exist here. The invoker asserts both (§4.7 steps 2–4, R3.5).
    argv: PLAN_REFRESH_ARGV,
    cwd: request.cwd,
    timeoutMs: request.timeoutMs ?? PLAN_REFRESH_TIMEOUT_MS,
  });

  if (invocation.exitMeaning === 'kane-not-found') {
    report({
      code: PLAN_DIAGNOSTIC_CODES.kaneNotFound,
      severity: 'warn',
      message:
        `kane-cli was not found, so \`${PLAN_REFRESH_ARGV.join(' ')}\` did not run and the ` +
        `cached plan is left exactly as it was (R2.12).`,
      file: null,
    });
    return keepCache(cached.plan, report);
  }

  const stream = parseStream(contractFor(PLAN_FAMILY), invocation.stdoutLines, { sink });

  // The gate was conjunctive — the terminal event **and** the plan event —
  // because a stream that stopped early may be missing members Kane had not
  // enumerated, which shrinks the blast radius silently. That reasoning is right
  // for an *execution* stream and wrong for this one, measured against 0.8.4
  // rather than assumed: `testrun run --dry-run` plans, validates, executes
  // nothing, prints **one line** — the `testrun_plan` event — and exits 0. There
  // is no `testrun_done`, because nothing was done. Requiring one rejected every
  // plan the installed CLI can produce, so `.kept/plan.json` was never written,
  // no identifier was ever derived, and `kept verify` reported an empty radius on
  // a repository with thirteen selectable members (15.3).
  //
  // So the gate is: a **clean exit** carrying a plan event is a complete dry run,
  // and anything else is still a crash. A truncated stream exits non-zero or was
  // terminated, and both keep the cache.
  const dryRunComplete =
    stream.kind === 'crashed' && stream.plan !== null && invocation.exitMeaning === 'success';
  if (dryRunComplete) {
    report({
      code: PLAN_DIAGNOSTIC_CODES.refreshedWithoutTerminal,
      severity: 'info',
      message:
        `\`${PLAN_REFRESH_ARGV.join(' ')}\` emitted its 'testrun_plan' event and exited cleanly ` +
        `without a '${stream.expectedTerminal}' event, which is what a dry run does: it executes ` +
        `nothing, so there is no execution to report done. The plan is accepted.`,
      file: PLAN_FILE_RELATIVE_PATH,
    });
  }

  if (stream.kind === 'crashed' && !dryRunComplete) {
    report({
      code: PLAN_DIAGNOSTIC_CODES.refreshCrashed,
      severity: 'warn',
      message:
        `\`${PLAN_REFRESH_ARGV.join(' ')}\` ended without its '${stream.expectedTerminal}' ` +
        `event${invocation.timedOut ? ' (it exceeded its budget and was terminated)' : ''}, so ` +
        `the outcome is unknown: the plan it carried is discarded and the previous ` +
        `${PLAN_FILE_RELATIVE_PATH} is left in place.`,
      file: PLAN_FILE_RELATIVE_PATH,
    });
    return keepCache(cached.plan, report);
  }

  if (stream.plan === null) {
    report({
      code: PLAN_DIAGNOSTIC_CODES.planEventAbsent,
      severity: 'warn',
      message:
        `\`${PLAN_REFRESH_ARGV.join(' ')}\` completed but emitted no 'testrun_plan' event, so ` +
        `there are no member identifiers to cache and the previous ` +
        `${PLAN_FILE_RELATIVE_PATH} is left in place.`,
      file: PLAN_FILE_RELATIVE_PATH,
    });
    return keepCache(cached.plan, report);
  }

  const refreshed = normalisePlanEvent(stream.plan, {
    capturedAt: new Date(nowMs).toISOString(),
    sink,
    repoRoot: request.repoRoot ?? request.cwd,
  });

  if (!refreshed.valid) {
    // Still a truthful plan: these members exist, Kane would just refuse to run
    // them. For this family that is exit 2 — preflight rejected, not a failure —
    // and each member's reason is carried on the member (R4.11).
    report({
      code: PLAN_DIAGNOSTIC_CODES.preflightInvalid,
      severity: 'warn',
      message:
        `\`${PLAN_REFRESH_ARGV.join(' ')}\` reported the suite as invalid: ` +
        `${refreshed.members.filter((member) => member.failure !== null).length} of ` +
        `${refreshed.members.length} member(s) carry a preflight rejection reason. The plan is ` +
        `cached as-is so the reasons can be surfaced.`,
      file: null,
    });
  }

  try {
    fs.ensureDir(dirname(PLAN_FILE_RELATIVE_PATH));
    fs.writeFile(PLAN_FILE_RELATIVE_PATH, serialisePlan(refreshed));
  } catch (cause) {
    report({
      code: PLAN_DIAGNOSTIC_CODES.cacheWriteFailed,
      severity: 'warn',
      message:
        `The refreshed plan could not be written to ${PLAN_FILE_RELATIVE_PATH} ` +
        `(${describe(cause)}); it is used for this run and re-fetched next time.`,
      file: PLAN_FILE_RELATIVE_PATH,
    });
  }

  const identified = refreshed.members.filter((member) => member.testId !== null).length;
  report({
    code: PLAN_DIAGNOSTIC_CODES.refreshed,
    severity: 'info',
    message:
      `\`${PLAN_REFRESH_ARGV.join(' ')}\` enumerated ${refreshed.members.length} member(s), ` +
      `${identified} of them carrying a test id (${staleness.detail}).`,
    file: null,
  });

  return refreshed;
}

/**
 * The refusal path: keep whatever was cached, and say so when there was nothing.
 * Separated out because "leave the cache alone" is the behaviour this module
 * exists to guarantee, and it should read the same on every path that takes it.
 */
function keepCache(plan: TestrunPlan | null, report: Report): TestrunPlan | null {
  if (plan === null) {
    report({
      code: PLAN_DIAGNOSTIC_CODES.unavailable,
      severity: 'warn',
      message:
        `No testrun plan is available: there was no cached ${PLAN_FILE_RELATIVE_PATH} and the ` +
        `refresh produced none. No assurance-graph identifier can be derived, so no blast ` +
        `radius can be computed and nothing is handed to Kane.`,
      file: PLAN_FILE_RELATIVE_PATH,
    });
  }
  return plan;
}
