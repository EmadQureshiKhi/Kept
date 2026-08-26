/**
 * The `.kept/sources.json` read-through cache (design §13.2.2, R5.2).
 *
 * `context/sources.ts` decides, `context/listing.ts` reads, and this module
 * *remembers*. It sits in front of `resolveSourceId` so the common case — a
 * README saved twice in a minute — costs no `context list` at all, and it is
 * built to the discipline `radius/plan.ts` established for `.kept/plan.json`
 * rather than to a second caching idiom.
 *
 * ```jsonc
 * // .kept/sources.json — beside plan.json and state.json
 * {
 *   "schemaVersion": 1,
 *   "refreshedAt": "2026-08-20T18:39:58.301Z",
 *   "listingSignature": "sha256:2c19…",   // hash of the projected listing
 *   "sources": [ … the projected StoreSource entries … ],
 *   "byPath": {
 *     "apps/fixture/README.md": {
 *       "sourceId": "src_7f31c0a4", "via": "exact-path",
 *       "digest": "c7dc998f…", "resolvedAt": "2026-08-20T18:39:58.301Z"
 *     }
 *   }
 * }
 * ```
 *
 * ## When a `byPath` hit is honoured
 *
 * Both conditions of §13.2.2, conjunctively: the entry is younger than
 * `maxAgeMs` (default ten minutes) **and** the cited file's mtime is not newer
 * than the entry's `resolvedAt`. Either one alone is too weak. Age alone would
 * hand `--source-id` a resolution taken before the edit that fired the hook,
 * which is the one moment the mapping is most likely to have moved; the mtime
 * alone would never notice a store that changed underneath a file nobody
 * touched. A miss on either is a refresh, not a guess.
 *
 * A honoured entry answers `via: 'cache'`, which is why that member leads
 * `SourceResolutionVia` — the cache adds a rung in front of the ladder without
 * changing a type. The *rung that originally answered* is kept on the entry as
 * a {@link LadderRung}, a type that cannot spell `cache`, so a cached record can
 * never claim it came from the cache it is stored in.
 *
 * ## `listingSignature`, and what it is for
 *
 * A hash of the **projected** listing: for each entry, its id, both path
 * spellings, its digest and its retirement, sorted by id so a store that
 * reordered its output is not mistaken for a store that changed. Two facts fall
 * out of it. A refresh whose signature equals the stored one leaves the recorded
 * `byPath` resolutions alone, because nothing they were derived from moved. A
 * refresh whose signature *differs* drops every one of them: an id may now point
 * at a different head, or have been retired, and a resolution derived from the
 * old listing is a claim about a store that no longer exists.
 *
 * The signature covers `absPath`, so it is scoped to the repository root it was
 * taken under. That is deliberate — a cache written for another root describes
 * files this one does not have.
 *
 * ## A failed refresh keeps the previous cache, and honours it
 *
 * This is the rule worth stating loudest, and it is the one `plan.ts` already
 * follows: when the listing cannot be read — no store, no binary, our own
 * timeout, a stream that never reached `done` — **nothing is written and nothing
 * is deleted**, and a previous `byPath` entry is still honoured even though it
 * was stale. A transient Kane hiccup must not turn a working docs branch into a
 * no-op.
 *
 * Honouring a stale entry is a considered trade, not a shortcut. The two
 * outcomes are: hand `maintain reconcile` an id that was correct minutes ago, or
 * hand it nothing. The first costs one process in the worst case, where Kane's
 * own checks five to seven refuse an id that has since gone or forked and exit
 * two with nothing mutated (§13.2.4) — data, not damage. The second is a save
 * that silently does nothing, which is the exact failure §13.2 exists to make
 * impossible. So the stale entry wins, and says so in a diagnostic.
 *
 * ## Nothing here throws, and nothing here spawns on its own
 *
 * An unreadable cache, a malformed one, an unwritable `.kept/` and every listing
 * failure are states of the world (§14.2) and all arrive as data. The one
 * invocation this module can cause is the listing's, through `listStoreSources`,
 * and only on a miss; a hit spawns nothing at all. Every failure still comes
 * back as the `ok: false` arm of {@link SourceResolution}, so a caller still
 * cannot reach a `--source-id` — which is the whole structural point of §13.2.
 */

import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';

import { createDiagnosticSink, type DiagnosticDraft, type DiagnosticSink } from '../diagnostics.js';
import type { KaneInvoker } from '../kane/invoker.js';
import { inMemoryStateFileSystem, nodeStateFileSystem, type StateFileSystem } from '../state.js';

import { listStoreSources, resolveSourceId, type SourceByteReader } from './listing.js';
import {
  LADDER_RUNGS,
  absoluteSourcePath,
  repoRelativeSourcePath,
  type LadderRung,
  type SourceResolution,
  type StoreSource,
} from './sources.js';

/** Where the cache lives. Gitignored: regenerable single-writer working state. */
export const SOURCES_CACHE_FILE_RELATIVE_PATH = '.kept/sources.json';

/** The only cache schema version this build reads or writes. */
export const SOURCES_CACHE_SCHEMA_VERSION = 1;

/** Default age at which a `byPath` entry stops being honoured (§13.2.2): ten minutes. */
export const SOURCES_CACHE_MAX_AGE_MS = 600_000;

/** The algorithm prefix {@link sourcesListingSignature} writes. */
export const LISTING_SIGNATURE_PREFIX = 'sha256:';

/** Diagnostic codes this module reports. Stable strings; the Ledger keys off them. */
export const SOURCE_CACHE_DIAGNOSTIC_CODES = Object.freeze({
  /** The cache file could not be read. Treated as absent, and refreshed. */
  unreadable: 'sources-cache-unreadable',
  /** The file parsed but is not the shape this module writes. Discarded. */
  malformed: 'sources-cache-malformed',
  /** The refreshed cache could not be written. The resolution still stands. */
  writeFailed: 'sources-cache-write-failed',
  /** A `byPath` entry answered, so no `context list` ran at all. */
  hit: 'sources-cache-hit',
  /** The entry was there and not honoured. Carries which condition failed. */
  stale: 'sources-cache-stale',
  /** The listing was refreshed and the cache rewritten. */
  refreshed: 'sources-cache-refreshed',
  /** The listing changed shape, so every recorded resolution was dropped. */
  churn: 'sources-cache-listing-churn',
  /** A refresh failed and the previous entry was honoured anyway. */
  refreshFailedEntryHonoured: 'sources-cache-refresh-failed-entry-honoured',
  /** A refresh failed and there was no previous entry to fall back on. */
  refreshFailedNoEntry: 'sources-cache-refresh-failed-no-entry',
  /** An entry named an id the cached listing does not carry. Refreshed. */
  inconsistent: 'sources-cache-entry-inconsistent',
} as const);

/** Every code above, for the Ledger's filter list and for the tests. */
export const SOURCE_CACHE_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(SOURCE_CACHE_DIAGNOSTIC_CODES),
);

/**
 * One recorded resolution, keyed by repo-relative POSIX path.
 *
 * `via` is a {@link LadderRung} rather than a `SourceResolutionVia`: the four
 * rungs are the only things that can *originate* a resolution, so a stored
 * entry cannot claim `cache` as its provenance and a cache hit reporting a hit
 * of a hit is not expressible.
 */
export interface SourceCacheEntry {
  readonly sourceId: string;
  /** The rung that answered when this entry was recorded. Never `cache`. */
  readonly via: LadderRung;
  /** The file's digest at the time, lowercase hex with no prefix, or null. */
  readonly digest: string | null;
  /** ISO 8601 instant the resolution was taken. The mtime is compared to this. */
  readonly resolvedAt: string;
}

/** The cache file (§13.2.2). Plain JSON: no `Date`, no `undefined`. */
export interface SourcesCache {
  readonly schemaVersion: number;
  /** ISO 8601 instant the listing behind `sources` was read. */
  readonly refreshedAt: string;
  /** {@link sourcesListingSignature} of `sources`, so store churn is detected. */
  readonly listingSignature: string;
  readonly sources: readonly StoreSource[];
  readonly byPath: Readonly<Record<string, SourceCacheEntry>>;
}

/** Absolute path of the cache file under a repository root. Pure. */
export function sourcesCachePath(repoRoot: string): string {
  return repoRoot.endsWith('/')
    ? `${repoRoot}${SOURCES_CACHE_FILE_RELATIVE_PATH}`
    : `${repoRoot}/${SOURCES_CACHE_FILE_RELATIVE_PATH}`;
}

/** The directory part of a path, or the path itself when it has no separator. */
function dirOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? path : path.slice(0, cut);
}

/**
 * Hash the projected listing (§13.2.2).
 *
 * Sorted by id, so wire order is not mistaken for a change; one line per entry
 * carrying every projected field the ladder can match on, with explicit markers
 * for absent values so a null path and the literal string `null` cannot collide.
 * `raw` is excluded: it is the unprojected entry, kept for diagnostics, and an
 * `ingested_at` stamp moving inside it is not a change to anything the ladder
 * reads.
 */
export function sourcesListingSignature(sources: readonly StoreSource[]): string {
  const rows = [...sources]
    .map((source) => ({
      sourceId: source.sourceId,
      path: source.path,
      absPath: source.absPath,
      digest: source.digest,
      retired: source.retired,
    }))
    .sort((left, right) => (left.sourceId < right.sourceId ? -1 : left.sourceId > right.sourceId ? 1 : 0));
  const hash = createHash('sha256');
  hash.update(JSON.stringify(rows));
  return `${LISTING_SIGNATURE_PREFIX}${hash.digest('hex')}`;
}

/** Structural guard for one recorded entry. */
export function isSourceCacheEntry(value: unknown): value is SourceCacheEntry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const sourceId = candidate['sourceId'];
  if (typeof sourceId !== 'string' || sourceId.length === 0) return false;
  if (!(LADDER_RUNGS as readonly string[]).includes(candidate['via'] as string)) return false;
  const digest = candidate['digest'];
  if (digest !== null && (typeof digest !== 'string' || digest.length === 0)) return false;
  const resolvedAt = candidate['resolvedAt'];
  return typeof resolvedAt === 'string' && !Number.isNaN(Date.parse(resolvedAt));
}

/** Structural guard for one projected source read back off disk. */
function isStoreSource(value: unknown): value is StoreSource {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const sourceId = candidate['sourceId'];
  if (typeof sourceId !== 'string' || sourceId.length === 0) return false;
  for (const key of ['path', 'absPath', 'digest'] as const) {
    if (!(key in candidate)) return false;
    const field = candidate[key];
    if (field !== null && typeof field !== 'string') return false;
  }
  if (typeof candidate['retired'] !== 'boolean') return false;
  return 'raw' in candidate;
}

/**
 * Structural guard for a cache read back off disk.
 *
 * Anything that fails it is treated as an absent cache, because a file this
 * module did not write is a file whose ids cannot be trusted to be Kane's — and
 * an id is the one thing `--source-id` is built from.
 */
export function isSourcesCache(value: unknown): value is SourcesCache {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['schemaVersion'] !== SOURCES_CACHE_SCHEMA_VERSION) return false;
  const refreshedAt = candidate['refreshedAt'];
  if (typeof refreshedAt !== 'string' || Number.isNaN(Date.parse(refreshedAt))) return false;
  const signature = candidate['listingSignature'];
  if (typeof signature !== 'string' || signature.length === 0) return false;
  const sources = candidate['sources'];
  if (!Array.isArray(sources) || !sources.every((entry) => isStoreSource(entry))) return false;
  const byPath = candidate['byPath'];
  if (typeof byPath !== 'object' || byPath === null || Array.isArray(byPath)) return false;
  return Object.values(byPath as Record<string, unknown>).every((entry) =>
    isSourceCacheEntry(entry),
  );
}

/** Canonical bytes: `byPath` keys sorted, two-space indent, one trailing newline. */
export function serialiseSourcesCache(cache: SourcesCache): string {
  const byPath: Record<string, SourceCacheEntry> = {};
  for (const key of Object.keys(cache.byPath).sort()) {
    const entry = cache.byPath[key];
    if (entry !== undefined) byPath[key] = entry;
  }
  return `${JSON.stringify(
    {
      schemaVersion: SOURCES_CACHE_SCHEMA_VERSION,
      refreshedAt: cache.refreshedAt,
      listingSignature: cache.listingSignature,
      sources: cache.sources,
      byPath,
    },
    null,
    2,
  )}\n`;
}

/** Why a cached resolution was not honoured, or `null` when it was. */
export type SourceCacheStaleReason =
  | 'missing'
  | 'malformed'
  | 'no-entry'
  | 'expired'
  | 'file-newer'
  | 'entry-inconsistent'
  | 'forced';

/** The staleness verdict, with the evidence that produced it. */
export interface SourceCacheStaleness {
  readonly stale: boolean;
  readonly reason: SourceCacheStaleReason | null;
  /** Human-readable evidence, for the diagnostic the caller records. */
  readonly detail: string;
}

/** What {@link sourceCacheStaleness} needs. Pure — no filesystem, no clock. */
export interface SourceCacheStalenessRequest {
  /** The cache as it was found, or null when there is none. */
  readonly cache: SourcesCache | null;
  /** Whether a file existed but failed {@link isSourcesCache}. */
  readonly malformed?: boolean;
  /** The recorded entry for the cited path, or null. */
  readonly entry?: SourceCacheEntry | null;
  /** Whether the entry's id is present and live in `cache.sources`. */
  readonly entrySourceLive?: boolean;
  /** The cited file's mtime in epoch ms, or null when it is unknown. */
  readonly fileMtimeMs?: number | null;
  readonly nowMs: number;
  readonly maxAgeMs: number;
  /** A caller that asked for a refresh regardless. */
  readonly force?: boolean;
}

/**
 * The honouring rule of §13.2.2, decided in one place so the reason a refresh
 * happened can be reported rather than inferred.
 *
 * A non-finite or non-positive `maxAgeMs` disables the age condition rather than
 * refreshing every time: "no age limit" is a legitimate ask for an offline run,
 * and the mtime condition still holds. An **unknown** mtime is not a pass — a
 * file we cannot stat is a file whose relationship to `resolvedAt` we do not
 * know, and the honest answer to not knowing is one `context list`.
 */
export function sourceCacheStaleness(
  request: SourceCacheStalenessRequest,
): SourceCacheStaleness {
  if (request.force === true) {
    return { stale: true, reason: 'forced', detail: 'a refresh was requested explicitly' };
  }
  if (request.cache === null) {
    return request.malformed === true
      ? {
          stale: true,
          reason: 'malformed',
          detail: `${SOURCES_CACHE_FILE_RELATIVE_PATH} is not a cache this version wrote`,
        }
      : {
          stale: true,
          reason: 'missing',
          detail: `${SOURCES_CACHE_FILE_RELATIVE_PATH} is absent`,
        };
  }
  const entry = request.entry ?? null;
  if (entry === null) {
    return {
      stale: true,
      reason: 'no-entry',
      detail: `${SOURCES_CACHE_FILE_RELATIVE_PATH} records no resolution for this path`,
    };
  }
  if (request.entrySourceLive === false) {
    return {
      stale: true,
      reason: 'entry-inconsistent',
      detail: `the recorded id ${entry.sourceId} is not a live source in the cached listing`,
    };
  }

  const resolvedAtMs = Date.parse(entry.resolvedAt);
  if (!Number.isFinite(resolvedAtMs)) {
    return {
      stale: true,
      reason: 'malformed',
      detail: `the recorded resolvedAt '${entry.resolvedAt}' is not a readable instant`,
    };
  }

  if (Number.isFinite(request.maxAgeMs) && request.maxAgeMs > 0) {
    const ageMs = request.nowMs - resolvedAtMs;
    if (Number.isFinite(ageMs) && ageMs > request.maxAgeMs) {
      return {
        stale: true,
        reason: 'expired',
        detail: `resolved ${Math.round(ageMs / 1000)} s ago, older than the ${request.maxAgeMs} ms window`,
      };
    }
  }

  const mtimeMs = request.fileMtimeMs ?? null;
  if (mtimeMs === null) {
    return {
      stale: true,
      reason: 'file-newer',
      detail: 'the cited file has no readable modification time, so it cannot be compared',
    };
  }
  if (mtimeMs > resolvedAtMs) {
    return {
      stale: true,
      reason: 'file-newer',
      detail: `the cited file was modified after the resolution was recorded`,
    };
  }

  return { stale: false, reason: null, detail: 'the recorded resolution is current' };
}

/**
 * How a file's modification time is read. Injected so the whole module can be
 * tested with no disk, and separate from {@link StateFileSystem} because that
 * seam is shared with `state.ts` and `handoff.ts` and neither has any use for an
 * mtime.
 */
export type SourceMtimeReader = (absPath: string) => number | null;

/** The production reader. Absence and errors are null, never a throw. */
export const nodeSourceMtimeReader: SourceMtimeReader = (absPath) => {
  const stats = statSync(absPath, { throwIfNoEntry: false });
  if (stats === undefined) return null;
  return Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : null;
};

/**
 * An in-memory cache filesystem plus mtimes, for tests and for the CLI's own
 * dry runs. `files` is {@link inMemoryStateFileSystem}'s map, so one stub serves
 * the cache, the state and the handoff.
 */
export function inMemorySourceCacheFileSystem(
  seed: Readonly<Record<string, string>> = {},
  mtimes: Readonly<Record<string, number>> = {},
): StateFileSystem & {
  readonly files: Map<string, string>;
  readonly mtimes: Map<string, number>;
  readonly mtimeMs: SourceMtimeReader;
} {
  const base = inMemoryStateFileSystem(seed);
  const stamps = new Map<string, number>(Object.entries(mtimes));
  return {
    ...base,
    mtimes: stamps,
    mtimeMs: (absPath: string): number | null => stamps.get(absPath) ?? null,
  };
}

/** {@link resolveSourceIdCached}'s input. Every default is production. */
export interface ResolveSourceIdCachedRequest {
  /** Absolute repository root. The cache sits at `.kept/sources.json` under it. */
  readonly repoRoot: string;
  /** The changed document, repo-relative or absolute. */
  readonly file: string;
  /** The Kane process boundary. Absent is supported and answers a reason. */
  readonly invoker?: KaneInvoker | undefined;
  /** Working directory for the listing. Defaults to `repoRoot`. */
  readonly cwd?: string | undefined;
  /** Listing budget in ms. Passed through to `listStoreSources`. */
  readonly timeoutMs?: number | undefined;
  /** Where diagnostics go. The returned diagnostic is also recorded here. */
  readonly diagnostics?: DiagnosticSink | undefined;
  /** Age at which an entry stops being honoured. Defaults to ten minutes. */
  readonly maxAgeMs?: number | undefined;
  /** Injected clock, so `refreshedAt` and the window are deterministic. */
  readonly now?: (() => number) | undefined;
  /** The cache file seam. Defaults to the real filesystem. */
  readonly fileSystem?: StateFileSystem | undefined;
  /** The mtime seam. Defaults to {@link nodeSourceMtimeReader}. */
  readonly mtimeMs?: SourceMtimeReader | undefined;
  /** Byte reader for the digest rung, passed through to `resolveSourceId`. */
  readonly readBytes?: SourceByteReader | undefined;
  /** A digest already in hand. `null` states the bytes were unreadable. */
  readonly fileDigest?: string | null | undefined;
  /** Live tail, passed through to the invoker. */
  readonly onLine?: ((line: string) => void) | undefined;
  /** Refresh regardless of what the cache says. */
  readonly force?: boolean | undefined;
}

/** What one cached resolution did, and what it left on disk. */
export interface CachedSourceResolution {
  /** The resolution itself. `via: 'cache'` when a recorded entry answered. */
  readonly resolution: SourceResolution;
  /** The cache as it now stands, or null when there is none and none was written. */
  readonly cache: SourcesCache | null;
  /** Whether a recorded entry answered, so no process ran. */
  readonly hit: boolean;
  /** Whether a listing was invoked **and** read. False on a hit and on a failure. */
  readonly refreshed: boolean;
  /** Whether `.kept/sources.json` was rewritten by this call. */
  readonly wrote: boolean;
  /** Why the cache was refreshed, or that it was not. */
  readonly staleness: SourceCacheStaleness;
  /**
   * True when a refresh failed and a previous entry was honoured anyway — the
   * transient-hiccup path of §13.2.2. The cache was left exactly as it was.
   */
  readonly honouredStaleEntry: boolean;
}

/** How every path in this module records adversity: one draft, never a throw. */
type Report = (draft: DiagnosticDraft) => void;

/** The cache as it was found on disk, before any decision. */
interface FoundCache {
  readonly cache: SourcesCache | null;
  readonly malformed: boolean;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Read the cache, or report why it is being treated as absent.
 *
 * **No command calls this today.** The comment here used to say it was exported
 * because `kept doctor` and the CLI's own diagnostics want the file without
 * triggering a refresh, and neither of those is true: `kept doctor` reports on the
 * `.context/` store and never reads `.kept/sources.json` at all, and the only live
 * path into this file is {@link resolveSourceIdCached}, which finds the cache
 * through `findCache` internally. The exported name has one live consumer, which is
 * `context-sources-cache.test.ts` asserting the read side triggers nothing.
 *
 * It is kept exported rather than made private for the reason the second half of
 * the old comment gave, which does still hold: a caller that already holds a cache
 * can hand it to {@link sourceCacheStaleness} directly, and getting the file
 * *without* refreshing is the only way to ask "what does the cache say" without
 * risking a listing. A reader deciding whether to use it should know it would be
 * the first such caller.
 */
export function readSourcesCache(
  repoRoot: string,
  options: {
    readonly fileSystem?: StateFileSystem | undefined;
    readonly diagnostics?: DiagnosticSink | undefined;
  } = {},
): SourcesCache | null {
  const fileSystem = options.fileSystem ?? nodeStateFileSystem();
  const sink = options.diagnostics;
  const report: Report = (draft) => {
    sink?.report(draft);
  };
  return findCache(repoRoot, fileSystem, report).cache;
}

function findCache(repoRoot: string, fileSystem: StateFileSystem, report: Report): FoundCache {
  const path = sourcesCachePath(repoRoot);
  let text: string | null;
  try {
    text = fileSystem.readFile(path);
  } catch (cause) {
    report({
      code: SOURCE_CACHE_DIAGNOSTIC_CODES.unreadable,
      severity: 'warn',
      message:
        `${SOURCES_CACHE_FILE_RELATIVE_PATH} could not be read (${describe(cause)}), so it is ` +
        `treated as absent and the store listing is refreshed.`,
      file: SOURCES_CACHE_FILE_RELATIVE_PATH,
    });
    return { cache: null, malformed: false };
  }
  if (text === null) return { cache: null, malformed: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    report({
      code: SOURCE_CACHE_DIAGNOSTIC_CODES.malformed,
      severity: 'warn',
      message:
        `${SOURCES_CACHE_FILE_RELATIVE_PATH} is not valid JSON (${describe(cause)}), so it is ` +
        `discarded and the store listing is refreshed.`,
      file: SOURCES_CACHE_FILE_RELATIVE_PATH,
    });
    return { cache: null, malformed: true };
  }

  if (!isSourcesCache(parsed)) {
    report({
      code: SOURCE_CACHE_DIAGNOSTIC_CODES.malformed,
      severity: 'warn',
      message:
        `${SOURCES_CACHE_FILE_RELATIVE_PATH} is not the shape this version writes, so it is ` +
        `discarded rather than trusted: a source id from a file we did not write is an id we ` +
        `cannot vouch for.`,
      file: SOURCES_CACHE_FILE_RELATIVE_PATH,
    });
    return { cache: null, malformed: true };
  }

  return { cache: parsed, malformed: false };
}

/**
 * Write the cache. Answers whether the bytes landed; never throws.
 *
 * A failed write is reported and otherwise ignored: the resolution it would have
 * recorded is still correct, and the only cost of losing it is one extra
 * `context list` next time.
 */
export function writeSourcesCache(
  repoRoot: string,
  cache: SourcesCache,
  options: {
    readonly fileSystem?: StateFileSystem | undefined;
    readonly diagnostics?: DiagnosticSink | undefined;
  } = {},
): boolean {
  const fileSystem = options.fileSystem ?? nodeStateFileSystem();
  const path = sourcesCachePath(repoRoot);
  try {
    fileSystem.ensureDir(dirOf(path));
    fileSystem.writeFile(path, serialiseSourcesCache(cache));
    return true;
  } catch (cause) {
    options.diagnostics?.report({
      code: SOURCE_CACHE_DIAGNOSTIC_CODES.writeFailed,
      severity: 'warn',
      message:
        `${SOURCES_CACHE_FILE_RELATIVE_PATH} could not be written (${describe(cause)}), so the ` +
        `resolution stands but was not recorded: the next save costs one more \`context list\`.`,
      file: SOURCES_CACHE_FILE_RELATIVE_PATH,
    });
    return false;
  }
}

/** The live source an entry names, or null when the cached listing has none. */
function liveSourceFor(
  cache: SourcesCache | null,
  entry: SourceCacheEntry | null,
): StoreSource | null {
  if (cache === null || entry === null) return null;
  const found = cache.sources.find((source) => source.sourceId === entry.sourceId);
  if (found === undefined || found.retired) return null;
  return found;
}

/**
 * Resolve a source id through the read-through cache (§13.2.2, R5.2).
 *
 * A hit spawns nothing. A miss refreshes the listing once, walks the ladder over
 * it and records the answer. A failed refresh writes nothing, deletes nothing,
 * and falls back to whatever entry was already there.
 *
 * Total over every input, including a repository with no `.kept/` at all and a
 * file with no repo-relative form. Never throws.
 */
export async function resolveSourceIdCached(
  request: ResolveSourceIdCachedRequest,
): Promise<CachedSourceResolution> {
  const sink = request.diagnostics ?? createDiagnosticSink();
  const report: Report = (draft) => {
    sink.report(draft);
  };
  const fileSystem = request.fileSystem ?? nodeStateFileSystem();
  const mtimeOf = request.mtimeMs ?? nodeSourceMtimeReader;
  const nowMs = (request.now ?? Date.now)();
  const maxAgeMs = request.maxAgeMs ?? SOURCES_CACHE_MAX_AGE_MS;

  // The cache key. A file with no repo-relative form — absolute, a `file:` URI,
  // one that escapes the root — has no key at all, so it is resolved live every
  // time rather than recorded under a spelling another root would misread.
  const key = repoRelativeSourcePath(request.file);
  const absFile = absoluteSourcePath(request.repoRoot, request.file);

  const found = findCache(request.repoRoot, fileSystem, report);
  const entry = key === null ? null : (found.cache?.byPath[key] ?? null);
  const cachedSource = liveSourceFor(found.cache, entry);

  const staleness = sourceCacheStaleness({
    cache: found.cache,
    malformed: found.malformed,
    entry,
    entrySourceLive: entry === null ? undefined : cachedSource !== null,
    fileMtimeMs: absFile === null ? null : mtimeOf(absFile),
    nowMs,
    maxAgeMs,
    force: request.force,
  });

  if (!staleness.stale && cachedSource !== null && entry !== null) {
    report({
      code: SOURCE_CACHE_DIAGNOSTIC_CODES.hit,
      severity: 'info',
      message:
        `${key ?? request.file} resolves to source ${cachedSource.sourceId} from ` +
        `${SOURCES_CACHE_FILE_RELATIVE_PATH}, recorded via ${entry.via} at ${entry.resolvedAt}, ` +
        `so no \`context list\` was invoked.`,
      file: key,
    });
    return {
      resolution: { ok: true, source: cachedSource, via: 'cache' },
      cache: found.cache,
      hit: true,
      refreshed: false,
      wrote: false,
      staleness,
      honouredStaleEntry: false,
    };
  }

  if (entry !== null) {
    report({
      code:
        staleness.reason === 'entry-inconsistent'
          ? SOURCE_CACHE_DIAGNOSTIC_CODES.inconsistent
          : SOURCE_CACHE_DIAGNOSTIC_CODES.stale,
      severity: 'info',
      message:
        `The recorded resolution for ${key ?? request.file} was not honoured ` +
        `(${staleness.detail}), so the store listing is refreshed.`,
      file: key,
    });
  }

  const listing = await listStoreSources({
    repoRoot: request.repoRoot,
    invoker: request.invoker,
    cwd: request.cwd,
    timeoutMs: request.timeoutMs,
    diagnostics: sink,
    onLine: request.onLine,
  });

  if (!listing.ok) {
    // The transient-hiccup path. Nothing is written and nothing is deleted; a
    // previous entry is honoured even though it was stale, because the
    // alternative is a save that silently does nothing (§13.2.2).
    if (entry !== null && cachedSource !== null) {
      report({
        code: SOURCE_CACHE_DIAGNOSTIC_CODES.refreshFailedEntryHonoured,
        severity: 'warn',
        message:
          `The store listing could not be refreshed (${listing.reason}), so ` +
          `${SOURCES_CACHE_FILE_RELATIVE_PATH} was left exactly as it was and the recorded ` +
          `resolution of ${key ?? request.file} to source ${cachedSource.sourceId} is honoured ` +
          `anyway. A transient failure must not turn a working docs branch into a no-op; if the ` +
          `id has since moved, Kane's own checks refuse it with nothing mutated.`,
        file: key,
      });
      return {
        resolution: { ok: true, source: cachedSource, via: 'cache' },
        cache: found.cache,
        hit: false,
        refreshed: false,
        wrote: false,
        staleness,
        honouredStaleEntry: true,
      };
    }

    report({
      code: SOURCE_CACHE_DIAGNOSTIC_CODES.refreshFailedNoEntry,
      severity: 'info',
      message:
        `The store listing could not be refreshed (${listing.reason}) and ` +
        `${SOURCES_CACHE_FILE_RELATIVE_PATH} holds no resolution for ${key ?? request.file}, so ` +
        `no source id was resolved. The previous cache, if any, was left exactly as it was: ` +
        `nothing was invoked afterwards and no verdict moved.`,
      file: key,
    });
    return {
      resolution: { ok: false, reason: listing.reason, diagnostic: listing.diagnostic },
      cache: found.cache,
      hit: false,
      refreshed: false,
      wrote: false,
      staleness,
      honouredStaleEntry: false,
    };
  }

  // `sources` is supplied, so this walks the ladder without invoking anything:
  // one listing per refresh, never two.
  const resolution = await resolveSourceId({
    repoRoot: request.repoRoot,
    file: request.file,
    sources: listing.sources,
    diagnostics: sink,
    ...(request.fileDigest === undefined ? {} : { fileDigest: request.fileDigest }),
    ...(request.readBytes === undefined ? {} : { readBytes: request.readBytes }),
  });

  const signature = sourcesListingSignature(listing.sources);
  const churned = found.cache !== null && found.cache.listingSignature !== signature;
  if (churned) {
    report({
      code: SOURCE_CACHE_DIAGNOSTIC_CODES.churn,
      severity: 'info',
      message:
        `The store listing no longer hashes to the signature ` +
        `${SOURCES_CACHE_FILE_RELATIVE_PATH} recorded, so every resolution it held was dropped: ` +
        `an id derived from the old listing is a claim about a store that has since changed.`,
      file: SOURCES_CACHE_FILE_RELATIVE_PATH,
    });
  }

  const byPath: Record<string, SourceCacheEntry> = {};
  if (!churned && found.cache !== null) {
    for (const [path, recorded] of Object.entries(found.cache.byPath)) {
      byPath[path] = recorded;
    }
  }
  const at = new Date(nowMs).toISOString();
  if (key !== null) {
    if (resolution.ok && resolution.via !== 'cache') {
      byPath[key] = {
        sourceId: resolution.source.sourceId,
        via: resolution.via,
        digest: resolution.source.digest,
        resolvedAt: at,
      };
    } else {
      // A fresh listing that does not resolve corrects the record rather than
      // leaving a resolution the store no longer backs: otherwise a later
      // refresh failure would honour an entry this listing just disproved.
      delete byPath[key];
    }
  }

  const cache: SourcesCache = {
    schemaVersion: SOURCES_CACHE_SCHEMA_VERSION,
    refreshedAt: at,
    listingSignature: signature,
    sources: listing.sources,
    byPath,
  };

  const wrote = writeSourcesCache(request.repoRoot, cache, {
    fileSystem,
    diagnostics: sink,
  });
  if (wrote) {
    report({
      code: SOURCE_CACHE_DIAGNOSTIC_CODES.refreshed,
      severity: 'info',
      message:
        `${SOURCES_CACHE_FILE_RELATIVE_PATH} was refreshed from a listing of ` +
        `${listing.sources.length} source${listing.sources.length === 1 ? '' : 's'} ` +
        `(${staleness.detail}), signature ${signature}.`,
      file: SOURCES_CACHE_FILE_RELATIVE_PATH,
    });
  }

  return {
    resolution,
    cache,
    hit: false,
    refreshed: true,
    wrote,
    staleness,
    honouredStaleEntry: false,
  };
}
