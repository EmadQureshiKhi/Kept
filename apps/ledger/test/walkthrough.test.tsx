/**
 * The guided verification chain: `lib/walkthrough.ts` as the argument, `Walkthrough` as the dialog,
 * and `PromiseGraph` as the page that offers it. Design §8.1, §8.3, §10.2, §10.8, R7.3, R8.2, R8.3,
 * R10.7.
 *
 * The reason this exists: the product's strongest claim is a chain of five facts, and following it
 * meant knowing to click four things in the right order across two routes. Every fact was already
 * published. None of them was a sequence.
 *
 * Three groups carry the weight.
 *
 * **The chain is built from what exists, never padded.** A promise with no designed test, no
 * evidence, no repair or no amendment gets fewer steps rather than a step reading "none". A
 * walkthrough that padded itself to five would teach a reader that a step can be empty, and then the
 * empty ones stop being read. So the length of the sequence is itself a fact, and the tests drive
 * promises with pieces missing to prove it.
 *
 * **The two-moments caveat.** The committed snapshot holds a `code-break` verdict from 26 August and
 * a documentation amendment proposed on 21 August, about the same line of the same file. Shown back
 * to back with no dates, step four says the code is wrong and step five offers to edit the
 * documentation, which reads as the tool arguing with itself. It is two moments. `orderCaveat` says
 * so, and it deliberately says nothing when the amendment came *after* the verdict, because then the
 * two really are one decision and a caveat would invent a problem. Both directions are tested.
 *
 * **It is honestly modal.** `aria-modal="true"` tells assistive technology the rest of the document
 * is unavailable. A dialog that claims that and then lets `Tab` walk into the page behind it has
 * lied to the one reader relying on it, so the trap is asserted in both directions rather than
 * inferred from the attribute.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { LedgerSnapshot, SnapshotPromise } from 'kept-core';
import { afterEach, describe, expect, it } from 'vitest';

import { PromiseGraph } from '../components/PromiseGraph.js';
import { PANEL_WORDS, PromisePanel } from '../components/PromisePanel.js';
import {
  WALKTHROUGH_WORDS,
  Walkthrough,
  stepImageAlt,
  walkthroughLabel,
} from '../components/Walkthrough.js';
import { snapshot } from '../lib/snapshot.js';
import {
  NOTHING_TO_EXPLAIN,
  STEP_HEADINGS,
  STEP_LEDES,
  WALKTHROUGH_TRIGGER,
  WALKTHROUGH_TRIGGER_KEPT,
  amendmentFor,
  hasWalkthrough,
  orderCaveat,
  stepAt,
  stepCounter,
  walkthroughSteps,
  walkthroughTriggerLabel,
} from '../lib/walkthrough.js';

import { installBrowserShims } from './_dom.js';

installBrowserShims();

afterEach(cleanup);

/** The promise the whole feature exists for. */
const RED = snapshot.promises.find((promise) => promise.verdict === 'red') ?? null;

/** A snapshot with one promise replaced, so a missing piece can be driven. */
function withPromise(overrides: Partial<SnapshotPromise>): LedgerSnapshot {
  const base = RED as SnapshotPromise;
  return {
    ...snapshot,
    promises: snapshot.promises.map((promise) =>
      promise.id === base.id ? { ...promise, ...overrides } : promise,
    ),
  };
}

/* ───────────────────────── the chain, as arithmetic ──────────────────────────── */

describe('walkthroughSteps builds the chain out of what the snapshot carries', () => {
  it('finds all five links for the red promise, in order', () => {
    expect(RED, 'the committed snapshot carries no red promise').not.toBeNull();
    if (RED === null) return;
    const steps = walkthroughSteps(snapshot, RED.id);
    expect(steps.map((step) => step.kind)).toEqual([
      'claim',
      'test',
      'evidence',
      'router',
      'amendment',
    ]);
    /* Nothing is invented and nothing is a placeholder: each step says what it is for and carries
       at least one checkable fact. */
    for (const step of steps) {
      expect(step.heading).toBe(STEP_HEADINGS[step.kind]);
      expect(step.lede).toBe(STEP_LEDES[step.kind]);
      expect(step.facts.length).toBeGreaterThan(0);
    }
  });

  it('quotes the claim off disk, untrimmed', () => {
    if (RED === null) return;
    const claim = walkthroughSteps(snapshot, RED.id)[0];
    /* `citation.text` is what the admission gate read (R1.3). Character-exact, because a sequence
       that tidied the line it quotes could not be checked against the file. */
    expect(claim?.quote).toBe(RED.citation.text);
    expect(claim?.facts.some((fact) => fact.value === `${RED.citation.file}:${String(RED.citation.line)}`)).toBe(
      true,
    );
  });

  it('quotes the router in the verification tool\u2019s own words', () => {
    if (RED === null || RED.repair === null) return;
    const router = walkthroughSteps(snapshot, RED.id).find((step) => step.kind === 'router');
    /* The one piece of prose on the site this repository did not write. */
    expect(router?.quote).toBe(RED.repair.rationale);
    expect(router?.facts.some((fact) => fact.value === RED.repair?.branch)).toBe(true);
  });

  it('shows a capture rather than a manifest of captures', () => {
    if (RED === null) return;
    const evidence = walkthroughSteps(snapshot, RED.id).find((step) => step.kind === 'evidence');
    expect(evidence?.image, 'the evidence step draws nothing').not.toBeNull();
    expect(evidence?.image ?? '').toMatch(/\.(png|jpe?g|gif|webp|avif)$/i);
    /* And it says how much else is in the pack, because the count is the fact the picture cannot
       carry. */
    const pack = snapshot.evidence.find((entry) => entry.id === RED.evidencePackId);
    expect(evidence?.facts.some((fact) => fact.value === String(pack?.artifacts.length))).toBe(true);
  });

  it('links the amendment to its own route rather than restating it', () => {
    if (RED === null) return;
    const amendment = amendmentFor(snapshot, RED.id);
    expect(amendment, 'no amendment is recorded against the red promise').not.toBeNull();
    const step = walkthroughSteps(snapshot, RED.id).find((entry) => entry.kind === 'amendment');
    expect(step?.quote).toBe(amendment?.proposedText);
    /* The sha256 interlock and the accept command live on the card, and this sequence does not
       duplicate them. */
    expect(step?.link?.href).toBe(`/amendments#${amendment?.id ?? ''}`);
  });

  it('drops a step rather than stating it as absent', () => {
    if (RED === null) return;
    const noTest = walkthroughSteps(withPromise({ designedTest: null }), RED.id);
    expect(noTest.map((step) => step.kind)).not.toContain('test');

    const noEvidence = walkthroughSteps(withPromise({ evidencePackId: null }), RED.id);
    expect(noEvidence.map((step) => step.kind)).not.toContain('evidence');

    const noRepair = walkthroughSteps(withPromise({ repair: null }), RED.id);
    expect(noRepair.map((step) => step.kind)).not.toContain('router');

    /* And the claim is never dropped: it is what a promise is. */
    for (const steps of [noTest, noEvidence, noRepair]) {
      expect(steps[0]?.kind).toBe('claim');
    }
  });

  it('answers nothing for an id the snapshot has never carried', () => {
    /* A promise can leave a snapshot between a link being shared and the link being opened. */
    expect(walkthroughSteps(snapshot, 'p_deadbeefdead')).toEqual([]);
    expect(hasWalkthrough(snapshot, 'p_deadbeefdead')).toBe(false);
  });

  it('withholds the sequence when the only step is the claim', () => {
    if (RED === null) return;
    const bare = withPromise({ designedTest: null, evidencePackId: null, repair: null });
    /* One step is a page, not a sequence, and the amendment is still on file so this needs it gone
       too before the chain collapses. */
    const stripped: LedgerSnapshot = { ...bare, amendments: [] };
    expect(walkthroughSteps(stripped, RED.id)).toHaveLength(1);
    expect(hasWalkthrough(stripped, RED.id)).toBe(false);
  });

  it('prefers a pending amendment over a settled one', () => {
    if (RED === null) return;
    const pending = amendmentFor(snapshot, RED.id);
    expect(pending?.status).toBe('pending');
    /* A reader is shown the decision still waiting on them, not a record of one already made. */
    const settled = {
      ...snapshot,
      amendments: snapshot.amendments.map((entry) => ({ ...entry, status: 'accepted' as const })),
    };
    expect(amendmentFor(settled, RED.id)?.id).toBe(pending?.id);
  });

  it('counts from one and clamps at both ends', () => {
    expect(stepCounter(0, 5)).toBe('1 of 5');
    expect(stepCounter(4, 5)).toBe('5 of 5');
    expect(stepAt(0, 5, -1)).toBe(0);
    expect(stepAt(4, 5, 1)).toBe(4);
    expect(stepAt(2, 5, 1)).toBe(3);
    expect(stepAt(0, 0, 1)).toBe(0);
  });

  it('keeps the kept-promise copy available, so the trigger never asks a false question', () => {
    expect(WALKTHROUGH_TRIGGER).toContain('red');
    expect(WALKTHROUGH_TRIGGER_KEPT).not.toContain('red');
    expect(NOTHING_TO_EXPLAIN.length).toBeGreaterThan(0);
    if (RED !== null) expect(walkthroughTriggerLabel(RED)).toContain(RED.id);
  });
});

/* ─────────────────── the caveat that keeps steps four and five honest ────────── */

describe('the sequence says when two steps are two moments', () => {
  it('warns when the proposal predates the verdict, naming both instants', () => {
    if (RED === null) return;
    const decidedAt = RED.verdictSource?.at ?? null;
    const amendment = amendmentFor(snapshot, RED.id);
    expect(decidedAt, 'the red promise carries no verdict source').not.toBeNull();
    expect(amendment).not.toBeNull();
    if (decidedAt === null || amendment === null) return;

    /* This is the real shape of the committed data: the amendment is the older record. */
    expect(amendment.createdAt < decidedAt).toBe(true);

    const step = walkthroughSteps(snapshot, RED.id).find((entry) => entry.kind === 'amendment');
    expect(step?.caveat, 'the two moments are shown with no explanation').not.toBeNull();
    expect(step?.caveat).toContain(amendment.createdAt);
    expect(step?.caveat).toContain(decidedAt);
    expect(step?.caveat).toContain('two moments');
  });

  it('says nothing when the proposal came after the verdict', () => {
    /* Then they really are one decision, and a caveat would invent a problem. */
    expect(orderCaveat('2026-08-21T00:00:00.000Z', '2026-08-26T00:00:00.000Z')).toBeNull();
    expect(orderCaveat(null, '2026-08-26T00:00:00.000Z')).toBeNull();
    expect(orderCaveat('2026-08-26T00:00:00.000Z', '2026-08-26T00:00:00.000Z')).toBeNull();
  });

  it('warns when it predates, on constructed instants too', () => {
    const caveat = orderCaveat('2026-08-26T00:00:00.000Z', '2026-08-21T00:00:00.000Z');
    expect(caveat).not.toBeNull();
    expect(caveat).toContain('2026-08-21T00:00:00.000Z');
    expect(caveat).toContain('2026-08-26T00:00:00.000Z');
  });
});

/* ──────────────────────────── the dialog, rendered ──────────────────────────── */

describe('Walkthrough is a dialog that walks', () => {
  const STEPS = RED === null ? [] : walkthroughSteps(snapshot, RED.id);

  function open(index = 0) {
    const state = { index, closed: false };
    const view = render(
      <Walkthrough
        index={index}
        onClose={() => {
          state.closed = true;
        }}
        onIndexChange={(next) => {
          state.index = next;
        }}
        promise={RED as SnapshotPromise}
        steps={STEPS}
      />,
    );
    return { ...view, state };
  }

  it('is modal, named by the promise and the step it is on', () => {
    const { container, unmount } = open(2);
    try {
      const dialog = container.querySelector('[role="dialog"]');
      expect(dialog?.getAttribute('aria-modal')).toBe('true');
      expect(dialog?.getAttribute('aria-label')).toBe(
        walkthroughLabel(RED as SnapshotPromise, 2, STEPS.length),
      );
      expect(dialog?.getAttribute('data-step')).toBe(STEPS[2]?.kind);
    } finally {
      unmount();
    }
  });

  it('maps the whole argument in a rail, marking where the reader is', () => {
    const { container, unmount } = open(1);
    try {
      const stops = [...container.querySelectorAll('.walkthrough__stop')];
      /* A reader can see how long the argument is before committing to it, which is the difference
         between a sequence and a series of surprises. */
      expect(stops).toHaveLength(STEPS.length);
      expect(stops.map((stop) => stop.textContent)).toEqual(
        STEPS.map((step, at) => `${String(at + 1)}${step.heading}`),
      );
      const current = stops.filter((stop) => stop.getAttribute('aria-current') === 'true');
      expect(current, 'exactly one stop is current').toHaveLength(1);
      expect(current[0]?.textContent).toContain(STEPS[1]?.heading ?? '');
    } finally {
      unmount();
    }
  });

  it('jumps to any stop from the rail', () => {
    const { container, state, unmount } = open(0);
    try {
      const stops = [...container.querySelectorAll<HTMLButtonElement>('.walkthrough__stop')];
      act(() => {
        fireEvent.click(stops[3] as HTMLButtonElement);
      });
      expect(state.index).toBe(3);
    } finally {
      unmount();
    }
  });

  it('renders the step: its heading, its argument, its facts and its bytes', () => {
    const { container, unmount } = open(0);
    try {
      const step = STEPS[0];
      expect(container.querySelector('.walkthrough__heading')?.textContent).toBe(step?.heading);
      expect(container.querySelector('.walkthrough__lede')?.textContent).toBe(step?.lede);
      expect(container.querySelector('.walkthrough__quote')?.textContent).toBe(step?.quote);
      const terms = [...container.querySelectorAll('.walkthrough__term')].map((t) => t.textContent);
      expect(terms).toEqual(step?.facts.map((fact) => fact.term));
    } finally {
      unmount();
    }
  });

  it('draws the capture with provenance for alt text, not a description of pixels', () => {
    const at = STEPS.findIndex((step) => step.image !== null);
    expect(at).toBeGreaterThanOrEqual(0);
    const { container, unmount } = open(at);
    try {
      const image = container.querySelector<HTMLImageElement>('.walkthrough__image');
      expect(image?.getAttribute('src')).toBe(STEPS[at]?.image);
      /* Nothing here has looked at the pixels, so the alt text says what the image *is*. */
      expect(image?.getAttribute('alt')).toBe(stepImageAlt(STEPS[at] as never));
      expect(image?.getAttribute('loading')).toBe('lazy');
    } finally {
      unmount();
    }
  });

  it('shows the caveat where the data has one, and nowhere else', () => {
    const withCaveat = STEPS.findIndex((step) => step.caveat !== null);
    expect(withCaveat).toBeGreaterThanOrEqual(0);

    const shown = open(withCaveat);
    expect(shown.container.querySelector('.walkthrough__caveat-text')?.textContent).toBe(
      STEPS[withCaveat]?.caveat,
    );
    expect(shown.container.textContent).toContain(WALKTHROUGH_WORDS.caveat);
    shown.unmount();

    const clean = STEPS.findIndex((step) => step.caveat === null);
    const hidden = open(clean);
    expect(hidden.container.querySelector('.walkthrough__caveat')).toBeNull();
    hidden.unmount();
  });

  it('closes on the control, on Escape, and on the backdrop', () => {
    for (const shut of [
      (container: HTMLElement) => {
        fireEvent.click(container.querySelector('.walkthrough__close') as Element);
      },
      (container: HTMLElement) => {
        fireEvent.keyDown(container.querySelector('.walkthrough') as Element, { key: 'Escape' });
      },
      (container: HTMLElement) => {
        fireEvent.click(container.querySelector('.walkthrough') as Element);
      },
    ]) {
      const { container, state, unmount } = open();
      act(() => {
        shut(container);
      });
      expect(state.closed).toBe(true);
      unmount();
    }
  });

  it('does not close on a click that lands on the plate', () => {
    const { container, state, unmount } = open();
    try {
      act(() => {
        fireEvent.click(container.querySelector('.walkthrough__plate') as Element);
      });
      expect(state.closed).toBe(false);
    } finally {
      unmount();
    }
  });

  it('walks with the arrow keys and with the two controls', () => {
    const { container, state, unmount } = open(1);
    try {
      const backdrop = container.querySelector('.walkthrough') as Element;
      act(() => {
        fireEvent.keyDown(backdrop, { key: 'ArrowRight' });
      });
      expect(state.index).toBe(2);
      act(() => {
        fireEvent.keyDown(backdrop, { key: 'ArrowLeft' });
      });
      expect(state.index).toBe(0);

      const controls = [
        ...container.querySelectorAll<HTMLButtonElement>('.walkthrough__step-control'),
      ];
      expect(controls).toHaveLength(2);
      act(() => {
        fireEvent.click(controls[1] as HTMLButtonElement);
      });
      expect(state.index).toBe(2);
    } finally {
      unmount();
    }
  });

  it('disables a control at the end rather than removing it', () => {
    const first = open(0);
    const atFirst = [
      ...first.container.querySelectorAll<HTMLButtonElement>('.walkthrough__step-control'),
    ];
    expect(atFirst[0]?.disabled).toBe(true);
    expect(atFirst[1]?.disabled).toBe(false);
    first.unmount();

    const last = open(STEPS.length - 1);
    const atLast = [
      ...last.container.querySelectorAll<HTMLButtonElement>('.walkthrough__step-control'),
    ];
    expect(atLast[0]?.disabled).toBe(false);
    expect(atLast[1]?.disabled).toBe(true);
    last.unmount();
  });

  it('puts focus on the way out, and keeps Tab inside itself', () => {
    const { container, unmount } = open(1);
    try {
      expect(document.activeElement).toBe(container.querySelector('.walkthrough__close'));

      const stops = [
        ...container.querySelectorAll<HTMLElement>(
          '.walkthrough__plate a[href], .walkthrough__plate button:not([disabled])',
        ),
      ];
      expect(stops.length).toBeGreaterThan(1);
      const firstStop = stops[0] as HTMLElement;
      const lastStop = stops[stops.length - 1] as HTMLElement;
      const backdrop = container.querySelector('.walkthrough') as Element;

      /* `aria-modal="true"` says the rest of the document is unavailable, so letting Tab walk out
         would make that a lie to the one reader relying on it. */
      act(() => {
        lastStop.focus();
        fireEvent.keyDown(backdrop, { key: 'Tab' });
      });
      expect(document.activeElement).toBe(firstStop);

      act(() => {
        firstStop.focus();
        fireEvent.keyDown(backdrop, { key: 'Tab', shiftKey: true });
      });
      expect(document.activeElement).toBe(lastStop);
    } finally {
      unmount();
    }
  });

  it('renders nothing for a step the chain does not hold', () => {
    const { container, unmount } = render(
      <Walkthrough
        index={99}
        onClose={() => undefined}
        onIndexChange={() => undefined}
        promise={RED as SnapshotPromise}
        steps={STEPS}
      />,
    );
    try {
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      unmount();
    }
  });
});

/* ───────────────────── the panel offers it, the graph mounts it ─────────────── */

describe('the way in sits under the claim, and only where there is a chain', () => {
  it('renders no trigger when the caller offers none', () => {
    if (RED === null) return;
    const { container, unmount } = render(<PromisePanel promise={RED} />);
    try {
      expect(container.querySelector('.promise-panel__explain')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('asks the question a reader is asking, and names the promise for a screen reader', () => {
    if (RED === null) return;
    const { container, unmount } = render(
      <PromisePanel onExplain={() => undefined} promise={RED} />,
    );
    try {
      const trigger = container.querySelector('.promise-panel__explain');
      expect(trigger?.textContent).toBe(WALKTHROUGH_TRIGGER);
      expect(trigger?.getAttribute('aria-label')).toBe(walkthroughTriggerLabel(RED));
      /* Directly under the claim, because that is when the question occurs: the reader has just
         read the claim and seen the verdict beside it. */
      const claim = container.querySelector('.promise-panel__claim');
      expect(claim?.nextElementSibling?.querySelector('.promise-panel__explain')).toBe(trigger);
    } finally {
      unmount();
    }
  });

  it('never asks "why is this red?" about a promise that is kept', () => {
    const proven = snapshot.promises.find((promise) => promise.verdict === 'proven') ?? null;
    expect(proven).not.toBeNull();
    if (proven === null) return;
    const { container, unmount } = render(
      <PromisePanel onExplain={() => undefined} promise={proven} />,
    );
    try {
      expect(container.querySelector('.promise-panel__explain')?.textContent).toBe(
        WALKTHROUGH_TRIGGER_KEPT,
      );
    } finally {
      unmount();
    }
  });

  it('opens the chain from the graph and returns focus to the trigger on close', () => {
    if (RED === null) return;
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={RED.id} snapshot={snapshot} />,
    );
    try {
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      const trigger = container.querySelector<HTMLButtonElement>('.promise-panel__explain');
      expect(trigger, 'the panel offers no way into the chain').not.toBeNull();

      act(() => {
        trigger?.focus();
        fireEvent.click(trigger as HTMLButtonElement);
      });
      const dialog = container.querySelector('[role="dialog"]');
      expect(dialog, 'clicking the trigger opened no chain').not.toBeNull();
      expect(dialog?.getAttribute('data-step')).toBe('claim');

      act(() => {
        fireEvent.click(container.querySelector('.walkthrough__close') as Element);
      });
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      /* The same contract `Escape` on a node honours: the way back is where you came from. */
      expect(document.activeElement).toBe(trigger);
    } finally {
      unmount();
    }
  });

  it('closes the chain when the reader selects a different promise', () => {
    if (RED === null) return;
    const other = snapshot.promises.find((promise) => promise.id !== RED.id) ?? null;
    if (other === null) return;

    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={RED.id} snapshot={snapshot} />,
    );
    try {
      act(() => {
        fireEvent.click(container.querySelector('.promise-panel__explain') as Element);
      });
      expect(container.querySelector('[role="dialog"]')).not.toBeNull();

      /* A chain is about one promise. Left open across a change of subject it would show step three
         of the previous argument beside the next promise's panel. */
      act(() => {
        fireEvent.click(
          container.querySelector(`[data-promise-row="${other.id}"]`) as Element,
        );
      });
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('adds no chain to the page until a promise is selected', () => {
    const { container, unmount } = render(
      <PromiseGraph initialSelectedId={null} snapshot={snapshot} />,
    );
    try {
      expect(container.querySelector('.promise-panel__explain')).toBeNull();
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('leaves the panel\u2019s own copy untouched', () => {
    if (RED === null) return;
    const { container, unmount } = render(
      <PromisePanel onExplain={() => undefined} promise={RED} />,
    );
    try {
      /* The trigger is an addition, not a replacement: the panel still says everything it said. */
      expect(container.textContent).toContain(RED.claim);
      expect(container.textContent).toContain(PANEL_WORDS.citation);
      expect(container.textContent).toContain(PANEL_WORDS.designedTest);
    } finally {
      unmount();
    }
  });
});
