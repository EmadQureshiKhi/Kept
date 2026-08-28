import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  MEMBER_STATUSES,
  ROUTER_MEMBER_STATUSES,
  VERDICTS,
  createDiagnosticSink,
  entersVerdictRouter,
  memberStatusToVerdict,
  reportMemberStatus,
} from 'kept-core';

import { arbMemberStatus } from './arbitraries.js';

/**
 * Feature: kept, Property 15: Member status maps totally onto four verdicts
 * (design §Correctness Properties, §6.5, R3.20, R4.8, R4.9).
 *
 * *For any* member status string, the mapping is total and never throws; `passed`
 * maps to `proven`, `failed` and `broken` both map to `red`, `interrupted` maps to
 * `stale`, and any unrecognised value maps to `stale` while being flagged as
 * unknown; and every non-passed status appears verbatim in the run diagnostics so
 * that a broken or interrupted member remains distinguishable from an asserted
 * failure.
 *
 * The property is worth stating over generated strings rather than over the four
 * known ones for a specific reason. The mapping's input crosses a process
 * boundary: it is a JSON string produced by a Kane release we may not have seen.
 * A `switch` with four arms and no default type-checks perfectly and returns
 * `undefined` at runtime for a fifth value, and `undefined` reaching the ledger
 * as a verdict is the exact failure this property exists to make impossible. So
 * the generator deliberately produces values *outside* the four — the seventh of
 * the design's twelve named edge cases — including empty strings, wrong casing and
 * a trailing space, and the property is that every one of them lands somewhere
 * honest.
 *
 * The diagnostics clause is the other half, and it is a lossless-ness claim about
 * a deliberately lossy mapping. `failed` and `broken` both become `red`, so once
 * the verdict is written the diagnostic is the only surviving record of which one
 * happened. "Verbatim" is asserted literally: the status string as it arrived,
 * unnormalised, must occur in the message text.
 *
 * **Validates: Requirements 3.20, 4.8, 4.9**
 */

/** Design's testing-strategy floor is 100; stated explicitly so it cannot drift. */
const NUM_RUNS = 500;

/** The mapping design §6.5 states, as data rather than as control flow. */
const EXPECTED: Readonly<Record<string, string>> = Object.freeze({
  passed: 'proven',
  failed: 'red',
  broken: 'red',
  interrupted: 'stale',
});

describe('Property 15: Member status maps totally onto four verdicts', () => {
  it('is total: every string maps to one of the four ledger verdicts, and never throws', () => {
    fc.assert(
      fc.property(arbMemberStatus, (status) => {
        const mapped = memberStatusToVerdict(status);
        expect(VERDICTS).toContain(mapped.verdict);
        expect(typeof mapped.known).toBe('boolean');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is total over arbitrary strings too, not merely over plausible ones', () => {
    fc.assert(
      fc.property(fc.string(), (status) => {
        const mapped = memberStatusToVerdict(status);
        expect(VERDICTS).toContain(mapped.verdict);
        expect(mapped.known).toBe((MEMBER_STATUSES as readonly string[]).includes(status));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('maps the four observed statuses exactly as design §6.5 states', () => {
    fc.assert(
      fc.property(arbMemberStatus, (status) => {
        const expected = EXPECTED[status];
        fc.pre(expected !== undefined);
        expect(memberStatusToVerdict(status)).toEqual({ verdict: expected, known: true });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('sends an unrecognised status to stale, flagged unknown, and never to proven or red', () => {
    fc.assert(
      fc.property(arbMemberStatus, (status) => {
        fc.pre(!(MEMBER_STATUSES as readonly string[]).includes(status));
        expect(memberStatusToVerdict(status)).toEqual({ verdict: 'stale', known: false });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is deterministic — the same status always maps the same way', () => {
    fc.assert(
      fc.property(arbMemberStatus, (status) => {
        expect(memberStatusToVerdict(status)).toEqual(memberStatusToVerdict(status));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('records every non-passed status verbatim in the diagnostics (R4.9)', () => {
    fc.assert(
      fc.property(
        arbMemberStatus,
        fc.option(fc.constantFrom('T-1', 'T-3', 'T-7'), { nil: null }),
        fc.option(fc.constantFrom('tests/cart_subtotal_test.md', 'tests/shop_filter_test.md'), {
          nil: null,
        }),
        (status, testId, path) => {
          const sink = createDiagnosticSink();
          const mapped = reportMemberStatus({ status, testId, path }, sink);

          if (status === 'passed') {
            expect(sink.size).toBe(0);
            return;
          }

          expect(sink.size).toBe(1);
          const entry = sink.entries[0];
          // Verbatim: the string as it arrived, not a normalised form of it.
          expect(entry?.message).toContain(`"${status}"`);
          expect(entry?.message).toContain(mapped.verdict);
          if (path !== null) expect(entry?.file).toBe(path);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('keeps a broken member distinguishable from an asserted failure after the fact', () => {
    // Both are `red`, so this is the whole content of R4.9: from the diagnostics
    // alone, the two must remain tellable apart.
    fc.assert(
      fc.property(fc.constantFrom('failed', 'broken'), (status) => {
        const sink = createDiagnosticSink();
        expect(reportMemberStatus({ status }, sink).verdict).toBe('red');
        const message = sink.entries[0]?.message ?? '';
        expect(message).toContain(`"${status}"`);
        expect(message).not.toContain(status === 'failed' ? '"broken"' : '"failed"');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('admits only failed and broken to the router', () => {
    fc.assert(
      fc.property(arbMemberStatus, (status) => {
        expect(entersVerdictRouter(status)).toBe(
          (ROUTER_MEMBER_STATUSES as readonly string[]).includes(status),
        );
        // An interrupted member proved nothing, so it can never reach the router.
        if (status === 'interrupted' || status === 'passed') {
          expect(entersVerdictRouter(status)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
