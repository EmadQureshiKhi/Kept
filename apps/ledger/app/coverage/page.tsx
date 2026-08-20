/**
 * `/coverage` — design §10.1, §10.10, R9.1, R9.2, R9.3, R9.6, R9.7, R9.8.
 *
 * The shareable page. R9.8 asks for one public place reporting proven coverage,
 * designed coverage, the freshness timestamp and every promise's verdict,
 * reachable without authentication — so this is the URL a README links to and the
 * one a reviewer opens cold. There is no auth to be reachable without: the page is
 * statically rendered from the committed snapshot, which is the whole of the
 * credential-free deployment story (§9.3, R8.6).
 *
 * It composes rather than reimplements. `MetricRail` owns both figures, the
 * degraded replacement and the freshness chip; `VerdictTag` owns the pairing of a
 * verdict's colour with its word. Neither is re-derived here, and this page
 * computes no coverage of its own — every figure it renders is a field of
 * `snapshot.metrics`, checked on parse against the promise list by the schema's
 * cross-field rules (§9.1). A page that divided anything would be a second
 * authority on the one number this product is judged by.
 *
 * Two decisions that are easy to get wrong:
 *
 * 1. **`now` is the snapshot's own `generatedAt`, not the clock.** This is a
 *    static render: whatever instant it is built at is frozen into the HTML, so
 *    reading `Date.now()` here would bake the build machine's clock into a figure
 *    that then silently ages. Measuring freshness against the instant the snapshot
 *    was generated makes the render deterministic — the same input produces the
 *    same page on every machine and in every screenshot — and the page states that
 *    instant in full, so a reader can do the arithmetic against their own clock
 *    rather than trusting ours.
 *
 * 2. **The counts are shown beside the figures.** A coverage percentage with no
 *    denominator is a number a reader has to take on faith. `8 of 8 designed` is
 *    checkable against the list directly below it, which is what makes the page
 *    shareable rather than merely public.
 *
 * Server component: no hooks, no handlers, no client boundary, and nothing here
 * reads the network or the filesystem at request time.
 */

import type { Metadata } from 'next';

import { MetricRail } from '../../components/MetricRail.js';
import { layoutSnapshot, promiseNodes } from '../../lib/layout.js';
import { renderFreshness } from '../../lib/relativeTime.js';
import { snapshot } from '../../lib/snapshot.js';

import { PromiseRow } from './PromiseRow.js';

import '../../styles/coverage.css';

/**
 * Statically rendered, stated rather than inferred. The page reads one imported
 * JSON module and nothing else, so there is nothing here that could make it
 * dynamic — this export is the assertion that it stays that way (§10.1).
 */
export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Coverage — KEPT',
  description:
    'Proven and designed coverage for every promise this repository states, with the ' +
    'freshness of the run behind them.',
};

/** What the page says when the repository states no promises at all (§10.10). */
const NO_PROMISES =
  'This repository states no promises yet, so both figures read n/a and no division was ' +
  'performed. A promise enters the ledger by being cited to a file and a line.';

export default function CoveragePage() {
  const { metrics, degraded, degradedReasons, freshness } = snapshot;
  const freshnessRendering = renderFreshness(freshness, snapshot.generatedAt);
  const promises = promiseNodes(layoutSnapshot(snapshot)).map((node) => node.promise);

  return (
    <div className="coverage-page">
      <header>
        <h1 className="coverage-page__title">Coverage</h1>
        <p className="coverage-page__lede">
          Every promise this repository states, the designed test bound to it, and the verdict of
          the last verification run that reached its terminal event. Proven coverage is withheld
          rather than estimated whenever the run behind it did not prove anything.
        </p>
      </header>

      <MetricRail
        degraded={degraded}
        freshness={{
          relative: freshnessRendering.text,
          tone: freshnessRendering.tone,
          at: freshnessRendering.at,
        }}
        metrics={metrics}
      />

      <p className="coverage-page__measured">
        {`${metrics.provenCount} of ${metrics.totalPromises} promises proven, `}
        {`${metrics.designedCount} designed, ${metrics.undesignedCount} with no designed test. `}
        {'Measured from the snapshot generated at '}
        <span className="coverage-page__instant">{snapshot.generatedAt}</span>
        {'.'}
      </p>

      {degraded ? (
        <p className="coverage-page__degraded surface-well">
          {'Proven coverage is withheld. The enrichment axis was discarded, so this page carries '}
          {'baseline data only: every promise, citation and designed-test binding below is '}
          {'present, and the proven figure is omitted rather than reported as zero. Reason'}
          {degradedReasons.length === 1 ? ' ' : 's '}
          {degradedReasons.map((reason, index) => (
            <span key={reason}>
              {index === 0 ? '' : ', '}
              <span className="coverage-page__reason">{reason}</span>
            </span>
          ))}
          {'.'}
        </p>
      ) : null}

      <section>
        <h2 className="coverage-page__section-title">
          {`Promises (${metrics.totalPromises}), attention first`}
        </h2>
        {promises.length === 0 ? (
          <p className="promise-list__empty surface-well">{NO_PROMISES}</p>
        ) : (
          <ul className="promise-list">
            {promises.map((promise) => (
              <PromiseRow key={promise.id} promise={promise} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
