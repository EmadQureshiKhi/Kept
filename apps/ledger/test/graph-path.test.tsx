/**
 * The path highlight: `lib/graphPath.ts` as arithmetic, and `PromiseGraph` as the DOM that
 * carries it. Design §10.2, §10.3, §10.4.3, R8.1, R10.5.
 *
 * The complaint this answers: the canvas draws thirty-five lines in one ink across four lanes
 * and nothing in the static picture says which of them belong together. Pointing at a promise,
 * arrowing to one, or opening one in the panel now lights its own chain and dims the rest.
 *
 * Two of these groups matter more than the others.
 *
 * **The one-hop rule.** A designed test can be bound to several promises: `t_c267737f2b25` is
 * the test for three of the committed thirteen. Walking edges outwards from a promise would
 * reach that test, then the two other promises through it, then the documents those were read
 * from, and the highlight would cover most of the graph while claiming to show one chain. So
 * there is an explicit test that a shared test is on the path and the promises sharing it are
 * not, driven off the committed snapshot rather than a constructed one, because the shape it
 * guards against is a shape the real data has.
 *
 * **Colour is untouched.** The highlight is opacity and only opacity. Colour is the verdict
 * channel (§10.4.3) and the `designed` edge already spends stroke weight on being the path a
 * verdict travels, so both of those signals are taken: a dimmed promise still carries its own
 * verdict hue, its word and its numeral. That is asserted as the absence of any verdict or
 * tone attribute changing when the path lights, which is the only way to state it in jsdom,
 * where no stylesheet is applied at all.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  NODE_CLASS,
  NODE_HEADER_CLASS,
  NODE_LIT_CLASS,
  PATH_IDLE,
  PATH_LIT,
  PromiseGraph,
} from '../components/PromiseGraph.js';
import { navOrder } from '../lib/graphNav.js';
import { NO_PATH, pathOf } from '../lib/graphPath.js';
import { layoutSnapshot } from '../lib/layout.js';
import { snapshot } from '../lib/snapshot.js';

import { installBrowserShims } from './_dom.js';

installBrowserShims();

afterEach(cleanup);

const LAYOUT = layoutSnapshot(snapshot);
const ORDER = navOrder(LAYOUT);

/* ───────────────────────── the relation, as arithmetic ───────────────────────── */

describe('pathOf names one promise\u2019s chain and stops there', () => {
  it('lights nothing for no promise, which is what makes the idle state honest', () => {
    /* Everything lit is the same picture as nothing lit, so `null` has to answer with the
       empty path rather than with the whole graph. */
    expect(pathOf(LAYOUT, null)).toBe(NO_PATH);
    expect(pathOf(LAYOUT, null).nodes.size).toBe(0);
    expect(pathOf(LAYOUT, null).edges.size).toBe(0);
  });

  it('lights nothing for an id this snapshot has never carried', () => {
    /* A promise can leave a snapshot between a link being shared and the link being opened,
       and a highlight over an id the ledger has never seen is a claim about nothing. */
    expect(pathOf(LAYOUT, 'p_deadbeefdead')).toBe(NO_PATH);
  });

  it('includes the promise itself, and every node one edge from it', () => {
    for (const promiseId of ORDER) {
      const path = pathOf(LAYOUT, promiseId);
      expect(path.nodes.has(promiseId), `${promiseId} is not on its own path`).toBe(true);

      const expected = new Set<string>([promiseId]);
      const expectedEdges = new Set<string>();
      for (const edge of LAYOUT.edges) {
        if (edge.from === promiseId) {
          expected.add(edge.to);
          expectedEdges.add(edge.id);
        } else if (edge.to === promiseId) {
          expected.add(edge.from);
          expectedEdges.add(edge.id);
        }
      }
      expect([...path.nodes].sort()).toEqual([...expected].sort());
      expect([...path.edges].sort()).toEqual([...expectedEdges].sort());
    }
  });

  it('reaches the document, the designed test and the evidence, in one hop each', () => {
    /* Every edge in this graph has a promise at one end: `cites` from a document, `designed`
       to a test, `evidence` to a pack. So a one-hop neighbourhood is the whole chain. This is
       the test that would fail if that stopped being true of the projection. */
    const withEverything = ORDER.find((id) => {
      const kinds = new Set(
        LAYOUT.edges.filter((e) => e.from === id || e.to === id).map((e) => e.kind),
      );
      return kinds.has('cites') && kinds.has('designed') && kinds.has('evidence');
    });
    expect(withEverything, 'no promise carries all three edge kinds').toBeDefined();

    const path = pathOf(LAYOUT, withEverything as string);
    const kinds = new Set(
      LAYOUT.nodes.filter((node) => path.nodes.has(node.id)).map((node) => node.kind),
    );
    expect([...kinds].sort()).toEqual(['document', 'evidence', 'promise', 'test']);
  });

  it('lights a shared designed test without lighting the promises that share it', () => {
    /* The shape a transitive walk would get wrong, checked against the real data: three of the
       committed promises are bound to one test document. */
    const shared = new Map<string, string[]>();
    for (const edge of LAYOUT.edges) {
      if (edge.kind !== 'designed') continue;
      shared.set(edge.to, [...(shared.get(edge.to) ?? []), edge.from]);
    }
    const [testId, promiseIds] =
      [...shared.entries()].find(([, ids]) => ids.length > 1) ?? ([null, []] as const);
    expect(testId, 'no designed test in the snapshot is shared by two promises').not.toBeNull();
    expect(promiseIds.length).toBeGreaterThan(1);

    const first = promiseIds[0] as string;
    const path = pathOf(LAYOUT, first);
    expect(path.nodes.has(testId as string), 'the shared test is not on the path').toBe(true);
    for (const sibling of promiseIds.slice(1)) {
      expect(
        path.nodes.has(sibling),
        `${sibling} shares a test with ${first} and was lit as if it were on its path`,
      ).toBe(false);
    }
  });

  it('lights a promise with no bindings as itself, not as nothing', () => {
    /* A promise with no document, no designed test and no evidence is still its own path.
       Answering NO_PATH for it would say "no promise is selected", which is false, and the
       reader would get no highlight at all on exactly the claim that carries suite debt. */
    const bare = { ...LAYOUT, edges: [] as typeof LAYOUT.edges };
    const first = ORDER[0] as string;
    const path = pathOf(bare, first);
    expect([...path.nodes]).toEqual([first]);
    expect(path.edges.size).toBe(0);
  });
});

/* ─────────────────────────── the relation, in the DOM ───────────────────────── */

describe('the graph lights the path and recedes the rest', () => {
  /** The class on the wrapper React Flow renders for a node. */
  function node(container: HTMLElement, id: string): Element | null {
    return container.querySelector(`.react-flow__node[data-id="${id}"]`);
  }

  it('is idle until a promise is under attention', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      /* At rest not one dim rule matches, which is what keeps the resting canvas identical to
         the canvas before this feature existed. */
      expect(container.querySelector('.promise-graph')?.getAttribute('data-path')).toBe(PATH_IDLE);
      expect(container.querySelectorAll(`.${NODE_LIT_CLASS}`)).toHaveLength(0);
      expect(container.querySelectorAll('.graph-edge--lit')).toHaveLength(0);
    } finally {
      unmount();
    }
  });

  it('lights the selected promise\u2019s chain, and nothing else', () => {
    const target = ORDER[0] as string;
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={target} snapshot={snapshot} />,
    );
    try {
      expect(container.querySelector('.promise-graph')?.getAttribute('data-path')).toBe(PATH_LIT);

      const path = pathOf(LAYOUT, target);
      const lit = [...container.querySelectorAll(`.react-flow__node.${NODE_LIT_CLASS}`)].map(
        (element) => element.getAttribute('data-id') ?? '',
      );
      expect(lit.sort()).toEqual([...path.nodes].sort());

      /* And every other subject carries the plain class, so the dim rule matches it. */
      for (const id of ORDER) {
        if (path.nodes.has(id)) continue;
        const element = node(container, id);
        expect(element?.classList.contains(NODE_CLASS)).toBe(true);
        expect(
          element?.classList.contains(NODE_LIT_CLASS),
          `${id} is lit and is not on the path`,
        ).toBe(false);
      }
    } finally {
      unmount();
    }
  });

  it('never dims a column heading, because a heading names its lane', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={ORDER[0] ?? null} snapshot={snapshot} />,
    );
    try {
      const headers = [...container.querySelectorAll(`.${NODE_HEADER_CLASS}`)];
      expect(headers.length, 'the column headings carry no exempting class').toBeGreaterThan(0);
      for (const header of headers) {
        /* The dim selector is `:not(--lit):not(--header)`, so carrying the header class is
           what exempts it. A reader following a line into a lane needs the lane's name most
           at the moment the rest of the lane has gone quiet. */
        expect(header.classList.contains(NODE_HEADER_CLASS)).toBe(true);
      }
    } finally {
      unmount();
    }
  });

  it('moves the highlight with the arrow keys, before anything is selected', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const canvas = container.querySelector('[role="application"]');
      expect(canvas).not.toBeNull();

      act(() => {
        fireEvent.keyDown(canvas as Element, { key: 'ArrowDown' });
      });
      /* Focus alone lights the path: a reader walking the lane sees each chain in turn without
         opening a panel for any of them. */
      expect(container.querySelector('.promise-graph')?.getAttribute('data-path')).toBe(PATH_LIT);
      expect(node(container, ORDER[0] as string)?.classList.contains(NODE_LIT_CLASS)).toBe(true);

      act(() => {
        fireEvent.keyDown(canvas as Element, { key: 'ArrowDown' });
      });
      expect(node(container, ORDER[1] as string)?.classList.contains(NODE_LIT_CLASS)).toBe(true);
      expect(
        node(container, ORDER[0] as string)?.classList.contains(NODE_LIT_CLASS),
        'the previous promise stayed lit, so two chains are lit at once',
      ).toBe(false);
    } finally {
      unmount();
    }
  });

  it('takes no colour away from a promise it recedes (§10.4.3, R10.5)', () => {
    const target = ORDER[0] as string;
    const plain = render(<PromiseGraph initialSelectedId={null} snapshot={snapshot} />);
    const verdictsIdle = [...plain.container.querySelectorAll('[data-promise]')].map(
      (element) => `${element.getAttribute('data-promise') ?? ''}:${element.getAttribute('data-verdict') ?? ''}`,
    );
    plain.unmount();

    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={target} snapshot={snapshot} />,
    );
    try {
      const verdictsLit = [...container.querySelectorAll('[data-promise]')].map(
        (element) => `${element.getAttribute('data-promise') ?? ''}:${element.getAttribute('data-verdict') ?? ''}`,
      );
      /* Byte-for-byte the same verdict attribution with a path lit as without one. The
         highlight is opacity in the stylesheet and touches no channel that carries meaning. */
      expect(verdictsLit).toEqual(verdictsIdle);
    } finally {
      unmount();
    }
  });
});
