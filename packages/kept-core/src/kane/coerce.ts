/**
 * The single coercion site for Kane's two inconsistently-typed numeric fields
 * (design §4.4, A10, R3.10, R3.11, R3.13, R3.14).
 *
 * This file is the **only** place in the repo permitted to read and compare a
 * `result_code`. `packages/kept-core/test/no-raw-result-code.test.ts` enforces
 * that mechanically (R3.12), because the failure mode it prevents is invisible:
 *
 * Our own recorded smoke run (`docs/kane/smoke-run.ndjson`, one `run_end` event)
 * carries the code **twice, in two different types** — the number `100` at the
 * top level and the string `"100"` inside `per_flow_metadata[0]`. Kane 0.8.4 is
 * not consistently typed here, and the skill reference (v0.0.17) documents the
 * field as a string while showing a confirmed product bug as `"740"`. A strict
 * equality check against the number 740 would therefore fire on one of those
 * paths and silently never fire on the other. 740 is the code the entire
 * three-way repair branch keys off, so an un-coerced comparison would leave the
 * branch looking alive while never routing anything.
 *
 * Both accessors take `unknown` and never throw. They read raw `JSON.parse`
 * output from another process, so every shape — `null`, a string, an array, a
 * frozen object with a hostile getter-free prototype — is a state of the world,
 * not a programming error, and design §14.2 reserves exceptions for the latter.
 * Absence and garbage both answer `null`; neither answers `0` or `NaN`.
 */

/** The field both Kane and the skill reference agree on the *name* of. */
export const RESULT_CODE_FIELD = 'result_code';

/**
 * Credit field names in preference order (R3.10). Runtime emits
 * `credits_consumed`; skill v0.0.17 documents `credits`. Both are accepted, the
 * observed name wins. Exported so the property generators of task 2.11 can
 * enumerate the same list the accessor reads.
 */
export const CREDITS_FIELDS = ['credits_consumed', 'credits'] as const;

/**
 * Strict decimal grammar, deliberately narrower than `Number()`.
 *
 * Accepted: `740`, `-12`, `+740`, `10.35`, `740.`, `.5`, `7.4e2`, `1E-3`.
 * Rejected: `''`, `'  '`, `0x2E4`, `0b1`, `0o7`, `1_000`, `Infinity`, `NaN`,
 * `740abc`.
 *
 * The two rejections that matter are the ones a bare built-in gets wrong:
 * `Number('')` is `0` — an empty field would read as result code zero — and
 * `parseInt('740abc')` is `740`, so a truncated or concatenated field would read
 * as a confirmed product bug. Neither built-in is used alone anywhere below.
 *
 * Exponent notation is accepted because `String(someNumber)` produces it for
 * large and small magnitudes, and R3.13's equivalence between a number and "its
 * decimal string" has to hold for whatever `String` actually emits. Alternate
 * radixes are rejected because `String(number)` never produces them: accepting
 * `'0x2E4'` would mean a hex literal silently equalled 740, widening the trusted
 * input space for a representation Kane has never emitted.
 */
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * `unknown` → finite number, or `null`.
 *
 * Only two input types are ever numeric here:
 *
 * - **number** — returned as-is when finite. `NaN` and `±Infinity` answer
 *   `null`: they are not codes, and `NaN` would poison every downstream
 *   comparison by being unequal to itself. Non-integers are returned
 *   **unrounded** — `740.4` stays `740.4` and compares unequal to 740. Rounding
 *   would be this accessor inventing a confirmed-bug verdict out of a value
 *   Kane did not send, which is worse than reporting a code that matches no
 *   rung of the router ladder and falls through to `failure.yaml` triage.
 * - **string** — trimmed, then required to match {@link DECIMAL}. Whitespace
 *   padding is explicitly in scope (`' 740'`, R3.13 and the named edge case in
 *   task 2.11).
 *
 * Everything else answers `null`, and `boolean` is the one worth naming:
 * `Number(true)` is `1`, so accepting booleans would turn a `true` flag into
 * result code 1. `bigint` is rejected for symmetry — `JSON.parse` cannot produce
 * one, so a bigint here means the caller built the object by hand and should
 * pass a number.
 */
function toFiniteNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!DECIMAL.test(trimmed)) return null;
  const parsed = Number(trimmed);
  // Guards overflow only: `'1e999'` matches the grammar and parses to Infinity.
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Own-property read that is safe on anything.
 *
 * `hasOwnProperty` rather than plain indexing, so an inherited `constructor` or
 * `toString` can never be mistaken for a Kane field. Arrays and functions are
 * rejected up front: a stream line that parsed to an array is a shape error, and
 * reading a field off it would be guessing.
 */
function readField(source: unknown, field: string): unknown {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return undefined;
  return Object.prototype.hasOwnProperty.call(source, field)
    ? (source as Record<string, unknown>)[field]
    : undefined;
}

/**
 * The ONLY place `result_code` is turned into a comparable value (R3.11, R3.12).
 *
 * Reads the `result_code` own-property of whatever record it is handed, so the
 * same accessor serves the top-level terminal event and each
 * `per_flow_metadata[]` entry — the two places the recorded smoke run disagrees
 * with itself about the type. Both answer `100` through this function (task
 * 2.15 pins that).
 *
 * Never merged with the process exit code, which stays a separate value all the
 * way to the snapshot (R3.14): `exitMeaning()` in `kane/exit.ts` owns that one.
 *
 * @returns the coerced code, or `null` for an absent, null or non-numeric field.
 */
export function resultCode(source: unknown): number | null {
  return toFiniteNumber(readField(source, RESULT_CODE_FIELD));
}

/**
 * Consumed credits, `credits_consumed` preferred and `credits` accepted (R3.10).
 *
 * Fall-through is on *usability*, not mere presence: a `credits_consumed` of
 * `null`, `''` or `'n/a'` hands over to `credits` rather than answering `null`
 * while a perfectly readable value sits in the sibling field. Only when neither
 * field yields a finite number is the answer `null` — never `0`, because "Kane
 * reported nothing" and "this run was free" are different facts and the free-
 * replay claim of R4.6 is only worth anything if the two stay distinguishable.
 *
 * Fractional values are the norm, not an edge case: the smoke run reports
 * `10.351184999999997`. Nothing is rounded and nothing is range-checked — this
 * is coercion, not validation.
 */
export function credits(source: unknown): number | null {
  for (const field of CREDITS_FIELDS) {
    const value = toFiniteNumber(readField(source, field));
    if (value !== null) return value;
  }
  return null;
}
