import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  PROGRESS_KEY,
  RESULT_CODE_FIELD,
  contractFor,
  createDiagnosticSink,
  credits,
  isKnownEventType,
  parseStream,
  resultCode,
  type RunEndEvent,
} from '@kept/core';

/**
 * The pinned smoke-run regression (task 2.15, R3.25).
 *
 * Every other NDJSON test in this package feeds the parser something a human
 * wrote — fixtures authored to a shape we believe Kane emits. This one does not.
 * It reads `docs/kane/smoke-run.ndjson`, the twelve-line stdout of a real
 * `kane-cli run --agent` invocation against example.com, and asserts the parser
 * against **what is actually in that file**. It is therefore the only test in
 * the repo that can fail because reality disagrees with our model of it, rather
 * than because our model disagrees with itself.
 *
 * Nothing is restated inline. Expected values are computed from the bytes on
 * disk: the line count, the type sequence, the terminal event and both typings
 * of the result code all come from `JSON.parse` of the file's own lines. A
 * regression here means either the parser changed or the recording changed, and
 * the recording is read-only (`scripts/check-readonly.mjs` guards it).
 *
 * Three facts are load-bearing, in the order R3.25 states them:
 *
 * 1. **All twelve lines parse.** Eight of them are the untyped
 *    `{step, status, remark}` progress objects — `run_start`, `step_start` and
 *    `step_end` do not exist in 0.8.4, so there is no `type` to classify those
 *    lines by and classification has to be structural (R3.8).
 * 2. **`run_end` is identified as the terminal event**, which is what makes the
 *    stream `complete` and its outcome readable at all.
 * 3. **Zero diagnostics.** Asserted through a collecting sink as well as on the
 *    result, because a real recorded stream that produces a diagnostic means the
 *    parser is wrong about reality, not that the run went badly.
 *
 * The fourth fact is the one that justifies `kane/coerce.ts` existing: this
 * single event carries the result code as a **number** at the top level and as a
 * **string** inside `per_flow_metadata[0]`. Both read to the same value through
 * `resultCode()`, and a comparison against either raw typing would silently
 * never fire on the other (source scan 1 of 6 bans writing one).
 */

/** The recording named by R3.25. Read-only to this test and to everything else. */
const SMOKE_RUN = new URL('../../../docs/kane/smoke-run.ndjson', import.meta.url);

/** Repository-relative path, so a diagnostic (if one ever appeared) is attributable. */
const SMOKE_RUN_REPO_PATH = 'docs/kane/smoke-run.ndjson';

/** The counts R3.25 pins. Drift in either direction is a regression, not a rebase. */
const RECORDED_JSON_LINES = 12;
const RECORDED_PROGRESS_LINES = 8;

/**
 * Event types this stream carries that appear in **no** Kane documentation — not
 * in the skill reference, not in the CLI help. Their presence is why the event
 * vocabulary is open and why retention is never gated on recognition (R3.9).
 */
const UNDOCUMENTED_TYPES = ['recording_state', 'skill_update_available'] as const;

/** Raw lines, exactly as the file carries them, trailing newline included. */
const rawLines = readFileSync(SMOKE_RUN, 'utf8').split('\n');

/** The same lines the parser will treat as events, decoded independently of it. */
const recordedObjects = rawLines
  .filter((line) => line.trimStart().startsWith('{'))
  .map((line) => JSON.parse(line) as Record<string, unknown>);

const sink = createDiagnosticSink();
const parsed = parseStream(contractFor('ExecutionRun'), rawLines, {
  sink,
  file: SMOKE_RUN_REPO_PATH,
});

describe('the recorded smoke run is still what the parser thinks it is', () => {
  it('is a twelve-line stream on disk, eight of them untyped progress lines', () => {
    expect(recordedObjects).toHaveLength(RECORDED_JSON_LINES);
    expect(
      recordedObjects.filter((event) => Object.hasOwn(event, PROGRESS_KEY)),
    ).toHaveLength(RECORDED_PROGRESS_LINES);
  });

  it('still carries both undocumented event types', () => {
    const types = recordedObjects.map((event) => event['type']);
    for (const type of UNDOCUMENTED_TYPES) expect(types).toContain(type);
  });
});

describe('the recorded smoke run parses as an ExecutionRun stream (R3.25)', () => {
  it('reaches its terminal run_end event, so the outcome is readable', () => {
    expect(parsed.kind).toBe('complete');
    if (parsed.kind !== 'complete') throw new Error('expected a complete stream');

    const terminal: RunEndEvent = parsed.terminal;
    expect(terminal.type).toBe(contractFor('ExecutionRun').terminalType);
    expect(terminal.status).toBe('passed');
    // Identified, not assumed: the terminal field is the last recorded line,
    // decoded here without the parser's help.
    expect(terminal).toEqual(recordedObjects.at(-1));
    // And it is still in `events` — nothing is ever moved out of the stream.
    expect(parsed.events.at(-1)).toBe(parsed.terminal);
  });

  it('records zero diagnostics, on the result and in the sink', () => {
    // The whole point of the pin. A real recorded stream must parse cleanly; a
    // diagnostic here says the parser mismodels Kane, not that the run failed.
    expect(parsed.diagnostics).toEqual([]);
    expect(sink.size).toBe(0);
    expect(sink.entries).toEqual([]);
  });

  it('accounts for every JSON line exactly once (R3.1)', () => {
    expect(parsed.events.length + parsed.progress.length).toBe(recordedObjects.length);
    expect(parsed.progress).toHaveLength(RECORDED_PROGRESS_LINES);
    expect(parsed.events).toHaveLength(recordedObjects.length - RECORDED_PROGRESS_LINES);
    expect(parsed.progress.every((event) => Object.hasOwn(event, PROGRESS_KEY))).toBe(true);
    // Wire order is preserved across both views, read back against the file.
    expect(parsed.events.map((event) => event['type'])).toEqual(
      recordedObjects
        .filter((event) => !Object.hasOwn(event, PROGRESS_KEY))
        .map((event) => event['type']),
    );
  });

  it('retains the two undocumented event types rather than dropping them (R3.9)', () => {
    const retained = parsed.events.map((event) => event['type']);
    for (const type of UNDOCUMENTED_TYPES) {
      expect(retained).toContain(type);
      // Retention is unconditional; recognition only decides which view the
      // event *also* appears in. Both of these happen to be recognised, so
      // `unknown` is empty here — retention is not what covers them.
      expect(isKnownEventType(type)).toBe(true);
    }
    expect(parsed.unknown).toEqual([]);
  });

  it('exposes no other family’s views off this stream', () => {
    expect(parsed.family).toBe('ExecutionRun');
    expect(parsed.members).toEqual([]);
    expect(parsed.plan).toBeNull();
    expect(parsed.coverage).toBeNull();
  });
});

describe('the result code reads the same through both of Kane’s typings', () => {
  it('is one value, carried twice, typed inconsistently in one event', () => {
    if (parsed.kind !== 'complete') throw new Error('expected a complete stream');
    const terminal: RunEndEvent = parsed.terminal;
    const flow = terminal.per_flow_metadata?.[0];
    expect(flow).toBeDefined();

    // Read the raw field off both sites without comparing it to anything: the
    // types differ, which is the fact being pinned.
    const topLevelRaw: unknown = terminal[RESULT_CODE_FIELD];
    const nestedRaw: unknown = flow?.[RESULT_CODE_FIELD];
    expect(typeof topLevelRaw).toBe('number');
    expect(typeof nestedRaw).toBe('string');

    // Through the coercing accessor the two agree, which is what every consumer
    // downstream depends on.
    const topLevel = resultCode(terminal);
    const nested = resultCode(flow);
    expect(topLevel).not.toBeNull();
    expect(topLevel).toBe(nested);
    // And the value is the one the recording carries, decoded independently.
    expect(topLevel).toBe(resultCode(recordedObjects.at(-1)));
  });

  it('reads the fractional credit figure off both sites too (R3.10)', () => {
    if (parsed.kind !== 'complete') throw new Error('expected a complete stream');
    const terminal: RunEndEvent = parsed.terminal;
    const consumed = credits(terminal);
    expect(consumed).not.toBeNull();
    // Fractional is the norm, not an edge case, and nothing is rounded.
    expect(Number.isInteger(consumed)).toBe(false);
    expect(consumed).toBe(credits(terminal.per_flow_metadata?.[0]));
  });
});
