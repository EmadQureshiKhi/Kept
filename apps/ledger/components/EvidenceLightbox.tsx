/**
 * `EvidenceLightbox`: the sealed artefact, looked at without leaving the page.
 * Design §10.2, §10.5, §10.8, R8.3, R10.7.
 *
 * The evidence pack is where this product's argument lands: a promise says the cart applies a
 * discount, a run says it did not, and the screenshot is the run showing its work. Until now
 * looking at that screenshot cost a tab switch, so the reader left the graph, looked at a
 * JPEG on its own, and came back to find their place. In a demonstration that is the worst
 * moment to lose the page, and in a review it is the moment a sceptic stops following.
 *
 * So a bitmap artefact opens over the panel. Everything else still opens in a tab, because
 * `lib/evidenceView.ts` reads the file's extension rather than Kane's label for it and a HAR
 * or a failure document is not something to put in an `<img>`.
 *
 * ## This one *is* a dialog, and the panel deliberately is not
 *
 * `PromisePanel` refuses `role="dialog"` on purpose: it is a detail of the graph and the graph
 * beside it stays readable and operable while it is open. A lightbox is the opposite claim. It
 * covers the page, it is the only thing a reader can interact with while it is up, and the way
 * out has to be obvious. So it takes `role="dialog"`, `aria-modal="true"`, an accessible name
 * from the artefact's own filename, `Escape`, a backdrop that closes on click, and a focus trap
 * that keeps `Tab` inside it. An `aria-modal` region a keyboard can tab out of is worse than no
 * dialog at all: it tells assistive technology the rest of the page is unavailable and then
 * sends the reader there.
 *
 * ## Not a native `<dialog>`, and the reason is testability rather than taste
 *
 * `<dialog>` with `showModal()` would supply the backdrop, the trap and the `Escape` key for
 * free, and that is normally the right trade in this codebase: the reading note on `/runs` and
 * the run detail rows are both native `<details>` for exactly that reason. It is not available
 * here. jsdom 29 implements neither `showModal` nor `close`, so every one of the behaviours
 * above would have to be asserted against a shim written in the test file, which proves the
 * shim rather than the component. Given the choice between a platform element whose behaviour
 * is unverifiable in this suite and thirty lines of explicit behaviour that is verifiable, the
 * verifiable version wins, and the same code path runs in the browser and in the test.
 *
 * ## Stepping through the pack is the point of the arrow keys
 *
 * The pack holds fifty-six per-step captures and they are a *sequence*: they are the run, in
 * the order it happened. So the lightbox steps with `ArrowLeft` and `ArrowRight` through the
 * pack's own order, states `n of m`, and clamps at both ends rather than wrapping, so "am I at
 * the last step" is answerable without counting. That is the same clamping rule the graph's
 * keyboard walk uses, for the same reason.
 *
 * ## Nothing is taken away
 *
 * The artefact's own URL is still on screen as a link that opens in a tab, so a reader who
 * wants the file at full size, or wants to save it, or wants to read the bytes, has not lost
 * anything by the image being shown here first. The lightbox is a shortcut over a static file,
 * never a replacement for it.
 *
 * The image is `loading="lazy"` and `decoding="async"`: the panel lists fifty-nine rows and
 * exactly one of them is ever open, so nothing is fetched until a reader asks for it.
 */

'use client';

import type { SnapshotArtifact } from 'kept-core';
import { useCallback, useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';

import '../styles/evidence-lightbox.css';

/** The words the lightbox says. Exported so tests read the copy rather than restate it. */
export const LIGHTBOX_WORDS = {
  close: 'close',
  previous: 'previous artefact',
  next: 'next artefact',
  /** Said under the image: the file is still a file, and still reachable as one. */
  openFile: 'open the file in a new tab',
  /** The alt text of a sealed capture, which is a description of provenance, not of pixels. */
  altPrefix: 'Sealed evidence artefact',
} as const;

/** The dialog's accessible name: which artefact, and where it sits in the pack. */
export function lightboxLabel(artifact: SnapshotArtifact, index: number, total: number): string {
  return `${artifact.name}, artefact ${String(index + 1)} of ${String(total)}`;
}

/**
 * The counter under the image.
 *
 * A separate function from the label because the two are different jobs: the label names the
 * dialog once, when it opens, and this is the line a sighted reader watches change as they
 * step. Keeping them apart means the announcement does not repeat on every arrow key.
 */
export function lightboxCounter(index: number, total: number): string {
  return `${String(index + 1)} of ${String(total)}`;
}

/**
 * Alt text for a sealed capture.
 *
 * It describes what the image *is* rather than what is in it, and that is the honest limit of
 * what this page knows: nothing here has looked at the pixels. The kind is Kane's own word for
 * the artefact's purpose and the name is the step it came from, so a reader who cannot see the
 * image learns which step of which run they are being shown and can go to the file itself. A
 * generated sentence claiming to describe the screenshot would be a description nobody wrote.
 */
export function lightboxAlt(artifact: SnapshotArtifact): string {
  return `${LIGHTBOX_WORDS.altPrefix}: ${artifact.kind}, ${artifact.name}`;
}

/** Keys that step towards the end of the pack, and towards its start. */
const NEXT_KEYS: ReadonlySet<string> = new Set(['ArrowRight', 'ArrowDown']);
const PREVIOUS_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowUp']);
const CLOSE_KEYS: ReadonlySet<string> = new Set(['Escape', 'Esc']);

/**
 * Where a step lands, clamped at both ends.
 *
 * Clamped rather than wrapped for the reason the graph's walk clamps: holding an arrow key
 * should stop at the last capture instead of silently starting the run again from the top.
 * Exported so the arithmetic is checked without a render.
 */
export function stepIndex(index: number, total: number, delta: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(index + delta, 0), total - 1);
}

/** Everything inside `root` a keyboard can land on, in document order. */
function focusables(root: HTMLElement): readonly HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
}

export interface EvidenceLightboxProps {
  /** The viewable artefacts of one pack, in the order the pack lists them. */
  readonly artifacts: readonly SnapshotArtifact[];
  /** Which one is open. Assumed to be a valid index into `artifacts`. */
  readonly index: number;
  /** The pack's id, shown so a reader can say which pack they were looking at. */
  readonly packId: string;
  readonly onIndexChange: (index: number) => void;
  readonly onClose: () => void;
}

export function EvidenceLightbox({
  artifacts,
  index,
  packId,
  onIndexChange,
  onClose,
}: EvidenceLightboxProps) {
  const surface = useRef<HTMLDivElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const artifact = artifacts[index];

  /* Focus lands on the way out rather than on the image: the close control is the thing a
     reader most needs to be able to reach the instant a dialog appears, and an `<img>` is not
     focusable anyway. `PromisePanel` restores focus to the link that opened this (§10.8). */
  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  const step = useCallback(
    (delta: number): void => {
      const next = stepIndex(index, artifacts.length, delta);
      if (next !== index) onIndexChange(next);
    },
    [artifacts.length, index, onIndexChange],
  );

  /**
   * The whole keyboard contract, in one handler on the dialog.
   *
   * `Escape` closes, the arrows step, and `Tab` cycles within the dialog. The trap is written
   * out rather than delegated because `aria-modal="true"` tells assistive technology the rest
   * of the document is unavailable, and a dialog that makes that claim and then lets `Tab`
   * walk into the page behind it has lied to the one reader who was relying on it.
   */
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (CLOSE_KEYS.has(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (NEXT_KEYS.has(event.key)) {
        event.preventDefault();
        step(1);
        return;
      }
      if (PREVIOUS_KEYS.has(event.key)) {
        event.preventDefault();
        step(-1);
        return;
      }
      if (event.key !== 'Tab') return;

      const root = surface.current;
      if (root === null) return;
      const stops = focusables(root);
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    },
    [onClose, step],
  );

  /**
   * A click on the backdrop closes; a click on the plate does not.
   *
   * Compared against the event's own target rather than checked with `contains`, so the test
   * is "the reader clicked the backdrop itself" rather than "the reader clicked something
   * that is not the plate", which would also be true of a click that started on the plate
   * and ended outside it.
   */
  const onBackdropClick = useCallback(
    (event: MouseEvent<HTMLDivElement>): void => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  if (artifact === undefined) return null;

  const total = artifacts.length;
  const atFirst = index === 0;
  const atLast = index === total - 1;

  return (
    /* The backdrop takes the click and the keys, and is not itself the dialog: the dialog is
       the plate inside it, so `aria-modal` names the region a reader is actually in. */
    <div className="evidence-lightbox" onClick={onBackdropClick} onKeyDown={onKeyDown}>
      <div
        aria-label={lightboxLabel(artifact, index, total)}
        aria-modal="true"
        className="evidence-lightbox__plate surface-raised-2"
        data-artifact={artifact.publicPath}
        ref={surface}
        role="dialog"
      >
        <div className="evidence-lightbox__head">
          <span className="evidence-lightbox__kind">{artifact.kind}</span>
          <span className="evidence-lightbox__name">{artifact.name}</span>
          <button
            aria-label={`${LIGHTBOX_WORDS.close} artefact viewer`}
            className="evidence-lightbox__close"
            onClick={onClose}
            ref={closeButton}
            type="button"
          >
            {LIGHTBOX_WORDS.close}
          </button>
        </div>

        {/* The recessed well is the mount the capture sits in, so a screenshot of a white
            page still reads as a picture on a surface rather than as a hole in the plate. */}
        <div className="evidence-lightbox__stage surface-well">
          <img
            alt={lightboxAlt(artifact)}
            className="evidence-lightbox__image"
            decoding="async"
            loading="lazy"
            src={artifact.publicPath}
          />
        </div>

        <div className="evidence-lightbox__foot">
          {/* Disabled at the ends rather than hidden: a control that disappears moves every
              other control on the row, and a reader who has just reached the last capture
              should not have the layout shift under the pointer they were about to click. */}
          <button
            aria-label={LIGHTBOX_WORDS.previous}
            className="evidence-lightbox__step"
            disabled={atFirst}
            onClick={() => step(-1)}
            type="button"
          >
            {'\u2190'}
          </button>
          <span className="evidence-lightbox__counter">{lightboxCounter(index, total)}</span>
          <button
            aria-label={LIGHTBOX_WORDS.next}
            className="evidence-lightbox__step"
            disabled={atLast}
            onClick={() => step(1)}
            type="button"
          >
            {'\u2192'}
          </button>

          {/* The pack the capture belongs to, and the file itself. Nothing the tab used to
              give a reader is taken away by showing the image here first. */}
          <span className="evidence-lightbox__pack">{packId}</span>
          <a
            className="evidence-lightbox__file"
            href={artifact.publicPath}
            rel="noopener noreferrer"
            target="_blank"
          >
            {LIGHTBOX_WORDS.openFile}
          </a>
        </div>
      </div>
    </div>
  );
}
