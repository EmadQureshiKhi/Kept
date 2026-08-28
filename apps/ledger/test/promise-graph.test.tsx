/**
 * `PromiseGraph` bound to a real DOM — task 9.6, design §10.2, §10.3, §10.8, §10.10,
 * R8.1, R8.2, R8.3, R10.7.
 *
 * `graph-nav.test.ts` proves the *model*: the walk order, the clamping, the key
 * vocabulary, all as arithmetic over a layout. This file proves the *bindings*, which
 * is the half a pure function cannot reach — that a `keydown` on the canvas actually
 * moves DOM focus, that `Enter` and `Space` actually open the panel, and that `Escape`
 * actually puts focus back on the node that opened it. §10.8 is a claim about a
 * keyboard, and a keyboard model that is correct in the abstract and unbound in the
 * tree is not a keyboard model.
 *
 * Two facts about the environment, stated rather than worked around:
 *
 *   - jsdom implements no `ResizeObserver`, so `_dom.tsx` supplies one. It is a shim
 *     for a browser API, not a mock of anything the Ledger wrote: every node, key
 *     handler and coordinate below is the shipped code.
 *   - jsdom does no layout, so React Flow never measures a handle and therefore paints
 *     no edge. Edges are asserted where they are real — in `layout.test.ts` over
 *     `layoutSnapshot`, and in the projection property — never here. Claiming edges
 *     from a tree that cannot draw them would be the emptiest kind of green.
 *
 * `initialSelectedId` is passed explicitly in most suites so the URL is not consulted;
 * the two deep-link suites at the end omit it and drive `window.location` instead,
 * which is the path a shared `?p=<id>` link actually takes.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { LedgerSnapshot } from 'kept-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import LedgerPage from '../app/page.js';
import {
  GRAPH_CAPTION,
  GRAPH_EMPTY,
  GRAPH_LABEL,
  PromiseGraph,
} from '../components/PromiseGraph.js';
import { PROMISE_LIST_LABEL } from '../components/PromiseList.js';
import { SELECTION_PARAM, navOrder } from '../lib/graphNav.js';
import { LANES, LANE_HEADINGS, layoutSnapshot } from '../lib/layout.js';
import { snapshot } from '../lib/snapshot.js';

import { installBrowserShims } from './_dom.js';

installBrowserShims();

afterEach(cleanup);

const ORDER = navOrder(layoutSnapshot(snapshot));

/** The committed snapshot with its promises removed — the §10.10 empty graph. */
const EMPTY: LedgerSnapshot = {
  ...snapshot,
  promises: [],
  edges: [],
  documents: [],
  metrics: {
    ...snapshot.metrics,
    totalPromises: 0,
    designedCount: 0,
    provenCount: 0,
    redCount: 0,
    staleCount: 0,
    undesignedCount: 0,
    designedCoverage: null,
    provenCoverage: null,
  },
};

/** The one `role="application"` element in the tree: the graph's canvas (§10.8). */
function canvasOf(container: HTMLElement): HTMLElement {
  const found = container.querySelectorAll<HTMLElement>('[role="application"]');
  expect(
    found.length,
    'exactly one application region belongs in this tree; two is one of them unlabelled',
  ).toBe(1);
  const canvas = found[0];
  expect(canvas).toBeDefined();
  return canvas as HTMLElement;
}

function nodeOf(container: HTMLElement, id: string): HTMLElement {
  const node = container.querySelector<HTMLElement>(`[data-promise-node="${id}"]`);
  expect(node, `no node is painted for ${id}`).not.toBeNull();
  return node as HTMLElement;
}

/** `keydown` on the canvas, wrapped so React has flushed before the assertion. */
function press(canvas: HTMLElement, key: string): void {
  act(() => {
    fireEvent.keyDown(canvas, { key });
  });
}

function focusedPromiseId(container: HTMLElement): string | null {
  const active = container.ownerDocument.activeElement;
  return active instanceof HTMLElement ? (active.getAttribute('data-promise-node') ?? null) : null;
}

beforeEach(() => {
  /* every suite starts from a clean URL, so one test's `?p=` cannot open another's panel */
  window.history.replaceState(null, '', '/');
});

/* ───────────────────── the projection: four lanes, one canvas ───────────────────── */

describe('PromiseGraph — the graph a judge sees first', () => {
  it('paints a node for every promise, in the one order lib/layout.ts sorted', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const painted = [...container.querySelectorAll('[data-promise-node]')].map((node) =>
        node.getAttribute('data-promise-node'),
      );
      expect(painted).toHaveLength(snapshot.promises.length);
      expect(new Set(painted).size, 'a promise is painted twice').toBe(painted.length);
      for (const id of ORDER) expect(painted).toContain(id);
    } finally {
      unmount();
    }
  });

  it('paints the context lanes too, so a claim has a document and a test beside it', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const lanes = [...container.querySelectorAll('[data-lane]')].map((chip) =>
        chip.getAttribute('data-lane'),
      );
      expect(lanes.filter((kind) => kind === 'document')).toHaveLength(snapshot.documents.length);
      expect(lanes, 'the designed-test lane is empty on a snapshot that designs tests').toContain(
        'test',
      );
      expect(container.textContent).toContain('apps/fixture/README.md');
    } finally {
      unmount();
    }
  });

  it('says the reading order in words above the lanes', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      expect(container.querySelector('.promise-graph__caption')?.textContent).toBe(GRAPH_CAPTION);
    } finally {
      unmount();
    }
  });

  it('opens no panel until something is selected', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      expect(container.querySelector('.promise-graph')?.getAttribute('data-panel')).toBe('closed');
      expect(container.querySelector('.promise-panel')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('writes out the empty graph as a state rather than leaving a blank (§10.10)', () => {
    const { container, unmount } = render(<PromiseGraph initialSelectedId={null} snapshot={EMPTY} />);
    try {
      expect(container.querySelector('.promise-graph__empty')?.textContent).toBe(GRAPH_EMPTY);
      expect(container.querySelectorAll('[data-promise-node]')).toHaveLength(0);
      expect(
        container.querySelector('[role="list"]'),
        'the parallel list is always in the DOM, empty included (§10.8)',
      ).not.toBeNull();
    } finally {
      unmount();
    }
  });
});

/* ───────────── the canvas furniture: frame, ground, controls, minimap ──────────── */

describe('PromiseGraph — the canvas is framed, grounded and steerable', () => {
  it('frames the canvas with a surface class rather than an authored shadow (§10.5)', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const frame = container.querySelector('.promise-graph__canvas');
      expect(frame).not.toBeNull();
      expect(
        frame?.classList.contains('surface-raised-2'),
        'the frame is composed from surfaces.css, because §10.4.4 permits a shadow to be ' +
          'declared there and nowhere else',
      ).toBe(true);
    } finally {
      unmount();
    }
  });

  it('lays a dotted ground at the page ruling behind the lanes', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const ground = container.querySelector('[data-testid="rf__background"]');
      expect(ground, 'no background layer is drawn, so the canvas is a void').not.toBeNull();
      const dot = container.querySelector('.react-flow__background-pattern.dots');
      expect(dot, 'the background is drawn but not as dots').not.toBeNull();
      /* 28px is `--grid-cell`, the page's own ruling, so the graph sits on the page's grid */
      expect(container.querySelector('pattern')?.getAttribute('width')).toBe('28');
    } finally {
      unmount();
    }
  });

  it('offers zoom and fit-view as native buttons with accessible names', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const controls = container.querySelector('.graph-controls');
      expect(controls, 'no controls are drawn').not.toBeNull();
      const buttons = [...container.querySelectorAll<HTMLButtonElement>('.react-flow__controls-button')];
      expect(buttons.length, 'zoom in, zoom out and fit view').toBe(3);
      for (const button of buttons) {
        expect(button.tagName).toBe('BUTTON');
        expect(
          button.getAttribute('aria-label'),
          'a control with no name is a control a screen reader cannot offer',
        ).toBeTruthy();
      }
      for (const required of [
        'react-flow__controls-zoomin',
        'react-flow__controls-zoomout',
        'react-flow__controls-fitview',
      ]) {
        expect(container.querySelector(`.${required}`), `${required} is absent`).not.toBeNull();
      }
      /* the interactivity lock is off: the graph is read-only, so there is nothing to unlock */
      expect(container.querySelector('.react-flow__controls-interactive')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('draws a minimap, and neither it nor the controls add a tab stop of their own', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      expect(container.querySelector('.graph-minimap'), 'no minimap on a 1520px graph').not.toBeNull();
      /* §10.8: one Tab enters the graph. Native buttons are reachable without a tabindex,
         and nothing here takes focus away from the canvas or holds it. */
      expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
      for (const trap of container.querySelectorAll('.graph-minimap [tabindex], .graph-controls [tabindex]')) {
        expect(trap.getAttribute('tabindex'), 'a positive tabindex jumps the tab order').not.toMatch(
          /^[1-9]/,
        );
      }
    } finally {
      unmount();
    }
  });

  it('labels the four columns so the left-to-right story needs no click', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const headings = [...container.querySelectorAll('[data-lane-header]')];
      expect(headings.map((heading) => heading.getAttribute('data-lane-header'))).toEqual([
        ...LANES,
      ]);
      expect(headings.map((heading) => heading.textContent)).toEqual(
        LANES.map((kind) => LANE_HEADINGS[kind]),
      );
      /* labels, not controls: no role and no focus stop (§10.8) */
      for (const heading of headings) {
        expect(heading.getAttribute('role')).toBeNull();
        expect(heading.getAttribute('tabindex')).toBeNull();
      }
      /* and they are not mistaken for the lanes they name */
      expect(container.querySelectorAll('[data-lane]')).toHaveLength(
        layoutSnapshot(snapshot).nodes.filter((node) => node.kind !== 'promise').length,
      );
    } finally {
      unmount();
    }
  });

  it('numbers the promise lane so "most urgent first" is visible, not inferred', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const ranks = ORDER.map((id) =>
        container
          .querySelector(`[data-promise-node="${id}"] .promise-node__rank`)
          ?.textContent ?? null,
      );
      expect(ranks).toEqual(ORDER.map((_, index) => String(index + 1)));
      const first = container.querySelector(
        `[data-promise-node="${ORDER[0]}"] .promise-node__rank`,
      );
      expect(first?.getAttribute('title')).toBe(
        `urgency 1 of ${snapshot.promises.length}, most urgent first`,
      );
    } finally {
      unmount();
    }
  });

  it('keeps the graph read-only: nothing drags, nothing connects, nothing is deletable', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      for (const node of container.querySelectorAll('.react-flow__node')) {
        expect(
          node.classList.contains('draggable'),
          'a draggable node lets a reader move a coordinate lib/layout.ts computed',
        ).toBe(false);
      }
      for (const handle of container.querySelectorAll('.react-flow__handle')) {
        expect(handle.classList.contains('connectionindicator')).toBe(false);
      }
    } finally {
      unmount();
    }
  });
});

/* ────────────── the parallel list: always present, never a fallback ────────────── */

describe('PromiseGraph — the role="list" beside the canvas (§10.8)', () => {
  it('is always rendered, is labelled, and holds one native button per promise', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const list = container.querySelector('[role="list"]');
      expect(list).not.toBeNull();
      expect(list?.getAttribute('aria-label')).toBe(PROMISE_LIST_LABEL);

      const rows = [...container.querySelectorAll<HTMLButtonElement>('[data-promise-row]')];
      expect(rows).toHaveLength(snapshot.promises.length);
      for (const row of rows) expect(row.tagName).toBe('BUTTON');
      expect(rows.map((row) => row.getAttribute('data-promise-row'))).toEqual([...ORDER]);
    } finally {
      unmount();
    }
  });

  it('selects from the list with no canvas and no arrow key involved', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const target = ORDER[2] ?? '';
      act(() => {
        container.querySelector<HTMLButtonElement>(`[data-promise-row="${target}"]`)?.click();
      });
      expect(container.querySelector('.promise-panel')?.getAttribute('data-promise-panel')).toBe(
        target,
      );
      expect(
        container.querySelector(`[data-promise-row="${target}"]`)?.getAttribute('aria-current'),
      ).toBe('true');
    } finally {
      unmount();
    }
  });

  it('marks exactly one row as current, and names which promise the panel shows', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={ORDER[0] ?? null} snapshot={snapshot} />,
    );
    try {
      const current = [...container.querySelectorAll('[aria-current="true"]')];
      expect(current).toHaveLength(1);
      expect(current[0]?.getAttribute('data-promise-row')).toBe(ORDER[0]);
    } finally {
      unmount();
    }
  });
});

/* ───────────────────────── the keyboard model, bound (§10.8) ───────────────────── */

describe('PromiseGraph — Tab enters the graph, and the graph says so', () => {
  it('is one role="application" region, labelled and focusable', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const canvas = canvasOf(container);
      expect(canvas.getAttribute('tabindex')).toBe('0');
      expect(canvas.getAttribute('aria-label')).toBe(GRAPH_LABEL);
      canvas.focus();
      expect(container.ownerDocument.activeElement).toBe(canvas);
    } finally {
      unmount();
    }
  });

  it('costs one Tab to enter, because the nodes rove focus rather than take it', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const stops = [...container.querySelectorAll('[tabindex="0"]')];
      expect(stops).toHaveLength(1);
      for (const node of container.querySelectorAll('[data-promise-node]')) {
        expect(node.getAttribute('tabindex')).toBe('-1');
      }
    } finally {
      unmount();
    }
  });
});

describe('PromiseGraph — the arrow keys walk the lane in painted order', () => {
  it('lands on the first promise on the first ArrowDown after Tab', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const canvas = canvasOf(container);
      canvas.focus();
      press(canvas, 'ArrowDown');
      expect(focusedPromiseId(container)).toBe(ORDER[0]);
    } finally {
      unmount();
    }
  });

  it('reaches every promise with ArrowDown alone, in order, and clamps at the end', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const canvas = canvasOf(container);
      canvas.focus();

      const visited: (string | null)[] = [];
      for (let step = 0; step < ORDER.length; step += 1) {
        press(canvas, 'ArrowDown');
        visited.push(focusedPromiseId(container));
      }
      expect(visited).toEqual([...ORDER]);

      /* one more press stops rather than wrapping, so the end of the lane is findable */
      press(canvas, 'ArrowDown');
      expect(focusedPromiseId(container)).toBe(ORDER[ORDER.length - 1]);
    } finally {
      unmount();
    }
  });

  it('comes back with ArrowUp, and clamps at the top', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const canvas = canvasOf(container);
      canvas.focus();
      press(canvas, 'End');
      expect(focusedPromiseId(container)).toBe(ORDER[ORDER.length - 1]);

      const visited: (string | null)[] = [];
      for (let step = 1; step < ORDER.length; step += 1) {
        press(canvas, 'ArrowUp');
        visited.push(focusedPromiseId(container));
      }
      expect(visited).toEqual([...ORDER].slice(0, -1).reverse());

      press(canvas, 'ArrowUp');
      expect(focusedPromiseId(container)).toBe(ORDER[0]);
    } finally {
      unmount();
    }
  });

  it('treats ArrowRight and ArrowLeft as the same lane, because the lane is one column', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const canvas = canvasOf(container);
      canvas.focus();
      press(canvas, 'Home');
      press(canvas, 'ArrowRight');
      expect(focusedPromiseId(container)).toBe(ORDER[1]);
      press(canvas, 'ArrowLeft');
      expect(focusedPromiseId(container)).toBe(ORDER[0]);
    } finally {
      unmount();
    }
  });

  it('jumps to the ends with Home and End', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const canvas = canvasOf(container);
      canvas.focus();
      press(canvas, 'End');
      expect(focusedPromiseId(container)).toBe(ORDER[ORDER.length - 1]);
      press(canvas, 'Home');
      expect(focusedPromiseId(container)).toBe(ORDER[0]);
    } finally {
      unmount();
    }
  });
});

describe('PromiseGraph — Enter and Space open the panel, Escape closes it (§10.8)', () => {
  for (const key of ['Enter', ' '] as const) {
    it(`opens the focused promise's panel on ${key === ' ' ? 'Space' : key}`, () => {
      const { container, unmount } = render(
        <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
      );
      try {
        const canvas = canvasOf(container);
        canvas.focus();
        press(canvas, 'ArrowDown');
        press(canvas, 'ArrowDown');
        const focused = focusedPromiseId(container);
        expect(focused).toBe(ORDER[1]);

        press(canvas, key);
        const panel = container.querySelector('.promise-panel');
        expect(panel, `${key} opened no panel`).not.toBeNull();
        expect(panel?.getAttribute('data-promise-panel')).toBe(focused);
        expect(container.querySelector('.promise-graph')?.getAttribute('data-panel')).toBe('open');
        expect(nodeOf(container, focused ?? '').getAttribute('data-selected')).toBe('true');
      } finally {
        unmount();
      }
    });
  }

  it('opens the first promise when Enter arrives before any arrow key', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const canvas = canvasOf(container);
      canvas.focus();
      press(canvas, 'Enter');
      expect(container.querySelector('.promise-panel')?.getAttribute('data-promise-panel')).toBe(
        ORDER[0],
      );
    } finally {
      unmount();
    }
  });

  it('closes on Escape and returns focus to the node that opened it', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const canvas = canvasOf(container);
      canvas.focus();
      press(canvas, 'ArrowDown');
      press(canvas, 'ArrowDown');
      press(canvas, 'ArrowDown');
      const opener = focusedPromiseId(container);
      expect(opener).toBe(ORDER[2]);
      press(canvas, 'Enter');
      expect(container.querySelector('.promise-panel')).not.toBeNull();

      /* focus moves into the panel, the way a reader tabbing through it would */
      const close = container.querySelector<HTMLButtonElement>('.promise-panel__close');
      expect(close).not.toBeNull();
      act(() => close?.focus());
      expect(container.ownerDocument.activeElement).toBe(close);

      act(() => {
        fireEvent.keyDown(close as HTMLElement, { key: 'Escape' });
      });

      expect(container.querySelector('.promise-panel')).toBeNull();
      expect(
        focusedPromiseId(container),
        'Escape closed the panel but left focus adrift; §10.8 returns it to the node',
      ).toBe(opener);
      expect(container.querySelector('.promise-graph')?.getAttribute('data-panel')).toBe('closed');
    } finally {
      unmount();
    }
  });

  it('closes with Escape pressed on the canvas as well as inside the panel', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const canvas = canvasOf(container);
      canvas.focus();
      press(canvas, 'Enter');
      expect(container.querySelector('.promise-panel')).not.toBeNull();
      press(canvas, 'Escape');
      expect(container.querySelector('.promise-panel')).toBeNull();
      expect(focusedPromiseId(container)).toBe(ORDER[0]);
    } finally {
      unmount();
    }
  });

  it('leaves every other key to the browser', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const canvas = canvasOf(container);
      canvas.focus();
      for (const key of ['Tab', 'PageDown', 'a', 'F1']) press(canvas, key);
      expect(focusedPromiseId(container)).toBeNull();
      expect(container.querySelector('.promise-panel')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('does nothing on an empty lane rather than inventing a stop', () => {
    const { container, unmount } = render(<PromiseGraph initialSelectedId={null} snapshot={EMPTY} />);
    try {
      /* no canvas to key into when there is nothing to draw; the section still exists */
      expect(container.querySelectorAll('[role="application"]')).toHaveLength(0);
      const section = container.querySelector<HTMLElement>('.promise-graph');
      expect(section).not.toBeNull();
      act(() => {
        fireEvent.keyDown(section as HTMLElement, { key: 'Enter' });
        fireEvent.keyDown(section as HTMLElement, { key: 'Escape' });
      });
      expect(container.querySelector('.promise-panel')).toBeNull();
    } finally {
      unmount();
    }
  });
});

/* ───────────────── selection is a URL, so a state of this page is sendable ──────── */

describe('PromiseGraph — ?p=<id> is the panel, and the panel is ?p=<id>', () => {
  it('opens the promise a shared link names, on first paint', () => {
    const target = ORDER[3] ?? '';
    window.history.replaceState(null, '', `/?${SELECTION_PARAM}=${target}`);
    const { container, unmount } = render(<PromiseGraph snapshot={snapshot} />);
    try {
      expect(container.querySelector('.promise-panel')?.getAttribute('data-promise-panel')).toBe(
        target,
      );
      expect(nodeOf(container, target).getAttribute('data-selected')).toBe('true');
    } finally {
      unmount();
    }
  });

  it('degrades a stale link to the graph with nothing selected, never to an empty panel', () => {
    window.history.replaceState(null, '', `/?${SELECTION_PARAM}=p_deadbeefdead`);
    const { container, unmount } = render(<PromiseGraph snapshot={snapshot} />);
    try {
      expect(container.querySelector('.promise-panel')).toBeNull();
      expect(container.querySelectorAll('[data-promise-node]')).toHaveLength(
        snapshot.promises.length,
      );
    } finally {
      unmount();
    }
  });

  it('mirrors a selection into the URL, and takes it out again on close', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const target = ORDER[1] ?? '';
      act(() => {
        container.querySelector<HTMLButtonElement>(`[data-promise-row="${target}"]`)?.click();
      });
      expect(new URL(window.location.href).searchParams.get(SELECTION_PARAM)).toBe(target);

      act(() => {
        container.querySelector<HTMLButtonElement>('.promise-panel__close')?.click();
      });
      expect(new URL(window.location.href).searchParams.get(SELECTION_PARAM)).toBeNull();
      expect(container.querySelector('.promise-panel')).toBeNull();
    } finally {
      unmount();
    }
  });
});

/* ─────────────────────────────── `/`, assembled ────────────────────────────────── */

describe('/ — the hero page composes the rail, the graph and the list', () => {
  it('renders the title, the rail and the graph from the committed snapshot', () => {
    const { container, unmount } = render(<LedgerPage />);
    try {
      expect(container.querySelector('.hero-title')?.textContent).toBe(
        'The promises this codebase makes',
      );
      expect(container.querySelector('.metric-rail'), 'no metric rail on the hero').not.toBeNull();
      expect(container.querySelector('.promise-graph')).not.toBeNull();
      expect(container.querySelectorAll('[data-promise-node]')).toHaveLength(
        snapshot.promises.length,
      );
      expect(container.querySelector('[role="list"]')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it('shows the honest state the snapshot is actually in', () => {
    // Which state that is moves with Kane, so the invariant is asserted rather than
    // the state. `degraded` and a null proven figure travel together in both
    // directions (the schema's own rule), and the rail either replaces the tile with
    // words or renders the figure in the file. Neither arm renders a zero.
    expect(snapshot.freshness.terminalEventAt).not.toBeNull();
    expect(snapshot.metrics.provenCoverage === null).toBe(snapshot.degraded);
    const { container, unmount } = render(<LedgerPage />);
    try {
      if (snapshot.degraded) {
        expect(container.querySelector('[data-degraded="true"]')).not.toBeNull();
        expect(container.querySelector('[data-metric="proven-coverage"]')).toBeNull();
      } else {
        expect(container.querySelector('[data-degraded="true"]')).toBeNull();
        expect(container.querySelector('[data-metric="proven-coverage"]')).not.toBeNull();
      }
    } finally {
      unmount();
    }
  });
});
