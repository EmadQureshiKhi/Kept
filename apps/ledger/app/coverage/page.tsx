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

import { CoverageRibbon } from './CoverageRibbon.js';
import { PromiseFilter } from './PromiseFilter.js';

import '../../styles/coverage.css';

/**
 * Statically rendered, stated rather than inferred. The page reads one imported
 * JSON module and nothing else, so there is nothing here that could make it
 * dynamic — this export is the assertion that it stays that way (§10.1).
 */
export const dynamic = 'force-static';

/**
 * The short name only. The root layout's `title.template` composes it into
 * `KEPT · Coverage`, so repeating the product name here would produce it twice, and
 * the descriptive sentence belongs to `description` rather than to the tab.
 */
export const metadata: Metadata = {
  title: 'Coverage',
  description:
    'Proven and designed coverage for every promise this repository states, with the ' +
    'freshness of the run behind them.',
};

/**
 * What the page says when the repository states no promises at all (§10.10).
 *
 * Two lines, because an empty state has two jobs: state the fact, then say what would
 * change it. The lead line is the answer and the detail line is the reason, and a
 * reader who only takes in the bold line has still taken in the fact.
 */
export const NO_PROMISES_LEAD = 'This repository states no promises yet.';

export const NO_PROMISES_DETAIL =
  'Both figures read n/a and no division was performed \u2014 a percentage over zero promises ' +
  'is a number nobody computed. A promise enters the ledger by being cited to a file and a ' +
  'line, so the first one appears here as soon as one is.';

export default function CoveragePage() {
  const { metrics, degraded, degradedReasons, freshness } = snapshot;
  const freshnessRendering = renderFreshness(freshness, snapshot.generatedAt);
  const promises = promiseNodes(layoutSnapshot(snapshot)).map((node) => node.promise);

  return (
    <div className="coverage-page">
      <header>
        {/* The page title, set in a solid ink slab: the plane and its offset shadow come
            from `.surface-slab-ink` (surfaces.css, the one file that may declare a
            shadow), the box from `.page-title__slab`, and the size, case and tracking
            from the `h1` clamp in `shell.css`. */}
        <h1 className="coverage-page__title">
          <span className="page-title__slab surface-slab-ink">Coverage</span>
        </h1>
        <p className="page-standfirst">
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

      {/* The measured line. Every figure in it is lifted into its own tabular run so the
          numbers a reader is checking carry more weight than the words between them; the
          string the sentence spells out is unchanged, which is what
          `coverage-render.test.tsx` reads. */}
      <p className="coverage-page__measured">
        <span className="coverage-page__figure">{metrics.provenCount}</span>
        {' of '}
        <span className="coverage-page__figure">{metrics.totalPromises}</span>
        {' promises proven, '}
        <span className="coverage-page__figure">{metrics.designedCount}</span>
        {' designed, '}
        <span className="coverage-page__figure">{metrics.undesignedCount}</span>
        {' with no designed test. Measured from the snapshot generated at '}
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

      {/* The dual-axis ribbon (R9.12). It sits above the promise list because it is
          the coarser statement — nine use cases against six acceptance criteria —
          and because R9.15's disambiguation has to be read *before* a reader meets a
          second figure called proven. Withheld rather than zeroed whenever the
          assurance graph was not read (R9.13). */}
      <CoverageRibbon
        axes={snapshot.coverageAxes ?? null}
        degradedReasons={degradedReasons}
        promiseCounts={{ proven: metrics.provenCount, total: metrics.totalPromises }}
      />

      <section>
        {/* `.section-head` is the shared strip in `shell.css`: small caps over a 3px ink
            rule, so the heading opens a block instead of being one more line of text on a
            ruled page. The count stays inside the heading's own string, because the count
            is what makes the heading checkable against the list below it. */}
        <h2 className="section-head">
          {`Promises (${metrics.totalPromises}), attention first`}
        </h2>
        {promises.length === 0 ? (
          /* No `.surface-well` here: an empty region is marked by the one dashed
             border in the system rather than by depth, so "specified and empty"
             looks the same on every page (§10.10). */
          <div className="promise-list__empty">
            <p className="promise-list__empty-lead">{NO_PROMISES_LEAD}</p>
            <p className="promise-list__empty-detail">{NO_PROMISES_DETAIL}</p>
          </div>
        ) : (
          /* `PromiseFilter` owns the chip row and the frame around the list. It reads the
             selected verdict from the query string, so the page stays `force-static`: the
             whole list ships in this HTML, a chip is a link rather than a control, and
             following one narrows what is shown without touching a server.

             The prerendered HTML cannot know the query string, so it lists every promise
             and the filter narrows it on mount. That is also the graceful degradation: with
             JavaScript disabled a reader keeps every promise, because the filter is an
             accelerator over data already on the page rather than the only way to see it. */
          <PromiseFilter promises={promises} />
        )}
      </section>
    </div>
  );
}
