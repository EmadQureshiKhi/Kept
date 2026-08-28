/**
 * Lane-0 documents and the graph edges, derived from the promises (design §9.1
 * `documents`, §10.3 lanes).
 *
 * The snapshot's `documents` array and its `edges` array are both *functions of
 * the promise list* rather than independent facts, and that is deliberate. The
 * Ledger lanes documents at x=0, promises at x=360, designed tests at x=760 and
 * evidence at x=1080; if any of those nodes were stored rather than derived, an
 * edge could outlive the promise it was built from and the snapshot's endpoint
 * resolution rule (§9.1 rule 4) would fail in the deployed build. Deriving them
 * from one place makes that impossible: every `cites` edge's source is a document
 * this module also emits, and every `designed` edge's target is the `t_` node the
 * schema's own `collectNodeIds` derives with the same {@link designedTestId}.
 *
 * `claimCount` counts the promises citing a file, not the lines in it. A document
 * with three promises is one node with `claimCount: 3`, which is what the Ledger
 * renders on the lane-0 card.
 *
 * Evidence edges are emitted for any promise carrying an `evidencePackId`, and
 * they are the one kind that can fail to resolve — a pack is only a node once it
 * has been copied under `apps/ledger/public/evidence/` and listed in the
 * snapshot's `evidence` array. The snapshot builder filters those and says so,
 * rather than this module guessing which packs are committed; it has no
 * filesystem and should not acquire one.
 */

import type { GraphEdge, PromiseRecord, SnapshotDocument } from 'kept-core';
import { designedTestId, documentId, toPosix } from 'kept-core';

/**
 * The lane-0 document nodes, one per cited file, sorted by id.
 *
 * Sorted by id rather than by path because that is the order the canonical
 * serialiser (§9.2) needs for a byte-stable committed file, and because the id is
 * the only field an edge can point at.
 */
export function deriveDocuments(
  promises: readonly PromiseRecord[],
): readonly SnapshotDocument[] {
  const counts = new Map<string, number>();
  for (const promise of promises) {
    const file = toPosix(promise.citation.file);
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  const documents: SnapshotDocument[] = [];
  for (const [file, claimCount] of counts) {
    documents.push({ id: documentId(file), file, claimCount });
  }
  return documents.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/**
 * Every edge the promise list implies: `cites` from the document to the promise,
 * `designed` from the promise to its `*_test.md` node, `evidence` from the
 * promise to its pack.
 *
 * Returned unsorted and possibly with duplicates. `createPromiseGraph` sorts by
 * `(kind, from, to)` and collapses duplicates, and it is the single authority on
 * that order — restating the comparators here would be the second one.
 */
export function deriveEdges(promises: readonly PromiseRecord[]): readonly GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const promise of promises) {
    edges.push({
      from: documentId(toPosix(promise.citation.file)),
      to: promise.id,
      kind: 'cites',
    });
    if (promise.designedTest !== null) {
      edges.push({
        from: promise.id,
        to: designedTestId(promise.designedTest.path),
        kind: 'designed',
      });
    }
    if (promise.evidencePackId !== null) {
      edges.push({ from: promise.id, to: promise.evidencePackId, kind: 'evidence' });
    }
  }
  return edges;
}
