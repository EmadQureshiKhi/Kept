/**
 * The store's source listing — invocation, tolerant projection, and the async
 * door in front of the match ladder (design §13.2.2, R5.2).
 *
 * `context/sources.ts` decides; this module *reads*. It holds the one invocation
 * that asks Kane what it has ingested, the tolerant projection that turns an
 * unpinned wire shape into {@link StoreSource} entries, and
 * {@link resolveSourceId} — the async function that composes the two and is the
 * only door `kept reconcile` may knock on for a `--source-id`.
 *
 * ## The invocation
 *
 * ```
 * kane-cli context list --type source --json
 *    family:   Assurance          ← `context list` is Assurance by §4.1
 *    enabler:  --mode agent       ← appended by the invoker from the contract
 *    terminal: done
 *    budget:   60 s
 * ```
 *
 * The enabler is never written here. `SOURCE_LISTING_ARGV` stops at `--json` and
 * the invoker appends `--mode agent` from the contract table (§4.7), which is why
 * the effective argv is a fact this module reports rather than a string it
 * composes. For this family a process exit of 3 is a **pause, resumable** and an
 * exit of 2 is generic failure whose reason lives in `done.status` — so the gate
 * below reads the stream first and the exit code second, exactly as
 * `providers/enrichment.ts` does.
 *
 * ## Three failure reasons, and where each one comes from
 *
 * | reason | the observation behind it |
 * |---|---|
 * | `no-store` | a **complete** stream whose `done.status` is `refused` |
 * | `crashed-stream` | the stream ended without its `done` event |
 * | `listing-unreadable` | everything else that left us without a listing |
 *
 * `no-store` is the one worth stating carefully, because it is the *live* path
 * today: there is no `.context/` store in this repository yet, and a `context
 * list` against a repository without one produces the refusal envelope committed
 * as `test/fixtures/assurance-cover-refused.ndjson` — a `complete` stream with
 * `status: 'refused'` and the event's own `exit_code: 2`, carrying Kane's remedy
 * in its message. A refusal is **not** a crash (§5.3.1). Classifying it as one
 * would throw away the remedy and describe a working Kane as a broken one, so the
 * refusal branch is checked before any exit code is consulted and Kane's own
 * message is quoted verbatim into the diagnostic.
 *
 * A refusal is read as `no-store` whatever its message says. `context list
 * --type source` takes no input that could be rejected, so there is nothing else
 * for Kane to refuse; and every failure reason of §13.2.2 takes the same six
 * steps — diagnostic, no spawn, no review card, verdicts untouched, handoff with
 * `branch: null`, exit 0 — so the reason chooses a code and a sentence, never a
 * behaviour. The message carries whatever the reason cannot.
 *
 * ## Tolerance, and where it stops
 *
 * The projection is the coverage payload's, applied to a different array (§5.3):
 * walk for **any array of objects**, accept an entry that carries a recognisable
 * id under any of its spellings, and keep the unprojected entry in `raw` for
 * diagnostics. The store's internal schema is not pinned by observation, so a
 * reader that hard-coded `sources` as the key would be over-fitting one capture —
 * and an extra envelope level would then project zero sources, which reads as an
 * empty store and answers every save with the wrong remedy.
 *
 * Two boundaries keep that from becoming credulity:
 *
 * 1. **An entry with no id is refused** and its location reported. An id is the
 *    one field `--source-id` is built from; an entry without one is not a source,
 *    and inventing an id from a filename is the exact thing §13.2.2 forbids.
 * 2. **An empty listing and an unreadable one are different facts.** A payload
 *    carrying an empty array is an empty store, and answers `ok` with no sources
 *    so the ladder can report `no-match` and name the `context ingest` remedy. A
 *    payload with no array of objects anywhere, or one whose objects all lacked
 *    ids, is `listing-unreadable` — we did not read an empty store, we failed to
 *    read the store.
 *
 * ## Nothing here throws
 *
 * A missing invoker, an absent binary, a refusal, a pause, a crash, our own
 * timeout kill, a hostile payload and an unreadable file on disk are all states of
 * the world (§14.2) and all arrive as data. The result of a failed listing is a
 * reason plus a diagnostic, and `resolveSourceId` hands that straight back as the
 * `ok: false` arm of {@link SourceResolution} — so a caller still cannot reach a
 * `--source-id`, which is the whole structural point of §13.2.
 */

import { readFileSync } from 'node:fs';

import { createDiagnosticSink, type Diagnostic, type DiagnosticSink } from '../diagnostics.js';
import type { ExitMeaning } from '../kane/exit.js';
import { contractFor, type CommandFamily } from '../kane/family.js';
import type { KaneInvoker } from '../kane/invoker.js';
import { parseStream, type ParsedStream } from '../kane/ndjson.js';
import {
  ACCEPTED_ASSURANCE_STATUS,
  normaliseAssuranceStatus,
} from '../providers/enrichment.js';

import {
  SOURCE_REASON_DIAGNOSTIC_CODE,
  absoluteSourcePath,
  normaliseDigest,
  repoRelativeSourcePath,
  resolveFromSources,
  sourceDigest,
  type SourceResolution,
  type SourceResolutionReason,
  type StoreSource,
} from './sources.js';

/**
 * The family `context list` belongs to (§4.1). `satisfies` rather than an
 * annotation, so `ParsedStream<'Assurance'>` keeps the family that makes
 * `terminal` an `AssuranceDoneEvent` instead of widening to `CommandFamily`.
 */
export const SOURCE_LISTING_FAMILY = 'Assurance' satisfies CommandFamily;

/**
 * argv **without** the NDJSON enabler (§13.2.2).
 *
 * `context list --type source --json`, and nothing else. The Assurance enabler is
 * `--mode agent`, appended by the invoker from the contract table — writing it
 * here would be a second encoding of the one fact §4.7 exists to encode once, and
 * `--agent` (which is `ExecutionRun`'s) would be rejected outright.
 */
export const SOURCE_LISTING_ARGV: readonly string[] = Object.freeze([
  'context',
  'list',
  '--type',
  'source',
  '--json',
]);

/**
 * The listing budget (§13.2.2): 60 s.
 *
 * A default lives here rather than in `.kept/config.json` because the design
 * states the number for this invocation and the config file has no key for it;
 * `timeouts.enrichmentMs` is the `cover` budget and borrowing it would tie two
 * unrelated commands together. A caller may still override it per call.
 */
export const SOURCE_LISTING_TIMEOUT_MS = 60_000;

/** Keys read as a source id, in precedence order (§13.2.2). */
export const SOURCE_ID_KEYS: readonly string[] = Object.freeze([
  'source_id',
  'id',
  'sourceId',
]);

/** Keys read as a path-ish value, in precedence order (§13.2.2). */
export const SOURCE_PATH_KEYS: readonly string[] = Object.freeze([
  'path',
  'file',
  'uri',
  'source_path',
]);

/** Keys read as a recorded content hash, in precedence order (§13.2.2). */
export const SOURCE_DIGEST_KEYS: readonly string[] = Object.freeze([
  'digest',
  'sha256',
  'hash',
  'content_hash',
]);

/** Keys read as a lifecycle marker, in precedence order (§13.2.2). */
export const SOURCE_LIFECYCLE_KEYS: readonly string[] = Object.freeze(['retired', 'status']);

/** Lifecycle strings read as retired. Compared lowercased and trimmed. */
export const RETIRED_LIFECYCLE_VALUES: readonly string[] = Object.freeze([
  'retired',
  'archived',
  'superseded',
  'deleted',
  'removed',
  'inactive',
]);

/** Lifecycle strings read as live. */
export const LIVE_LIFECYCLE_VALUES: readonly string[] = Object.freeze([
  'active',
  'live',
  'current',
  'ready',
  'ingested',
  'ok',
]);

/**
 * How deep the walk descends. A JSON payload has no cycles, so this bounds how
 * much of an unexpectedly deep document is searched, not how many times a node is
 * visited. The recorded envelope needs three levels; eight leaves room for
 * wrappers a later release might add.
 */
export const MAX_SOURCE_WALK_DEPTH = 8;

/** Upper bound on projected entries, so a hostile payload cannot exhaust memory. */
export const MAX_SOURCE_ENTRIES = 10_000;

/**
 * Diagnostic codes this module adds to the six of `sources.ts`.
 *
 * The three *reasons* reuse `SOURCE_REASON_DIAGNOSTIC_CODE`, so a failed listing
 * and a failed ladder report the same code for the same reason. These are the
 * observations that are not themselves a reason.
 */
export const SOURCE_LISTING_DIAGNOSTIC_CODES = Object.freeze({
  /** An object inside an array carried no id under any spelling. */
  entryRefused: 'reconcile-source-entry-refused',
  /** Two entries claimed one id; the first was kept. */
  duplicateId: 'reconcile-source-duplicate-id',
  /** A lifecycle marker this version does not recognise. Read as live. */
  lifecycleUnrecognised: 'reconcile-source-lifecycle-unrecognised',
  /** The listing was read. Informational: how many sources, and how many retired. */
  listed: 'reconcile-source-listing-read',
  /** The changed file's bytes could not be read, so the digest rung is skipped. */
  fileUnreadable: 'reconcile-source-file-unreadable',
} as const);

/** Every code above, for the Ledger's filter list and for the tests. */
export const SOURCE_LISTING_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(SOURCE_LISTING_DIAGNOSTIC_CODES),
);

/** The three reasons a listing can fail with — the pre-ladder arm of §13.2.2. */
export type SourceListingFailureReason = Extract<
  SourceResolutionReason,
  'no-store' | 'listing-unreadable' | 'crashed-stream'
>;

/** What {@link projectSourceListing} made of a payload. */
export interface SourceListingProjection {
  /** Accepted entries, in walk order, deduplicated on `sourceId`. */
  readonly sources: readonly StoreSource[];
  /** How many arrays holding at least one object were walked. */
  readonly arrays: number;
  /**
   * How many arrays holding no members at all were walked.
   *
   * This is what distinguishes an empty store from an unreadable payload: a
   * listing that said `"sources": []` said something, and the honest answer to it
   * is `no-match` with the ingest remedy rather than `listing-unreadable`.
   */
  readonly emptyArrays: number;
  /** How many objects inside those arrays were examined. */
  readonly examined: number;
  /** Locations of objects that carried no id under any recognised spelling. */
  readonly refused: readonly string[];
  /** Locations dropped because an earlier entry already claimed the same id. */
  readonly duplicates: readonly string[];
  /** Locations whose lifecycle marker was unrecognised, with the value seen. */
  readonly unknownLifecycle: readonly string[];
  /** True when the depth or entry bound stopped the walk. */
  readonly truncated: boolean;
}

const EMPTY_PROJECTION: SourceListingProjection = Object.freeze({
  sources: Object.freeze([]) as readonly StoreSource[],
  arrays: 0,
  emptyArrays: 0,
  examined: 0,
  refused: Object.freeze([]) as readonly string[],
  duplicates: Object.freeze([]) as readonly string[],
  unknownLifecycle: Object.freeze([]) as readonly string[],
  truncated: false,
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read the first present key of a family. Own properties only. */
function firstPresent(source: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const value = source[key];
      if (value !== undefined && value !== null) return value;
    }
  }
  return undefined;
}

/** A source id: a non-empty trimmed string, or a finite number's decimal form. */
function readSourceId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** What a lifecycle marker said, and whether this version understood it. */
interface Lifecycle {
  readonly retired: boolean;
  readonly recognised: boolean;
  /** The marker as it arrived, for the diagnostic. Null when there was none. */
  readonly seen: string | null;
}

const LIVE: Lifecycle = Object.freeze({ retired: false, recognised: true, seen: null });

/**
 * Read a lifecycle marker (§13.2.2).
 *
 * `retired: true|false` is the direct spelling; `status: 'retired'` is the
 * indirect one, and the fixture carries both. An **unrecognised** marker is read
 * as live and reported: the alternative is to withhold a source because we did
 * not recognise a word, and retirement is also check 6 of the fail-fast ladder
 * (§13.2.4) — so Kane still refuses a retired source we mistakenly offered, at a
 * cost of one process, while a source wrongly withheld here is a docs branch that
 * silently does nothing.
 */
function readLifecycle(value: unknown): Lifecycle {
  if (value === undefined) return LIVE;
  if (typeof value === 'boolean') return { retired: value, recognised: true, seen: String(value) };
  if (typeof value === 'number') {
    if (value === 1) return { retired: true, recognised: true, seen: '1' };
    if (value === 0) return { retired: false, recognised: true, seen: '0' };
    return { retired: false, recognised: false, seen: String(value) };
  }
  if (typeof value !== 'string') return { retired: false, recognised: false, seen: null };
  const text = value.trim().toLowerCase();
  if (text.length === 0) return LIVE;
  if (text === 'true' || text === 'yes') return { retired: true, recognised: true, seen: text };
  if (text === 'false' || text === 'no') return { retired: false, recognised: true, seen: text };
  if (RETIRED_LIFECYCLE_VALUES.includes(text)) {
    return { retired: true, recognised: true, seen: text };
  }
  if (LIVE_LIFECYCLE_VALUES.includes(text)) {
    return { retired: false, recognised: true, seen: text };
  }
  return { retired: false, recognised: false, seen: text };
}

/** One projected entry, plus what its lifecycle marker told us. */
interface ProjectedEntry {
  readonly source: StoreSource;
  readonly lifecycle: Lifecycle;
}

/**
 * Project one object, or refuse it for carrying no id.
 *
 * `path` and `absPath` are derived by `sources.ts` from the *same* value, so the
 * two rungs they feed can never disagree about which spelling arrived: a relative
 * path yields both, an absolute path or a `file:` URI yields only `absPath`
 * (there is no repo-relative form of either), and no path-ish field at all yields
 * neither — which is a normal entry, and exactly the one the digest rung serves.
 */
function projectEntry(
  entry: Record<string, unknown>,
  repoRoot: string,
): ProjectedEntry | null {
  const sourceId = readSourceId(firstPresent(entry, SOURCE_ID_KEYS));
  if (sourceId === null) return null;
  const pathish = firstPresent(entry, SOURCE_PATH_KEYS);
  const lifecycle = readLifecycle(firstPresent(entry, SOURCE_LIFECYCLE_KEYS));
  return {
    source: {
      sourceId,
      path: repoRelativeSourcePath(pathish),
      absPath: absoluteSourcePath(repoRoot, pathish),
      digest: normaliseDigest(firstPresent(entry, SOURCE_DIGEST_KEYS)),
      retired: lifecycle.retired,
      // The unprojected entry, verbatim (§13.2.2). Nothing reads it for matching —
      // it exists so a diagnostic can show a reviewer what actually arrived.
      raw: entry,
    },
    lifecycle,
  };
}

/** {@link projectSourceListing}'s options. */
export interface ProjectSourceListingOptions {
  /** Absolute repository root. `absPath` is resolved against it. */
  readonly repoRoot: string;
  /** Location prefix for reported entry positions. Defaults to the payload root. */
  readonly at?: string | undefined;
}

/**
 * Walk a payload for source entries (§13.2.2, mirroring §5.3).
 *
 * Structural, not positional: every array reachable within
 * {@link MAX_SOURCE_WALK_DEPTH} levels is inspected and each of its object
 * members is offered to the projection, and the walk continues *into* those
 * members so an array of wrappers each holding the real array still projects.
 * Junk members — strings, numbers, nulls, nested arrays — are ignored rather than
 * refused, because they were never candidates.
 *
 * Total over every input, including `null`, a primitive and a deeply nested
 * document. Never throws.
 */
export function projectSourceListing(
  payload: unknown,
  options: ProjectSourceListingOptions,
): SourceListingProjection {
  if (!isPlainObject(payload) && !Array.isArray(payload)) return EMPTY_PROJECTION;

  const sources: StoreSource[] = [];
  const byId = new Set<string>();
  const refused: string[] = [];
  const duplicates: string[] = [];
  const unknownLifecycle: string[] = [];
  let arrays = 0;
  let emptyArrays = 0;
  let examined = 0;
  let truncated = false;

  const walk = (node: unknown, at: string, depth: number): void => {
    if (depth > MAX_SOURCE_WALK_DEPTH) {
      truncated = true;
      return;
    }
    if (Array.isArray(node)) {
      if (node.length === 0) {
        emptyArrays += 1;
        return;
      }
      let holdsObject = false;
      for (let index = 0; index < node.length; index += 1) {
        const member = node[index];
        const location = `${at}[${index}]`;
        if (isPlainObject(member)) {
          holdsObject = true;
          examined += 1;
          if (sources.length >= MAX_SOURCE_ENTRIES) {
            truncated = true;
          } else {
            const projected = projectEntry(member, options.repoRoot);
            if (projected === null) {
              refused.push(location);
            } else if (byId.has(projected.source.sourceId)) {
              duplicates.push(location);
            } else {
              byId.add(projected.source.sourceId);
              sources.push(projected.source);
              if (!projected.lifecycle.recognised) {
                unknownLifecycle.push(
                  `${location}: ${projected.lifecycle.seen ?? 'a non-string marker'}`,
                );
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
      const location = at.length === 0 ? key : `${at}.${key}`;
      walk(node[key], location, depth + 1);
    }
  };

  walk(payload, options.at ?? '', 0);

  return {
    sources,
    arrays,
    emptyArrays,
    examined,
    refused,
    duplicates,
    unknownLifecycle,
    truncated,
  };
}

/** Everything one listing attempt produced, whether or not it produced sources. */
interface SourceListingShared {
  /** The parsed stream, or null when no process ran at all. */
  readonly stream: ParsedStream<typeof SOURCE_LISTING_FAMILY> | null;
  /** What the payload projected, or null when the gate refused before projecting. */
  readonly projection: SourceListingProjection | null;
  /** The exit meaning of the invocation, or `kane-not-found` when none ran. */
  readonly exitMeaning: ExitMeaning;
  /** argv actually issued, enabler included — `--mode agent`, never `--agent`. */
  readonly effectiveArgv: readonly string[];
  /** Whether *our* timer fired and the process was killed. */
  readonly timedOut: boolean;
  /** `done.status`, normalised, or null when no terminal event arrived. */
  readonly status: string | null;
}

/**
 * A listing attempt (§13.2.2). A discriminated union, so `sources` is reachable
 * only on the arm that actually read a store.
 */
export type SourceListing =
  | (SourceListingShared & {
      readonly ok: true;
      readonly sources: readonly StoreSource[];
    })
  | (SourceListingShared & {
      readonly ok: false;
      readonly reason: SourceListingFailureReason;
      readonly diagnostic: Diagnostic;
    });

/** {@link listStoreSources}'s input. Every default is production; each seam is a test. */
export interface ListStoreSourcesRequest {
  /** Absolute repository root. Every `absPath` is resolved against it. */
  readonly repoRoot: string;
  /**
   * The Kane process boundary. Optional because "no Kane at all" is a supported
   * state (R2.12) — it answers `listing-unreadable` and says so, with no spawn.
   */
  readonly invoker?: KaneInvoker | undefined;
  /** Working directory for the invocation. Defaults to `repoRoot`. */
  readonly cwd?: string | undefined;
  /** Budget in ms. Defaults to {@link SOURCE_LISTING_TIMEOUT_MS} (§13.2.2). */
  readonly timeoutMs?: number | undefined;
  /** Where diagnostics are recorded. A fresh collecting sink when omitted. */
  readonly diagnostics?: DiagnosticSink | undefined;
  /** Live tail, passed through to the invoker. */
  readonly onLine?: ((line: string) => void) | undefined;
}

/** The first non-empty `message` string in the stream, to quote verbatim. */
function firstMessage(stream: ParsedStream<typeof SOURCE_LISTING_FAMILY>): string | null {
  for (const event of stream.events) {
    const message = event['message'];
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  return null;
}

const ARGV_TEXT = SOURCE_LISTING_ARGV.join(' ');

/**
 * Invoke the listing and project it (§13.2.2).
 *
 * Resolves for every state of the world; never throws. The classification order
 * is the one `providers/enrichment.ts` established, for the same reasons:
 *
 * 1. **no invoker / no binary** → `listing-unreadable`. Answered first, because
 *    a repository with no Kane is a supported state and nothing else needs to run.
 * 2. **our timer fired** → `listing-unreadable`. Before the crash check, because
 *    a killed process leaves a truncated stream that would otherwise read as a
 *    crash, and "we cut it off at the budget" is both more accurate and the part
 *    we know from our own side.
 * 3. **no `done` event** → `crashed-stream`. Before the status branch, because a
 *    stream with no terminal event has no status to read.
 * 4. **`done.status` is `refused`** → `no-store`, quoting Kane's own message.
 * 5. **any other non-accepting status** → `listing-unreadable`, including a
 *    pause: exit 3 is resumable, not a failure, but a paused listing is still a
 *    listing we do not have.
 * 6. **a failing exit under an accepting envelope** → `listing-unreadable`. The
 *    envelope is inconsistent, and trusting half of it is how a partial listing
 *    becomes an `ambiguous` that should have been a match.
 * 7. **nothing recognisable in the payload** → `listing-unreadable`; an *empty*
 *    array is instead `ok` with no sources.
 */
export async function listStoreSources(
  request: ListStoreSourcesRequest,
): Promise<SourceListing> {
  const sink = request.diagnostics ?? createDiagnosticSink();
  const declaredArgv: readonly string[] = [...SOURCE_LISTING_ARGV];

  const fail = (
    reason: SourceListingFailureReason,
    message: string,
    shared: SourceListingShared,
  ): SourceListing => ({
    ...shared,
    ok: false,
    reason,
    diagnostic: sink.report({
      code: SOURCE_REASON_DIAGNOSTIC_CODE[reason],
      severity: 'warn',
      message,
      file: null,
    }),
  });

  const noProcess: SourceListingShared = {
    stream: null,
    projection: null,
    exitMeaning: 'kane-not-found',
    effectiveArgv: declaredArgv,
    timedOut: false,
    status: null,
  };

  try {
    const invoker = request.invoker;
    if (invoker === undefined) {
      return fail(
        'listing-unreadable',
        `No Kane invoker was supplied, so \`${ARGV_TEXT}\` was not run and no source id could ` +
          `be resolved. \`maintain reconcile\` was not invoked, no review card was created, ` +
          `and every verdict is unchanged.`,
        noProcess,
      );
    }

    const invocation = await invoker.invoke({
      family: SOURCE_LISTING_FAMILY,
      argv: SOURCE_LISTING_ARGV,
      cwd: request.cwd ?? request.repoRoot,
      timeoutMs: request.timeoutMs ?? SOURCE_LISTING_TIMEOUT_MS,
      onLine: request.onLine,
    });

    if (invocation.exitMeaning === 'kane-not-found') {
      return fail(
        'listing-unreadable',
        `kane-cli was not found, so \`${ARGV_TEXT}\` did not run and no source id could be ` +
          `resolved (R2.12). Nothing was invoked and no verdict moved.`,
        { ...noProcess, effectiveArgv: invocation.effectiveArgv },
      );
    }

    const stream = parseStream(contractFor(SOURCE_LISTING_FAMILY), invocation.stdoutLines, {
      sink,
    });
    const shared: SourceListingShared = {
      stream,
      projection: null,
      exitMeaning: invocation.exitMeaning,
      effectiveArgv: invocation.effectiveArgv,
      timedOut: invocation.timedOut,
      status: stream.kind === 'complete' ? normaliseAssuranceStatus(stream.terminal.status) : null,
    };

    if (invocation.timedOut || invocation.exitMeaning === 'killed-by-timeout') {
      return fail(
        'listing-unreadable',
        `\`${ARGV_TEXT}\` did not finish within its ${
          request.timeoutMs ?? SOURCE_LISTING_TIMEOUT_MS
        } ms budget and was killed, so the store listing is unknown and no source id was ` +
          `resolved. Nothing was invoked afterwards and no verdict moved.`,
        shared,
      );
    }

    if (stream.kind === 'crashed') {
      return fail(
        'crashed-stream',
        `The \`${ARGV_TEXT}\` stream ended without a '${stream.expectedTerminal}' event, so the ` +
          `store listing is incomplete and cannot be trusted: a partial listing turns a real ` +
          `match into a missing one. No source id was resolved, nothing was invoked, and no ` +
          `verdict moved.`,
        shared,
      );
    }

    const status = normaliseAssuranceStatus(stream.terminal.status);
    const message = firstMessage(stream);
    const quoted = message === null ? '' : ` Kane reported: ${message}`;

    if (status === 'refused') {
      // The live path today: no `.context/` store exists in this repository yet,
      // and a refusal is a *complete* stream carrying its own remedy (§5.3.1).
      return fail(
        'no-store',
        `\`${ARGV_TEXT}\` was refused, which is how Kane reports that there is no context ` +
          `store to list, so no source id could be resolved. Run \`kane-cli context ingest ` +
          `<files>\` to create one. Nothing was invoked and no verdict moved.${quoted}`,
        shared,
      );
    }

    if (status !== ACCEPTED_ASSURANCE_STATUS) {
      return fail(
        'listing-unreadable',
        `\`${ARGV_TEXT}\` finished with status '${status}', so the store listing was not ` +
          `obtained and no source id was resolved.${
            status === 'paused' ? ' The listing is resumable and this is not a failure.' : ''
          } Nothing was invoked and no verdict moved.${quoted}`,
        shared,
      );
    }

    if (invocation.exitMeaning !== 'success') {
      return fail(
        'listing-unreadable',
        `\`${ARGV_TEXT}\` reported status '${status}' but its process exit meant ` +
          `'${invocation.exitMeaning}'. The envelope is inconsistent, so the listing was ` +
          `discarded rather than half-trusted: a listing missing entries turns a real match ` +
          `into a missing one.${quoted}`,
        shared,
      );
    }

    // The events are handed to the walk as an object keyed by wire position, so
    // the walk offers *array members* as candidate entries and never the events
    // themselves — an event object is not a source, and examining it would both
    // report a phantom refusal and blur the empty-store test below. Locations
    // read `events[1].sources[3]`.
    const payload: Record<string, unknown> = {};
    stream.events.forEach((event, index) => {
      payload[`events[${index}]`] = event;
    });
    const projection = projectSourceListing(payload, { repoRoot: request.repoRoot });
    const withProjection: SourceListingShared = { ...shared, projection };

    for (const location of projection.refused) {
      sink.report({
        code: SOURCE_LISTING_DIAGNOSTIC_CODES.entryRefused,
        severity: 'info',
        message:
          `The listing entry at ${location} carried no source id under any recognised ` +
          `spelling (${SOURCE_ID_KEYS.join(', ')}), so it was skipped rather than given an id ` +
          `derived from its filename.`,
        file: null,
      });
    }
    for (const location of projection.duplicates) {
      sink.report({
        code: SOURCE_LISTING_DIAGNOSTIC_CODES.duplicateId,
        severity: 'warn',
        message:
          `The listing entry at ${location} repeats a source id already projected, so the ` +
          `first one was kept. Two entries under one id is a store shape this version does ` +
          `not understand.`,
        file: null,
      });
    }
    for (const seen of projection.unknownLifecycle) {
      sink.report({
        code: SOURCE_LISTING_DIAGNOSTIC_CODES.lifecycleUnrecognised,
        severity: 'info',
        message:
          `The listing entry at ${seen} carries a lifecycle marker this version does not ` +
          `recognise, so the entry is treated as live. Kane's own retirement check would ` +
          `still refuse it, at a cost of one process.`,
        file: null,
      });
    }

    if (projection.sources.length === 0 && projection.emptyArrays === 0) {
      return fail(
        'listing-unreadable',
        `\`${ARGV_TEXT}\` completed but nothing in its payload projected as a source ` +
          `(${projection.examined} object${projection.examined === 1 ? '' : 's'} examined ` +
          `across ${projection.arrays} array${projection.arrays === 1 ? '' : 's'}` +
          `${projection.truncated ? ', walk truncated' : ''}), so the store listing could not ` +
          `be read. This is not an empty store: an empty store lists an empty array. No source ` +
          `id was resolved and no verdict moved.`,
        withProjection,
      );
    }

    const retired = projection.sources.filter((source) => source.retired).length;
    sink.report({
      code: SOURCE_LISTING_DIAGNOSTIC_CODES.listed,
      severity: 'info',
      message:
        `\`${ARGV_TEXT}\` listed ${projection.sources.length} source` +
        `${projection.sources.length === 1 ? '' : 's'} (${retired} retired, ` +
        `${projection.sources.length - retired} live)` +
        `${projection.refused.length === 0 ? '' : `, ${projection.refused.length} entr${projection.refused.length === 1 ? 'y' : 'ies'} skipped for carrying no id`}.`,
      file: null,
    });

    return { ...withProjection, ok: true, sources: projection.sources };
  } catch (cause) {
    // Unreachable by design: every path above returns. Present because §13.2.2
    // makes an unreadable listing a reason and never an exception, and an outcome
    // nobody planned for is exactly an outcome nobody knows.
    return fail(
      'listing-unreadable',
      `Reading the store listing raised ${
        cause instanceof Error ? cause.message : String(cause)
      }, so no source id was resolved: \`maintain reconcile\` was not invoked and no verdict ` +
        `moved.`,
      noProcess,
    );
  }
}

/**
 * How the changed file's bytes are read for the digest rung. Injected so the
 * whole module can be tested with no disk.
 */
export type SourceByteReader = (absPath: string) => Uint8Array | null;

/** The production reader: bytes, never decoded text. Absence and errors are null. */
export const nodeSourceByteReader: SourceByteReader = (absPath) => {
  try {
    return readFileSync(absPath);
  } catch {
    return null;
  }
};

/** {@link resolveSourceId}'s input (§13.2.2). */
export interface ResolveSourceIdRequest {
  /** Absolute repository root. Rung 2 resolves both sides against it. */
  readonly repoRoot: string;
  /** The changed document, repo-relative or absolute. */
  readonly file: string;
  /** The Kane process boundary. Absent is supported and answers a reason. */
  readonly invoker?: KaneInvoker | undefined;
  /** Working directory for the listing. Defaults to `repoRoot`. */
  readonly cwd?: string | undefined;
  /** Listing budget in ms. Defaults to {@link SOURCE_LISTING_TIMEOUT_MS}. */
  readonly timeoutMs?: number | undefined;
  /** Where diagnostics go. The returned diagnostic is also recorded here. */
  readonly diagnostics?: DiagnosticSink | undefined;
  /** Live tail, passed through to the invoker. */
  readonly onLine?: ((line: string) => void) | undefined;
  /**
   * A listing already in hand, so no process runs at all.
   *
   * This is the seam task 12.3's `.kept/sources.json` read-through cache slots
   * into: the cache decides whether its entries are fresh, and when they are it
   * passes them here and the ladder runs with no spawn. `SourceResolutionVia`
   * already carries `cache` in front of the four rungs, so the cache adds a rung
   * without changing a type.
   */
  readonly sources?: readonly StoreSource[] | undefined;
  /**
   * The file's digest, when the caller already computed it. `null` states that
   * the bytes were unreadable and rung 3 must be skipped; omitting the field
   * reads the bytes through {@link ResolveSourceIdRequest.readBytes}.
   */
  readonly fileDigest?: string | null | undefined;
  /** Byte reader for the digest rung. Defaults to {@link nodeSourceByteReader}. */
  readonly readBytes?: SourceByteReader | undefined;
}

/**
 * Resolve the source id for a changed document (§13.2.2) — the async door in
 * front of the ladder, and the only way to obtain a `--source-id`.
 *
 * Reads the listing (unless one was supplied), computes the file's digest, and
 * walks the four rungs of `resolveFromSources`. Every failure — no store, an
 * unreadable listing, a crashed stream, no match, an ambiguous match, a retired
 * match — comes back as the `ok: false` arm carrying a reason and the diagnostic
 * that was recorded for it. There is no arm that carries an id without a
 * `StoreSource` behind it, which is what makes an unresolved source a *structural*
 * no-op: no spawn, no credits, no review card, no verdict movement, `degraded`
 * still false, exit 0 (§14.1).
 *
 * Never throws.
 */
export async function resolveSourceId(
  request: ResolveSourceIdRequest,
): Promise<SourceResolution> {
  const sink = request.diagnostics ?? createDiagnosticSink();

  let sources = request.sources;
  if (sources === undefined) {
    const listing = await listStoreSources({
      repoRoot: request.repoRoot,
      invoker: request.invoker,
      cwd: request.cwd,
      timeoutMs: request.timeoutMs,
      diagnostics: sink,
      onLine: request.onLine,
    });
    if (!listing.ok) {
      return { ok: false, reason: listing.reason, diagnostic: listing.diagnostic };
    }
    sources = listing.sources;
  }

  let fileDigest: string | null;
  if (request.fileDigest !== undefined) {
    fileDigest = request.fileDigest;
  } else {
    const absPath = absoluteSourcePath(request.repoRoot, request.file);
    const bytes = absPath === null ? null : (request.readBytes ?? nodeSourceByteReader)(absPath);
    if (bytes === null) {
      // Not a failure: rung 3 is simply skipped. A file we cannot read is not a
      // file whose digest is "no digest", and the path rungs may still answer.
      sink.report({
        code: SOURCE_LISTING_DIAGNOSTIC_CODES.fileUnreadable,
        severity: 'info',
        message:
          `The bytes of ${request.file} could not be read, so the digest rung was skipped and ` +
          `only the path rungs were walked.`,
        file: repoRelativeSourcePath(request.file),
      });
      fileDigest = null;
    } else {
      fileDigest = sourceDigest(bytes);
    }
  }

  return resolveFromSources({
    repoRoot: request.repoRoot,
    file: request.file,
    sources,
    fileDigest,
    diagnostics: sink,
  });
}
