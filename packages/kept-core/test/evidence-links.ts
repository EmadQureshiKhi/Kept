/**
 * Referential closure of committed evidence — the shared reader
 * (design §15.3, Property 28, R13.4, R13.5).
 *
 * Not a test suite: the filename is outside the runner's `test/**\/*.test.ts`
 * glob, so vitest never collects it, while the root `tsconfig.json` includes
 * `packages/*\/test/**\/*.ts` so `tsc -b` type-checks it under full strict mode.
 * The same precedent `arbitraries.ts`, `verdict-evidence-tree.ts` and
 * `apps/ledger/test/_scan.ts` already set.
 *
 * It exists because two suites need the *same* answer to one question and must
 * not each invent their own:
 *
 *   - `evidence-integrity.test.ts` asks it of the committed tree as it actually
 *     stands (task 15.8).
 *   - `evidence-closure.prop.test.ts` asks it of generated snapshots and
 *     generated trees (task 15.9, Property 28).
 *
 * A judge clicks an artefact link. That link is a plain static URL under
 * `/evidence/`, served by Next out of `apps/ledger/public/evidence/`, so the
 * whole of "does it work" reduces to two directions:
 *
 * **Forward.** Every evidence pack id, every artefact `publicPath` and every
 * `evidenceRef` in the snapshot resolves to a file **committed in the
 * repository**. Committed is the load-bearing word: a file that exists only on
 * the machine that curated it satisfies `existsSync` and returns 404 for a judge
 * who clones, which is the exact failure this closure exists to refuse.
 *
 * **Backward.** Every committed file under the curated directory is referenced by
 * at least one promise, run, review card or amendment. An orphan curated pack is
 * repository weight nothing explains — and worse, it is usually the fossil of a
 * reference that was later cleared, so its presence means the snapshot and the
 * tree disagree about what was proven.
 *
 * Both directions are stated over a `committed` set of repo-relative POSIX paths
 * rather than over a filesystem, which is what lets the property suite supply a
 * generated tree and the integrity suite supply git's own index.
 */

import type { LedgerSnapshot } from '@kept/core';

/** Where curated packs are committed, relative to the repository root. */
export const CURATED_EVIDENCE_DIR = 'apps/ledger/public/evidence';

/**
 * The one committed file under the curated directory that is not an artefact.
 *
 * It explains the directory to a reader who finds it — what fills it, which three
 * artefact kinds are curated and why the rest of a sealed pack is not — so the
 * backward direction excludes it by name rather than by pattern.
 */
export const CURATED_README = `${CURATED_EVIDENCE_DIR}/README.md`;

/** The static URL prefix every artefact link carries (§9.3, R8.4). */
export const PUBLIC_EVIDENCE_PREFIX = '/evidence/';

/**
 * What kind of link this is, because the three resolve differently.
 *
 * `pack` is an identifier or a pack root — satisfied by any committed file
 * beneath it. `artifact` is a `publicPath` naming one file. `ref` is a
 * repo-relative `evidenceRef` naming one file inside a pack.
 */
export type LinkKind = 'pack' | 'artifact' | 'ref';

/** One evidence link, with everything needed to report on it. */
export interface EvidenceLink {
  readonly kind: LinkKind;
  /** Where in the snapshot it was found, e.g. `promises[3].repair.evidenceRef`. */
  readonly where: string;
  /** The value verbatim, exactly as the snapshot spells it. */
  readonly value: string;
  /** The pack the link belongs to, or null when it names none. */
  readonly packId: string | null;
  /**
   * The repo-relative POSIX path it resolves to, or null when it resolves
   * nowhere at all. A trailing `/` means the pack directory, which any committed
   * file beneath satisfies.
   */
  readonly path: string | null;
}

/** A link that fails one of the two directions, with the reason in words. */
export interface LinkFault {
  readonly link: EvidenceLink;
  readonly reason: string;
}

/** A committed file the snapshot does not explain. */
export interface OrphanFile {
  readonly path: string;
  readonly reason: string;
}

/* ─────────────────────────────── resolution ──────────────────────────────── */

/**
 * `/evidence/<packId>/<name>` to `apps/ledger/public/evidence/<packId>/<name>`,
 * or null when the value is not a link into the curated directory at all.
 *
 * Deliberately strict about the prefix. An absolute filesystem path, a Windows
 * drive letter or a URL would each resolve to *something* under a lenient join,
 * and that something would be a file no clone has.
 */
export function publicPathToRepoPath(publicPath: string): string | null {
  if (!publicPath.startsWith(PUBLIC_EVIDENCE_PREFIX)) return null;
  return `${CURATED_EVIDENCE_DIR}/${publicPath.slice(PUBLIC_EVIDENCE_PREFIX.length)}`;
}

/**
 * An `evidenceRef` to the committed file it names.
 *
 * Two spellings are accepted because two are written: the schema's example is
 * `evidence/ev_…/failure.yaml`, relative to the public directory, and a
 * repo-relative spelling naming the committed path in full is the same reference
 * said differently. Anything else resolves to null rather than being joined
 * hopefully onto the curated root.
 */
export function refToRepoPath(ref: string): string | null {
  if (ref.startsWith(`${CURATED_EVIDENCE_DIR}/`)) return ref;
  if (ref.startsWith('evidence/')) return `${CURATED_EVIDENCE_DIR}/${ref.slice('evidence/'.length)}`;
  return null;
}

/** The pack id a committed curated path belongs to, or null. */
export function packIdOfCommittedPath(path: string): string | null {
  if (!path.startsWith(`${CURATED_EVIDENCE_DIR}/`)) return null;
  const rest = path.slice(CURATED_EVIDENCE_DIR.length + 1);
  const cut = rest.indexOf('/');
  if (cut <= 0) return null;
  return rest.slice(0, cut);
}

/**
 * The pack id a reference names, by the same rule the schema uses: the first
 * `ev_`-prefixed path segment.
 *
 * Reimplemented here rather than imported so this module can also read a
 * reference the schema would have rejected — which is what the adversarial cases
 * below are for.
 */
export function packIdOfRef(ref: string): string | null {
  for (const segment of ref.split('/')) {
    if (segment.startsWith('ev_') && segment.length > 3) return segment;
  }
  return null;
}

/* ──────────────────────────── link enumeration ───────────────────────────── */

/**
 * Every evidence link the snapshot carries, from all four surfaces that can hold
 * one: promises, runs, review cards and amendments.
 *
 * The list is exhaustive on purpose. A closure check that read only
 * `promises[].evidencePackId` would pass a snapshot whose `/amendments` page
 * links a file nobody committed, and the amendment page is the one a reviewer
 * reaches from a repair.
 */
export function evidenceLinks(snapshot: LedgerSnapshot): EvidenceLink[] {
  const links: EvidenceLink[] = [];

  const pack = (where: string, packId: string): void => {
    links.push({
      kind: 'pack',
      where,
      value: packId,
      packId,
      path: `${CURATED_EVIDENCE_DIR}/${packId}/`,
    });
  };
  const artifact = (where: string, publicPath: string, packId: string | null): void => {
    links.push({
      kind: 'artifact',
      where,
      value: publicPath,
      packId,
      path: publicPathToRepoPath(publicPath),
    });
  };
  const ref = (where: string, value: string): void => {
    links.push({
      kind: 'ref',
      where,
      value,
      packId: packIdOfRef(value),
      path: refToRepoPath(value),
    });
  };

  snapshot.evidence.forEach((entry, index) => {
    pack(`evidence[${index}].id`, entry.id);
    artifact(`evidence[${index}].publicPath`, entry.publicPath, entry.id);
    entry.artifacts.forEach((art, artIndex) => {
      artifact(`evidence[${index}].artifacts[${artIndex}].publicPath`, art.publicPath, entry.id);
    });
  });

  snapshot.promises.forEach((promise, index) => {
    if (promise.evidencePackId !== null) {
      pack(`promises[${index}].evidencePackId`, promise.evidencePackId);
    }
    const repairRef = promise.repair?.evidenceRef ?? null;
    if (repairRef !== null) ref(`promises[${index}].repair.evidenceRef`, repairRef);
  });

  snapshot.runs.forEach((run, index) => {
    if (run.evidencePackId !== null) pack(`runs[${index}].evidencePackId`, run.evidencePackId);
  });

  snapshot.reviewCards.forEach((card, index) => {
    if (card.evidenceRef !== null) ref(`reviewCards[${index}].evidenceRef`, card.evidenceRef);
  });

  snapshot.amendments.forEach((amendment, index) => {
    if (amendment.evidenceRef !== null) ref(`amendments[${index}].evidenceRef`, amendment.evidenceRef);
    for (const label of Object.keys(amendment.artifacts).sort()) {
      const publicPath = amendment.artifacts[label];
      if (publicPath === undefined) continue;
      artifact(`amendments[${index}].artifacts.${label}`, publicPath, packIdOfRef(publicPath));
    }
  });

  return links;
}

/** Every pack id anything in the snapshot references, packs themselves included. */
export function referencedPackIds(snapshot: LedgerSnapshot): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const link of evidenceLinks(snapshot)) {
    if (link.packId !== null) ids.add(link.packId);
  }
  return ids;
}

/**
 * Pack ids referenced by a promise, a run, a review card or an amendment — that
 * is, by something a reader can *read*, rather than by the `evidence` array's own
 * inventory of itself.
 *
 * The backward direction is stated against this narrower set on purpose. A pack
 * listed in `evidence` and referenced by nothing is still an orphan: it is a
 * directory of images with no verdict, repair or run attached to explain what
 * they show.
 */
export function readerReferencedPackIds(snapshot: LedgerSnapshot): ReadonlySet<string> {
  const ids = new Set<string>();
  const add = (id: string | null): void => {
    if (id !== null && id.length > 0) ids.add(id);
  };
  for (const promise of snapshot.promises) {
    add(promise.evidencePackId);
    const repairRef = promise.repair?.evidenceRef ?? null;
    if (repairRef !== null) add(packIdOfRef(repairRef));
  }
  for (const run of snapshot.runs) add(run.evidencePackId);
  for (const card of snapshot.reviewCards) {
    if (card.evidenceRef !== null) add(packIdOfRef(card.evidenceRef));
  }
  for (const amendment of snapshot.amendments) {
    if (amendment.evidenceRef !== null) add(packIdOfRef(amendment.evidenceRef));
    for (const publicPath of Object.values(amendment.artifacts)) add(packIdOfRef(publicPath));
  }
  return ids;
}

/* ───────────────────────── the two adversarial rules ─────────────────────── */

/**
 * Why this link value could never be a safe committed path, or null when it
 * could.
 *
 * Two shapes are refused, and both are the schema's own concern rather than an
 * invention here: an **absolute filesystem path**, which is what
 * `kane/evidence.ts` returns and what the snapshot writer must rewrite, and a
 * `..` segment or a backslash, which is how an unpacked archive entry escapes the
 * directory it was supposed to land in. A `publicPath` carrying either would be a
 * link that either 404s or points outside the tree a judge cloned.
 */
export function unsafeLinkReason(link: EvidenceLink): string | null {
  const value = link.value;
  if (value.length === 0) return 'is empty';
  if (value.includes('\\')) return 'contains a backslash, so it is not a POSIX path';
  if (value.split('/').includes('..')) return "contains a '..' segment, which escapes the tree";
  if (/^[A-Za-z]:/.test(value)) return 'starts with a drive letter, so it is a filesystem path';
  if (link.kind === 'artifact') {
    if (!value.startsWith(PUBLIC_EVIDENCE_PREFIX)) {
      return `is not a static URL under ${PUBLIC_EVIDENCE_PREFIX}`;
    }
  } else if (link.kind === 'ref' && value.startsWith('/')) {
    return 'is absolute, so it names a path on the machine that wrote it';
  }
  return null;
}

/** Every link whose value could not be a safe committed path. */
export function unsafeLinks(links: readonly EvidenceLink[]): LinkFault[] {
  const faults: LinkFault[] = [];
  for (const link of links) {
    const reason = unsafeLinkReason(link);
    if (reason !== null) faults.push({ link, reason });
  }
  return faults;
}

/* ───────────────────────────── forward direction ─────────────────────────── */

/**
 * Every link that does not resolve to a committed file.
 *
 * `committed` is a set of repo-relative POSIX paths — git's index in the
 * integrity suite, a generated tree in the property suite. A pack link is
 * satisfied by any committed file beneath its directory; an artefact or a
 * reference must name a committed file exactly.
 */
export function danglingLinks(
  links: readonly EvidenceLink[],
  committed: ReadonlySet<string>,
): LinkFault[] {
  const faults: LinkFault[] = [];
  const paths = [...committed];
  for (const link of links) {
    if (unsafeLinkReason(link) !== null) continue; // reported by the other rule
    if (link.path === null) {
      faults.push({ link, reason: 'resolves to no path under the curated directory' });
      continue;
    }
    if (link.path.endsWith('/')) {
      const prefix = link.path;
      if (!paths.some((path) => path.startsWith(prefix))) {
        faults.push({ link, reason: `no committed file lives under ${prefix}` });
      }
      continue;
    }
    if (!committed.has(link.path)) {
      faults.push({ link, reason: `${link.path} is not committed in the repository` });
    }
  }
  return faults;
}

/* ──────────────────────────── backward direction ─────────────────────────── */

/**
 * Every committed file under the curated directory that the snapshot does not
 * explain, with the reason it is unexplained.
 *
 * Three ways to be an orphan, and they are different bugs. The pack is in no
 * reference a reader can reach — the fossil case, a directory left behind after
 * the snapshot cleared the reference. The pack is not in the `evidence` array at
 * all, so nothing describes its artefacts. Or the file is in a described pack but
 * no artefact entry names it, so nothing links it and it is bytes for their own
 * sake.
 */
export function orphanCommittedFiles(
  committed: ReadonlySet<string>,
  snapshot: LedgerSnapshot,
): OrphanFile[] {
  const described = new Set(snapshot.evidence.map((entry) => entry.id));
  const readable = readerReferencedPackIds(snapshot);
  const named = new Set(
    evidenceLinks(snapshot)
      .filter((link) => link.kind === 'artifact' && link.path !== null && !link.path.endsWith('/'))
      .map((link) => link.path as string),
  );

  const orphans: OrphanFile[] = [];
  for (const path of [...committed].sort()) {
    if (!path.startsWith(`${CURATED_EVIDENCE_DIR}/`)) continue;
    if (path === CURATED_README) continue;
    const packId = packIdOfCommittedPath(path);
    if (packId === null) {
      orphans.push({ path, reason: 'sits directly in the curated directory, inside no pack' });
      continue;
    }
    if (!described.has(packId)) {
      orphans.push({ path, reason: `pack '${packId}' is not an entry in the snapshot's evidence` });
      continue;
    }
    if (!readable.has(packId)) {
      orphans.push({
        path,
        reason: `pack '${packId}' is referenced by no promise, run, review card or amendment`,
      });
      continue;
    }
    if (!named.has(path)) {
      orphans.push({ path, reason: `pack '${packId}' lists no artefact naming this file` });
    }
  }
  return orphans;
}

/* ─────────────────────────────── reporting ───────────────────────────────── */

export function formatFaults(faults: readonly LinkFault[]): string {
  return faults
    .map((fault) => `${fault.link.where}  '${fault.link.value}'\n    ${fault.reason}`)
    .join('\n');
}

export function formatOrphans(orphans: readonly OrphanFile[]): string {
  return orphans.map((orphan) => `${orphan.path}\n    ${orphan.reason}`).join('\n');
}
