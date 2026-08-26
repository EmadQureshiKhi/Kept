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
 * pack *directory* and therefore resolves nothing here, so the curation below
 * reads the archive itself — through `readPackEntries`, which now lives in
 * `@kept/core` beside the evidence resolver because the triage rung reads the same
 * archives to find the note that decides a repair branch.
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

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

import type {
  ArtifactKind,
  CollectingDiagnosticSink,
  Diagnostic,
  DiagnosticSink,
  HandoffFile,
  KeptState,
  LedgerSnapshot,
  PackEntry,
  SnapshotAmendment,
  SnapshotArtifact,
  SnapshotEvidence,
  SnapshotReviewCard,
  SnapshotRun,
  SnapshotRunMember,
  StateFileSystem,
} from '@kept/core';
import {
  HANDOFF_DIRECTORY_RELATIVE_PATH,
  SEALED_PACK_SUFFIX,
  evidenceId,
  classifyArtifact,
  createDiagnosticSink,
  createStateStore,
  evidencePackIdFromRef,
  isMemberStatus,
  listAmendments,
  listReviewCards,
  nodeStateFileSystem,
  parseHandoff,
  readPackEntries,
  toSnapshotAmendment,
  toSnapshotReviewCard,
  REVIEW_CARDS_DIRECTORY_RELATIVE_PATH,
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
  /** A file under `.kept/handoff/` this version cannot read. The rest still load. */
  runUnreadable: 'snapshot-run-unreadable',
  /** How many terminal events and amendments the projection found on disk. */
  recordsProjected: 'snapshot-records-projected',
} as const);

/** The codes as a list, so a test can enumerate them. */
export const SNAPSHOT_COMMAND_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(SNAPSHOT_COMMAND_DIAGNOSTIC_CODES),
);

/** Where curated packs are committed, relative to the repository root. */
export const CURATED_EVIDENCE_RELATIVE_DIR = 'apps/ledger/public/evidence';

/** Where Kane leaves a copy of every sealed pack, relative to the repo root. */
export const SEALED_EVIDENCE_RELATIVE_DIR = '.testmuai/evidence';

/**
 * The suffix Kane gives a sealed pack. The id is the execution id before it.
 *
 * Re-exported from the core package, which now owns both the suffix and the zip
 * reader: the triage rung reads the same archives this command curates, and one
 * spelling of the suffix is what keeps the two agreeing about what a pack is.
 */
export { SEALED_PACK_SUFFIX } from '@kept/core';

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
  const names: string[] = [];
  const add = (name: string): void => {
    if (name.length > 0 && !names.includes(name)) names.push(name);
  };

  // A pack id **already carrying the suffix** is the common case, and it was the
  // one this function got wrong: `listArtifacts` names a pack by its entry name, so
  // an id is `<execution_id>.evidence`, and appending the suffix again looked for
  // `<execution_id>.evidence.evidence`. Nothing was ever curated, and the doubled
  // spelling was visible in the diagnostic the whole time.
  add(packId);
  if (!packId.endsWith(SEALED_PACK_SUFFIX)) add(`${packId}${SEALED_PACK_SUFFIX}`);

  // A snapshot id is `ev_`-prefixed by schema (`evidenceIdField`), while the sealed
  // file is named for the bare execution id, so both spellings are tried.
  const bare = packId.startsWith('ev_') ? packId.slice(3) : packId;
  if (bare !== packId) {
    add(bare);
    if (!bare.endsWith(SEALED_PACK_SUFFIX)) add(`${bare}${SEALED_PACK_SUFFIX}`);
  }
  return Object.freeze(names);
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

/**
 * One file recovered from a sealed pack.
 *
 * An alias for the core package's `PackEntry`, not a lookalike: the zip reader
 * moved to `@kept/core` when the triage rung became its second caller, and two
 * spellings of one shape is how a curation step and a router quietly stop agreeing
 * about what came out of an archive.
 */
export type CuratedEntry = PackEntry;

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
    // Kane's name finds the archive; the node id names everything KEPT publishes.
    const nodeId = evidenceId(packId);
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
      // Named by the **node id**, not by Kane's archive name. It is what the
      // snapshot declares as `evidence[].id`, what §15.3's `/evidence/ev_…/`
      // convention documents, and what Property 28 resolves a link against — so a
      // directory named anything else is a link a judge clicks and gets a 404 from.
      const destination = joinPath(curatedRoot, `${nodeId}/${entry.name}`);
      fs.ensureDir(destination.slice(0, destination.lastIndexOf('/')));
      fs.writeBinary(destination, entry.bytes);
      packBytes += entry.bytes.length;
      artifacts.push({
        kind: classifyArtifact(entry.name),
        name: entry.name,
        publicPath: publicPathFor(nodeId, entry.name),
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
      // The snapshot's node id, minted from Kane's pack name — `ev_` prefixed and
      // path-safe, because §9.1's `evidenceIdField` is `^ev_[A-Za-z0-9._-]+$` and
      // the graph lanes nodes by prefix. Kane's own name is a bare execution UUID
      // with a `.evidence` suffix, which can never satisfy that pattern, so every
      // reference used to be dropped by the projection without a word: eight
      // promises with `evidencePackId: null` and an empty `evidence` array, on a
      // repository that had the archives on disk the whole time.
      id: nodeId,
      // And Kane's own name, kept beside it, so the record still says which
      // archive this came from rather than only what KEPT renamed it to.
      packId,
      // Every pack in this repository was sealed by `testmd run`, which is the
      // ExecutionRun family. `testrun` is the suite spelling and nothing here
      // has used it, so claiming it would be a guess.
      kind: 'run',
      // Disk mtimes are not carried into the committed snapshot: the archive's
      // own timestamps are local to the machine that sealed it, and a snapshot
      // whose bytes change with the clone's filesystem is not a contract.
      sealedAt: null,
      publicPath: publicPathFor(nodeId),
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

/**
 * Every pack the graph references, in first-seen order, **one entry per pack**.
 *
 * Deduplication is by minted node id rather than by the string, because one pack
 * reaches here under two spellings: `promise.evidencePackId` is Kane's own archive
 * name, and `evidencePackIdFromRef` resolves a `repair.evidenceRef` to the `ev_`
 * node id. Both find the same archive — `archiveNamesFor` tries the prefixed and bare
 * forms — so treating them as distinct curated the same pack twice and published two
 * `evidence` entries sharing one id.
 *
 * Kane's own spelling wins when both are seen, so the curated directory is named
 * after the archive rather than after KEPT's rename of it.
 */
export function referencedPackIds(state: KeptState): readonly string[] {
  const byNode = new Map<string, string>();
  const add = (id: string | null): void => {
    if (id === null || id.length === 0) return;
    const node = evidenceId(id);
    const existing = byNode.get(node);
    if (existing === undefined) {
      byNode.set(node, id);
      return;
    }
    // Prefer the spelling that is not already a node id: it is Kane's.
    if (existing.startsWith('ev_') && !id.startsWith('ev_')) byNode.set(node, id);
  };
  for (const promise of state.graph.promises) {
    add(promise.evidencePackId);
    if (promise.repair !== null && promise.repair.evidenceRef !== null) {
      add(evidencePackIdFromRef(promise.repair.evidenceRef));
    }
  }
  return Object.freeze([...byNode.values()]);
}

/* ─────────────────────── runs and amendments, off the disk ───────────────────
 *
 * `/runs` is the terminal-event log and `/amendments` is the docs-lie surface, and
 * until now both were rendered from fields nothing ever filled: every caller of
 * `buildSnapshot` left `runs` and `amendments` at their defaults, so the two pages
 * published their empty states on a repository that had recorded nine members and a
 * red verdict. The record already existed on disk — `.kept/handoff/<runId>.json` is
 * written for **every** run (R11.7) and `.kept/amendments/<id>.json` for every
 * proposal (§8.3) — so this is a projection of persisted state, not a new source of
 * truth, and it stays exactly as much of one as the evidence curation above.
 *
 * Two rules keep it honest. A handoff that **invoked nothing** is not a terminal
 * event and is left out: an empty blast radius and a missing binary both write a
 * handoff, and neither is a run. And only `warn` and `error` diagnostics are
 * carried, because the `/runs` detail row is headed *reasons and diagnostics* and an
 * `info` progress note is neither.
 */

/** The directory seam, so these collectors can be tested without a disk. */
export type DirectoryReader = (path: string) => readonly string[];

/** The production reader: `node:fs`, answering `[]` for an absent directory. */
export const nodeDirectoryReader: DirectoryReader = (path: string): readonly string[] => {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
};

/** The members one handoff reported on, deduped, in the order they were recorded. */
function runMembersOf(handoff: HandoffFile): readonly SnapshotRunMember[] {
  const members: SnapshotRunMember[] = [];
  const seen = new Set<string>();
  for (const result of handoff.results) {
    // Verbatim from the wire, so `broken` stays distinguishable from `failed`
    // (R4.9). A result whose member status never arrived has no member row.
    if (result.designedTest === null || result.memberStatus === null) continue;
    if (!isMemberStatus(result.memberStatus)) continue;
    const key = `${result.designedTest}\u0000${result.testId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    members.push({
      path: result.designedTest,
      testId: result.testId,
      status: result.memberStatus,
      verdict: result.verdict,
    });
  }
  return members;
}

/** One run entry, projected from one handoff. Null when it is not a run. */
export function runFromHandoff(handoff: HandoffFile): SnapshotRun | null {
  if (!handoff.command.invoked) return null;
  if (handoff.command.family === null) return null;
  // `exitMeaning` is how §14.1 names what happened, and every invocation has one.
  // A handoff that claims a process ran and reports no meaning for its exit is not
  // a run this log can describe, so it is left out rather than given a default.
  if (handoff.outcome.exitMeaning === null) return null;
  const command = handoff.command.argv.join(' ');
  if (command.length === 0) return null;

  const duration = handoff.outcome.durationMs ?? null;
  const verdictObject =
    handoff.results.find((result) => result.verdictObject !== null)?.verdictObject ?? null;

  return {
    id: handoff.runId,
    family: handoff.command.family,
    command,
    // The handoff records one instant — when it was written, which is the instant
    // the terminal event was consumed. A `startedAt` would be that minus a
    // duration, which is arithmetic rather than a measurement, so it stays null.
    startedAt: null,
    endedAt: handoff.writtenAt,
    durationMs: duration === null ? null : Math.max(0, Math.round(duration)),
    exitCode: handoff.outcome.exitCode,
    exitMeaning: handoff.outcome.exitMeaning,
    terminalSeen: handoff.outcome.terminalSeen,
    terminalEventType: handoff.outcome.terminalEventType,
    status: handoff.outcome.status,
    resultCode: handoff.outcome.resultCode,
    reasonCode: handoff.outcome.reasonCode,
    credits: handoff.outcome.credits,
    verdictObject: verdictObject === null ? null : { ...verdictObject },
    evidencePackId:
      handoff.results.find((result) => result.evidencePackId !== null)?.evidencePackId ?? null,
    members: [...runMembersOf(handoff)],
    diagnostics: handoff.diagnostics
      .filter((entry) => entry.severity !== 'info')
      .map((entry) => ({ ...entry })),
  };
}

/**
 * Every run the repository has persisted, newest first.
 *
 * Sorted on the handoff's own `writtenAt` rather than on a file mtime, because a
 * clone's mtimes are a fact about the clone and the instant the terminal event was
 * consumed is a fact about the run.
 */
export function collectRuns(request: {
  readonly repoRoot: string;
  readonly fileSystem?: StateFileSystem | undefined;
  readonly readDirectory?: DirectoryReader | undefined;
  readonly diagnostics?: DiagnosticSink | undefined;
}): readonly SnapshotRun[] {
  const fileSystem = request.fileSystem ?? nodeStateFileSystem();
  const readDirectory = request.readDirectory ?? nodeDirectoryReader;
  const directory = joinPath(request.repoRoot, HANDOFF_DIRECTORY_RELATIVE_PATH);

  const runs: SnapshotRun[] = [];
  for (const name of [...readDirectory(directory)].sort()) {
    if (!name.endsWith('.json')) continue;
    let text: string | null;
    try {
      text = fileSystem.readFile(`${directory}/${name}`);
    } catch {
      text = null;
    }
    const handoff = text === null ? null : parseHandoff(text);
    if (handoff === null) {
      request.diagnostics?.report({
        code: SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.runUnreadable,
        severity: 'warn',
        message:
          `${HANDOFF_DIRECTORY_RELATIVE_PATH}/${name} is not a handoff this version can read, ` +
          `so it contributes no run entry. The rest of the log is unaffected.`,
        file: `${HANDOFF_DIRECTORY_RELATIVE_PATH}/${name}`,
      });
      continue;
    }
    const run = runFromHandoff(handoff);
    if (run !== null) runs.push(run);
  }

  return Object.freeze(
    runs.sort((left, right) => {
      const l = Date.parse(left.endedAt ?? '');
      const r = Date.parse(right.endedAt ?? '');
      if (Number.isNaN(l) || Number.isNaN(r) || l === r) {
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
      }
      return r - l;
    }),
  );
}

/** Every staged amendment, in the shape the snapshot carries (§8.3, R7.5). */
export function collectAmendments(request: {
  readonly repoRoot: string;
  readonly fileSystem?: StateFileSystem | undefined;
  readonly readDirectory?: DirectoryReader | undefined;
  readonly diagnostics?: DiagnosticSink | undefined;
}): readonly SnapshotAmendment[] {
  const amendments = listAmendments(request.repoRoot, {
    ...(request.fileSystem === undefined ? {} : { fileSystem: request.fileSystem }),
    ...(request.readDirectory === undefined
      ? {}
      : { readDirectory: request.readDirectory as (path: string) => readonly string[] }),
    ...(request.diagnostics === undefined ? {} : { diagnostics: request.diagnostics }),
  });
  return Object.freeze(amendments.map(toSnapshotAmendment));
}

/**
 * Every held change in `.kept/review-cards/`, in the snapshot's own shape.
 *
 * **This projection was missing, and its absence was the reason `/reviews` could not
 * render a held change through the CLI at all.** `listReviewCards` was written,
 * exported and unit-tested, and its own doc comment says it "is the seam
 * `kept snapshot` fills its `reviewCards` field from and `/reviews` renders". Nothing
 * called it. `runSnapshot` accepted `reviewCards` only as a request field, and the two
 * commands that produce cards, `reconcile` and `evolve`, did not pass it, so the
 * snapshot wrote `[]` on every path a human could reach.
 *
 * It was found by running the docs-triggered loop live (task 22.2): a documentation
 * edit made Kane stage nine changes, KEPT mirrored nine cards into `.kept/review-cards/`,
 * the reconcile output reported nine, and the snapshot it wrote in the same second
 * carried none. Every unit test passed, because each half was correct on its own and
 * no test asserted the composition. That is the same shape as the undeclared `yaml`
 * and `zod` dependencies of `@kept/core`, and it is the third time in this repository
 * that the defect has been in the wiring rather than in a part.
 *
 * Symmetric with {@link collectAmendments} deliberately: omit the field and the store
 * is read, pass it, even as `[]`, and no directory is touched. A held change nobody
 * can see is not held, it is lost, and the ledger's whole claim is that it shows what
 * it owes.
 */
function collectReviewCards(request: {
  readonly repoRoot: string;
  readonly fileSystem?: StateFileSystem | undefined;
  readonly readDirectory?: DirectoryReader | undefined;
  readonly diagnostics?: DiagnosticSink | undefined;
}): readonly SnapshotReviewCard[] {
  const cards = listReviewCards(request.repoRoot, {
    ...(request.fileSystem === undefined ? {} : { fileSystem: request.fileSystem }),
    ...(request.readDirectory === undefined
      ? {}
      : { readDirectory: request.readDirectory as (path: string) => readonly string[] }),
    ...(request.diagnostics === undefined ? {} : { diagnostics: request.diagnostics }),
  });
  return Object.freeze(cards.map(toSnapshotReviewCard));
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
  /**
   * `kane-cli --version`, passed straight to `buildSnapshot`. **Nothing passes it**,
   * so `generator.kaneCli` reads `null` in every committed snapshot; the seam is
   * here rather than a probe because this command invokes no Kane at all. The
   * reason it is a documented gap rather than a wiring job is written at
   * `BuildSnapshotRequest.kaneCliVersion` in `../snapshot.js`.
   */
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
  /**
   * The terminal-event log. Omit it and the command projects it from
   * `.kept/handoff/`, which is the normal path; pass it — even as `[]` — to project
   * a state without reading the persisted handoffs.
   */
  readonly runs?: readonly SnapshotRun[] | undefined;
  /**
   * Held changes. Omit it and the command reads `.kept/review-cards/`.
   *
   * That sentence was not true until task 22.2: the field existed, nothing filled it
   * from the store, and the two commands that produce cards did not pass it, so
   * `/reviews` rendered nothing however many changes were held. See
   * {@link collectReviewCards}.
   */
  readonly reviewCards?: readonly SnapshotReviewCard[] | undefined;
  /** Staged amendments. Omit it and the command reads `.kept/amendments/`. */
  readonly amendments?: readonly SnapshotAmendment[] | undefined;
  /**
   * Directory listing for all three projections above. Defaults to `node:fs`.
   *
   * **This is a second seam, and it has to be, which is why omitting it is a
   * trap.** `fileSystem` is a `StateFileSystem`: it reads and writes whole files
   * by path, and it has no way to answer "what is in this directory", because
   * nothing else in the product needs it to. The three projections start by
   * *enumerating* `.kept/handoff/`, `.kept/amendments/` and `.kept/review-cards/`,
   * so they need a listing seam that `fileSystem` cannot provide. Two seams for
   * one store is the cost of that, and the cost is paid at every call site.
   *
   * The trap is that injecting only `fileSystem` looks like it isolated the run
   * and did not. The reads are redirected into the seeded map while the listing
   * stays on real disk, so the projection enumerates the developer's own
   * `.kept/handoff/`, tries to read each name it found out of a map that has none
   * of them, and reports one `snapshot-run-unreadable` warning per real file. The
   * count tracks whatever is on that machine: 27 on the machine this was found
   * on, 0 on a fresh clone. Nothing fails, because nothing asserted on the exact
   * diagnostic list, and the moment something does the test is machine-dependent.
   *
   * So a caller that injects `fileSystem` must inject `readDirectory` too, and a
   * caller that threads one down to `runSnapshot` must thread both. Every request
   * type on the way here declares the field for that reason.
   */
  readonly readDirectory?: DirectoryReader | undefined;
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

  // The terminal-event log and the amendment surface, projected off the records
  // `kept verify` and `kept amend propose` already persisted. Omitting either
  // discovers it; passing one — even as `[]` — projects a state without reading
  // `.kept/handoff/` or `.kept/amendments/` at all, which is what every unit test
  // of this command wants.
  const runs =
    request.runs ??
    collectRuns({
      repoRoot: request.repoRoot,
      fileSystem,
      diagnostics: sink,
      ...(request.readDirectory === undefined ? {} : { readDirectory: request.readDirectory }),
    });
  const amendments =
    request.amendments ??
    collectAmendments({
      repoRoot: request.repoRoot,
      fileSystem,
      diagnostics: sink,
      ...(request.readDirectory === undefined ? {} : { readDirectory: request.readDirectory }),
    });
  const reviewCards =
    request.reviewCards ??
    collectReviewCards({
      repoRoot: request.repoRoot,
      fileSystem,
      diagnostics: sink,
      ...(request.readDirectory === undefined ? {} : { readDirectory: request.readDirectory }),
    });
  if (
    request.runs === undefined ||
    request.amendments === undefined ||
    request.reviewCards === undefined
  ) {
    // The diagnostic fires when **any** of the three fields was omitted, and it used
    // to close by asserting "All three are projections of persisted records" while
    // printing a caller-supplied count for whichever field was passed. On the
    // partial case that sentence was false about the very number beside it: a
    // caller passing `runs: []` and omitting the other two got a line claiming the
    // run count came off `.kept/handoff/` when nothing had listed that directory.
    // Only a caller can reach the partial case, so this was latent rather than
    // live, and a latent false statement is still the thing this command exists to
    // refuse. Each field now says which of the two it was, and the closing sentence
    // is scoped to the fields that really were read.
    const clause = (
      count: number,
      noun: string,
      directory: string,
      projected: boolean,
    ): string =>
      `${count} ${noun}${count === 1 ? '' : 's'} ` +
      (projected
        ? `from ${directory}/`
        : `supplied by the caller rather than read from ${directory}/`);
    const projectedFrom: string[] = [];
    if (request.runs === undefined) projectedFrom.push(`${HANDOFF_DIRECTORY_RELATIVE_PATH}/`);
    if (request.amendments === undefined) projectedFrom.push('.kept/amendments/');
    if (request.reviewCards === undefined) {
      projectedFrom.push(`${REVIEW_CARDS_DIRECTORY_RELATIVE_PATH}/`);
    }
    const allThree = projectedFrom.length === 3;
    const clauses = [
      clause(
        runs.length,
        'terminal event',
        HANDOFF_DIRECTORY_RELATIVE_PATH,
        request.runs === undefined,
      ),
      clause(amendments.length, 'amendment', '.kept/amendments', request.amendments === undefined),
      clause(
        reviewCards.length,
        'held change',
        REVIEW_CARDS_DIRECTORY_RELATIVE_PATH,
        request.reviewCards === undefined,
      ),
    ];

    sink.report({
      code: SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.recordsProjected,
      severity: 'info',
      message:
        // `projected` leads the sentence only when all three were, because it is a
        // verb this command has to have earned for every count that follows it.
        `kept snapshot: ${allThree ? 'projected ' : ''}` +
        `${clauses.slice(0, -1).join(', ')} and ${clauses[clauses.length - 1] as string}. ` +
        `${
          allThree
            ? 'All three are projections of persisted records; none is'
            : `What was read off ${projectedFrom.join(' and ')} is a projection of persisted ` +
              `records, and none of the three is`
        } a source of truth this command invents.`,
      file: null,
    });
  }

  const built = buildSnapshot({
    state,
    diagnostics: sink,
    evidence,
    runs,
    amendments,
    reviewCards,
    ...(request.generatedAt === undefined ? {} : { generatedAt: request.generatedAt }),
    ...(request.kaneCliVersion === undefined ? {} : { kaneCliVersion: request.kaneCliVersion }),
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
