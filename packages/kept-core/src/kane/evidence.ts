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

/** The newest sealed pack in a resolved evidence directory. */
export interface EvidencePack {
  /** The pack directory's own name, e.g. `ev_20260820T184011Z`. */
  readonly id: string;
  /** Absolute path to the pack directory. */
  readonly dir: string;
  /** ISO 8601 mtime of the pack directory — when it was sealed, as far as disk knows. */
  readonly sealedAt: string | null;
  /** Every file in the pack, `name`-sorted. Nothing is ever omitted. */
  readonly artifacts: readonly EvidenceArtifact[];
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
}

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
): EvidencePack {
  return {
    id,
    dir,
    sealedAt: isoOrNull(statSafely(fs, dir, sink)?.mtimeMs),
    artifacts: collectArtifacts(fs, dir, sink),
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

  const packs = entries
    .filter((entry) => entry.isDirectory)
    .map((entry) => ({
      name: entry.name,
      mtimeMs: statSafely(fs, join(dir, entry.name), sink)?.mtimeMs ?? 0,
    }))
    .sort((a, b) => (b.mtimeMs - a.mtimeMs) || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));

  const newest = packs[0];
  if (newest === undefined) {
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
    pack: buildPack(fs, join(dir, newest.name), newest.name, sink),
    packIds: packs.map((pack) => pack.name),
  };
}
