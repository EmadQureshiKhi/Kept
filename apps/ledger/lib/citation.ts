/**
 * How a citation and a designed test are written down — design §10.7, R1.3, R8.2.
 *
 * Three components render the same two identifiers: the node, the list beside it and
 * the panel. Written three times they would eventually be written three ways, and a
 * `path:line` that disagreed with itself between the graph and the panel would
 * undermine the one thing a citation is for — being checkable by opening the file.
 * So the spelling lives here, once, in a module with no DOM and no React, and the
 * components render what it returns.
 *
 * `path:line` and nothing else: no `(line 19)`, no `L19`, no repo name. It is the
 * form an editor, a terminal and a code host all accept, so a reader can paste it
 * straight into whichever they are already in.
 */

import type { SnapshotPromise } from 'kept-core';

/** `apps/fixture/README.md:19` — the identifier §10.7 sets in mono. */
export function citationLabel(citation: SnapshotPromise['citation']): string {
  return `${citation.file}:${citation.line}`;
}

/**
 * `tests/cart_subtotal_test.md · T-3`, or just the path when the author wrote no
 * `test_id`, or `null` when no test was designed at all.
 *
 * `null` is a first-class answer rather than an empty string: an undesigned promise
 * is the suite debt R5.8 exists to report, and the panel says so in words.
 */
export function designedTestLabel(designedTest: SnapshotPromise['designedTest']): string | null {
  if (designedTest === null) return null;
  return designedTest.testId === null
    ? designedTest.path
    : `${designedTest.path} \u00B7 ${designedTest.testId}`;
}
