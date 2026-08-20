import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  CREDITS_FIELDS,
  KNOWN_EVENT_TYPES,
  MEMBER_END_STATUSES,
  RESULT_CODE_FIELD,
  TRIAGE_SIGNAL_FIELDS,
  citedLine,
  contractFor,
  credits,
  isCitationPathSafe,
  isLedgerSnapshot,
  lineCount,
  loadFailureYaml,
  parseStream,
  resultCode,
  type CommandFamily,
} from '@kept/core';

import {
  arbCitation,
  arbCreditsSlot,
  arbDoc,
  arbFailureYaml,
  arbGraphCase,
  arbKaneEvent,
  arbMalformedLine,
  arbMemberStatus,
  arbNoisyPrefix,
  arbResultCodeSlot,
  arbSnapshot,
  arbStoreSourceListing,
  arbStream,
  arbTerminalEvent,
  arbTruncatedStream,
  citationSourceFor,
  creditsWire,
  expectedCredits,
  type StoreListingFeature,
} from './arbitraries.js';

/**
 * The self-test for `test/arbitraries.ts` (design §Testing Strategy, R3.1, R3.10,
 * R3.13).
 *
 * A shared generator module is worth exactly as much as its coverage of the cases
 * the design says the system breaks on, and "could reach it in principle" is not
 * coverage: a generator that produces `" 740"` once in a million draws has not
 * produced it. So every one of the twelve named edge cases is asserted **reachable
 * within a bounded number of draws** here, and several are additionally checked
 * against the real accessor or parser rather than against the generator's own
 * label — a generator that lies about what it produced is the failure mode this
 * file exists to catch.
 *
 * The sample seed is fixed. That is deliberate: a coverage assertion that flakes
 * is a coverage assertion that gets deleted, and the draw counts below are an order
 * of magnitude above what each weighted arm needs anyway.
 *
 * **Validates: Requirements 3.1, 3.10, 3.13**
 */

const SAMPLE_RUNS = 600;
const SEED = 20_260_820;

function sample<T>(arb: fc.Arbitrary<T>, numRuns: number = SAMPLE_RUNS): T[] {
  return fc.sample(arb, { numRuns, seed: SEED });
}

/** Own-key test that is safe on a generated wire object. */
function has(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

const FAMILIES: readonly CommandFamily[] = ['ExecutionRun', 'ExecutionTestrun', 'Assurance'];

// ---------------------------------------------------------------------------
// Named cases 10 and 11: CRLF endings, and a doc with no trailing newline
// ---------------------------------------------------------------------------

describe('arbDoc reaches the byte-level document cases', () => {
  const docs = sample(arbDoc);

  it('produces CRLF documents and LF documents', () => {
    expect(docs.some((doc) => doc.eol === '\r\n' && doc.content.includes('\r\n'))).toBe(true);
    expect(docs.some((doc) => doc.eol === '\n' && !doc.content.includes('\r'))).toBe(true);
  });

  it('produces documents with and without a trailing newline', () => {
    expect(docs.some((doc) => doc.lineCount > 0 && !doc.content.endsWith('\n'))).toBe(true);
    expect(docs.some((doc) => doc.content.endsWith('\n'))).toBe(true);
  });

  it('knows every document’s citable line count by construction', () => {
    for (const doc of docs) {
      // The §3.3 rules, applied independently to the bytes: split on \n, drop a
      // single trailing empty element, strip the \r a CRLF terminator leaves.
      const parts = doc.content.split('\n');
      if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
      const recovered = parts.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
      expect(recovered).toEqual([...doc.lines]);
      expect(doc.lineCount).toBe(doc.lines.length);
    }
  });
});

// ---------------------------------------------------------------------------
// Named cases 8 and 9: a citation at EOF, one past it, and a whitespace line
// ---------------------------------------------------------------------------

describe('arbCitation reaches the citation boundary cases', () => {
  const cases = sample(arbCitation);

  it('cites a line exactly at EOF', () => {
    const atEof = cases.filter((c) => c.placement === 'at-eof' && c.doc.lineCount > 0);
    expect(atEof.length).toBeGreaterThan(0);
    for (const c of atEof) {
      expect(c.citation.line).toBe(c.doc.lineCount);
      expect(c.inRange).toBe(true);
      expect(c.citedLine).toBe(c.doc.lines[c.doc.lineCount - 1]);
    }
  });

  it('cites a line exactly one past EOF', () => {
    const past = cases.filter((c) => c.placement === 'one-past-eof');
    expect(past.length).toBeGreaterThan(0);
    for (const c of past) {
      expect(c.citation.line).toBe(c.doc.lineCount + 1);
      expect(c.inRange).toBe(false);
      expect(c.citedLine).toBeNull();
    }
  });

  it('cites a line containing only whitespace', () => {
    const blank = cases.filter((c) => c.placement === 'whitespace-line');
    expect(blank.length).toBeGreaterThan(0);
    for (const c of blank) {
      expect(c.citedLine).not.toBeNull();
      expect((c.citedLine ?? 'x').trim()).toBe('');
      expect(c.inRange).toBe(true);
    }
  });

  it('agrees with its own document map on what resolves and what does not', () => {
    for (const c of cases) {
      const content = c.documents[c.citation.file];
      const present = content !== undefined;
      expect(present).toBe(c.placement !== 'file-missing');
      expect(c.inRange).toBe(present && c.citation.line <= c.doc.lineCount);
      if (c.inRange) expect(c.citedLine).toBe(c.doc.lines[c.citation.line - 1]);
      // A citation is repo-relative POSIX with a one-based line, always.
      expect(c.citation.file.includes('\\')).toBe(false);
      expect(c.citation.line).toBeGreaterThanOrEqual(1);
    }
  });

  it('produces citations whose text both agrees and disagrees with the file', () => {
    expect(cases.some((c) => c.textAgrees)).toBe(true);
    expect(cases.some((c) => c.inRange && !c.textAgrees)).toBe(true);
  });

  it('agrees with the admission gate’s own line splitting, through its own reader', () => {
    // The generator knows each document's line count by construction; the gate
    // derives it from the bytes. If the two ever disagree, a citation property
    // built on this generator would be quietly testing the wrong boundary — so the
    // disagreement fails here instead.
    for (const c of cases) {
      const source = citationSourceFor(c);
      const content = source.read(c.citation.file);
      expect(content).toBe(c.documents[c.citation.file] ?? null);
      if (content === null) {
        expect(c.placement).toBe('file-missing');
        continue;
      }
      expect(lineCount(content)).toBe(c.doc.lineCount);
      expect(citedLine(content, c.citation.line)).toBe(c.citedLine);
      expect(isCitationPathSafe(c.citation.file)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Named cases 1 and 2: the empty graph, and zero `*_test.md` files
// ---------------------------------------------------------------------------

describe('arbGraph reaches the empty graph and the testless graph', () => {
  const cases = sample(arbGraphCase);

  it('produces the empty graph', () => {
    const empty = cases.filter((c) => c.kind === 'empty');
    expect(empty.length).toBeGreaterThan(0);
    for (const c of empty) expect(c.graph.promises).toHaveLength(0);
    // And the general generator reaches zero promises too, not only the labelled arm.
    expect(cases.some((c) => c.graph.promises.length === 0)).toBe(true);
  });

  it('produces a graph with promises and zero designed tests', () => {
    const testless = cases.filter(
      (c) =>
        c.graph.promises.length > 0 &&
        c.graph.promises.every((promise) => promise.designedTest === null),
    );
    expect(testless.length).toBeGreaterThan(0);
  });

  it('still produces graphs that do have designed tests, and degraded ones', () => {
    expect(
      cases.some((c) => c.graph.promises.some((promise) => promise.designedTest !== null)),
    ).toBe(true);
    expect(cases.some((c) => c.graph.degraded)).toBe(true);
    expect(cases.some((c) => !c.graph.degraded)).toBe(true);
  });
});

describe('arbSnapshot is schema-valid by construction', () => {
  const snapshots = sample(arbSnapshot, 300);

  it('produces only snapshots the schema accepts', () => {
    for (const snapshot of snapshots) {
      expect(isLedgerSnapshot(snapshot)).toBe(true);
    }
  });

  it('reaches the empty graph and the zero-test-file graph', () => {
    expect(snapshots.some((s) => s.metrics.totalPromises === 0)).toBe(true);
    expect(
      snapshots.some((s) => s.metrics.totalPromises > 0 && s.metrics.designedCount === 0),
    ).toBe(true);
    expect(snapshots.some((s) => s.metrics.designedCount > 0)).toBe(true);
  });

  it('derives every count from the promise list it carries', () => {
    for (const snapshot of snapshots) {
      expect(snapshot.metrics.totalPromises).toBe(snapshot.promises.length);
      expect(snapshot.metrics.designedCount).toBe(
        snapshot.promises.filter((promise) => promise.designedTest !== null).length,
      );
      const empty = snapshot.metrics.totalPromises === 0;
      expect(snapshot.metrics.designedCoverage === null).toBe(empty);
      expect(snapshot.metrics.provenCoverage === null).toBe(empty || snapshot.degraded);
    }
  });
});

// ---------------------------------------------------------------------------
// Named cases 3, 4 and 12: the padded bug code, the credits fallback, and an
// absent `session_dir`
// ---------------------------------------------------------------------------

describe('arbTerminalEvent reaches the wire-field cases, per family', () => {
  it('emits the right terminal type per family, and never a `step` key', () => {
    for (const family of FAMILIES) {
      const events = sample(arbTerminalEvent(family), 200);
      const expectedType: string = contractFor(family).terminalType;
      for (const event of events) {
        expect((event as Record<string, unknown>)['type']).toBe(expectedType);
        // Classification is `step`-key first, so a terminal event carrying one
        // would classify as progress and its stream would read crashed.
        expect(has(event, 'step')).toBe(false);
      }
    }
  });

  it('emits the result code as a number and as a string, including the padded bug code', () => {
    for (const family of FAMILIES) {
      const events = sample(arbTerminalEvent(family), 400);
      const wires = events.map((event) => (event as Record<string, unknown>)[RESULT_CODE_FIELD]);
      expect(wires.some((wire) => typeof wire === 'number')).toBe(true);
      expect(wires.some((wire) => typeof wire === 'string')).toBe(true);
      expect(wires.some((wire) => wire === undefined)).toBe(true);

      // The named case, and it is checked through the accessor rather than
      // through the generator's own label: the padded string has to coerce to the
      // confirmed-product-bug code, or the whole repair ladder never fires.
      const padded = events.filter(
        (event) => (event as Record<string, unknown>)[RESULT_CODE_FIELD] === ' 740',
      );
      expect(padded.length).toBeGreaterThan(0);
      for (const event of padded) expect(resultCode(event)).toBe(740);
    }
  });

  it('emits credits as `credits_consumed`, as `credits`, or as neither', () => {
    for (const family of FAMILIES) {
      const events = sample(arbTerminalEvent(family), 400);
      const [preferred, fallback] = CREDITS_FIELDS;

      expect(events.some((event) => has(event, preferred))).toBe(true);
      expect(events.some((event) => !has(event, preferred) && !has(event, fallback))).toBe(true);

      // The named case: the preferred field absent while the documented spelling
      // carries a readable number. R14.7's measured-credits evidence has to read
      // the same whichever name the recorded run happened to use.
      const fallbackOnly = events.filter(
        (event) => !has(event, preferred) && has(event, fallback),
      );
      expect(fallbackOnly.length).toBeGreaterThan(0);
      expect(fallbackOnly.some((event) => credits(event) !== null)).toBe(true);
    }
  });

  it('omits `session_dir` from some `run_end` events, and carries it in others', () => {
    const events = sample(arbTerminalEvent('ExecutionRun'), 400);
    expect(events.some((event) => !has(event, 'session_dir'))).toBe(true);
    expect(events.some((event) => has(event, 'session_dir'))).toBe(true);
    // And the observed inconsistency is generated: the string form of the code
    // one level down, inside per-flow metadata.
    expect(
      events.some((event) => {
        const flows = (event as Record<string, unknown>)['per_flow_metadata'];
        if (!Array.isArray(flows)) return false;
        const first = flows[0] as Record<string, unknown> | undefined;
        return typeof first?.[RESULT_CODE_FIELD] === 'string';
      }),
    ).toBe(true);
  });
});

describe('arbTerminalEvent keeps the Assurance envelope faithful', () => {
  const events = sample(arbTerminalEvent('Assurance'), 300);

  it('carries the verified envelope members and the event’s own exit code', () => {
    for (const event of events) {
      expect((event as Record<string, unknown>)['v']).toBe(1);
      expect(typeof (event as Record<string, unknown>)['verb']).toBe('string');
    }
    expect(events.some((event) => has(event, 'exit_code'))).toBe(true);
    // The refusal of §5.3.1 is a *complete* stream with a refused status, not a
    // crashed one — so the status has to be reachable.
    expect(events.some((event) => (event as Record<string, unknown>)['status'] === 'refused')).toBe(
      true,
    );
    expect(events.some((event) => (event as Record<string, unknown>)['status'] === 'paused')).toBe(
      true,
    );
  });
});

describe('the absorbed wire-field slot models agree with the accessors', () => {
  it('coerces every result-code slot to the value it predicts', () => {
    fc.assert(
      fc.property(arbResultCodeSlot, (slot) => {
        const event: Record<string, unknown> = {};
        if (slot.present) event[RESULT_CODE_FIELD] = slot.wire;
        expect(resultCode(event)).toBe(slot.expected);
      }),
      { numRuns: 500 },
    );
  });

  it('reads every credits slot as the first usable reading in preference order', () => {
    fc.assert(
      fc.property(arbCreditsSlot, (slot) => {
        expect(credits(creditsWire(slot.states))).toBe(expectedCredits(slot.states));
      }),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// Named case 7: a member status outside the four
// ---------------------------------------------------------------------------

describe('arbMemberStatus reaches all four statuses and values outside them', () => {
  const statuses = sample(arbMemberStatus);

  it('produces each of the four observed statuses', () => {
    for (const status of MEMBER_END_STATUSES) {
      expect(statuses).toContain(status);
    }
  });

  it('produces statuses outside the four', () => {
    const known: readonly string[] = MEMBER_END_STATUSES;
    const outside = statuses.filter((status) => !known.includes(status));
    expect(outside.length).toBeGreaterThan(0);
    // Including the two that a case-insensitive or trimming comparison would
    // wrongly fold into a known one.
    expect(statuses.some((status) => status === 'PASSED' || status === 'passed ')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Named cases 5 and 6: a terminal-only stream, and truncation at every index
// ---------------------------------------------------------------------------

describe('arbStream reaches its family’s terminal event', () => {
  it('parses as complete for every family and every draw', () => {
    for (const family of FAMILIES) {
      for (const stream of sample(arbStream(family), 200)) {
        expect(parseStream(contractFor(family), stream.lines).kind).toBe('complete');
      }
    }
  });

  it('produces a stream whose only line is the terminal event', () => {
    for (const family of FAMILIES) {
      const streams = sample(arbStream(family), 200);
      const only = streams.filter((stream) => stream.lines.length === 1);
      expect(only.length).toBeGreaterThan(0);
      for (const stream of only) {
        const parsed = parseStream(contractFor(family), stream.lines);
        expect(parsed.kind).toBe('complete');
        expect(parsed.events).toHaveLength(1);
      }
      // The named case names `run_end` specifically.
      if (family === 'ExecutionRun') {
        expect(
          only.some((stream) => (stream.lines[0] ?? '').includes('"type":"run_end"')),
        ).toBe(true);
      }
    }
  });

  it('produces leading noise and malformed lines without losing the terminal event', () => {
    const streams = sample(arbStream('ExecutionRun'), 300);
    expect(streams.some((stream) => stream.shape === 'noisy')).toBe(true);
    const malformed = streams.filter((stream) => stream.shape === 'malformed');
    expect(malformed.length).toBeGreaterThan(0);
    // A malformed line is diagnosed and parsing continues (R3.24); leading noise
    // is skipped silently (R3.23).
    expect(
      malformed.some(
        (stream) => parseStream(contractFor('ExecutionRun'), stream.lines).diagnostics.length > 0,
      ),
    ).toBe(true);
  });
});

describe('arbTruncatedStream never reaches the terminal event, and cuts at every index', () => {
  it('parses as crashed for every family and every draw', () => {
    for (const family of FAMILIES) {
      for (const stream of sample(arbTruncatedStream(family), 200)) {
        const parsed = parseStream(contractFor(family), stream.lines);
        expect(parsed.kind).toBe('crashed');
        if (parsed.kind === 'crashed') {
          expect(parsed.expectedTerminal).toBe(contractFor(family).terminalType);
        }
      }
    }
  });

  it('cuts at every index, from the empty stream to one line short of the verdict', () => {
    const streams = sample(arbTruncatedStream('ExecutionRun'));
    const cuts = new Set(streams.map((stream) => stream.cutAt));
    for (let index = 0; index <= 7; index += 1) {
      expect(cuts.has(index), `no draw truncated at index ${index}`).toBe(true);
    }
    // The empty stream, and the sharpest case: everything arrived except the one
    // line that says what happened.
    expect(streams.some((stream) => stream.lines.length === 0)).toBe(true);
    expect(streams.some((stream) => stream.cutAt === stream.full.length - 1)).toBe(true);
  });

  it('is crashed at *every* cut of a concrete stream, not only at the cut drawn', () => {
    const longest = sample(arbTruncatedStream('ExecutionTestrun'), 200)
      .map((stream) => stream.full)
      .reduce((best, full) => (full.length > best.length ? full : best), [] as readonly string[]);
    expect(longest.length).toBeGreaterThan(2);
    for (let cut = 0; cut < longest.length; cut += 1) {
      expect(parseStream(contractFor('ExecutionTestrun'), longest.slice(0, cut)).kind).toBe(
        'crashed',
      );
    }
    // And the whole thing, uncut, is complete — so the cuts are what made the
    // difference rather than the stream never having had a terminal event.
    expect(parseStream(contractFor('ExecutionTestrun'), longest).kind).toBe('complete');
  });
});

// ---------------------------------------------------------------------------
// Line-level generators, and the open event vocabulary
// ---------------------------------------------------------------------------

describe('arbNoisyPrefix and arbMalformedLine produce what they claim', () => {
  it('produces prefix lines that are genuinely not the start of the stream', () => {
    const lines = sample(arbNoisyPrefix);
    for (const line of lines) {
      expect(line.trimStart().startsWith('{')).toBe(false);
      expect(line.includes('\n')).toBe(false);
      expect(line.includes('\r')).toBe(false);
    }
    // Including the empty and whitespace-only lines a real banner block contains.
    expect(lines.some((line) => line.trim().length === 0)).toBe(true);
  });

  it('produces lines that are never a Kane event', () => {
    const lines = sample(arbMalformedLine);
    let unparseable = 0;
    let nonObject = 0;
    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        unparseable += 1;
        continue;
      }
      // Well-formed JSON that is still not an event: a scalar, or an array.
      expect(typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)).toBe(true);
      nonObject += 1;
    }
    expect(unparseable).toBeGreaterThan(0);
    expect(nonObject).toBeGreaterThan(0);
  });
});

describe('arbKaneEvent covers the open vocabulary', () => {
  const events = sample(arbKaneEvent);
  const types = events.map((event) => (event as Record<string, unknown>)['type']);

  it('produces progress events, which carry a `step` key and often no type', () => {
    const progress = events.filter((event) => has(event, 'step'));
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.some((event) => !has(event, 'type'))).toBe(true);
  });

  it('produces all three terminal event types', () => {
    for (const family of FAMILIES) {
      expect(types).toContain(contractFor(family).terminalType);
    }
  });

  it('produces event types outside the recognised set, because retention of unknowns is required', () => {
    const known: readonly string[] = KNOWN_EVENT_TYPES;
    const unknown = types.filter((type) => typeof type === 'string' && !known.includes(type));
    expect(unknown.length).toBeGreaterThan(0);
  });

  it('produces the documented-but-never-observed types too', () => {
    expect(types).toContain('recording_state');
    expect(types).toContain('testrun_member_end');
  });
});

// ---------------------------------------------------------------------------
// failure.yaml — all four category aliases, checked through the loader
// ---------------------------------------------------------------------------

describe('arbFailureYaml covers all four accepted category aliases', () => {
  const cases = sample(arbFailureYaml);

  it('reaches every alias, including the one with no committed fixture', () => {
    for (const alias of TRIAGE_SIGNAL_FIELDS) {
      expect(
        cases.some((c) => c.alias === alias),
        `no draw carried its signal under ${alias}`,
      ).toBe(true);
    }
  });

  it('is read by the loader exactly as it labels itself', () => {
    for (const c of cases) {
      const loaded = loadFailureYaml({ content: c.text });
      if (c.shape === 'invalid') {
        // A document that never became a document at all.
        expect(loaded).toBeNull();
        continue;
      }
      expect(loaded).not.toBeNull();
      if (loaded === null) continue;
      expect(loaded.signalField).toBe(c.alias);
      expect(loaded.signal).toBe(c.signal);
      expect(loaded.isMapping).toBe(c.shape === 'mapping');
      // The padded code has to coerce, here as everywhere else.
      expect(loaded.resultCode).toBe(c.withPaddedResultCode ? 740 : null);
    }
  });

  it('reaches every root shape, because a parsed-but-silent note is not an absent one', () => {
    for (const shape of ['mapping', 'empty', 'scalar', 'sequence', 'invalid'] as const) {
      expect(cases.some((c) => c.shape === shape), `no draw was ${shape}`).toBe(true);
    }
    // A mapping that carries no signal at all is still a record, not a null.
    const silent = cases.filter((c) => c.shape === 'mapping' && c.alias === null);
    expect(silent.length).toBeGreaterThan(0);
    for (const c of silent) expect(loadFailureYaml({ content: c.text })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The store source listing — the four cases the fixture is required to cover
// ---------------------------------------------------------------------------

describe('arbStoreSourceListing covers the four required listing cases', () => {
  const cases = sample(arbStoreSourceListing);

  it('reaches exact-path, digest-only, retired and duplicate', () => {
    const required: readonly StoreListingFeature[] = [
      'exact-path',
      'digest-only',
      'retired',
      'duplicate',
    ];
    for (const feature of required) {
      expect(
        cases.some((c) => c.features.includes(feature)),
        `no draw contained a ${feature} entry`,
      ).toBe(true);
    }
  });

  it('spells the recognisable fields under every accepted key', () => {
    const idKeys = new Set(cases.flatMap((c) => c.entries.map((entry) => entry.idKey)));
    expect(idKeys.size).toBeGreaterThanOrEqual(3);
    const lifecycleKeys = new Set(
      cases.flatMap((c) => c.entries.map((entry) => entry.lifecycleKey)),
    );
    expect(lifecycleKeys.has('retired')).toBe(true);
    expect(lifecycleKeys.has('status')).toBe(true);
  });

  it('buries the array inside an envelope on some draws, and carries junk entries', () => {
    expect(cases.some((c) => Array.isArray(c.payload))).toBe(true);
    expect(cases.some((c) => !Array.isArray(c.payload) && typeof c.payload === 'object')).toBe(
      true,
    );
    // Every declared entry is on the wire under its own id key.
    for (const c of cases) {
      for (const entry of c.entries) {
        expect(entry.entry[entry.idKey]).toBe(entry.sourceId);
      }
    }
  });

  it('gives two live entries the same path, which is the fork guard’s input', () => {
    const forked = cases.filter((c) => c.features.includes('duplicate'));
    expect(forked.length).toBeGreaterThan(0);
    for (const c of forked) {
      const live = c.entries.filter((entry) => !entry.retired && entry.path !== null);
      const paths = live.map((entry) => entry.path);
      expect(new Set(paths).size).toBeLessThan(paths.length);
    }
  });
});
