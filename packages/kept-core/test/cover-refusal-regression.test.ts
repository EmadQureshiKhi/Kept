import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ASSURANCE_STATUSES,
  NDJSON_CRASHED_DIAGNOSTIC_CODE,
  contractFor,
  createDiagnosticSink,
  exitMeaning,
  parseStream,
  type AssuranceDoneEvent,
  type AssuranceStatus,
} from '@kept/core';

/**
 * The `cover` refusal regression (task 2.16, R2.7, R2.8, R3.22, design §5.3.1).
 *
 * `packages/kept-core/test/fixtures/assurance-cover-refused.ndjson` is the
 * captured stdout of a real `kane-cli cover --json --mode agent` run in a
 * directory with no `.context/` store: two lines, an `error` carrying Kane's own
 * remedy and a terminal `done` with `status: "refused"` and `exit_code: 2`.
 *
 * The regression this file exists to prevent is a one-word mistake with a
 * disproportionate cost. `done` **arrived**, so the parser knows exactly what
 * happened: the user has not ingested any sources yet. That is a `complete`
 * stream. Read as `crashed`, it becomes "Kane crashed, outcome unknown" — the
 * remedy in Kane's `message` never reaches the Ledger's `/runs` page, and a
 * perfectly diagnosable setup step reads as a tool failure. R2.7 reserves the
 * crashed classification for a stream that lacks `done` entirely, and this
 * stream is the discriminator for that boundary.
 *
 * The second thing pinned here is the separation R3.14 requires. The event
 * carries its **own** `exit_code`, and the operating-system process carries one
 * too. Both are 2 in this envelope, which is exactly why they are easy to
 * conflate and worth keeping visibly apart: the event's value is read out of the
 * stream, the process's value goes through `exitMeaning()`, and no code path
 * substitutes one for the other. `exitMeaning('Assurance', 2, false)` is the
 * generic `failure` — the *reason* is in `done.status`, never in the exit code.
 *
 * Values are read from the fixture, never restated. `expect(...).toEqual(...)`
 * against the independently decoded lines is what makes this a pin rather than a
 * paraphrase, and it is why the `message` assertion is verbatim by construction.
 *
 * ### The deliberate hole: `degradedReason`
 *
 * Design §5.3 maps this observation to `degradedReason: 'assurance-status:refused'`
 * and §5.3.1 restates it. That mapping is owned by the **EnrichmentProvider**
 * (`src/providers/enrichment.ts`, task 3.7), which does not exist yet — nothing
 * in `@kept/core` today produces a `degradedReason` at all. Asserting the string
 * here would put the mapping in a test file and hand task 3.7 a second source of
 * truth to disagree with, so this file stops one step short: it pins every
 * **input** that mapping consumes (a `complete` stream, `status === 'refused'`,
 * the event's exit code, the process exit meaning, the verbatim message) and
 * asserts that the observed status is not the one §5.3 accepts. Task 3.7 closes
 * the hole by asserting `ok === false` and the reason string against this same
 * fixture.
 */

const REFUSAL_FIXTURE = new URL('./fixtures/assurance-cover-refused.ndjson', import.meta.url);
const REFUSAL_REPO_PATH =
  'packages/kept-core/test/fixtures/assurance-cover-refused.ndjson';

/** The one `done.status` §5.3 accepts. Everything else degrades the build. */
const ACCEPTED_STATUS: AssuranceStatus = 'complete';

/**
 * The **process** exit code of the recorded run, verified in §5.3.1. Kept in its
 * own named constant so that every use below is unmistakably the process's
 * value and never the event's — the two are read from different places on
 * purpose.
 */
const RECORDED_PROCESS_EXIT_CODE = 2;

const rawLines = readFileSync(REFUSAL_FIXTURE, 'utf8').split('\n');

/** The fixture's lines, decoded without the parser's help. */
const recordedObjects = rawLines
  .filter((line) => line.trimStart().startsWith('{'))
  .map((line) => JSON.parse(line) as Record<string, unknown>);

const recordedError = recordedObjects.at(0);
const recordedDone = recordedObjects.at(-1);

const sink = createDiagnosticSink();
const parsed = parseStream(contractFor('Assurance'), rawLines, {
  sink,
  file: REFUSAL_REPO_PATH,
});

describe('the captured refusal envelope is still two lines (§5.3.1)', () => {
  it('is an error line followed by a terminal done line', () => {
    expect(recordedObjects).toHaveLength(2);
    expect(recordedError?.['type']).toBe('error');
    expect(recordedDone?.['type']).toBe(contractFor('Assurance').terminalType);
    // Every Assurance event carries the envelope, confirmed rather than assumed.
    for (const event of recordedObjects) {
      expect(event['v']).toBe(1);
      expect(event['verb']).toBe('cover');
    }
  });
});

describe('a refusal is a complete stream, not a crashed one (R2.7, R2.8)', () => {
  it('classifies as complete, because done arrived', () => {
    // `crashed` here is the regression: it would turn "you have not ingested any
    // sources yet" into "Kane crashed" and lose the remedy below.
    expect(parsed.kind).toBe('complete');
    expect(sink.has(NDJSON_CRASHED_DIAGNOSTIC_CODE)).toBe(false);
    expect(parsed.diagnostics).toEqual([]);
    expect(sink.size).toBe(0);
  });

  it('exposes status refused off the terminal event (R3.22)', () => {
    if (parsed.kind !== 'complete') throw new Error('expected a complete stream');
    const terminal: AssuranceDoneEvent = parsed.terminal;

    expect(terminal.status).toBe('refused');
    // An observed value, not merely a documented one — so the vocabulary the
    // parser exposes has to contain it.
    expect(ASSURANCE_STATUSES).toContain('refused');
    expect(terminal).toEqual(recordedDone);
    // §5.3 acceptance requires `complete`; this is the failing side of that gate.
    expect(terminal.status).not.toBe(ACCEPTED_STATUS);
  });

  it('would be crashed if done had never arrived — the boundary R2.7 draws', () => {
    // The same capture with its terminal line dropped — identified by decoding
    // each line rather than by string matching. Nothing else changes and the
    // classification flips, which is the whole distinction between "there is no
    // context store" and "the outcome is unknown".
    const withoutDone = rawLines.filter((line) => {
      if (!line.trimStart().startsWith('{')) return true;
      return (JSON.parse(line) as Record<string, unknown>)['type'] !== 'done';
    });
    expect(withoutDone.filter((line) => line.trimStart().startsWith('{'))).toHaveLength(1);

    const crashed = parseStream(contractFor('Assurance'), withoutDone);
    expect(crashed.kind).toBe('crashed');
    if (crashed.kind !== 'crashed') return;
    expect(crashed.expectedTerminal).toBe('done');
    expect(crashed.diagnostics[0]?.code).toBe(NDJSON_CRASHED_DIAGNOSTIC_CODE);
    // The error event is still retained; only the outcome is now unknown.
    expect(crashed.events).toHaveLength(1);
  });
});

describe('the event exit code and the process exit code stay separate (R3.14)', () => {
  it('reads the event’s own exit code out of the stream', () => {
    if (parsed.kind !== 'complete') throw new Error('expected a complete stream');
    const terminal: AssuranceDoneEvent = parsed.terminal;
    // Read from the event, decoded independently of the parser. Never routed
    // through `exitMeaning()`, which interprets the *process*.
    expect(terminal.exit_code).toBe(recordedDone?.['exit_code']);
    expect(terminal.exit_code).toBe(2);
  });

  it('interprets the process exit code as a generic failure', () => {
    // Assurance exit 2 is `failure`, full stop — not `preflight-rejected` (that
    // is `testrun run`'s 2) and not a refusal-specific meaning. The reason lives
    // in `done.status`, which is why both halves are needed to describe this run.
    expect(exitMeaning('Assurance', RECORDED_PROCESS_EXIT_CODE, false)).toBe('failure');
  });

  it('never lets one value stand in for the other', () => {
    if (parsed.kind !== 'complete') throw new Error('expected a complete stream');
    const eventExitCode = parsed.terminal.exit_code;

    // The two happen to agree in this envelope, which is precisely the trap.
    // Move the process code alone and the meaning moves with it while the
    // event's value does not budge — so nothing downstream can be reading the
    // event's `exit_code` as the process's.
    expect(exitMeaning('Assurance', 3, false)).toBe('paused-resumable');
    expect(exitMeaning('Assurance', 0, false)).toBe('success');
    expect(exitMeaning('Assurance', RECORDED_PROCESS_EXIT_CODE, true)).toBe('killed-by-timeout');
    expect(parsed.terminal.exit_code).toBe(eventExitCode);
  });
});

describe('Kane’s own remedy survives the trip verbatim', () => {
  it('retains the error event with its message unaltered', () => {
    expect(parsed.events).toHaveLength(2);
    const error = parsed.events.at(0);
    expect(error).toEqual(recordedError);

    const message: unknown = error?.['message'];
    // Verbatim by construction: compared against the bytes on disk, never
    // against a paraphrase written here.
    expect(message).toBe(recordedError?.['message']);
    expect(typeof message).toBe('string');
    // And it is the actionable half — the reviewer is told what to run.
    expect(message as string).toContain('no context store');
    expect(message as string).toContain('context ingest');
  });

  it('leaves the whole envelope available for a diagnostic to quote', () => {
    // Task 3.7 builds `degradedReason: assurance-status:refused` and a
    // diagnostic quoting this message. Both inputs it needs are here, on a
    // stream classified `complete`.
    if (parsed.kind !== 'complete') throw new Error('expected a complete stream');
    expect(parsed.family).toBe('Assurance');
    expect(parsed.terminal.status).toBe('refused');
    expect(parsed.events.some((event) => typeof event['message'] === 'string')).toBe(true);
    // Nothing was projected or dropped: no coverage payload arrived, so the
    // enrichment axes have nothing to read even before the status is consulted.
    expect(parsed.coverage).toBeNull();
    expect(parsed.progress).toEqual([]);
    expect(parsed.unknown).toEqual([]);
  });
});
