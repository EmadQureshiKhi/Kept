/**
 * Canonical snapshot serialisation (design §9.2, R1.8, R8.8).
 *
 * Three functions, one guarantee: for any snapshot `x`,
 * `parseSnapshot(serialiseSnapshot(x))` deep-equals `canonicaliseSnapshot(x)`
 * — which *is* `x` whenever `x` is already in canonical order, as everything
 * `createPromiseGraph` and `kept snapshot` produce is — and re-serialising that
 * parsed value is byte-identical to the first string.
 *
 * Which sounds like a formality until you notice what it buys:
 *
 * - **A readable git diff.** `ledger.snapshot.json` is committed, and the commit
 *   history is part of what a reviewer reads. If key order drifted between
 *   builds, every rebuild would produce a whole-file diff and the one artefact
 *   that proves the ledger is real would be unreviewable. Sorted keys, ordered
 *   arrays and a fixed indent mean a diff shows the promises that changed and
 *   nothing else.
 * - **An honest round trip.** The Ledger imports the JSON and re-parses it
 *   through the schema (design §10.1). If serialisation lost or reshaped a field
 *   the build would render a lie, or fail — R8.8 chooses fail.
 *
 * {@link canonicaliseSnapshot} is the single ordering authority: it deep-clones
 * into canonical array order and rejects anything that would not survive JSON.
 * {@link serialiseSnapshot} runs it and then writes the bytes. Splitting it that
 * way means "what the file says" and "what the value in memory is" are the same
 * object, so the writer of `kept snapshot` (task 3.18) can hold the canonical
 * value it just committed instead of re-parsing its own output.
 *
 * The stringifier is hand-rolled rather than `JSON.stringify(value, null, 2)`
 * for three reasons, each of which is a bug that would otherwise be silent:
 *
 * 1. **Key order.** `JSON.stringify` emits own-property insertion order, and
 *    JavaScript reorders *integer-like* keys ahead of string keys regardless of
 *    insertion. An amendment's `artifacts` map has author-supplied keys; one
 *    named `"0"` would jump the queue and no amount of pre-sorting would hold.
 *    Writing the text directly, from `Object.keys().sort()`, cannot drift.
 * 2. **`Date`.** `JSON.stringify` calls `toJSON()`, so a `Date` that leaked into
 *    a snapshot structure would serialise to a perfectly good ISO string and
 *    come back as a string, silently breaking the deep-equal guarantee. Here it
 *    throws, naming the path. Design §9.2 says no `Date` survives into the
 *    structure; this is what makes that a fact rather than an intention.
 * 3. **`undefined`.** `JSON.stringify` *drops* an object key whose value is
 *    `undefined`, which is exactly how a snapshot loses a field without anyone
 *    noticing. Here it throws, naming the path — the same rule the model's
 *    guards apply with `hasExplicitKey`.
 *
 * Array order is not this module's invention. `createPromiseGraph` already sorts
 * `promises` by id and `edges` by `(kind, from, to)` at construction (design
 * §3.1), so canonical order is inherited for the two arrays that matter most.
 * This module re-establishes it for every array §9.2 gives a natural id, which
 * makes serialisation total: two builds that discovered the same documents,
 * packs, cards or amendments in a different order emit identical bytes.
 *
 * Several arrays are deliberately left in the order they arrive, because their
 * order carries meaning that sorting would destroy: `runs` is newest-first and
 * capped at 20 (§9.1), `diagnostics` is report order (§14), a run's `members` is
 * Kane's plan order, and `degradedReasons`, `providers` and `proposedChanges`
 * are author-ordered.
 */

import { compareGraphEdges, type GraphEdge } from './promise.js';
import { LedgerSnapshotSchema, type LedgerSnapshot } from './snapshot.js';

/** Two spaces, as design §9.2 fixes it. */
const INDENT = '  ';

/** Issue paths beyond this many are summarised rather than printed. */
const MAX_REPORTED_ISSUES = 8;

/**
 * Thrown by {@link parseSnapshot}. Carries the failing field paths separately
 * from the message so a caller can report them without re-parsing the text.
 *
 * Throwing is right *here* and almost nowhere else in this codebase. Design §14
 * reserves exceptions for programming errors and reports states of the world as
 * diagnostics — but a malformed `ledger.snapshot.json` is not a state of the
 * world, it is a broken build artefact. R8.8 requires the Ledger build to fail
 * rather than render a lie, and a build fails by throwing.
 */
export class SnapshotParseError extends Error {
  /** Dotted field paths that failed, e.g. `metrics.designedCoverage`. */
  readonly paths: readonly string[];

  constructor(message: string, paths: readonly string[]) {
    super(message);
    this.name = 'SnapshotParseError';
    this.paths = [...paths];
  }
}

/** Dotted path with `[i]` indices. The empty path renders as `<root>`. */
function formatPath(path: readonly PropertyKey[]): string {
  let text = '';
  for (const key of path) {
    if (typeof key === 'number') text += `[${key}]`;
    else text += text.length === 0 ? String(key) : `.${String(key)}`;
  }
  return text.length === 0 ? '<root>' : text;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'object' || value === null) return '';
  const held = (value as Record<string, unknown>)[field];
  return typeof held === 'string' ? held : '';
}

/**
 * Compare by string fields in order, by code unit. Never `localeCompare`: it
 * reads the ambient locale, and a snapshot serialised in `tr-TR` must be
 * byte-identical to one serialised in `en-US` or the committed file's diff
 * depends on whose laptop ran the build.
 */
function byFields(...fields: readonly string[]): (left: unknown, right: unknown) => number {
  return (left, right) => {
    for (const field of fields) {
      const a = readString(left, field);
      const b = readString(right, field);
      if (a !== b) return a < b ? -1 : 1;
    }
    return 0;
  };
}

/**
 * Array orderings, keyed by shape path. The key is the field path with `[]`
 * standing in for an array index, so `evidence[].artifacts` names the artefact
 * list inside any evidence entry. Absent from this table means "leave alone",
 * which is the safe default: reordering an array whose order means something is
 * a data loss no test would catch.
 */
const ARRAY_ORDER: Readonly<Record<string, (left: unknown, right: unknown) => number>> = {
  promises: byFields('id'),
  /**
   * Delegated to the model rather than restated as `byFields('kind','from','to')`.
   * `compareGraphEdges` ranks `kind` by its position in `GRAPH_EDGE_KINDS`, which
   * today happens to coincide with alphabetical order — so a lexicographic sort
   * would agree, until somebody adds a fourth kind and the two silently diverge.
   * One authority for edge order (design §3.1), used at construction and here.
   */
  edges: (left, right) => compareGraphEdges(left as GraphEdge, right as GraphEdge),
  documents: byFields('id'),
  evidence: byFields('id'),
  'evidence[].artifacts': byFields('kind', 'name'),
  reviewCards: byFields('id'),
  amendments: byFields('id'),
};

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

/**
 * Deep-clone into canonical form, rejecting anything JSON cannot carry
 * faithfully. `path` names the offending field; `shape` is the same path with
 * `[]` for indices, which is the key {@link ARRAY_ORDER} is looked up by.
 */
function canonicalise(value: unknown, path: readonly PropertyKey[], shape: string): unknown {
  if (value === null) return null;

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(
          `${formatPath(path)}: ${String(value)} is not representable in JSON; ` +
            'a snapshot number must be finite',
        );
      }
      // Normalise `-0` to `0`. The two are indistinguishable to every reader of
      // this file, and leaving both spellings in would make an equal snapshot
      // capable of two different byte strings.
      return value === 0 ? 0 : value;
    case 'object':
      break;
    default:
      throw new TypeError(
        `${formatPath(path)}: ${typeof value} is not serialisable into a snapshot` +
          (value === undefined
            ? '; absent fields are explicit null, never undefined (design §9.1)'
            : ''),
      );
  }

  const held = value as object;
  if (held instanceof Date) {
    throw new TypeError(
      `${formatPath(path)}: a Date must not appear in a snapshot; ` +
        'timestamps are ISO 8601 strings throughout (design §9.2)',
    );
  }

  if (Array.isArray(held)) {
    const elementShape = `${shape}[]`;
    const cloned = held.map((element, index) =>
      canonicalise(element, [...path, index], elementShape),
    );
    const comparator = ARRAY_ORDER[shape];
    return comparator === undefined ? cloned : cloned.sort(comparator);
  }

  if (!isPlainObject(held)) {
    const name = (held as { constructor?: { name?: string } }).constructor?.name;
    throw new TypeError(
      `${formatPath(path)}: ${name ?? 'a non-plain object'} is not serialisable into a ` +
        'snapshot; the structure is plain JSON throughout (design §9.2)',
    );
  }

  const record = held as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  // Sorted here as well as at write time, so the returned value's own key order
  // matches the bytes. Nothing depends on it, but a reader inspecting the value
  // in a debugger sees the file.
  for (const key of Object.keys(record).sort()) {
    out[key] = canonicalise(
      record[key],
      [...path, key],
      shape.length === 0 ? key : `${shape}.${key}`,
    );
  }
  return out;
}

/**
 * The canonical form of a snapshot: a deep clone with every id-ordered array in
 * its natural order and every key sorted.
 *
 * This is the fixed point of the round trip. `parseSnapshot(serialiseSnapshot(x))`
 * deep-equals `canonicaliseSnapshot(x)` for every snapshot, and equals `x`
 * itself whenever `x` was already canonical — which is the normal case, because
 * `createPromiseGraph` sorts at construction (design §3.1).
 *
 * Throws a `TypeError` naming the path on a `Date`, an `undefined`, a `NaN`, an
 * `Infinity`, a `Map`, a `Set` or any class instance.
 */
export function canonicaliseSnapshot(snapshot: LedgerSnapshot): LedgerSnapshot {
  return canonicalise(snapshot, [], '') as LedgerSnapshot;
}

/** Write an already-canonical value as JSON text with a two-space indent. */
function write(value: unknown, depth: number): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  const inner = INDENT.repeat(depth + 1);
  const closing = INDENT.repeat(depth);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const parts = value.map((element) => inner + write(element, depth + 1));
    return `[\n${parts.join(',\n')}\n${closing}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length === 0) return '{}';
  const parts = keys.map(
    (key) => `${inner}${JSON.stringify(key)}: ${write(record[key], depth + 1)}`,
  );
  return `{\n${parts.join(',\n')}\n${closing}}`;
}

/**
 * Serialise a snapshot canonically: recursively sorted keys, two-space indent,
 * arrays in their natural id order, and a trailing newline so the committed file
 * is a well-formed text file and `git diff` never reports
 * "\\ No newline at end of file".
 *
 * Not schema-validated here. Serialisation is what the CLI does *after* building
 * a snapshot it already trusts, and validating on the way out would report a
 * cross-field disagreement at the wrong moment — the writer wants to see the
 * bytes it produced, and `kept snapshot` validates explicitly. `parseSnapshot`
 * is the validating direction.
 */
export function serialiseSnapshot(snapshot: LedgerSnapshot): string {
  return `${write(canonicalise(snapshot, [], ''), 0)}\n`;
}

/**
 * Parse and validate snapshot text.
 *
 * Throws {@link SnapshotParseError} naming every failing field path (R8.8). The
 * Ledger calls this at build time from `apps/ledger/lib/snapshot.ts`, so an
 * invalid snapshot fails the deployment rather than rendering a graph that
 * disagrees with its own metrics.
 */
export function parseSnapshot(text: string): LedgerSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new SnapshotParseError(`<root>: ledger snapshot is not valid JSON: ${reason}`, [
      '<root>',
    ]);
  }

  const result = LedgerSnapshotSchema.safeParse(raw);
  if (result.success) return result.data;

  const paths = result.error.issues.map((issue) => formatPath(issue.path));
  const detail = result.error.issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue, index) => {
      const at = paths[index] ?? '<root>';
      // Cross-field messages already lead with their own path (design §9.1); do
      // not print it twice.
      return issue.message.startsWith(`${at}:`) ? issue.message : `${at}: ${issue.message}`;
    })
    .join('; ');
  const more =
    paths.length > MAX_REPORTED_ISSUES ? ` (+${paths.length - MAX_REPORTED_ISSUES} more)` : '';
  throw new SnapshotParseError(
    `ledger snapshot failed schema validation: ${detail}${more}`,
    paths,
  );
}
