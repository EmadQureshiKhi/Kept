import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  COVERAGE_RISK_BANDS,
  LedgerSnapshotSchema,
  NO_COVERAGE_AXES,
  SnapshotCoverageAxesSchema,
  UNKNOWN_RISK_RANK,
  compareCoverageRowIds,
  contractFor,
  coverageAxesDenominator,
  coverageRiskRank,
  isCoverageAxes,
  parseStream,
  projectGaps,
  readCoverageRatio,
  readPercent,
  type CoverageAxes,
} from '@kept/core';

/**
 * Task 22.1, the coverage-against-acceptance-criteria axis, asserted offline
 * (design §5.3.0, R9.9 through R9.15).
 *
 * **Nothing here runs Kane and nothing here reads a `.context/` store.** Every byte
 * comes off disk from `test/fixtures/assurance-gaps-*.ndjson`, so the axis the
 * shareable page publishes is reproducible in CI on a machine with no assurance
 * chain installed at all. That is the point of committing the stream: a headline
 * figure that can only be re-derived by spending credits is a figure nobody can
 * check.
 *
 * Two of the five fixtures are **real captured stdout** from
 * `kane-cli cover gaps --json --mode agent`:
 *
 * | fixture | what it is |
 * |---|---|
 * | `assurance-gaps-complete.ndjson` | captured in this repository. Exit 0, `done` with `status: complete`, nine use-case rows |
 * | `assurance-gaps-refused.ndjson` | captured in an empty directory with no `.context/` store. Exit 2, `done` with `status: refused`, `verb: gaps` |
 * | `assurance-gaps-paused.ndjson` | the real payload line, then a `paused` terminal at exit 3 |
 * | `assurance-gaps-truncated.ndjson` | the real payload line and nothing after it |
 * | `assurance-gaps-no-rows.ndjson` | the real axes with an empty `usecases` list |
 *
 * The last three are derived and say so, here and in the fixtures README. Kane does
 * not pause, truncate or empty this command in this repository, and a degradation
 * path asserted only against streams somebody has seen is a degradation path that
 * holds for the streams somebody has seen.
 *
 * ### The degradation paths carry the same weight as the success path
 *
 * The rule they all express is R9.13: an axis that was not delivered is **withheld**.
 * Never a zero, never an empty ribbon. A zero on the proven axis is a claim that
 * nothing is proven; an empty row list under two green percentages reads as "nothing
 * owed". Both are worse than a page that says the figure is missing, because both
 * are legible as facts.
 *
 * The provider-level half of this, which reason each stream degrades with, is in
 * `providers-enrichment.test.ts`. This file asserts the two layers underneath it:
 * what the parser makes of the bytes, and what the projection makes of the payload.
 */

const FIXTURES = new URL('./fixtures/', import.meta.url);

function fixtureLines(name: string): readonly string[] {
  return readFileSync(new URL(name, FIXTURES), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
}

const COMPLETE = fixtureLines('assurance-gaps-complete.ndjson');
const REFUSED = fixtureLines('assurance-gaps-refused.ndjson');
const PAUSED = fixtureLines('assurance-gaps-paused.ndjson');
const TRUNCATED = fixtureLines('assurance-gaps-truncated.ndjson');
const NO_ROWS = fixtureLines('assurance-gaps-no-rows.ndjson');

/** The recorded payload, decoded independently of the parser. */
const PAYLOAD = JSON.parse(COMPLETE[0] as string) as Record<string, unknown>;
const DESIGN = PAYLOAD['design_completeness'] as Record<string, unknown>;
const PROVEN = PAYLOAD['proven'] as Record<string, unknown>;
const USECASES = PAYLOAD['usecases'] as readonly Record<string, unknown>[];

function streamOf(lines: readonly string[]) {
  return parseStream(contractFor('Assurance'), lines);
}

function axesOf(lines: readonly string[]): CoverageAxes {
  const stream = streamOf(lines);
  return projectGaps(stream.gaps).axes;
}

// ---------------------------------------------------------------------------
// The success path, against the committed bytes
// ---------------------------------------------------------------------------

describe('the committed `cover gaps` stream projects both axes, offline (R9.10)', () => {
  it('parses as a complete Assurance stream carrying a gaps payload', () => {
    const stream = streamOf(COMPLETE);
    expect(stream.kind).toBe('complete');
    if (stream.kind !== 'complete') return;
    expect(stream.terminal.status).toBe('complete');
    expect(stream.terminal.exit_code).toBe(0);
    expect(stream.terminal['verb']).toBe('gaps');
    expect(stream.gaps).not.toBeNull();
    // The singular `coverage` payload is a different event and this stream has none.
    expect(stream.coverage).toBeNull();
    expect(stream.diagnostics).toEqual([]);
  });

  it('reads both percentages and both ratio strings verbatim', () => {
    const axes = axesOf(COMPLETE);
    expect(axes.designCompleteness.pct).toBe(DESIGN['pct']);
    expect(axes.designCompleteness.ratio.text).toBe(DESIGN['acs_designed']);
    expect(axes.proven.pct).toBe(PROVEN['pct']);
    expect(axes.proven.ratio.text).toBe(PROVEN['acs_proven']);
    // Parsed beside the string, never instead of it.
    expect(axes.designCompleteness.ratio).toEqual({ text: '6/6', numerator: 6, denominator: 6 });
    expect(axes.proven.ratio).toEqual({ text: '6/6', numerator: 6, denominator: 6 });
  });

  it('carries what the proven axis is counted over, so the page can say so (R9.15)', () => {
    const axes = axesOf(COMPLETE);
    expect(axes.proven.source).toBe('graph_execution_facts');
    expect(axes.proven.denominatorBasis).toBe('current_live_acs');
    expect(axes.proven.latestRunExecutionId).toBe(
      (PROVEN['latest_run'] as Record<string, unknown>)['execution_id'],
    );
    expect(axes.proven.failing).toBe(0);
    expect(axes.proven.blocked).toBe(0);
    expect(axes.proven.notRun).toBe(0);
  });

  it('shows the use-case debt as debt: 1/9, with eight designs owed', () => {
    const axes = axesOf(COMPLETE);
    // `6/6` acceptance criteria designed reports 100% of the criteria that exist.
    // `1/9` use cases complete is what the graph *owes*, and it is the number that
    // makes the ribbon worth reading. It is carried, not rounded away, and no use
    // case was authored to improve it.
    expect(axes.designCompleteness.usecasesComplete).toEqual({
      text: '1/9',
      numerator: 1,
      denominator: 9,
    });
    expect(axes.designCompleteness.ucsNeedingScenarios).toBe(8);
    expect(axes.rows.filter((row) => row.designCompleteness.status === 'complete')).toHaveLength(1);
    expect(axes.rows.filter((row) => row.pending.length > 0)).toHaveLength(8);
  });

  it('projects one row per use case, with both axes on every one (R9.11)', () => {
    const axes = axesOf(COMPLETE);
    expect(axes.rows).toHaveLength(USECASES.length);
    expect([...axes.rows].map((row) => row.id).sort()).toEqual(
      USECASES.map((entry) => entry['id'] as string).sort(),
    );
    for (const row of axes.rows) {
      const recorded = USECASES.find((entry) => entry['id'] === row.id);
      expect(recorded, `${row.id} is not in the recorded payload`).toBeDefined();
      expect(row.title).toBe(recorded?.['title']);
      expect(row.risk).toBe(recorded?.['risk']);
      // Both axes present as objects on every row, even when both are zero-designed:
      // a use case nobody has designed still owes both figures.
      expect(row.designCompleteness).toHaveProperty('pct');
      expect(row.designCompleteness).toHaveProperty('status');
      expect(row.proven).toHaveProperty('pct');
      expect(row.proven).toHaveProperty('status');
    }
  });

  it('orders the rows by risk band, then by identifier (R9.12)', () => {
    const axes = axesOf(COMPLETE);
    expect(axes.rows.map((row) => row.id)).toEqual([
      'uc-1',
      'uc-2',
      'uc-3',
      'uc-6',
      'uc-7',
      'uc-8',
      'uc-4',
      'uc-5',
      'uc-10',
    ]);
    // Ranks are non-decreasing, and `uc-10` follows `uc-5` rather than preceding it:
    // digit runs compare numerically, because a reader reading "ordered by
    // identifier" is not reading character codes.
    const ranks = axes.rows.map((row) => row.riskRank);
    expect([...ranks].sort((left, right) => left - right)).toEqual(ranks);
    expect(compareCoverageRowIds('uc-5', 'uc-10')).toBeLessThan(0);
    expect(compareCoverageRowIds('uc-3', 'uc-10')).toBeLessThan(0);
  });

  it('publishes every ready command as a string and nothing else', () => {
    const axes = axesOf(COMPLETE);
    const commands = axes.rows.flatMap((row) =>
      row.pending.map((item) => item.readyCommand),
    );
    expect(commands.length).toBe(8);
    for (const command of commands) {
      expect(typeof command).toBe('string');
      expect(command).toMatch(/^kane-cli /u);
    }
    // And the shape of a pending item is six nullable strings. Nothing on it is a
    // function, a handler or anything a renderer could invoke.
    for (const row of axes.rows) {
      for (const item of row.pending) {
        for (const value of Object.values(item)) {
          expect(value === null || typeof value === 'string').toBe(true);
        }
      }
    }
  });

  it('keeps the corpus-gap list out of the ribbon', () => {
    // The recorded payload carries five `other[]` entries, `gap-1` … `gap-5`, each
    // with a `ref`, a `ready_command` and a `question`. They are corpus gaps, not use
    // cases: folding them in would publish five rows with both axes null and make the
    // debt look like something it is not.
    expect((PAYLOAD['other'] as readonly unknown[]).length).toBe(5);
    const ids = axesOf(COMPLETE).rows.map((row) => row.id);
    expect(ids.filter((id) => id.startsWith('gap-'))).toEqual([]);
  });

  it('survives the round trip the snapshot schema puts it through', () => {
    const axes = axesOf(COMPLETE);
    expect(isCoverageAxes(axes)).toBe(true);
    const parsed = SnapshotCoverageAxesSchema.parse(JSON.parse(JSON.stringify(axes)));
    expect(parsed.rows).toHaveLength(9);
    expect(parsed.designCompleteness.usecasesComplete.text).toBe('1/9');
  });
});

// ---------------------------------------------------------------------------
// The degradation paths, with the same weight
// ---------------------------------------------------------------------------

describe('every stream that is not a clean complete withholds the axes (R9.13)', () => {
  it('a refusal is a complete stream with no payload at all', () => {
    const stream = streamOf(REFUSED);
    expect(stream.kind).toBe('complete');
    if (stream.kind !== 'complete') return;
    expect(stream.terminal.status).toBe('refused');
    expect(stream.terminal['verb']).toBe('gaps');
    expect(stream.gaps).toBeNull();
    // Nothing to project, so nothing is projected, and the empty projection is both
    // percentages absent, not both zero.
    expect(projectGaps(stream.gaps).axes).toEqual(NO_COVERAGE_AXES);
    expect(NO_COVERAGE_AXES.designCompleteness.pct).toBeNull();
    expect(NO_COVERAGE_AXES.proven.pct).toBeNull();
    expect(NO_COVERAGE_AXES.rows).toEqual([]);
  });

  it('a pause at exit 3 is complete and resumable, and its payload is not accepted', () => {
    const stream = streamOf(PAUSED);
    expect(stream.kind).toBe('complete');
    if (stream.kind !== 'complete') return;
    expect(stream.terminal.status).toBe('paused');
    expect(stream.terminal.exit_code).toBe(3);
    // The payload is *readable* here, which is exactly why the gate has to be
    // conjunctive: a resumable run's figures are figures nobody stood behind.
    expect(projectGaps(stream.gaps).axes.rows).toHaveLength(9);
  });

  it('a stream truncated before done has an unknown outcome', () => {
    const stream = streamOf(TRUNCATED);
    expect(stream.kind).toBe('crashed');
    if (stream.kind !== 'crashed') return;
    expect(stream.expectedTerminal).toBe('done');
    // Same shape as the pause: a perfectly readable payload on a stream whose
    // outcome nobody knows.
    expect(projectGaps(stream.gaps).axes.rows).toHaveLength(9);
  });

  it('a payload with no use-case rows projects zero rows, not an empty ribbon', () => {
    const stream = streamOf(NO_ROWS);
    expect(stream.kind).toBe('complete');
    if (stream.kind !== 'complete') return;
    expect(stream.terminal.status).toBe('complete');
    const projection = projectGaps(stream.gaps);
    // The trap in full: two green percentages over nothing at all.
    expect(projection.axes.designCompleteness.pct).toBe(100);
    expect(projection.axes.proven.pct).toBe(100);
    expect(projection.axes.rows).toEqual([]);
    // Which is why an axes value with no rows is not a value the snapshot can carry.
    expect(isCoverageAxes(projection.axes)).toBe(false);
    expect(SnapshotCoverageAxesSchema.safeParse(projection.axes).success).toBe(false);
  });

  it('is total over payloads that are not a gaps event at all', () => {
    for (const payload of [null, undefined, 7, 'text', true, [], {}]) {
      const projection = projectGaps(payload);
      expect(projection.axes.rows).toEqual([]);
      expect(projection.axes.designCompleteness.pct).toBeNull();
      expect(projection.axes.proven.pct).toBeNull();
    }
  });
});

describe('the snapshot refuses to publish axes a degraded graph cannot support', () => {
  /** The smallest snapshot the schema accepts, with no promises and no axes. */
  function emptySnapshot(): Record<string, unknown> {
    return {
      schemaVersion: 1,
      generatedAt: '2026-08-24T00:00:00.000Z',
      generator: { kept: '0.1.0', kaneCli: null },
      degraded: false,
      degradedReasons: [],
      freshness: { terminalEventAt: null, terminalEventType: null, commandFamily: null },
      metrics: {
        totalPromises: 0,
        designedCount: 0,
        provenCount: 0,
        redCount: 0,
        staleCount: 0,
        undesignedCount: 0,
        designedCoverage: null,
        provenCoverage: null,
      },
      coverageAxes: null,
      promises: [],
      edges: [],
      documents: [],
      evidence: [],
      runs: [],
      reviewCards: [],
      amendments: [],
      diagnostics: [],
    };
  }

  it('accepts the projected axes on a clean graph', () => {
    const snapshot = emptySnapshot();
    snapshot['coverageAxes'] = JSON.parse(JSON.stringify(axesOf(COMPLETE)));
    expect(LedgerSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('rejects axes on a degraded graph, naming the field (R8.8, R9.13)', () => {
    const snapshot = emptySnapshot();
    snapshot['degraded'] = true;
    snapshot['degradedReasons'] = ['gaps-payload-unreadable'];
    snapshot['coverageAxes'] = JSON.parse(JSON.stringify(axesOf(COMPLETE)));
    const result = LedgerSnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).toContain('coverageAxes');
  });

  it('accepts a degraded graph whose axes are withheld', () => {
    const snapshot = emptySnapshot();
    snapshot['degraded'] = true;
    snapshot['degradedReasons'] = ['gaps-payload-unreadable'];
    snapshot['coverageAxes'] = null;
    expect(LedgerSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('rejects two axis ratios over two denominators (R9.15)', () => {
    const snapshot = emptySnapshot();
    const axes = JSON.parse(JSON.stringify(axesOf(COMPLETE))) as {
      proven: { ratio: { text: string; numerator: number; denominator: number } };
    };
    axes.proven.ratio = { text: '6/8', numerator: 6, denominator: 8 };
    snapshot['coverageAxes'] = axes;
    const result = LedgerSnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).toContain('denominator');
  });
});

// ---------------------------------------------------------------------------
// The readers, at their edges
// ---------------------------------------------------------------------------

describe('a figure this build cannot read is withheld, never coerced to zero', () => {
  it('reads a percentage in range and refuses one outside it', () => {
    expect(readPercent(100)).toBe(100);
    expect(readPercent(0)).toBe(0);
    expect(readPercent('87')).toBe(87);
    expect(readPercent(62.5)).toBe(62.5);
    // Withheld rather than clamped: above 100 the upstream count is wrong, and
    // clamping would publish a wrong count as a right-looking number.
    expect(readPercent(101)).toBeNull();
    expect(readPercent(-1)).toBeNull();
    expect(readPercent(Number.NaN)).toBeNull();
    expect(readPercent(Number.POSITIVE_INFINITY)).toBeNull();
    expect(readPercent(null)).toBeNull();
    expect(readPercent('most of them')).toBeNull();
  });

  it('keeps a ratio string verbatim even when it cannot parse it', () => {
    expect(readCoverageRatio('6/6')).toEqual({ text: '6/6', numerator: 6, denominator: 6 });
    expect(readCoverageRatio('1 / 9')).toEqual({ text: '1 / 9', numerator: 1, denominator: 9 });
    // The string survives; the pair does not, so nothing downstream divides.
    expect(readCoverageRatio('six of six')).toEqual({
      text: 'six of six',
      numerator: null,
      denominator: null,
    });
    expect(readCoverageRatio('0/0')).toEqual({ text: '0/0', numerator: null, denominator: null });
    expect(readCoverageRatio('7/6')).toEqual({ text: '7/6', numerator: null, denominator: null });
    expect(readCoverageRatio(null)).toEqual({ text: null, numerator: null, denominator: null });
  });

  it('sorts an unrecognised risk band last rather than first', () => {
    expect(COVERAGE_RISK_BANDS).toEqual(['high', 'med', 'low']);
    expect(coverageRiskRank('high')).toBe(0);
    expect(coverageRiskRank('low')).toBe(2);
    // An unknown band is still a row a reader is owed, and last is the only
    // placement that does not claim to know how urgent it is.
    expect(coverageRiskRank('catastrophic')).toBe(UNKNOWN_RISK_RANK);
    expect(coverageRiskRank(null)).toBe(UNKNOWN_RISK_RANK);
    expect(UNKNOWN_RISK_RANK).toBeGreaterThan(coverageRiskRank('low'));
  });

  it('claims a shared denominator only when both ratios agree on one', () => {
    expect(coverageAxesDenominator(axesOf(COMPLETE))).toBe(6);
    expect(coverageAxesDenominator(NO_COVERAGE_AXES)).toBeNull();
  });
});
