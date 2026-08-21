/**
 * Source-id resolution — the four-rung match ladder (design §13.2.2, R5.1, R5.2).
 *
 * ## Why this module exists, stated once
 *
 * `kane-cli maintain reconcile` **requires** both `--from <file>` and
 * `--source-id <id>`; verified against the installed 0.8.4 by its own `--help`.
 * An earlier version of the design issued a bare `maintain reconcile --mode
 * agent`, which would have exited 2 on every single save while looking perfectly
 * wired up — a dead docs branch nobody would notice until they read an exit code.
 *
 * The correction is structural rather than disciplinary. `--source-id` can only be
 * built from the `ok: true` arm of {@link SourceResolution}, and that arm carries a
 * `StoreSource` this module matched against the live store. So an unresolved source
 * is **not expressible** as a spawn: no process, no credit, no review card, no
 * verdict movement, `degraded` still false, exit 0 (§14.1). Everything below exists
 * to make the unresolved case a returned value instead of a bad argv.
 *
 * ## No fuzzy matching at any rung
 *
 * | # | rung | rule |
 * |---|---|---|
 * | 1 | `exact-path` | repo-relative POSIX path equality against the projected `path` |
 * | 2 | `abs-path` | absolute-path equality after resolving both sides against `repoRoot` |
 * | 3 | `digest` | sha256 of the file's current bytes equals the recorded digest |
 * | 4 | `unique-basename` | basename equality **and exactly one live candidate** |
 * | 5 | `basename-slug` | the file's slugified basename equals the slugified id, **and exactly one live candidate** |
 *
 * ## Why there is a fifth rung, and why it is last
 *
 * Observed, not assumed. The live store's projection carries `id, cid, label,
 * title, trust, fresh` — **no path key at all**, and `cid` is not one of
 * `digest | sha256 | hash | content_hash`, so rungs 1, 2 and 4 have nothing to
 * read and rung 3 has nothing to compare against. Nor is the path recoverable:
 * `context explain readme` replays only `minted` and `head_move`, and no file
 * under `.context/` contains the string `README`. The three hashes in play are all
 * different — `cid sha256:883da226…`, the ingest line's `blob sha256:2d6ab576…`,
 * and the file's own `shasum -a 256` `b2118de7…` — so Kane does not key a source
 * by the digest KEPT computes.
 *
 * **Kane keys a source by content and by slug, not by repository path.** The one
 * thread that survives is the slug: `apps/fixture/README.md` was ingested and the
 * source it minted is `id: readme`. Matching on that is the difference between a
 * docs branch that works and one that silently does nothing, and it is recorded at
 * `docs/kane/reconcile/` rather than inferred.
 *
 * It is **last** so it can never shadow a stronger match: a store that does
 * publish a path is still matched on the path, and the slug is consulted only when
 * every rung above it found nothing. And it is subject to the same uniqueness rule
 * as rung 4 — two live entries whose ids slugify to one value are `ambiguous`, not
 * a coin flip — because a slug is a *lossier* key than a basename and the answer to
 * a lossy tie is a human, not a guess.
 *
 * First hit wins, and a hit is only a hit when it is unambiguous. Two or more live
 * candidates tying at one rung is {@link SourceResolution} `ambiguous` — never a
 * coin flip, never "the first one", never "the lower id". Titles, use-case names
 * and ordinal position are never consulted; the listing carries all three and this
 * module reads none of them. That is the requirement most easily violated by a
 * helpful-looking fallback, so the ladder is written as four explicit rungs over
 * normalised values rather than as a scoring function with a threshold.
 *
 * Normalisation is not fuzziness. `sha256:9e0c…` and `9e0c…` are the same digest in
 * two spellings, and `a/./b` and `a/b` are the same file; recognising that is
 * reading the value, not guessing at it. What would make it fuzzy is deciding that
 * two *different* values are close enough, and nothing here does that.
 *
 * ## Retirement is decided at the winning rung, not globally
 *
 * A matched-but-retired entry resolves to `reason: 'retired'` rather than being
 * handed to Kane, so `maintain reconcile`'s own check 6 (§13.2.4) is never reached
 * on the normal path. But retirement is evaluated *against what matched*: a retired
 * duplicate does not make a live match ambiguous, because a retired source cannot
 * fork a graph. Only two **live** candidates can, and that is exactly the fork
 * guard of §13.2.4 #7.
 *
 * ## What this file does not do
 *
 * It starts no process and reads no file. The ladder takes an already-projected
 * listing and an already-computed digest, which is what lets every rung be tested
 * over committed bytes with no Kane and no disk. `resolveSourceId` — the function
 * that invokes `context list --type source --json`, projects it and walks this
 * ladder — lives beside it and composes the two.
 */

import { createHash } from 'node:crypto';
import { isAbsolute, posix, resolve } from 'node:path';

import type { Diagnostic, DiagnosticSink } from '../diagnostics.js';
import { toPosix } from '../model/ids.js';

/**
 * One entry of the store listing, after tolerant projection (§13.2.2).
 *
 * Every field but `sourceId` and `retired` is explicitly nullable, because the
 * store's internal schema is not pinned by observation and an entry that carried
 * no path is a normal entry rather than a broken one — it is exactly the case the
 * `digest` rung exists to serve.
 */
export interface StoreSource {
  /** The id `--source-id` is built from. Non-empty, trimmed; the only required field. */
  readonly sourceId: string;
  /**
   * Repo-relative POSIX path, normalised from whatever key carried it, or null.
   *
   * Null when the entry carried no path-ish field at all, and null when the value
   * was absolute or a `file:` URI — those spellings cannot be repo-relative, and
   * inventing a relative form for them here would make rung 2 unreachable and
   * quietly relabel an `abs-path` match as an `exact-path` one.
   */
  readonly path: string | null;
  /** Absolute path, resolved against `repoRoot`, or null when no path-ish field arrived. */
  readonly absPath: string | null;
  /** Recorded content hash, lowercased hex with any `sha256:` prefix stripped, or null. */
  readonly digest: string | null;
  /** Whether the entry is retired. False when the listing said nothing (see below). */
  readonly retired: boolean;
  /** The unprojected entry, kept verbatim for diagnostics (§13.2.2). */
  readonly raw: unknown;
}

/** How a resolution found its source. `cache` is the read-through cache's rung (12.3). */
export type SourceResolutionVia =
  | 'cache'
  | 'exact-path'
  | 'abs-path'
  | 'digest'
  | 'unique-basename'
  | 'basename-slug';

/** Every `via` value, in ladder order with `cache` in front of it. */
export const SOURCE_RESOLUTION_VIA: readonly SourceResolutionVia[] = Object.freeze([
  'cache',
  'exact-path',
  'abs-path',
  'digest',
  'unique-basename',
  'basename-slug',
]);

/**
 * Why a resolution failed. Closed vocabulary from §13.2.2.
 *
 * All six take the same six steps of §13.2.2 — diagnostic, no spawn, no review
 * card, verdicts and freshness untouched, handoff with `branch: null`, exit 0 — and
 * differ only in their message. None of them sets `degraded`: `degraded` reports
 * that the *proven axis* is untrustworthy, and an unresolved source loses no proven
 * data at all.
 */
export type SourceResolutionReason =
  | 'no-store'
  | 'listing-unreadable'
  | 'crashed-stream'
  | 'no-match'
  | 'ambiguous'
  | 'retired';

/** Every failure reason, in the order §13.2.2 lists them. */
export const SOURCE_RESOLUTION_REASONS: readonly SourceResolutionReason[] = Object.freeze([
  'no-store',
  'listing-unreadable',
  'crashed-stream',
  'no-match',
  'ambiguous',
  'retired',
]);

/**
 * The resolution result (§13.2.2).
 *
 * A discriminated union rather than a nullable id, because `--source-id` is built
 * from `source.sourceId` and the `ok: true` arm is the only place that field is
 * reachable. A caller cannot spawn `maintain reconcile` from a failure without
 * first inventing an id, which is the one thing §13.2.2 forbids outright.
 */
export type SourceResolution =
  | { readonly ok: true; readonly source: StoreSource; readonly via: SourceResolutionVia }
  | {
      readonly ok: false;
      readonly reason: SourceResolutionReason;
      readonly diagnostic: Diagnostic;
    };

/**
 * Diagnostic codes this module reports. `reconcile-source-unresolved` is fixed by
 * design §13.2.2 — the Ledger's `/runs` page keys off it to render the
 * `context ingest` remedy — and the rest follow its shape, one per reason so a
 * reviewer is never told "unresolved" when the truth is "ambiguous".
 */
export const SOURCE_DIAGNOSTIC_CODES = Object.freeze({
  /** `no-match`: nothing in the store backs this file. Names the ingest remedy. */
  unresolved: 'reconcile-source-unresolved',
  /** `no-store`: the listing refused because there is no `.context/` store yet. */
  noStore: 'reconcile-source-no-store',
  /** `listing-unreadable`: a listing we could not read, or could not ask for. */
  listingUnreadable: 'reconcile-source-listing-unreadable',
  /** `crashed-stream`: the listing stream ended without its terminal event. */
  crashedStream: 'reconcile-source-listing-crashed',
  /** `ambiguous`: two or more live candidates tied at one rung. Names every id. */
  ambiguous: 'reconcile-source-ambiguous',
  /** `retired`: the match is a retired entry, so it is never handed to Kane. */
  retired: 'reconcile-source-retired',
  /** The accepted path, recorded so a reviewer can see which rung answered. */
  resolved: 'reconcile-source-resolved',
} as const);

/** Every code above, for the Ledger's filter list and for the ladder tests. */
export const SOURCE_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(SOURCE_DIAGNOSTIC_CODES),
);

/** The code that reports each failure reason. Total over the vocabulary. */
export const SOURCE_REASON_DIAGNOSTIC_CODE: {
  readonly [R in SourceResolutionReason]: string;
} = Object.freeze({
  'no-store': SOURCE_DIAGNOSTIC_CODES.noStore,
  'listing-unreadable': SOURCE_DIAGNOSTIC_CODES.listingUnreadable,
  'crashed-stream': SOURCE_DIAGNOSTIC_CODES.crashedStream,
  'no-match': SOURCE_DIAGNOSTIC_CODES.unresolved,
  ambiguous: SOURCE_DIAGNOSTIC_CODES.ambiguous,
  retired: SOURCE_DIAGNOSTIC_CODES.retired,
});

/** Prefix a digest may carry in the listing. Stripped before comparison. */
export const DIGEST_ALGORITHM_PREFIX = 'sha256:';

/**
 * The `file:` URI scheme the `uri` key family can carry, matched **however many
 * slashes survived normalisation**.
 *
 * This is deliberately not the literal `file://`. `normaliseSourcePath` runs
 * `toPosix`, which collapses repeated separators, so `file:///abs/path` arrives
 * here as `file:/abs/path` and a literal-prefix test would miss it — projecting a
 * URI as though it were a repo-relative path called `file:/abs/path`, which would
 * put a bogus candidate on rung 1 and a real basename on rung 4. One or more
 * slashes are required, so an opaque `file:relative.md` is left alone rather than
 * promoted to an absolute path it never named.
 */
const FILE_URI_PREFIX = /^file:\/+/i;

/** Is this normalised value a `file:` URI in any surviving spelling? */
function isFileUri(value: string): boolean {
  return FILE_URI_PREFIX.test(value);
}

/**
 * Normalise a path-ish value the way `normaliseCoveragePath` does (§5.3): POSIX
 * separators, trimmed, no leading `./`, no trailing `/`.
 *
 * Deliberately **not** canonicalising `.` and `..` segments. Rung 1 is string
 * equality over this form and rung 2 is equality over the *resolved* form, so
 * collapsing segments here would fold rung 2 into rung 1 and leave the ladder with
 * three live rungs and one that can never report itself. An entry the store
 * recorded as `apps/fixture/./docs/../app/settings/page.tsx` is the case rung 2 was
 * written for.
 *
 * Answers null for anything that is not a non-empty string.
 */
export function normaliseSourcePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let path = toPosix(value).trim();
  while (path.startsWith('./')) path = path.slice(2);
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path.length === 0 ? null : path;
}

/**
 * Decode a `file:` URI into a filesystem path, or answer the value unchanged.
 *
 * The `uri` key family means a URI is possible, and a percent-encoded space in a
 * path is not a different file from a literal one. A URI that fails to decode is
 * returned as-is rather than dropped: an unmatched candidate is a better outcome
 * than a silently discarded entry.
 */
function decodePathish(value: string): string {
  if (!isFileUri(value)) return value;
  // Strip the scheme and whatever slashes survived normalisation, then restore the
  // single leading one that makes the remainder an absolute path. `file://host/path`
  // is not something a local store emits, and reading its host as a path segment is
  // the safer misread.
  const path = `/${value.replace(FILE_URI_PREFIX, '')}`;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** Is this normalised value already an absolute path, or a `file:` URI? */
function isAbsoluteish(value: string): boolean {
  return (
    value.startsWith('/') || isAbsolute(value) || isFileUri(value) || /^[A-Za-z]:\//.test(value)
  );
}

/**
 * The repo-relative POSIX form of a path-ish value, or null when there is none.
 *
 * Null for an absolute path, a `file:` URI, and a relative path that escapes the
 * repository through `..` — none of those *is* a repo-relative path, and answering
 * a derived one would make rung 1 fire where rung 2 belongs.
 */
export function repoRelativeSourcePath(value: unknown): string | null {
  const normalised = normaliseSourcePath(value);
  if (normalised === null) return null;
  if (isAbsoluteish(normalised)) return null;
  if (normalised === '..' || normalised.startsWith('../')) return null;
  return normalised;
}

/**
 * The absolute form of a path-ish value, resolved against `repoRoot`.
 *
 * This is the rung-2 key, and it is where `.` and `..` are collapsed — by
 * `node:path.resolve`, so the platform's own rules apply rather than a hand-rolled
 * imitation of them. Null only when the value is not a usable path.
 */
export function absoluteSourcePath(repoRoot: string, value: unknown): string | null {
  const normalised = normaliseSourcePath(value);
  if (normalised === null) return null;
  const decoded = decodePathish(normalised);
  if (decoded.length === 0) return null;
  return resolve(repoRoot, decoded);
}

/**
 * Normalise a digest for comparison: trimmed, lowercased, `sha256:` prefix
 * stripped. Answers null for anything that is not a non-empty string.
 *
 * Nothing here validates the hex length. A store that records a different digest
 * width would simply not match, and refusing the value outright would turn a
 * missed rung into a discarded entry that also cannot match on its path.
 */
export function normaliseDigest(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let text = value.trim().toLowerCase();
  if (text.startsWith(DIGEST_ALGORITHM_PREFIX)) {
    text = text.slice(DIGEST_ALGORITHM_PREFIX.length).trim();
  }
  return text.length === 0 ? null : text;
}

/**
 * sha256 of a file's current bytes, as lowercase hex (rung 3).
 *
 * Hashes **bytes**, not decoded text, which is why this does not reuse
 * `sha256Hex` from `model/ids.ts`: that function hashes a string as UTF-8, and a
 * lossy decode of a file that is not valid UTF-8 would silently change the hash.
 * A string is accepted for callers that already hold the text, and is encoded as
 * UTF-8 — identical bytes for every document type the ingest allow-list admits.
 */
export function sourceDigest(bytes: Uint8Array | string): string {
  const hash = createHash('sha256');
  hash.update(typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes);
  return hash.digest('hex');
}

/** Basename of a repo-relative or absolute POSIX path. Empty string when there is none. */
function basenameOf(path: string): string {
  return posix.basename(toPosix(path));
}

/**
 * The slug of a name: lowercased, every run of characters that is not a letter or
 * a digit collapsed to one `-`, and the result trimmed of `-` (rung 5).
 *
 * This is the normalisation Kane's own ids carry — `README.md` was ingested and
 * became `readme` — and it is applied to **both** sides so the comparison is
 * equality over one form rather than a similarity test. Two values that slugify
 * differently do not match; nothing here decides that two different values are
 * close enough, which is what would make it fuzzy.
 *
 * Answers the empty string when nothing survives, and an empty slug never
 * matches: a file called `---.md` names no source, and letting empty equal empty
 * would match it against every id that also slugifies to nothing.
 */
export function slugOfName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

/**
 * The slug of a file's basename, with its extension dropped first (rung 5).
 *
 * The extension goes because Kane's id for `README.md` is `readme` rather than
 * `readme-md`. A leading-dot name keeps its whole basename — `.eslintrc` has no
 * extension to drop, it has a name that starts with a dot.
 *
 * That guard is deliberate all the way down, so `.md` slugifies to `md` rather
 * than to nothing. `md` is an ordinary slug that matches whatever id also
 * slugifies to `md` and nothing else; it is not a wildcard, so there is no rule
 * here for it to break. The rule this rung does need is that an *empty* slug
 * never matches, and that is enforced by {@link matchStoreSources} refusing to
 * compare when either side normalises away — `---.md` names no source.
 */
export function basenameSlug(path: string): string {
  const base = basenameOf(path);
  if (base.length === 0) return '';
  const cut = base.lastIndexOf('.');
  return slugOfName(cut <= 0 ? base : base.slice(0, cut));
}

/** The five rungs, in ladder order. `cache` is not a rung — it precedes the ladder. */
export type LadderRung = Exclude<SourceResolutionVia, 'cache'>;

/** The rungs, in the order {@link resolveFromSources} walks them. */
export const LADDER_RUNGS: readonly LadderRung[] = Object.freeze([
  'exact-path',
  'abs-path',
  'digest',
  'unique-basename',
  'basename-slug',
]);

/** What {@link matchStoreSources} was asked to match against. */
export interface SourceMatchRequest {
  /** Absolute repository root. Both sides of rung 2 are resolved against it. */
  readonly repoRoot: string;
  /** The changed document, repo-relative or absolute; normalised internally. */
  readonly file: string;
  /** The projected listing, live and retired entries together. */
  readonly sources: readonly StoreSource[];
  /**
   * sha256 of the file's current bytes, as lowercase hex, or null when the bytes
   * could not be read. Null simply skips rung 3 — a file we cannot read is not a
   * file whose digest is "no digest", and treating the two alike would let an
   * entry with no recorded digest match an unreadable file.
   */
  readonly fileDigest?: string | null | undefined;
}

/** Candidates per rung, live and retired kept apart. */
export interface RungMatches {
  readonly rung: LadderRung;
  /** Non-retired candidates. Two or more of these is the fork guard's condition. */
  readonly live: readonly StoreSource[];
  /** Retired candidates that matched the same rung. */
  readonly retired: readonly StoreSource[];
}

/** Everything the ladder saw, rung by rung. Exported for the fork guard of §13.2.4 #7. */
export interface SourceMatchSet {
  /** The request's file as a repo-relative POSIX path, or null when it escapes the root. */
  readonly relPath: string | null;
  /** The request's file, resolved absolute. */
  readonly absPath: string;
  /** The digest that was compared, or null when rung 3 was skipped. */
  readonly fileDigest: string | null;
  /** The slug rung 5 compared, or the empty string when the file has none. */
  readonly fileSlug: string;
  /** One entry per rung, in ladder order. Always {@link LADDER_RUNGS}.length entries. */
  readonly rungs: readonly RungMatches[];
}

function partition(candidates: readonly StoreSource[]): {
  live: StoreSource[];
  retired: StoreSource[];
} {
  const live: StoreSource[] = [];
  const retired: StoreSource[] = [];
  for (const candidate of candidates) {
    if (candidate.retired) retired.push(candidate);
    else live.push(candidate);
  }
  return { live, retired };
}

/**
 * Compute every rung's candidates without deciding anything.
 *
 * Exported because the fork guard of §13.2.4 #7 asks a different question than the
 * ladder does — "does this file already back a *different* live source?" — and it
 * needs the same match sets to answer it. Keeping the matching here means the guard
 * and the ladder can never disagree about what "matches" means.
 */
export function matchStoreSources(request: SourceMatchRequest): SourceMatchSet {
  const relPath = repoRelativeSourcePath(request.file);
  const absPath = absoluteSourcePath(request.repoRoot, request.file) ?? resolve(request.repoRoot);
  const fileDigest = normaliseDigest(request.fileDigest ?? null);
  const sources = request.sources;

  const exact = relPath === null ? [] : sources.filter((s) => s.path !== null && s.path === relPath);
  const absolute = sources.filter((s) => s.absPath !== null && s.absPath === absPath);
  const digest =
    fileDigest === null ? [] : sources.filter((s) => s.digest !== null && s.digest === fileDigest);

  // Rung 4 keys on the basename of whichever spelling the entry carried, because an
  // entry recorded absolutely has no `path` and would otherwise be invisible here.
  const wantedBasename = basenameOf(relPath ?? absPath);
  const basename =
    wantedBasename.length === 0
      ? []
      : sources.filter((s) => {
          const candidate = s.path ?? s.absPath;
          return candidate !== null && basenameOf(candidate) === wantedBasename;
        });

  // Rung 5 keys on the *id*, because the live store publishes no path at all: the
  // only thing an entry and a file share is the slug Kane derived at ingest. Both
  // sides go through the same normalisation, and an empty slug matches nothing.
  const fileSlug = basenameSlug(relPath ?? absPath);
  const slug =
    fileSlug.length === 0
      ? []
      : sources.filter((s) => slugOfName(s.sourceId) === fileSlug);

  const rungs: RungMatches[] = [
    { rung: 'exact-path', ...partition(exact) },
    { rung: 'abs-path', ...partition(absolute) },
    { rung: 'digest', ...partition(digest) },
    { rung: 'unique-basename', ...partition(basename) },
    { rung: 'basename-slug', ...partition(slug) },
  ];

  return { relPath, absPath, fileDigest, fileSlug, rungs };
}

/** {@link resolveFromSources}'s input: a match request plus where diagnostics go. */
export interface ResolveFromSourcesRequest extends SourceMatchRequest {
  /** Where the diagnostic is recorded. The same record is embedded in the result. */
  readonly diagnostics: DiagnosticSink;
}

function idsOf(sources: readonly StoreSource[]): string {
  return sources.map((source) => source.sourceId).join(', ');
}

/**
 * Walk the ladder over an already-projected listing (§13.2.2).
 *
 * First hit wins, and "hit" means *exactly one live candidate at that rung*:
 *
 * - one live candidate → `{ ok: true, via }` for that rung;
 * - two or more live candidates → `ambiguous`, naming every tied id, because this
 *   is either a fork (one file backing two live sources, §13.2.4 #7) or a store
 *   shape we do not understand, and both are for a human to resolve;
 * - candidates that are **all** retired → `retired`, so a retired source is never
 *   handed to Kane and check 6 of the fail-fast ladder is never reached;
 * - nothing at any rung → `no-match`, whose diagnostic quotes the
 *   `kane-cli context ingest` remedy verbatim.
 *
 * Retirement is judged at the winning rung only. A retired duplicate alongside one
 * live match resolves to the live one: a retired entry cannot fork a graph, so it
 * is not a competing candidate.
 *
 * Total over every input, including an empty listing and a file that escapes the
 * repository root. Never throws.
 */
export function resolveFromSources(request: ResolveFromSourcesRequest): SourceResolution {
  const matches = matchStoreSources(request);
  const named = matches.relPath ?? request.file;

  for (const rung of matches.rungs) {
    if (rung.live.length === 0 && rung.retired.length === 0) continue;

    const only = rung.live.length === 1 ? rung.live[0] : undefined;
    if (only !== undefined) {
      const source = only;
      request.diagnostics.report({
        code: SOURCE_DIAGNOSTIC_CODES.resolved,
        severity: 'info',
        message:
          `${named} resolves to source ${source.sourceId} via ${rung.rung}` +
          `${rung.retired.length === 0 ? '' : `, ignoring ${rung.retired.length} retired entr${rung.retired.length === 1 ? 'y' : 'ies'} that matched the same rung`}` +
          `.` +
          // The slug rung is named in its own words, so a reviewer reading `/runs`
          // is never left thinking a path matched when none was published.
          `${
            rung.rung === 'basename-slug'
              ? ` The match is on the slug '${matches.fileSlug}' Kane derived at ingest, not on a` +
                ` path: this listing publishes none.`
              : ''
          }`,
        file: matches.relPath,
      });
      return { ok: true, source, via: rung.rung };
    }

    if (rung.live.length > 1) {
      const diagnostic = request.diagnostics.report({
        code: SOURCE_DIAGNOSTIC_CODES.ambiguous,
        severity: 'warn',
        message:
          `${named} matches ${rung.live.length} live sources at the ${rung.rung} rung ` +
          `(${idsOf(rung.live)}), so no source id could be chosen — the ladder never guesses, ` +
          `and titles, use-case names and listing order are never consulted. Retire all but one ` +
          `of them, then reconcile again. Nothing was invoked and no verdict moved.`,
        file: matches.relPath,
      });
      return { ok: false, reason: 'ambiguous', diagnostic };
    }

    const diagnostic = request.diagnostics.report({
      code: SOURCE_DIAGNOSTIC_CODES.retired,
      severity: 'warn',
      message:
        `${named} matches only retired source${rung.retired.length === 1 ? '' : 's'} ` +
        `(${idsOf(rung.retired)}) at the ${rung.rung} rung, so it was not handed to ` +
        `\`maintain reconcile\`: moving the head of a retired source is refused, and catching ` +
        `that here costs no process at all. Re-ingest the document to give it a live source.`,
      file: matches.relPath,
    });
    return { ok: false, reason: 'retired', diagnostic };
  }

  const diagnostic = request.diagnostics.report({
    code: SOURCE_DIAGNOSTIC_CODES.unresolved,
    severity: 'warn',
    message:
      `no ingested source matches ${named} — run \`kane-cli context ingest ${named}\` first. ` +
      `\`maintain reconcile\` was not invoked, no review card was created, and every verdict ` +
      `is unchanged.`,
    file: matches.relPath,
  });
  return { ok: false, reason: 'no-match', diagnostic };
}
