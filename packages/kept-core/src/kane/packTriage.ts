/**
 * The triage note inside the sealed pack, attributed to a member by identifier
 * (design §4.6, §6.2, §6.3, R4.13, R6.7, R6.11).
 *
 * ## The gap this closes
 *
 * `testrun_member_end` carries `path`, `test_id` and `status` and **nothing
 * else** — no `result_code`, no `reason_code`, no `verdict` object (measured
 * across six live runs; `docs/kane/loop/README.md`). So §6.2's first three rungs
 * have nothing to read and every failing member delegates to the triage note.
 * The note, meanwhile, is sealed inside a single `.evidence` **zip**, which
 * `kane/evidence.ts` — a directory walker — does not open. The two facts
 * together meant every failure this project ever routed answered `docs-lie`,
 * including a deliberately broken `subtotal`: a three-way branch behaving as a
 * one-way branch, and looking like it worked.
 *
 * The note itself is not the weak link. For the broken subtotal Kane wrote
 * `category: application_issue/ui_data_defect` at confidence 0.96 on the first
 * attempt, while its inline verdict object on the stream was absent on three runs
 * out of six and contradicted itself on the others. **The sealed note is the
 * stable signal**, so this module goes and gets it.
 *
 * ## Attribution: by identifier, never by name
 *
 * The note is per failing **step**, at `tests/<slug>/steps/<n-a-b>/failure.yaml`,
 * and `<slug>` is derived from the test document's *title*
 * (`tests/cart-subtotal-d5ba3490/…` for `tests/cart_subtotal_test.md`). Inferring
 * a member's identity from that slug is precisely what §7.1 and §4.6 exist to
 * forbid, and the crude alternative — one note per pack — hands two members in
 * one radius the same branch and therefore the same automatic repair.
 *
 * Neither is necessary, because the pack states the identity itself.
 * `tests/<slug>/result.yaml` carries:
 *
 * ```yaml
 * external_id:
 *   execution_id: 0944d075-8dab-4683-a59f-96e51308697c
 *   test_id: 1c4fff07-a0da-495b-8471-26d45b4a1441
 * ```
 *
 * and that `test_id` is **the same UUID** `testrun_plan.members[].test_id` and
 * `testrun_member_end.test_id` carry. So the pack's own per-test directory is
 * tied to a member by an identifier match, not by a name match — the same
 * discipline the blast radius already follows (R4.4, Property 16).
 *
 * Everything else is refusal, on the model of `pairMemberDebug`:
 *
 * - A member event with **no `test_id`** is attributed nothing.
 * - A test directory with no `result.yaml`, or one that declares no `test_id`,
 *   contributes nothing — its notes are dropped rather than guessed at.
 * - Two directories declaring **one** `test_id` cancel each other out: the id is
 *   dropped entirely.
 * - An archive whose name is not this run's execution id is **not read at all**
 *   (see {@link readSealedPackTriage}), so a stale or parallel pack cannot
 *   contribute a signal.
 *
 * A signal on the wrong member would authorise an automatic source patch against
 * a promise nobody tested — worse than falling back to the conservative
 * `docs-lie` residue, which touches nothing without a human.
 *
 * ## Paths are still the family's
 *
 * The evidence *directory* comes from {@link resolveEvidenceDir}, which derives
 * it from the command family and nothing else (§4.6, A12). This module composes
 * no path of its own: it lists that directory and **filters** the listing, and
 * the run's execution id is used only to *reject* an archive that is not this
 * run's — never to spell a file name that was not already on disk.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { parseDocument } from 'yaml';

import type { DiagnosticSink } from '../diagnostics.js';

import type { EvidenceDirEntry, EvidenceStat } from './evidence.js';
import { PackFormatError, readPackEntries, type PackEntry } from './packArchive.js';

/** The suffix Kane gives a sealed pack. The execution id is the name before it. */
export const SEALED_PACK_SUFFIX = '.evidence';

/** The per-test manifest inside a pack, which carries the member's `test_id`. */
export const PACK_RESULT_FILENAME = 'result.yaml';

/** The directory every per-test sub-tree of a pack lives under. */
export const PACK_TESTS_PREFIX = 'tests/';

/** Diagnostic codes this module reports. Stable; `/runs` keys off them. */
export const SEALED_TRIAGE_DIAGNOSTIC_CODES = Object.freeze({
  /** How many notes were read, and which archive they came from. */
  read: 'sealed-triage-read',
  /** No archive in the family-derived directory belongs to this run. */
  archiveAbsent: 'sealed-triage-archive-absent',
  /** The archive is there and is not a readable pack. Routing falls back. */
  archiveUnreadable: 'sealed-triage-archive-unreadable',
  /** A note exists and no member identifier claims it, so nothing is attributed. */
  unattributed: 'sealed-triage-unattributed',
} as const);

/** The codes as a list, so a test can enumerate them. */
export const SEALED_TRIAGE_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(SEALED_TRIAGE_DIAGNOSTIC_CODES),
);

/** One triage note, read out of a sealed archive and tied to one member. */
export interface SealedTriageNote {
  /** Absolute path of the `.evidence` archive it was read from. A real file. */
  readonly archivePath: string;
  /** The entry's name inside the archive, POSIX separators. */
  readonly entryName: string;
  /** The note's text, ready for `loadFailureYaml({ content })`. */
  readonly content: string;
  /** The member `test_id` the pack's own manifest declared for it. */
  readonly testId: string;
}

/** What one sealed pack had to say about the members that failed in it. */
export interface SealedPackTriage {
  /** Absolute path of the archive that was read. */
  readonly archivePath: string;
  /** Notes by member `test_id`. Only unambiguous attributions are present. */
  readonly notes: ReadonlyMap<string, SealedTriageNote>;
}

/** The reads this module needs, injected — a sealed pack is not a test dependency. */
export interface SealedPackFileSystem {
  readDirectory(dir: string): readonly EvidenceDirEntry[];
  stat(path: string): EvidenceStat | null;
  /** Whole-file bytes, or null when absent or unreadable. */
  readBinary(path: string): Uint8Array | null;
}

/** The production reads: `node:fs`, absence answered as null rather than thrown. */
export const nodeSealedPackFileSystem: SealedPackFileSystem = {
  readDirectory(dir: string): readonly EvidenceDirEntry[] {
    return readdirSync(dir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }));
  },
  stat(path: string): EvidenceStat | null {
    const stats = statSync(path, { throwIfNoEntry: false });
    if (stats === undefined) return null;
    return {
      mtimeMs: stats.mtimeMs,
      bytes: stats.isFile() ? stats.size : null,
      isDirectory: stats.isDirectory(),
    };
  },
  readBinary(path: string): Uint8Array | null {
    try {
      return readFileSync(path);
    } catch {
      return null;
    }
  },
};

/** {@link readSealedPackTriage} input. */
export interface SealedPackTriageRequest {
  /**
   * The family-derived evidence directory — `EvidenceListing.dir`. Null when the
   * family resolves none, in which case there is nothing to read.
   */
  readonly evidenceDir: string | null;
  /**
   * This run's own execution id, off the terminal event.
   *
   * Used as a **filter and a refusal**, not as a path: an archive whose name is
   * not this id is skipped, and when nothing is left the answer is null. That is
   * what stops the newest-pack heuristic attributing a previous run's — or a
   * parallel run's — judgement to this one. Pass null to accept the newest
   * archive in the directory instead, which is only appropriate when the caller
   * has no terminal event to read an id from.
   */
  readonly executionId?: string | null;
  readonly fs?: SealedPackFileSystem | undefined;
  readonly diagnostics?: DiagnosticSink | undefined;
}

/**
 * Parser options for the manifest, matching `kane/failureYaml.ts`'s.
 *
 * `maxAliasCount` refuses an alias graph that expands exponentially — the classic
 * YAML bomb — rather than materialising it, and `logLevel: 'silent'` keeps a
 * warning about an untrusted file out of the CLI's output and in the diagnostic
 * channel where the rest of KEPT reads.
 */
const MANIFEST_PARSE_OPTIONS = {
  maxAliasCount: 100,
  logLevel: 'silent',
} as const;

/** A trimmed non-empty string, or null. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Own-property read that is safe on anything, arrays and functions included. */
function readField(source: unknown, field: string): unknown {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return undefined;
  return Object.prototype.hasOwnProperty.call(source, field)
    ? (source as Record<string, unknown>)[field]
    : undefined;
}

/** The pack-relative test directory an entry sits in, or null. */
function testDirectoryOf(name: string): string | null {
  if (!name.startsWith(PACK_TESTS_PREFIX)) return null;
  const rest = name.slice(PACK_TESTS_PREFIX.length);
  const cut = rest.indexOf('/');
  if (cut <= 0) return null;
  return `${PACK_TESTS_PREFIX}${rest.slice(0, cut)}`;
}

/** Whether an entry is a per-test manifest. */
function isResultManifest(name: string): boolean {
  return name.endsWith(`/${PACK_RESULT_FILENAME}`) && testDirectoryOf(name) !== null;
}

/** Whether an entry is a per-step triage note under a test directory. */
function isStepNote(name: string): boolean {
  return (
    (name.endsWith('/failure.yaml') || name.endsWith('/failure.yml')) &&
    name.includes('/steps/') &&
    testDirectoryOf(name) !== null
  );
}

/**
 * `external_id.test_id` out of a `result.yaml`, or null.
 *
 * Parsed as untrusted YAML, exactly like the triage note itself: the alias-bomb
 * guard is the package default this call names explicitly, warnings go nowhere
 * near stdout, and every field is read as possibly-absent and possibly the wrong
 * type. Anything unreadable answers null and the directory contributes nothing.
 */
export function testIdFromResultManifest(source: string): string | null {
  try {
    const doc = parseDocument(source, MANIFEST_PARSE_OPTIONS);
    if (doc.errors.length > 0) return null;
    const root: unknown = doc.toJS();
    return text(readField(readField(root, 'external_id'), 'test_id'));
  } catch {
    return null;
  }
}

/** The archive belonging to this run, or the newest when no id was supplied. */
function resolveArchive(
  request: SealedPackTriageRequest,
  fs: SealedPackFileSystem,
): string | null {
  const dir = request.evidenceDir;
  if (dir === null) return null;

  let entries: readonly EvidenceDirEntry[];
  try {
    entries = fs.readDirectory(dir);
  } catch {
    // An absent `.testmuai/evidence/` is routine — it is gitignored and
    // regenerated per run — and `listArtifacts` has already diagnosed the
    // directory it could not read. Saying it twice is noise.
    return null;
  }

  const wanted = text(request.executionId);
  const archives = entries
    .filter((entry) => entry.isFile && entry.name.endsWith(SEALED_PACK_SUFFIX))
    .filter(
      (entry) =>
        wanted === null || entry.name.slice(0, -SEALED_PACK_SUFFIX.length).trim() === wanted,
    )
    .map((entry) => {
      const path = join(dir, entry.name);
      let mtimeMs = 0;
      try {
        mtimeMs = fs.stat(path)?.mtimeMs ?? 0;
      } catch {
        mtimeMs = 0;
      }
      return { path, name: entry.name, mtimeMs };
    })
    // Newest first, tie-broken by descending name — the same rule
    // `listArtifacts` uses for pack directories, so the two agree.
    .sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));

  const newest = archives[0];
  if (newest === undefined) {
    request.diagnostics?.report({
      code: SEALED_TRIAGE_DIAGNOSTIC_CODES.archiveAbsent,
      severity: 'warn',
      message:
        wanted === null
          ? `No sealed ${SEALED_PACK_SUFFIX} archive in ${dir}, so no triage note can be read.`
          : `No sealed ${SEALED_PACK_SUFFIX} archive in ${dir} belongs to execution ${wanted}, ` +
            `so no triage note is read for it. A pack sealed by some other run is deliberately ` +
            `not consulted: its judgement is about other members.`,
      file: dir,
    });
    return null;
  }
  return newest.path;
}

/**
 * Read the triage notes out of this run's sealed pack, keyed by member `test_id`.
 *
 * Returns null when there is no archive to read, when it is not a readable pack,
 * or when nothing in it could be attributed. Never throws: every one of those is
 * a state of the world, and a run whose pack is missing still routes — through
 * the conservative residue (design §14.2, R2.3).
 */
export function readSealedPackTriage(
  request: SealedPackTriageRequest,
): SealedPackTriage | null {
  const fs = request.fs ?? nodeSealedPackFileSystem;
  const sink = request.diagnostics;

  const archivePath = resolveArchive(request, fs);
  if (archivePath === null) return null;

  const bytes = fs.readBinary(archivePath);
  if (bytes === null) {
    sink?.report({
      code: SEALED_TRIAGE_DIAGNOSTIC_CODES.archiveUnreadable,
      severity: 'warn',
      message: `Sealed pack ${basename(archivePath)} could not be read, so no triage note was.`,
      file: archivePath,
    });
    return null;
  }

  let entries: readonly PackEntry[];
  try {
    // Only the two kinds of file attribution needs are inflated. The rest of a
    // pack is megabytes of HARs, console streams and agent trajectories.
    entries = readPackEntries(bytes, {
      select: (name) => isResultManifest(name) || isStepNote(name),
    });
  } catch (cause) {
    sink?.report({
      code: SEALED_TRIAGE_DIAGNOSTIC_CODES.archiveUnreadable,
      severity: 'warn',
      message:
        `Sealed pack ${basename(archivePath)} is not a readable archive, so no triage note ` +
        `was read from it and every failing member routes from the residue instead: ` +
        `${cause instanceof PackFormatError || cause instanceof Error ? cause.message : String(cause)}`,
      file: archivePath,
    });
    return null;
  }

  const decoder = new TextDecoder();

  // Which test directory each member id owns. An id claimed twice is dropped:
  // two directories for one member means the pack disagrees with itself, and
  // picking either would be a guess.
  const directoryFor = new Map<string, string | null>();
  for (const entry of entries) {
    if (!isResultManifest(entry.name)) continue;
    const directory = testDirectoryOf(entry.name);
    if (directory === null) continue;
    const testId = testIdFromResultManifest(decoder.decode(entry.bytes));
    if (testId === null) continue;
    directoryFor.set(testId, directoryFor.has(testId) ? null : directory);
  }

  const notes = new Map<string, SealedTriageNote>();
  let unattributed = 0;
  const claimed = new Map<string, string>();
  for (const [testId, directory] of directoryFor) {
    if (directory !== null) claimed.set(directory, testId);
  }

  for (const entry of [...entries]
    .filter((candidate) => isStepNote(candidate.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const directory = testDirectoryOf(entry.name);
    const testId = directory === null ? undefined : claimed.get(directory);
    if (testId === undefined) {
      unattributed += 1;
      continue;
    }
    // A member that failed at more than one step group has more than one note,
    // and both are its own; the first in name order is the one reported, and the
    // count is diagnosed so nothing is silently dropped.
    if (notes.has(testId)) continue;
    notes.set(testId, {
      archivePath,
      entryName: entry.name,
      content: decoder.decode(entry.bytes),
      testId,
    });
  }

  if (unattributed > 0) {
    sink?.report({
      code: SEALED_TRIAGE_DIAGNOSTIC_CODES.unattributed,
      severity: 'warn',
      message:
        `${unattributed} triage note(s) in ${basename(archivePath)} sit under a test directory ` +
        `whose ${PACK_RESULT_FILENAME} declares no member test id, so they were not attributed ` +
        `to any member. A note attributed to the wrong member would authorise the wrong repair, ` +
        `so those failures route from the residue instead.`,
      file: archivePath,
    });
  }

  if (notes.size === 0) return null;

  sink?.report({
    code: SEALED_TRIAGE_DIAGNOSTIC_CODES.read,
    severity: 'info',
    message:
      `Read ${notes.size} triage note(s) from sealed pack ${basename(archivePath)}, each tied ` +
      `to a member by the test id the pack's own ${PACK_RESULT_FILENAME} declares — never by ` +
      `matching a directory name to a document title. testrun_member_end carries no result ` +
      `code, no reason code and no verdict object, so this note is the stable classification ` +
      `signal (R6.4, R6.7).`,
    file: archivePath,
  });

  return { archivePath, notes };
}

/** The note for one member, or null when nothing was attributed to it. */
export function sealedNoteFor(
  pack: SealedPackTriage | null,
  testId: string | null,
): SealedTriageNote | null {
  if (pack === null || testId === null) return null;
  return pack.notes.get(testId) ?? null;
}
