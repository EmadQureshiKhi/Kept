/**
 * The verdict spike's committed regression (task 6.3, R6.12, R6.13).
 *
 * Every other verdict test in this package feeds the router a context a human
 * composed. This one does not. It reads the three streams `kane-cli` 0.8.4
 * actually printed — authoring T-3's probe, replaying it against a deliberately
 * broken `subtotal`, and replaying it again once the break was reverted — and
 * asserts the branch the **selected** strategy routes them to.
 *
 * That makes it the file that fails if any of four things drift: the captured
 * bytes, the parser's reading of them, either strategy's ladder, or the
 * `verdictRouter` string in `.kept/config.json`. The narrative and the reasoning
 * live in `docs/kane/verdict-spike.md`; what lives here is the machine-checkable
 * part of it.
 *
 * Three observations are pinned deliberately, because each one contradicts a
 * document and would otherwise be re-assumed by the next reader:
 *
 * 1. **A failing cached replay carries no readable result code at all.** Not the
 *    confirmed-bug code, not a code in the assertion-class band, nothing. So
 *    rules three through five of design §6.2 are unreachable on this path, and a
 *    test that only proved "the code is not seven-forty" would be too weak — the
 *    field is absent, which is a stronger and more surprising fact.
 * 2. **It does carry an inline `verdict` object, and `confirmed` reads false**
 *    while `family` reads `application_issue` and `confidence` reads 0.97. The
 *    object's own `downgrade_reason` says the flag was downgraded because its
 *    citations were not mechanically verifiable — so `confirmed` is a
 *    verification flag, not the product-versus-test attribution. Rule 1 of §6.2
 *    keys on it anyway and therefore routes `test-drift` for what is really a
 *    code break. That is asserted here as **observed behaviour, not as desired
 *    behaviour**, with the follow-up recorded in the spike document. Changing it
 *    is a change inside `src/verdict/`, which the spike was fenced out of.
 * 3. **Replay is free; a failing replay's investigation is not.** The passing
 *    replay reports no credits anywhere. The failing one reports its charge on
 *    the verdict object rather than on any event, which is the only place
 *    `credits()` can find it.
 *
 * The probe these streams came from lives outside `tests/` and carries no
 * `@verifies` tag, so it mints no promise and is not one of the eight claims.
 * `docs/kane/verdict-spike.md` records why the corpus file itself could not be
 * handed to Kane.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  contractFor,
  createFailureContext,
  credits,
  parseStream,
  resultCode,
  selectRouter,
  VERDICT_ROUTER_NAMES,
  type RepairStrategy,
} from 'kept-core';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SPIKE_DIR = 'docs/kane/spike';

/** `testmd run` is Execution_Run: NDJSON via `--agent`, terminal type `run_end`. */
const RUN = contractFor('ExecutionRun');

/** Raw lines, exactly as the capture carries them — trailing newline included. */
function capture(name: string): readonly string[] {
  return readFileSync(`${REPO_ROOT}/${SPIKE_DIR}/${name}`, 'utf8').split('\n');
}

function parsedCapture(name: string) {
  const parsed = parseStream(RUN, capture(name));
  expect(parsed.kind, `${name} did not parse as a complete stream`).toBe('complete');
  if (parsed.kind !== 'complete') throw new Error('unreachable');
  return parsed;
}

/** The failing replay, and the context the routers actually saw. */
function failingContext() {
  const parsed = parsedCapture('t3-replay-failed.ndjson');
  const terminal = parsed.terminal as unknown as Record<string, unknown>;
  // No evidence listing is supplied, and that is the honest reality rather than a
  // simplification: `testmd run` seals its pack as a single `.evidence` zip file,
  // so `listArtifacts` — which lists a pack directory — resolves nothing here.
  const ctx = createFailureContext({
    family: 'ExecutionRun',
    terminal,
    promiseId: 'p_cart_subtotal_spike',
    repoRoot: REPO_ROOT,
  });
  return { parsed, terminal, ctx };
}

/** The one string the spike was allowed to change, read from the committed file. */
function committedRouterName(): string {
  const config = JSON.parse(readFileSync(`${REPO_ROOT}/.kept/config.json`, 'utf8')) as {
    verdictRouter?: unknown;
  };
  return String(config.verdictRouter);
}

describe('the authoring capture is a complete stream that cost real credits', () => {
  const parsed = parsedCapture('t3-author.ndjson');

  it('parses every line with no diagnostics at all', () => {
    expect(parsed.diagnostics).toEqual([]);
  });

  it('emits one run_end per step and terminates on the last of them', () => {
    const runEnds = parsed.events.filter((event) => event.type === 'run_end');
    expect(runEnds.length).toBe(6);
    expect(parsed.terminal).toBe(runEnds[runEnds.length - 1]);
    expect((parsed.terminal as unknown as Record<string, unknown>)['status']).toBe('passed');
  });

  it('charges per step, and every step reports the success code', () => {
    const runEnds = parsed.events.filter((event) => event.type === 'run_end');
    const perStep = runEnds.map((event) => credits(event));
    for (const charge of perStep) expect(charge).not.toBeNull();
    const total = perStep.reduce<number>((sum, charge) => sum + (charge ?? 0), 0);
    expect(total).toBeCloseTo(49.205855, 6);
    for (const event of runEnds) expect(resultCode(event)).toBe(100);
  });

  it('retains testmd’s own terminal event as an unknown type rather than dropping it', () => {
    const names = parsed.unknown.map((event) => event.type);
    expect(names).toContain('test_md_done');
    expect(names).toContain('test_md_summary');
  });
});

describe('the failing cached replay carries a verdict object and no readable code', () => {
  const { parsed, terminal, ctx } = failingContext();

  it('parses cleanly and terminates on the failing step', () => {
    expect(parsed.diagnostics).toEqual([]);
    expect(terminal['status']).toBe('failed');
    expect(terminal['reason']).toBe('assertion_failed: @ step 3');
  });

  it('reports no result code whatsoever on the failing step', () => {
    // The absence is the finding. Rules three through five of design §6.2 read
    // this through the coercing accessor and get nothing, so the numeric rungs
    // cannot fire on a failing replay of a testmd test.
    expect(resultCode(terminal)).toBeNull();
    expect(Object.keys(terminal)).not.toContain('result_code');
    // The five steps that replayed green did report it, so this is a shape
    // difference between a passing and a failing step, not a missing feature.
    const passing = parsed.events
      .filter((event) => event.type === 'run_end' && event !== parsed.terminal)
      .map((event) => resultCode(event));
    expect(passing).toEqual([100, 100, 100, 100, 100]);
  });

  it('carries the inline verdict object, downgraded to unconfirmed', () => {
    const verdict = ctx.verdictObject;
    expect(verdict).not.toBeNull();
    if (verdict === null) return;
    expect(verdict.confirmed).toBe(false);
    expect(verdict.confirmedKnown).toBe(true);
    // Every field except `confirmed` names the product as the culprit.
    expect(verdict.family).toBe('application_issue');
    expect(verdict.category).toBe('ui_data_defect');
    expect(verdict.severity).toBe('major');
    expect(verdict.confidence).toBe(0.97);
    expect(verdict.one_liner).toContain('$18.00');

    const raw = terminal['verdict'] as Record<string, unknown>;
    expect(String(raw['downgrade_reason'])).toContain('not mechanically verifiable');
    expect(String(raw['agent_fault_assessment'])).toContain('did not cause this outcome');
  });

  it('reports the investigation charge on the verdict object, not on the event', () => {
    expect(credits(terminal)).toBeNull();
    expect(credits(terminal['verdict'])).toBeCloseTo(4.84245, 5);
  });
});

describe('the routed branch, from the committed capture through the selected strategy', () => {
  const { ctx } = failingContext();

  it('routes test-drift under resultCode740, on rule one, carrying Kane’s grading', () => {
    const routed = selectRouter({ verdictRouter: 'resultCode740' }).route(ctx);
    expect(routed.strategy).toBe('resultCode740');
    // Observed, not desired: the object outranks the code, and `confirmed` is
    // false, so rule one fires. See follow-up 1 in docs/kane/verdict-spike.md.
    expect(routed.branch).toBe('test-drift');
    expect(routed.rationale).toContain('confirmed as false');
    // The grading survives into the annotation a reviewer reads, which is the
    // whole reason this strategy is the better default here.
    expect(routed.severity).toBe('major');
    expect(routed.category).toBe('ui_data_defect');
    expect(routed.confidence).toBe(0.97);
    expect(routed.rationale).toContain('$18.00');
  });

  it('routes docs-lie under failureYamlTriage, carrying nothing, because no note is reachable', () => {
    const routed = selectRouter({ verdictRouter: 'failureYamlTriage' }).route(ctx);
    expect(routed.strategy).toBe('failureYamlTriage');
    expect(routed.branch).toBe('docs-lie');
    expect(routed.severity).toBeNull();
    expect(routed.category).toBeNull();
    expect(routed.confidence).toBeNull();
    expect(routed.evidenceRef).toBeNull();
  });

  it('is the strategy .kept/config.json actually selects', () => {
    const configured = committedRouterName();
    expect(VERDICT_ROUTER_NAMES).toContain(configured as RepairStrategy);
    // The spike's whole output is this one string. If it is ever flipped, the
    // branch asserted above changes with it and this file must be re-read.
    expect(configured).toBe('resultCode740');
    expect(selectRouter({ verdictRouter: configured }).name).toBe('resultCode740');
  });
});

describe('the passing cached replay is free, which is what makes the recording worth committing', () => {
  const parsed = parsedCapture('t3-replay-passed.ndjson');

  it('replays every step green with no diagnostics', () => {
    expect(parsed.diagnostics).toEqual([]);
    const runEnds = parsed.events.filter((event) => event.type === 'run_end');
    expect(runEnds.length).toBe(6);
    for (const event of runEnds) {
      expect((event as unknown as Record<string, unknown>)['status']).toBe('passed');
      expect(resultCode(event)).toBe(100);
    }
  });

  it('reports no credits on any event, on the terminal, or anywhere in the stream', () => {
    for (const event of parsed.events) expect(credits(event)).toBeNull();
    expect(credits(parsed.terminal)).toBeNull();
  });

  it('says in its own summary that every step came from cache', () => {
    const summary = parsed.unknown.find((event) => event.type === 'test_md_summary') as
      | (Record<string, unknown> & { steps?: Record<string, unknown> })
      | undefined;
    expect(summary?.steps?.['replay_decisions']).toBe(6);
    expect(summary?.steps?.['author_decisions']).toBe(0);
  });
});
