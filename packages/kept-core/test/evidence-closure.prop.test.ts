import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isLedgerSnapshot, parseSnapshot, serialiseSnapshot } from 'kept-core';

import {
  CURATED_EVIDENCE_DIR,
  arbClosureCase,
  curatedTreeFor,
  readerPackIds,
  withoutPack,
  type ClosureCase,
  type ClosureLabel,
} from './arbitraries.js';
import {
  danglingLinks,
  evidenceLinks,
  formatFaults,
  formatOrphans,
  orphanCommittedFiles,
  packIdOfCommittedPath,
  readerReferencedPackIds,
  unsafeLinks,
} from './evidence-links.js';

/**
 * Feature: kept, Property 28: Committed evidence and the snapshot are
 * referentially closed (design §Correctness Properties, §15.3).
 *
 * *For any* committed snapshot, every evidence pack identifier, artefact public
 * path and repair evidence reference resolves to a file committed in the
 * repository, and every committed curated pack is referenced by at least one
 * promise, run or amendment.
 *
 * Two directions, and they fail differently. Forward failure is a link a judge
 * clicks and gets a 404 from — the single most damaging thing this repository can
 * ship, because it turns a ledger of proof into a ledger of claims. Backward
 * failure is quieter: a committed pack nothing references is repository weight
 * nothing explains, and it is usually the fossil of a reference that was cleared
 * later, which means the tree and the snapshot no longer agree about what was
 * proven. A closure check that asserted only the forward direction would call that
 * healthy.
 *
 * The property is asserted over a **snapshot and a committed tree generated
 * together**, because closure is a statement about two artefacts agreeing and
 * generating one while assuming the other proves nothing. `arbClosureCase` weights
 * the five cases the plan names — the empty graph, an absent pack whose reference
 * must be cleared rather than dangled, a pack referenced by two promises, a
 * `repair.evidenceRef` pointing into a pack, and an orphan pack — and the last
 * describe block asserts each is actually reached, because a case a generator
 * could in principle produce once in a million draws is not covered.
 *
 * `evidence-integrity.test.ts` asks the same two questions of the committed tree as
 * it actually stands (task 15.8). This file asks them of every tree the pipeline
 * could produce. Both call the same reader, so neither can drift into its own
 * private idea of what resolving means.
 *
 * **Validates: Requirements 13.4, 13.5**
 */

/** Design's testing-strategy floor is 100 runs; stated so it cannot regress. */
const NUM_RUNS = 500;

/** The committed tree as a set, which is the form the closure reader takes. */
function committedSet(kase: ClosureCase): ReadonlySet<string> {
  return new Set(kase.committed);
}

describe('Feature: kept, Property 28: Committed evidence and the snapshot are referentially closed', () => {
  it('resolves every pack id, artefact publicPath and evidenceRef to a committed file', () => {
    fc.assert(
      fc.property(arbClosureCase, (kase) => {
        // Not vacuous: every generated snapshot is one the schema accepts, so the
        // property is stated over snapshots that could actually be committed.
        expect(isLedgerSnapshot(kase.snapshot)).toBe(true);
        expect(parseSnapshot(serialiseSnapshot(kase.snapshot))).toStrictEqual(kase.snapshot);

        const links = evidenceLinks(kase.snapshot);
        const faults = danglingLinks(links, committedSet(kase));
        expect(
          faults.length === 0 ? '' : `${kase.label}:\n${formatFaults(faults)}`,
          'a link the snapshot publishes must name a file a clone has',
        ).toBe('');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('leaves no committed curated file the snapshot cannot explain', () => {
    fc.assert(
      fc.property(arbClosureCase, (kase) => {
        const orphans = orphanCommittedFiles(committedSet(kase), kase.snapshot);
        const reported = [
          ...new Set(
            orphans
              .map((orphan) => packIdOfCommittedPath(orphan.path))
              .filter((id): id is string => id !== null),
          ),
        ].sort();
        expect(
          reported,
          orphans.length === 0
            ? ''
            : `${kase.label} reported unexpected orphans:\n${formatOrphans(orphans)}`,
        ).toEqual([...kase.orphanPackIds].sort());
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('publishes no absolute filesystem path, no `..` segment and no backslash', () => {
    fc.assert(
      fc.property(arbClosureCase, (kase) => {
        const faults = unsafeLinks(evidenceLinks(kase.snapshot));
        expect(faults.length === 0 ? '' : formatFaults(faults)).toBe('');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('clears the reference to an absent pack rather than leaving it dangling', () => {
    fc.assert(
      fc.property(
        arbClosureCase.filter((kase) => kase.clearedPackId !== null),
        (kase) => {
          const packId = kase.clearedPackId ?? '';
          // Nothing anywhere still names it: not a promise, not a repair, not an
          // edge, not the evidence array, not the committed tree.
          expect(kase.snapshot.evidence.map((pack) => pack.id)).not.toContain(packId);
          expect(readerPackIds(kase.snapshot).has(packId)).toBe(false);
          for (const promise of kase.snapshot.promises) {
            expect(promise.evidencePackId).not.toBe(packId);
            expect(promise.repair?.evidenceRef ?? '').not.toContain(packId);
          }
          for (const edge of kase.snapshot.edges) {
            expect(edge.from).not.toBe(packId);
            expect(edge.to).not.toBe(packId);
          }
          expect(kase.committed.some((path) => path.includes(`/${packId}/`))).toBe(false);
          // And a cleared reference is still a valid snapshot: honesty costs
          // nothing at the schema.
          expect(isLedgerSnapshot(kase.snapshot)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('agrees with the generator about which packs a reader can reach', () => {
    // The generator implements the reference set independently of the checker, so
    // this is the assertion that stops the two agreeing by construction — and
    // stops a bug in either from making the closure property vacuous.
    fc.assert(
      fc.property(arbClosureCase, (kase) => {
        expect([...readerReferencedPackIds(kase.snapshot)].sort()).toEqual(
          [...readerPackIds(kase.snapshot)].sort(),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Property 28: closure is broken by exactly the two things that break it', () => {
  it('reports a dangling link the moment a committed artefact is removed', () => {
    fc.assert(
      fc.property(arbClosureCase, (kase) => {
        const artefacts = kase.committed.filter(
          (path) => path.startsWith(`${CURATED_EVIDENCE_DIR}/`) && !path.endsWith('README.md'),
        );
        // Nothing to remove in the empty-tree cases, and no claim to make there.
        fc.pre(artefacts.length > 0);
        const dropped = artefacts[0] ?? '';
        const thinner = new Set(kase.committed.filter((path) => path !== dropped));
        const faults = danglingLinks(evidenceLinks(kase.snapshot), thinner);
        // The orphan arm's extra file belongs to no link, so removing it dangles
        // nothing — every other case must notice immediately.
        if (packIdOfCommittedPath(dropped) !== kase.orphanPackIds[0]) {
          expect(faults.length).toBeGreaterThan(0);
          expect(formatFaults(faults)).toContain(dropped);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reports an orphan the moment a described pack stops being referenced', () => {
    fc.assert(
      fc.property(
        arbClosureCase.filter(
          (kase) => kase.orphanPackIds.length === 0 && kase.snapshot.evidence.length > 0,
        ),
        (kase) => {
          const packId = kase.snapshot.evidence[0]?.id ?? '';
          // The tree keeps the pack; the snapshot forgets it. That is exactly the
          // fossil an orphan check exists to find.
          const forgotten = withoutPack(kase.snapshot, packId);
          const orphans = orphanCommittedFiles(committedSet(kase), forgotten);
          expect(orphans.length).toBeGreaterThan(0);
          expect(formatOrphans(orphans)).toContain(packId);
          // The forward direction stays clean: forgetting a pack removes links,
          // it does not dangle them.
          expect(danglingLinks(evidenceLinks(forgotten), committedSet(kase))).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('reports a pack whose curated files were never committed', () => {
    fc.assert(
      fc.property(
        arbClosureCase.filter((kase) => kase.snapshot.evidence.length > 0),
        (kase) => {
          // The snapshot as generated, against a tree holding only the README:
          // the state a machine reaches when it curates and forgets to commit.
          const faults = danglingLinks(
            evidenceLinks(kase.snapshot),
            new Set([`${CURATED_EVIDENCE_DIR}/README.md`]),
          );
          expect(faults.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('Property 28: every named case is actually reached', () => {
  const CASES: readonly ClosureLabel[] = [
    'closed',
    'empty-graph',
    'pack-absent',
    'shared-pack',
    'repair-ref',
    'orphan-pack',
  ];

  const sampled = fc.sample(arbClosureCase, { numRuns: 400, seed: 28 });

  for (const label of CASES) {
    it(`draws the ${label} case`, () => {
      expect(
        sampled.filter((kase) => kase.label === label).length,
        `${label} was never generated, so the clauses that depend on it are vacuous`,
      ).toBeGreaterThan(0);
    });
  }

  it('draws an empty tree and a full one, so neither state is assumed', () => {
    const artefactsOf = (kase: ClosureCase): number =>
      kase.committed.filter((path) => !path.endsWith('README.md')).length;
    expect(sampled.some((kase) => artefactsOf(kase) === 0)).toBe(true);
    expect(sampled.some((kase) => artefactsOf(kase) > 1)).toBe(true);
  });

  it('draws a pack two promises share, and a repair reference into a pack', () => {
    const shared = sampled.filter((kase) => {
      const counted = new Map<string, number>();
      for (const promise of kase.snapshot.promises) {
        if (promise.evidencePackId === null) continue;
        counted.set(promise.evidencePackId, (counted.get(promise.evidencePackId) ?? 0) + 1);
      }
      return [...counted.values()].some((count) => count >= 2);
    });
    expect(shared.length).toBeGreaterThan(0);

    const withRef = sampled.filter((kase) =>
      kase.snapshot.promises.some((promise) => (promise.repair?.evidenceRef ?? null) !== null),
    );
    expect(withRef.length).toBeGreaterThan(0);
  });

  it('generates the tree curation would write, for every case but the orphan one', () => {
    for (const kase of sampled) {
      if (kase.label === 'orphan-pack') continue;
      expect(kase.committed).toEqual(curatedTreeFor(kase.snapshot));
    }
  });
});
