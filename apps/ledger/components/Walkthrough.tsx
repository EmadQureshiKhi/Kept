/**
 * `Walkthrough`: the five-step answer to "why is this red?". Design §8.1, §10.2, §10.5, §10.8,
 * R7.3, R8.2, R8.3, R10.7.
 *
 * The chain that carries this product's argument is claim, designed test, sealed evidence, the
 * branch the router chose, and the replacement it proposed. Every one of those facts was already
 * on the site before this existed, and following them meant knowing to click four things in the
 * right order across two routes. A reader who did not already understand the product had no way
 * to discover that they were one argument.
 *
 * So they are a sequence now, with next and back. `lib/walkthrough.ts` decides what the steps are
 * and what each one says; this file places them and owns nothing but which one is showing. That
 * split is the point: the argument is prose and arithmetic over the committed snapshot, so it is
 * reviewable in one file and provable without a DOM, and a component cannot quietly change what
 * the product claims.
 *
 * ## It is a dialog, and it says so
 *
 * Like the evidence lightbox and unlike the promise panel: it covers the page, it is the only
 * thing a reader interacts with while it is up, and the way out has to be obvious. So
 * `role="dialog"`, `aria-modal="true"`, a name naming the promise, `Escape`, a backdrop that
 * closes on click, and `Tab` trapped inside. An `aria-modal` region a keyboard can tab out of
 * tells assistive technology the rest of the page is unavailable and then sends the reader there,
 * which is worse than not claiming to be modal at all.
 *
 * Not a native `<dialog>`, for the reason `EvidenceLightbox` records: jsdom 29 implements neither
 * `showModal` nor `close`, so every behaviour above would be asserted against a shim written in
 * the test file rather than against the component. The explicit version runs the same code path in
 * the browser and in the test.
 *
 * ## The rail is a map, not decoration
 *
 * Five named stops across the top, the current one filled. A reader can see how long the argument
 * is before committing to it, and can see which part they are in, which is the difference between
 * a sequence and a series of surprises. The stops are links to the steps rather than buttons, and
 * they carry the step's own word, so `the decision` is reachable in one click from `the claim`.
 *
 * ## Nothing here is new information
 *
 * Every fact in the sequence is already reachable in the panel, on `/amendments`, or in the
 * evidence pack, and the last step links to the amendment card so the sha256 interlock and the
 * accept command are read where they live. This is an ordering of the site, not a second copy of
 * it, which is also why it spends no credit, fetches nothing and reaches no handler (R8.4).
 */

'use client';

import type { SnapshotPromise } from 'kept-core';
import { useCallback, useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';

import { stepAt, stepCounter, type WalkthroughStep } from '../lib/walkthrough.js';

import '../styles/walkthrough.css';

/** The words the frame says. Exported so tests read the copy rather than restate it. */
export const WALKTHROUGH_WORDS = {
  close: 'close',
  previous: 'previous step',
  next: 'next step',
  /** The eyebrow over the whole sequence, so it is clear what is being explained. */
  eyebrow: 'verification chain',
  /** What a step's verbatim block is, said once, because bytes need saying. */
  quoted: 'quoted verbatim',
  /** What the caveat block is, so a reader does not read it as part of the record. */
  caveat: 'read this with it',
} as const;

/** The dialog's accessible name: what is being explained, and about which promise. */
export function walkthroughLabel(promise: SnapshotPromise, index: number, total: number): string {
  return `${WALKTHROUGH_WORDS.eyebrow} for promise ${promise.id}, step ${stepCounter(index, total)}`;
}

/** Alt text for a step's capture: provenance, because nothing here has read the pixels. */
export function stepImageAlt(step: WalkthroughStep): string {
  return `Sealed evidence artefact for ${step.heading}`;
}

const NEXT_KEYS: ReadonlySet<string> = new Set(['ArrowRight', 'ArrowDown']);
const PREVIOUS_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowUp']);
const CLOSE_KEYS: ReadonlySet<string> = new Set(['Escape', 'Esc']);

/** Everything inside `root` a keyboard can land on, in document order. */
function focusables(root: HTMLElement): readonly HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
}

export interface WalkthroughProps {
  readonly promise: SnapshotPromise;
  readonly steps: readonly WalkthroughStep[];
  readonly index: number;
  readonly onIndexChange: (index: number) => void;
  readonly onClose: () => void;
}

export function Walkthrough({ promise, steps, index, onIndexChange, onClose }: WalkthroughProps) {
  const surface = useRef<HTMLDivElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const step = steps[index];

  /* Focus lands on the way out the instant the dialog appears, which is what a reader most needs
     to be able to reach. `PromiseGraph` restores focus to the trigger on close (§10.8). */
  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  const move = useCallback(
    (delta: number): void => {
      const next = stepAt(index, steps.length, delta);
      if (next !== index) onIndexChange(next);
    },
    [index, onIndexChange, steps.length],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (CLOSE_KEYS.has(event.key)) {
        event.preventDefault();
        /* Stopped here rather than allowed to bubble: the graph section also closes the panel on
           `Escape`, and one keystroke must not shut two things. */
        event.stopPropagation();
        onClose();
        return;
      }
      if (NEXT_KEYS.has(event.key)) {
        event.preventDefault();
        move(1);
        return;
      }
      if (PREVIOUS_KEYS.has(event.key)) {
        event.preventDefault();
        move(-1);
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
    [move, onClose],
  );

  /* The backdrop itself, compared against the event's own target, so a drag that started on the
     plate and ended outside it does not close the sequence. */
  const onBackdropClick = useCallback(
    (event: MouseEvent<HTMLDivElement>): void => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  if (step === undefined) return null;

  const total = steps.length;

  return (
    <div className="walkthrough" onClick={onBackdropClick} onKeyDown={onKeyDown}>
      <div
        aria-label={walkthroughLabel(promise, index, total)}
        aria-modal="true"
        className="walkthrough__plate surface-raised-2"
        data-step={step.kind}
        ref={surface}
        role="dialog"
      >
        <div className="walkthrough__head">
          <span className="walkthrough__eyebrow">{WALKTHROUGH_WORDS.eyebrow}</span>
          <span className="walkthrough__subject">{promise.id}</span>
          <button
            aria-label={`${WALKTHROUGH_WORDS.close} the verification chain`}
            className="walkthrough__close"
            onClick={onClose}
            ref={closeButton}
            type="button"
          >
            {WALKTHROUGH_WORDS.close}
          </button>
        </div>

        {/* The rail: five named stops, the current one filled. A reader sees how long the argument
            is before committing to it and which part of it they are in. Links rather than buttons,
            because a stop is a place in a sequence and `aria-current` states which one. */}
        <div aria-label="chain steps" className="walkthrough__rail" role="group">
          {steps.map((entry, at) => (
            <button
              aria-current={at === index ? 'true' : undefined}
              className="walkthrough__stop"
              key={entry.kind}
              onClick={() => onIndexChange(at)}
              type="button"
            >
              <span className="walkthrough__stop-index">{at + 1}</span>
              <span className="walkthrough__stop-word">{entry.heading}</span>
            </button>
          ))}
        </div>

        <div className="walkthrough__body">
          <h2 className="walkthrough__heading">{step.heading}</h2>
          <p className="walkthrough__lede">{step.lede}</p>

          {step.facts.length === 0 ? null : (
            <dl className="walkthrough__facts">
              {step.facts.map((fact) => (
                <div className="walkthrough__fact" key={fact.term}>
                  <dt className="walkthrough__term">{fact.term}</dt>
                  <dd className="walkthrough__value">{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {/* Bytes, in the one recessed surface, with no trimming: leading space, trailing space
              and inner runs are what the file and the tool actually produced. */}
          {step.quote === null ? null : (
            <div className="walkthrough__quote-block">
              <span className="walkthrough__quote-label">{WALKTHROUGH_WORDS.quoted}</span>
              <blockquote className="walkthrough__quote surface-well">{step.quote}</blockquote>
            </div>
          )}

          {step.image === null ? null : (
            <div className="walkthrough__stage surface-well">
              <img
                alt={stepImageAlt(step)}
                className="walkthrough__image"
                decoding="async"
                loading="lazy"
                src={step.image}
              />
            </div>
          )}

          {/* The one place this sequence talks about itself. It exists because the committed
              snapshot holds a code-break verdict and an older documentation amendment about the
              same line, and shown back to back with no dates that reads as the tool arguing with
              itself. Dashed, like every other "specified and worth reading" block (§10.10). */}
          {step.caveat === null ? null : (
            <div className="walkthrough__caveat">
              <span className="walkthrough__caveat-label">{WALKTHROUGH_WORDS.caveat}</span>
              <p className="walkthrough__caveat-text">{step.caveat}</p>
            </div>
          )}

          {step.link === null ? null : (
            <p className="walkthrough__out">
              <a className="walkthrough__link" href={step.link.href}>
                {step.link.words}
              </a>
            </p>
          )}
        </div>

        <div className="walkthrough__foot">
          {/* Disabled at the ends rather than hidden: a control that disappears moves the one
              beside it under the pointer that was about to click. */}
          <button
            aria-label={WALKTHROUGH_WORDS.previous}
            className="walkthrough__step-control"
            disabled={index === 0}
            onClick={() => move(-1)}
            type="button"
          >
            {'\u2190 back'}
          </button>
          <span className="walkthrough__counter">{stepCounter(index, total)}</span>
          <button
            aria-label={WALKTHROUGH_WORDS.next}
            className="walkthrough__step-control"
            disabled={index === total - 1}
            onClick={() => move(1)}
            type="button"
          >
            {'next \u2192'}
          </button>
        </div>
      </div>
    </div>
  );
}
