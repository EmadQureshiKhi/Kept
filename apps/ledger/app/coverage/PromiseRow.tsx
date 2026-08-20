/**
 * One promise on the shareable page — design §10.1, §10.7, R9.8, R10.5.
 *
 * The verdict as a word beside its colour, the claim as prose, and the citation and
 * designed test as the identifiers they are. `VerdictTag` carries the first of
 * those, so the rule that colour is never the only channel is kept in one place
 * rather than restated here.
 *
 * The claim is rendered verbatim. That is worth more than it looks: the snapshot's
 * citation text was overwritten with the line read from disk at admission (§3.3,
 * R1.3), so what a reader sees is what the file says rather than what a provider
 * remembered — and a promise with no designed test says so in words instead of
 * leaving a blank a reader has to interpret.
 *
 * Colocated beside its route rather than in `components/`: Next treats only a
 * handful of filenames under `app/` as routes, and being its own module is what
 * lets it be rendered against constructed promises rather than only against the
 * eight the committed snapshot happens to hold.
 */

import type { SnapshotPromise } from '@kept/core';

import { VerdictTag } from '../../components/VerdictTag.js';

import '../../styles/coverage.css';

/** What a promise with no designed test reads. A statement, not an empty cell. */
export const NO_DESIGNED_TEST = 'no designed test';

export interface PromiseRowProps {
  readonly promise: SnapshotPromise;
}

export function PromiseRow({ promise }: PromiseRowProps) {
  const { citation, designedTest } = promise;

  return (
    <li className="promise-list__item" data-promise={promise.id} data-verdict={promise.verdict}>
      <span className="promise-list__verdict">
        <VerdictTag verdict={promise.verdict} />
      </span>
      <div className="promise-list__body">
        <p className="promise-list__claim">{promise.claim}</p>
        <p className="promise-list__meta">
          <span className="promise-list__id">{promise.id}</span>
          <span className="promise-list__separator">·</span>
          <span className="promise-list__citation">{`${citation.file}:${citation.line}`}</span>
          <span className="promise-list__separator">·</span>
          <span className="promise-list__test">
            {designedTest === null
              ? NO_DESIGNED_TEST
              : designedTest.testId === null
                ? designedTest.path
                : `${designedTest.path} ${designedTest.testId}`}
          </span>
        </p>
      </div>
    </li>
  );
}
