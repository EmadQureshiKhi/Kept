import { describe, expect, it } from 'vitest';

import {
  MEMBER_END_STATUSES,
  MEMBER_STATUSES,
  MEMBER_STATUS_DIAGNOSTIC_CODES,
  ROUTER_MEMBER_STATUSES,
  VERDICTS,
  createDiagnosticSink,
  entersVerdictRouter,
  isMemberStatus,
  memberStatusToVerdict,
  reportMemberStatus,
} from 'kept-core';

/**
 * Member status → verdict (task 11.1, design §6.5, R3.20, R4.8, R4.9).
 *
 * The mapping itself is five lines, so what is worth asserting is not the five
 * lines but the three claims that hang off them: that it is total over strings
 * arriving from another process, that the distinction it deliberately throws away
 * survives in the diagnostics, and that only two of the four statuses are allowed
 * anywhere near the verdict router.
 */

describe('the status vocabulary is the parser\'s own', () => {
  it('is the same four values, not a second spelling of them', () => {
    expect(MEMBER_STATUSES).toEqual(MEMBER_END_STATUSES);
    expect(MEMBER_STATUSES).toHaveLength(4);
  });

  it('recognises exactly those four', () => {
    for (const status of MEMBER_STATUSES) expect(isMemberStatus(status)).toBe(true);
    for (const other of ['skipped', 'PASSED', 'passed ', '', 'errored']) {
      expect(isMemberStatus(other)).toBe(false);
    }
    expect(isMemberStatus(null)).toBe(false);
    expect(isMemberStatus(1)).toBe(false);
  });
});

describe('memberStatusToVerdict', () => {
  it('maps the four observed statuses exactly as design §6.5 states', () => {
    expect(memberStatusToVerdict('passed')).toEqual({ verdict: 'proven', known: true });
    expect(memberStatusToVerdict('failed')).toEqual({ verdict: 'red', known: true });
    expect(memberStatusToVerdict('broken')).toEqual({ verdict: 'red', known: true });
    expect(memberStatusToVerdict('interrupted')).toEqual({ verdict: 'stale', known: true });
  });

  it('answers stale-and-unknown for a status from some later release', () => {
    for (const status of ['skipped', 'errored', 'timed_out', 'PASSED', 'passed ', '']) {
      expect(memberStatusToVerdict(status)).toEqual({ verdict: 'stale', known: false });
    }
  });

  it('never answers proven or red for a status it does not recognise', () => {
    // The failure mode this closes: a fifth status read as a pass would publish
    // proof the run never produced.
    for (const status of ['pass', 'ok', 'success', 'PASS', 'fail']) {
      const mapped = memberStatusToVerdict(status);
      expect(mapped.known).toBe(false);
      expect(mapped.verdict).toBe('stale');
    }
  });

  it('only ever answers one of the four ledger verdicts', () => {
    for (const status of [...MEMBER_STATUSES, 'nonsense', '', '  ']) {
      expect(VERDICTS).toContain(memberStatusToVerdict(status).verdict);
    }
  });
});

describe('only failed and broken enter the router', () => {
  it('admits exactly those two', () => {
    expect(ROUTER_MEMBER_STATUSES).toEqual(['failed', 'broken']);
    expect(entersVerdictRouter('failed')).toBe(true);
    expect(entersVerdictRouter('broken')).toBe(true);
  });

  it('refuses passed, interrupted, and anything unrecognised', () => {
    // `interrupted` proved nothing, so there is no failure to triage and no
    // branch to choose; routing it would invent a repair out of an absence.
    for (const status of ['passed', 'interrupted', 'skipped', '']) {
      expect(entersVerdictRouter(status)).toBe(false);
    }
  });
});

describe('reportMemberStatus records the distinction the verdict throws away (R4.9)', () => {
  it('records nothing for a passing member', () => {
    const sink = createDiagnosticSink();
    expect(reportMemberStatus({ status: 'passed', testId: 'T-3' }, sink)).toEqual({
      verdict: 'proven',
      known: true,
    });
    expect(sink.size).toBe(0);
  });

  it('quotes broken and interrupted verbatim, so red stays decomposable', () => {
    for (const status of ['failed', 'broken', 'interrupted'] as const) {
      const sink = createDiagnosticSink();
      reportMemberStatus({ status, testId: 'T-3', path: 'tests/cart_subtotal_test.md' }, sink);
      expect(sink.has(MEMBER_STATUS_DIAGNOSTIC_CODES.recorded)).toBe(true);
      const entry = sink.withCode(MEMBER_STATUS_DIAGNOSTIC_CODES.recorded)[0];
      expect(entry?.message).toContain(`"${status}"`);
      expect(entry?.message).toContain('T-3');
      expect(entry?.file).toBe('tests/cart_subtotal_test.md');
    }
  });

  it('marks a broken member as a warning and an asserted failure as information', () => {
    const broken = createDiagnosticSink();
    reportMemberStatus({ status: 'broken' }, broken);
    expect(broken.hasSeverity('warn')).toBe(true);

    const failed = createDiagnosticSink();
    reportMemberStatus({ status: 'failed' }, failed);
    expect(failed.hasSeverity('warn')).toBe(false);
    expect(failed.hasSeverity('info')).toBe(true);
  });

  it('diagnoses an unrecognised status under its own code, verbatim', () => {
    const sink = createDiagnosticSink();
    const mapping = reportMemberStatus({ status: 'timed_out' }, sink);
    expect(mapping).toEqual({ verdict: 'stale', known: false });
    const entry = sink.withCode(MEMBER_STATUS_DIAGNOSTIC_CODES.unknown)[0];
    expect(entry?.message).toContain('"timed_out"');
    expect(entry?.severity).toBe('warn');
  });

  it('says so plainly when the plan identified the member by neither id nor path', () => {
    const sink = createDiagnosticSink();
    reportMemberStatus({ status: 'broken', testId: '  ', path: null }, sink);
    expect(sink.entries[0]?.message).toContain('a member the plan did not identify');
    expect(sink.entries[0]?.file).toBeNull();
  });

  it('maps and records in one call, with no sink required', () => {
    expect(reportMemberStatus({ status: 'broken' })).toEqual({ verdict: 'red', known: true });
  });
});
