import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  NDJSON_CRASHED_DIAGNOSTIC_CODE,
  NDJSON_PARSE_DIAGNOSTIC_CODE,
  contractFor,
  createDiagnosticSink,
  parseStream,
  resultCode,
  type AssuranceDoneEvent,
  type MemberEndStatus,
  type RunEndEvent,
  type TestrunDoneEvent,
} from 'kept-core';

/**
 * The family-gated NDJSON parser, checked against every recorded and authored
 * stream we have (design §4.2, §4.3, R3.1, R3.3, R3.6, R3.8, R3.9, R3.23, R3.24,
 * R3.25).
 *
 * Two halves, both enforced by `npm run check`:
 *
 * - **Runtime**, against `test/fixtures/*.ndjson` and the pinned recording at
 *   `docs/kane/smoke-run.ndjson`, read from disk and never restated here. Lines
 *   are handed to the parser exactly as the file carries them, trailing newline
 *   included, because a parser that only works on pre-cleaned input is not the
 *   thing we need.
 * - **Compile-time**, through `@ts-expect-error` and typed annotations. The root
 *   tsconfig type-checks `packages/*​/test/**​/*.ts`, so the fence that keeps
 *   `terminal` off the `crashed` arm fails the *build* if it ever stops holding,
 *   which is the only way a type guarantee can be a test.
 *
 * Properties 7, 8 and 13 are tasks 2.12–2.14 and live elsewhere.
 */

const FIXTURES = new URL('./fixtures/', import.meta.url);

/** The pinned recording named by R3.25. Read-only; `run-passed.ndjson` copies it. */
const SMOKE_RUN = new URL('../../../docs/kane/smoke-run.ndjson', import.meta.url);

/** Raw lines, exactly as the file carries them — blanks and all. */
function rawLines(file: URL): string[] {
  return readFileSync(file, 'utf8').split('\n');
}

function fixtureLines(name: string): string[] {
  return rawLines(new URL(name, FIXTURES));
}

/** How many lines of a file actually parse as a JSON object. */
function jsonObjectLineCount(lines: readonly string[]): number {
  return lines.filter((line) => {
    if (!line.trimStart().startsWith('{')) return false;
    try {
      return typeof JSON.parse(line) === 'object';
    } catch {
      return false;
    }
  }).length;
}

const RUN = contractFor('ExecutionRun');
const TESTRUN = contractFor('ExecutionTestrun');
const ASSURANCE = contractFor('Assurance');

describe('ExecutionRun — the recorded stream (R3.25)', () => {
  const lines = rawLines(SMOKE_RUN);
  const parsed = parseStream(RUN, lines);

  it('is complete, terminal on run_end, and records no diagnostic', () => {
    expect(parsed.kind).toBe('complete');
    expect(parsed.diagnostics).toEqual([]);
    if (parsed.kind !== 'complete') return;
    expect(parsed.terminal.type).toBe('run_end');
    expect(parsed.terminal.status).toBe('passed');
  });

  it('emits one event per JSON line, split into events and progress (R3.1)', () => {
    expect(jsonObjectLineCount(lines)).toBe(12);
    expect(parsed.events.length + parsed.progress.length).toBe(12);
    // Four typed events; the other eight lines are the untyped {step,...} objects.
    expect(parsed.events).toHaveLength(4);
    expect(parsed.progress).toHaveLength(8);
    expect(parsed.progress.every((event) => 'step' in event)).toBe(true);
  });

  it('recognises both undocumented types rather than retaining them as unknown', () => {
    // `recording_state` and `skill_update_available` are documented nowhere but
    // are in the recognised set, so retention is not what covers them here.
    expect(parsed.unknown).toEqual([]);
    expect(parsed.events.map((event) => event['type'])).toEqual([
      'recording_state',
      'skill_update_available',
      'bifurcation',
      'run_end',
    ]);
  });

  it('keeps the terminal event in events as well as on the terminal field', () => {
    if (parsed.kind !== 'complete') throw new Error('expected a complete stream');
    expect(parsed.events.at(-1)).toBe(parsed.terminal);
  });

  it('exposes no testrun or coverage views for this family', () => {
    expect(parsed.members).toEqual([]);
    expect(parsed.plan).toBeNull();
    expect(parsed.coverage).toBeNull();
  });
});

describe('ExecutionRun — the failing authored stream', () => {
  const lines = fixtureLines('run-failed-740.ndjson');
  const parsed = parseStream(RUN, lines);

  it('is complete with the inline verdict object exposed (R3.16)', () => {
    expect(parsed.kind).toBe('complete');
    if (parsed.kind !== 'complete') return;
    const terminal: RunEndEvent = parsed.terminal;
    expect(terminal.status).toBe('failed');
    expect(terminal.verdict?.confirmed).toBe(true);
    expect(terminal.verdict?.one_liner).toBe('subtotal did not change after quantity increment');
  });

  it('reads the confirmed-bug code through the coercing accessor from both typings', () => {
    if (parsed.kind !== 'complete') throw new Error('expected a complete stream');
    const terminal: RunEndEvent = parsed.terminal;
    // The field is the string at the top level and the number one level down.
    expect(resultCode(terminal)).toBe(740);
    expect(resultCode(terminal.per_flow_metadata?.[0])).toBe(740);
  });

  it('tolerates the legacy run directory key without reading it (R3.18)', () => {
    if (parsed.kind !== 'complete') throw new Error('expected a complete stream');
    // Present on the wire, undeclared on the interface: reading it answers
    // `unknown`, so nothing can pass it where a path is expected.
    const legacy: unknown = parsed.terminal['run_dir'];
    expect(typeof legacy).toBe('string');
    expect(parsed.diagnostics).toEqual([]);
  });

  it('splits the nine lines into three events and six progress lines', () => {
    expect(parsed.events).toHaveLength(3);
    expect(parsed.progress).toHaveLength(6);
    expect(parsed.events.length + parsed.progress.length).toBe(jsonObjectLineCount(lines));
  });
});

describe('ExecutionTestrun — the mixed suite', () => {
  const lines = fixtureLines('testrun-mixed.ndjson');
  const parsed = parseStream(TESTRUN, lines);

  it('is complete on testrun_done, not on run_end', () => {
    expect(parsed.kind).toBe('complete');
    if (parsed.kind !== 'complete') return;
    const terminal: TestrunDoneEvent = parsed.terminal;
    expect(terminal.type).toBe('testrun_done');
    expect(terminal.status).toBe('failed');
    expect(terminal.totals?.tests).toBe(4);
  });

  it('exposes all four member statuses as four distinct values (R3.20)', () => {
    const statuses = parsed.members.map((member) => member.status);
    expect(statuses).toEqual<MemberEndStatus[]>([
      'passed',
      'failed',
      'broken',
      'interrupted',
    ]);
    expect(new Set(statuses).size).toBe(4);
  });

  it('exposes the plan with each member’s identity (R3.21)', () => {
    expect(parsed.plan?.valid).toBe(true);
    expect(parsed.plan?.members?.map((member) => member.test_id)).toEqual([
      'T-1',
      'T-3',
      'T-4',
      'T-5',
    ]);
    expect(parsed.plan?.members?.[0]?.tags).toEqual(['shop', 'smoke']);
    expect(parsed.plan?.members?.[0]?.failure).toBeNull();
  });

  it('parses all fourteen lines with no diagnostic and nothing unknown', () => {
    expect(parsed.events).toHaveLength(14);
    expect(parsed.progress).toEqual([]);
    expect(parsed.unknown).toEqual([]);
    expect(parsed.diagnostics).toEqual([]);
  });
});

describe('ExecutionTestrun — the preflight rejection is complete, not crashed', () => {
  const parsed = parseStream(TESTRUN, fixtureLines('testrun-preflight-invalid.ndjson'));

  it('reaches its terminal event even though nothing ran', () => {
    expect(parsed.kind).toBe('complete');
    expect(parsed.diagnostics).toEqual([]);
  });

  it('exposes valid: false and every rejection reason (R3.21)', () => {
    expect(parsed.plan?.valid).toBe(false);
    expect(parsed.plan?.members?.map((member) => member.failure)).toEqual([
      'missing_meta',
      'not_authored',
      'org_mismatch',
      'project_mismatch',
    ]);
    // Nothing executed, so there is no member outcome to read.
    expect(parsed.members).toEqual([]);
  });
});

describe('ExecutionTestrun — the truncated stream is crashed (R3.6)', () => {
  const lines = fixtureLines('testrun-crashed.ndjson');
  const parsed = parseStream(TESTRUN, lines);

  it('classifies the outcome as unknown rather than as a pass or a failure', () => {
    expect(parsed.kind).toBe('crashed');
    if (parsed.kind !== 'crashed') return;
    expect(parsed.expectedTerminal).toBe('testrun_done');
    expect(parsed.family).toBe('ExecutionTestrun');
  });

  it('names the family and the expected terminal type in one diagnostic', () => {
    expect(parsed.diagnostics).toHaveLength(1);
    const diagnostic = parsed.diagnostics[0];
    expect(diagnostic?.code).toBe(NDJSON_CRASHED_DIAGNOSTIC_CODE);
    expect(diagnostic?.message).toContain('ExecutionTestrun');
    expect(diagnostic?.message).toContain('testrun_done');
    expect(diagnostic?.message).toContain('outcome unknown');
    expect(diagnostic?.line).toBeNull();
  });

  it('still retains every event it did see', () => {
    expect(parsed.events).toHaveLength(5);
    expect(parsed.members.map((member) => member.status)).toEqual(['passed']);
    expect(parsed.plan?.members).toHaveLength(2);
  });
});

describe('the same stream parsed against the wrong family reports nothing readable', () => {
  it('reads the recorded run as crashed when the family says Assurance', () => {
    const parsed = parseStream(ASSURANCE, rawLines(SMOKE_RUN));
    expect(parsed.kind).toBe('crashed');
    if (parsed.kind !== 'crashed') return;
    // The whole reason `parseStream` takes a contract: nothing here infers
    // `run_end` from the stream's contents.
    expect(parsed.expectedTerminal).toBe('done');
    expect(parsed.diagnostics[0]?.message).toContain('Assurance');
    // `run_end` is a recognised type, so it is retained as a plain event.
    expect(parsed.events.map((event) => event['type'])).toContain('run_end');
    expect(parsed.unknown).toEqual([]);
  });

  it('reads the mixed testrun as crashed when the family says ExecutionRun', () => {
    const parsed = parseStream(RUN, fixtureLines('testrun-mixed.ndjson'));
    expect(parsed.kind).toBe('crashed');
    if (parsed.kind !== 'crashed') return;
    expect(parsed.expectedTerminal).toBe('run_end');
    // Members are retained regardless of family; R3.3's restriction is the
    // verdict layer's, and it names a family too.
    expect(parsed.members).toHaveLength(4);
  });
});

describe('Assurance — the verified refusal is a complete stream (§5.3.1)', () => {
  const parsed = parseStream(ASSURANCE, fixtureLines('assurance-cover-refused.ndjson'));

  it('is complete with status refused, never crashed', () => {
    expect(parsed.kind).toBe('complete');
    if (parsed.kind !== 'complete') return;
    const terminal: AssuranceDoneEvent = parsed.terminal;
    expect(terminal.type).toBe('done');
    expect(terminal.status).toBe('refused');
    // The event's own exit code, never merged with the process one (R3.14).
    expect(terminal.exit_code).toBe(2);
    expect(terminal.v).toBe(1);
    expect(terminal.verb).toBe('cover');
  });

  it('retains the error event so its remedy can be quoted verbatim', () => {
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0]?.['message']).toBe(
      'error: no context store here (run `kane-cli context ingest <files>` first)',
    );
    expect(parsed.diagnostics).toEqual([]);
  });
});

describe('Assurance — the coverage payload is exposed raw', () => {
  const lines = fixtureLines('assurance-cover-done.ndjson');
  const parsed = parseStream(ASSURANCE, lines);

  it('is complete with status complete', () => {
    expect(parsed.kind).toBe('complete');
    if (parsed.kind !== 'complete') return;
    expect(parsed.terminal.status).toBe('complete');
    expect(parsed.terminal.exit_code).toBe(0);
  });

  it('exposes the whole coverage event, unprojected and byte-faithful', () => {
    const firstLine = lines[0];
    expect(firstLine).toBeDefined();
    expect(parsed.coverage).toEqual(JSON.parse(firstLine as string));
    // Nothing is lifted out: `pack`, `generated_at` and the nested payload all
    // stay where Kane put them, because the payload schema is not pinned.
    expect(parsed.coverage?.['pack']).toBe('.testmuai/evidence/ev_20260820T183041Z');
    const payload = parsed.coverage?.['coverage'] as Record<string, unknown>;
    expect((payload['tests'] as unknown[]).length).toBe(7);
  });

  it('keeps the coverage event in events too', () => {
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0]).toBe(parsed.coverage);
  });
});

describe('Assurance — a pause is complete, and its unknown type is retained (R3.9)', () => {
  const parsed = parseStream(ASSURANCE, fixtureLines('assurance-paused.ndjson'));

  it('reads status paused and event exit code 3 off a complete stream', () => {
    expect(parsed.kind).toBe('complete');
    if (parsed.kind !== 'complete') return;
    expect(parsed.terminal.status).toBe('paused');
    expect(parsed.terminal.exit_code).toBe(3);
  });

  it('retains the unrecognised event type and keeps going', () => {
    expect(parsed.unknown).toHaveLength(1);
    expect(parsed.unknown[0]?.['type']).toBe('review_card');
    // Retained means retained in both views, and it did not stop the parse.
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0]).toBe(parsed.unknown[0]);
    expect(parsed.diagnostics).toEqual([]);
  });
});

describe('line handling (§4.3)', () => {
  it('skips non-{ prefix lines silently and numbers the rest one-based', () => {
    const lines = [
      'kane-cli 0.8.4',
      '  banner text, not JSON',
      '{"type":"recording_state","enabled":true}',
      'not json at all',
      '',
      '{"step":1,"status":"running","remark":"Step 1"}',
      '42',
      '{"type":"run_end","status":"passed"}',
    ];
    const parsed = parseStream(RUN, lines);

    expect(parsed.kind).toBe('complete');
    // Two prefix lines and one blank line: three skips, zero diagnostics.
    expect(parsed.diagnostics).toHaveLength(2);
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([4, 7]);
    expect(
      parsed.diagnostics.every(
        (diagnostic) => diagnostic.code === NDJSON_PARSE_DIAGNOSTIC_CODE,
      ),
    ).toBe(true);
    // Parsing continued past both bad lines and still reached the terminal.
    expect(parsed.events).toHaveLength(2);
    expect(parsed.progress).toHaveLength(1);
  });

  it('records no diagnostic when a stream is nothing but prefix lines', () => {
    const parsed = parseStream(RUN, ['kane-cli 0.8.4', 'no stream here', '']);
    expect(parsed.kind).toBe('crashed');
    expect(parsed.events).toEqual([]);
    // The only diagnostic is the crash itself — the prefix lines are silent.
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics[0]?.code).toBe(NDJSON_CRASHED_DIAGNOSTIC_CODE);
  });

  it('treats an empty stream as crashed rather than as an empty success', () => {
    const parsed = parseStream(ASSURANCE, []);
    expect(parsed.kind).toBe('crashed');
    expect(parsed.diagnostics).toHaveLength(1);
  });

  it('diagnoses a malformed line that is the very first { line', () => {
    const parsed = parseStream(RUN, ['{"type":"run_end"', '{"type":"run_end"}']);
    expect(parsed.kind).toBe('complete');
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics[0]?.line).toBe(1);
    expect(parsed.diagnostics[0]?.message).toContain('{"type":"run_end"');
  });

  it('classifies by the step key first, whatever the type says (R3.8)', () => {
    // Precedence, spelled out: a `step` key wins over a terminal `type`, so this
    // stream reads crashed. Outcome unknown is the safe direction — the
    // alternative is reading a verdict off a progress line. No observed
    // terminal event carries `step`.
    const parsed = parseStream(RUN, ['{"type":"run_end","step":4,"status":"passed"}']);
    expect(parsed.kind).toBe('crashed');
    expect(parsed.progress).toHaveLength(1);
    expect(parsed.events).toEqual([]);
  });

  it('classifies an untyped step line as progress, not as unknown', () => {
    const parsed = parseStream(RUN, [
      '{"step":2,"status":"done","remark":"navigate"}',
      '{"type":"run_end"}',
    ]);
    expect(parsed.progress).toHaveLength(1);
    expect(parsed.unknown).toEqual([]);
  });

  it('retains a typeless, stepless object as unknown', () => {
    const parsed = parseStream(RUN, ['{}', '{"type":"run_end"}']);
    expect(parsed.unknown).toHaveLength(1);
    expect(parsed.events).toHaveLength(2);
  });

  it('lets the last terminal-type event win, retaining the earlier ones', () => {
    const parsed = parseStream(RUN, [
      '{"type":"run_end","status":"failed","run_id":"first"}',
      '{"type":"bifurcation","count":1}',
      '{"type":"run_end","status":"passed","run_id":"second"}',
    ]);
    expect(parsed.kind).toBe('complete');
    if (parsed.kind !== 'complete') return;
    expect(parsed.terminal.run_id).toBe('second');
    expect(parsed.events).toHaveLength(3);
    expect(parsed.events[0]?.['run_id']).toBe('first');
  });

  it('keeps the last coverage event and the last plan when several arrive', () => {
    const parsed = parseStream(TESTRUN, [
      '{"type":"testrun_plan","valid":true,"members":[]}',
      '{"type":"testrun_plan","valid":false,"members":[]}',
      '{"type":"coverage","pack":"first"}',
      '{"type":"coverage","pack":"second"}',
      '{"type":"testrun_done","status":"failed"}',
    ]);
    expect(parsed.plan?.valid).toBe(false);
    expect(parsed.coverage?.['pack']).toBe('second');
  });
});

describe('diagnostics wiring', () => {
  it('reports into an injected sink as well as onto the result', () => {
    const sink = createDiagnosticSink({ clock: () => new Date('2026-08-20T18:30:41.000Z') });
    const parsed = parseStream(RUN, ['{"type":"recording_state"}', 'broken'], {
      sink,
      file: 'docs/kane/smoke-run.ndjson',
    });

    expect(parsed.kind).toBe('crashed');
    // One malformed line plus the crash.
    expect(sink.size).toBe(2);
    expect(sink.entries).toEqual(parsed.diagnostics);
    expect(sink.has(NDJSON_PARSE_DIAGNOSTIC_CODE)).toBe(true);
    expect(sink.has(NDJSON_CRASHED_DIAGNOSTIC_CODE)).toBe(true);
    expect(parsed.diagnostics.every((d) => d.file === 'docs/kane/smoke-run.ndjson')).toBe(true);
    expect(parsed.diagnostics.every((d) => d.at === '2026-08-20T18:30:41.000Z')).toBe(true);
  });

  it('defaults to its own sink, so a bare two-argument call still collects', () => {
    const parsed = parseStream(RUN, ['{"nope"']);
    expect(parsed.diagnostics).toHaveLength(2);
  });
});

describe('the type fence: terminal exists only on the complete arm (§4.2)', () => {
  it('narrows the terminal event to the family that was declared', () => {
    const run = parseStream(RUN, rawLines(SMOKE_RUN));
    if (run.kind === 'complete') {
      // `TerminalEvent<'ExecutionRun'>` is the `run_end` shape and nothing else.
      const literal: 'run_end' = run.terminal.type;
      expect(literal).toBe('run_end');
      // @ts-expect-error `expectedTerminal` belongs to the crashed arm only
      void run.expectedTerminal;
    }

    const assurance = parseStream(ASSURANCE, fixtureLines('assurance-cover-done.ndjson'));
    if (assurance.kind === 'complete') {
      const literal: 'done' = assurance.terminal.type;
      expect(literal).toBe('done');
    }
  });

  it('makes reading a verdict off a crashed stream a compile error', () => {
    const crashed = parseStream(TESTRUN, fixtureLines('testrun-crashed.ndjson'));
    if (crashed.kind === 'crashed') {
      // The load-bearing assertion of this whole module: not `undefined` at
      // runtime, a build failure. If `terminal` ever appears on this arm, the
      // unused-directive error fails `tsc -b`.
      // @ts-expect-error `terminal` exists only on the complete arm
      void crashed.terminal;

      const expected: 'testrun_done' = crashed.expectedTerminal;
      expect(expected).toBe('testrun_done');
    }
  });

  it('refuses a parse call that names no family', () => {
    // Never invoked: the assertion is that this does not compile. A family name
    // is not a contract, and `FamilyContract`'s brand is module-private, so
    // `contractFor()` is the only way to obtain one.
    const unfamilied = (): unknown =>
      // @ts-expect-error a string is not a FamilyContract
      parseStream('ExecutionRun', ['{"type":"run_end"}']);
    expect(typeof unfamilied).toBe('function');
  });
});
