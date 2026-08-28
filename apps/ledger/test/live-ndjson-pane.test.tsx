/**
 * The dev-only live NDJSON pane (task 21.9, R8.7, R3.9 at the UI layer, §18 #2).
 *
 * Task 21.9 makes four claims, and this file is arranged as one describe block per
 * claim so a failure names which claim broke rather than which function did.
 *
 * **1. It renders Kane's own stream, so an event it does not recognise becomes a row
 * rather than a dropped line.** Asserted against a committed capture rather than
 * against invented lines, because the invented ones would be written by whoever also
 * wrote the recognition list and would agree with it by construction.
 * `docs/kane/loop/codebreak-green-f2cac6b7.member.ndjson` is 240 real lines from the
 * code-break loop, and only thirteen of them carry a `type` this repository
 * recognises. A pane that showed the recognised ones would draw thirteen rows out of
 * two hundred and forty and look like it was working. That ratio is asserted
 * explicitly below, so the guard cannot be satisfied by a pane that quietly filters.
 *
 * **2. It does not make a dev page hang on that capture.** Four separate bounds, and
 * each is tested for the specific stall it prevents: the buffer cap for memory, the
 * window for DOM node count, the flush timer for render count, the text clamp for
 * layout cost on one pathological line. The eviction arithmetic is checked as an
 * invariant, `received === rows.length + dropped`, because that is the property that
 * makes the count on the page trustworthy once the cap has bitten.
 *
 * **3. It is absent from the production build, and that is asserted rather than
 * inferred from a flag.** Asserted at its cause, which is the shape task 21.8 settled
 * on for the watch listener's port: nothing under `apps/ledger/app/` and nothing in
 * any other component names this module, so it is not a node in the graph the bundler
 * walks and no output can contain it. That is stronger than reading `.next`, which can be
 * stale, and it runs on a clean checkout, where `.next` does not exist at all and a
 * build-output scan would be a guard that passes by inspecting nothing.
 *
 * **4. It reads nothing.** This is the one that has already gone wrong once. A first
 * pass at this pane shipped a companion server module that opened the newest capture
 * under `.kept/diagnostics/` and handed the lines down. It worked, and it broke the
 * clause in `judge-path.test.ts` holding that no module under `apps/ledger/` imports
 * `node:fs`, on the grounds that a projection which reads nothing at request time has
 * nothing stale to serve. The companion module is gone and the transport belongs to
 * `kept watch`, which already owns the local tail (§13.1) and already runs in the
 * process holding the invoker's line callback. The clause is restated here so this
 * suite, and not only the core one, goes red if a reader is added back.
 */

import { act, cleanup, render } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { KNOWN_EVENT_TYPES } from 'kept-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EMPTY_NDJSON_PANE_STATE,
  KNOWN_NDJSON_EVENT_TYPES,
  LIVE_NDJSON_EMPTY_HEADLINE,
  LIVE_NDJSON_NOTE_LABEL,
  LIVE_NDJSON_REGION_LABEL,
  LiveNdjsonPane,
  NDJSON_NO_TYPE_LABEL,
  NDJSON_PANE_FLUSH_MS,
  NDJSON_PANE_LINE_CAP,
  NDJSON_PANE_TEXT_CAP,
  NDJSON_PANE_WINDOW_SIZE,
  NDJSON_PREAMBLE_LABEL,
  NDJSON_UNPARSED_LABEL,
  appendNdjsonLines,
  classifyNdjsonLine,
  liveNdjsonEmptyDetail,
  liveNdjsonHeading,
  liveNdjsonNote,
  liveNdjsonStatus,
  ndjsonWindow,
  type NdjsonLineSource,
  type NdjsonRowKind,
} from '../components/LiveNdjsonPane.js';
import { REPO_ROOT, scanLedger } from './_scan.js';

afterEach(cleanup);

/* ────────────────────────────── the committed capture ───────────────────────── */

/**
 * A real member stream, committed so this suite needs no local run.
 *
 * The captures a local run leaves under `.kept/diagnostics/` are ignored by git, so
 * reading one of those would make the suite pass only on the machine that produced it
 * and pass vacuously everywhere else. This file is in the tree.
 */
const CAPTURE = 'docs/kane/loop/codebreak-green-f2cac6b7.member.ndjson';

function captureLines(): readonly string[] {
  const text = readFileSync(resolve(REPO_ROOT, CAPTURE), 'utf8');
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines.length < 200) {
    throw new Error(
      `${CAPTURE} yielded ${lines.length} lines. The bounds in this suite are calibrated ` +
        `on a two-hundred-line member capture, and a short file would let them pass ` +
        `without ever reaching a limit.`,
    );
  }
  return lines;
}

const CAPTURED = captureLines();

/**
 * The capture as the pane renders it: verbatim, except where the text clamp bites.
 *
 * The clamp is not hypothetical on this file. One of its 240 lines is a 2,895
 * character `run_end` carrying a full triage verdict, a root cause, an agent-fault
 * assessment and per-flow metadata, so a suite that asserted the rendered rows were
 * byte-identical to the file would be asserting the clamp does not exist. Exactly one
 * line is affected, which {@link CLAMPED_LINE_COUNT} pins.
 */
function asRendered(lines: readonly string[]): readonly string[] {
  return lines.map((line) =>
    line.length <= NDJSON_PANE_TEXT_CAP ? line : line.slice(0, NDJSON_PANE_TEXT_CAP),
  );
}

/** Lines of the committed capture the text clamp shortens. Real, and exactly one. */
const CLAMPED_LINE_COUNT = 1;

function kindCounts(lines: readonly string[]): Record<NdjsonRowKind, number> {
  const counts: Record<NdjsonRowKind, number> = {
    typed: 0,
    progress: 0,
    unrecognised: 0,
    unparsed: 0,
    preamble: 0,
  };
  for (const [index, line] of lines.entries()) {
    counts[classifyNdjsonLine(line, index + 1).kind] += 1;
  }
  return counts;
}

/* ─────────── claim 1: every line becomes a row, recognised or not ───────────── */

describe('the pane retains an event whose type it does not recognise (R3.9)', () => {
  it('restates the contract package’s recognition list without drifting from it', () => {
    // Restated rather than imported because this is a `'use client'` module and the
    // package that owns the list reaches modules that open files. The restatement is
    // only safe while this assertion holds.
    expect(KNOWN_NDJSON_EVENT_TYPES).toEqual([...KNOWN_EVENT_TYPES]);
    expect(KNOWN_NDJSON_EVENT_TYPES).toHaveLength(22);
  });

  it('classifies a recognised type as typed', () => {
    for (const type of KNOWN_EVENT_TYPES) {
      const row = classifyNdjsonLine(JSON.stringify({ type }), 1);
      expect(row.kind, `${type} is in the recognition list`).toBe('typed');
      expect(row.label).toBe(type);
    }
  });

  it('classifies an unknown type as unrecognised, and keeps its name', () => {
    const row = classifyNdjsonLine(JSON.stringify({ type: 'step_event', index: 4 }), 7);
    expect(row.kind).toBe('unrecognised');
    expect(row.label).toBe('step_event');
    expect(row.seq).toBe(7);
  });

  it('identifies a progress event by its step key, before consulting type (R3.8)', () => {
    const row = classifyNdjsonLine(JSON.stringify({ step: 'launching browser', pct: 10 }), 1);
    expect(row.kind).toBe('progress');
    expect(row.label).toBe('launching browser');
  });

  it('keeps an object with neither a type nor a step, under a named label', () => {
    const row = classifyNdjsonLine(JSON.stringify({ detail: 'something new' }), 1);
    expect(row.kind).toBe('unrecognised');
    expect(row.label).toBe(NDJSON_NO_TYPE_LABEL);
  });

  it('keeps a line that began with a brace and did not parse (R3.24)', () => {
    const row = classifyNdjsonLine('{"type":"run_end","truncated', 1);
    expect(row.kind).toBe('unparsed');
    expect(row.label).toBe(NDJSON_UNPARSED_LABEL);
    expect(row.text).toBe('{"type":"run_end","truncated');
  });

  it('keeps a preamble line, which is chatter rather than an event (R3.23)', () => {
    const row = classifyNdjsonLine('Kane CLI 0.8.4', 1);
    expect(row.kind).toBe('preamble');
    expect(row.label).toBe(NDJSON_PREAMBLE_LABEL);
  });

  it('refuses a bare JSON array and a bare null, which are not events', () => {
    expect(classifyNdjsonLine('{}', 1).kind).toBe('unrecognised');
    // Neither begins with a brace, so both are preamble rather than unparsed.
    expect(classifyNdjsonLine('[1,2]', 1).kind).toBe('preamble');
    expect(classifyNdjsonLine('null', 1).kind).toBe('preamble');
  });

  it('turns all 240 lines of a real capture into 240 rows', () => {
    const state = appendNdjsonLines(EMPTY_NDJSON_PANE_STATE, CAPTURED);
    expect(state.rows).toHaveLength(CAPTURED.length);
    expect(state.received).toBe(CAPTURED.length);
    expect(state.dropped).toBe(0);
    expect(state.rows.map((row) => row.text)).toEqual(asRendered(CAPTURED));
    // Arrival order is 1-based and contiguous, which is what makes `seq` a key.
    expect(state.rows.map((row) => row.seq)).toEqual(
      CAPTURED.map((_line, index) => index + 1),
    );
  });

  it('would draw a small fraction of that capture if it filtered to recognised types', () => {
    const counts = kindCounts(CAPTURED);
    // The number this guard exists for. A filtering pane draws `typed` only.
    expect(counts.typed).toBeGreaterThan(0);
    expect(counts.unrecognised).toBeGreaterThan(counts.typed * 10);
    expect(counts.typed + counts.unrecognised + counts.progress).toBe(CAPTURED.length);
    expect(counts.unparsed).toBe(0);
    expect(counts.preamble).toBe(0);
  });

  it('names the unrecognised types the capture actually carries', () => {
    const unrecognised = new Set(
      CAPTURED.map((line, index) => classifyNdjsonLine(line, index + 1))
        .filter((row) => row.kind === 'unrecognised')
        .map((row) => row.label),
    );
    // Four of Kane's own step-level types, none of them in the recognition list.
    for (const type of ['step_start', 'step_end', 'step_event', 'test_md_step_start']) {
      expect(unrecognised, `${type} is emitted by Kane and is not recognised`).toContain(type);
      expect(KNOWN_NDJSON_EVENT_TYPES).not.toContain(type);
    }
  });
});

/* ─────────── claim 2: four bounds, so a dev page does not hang ──────────────── */

describe('the pane is bounded four separate ways', () => {
  it('holds no more rows than the cap, and counts what it evicted', () => {
    const state = appendNdjsonLines(EMPTY_NDJSON_PANE_STATE, CAPTURED, 40);
    expect(state.rows).toHaveLength(40);
    expect(state.received).toBe(CAPTURED.length);
    expect(state.dropped).toBe(CAPTURED.length - 40);
    // Eviction is from the head, so what is held is the newest.
    expect(state.rows[0]?.seq).toBe(CAPTURED.length - 39);
    expect(state.rows[39]?.seq).toBe(CAPTURED.length);
  });

  it('keeps received equal to held plus dropped, however the lines arrive', () => {
    for (const cap of [1, 2, 7, 40, 239, 240, 241, NDJSON_PANE_LINE_CAP]) {
      let state = EMPTY_NDJSON_PANE_STATE;
      // Ragged batches, because one append of everything would not exercise the
      // carried-over `dropped` count at all.
      for (let at = 0; at < CAPTURED.length; at += 13) {
        state = appendNdjsonLines(state, CAPTURED.slice(at, at + 13), cap);
        expect(state.rows.length, `cap ${cap} overran`).toBeLessThanOrEqual(cap);
        expect(state.received, `cap ${cap} lost a line`).toBe(
          state.rows.length + state.dropped,
        );
      }
      expect(state.received).toBe(CAPTURED.length);
    }
  });

  it('clamps a small or fractional cap to one, rather than to no bound', () => {
    for (const cap of [0, -5, 0.4]) {
      const state = appendNdjsonLines(EMPTY_NDJSON_PANE_STATE, CAPTURED, cap);
      expect(state.rows.length, `cap ${String(cap)} produced an unbounded buffer`).toBe(1);
      expect(state.received).toBe(CAPTURED.length);
      expect(state.dropped).toBe(CAPTURED.length - 1);
    }
  });

  it('falls back to the default cap when handed a cap that is not a number', () => {
    // This is the case that was broken. `Math.max(1, Math.floor(NaN))` is `NaN`, every
    // comparison against it is false, and the pane held all 240 lines with no bound at
    // all: the parameter asked for as a safety measure became the absence of one.
    // `Infinity` goes the same way deliberately, because an unbounded pane is not an
    // option this component offers however it is called.
    for (const cap of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const state = appendNdjsonLines(EMPTY_NDJSON_PANE_STATE, CAPTURED, cap);
      expect(state.rows.length, `cap ${String(cap)} was treated as no bound`).toBe(
        Math.min(CAPTURED.length, NDJSON_PANE_LINE_CAP),
      );
      expect(state.received).toBe(CAPTURED.length);
    }
    // The same coercion guards the window, which shares the arithmetic.
    const rows = appendNdjsonLines(EMPTY_NDJSON_PANE_STATE, CAPTURED).rows;
    expect(ndjsonWindow(rows, Number.NaN)).toHaveLength(NDJSON_PANE_WINDOW_SIZE);
    expect(ndjsonWindow(rows, Number.POSITIVE_INFINITY)).toHaveLength(NDJSON_PANE_WINDOW_SIZE);
  });

  it('returns the same state object when handed nothing', () => {
    const state = appendNdjsonLines(EMPTY_NDJSON_PANE_STATE, CAPTURED, 40);
    expect(appendNdjsonLines(state, [], 40)).toBe(state);
  });

  it('windows to the tail, so the DOM node count does not track the stream', () => {
    const state = appendNdjsonLines(EMPTY_NDJSON_PANE_STATE, CAPTURED);
    const shown = ndjsonWindow(state.rows, 12);
    expect(shown).toHaveLength(12);
    expect(shown[11]?.seq).toBe(CAPTURED.length);
    expect(shown[0]?.seq).toBe(CAPTURED.length - 11);
    // A window wider than the buffer is the buffer, not a padded one.
    expect(ndjsonWindow(state.rows, 10_000)).toHaveLength(CAPTURED.length);
    expect(ndjsonWindow([], 12)).toEqual([]);
    expect(ndjsonWindow(state.rows, 0)).toHaveLength(1);
  });

  it('clamps one pathological line and says how much it withheld', () => {
    const huge = `{"type":"step_event","screenshot":"${'A'.repeat(NDJSON_PANE_TEXT_CAP * 2)}"}`;
    const row = classifyNdjsonLine(huge, 1);
    expect(row.text).toHaveLength(NDJSON_PANE_TEXT_CAP);
    expect(row.clamped).toBe(huge.length - NDJSON_PANE_TEXT_CAP);
    // Classification survives the clamp: the type is read from the parse, not the text.
    expect(row.label).toBe('step_event');
    expect(row.kind).toBe('unrecognised');
  });

  it('bites on the real capture exactly once, and leaves every other line alone', () => {
    // Not a synthetic case. One line of this capture is a 2,895 character `run_end`
    // carrying a full triage verdict, so the clamp is exercised by the file rather than
    // by a string of repeated As. If this count ever moves, the capture changed and the
    // suite should be read again rather than adjusted.
    const clamped = CAPTURED.map((line, index) => classifyNdjsonLine(line, index + 1)).filter(
      (row) => row.clamped > 0,
    );
    expect(clamped).toHaveLength(CLAMPED_LINE_COUNT);
    expect(clamped[0]?.label).toBe('run_end');
    expect(clamped[0]?.text).toHaveLength(NDJSON_PANE_TEXT_CAP);
    expect(clamped[0]?.clamped).toBe(895);
  });

  it('coalesces a burst from the subscription into one flush', async () => {
    vi.useFakeTimers();
    try {
      let emit: ((line: string) => void) | undefined;
      let stopped = 0;
      const source: NdjsonLineSource = {
        subscribe(onLine) {
          emit = onLine;
          return () => {
            stopped += 1;
          };
        },
      };

      const { container, unmount } = render(
        <LiveNdjsonPane flushMs={NDJSON_PANE_FLUSH_MS} source={source} windowSize={500} />,
      );
      expect(emit).toBeDefined();

      // The whole capture arrives between two ticks of the flush timer.
      for (const line of CAPTURED) emit?.(line);
      expect(
        container.querySelectorAll('[data-ndjson-seq]'),
        'lines reached the DOM before the timer fired, so arrivals are not coalesced',
      ).toHaveLength(0);

      /* `act` because the flush lands in a `setInterval` callback, which React has no
         other way to know is a state update it should commit before we read the DOM. */
      await act(async () => {
        await vi.advanceTimersByTimeAsync(NDJSON_PANE_FLUSH_MS + 1);
      });
      expect(container.querySelectorAll('[data-ndjson-seq]')).toHaveLength(CAPTURED.length);

      unmount();
      expect(stopped, 'the subscription was not torn down on unmount').toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds the pending buffer as well as the state', async () => {
    vi.useFakeTimers();
    try {
      let emit: ((line: string) => void) | undefined;
      const source: NdjsonLineSource = {
        subscribe(onLine) {
          emit = onLine;
          return () => undefined;
        },
      };
      const { container } = render(
        <LiveNdjsonPane cap={20} source={source} windowSize={500} />,
      );
      for (const line of CAPTURED) emit?.(line);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(NDJSON_PANE_FLUSH_MS + 1);
      });
      expect(container.querySelectorAll('[data-ndjson-seq]')).toHaveLength(20);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ──────────────────── the words on the page, and the empty state ────────────── */

describe('the pane says what it is showing and what it discarded', () => {
  it('states shown and held apart, because the window makes them differ', () => {
    expect(liveNdjsonHeading(120, 120)).toBe('Live NDJSON (120)');
    expect(liveNdjsonHeading(120, 240)).toBe('Live NDJSON (120 of 240)');
  });

  it('names the discard count once the cap has bitten, and not before', () => {
    const held = appendNdjsonLines(EMPTY_NDJSON_PANE_STATE, CAPTURED.slice(0, 10));
    expect(liveNdjsonStatus(held, 10)).toBe('Showing 10 of 10 held lines, 10 received.');
    expect(liveNdjsonStatus(held, 10)).not.toContain('discarded');

    const evicted = appendNdjsonLines(EMPTY_NDJSON_PANE_STATE, CAPTURED, 40);
    const sentence = liveNdjsonStatus(evicted, 12);
    expect(sentence).toContain('Showing 12 of 40 held lines, 240 received.');
    expect(sentence).toContain('200 earlier lines were discarded by the buffer cap.');
  });

  it('says the lines are handed to it rather than read by it', () => {
    const note = liveNdjsonNote(CAPTURE);
    expect(note).toContain(CAPTURE);
    expect(note).toContain('handed to this pane rather than read by it');
    expect(note).toContain('local development');
    expect(liveNdjsonNote(undefined)).toContain('from outside the app');
  });

  it('reads as specified and empty rather than as broken, when nothing has arrived', () => {
    const { container } = render(<LiveNdjsonPane handoffPath={CAPTURE} />);
    const empty = container.querySelector('.runs-empty');
    expect(empty, 'an empty pane must render the dashed empty state of §10.10').not.toBeNull();
    expect(empty?.textContent).toContain(LIVE_NDJSON_EMPTY_HEADLINE);
    expect(empty?.textContent).toContain('Nothing is being filtered and nothing is being withheld');
    expect(container.querySelector('[role="region"]')).toBeNull();
    expect(liveNdjsonEmptyDetail(undefined)).toContain('the handoff');
  });

  it('renders no bare count that could read as a complete record', () => {
    const { container } = render(
      <LiveNdjsonPane cap={40} lines={CAPTURED} windowSize={12} />,
    );
    const status = container.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toContain('240 received');
    expect(status?.textContent).toContain('discarded by the buffer cap');
    expect(container.querySelector('h2')?.textContent).toBe('Live NDJSON (12 of 40)');
  });
});

/* ──────────────────────── rendering the real capture ────────────────────────── */

describe('the pane renders a real capture', () => {
  it('draws the window rather than the whole buffer', () => {
    const { container } = render(<LiveNdjsonPane lines={CAPTURED} />);
    const rows = [...container.querySelectorAll('[data-ndjson-seq]')];
    expect(rows).toHaveLength(NDJSON_PANE_WINDOW_SIZE);
    expect(rows.length).toBeLessThan(CAPTURED.length);
    expect(rows[rows.length - 1]?.getAttribute('data-ndjson-seq')).toBe(String(CAPTURED.length));
  });

  it('puts unrecognised rows in the DOM, not only recognised ones', () => {
    const { container } = render(<LiveNdjsonPane lines={CAPTURED} windowSize={500} />);
    const kinds = [...container.querySelectorAll('[data-ndjson-kind]')].map((node) =>
      node.getAttribute('data-ndjson-kind'),
    );
    const counts = kindCounts(CAPTURED);
    expect(kinds).toHaveLength(CAPTURED.length);
    expect(kinds.filter((kind) => kind === 'unrecognised')).toHaveLength(counts.unrecognised);
    expect(kinds.filter((kind) => kind === 'typed')).toHaveLength(counts.typed);
  });

  it('renders each line’s bytes verbatim beside the verdict it was given', () => {
    const { container } = render(<LiveNdjsonPane lines={CAPTURED} windowSize={500} />);
    const rendered = [...container.querySelectorAll('.diagnostic__remedy')].map(
      (node) => node.textContent ?? '',
    );
    // Verbatim, save for the one line the text clamp shortens, which the row itself
    // declares: `+895 chars`. Nothing is rewrapped and nothing is summarised.
    expect(rendered).toEqual(asRendered(CAPTURED));
    const declared = [...container.querySelectorAll('[data-ndjson-seq]')].filter((node) =>
      (node.textContent ?? '').includes('+895 chars'),
    );
    expect(declared).toHaveLength(CLAMPED_LINE_COUNT);
  });

  it('gives the scroll region a name and the disclosure a name for its glyph', () => {
    const { container } = render(<LiveNdjsonPane lines={CAPTURED} />);
    const region = container.querySelector('[role="region"]');
    expect(region?.getAttribute('aria-label')).toBe(LIVE_NDJSON_REGION_LABEL);
    expect(region?.getAttribute('tabindex')).toBe('0');
    const summary = container.querySelector('summary');
    expect(summary?.getAttribute('aria-label')).toBe(LIVE_NDJSON_NOTE_LABEL);
    expect(summary?.textContent).toBe('?');
  });

  it('replaces the captured prefix when it grows, instead of double-counting it', () => {
    const { container, rerender } = render(
      <LiveNdjsonPane lines={CAPTURED.slice(0, 40)} windowSize={500} />,
    );
    expect(container.querySelectorAll('[data-ndjson-seq]')).toHaveLength(40);
    rerender(<LiveNdjsonPane lines={CAPTURED.slice(0, 90)} windowSize={500} />);
    const rows = [...container.querySelectorAll('[data-ndjson-seq]')];
    expect(rows).toHaveLength(90);
    expect(rows.map((row) => row.getAttribute('data-ndjson-seq'))).toEqual(
      CAPTURED.slice(0, 90).map((_line, index) => String(index + 1)),
    );
  });
});

/* ─────────── claims 3 and 4: absent from the build, and reads nothing ───────── */

describe('the pane is absent from the production build, asserted at its cause', () => {
  const MODULE = 'apps/ledger/components/LiveNdjsonPane.tsx';
  const SOURCES = scanLedger(['.ts', '.tsx', '.mts', '.mjs']).filter(
    (file) => !file.path.startsWith('apps/ledger/test/'),
  );

  it('exists, so this scan is measuring something', () => {
    expect(SOURCES.map((file) => file.path)).toContain(MODULE);
  });

  it('is named by no page, layout or route under app/', () => {
    const namers = SOURCES.filter(
      (file) => file.path.startsWith('apps/ledger/app/') && file.text.includes('LiveNdjsonPane'),
    ).map((file) => file.path);
    expect(
      namers,
      `these modules under app/ name the pane, which puts it in the module graph the ` +
        `bundler walks and therefore in the production output. Mounting the pane is a ` +
        `local edit, not a commit.`,
    ).toEqual([]);
  });

  it('is named by no other component or library module either', () => {
    const namers = SOURCES.filter(
      (file) => file.path !== MODULE && file.text.includes('LiveNdjsonPane'),
    ).map((file) => file.path);
    expect(
      namers,
      `only the pane's own file may name it. Any other shipped module naming it gives ` +
        `the bundler a static edge to follow.`,
    ).toEqual([]);
  });

  it('carries no companion module that would mount it', () => {
    // The first pass at this task shipped `LiveNdjsonDevMount.tsx`, which opened the
    // newest capture on the server and handed the lines down. It is gone, and its
    // absence is asserted rather than remembered.
    const components = resolve(REPO_ROOT, 'apps/ledger/components');
    const present = readdirSync(components).filter((name) => name.includes('LiveNdjson'));
    expect(present).toEqual(['LiveNdjsonPane.tsx']);
    expect(statSync(resolve(components, 'LiveNdjsonDevMount.tsx'), { throwIfNoEntry: false })).toBe(
      undefined,
    );
  });

  it('reads no file, and neither does anything else the Ledger ships', () => {
    const readers = SOURCES.filter((file) =>
      /from\s*['"]node:fs(\/promises)?['"]/.test(file.text),
    ).map((file) => file.path);
    expect(
      readers,
      `the Ledger is a projection of one committed file: a module that reads at request ` +
        `time has something stale to serve. This is also the clause the first pass at ` +
        `this task broke, so it is restated here and not only in judge-path.test.ts.`,
    ).toEqual([]);
  });

  it('opens no socket and spawns nothing, so the tail arrives from the CLI', () => {
    const pane = SOURCES.find((file) => file.path === MODULE);
    expect(pane).toBeDefined();
    const text = pane?.text ?? '';
    for (const forbidden of ['node:child_process', 'node:net', 'node:http', 'EventSource', 'WebSocket']) {
      expect(text, `the pane names ${forbidden}, which is a transport it must not own`).not.toContain(
        forbidden,
      );
    }
    // No fetch either: R8.4 leaves the Ledger no route to poll.
    expect(text).not.toMatch(/\bfetch\s*\(/);
  });
});

/* ────────────────────── the visual system is composed, not extended ─────────── */

describe('the pane authors no style of its own', () => {
  const MODULE = 'apps/ledger/components/LiveNdjsonPane.tsx';
  const source = readFileSync(resolve(REPO_ROOT, MODULE), 'utf8');

  /** Every class token that reaches the DOM from a `className` in this file. */
  function classTokens(text: string): readonly string[] {
    const tokens = new Set<string>();
    for (const match of text.matchAll(/className="([^"{}]+)"/g)) {
      for (const token of (match[1] ?? '').split(/\s+/)) {
        if (token !== '') tokens.add(token);
      }
    }
    return [...tokens].sort();
  }

  const STYLESHEETS = scanLedger(['.css']);

  it('adds no stylesheet, and imports only one that already existed', () => {
    const imports = [...source.matchAll(/import '(\.\.\/styles\/[^']+)'/g)].map(
      (match) => match[1],
    );
    expect(imports).toEqual(['../styles/runs.css']);
    expect(STYLESHEETS.map((file) => file.path)).toContain('apps/ledger/styles/runs.css');
  });

  it('composes only classes the stylesheets already define', () => {
    const tokens = classTokens(source);
    expect(tokens.length).toBeGreaterThan(8);
    const css = STYLESHEETS.map((file) => file.text).join('\n');
    const undefinedTokens = tokens.filter(
      (token) => !new RegExp(`\\.${token.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css),
    );
    expect(
      undefinedTokens,
      `these classes are used by the pane and defined by no stylesheet, so the pane is ` +
        `either extending the visual system or relying on a class that was renamed`,
    ).toEqual([]);
  });

  it('authors no colour at all', () => {
    for (const pattern of [/#[0-9a-f]{3,8}\b/i, /oklch\(/, /rgba?\(/, /hsla?\(/, /linear-gradient/]) {
      expect(source, `the pane names a colour matching ${String(pattern)}`).not.toMatch(pattern);
    }
    // No inline style attribute either, which is where a token would sneak in.
    expect(source).not.toMatch(/style=\{/);
  });

  it('is written without em dashes or en dashes', () => {
    const offending = source
      .split('\n')
      .map((line, index) => ({ line, at: index + 1 }))
      .filter((entry) => entry.line.includes('\u2014') || entry.line.includes('\u2013'));
    expect(
      offending.map((entry) => `${relative('.', MODULE)}:${entry.at}`),
      'checked by codepoint rather than by eye',
    ).toEqual([]);
  });
});
