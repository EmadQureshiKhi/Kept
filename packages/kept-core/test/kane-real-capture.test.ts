/**
 * The promoted real captures (task 6.4, R3.25, R6.7).
 *
 * Six streams and two triage notes in `test/fixtures/` are now bytes `kane-cli`
 * 0.8.4 actually printed rather than shapes a human believed it prints. This file
 * asserts the parser and both router strategies against them, and — more
 * importantly — **pins the four places reality contradicted the hand-authored
 * fixtures**, so that the contradiction is a red test if anyone quietly
 * "corrects" a capture back toward the assumption:
 *
 * 1. `testrun_done` carries `overall_status` and `execution_id`. It carries no
 *    `status` and no `totals` — those live on `testrun_summary`, whose own totals
 *    include an `authored` bucket and no `interrupted` one.
 * 2. `testrun_plan.members[].test_id` is Kane's own **UUID**, not a logical
 *    `T-n` identifier, and a member that cannot parse still plans as
 *    `valid: true`. Neither observed member carries a `failure` field.
 * 3. `testrun_member_end` carries **no inline verdict object and no result
 *    code** — only path, test id, status and duration. So on the one family KEPT
 *    verifies with, `resultCode740` has nothing to route on and delegates, and
 *    both configurations answer identically.
 * 4. The sealed pack's categorised note spells its category
 *    `triage.rca.category`, one level below the `triage.category` alias the
 *    loader originally accepted, so a real note read as no signal at all and
 *    every failure routed to the residue. The alias list now reads that
 *    spelling, and the case below asserts the fixed behaviour: the real note
 *    yields its real signal, and that signal is what makes `code-break` fire.
 *    The note at the pack root is a different file — an index with no category —
 *    and it still, correctly, reads as no signal.
 *
 * Corrections 1 through 3 are asserted as *observed*, not as desired, with the
 * follow-up named in `docs/kane/verdict-spike.md`. Correction 4 was the one with
 * a fix in it, and `docs/kane/loop/README.md` finding four is the measurement
 * that motivated it: without it the deliberately broken `subtotal` answered
 * `docs-lie` while the sealed note said the product was at fault at high
 * confidence, on the first attempt, every time. The
 * hand-authored `testrun-*.ndjson` and `run-failed-740.ndjson` fixtures stay
 * exactly as they were, because replacing them would have required editing the
 * suites that pin them — and a fixture swap is not the place to smuggle in a
 * change to an event contract.
 */

import { readFileSync } from 'node:fs';

import {
  contractFor,
  createFailureContext,
  credits,
  loadFailureYaml,
  parseStream,
  resultCode,
  selectRouter,
  type SealedTriageNote,
} from 'kept-core';
import { describe, expect, it } from 'vitest';

const TESTRUN = contractFor('ExecutionTestrun');
const RUN = contractFor('ExecutionRun');

/** A UUID as Kane spells its own test ids. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fixtureLines(name: string): readonly string[] {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').split('\n');
}

function fixtureText(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

function complete(contract: Parameters<typeof parseStream>[0], name: string) {
  const parsed = parseStream(contract, fixtureLines(name));
  expect(parsed.kind, `${name} did not parse as complete`).toBe('complete');
  if (parsed.kind !== 'complete') throw new Error('unreachable');
  return parsed;
}

describe('the real passing testrun', () => {
  const parsed = complete(TESTRUN, 'testrun-real-passed.ndjson');
  const terminal = parsed.terminal as unknown as Record<string, unknown>;

  it('terminates on testrun_done with overall_status, and with no status or totals', () => {
    expect(terminal['type']).toBe('testrun_done');
    expect(terminal['overall_status']).toBe('passed');
    expect(terminal['execution_id']).toBeTypeOf('string');
    // Correction 1. The hand-authored fixture puts both of these on this event.
    expect(terminal['status']).toBeUndefined();
    expect(terminal['totals']).toBeUndefined();
    expect(parsed.diagnostics).toEqual([]);
  });

  it('carries the totals on the summary, with an authored bucket and no interrupted one', () => {
    const summary = parsed.events.find((event) => event.type === 'testrun_summary') as
      | (Record<string, unknown> & { totals?: Record<string, unknown> })
      | undefined;
    const totals = summary?.totals ?? {};
    expect(Object.keys(totals).sort()).toEqual([
      'authored',
      'broken',
      'failed',
      'passed',
      'skipped',
      'tests',
    ]);
    expect(totals['passed']).toBe(1);
  });

  it('identifies its member by a UUID rather than by a logical test id', () => {
    expect(parsed.plan?.valid).toBe(true);
    const member = parsed.plan?.members?.[0];
    expect(member?.path).toContain('cart_subtotal_spike_test.md');
    expect(String(member?.test_id)).toMatch(UUID);
    // Correction 2: no rejection field on a member that planned cleanly.
    expect(member?.failure).toBeUndefined();
    expect(parsed.members.map((entry) => entry.status)).toEqual(['passed']);
  });
});

describe('the real failing testrun is the family KEPT verifies with, and it carries no verdict', () => {
  const parsed = complete(TESTRUN, 'testrun-real-failed.ndjson');
  const terminal = parsed.terminal as unknown as Record<string, unknown>;

  it('reports the failure on the member and waits on one investigation', () => {
    expect(terminal['overall_status']).toBe('failed');
    expect(parsed.members.map((entry) => entry.status)).toEqual(['failed']);
    const waiting = parsed.events.find(
      (event) => event.type === 'testrun_investigations_wait',
    ) as (Record<string, unknown> | undefined);
    expect(waiting?.['count']).toBe(1);
    expect(parsed.diagnostics).toEqual([]);
  });

  it('gives the router neither an inline verdict object nor a readable code', () => {
    const member = parsed.members[0] as unknown as Record<string, unknown>;
    expect(Object.keys(member).sort()).toEqual([
      'duration_s',
      'path',
      'status',
      'test_id',
      'type',
    ]);
    // Correction 3, and the reason the configured strategy barely matters here.
    expect(member['verdict']).toBeUndefined();
    expect(resultCode(member)).toBeNull();
    expect(resultCode(terminal)).toBeNull();
    expect(credits(member)).toBeNull();
  });

  it('routes identically under both configurations, because rule one cannot fire', () => {
    const member = parsed.members[0] as unknown as Record<string, unknown>;
    const ctx = createFailureContext({
      family: 'ExecutionTestrun',
      terminal: member,
      memberStatus: 'failed',
      promiseId: 'p_cart_subtotal_spike',
    });
    expect(ctx.verdictObject).toBeNull();

    const primary = selectRouter({ verdictRouter: 'resultCode740' }).route(ctx);
    const fallback = selectRouter({ verdictRouter: 'failureYamlTriage' }).route(ctx);
    // resultCode740 delegates and returns the delegate's answer verbatim, so the
    // two configurations agree on every field including the strategy name.
    expect(primary).toEqual(fallback);
    expect(primary.strategy).toBe('failureYamlTriage');
    expect(primary.branch).toBe('docs-lie');
  });
});

describe('the real testrun truncated mid-suite is crashed, not failed', () => {
  const parsed = parseStream(TESTRUN, fixtureLines('testrun-real-crashed.ndjson'));

  it('classifies the outcome as unknown and says which terminal never arrived', () => {
    expect(parsed.kind).toBe('crashed');
    if (parsed.kind !== 'crashed') return;
    expect(parsed.expectedTerminal).toBe('testrun_done');
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics[0]?.message).toContain('outcome unknown');
    // The member did end, and the investigation was still running when the
    // stream stopped — which is exactly why the outcome is not readable.
    expect(parsed.events).toHaveLength(5);
  });
});

describe('the real testmd captures, read as ExecutionRun', () => {
  it('authored six steps, each closing with its own run_end and its own charge', () => {
    const parsed = complete(RUN, 'run-testmd-authored.ndjson');
    const runEnds = parsed.events.filter((event) => event.type === 'run_end');
    expect(runEnds).toHaveLength(6);
    expect(parsed.diagnostics).toEqual([]);
    for (const event of runEnds) {
      expect(resultCode(event)).toBe(100);
      expect(credits(event)).not.toBeNull();
    }
  });

  it('replayed free, reporting no charge anywhere in the stream', () => {
    const parsed = complete(RUN, 'run-testmd-replay-passed.ndjson');
    for (const event of parsed.events) expect(credits(event)).toBeNull();
  });

  it('reports a failing replay with a verdict object and no code, and charges on the object', () => {
    const parsed = complete(RUN, 'run-testmd-replay-failed.ndjson');
    const terminal = parsed.terminal as unknown as Record<string, unknown>;
    expect(terminal['status']).toBe('failed');
    expect(resultCode(terminal)).toBeNull();
    expect(credits(terminal)).toBeNull();
    expect(credits(terminal['verdict'])).toBeCloseTo(4.84245, 5);
  });
});

describe('the real sealed triage notes', () => {
  it('spells its category at triage.rca.category, and the loader reads it there', () => {
    const note = loadFailureYaml({ content: fixtureText('failure-real-triaged.yaml') });
    expect(note).not.toBeNull();
    if (note === null) return;
    // Correction 4, fixed. Kane writes the categorised judgement one level below
    // `triage`, and the alias list now reads that spelling, so a real sealed note
    // yields a real signal instead of nothing.
    expect(note.signal).toBe('application_issue/ui_data_defect');
    expect(note.signalField).toBe('triage.rca.category');
    const rca = (note.fields['triage'] as Record<string, unknown>)['rca'] as Record<
      string,
      unknown
    >;
    expect(rca['category']).toBe('application_issue/ui_data_defect');
    expect(rca['confidence']).toBe(0.97);
    // Severity sits directly under `triage` and confidence under `triage.rca`, so
    // reading only the shallower placement published a category with no
    // confidence beside it. Both are reached now.
    expect(note.severity).toBe('major');
    expect(note.confidence).toBe(0.97);
    expect(note.resultCode).toBeNull();
  });

  it('routes code-break off that note, delivered the way the pack delivers it', () => {
    // The whole ladder, over real bytes. `testrun_member_end` carries no verdict
    // object and no readable code (correction 3), so rule one cannot fire and
    // rule three has nothing to read; the note is what decides, and it arrives as
    // *text* read out of the sealed `.evidence` archive and tied to this member by
    // the test id the pack's own `result.yaml` declares — never by matching the
    // pack's slug to a document title (§7.1, §4.6).
    const sealed: SealedTriageNote = {
      archivePath: '/tmp/0944d075-8dab-4683-a59f-96e51308697c.evidence',
      entryName: 'tests/cart-subtotal-d5ba3490/steps/17-5-3/failure.yaml',
      content: fixtureText('failure-real-triaged.yaml'),
      testId: '1c4fff07-a0da-495b-8471-26d45b4a1441',
    };
    const ctx = createFailureContext({
      family: 'ExecutionTestrun',
      terminal: {
        type: 'testrun_member_end',
        path: 'tests/cart_subtotal_test.md',
        status: 'failed',
        test_id: sealed.testId,
      },
      memberStatus: 'failed',
      promiseId: 'p_8d965c2fae07',
      sealedTriage: sealed,
    });
    expect(ctx.verdictObject).toBeNull();

    const routed = selectRouter({ verdictRouter: 'resultCode740' }).route(ctx);
    expect(routed.strategy).toBe('failureYamlTriage');
    expect(routed.branch).toBe('code-break');
    expect(routed.category).toBe('application_issue/ui_data_defect');
    expect(routed.confidence).toBe(0.97);
    expect(routed.severity).toBe('major');
    // The artefact named is the archive Kane sealed, which is a real file, not a
    // pack directory someone extracted beside it.
    expect(routed.evidenceRef).toContain('.evidence');
  });

  it('reads the pack-root note as an index with no signal at all', () => {
    const note = loadFailureYaml({ content: fixtureText('failure-real-index.yaml') });
    expect(note).not.toBeNull();
    if (note === null) return;
    expect(note.signal).toBeNull();
    expect(note.isMapping).toBe(true);
    const failures = note.fields['failures'] as readonly Record<string, unknown>[];
    expect(failures).toHaveLength(1);
    // The stream called this member `failed`; the sealed pack calls it `broken`.
    // Both map to a red verdict, but they are not the same word.
    expect(failures[0]?.['status']).toBe('broken');
    expect(failures[0]?.['triage_status']).toBe('triaged');
  });
});
