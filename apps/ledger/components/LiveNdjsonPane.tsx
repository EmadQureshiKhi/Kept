/**
 * `LiveNdjsonPane` - the local-development NDJSON tail (R8.7, R3.9's spirit at the
 * UI layer, design §10.10 for the empty and bounded states, §18 #2).
 *
 * ## Why this file holds no transport at all
 *
 * R8.7 asks the Ledger to tail live NDJSON while it runs locally, and task 21.9 says
 * where the lines come from: the invoker's own per-line callback, which lives in the
 * CLI process. That is not an implementation detail this pane may work around. The
 * Ledger is a read-only projection: R8.4 forbids it any mutating route, R8.6 forbids
 * it any subprocess, and `scripts/check-readonly.mjs` enforces both over
 * `apps/ledger/**`. On top of those, `judge-path.test.ts` asserts that no module
 * under `apps/ledger/` imports `node:fs` at all, on the grounds that a projection
 * which reads nothing at request time has nothing stale to serve. A pane that opened
 * the captured stream itself would break that clause, and the clause is worth more
 * than the convenience.
 *
 * So the stream arrives from outside and this module is deliberately incapable of
 * going to get it: it takes lines as a prop, takes an optional subscription seam for
 * a continuous feed, and reads nothing. Whoever mounts it supplies both. The one
 * consumer that exists today is `kept watch`, which already owns the local NDJSON
 * tail (§13.1) and already runs in the process holding the line callback.
 *
 * The client boundary says the same thing a second way, so this is not merely a
 * policy choice. A `'use client'` module is the root of a browser bundle and
 * everything it reaches is chunked for the browser, transitively - see the header of
 * `RunLog.tsx`, which pays the same price. Anything in this app that can open a file
 * reaches a Node built-in no browser chunk can contain, so a client module that read
 * the capture itself would not merely be wrong, it would fail the build outright.
 *
 * ## Why nothing under `app/` names this module
 *
 * Task 21.9 wants the pane genuinely absent from the production build rather than
 * hidden inside it, and wants that asserted rather than inferred from a flag. The
 * cheapest way to be absent is to be unreachable, so no page, layout or route under
 * `apps/ledger/app/` names this file. `test/live-ndjson-pane.test.tsx` asserts the
 * unreachability by scanning the tree, which is the same shape task 21.8 settled on
 * for the watch listener's port: assert the cause, because the cause is deterministic
 * and a built artefact can be stale. Mounting the pane is one line a developer adds
 * locally and does not commit.
 *
 * ## Why an unrecognised event is a rendered row rather than a dropped line
 *
 * R3.9 says the parser retains an event whose `type` it does not recognise and
 * carries on. {@link KNOWN_NDJSON_EVENT_TYPES} is the same recognition list the
 * contract package publishes, and it is a recognition list rather than an
 * allow-list: the upstream tool's own documentation says new types and fields may
 * appear in any release. A pane that showed only the twenty-two it knows would be
 * lying about the stream it claims to be a window onto, and the lie would be
 * invisible - the reader cannot miss what was never drawn.
 *
 * The streams this repository has actually captured make that concrete rather than
 * theoretical. The member captures under `.kept/diagnostics/` are full of
 * `run_start`, `step_start`, `step_event` and `test_md_step_start`, none of which is
 * in the recognition list. A dropping pane would render almost none of a real
 * capture.
 *
 * So every line becomes a row, and the row says which of five things the line was:
 * a recognised type, a progress event (identified by a `step` key, R3.8), an
 * unrecognised type, a line that failed strict JSON parsing (R3.24), or a preamble
 * line that arrived before the first `{` (R3.23). The raw bytes are rendered
 * verbatim beside that verdict, so a reader can disagree with the classification.
 *
 * ## Why the vocabulary is restated here instead of imported
 *
 * `KNOWN_NDJSON_EVENT_TYPES` duplicates the contract package's list, for the
 * client-boundary reason above. Duplication invites drift, so
 * `test/live-ndjson-pane.test.tsx` asserts the two are element-for-element equal.
 * The check is in the test rather than in the component because only the test may
 * import the contract package at all.
 *
 * ## Four bounds, because one is not enough
 *
 * A single member replay is around 240 lines and a suite has nine members, so a
 * naive pane would hold thousands of rows and re-render on each one. Four separate
 * limits, each answering a different way this could stall the page it is meant to
 * help debug:
 *
 *   1. **The buffer is capped** at {@link NDJSON_PANE_LINE_CAP} rows. Older rows are
 *      evicted from the head and counted, and the count is stated on the page, so a
 *      long stream costs bounded memory and the reader is told what was discarded
 *      rather than left to assume they are seeing everything.
 *   2. **The window is the tail.** Only the last {@link NDJSON_PANE_WINDOW_SIZE}
 *      rows reach the DOM, so the node count is constant however long the stream
 *      runs. History is not this pane's job: it is on disk in the handoff file,
 *      which the pane names.
 *   3. **Arrivals are coalesced.** Lines from a subscription land in a ref and are
 *      flushed on one timer every {@link NDJSON_PANE_FLUSH_MS}, so a 240-line burst
 *      is one render rather than 240.
 *   4. **A single row's text is clamped** to {@link NDJSON_PANE_TEXT_CAP}
 *      characters. One pathological event carrying an inlined screenshot would
 *      otherwise put a megabyte of monospace into a `white-space: pre` box, and the
 *      layout cost of that is paid on every frame.
 *
 * ## The visual system is composed, never extended
 *
 * Every class here already exists in `styles/runs.css` and `styles/shell.css`: the
 * bounded scroll region of the terminal-event log, the diagnostic record with its
 * inverted code chip and its `pre` command box, the dashed empty state, the section
 * head with its `?` disclosure. No colour, no gradient and no token is authored,
 * and no stylesheet is added, which is why the forbidden-palette and contrast
 * matrix scans have nothing new to measure.
 */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import '../styles/runs.css';

/**
 * The recognised `type` values, in the contract package's own order.
 *
 * A recognition list, never an allow-list (R3.9). Restated here because this is a
 * client module and the package that owns the list reaches modules that open files;
 * the test asserts the two lists are identical so the restatement cannot drift.
 */
export const KNOWN_NDJSON_EVENT_TYPES: readonly string[] = Object.freeze([
  'recording_state',
  'skill_update_available',
  'bifurcation',
  'project_folder_auto_defaulted',
  'child_agent_start',
  'child_agent_end',
  'ask_user',
  'error',
  'test_md_evidence_ingest',
  'test_md_bundle_sync',
  'run_end',
  'testrun_plan',
  'testrun_start',
  'testrun_member_start',
  'testrun_member_end',
  'testrun_investigations_wait',
  'testrun_evidence_ingest',
  'testrun_summary',
  'testrun_done',
  'coverage',
  'gaps',
  'done',
]);

const KNOWN_SET: ReadonlySet<string> = new Set(KNOWN_NDJSON_EVENT_TYPES);

/** Rows held in memory at once. Beyond this the oldest are evicted and counted. */
export const NDJSON_PANE_LINE_CAP = 2_000;

/** Rows placed in the DOM. The tail, so the node count does not track the stream. */
export const NDJSON_PANE_WINDOW_SIZE = 120;

/** How often buffered arrivals are flushed into state, in milliseconds. */
export const NDJSON_PANE_FLUSH_MS = 100;

/** Characters of one line that are rendered. The rest is counted, not drawn. */
export const NDJSON_PANE_TEXT_CAP = 2_000;

/**
 * What a line turned out to be. Five values, and none of them is "discarded":
 * every line the pane is handed becomes exactly one row.
 */
export type NdjsonRowKind =
  /** A recognised `type` value. */
  | 'typed'
  /** No `type`, but a `step` key, which is how a progress event is identified (R3.8). */
  | 'progress'
  /** A `type` the recognition list does not carry, or an object with no `type` at all. */
  | 'unrecognised'
  /** Strict JSON parsing failed on a line that began with `{` (R3.24). */
  | 'unparsed'
  /** A line before the first one beginning with `{` (R3.23). Tool chatter, not an event. */
  | 'preamble';

/** One rendered line. `text` is the bytes as delivered, clamped for layout only. */
export interface NdjsonRow {
  /** Arrival order, 1-based and never reused, so it is a stable React key. */
  readonly seq: number;
  readonly kind: NdjsonRowKind;
  /**
   * The identifier shown in the code chip: the `type`, the `step`, or a hyphenated
   * stand-in when the line carried neither. Always an identifier rather than prose,
   * because the chip is monospace and §10.7 reserves that for identifiers.
   */
  readonly label: string;
  /** The line, verbatim up to {@link NDJSON_PANE_TEXT_CAP} characters. */
  readonly text: string;
  /** Characters withheld from `text` by the clamp. Zero for almost every line. */
  readonly clamped: number;
}

/** The label used when an object carries neither a `type` nor a `step`. */
export const NDJSON_NO_TYPE_LABEL = 'no-type';

/** The label used when a line beginning with `{` does not parse. */
export const NDJSON_UNPARSED_LABEL = 'unparsed-json';

/** The label used for a line that arrived before the first `{`. */
export const NDJSON_PREAMBLE_LABEL = 'not-json';

/**
 * Classifies one line without ever refusing it.
 *
 * The order matters and mirrors the parser's own classification (design §4.3): a
 * `step` key identifies a progress event before `type` is consulted, because
 * progress events genuinely carry no `type`; and a `type` that is present but
 * unrecognised is retained rather than treated as absent (R3.9).
 */
export function classifyNdjsonLine(line: string, seq: number): NdjsonRow {
  const clamped = Math.max(0, line.length - NDJSON_PANE_TEXT_CAP);
  const text = clamped === 0 ? line : line.slice(0, NDJSON_PANE_TEXT_CAP);
  const row = { seq, text, clamped } as const;

  if (!line.trimStart().startsWith('{')) {
    return { ...row, kind: 'preamble', label: NDJSON_PREAMBLE_LABEL };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return { ...row, kind: 'unparsed', label: NDJSON_UNPARSED_LABEL };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...row, kind: 'unparsed', label: NDJSON_UNPARSED_LABEL };
  }

  const event = parsed as Record<string, unknown>;
  const type = event['type'];

  if (typeof type === 'string' && type !== '') {
    return {
      ...row,
      kind: KNOWN_SET.has(type) ? 'typed' : 'unrecognised',
      label: type,
    };
  }

  if ('step' in event) {
    const step = event['step'];
    return {
      ...row,
      kind: 'progress',
      label: typeof step === 'string' && step !== '' ? step : 'step',
    };
  }

  return { ...row, kind: 'unrecognised', label: NDJSON_NO_TYPE_LABEL };
}

/** Everything the pane knows about the stream so far. */
export interface NdjsonPaneState {
  /** At most {@link NDJSON_PANE_LINE_CAP} rows, oldest first. */
  readonly rows: readonly NdjsonRow[];
  /** Lines ever handed to the pane, including the ones the cap has since evicted. */
  readonly received: number;
  /** Lines evicted by the cap. Stated on the page rather than silently forgotten. */
  readonly dropped: number;
}

export const EMPTY_NDJSON_PANE_STATE: NdjsonPaneState = Object.freeze({
  rows: Object.freeze([]),
  received: 0,
  dropped: 0,
});

/**
 * Turns a caller's number into a bound that actually bounds.
 *
 * `Math.max(1, Math.floor(cap))` is the obvious spelling and it is wrong, which
 * `test/live-ndjson-pane.test.tsx` caught: `Math.floor(NaN)` is `NaN` and
 * `Math.max(1, NaN)` is `NaN`, so every downstream comparison against the limit is
 * false and the buffer grows without limit. The bound that was asked for as a safety
 * measure becomes the absence of one, which is the worst available outcome here.
 *
 * So a value that is not a finite number is not treated as a permissive bound, it is
 * treated as no answer at all and the module default is used instead. `Infinity` goes
 * the same way on purpose: an unbounded pane is not one of the options this component
 * offers, whatever a caller passes. Zero and negatives clamp to one, because a
 * caller who asked for a small bound wants a small bound.
 */
function boundedLimit(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
}

/**
 * Appends lines to a state, evicting from the head once the cap is reached.
 *
 * Pure and total, so the whole bounding rule is unit-testable without a render:
 * `rows.length` is never above `cap`, `received` counts every line the pane was
 * ever handed, and `received === rows.length + dropped` holds for any input.
 */
export function appendNdjsonLines(
  state: NdjsonPaneState,
  lines: readonly string[],
  cap: number = NDJSON_PANE_LINE_CAP,
): NdjsonPaneState {
  if (lines.length === 0) return state;
  const limit = boundedLimit(cap, NDJSON_PANE_LINE_CAP);
  const rows = [...state.rows];
  let received = state.received;
  for (const line of lines) {
    received += 1;
    rows.push(classifyNdjsonLine(line, received));
  }
  const overflow = Math.max(0, rows.length - limit);
  return {
    rows: overflow === 0 ? rows : rows.slice(overflow),
    received,
    dropped: state.dropped + overflow,
  };
}

/** The tail that reaches the DOM. */
export function ndjsonWindow(
  rows: readonly NdjsonRow[],
  windowSize: number = NDJSON_PANE_WINDOW_SIZE,
): readonly NdjsonRow[] {
  const size = boundedLimit(windowSize, NDJSON_PANE_WINDOW_SIZE);
  return rows.length <= size ? rows : rows.slice(rows.length - size);
}

/**
 * A continuous feed of lines, if one is available.
 *
 * Typed as a plain string callback for the same reason the invoker's own line
 * callback is: the seam stays independent of the event shapes, so a source can be a
 * dev-server poll, a test's fake, or nothing at all. `subscribe` returns its own
 * teardown.
 */
export interface NdjsonLineSource {
  subscribe(onLine: (line: string) => void): () => void;
}

export interface LiveNdjsonPaneProps {
  /**
   * Lines already captured, in order. Treated as the authoritative prefix and
   * re-derived whenever it changes, so a mount that has since been handed more of the
   * capture replaces the prefix instead of double-counting it.
   */
  readonly lines?: readonly string[] | undefined;
  /** An optional feed of lines not already in `lines`. */
  readonly source?: NdjsonLineSource | undefined;
  /**
   * Where the lines came from, named on the page so the tail is checkable against the
   * capture. A label supplied by whoever mounts the pane, never discovered here.
   */
  readonly handoffPath?: string | undefined;
  readonly cap?: number | undefined;
  readonly windowSize?: number | undefined;
  readonly flushMs?: number | undefined;
}

/** The heading's `id`, so the scroll region borrows its accessible name from it. */
export const LIVE_NDJSON_HEADING_ID = 'live-ndjson-heading';

/** The accessible name of the bounded scroll region. */
export const LIVE_NDJSON_REGION_LABEL = 'live NDJSON tail';

/** The accessible name of the `?` disclosure, since the glyph is a shape. */
export const LIVE_NDJSON_NOTE_LABEL = 'How to read the live NDJSON tail';

/** The lead line when the handoff exists but holds nothing yet. */
export const LIVE_NDJSON_EMPTY_HEADLINE = 'No NDJSON line has arrived yet.';

/**
 * The heading, with both counts in it.
 *
 * Stated as `shown of held` rather than as a single number because the two differ by
 * construction: the window is the tail. A bare count would let a reader believe the
 * pane is showing everything it holds.
 */
export function liveNdjsonHeading(shown: number, held: number): string {
  return shown === held
    ? `Live NDJSON (${held})`
    : `Live NDJSON (${shown} of ${held})`;
}

/**
 * The live region's sentence: what is drawn, what is held, what was discarded.
 *
 * The discard count is not optional decoration. Once the cap has evicted a line the
 * pane is no longer a complete record, and a pane that did not say so would be
 * making the same silent omission that dropping an unrecognised event would make.
 */
export function liveNdjsonStatus(state: NdjsonPaneState, shown: number): string {
  const held = `Showing ${shown} of ${state.rows.length} held lines, ${state.received} received.`;
  return state.dropped === 0
    ? held
    : `${held} ${state.dropped} earlier lines were discarded by the buffer cap.`;
}

/** The `?` panel's copy. Names the handoff, so the tail can be checked against it. */
export function liveNdjsonNote(handoffPath: string | undefined): string {
  const source =
    handoffPath === undefined
      ? 'The lines are handed to this pane from outside the app.'
      : `The lines come from ${handoffPath}, and are handed to this pane rather than ` +
        `read by it.`;
  return (
    `${source} This pane exists only in local development and is absent from the ` +
    `deployed build. Every line becomes a row, including one whose event type is not ` +
    `recognised and one that did not parse, because a pane that dropped either would ` +
    `misrepresent the stream it is a window onto. Only the newest lines are drawn and ` +
    `the buffer is capped, so a long capture cannot stall the page.`
  );
}

/** The second line of the empty state, so an empty pane reads as specified. */
export function liveNdjsonEmptyDetail(handoffPath: string | undefined): string {
  const where =
    handoffPath === undefined ? 'the handoff' : handoffPath;
  return (
    `A row appears here for every line a local verification run writes to ${where}. ` +
    `Nothing is being filtered and nothing is being withheld: the stream has produced ` +
    `no line yet, or no run has been started in this working tree.`
  );
}

/** Keeps the tail of an array of raw lines, so the pending buffer is bounded too. */
function tail(lines: readonly string[], limit: number): string[] {
  return lines.length <= limit ? [...lines] : lines.slice(lines.length - limit);
}

export function LiveNdjsonPane({
  lines,
  source,
  handoffPath,
  cap = NDJSON_PANE_LINE_CAP,
  windowSize = NDJSON_PANE_WINDOW_SIZE,
  flushMs = NDJSON_PANE_FLUSH_MS,
}: LiveNdjsonPaneProps) {
  /* Lines delivered by the subscription, kept separately from the prop so a changed
     prop recomputes the prefix without either half being counted twice. */
  const [live, setLive] = useState<readonly string[]>([]);
  const pending = useRef<string[]>([]);

  const captured = useMemo(
    () => appendNdjsonLines(EMPTY_NDJSON_PANE_STATE, lines ?? [], cap),
    [lines, cap],
  );
  const state = useMemo(() => appendNdjsonLines(captured, live, cap), [captured, live, cap]);

  useEffect(() => {
    if (source === undefined) return undefined;
    const stop = source.subscribe((line: string) => {
      pending.current.push(line);
      /* Bound the buffer as well as the state: a burst that arrives faster than the
         flush timer must not be able to grow without limit between two flushes. */
      const limit = boundedLimit(cap, NDJSON_PANE_LINE_CAP);
      if (pending.current.length > limit) pending.current = tail(pending.current, limit);
    });
    const timer = setInterval(
      () => {
        if (pending.current.length === 0) return;
        const batch = pending.current;
        pending.current = [];
        setLive((previous) => tail([...previous, ...batch], boundedLimit(cap, NDJSON_PANE_LINE_CAP)));
      },
      boundedLimit(flushMs, NDJSON_PANE_FLUSH_MS),
    );
    return () => {
      clearInterval(timer);
      stop();
    };
  }, [source, cap, flushMs]);

  const shown = ndjsonWindow(state.rows, windowSize);

  return (
    <section className="runs-page" data-live-ndjson="">
      <div className="section-head-line">
        <h2 className="section-head" id={LIVE_NDJSON_HEADING_ID}>
          {liveNdjsonHeading(shown.length, state.rows.length)}
        </h2>
        <details className="hint">
          <summary aria-label={LIVE_NDJSON_NOTE_LABEL} className="hint__summary">
            ?
          </summary>
          <div className="hint__panel surface-raised-2">{liveNdjsonNote(handoffPath)}</div>
        </details>
      </div>

      {/* The counts change without saying so, which is silent to a screen reader. */}
      <p aria-live="polite" className="runs-filter__status" role="status">
        {liveNdjsonStatus(state, shown.length)}
      </p>

      {shown.length === 0 ? (
        /* The one dashed treatment in the system, so "specified and empty" looks the
           same here as it does on every other page (§10.10). */
        <div className="runs-empty">
          <p className="runs-empty__headline">{LIVE_NDJSON_EMPTY_HEADLINE}</p>
          <p className="runs-empty__detail">{liveNdjsonEmptyDetail(handoffPath)}</p>
        </div>
      ) : (
        <div
          aria-label={LIVE_NDJSON_REGION_LABEL}
          className="runs-table-frame surface-raised"
          role="region"
          tabIndex={0}
        >
          <div className="runs-diagnostics">
            {shown.map((row) => (
              <article
                className="diagnostic"
                data-ndjson-kind={row.kind}
                data-ndjson-label={row.label}
                data-ndjson-seq={row.seq}
                key={row.seq}
              >
                <p className="diagnostic__title">
                  <span className="diagnostic__at">{row.seq}</span>
                  <span className="diagnostic__code">{row.label}</span>
                  <span className="diagnostic__severity">{row.kind}</span>
                  {row.clamped > 0 ? (
                    <span className="diagnostic__severity">{`+${row.clamped} chars`}</span>
                  ) : null}
                </p>
                {/* The bytes as delivered. `white-space: pre` with a horizontal
                    scroller, so nothing is rewrapped and nothing is invented at a
                    line break. */}
                <code className="diagnostic__remedy">{row.text}</code>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
