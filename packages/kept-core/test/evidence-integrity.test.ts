import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SNAPSHOT_SCHEMA_VERSION, parseSnapshot, type LedgerSnapshot } from 'kept-core';
import { describe, expect, it } from 'vitest';

import {
  CURATED_EVIDENCE_DIR,
  CURATED_README,
  danglingLinks,
  evidenceLinks,
  formatFaults,
  formatOrphans,
  orphanCommittedFiles,
  packIdOfCommittedPath,
  packIdOfRef,
  packIdOfSealedRef,
  publicPathToRepoPath,
  refToRepoPath,
  unsafeLinks,
  type EvidenceLink,
} from './evidence-links.js';

/**
 * Referential integrity of the committed evidence and the committed snapshot
 * (task 15.8, R13.4, R13.5, design §15.3).
 *
 * A dangling evidence link is the one broken thing a judge will click. Every
 * other guard in this repository protects something a reviewer has to be told to
 * look for; this one protects the thing they reach for unprompted, and it fails
 * in the least recoverable way — a 404 in a deployed Ledger that claims to be a
 * ledger of proof.
 *
 * So both directions are asserted, over the tree as it actually stands:
 *
 * **Forward.** Every `evidence[].id`, every artefact `publicPath` and every
 * `evidenceRef` in `apps/ledger/data/ledger.snapshot.json` resolves to a file
 * **committed in the repository**. Committed, not present: an uncommitted file
 * satisfies `existsSync` on the machine that curated it and 404s for the judge who
 * clones, so the check is against git's own index — see {@link committedPaths} —
 * *and* against the disk, because a path tracked in the index but deleted from the
 * working tree is equally missing from a fresh checkout.
 *
 * **Backward.** Every committed file under `apps/ledger/public/evidence/`, the
 * `README.md` aside, is referenced by at least one promise, run, review card or
 * amendment. An orphan curated pack is repository weight nothing explains, and it
 * is usually the fossil of a reference that was cleared later — so its presence
 * means the tree and the snapshot disagree about what was proven.
 *
 * ## Where the zero-file guard goes, and why it is not on the packs
 *
 * Every source scan in this repository throws when it scans nothing, because a
 * renamed directory turns a guard into a silently green no-op. That rule needs
 * care here, because **an empty curated directory is a legitimate state**:
 * curation is driven by references, and a graph whose promises carry no
 * `evidencePackId` curates nothing at all. `buildSnapshot` clears a reference
 * whose pack is absent rather than publishing a dead link, which is precisely why
 * a snapshot with `evidence: []` is honest rather than broken.
 *
 * So the guard is on **the snapshot and the index**, the two things that can never
 * legitimately be empty: the committed snapshot must exist, be tracked and parse
 * through the schema authority, and git must report a non-empty set of tracked
 * files. The **pack count is deliberately unguarded** — asserting one pack exists
 * would break the build on the day the loop has not run, and asserting none exists
 * would break it the moment the loop does. What is asserted instead is the
 * invariant that holds in both worlds: whatever the snapshot links is committed,
 * and whatever is committed is linked.
 */

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const SNAPSHOT_PATH = 'apps/ledger/data/ledger.snapshot.json';

/**
 * Every path git tracks, repo-relative and forward-slashed.
 *
 * `git ls-files` reads the **index**, which is the honest definition of "will a
 * clone have this file" at the moment a commit is being assembled: `kept snapshot`
 * writes the curated packs and the snapshot together, and they are staged
 * together, so a check against `HEAD` would fail during the very commit that lands
 * them while a check against the working tree would pass for a file nobody ever
 * added. The index is the seam where the two agree.
 */
function committedPaths(): ReadonlySet<string> {
  const stdout = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const paths = stdout.split('\0').filter((path) => path.length > 0);
  if (paths.length === 0) {
    throw new Error(
      `git tracks no file under ${REPO_ROOT}. Referential integrity is stated against ` +
        `the index, so an empty index would let this whole guard pass by resolving ` +
        `nothing — which is the one outcome worse than a dangling link.`,
    );
  }
  return new Set(paths.map((path) => path.split('\\').join('/')));
}

const COMMITTED = committedPaths();

/** The committed snapshot, read through the schema authority rather than JSON. */
function committedSnapshot(): LedgerSnapshot {
  const absolute = resolve(REPO_ROOT, SNAPSHOT_PATH);
  if (!existsSync(absolute)) {
    throw new Error(
      `${SNAPSHOT_PATH} does not exist, so there is no snapshot to check the committed ` +
        `evidence against and this guard would pass by reading nothing.`,
    );
  }
  if (!COMMITTED.has(SNAPSHOT_PATH)) {
    throw new Error(
      `${SNAPSHOT_PATH} is not tracked by git. The Ledger imports it at build time, so an ` +
        `untracked snapshot is a Ledger that does not build for anybody but its author.`,
    );
  }
  return parseSnapshot(readFileSync(absolute, 'utf8'));
}

const SNAPSHOT = committedSnapshot();
const LINKS = evidenceLinks(SNAPSHOT);

/** The committed files under the curated directory, `README.md` included. */
const CURATED_COMMITTED = [...COMMITTED]
  .filter((path) => path.startsWith(`${CURATED_EVIDENCE_DIR}/`))
  .sort();

/**
 * A synthetic link, so each rule can be proven to fire without breaking the real
 * tree to do it. Resolution is the module's own, never a second copy of it.
 */
function link(kind: EvidenceLink['kind'], value: string, where = 'planted'): EvidenceLink {
  const path =
    kind === 'pack'
      ? `${CURATED_EVIDENCE_DIR}/${value}/`
      : kind === 'artifact'
        ? publicPathToRepoPath(value)
        : refToRepoPath(value);
  return { kind, where, value, packId: kind === 'pack' ? value : packIdOfRef(value), path };
}

/* ─────────────────────────── meta: not a no-op ───────────────────────────── */

describe('the evidence integrity check is reading something', () => {
  it('read the committed snapshot through the schema, from git-tracked bytes', () => {
    expect(COMMITTED.has(SNAPSHOT_PATH)).toBe(true);
    expect(SNAPSHOT.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    // The snapshot always has promises to link from, whatever the evidence state.
    expect(SNAPSHOT.promises.length).toBeGreaterThan(0);
  });

  it('read a plausible index, including the files a judge clones', () => {
    expect(COMMITTED.size).toBeGreaterThan(50);
    for (const anchor of [
      SNAPSHOT_PATH,
      CURATED_README,
      'apps/ledger/lib/snapshot.ts',
      'packages/kept-cli/src/commands/snapshot.ts',
    ]) {
      expect(COMMITTED.has(anchor), `${anchor} is not tracked — has the tree moved?`).toBe(true);
    }
  });

  it('tolerates a curated directory that is legitimately empty of packs', () => {
    // Curation is reference-driven: a graph carrying no evidencePackId curates
    // nothing, and `buildSnapshot` clears an unresolvable reference rather than
    // publishing a dead link. So the pack count is an observation, never an
    // assertion — the invariants below hold in both worlds.
    const packFiles = CURATED_COMMITTED.filter((path) => path !== CURATED_README);
    expect(packFiles.length).toBeGreaterThanOrEqual(0);
    expect(SNAPSHOT.evidence.length).toBeGreaterThanOrEqual(0);
    // Whatever the count, the two sides agree about whether there is anything.
    if (SNAPSHOT.evidence.length > 0) expect(packFiles.length).toBeGreaterThan(0);
  });
});

/* ───────────────────────── forward: nothing dangles ──────────────────────── */

describe('every evidence link in the committed snapshot resolves to a committed file', () => {
  it('resolves every pack id, artefact publicPath and evidenceRef (R13.4, R13.5)', () => {
    const faults = danglingLinks(LINKS, COMMITTED);
    expect(
      faults,
      faults.length === 0
        ? ''
        : `a judge clicks these links and gets a 404. Either commit the curated pack or ` +
          `let 'kept snapshot' clear the reference — a cleared reference is honest, a ` +
          `dangling one is not.\n\n${formatFaults(faults)}`,
    ).toEqual([]);
  });

  it('finds every resolved artefact on disk as well as in the index', () => {
    const missing = LINKS.filter(
      (entry) =>
        entry.kind !== 'pack' &&
        entry.path !== null &&
        COMMITTED.has(entry.path) &&
        !existsSync(resolve(REPO_ROOT, entry.path)),
    );
    expect(
      missing.map((entry) => entry.path),
      'tracked in the index but absent from the working tree, so a fresh checkout has ' +
        'a file this one does not',
    ).toEqual([]);
  });

  it('links no absolute filesystem path, no `..` segment and no backslash', () => {
    // The two adversarial shapes the schema's own publicPath rule exists for:
    // `kane/evidence.ts` returns absolute paths, and an unpacked archive entry
    // is the classic way a `..` escapes the directory it was meant to land in.
    const faults = unsafeLinks(LINKS);
    expect(
      faults,
      faults.length === 0 ? '' : formatFaults(faults),
    ).toEqual([]);
  });

  it('spells every artefact link as a static URL under /evidence/', () => {
    for (const pack of SNAPSHOT.evidence) {
      expect(pack.publicPath).toBe(`/evidence/${pack.id}/`);
      for (const artifact of pack.artifacts) {
        expect(artifact.publicPath).toBe(`/evidence/${pack.id}/${artifact.name}`);
      }
    }
  });
});

/* ────────────────────── backward: nothing is unexplained ─────────────────── */

describe('every committed curated file is referenced by the snapshot', () => {
  it('leaves no orphan pack in the repository (R13.4)', () => {
    const orphans = orphanCommittedFiles(COMMITTED, SNAPSHOT);
    expect(
      orphans,
      orphans.length === 0
        ? ''
        : `these files are committed under ${CURATED_EVIDENCE_DIR}/ and nothing in the ` +
          `snapshot explains them. An orphan pack is usually the fossil of a reference ` +
          `that was cleared later, so the tree and the snapshot now disagree about what ` +
          `was proven.\n\n${formatOrphans(orphans)}`,
    ).toEqual([]);
  });

  it('keeps the directory explained by a committed README rather than by nothing', () => {
    expect(COMMITTED.has(CURATED_README)).toBe(true);
    const readme = readFileSync(resolve(REPO_ROOT, CURATED_README), 'utf8');
    expect(readme).toContain('kept snapshot');
    expect(readme).toContain('R13.4');
  });

  it('commits the curated directory and ignores the sealed archives', () => {
    const ignore = readFileSync(resolve(REPO_ROOT, '.gitignore'), 'utf8');
    expect(ignore).toMatch(/^!apps\/ledger\/public\/evidence\/$/m);
    expect(ignore).toMatch(/^\.testmuai\/evidence\/$/m);
    // The sealed packs are one to three megabytes each and must stay out.
    expect([...COMMITTED].some((path) => path.endsWith('.evidence'))).toBe(false);
  });

  it('places every committed curated file inside a pack directory', () => {
    for (const path of CURATED_COMMITTED) {
      if (path === CURATED_README) continue;
      expect(
        packIdOfCommittedPath(path),
        `${path} sits in no pack directory, so no publicPath can name it`,
      ).not.toBeNull();
    }
  });
});

/* ──────────────── the same rules over a directory that is full ───────────── */

describe('the same rules pass over a curated directory that is full', () => {
  /**
   * The committed tree fills the first time a verification run seals a pack the
   * graph records, and the parallel closed loop can land one at any moment. A
   * guard that only holds while the directory is empty would be worthless, so the
   * full case is exercised here against the **same** functions the real tree is
   * checked with — the snapshot is the committed one with a pack grafted on, and
   * the committed set is the real index with that pack's files added.
   */
  const PACK = 'ev_20260821T0736Z';
  const NAMES = [
    'tests/cart-discount-27eaa1da/steps/8-2-3/annotated.png',
    'tests/cart-discount-27eaa1da/steps/8-2-3/screenshot.jpg',
  ] as const;

  const full: LedgerSnapshot = parseSnapshot(
    JSON.stringify({
      ...SNAPSHOT,
      evidence: [
        ...SNAPSHOT.evidence,
        {
          id: PACK,
          kind: 'run',
          sealedAt: null,
          publicPath: `/evidence/${PACK}/`,
          artifacts: [
            { kind: 'annotated', name: NAMES[0], publicPath: `/evidence/${PACK}/${NAMES[0]}`, bytes: 17 },
            { kind: 'screenshot', name: NAMES[1], publicPath: `/evidence/${PACK}/${NAMES[1]}`, bytes: 11 },
          ],
        },
      ].sort((left, right) => (left.id < right.id ? -1 : 1)),
      promises: SNAPSHOT.promises.map((promise, index) =>
        index === 0
          ? {
              ...promise,
              evidencePackId: PACK,
              repair:
                promise.repair === null
                  ? null
                  : { ...promise.repair, evidenceRef: `evidence/${PACK}/${NAMES[0]}` },
            }
          : promise,
      ),
    }),
  );

  const committed: ReadonlySet<string> = new Set([
    ...COMMITTED,
    ...NAMES.map((name) => `${CURATED_EVIDENCE_DIR}/${PACK}/${name}`),
  ]);

  it('resolves every link of a committed pack, and reports no orphan', () => {
    const links = evidenceLinks(full);
    expect(links.length).toBeGreaterThan(LINKS.length);
    expect(unsafeLinks(links)).toEqual([]);
    expect(formatFaults(danglingLinks(links, committed))).toBe('');
    expect(formatOrphans(orphanCommittedFiles(committed, full))).toBe('');
  });

  it('still reports the pack as dangling when its files were never committed', () => {
    const faults = danglingLinks(evidenceLinks(full), COMMITTED);
    expect(faults.length).toBeGreaterThan(0);
    expect(formatFaults(faults)).toContain(PACK);
  });

  it('still reports the pack as an orphan when the snapshot stops referencing it', () => {
    const orphans = orphanCommittedFiles(committed, SNAPSHOT);
    expect(orphans.map((entry) => entry.path).sort()).toEqual(
      NAMES.map((name) => `${CURATED_EVIDENCE_DIR}/${PACK}/${name}`).sort(),
    );
  });
});

/* ─────────────────────── each direction is proven to fire ────────────────── */

describe('the integrity rules are proven to fire on a broken tree', () => {
  const COMMITTED_FIXTURE: ReadonlySet<string> = new Set([
    `${CURATED_EVIDENCE_DIR}/ev_present/steps/1-0-1/screenshot.jpg`,
  ]);

  it('reports an artefact publicPath naming a file nobody committed', () => {
    const faults = danglingLinks(
      [link('artifact', '/evidence/ev_present/steps/1-0-1/annotated.png')],
      COMMITTED_FIXTURE,
    );
    expect(faults).toHaveLength(1);
    expect(faults[0]?.reason).toContain('is not committed');
  });

  it('reports a pack id with no committed file beneath it', () => {
    const faults = danglingLinks([link('pack', 'ev_absent')], COMMITTED_FIXTURE);
    expect(faults).toHaveLength(1);
    expect(faults[0]?.reason).toContain('no committed file lives under');
  });

  it('reports a repair evidenceRef pointing into an uncommitted pack', () => {
    const faults = danglingLinks(
      [link('ref', 'evidence/ev_absent/failure.yaml')],
      COMMITTED_FIXTURE,
    );
    expect(faults).toHaveLength(1);
  });

  it('accepts the reference spellings that do resolve', () => {
    expect(
      danglingLinks(
        [
          link('artifact', '/evidence/ev_present/steps/1-0-1/screenshot.jpg'),
          link('ref', 'evidence/ev_present/steps/1-0-1/screenshot.jpg'),
          link('ref', `${CURATED_EVIDENCE_DIR}/ev_present/steps/1-0-1/screenshot.jpg`),
          link('pack', 'ev_present'),
        ],
        COMMITTED_FIXTURE,
      ),
    ).toEqual([]);
  });

  it('reports an absolute filesystem path, a `..` escape and a backslash', () => {
    const planted = [
      link('artifact', '/Users/someone/KEPT/.testmuai/evidence/annotated.png'),
      link('artifact', '/evidence/ev_present/../../../etc/passwd'),
      link('artifact', '/evidence/ev_present\\steps\\annotated.png'),
      link('ref', '/evidence/ev_present/failure.yaml'),
    ];
    const faults = unsafeLinks(planted);
    expect(faults).toHaveLength(planted.length);
    expect(faults.map((fault) => fault.reason).join('\n')).toMatch(/static URL|\.\.|backslash|absolute/);
  });

  it('reports an orphan pack, and says which of the three ways it is orphaned', () => {
    const orphan = `${CURATED_EVIDENCE_DIR}/ev_fossil/steps/1-0-1/screenshot.jpg`;
    const orphans = orphanCommittedFiles(new Set([CURATED_README, orphan]), SNAPSHOT);
    expect(orphans.map((entry) => entry.path)).toEqual([orphan]);
    expect(orphans[0]?.reason).toContain('ev_fossil');
  });

  it('never reports the README as an orphan, whatever the snapshot says', () => {
    expect(orphanCommittedFiles(new Set([CURATED_README]), SNAPSHOT)).toEqual([]);
  });

  it('refuses to resolve a link that names nothing under the curated directory', () => {
    expect(publicPathToRepoPath('/promises/p_000000000000')).toBeNull();
    // Not an evidence reference at all: no `evidence/` prefix and no sealed suffix.
    expect(refToRepoPath('.testmuai/tests/whatever.md')).toBeNull();
    expect(refToRepoPath('apps/fixture/README.md')).toBeNull();
  });

  it('resolves a sealed-archive reference to the curated copy of that pack', () => {
    // The router writes the archive Kane sealed, under the gitignored
    // `.testmuai/evidence/` — deliberate provenance, because that is where the
    // triage note which decided the branch actually lives (R6.11). What has to
    // resolve for a judge is the *curated* copy, named by the minted node id. This
    // rule said "resolves nowhere" for every real `evidenceRef`, so the first run
    // that produced one failed the guard on a pack that was correctly committed.
    expect(refToRepoPath('.testmuai/evidence/73c1df17.evidence')).toBe(
      `${CURATED_EVIDENCE_DIR}/ev_73c1df17.evidence/`,
    );
    expect(packIdOfSealedRef('.testmuai/evidence/73c1df17.evidence')).toBe(
      'ev_73c1df17.evidence',
    );
    // And it is still the curated directory it maps into, never the sealed one.
    expect(refToRepoPath('.testmuai/evidence/73c1df17.evidence')).toContain(
      CURATED_EVIDENCE_DIR,
    );
  });
});
