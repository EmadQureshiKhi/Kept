/**
 * Evidence-pack resolution (design §4.6, R3.19, R4.13, R6.11).
 *
 * The fact this module exists to encode: **no terminal event carries an
 * evidence path.** Kane 0.8.4 prints the pack hint
 * (`evidence: view locally with kane-cli evidence serve <path>`) on **stderr
 * only**, and `run_dir` — the field an implementer instinctively reaches for —
 * is legacy and no longer created (A12, docs/kane/command-surface.md). So a
 * resolver that reads a path off an event reads a field that is either absent or
 * stale, and the pack it fails to find is proof a reviewer will never see.
 *
 * The location is therefore derived from the **command family** and nothing
 * else, and the family fact is read from `contractFor(family).evidence` rather
 * than re-derived here, so it stays encoded exactly once:
 *
 * | family             | `contract.evidence` | resolved directory              |
 * |--------------------|---------------------|---------------------------------|
 * | `ExecutionRun`     | `session-dir`       | `<session_dir>/evidence`        |
 * | `ExecutionTestrun` | `cwd-testmuai`      | `<cwd>/.testmuai/evidence`      |
 * | `Assurance`        | `none`              | `null` — no pack exists          |
 *
 * Structurally, {@link resolveEvidenceDir} takes no event parameter at all:
 * `{ family, sessionDir, cwd }` is the whole input, so "never derived from the
 * event" is a shape the type system enforces rather than a habit reviewers must
 * police. `session_dir` is a session directory, not an evidence path — passing
 * it in is the caller's one legitimate read off `run_end`, and its absence is a
 * named edge case answered with `null` plus a diagnostic, never a guess.
 *
 * **Paths are absolute.** Every non-null path this module returns is absolute
 * and normalised in the host's native separator form: relative inputs are
 * resolved against `cwd`, and never against `process.cwd()` behind the caller's
 * back. Repo-relative forms (`evidence/ev_…/failure.yaml` in `RepairAnnotation`
 * and the snapshot) are produced later, by the writer that knows where the
 * repository root is; mixing the two conventions inside one value is how a
 * fabricated path gets published, which R6.11 forbids.
 *
 * Adversity is diagnosed, never thrown (design §14.2): a missing `session_dir`,
 * an evidence directory that does not exist — `.testmuai/evidence/` is
 * gitignored and regenerated, so its absence is routine — an unreadable entry,
 * or a directory holding no pack all return an empty answer and record a
 * `Diagnostic`.
 */

import { readdirSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';

import type { DiagnosticSink } from '../diagnostics.js';

import { contractFor, type CommandFamily } from './family.js';
import { SEALED_PACK_SUFFIX } from './packTriage.js';

/** Directory name Kane seals packs into, under a session directory. */
export const EVIDENCE_DIR_NAME = 'evidence';

/** Kane's per-project working directory, holding `testrun` suite packs. */
export const TESTMUAI_DIR_NAME = '.testmuai';

/**
 * How an artefact inside a pack is classified. Same vocabulary as
 * `LedgerSnapshot.evidence[].artifacts[].kind` (design §9.1), so a listing
 * serialises into the snapshot without a translation table.
 */
export type ArtifactKind =
  | 'annotated'
  | 'screenshot'
  | 'har'
  | 'console'
  | 'log'
  | 'failure-yaml'
  | 'other';

/** The kinds, in snapshot order. Lets tests and generators enumerate. */
export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  'annotated',
  'screenshot',
  'har',
  'console',
  'log',
  'failure-yaml',
  'other',
];

/** One file inside a pack. */
export interface EvidenceArtifact {
  readonly kind: ArtifactKind;
  /** Path relative to the pack directory, POSIX separators, e.g. `steps/step-4.png`. */
  readonly name: string;
  /** Absolute path on this host. */
  readonly path: string;
  /** Size in bytes, or null when it could not be read. */
  readonly bytes: number | null;
  /** ISO 8601 mtime, or null when it could not be read. */
  readonly modifiedAt: string | null;
}

/** The sealed pack this run resolved, in a resolved evidence directory. */
export interface EvidencePack {
  /** The pack's own entry name, e.g. `defd438c-….evidence`. */
  readonly id: string;
  /** Absolute path to the pack — the archive file, or an extracted directory. */
  readonly dir: string;
  /** ISO 8601 mtime — when it was sealed, as far as disk knows. */
  readonly sealedAt: string | null;
  /**
   * Every file in the pack, `name`-sorted. Nothing is ever omitted.
   *
   * **Empty for a sealed archive**, whose members are inside the zip: this module
   * walks a filesystem and does not inflate, and composing paths into an archive it
   * had not read would be fabricating them (R6.11). The two callers that need the
   * contents have the reader — `kane/packTriage.ts` for the triage note and
   * `kept snapshot`'s curation for the artefacts a judge clicks — and both go through
   * `kane/packArchive.ts`. {@link EvidencePack.archive} says which shape this is.
   */
  readonly artifacts: readonly EvidenceArtifact[];
  /** True when the pack is a sealed `.evidence` archive rather than a directory. */
  readonly archive: boolean;
}

/** What {@link listArtifacts} answers. */
export interface EvidenceListing {
  /** The family-derived directory, or null when the family cannot resolve one. */
  readonly dir: string | null;
  /** The newest pack by directory mtime, or null when there is none. */
  readonly pack: EvidencePack | null;
  /** Every pack id found in `dir`, newest first. */
  readonly packIds: readonly string[];
}

/**
 * The resolver's whole input. Deliberately **no event field** — see the module
 * note. `sessionDir` is `run_end.session_dir` when the caller has one.
 */
export interface EvidenceDirRequest {
  readonly family: CommandFamily;
  /** `run_end.session_dir`, or null/absent when the event did not carry one. */
  readonly sessionDir?: string | null;
  /** The directory Kane was invoked in. Absolute, or resolved against itself. */
  readonly cwd: string;
  /** Where adversity is recorded. Omit to resolve silently. */
  readonly diagnostics?: DiagnosticSink;
}

/** One directory entry, as much of `Dirent` as this module needs. */
export interface EvidenceDirEntry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
}

/** One `stat`, as much of `Stats` as this module needs. */
export interface EvidenceStat {
  readonly mtimeMs: number;
  readonly bytes: number | null;
  readonly isDirectory: boolean;
}

/**
 * The filesystem, injected. Real Kane output is not a test dependency: the unit
 * and property suites hand in temporary trees or in-memory ones, and the
 * property suite additionally records every path this module touches to prove
 * none of them came from an event field.
 *
 * Implementations may throw; every call site here treats a throw as adversity
 * and records a diagnostic.
 */
export interface EvidenceFileSystem {
  readDirectory(dir: string): readonly EvidenceDirEntry[];
  stat(path: string): EvidenceStat | null;
}

/** The production filesystem, `node:fs` synchronous calls. */
export const nodeEvidenceFileSystem: EvidenceFileSystem = {
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
};

/** {@link listArtifacts} input: the resolver's input plus the filesystem. */
export interface ListArtifactsRequest extends EvidenceDirRequest {
  readonly fs?: EvidenceFileSystem;
  /**
   * This run's own `execution_id`, when the terminal event carried one.
   *
   * Kane names the sealed pack after it, so supplying it turns "the newest pack in
   * the directory" into "**this run's** pack" — which is the difference between an
   * evidence reference a judge can click and one that points at whatever happened to
   * seal last. Without it the newest-wins heuristic is kept, and a mismatch is
   * diagnosed rather than silently accepted.
   */
  readonly executionId?: string | null;
}

/**
 * A filesystem sync conflict copy: `<name> 2.evidence`, `<name> 3.evidence`.
 *
 * iCloud Drive — and Dropbox, and OneDrive — resolve a write collision by keeping
 * both sides and appending a space and an ordinal to one of them. This repository
 * lives on an iCloud-synced path, and the copies it produced were being selected as
 * packs: they sort newest because the sync wrote them last, and they are usually a
 * *directory* holding a partial extraction rather than a sealed archive. The
 * consequence was a promise carrying `evidencePackId: '<uuid> 2.evidence'`, which
 * names no archive Kane ever wrote, so every evidence reference in the snapshot was
 * cleared as a dead link and `apps/ledger/public/evidence/` stayed empty.
 *
 * They are rejected by name rather than by content, deliberately: a conflict copy is
 * a fact about the filesystem, and the pack it shadows is still there under its real
 * name. Rejecting the copy is what lets the real one be found.
 */
const SYNC_CONFLICT_COPY = /\s\d+(?:\.[A-Za-z0-9]+)?$/;

/** Whether an entry name is a sync conflict copy rather than a pack Kane sealed. */
export function isSyncConflictCopy(name: string): boolean {
  return SYNC_CONFLICT_COPY.test(name.trim());
}

/**
 * The suffix Kane gives a sealed evidence pack, from the module that reads one.
 *
 * A pack is a **single archive file**, not a directory — `<execution_id>.evidence`,
 * a zip of two to eleven megabytes. That is what `testrun run` writes, and it is why
 * a resolver that considered only directories could never find one: the only
 * directories in `.testmuai/evidence/` are extractions somebody left behind, or the
 * conflict copies above. Imported from the module that reads one rather than
 * restated, so the two modules that care about the shape of a pack cannot disagree
 * about its name. The barrel publishes it from there.
 */

/**
 * How deep inside a pack the walk goes. Kane's packs are one or two levels;
 * the cap exists so a symlink loop is a truncated listing rather than a hang.
 */
const MAX_PACK_DEPTH = 8;

/** Trim a path-ish input to something usable, or null. */
function cleanPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * A `cwd` this module is willing to build a path on: present and absolute.
 *
 * A relative `cwd` is rejected rather than resolved, because the only thing it
 * could be resolved against is `process.cwd()` — and Kane may well have been
 * invoked somewhere else. Substituting our own working directory would produce a
 * confident, wrong, absolute path, which is worse than no path at all (R6.11).
 */
function usableCwd(value: string): string | null {
  const cleaned = cleanPath(value);
  if (cleaned === null || !isAbsolute(cleaned)) return null;
  return resolve(cleaned);
}

function isoOrNull(mtimeMs: number | undefined): string | null {
  if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs)) return null;
  const stamp = new Date(mtimeMs);
  return Number.isNaN(stamp.getTime()) ? null : stamp.toISOString();
}

/**
 * The family-derived evidence directory, absolute, or null.
 *
 * Null has exactly three causes, all of them states of the world rather than
 * failures: the family seals no pack (`Assurance`), `run_end` arrived without a
 * `session_dir`, or the caller supplied no usable `cwd` to resolve against. Each
 * is diagnosed when a sink is supplied — except `Assurance`, where null is the
 * ordinary answer and a diagnostic on every `cover` run would be noise.
 *
 * Never throws for its inputs. An unknown `family` is a programming error and
 * `contractFor` throws for it, exactly as it does everywhere else.
 */
export function resolveEvidenceDir(request: EvidenceDirRequest): string | null {
  const { evidence } = contractFor(request.family);
  const sink = request.diagnostics;
  const cwd = usableCwd(request.cwd);

  switch (evidence) {
    case 'none':
      return null;

    case 'session-dir': {
      const sessionDir = cleanPath(request.sessionDir);
      if (sessionDir === null) {
        // The named edge case: `session_dir` absent from `run_end`. There is no
        // second field to fall back on — `run_dir` is legacy and is never read —
        // so the honest answer is that this run has no locatable pack.
        sink?.report({
          code: 'evidence-session-dir-absent',
          severity: 'warn',
          message:
            'Terminal event carried no session_dir, so the evidence pack for this ' +
            'ExecutionRun cannot be located. No path is guessed.',
          file: null,
        });
        return null;
      }
      if (isAbsolute(sessionDir)) return join(sessionDir, EVIDENCE_DIR_NAME);
      if (cwd === null) {
        sink?.report({
          code: 'evidence-cwd-unusable',
          severity: 'error',
          message:
            `Relative session_dir ${sessionDir} needs an absolute cwd to resolve ` +
            `against, and none was supplied.`,
          file: sessionDir,
        });
        return null;
      }
      return join(resolve(cwd, sessionDir), EVIDENCE_DIR_NAME);
    }

    case 'cwd-testmuai': {
      if (cwd === null) {
        sink?.report({
          code: 'evidence-cwd-unusable',
          severity: 'error',
          message:
            'No absolute cwd supplied, so <cwd>/.testmuai/evidence cannot be ' +
            'resolved. The process working directory is deliberately not substituted.',
          file: null,
        });
        return null;
      }
      return join(cwd, TESTMUAI_DIR_NAME, EVIDENCE_DIR_NAME);
    }
  }
}

/** `readDirectory`, downgraded to null on any throw. */
function readDirectorySafely(
  fs: EvidenceFileSystem,
  dir: string,
  sink: DiagnosticSink | undefined,
  code: string,
): readonly EvidenceDirEntry[] | null {
  try {
    return fs.readDirectory(dir);
  } catch (cause) {
    sink?.report({
      code,
      severity: 'warn',
      message: `Could not read ${dir}: ${cause instanceof Error ? cause.message : String(cause)}`,
      file: dir,
    });
    return null;
  }
}

/** `stat`, downgraded to null on any throw. */
function statSafely(
  fs: EvidenceFileSystem,
  path: string,
  sink: DiagnosticSink | undefined,
): EvidenceStat | null {
  try {
    return fs.stat(path);
  } catch (cause) {
    sink?.report({
      code: 'evidence-entry-unreadable',
      severity: 'warn',
      message: `Could not stat ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
      file: path,
    });
    return null;
  }
}

/**
 * Classify one artefact by file name (design §4.6).
 *
 * Order matters: `failure.yaml` is decided before the generic YAML fall-through,
 * and `annotated.png` before the generic screenshot rule, because `annotated` is
 * the one image a reviewer is shown first and must not be filed as step 4 of
 * seventeen.
 *
 * Anything unrecognised is `other`. It is never dropped — a pack that quietly
 * omits a file it did not recognise is the same dishonesty as a coverage number
 * that quietly omits a test.
 */
export function classifyArtifact(name: string): ArtifactKind {
  const leaf = basename(name.replace(/\\/g, '/')).toLowerCase();
  if (leaf === 'failure.yaml' || leaf === 'failure.yml') return 'failure-yaml';
  if (/^annotated[^/]*\.png$/.test(leaf)) return 'annotated';
  if (/\.(?:png|jpg|jpeg|webp)$/.test(leaf)) return 'screenshot';
  if (leaf.endsWith('.har')) return 'har';
  if (/^console.*\.ndjson$/.test(leaf)) return 'console';
  if (leaf.endsWith('.log')) return 'log';
  return 'other';
}

/** Walk one pack directory, depth-capped, collecting every file it holds. */
function collectArtifacts(
  fs: EvidenceFileSystem,
  packDir: string,
  sink: DiagnosticSink | undefined,
): EvidenceArtifact[] {
  const artifacts: EvidenceArtifact[] = [];
  const queue: { readonly dir: string; readonly prefix: string; readonly depth: number }[] = [
    { dir: packDir, prefix: '', depth: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const entries = readDirectorySafely(fs, current.dir, sink, 'evidence-pack-unreadable');
    if (entries === null) continue;

    for (const entry of entries) {
      const absolute = join(current.dir, entry.name);
      const name = current.prefix === '' ? entry.name : `${current.prefix}/${entry.name}`;
      if (entry.isDirectory) {
        if (current.depth + 1 <= MAX_PACK_DEPTH) {
          queue.push({ dir: absolute, prefix: name, depth: current.depth + 1 });
        } else {
          sink?.report({
            code: 'evidence-pack-depth-capped',
            severity: 'warn',
            message: `Stopped descending at ${name}; evidence packs are not this deep.`,
            file: absolute,
          });
        }
        continue;
      }
      const stat = statSafely(fs, absolute, sink);
      artifacts.push({
        kind: classifyArtifact(name),
        name,
        path: absolute,
        bytes: stat?.bytes ?? null,
        modifiedAt: isoOrNull(stat?.mtimeMs),
      });
    }
  }

  return artifacts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function buildPack(
  fs: EvidenceFileSystem,
  dir: string,
  id: string,
  sink: DiagnosticSink | undefined,
  archive = false,
): EvidencePack {
  return {
    id,
    dir,
    sealedAt: isoOrNull(statSafely(fs, dir, sink)?.mtimeMs),
    // A sealed archive's members are inside the zip. This module walks a filesystem;
    // inflating is `kane/packArchive.ts`'s job, and inventing paths into an archive
    // nothing here read would be fabricating them (R6.11).
    artifacts: archive ? Object.freeze([]) : collectArtifacts(fs, dir, sink),
    archive,
  };
}

/**
 * The newest pack in the family-derived evidence directory, and everything in
 * it.
 *
 * "Newest" is the pack directory's mtime, tie-broken by descending name so the
 * answer is deterministic when two packs seal inside one filesystem tick —
 * Kane's ids are timestamps, so descending name is also newest-first.
 *
 * A directory holding files but no sub-directory is treated as the pack itself.
 * That is the shape a `testrun` suite pack can take under
 * `<cwd>/.testmuai/evidence/`, and reading it is strictly better than reporting
 * that evidence which exists on disk does not exist.
 *
 * Returns `dir: null` whenever {@link resolveEvidenceDir} does, and
 * `pack: null` when the directory is absent, unreadable, or holds nothing.
 * Never throws.
 */
export function listArtifacts(request: ListArtifactsRequest): EvidenceListing {
  const sink = request.diagnostics;
  const dir = resolveEvidenceDir(request);
  if (dir === null) return { dir: null, pack: null, packIds: [] };

  const fs = request.fs ?? nodeEvidenceFileSystem;
  const entries = readDirectorySafely(fs, dir, sink, 'evidence-dir-unreadable');
  if (entries === null) return { dir, pack: null, packIds: [] };

  // A pack is a sealed `.evidence` **archive** or an extracted directory. Archives
  // were invisible here until the closed loop was driven live, and they are what
  // Kane actually writes — so the only packs this function could see were leftover
  // extractions and sync conflict copies, and every evidence reference in the
  // snapshot was therefore a dead link.
  const rejected: string[] = [];
  const packs = entries
    .filter((entry) => {
      if (!entry.isDirectory && !(entry.isFile && entry.name.endsWith(SEALED_PACK_SUFFIX))) {
        return false;
      }
      if (isSyncConflictCopy(entry.name)) {
        rejected.push(entry.name);
        return false;
      }
      return true;
    })
    .map((entry) => ({
      name: entry.name,
      archive: entry.isFile === true,
      mtimeMs: statSafely(fs, join(dir, entry.name), sink)?.mtimeMs ?? 0,
    }))
    // Newest first, tie-broken by descending name so two packs sealing inside one
    // filesystem tick still order deterministically. An archive outranks a directory
    // of the same age: the archive is what Kane sealed, a directory of the same name
    // is an extraction of it.
    .sort(
      (a, b) =>
        b.mtimeMs - a.mtimeMs ||
        Number(b.archive) - Number(a.archive) ||
        (a.name < b.name ? 1 : a.name > b.name ? -1 : 0),
    );

  for (const name of rejected.sort()) {
    sink?.report({
      code: 'evidence-pack-conflict-copy',
      severity: 'info',
      message:
        `'${name}' in ${dir} is a filesystem sync conflict copy, not a pack Kane sealed — ` +
        `iCloud Drive resolves a write collision by keeping both sides and appending an ` +
        `ordinal. It sorts newest because the sync wrote it last, so selecting it would ` +
        `attribute this run's evidence to an id no archive is named after. It is ignored ` +
        `and the pack it shadows is resolved under its real name.`,
      file: join(dir, name),
    });
  }

  // This run's own pack, when the terminal event named one. Matching on the id with
  // and without the suffix, because the entry carries it and `execution_id` does not.
  const wanted = cleanPath(request.executionId);
  const own =
    wanted === null
      ? undefined
      : packs.find(
          (pack) => pack.name === wanted || pack.name === `${wanted}${SEALED_PACK_SUFFIX}`,
        );
  if (wanted !== null && own === undefined && packs.length > 0) {
    sink?.report({
      code: 'evidence-pack-not-this-run',
      severity: 'warn',
      message:
        `No pack in ${dir} is named after this run's execution id '${wanted}', so the newest ` +
        `pack present is reported instead. Sealed packs are gitignored and regenerated per ` +
        `run, so a fresh clone reaching this state is expected; on a machine that just ran ` +
        `the suite it means the upload or the seal did not land.`,
      file: dir,
    });
  }

  const selected = own ?? packs[0];
  if (selected === undefined) {
    // A directory holding files but no pack entry is itself the pack. That is the
    // shape an already-extracted `testrun` pack takes.
    if (entries.some((entry) => entry.isFile)) {
      const id = basename(dir);
      return { dir, pack: buildPack(fs, dir, id, sink), packIds: [id] };
    }
    sink?.report({
      code: 'evidence-pack-absent',
      severity: 'warn',
      message: `No evidence pack found in ${dir}.`,
      file: dir,
    });
    return { dir, pack: null, packIds: [] };
  }

  return {
    dir,
    pack: buildPack(fs, join(dir, selected.name), selected.name, sink, selected.archive),
    packIds: packs.map((pack) => pack.name),
  };
}
