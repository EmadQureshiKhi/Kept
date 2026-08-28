import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  NDJSON_CRASHED_DIAGNOSTIC_CODE,
  NDJSON_PARSE_DIAGNOSTIC_CODE,
  NDJSON_SNIPPET_LENGTH,
  PROGRESS_KEY,
  contractFor,
  isKnownEventType,
  parseStream,
  type CommandFamily,
  type Diagnostic,
  type KaneEvent,
} from 'kept-core';

import {
  arbFamily,
  arbKaneEvent,
  arbMalformedLine,
  arbNoisyPrefix,
  arbStream,
  arbTerminalEvent,
  arbTruncatedStream,
} from './arbitraries.js';

/**
 * Feature: kept, Property 7: Parsing is robust and lossless per line
 * (design §Correctness Properties, §4.3; R3.1, R3.8, R3.9, R3.23, R3.24).
 *
 * *For any* sequence of lines consisting of arbitrary non-`{` prefix lines,
 * well-formed JSON lines and malformed lines, the parser emits exactly one event
 * per line that parsed as JSON, records no diagnostic for the leading prefix
 * lines, records exactly one diagnostic carrying the correct one-based line
 * number for each malformed line after the first `{` line, classifies every
 * event carrying a `step` key as a progress event, retains every event whose
 * `type` is outside the known set as an unknown-type event, and continues
 * processing all subsequent lines in every case.
 *
 * ## How the six clauses are encoded
 *
 * Every clause is stated over a **labelled** stream: the generator builds each
 * line together with the label of what that line is, so an expectation is known
 * *by construction* rather than re-derived by a second copy of the classifier.
 * The only ground truth the labeller consults is `JSON.parse` itself and the
 * presence of the `PROGRESS_KEY` own-key — which is exactly what R3.1 and R3.8
 * are written in terms of, and neither is code under test.
 *
 * | clause | encoding |
 * |---|---|
 * | one event per JSON line | `events.length + progress.length` equals the labelled object-line count |
 * | no diagnostic for leading prefix | no diagnostic carries a line number inside the prefix block |
 * | one diagnostic, correct one-based number, per malformed line | the `ndjson-parse` line numbers deep-equal the labelled malformed positions, in order |
 * | `step` key ⇒ progress | `progress` deep-equals the labelled progress values in order, and no event in `events` carries the key |
 * | unrecognised `type` retained | `unknown` deep-equals the labelled unknown-type values in order, and each is *also* in `events` by identity |
 * | continues in every case | a terminal event behind an arbitrary wall of malformed lines is still reached |
 *
 * ## The subtlety in "one event per line that parsed as JSON"
 *
 * A JSON scalar, `null` or an array is well-formed JSON and is **not** an
 * event. `kane/ndjson.ts` diagnoses such a line under the same
 * `ndjson-parse` code as a syntax error and produces nothing, so a count taken
 * over lines that "parsed as JSON" would be wrong by exactly the number of
 * those lines — and `arbMalformedLine` has a whole arm that generates them
 * (`42`, `null`, `[1,2,3]`). The count identity below is therefore stated over
 * lines that parse **to an object**, which is what §4.3's own sentence means and
 * what the parser implements: admitting a scalar would put a number in `events`
 * typed as a `KaneEvent`.
 *
 * Losslessness is asserted positively as well as by count: `unknown`,
 * `members`, `plan` and `coverage` are *views* into `events`, so each is checked
 * to be present in `events` by reference identity. Nothing is moved out of the
 * stream.
 *
 * **Validates: Requirements 3.1, 3.8, 3.9, 3.23, 3.24**
 */

/** Design §Testing Strategy floor is 100 runs; stated so it cannot regress to a default. */
const NUM_RUNS = 500;

/** Own-key test, safe on any parsed value. */
function hasOwn(source: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

/** What a body line is. The labels the whole suite predicts from. */
type LineKind = 'prefix' | 'blank' | 'unparseable' | 'non-object' | 'progress' | 'event';

interface LineCase {
  readonly kind: LineKind;
  readonly line: string;
  /** The wire value, for the two object kinds. Null otherwise. */
  readonly value: Record<string, unknown> | null;
}

/** Kinds that put exactly one entry into `events` or `progress`. */
const OBJECT_KINDS: readonly LineKind[] = ['progress', 'event'];

/** Kinds that cost exactly one `ndjson-parse` diagnostic when past the prefix. */
const DIAGNOSED_KINDS: readonly LineKind[] = ['unparseable', 'non-object'];

/**
 * Label a line as it will be seen **after** the prefix fence has been crossed.
 *
 * `JSON.parse` and an own-key test are the only two things consulted, and both
 * are the vocabulary R3.1 and R3.8 are written in. Nothing here re-implements
 * classification: which bucket an object lands in is a one-key question, and
 * whether a line is JSON at all is the JSON grammar's business, not the
 * parser's.
 */
function bodyCase(line: string): LineCase {
  if (line.trim().length === 0) return { kind: 'blank', line, value: null };
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { kind: 'unparseable', line, value: null };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { kind: 'non-object', line, value: null };
  }
  const record = value as Record<string, unknown>;
  const kind: LineKind = hasOwn(record, PROGRESS_KEY) ? 'progress' : 'event';
  return { kind, line, value: record };
}

/** A labelled stream: the lines, and the truth about every one of them. */
interface LabelledStream {
  readonly family: CommandFamily;
  /** Lines before the first `{` line. Every one must be skipped silently. */
  readonly prefix: readonly string[];
  /** Body lines, in order. The first is always an object line. */
  readonly body: readonly LineCase[];
  /** What `parseStream` is handed: prefix followed by body. */
  readonly lines: readonly string[];
}

/** The wire line for an event. */
function eventLine(event: KaneEvent): string {
  return JSON.stringify(event);
}

/** Blank-after-trim lines, which are skipped silently wherever they sit. */
const arbBlankLine: fc.Arbitrary<string> = fc.constantFrom('', '   ', '\t', ' \t ');

/**
 * One body line: a Kane event, a malformed line, or a blank one.
 *
 * Malformed lines are weighted heavily enough that most streams carry one, since
 * "records exactly one diagnostic per malformed line" and "continues processing"
 * are the two clauses that are vacuous without them.
 */
const arbBodyLine: fc.Arbitrary<LineCase> = fc
  .oneof(
    { weight: 5, arbitrary: arbKaneEvent.map(eventLine) },
    { weight: 3, arbitrary: arbMalformedLine },
    { weight: 1, arbitrary: arbBlankLine },
  )
  .map(bodyCase);

/**
 * A labelled stream over the three line categories the property names.
 *
 * The body always **opens with a real event line**, which is what makes every
 * label position-independent: the opener is the line that crosses the
 * `seenFirstBrace` fence, so no later body line can be swallowed by the
 * leading-noise rule and relabelled. Without that anchor a generated blank or
 * malformed line at position one would be a *prefix* line, and the generator
 * would be claiming a case it had not produced.
 */
const arbLabelledStream: fc.Arbitrary<LabelledStream> = fc
  .record({
    family: arbFamily,
    prefix: fc.array(arbNoisyPrefix, { maxLength: 3 }),
    opener: arbKaneEvent,
    rest: fc.array(arbBodyLine, { maxLength: 8 }),
  })
  .map((seed): LabelledStream => {
    const body = [bodyCase(eventLine(seed.opener)), ...seed.rest];
    return {
      family: seed.family,
      prefix: seed.prefix,
      body,
      lines: [...seed.prefix, ...body.map((entry) => entry.line)],
    };
  });

/** The labelled body lines of a kind, in wire order. */
function casesOfKind(stream: LabelledStream, kinds: readonly LineKind[]): LineCase[] {
  return stream.body.filter((entry) => kinds.includes(entry.kind));
}

/** One-based line numbers of the body lines of a kind, in wire order. */
function lineNumbersOfKind(stream: LabelledStream, kinds: readonly LineKind[]): number[] {
  const offset = stream.prefix.length;
  return stream.body
    .map((entry, index) => ({ entry, number: offset + index + 1 }))
    .filter(({ entry }) => kinds.includes(entry.kind))
    .map(({ number }) => number);
}

/** The snippet a diagnostic quotes: whitespace collapsed, bounded by the constant. */
function collapsedSnippet(line: string): string {
  const flat = line.trim().replace(/\s+/gu, ' ');
  return flat.slice(0, Math.min(flat.length, NDJSON_SNIPPET_LENGTH));
}

/** Diagnostics carrying the parse code, in report order. */
function parseDiagnostics(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  return diagnostics.filter((entry) => entry.code === NDJSON_PARSE_DIAGNOSTIC_CODE);
}

/** Parse a labelled stream against the family it was drawn for. */
function parseLabelled(stream: LabelledStream) {
  return parseStream(contractFor(stream.family), stream.lines);
}

describe('Feature: kept, Property 7: Parsing is robust and lossless per line', () => {
  it('generates every line kind, so no clause below is vacuous', () => {
    // The shared module's self-test proves *its* generators reach their named
    // cases; this file composes them into a new shape, and a composition can lose
    // an arm to a weight or a filter. Every clause below is conditional on the
    // kind it names, so an arm that never appeared would make a clause pass by
    // never being tested.
    const reached = new Set<LineKind>();
    for (const stream of fc.sample(arbLabelledStream, 300)) {
      if (stream.prefix.length > 0) reached.add('prefix');
      for (const entry of stream.body) reached.add(entry.kind);
    }
    const kinds: readonly LineKind[] = [
      'prefix',
      'blank',
      'unparseable',
      'non-object',
      'progress',
      'event',
    ];
    for (const kind of kinds) expect(reached.has(kind), `never generated: ${kind}`).toBe(true);
  });

  it('emits exactly one event per line that parsed to a JSON object (R3.1)', () => {
    fc.assert(
      fc.property(arbLabelledStream, (stream) => {
        const parsed = parseLabelled(stream);
        const objectLines = casesOfKind(stream, OBJECT_KINDS).length;

        // The spine of the property. `events` and `progress` are disjoint and
        // jointly exhaustive over the object lines, so their sizes add up to
        // exactly that count — never to the number of lines that parsed as JSON,
        // because a scalar or an array parses and is still not an event.
        expect(parsed.events.length + parsed.progress.length).toBe(objectLines);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('records no diagnostic for any leading prefix line (R3.23)', () => {
    fc.assert(
      fc.property(arbLabelledStream, (stream) => {
        const parsed = parseLabelled(stream);
        for (const diagnostic of parsed.diagnostics) {
          // The crash diagnostic carries no line at all; every other diagnostic
          // must point past the prefix block. Kane's banners are chatter, and
          // diagnosing them would bury the diagnostics that matter.
          if (diagnostic.line === null) continue;
          expect(diagnostic.line).toBeGreaterThan(stream.prefix.length);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is completely silent on a stream that is nothing but prefix lines (R3.23)', () => {
    fc.assert(
      fc.property(arbFamily, fc.array(arbNoisyPrefix, { maxLength: 6 }), (family, prefix) => {
        const parsed = parseStream(contractFor(family), prefix);
        expect(parsed.events).toEqual([]);
        expect(parsed.progress).toEqual([]);
        // The only thing recorded is the crash itself: no line ever reached the
        // JSON grammar, so nothing can have failed it.
        expect(parseDiagnostics(parsed.diagnostics)).toEqual([]);
        expect(parsed.diagnostics.map((entry) => entry.code)).toEqual([
          NDJSON_CRASHED_DIAGNOSTIC_CODE,
        ]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('records exactly one diagnostic per malformed line, with its one-based number (R3.24)', () => {
    fc.assert(
      fc.property(arbLabelledStream, (stream) => {
        const parsed = parseLabelled(stream);
        const diagnostics = parseDiagnostics(parsed.diagnostics);
        const expectedNumbers = lineNumbersOfKind(stream, DIAGNOSED_KINDS);

        // One each, in wire order, numbered over the *raw* input — skipped
        // prefix and blank lines still count towards the number, which is the
        // whole point of quoting one: a reviewer has to be able to find the line.
        expect(diagnostics.map((entry) => entry.line)).toEqual(expectedNumbers);

        const malformed = casesOfKind(stream, DIAGNOSED_KINDS);
        diagnostics.forEach((diagnostic, index) => {
          const number = expectedNumbers[index];
          expect(diagnostic.severity).toBe('warn');
          expect(diagnostic.message).toContain(`line ${String(number)}`);
          expect(diagnostic.message).toContain('parsing continued');
          const source = malformed[index];
          expect(source).toBeDefined();
          if (source !== undefined) {
            expect(diagnostic.message).toContain(collapsedSnippet(source.line));
          }
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('classifies every event carrying a step key as progress, and nothing else (R3.8)', () => {
    fc.assert(
      fc.property(arbLabelledStream, (stream) => {
        const parsed = parseLabelled(stream);

        // Deep equality in wire order: the same values, in the same sequence.
        expect(parsed.progress).toEqual(
          casesOfKind(stream, ['progress']).map((entry) => entry.value),
        );
        expect(parsed.events).toEqual(casesOfKind(stream, ['event']).map((entry) => entry.value));

        // And the two buckets are disjoint by construction as well as by count:
        // no object is in both, so nothing is double-counted in the identity above.
        for (const event of parsed.events) expect(hasOwn(event, PROGRESS_KEY)).toBe(false);
        for (const entry of parsed.progress) expect(hasOwn(entry, PROGRESS_KEY)).toBe(true);
        for (const event of parsed.events) expect(parsed.progress).not.toContain(event);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('retains every event whose type is outside the known set (R3.9)', () => {
    fc.assert(
      fc.property(arbLabelledStream, (stream) => {
        const parsed = parseLabelled(stream);
        const expectedUnknown = casesOfKind(stream, ['event'])
          .map((entry) => entry.value)
          .filter((value) => value !== null && !isKnownEventType(value['type']));

        expect(parsed.unknown).toEqual(expectedUnknown);

        // Retained, not relocated: recognition never gates retention, so every
        // unknown-type event is *also* in `events`, by reference identity.
        for (const event of parsed.unknown) {
          expect(parsed.events.some((candidate) => candidate === event)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('exposes every typed view as a view into events, never as a removal from it', () => {
    fc.assert(
      fc.property(arbLabelledStream, (stream) => {
        const parsed = parseLabelled(stream);
        const isInEvents = (candidate: KaneEvent): boolean =>
          parsed.events.some((event) => event === candidate);

        for (const member of parsed.members) expect(isInEvents(member)).toBe(true);
        if (parsed.plan !== null) expect(isInEvents(parsed.plan)).toBe(true);
        if (parsed.coverage !== null) expect(isInEvents(parsed.coverage)).toBe(true);
        if (parsed.kind === 'complete') expect(isInEvents(parsed.terminal)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('continues past every malformed line and still reaches the terminal event (R3.24)', () => {
    /** A family, its terminal event, and a wall of unreadable lines either side. */
    const arbWalledStream = arbFamily.chain((family) =>
      fc
        .record({
          terminal: arbTerminalEvent(family),
          before: fc.array(arbMalformedLine, { minLength: 1, maxLength: 6 }),
          after: fc.array(arbMalformedLine, { minLength: 1, maxLength: 6 }),
        })
        .map((parts) => ({ family, ...parts })),
    );

    fc.assert(
      fc.property(arbWalledStream, ({ family, terminal, before, after }) => {
        const opener = '{"type":"recording_state","enabled":true}';
        const lines = [opener, ...before, eventLine(terminal), ...after];
        const parsed = parseStream(contractFor(family), lines);

        // Unreadable lines on both sides of the verdict, and the verdict is
        // still read: nothing aborts the parse, in either direction.
        expect(parsed.kind).toBe('complete');
        expect(parseDiagnostics(parsed.diagnostics)).toHaveLength(before.length + after.length);
        expect(parsed.events).toHaveLength(2);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('holds every clause over the shared complete and truncated stream generators', () => {
    fc.assert(
      fc.property(
        arbFamily.chain((family) =>
          fc.oneof(arbStream(family), arbTruncatedStream(family)).map((stream) => ({
            family,
            stream,
          })),
        ),
        ({ family, stream }) => {
          const cases = stream.lines.map(bodyCase);
          const parsed = parseStream(contractFor(family), stream.lines);

          // The count identity again, this time over streams built by the shared
          // module rather than by this file — so a divergence between the two
          // shapes of generated stream fails here rather than silently.
          const objectLines = cases.filter(
            (entry, index) =>
              OBJECT_KINDS.includes(entry.kind) && index >= firstBraceIndex(stream.lines),
          ).length;
          expect(parsed.events.length + parsed.progress.length).toBe(objectLines);

          for (const diagnostic of parsed.diagnostics) {
            if (diagnostic.line === null) continue;
            expect(diagnostic.line).toBeGreaterThan(0);
            expect(diagnostic.line).toBeLessThanOrEqual(stream.lines.length);
            // The quoted line is the line the number points at.
            const quoted = stream.lines[diagnostic.line - 1];
            expect(quoted).toBeDefined();
            if (quoted !== undefined) {
              expect(diagnostic.message).toContain(collapsedSnippet(quoted));
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

/**
 * Index of the first line whose trimmed form opens an object — the prefix fence.
 * Lines before it are skipped silently whatever they contain, so a count over a
 * stream this file did not build has to respect it (R3.23).
 */
function firstBraceIndex(lines: readonly string[]): number {
  const index = lines.findIndex((line) => line.trimStart().startsWith('{'));
  return index === -1 ? lines.length : index;
}
