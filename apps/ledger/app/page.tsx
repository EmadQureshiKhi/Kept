/**
 * `/` — the hero. Design §10.1, §10.2, §10.10, R8.1, R8.6, R9.1, R9.2, R9.6.
 *
 * Statically rendered from the committed snapshot: the metric rail, then the promise
 * graph with its parallel list and its detail panel. No data fetching, no request-time
 * work, no subprocess — `lib/snapshot.ts` validated the file at build time and a
 * violation would have failed that build rather than reached this page (R8.8).
 *
 * **`now` is `snapshot.generatedAt`, not the wall clock.** A statically rendered page
 * has exactly one honest reference instant: the moment the snapshot was built. Reading
 * the real clock here would make the freshness chip differ between the build and every
 * later view of the same HTML, and would make two builds of one snapshot produce two
 * different pages — the same jitter `lib/layout.ts` exists to keep out of the graph.
 * The chip's `title` carries the exact ISO instant either way.
 *
 * The state a judge sees first is **measured and uneven**, and the unevenness is the
 * point. The committed snapshot carries `degraded: false` with no reasons, so the rail
 * renders a real proven coverage figure rather than replacing the tile with the
 * `baseline data only` chip of §10.10, and `freshness.terminalEventAt` is set, so the
 * chip reports a real age against `generatedAt` instead of `never verified`. What the
 * figure says is that seven of the thirteen promises are `proven`. The remaining six are
 * the debt, and they are two different kinds of it: five are `stale`, claims this
 * repository makes about itself in its own root README that nothing has ever run, and
 * one is `red`, the discount claim the fixture is designed never to satisfy. Two
 * promises have an evidence pack sealed and linkable.
 *
 * That combination is the honest state of this repository rather than a fallback, and it
 * is worth stating because the numbers come from different places: the verdicts are
 * replayed from committed Kane recordings, while the coverage axes beside them are read
 * off the live graph by `cover gaps`. The rail has to report a measured figure and an
 * unpaid debt at the same time without either one implying the other, and it has to keep
 * the withheld arm working for the run where those axes are discarded again. Every one
 * of those paths is first-class in the components.
 */

import { MetricRail } from '../components/MetricRail.js';
import { PromiseGraph } from '../components/PromiseGraph.js';
import { renderFreshness } from '../lib/relativeTime.js';
import { snapshot } from '../lib/snapshot.js';

import '../styles/hero.css';

/**
 * **No `metadata` export here, and that is the decision rather than an omission.**
 *
 * The root layout sets `title.default` to `KEPT` and `title.template` to `KEPT · %s`.
 * A `title` on this page would be composed by that template, so the site's front door
 * would read `KEPT · Promises` — a section name for something that is not a section.
 * Falling through to `default` is what makes the home tab read plain `KEPT`, and the
 * layout's `description` already covers this page, being a description of the product
 * and this page being the product's front page.
 */

export default function LedgerPage() {
  const freshness = renderFreshness(snapshot.freshness, snapshot.generatedAt);

  return (
    <>
      <header className="hero-header">
        {/* The title is set in a solid ink slab: `.surface-slab-ink` fills the plane with
            `--text-000` and inverts its type to `--ink-000` (surfaces.css, because that is
            the one file permitted to declare the offset shadow), and
            `.page-title__slab` sizes the box around the words (shell.css). The `h1`
            itself keeps the type ramp, so the heading is still one clamp from a phone to
            a wide monitor — and `.hero-title`'s own `textContent` is unchanged, which is
            what `promise-graph.test.tsx` asserts. */}
        <h1 className="hero-title">
          <span className="page-title__slab surface-slab-ink">
            The promises this codebase makes
          </span>
        </h1>
        <p className="page-standfirst">
          Every claim the repository states in prose, the citation it is written at, the
          designed test that would prove it, and the verdict of the last verification run.
        </p>
      </header>

      <MetricRail
        degraded={snapshot.degraded}
        freshness={{ relative: freshness.text, tone: freshness.tone, at: freshness.at }}
        metrics={snapshot.metrics}
      />

      <PromiseGraph snapshot={snapshot} />
    </>
  );
}
