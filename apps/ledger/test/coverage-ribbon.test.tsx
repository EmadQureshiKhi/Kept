/**
 * The dual-axis ribbon, rendered, design §5.3.0, §10.1, R9.10 through R9.15.
 *
 * Two halves, and both of them run with **no Kane and no `.context/` store**.
 *
 * The **committed** half renders `/coverage` from `apps/ledger/data/ledger.snapshot.json`
 * and asserts the ribbon a judge actually opens: nine use-case rows in risk-then-id
 * order, both axes read verbatim off the file, the use-case debt shown as debt, and
 * every `kane-cli …` string sitting in the DOM as text.
 *
 * The **offline** half projects the committed `cover gaps` capture,
 * `packages/kept-core/test/fixtures/assurance-gaps-complete.ndjson`, through
 * `projectGaps` and renders the ribbon from those bytes directly. That is what makes
 * the axis reproducible in CI rather than only on a machine with an assurance chain:
 * the same rows come out of the fixture as out of the snapshot, so a reviewer can
 * check the published figure against a recorded stream instead of taking it on trust.
 *
 * The withheld half of R9.13 is asserted here as an example and in
 * `coverage-axes.prop.test.tsx` over arbitrary payloads. Both matter: the example
 * pins the words a reader sees, the property pins that no payload can produce a
 * control or a zero.
 */

import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SnapshotCoverageAxesSchema, contractFor, parseStream, projectGaps } from '@kept/core';
import { afterEach, describe, expect, it } from 'vitest';

import CoveragePage from '../app/coverage/page.js';
import {
  AXES_WITHHELD_LEAD,
  CoverageRibbon,
  RAIL_PROVEN_LABEL,
  RIBBON_DESIGN_LABEL,
  RIBBON_PROVEN_LABEL,
  RIBBON_USECASE_LABEL,
  ribbonUsecaseNote,
  usecaseDuplication,
} from '../app/coverage/CoverageRibbon.js';
import { snapshot } from '../lib/snapshot.js';
import { REPO_ROOT } from './_scan.js';

afterEach(cleanup);

const FIXTURE = resolve(
  REPO_ROOT,
  'packages/kept-core/test/fixtures/assurance-gaps-complete.ndjson',
);

/** The committed capture, parsed and projected with nothing else in the loop. */
function axesFromFixture() {
  const lines = readFileSync(FIXTURE, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
  const stream = parseStream(contractFor('Assurance'), lines);
  return projectGaps(stream.gaps).axes;
}

describe('the use-case denominator is published with its caveat', () => {
  /**
   * The figure is Kane's count and Kane's count is inflated: `maintain reconcile`
   * appends use cases rather than matching them, so four of the nine are duplicates of
   * another four and the graph describes five distinct use cases. That was measured by
   * driving the documentation trigger live at task 22.2, and reverting the four that run
   * added is what brought the figure back to `1/9`.
   *
   * §5.3.0's rule is that this ribbon quotes the graph rather than editing it, so the
   * number stays as Kane reports it and the page carries the caveat instead. A published
   * denominator a reader cannot interpret is not a figure, it is a decoration, so the
   * caveat is asserted on the rendered page and not merely exported.
   */
  it('says on the page that the denominator is Kane’s count and runs high', () => {
    const rows = snapshot.coverageAxes?.rows ?? [];
    expect(rows.length, 'the committed snapshot publishes no rows to describe').toBeGreaterThan(0);
    const { container, unmount } = render(<CoveragePage />);
    try {
      const note = container.querySelector('[data-usecase-note]');
      expect(note, 'the use-case caveat is not on the page').not.toBeNull();
      // Derived from the rows the page rendered, not compared against a constant.
      expect(note?.textContent).toBe(ribbonUsecaseNote(usecaseDuplication(rows)));
      const text = note?.textContent ?? '';
      expect(text).toContain('as Kane reports it');
      expect(text).toContain('quotes the graph rather than editing it');
    } finally {
      unmount();
    }
  });

  it('states the row count the page itself rendered, not a fixed one', () => {
    /* The defect this replaced: the note was a fixed sentence saying "four of these nine"
       under a heading that read its own count off the data. `maintain reconcile` appends
       use cases rather than matching them and has moved this count once already, so the
       page would have contradicted itself in adjacent lines. */
    const rows = snapshot.coverageAxes?.rows ?? [];
    const { container, unmount } = render(<CoveragePage />);
    try {
      const text = container.querySelector('[data-usecase-note]')?.textContent ?? '';
      expect(text).toContain(`${String(rows.length)} of them`);
      const counts = usecaseDuplication(rows);
      if (counts.repeated > 0) {
        expect(text).toContain(`${String(counts.repeated)} of these ${String(counts.total)}`);
        expect(text).toContain(`${String(counts.distinct)} distinct use cases`);
      }
    } finally {
      unmount();
    }
  });

  it('counts repetition by description, and says nothing when there is none', () => {
    expect(usecaseDuplication([])).toEqual({ total: 0, distinct: 0, repeated: 0 });
    expect(usecaseDuplication([{ title: 'a' }, { title: 'b' }])).toEqual({
      total: 2,
      distinct: 2,
      repeated: 0,
    });
    expect(
      usecaseDuplication([{ title: 'a' }, { title: 'a' }, { title: 'a' }, { title: 'b' }]),
    ).toEqual({ total: 4, distinct: 2, repeated: 2 });

    // A graph that stops duplicating stops being described as if it did.
    const clean = ribbonUsecaseNote({ total: 5, distinct: 5, repeated: 0 });
    expect(clean).toContain('5 of them');
    expect(clean).toContain('describes something different');
    expect(clean).not.toContain('repeat another');
    expect(clean).not.toContain('runs high');
  });

  it('matches the committed snapshot’s own duplication, measured here', () => {
    // Four duplicate pairs below nine rows, so five distinct descriptions. Measured off
    // the file rather than asserted from memory, so it moves with the artefact.
    const rows = snapshot.coverageAxes?.rows ?? [];
    expect(usecaseDuplication(rows)).toEqual({ total: 9, distinct: 5, repeated: 4 });
  });

  it('authors no class of its own for it', () => {
    // The note reuses the statement block the page already has. A new class here would
    // be a new visual token, which the palette and parity scans would then have to
    // measure, and this is one sentence of prose.
    const { container, unmount } = render(<CoveragePage />);
    try {
      const note = container.querySelector('[data-usecase-note]');
      expect(note?.className).toBe('coverage-page__measured');
    } finally {
      unmount();
    }
  });
});

describe('/coverage, the ribbon the committed snapshot publishes', () => {
  it('is present, with one row per use case in the snapshot’s own order (R9.12)', () => {
    const axes = snapshot.coverageAxes ?? null;
    expect(axes, 'the committed snapshot carries no coverage axes').not.toBeNull();
    if (axes === null) return;

    const { container, unmount } = render(<CoveragePage />);
    try {
      const rows = [...container.querySelectorAll('[data-usecase]')];
      expect(rows.map((row) => row.getAttribute('data-usecase'))).toEqual(
        axes.rows.map((row) => row.id),
      );
      // Risk bands are non-decreasing down the page, which is the visible half of
      // "ordered by risk band then identifier".
      const bands = rows.map((row) => row.getAttribute('data-risk'));
      expect(bands).toEqual(axes.rows.map((row) => row.risk ?? 'unranked'));
    } finally {
      unmount();
    }
  });

  it('reports both axes verbatim from the file, and recomputes nothing', () => {
    const axes = snapshot.coverageAxes ?? null;
    if (axes === null) return;
    const { container, unmount } = render(<CoveragePage />);
    try {
      const design = container.querySelector(`[data-axis-label="${RIBBON_DESIGN_LABEL}"]`);
      const proven = container.querySelector(`[data-axis-label="${RIBBON_PROVEN_LABEL}"]`);
      expect(design?.textContent).toContain(`${String(axes.designCompleteness.pct)}%`);
      expect(design?.textContent).toContain(axes.designCompleteness.ratio.text ?? '');
      expect(proven?.textContent).toContain(`${String(axes.proven.pct)}%`);
      expect(proven?.textContent).toContain(axes.proven.ratio.text ?? '');
      // And it says what the proven axis is counted over, so the figure is checkable.
      expect(proven?.textContent).toContain('graph_execution_facts');
      expect(proven?.textContent).toContain('current_live_acs');
    } finally {
      unmount();
    }
  });

  it('shows the use-case debt as debt: 1/9, with eight designs owed', () => {
    const axes = snapshot.coverageAxes ?? null;
    if (axes === null) return;
    const { container, unmount } = render(<CoveragePage />);
    try {
      const debt = container.querySelector(`[data-axis-label="${RIBBON_USECASE_LABEL}"]`);
      expect(debt, 'the ribbon publishes no use-case figure at all').not.toBeNull();
      expect(debt?.textContent).toContain(axes.designCompleteness.usecasesComplete.text ?? '');
      expect(debt?.textContent).toContain(
        `${String(axes.designCompleteness.ucsNeedingScenarios)} use cases still owe`,
      );
      // The debt is real and it is on the page as a figure, not rounded into the
      // acceptance-criteria ratio beside it. Eight designs owed, and no use case was
      // authored to make the number look better.
      expect(axes.designCompleteness.usecasesComplete.text).toBe('1/9');
      expect(axes.designCompleteness.ucsNeedingScenarios).toBe(8);
    } finally {
      unmount();
    }
  });

  it('publishes every ready command as text, in a span, under no control', () => {
    const axes = snapshot.coverageAxes ?? null;
    if (axes === null) return;
    const expected = axes.rows.flatMap((row) =>
      row.pending.map((item) => item.readyCommand).filter((value) => value !== null),
    );
    expect(expected.length).toBeGreaterThan(0);

    const { container, unmount } = render(<CoveragePage />);
    try {
      const rendered = [...container.querySelectorAll('[data-ready-command]')];
      expect(rendered.map((element) => element.textContent)).toEqual(expected);
      for (const element of rendered) {
        expect(element.tagName).toBe('SPAN');
        expect(element.hasAttribute('href')).toBe(false);
        expect(element.hasAttribute('onclick')).toBe(false);
        expect(element.closest('button')).toBeNull();
        expect(element.closest('a')).toBeNull();
        expect(element.closest('form')).toBeNull();
      }
      // The whole page, not only the ribbon: `/coverage` offers no way to spend a
      // credit, which is the read-only guarantee of §9 stated at the DOM.
      expect(container.querySelectorAll('button')).toHaveLength(0);
      expect(container.querySelectorAll('form')).toHaveLength(0);
      expect(container.querySelectorAll('input')).toHaveLength(0);
    } finally {
      unmount();
    }
  });

  it('labels the two proven figures apart, in the words a reader sees (R9.15)', () => {
    const { container, unmount } = render(<CoveragePage />);
    try {
      const text = container.textContent ?? '';
      // The rail's word for promises, and the ribbon's word for acceptance criteria.
      expect(RAIL_PROVEN_LABEL).toBe('proven coverage');
      expect(RIBBON_PROVEN_LABEL).toBe('proven, acceptance criteria');
      expect(text).toContain(RIBBON_PROVEN_LABEL);

      // The sentence that makes the disagreement legible rather than suspicious.
      expect(text).toContain('The rail above counts promises');
      expect(text).toContain(
        `${String(snapshot.metrics.provenCount)} of ${String(snapshot.metrics.totalPromises)} promises this repository verified`,
      );
      expect(text).toContain('acceptance criteria the assurance graph holds execution facts for');
      expect(text).toContain('Different denominators over different objects');

      // And the rail's label never appears inside the ribbon.
      const ribbon = container.querySelector('[aria-labelledby="coverage-axes-heading"]');
      expect(ribbon).not.toBeNull();
      expect(ribbon?.textContent ?? '').not.toContain(RAIL_PROVEN_LABEL);
    } finally {
      unmount();
    }
  });

  it('renders the ribbon with Kane invoked zero times (R9.14)', () => {
    // The page reads one imported JSON module. There is no invoker in this render, no
    // process, no `.context/` store and no network, the axes are a field of the
    // committed file, which is the whole of R9.14.
    expect(CoveragePage.length).toBe(0);
    const { container, unmount } = render(<CoveragePage />);
    try {
      expect(container.querySelectorAll('[data-usecase]').length).toBe(
        snapshot.coverageAxes?.rows.length ?? 0,
      );
    } finally {
      unmount();
    }
  });
});

describe('the ribbon renders from the committed `cover gaps` bytes, offline', () => {
  it('projects the same rows the snapshot publishes', () => {
    const fixtureAxes = axesFromFixture();
    expect(fixtureAxes.rows).toHaveLength(9);
    expect(fixtureAxes.rows.map((row) => row.id)).toEqual(
      snapshot.coverageAxes?.rows.map((row) => row.id) ?? [],
    );
    expect(fixtureAxes.designCompleteness.ratio.text).toBe(
      snapshot.coverageAxes?.designCompleteness.ratio.text,
    );
    expect(fixtureAxes.proven.ratio.text).toBe(snapshot.coverageAxes?.proven.ratio.text);
  });

  it('renders from those bytes with no snapshot in the loop at all', () => {
    const axes = SnapshotCoverageAxesSchema.parse(JSON.parse(JSON.stringify(axesFromFixture())));
    const { container, unmount } = render(
      <CoverageRibbon
        axes={axes}
        degradedReasons={[]}
        promiseCounts={{ proven: 7, total: 8 }}
      />,
    );
    try {
      expect(container.querySelectorAll('[data-usecase]')).toHaveLength(9);
      expect(container.querySelectorAll('[data-ready-command]')).toHaveLength(8);
      expect(container.textContent ?? '').toContain('1/9');
    } finally {
      unmount();
    }
  });
});

describe('the ribbon is withheld rather than empty when the axes are absent (R9.13)', () => {
  it('states the fact, quotes the reason, and renders no row', () => {
    const { container, unmount } = render(
      <CoverageRibbon
        axes={null}
        degradedReasons={['gaps-payload-unreadable']}
        promiseCounts={{ proven: 7, total: 8 }}
      />,
    );
    try {
      const text = container.textContent ?? '';
      expect(text).toContain(AXES_WITHHELD_LEAD);
      expect(text).toContain('gaps-payload-unreadable');
      expect(container.querySelector('[data-coverage-axes="withheld"]')).not.toBeNull();
      expect(container.querySelectorAll('[data-usecase]')).toHaveLength(0);
      // Never a zero, and never a row list that reads as "nothing owed".
      expect(text).not.toContain('0%');
      expect(container.querySelector('.promise-list')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('uses the one dashed empty state in the system, not a card', () => {
    const { container, unmount } = render(
      <CoverageRibbon axes={null} degradedReasons={[]} promiseCounts={{ proven: 0, total: 0 }} />,
    );
    try {
      // §10.10: a region that is specified and holding nothing is marked by the one
      // dashed border, so a reader who has met one already knows it is not a
      // failure to load.
      const empty = container.querySelector('.promise-list__empty');
      expect(empty).not.toBeNull();
      expect(empty?.getAttribute('data-coverage-axes')).toBe('withheld');
    } finally {
      unmount();
    }
  });
});
