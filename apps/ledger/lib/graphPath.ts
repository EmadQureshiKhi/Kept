/**
 * The path through the graph that belongs to one promise. Design §10.2, §10.3, R8.1.
 *
 * The canvas draws four lanes and thirty-five lines across them, and nothing in the static
 * picture says which lines belong together. A reader looking at the `red` promise cannot
 * tell, without clicking, which document it was read from, which designed test would prove
 * it, or whether any evidence was sealed for it. The lines are all the same ink and they
 * cross.
 *
 * This module answers that as arithmetic: given a promise, which nodes and which edges are
 * its path. `PromiseGraph` uses the answer to light that path and dim the rest, so the
 * relationship is visible without a click. Pure and DOM-free, so it is checked under the
 * repository's no-DOM `lib` program and provable over any schema-valid snapshot rather than
 * over one rendered tree.
 *
 * ## One hop, and that is not a simplification
 *
 * Every edge in this graph has a promise at one end. `cites` runs document to promise,
 * `designed` runs promise to test, `evidence` runs promise to evidence pack. So the closed
 * one-hop neighbourhood of a promise *is* its whole chain, and no transitive walk is needed
 * to find it.
 *
 * Which is fortunate, because a transitive walk would be wrong. A designed test can be the
 * test for several promises: in the committed snapshot `t_c267737f2b25` is bound to three of
 * them. Following edges outwards from a promise would reach that test, then the two other
 * promises through it, then the documents those were read from, and the highlight would
 * spread across most of the graph while claiming to show one promise's path. Lighting the
 * neighbours of the promise and stopping is the honest answer: the shared test is on the
 * path, the promises that share it are not.
 *
 * ## Direction is deliberately ignored
 *
 * A `cites` edge points at the promise and a `designed` edge points away from it, and the
 * path is the same object either way. Reading direction here would mean this module needed to
 * know which kind points which way, which is a second place that fact lives and a second
 * place it can go stale when the projection changes. An endpoint match is a fact about the
 * edge rather than an assumption about the vocabulary.
 */

import type { GraphLayout } from './layout.js';

/**
 * The lit set: the promise, everything one edge from it, and the edges between.
 *
 * Sets rather than arrays, because every consumer asks "is this one on the path" once per
 * painted node and once per painted edge, and a linear scan per node is quadratic in the
 * size of the graph for no reason.
 */
export interface GraphPath {
  /** Node ids on the path, including the promise itself. */
  readonly nodes: ReadonlySet<string>;
  /** Edge ids on the path, as `lib/layout.ts` spells them. */
  readonly edges: ReadonlySet<string>;
}

/** Nothing lit. Shared, because it is immutable and asked for on every idle render. */
export const NO_PATH: GraphPath = Object.freeze({
  nodes: Object.freeze(new Set<string>()) as ReadonlySet<string>,
  edges: Object.freeze(new Set<string>()) as ReadonlySet<string>,
});

/**
 * The path belonging to `promiseId`, or {@link NO_PATH}.
 *
 * `null` in answers with nothing lit rather than with everything, which is what makes the
 * caller's idle state the honest one: no promise under attention means no claim about which
 * lines belong together, and a graph where every line is lit is a graph with no highlight.
 *
 * An id the layout does not carry answers the same way. A promise can leave a snapshot
 * between a link being shared and the link being opened, and a highlight over an id the
 * ledger has never seen would be a claim about nothing.
 */
export function pathOf(layout: GraphLayout, promiseId: string | null): GraphPath {
  if (promiseId === null) return NO_PATH;

  const nodes = new Set<string>();
  const edges = new Set<string>();

  for (const edge of layout.edges) {
    if (edge.from === promiseId) {
      edges.add(edge.id);
      nodes.add(edge.to);
    } else if (edge.to === promiseId) {
      edges.add(edge.id);
      nodes.add(edge.from);
    }
  }

  /* Added last and unconditionally: a promise with no document, no designed test and no
     evidence is still its own path, and lighting it alone says "this one, and nothing is
     bound to it", which is the suite debt the coverage rail counts. Returning NO_PATH for
     it would instead say "no promise is selected", which is false. */
  if (layout.nodes.some((node) => node.id === promiseId)) nodes.add(promiseId);

  return nodes.size === 0 ? NO_PATH : { nodes, edges };
}
