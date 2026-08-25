/**
 * **Feature: kept, Property 37: The coverage axes are withheld or in range, both
 * axes reach every row, no ready command reaches the DOM as a control, and the two
 * proven figures are never rendered under the same label.**
 *
 * **Validates: Requirements 9.9, 9.10, 9.11, 9.12, 9.13, 9.14, 9.15**
 *
 * *For any* `gaps` payload, the recorded one, a mutated one, an adversarial one, or
 * something that is not a payload at all, four things hold:
 *
 * 1. **withheld or in range.** Each axis percentage is `null` or a number in
 *    `[0, 100]`, and it is never `0` as a stand-in for absent. Each axis ratio is
 *    absent or carries a denominator of at least one, and a shared live
 *    acceptance-criteria count is claimed **only** when the two axes agree on one,
 *    two ratios shown side by side over two denominators are measuring two
 *    populations, and the snapshot refuses to publish that pair at all.
 * 2. **every row carries both axes.** A use case with no design and no run still
 *    reports both figures, because a row that hid itself over having nothing to
 *    report would hide the debt. Rows arrive ordered by risk band then identifier,
 *    with an unrecognised band last.
 * 3. **no ready command is a control.** `pending[].readyCommand` is a literal
 *    `kane-cli …` string. Rendered, it is a `<span>` with no handler, no `href`, no
 *    ancestor that is a button, a link, a form or an input, and no `on*` attribute
 *    anywhere in the ribbon. The deployed Ledger has no mutating route (§9, R8.4);
 *    a control here that spent credits would break that outright, and the strongest
 *    available form of "we did not wire it up" is that there is nothing wired.
 * 4. **the two proven figures never share a label.** `metrics.provenCoverage` counts
 *    promises this repository verified; the ribbon's proven axis counts acceptance
 *    criteria the assurance graph holds execution facts for. R9.15 requires each to
 *    be labelled so neither is read as the other, so the rail's label and the
 *    ribbon's are asserted distinct, the ribbon's labels all name the population
 *    they count, and the rail's label appears nowhere in the ribbon.
 *
 * Clauses 3 and 4 are read off the **rendered DOM**, not off this file's source.
 * That is the difference between asserting the markup and asserting what a reader
 * and a browser get: a control introduced through a component prop, a spread, or a
 * later refactor is caught by walking the tree, and is not caught by reading the
 * JSX.
 *
 * Nothing here runs Kane and nothing reads a `.context/` store: the seed payload is
 * the committed capture, and every other input is generated from it.
 */

import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  SnapshotCoverageAxesSchema,
  coverageAxesDenominator,
  projectGaps,
  type CoverageAxes,
  type SnapshotCoverageAxes,
} from '@kept/core';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CoverageRibbon,
  RAIL_PROVEN_LABEL,
  RIBBON_DESIGN_LABEL,
  RIBBON_PROVEN_LABEL,
  RIBBON_USECASE_LABEL,
  WITHHELD,
} from '../app/coverage/CoverageRibbon.js';
import { MetricRail } from '../components/MetricRail.js';
import { REPO_ROOT } from './_scan.js';

afterEach(cleanup);

/** Design's testing-strategy floor is 100 runs; stated so it cannot regress. */
const NUM_RUNS = 300;

/**
 * The render clauses mount and walk a whole tree per case, so they run a smaller set
 * than the projection clauses above.
 *
 * Forty rather than three hundred, and the number is a budget rather than a
 * preference: `projection-completeness.prop.test.tsx` renders its own arbitrary
 * snapshots with a five-second per-test ceiling, and a second jsdom property suite
 * competing for the same worker pool pushed it over that ceiling at three hundred.
 * A property that makes another property time out has not found a bug, it has spent
 * one. The clauses these runs check are **structural**, a span is not a control, a
 * label is not the rail's, so the interesting variation is in the shapes the
 * generator reaches rather than in how many times it reaches them, and the
 * non-vacuity test above pins that the shapes are reached.
 */
const RENDER_RUNS = 40;

/**
 * Resolved from the repository root rather than from `import.meta.url`: this suite
 * runs in jsdom, where the module URL is an `http:` one and `readFileSync` refuses
 * it. `_scan.ts` already owns the walk up to the root, so the path is derived once.
 */
const FIXTURE = resolve(
  REPO_ROOT,
  'packages/kept-core/test/fixtures/assurance-gaps-complete.ndjson',
);

/** The real captured payload, decoded once. Every generated input is a mutation of it. */
const RECORDED = JSON.parse(
  readFileSync(FIXTURE, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)[0] ?? '{}',
) as Record<string, unknown>;

/* ─────────────────────────────── the generators ────────────────────────────── */

/**
 * A percentage-shaped value: in range, out of range, wrongly typed, or absent.
 *
 * Out-of-range and wrongly typed values are generated deliberately. The clause that
 * matters is not "a good payload reads well", it is that a payload this build
 * cannot read produces a *withheld* figure and never a zero, and only a generator
 * that produces unreadable payloads can exercise it.
 */
const arbPercentValue: fc.Arbitrary<unknown> = fc.oneof(
  fc.integer({ min: 0, max: 100 }),
  fc.double({ min: 0, max: 100, noNaN: true }),
  fc.integer({ min: 101, max: 10_000 }),
  fc.integer({ min: -1_000, max: -1 }),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, null, undefined, 'lots', '', true, []),
  fc.integer({ min: 0, max: 100 }).map((value) => String(value)),
);

/** A ratio-shaped value: `n/m`, a nonsense string, a wrong type, or absent. */
const arbRatioValue: fc.Arbitrary<unknown> = fc.oneof(
  fc
    .tuple(fc.nat({ max: 40 }), fc.integer({ min: 0, max: 40 }))
    .map(([left, right]) => `${String(left)}/${String(right)}`),
  fc.constantFrom('6/6', '1/9', '0/0', 'six of six', '', '/', '3', null, undefined, 7, {}),
);

/** A risk band: one of the three observed, something else, or absent. */
const arbRisk: fc.Arbitrary<unknown> = fc.constantFrom(
  'high',
  'med',
  'low',
  'catastrophic',
  '',
  null,
  undefined,
  3,
);

/**
 * A `ready_command`-shaped value, including the shapes that would matter if anything
 * ever treated it as markup or as a URL rather than as text.
 */
const arbReadyCommand: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom(
    'kane-cli design tests --use-case uc-1',
    'kane-cli design explain gap-1',
    'javascript:alert(1)',
    '<button onclick="spend()">run</button>',
    'kane-cli run --agent; rm -rf /',
    '  kane-cli  design tests  ',
    '',
    null,
    undefined,
  ),
  fc.string(),
);

const arbPending: fc.Arbitrary<unknown> = fc.record(
  {
    kind: fc.constantFrom('zero-scenario', 'incomplete', 'missing-expected-result', null),
    why: fc.oneof(fc.string(), fc.constant(null)),
    risk: arbRisk,
    stage: fc.constantFrom('design', 'run', null),
    tag: fc.constantFrom('create', 'update', null),
    ready_command: arbReadyCommand,
  },
  { requiredKeys: [] },
);

const arbUseCase: fc.Arbitrary<unknown> = fc.record(
  {
    id: fc.oneof(
      fc.integer({ min: 1, max: 40 }).map((n) => `uc-${String(n)}`),
      fc.constantFrom('', null, undefined),
      fc.string(),
    ),
    title: fc.oneof(fc.string(), fc.constant(null)),
    risk: arbRisk,
    design_completeness: fc.oneof(
      fc.record({ pct: arbPercentValue, status: fc.constantFrom('complete', 'undesigned', null) }),
      fc.constantFrom(null, undefined, 7),
    ),
    proven: fc.oneof(
      fc.record({ pct: arbPercentValue, status: fc.constantFrom('proven', 'not_run', null) }),
      fc.constantFrom(null, undefined, 'nope'),
    ),
    stale_acs: fc.oneof(fc.nat({ max: 12 }), fc.constantFrom(null, -1, '3')),
    pending: fc.oneof(fc.array(arbPending, { maxLength: 3 }), fc.constantFrom(null, undefined, 5)),
  },
  { requiredKeys: [] },
);

/** A whole `gaps` payload: mutated, adversarial, or not a payload at all. */
const arbPayload: fc.Arbitrary<unknown> = fc.oneof(
  { arbitrary: fc.constant(RECORDED), weight: 2 },
  {
    weight: 6,
    arbitrary: fc.record(
      {
        type: fc.constant('gaps'),
        v: fc.constant(1),
        verb: fc.constant('gaps'),
        design_completeness: fc.oneof(
          fc.record({
            pct: arbPercentValue,
            acs_designed: arbRatioValue,
            usecases_complete: arbRatioValue,
            ucs_needing_scenarios: fc.oneof(fc.nat({ max: 40 }), fc.constant(null)),
          }),
          fc.constantFrom(null, undefined, 'absent'),
        ),
        proven: fc.oneof(
          fc.record({
            pct: arbPercentValue,
            acs_proven: arbRatioValue,
            failing: fc.nat({ max: 9 }),
            blocked: fc.nat({ max: 9 }),
            not_run: fc.nat({ max: 9 }),
            config: fc.constant({
              source: 'graph_execution_facts',
              denominator: 'current_live_acs',
            }),
          }),
          fc.constantFrom(null, undefined, 42),
        ),
        usecases: fc.oneof(
          fc.array(arbUseCase, { maxLength: 6 }),
          fc.constantFrom(null, undefined, {}),
        ),
        other: fc.constant([{ ref: 'gap-1', ready_command: 'kane-cli design explain gap-1' }]),
      },
      { requiredKeys: [] },
    ),
  },
  { arbitrary: fc.constantFrom(null, undefined, 7, 'text', true, [], {}), weight: 1 },
);

/* ───────────────────────────── non-vacuity ─────────────────────────────────── */

describe('Feature: kept, Property 37: the generator reaches both states it has to', () => {
  it('produces payloads that project rows and payloads that project none', () => {
    // Three clauses below return early on one side of that split, so the split has to
    // be shown to exist. A property whose interesting arm is never generated passes
    // for the worst possible reason.
    const sampled = fc.sample(arbPayload, { numRuns: 400, seed: 22_1 }).map(
      (payload) => projectGaps(payload).axes,
    );
    expect(sampled.filter((axes) => axes.rows.length > 0).length).toBeGreaterThan(20);
    expect(sampled.filter((axes) => axes.rows.length === 0).length).toBeGreaterThan(20);
    // And it reaches an unreadable percentage, which is the case the withheld rule is
    // about, as well as a readable one.
    expect(sampled.filter((axes) => axes.proven.pct === null).length).toBeGreaterThan(10);
    expect(sampled.filter((axes) => axes.proven.pct !== null).length).toBeGreaterThan(10);
    // And a ready command to render, which is what clause 3 walks the DOM for.
    expect(
      sampled.filter((axes) =>
        axes.rows.some((row) => row.pending.some((item) => item.readyCommand !== null)),
      ).length,
    ).toBeGreaterThan(5);
  });
});

/* ────────────────────────── clause 1 and clause 2 ─────────────────────────── */

describe('Feature: kept, Property 37: the axes are withheld or in range, and every row carries both', () => {
  it('never reports a percentage outside [0, 100], and never a zero for absent', () => {
    fc.assert(
      fc.property(arbPayload, (payload) => {
        const axes = projectGaps(payload).axes;
        for (const pct of [axes.designCompleteness.pct, axes.proven.pct]) {
          if (pct === null) continue;
          expect(Number.isFinite(pct)).toBe(true);
          expect(pct).toBeGreaterThanOrEqual(0);
          expect(pct).toBeLessThanOrEqual(100);
        }
        for (const row of axes.rows) {
          for (const pct of [row.designCompleteness.pct, row.proven.pct]) {
            if (pct === null) continue;
            expect(pct).toBeGreaterThanOrEqual(0);
            expect(pct).toBeLessThanOrEqual(100);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('claims a shared acceptance-criteria count only when both ratios agree on one', () => {
    fc.assert(
      fc.property(arbPayload, (payload) => {
        const axes = projectGaps(payload).axes;
        const designed = axes.designCompleteness.ratio.denominator;
        const proven = axes.proven.ratio.denominator;
        for (const denominator of [designed, proven]) {
          if (denominator === null) continue;
          expect(Number.isInteger(denominator)).toBe(true);
          expect(denominator).toBeGreaterThanOrEqual(1);
        }
        const shared = coverageAxesDenominator(axes);
        if (shared === null) {
          expect(designed === null || proven === null || designed !== proven).toBe(true);
        } else {
          expect(shared).toBe(designed);
          expect(shared).toBe(proven);
        }
        // A numerator is only ever published beside a denominator it does not exceed.
        for (const ratio of [axes.designCompleteness.ratio, axes.proven.ratio]) {
          if (ratio.numerator === null) continue;
          expect(ratio.denominator).not.toBeNull();
          expect(ratio.numerator).toBeLessThanOrEqual(ratio.denominator ?? 0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('gives every row both axes, an identifier, and a rank no better than its band', () => {
    fc.assert(
      fc.property(arbPayload, (payload) => {
        const axes = projectGaps(payload).axes;
        for (const row of axes.rows) {
          expect(typeof row.id).toBe('string');
          expect(row.id.length).toBeGreaterThan(0);
          expect(typeof row.title).toBe('string');
          expect(row.designCompleteness).not.toBeUndefined();
          expect(row.proven).not.toBeUndefined();
          expect(Object.keys(row.designCompleteness).sort()).toEqual(['pct', 'status']);
          expect(Object.keys(row.proven).sort()).toEqual(['pct', 'status']);
          // An unrecognised band sorts after every known one, never first.
          if (row.risk === null || !['high', 'med', 'low'].includes(row.risk)) {
            expect(row.riskRank).toBe(3);
          }
        }
        // Ordered by risk band, then identifier (R9.12).
        const ranks = axes.rows.map((row) => row.riskRank);
        expect([...ranks].sort((left, right) => left - right)).toEqual(ranks);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('projects a value the snapshot schema accepts, or no rows at all', () => {
    fc.assert(
      fc.property(arbPayload, (payload) => {
        const axes = projectGaps(payload).axes;
        const plain = JSON.parse(JSON.stringify(axes)) as unknown;
        // R9.13 in schema form: rows or nothing. An axes value with no rows is the
        // withheld state, and the withheld state is spelled `null` in the snapshot.
        expect(SnapshotCoverageAxesSchema.safeParse(plain).success).toBe(axes.rows.length > 0);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

/* ────────────────────────── clause 3 and clause 4 ─────────────────────────── */

/** Element names that are, or can become, a control. */
const CONTROL_TAGS = new Set(['A', 'BUTTON', 'FORM', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL']);

/** Attributes that make an element act, rather than say. */
const ACTING_ATTRIBUTES = ['href', 'src', 'action', 'formaction', 'onclick', 'role', 'tabindex'];

function asSnapshotAxes(axes: CoverageAxes): SnapshotCoverageAxes {
  return SnapshotCoverageAxesSchema.parse(JSON.parse(JSON.stringify(axes)));
}

describe('Feature: kept, Property 37: no ready command is a control, and the two proven figures never share a label', () => {
  it('renders every ready command as text with no control anywhere above it', () => {
    fc.assert(
      fc.property(arbPayload, (payload) => {
        const axes = projectGaps(payload).axes;
        if (axes.rows.length === 0) return;
        const { container, unmount } = render(
          <CoverageRibbon
            axes={asSnapshotAxes(axes)}
            degradedReasons={[]}
            promiseCounts={{ proven: 7, total: 8 }}
          />,
        );
        try {
          const expected = axes.rows.flatMap((row) =>
            row.pending.map((item) => item.readyCommand).filter((value) => value !== null),
          );
          const rendered = [...container.querySelectorAll('[data-ready-command]')];
          expect(rendered).toHaveLength(expected.length);

          for (const element of rendered) {
            // A span, carrying text, and carrying nothing that acts.
            expect(element.tagName).toBe('SPAN');
            expect(CONTROL_TAGS.has(element.tagName)).toBe(false);
            expect(element.children).toHaveLength(0);
            for (const attribute of ACTING_ATTRIBUTES) {
              expect(element.hasAttribute(attribute)).toBe(false);
            }
            // Nor is one wrapped around it.
            let parent = element.parentElement;
            while (parent !== null && parent !== container) {
              expect(CONTROL_TAGS.has(parent.tagName)).toBe(false);
              parent = parent.parentElement;
            }
            expect(expected).toContain(element.textContent);
          }

          // And nothing in the whole ribbon acts, whether or not it carries a command.
          for (const element of container.querySelectorAll('*')) {
            expect(CONTROL_TAGS.has(element.tagName)).toBe(false);
            for (const attribute of element.getAttributeNames()) {
              expect(attribute.toLowerCase().startsWith('on')).toBe(false);
            }
            expect(element.hasAttribute('href')).toBe(false);
            expect(element.hasAttribute('action')).toBe(false);
          }
        } finally {
          unmount();
        }
      }),
      { numRuns: RENDER_RUNS },
    );
  });

  it('never labels the acceptance-criteria figure with the rail’s word for promises', () => {
    fc.assert(
      fc.property(arbPayload, (payload) => {
        const axes = projectGaps(payload).axes;
        if (axes.rows.length === 0) return;
        const { container, unmount } = render(
          <div>
            <MetricRail
              degraded={false}
              freshness={{ relative: '2 hours ago', tone: 'current', at: '2026-08-21T16:35:22Z' }}
              metrics={{ designedCoverage: 1, provenCoverage: 0.875, undesignedCount: 0 }}
            />
            <CoverageRibbon
              axes={asSnapshotAxes(axes)}
              degradedReasons={[]}
              promiseCounts={{ proven: 7, total: 8 }}
            />
          </div>,
        );
        try {
          const ribbon = container.querySelector('section');
          expect(ribbon).not.toBeNull();
          if (ribbon === null) return;

          // The two labels are different words, and the rail's never appears inside
          // the ribbon.
          expect(RIBBON_PROVEN_LABEL).not.toBe(RAIL_PROVEN_LABEL);
          const railTile = container.querySelector('[data-metric="proven-coverage"]');
          expect(railTile?.textContent).toContain(RAIL_PROVEN_LABEL);
          expect(ribbon.textContent ?? '').not.toContain(RAIL_PROVEN_LABEL);

          // Every axis label in the ribbon names the population it counts, so no
          // figure here can be read as the rail's.
          const labels = [...ribbon.querySelectorAll('[data-axis-label]')].map(
            (element) => element.getAttribute('data-axis-label') ?? '',
          );
          expect(labels.length).toBeGreaterThan(0);
          for (const label of labels) {
            expect([RIBBON_DESIGN_LABEL, RIBBON_PROVEN_LABEL, RIBBON_USECASE_LABEL]).toContain(
              label,
            );
            expect(label).not.toBe(RAIL_PROVEN_LABEL);
          }
          // The ribbon's own proven figure is labelled once at the axis level and once
          // per row, and both spellings say `acceptance criteria`.
          expect(RIBBON_PROVEN_LABEL).toContain('acceptance criteria');
          expect(RIBBON_DESIGN_LABEL).toContain('acceptance criteria');
        } finally {
          unmount();
        }
      }),
      { numRuns: RENDER_RUNS },
    );
  });

  it('withholds rather than zeroing, and never renders an empty ribbon', () => {
    fc.assert(
      fc.property(arbPayload, fc.array(fc.constantFrom('gaps-payload-unreadable', 'paused-resumable'), { maxLength: 2 }), (payload, reasons) => {
        const axes = projectGaps(payload).axes;
        if (axes.rows.length > 0) return;
        // Zero rows is the withheld state. The ribbon states it, quotes the reason,
        // and renders no row at all, never a row list that reads as "nothing owed".
        const { container, unmount } = render(
          <CoverageRibbon
            axes={null}
            degradedReasons={reasons}
            promiseCounts={{ proven: 7, total: 8 }}
          />,
        );
        try {
          expect(container.querySelector('[data-coverage-axes="withheld"]')).not.toBeNull();
          expect(container.querySelectorAll('[data-usecase]')).toHaveLength(0);
          expect(container.querySelectorAll('[data-ready-command]')).toHaveLength(0);
          const text = container.textContent ?? '';
          expect(text).toContain(WITHHELD);
          expect(text).not.toContain('0%');
          for (const reason of reasons) expect(text).toContain(reason);
        } finally {
          unmount();
        }
      }),
      { numRuns: RENDER_RUNS },
    );
  });
});
