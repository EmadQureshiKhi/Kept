/**
 * The evidence lane, asserted against a snapshot that finally has one. Task 21.4,
 * design §10.3, R8.3.
 *
 * Nothing here is new behaviour. `LANES` has carried `evidence` since §10.3 landed,
 * `LANE_X` has had four entries the whole time, `layoutSnapshot` has emitted a node per
 * `snapshot.evidence` entry at `LANE_INDEX.evidence`, and `PromiseGraph` has rendered a
 * chip for it. The lane was invisible only because `snapshot.evidence` was `[]` until
 * evidence curation was fixed, so the one assertion that mattered, that a declared pack
 * becomes a painted node with an edge arriving at it, was not writable. It is now: the
 * committed snapshot declares one pack, and nine `evidence` edges resolve to it.
 *
 * ## The edges this snapshot used to drop, and why the last block changed subject
 *
 * There were six, then four, and there are none. All six named one pack id:
 *
 *     ev_a1039478-409c-4213-a5e8-fcf8480a56f8-2.evidence
 *
 * the slug of a directory called `a1039478-…-fcf8480a56f8 2.evidence`, a filesystem
 * conflict copy, the ` 2` a copying tool appended when it found the name taken. That
 * duplicate pack was never committed under `apps/ledger/public/evidence/`, so the
 * projection cleared the naming promises' `evidencePackId` and dropped the `evidence`
 * edges that would have arrived at it. Authoring `tests/kept_badge_endpoint_test.md` live
 * and replaying the whole recorded suite re-attributed every promise carrying a verdict to
 * one run and one sealed pack, and the id left the graph entirely.
 *
 * The behaviour is still worth pinning, because the alternative is worse than an absent
 * edge: an edge whose target resolves to nothing is a line the reader follows to a blank,
 * and a graph that draws one is lying more loudly than a graph that draws nothing. So the
 * last block asserts two separate things: that this commit drops nothing, and that the
 * Ledger would still refuse an unresolvable reference, measured over a snapshot
 * constructed by bending one promise back onto that id. Its own note explains why it is
 * arranged that way rather than counting a set that is now empty.
 *
 * ## Two facts about the environment, stated rather than worked around
 *
 *   - jsdom implements no `ResizeObserver`, so `_dom.tsx` supplies one. It is a shim for a
 *     browser API, not a mock of anything the Ledger wrote.
 *   - jsdom does no layout, so React Flow measures no handle and therefore paints no edge
 *     path. Edges are asserted where they are real: over `layoutSnapshot`, which is the
 *     function that decides whether an edge exists at all. Claiming a drawn edge from a
 *     tree that cannot draw one would be the emptiest kind of green.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { LedgerSnapshot, SnapshotDiagnostic, SnapshotEvidence } from '@kept/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LANE_WORDS } from '../components/LaneNode.js';
import { PromiseGraph } from '../components/PromiseGraph.js';
import { PANEL_WORDS } from '../components/PromisePanel.js';
import { navOrder } from '../lib/graphNav.js';
import {
  LANE_INDEX,
  LANE_X,
  NODE_SIZE,
  layoutSnapshot,
  type EvidenceLayoutNode,
  type GraphLayout,
} from '../lib/layout.js';
import { snapshot } from '../lib/snapshot.js';

import { installBrowserShims } from './_dom.js';

installBrowserShims();

afterEach(cleanup);

/** Lane 3: the rightmost column, and the subject of this file. */
const EVIDENCE_LANE = LANE_INDEX.evidence;

const LAYOUT = layoutSnapshot(snapshot);
const ORDER = navOrder(LAYOUT);

/** Every pack the committed snapshot declares. */
const PACKS: readonly SnapshotEvidence[] = snapshot.evidence;

/** Every `evidence` edge the committed snapshot carries. */
const EVIDENCE_EDGES = snapshot.edges.filter((edge) => edge.kind === 'evidence');

/** Every promise that names a pack, in snapshot order. */
const PROMISES_WITH_PACK = snapshot.promises.filter(
  (promise) => promise.evidencePackId !== null,
);

/** The diagnostics recording an edge the projection refused to publish. */
const DROPPED_EDGES: readonly SnapshotDiagnostic[] = snapshot.diagnostics.filter(
  (diagnostic) => diagnostic.code === 'snapshot-edge-unresolved',
);

/**
 * The pack ids those diagnostics name, read out of their messages rather than typed in.
 *
 * The message is the only place a dropped edge survives, so the id is quoted out of it:
 * hard-coding the literal would let a *different* stale id pass this file unnoticed. Empty
 * on this commit, because nothing is dropped, and asserted to be empty rather than left to
 * be quietly so.
 */
const DROPPED_TARGETS: readonly string[] = DROPPED_EDGES.map((diagnostic) => {
  const quoted = /names '([^']+)'/.exec(diagnostic.message);
  return quoted?.[1] ?? '';
});

/** The committed snapshot with every pack and every evidence reference removed. */
const NO_PACK: LedgerSnapshot = {
  ...snapshot,
  evidence: [],
  edges: snapshot.edges.filter((edge) => edge.kind !== 'evidence'),
  promises: snapshot.promises.map((promise) => ({ ...promise, evidencePackId: null })),
};

/**
 * The conflict-copy pack id this repository actually carried, kept verbatim.
 *
 * `ev_<uuid>-2.evidence` is the slug of a directory named `<uuid> 2.evidence`, the ` 2`
 * appended by a copying tool that found the name taken. The pack was never committed
 * under `apps/ledger/public/evidence/`, so six promises and two runs named a pack that
 * did not exist. The projection cleared them and dropped their edges, and the committed
 * file no longer carries the id at all.
 *
 * It is kept here as a literal because the Ledger's behaviour when handed such a
 * reference is worth asserting whether or not the repository is currently suffering
 * from one, and because a real id is a better fixture than an invented one.
 */
const STALE_PACK_ID = 'ev_a1039478-409c-4213-a5e8-fcf8480a56f8-2.evidence';

/** The promise this file uses to carry the unresolvable reference. */
const RETARGETED = PROMISES_WITH_PACK[0] as LedgerSnapshot['promises'][number];

/**
 * The committed snapshot with one promise's pack reference bent to {@link STALE_PACK_ID}
 * and its evidence edge redirected there with it: a snapshot naming a pack it does not
 * declare.
 *
 * This is deliberately *not* a snapshot `parseSnapshot` would accept. §9.1's evidence
 * rule rejects an unresolvable reference, which is exactly why the projection clears one
 * before writing the file. So this shape can never arrive from disk, and the Ledger is
 * asserted against it anyway, because "the file is valid" and "the renderer would cope
 * if it were not" are different guarantees and only the second one is a defence.
 */
const WITH_STALE_PACK: LedgerSnapshot = {
  ...snapshot,
  promises: snapshot.promises.map((promise) =>
    promise.id === RETARGETED.id ? { ...promise, evidencePackId: STALE_PACK_ID } : promise,
  ),
  edges: snapshot.edges.map((edge) =>
    edge.kind === 'evidence' && edge.from === RETARGETED.id
      ? { ...edge, to: STALE_PACK_ID }
      : edge,
  ),
};

function evidenceNodes(layout: GraphLayout): readonly EvidenceLayoutNode[] {
  return layout.nodes.filter((node): node is EvidenceLayoutNode => node.kind === 'evidence');
}

/** The one `role="application"` element in the tree: the graph's canvas (§10.8). */
function canvasOf(container: HTMLElement): HTMLElement {
  const canvas = container.querySelector<HTMLElement>('[role="application"]');
  expect(canvas, 'no canvas is painted, so there is no lane to assert').not.toBeNull();
  return canvas as HTMLElement;
}

/** `keydown` on the canvas, wrapped so React has flushed before the assertion. */
function press(canvas: HTMLElement, key: string): void {
  act(() => {
    fireEvent.keyDown(canvas, { key });
  });
}

function focusedPromiseId(container: HTMLElement): string | null {
  const active = container.ownerDocument.activeElement;
  return active instanceof HTMLElement
    ? (active.getAttribute('data-promise-node') ?? null)
    : null;
}

/** Every evidence chip in the painted tree. */
function evidenceChips(container: HTMLElement): readonly HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-lane="evidence"]')];
}

beforeEach(() => {
  /* a clean URL, so no other suite's `?p=` opens a panel in this one */
  window.history.replaceState(null, '', '/');
});

/* ─────────────────── what the committed snapshot actually declares ─────────────────── */

describe('the evidence this snapshot carries, measured rather than assumed', () => {
  /**
   * The figures task 21.4 stated were one pack of 37 artefacts, two resolving evidence
   * edges and six dropped ones. **They have moved, because the graph earned a second
   * pack**, and they are restated here rather than loosened.
   *
   * Task 22.2 re-verified two promises live, which sealed a second pack of 20 artefacts
   * and moved those two promises onto it. So the committed file now declares two packs
   * and four resolving edges, and four of the previously dropped six resolved as a
   * consequence: the two promises that moved to the new pack no longer name the stale
   * conflict-copy id, and neither do the two runs that named it.
   *
   * The shape of the claim is unchanged and is what actually matters: every declared
   * pack is committed, every edge that resolves points at a pack this file carries, and
   * every edge that does not resolve is dropped and diagnosed rather than published as
   * an edge to nothing. The counts are kept as one assertion so a curation change fails
   * here with its arithmetic in view.
   */
  it('declares one pack of 59 artefacts, and an edge for every promise naming it', () => {
    /* The counts moved again, for the best reason available: a whole-suite replay
       re-verified every recorded member in one run, so all nine promises that carry a
       verdict earned it from that run and name its single sealed pack. The earlier
       two-pack state was two runs' worth of history; this is one run's.
     *
     * The invariant is what matters rather than the arithmetic, and it is now at its
     * strongest it has ever been: every promise carrying a pack has a resolving edge to
     * it, and **nothing is dropped at all**. The stale conflict-copy id that produced
     * first six and then four dropped edges is gone from the graph, because every
     * promise was re-attributed by a run that post-dates it. */
    expect(PACKS).toHaveLength(1);
    expect(PACKS.reduce((total, pack) => total + pack.artifacts.length, 0)).toBe(59);
    expect(EVIDENCE_EDGES).toHaveLength(9);
    expect(PROMISES_WITH_PACK).toHaveLength(9);
    expect(DROPPED_EDGES).toHaveLength(0);
  });

  it('resolves every edge it publishes against a pack it actually carries', () => {
    // The invariant behind the counts above, so a future curation change that keeps the
    // arithmetic but breaks the referencing still fails.
    const declared = new Set(PACKS.map((pack) => pack.id));
    for (const edge of EVIDENCE_EDGES) {
      expect(declared, `the evidence edge to ${edge.to} names a pack this file has no node for`)
        .toContain(edge.to);
    }
  });
});

/* ────────────── one lane-3 node per declared pack (§10.3, task 21.4 #1) ───────────── */

describe('the evidence lane paints one node per declared pack', () => {
  it('places exactly one lane-3 node per pack, in the evidence lane and nowhere else', () => {
    const packed = evidenceNodes(LAYOUT);
    expect(packed).toHaveLength(PACKS.length);
    expect(packed.map((node) => node.id).sort()).toStrictEqual(
      PACKS.map((pack) => pack.id).sort(),
    );
    for (const node of packed) {
      expect(node.lane).toBe(EVIDENCE_LANE);
      expect(node.x).toBe(LANE_X[EVIDENCE_LANE]);
      expect({ width: node.width, height: node.height }).toStrictEqual(NODE_SIZE.evidence);
      expect(node.verdict, 'a pack is context, so it is not a verdict of anything').toBeNull();
    }
    expect(LAYOUT.laneRows[EVIDENCE_LANE]).toBe(PACKS.length);
  });

  it('paints one chip per pack, naming the pack it is', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const chips = evidenceChips(container);
      expect(
        chips,
        'the evidence lane paints nothing, which is what it did for every render before ' +
          'curation was fixed',
      ).toHaveLength(PACKS.length);
      for (const pack of PACKS) {
        const chip = chips.find((candidate) => candidate.textContent?.includes(pack.id));
        expect(chip, `no chip names pack ${pack.id}`).toBeDefined();
      }
    } finally {
      unmount();
    }
  });
});

/* ─────── an evidence edge arrives from every promise that names it (#2) ─────── */

describe('an evidence edge reaches the pack from each promise that names it', () => {
  it('resolves one edge per naming promise, and resolves both of its endpoints', () => {
    const placed = new Set(LAYOUT.nodes.map((node) => node.id));
    const laid = LAYOUT.edges.filter((edge) => edge.kind === 'evidence');
    expect(laid).toHaveLength(EVIDENCE_EDGES.length);

    for (const promise of PROMISES_WITH_PACK) {
      const arriving = laid.filter(
        (edge) => edge.from === promise.id && edge.to === promise.evidencePackId,
      );
      expect(
        arriving,
        `promise ${promise.id} names pack ${String(promise.evidencePackId)} and no edge ` +
          `reaches it, so the panel and the graph disagree about the same fact`,
      ).toHaveLength(1);
      expect(placed.has(promise.id)).toBe(true);
      expect(placed.has(promise.evidencePackId ?? '')).toBe(true);
    }
  });

  it('lands every evidence edge on a painted lane-3 node, so none points at nothing', () => {
    const packed = new Set(evidenceNodes(LAYOUT).map((node) => node.id));
    for (const edge of LAYOUT.edges.filter((edge) => edge.kind === 'evidence')) {
      expect(
        packed.has(edge.to),
        `${edge.id} arrives at ${edge.to}, which is not a node in the evidence lane`,
      ).toBe(true);
    }
    expect(LAYOUT.danglingEdges, 'an edge to nothing is worse than an absent edge').toStrictEqual(
      [],
    );
  });
});

/* ────────── the pack is reachable by keyboard, and it is named (#3) ────────── */

describe('the evidence a promise names is keyboard reachable, and named', () => {
  it('names the chip in words and in full, and adds no tab stop of its own', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      for (const chip of evidenceChips(container)) {
        const text = chip.textContent ?? '';
        /* the accessible name is the chip's own contents: the kind in prose, then the id */
        expect(text).toContain(LANE_WORDS.evidence);
        const name = chip.querySelector<HTMLElement>('.lane-node__name');
        expect(name, 'the chip carries no name element').not.toBeNull();
        const id = name?.getAttribute('title') ?? '';
        expect(PACKS.map((pack) => pack.id)).toContain(id);
        expect(
          text,
          'the id is titled but not written, so a reader sees a chip that will not say ' +
            'which pack it is',
        ).toContain(id);
        /* context, not a subject: §10.3 keeps the three context lanes out of the tab order,
           because everything they carry is repeated in the panel, which is the surface a
           keyboard reader works in */
        expect(chip.getAttribute('tabindex')).toBeNull();
        expect(chip.getAttribute('role')).toBeNull();
      }
      expect(
        container.querySelectorAll('[tabindex="0"]'),
        'one Tab enters the graph; a chip that took a stop of its own would add four',
      ).toHaveLength(1);
    } finally {
      unmount();
    }
  });

  it('reaches the pack and every artefact by keyboard alone, through the promise it proves', () => {
    const promise = PROMISES_WITH_PACK[0];
    expect(promise, 'no promise names a pack, so there is no path to walk').toBeDefined();
    const pack = PACKS.find((candidate) => candidate.id === promise?.evidencePackId);
    expect(pack, 'a promise names a pack this snapshot does not declare').toBeDefined();

    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      const canvas = canvasOf(container);
      canvas.focus();
      press(canvas, 'Home');
      /* ArrowDown until the lane's own order reaches the promise that names the pack:
         no pointer, no click, and no id typed into a URL */
      const steps = ORDER.indexOf(promise?.id ?? '');
      expect(steps, 'the promise is not in the walk order at all').toBeGreaterThanOrEqual(0);
      for (let step = 0; step < steps; step += 1) press(canvas, 'ArrowDown');
      expect(focusedPromiseId(container)).toBe(promise?.id);

      press(canvas, 'Enter');
      const panel = container.querySelector<HTMLElement>('.promise-panel');
      expect(panel, 'Enter opened no panel, so the pack has no keyboard surface').not.toBeNull();
      const text = panel?.textContent ?? '';
      expect(text).toContain(pack?.id);
      expect(
        text,
        'the panel says no pack was sealed for a promise the graph draws an edge from',
      ).not.toContain(PANEL_WORDS.noEvidence);
      expect(text).toContain(PANEL_WORDS.artifactsOpenAway);

      const links = [
        ...(panel?.querySelectorAll<HTMLAnchorElement>('.promise-panel__artifact') ?? []),
      ];
      expect(links).toHaveLength(pack?.artifacts.length ?? -1);
      for (const link of links) {
        expect(link.tagName, 'an artefact a keyboard cannot reach is not a link').toBe('A');
        expect(link.getAttribute('href')).toBeTruthy();
        expect(link.textContent, 'a link with no text has no accessible name').toBeTruthy();
      }

      /* and the first of them actually takes focus, which is the claim */
      const first = links[0];
      expect(first).toBeDefined();
      act(() => first?.focus());
      expect(container.ownerDocument.activeElement).toBe(first);
    } finally {
      unmount();
    }
  });
});

/* ──────── no pack declared: no lane-3 node, and no empty lane (#4) ──────── */

describe('a snapshot declaring no pack paints no lane-3 node and no empty lane', () => {
  it('reserves no row, places no node and leaves no edge dangling', () => {
    const laid = layoutSnapshot(NO_PACK);
    expect(evidenceNodes(laid)).toStrictEqual([]);
    expect(laid.laneRows[EVIDENCE_LANE], 'the lane reserves rows for packs it has not got').toBe(
      0,
    );
    expect(
      laid.nodes.filter((node) => node.x === LANE_X[EVIDENCE_LANE]),
      'something is standing at the evidence lane x with no pack behind it',
    ).toStrictEqual([]);
    expect(laid.edges.filter((edge) => edge.kind === 'evidence')).toStrictEqual([]);
    expect(laid.danglingEdges).toStrictEqual([]);
  });

  it('paints no chip, and paints the other three lanes as it always did', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={NO_PACK} />,
    );
    try {
      expect(evidenceChips(container)).toHaveLength(0);
      /* the absence is the packs, not the graph: documents, promises and designed tests
         are all still there, so this is an empty lane rather than a broken render */
      expect(container.querySelectorAll('[data-lane="document"]')).toHaveLength(
        NO_PACK.documents.length,
      );
      expect(container.querySelectorAll('[data-lane="test"]').length).toBeGreaterThan(0);
      expect(container.querySelectorAll('[data-promise-node]')).toHaveLength(
        NO_PACK.promises.length,
      );
    } finally {
      unmount();
    }
  });

  it('leaves the column caption as the only thing standing over the empty lane', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={NO_PACK} />,
    );
    try {
      /* The four captions are a constant of `LANES`, not a projection of the data, so the
         `Evidence` heading stays put when no pack is declared. It is a label rather than a
         node in the lane: it carries `data-lane-header` instead of `data-lane`, takes no
         role and takes no focus, so neither the keyboard model nor a lane query can mistake
         it for a pack. Measured here rather than assumed, because "no empty lane" and "a
         caption over an empty lane" are different pages. */
      const caption = container.querySelector<HTMLElement>('[data-lane-header="evidence"]');
      expect(caption).not.toBeNull();
      expect(caption?.getAttribute('data-lane')).toBeNull();
      expect(caption?.getAttribute('role')).toBeNull();
      expect(caption?.getAttribute('tabindex')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('says nothing about a pack in the panel of a promise that has none', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={ORDER[0] ?? null} snapshot={NO_PACK} />,
    );
    try {
      const panel = container.querySelector<HTMLElement>('.promise-panel');
      expect(panel).not.toBeNull();
      expect(panel?.textContent).toContain(PANEL_WORDS.noEvidence);
      expect(panel?.querySelectorAll('.promise-panel__artifact')).toHaveLength(0);
    } finally {
      unmount();
    }
  });
});

/* ───────── the dropped edges stay dropped, and stay diagnosed (#5) ───────── */

/**
 * Task 21.4 counted six of these, then four. **There are none now, and this block had to
 * change subject rather than change its arithmetic.**
 *
 * All six named the same stale pack id, `ev_<uuid>-2.evidence`, slugged from a directory
 * a cloud-sync conflict copy had renamed with a trailing space and a 2. Two resolved when
 * task 22.2 re-verified their promises onto a committed pack. The remaining four went when
 * `tests/kept_badge_endpoint_test.md` was authored live and the whole recorded suite was
 * replayed in one run: every promise carrying a verdict was re-attributed to that run and
 * to the single pack it sealed, so nothing in the graph names the conflict copy any more.
 *
 * That left this block asserting a set with nothing in it, which is the quietest way a
 * suite goes wrong. Four tests would have kept passing while proving nothing, and the one
 * behaviour they were written to protect, that the Ledger never draws a line to a pack it
 * has not got, would have gone unguarded at exactly the moment the repository stopped
 * exercising it by accident.
 *
 * So the coverage is kept and its subject is moved. Two things are asserted separately:
 *
 *   - **The committed file drops nothing**, stated as a fact about this commit, so the
 *     block is honest about the state it found rather than silently vacuous.
 *   - **The Ledger still refuses an unresolvable reference**, asserted over
 *     {@link WITH_STALE_PACK}, a snapshot constructed by bending one promise back onto the
 *     conflict-copy id. That is the shape the projection exists to prevent reaching disk,
 *     and the renderer's behaviour when handed it is a defence worth having whether or not
 *     the repository is currently producing one.
 *
 * What is **not** re-asserted here is the diagnostic's own wording and severity. Those are
 * produced by `buildSnapshot`, not by anything in this app, and they moved to
 * `packages/kept-cli/test/snapshot.test.ts`, over a constructed state that actually
 * exercises the projection. Asserting them against literals typed into this file would
 * have been a test of my own typing.
 */
describe('this snapshot drops no edge, and the Ledger would still refuse one', () => {
  it('drops nothing, and names no pack it does not carry', () => {
    expect(
      DROPPED_EDGES,
      'the committed snapshot has started dropping edges again, so some promise names a ' +
        'pack that is not committed under apps/ledger/public/evidence/',
    ).toHaveLength(0);
    expect(DROPPED_TARGETS).toStrictEqual([]);

    /* the positive form of the same statement: every reference resolves */
    const declared = new Set(PACKS.map((pack) => pack.id));
    for (const promise of snapshot.promises) {
      if (promise.evidencePackId === null) continue;
      expect(declared, `promise ${promise.id} names a pack this snapshot does not declare`)
        .toContain(promise.evidencePackId);
    }
    expect(LAYOUT.danglingEdges).toStrictEqual([]);
  });

  it('carries no trace of the conflict copy that produced the earlier drops', () => {
    /* The id is gone from every surface at once, which is what "re-attributed" means:
       not hidden from the render, but absent from the data behind it. */
    expect(snapshot.evidence.map((pack) => pack.id)).not.toContain(STALE_PACK_ID);
    expect(snapshot.promises.map((promise) => promise.evidencePackId)).not.toContain(
      STALE_PACK_ID,
    );
    expect(
      snapshot.edges.filter(
        (edge) => edge.from === STALE_PACK_ID || edge.to === STALE_PACK_ID,
      ),
    ).toStrictEqual([]);
    expect(LAYOUT.nodes.map((node) => node.id)).not.toContain(STALE_PACK_ID);
    expect(snapshot.runs.map((run) => run.evidencePackId)).not.toContain(STALE_PACK_ID);
  });

  it('places no node for a pack the snapshot does not declare', () => {
    const laid = layoutSnapshot(WITH_STALE_PACK);
    /* The lane is sized by `snapshot.evidence`, which the bend did not touch, so a node
       appearing for the stale id would mean the layout trusted an edge endpoint over the
       declared pack list. */
    expect(evidenceNodes(laid)).toHaveLength(PACKS.length);
    expect(laid.nodes.map((node) => node.id)).not.toContain(STALE_PACK_ID);
    expect(laid.laneRows[EVIDENCE_LANE]).toBe(PACKS.length);
  });

  it('holds the unresolvable edge back rather than handing it to the graph', () => {
    const laid = layoutSnapshot(WITH_STALE_PACK);
    /* Not in `edges`, which is what React Flow is given. */
    expect(laid.edges.filter((edge) => edge.to === STALE_PACK_ID)).toStrictEqual([]);
    /* In `danglingEdges`, which is the count a reader can see, so the refusal is visible
       rather than a line that quietly failed to appear. */
    const held = laid.danglingEdges.filter((edge) => edge.to === STALE_PACK_ID);
    expect(
      held,
      'the edge to a missing pack was neither drawn nor held, so it vanished with nothing ' +
        'to say it ever existed',
    ).toHaveLength(1);
    expect(held[0]?.kind).toBe('evidence');
    expect(held[0]?.from).toBe(RETARGETED.id);
    /* And every edge that *is* drawn still lands on a real node. */
    const placed = new Set(laid.nodes.map((node) => node.id));
    for (const edge of laid.edges) {
      expect(placed.has(edge.from) && placed.has(edge.to)).toBe(true);
    }
  });

  it('renders nothing for it: no chip names it, and no edge carries it', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={WITH_STALE_PACK} />,
    );
    try {
      expect(container.textContent ?? '').not.toContain(STALE_PACK_ID);
      /* React Flow keys an edge by the layout's own edge id, so a held edge that reached
         the graph would appear here even though jsdom paints no path for it */
      for (const edge of container.querySelectorAll('.react-flow__edge')) {
        expect(edge.getAttribute('data-id') ?? '').not.toContain(STALE_PACK_ID);
      }
      expect(evidenceChips(container)).toHaveLength(PACKS.length);
    } finally {
      unmount();
    }
  });

  it('explains the absence in the panel instead of linking into the missing pack', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={RETARGETED.id} snapshot={WITH_STALE_PACK} />,
    );
    try {
      const panel = container.querySelector<HTMLElement>('.promise-panel');
      expect(panel).not.toBeNull();
      const text = panel?.textContent ?? '';
      /* The panel resolves the id against `snapshot.evidence` and gets nothing, so it says
         no pack was sealed. A reader is told there is nothing to open, which is true, and
         is never handed a link into a directory the repository does not contain. */
      expect(text).toContain(PANEL_WORDS.noEvidence);
      expect(text).not.toContain(STALE_PACK_ID);
      expect(panel?.querySelectorAll('.promise-panel__artifact')).toHaveLength(0);
    } finally {
      unmount();
    }
  });
});
