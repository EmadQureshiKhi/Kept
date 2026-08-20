import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ASSURANCE_STATUSES,
  COMMAND_FAMILIES,
  KNOWN_EVENT_TYPES,
  MEMBER_END_STATUSES,
  RUN_END_WIRE_FIELDS,
  VERDICT_OBJECT_FIELDS,
  contractFor,
  isKnownEventType,
  isVerdictObject,
  resultCode,
  type AssuranceDoneEvent,
  type AssuranceStatus,
  type KaneErrorEvent,
  type MemberEndEvent,
  type MemberEndStatus,
  type PerFlowMetadata,
  type ProgressEvent,
  type RunEndContext,
  type RunEndEvent,
  type TerminalEvent,
  type TestrunDoneEvent,
  type TestrunPlanEvent,
  type VerdictObject,
  type WireEnum,
} from '@kept/core';

/**
 * The Kane event surface, checked against the only two streams we have actually
 * observed (design §4.3, §5.3.1, R3.16 through R3.22).
 *
 * Two halves:
 *
 * - **Runtime**, against `docs/kane/smoke-run.ndjson` read from disk. The
 *   fixture is never restated here; it is the recording, and a test that
 *   paraphrased it would be checking a paraphrase. Every field name Kane emitted
 *   has to be accounted for by the declared surface, and the one exception —
 *   the legacy run directory — has to stay an exception.
 * - **Compile-time**, through typed annotations and `@ts-expect-error`. The root
 *   tsconfig type-checks `packages/*​/test/**​/*.ts`, so these are enforced by
 *   `tsc -b` rather than by vitest: an annotation that stopped holding fails the
 *   build, and an `@ts-expect-error` that stopped erroring fails it too.
 */

/** The pinned recording, read from disk — read-only, never restated here. */
const SMOKE_RUN = new URL('../../../docs/kane/smoke-run.ndjson', import.meta.url);

/**
 * The legacy key Kane still emits and nothing may read (R3.18, §4.6). Spelled
 * here so the fence can be asserted; the source declares only `runDirLegacy`.
 */
const LEGACY_RUN_DIR_KEY = 'run_dir';

function fixtureLines(fixture: URL): string[] {
  return readFileSync(fixture, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

const SMOKE_LINES = fixtureLines(SMOKE_RUN);
const SMOKE_EVENTS: readonly Record<string, unknown>[] = SMOKE_LINES.map(
  (line) => JSON.parse(line) as Record<string, unknown>,
);

function ownKeys(value: unknown): string[] {
  return Object.keys(value as Record<string, unknown>).sort();
}

describe('the recorded ExecutionRun stream is intact', () => {
  it('is twelve lines, every one of them strict JSON', () => {
    expect(SMOKE_LINES).toHaveLength(12);
    expect(SMOKE_EVENTS).toHaveLength(12);
  });

  it('ends with run_end and carries no event Kane 0.8.4 does not have', () => {
    const terminal = SMOKE_EVENTS.at(-1);
    expect(terminal?.['type']).toBe('run_end');

    const types = SMOKE_EVENTS.map((event) => event['type']).filter(
      (type): type is string => typeof type === 'string',
    );
    for (const invented of ['run_start', 'step_start', 'step_end']) {
      expect(types).not.toContain(invented);
    }
  });

  it('identifies progress lines by the step key, not by a type value (R3.8)', () => {
    const progress = SMOKE_EVENTS.filter((event) =>
      Object.prototype.hasOwnProperty.call(event, 'step'),
    );
    expect(progress).toHaveLength(8);
    // None of the eight carries a `type` at all — structural classification is
    // the only thing that could find them.
    expect(progress.every((event) => event['type'] === undefined)).toBe(true);

    const first = progress[0] as ProgressEvent | undefined;
    const step: number | string | undefined = first?.step;
    expect(typeof step).toBe('number');
  });
});

describe('RunEndEvent accommodates the observed run_end (R3.17)', () => {
  const runEnd = SMOKE_EVENTS.at(-1) as RunEndEvent;

  it('declares every field the real event carries, bar the legacy directory', () => {
    const declared = new Set<string>(RUN_END_WIRE_FIELDS);
    const undeclared = ownKeys(runEnd).filter((key) => !declared.has(key));

    // The single permitted gap. If Kane starts emitting a new field this test
    // fails, which is the point: an unannounced field should force a decision
    // about whether it is readable, not slip in through the index signature.
    expect(undeclared).toEqual([LEGACY_RUN_DIR_KEY]);
  });

  it('keeps the legacy run directory unreadable (R3.18, §4.6)', () => {
    // The wire key is never declared, so it resolves through the index signature
    // as `unknown` and cannot reach anything that expects a path.
    // @ts-expect-error — reading the legacy key yields unknown, never a path
    const asPath: string = runEnd[LEGACY_RUN_DIR_KEY];
    expect(typeof asPath).toBe('string'); // it *is* a string on the wire — and still unusable

    expect(RUN_END_WIRE_FIELDS).not.toContain(LEGACY_RUN_DIR_KEY);
    // The renamed slot is the only path-shaped declaration, and nothing fills it.
    const legacy: string | undefined = runEnd.runDirLegacy;
    expect(legacy).toBeUndefined();
  });

  it('carries no evidence-pack path of any name (R3.19)', () => {
    expect(ownKeys(runEnd).filter((key) => key.includes('evidence'))).toEqual([]);
    const sessionDir: string | undefined = runEnd.session_dir;
    expect(typeof sessionDir).toBe('string');
  });

  it('types the fields R3.17 names, widely enough to survive the wire', () => {
    const status: string | undefined = runEnd.status;
    const reasonCode: string | null | undefined = runEnd.reason_code;
    const runId: string | undefined = runEnd.run_id;
    const context: RunEndContext | undefined = runEnd.context;
    const perFlow: readonly PerFlowMetadata[] | undefined = runEnd.per_flow_metadata;
    const verdict: VerdictObject | undefined = runEnd.verdict;

    expect(status).toBe('passed');
    expect(reasonCode).toBe('success.complete');
    expect(runId).toBe('run-0');
    expect(context?.pointer).toBeDefined();
    expect(perFlow).toHaveLength(1);
    expect(verdict).toBeUndefined(); // a passing run carries no verdict object

    // The two typings of one field in one event, both coerced at the single site.
    const top = resultCode(runEnd);
    const flow = resultCode(perFlow?.[0]);
    expect(typeof runEnd.result_code).toBe('number');
    expect(typeof perFlow?.[0]?.result_code).toBe('string');
    expect(top).toBe(flow);

    // Credits: the observed name is declared, the documented one is accepted.
    const consumed: number | string | null | undefined = runEnd.credits_consumed;
    const documented: number | string | null | undefined = runEnd.credits;
    expect(typeof consumed).toBe('number');
    expect(documented).toBeUndefined();
  });

  it('is usable as the raw record the verdict router takes (§6.1)', () => {
    const asRecord: Record<string, unknown> = runEnd;
    expect(asRecord['type']).toBe('run_end');
  });
});

/**
 * The verified refusal envelope, verbatim (§5.3.1). Two lines, emitted on stdout
 * with nothing at all on stderr, by running `cover` where there is no context
 * store. Restated here because they are the observation, not a fixture read.
 */
const REFUSAL_LINES = [
  '{"type":"error","v":1,"verb":"cover","message":"error: no context store here (run `kane-cli context ingest <files>` first)"}',
  '{"type":"done","v":1,"verb":"cover","status":"refused","exit_code":2}',
] as const;

describe('the Assurance envelope and its terminal done (R3.22, §5.3.1)', () => {
  const [errorLine, doneLine] = REFUSAL_LINES;
  const errorEvent = JSON.parse(errorLine) as KaneErrorEvent;
  const doneEvent = JSON.parse(doneLine) as AssuranceDoneEvent;

  it('types v and verb as present-and-optional on both lines', () => {
    const errorVersion: number | undefined = errorEvent.v;
    const errorVerb: string | undefined = errorEvent.verb;
    const doneVersion: number | undefined = doneEvent.v;
    const doneVerb: string | undefined = doneEvent.verb;

    expect([errorVersion, doneVersion]).toEqual([1, 1]);
    expect([errorVerb, doneVerb]).toEqual(['cover', 'cover']);

    // Optional, so an Assurance event without the envelope still type-checks.
    const bare: AssuranceDoneEvent = { type: 'done', status: 'complete' };
    expect(bare.v).toBeUndefined();
  });

  it('exposes the refusal message verbatim for the diagnostic (§5.3)', () => {
    const message: string | undefined = errorEvent.message;
    expect(message).toContain('context ingest');
  });

  it('accepts status refused, and all six documented statuses', () => {
    const status: WireEnum<AssuranceStatus> | undefined = doneEvent.status;
    expect(status).toBe('refused');
    expect([...ASSURANCE_STATUSES]).toEqual([
      'complete',
      'paused',
      'error',
      'refused',
      'interrupted',
      'aborted',
    ]);
    expect(new Set(ASSURANCE_STATUSES).size).toBe(6);

    for (const known of ASSURANCE_STATUSES) {
      const assignable: AssuranceDoneEvent = { type: 'done', status: known };
      expect(assignable.status).toBe(known);
    }
    // Open, because the vocabulary is Kane's to extend.
    const future: AssuranceDoneEvent = { type: 'done', status: 'quarantined' };
    expect(future.status).toBe('quarantined');
  });

  it('keeps the event exit_code separate from the process exit code (R3.14)', () => {
    // Both were 2 in this observation, which is exactly why they must not merge.
    expect(doneEvent.exit_code).toBe(2);

    // @ts-expect-error — the event's code is wire-typed; coerce before using it
    const eventCode: number = doneEvent.exit_code;
    expect(eventCode).toBe(2);

    // The process code is interpreted per family, by the only thing that knows
    // that 3 means paused-and-resumable here. Nothing reads it off the event.
    expect(RUN_END_WIRE_FIELDS).not.toContain('exit_code');
  });
});

describe('the known type set is open, not an allow-list (§4.3, R3.9)', () => {
  it('is the twenty-two names of the verified surface, deduplicated', () => {
    expect(KNOWN_EVENT_TYPES).toHaveLength(22);
    expect(new Set(KNOWN_EVENT_TYPES).size).toBe(22);
  });

  it('recognises all three terminal types, one per family', () => {
    const terminals = COMMAND_FAMILIES.map((family) => contractFor(family).terminalType);
    expect(terminals).toEqual(['run_end', 'testrun_done', 'done']);
    for (const terminal of terminals) expect(isKnownEventType(terminal)).toBe(true);
  });

  it('recognises every type the recorded stream emitted', () => {
    for (const event of SMOKE_EVENTS) {
      const type = event['type'];
      if (type === undefined) continue; // progress line
      expect(isKnownEventType(type)).toBe(true);
    }
  });

  it('does not recognise the three events the website invented', () => {
    for (const invented of ['run_start', 'step_start', 'step_end']) {
      expect(isKnownEventType(invented)).toBe(false);
    }
  });

  it('answers false rather than throwing for anything that is not a type value', () => {
    for (const bogus of [null, undefined, 3, {}, [], 'toString', '', 'RUN_END']) {
      expect(isKnownEventType(bogus)).toBe(false);
    }
  });
});

describe('testrun shapes (R3.20, R3.21)', () => {
  it('exposes the four member statuses as four distinct values', () => {
    expect([...MEMBER_END_STATUSES]).toEqual(['passed', 'failed', 'broken', 'interrupted']);
    expect(new Set(MEMBER_END_STATUSES).size).toBe(4);

    for (const status of MEMBER_END_STATUSES) {
      const member: MemberEndEvent = { type: 'testrun_member_end', status };
      const narrowed: WireEnum<MemberEndStatus> | undefined = member.status;
      expect(narrowed).toBe(status);
    }
    // Open: an unseen status is a value to default on, not a type error.
    const future: MemberEndEvent = { type: 'testrun_member_end', status: 'flaked' };
    expect(future.status).toBe('flaked');
  });

  it('exposes valid plus path, test_id, tags and failure per plan member', () => {
    const plan: TestrunPlanEvent = {
      type: 'testrun_plan',
      valid: true,
      members: [
        { path: 'tests/cart_test.md', test_id: 'T-1', tags: ['cart'], failure: null },
        { path: 'tests/orphan_test.md', test_id: null, tags: [], failure: 'missing_meta' },
      ],
    };

    const valid: boolean | undefined = plan.valid;
    const first = plan.members?.[0];
    const second = plan.members?.[1];
    const testId: string | null | undefined = first?.test_id;
    const tags: readonly string[] | undefined = first?.tags;
    const failure: string | null | undefined = second?.failure;

    expect(valid).toBe(true);
    expect(testId).toBe('T-1');
    expect(tags).toEqual(['cart']);
    expect(failure).toBe('missing_meta');
    // An id-less member is representable, so the selector can exclude it rather
    // than guess an id from the path (§7.1).
    expect(second?.test_id).toBeNull();
  });
});

describe('VerdictObject is the raw wire shape (R3.16)', () => {
  it('names the six fields R3.16 requires', () => {
    expect([...VERDICT_OBJECT_FIELDS]).toEqual([
      'confirmed',
      'family',
      'category',
      'severity',
      'one_liner',
      'confidence',
    ]);
  });

  it('widens confirmed and confidence so a branch has to normalise them', () => {
    const asKaneDocuments: VerdictObject = {
      confirmed: true,
      family: 'payments',
      category: 'assertion',
      severity: 'high',
      one_liner: 'subtotal ignored the quantity change',
      confidence: 0.92,
    };
    // The same object as a differently-typed release might send it.
    const asWireMightSend: VerdictObject = { confirmed: 'true', confidence: '0.92' };

    expect(isVerdictObject(asKaneDocuments)).toBe(true);
    expect(isVerdictObject(asWireMightSend)).toBe(true);

    // @ts-expect-error — `confirmed` is not a boolean until stage 11 normalises it
    const trusted: boolean = asKaneDocuments.confirmed;
    expect(trusted).toBe(true);
    // @ts-expect-error — nor is `confidence` a number
    const threshold: number = asKaneDocuments.confidence;
    expect(threshold).toBeCloseTo(0.92);
  });

  it('recognises a verdict object without validating one', () => {
    for (const notAVerdict of [null, undefined, 'confirmed', 3, [], {}, { other: 1 }]) {
      expect(isVerdictObject(notAVerdict)).toBe(false);
    }
    // One recognised field is enough — partial objects are a wire state.
    expect(isVerdictObject({ severity: 'low' })).toBe(true);
    // Inherited members never count.
    expect(isVerdictObject(Object.create({ confirmed: true }))).toBe(false);
  });
});

describe('TerminalEvent<F> narrows to one family (§4.2)', () => {
  it('is the run_end shape for ExecutionRun', () => {
    const terminal: TerminalEvent<'ExecutionRun'> = { type: 'run_end', status: 'passed' };
    const type: 'run_end' = terminal.type;
    expect(type).toBe(contractFor('ExecutionRun').terminalType);

    // @ts-expect-error — an Assurance done is not an ExecutionRun terminal event
    const wrongFamily: TerminalEvent<'ExecutionRun'> = { type: 'done', status: 'complete' };
    expect(wrongFamily.type).toBe('done');
  });

  it('is the testrun_done shape for ExecutionTestrun', () => {
    const terminal: TerminalEvent<'ExecutionTestrun'> = { type: 'testrun_done' };
    const type: 'testrun_done' = terminal.type;
    expect(type).toBe(contractFor('ExecutionTestrun').terminalType);

    // @ts-expect-error — run_end is the other execution family's terminal event
    const wrongFamily: TestrunDoneEvent = { type: 'run_end' };
    expect(wrongFamily.type).toBe('run_end');
  });

  it('is the done shape for Assurance', () => {
    const terminal: TerminalEvent<'Assurance'> = { type: 'done', status: 'complete' };
    const type: 'done' = terminal.type;
    expect(type).toBe(contractFor('Assurance').terminalType);

    // @ts-expect-error — the ExecutionRun terminal type is not `done`
    const narrowed: 'done' = ({ type: 'run_end' } satisfies RunEndEvent).type;
    expect(narrowed).toBe('run_end');
  });
});
