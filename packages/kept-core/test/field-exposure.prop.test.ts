import { readFileSync } from 'node:fs';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ASSURANCE_STATUSES,
  RESULT_CODE_FIELD,
  VERDICT_OBJECT_FIELDS,
  contractFor,
  credits,
  isVerdictObject,
  parseStream,
  resolveEvidenceDir,
  resultCode,
  type AssuranceDoneEvent,
  type MemberEndEvent,
  type RunEndEvent,
  type TestrunDoneEvent,
  type TestrunPlanEvent,
} from '@kept/core';

import {
  arbFamily,
  arbMemberEndEvent,
  arbTerminalEvent,
  arbTestrunPlanEvent,
  arbTrapPath,
} from './arbitraries.js';

/**
 * Feature: kept, Property 13: Family-typed fields are exposed faithfully and
 * `run_dir` is never read (design §Correctness Properties, §4.3, §4.6; R3.16,
 * R3.17, R3.18, R3.21, R3.22).
 *
 * *For any* generated terminal event of any family, the parser exposes that
 * family's documented fields with their values unchanged — `status`,
 * `result_code`, `reason_code`, consumed credits, `run_id`, `session_dir` and
 * `per_flow_metadata` for `run_end`; `valid` and each member's `path`, `test_id`,
 * `tags` and `failure` for `testrun_plan`; the six `verdict` object fields when
 * present; and the `status` and `exit_code` for `done` — while performing zero
 * filesystem operations involving `run_dir` and parsing successfully whether or
 * not `run_dir` is present.
 *
 * ## "Unchanged" is measured against the wire, not against a re-derivation
 *
 * Every expectation below compares the parsed field to the value **the generated
 * line carries**, obtained as `JSON.parse` of that exact line. Nothing is
 * recomputed from the generator's seed, because a re-derivation would be a second
 * implementation of the thing under test — and because the line *is* the wire: a
 * value that cannot survive JSON is not a value Kane can emit. `NaN`, `Infinity`
 * and `undefined` are all in the generators on purpose (they are what an
 * unusable field looks like), and each of them changes shape at the serialiser,
 * before the parser ever sees it. Comparing to the pre-serialisation object would
 * be asserting against a value that never existed on any wire.
 *
 * Each family's clause therefore does two things: a whole-event deep equality,
 * which is the losslessness statement, and a field-by-field pass over exactly the
 * names the property lists, which is the statement that those specific fields are
 * *exposed* — a parser that returned the raw object under a different key would
 * pass the first and fail the second.
 *
 * `result_code` is read **only** through `resultCode()` (design §4.4, R3.12), so
 * the assertion is that the accessor answers the same off the parsed event as off
 * a plain `JSON.parse` of the same line — the parser altered nothing the accessor
 * reads. The recorded inconsistency is checked in the same clause: one event
 * carries the code at the top level and its string form inside
 * `per_flow_metadata[0]`, and both readings agree.
 *
 * ## How "zero filesystem operations involving `run_dir`" is encoded
 *
 * `run_dir` is a legacy key Kane still emits and no longer creates (R3.18), so
 * the failure it invites is silent: a pack read from a stale path looks exactly
 * like a run that produced no pack. Property 14 already proves the *resolver* is
 * path-independent through a recording filesystem. What is left for this property
 * is the parser itself, and it is encoded three ways:
 *
 * 1. **The parser performs no filesystem operation at all.** A static fence over
 *    `src/kane/ndjson.ts` asserts it imports nothing from `node:fs`, `node:path`
 *    or any other host API and calls no `require`. A module that cannot reach a
 *    filesystem cannot reach one *with* `run_dir`, and unlike a runtime spy this
 *    holds for every input rather than for the ones a test happened to try.
 * 2. **Presence-independence.** The same event parsed with the legacy keys
 *    injected and with them removed yields results that are equal once those keys
 *    are dropped — same kind, same fields, same diagnostics. Both directions are
 *    constructed on every run rather than left to the draw.
 * 3. **A legacy value is never surfaced as a path.** The wire key is undeclared
 *    on `RunEndEvent`, so reading it answers `unknown` and cannot be passed where
 *    a path is expected — asserted at compile time, which is where it matters.
 *    And at the one seam that does consume a path from this event, the resolved
 *    evidence directory never mentions an injected legacy value.
 *
 * **Validates: Requirements 3.16, 3.17, 3.18, 3.21, 3.22**
 */

/** Design §Testing Strategy floor is 100 runs; stated so it cannot regress to a default. */
const NUM_RUNS = 500;

/** Own-key test, safe on any parsed value. */
function hasOwn(source: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

/**
 * The keys no filesystem call may ever take. `run_dir` and `runDirLegacy` are
 * the legacy pair named by R3.18; the rest are plausible names an implementer
 * would invent, and they are dropped from both sides of the
 * presence-independence comparison.
 */
const LEGACY_PATH_KEYS: readonly string[] = [
  'run_dir',
  'runDirLegacy',
  'evidence_path',
  'evidence_dir',
  'evidencePath',
  'packDir',
];

/** The same object without any legacy path key. */
function withoutLegacyKeys(source: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!LEGACY_PATH_KEYS.includes(key)) copy[key] = value;
  }
  return copy;
}

/** The wire line of an event, and the value that line carries. */
function wireOf<T>(event: T): { readonly line: string; readonly wire: T } {
  const line = JSON.stringify(event);
  return { line, wire: JSON.parse(line) as T };
}

describe('Feature: kept, Property 13: Family-typed fields are exposed faithfully and run_dir is never read', () => {
  describe('run_end — the ExecutionRun terminal event (R3.17)', () => {
    it('exposes every documented field with its value unchanged', () => {
      fc.assert(
        fc.property(arbTerminalEvent('ExecutionRun'), (event) => {
          const { line, wire } = wireOf<RunEndEvent>(event);
          const parsed = parseStream(contractFor('ExecutionRun'), [line]);
          expect(parsed.kind).toBe('complete');
          if (parsed.kind !== 'complete') return;
          const terminal: RunEndEvent = parsed.terminal;

          // Losslessness: the whole event, exactly as the line carried it.
          expect(terminal).toEqual(wire);
          expect(parsed.diagnostics).toEqual([]);

          // And each field the property names, by name.
          expect(terminal.type).toBe('run_end');
          expect(terminal.status).toBe(wire.status);
          expect(terminal.reason_code).toBe(wire.reason_code);
          expect(terminal.run_id).toBe(wire.run_id);
          expect(terminal.session_dir).toBe(wire.session_dir);
          expect(terminal.per_flow_metadata).toEqual(wire.per_flow_metadata);

          // Presence is preserved as well as value: an absent `session_dir` is a
          // run that named no session, which is different from one that named an
          // empty string, and the evidence resolver depends on the difference.
          expect(hasOwn(terminal, 'session_dir')).toBe(hasOwn(wire, 'session_dir'));
          expect(hasOwn(terminal, 'run_id')).toBe(hasOwn(wire, 'run_id'));

          // The two coerced fields, read only through their accessors (§4.4).
          expect(hasOwn(terminal, RESULT_CODE_FIELD)).toBe(hasOwn(wire, RESULT_CODE_FIELD));
          expect(resultCode(terminal)).toBe(resultCode(wire));
          expect(terminal.credits_consumed).toEqual(wire.credits_consumed);
          expect(terminal.credits).toEqual(wire.credits);
          expect(credits(terminal)).toBe(credits(wire));
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it('reads the same code from the top level and from per_flow_metadata[0] (R3.13)', () => {
      fc.assert(
        fc.property(arbTerminalEvent('ExecutionRun'), (event) => {
          const { line } = wireOf<RunEndEvent>(event);
          const parsed = parseStream(contractFor('ExecutionRun'), [line]);
          if (parsed.kind !== 'complete') throw new Error('expected a complete stream');
          const terminal: RunEndEvent = parsed.terminal;

          const flow = terminal.per_flow_metadata?.[0];
          if (flow === undefined) return;
          // One event, two typings — number at the top level, string one level
          // down. Both are exposed untouched, and the accessor reads them to the
          // same value, which is the whole reason comparison goes through it.
          expect(resultCode(flow)).toBe(resultCode(terminal));
        }),
        { numRuns: NUM_RUNS },
      );
    });
  });

  describe('testrun_done and testrun_plan — the ExecutionTestrun surface (R3.21)', () => {
    it('exposes the terminal status and totals unchanged', () => {
      fc.assert(
        fc.property(arbTerminalEvent('ExecutionTestrun'), (event) => {
          const { line, wire } = wireOf<TestrunDoneEvent>(event);
          const parsed = parseStream(contractFor('ExecutionTestrun'), [line]);
          expect(parsed.kind).toBe('complete');
          if (parsed.kind !== 'complete') return;
          const terminal: TestrunDoneEvent = parsed.terminal;

          expect(terminal).toEqual(wire);
          expect(terminal.type).toBe('testrun_done');
          expect(terminal.status).toBe(wire.status);
          expect(terminal.totals).toEqual(wire.totals);
          expect(hasOwn(terminal, 'totals')).toBe(hasOwn(wire, 'totals'));
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it('exposes valid and every member’s path, test_id, tags and failure', () => {
      fc.assert(
        fc.property(
          arbFamily.chain((family) =>
            fc
              .record({ plan: arbTestrunPlanEvent, terminal: arbTerminalEvent(family) })
              .map((parts) => ({ family, ...parts })),
          ),
          ({ family, plan, terminal }) => {
            const planWire = wireOf<TestrunPlanEvent>(plan as TestrunPlanEvent);
            const lines = [planWire.line, JSON.stringify(terminal)];
            // Collected unconditionally, not gated on family: only an
            // ExecutionTestrun stream carries a plan in practice, but R3.3's
            // restriction belongs to the verdict layer, which names a family too.
            const parsed = parseStream(contractFor(family), lines);

            expect(parsed.plan).toEqual(planWire.wire);
            expect(parsed.plan?.valid).toBe(planWire.wire.valid);

            const wireMembers = planWire.wire.members ?? [];
            expect(parsed.plan?.members ?? []).toHaveLength(wireMembers.length);
            wireMembers.forEach((wireMember, index) => {
              const member = parsed.plan?.members?.[index];
              expect(member?.path).toBe(wireMember.path);
              expect(member?.test_id).toBe(wireMember.test_id);
              expect(member?.tags).toEqual(wireMember.tags);
              expect(member?.failure).toBe(wireMember.failure);
            });
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });
  });

  describe('done — the Assurance terminal event (R3.22)', () => {
    it('exposes status and exit_code unchanged, in either wire type', () => {
      fc.assert(
        fc.property(arbTerminalEvent('Assurance'), (event) => {
          const { line, wire } = wireOf<AssuranceDoneEvent>(event);
          const parsed = parseStream(contractFor('Assurance'), [line]);
          expect(parsed.kind).toBe('complete');
          if (parsed.kind !== 'complete') return;
          const terminal: AssuranceDoneEvent = parsed.terminal;

          expect(terminal).toEqual(wire);
          expect(terminal.type).toBe('done');
          expect(terminal.status).toBe(wire.status);
          // The event's **own** exit code, carried inside the stream. Never the
          // process exit code, and never merged with it (R3.14).
          expect(terminal.exit_code).toBe(wire.exit_code);
          expect(hasOwn(terminal, 'exit_code')).toBe(hasOwn(wire, 'exit_code'));
          // The verified envelope: observed, so declared.
          expect(terminal.v).toBe(wire.v);
          expect(terminal.verb).toBe(wire.verb);
          expect(terminal.message).toBe(wire.message);
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it('exposes all six documented statuses as six distinct values', () => {
      // Not a property: the vocabulary is six values, so it is enumerated. Each
      // one reads back verbatim off a **complete** stream — `refused` included,
      // which is the observed value that makes a refusal a complete stream rather
      // than a crashed one (§5.3.1).
      const exposed = ASSURANCE_STATUSES.map((status) => {
        const line = JSON.stringify({ type: 'done', v: 1, verb: 'cover', status, exit_code: 0 });
        const parsed = parseStream(contractFor('Assurance'), [line]);
        expect(parsed.kind).toBe('complete');
        if (parsed.kind !== 'complete') return null;
        return parsed.terminal.status;
      });
      expect(exposed).toEqual([...ASSURANCE_STATUSES]);
      expect(new Set(exposed).size).toBe(ASSURANCE_STATUSES.length);
    });
  });

  describe('the verdict object, when present (R3.16)', () => {
    it('exposes the six fields of a terminal event’s verdict unchanged', () => {
      fc.assert(
        fc.property(arbTerminalEvent('ExecutionRun'), (event) => {
          const { line, wire } = wireOf<RunEndEvent>(event);
          const parsed = parseStream(contractFor('ExecutionRun'), [line]);
          if (parsed.kind !== 'complete') throw new Error('expected a complete stream');
          const wireVerdict = wire.verdict;
          if (wireVerdict === undefined) return;

          const verdict = parsed.terminal.verdict;
          expect(isVerdictObject(verdict)).toBe(true);
          // The whole object, including fields no release has announced.
          expect(verdict).toEqual(wireVerdict);
          for (const field of VERDICT_OBJECT_FIELDS) {
            expect(verdict?.[field]).toEqual(wireVerdict[field]);
            expect(hasOwn(verdict ?? {}, field)).toBe(hasOwn(wireVerdict, field));
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it('exposes the six fields of a member’s verdict unchanged', () => {
      fc.assert(
        fc.property(
          arbFamily.chain((family) =>
            fc
              .record({ member: arbMemberEndEvent, terminal: arbTerminalEvent(family) })
              .map((parts) => ({ family, ...parts })),
          ),
          ({ family, member, terminal }) => {
            const memberWire = wireOf<MemberEndEvent>(member as MemberEndEvent);
            const parsed = parseStream(contractFor(family), [
              memberWire.line,
              JSON.stringify(terminal),
            ]);

            expect(parsed.members).toHaveLength(1);
            const parsedMember = parsed.members[0];
            expect(parsedMember).toEqual(memberWire.wire);
            expect(parsedMember?.status).toBe(memberWire.wire.status);
            expect(parsedMember?.path).toBe(memberWire.wire.path);
            expect(parsedMember?.test_id).toBe(memberWire.wire.test_id);

            const wireVerdict = memberWire.wire.verdict;
            if (wireVerdict === undefined) return;
            expect(isVerdictObject(parsedMember?.verdict)).toBe(true);
            for (const field of VERDICT_OBJECT_FIELDS) {
              expect(parsedMember?.verdict?.[field]).toEqual(wireVerdict[field]);
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });
  });

  describe('run_dir is never read (R3.18)', () => {
    it('parses identically whether or not the legacy path keys are present', () => {
      fc.assert(
        fc.property(
          arbFamily.chain((family) =>
            fc
              .record({ terminal: arbTerminalEvent(family), trap: arbTrapPath })
              .map((parts) => ({ family, ...parts })),
          ),
          ({ family, terminal, trap }) => {
            const contract = contractFor(family);
            const wire = JSON.parse(JSON.stringify(terminal)) as Record<string, unknown>;

            // Both directions are constructed, not drawn: one event with every
            // legacy key stripped, and the same event with them injected.
            const absent = withoutLegacyKeys(wire);
            const present: Record<string, unknown> = {
              ...absent,
              run_dir: trap,
              runDirLegacy: trap,
              evidence_dir: trap,
            };

            const withoutRunDir = parseStream(contract, [JSON.stringify(absent)]);
            const withRunDir = parseStream(contract, [JSON.stringify(present)]);

            // Parsing succeeds either way, with nothing to report either way.
            expect(withoutRunDir.kind).toBe('complete');
            expect(withRunDir.kind).toBe('complete');
            expect(withRunDir.diagnostics).toEqual([]);
            expect(withoutRunDir.diagnostics).toEqual([]);
            if (withRunDir.kind !== 'complete' || withoutRunDir.kind !== 'complete') return;

            // And once the legacy keys are dropped, the two results are the same
            // event: nothing downstream of the parser can be steered by them.
            expect(withoutLegacyKeys(withRunDir.terminal)).toEqual(
              withoutLegacyKeys(withoutRunDir.terminal),
            );
            expect(withRunDir.events).toHaveLength(withoutRunDir.events.length);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    it('never surfaces a legacy value where a path is expected', () => {
      fc.assert(
        fc.property(arbTerminalEvent('ExecutionRun'), arbTrapPath, (event, trap) => {
          const line = JSON.stringify({ ...event, run_dir: trap, runDirLegacy: trap });
          const parsed = parseStream(contractFor('ExecutionRun'), [line]);
          if (parsed.kind !== 'complete') throw new Error('expected a complete stream');
          const terminal: RunEndEvent = parsed.terminal;

          // The wire key is undeclared on `RunEndEvent`, so it comes back through
          // the index signature as `unknown` and cannot be passed anywhere a path
          // is expected without an explicit cast. This is the assertion, and it is
          // enforced by `tsc -b`: an unused `@ts-expect-error` is itself an error.
          // @ts-expect-error `run_dir` is undeclared and reads as unknown
          const asPath: string = terminal['run_dir'];
          void asPath;

          // At the one seam that does take a path off this event, the answer comes
          // from the family contract plus `session_dir` and mentions no legacy
          // value — `/trap/` and `/legacy/` are disjoint from the session root by
          // construction.
          const sessionDir = typeof terminal.session_dir === 'string' ? terminal.session_dir : null;
          const evidence = resolveEvidenceDir({
            family: 'ExecutionRun',
            sessionDir,
            cwd: '/base/cwd',
          });
          if (evidence !== null) {
            expect(evidence.includes('/trap/')).toBe(false);
            expect(evidence.includes('/legacy/')).toBe(false);
          }
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it('performs no filesystem operation at all, with or without run_dir', () => {
      // A static fence rather than a runtime spy: a module that imports no host
      // API cannot reach a filesystem on *any* input, which is a stronger
      // statement than "did not on the inputs tried". Property 14 covers the
      // resolver, which is the module that legitimately touches disk.
      const source = readFileSync(
        new URL('../src/kane/ndjson.ts', import.meta.url),
        'utf8',
      );
      const hostImports = /from\s+['"]node:[a-z_\/]+['"]/gu;
      expect(source.match(hostImports)).toBeNull();
      expect(source.includes('require(')).toBe(false);
      expect(source.includes('createRequire')).toBe(false);
      expect(source.includes('process.cwd')).toBe(false);
      // The guard must not be able to pass by reading the wrong file.
      expect(source).toContain('export function parseStream');
    });
  });

});
