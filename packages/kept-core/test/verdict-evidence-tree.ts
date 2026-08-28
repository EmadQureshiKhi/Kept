/**
 * An in-memory evidence tree for the verdict-router suites (tasks 11.1, 11.3,
 * 11.4, and Properties 17 and 18).
 *
 * A sealed Kane pack is not a test dependency. `kane/evidence.ts` and
 * `kane/failureYaml.ts` both take their filesystem as an injected interface for
 * exactly this reason, so the router suites can exercise the real resolution path
 * — family-derived directory, newest pack, `failure.yaml` classification — with no
 * disk anywhere and no Kane run.
 *
 * It lives here rather than in `test/arbitraries.ts` because that module is the
 * shared generator set and this is a fixture *builder*, not an arbitrary: it takes
 * an exact tree and answers the two filesystems that read it. Deterministic
 * modified times are part of the point — "newest pack" is decided by directory
 * mtime, and a builder that inherited real clock values would make the newest-pack
 * assertions flaky.
 */

import {
  listArtifacts,
  type EvidenceDirEntry,
  type EvidenceFileSystem,
  type EvidenceListing,
  type EvidenceStat,
  type FailureYamlFileSystem,
} from 'kept-core';

/** The repository root every path in a built tree sits under. Absolute, POSIX. */
export const REPO_ROOT = '/repo';

/**
 * Where the ExecutionTestrun family seals its packs. Spelled once, and only so
 * the assertions can compare against it — nothing in the source re-spells it.
 */
export const TESTRUN_EVIDENCE_ROOT = `${REPO_ROOT}/.testmuai/evidence`;

/** One pack: its directory name, when it was sealed, and the files it holds. */
export interface PackSpec {
  /** The pack directory's own name, e.g. `ev_20260820T184011Z`. */
  readonly id: string;
  /** Directory mtime. Larger is newer. Defaults to the pack's index in the list. */
  readonly mtimeMs?: number;
  /** Pack-relative file name → file content. */
  readonly files: Readonly<Record<string, string>>;
}

/** The two injected filesystems, plus what was put in the tree. */
export interface EvidenceTree {
  /** For `listArtifacts` / `resolveEvidenceDir`. */
  readonly fs: EvidenceFileSystem;
  /** For `loadFailureYaml`, counting its reads so laziness can be asserted. */
  readonly yaml: FailureYamlFileSystem;
  /** Every absolute file path the tree holds. */
  readonly filePaths: readonly string[];
  /** Every absolute directory path the tree holds. */
  readonly dirPaths: readonly string[];
  /** How many times `yaml.readFile` has been called. */
  reads(): number;
}

function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? '/' : path.slice(0, cut);
}

function leafOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Build the tree.
 *
 * An empty pack list still creates the evidence directory itself, which is the
 * honest shape of a project that has run nothing: the directory exists because
 * Kane created it, and it holds no pack. `listArtifacts` answers `pack: null`
 * plus a diagnostic for that, and the router has to route it anyway.
 */
export function buildEvidenceTree(packs: readonly PackSpec[]): EvidenceTree {
  const files = new Map<string, string>();
  const dirMtimes = new Map<string, number>([
    [REPO_ROOT, 1],
    [`${REPO_ROOT}/.testmuai`, 1],
    [TESTRUN_EVIDENCE_ROOT, 1],
  ]);

  packs.forEach((pack, index) => {
    const dir = `${TESTRUN_EVIDENCE_ROOT}/${pack.id}`;
    dirMtimes.set(dir, pack.mtimeMs ?? 1000 + index);
    for (const [name, content] of Object.entries(pack.files)) {
      files.set(`${dir}/${name}`, content);
      // A nested artefact name creates its intermediate directories.
      let parent = parentOf(`${dir}/${name}`);
      while (parent.length > dir.length) {
        if (!dirMtimes.has(parent)) dirMtimes.set(parent, dirMtimes.get(dir) ?? 1);
        parent = parentOf(parent);
      }
    }
  });

  let reads = 0;

  const fs: EvidenceFileSystem = {
    readDirectory(dir: string): readonly EvidenceDirEntry[] {
      if (!dirMtimes.has(dir)) {
        throw new Error(`ENOENT: no such directory, scandir '${dir}'`);
      }
      const entries: EvidenceDirEntry[] = [];
      for (const candidate of dirMtimes.keys()) {
        if (candidate !== dir && parentOf(candidate) === dir) {
          entries.push({ name: leafOf(candidate), isDirectory: true, isFile: false });
        }
      }
      for (const candidate of files.keys()) {
        if (parentOf(candidate) === dir) {
          entries.push({ name: leafOf(candidate), isDirectory: false, isFile: true });
        }
      }
      return entries;
    },
    stat(path: string): EvidenceStat | null {
      const dirMtime = dirMtimes.get(path);
      if (dirMtime !== undefined) return { mtimeMs: dirMtime, bytes: null, isDirectory: true };
      const content = files.get(path);
      if (content === undefined) return null;
      return { mtimeMs: 500, bytes: content.length, isDirectory: false };
    },
  };

  const yaml: FailureYamlFileSystem = {
    readFile(path: string): string | null {
      reads += 1;
      return files.get(path) ?? null;
    },
  };

  return {
    fs,
    yaml,
    filePaths: [...files.keys()],
    dirPaths: [...dirMtimes.keys()],
    reads: (): number => reads,
  };
}

/**
 * The listing a real caller would hand the router: resolved from the command
 * family and the working directory, never from a terminal event.
 */
export function testrunListing(tree: EvidenceTree): EvidenceListing {
  return listArtifacts({ family: 'ExecutionTestrun', cwd: REPO_ROOT, fs: tree.fs });
}
