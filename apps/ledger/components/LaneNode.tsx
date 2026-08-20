/**
 * `LaneNode` — design §10.3 (lanes 0, 2 and 3), §10.7, R8.1.
 *
 * The three lanes that are not promises: the document a claim was read from, the
 * `*_test.md` designed to prove it, and the evidence pack a run sealed. They are
 * context rather than subjects, so they are compact chips at the same elevation as a
 * promise node and a little over half its height, and they are not focus stops in the
 * keyboard model (§10.8) — everything they carry is repeated as text in the panel,
 * which is the surface a keyboard reader uses.
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
