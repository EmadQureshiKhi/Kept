/**
 * `LaneNode` — design §10.3 (lanes 0, 2 and 3), §10.7, R8.1.
 *
 * The three lanes that are not promises: the document a claim was read from, the
 * `*_test.md` designed to prove it, and the evidence pack a run sealed. They are
 * context rather than subjects, so they are compact chips — 240×56 against a promise
 * node's 320×88 — and they are not focus stops in the keyboard model (§10.8), because
 * everything they carry is repeated as text in the panel, which is the surface a keyboard
 * reader uses.
 *
 * They keep the promise node's slab and 2px ink border but sit one step *down* the ink ramp
 * rather than one step up, so a document does not read like a promise at a glance. That is
 * a fill from the existing ramp, not a new colour: the four `--ink-*` surfaces are the only
 * fills in this system (§10.4.1).
 *
 * The name is an identifier — a repo-relative path or a pack id — so it is mono
 * (§10.7). The kind above it is one prose word, so it is not.
 *
 * Written as one component over a `kind` rather than three near-identical ones: the
 * three lanes differ in what they name and in nothing else, and three files would
 * drift.
 */

'use client';

import clsx from 'clsx';

import type { LaneKind } from '../lib/layout.js';

import '../styles/promise-node.css';

/** What each non-promise lane calls itself, in the reading order of §10.3. */
export const LANE_WORDS: Readonly<Record<Exclude<LaneKind, 'promise'>, string>> = {
  document: 'document',
  test: 'designed test',
  evidence: 'evidence pack',
};

export interface LaneNodeProps {
  readonly kind: Exclude<LaneKind, 'promise'>;
  /** The path or id this chip names. Never empty: a nameless node is not drawn. */
  readonly name: string;
  readonly className?: string;
}

export function LaneNode({ kind, name, className }: LaneNodeProps) {
  return (
    <div className={clsx('lane-node', 'surface-raised', className)} data-lane={kind}>
      <span className="lane-node__kind">{LANE_WORDS[kind]}</span>
      <span className="lane-node__name" title={name}>
        {name}
      </span>
    </div>
  );
}

export interface LaneHeaderProps {
  readonly kind: LaneKind;
  /** The column's name, from `LANE_HEADINGS`. */
  readonly heading: string;
  readonly className?: string;
}

/**
 * The heading above one column — `Documents`, `Promises`, `Designed tests`, `Evidence`.
 *
 * The caption already says the reading order in a sentence; this says it in four words
 * standing over the four columns, which is what makes the left-to-right story legible
 * before a reader has clicked anything.
 *
 * It labels rather than acts, so it is not a focus stop and carries no role: adding one
 * would put four dead stops in front of the promise lane, which is the opposite of what
 * §10.8 asks for. One prose word (or two), so `--font-ui` rather than mono (§10.7).
 */
export function LaneHeader({ kind, heading, className }: LaneHeaderProps) {
  return (
    <div className={clsx('lane-header', className)} data-lane-header={kind}>
      {heading}
    </div>
  );
}
