import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  MEMBER_DEBUG_DIAGNOSTIC_CODES,
  MEMBER_DEBUG_PREFIX,
  MEMBER_TERMINAL_TYPE,
  createDiagnosticSink,
  pairMemberDebug,
  parseMemberDebug,
  resultCode,
} from '../src/index.js';

/**
 * The `[member]` stream — task 15.6 (design §4.1, §6.2, §7.4, R4.12, R6.4, R6.5).
 *
 * The fixture is not a fixture: it is the verbatim stderr of the committed
 * zero-credit replay of the whole suite, nine members, captured with
 * `KANE_TESTRUN_MEMBER_DEBUG=1`. The assertion that matters is the one that was
 * silently false for the whole project until the loop was driven live — that the
 * classification signal exists **here** and nowhere else.
 */
const STDERR = readFileSync(
  new URL('../../../docs/kane/replay/verify-all-replay.stderr.txt', import.meta.url),
  'utf8',
)
  .split('\n')
  .filter((line) => line.length > 0);

describe('parseMemberDebug reads the member terminals off a real stderr stream', () => {
  it('segments the stream one slice per member, not one per step group', () => {
    const capture = parseMemberDebug(STDERR, createDiagnosticSink());

    // Nine members, nine segments — and **forty** step groups between them, which
    // is the whole reason a segment exists. Kane replays a `*_test.md` as a series
    // of runs (`run-0`, `run-1`, …) and restarts the numbering per member, so
    // pairing `run_end` one-to-one with `testrun_member_end` attributes nothing.
    expect(capture.segments).toHaveLength(9);
    expect(
      capture.segments.reduce((count, segment) => count + segment.stepGroups, 0),
    ).toBe(40);
    expect(capture.unparsed).toBe(0);
    // Every member ended with its own terminal.
    for (const segment of capture.segments) {
      expect(segment.done?.['type']).toBe(MEMBER_TERMINAL_TYPE);
    }
    // One member failed, and the segment picked the step group that failed.
    const failedMembers = capture.segments.filter(
      (segment) => segment.done?.['overall_status'] === 'failed',
    );
    expect(failedMembers).toHaveLength(1);
  });

  it('picks the step group that failed, which is the one carrying the signal', () => {
    const capture = parseMemberDebug(STDERR, createDiagnosticSink());
    const failing = capture.terminals.filter(
      (terminal) => terminal !== null && terminal['status'] === 'failed',
    );
    expect(failing, 'the suite has exactly one designed failure').toHaveLength(1);
    const terminal = failing[0] as Record<string, unknown>;

    // The three fields `testrun_member_end` does not have. This is the whole point.
    expect(resultCode(terminal)).toBe(740);
    expect(terminal['reason_code']).toBe('assertion_error.confirmed_product_bug');
    const verdict = terminal['verdict'] as Record<string, unknown>;
    expect(verdict['confirmed']).toBe(true);
    expect(verdict['family']).toBe('application_issue');
    expect(typeof verdict['confidence']).toBe('number');
    // And the credits the judgement cost, which the suite terminal never reports.
    expect(typeof terminal['credits_consumed']).toBe('number');
  });

  it('ignores every line that is not a member event, silently', () => {
    const capture = parseMemberDebug(
      [
        'evidence: view locally with kane-cli evidence serve /tmp/x.evidence',
        'Update available: 0.8.4 → 0.8.5',
        `${MEMBER_DEBUG_PREFIX}{"type":"bifurcation"}`,
        `${MEMBER_DEBUG_PREFIX}{"type":"run_end","status":"passed","result_code":100}`,
        `${MEMBER_DEBUG_PREFIX}{"type":"test_md_done","overall_status":"passed"}`,
      ],
      createDiagnosticSink(),
    );
    expect(capture.lines).toBe(3);
    expect(capture.segments).toHaveLength(1);
    expect(capture.terminals[0]?.['result_code']).toBe(100);
    expect(capture.unparsed).toBe(0);
  });

  it('reports a prefixed line that is not JSON, and keeps the others', () => {
    const sink = createDiagnosticSink();
    const capture = parseMemberDebug(
      [
        `${MEMBER_DEBUG_PREFIX}{"type":"run_end","status":"failed",`,
        `${MEMBER_DEBUG_PREFIX}{"type":"run_end","status":"passed"}`,
        `${MEMBER_DEBUG_PREFIX}{"type":"test_md_done","overall_status":"passed"}`,
      ],
      sink,
    );
    expect(capture.unparsed).toBe(1);
    expect(capture.segments).toHaveLength(1);
    expect(sink.has(MEMBER_DEBUG_DIAGNOSTIC_CODES.unparsed)).toBe(true);
  });
});

describe('pairMemberDebug ties a terminal to a member by order, or to nothing at all', () => {
  /** One member per status: a step group with that outcome, then `test_md_done`. */
  const terminals = (...statuses: readonly string[]): readonly string[] =>
    statuses.flatMap((status) => [
      `${MEMBER_DEBUG_PREFIX}${JSON.stringify({
        type: 'run_end',
        status,
        result_code: status === 'failed' ? 740 : 100,
      })}`,
      `${MEMBER_DEBUG_PREFIX}${JSON.stringify({
        type: 'test_md_done',
        overall_status: status,
      })}`,
    ]);

  it('pairs positionally when the two sequences agree', () => {
    const sink = createDiagnosticSink();
    const pairing = pairMemberDebug(
      [
        { status: 'passed', path: 'tests/a_test.md' },
        { status: 'failed', path: 'tests/b_test.md' },
      ],
      parseMemberDebug(terminals('passed', 'failed')),
      sink,
    );
    expect(pairing.paired).toBe(true);
    expect(pairing.terminals[0]?.['status']).toBe('passed');
    expect(pairing.terminals[1]?.['status']).toBe('failed');
    expect(sink.has(MEMBER_DEBUG_DIAGNOSTIC_CODES.captured)).toBe(true);
  });

  it('attributes nothing when the lengths disagree', () => {
    const sink = createDiagnosticSink();
    const pairing = pairMemberDebug(
      [
        { status: 'passed', path: 'tests/a_test.md' },
        { status: 'failed', path: 'tests/b_test.md' },
      ],
      parseMemberDebug(terminals('failed')),
      sink,
    );
    expect(pairing.paired).toBe(false);
    expect(pairing.terminals).toEqual([null, null]);
    expect(sink.has(MEMBER_DEBUG_DIAGNOSTIC_CODES.unpaired)).toBe(true);
  });

  it('attributes nothing when a paired status contradicts the member event', () => {
    // The dangerous case: two failures and two terminals, in the wrong order. A
    // verdict object on the wrong member would authorise an automatic source patch
    // against a promise nobody tested.
    const sink = createDiagnosticSink();
    const pairing = pairMemberDebug(
      [
        { status: 'failed', path: 'tests/a_test.md' },
        { status: 'passed', path: 'tests/b_test.md' },
      ],
      parseMemberDebug(terminals('passed', 'failed')),
      sink,
    );
    expect(pairing.paired).toBe(false);
    expect(pairing.terminals).toEqual([null, null]);
    const message = sink.entries
      .filter((entry) => entry.code === MEMBER_DEBUG_DIAGNOSTIC_CODES.unpaired)
      .map((entry) => entry.message)
      .join('');
    expect(message).toContain('tests/a_test.md');
  });

  it('attributes nothing, and says nothing, when the capture is empty', () => {
    // The `--member-debug` flag was not given. That is a supported way to run, so
    // it is not a warning: the router falls back to the member event and the
    // triage rung, conservatively.
    const sink = createDiagnosticSink();
    const pairing = pairMemberDebug(
      [{ status: 'failed', path: 'tests/a_test.md' }],
      parseMemberDebug([], sink),
      sink,
    );
    expect(pairing.paired).toBe(false);
    expect(pairing.terminals).toEqual([null]);
    expect(sink.entries).toEqual([]);
  });

  it('tolerates a broken member, whose own terminal never arrived', () => {
    // `broken` and `interrupted` are the suite's readings of a member that produced
    // no terminal of its own, so a disagreement there is expected rather than
    // suspicious — only two *reported* statuses contradicting each other refuse.
    const pairing = pairMemberDebug(
      [
        { status: 'broken', path: 'tests/a_test.md' },
        { status: 'failed', path: 'tests/b_test.md' },
      ],
      parseMemberDebug(terminals('failed', 'failed')),
      createDiagnosticSink(),
    );
    expect(pairing.paired).toBe(true);
  });
});
