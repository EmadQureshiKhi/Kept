/**
 * **Property 23: Every promise is reachable, selectable and evidenced in the
 * projection.**
 *
 * **Validates: Requirements 7.5, 8.1, 8.2, 8.3, 10.7**
 *
 * Design §9.6 states the property in one sentence with three clauses, and each clause
 * is a different kind of claim, so each is proven differently and honestly:
 *
 *   1. **Completeness (R8.1, R8.2).** For *any* schema-valid snapshot the graph paints
 *      exactly one node per promise, that node carries the promise's claim text and
 *      its citation as `path:line`, and it is numbered with its own position in the lane's
 *      urgency order. Not "at least one" and not "a node for every
 *      promise it happens to know about": a duplicated node is a graph that double-counts
 *      its own subject, and a missing one is a promise the repository states and the
 *      ledger hides.
 *   2. **Reachability and selectability by keyboard alone (R10.7).** For any snapshot and
 *      any promise in it, that promise is reached from an unfocused graph by arrow keys
 *      and opened with `Enter` — no pointer, no canvas gesture, nothing that needs a
 *      mouse. And the parallel `role="list"` is asserted **unconditionally**, on every
 *      generated snapshot including the empty one, because a list that is present when
 *      there are promises and absent otherwise is a list a reader cannot rely on.
 *   3. **Evidenced (R8.3).** The opened panel names the verbatim cited text, the designed
 *      test reference and the verdict as *text*, and links **exactly** the artefacts the
 *      snapshot lists for that promise — set equality in both directions. An extra link
 *      is a claim about evidence that does not exist; a missing one is evidence withheld.
 *
 * **The generator is `arbSnapshot` from `packages/kept-core/test/arbitraries.ts`**, the
 * same one the snapshot round-trip and badge properties quantify over. It is schema-valid
 * by construction, weights in the empty graph and the zero-test-file graph, and produces
 * promises with and without a designed test, a verdict source, a repair branch and an
 * evidence pack. Writing a second generator here would let this property drift away from
 * the shape the CLI actually emits, which is the one thing a projection property must not
 * do.
 *
 * **The one clause this file does not prove, and where it lives instead.** §9.6's
 * sentence also covers the amendment accept control (R7.5). `/amendments` is task 14.6
 * and does not exist, and `arbSnapshot` generates no amendments — so the clause is
 * *vacuous* here rather than satisfied. That is asserted explicitly below rather than
 * quietly skipped: the moment the generator grows an amendment, the assertion fails and
 * says which surface has to join this property.
 *
 * **jsdom does no layout**, so nothing here asserts a width, and React Flow paints no
 * edge in this environment because it never measures a handle. Edges are proven over
 * `layoutSnapshot` in `layout.test.ts` and their endpoints by the schema's own
 * cross-field rule; the visible focus ring of §10.8 is proven against the stylesheet in
 * `promise-graph-density.test.ts` and `contrast-matrix.test.ts`. Each claim is asserted
 * where it is real.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import fc from 'fast-check';
import type { LedgerSnapshot, SnapshotPromise } from '@kept/core';
import { afterEach, describe, expect, it } from 'vitest';

import { arbSnapshot } from '../../../packages/kept-core/test/arbitraries.js';
import { PromiseGraph } from '../components/PromiseGraph.js';
import { citationLabel, designedTestLabel } from '../lib/citation.js';
import { navOrder } from '../lib/graphNav.js';
import { layoutSnapshot } from '../lib/layout.js';

import { installBrowserShims } from './_dom.js';

installBrowserShims();

/**
 * Runs per property, in two budgets — because the properties in this file cost two
 * very different things, and one budget for both made the expensive half unreliable.
 *
 * `NUM_RUNS` is the repository's usual 500 and covers the two analytic properties,
 * which only read a generated snapshot: they finish in 66 ms and 134 ms.
 *
 * `RENDER_RUNS` covers the five clauses that **mount `PromiseGraph` once per case**.
 * Measured on an idle machine, one mount-assert-unmount cycle costs 6–8 ms, so 500
 * of them is 3.2–5.7 s of a single `it`, and the ledger project's per-test budget is
 * **5 s** — the root `testTimeout` is not inherited by a project. That is not a
 * margin, it is a coin flip: the clause below that opens the panel on `Enter` was
 * observed at 3.9 s alone and 5.7 s — a timeout — with the rest of the project's
 * files running beside it. A property whose greenness depends on how busy the
 * machine is proves nothing to whoever runs it next, so the sample is cut to a size
 * that fits the budget with room to spare (~1.2 s per clause) rather than the budget
 * being raised to fit the sample. 150 is still half again the floor this plan sets
 * for a property (100 cases), and the five clauses together sample 750 snapshots.
 *
 * If a clause here ever needs a bigger sample than the budget allows, the thing to
 * make cheaper is the render, not the clock.
 */
const NUM_RUNS = 500;
const RENDER_RUNS = 150;

afterEach(cleanup);

/**
 * The lane order of a snapshot — the order the arrow keys walk and the list paints.
 *
 * Taken from the shipped `navOrder(layoutSnapshot(...))` rather than recomputed, so the
 * property quantifies over the sort the page actually uses. A second sort here could
 * agree with the design and disagree with the product.
 */
function orderOf(snapshot: LedgerSnapshot): readonly string[] {
  return navOrder(layoutSnapshot(snapshot));
}

/** Every artefact public path the snapshot lists for a promise. Possibly none. */
function artefactPathsFor(snapshot: LedgerSnapshot, promise: SnapshotPromise): string[] {
  if (promise.evidencePackId === null) return [];
  const pack = snapshot.evidence.find((entry) => entry.id === promise.evidencePackId);
  return (pack?.artifacts ?? []).map((artifact) => artifact.publicPath);
}

/** `keydown` on the graph's application region, flushed. */
function press(canvas: HTMLElement, key: string): void {
  act(() => {
    fireEvent.keyDown(canvas, { key });
  });
}

/**
 * The graph's one `role="application"` region, or `null` when nothing is drawn.
 *
 * `null` is the empty-graph answer: with no promises there is no canvas to key into,
 * and §10.10 puts a sentence there instead. The list is still present, which is the
 * point of the clause below.
 */
function canvasOf(container: HTMLElement): HTMLElement | null {
  const found = container.querySelectorAll<HTMLElement>('[role="application"]');
  expect(found.length, 'more than one application region in the tree').toBeLessThanOrEqual(1);
  return found[0] ?? null;
}

/* ───────────────────────────────── meta-tests ──────────────────────────────────── */

describe('Property 23 — the generator reaches the cases the clauses are about', () => {
  it('produces empty graphs, promises without tests, and promises with evidence', () => {
    const seen = {
      empty: false,
      populated: false,
      withPack: false,
      withoutPack: false,
      withTest: false,
      withoutTest: false,
      withArtifacts: false,
    };
    fc.assert(
      fc.property(arbSnapshot, (snapshot) => {
        if (snapshot.promises.length === 0) seen.empty = true;
        else seen.populated = true;
        for (const promise of snapshot.promises) {
          if (promise.evidencePackId === null) seen.withoutPack = true;
          else {
            seen.withPack = true;
            if (artefactPathsFor(snapshot, promise).length > 0) seen.withArtifacts = true;
          }
          if (promise.designedTest === null) seen.withoutTest = true;
          else seen.withTest = true;
        }
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
    for (const [name, reached] of Object.entries(seen)) {
      expect(reached, `the generator never produced the "${name}" case`).toBe(true);
    }
  });

  it('generates no amendment, so R7.5 belongs to task 14.6 and not to this file', () => {
    fc.assert(
      fc.property(arbSnapshot, (snapshot) => {
        expect(
          snapshot.amendments,
          'arbSnapshot has grown amendments. The accept-control clause of Property 23 ' +
            '(R7.5) is no longer vacuous, and /amendments must join this property.',
        ).toEqual([]);
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

/* ───────────── clause 1 — one node per promise, with its claim and citation ────── */

describe('Property 23 — completeness: exactly one node per promise (R8.1, R8.2)', () => {
  it('paints every promise once, carrying its claim and its path:line', () => {
    fc.assert(
      fc.property(arbSnapshot, (snapshot) => {
        const { container, unmount } = render(
          <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
        );
        try {
          const painted = [...container.querySelectorAll('[data-promise-node]')].map(
            (node) => node.getAttribute('data-promise-node') ?? '',
          );

          /* one per promise, no duplicate, no stranger */
          expect(painted).toHaveLength(snapshot.promises.length);
          expect([...painted].sort()).toEqual(
            snapshot.promises.map((promise) => promise.id).sort(),
          );

          /* and in the one order lib/layout.ts sorted, red first */
          const order = orderOf(snapshot);
          expect(painted).toEqual([...order]);

          /* the urgency numeral is that order, stated on the node. A sort a reader has to
             infer from four hues is a sort a reader does not have, so the position is
             painted — and it must agree with the position, on every snapshot, or the node
             is telling a reader something the lane does not do. */
          const position = new Map(order.map((id, index) => [id, index + 1]));

          for (const promise of snapshot.promises) {
            const node = container.querySelector(`[data-promise-node="${promise.id}"]`);
            expect(node, `${promise.id} has no node`).not.toBeNull();
            expect(node?.querySelector('.promise-node__claim')?.textContent).toBe(promise.claim);
            expect(node?.querySelector('.promise-node__claim')?.getAttribute('title')).toBe(
              promise.claim,
            );
            expect(node?.querySelector('.promise-node__citation')?.textContent).toBe(
              citationLabel(promise.citation),
            );
            /* R10.5 read through the graph: the verdict is a word on the node */
            expect(node?.textContent).toContain(promise.verdict);
            expect(
              node?.querySelector('.promise-node__rank')?.textContent,
              `${promise.id} is painted at lane position ${position.get(promise.id)} but ` +
                `numbered otherwise`,
            ).toBe(String(position.get(promise.id)));
          }
          return true;
        } finally {
          unmount();
        }
      }),
      { numRuns: RENDER_RUNS },
    );
  });
});

/* ──────── clause 2 — reachable and selectable with a keyboard alone (R10.7) ────── */

describe('Property 23 — reachability: the parallel list is always there (§10.8)', () => {
  it('renders one labelled role="list" with a native button per promise, on any snapshot', () => {
    fc.assert(
      fc.property(arbSnapshot, (snapshot) => {
        const { container, unmount } = render(
          <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
        );
        try {
          const lists = container.querySelectorAll('[role="list"]');
          expect(
            lists.length,
            'the parallel list is unconditional: a list that appears only when there is ' +
              'something in it is a list a keyboard reader cannot depend on (§10.8)',
          ).toBe(1);
          expect(lists[0]?.getAttribute('aria-label')).toBeTruthy();

          const rows = [...container.querySelectorAll<HTMLElement>('[data-promise-row]')];
          expect(rows.map((row) => row.getAttribute('data-promise-row'))).toEqual([
            ...orderOf(snapshot),
          ]);
          for (const row of rows) {
            expect(row.tagName, 'a row that is not a button needs JavaScript to activate').toBe(
              'BUTTON',
            );
            expect(row.getAttribute('type')).toBe('button');
            /* an accessible name, which for these rows is their own text */
            expect((row.textContent ?? '').trim().length).toBeGreaterThan(0);
          }
          return true;
        } finally {
          unmount();
        }
      }),
      { numRuns: RENDER_RUNS },
    );
  });

  it('reaches any promise from an unfocused graph with arrow keys alone', () => {
    fc.assert(
      fc.property(arbSnapshot, fc.nat({ max: 32 }), (snapshot, pick) => {
        const order = orderOf(snapshot);
        const { container, unmount } = render(
          <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
        );
        try {
          const canvas = canvasOf(container);
          if (order.length === 0) {
            /* nothing to reach, and §10.10 says so in words rather than in a blank */
            expect(canvas, 'an empty graph offers a focus stop that goes nowhere').toBeNull();
            expect(container.querySelector('.promise-graph__empty')).not.toBeNull();
            return true;
          }
          expect(canvas, 'a populated graph has no application region to enter').not.toBeNull();
          const target = pick % order.length;

          canvas?.focus();
          /* Home first, so the walk starts from a stated position rather than from
             whatever the previous run left focused in the shared jsdom document */
          press(canvas as HTMLElement, 'Home');
          for (let step = 0; step < target; step += 1) press(canvas as HTMLElement, 'ArrowDown');

          const active = container.ownerDocument.activeElement;
          expect(
            active instanceof HTMLElement ? active.getAttribute('data-promise-node') : null,
            `${target} ArrowDown presses did not land on promise ${target} of the lane`,
          ).toBe(order[target]);
          return true;
        } finally {
          unmount();
        }
      }),
      { numRuns: RENDER_RUNS },
    );
  });
});

/* ─────────── clause 3 — the opened panel names and links exactly the evidence ──── */

describe('Property 23 — evidenced: the panel is the promise, in full (R8.3)', () => {
  it('opens on Enter and names the verbatim citation, the test and the verdict', () => {
    fc.assert(
      fc.property(arbSnapshot, fc.nat({ max: 32 }), (snapshot, pick) => {
        const order = orderOf(snapshot);
        if (order.length === 0) return true;

        const { container, unmount } = render(
          <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
        );
        try {
          const canvas = canvasOf(container);
          const target = pick % order.length;
          const id = order[target] ?? '';
          const promise = snapshot.promises.find((entry) => entry.id === id);
          expect(promise, `${id} is in the walk order but not in the snapshot`).toBeDefined();

          canvas?.focus();
          press(canvas as HTMLElement, 'Home');
          for (let step = 0; step < target; step += 1) press(canvas as HTMLElement, 'ArrowDown');
          press(canvas as HTMLElement, 'Enter');

          const panel = container.querySelector('.promise-panel');
          expect(panel, `Enter on ${id} opened no panel`).not.toBeNull();
          expect(panel?.getAttribute('data-promise-panel')).toBe(id);

          /* the claim in full, never the node's clamped two lines */
          expect(panel?.querySelector('.promise-panel__claim')?.textContent).toBe(promise?.claim);

          /* the cited line byte for byte — the product's credibility claim (R1.3) */
          expect(
            panel?.querySelector('.promise-panel__quote')?.textContent,
            'the quoted line was normalised, so it can no longer be checked against the file',
          ).toBe(promise?.citation.text);
          expect(panel?.textContent).toContain(citationLabel(promise?.citation ?? { file: '', line: 0, text: '' }));

          /* the designed test reference, or the sentence that says there is none */
          const designed = designedTestLabel(promise?.designedTest ?? null);
          if (designed !== null) expect(panel?.textContent).toContain(designed);

          /* the verdict as text, not only as a hue (R10.5) */
          expect(panel?.querySelector('.verdict-tag')?.textContent).toBe(promise?.verdict);
          return true;
        } finally {
          unmount();
        }
      }),
      { numRuns: RENDER_RUNS },
    );
  });

  it('links exactly the artefacts the snapshot lists for that promise, and no others', () => {
    fc.assert(
      fc.property(arbSnapshot, fc.nat({ max: 32 }), (snapshot, pick) => {
        const order = orderOf(snapshot);
        if (order.length === 0) return true;

        const id = order[pick % order.length] ?? '';
        const promise = snapshot.promises.find((entry) => entry.id === id);
        expect(promise).toBeDefined();

        const { container, unmount } = render(
          <PromiseGraph initialSelectedId={id} snapshot={snapshot} />,
        );
        try {
          const panel = container.querySelector('.promise-panel');
          expect(panel, `?p=${id} opened no panel`).not.toBeNull();

          const expected = artefactPathsFor(snapshot, promise as SnapshotPromise);
          const linked = [
            ...container.querySelectorAll<HTMLAnchorElement>('.promise-panel__artifact'),
          ].map((link) => link.getAttribute('href') ?? '');

          expect(
            [...linked].sort(),
            'the panel links a different set of artefacts than the snapshot lists: an ' +
              'extra link claims evidence that does not exist, a missing one withholds it',
          ).toEqual([...expected].sort());

          /* every link is a plain static path, never a route handler of ours (R8.4) */
          for (const href of linked) expect(href.startsWith('/evidence/')).toBe(true);
          return true;
        } finally {
          unmount();
        }
      }),
      { numRuns: RENDER_RUNS },
    );
  });
});
