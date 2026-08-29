/**
 * The evidence lightbox: `lib/evidenceView.ts` as arithmetic, `EvidenceLightbox` as the
 * dialog, and `PromisePanel` as the surface that opens it. Design §10.2, §10.5, §10.8, R8.3,
 * R10.7.
 *
 * The complaint this answers: the screenshot is where the argument lands, and looking at one
 * used to cost a tab switch. The reader left the graph, looked at a JPEG alone, and came back
 * to find their place.
 *
 * Three groups here carry the weight.
 *
 * **The extension decides, not the kind.** `kind` is Kane's word for what an artefact is *for*
 * and it is a claim rather than a format. A `screenshot` written as a `.yaml` would go into an
 * `<img>` if the kind were trusted, and an `other` that is a PNG would needlessly cost a tab.
 * So both of those cases are constructed and asserted, because neither is in the committed
 * pack and neither would be caught by testing against it.
 *
 * **The dialog is honest about being modal.** `aria-modal="true"` tells assistive technology
 * the rest of the document is unavailable. A dialog that makes that claim and then lets `Tab`
 * walk into the page behind it has lied to the one reader relying on it, so the trap is
 * asserted in both directions rather than assumed from the attribute.
 *
 * **Nothing is taken away.** Every artefact keeps a real `href`, a real `target="_blank"` and
 * a real `rel`, only an unmodified primary click on a bitmap is intercepted, and the file is
 * still linked from inside the viewer. So the last group asserts what still works: a cmd-click
 * opens a tab, a non-image click opens a tab, and closing returns focus to the row.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { SnapshotArtifact, SnapshotEvidence, SnapshotPromise } from 'kept-core';
import { SnapshotEvidenceSchema, SnapshotPromiseSchema } from 'kept-core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  EvidenceLightbox,
  LIGHTBOX_WORDS,
  lightboxAlt,
  lightboxCounter,
  lightboxLabel,
  stepIndex,
} from '../components/EvidenceLightbox.js';
import {
  ARTIFACT_COLLAPSE_AT,
  PANEL_WORDS,
  PromisePanel,
  artifactSummary,
} from '../components/PromisePanel.js';
import {
  VIEWABLE_EXTENSIONS,
  extensionOf,
  isViewableArtifact,
  viewableArtifacts,
  viewableCount,
} from '../lib/evidenceView.js';
import { snapshot } from '../lib/snapshot.js';

afterEach(cleanup);

const CLAIM = 'The Cart screen applies a 10 percent discount automatically above 50 dollars.';

function makePromise(overrides: Partial<SnapshotPromise> = {}): SnapshotPromise {
  return SnapshotPromiseSchema.parse({
    id: 'p_177308118beb',
    claim: CLAIM,
    citation: { file: 'apps/fixture/README.md', line: 19, text: `- ${CLAIM}` },
    designedTest: { path: 'tests/cart_discount_test.md', testId: 'T-1' },
    verdict: 'red',
    verdictSource: null,
    repair: null,
    evidencePackId: 'ev_9f21c4a0',
    providers: ['baseline'],
    credits: null,
    ...overrides,
  });
}

function artifact(
  kind: SnapshotArtifact['kind'],
  name: string,
  bytes = 1_024,
): SnapshotArtifact {
  return { kind, name, publicPath: `/evidence/ev_9f21c4a0/${name}`, bytes };
}

/** Two bitmaps and one document, so the split is visible in one pack. */
function makeEvidence(artifacts?: readonly SnapshotArtifact[]): SnapshotEvidence {
  return SnapshotEvidenceSchema.parse({
    id: 'ev_9f21c4a0',
    kind: 'testrun',
    sealedAt: '2026-08-20T16:17:09.800Z',
    publicPath: '/evidence/ev_9f21c4a0/',
    artifacts:
      artifacts ??
      ([
        artifact('annotated', 'annotated.png', 40_112),
        artifact('failure-yaml', 'failure.yaml'),
        artifact('screenshot', 'step-2.jpg', 22_004),
      ] as const),
  });
}

/* ─────────────────────── which artefacts can be looked at ─────────────────────── */

describe('a viewable artefact is decided by the file, not by its label', () => {
  it('reads the extension off a path, lower cased, or answers null', () => {
    expect(extensionOf('/evidence/ev_1/step-2.JPG')).toBe('jpg');
    expect(extensionOf('/evidence/ev_1/annotated.png')).toBe('png');
    /* A directory with a dot in it must not lend its extension to a file that has none. */
    expect(extensionOf('/evidence/ev_1.evidence/manifest')).toBeNull();
    expect(extensionOf('/evidence/ev_1/trailing.')).toBeNull();
    expect(extensionOf('.hidden')).toBeNull();
  });

  it('admits every bitmap extension and refuses the document formats', () => {
    for (const extension of VIEWABLE_EXTENSIONS) {
      expect(isViewableArtifact({ publicPath: `/e/a.${extension}` }), extension).toBe(true);
    }
    for (const extension of ['yaml', 'har', 'json', 'ndjson', 'log', 'txt', 'md', '']) {
      expect(isViewableArtifact({ publicPath: `/e/a.${extension}` }), extension).toBe(false);
    }
  });

  it('refuses an SVG, because a vector document is not a bitmap', () => {
    /* An SVG loaded through `<img src>` cannot run script, but it is a document rather than a
       picture and the safe default for a format that *can* carry script is the tab the browser
       already sandboxes. No artefact in the committed pack is one, so nothing is lost. */
    expect(isViewableArtifact({ publicPath: '/e/diagram.svg' })).toBe(false);
  });

  it('trusts the extension over the kind, in both directions', () => {
    /* Neither of these is in the committed pack, and both are the reason the kind is not
       consulted: one would put YAML in an image element, the other would send a PNG to a tab. */
    expect(isViewableArtifact(artifact('screenshot', 'mislabelled.yaml'))).toBe(false);
    expect(isViewableArtifact(artifact('other', 'actually-a-capture.png'))).toBe(true);
  });

  it('keeps the pack\u2019s own order, because the captures are a sequence', () => {
    const pack = makeEvidence([
      artifact('screenshot', 'step-3.jpg'),
      artifact('failure-yaml', 'failure.yaml'),
      artifact('screenshot', 'step-1.jpg'),
    ]);
    /* Filtered, never sorted: fifty-six per-step captures are the run in the order it
       happened, and re-sorting them would turn a sequence into a gallery. */
    expect(viewableArtifacts(pack.artifacts).map((a) => a.name)).toEqual([
      'step-3.jpg',
      'step-1.jpg',
    ]);
  });

  it('counts the committed pack, so this is not being tested against nothing', () => {
    const pack = snapshot.evidence[0] ?? null;
    expect(pack, 'the committed snapshot carries no evidence pack').not.toBeNull();
    /* Fifty-six per-step screenshots plus one annotated capture; the two failure documents
       are not viewable. */
    expect(viewableCount(pack)).toBeGreaterThan(0);
    expect(viewableCount(pack)).toBeLessThan(pack?.artifacts.length ?? 0);
    expect(viewableCount(null)).toBe(0);
  });
});

/* ───────────────────────────── the viewer\u2019s own words ────────────────────── */

describe('the viewer says which artefact it is showing', () => {
  it('names the dialog by the artefact and its place in the pack', () => {
    expect(lightboxLabel(artifact('screenshot', 'step-2.jpg'), 1, 57)).toBe(
      'step-2.jpg, artefact 2 of 57',
    );
  });

  it('counts from one, because a reader does', () => {
    expect(lightboxCounter(0, 57)).toBe('1 of 57');
    expect(lightboxCounter(56, 57)).toBe('57 of 57');
  });

  it('describes what the image is rather than claiming to describe what is in it', () => {
    /* Nothing on this page has looked at the pixels. The alt text carries provenance: the
       kind and the step it came from. That is the honest limit of what is known, and it is
       what lets a reader who cannot see the capture go to the file itself. */
    const alt = lightboxAlt(artifact('screenshot', 'step-2.jpg'));
    expect(alt).toBe(`${LIGHTBOX_WORDS.altPrefix}: screenshot, step-2.jpg`);
  });

  it('clamps a step at both ends rather than wrapping', () => {
    /* The same rule the graph\u2019s keyboard walk uses: holding an arrow key stops at the last
       capture instead of silently starting the run again from the top, so "am I at the end" is
       answerable without counting. */
    expect(stepIndex(0, 3, -1)).toBe(0);
    expect(stepIndex(2, 3, 1)).toBe(2);
    expect(stepIndex(1, 3, 1)).toBe(2);
    expect(stepIndex(1, 3, -1)).toBe(0);
    expect(stepIndex(0, 0, 1)).toBe(0);
  });
});

/* ──────────────────────────── the dialog, rendered ───────────────────────────── */

describe('EvidenceLightbox is a dialog, and behaves like one', () => {
  const ARTIFACTS: readonly SnapshotArtifact[] = [
    artifact('annotated', 'annotated.png'),
    artifact('screenshot', 'step-1.jpg'),
    artifact('screenshot', 'step-2.jpg'),
  ];

  function open(index = 0) {
    const state = { index, closed: false };
    const view = render(
      <EvidenceLightbox
        artifacts={ARTIFACTS}
        index={index}
        onClose={() => {
          state.closed = true;
        }}
        onIndexChange={(next) => {
          state.index = next;
        }}
        packId="ev_9f21c4a0"
      />,
    );
    return { ...view, state };
  }

  it('draws the artefact, with a name and a modal role', () => {
    const { container, unmount } = open(1);
    try {
      const dialog = container.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
      expect(dialog?.getAttribute('aria-modal')).toBe('true');
      expect(dialog?.getAttribute('aria-label')).toBe(
        lightboxLabel(ARTIFACTS[1] as SnapshotArtifact, 1, 3),
      );

      const image = container.querySelector<HTMLImageElement>('.evidence-lightbox__image');
      expect(image?.getAttribute('src')).toBe(ARTIFACTS[1]?.publicPath);
      expect(image?.getAttribute('alt')).toBe(lightboxAlt(ARTIFACTS[1] as SnapshotArtifact));
      /* Fifty-nine rows and one ever open, so nothing is fetched until it is asked for. */
      expect(image?.getAttribute('loading')).toBe('lazy');
    } finally {
      unmount();
    }
  });

  it('puts focus on the way out the moment it appears', () => {
    const { container, unmount } = open();
    try {
      /* The close control is what a reader most needs to reach the instant a dialog covers the
         page, and an `<img>` is not focusable anyway. */
      expect(document.activeElement).toBe(container.querySelector('.evidence-lightbox__close'));
    } finally {
      unmount();
    }
  });

  it('closes on the control, on Escape, and on the backdrop', () => {
    for (const shut of [
      (container: HTMLElement) => {
        fireEvent.click(container.querySelector('.evidence-lightbox__close') as Element);
      },
      (container: HTMLElement) => {
        fireEvent.keyDown(container.querySelector('.evidence-lightbox') as Element, {
          key: 'Escape',
        });
      },
      (container: HTMLElement) => {
        /* The backdrop itself, not merely "something that is not the plate": a drag that
           started on the plate and ended outside it must not close the viewer. */
        fireEvent.click(container.querySelector('.evidence-lightbox') as Element);
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

  it('does not close when the click lands on the plate', () => {
    const { container, state, unmount } = open();
    try {
      act(() => {
        fireEvent.click(container.querySelector('.evidence-lightbox__plate') as Element);
      });
      expect(state.closed).toBe(false);
    } finally {
      unmount();
    }
  });

  it('steps through the pack with the arrows and with the two controls', () => {
    const { container, state, unmount } = open(1);
    try {
      const backdrop = container.querySelector('.evidence-lightbox') as Element;
      act(() => {
        fireEvent.keyDown(backdrop, { key: 'ArrowRight' });
      });
      expect(state.index).toBe(2);

      act(() => {
        fireEvent.keyDown(backdrop, { key: 'ArrowLeft' });
      });
      expect(state.index).toBe(0);

      const steps = [...container.querySelectorAll('.evidence-lightbox__step')];
      expect(steps).toHaveLength(2);
      act(() => {
        fireEvent.click(steps[1] as Element);
      });
      expect(state.index).toBe(2);
    } finally {
      unmount();
    }
  });

  it('disables a step at the end of the pack rather than removing it', () => {
    /* A control that disappears moves every other control on the row, and a reader who has
       just reached the last capture should not have the layout shift under the pointer they
       were about to click. */
    const first = open(0);
    const stepsAtFirst = [...first.container.querySelectorAll('button.evidence-lightbox__step')];
    expect(stepsAtFirst).toHaveLength(2);
    expect((stepsAtFirst[0] as HTMLButtonElement).disabled).toBe(true);
    expect((stepsAtFirst[1] as HTMLButtonElement).disabled).toBe(false);
    first.unmount();

    const last = open(ARTIFACTS.length - 1);
    const stepsAtLast = [...last.container.querySelectorAll('button.evidence-lightbox__step')];
    expect((stepsAtLast[0] as HTMLButtonElement).disabled).toBe(false);
    expect((stepsAtLast[1] as HTMLButtonElement).disabled).toBe(true);
    last.unmount();
  });

  it('keeps Tab inside itself, in both directions', () => {
    const { container, unmount } = open(1);
    try {
      const stops = [
        ...container.querySelectorAll<HTMLElement>(
          '.evidence-lightbox__plate a[href], .evidence-lightbox__plate button:not([disabled])',
        ),
      ];
      expect(stops.length, 'the dialog holds nothing focusable').toBeGreaterThan(1);
      const first = stops[0] as HTMLElement;
      const last = stops[stops.length - 1] as HTMLElement;
      const backdrop = container.querySelector('.evidence-lightbox') as Element;

      /* Forward off the last stop wraps to the first. `aria-modal="true"` says the rest of the
         document is unavailable, so letting Tab walk out of here would make that a lie. */
      act(() => {
        last.focus();
        fireEvent.keyDown(backdrop, { key: 'Tab' });
      });
      expect(document.activeElement).toBe(first);

      act(() => {
        first.focus();
        fireEvent.keyDown(backdrop, { key: 'Tab', shiftKey: true });
      });
      expect(document.activeElement).toBe(last);
    } finally {
      unmount();
    }
  });

  it('still links the file, and names the pack it came from', () => {
    const { container, unmount } = open(2);
    try {
      const file = container.querySelector<HTMLAnchorElement>('.evidence-lightbox__file');
      /* A reader who wants the capture at full size, or wants to save it, or wants the bytes,
         has lost nothing by the image being shown here first. */
      expect(file?.getAttribute('href')).toBe(ARTIFACTS[2]?.publicPath);
      expect(file?.getAttribute('target')).toBe('_blank');
      expect(file?.getAttribute('rel')).toBe('noopener noreferrer');
      expect(file?.textContent).toBe(LIGHTBOX_WORDS.openFile);
      expect(container.querySelector('.evidence-lightbox__pack')?.textContent).toBe(
        'ev_9f21c4a0',
      );
    } finally {
      unmount();
    }
  });

  it('renders nothing for an index the pack does not hold', () => {
    const { container, unmount } = render(
      <EvidenceLightbox
        artifacts={ARTIFACTS}
        index={99}
        onClose={() => undefined}
        onIndexChange={() => undefined}
        packId="ev_9f21c4a0"
      />,
    );
    try {
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      unmount();
    }
  });
});

/* ─────────────────── the panel opens it, and only for a bitmap ────────────────── */

describe('the panel opens a capture in place and a document in a tab', () => {
  function panel(pack: SnapshotEvidence = makeEvidence()) {
    return render(<PromisePanel evidence={pack} promise={makePromise()} />);
  }

  function rowFor(container: HTMLElement, name: string): HTMLAnchorElement {
    const found = [
      ...container.querySelectorAll<HTMLAnchorElement>('.promise-panel__artifact'),
    ].find((link) => link.textContent === name);
    expect(found, `no artefact row named ${name}`).toBeDefined();
    return found as HTMLAnchorElement;
  }

  /** Click a row and report whether the navigation was prevented. */
  function click(link: HTMLAnchorElement, init: Partial<MouseEventInit> = {}): boolean {
    let prevented = false;
    act(() => {
      prevented = !fireEvent.click(link, { button: 0, ...init });
    });
    return prevented;
  }

  it('says both behaviours in words, once, above the list', () => {
    const { container, unmount } = panel();
    try {
      /* A reader who clicks two rows and gets two behaviours has to have been told there are
         two, and the mark on the row is geometry that cannot be read aloud. */
      expect(container.textContent).toContain(PANEL_WORDS.artifactsOpenAway);
      expect(PANEL_WORDS.artifactsOpenAway).toContain('viewer');
      expect(PANEL_WORDS.artifactsOpenAway).toContain('new tab');
    } finally {
      unmount();
    }
  });

  it('marks which rows are viewable, so the stylesheet and the tests agree', () => {
    const { container, unmount } = panel();
    try {
      expect(rowFor(container, 'annotated.png').getAttribute('data-viewable')).toBe('true');
      expect(rowFor(container, 'step-2.jpg').getAttribute('data-viewable')).toBe('true');
      expect(rowFor(container, 'failure.yaml').hasAttribute('data-viewable')).toBe(false);
    } finally {
      unmount();
    }
  });

  it('opens the viewer on a capture, at that capture', () => {
    const { container, unmount } = panel();
    try {
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      expect(click(rowFor(container, 'step-2.jpg'))).toBe(true);

      const dialog = container.querySelector('[role="dialog"]');
      expect(dialog, 'clicking a capture opened no viewer').not.toBeNull();
      /* The index is into the viewable artefacts rather than into the pack, so stepping can
         never land on the failure document between them. `step-2.jpg` is the second bitmap
         and the third artefact. */
      expect(dialog?.getAttribute('data-artifact')).toBe('/evidence/ev_9f21c4a0/step-2.jpg');
      expect(container.querySelector('.evidence-lightbox__counter')?.textContent).toBe('2 of 2');
    } finally {
      unmount();
    }
  });

  it('leaves a document to the tab it always had', () => {
    const { container, unmount } = panel();
    try {
      const link = rowFor(container, 'failure.yaml');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      /* Not prevented, so the browser opens it. A HAR has no business in an `<img>`. */
      expect(click(link)).toBe(false);
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('leaves a cmd-click on a capture to the browser as well', () => {
    const { container, unmount } = panel();
    try {
      expect(click(rowFor(container, 'annotated.png'), { metaKey: true })).toBe(false);
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('returns focus to the row it was opened from when it closes (§10.8)', () => {
    const { container, unmount } = panel();
    try {
      const link = rowFor(container, 'annotated.png');
      click(link);
      expect(container.querySelector('[role="dialog"]')).not.toBeNull();

      act(() => {
        fireEvent.click(container.querySelector('.evidence-lightbox__close') as Element);
      });
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      /* The same contract `Escape` on the graph honours: the way back is where you came from,
         never the top of the document. */
      expect(document.activeElement).toBe(link);
    } finally {
      unmount();
    }
  });

  it('opens no viewer for a pack with nothing viewable in it', () => {
    const { container, unmount } = panel(
      makeEvidence([artifact('failure-yaml', 'failure.yaml'), artifact('har', 'network.har')]),
    );
    try {
      for (const name of ['failure.yaml', 'network.har']) {
        expect(click(rowFor(container, name))).toBe(false);
      }
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      unmount();
    }
  });
});

/* ─────────── a long artefact list starts shut, and hides nothing by it ─────────── */

/**
 * The complaint: the committed pack carries fifty-nine artefacts and nine of the thirteen
 * promises point at it, so opening almost any proven promise unrolled fifty-nine rows underneath
 * four sections of prose. The reader scrolled past every one of them to reach the sections they
 * had not read yet, and the sections were the answer.
 *
 * Three things have to be true of the fix. A shut list has to say what it holds, or a reader has
 * to open it to find out whether it was worth opening. Shutting it must take nothing out of the
 * document, which is the whole argument for `<details>` over a conditional render: the children
 * stay in the tree, so the browser's own find still matches an artefact path and a screen reader
 * still walks it. And a short pack must not be collapsed at all, because a click that hides two
 * rows is a click that bought nothing.
 */
describe('the artefact list collapses when it is long enough to be a wall', () => {
  /** A pack of `count` captures, so the disclosure can be driven either side of the threshold. */
  function packOf(count: number): SnapshotEvidence {
    return makeEvidence(
      Array.from({ length: count }, (_unused, index) =>
        artifact('screenshot', `step-${String(index + 1)}.jpg`),
      ),
    );
  }

  function disclosure(container: HTMLElement): HTMLDetailsElement | null {
    return container.querySelector<HTMLDetailsElement>('.promise-panel__artifacts-disclosure');
  }

  it('states the total, and the viewable count beside it', () => {
    expect(artifactSummary(59, 57)).toBe('59 artefacts, 57 viewable here');
    expect(artifactSummary(1, 1)).toBe('1 artefact, 1 viewable here');
    /* Left out rather than spelled `0 viewable here`, which would read as a failure. A pack of
       two failure documents has nothing to view and nothing has gone wrong. */
    expect(artifactSummary(2, 0)).toBe('2 artefacts');
  });

  it('shuts a pack above the threshold and leaves a short one open', () => {
    const long = render(
      <PromisePanel evidence={packOf(ARTIFACT_COLLAPSE_AT + 1)} promise={makePromise()} />,
    );
    expect(disclosure(long.container)?.open, 'a long pack renders open').toBe(false);
    long.unmount();

    const short = render(
      <PromisePanel evidence={packOf(ARTIFACT_COLLAPSE_AT)} promise={makePromise()} />,
    );
    /* Collapsing a list this short would cost a click to hide nothing, so it does not. */
    expect(disclosure(short.container)?.open, 'a short pack renders shut').toBe(true);
    short.unmount();
  });

  it('says on the outside how much it is holding', () => {
    const pack = packOf(20);
    const { container, unmount } = render(
      <PromisePanel evidence={pack} promise={makePromise()} />,
    );
    try {
      const summary = disclosure(container)?.querySelector('summary');
      expect(summary?.tagName).toBe('SUMMARY');
      expect(summary?.textContent).toBe(artifactSummary(20, viewableCount(pack)));
      /* Never a bare `show artefacts`: a closed disclosure that does not say what it holds is
         indistinguishable from one holding nothing. */
      expect(summary?.textContent).toMatch(/\d+ artefacts/);
    } finally {
      unmount();
    }
  });

  it('keeps every artefact path in the document while shut', () => {
    const pack = packOf(20);
    const { container, unmount } = render(
      <PromisePanel evidence={pack} promise={makePromise()} />,
    );
    try {
      expect(disclosure(container)?.open).toBe(false);
      /* The whole argument for `<details>`: shut is a presentation state, not a content one. */
      const links = [
        ...container.querySelectorAll<HTMLAnchorElement>('.promise-panel__artifact'),
      ];
      expect(links).toHaveLength(pack.artifacts.length);
      expect(links.map((link) => link.getAttribute('href'))).toEqual(
        pack.artifacts.map((entry) => entry.publicPath),
      );
      /* And the sentence explaining the two behaviours is inside it rather than lost with it. */
      expect(disclosure(container)?.textContent).toContain(PANEL_WORDS.artifactsOpenAway);
    } finally {
      unmount();
    }
  });

  it('still opens the viewer from a row inside a shut list', () => {
    const { container, unmount } = render(
      <PromisePanel evidence={packOf(20)} promise={makePromise()} />,
    );
    try {
      const link = [
        ...container.querySelectorAll<HTMLAnchorElement>('.promise-panel__artifact'),
      ].find((candidate) => candidate.textContent === 'step-7.jpg');
      expect(link).toBeDefined();
      act(() => {
        fireEvent.click(link as HTMLAnchorElement, { button: 0 });
      });
      expect(container.querySelector('[role="dialog"]')?.getAttribute('data-artifact')).toBe(
        '/evidence/ev_9f21c4a0/step-7.jpg',
      );
    } finally {
      unmount();
    }
  });

  it('collapses the committed pack, because that is the one a reader meets', () => {
    const pack = snapshot.evidence[0] ?? null;
    if (pack === null) return;
    const promise = snapshot.promises.find((entry) => entry.evidencePackId === pack.id) ?? null;
    expect(promise, 'no committed promise points at the pack').not.toBeNull();
    if (promise === null) return;

    const { container, unmount } = render(<PromisePanel evidence={pack} promise={promise} />);
    try {
      expect(pack.artifacts.length).toBeGreaterThan(ARTIFACT_COLLAPSE_AT);
      expect(disclosure(container)?.open).toBe(false);
      expect(disclosure(container)?.querySelector('summary')?.textContent).toBe(
        artifactSummary(pack.artifacts.length, viewableCount(pack)),
      );
      /* Fifty-nine rows are still there, one summary line tall. */
      expect(container.querySelectorAll('.promise-panel__artifact')).toHaveLength(
        pack.artifacts.length,
      );
    } finally {
      unmount();
    }
  });

  it('adds no disclosure to a pack with nothing in it', () => {
    const { container, unmount } = render(
      <PromisePanel evidence={makeEvidence([])} promise={makePromise()} />,
    );
    try {
      /* An empty pack states itself in prose (§10.10). A disclosure over nothing would be a
         control that opens on a blank. */
      expect(disclosure(container)).toBeNull();
      expect(container.textContent).toContain(PANEL_WORDS.noArtifacts);
    } finally {
      unmount();
    }
  });
});
