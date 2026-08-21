/**
 * `kept snapshot` — project `.kept/state.json` into the committed ledger file
 * (design §13.1, §9.2, §15.3, R1.8, R4.14, R13.4, R13.5).
 *
 * The whole command is: load the state, curate the evidence it references, build
 * the snapshot, self-check it, write the bytes. It invokes no Kane — the §13.1
 * table's `Kane invocation` column reads `none` — so it costs nothing, is safe to
 * run repeatedly, and is the thing `npm run build:snapshot` calls after
 * `kept build`.
 *
 * One decision is worth naming. When the assembled snapshot fails its own schema
 * check, this command **does not write** and **does not exit non-zero**. Not
 * writing is obvious: publishing a file the Ledger's build-time `parseSnapshot`
 * would reject just moves the failure somewhere less informative. Exiting zero is
 * the less obvious half, and it follows from §14.2 — the CLI's exit code reports
 * whether KEPT worked, and the honest report here is a printed `error` diagnostic
 * naming the offending field path, with the last good committed file still in
 * place. The Ledger build is where an invalid or missing snapshot fails loudly
 * (§14.1), and it still will.
 *
 * ## Evidence curation (§15.3, R13.4, R13.5)
 *
 * A sealed pack is a **single `.evidence` zip file**, not a directory. That is
 * observed, not assumed: `kane-cli` prints
 * `evidence: view locally with kane-cli evidence serve
 * …/sessions/<session_id>/evidence/<execution_id>.evidence` on stderr, the file
 * at that path is a zip archive, and a copy lands under
 * `<cwd>/.testmuai/evidence/<execution_id>.evidence`. `kane/evidence.ts` lists a
 * pack *directory* and therefore resolves nothing here; rather than change a
 * module this command does not own, the curation below reads the archive itself.
 *
 * `.testmuai/evidence/` is gitignored because the packs are one to three
 * megabytes each. So the curation **unzips the artefacts a judge would actually
 * open** — `annotated.png`, the per-step screenshots, and the triage notes — into
 * `apps/ledger/public/evidence/<packId>/`, which `.gitignore` force-negates, and
 * rewrites every `publicPath` to the resulting static URL. Committing the zips
 * wholesale would put tens of megabytes of HARs, network logs and agent
 * trajectories into the repository for artefacts nothing links.
 *
 * The result is the thing R13.4 and R13.5 are about: the Ledger's artefact links
 * are plain `<a href="/evidence/…">` static URLs. No Kane, no credentials, no
 * network, no route handler.
 *
 * Curation is still a pure projection. It reads two things — the pack ids the
 * graph already references, and the archives those ids name — and writes only
 * under `apps/ledger/public/`. It spawns nothing: the inflate is `node:zlib`,
 * which is why no unzip dependency appears in the runtime budget.
 */

import { inflateRawSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import type {
  ArtifactKind,
  CollectingDiagnosticSink,
  Diagnostic,
  DiagnosticSink,
  KeptState,
  LedgerSnapshot,
  SnapshotAmendment,
  SnapshotArtifact,
  SnapshotEvidence,
  SnapshotReviewCard,
  SnapshotRun,
  StateFileSystem,
} from '@kept/core';
import {
  classifyArtifact,
  createDiagnosticSink,
  createStateStore,
  evidencePackIdFromRef,
  nodeStateFileSystem,
} from '@kept/core';

import { joinPath } from '../config.js';
import {
  SNAPSHOT_FILE_RELATIVE_PATH,
  buildSnapshot,
  writeSnapshot,
} from '../snapshot.js';

/** Diagnostic codes this command reports. Stable; the Ledger keys off them. */
export const SNAPSHOT_COMMAND_DIAGNOSTIC_CODES = Object.freeze({
  written: 'snapshot-written',
  unchanged: 'snapshot-unchanged',
  notWritten: 'snapshot-not-written',
  evidenceCurated: 'snapshot-evidence-curated',
  evidencePackAbsent: 'snapshot-evidence-pack-absent',
  evidencePackUnreadable: 'snapshot-evidence-pack-unreadable',
  evidencePackEmpty: 'snapshot-evidence-pack-empty',
  evidencePackOversize: 'snapshot-evidence-pack-oversize',
} as const);

/** The codes as a list, so a test can enumerate them. */
export const SNAPSHOT_COMMAND_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(SNAPSHOT_COMMAND_DIAGNOSTIC_CODES),
);

/** Where curated packs are committed, relative to the repository root. */
export const CURATED_EVIDENCE_RELATIVE_DIR = 'apps/ledger/public/evidence';

/** Where Kane leaves a copy of every sealed pack, relative to the repo root. */
export const SEALED_EVIDENCE_RELATIVE_DIR = '.testmuai/evidence';

/** The suffix Kane gives a sealed pack. The id is the execution id before it. */
export const SEALED_PACK_SUFFIX = '.evidence';

/**
 * The archive file names a snapshot pack id could name, in preference order.
 *
 * Two spellings, because two are real. The snapshot's own id rule is
 * `^ev_[A-Za-z0-9._-]+$` (§9.1), while the file Kane seals is named for the
 * **execution id** — `73c1df17-2589-4202-bb02-afa6d4a1cf2b.evidence`, no prefix.
 * Whether a given graph carries the prefixed or the bare form depends on how the
 * pack was resolved upstream, and resolving that disagreement lives in
 * `kane/evidence.ts`, not here. Trying both is a two-line accommodation; guessing
 * one and reporting "no pack" for the other would hide committed evidence.
 */
export function archiveNamesFor(packId: string): readonly string[] {
  const bare = packId.startsWith('ev_') ? packId.slice(3) : packId;
  const names = [`${packId}${SEALED_PACK_SUFFIX}`];
  if (bare !== packId && bare.length > 0) names.push(`${bare}${SEALED_PACK_SUFFIX}`);
  return names;
}

/**
 * The artefact kinds worth committing.
 *
 * `annotated` is the one image a reviewer is shown first, `screenshot` is the
 * per-step visual record, and `failure-yaml` is Kane's own triage note — the
 * categorised one is nested per failing step and spells its category at
 * `triage.rca.category`. Everything else a pack carries (HARs, console streams,
 * run logs, the agent's trajectory and its `execution.json`) is bulk nothing in
 * the Ledger links, so it stays out of the repository.
 */
export const CURATED_ARTIFACT_KINDS: readonly ArtifactKind[] = Object.freeze([
  'annotated',
  'screenshot',
  'failure-yaml',
]);

/**
 * Per-pack ceiling on curated bytes. A pack over it is curated up to the ceiling
 * and diagnosed, rather than silently committing an unbounded blob: the whole
 * point of curating is that the repository stays clonable.
 */
export const MAX_CURATED_PACK_BYTES = 6 * 1024 * 1024;

/** One file recovered from a sealed pack. */
export interface CuratedEntry {
  /** Path inside the archive, POSIX separators. */
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** The filesystem seam curation uses, so its tests need no disk. */
export interface CurationFileSystem {
  /** Whole-file bytes, or null when absent or unreadable. */
  readBinary(path: string): Uint8Array | null;
  ensureDir(path: string): void;
  writeBinary(path: string, bytes: Uint8Array): void;
}

/** The production filesystem, `node:fs` synchronous calls. */
export const nodeCurationFileSystem: CurationFileSystem = {
  readBinary(path: string): Uint8Array | null {
    try {
      return readFileSync(path);
    } catch {
      return null;
    }
  },
  ensureDir(path: string): void {
    mkdirSync(path, { recursive: true });
  },
  writeBinary(path: string, bytes: Uint8Array): void {
    writeFileSync(path, bytes);
  },
};

/* ─────────────────────────────── the zip reader ──────────────────────────────
 *
 * Enough of the format to read a sealed pack, and no more. Kane's packs are
 * ordinary single-disk archives whose entries are stored (method 0) or deflated
 * (method 8), so `node:zlib`'s raw inflate is the whole decompressor. A zip64
 * archive, an unsupported method or a truncated file is refused by name rather
 * than half-read, because a pack that curated to garbage would look like evidence
 * until a judge clicked it.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** A zip comment is at most this long, so the end record is within the tail. */
const MAX_EOCD_SEARCH = 0xffff + 22;
const ZIP64_SENTINEL_32 = 0xffffffff;
const ZIP64_SENTINEL_16 = 0xffff;

/** Thrown inside the reader and turned into a diagnostic by the caller. */
class PackFormatError extends Error {}

function readU16(bytes: Uint8Array, at: number): number {
  const a = bytes[at];
  const b = bytes[at + 1];
  if (a === undefined || b === undefined) throw new PackFormatError('archive ends mid-field');
  return a | (b << 8);
}

function readU32(bytes: Uint8Array, at: number): number {
  const a = bytes[at];
  const b = bytes[at + 1];
  const c = bytes[at + 2];
  const d = bytes[at + 3];
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw new PackFormatError('archive ends mid-field');
  }
  return (a | (b << 8) | (c << 16) | (d << 24)) >>> 0;
}

/** Locate the end-of-central-directory record by scanning the tail backwards. */
function findEndRecord(bytes: Uint8Array): number {
  const floor = Math.max(0, bytes.length - MAX_EOCD_SEARCH);
  for (let at = bytes.length - 22; at >= floor; at -= 1) {
    if (readU32(bytes, at) === EOCD_SIGNATURE) return at;
  }
  throw new PackFormatError('no end-of-central-directory record: this is not a zip archive');
}

/**
 * Every entry in a sealed pack, decompressed, in central-directory order.
 *
 * Exported because the property and unit suites build archives byte by byte and
 * assert this reader against them, which is the only way to test a format reader
 * without a fixture nobody can regenerate.
 */
export function readPackEntries(bytes: Uint8Array): readonly CuratedEntry[] {
  const end = findEndRecord(bytes);
  const entryCount = readU16(bytes, end + 10);
  const directoryOffset = readU32(bytes, end + 16);
  if (entryCount === ZIP64_SENTINEL_16 || directoryOffset === ZIP64_SENTINEL_32) {
    throw new PackFormatError('zip64 archive: not supported, and no pack this size is curated');
  }

  const decoder = new TextDecoder();
  const entries: CuratedEntry[] = [];
  let cursor = directoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(bytes, cursor) !== CENTRAL_SIGNATURE) {
      throw new PackFormatError(`central directory entry ${index} has the wrong signature`);
    }
    const method = readU16(bytes, cursor + 10);
    const compressedSize = readU32(bytes, cursor + 20);
    const nameLength = readU16(bytes, cursor + 28);
    const extraLength = readU16(bytes, cursor + 30);
    const commentLength = readU16(bytes, cursor + 32);
    const localOffset = readU32(bytes, cursor + 42);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;

    // A directory entry carries no data and needs none: the write step creates
    // whatever directories the surviving names imply.
    if (name.endsWith('/')) continue;

    if (readU32(bytes, localOffset) !== LOCAL_SIGNATURE) {
      throw new PackFormatError(`local header for ${name} has the wrong signature`);
    }
    const localNameLength = readU16(bytes, localOffset + 26);
    const localExtraLength = readU16(bytes, localOffset + 28);
    const dataAt = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataAt, dataAt + compressedSize);
    if (raw.length < compressedSize) {
      throw new PackFormatError(`${name} is truncated: the archive ends inside its data`);
    }

    if (method === 0) {
      entries.push({ name, bytes: raw });
    } else if (method === 8) {
      entries.push({ name, bytes: inflateRawSync(raw) });
    } else {
      throw new PackFormatError(`${name} uses compression method ${method}, which is not read`);
    }
  }

  return entries;
}

/* ──────────────────────────────── the curation ─────────────────────────────── */

/** {@link curateEvidencePacks}'s input. */
export interface CurateEvidenceRequest {
  readonly repoRoot: string;
  /** Pack ids the graph references. Order is preserved; duplicates collapse. */
  readonly packIds: readonly string[];
  /** Where sealed `.evidence` archives live. Defaults to `.testmuai/evidence/`. */
  readonly sealedDir?: string | undefined;
  readonly fileSystem?: CurationFileSystem | undefined;
  readonly diagnostics?: DiagnosticSink | undefined;
}

/** What {@link curateEvidencePacks} committed. */
export interface CurateEvidenceResult {
  /** One entry per pack that curated to at least one artefact, id-sorted. */
  readonly evidence: readonly SnapshotEvidence[];
  /** Total bytes written under `apps/ledger/public/evidence/`. */
  readonly bytes: number;
}

/** `/evidence/<packId>/<name>`, the static URL the Ledger links. */
function publicPathFor(packId: string, name?: string): string {
  return name === undefined ? `/evidence/${packId}/` : `/evidence/${packId}/${name}`;
}

/**
 * Is this archive entry name safe to write under the curated directory?
 *
 * An archive is untrusted input even when Kane sealed it, and an entry named
 * `../../../etc/whatever` is the oldest bug in unpacking. Names must be relative,
 * POSIX-separated, free of any `..` segment, and free of the backslash the
 * snapshot's own `publicPath` rule already refuses — so a name that would produce
 * an unpublishable path is refused here, where the answer is "skip it", rather
 * than at the schema check, where the answer would be "the whole snapshot is
 * invalid".
 */
function isSafeEntryName(name: string): boolean {
  if (name.length === 0 || name.startsWith('/') || name.includes('\\')) return false;
  if (/^[a-zA-Z]:/.test(name)) return false;
  return name.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/**
 * Copy the useful artefacts of every referenced pack into
 * `apps/ledger/public/evidence/<packId>/` and describe them as the snapshot's
 * `evidence` array.
 *
 * Never throws. A referenced pack that is not on disk, is not a readable
 * archive, or holds nothing worth committing is diagnosed and omitted — and
 * omitting it is what makes `buildSnapshot` clear the promise's reference rather
 * than publish a link to a file that was never committed.
 */
export function curateEvidencePacks(request: CurateEvidenceRequest): CurateEvidenceResult {
  const fs = request.fileSystem ?? nodeCurationFileSystem;
  const sink = request.diagnostics;
  const sealedDir = request.sealedDir ?? joinPath(request.repoRoot, SEALED_EVIDENCE_RELATIVE_DIR);
  const curatedRoot = joinPath(request.repoRoot, CURATED_EVIDENCE_RELATIVE_DIR);
  const kinds = new Set<ArtifactKind>(CURATED_ARTIFACT_KINDS);

  const evidence: SnapshotEvidence[] = [];
  let totalBytes = 0;

  for (const packId of [...new Set(request.packIds)].sort()) {
    const candidates = archiveNamesFor(packId).map((name) => joinPath(sealedDir, name));
    let archive: Uint8Array | null = null;
    for (const candidate of candidates) {
      archive = fs.readBinary(candidate);
      if (archive !== null) break;
    }
    if (archive === null) {
      sink?.report({
        code: SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.evidencePackAbsent,
        severity: 'warn',
        message:
          `The graph references evidence pack '${packId}', and no readable archive exists at ` +
          `${candidates.join(' or ')}. Sealed packs are gitignored and regenerated per run, so ` +
          `a fresh clone reaching this state is expected; nothing was curated for it and the ` +
          `reference will be cleared rather than published as a dead link.`,
        file: null,
      });
      continue;
    }

    let entries: readonly CuratedEntry[];
    try {
      entries = readPackEntries(archive);
    } catch (cause) {
      sink?.report({
        code: SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.evidencePackUnreadable,
        severity: 'warn',
        message:
          `Evidence pack '${packId}' could not be read as a sealed archive, so nothing was ` +
          `curated from it: ${cause instanceof Error ? cause.message : String(cause)}`,
        file: null,
      });
      continue;
    }

    const wanted = entries
      .filter((entry) => isSafeEntryName(entry.name) && kinds.has(classifyArtifact(entry.name)))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    const artifacts: SnapshotArtifact[] = [];
    let packBytes = 0;
    let skipped = 0;

    for (const entry of wanted) {
      if (packBytes + entry.bytes.length > MAX_CURATED_PACK_BYTES) {
        skipped += 1;
        continue;
      }
      const destination = joinPath(curatedRoot, `${packId}/${entry.name}`);
      fs.ensureDir(destination.slice(0, destination.lastIndexOf('/')));
      fs.writeBinary(destination, entry.bytes);
      packBytes += entry.bytes.length;
      artifacts.push({
        kind: classifyArtifact(entry.name),
        name: entry.name,
        publicPath: publicPathFor(packId, entry.name),
        bytes: entry.bytes.length,
      });
    }

    if (skipped > 0) {
      sink?.report({
        code: SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.evidencePackOversize,
        severity: 'warn',
        message:
          `Evidence pack '${packId}' curated ${artifacts.length} artefact` +
          `${artifacts.length === 1 ? '' : 's'} to the ${MAX_CURATED_PACK_BYTES}-byte ceiling ` +
          `and left ${skipped} out, so the committed repository stays clonable. The pack still ` +
          `exists in full where Kane sealed it.`,
        file: null,
      });
    }

    if (artifacts.length === 0) {
      sink?.report({
        code: SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.evidencePackEmpty,
        severity: 'warn',
        message:
          `Evidence pack '${packId}' holds ${entries.length} file` +
          `${entries.length === 1 ? '' : 's'} and none of them is an annotated capture, a ` +
          `screenshot or a triage note, so there is a pack to point at and nothing of it a ` +
          `reviewer could open.`,
        file: null,
      });
      continue;
    }

    totalBytes += packBytes;
    evidence.push({
      id: packId,
      // Every pack in this repository was sealed by `testmd run`, which is the
      // ExecutionRun family. `testrun` is the suite spelling and nothing here
      // has used it, so claiming it would be a guess.
      kind: 'run',
      // Disk mtimes are not carried into the committed snapshot: the archive's
      // own timestamps are local to the machine that sealed it, and a snapshot
      // whose bytes change with the clone's filesystem is not a contract.
      sealedAt: null,
      publicPath: publicPathFor(packId),
      artifacts,
    });
  }

  if (evidence.length > 0) {
    sink?.report({
      code: SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.evidenceCurated,
      severity: 'info',
      message:
        `kept snapshot: curated ${evidence.length} evidence pack` +
        `${evidence.length === 1 ? '' : 's'} into ${CURATED_EVIDENCE_RELATIVE_DIR}/ ` +
        `(${evidence.reduce((count, pack) => count + pack.artifacts.length, 0)} artefacts, ` +
        `${totalBytes} bytes), so every artefact link is a static URL needing no Kane, no ` +
        `credentials and no network.`,
      file: null,
    });
  }

  return { evidence, bytes: totalBytes };
}

/** Every pack id the graph references, in first-seen order. */
export function referencedPackIds(state: KeptState): readonly string[] {
  const ids: string[] = [];
  const add = (id: string | null): void => {
    if (id !== null && id.length > 0 && !ids.includes(id)) ids.push(id);
  };
  for (const promise of state.graph.promises) {
    add(promise.evidencePackId);
    if (promise.repair !== null && promise.repair.evidenceRef !== null) {
      add(evidencePackIdFromRef(promise.repair.evidenceRef));
    }
  }
  return ids;
}

/* ──────────────────────────────── the command ──────────────────────────────── */

/** {@link runSnapshot}'s input. Every seam has a production default. */
export interface SnapshotRequest {
  readonly repoRoot: string;
  /** State reads and snapshot writes. Defaults to the `node:fs` implementation. */
  readonly fileSystem?: StateFileSystem | undefined;
  /**
   * The state to project. Omit it and the command loads `.kept/state.json`, which
   * is the normal path; `kept build` passes the state it just wrote so the two
   * commands in `npm run build:snapshot` cannot disagree about what was built.
   */
  readonly state?: KeptState | undefined;
  readonly generatedAt?: string | undefined;
  readonly kaneCliVersion?: string | null | undefined;
  /**
   * Curated packs. Omit it and the command curates the packs the graph references
   * out of `.testmuai/evidence/` itself, which is the normal path. Pass it — even
   * as `[]` — to project a state without touching a sealed archive.
   */
  readonly evidence?: readonly SnapshotEvidence[] | undefined;
  /** Where sealed archives live. Defaults to `<repoRoot>/.testmuai/evidence`. */
  readonly sealedEvidenceDir?: string | undefined;
  /** The curation filesystem. Defaults to `node:fs`. */
  readonly curationFileSystem?: CurationFileSystem | undefined;
  readonly runs?: readonly SnapshotRun[] | undefined;
  readonly reviewCards?: readonly SnapshotReviewCard[] | undefined;
  readonly amendments?: readonly SnapshotAmendment[] | undefined;
  readonly diagnostics?: CollectingDiagnosticSink | undefined;
}

/** What {@link runSnapshot} did. */
export interface SnapshotResult {
  readonly snapshot: LedgerSnapshot;
  /** Absolute path of the committed snapshot file. */
  readonly path: string;
  /** True when the bytes were written. False when invalid, or already identical. */
  readonly written: boolean;
  /** False when the self-check rejected the snapshot; `error` names the field. */
  readonly valid: boolean;
  readonly error: string | null;
  readonly bytes: number;
  /** Bytes written under `apps/ledger/public/evidence/` by the curation step. */
  readonly curatedBytes: number;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Write the committed snapshot. Never throws for any state of the world,
 * including an absent or corrupt `.kept/state.json` — the state store answers an
 * empty state plus a diagnostic for both, and an empty graph is a perfectly valid
 * snapshot whose two coverage figures are `null` (R9.3).
 */
export function runSnapshot(request: SnapshotRequest): SnapshotResult {
  const sink = request.diagnostics ?? createDiagnosticSink();
  // One filesystem for both the state read and the snapshot write, so a test that
  // seeds a state file sees the snapshot land in the same map.
  const fileSystem = request.fileSystem ?? nodeStateFileSystem();
  const store = createStateStore({ repoRoot: request.repoRoot, fileSystem, sink });
  const state = request.state ?? store.load();

  // Curation runs before assembly, because `buildSnapshot` resolves every
  // reference the graph carries against the packs that are actually committed and
  // clears the ones that are not (§9.1 rule 3). A graph referencing no pack
  // curates nothing and touches no archive.
  let evidence = request.evidence;
  let curatedBytes = 0;
  if (evidence === undefined) {
    const curated = curateEvidencePacks({
      repoRoot: request.repoRoot,
      packIds: referencedPackIds(state),
      diagnostics: sink,
      ...(request.sealedEvidenceDir === undefined
        ? {}
        : { sealedDir: request.sealedEvidenceDir }),
      ...(request.curationFileSystem === undefined
        ? {}
        : { fileSystem: request.curationFileSystem }),
    });
    evidence = curated.evidence;
    curatedBytes = curated.bytes;
  }

  const built = buildSnapshot({
    state,
    diagnostics: sink,
    evidence,
    ...(request.generatedAt === undefined ? {} : { generatedAt: request.generatedAt }),
    ...(request.kaneCliVersion === undefined ? {} : { kaneCliVersion: request.kaneCliVersion }),
    ...(request.runs === undefined ? {} : { runs: request.runs }),
    ...(request.reviewCards === undefined ? {} : { reviewCards: request.reviewCards }),
    ...(request.amendments === undefined ? {} : { amendments: request.amendments }),
  });

  if (!built.valid) {
    sink.report({
      code: SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.notWritten,
      severity: 'error',
      message:
        `The snapshot was not written because it failed its own schema check; the previously ` +
        `committed file stands. ${built.error ?? 'no reason reported'}`,
    });
    return {
      snapshot: built.snapshot,
      path: joinPath(request.repoRoot, SNAPSHOT_FILE_RELATIVE_PATH),
      written: false,
      valid: false,
      error: built.error,
      bytes: 0,
      curatedBytes,
      diagnostics: sink.entries,
    };
  }

  const write = writeSnapshot({ repoRoot: request.repoRoot, text: built.text, fileSystem });
  sink.report({
    code: write.changed
      ? SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.written
      : SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.unchanged,
    severity: 'info',
    message: write.changed
      ? `kept snapshot: wrote ${write.bytes} bytes carrying ` +
        `${built.snapshot.promises.length} promise` +
        `${built.snapshot.promises.length === 1 ? '' : 's'}`
      : `kept snapshot: the committed file is already byte-identical, so nothing was written`,
  });

  return {
    snapshot: built.snapshot,
    path: write.path,
    written: write.changed,
    valid: true,
    error: null,
    bytes: write.bytes,
    curatedBytes,
    diagnostics: sink.entries,
  };
}
