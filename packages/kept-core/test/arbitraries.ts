/**
 * Shared fast-check generators for the `@kept/core` property suite
 * (design §Testing Strategy; R3.1, R3.10, R3.13).
 *
 * This file is **not** a test suite. It does not match the runner's
 * `test/**\/*.test.ts` include glob, so vitest never collects it; the root
 * `tsconfig.json` does include `packages/*\/test/**\/*.ts`, so `tsc -b`
 * type-checks it under full strict mode. Its self-test lives next door in
 * `arbitraries.test.ts`, and that suite is the thing that makes this file worth
 * having: a generator that *could in principle* reach a named edge case, once in
 * a million draws, has not covered it. Every named case below is therefore
 * weighted explicitly, labelled on the value it produces, and asserted reachable
 * within a bounded number of draws.
 *
 * ## The twelve named edge cases (design §Testing Strategy)
 *
 * They are quoted from the design because they are "where this system breaks":
 *
 * | # | case | reached by |
 * |---|---|---|
 * | 1 | empty graph | {@link arbGraph} `kind: 'empty'`, {@link arbEmptySnapshot} |
 * | 2 | zero `*_test.md` files | {@link arbGraph} `kind: 'testless'`, {@link arbTestlessSnapshot} |
 * | 3 | `result_code` as `" 740"` | {@link arbResultCodeSlot} `label: 'padded-bug-code'` |
 * | 4 | `credits_consumed` absent, `credits` present | {@link arbCreditsSlot} `label: 'fallback-only'` |
 * | 5 | a stream whose only line is the terminal event | {@link arbStream} `shape: 'terminal-only'` |
 * | 6 | a stream truncated at every index | {@link arbTruncatedStream} `cutAt` |
 * | 7 | a member status outside the four | {@link arbMemberStatus} |
 * | 8 | a citation exactly at EOF and exactly one past it | {@link arbCitation} `placement` |
 * | 9 | a cited line of only whitespace | {@link arbCitation} `placement: 'whitespace-line'` |
 * | 10 | CRLF endings | {@link arbDoc} `eol` |
 * | 11 | a doc with no trailing newline | {@link arbDoc} `trailingNewline: false` |
 * | 12 | `session_dir` absent from `run_end` | {@link arbTerminalEvent} `sessionDir: null` |
 *
 * ## Two rules the generators here obey, and why
 *
 * **No generated terminal event carries a `step` key.** Classification in
 * `kane/ndjson.ts` is `step`-key-*first* (R3.8), so an event carrying both
 * `step` and a terminal `type` classifies as progress and the stream reads
 * crashed. That is deliberate in the parser, and it means a generator that
 * sprinkled `step` onto terminal events would collide properties 8 and 13.
 *
 * **Everything derivable in a snapshot is derived, never generated.** Metric
 * counts come from the promise list, coverage from the counts, edge endpoints
 * from nodes that exist, evidence references from the packs the snapshot
 * carries, the freshness terminal type from the family contract. Generating
 * those independently yields snapshots the five cross-field schema rules reject,
 * and a property whose inputs are mostly invalid tests the rejection path rather
 * than the thing it names.
 *
 * ## Provenance and renames
 *
 * These generators were lifted from the property suites that landed before this
 * file existed, each of which flagged what task 2.11 should absorb. Where two
 * suites named the same idea differently, one name was picked:
 *
 * - `arbFamily` — consolidated from three copies (exit, evidence, snapshot).
 * - `arbFile` / `arbDocFile` → **`arbDocFile`**, pooling all three path pools.
 * - `arbCode` → **`arbResultCodeNumber`** (this module also has `arbExitCode`,
 *   and "code" alone is ambiguous between the two).
 * - `arbPad` → **`arbWhitespacePad`**.
 * - `arbNonNumeric` → **`arbNonNumericWire`**.
 * - `arbDecoration` → **`arbWhitespaceNoise`** (the rename its author suggested).
 * - `arbTrapFields` → **`arbLegacyPathFields`** (likewise).
 * - `buildEvent` / `expected` (credits) → **`creditsWire`** / **`expectedCredits`**.
 *
 * `arbCitation` derives every fact it reports **by construction**: it builds the
 * lines and then joins them, so it never re-implements the §3.3 splitting rules it
 * would otherwise be testing the gate against with a second copy of the gate's own
 * logic. {@link citationSourceFor} composes the generated document map with the
 * gate's own injected reader, so a property gets the production code path with no
 * disk anywhere, and the self-test cross-checks the two — a divergence between the
 * generator's count and the gate's splitting fails there rather than silently
 * making a citation property vacuous.
 */

import fc from 'fast-check';

import {
  ARTIFACT_KINDS,
  ASSURANCE_STATUSES,
  COMMAND_FAMILIES,
  CREDITS_FIELDS,
  KNOWN_EVENT_TYPES,
  MEMBER_END_STATUSES,
  PROVIDER_NAMES,
  REPAIR_BRANCHES,
  REPAIR_STRATEGIES,
  RESULT_CODE_FIELD,
  SNAPSHOT_SCHEMA_VERSION,
  TRIAGE_SIGNAL_FIELDS,
  VERDICTS,
  compareGraphEdges,
  comparePromiseRecords,
  contractFor,
  createPromiseGraph,
  createPromiseRecord,
  designedTestId,
  documentId,
  inMemoryCitationSource,
  promiseId,
  type Citation,
  type CitationSource,
  type CommandFamily,
  type KaneEvent,
  type LedgerSnapshot,
  type MemberEndStatus,
  type PromiseGraph,
  type PromiseRecord,
  type ProviderName,
  type TerminalEvent,
  type TriageSignalField,
  type Verdict,
  type VerdictObject,
  type WireEnum,
} from '@kept/core';

// ---------------------------------------------------------------------------
// 1. Families, exit codes, paths
// ---------------------------------------------------------------------------

/** All three families, every run. Consolidated from three duplicate copies. */
export const arbFamily: fc.Arbitrary<CommandFamily> = fc.constantFrom(...COMMAND_FAMILIES);

/**
 * Every process exit code Node can report, and then some.
 *
 * `fc.integer()` alone spans the full signed range, which is what totality
 * means; the weighted constants keep the named rungs of the §4.5 table hit
 * densely rather than by luck, and the POSIX zero-to-255 band is where a real
 * Kane exit lands. `null` is the signalled case — Node reports
 * `code: null, signal: <sig>` — and lives in the same generator rather than a
 * separate one, so no clause can accidentally be proven over integers only.
 */
export const arbExitCode: fc.Arbitrary<number | null> = fc.oneof(
  { weight: 3, arbitrary: fc.integer() },
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 255 }) },
  { weight: 3, arbitrary: fc.constantFrom(0, 1, 2, 3, 4, 126, 127, 130, 137, 143, 255, -1) },
  { weight: 2, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constantFrom(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) },
);

/** Whether *our* timeout killed the process. */
export const arbKilled: fc.Arbitrary<boolean> = fc.boolean();

/** Exit codes that are not `null`, for clauses stated about integers. */
export const arbIntegerExitCode: fc.Arbitrary<number> = arbExitCode.filter(
  (code): code is number => code !== null,
);

/** One path segment: nothing `path.join` would collapse or re-root. */
export const arbSegment: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), {
    minLength: 1,
    maxLength: 10,
  })
  .map((chars) => chars.join(''));

/**
 * An absolute directory under a fixed `/base` root. The root is fixed so
 * {@link arbTrapPath} is disjoint from it by construction, which is what lets a
 * filesystem clause assert "no touched path mentions a trap value" mechanically.
 */
export const arbAbsoluteDir: fc.Arbitrary<string> = fc
  .array(arbSegment, { minLength: 1, maxLength: 4 })
  .map((segments) => `/${['base', ...segments].join('/')}`);

/** A path a naive implementation might lift off an event. Disjoint from `/base`. */
export const arbTrapPath: fc.Arbitrary<string> = fc
  .array(arbSegment, { minLength: 1, maxLength: 3 })
  .map((segments) => `/${['trap', ...segments, 'evidence'].join('/')}`);

/** Every way `run_end` can fail to carry a usable session directory. */
export const arbAbsentSessionDir: fc.Arbitrary<string | null | undefined> = fc.constantFrom<
  string | null | undefined
>(undefined, null, '', '   ');

/**
 * Path-ish fields that must never be read. `run_dir` and `runDirLegacy` are the
 * legacy pair (R3.18); the rest are plausible names an implementer would invent.
 * Renamed from `arbTrapFields` at its author's suggestion.
 */
export const arbLegacyPathFields: fc.Arbitrary<Record<string, string | undefined>> = fc.record(
  {
    run_dir: arbTrapPath,
    runDirLegacy: arbTrapPath,
    evidence_path: arbTrapPath,
    evidence_dir: arbTrapPath,
    evidencePath: arbTrapPath,
    packDir: arbTrapPath,
  },
  { requiredKeys: [] },
);

/** Repository-relative POSIX document paths, pooled from all three prior suites. */
export const arbDocFile: fc.Arbitrary<string> = fc.constantFrom(
  'README.md',
  'apps/fixture/README.md',
  'apps/fixture/CHANGELOG.md',
  'apps/fixture/app/page.tsx',
  'docs/promises.md',
);

/** `*_test.md` paths — the designed-test side of the graph. */
export const arbTestFile: fc.Arbitrary<string> = fc.constantFrom(
  'tests/cart_subtotal_test.md',
  'tests/cart_discount_test.md',
  'tests/checkout_test.md',
);

/** ISO 8601 instants, as strings. No `Date` ever enters a snapshot (§9.2). */
export const arbInstant: fc.Arbitrary<string> = fc
  .integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2026, 11, 31) })
  .map((ms) => new Date(ms).toISOString());

/** One-based line numbers, including the lower boundary. */
export const arbLine: fc.Arbitrary<number> = fc.integer({ min: 1, max: 5000 });

// ---------------------------------------------------------------------------
// 2. Claims and whitespace noise
// ---------------------------------------------------------------------------

/**
 * Claim words. A deliberately small alphabet of ordinary words plus a few
 * awkward ones — a leading number, inline markdown, an accented character, a
 * capitalised duplicate — so that collisions between generated claims are common
 * enough to exercise the *only if* direction of Property 1 rather than being
 * astronomically unlikely.
 */
export const arbWord: fc.Arbitrary<string> = fc.constantFrom(
  'cart',
  'subtotal',
  'updates',
  'checkout',
  'is',
  'fast',
  'free',
  'shipping',
  '3.5x',
  '**subtotal**',
  'caf\u00e9',
  'Fast',
);

/** A claim as an author would type it: one line, no newline inside. */
export const arbClaim: fc.Arbitrary<string> = fc
  .array(arbWord, { minLength: 1, maxLength: 6 })
  .map((words) => words.join(' '));

/**
 * Claim text that has to survive a byte-for-byte round trip: quotes, a
 * backslash, a newline, a tab, a combining accent, an emoji, a `</script>`
 * sequence and the empty string. The claim is rendered verbatim in the Ledger, so
 * a mangled one is a promise the graph misquotes.
 */
export const arbAwkwardClaim: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    '- The Cart screen shows a running subtotal.',
    '- The Checkout button is disabled while the cart is empty.',
    'A claim with "quotes" and a \\ backslash',
    'A claim with a\ttab and a\nnewline',
    'Caf\u00e9 r\u00e9sum\u00e9 — na\u00efve',
    'A claim with </script> and \u00e9\u0301 and \u{1f9fe}',
    '',
  ),
  fc.string({ maxLength: 40 }),
);

/** Either kind of claim: dense collisions most of the time, awkward text often. */
export const arbAnyClaim: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: arbClaim },
  { weight: 2, arbitrary: arbAwkwardClaim },
);

/**
 * Whitespace and markdown perturbations the claim normaliser deliberately
 * absorbs: runs of spaces and tabs, list and heading markers, a trailing `\r`
 * from a CRLF checkout, surrounding indentation, an NFD decomposition and a
 * zero-width space. Renamed from `arbDecoration` at its author's suggestion.
 */
export const arbWhitespaceNoise: fc.Arbitrary<(claim: string) => string> = fc.constantFrom(
  (claim: string) => claim,
  (claim: string) => `  ${claim}  `,
  (claim: string) => `\t${claim}`,
  (claim: string) => `${claim}\r`,
  (claim: string) => `- ${claim}`,
  (claim: string) => `* ${claim}`,
  (claim: string) => `1. ${claim}`,
  (claim: string) => `> ${claim}`,
  (claim: string) => `## ${claim}`,
  (claim: string) => `- [ ] ${claim}`,
  (claim: string) => claim.split(' ').join('   '),
  (claim: string) => claim.split(' ').join('\t'),
  (claim: string) => claim.normalize('NFD'),
  (claim: string) => `${claim}\u200b`,
);

// ---------------------------------------------------------------------------
// 3. The two coerced wire fields: result_code and credits
// ---------------------------------------------------------------------------

/**
 * Integers Kane could put in the result-code field, biased towards the ones the
 * router ladder reads: the observed and documented codes, the assertion band
 * boundaries, and the zero a naive `Number('')` invents. Renamed from `arbCode`.
 */
export const arbResultCodeNumber: fc.Arbitrary<number> = fc.oneof(
  { weight: 3, arbitrary: fc.integer() },
  { weight: 2, arbitrary: fc.constantFrom(0, 100, 700, 740, 799, -1) },
  { weight: 1, arbitrary: fc.maxSafeInteger() },
);

/**
 * Whitespace padding, the empty string included, so the unpadded string form is
 * covered by the same clause. Renamed from `arbPad`.
 */
export const arbWhitespacePad: fc.Arbitrary<string> = fc.string({
  unit: fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'),
  maxLength: 3,
});

/**
 * Values that are not a number in any form Kane emits.
 *
 * The string filter is written against `Number()` rather than against the
 * accessor's own grammar, **on purpose**: that is what stops the generator
 * inheriting a bug from the code under test. Every string it produces is one
 * `Number()` itself reads as non-finite, or as the zero that makes `''`
 * dangerous. Preserved verbatim from its author's suite. Renamed from
 * `arbNonNumeric`.
 */
export const arbNonNumericWire: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom<unknown>(
    null,
    undefined,
    true,
    false,
    '',
    '   ',
    'abc',
    '740abc',
    'NaN',
    'Infinity',
    '-Infinity',
    '0x2E4', // Number('0x2E4') is the bug code — a hex literal must not read as it.
    '0b1',
    '0o7',
    '1_000',
    '1e999', // Matches a decimal grammar but overflows to Infinity.
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ),
  fc.string().filter((raw) => {
    const trimmed = raw.trim();
    return trimmed === '' || !Number.isFinite(Number(trimmed));
  }),
  fc.array(fc.integer(), { maxLength: 2 }),
  fc.record({ value: fc.integer() }),
);

/**
 * One field's state on the wire, as an intent a property can predict from.
 *
 * `absent` means the key is not present at all — distinct from `unusable`,
 * because both accessors fall through on *usability* rather than on presence,
 * and distinct from a zero reading, which is a real free replay (R4.6).
 */
export type UsableState = {
  readonly kind: 'usable';
  readonly wire: number | string;
  readonly value: number;
};

export type FieldState =
  | { readonly kind: 'absent' }
  | UsableState
  | { readonly kind: 'unusable'; readonly wire: unknown };

/** The absent state, as a value rather than a literal repeated at each use. */
export const ABSENT_FIELD: FieldState = { kind: 'absent' };

/**
 * A finite credit reading in either wire type. Fractional values are the norm —
 * the recorded smoke run reports ten-point-three-five credits — and zero is a
 * free replay rather than a missing reading.
 *
 * Negative zero is normalised to zero because `String(-0)` is `'0'`, so the wire
 * can only ever carry it as a number, and "minus zero credits" is not a fact
 * Kane reports; keeping it would test `Object.is` rather than the accessor.
 */
export const arbUsableCredits: fc.Arbitrary<UsableState> = fc
  .oneof(
    { weight: 3, arbitrary: fc.double({ noNaN: true, noDefaultInfinity: true }) },
    { weight: 1, arbitrary: fc.constantFrom(0, 1, 10.351184999999997) },
  )
  .map((value) => (Object.is(value, -0) ? 0 : value))
  .chain((value) =>
    fc.constantFrom<UsableState>(
      { kind: 'usable', wire: value, value },
      { kind: 'usable', wire: String(value), value },
      { kind: 'usable', wire: `  ${String(value)}  `, value },
    ),
  );

/**
 * Present but unreadable — the shapes that must hand over to the sibling field
 * instead of answering null while a readable value sits next door.
 */
export const arbUnusableCredits: fc.Arbitrary<FieldState> = fc
  .oneof(
    fc.constantFrom<unknown>(null, undefined, '', '   ', 'n/a', 'free', true, false, Number.NaN, [
      1,
    ]),
    fc.string().filter((raw) => {
      const trimmed = raw.trim();
      return trimmed === '' || !Number.isFinite(Number(trimmed));
    }),
  )
  .map((wire) => ({ kind: 'unusable', wire }) as FieldState);

/** One credits field in an independently chosen state. */
export const arbFieldState: fc.Arbitrary<FieldState> = fc.oneof(
  { weight: 2, arbitrary: arbUsableCredits },
  { weight: 1, arbitrary: arbUnusableCredits },
  { weight: 1, arbitrary: fc.constant(ABSENT_FIELD) },
);

/** Both credits fields, each in an independently chosen state. */
export const arbCreditsFields: fc.Arbitrary<readonly [FieldState, FieldState]> = fc.tuple(
  arbFieldState,
  arbFieldState,
);

/** How a credits slot was drawn — the label the self-test proves coverage on. */
export type CreditsLabel = 'fallback-only' | 'neither' | 'any';

/** A credits slot plus the label of the case it was drawn for. */
export interface CreditsSlot {
  readonly label: CreditsLabel;
  readonly states: readonly [FieldState, FieldState];
}

/**
 * The credits slot of a terminal event, with the named edge case weighted rather
 * than left to chance: `credits_consumed` **absent** while `credits` carries a
 * readable number is one of the twelve, and it is the case R14.7 rests on — the
 * submission's measured-credits evidence has to read the same whichever name the
 * recorded run happens to carry.
 */
export const arbCreditsSlot: fc.Arbitrary<CreditsSlot> = fc.oneof(
  {
    weight: 3,
    arbitrary: arbUsableCredits.map(
      (fallback): CreditsSlot => ({ label: 'fallback-only', states: [ABSENT_FIELD, fallback] }),
    ),
  },
  {
    weight: 1,
    arbitrary: fc.constant<CreditsSlot>({ label: 'neither', states: [ABSENT_FIELD, ABSENT_FIELD] }),
  },
  {
    weight: 5,
    arbitrary: arbCreditsFields.map((states): CreditsSlot => ({ label: 'any', states })),
  },
);

/**
 * The wire fields a credits slot puts on an event. Absent means the key is not
 * written at all — which is why this builds a record rather than assigning
 * `undefined`, since `JSON.stringify` would drop the key either way and the two
 * cases would stop being distinguishable before the accessor ever saw them.
 * Renamed from `buildEvent`.
 */
export function creditsWire(states: readonly [FieldState, FieldState]): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  CREDITS_FIELDS.forEach((field, index) => {
    const state = states[index];
    if (state !== undefined && state.kind !== 'absent') fields[field] = state.wire;
  });
  return fields;
}

/** The first usable reading in preference order, or null. Renamed from `expected`. */
export function expectedCredits(states: readonly [FieldState, FieldState]): number | null {
  for (const state of states) {
    if (state.kind === 'usable') return state.value;
  }
  return null;
}

/** How a result-code slot was drawn. */
export type ResultCodeLabel =
  | 'number'
  | 'decimal-string'
  | 'padded-bug-code'
  | 'padded'
  | 'non-numeric'
  | 'absent';

/** A result-code slot: the wire value, its label, and what it must coerce to. */
export interface ResultCodeSlot {
  readonly label: ResultCodeLabel;
  readonly present: boolean;
  readonly wire: unknown;
  readonly expected: number | null;
}

/** The confirmed-product-bug code, padded exactly as the design names it. */
const PADDED_BUG_CODE = ' 740';

/**
 * The result-code slot of a terminal event: emitted as a **number or a string**,
 * as R3.13 and the recorded run demand — the field is typed inconsistently
 * *within one event*, number at the top level and string inside
 * `per_flow_metadata[0]`.
 *
 * The whitespace-padded bug code is one of the twelve named cases and gets its
 * own weighted arm, because it is the value the entire three-way repair branch
 * keys off and a padded string is the form a hand-sealed pack or a shell pipeline
 * produces.
 */
export const arbResultCodeSlot: fc.Arbitrary<ResultCodeSlot> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constant<ResultCodeSlot>({
      label: 'padded-bug-code',
      present: true,
      wire: PADDED_BUG_CODE,
      expected: 740,
    }),
  },
  {
    weight: 4,
    arbitrary: arbResultCodeNumber.map(
      (code): ResultCodeSlot => ({ label: 'number', present: true, wire: code, expected: code }),
    ),
  },
  {
    weight: 3,
    arbitrary: arbResultCodeNumber.map(
      (code): ResultCodeSlot => ({
        label: 'decimal-string',
        present: true,
        wire: String(code),
        expected: code,
      }),
    ),
  },
  {
    weight: 2,
    arbitrary: fc
      .tuple(arbResultCodeNumber, arbWhitespacePad, arbWhitespacePad)
      .map(([code, left, right]): ResultCodeSlot => ({
        label: 'padded',
        present: true,
        wire: `${left}${String(code)}${right}`,
        expected: code,
      })),
  },
  {
    weight: 2,
    arbitrary: arbNonNumericWire.map(
      (wire): ResultCodeSlot => ({ label: 'non-numeric', present: true, wire, expected: null }),
    ),
  },
  {
    weight: 2,
    arbitrary: fc.constant<ResultCodeSlot>({
      label: 'absent',
      present: false,
      wire: undefined,
      expected: null,
    }),
  },
);

// ---------------------------------------------------------------------------
// 4. In-memory documents and citations (design §3.3)
// ---------------------------------------------------------------------------

/** The two line terminators a checkout can produce. */
export type LineEnding = '\n' | '\r\n';

/**
 * A generated document, and the facts about it that a citation case needs.
 *
 * `lineCount` is `lines.length` **by construction**: the generator builds the
 * lines and then joins them, so it never has to re-derive a count by
 * re-implementing the §3.3 splitting rules — which would mean testing the gate
 * against a second copy of its own logic. Every generated line is non-empty,
 * which is what makes the identity hold for both terminator styles and with or
 * without a trailing newline: the only element `splitLines` drops is a trailing
 * empty one, and a trailing `\r` belongs to the terminator rather than the line.
 */
export interface GeneratedDoc {
  /** Repository-relative POSIX path. */
  readonly file: string;
  /** The citable lines, in order. Never empty strings, never containing `\n`. */
  readonly lines: readonly string[];
  readonly eol: LineEnding;
  readonly trailingNewline: boolean;
  /** The bytes a reader would get back. */
  readonly content: string;
  /** How many citable lines the document has. Equals `lines.length`. */
  readonly lineCount: number;
}

/** Ordinary document lines. Non-empty, and free of any line terminator. */
const DOC_LINE_POOL: readonly string[] = [
  '# Kepler Coffee',
  '- The Cart screen shows a running subtotal.',
  '- Checkout is disabled while the cart is empty.',
  'Shipping is free over thirty pounds.',
  '  indented prose with a trailing space ',
  '> a blockquote claim',
  '1. an ordered claim',
  '**subtotal** updates 3.5x faster',
  'caf\u00e9 r\u00e9sum\u00e9 — na\u00efve',
  '<!-- @verifies apps/fixture/README.md:16 -->',
];

/**
 * Lines that are whitespace and nothing else — one of the twelve named cases.
 * A cited line of only whitespace is admissible content, and the gate must copy
 * it verbatim rather than treating an all-space line as a missing one.
 */
const WHITESPACE_LINE_POOL: readonly string[] = ['   ', '\t', ' \t ', '\u00a0'];

const arbDocLine: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom(...DOC_LINE_POOL) },
  { weight: 2, arbitrary: fc.constantFrom(...WHITESPACE_LINE_POOL) },
);

/** Assemble the bytes of a document from its lines. */
function buildDoc(
  file: string,
  lines: readonly string[],
  eol: LineEnding,
  trailingNewline: boolean,
): GeneratedDoc {
  const body = lines.join(eol);
  const content = lines.length > 0 && trailingNewline ? `${body}${eol}` : body;
  return { file, lines, eol, trailingNewline, content, lineCount: lines.length };
}

/**
 * A whole document, including the two named byte-level cases: **CRLF endings**
 * and **no trailing newline**. Both are weighted rather than rare, because both
 * are ordinary states of a real checkout and both are where an off-by-one in line
 * counting hides. The zero-line document is included at low weight: it has no
 * citable line at all, so citing line one of it is legitimately out of range.
 */
export const arbDoc: fc.Arbitrary<GeneratedDoc> = fc
  .record({
    file: arbDocFile,
    lines: fc.oneof(
      { weight: 7, arbitrary: fc.array(arbDocLine, { minLength: 1, maxLength: 8 }) },
      { weight: 1, arbitrary: fc.constant<readonly string[]>([]) },
    ),
    eol: fc.oneof(
      { weight: 3, arbitrary: fc.constant<LineEnding>('\n') },
      { weight: 2, arbitrary: fc.constant<LineEnding>('\r\n') },
    ),
    trailingNewline: fc.oneof(
      { weight: 3, arbitrary: fc.constant(true) },
      { weight: 2, arbitrary: fc.constant(false) },
    ),
  })
  .map((seed) => buildDoc(seed.file, seed.lines, seed.eol, seed.trailingNewline));

/**
 * Where a generated citation points. `at-eof` and `one-past-eof` are the two
 * named cases and they are the classic off-by-one: a three-line file ending in a
 * newline has three lines, so line three is the last real line and line four
 * does not exist.
 */
export type CitationPlacement =
  | 'in-range'
  | 'at-eof'
  | 'one-past-eof'
  | 'past-eof'
  | 'whitespace-line'
  | 'file-missing';

/** A citation, the documents it is over, and what the truth about it is. */
export interface CitationCase {
  /**
   * The in-memory document map: repository-relative path to contents. This is
   * what an injected reader is built from, so a property over citations needs no
   * disk anywhere.
   */
  readonly documents: Readonly<Record<string, string>>;
  /** The document the citation points into, whether or not the map carries it. */
  readonly doc: GeneratedDoc;
  /** The citation itself: file, line, text (design §3.1). */
  readonly citation: Citation;
  readonly placement: CitationPlacement;
  /** Whether the cited line exists in the cited document. */
  readonly inRange: boolean;
  /** The verbatim cited line, or null when the citation resolves to nothing. */
  readonly citedLine: string | null;
  /** Whether `citation.text` already agrees with the file (R1.3 overwrites it). */
  readonly textAgrees: boolean;
}

/** Text that disagrees with the file — what §3.3 has to overwrite. */
const arbDriftedText: fc.Arbitrary<string> = fc.constantFrom(
  'a claim that was edited after the citation was recorded',
  '',
  '- The Cart screen shows a running total.',
  '   ',
);

const arbPlacement: fc.Arbitrary<CitationPlacement> = fc.oneof(
  { weight: 4, arbitrary: fc.constant<CitationPlacement>('in-range') },
  { weight: 3, arbitrary: fc.constant<CitationPlacement>('at-eof') },
  { weight: 3, arbitrary: fc.constant<CitationPlacement>('one-past-eof') },
  { weight: 2, arbitrary: fc.constant<CitationPlacement>('whitespace-line') },
  { weight: 1, arbitrary: fc.constant<CitationPlacement>('past-eof') },
  { weight: 1, arbitrary: fc.constant<CitationPlacement>('file-missing') },
);

/** Force a whitespace-only line into a document, and say which line it is. */
function withWhitespaceLine(doc: GeneratedDoc): { doc: GeneratedDoc; line: number } {
  const existing = doc.lines.findIndex((line) => line.trim().length === 0);
  if (existing >= 0) return { doc, line: existing + 1 };
  const lines = doc.lines.length === 0 ? ['   '] : [...doc.lines];
  lines[0] = '   ';
  return { doc: buildDoc(doc.file, lines, doc.eol, doc.trailingNewline), line: 1 };
}

/**
 * A citation over generated in-memory documents (design §Testing Strategy).
 *
 * Independent of `model/admission.ts` on purpose: the gate is the thing under
 * test in Property 2, so the generator carries its own document map and derives
 * every fact about it from the lines it built. Four of the twelve named cases live
 * here — a citation exactly at EOF, one exactly past it, a cited line of only
 * whitespace, and the byte-level pair of CRLF endings and a missing trailing
 * newline that {@link arbDoc} supplies.
 */
export const arbCitation: fc.Arbitrary<CitationCase> = fc
  .record({
    doc: arbDoc,
    others: fc.array(arbDoc, { maxLength: 2 }),
    placement: arbPlacement,
    inRangeLine: fc.integer({ min: 1, max: 8 }),
    beyond: fc.integer({ min: 2, max: 40 }),
    textAgrees: fc.boolean(),
    drifted: arbDriftedText,
  })
  .map((seed): CitationCase => {
    let doc = seed.doc;
    let line: number;
    switch (seed.placement) {
      case 'whitespace-line': {
        const forced = withWhitespaceLine(doc);
        doc = forced.doc;
        line = forced.line;
        break;
      }
      case 'at-eof':
        // A zero-line document has no last line, so the honest reading of
        // "exactly at EOF" for it is line one, which is also one past its end.
        line = Math.max(doc.lineCount, 1);
        break;
      case 'one-past-eof':
        line = doc.lineCount + 1;
        break;
      case 'past-eof':
        line = doc.lineCount + seed.beyond;
        break;
      case 'in-range':
      case 'file-missing':
        line = doc.lineCount === 0 ? 1 : ((seed.inRangeLine - 1) % doc.lineCount) + 1;
        break;
    }

    const present = seed.placement !== 'file-missing';
    const resolved = present && line <= doc.lineCount ? (doc.lines[line - 1] ?? null) : null;
    const text = resolved !== null && seed.textAgrees ? resolved : seed.drifted;

    const documents: Record<string, string> = {};
    for (const other of seed.others) documents[other.file] = other.content;
    if (present) documents[doc.file] = doc.content;
    else delete documents[doc.file];

    return {
      documents,
      doc,
      citation: { file: doc.file, line, text },
      placement: seed.placement,
      inRange: resolved !== null,
      citedLine: resolved,
      textAgrees: resolved !== null && seed.textAgrees,
    };
  });

/**
 * The gate's own injected reader, over a generated document map. This is what
 * makes a citation property run the production code path with no disk anywhere —
 * only `read` differs from a real repository.
 */
export function citationSourceFor(generated: CitationCase): CitationSource {
  return inMemoryCitationSource(generated.documents);
}

// ---------------------------------------------------------------------------
// 5. Promises and graphs
// ---------------------------------------------------------------------------

/** The four verdicts, from the vocabulary rather than hand-listed literals. */
export const arbVerdict: fc.Arbitrary<Verdict> = fc.constantFrom(...VERDICTS);

/** A non-empty provider list in the canonical baseline-then-enrichment order. */
export const arbProviders: fc.Arbitrary<readonly ProviderName[]> = fc
  .subarray([...PROVIDER_NAMES], { minLength: 1 })
  .map((names) => PROVIDER_NAMES.filter((name) => names.includes(name)));

/**
 * A promise whose verdict and designed-test reference are chosen
 * **independently**, so the two disagree exactly as they do once the router has
 * run: a designed promise whose test failed is `red` and still designed, and a
 * promise with no test at all is `undesigned`. Generating the verdict *from* the
 * reference would quietly make Property 21's designed-count clause tautological.
 */
export const arbPromise: fc.Arbitrary<PromiseRecord> = fc
  .record({
    claim: arbClaim,
    file: arbDocFile,
    line: fc.integer({ min: 1, max: 500 }),
    verdict: arbVerdict,
    designed: fc.boolean(),
    testPath: arbTestFile,
    testId: fc.option(fc.constantFrom('T-1', 'T-2', 'T-3'), { nil: null }),
    providers: arbProviders,
  })
  .map((input) =>
    createPromiseRecord({
      claim: input.claim,
      citation: { file: input.file, line: input.line, text: input.claim },
      designedTest: input.designed ? { path: input.testPath, testId: input.testId } : null,
      verdict: input.verdict,
      providers: input.providers,
    }),
  );

/** A promise that no `*_test.md` designs — the zero-test-file half of the graph. */
export const arbUndesignedPromise: fc.Arbitrary<PromiseRecord> = fc
  .record({ claim: arbClaim, file: arbDocFile, line: fc.integer({ min: 1, max: 500 }) })
  .map((input) =>
    createPromiseRecord({
      claim: input.claim,
      citation: { file: input.file, line: input.line, text: input.claim },
      designedTest: null,
      providers: ['baseline'],
    }),
  );

/**
 * Build the promises a document yields, the way a provider would: walk the lines
 * in order, one promise per claim, line numbers assigned by position. This is the
 * perturbation harness Property 1 uses — the same claims at a different starting
 * line must derive the same identifiers.
 */
export function buildPromises(
  file: string,
  claims: readonly string[],
  firstLine = 1,
): PromiseRecord[] {
  return claims.map((claim, index) =>
    createPromiseRecord({
      claim,
      citation: { file, line: firstLine + index, text: claim },
      providers: ['baseline'],
    }),
  );
}

/** Which of the three graph shapes a draw is. */
export type GraphKind = 'empty' | 'testless' | 'mixed';

/** A graph plus the label of the shape it was drawn for. */
export interface GraphCase {
  readonly kind: GraphKind;
  readonly graph: PromiseGraph;
}

/**
 * Any graph, degraded or not, with **both** structural edge cases weighted:
 * the **empty graph**, where a divide-by-zero in coverage hides (R9.3), and a
 * graph with promises but **zero `*_test.md` files**, which is the honest state of
 * a repository whose suite has not been designed yet and the state the
 * undesigned-count debt metric exists to report (R5.8).
 */
export const arbGraphCase: fc.Arbitrary<GraphCase> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc
      .record({ degraded: fc.boolean() })
      .map((seed): GraphCase => ({
        kind: 'empty',
        graph: createPromiseGraph({
          degraded: seed.degraded,
          degradedReasons: seed.degraded ? ['enrichment-timeout'] : [],
        }),
      })),
  },
  {
    weight: 3,
    arbitrary: fc
      .record({
        promises: fc.array(arbUndesignedPromise, { minLength: 1, maxLength: 8 }),
        degraded: fc.boolean(),
      })
      .map((seed): GraphCase => ({
        kind: 'testless',
        graph: createPromiseGraph({
          promises: seed.promises,
          degraded: seed.degraded,
          degradedReasons: seed.degraded ? ['enrichment-timeout'] : [],
        }),
      })),
  },
  {
    weight: 7,
    arbitrary: fc
      .record({
        promises: fc.array(arbPromise, { minLength: 0, maxLength: 12 }),
        degraded: fc.boolean(),
      })
      .map((seed): GraphCase => ({
        kind: 'mixed',
        graph: createPromiseGraph({
          promises: seed.promises,
          degraded: seed.degraded,
          degradedReasons: seed.degraded ? ['enrichment-timeout'] : [],
        }),
      })),
  },
);

/** Any graph, including the empty one. The plain generator most properties want. */
export const arbGraph: fc.Arbitrary<PromiseGraph> = arbGraphCase.map((drawn) => drawn.graph);

/**
 * A graph whose promises all carry one verdict — the all-proven and all-red
 * extremes, where a ratio of exactly one or exactly zero must still be a number
 * and not a null.
 */
export const arbUniformGraph: fc.Arbitrary<PromiseGraph> = fc
  .record({
    verdict: arbVerdict,
    promises: fc.array(arbPromise, { minLength: 1, maxLength: 8 }),
    designed: fc.boolean(),
    degraded: fc.boolean(),
  })
  .map((input) =>
    createPromiseGraph({
      promises: input.promises.map((promise) =>
        createPromiseRecord({
          claim: promise.claim,
          citation: promise.citation,
          designedTest: input.designed ? { path: 'tests/cart_subtotal_test.md', testId: 'T-1' } : null,
          verdict: input.verdict,
          providers: promise.providers,
        }),
      ),
      degraded: input.degraded,
    }),
  );

// ---------------------------------------------------------------------------
// 6. Ledger snapshots — schema-valid by construction (design §9.1, §9.2)
// ---------------------------------------------------------------------------

/** Keep the first occurrence of each key, in order. */
export function dedupeBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

type SnapshotEvidencePack = LedgerSnapshot['evidence'][number];
type SnapshotArtifactValue = SnapshotEvidencePack['artifacts'][number];
type SnapshotPromiseValue = LedgerSnapshot['promises'][number];
type SnapshotEdgeValue = LedgerSnapshot['edges'][number];
type SnapshotDiagnosticValue = LedgerSnapshot['diagnostics'][number];

export const arbEvidencePackId: fc.Arbitrary<string> = fc.constantFrom(
  'ev_20260820T184011Z',
  'ev_20260821T090000Z',
);

/** One artefact of a pack. Its public path is derived from the pack it is in. */
export function arbArtifact(packId: string): fc.Arbitrary<SnapshotArtifactValue> {
  return fc
    .record({
      kind: fc.constantFrom(...ARTIFACT_KINDS),
      name: fc.constantFrom('annotated.png', 'failure.yaml', 'step-3.png', 'console.log'),
      bytes: fc.option(fc.nat({ max: 1_000_000 }), { nil: null }),
    })
    .map((artifact) => ({
      kind: artifact.kind,
      name: artifact.name,
      publicPath: `/evidence/${packId}/${artifact.name}`,
      bytes: artifact.bytes,
    }));
}

/**
 * One evidence pack. Artefacts are deduplicated on the canonical key so two
 * never collide in a way that makes the sort unstable between two orderings of
 * the same input, and they are emitted in canonical `(kind, name)` order because
 * this generator produces the *canonical* form — the one `kept snapshot` writes.
 */
export function arbEvidence(packId: string): fc.Arbitrary<SnapshotEvidencePack> {
  return fc
    .record({
      kind: fc.constantFrom('run' as const, 'testrun' as const),
      sealedAt: fc.option(arbInstant, { nil: null }),
      artifacts: fc.array(arbArtifact(packId), { maxLength: 4 }),
    })
    .map((pack) => ({
      id: packId,
      kind: pack.kind,
      sealedAt: pack.sealedAt,
      publicPath: `/evidence/${packId}/`,
      artifacts: dedupeBy(pack.artifacts, (artifact) => `${artifact.kind}\u0000${artifact.name}`).sort(
        (left, right) =>
          left.kind !== right.kind
            ? left.kind < right.kind
              ? -1
              : 1
            : left.name < right.name
              ? -1
              : left.name > right.name
                ? 1
                : 0,
      ),
    }));
}

/** The seed of one snapshot promise, before anything derivable is derived. */
export interface PromiseDraft {
  readonly file: string;
  readonly claim: string;
  readonly line: number;
  readonly designedTestPath: string | null;
  readonly testId: string | null;
  readonly verdict: Verdict;
  readonly withVerdictSource: boolean;
  readonly withRepair: boolean;
  readonly packIndex: number | null;
  readonly credits: number | null;
  readonly providers: readonly ProviderName[];
}

const arbDraftShape = {
  file: arbDocFile,
  claim: arbAnyClaim,
  line: fc.integer({ min: 1, max: 400 }),
  testId: fc.option(fc.constantFrom('T-1', 'T-3', 'T-7'), { nil: null }),
  verdict: arbVerdict,
  withVerdictSource: fc.boolean(),
  withRepair: fc.boolean(),
  packIndex: fc.option(fc.nat({ max: 1 }), { nil: null }),
  credits: fc.option(fc.nat({ max: 50 }), { nil: null }),
  providers: arbProviders,
} as const;

export const arbPromiseDraft: fc.Arbitrary<PromiseDraft> = fc.record({
  ...arbDraftShape,
  designedTestPath: fc.option(arbTestFile, { nil: null }),
});

/** A draft no `*_test.md` designs — the zero-test-file case, in snapshot form. */
export const arbTestlessPromiseDraft: fc.Arbitrary<PromiseDraft> = fc.record({
  ...arbDraftShape,
  designedTestPath: fc.constant(null),
});

export const arbDiagnostic: fc.Arbitrary<SnapshotDiagnosticValue> = fc.record({
  code: fc.constantFrom('ndjson-parse', 'kane-not-found', 'citation-out-of-range'),
  severity: fc.constantFrom('info' as const, 'warn' as const, 'error' as const),
  message: fc.string({ minLength: 1, maxLength: 40 }).map((text) => text.trim() || 'message'),
  file: fc.option(arbDocFile, { nil: null }),
  line: fc.option(fc.integer({ min: 1, max: 400 }), { nil: null }),
  at: arbInstant,
});

interface SnapshotSeed {
  readonly drafts: readonly PromiseDraft[];
  readonly packIds: readonly string[];
  readonly degraded: boolean;
  readonly degradedReasons: readonly string[];
  readonly fresh: CommandFamily | null;
  readonly freshAt: string;
  readonly generatedAt: string;
  readonly kaneCli: string | null;
  readonly diagnostics: readonly SnapshotDiagnosticValue[];
}

function buildSnapshot(
  seed: SnapshotSeed,
  evidence: readonly SnapshotEvidencePack[],
): LedgerSnapshot {
  const packIds = evidence.map((pack) => pack.id);

  const byId = new Map<string, SnapshotPromiseValue>();
  for (const draft of seed.drafts) {
    const id = promiseId(draft.file, draft.claim);
    // A promise id is a function of (file, claim), so two drafts can collide.
    // The graph merges them into one promise; keeping the first *is* that merge.
    if (byId.has(id)) continue;
    const packId =
      draft.packIndex === null
        ? null
        : (packIds[draft.packIndex % Math.max(packIds.length, 1)] ?? null);
    const designedTest =
      draft.designedTestPath === null
        ? null
        : { path: draft.designedTestPath, testId: draft.testId };
    byId.set(id, {
      id,
      claim: draft.claim,
      citation: { file: draft.file, line: draft.line, text: draft.claim },
      designedTest,
      verdict: draft.verdict,
      verdictSource: draft.withVerdictSource
        ? {
            runId: 'tr_20260820T184011Z',
            terminalEventType: 'testrun_done',
            at: seed.freshAt,
            memberStatus: MEMBER_END_STATUSES[0],
            resultCode: 740,
            reasonCode: 'failure.product_bug',
          }
        : null,
      repair: draft.withRepair
        ? {
            branch: REPAIR_BRANCHES[0] ?? 'code-break',
            strategy: REPAIR_STRATEGIES[0] ?? 'resultCode740',
            severity: 'high',
            category: 'functional',
            confidence: 0.9,
            evidenceRef: packId === null ? null : `evidence/${packId}/failure.yaml`,
            rationale: 'generated',
          }
        : null,
      evidencePackId: packId,
      providers: [...draft.providers],
      credits: draft.credits,
    });
  }

  const promises = [...byId.values()].sort(comparePromiseRecords);

  const documents = dedupeBy(
    promises.map((promise) => promise.citation.file),
    (file) => file,
  )
    .map((file) => ({
      id: documentId(file),
      file,
      claimCount: promises.filter((promise) => promise.citation.file === file).length,
    }))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  const rawEdges = promises.flatMap((promise) => {
    const edges: SnapshotEdgeValue[] = [
      { from: documentId(promise.citation.file), to: promise.id, kind: 'cites' },
    ];
    if (promise.designedTest !== null) {
      edges.push({
        from: promise.id,
        to: designedTestId(promise.designedTest.path),
        kind: 'designed' as const,
      });
    }
    if (promise.evidencePackId !== null) {
      edges.push({ from: promise.id, to: promise.evidencePackId, kind: 'evidence' as const });
    }
    return edges;
  });
  const edges = dedupeBy(rawEdges, (edge) => `${edge.kind}\u0000${edge.from}\u0000${edge.to}`).sort(
    compareGraphEdges,
  );

  const total = promises.length;
  const designedCount = promises.filter((promise) => promise.designedTest !== null).length;
  const count = (verdict: Verdict): number =>
    promises.filter((promise) => promise.verdict === verdict).length;
  const provenCount = count('proven');

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: seed.generatedAt,
    generator: { kept: '0.0.0', kaneCli: seed.kaneCli },
    degraded: seed.degraded,
    degradedReasons: [...seed.degradedReasons],
    freshness:
      seed.fresh === null
        ? { terminalEventAt: null, terminalEventType: null, commandFamily: null }
        : {
            terminalEventAt: seed.freshAt,
            terminalEventType: contractFor(seed.fresh).terminalType,
            commandFamily: seed.fresh,
          },
    metrics: {
      totalPromises: total,
      designedCount,
      provenCount,
      redCount: count('red'),
      staleCount: count('stale'),
      undesignedCount: count('undesigned'),
      designedCoverage: total === 0 ? null : designedCount / total,
      provenCoverage: total === 0 || seed.degraded ? null : provenCount / total,
    },
    promises,
    edges,
    documents,
    evidence: [...evidence].sort((left, right) => (left.id < right.id ? -1 : 1)),
    runs: [],
    reviewCards: [],
    amendments: [],
    // Spread each entry: `fc.record` may hand back a null-prototype object, and
    // `toStrictEqual` treats one of those as unequal to a parsed plain object.
    diagnostics: seed.diagnostics.map((entry) => ({ ...entry })),
  };
}

/**
 * A schema-valid snapshot over a supplied draft generator.
 *
 * Exposed as a **factory** so the empty graph and the zero-test-file graph fall
 * out of it for free rather than being a second, divergent generator.
 */
export function snapshotArb(
  drafts: fc.Arbitrary<readonly PromiseDraft[]>,
): fc.Arbitrary<LedgerSnapshot> {
  return fc
    .record({
      drafts,
      packIds: fc.uniqueArray(arbEvidencePackId, { maxLength: 2 }),
      degraded: fc.boolean(),
      degradedReasons: fc.array(fc.constantFrom('kane-cli not found', 'stream crashed'), {
        maxLength: 2,
      }),
      fresh: fc.option(arbFamily, { nil: null }),
      freshAt: arbInstant,
      generatedAt: arbInstant,
      kaneCli: fc.option(fc.constantFrom('0.8.4'), { nil: null }),
      diagnostics: fc.array(arbDiagnostic, { maxLength: 3 }),
    })
    .chain((seed) => {
      const packs: fc.Arbitrary<readonly SnapshotEvidencePack[]> =
        seed.packIds.length === 0
          ? fc.constant<readonly SnapshotEvidencePack[]>([])
          : fc.tuple(...seed.packIds.map((id) => arbEvidence(id)));
      return packs.map((evidence) => buildSnapshot(seed, evidence));
    });
}

/** The empty graph: zero promises, both coverage figures null (R9.3). */
export const arbEmptySnapshot: fc.Arbitrary<LedgerSnapshot> = snapshotArb(fc.constant([]));

/** Promises, but zero `*_test.md` files: designed coverage is exactly zero. */
export const arbTestlessSnapshot: fc.Arbitrary<LedgerSnapshot> = snapshotArb(
  fc.array(arbTestlessPromiseDraft, { minLength: 1, maxLength: 6 }),
);

/** Any snapshot, with both structural edge cases weighted in. */
export const arbSnapshot: fc.Arbitrary<LedgerSnapshot> = fc.oneof(
  { weight: 2, arbitrary: arbEmptySnapshot },
  { weight: 2, arbitrary: arbTestlessSnapshot },
  { weight: 6, arbitrary: snapshotArb(fc.array(arbPromiseDraft, { maxLength: 6 })) },
);

/** Rebuild a value with its object keys inserted in reverse-sorted order. */
export function reorderKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderKeys);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort().reverse()) out[key] = reorderKeys(record[key]);
  return out;
}

/** Reverse every array the canonical order fixes, at every level it appears. */
export function shuffleOrderedArrays(snapshot: LedgerSnapshot): LedgerSnapshot {
  return {
    ...snapshot,
    promises: [...snapshot.promises].reverse(),
    edges: [...snapshot.edges].reverse(),
    documents: [...snapshot.documents].reverse(),
    evidence: [...snapshot.evidence]
      .reverse()
      .map((pack) => ({ ...pack, artifacts: [...pack.artifacts].reverse() })),
  };
}

// ---------------------------------------------------------------------------
// 7. The Kane event surface (design §4.3)
// ---------------------------------------------------------------------------

/**
 * A `verdict` object as it arrives on the wire, with `confirmed` and
 * `confidence` drawn from the **widest plausible wire union** rather than from
 * the settled shape the router normalises them into. That widening is the whole
 * point: a branch that treated `confirmed` as a boolean without normalising it
 * would fire on one of Kane's typings and silently never fire on the other.
 *
 * At least one of the six recognised fields is always present, because
 * `isVerdictObject` recognises an object by those fields and handing the router
 * `{}` would let its first rule fire — an absent `confirmed` reads as
 * not-confirmed — on no evidence at all. {@link arbUnrecognisableVerdictObject}
 * covers that shape separately, where it belongs.
 */
export const arbVerdictObject: fc.Arbitrary<VerdictObject> = fc
  .record(
    {
      confirmed: fc.oneof(
        fc.boolean(),
        fc.constantFrom<boolean | string | number | null>('true', 'false', 'yes', 1, 0, null),
      ),
      family: fc.option(fc.constantFrom('functional', 'visual', 'data'), { nil: null }),
      category: fc.option(fc.constantFrom('product_bug', 'selector', 'assertion'), { nil: null }),
      severity: fc.oneof(
        fc.constantFrom<string | number | null>('high', 'medium', 'low', 1, 2, null),
      ),
      one_liner: fc.option(fc.constantFrom('the subtotal does not update', 'timed out'), {
        nil: null,
      }),
      confidence: fc.oneof(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom<number | string | null>('0.9', ' 0.42 ', 'high', null),
      ),
      // Unannounced fields survive the trip (R3.9).
      spike_note: fc.constantFrom('recorded once, in a reference document'),
    },
    { requiredKeys: [] },
  )
  .chain((partial) =>
    // Force one recognised field so the object is recognisable as a verdict.
    fc
      .constantFrom('confirmed' as const, 'category' as const, 'one_liner' as const)
      .map((forced): VerdictObject => {
        const forcedValue: Record<string, unknown> =
          forced === 'confirmed'
            ? { confirmed: true }
            : forced === 'category'
              ? { category: 'product_bug' }
              : { one_liner: 'the subtotal does not update' };
        return { ...partial, ...forcedValue };
      }),
  );

/** An object carrying none of the six fields — not a verdict, and must not read as one. */
export const arbUnrecognisableVerdictObject: fc.Arbitrary<Record<string, unknown>> =
  fc.constantFrom<Record<string, unknown>>(
    {},
    { note: 'nothing routable here' },
    { CONFIRMED: true },
    { verdict: 'confirmed' },
  );

/**
 * `testrun_member_end.status` — the four observed values **and values outside
 * them**, which is one of the twelve named cases. Four, not two: `broken` is not
 * an asserted failure and `interrupted` proved nothing at all, and a fifth value
 * from a later release must map somewhere rather than crash the mapping.
 */
export const arbMemberStatus: fc.Arbitrary<WireEnum<MemberEndStatus>> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...MEMBER_END_STATUSES) },
  {
    weight: 3,
    arbitrary: fc.constantFrom<string>(
      'skipped',
      'errored',
      'timed_out',
      'PASSED',
      'passed ',
      'pending',
      '',
    ),
  },
);

/** The six documented Assurance terminal statuses, plus values outside them. */
export const arbAssuranceStatus: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom(...ASSURANCE_STATUSES) },
  { weight: 1, arbitrary: fc.constantFrom('cancelled', 'DONE', 'unknown') },
);

/** Unannounced fields, which every event has to carry through untouched (R3.9). */
export const arbUnknownExtras: fc.Arbitrary<Record<string, unknown>> = fc.record(
  {
    v: fc.constant(1),
    nested_payload: fc.constant({ shape: 'not pinned by observation' }),
    later_release_field: fc.constantFrom('new in 0.9.0', 42, true),
  },
  { requiredKeys: [] },
);

/** Cast site for a generated wire object. One helper, so the cast is countable. */
function asEvent(record: Record<string, unknown>): KaneEvent {
  return record as unknown as KaneEvent;
}

/**
 * A progress line (R3.8): `{step, status, remark}`, and **no `type` at all** in
 * the shape the recorded smoke run actually carries. The documented `run_start`,
 * `step_start` and `step_end` events do not exist in 0.8.4, so structural
 * recognition on the `step` key is the only classification available.
 */
export const arbProgressEvent: fc.Arbitrary<KaneEvent> = fc
  .record(
    {
      step: fc.oneof(fc.integer({ min: 1, max: 40 }), fc.constantFrom('1', 'step-2')),
      status: fc.constantFrom('running', 'done'),
      remark: fc.constantFrom('navigate: Navigate to https://example.com', 'Step 1', 'wait'),
      type: fc.constantFrom('progress', 'recording_state'),
    },
    { requiredKeys: ['step'] },
  )
  .map((record) => asEvent({ ...record }));

/** A recognised type with no dedicated interface, plus a type from no release at all. */
export const arbOtherEvent: fc.Arbitrary<KaneEvent> = fc
  .record({
    type: fc.oneof(
      { weight: 4, arbitrary: fc.constantFrom(...KNOWN_EVENT_TYPES) },
      // The vocabulary is open by Kane's own documentation, and retention of an
      // unrecognised type is a requirement — so unknown types are generated.
      { weight: 3, arbitrary: fc.constantFrom('quantum_flux', 'testrun_teleported', '', 'DONE') },
    ),
    extras: arbUnknownExtras,
  })
  .map((seed) => asEvent({ type: seed.type, ...seed.extras }))
  // A generated `other` event must never masquerade as progress: classification
  // is `step`-key first, so a `step` here would silently change what it is.
  .filter((event) => !Object.prototype.hasOwnProperty.call(event, 'step'));

/** `testrun_member_end`, with a status that may be outside the four. */
export const arbMemberEndEvent: fc.Arbitrary<KaneEvent> = fc
  .record({
    status: arbMemberStatus,
    path: arbTestFile,
    test_id: fc.option(fc.constantFrom('T-1', 'T-3'), { nil: null }),
    verdict: fc.option(arbVerdictObject, { nil: null }),
  })
  .map((seed) => {
    const record: Record<string, unknown> = {
      type: 'testrun_member_end',
      status: seed.status,
      path: seed.path,
      test_id: seed.test_id,
    };
    if (seed.verdict !== null) record['verdict'] = seed.verdict;
    return asEvent(record);
  });

/** `testrun_plan`, the only event a `--dry-run` invocation exists to collect. */
export const arbTestrunPlanEvent: fc.Arbitrary<KaneEvent> = fc
  .record({
    valid: fc.boolean(),
    members: fc.array(
      fc.record({
        path: arbTestFile,
        test_id: fc.option(fc.constantFrom('T-1', 'T-3', 'T-7'), { nil: null }),
        tags: fc.array(fc.constantFrom('cart', 'subtotal', 'checkout'), { maxLength: 3 }),
        failure: fc.option(fc.constantFrom('selector not found'), { nil: null }),
      }),
      { maxLength: 4 },
    ),
  })
  .map((seed) =>
    asEvent({
      type: 'testrun_plan',
      valid: seed.valid,
      members: seed.members.map((member) => ({ ...member })),
    }),
  );

/** `testrun_summary`, which precedes the terminal event and carries the counts. */
export const arbTestrunSummaryEvent: fc.Arbitrary<KaneEvent> = fc
  .record({
    tests: fc.nat({ max: 12 }),
    passed: fc.nat({ max: 12 }),
    failed: fc.nat({ max: 12 }),
    broken: fc.nat({ max: 4 }),
    skipped: fc.nat({ max: 4 }),
  })
  .map((totals) => asEvent({ type: 'testrun_summary', totals: { ...totals } }));

/**
 * `error` inside an Assurance stream — the first of the two verified refusal
 * lines (§5.3.1). Its message is quoted verbatim into a diagnostic so a reviewer
 * gets the actual remedy rather than the word "failed".
 */
export const arbKaneErrorEvent: fc.Arbitrary<KaneEvent> = fc
  .record({
    verb: fc.constantFrom('cover', 'extract', 'reconcile'),
    message: fc.constantFrom(
      'no context store found — run `kane-cli context ingest` first',
      'the requested source id is not ingested',
    ),
  })
  .map((seed) => asEvent({ type: 'error', v: 1, verb: seed.verb, message: seed.message }));

/**
 * `run_end` — the `ExecutionRun` terminal event.
 *
 * Three of the twelve named cases live here. The result code is emitted as a
 * number **or** a string, including the whitespace-padded confirmed-bug code;
 * credits arrive as `credits_consumed`, as `credits`, or as neither; and
 * `session_dir` is **absent** on a weighted share of draws, because it is the one
 * path in the event KEPT legitimately reads and an evidence resolver that assumed
 * it present would answer a path for a run that never named a session.
 *
 * `per_flow_metadata[0]` carries the *string* form of the same code, which is the
 * inconsistency the recorded run actually exhibits — number at the top level,
 * string one level down, in one event. `run_dir` and `runDirLegacy` are emitted so
 * a stream carrying the legacy keys is generated; nothing may read them.
 *
 * No `step` key, ever: classification is `step`-first, so a terminal event
 * carrying one would classify as progress and its stream would read crashed.
 */
export const arbRunEndEvent: fc.Arbitrary<KaneEvent> = fc
  .record({
    status: fc.constantFrom('passed', 'failed', 'error'),
    code: arbResultCodeSlot,
    credits: arbCreditsSlot,
    sessionDir: fc.oneof(
      { weight: 5, arbitrary: arbAbsoluteDir },
      { weight: 3, arbitrary: fc.constant(null) },
    ),
    runId: fc.option(fc.constantFrom('run_20260820T184011Z'), { nil: null }),
    reasonCode: fc.option(fc.constantFrom('failure.product_bug', 'ok'), { nil: null }),
    verdict: fc.option(arbVerdictObject, { nil: null }),
    withPerFlow: fc.boolean(),
    withLegacyPaths: fc.boolean(),
    extras: arbUnknownExtras,
  })
  .map((seed) => {
    const record: Record<string, unknown> = {
      type: 'run_end',
      status: seed.status,
      summary: 'You asked to open the More information link.',
      ...seed.extras,
      ...creditsWire(seed.credits.states),
    };
    if (seed.code.present) record[RESULT_CODE_FIELD] = seed.code.wire;
    if (seed.runId !== null) record['run_id'] = seed.runId;
    if (seed.reasonCode !== null) record['reason_code'] = seed.reasonCode;
    // Named edge case: `session_dir` absent from `run_end`.
    if (seed.sessionDir !== null) record['session_dir'] = seed.sessionDir;
    if (seed.verdict !== null) record['verdict'] = seed.verdict;
    if (seed.withPerFlow) {
      const flow: Record<string, unknown> = { reason_code: seed.reasonCode };
      if (seed.code.present) {
        // The observed inconsistency: the string form, one level down.
        flow[RESULT_CODE_FIELD] =
          typeof seed.code.wire === 'number' ? String(seed.code.wire) : seed.code.wire;
      }
      record['per_flow_metadata'] = [flow];
    }
    if (seed.withLegacyPaths) {
      record['run_dir'] = '/legacy/never/created';
      record['runDirLegacy'] = '/legacy/never/created';
    }
    return asEvent(record);
  });

/**
 * `testrun_done` — the `ExecutionTestrun` terminal event. Deliberately thin:
 * no such event has been captured, so beyond `status` and an echoed `totals`
 * everything arrives through the index signature. Declaring more would be
 * inventing a contract.
 */
export const arbTestrunDoneEvent: fc.Arbitrary<KaneEvent> = fc
  .record({
    status: fc.constantFrom('passed', 'failed', 'completed'),
    code: arbResultCodeSlot,
    credits: arbCreditsSlot,
    withTotals: fc.boolean(),
    extras: arbUnknownExtras,
  })
  .map((seed) => {
    const record: Record<string, unknown> = {
      type: 'testrun_done',
      status: seed.status,
      ...seed.extras,
      ...creditsWire(seed.credits.states),
    };
    if (seed.code.present) record[RESULT_CODE_FIELD] = seed.code.wire;
    if (seed.withTotals) {
      record['totals'] = { tests: 4, passed: 2, failed: 1, broken: 1, skipped: 0 };
    }
    return asEvent(record);
  });

/**
 * `done` — the `Assurance` terminal event, and the reason a refusal is a
 * **complete** stream rather than a crashed one (§5.3.1).
 *
 * `exit_code` here is the **event's own** code, carried inside the stream, and it
 * is generated as a number or a string on the same evidence that forced coercion
 * on the result code. It is never the process exit code: both were two in the
 * observed refusal, which is exactly why they are easy to conflate.
 *
 * A result code is emitted on a **minority** of draws. No observed `done` event
 * carries one, so it is not asserted as part of the shape — but the event surface
 * is open by Kane's own documentation, and §6.2's rule ladder coerces the field
 * off whichever terminal event it is handed. A generator that could never put one
 * on a `done` event would leave the Assurance arm of that ladder unexercised,
 * which is the failure mode the three-contract model exists to prevent.
 */
export const arbAssuranceDoneEvent: fc.Arbitrary<KaneEvent> = fc
  .record({
    status: arbAssuranceStatus,
    code: arbResultCodeSlot,
    withCode: fc.oneof(
      { weight: 2, arbitrary: fc.constant(true) },
      { weight: 3, arbitrary: fc.constant(false) },
    ),
    verb: fc.constantFrom('cover', 'gaps', 'extract', 'reconcile', 'evolve'),
    exitCode: fc.oneof(
      fc.integer({ min: 0, max: 5 }),
      fc.constantFrom<string>('0', '2', ' 3 '),
      fc.constant(null),
    ),
    message: fc.option(
      fc.constantFrom('no context store found — run `kane-cli context ingest` first'),
      { nil: null },
    ),
    credits: arbCreditsSlot,
    extras: arbUnknownExtras,
  })
  .map((seed) => {
    const record: Record<string, unknown> = {
      type: 'done',
      v: 1,
      verb: seed.verb,
      status: seed.status,
      ...seed.extras,
      ...creditsWire(seed.credits.states),
    };
    if (seed.exitCode !== null) record['exit_code'] = seed.exitCode;
    if (seed.message !== null) record['message'] = seed.message;
    if (seed.withCode && seed.code.present) record[RESULT_CODE_FIELD] = seed.code.wire;
    return asEvent(record);
  });

/**
 * The terminal event of a family, typed by family (R3.2).
 *
 * The single cast in this section: the generators above build wire records, and
 * `TerminalEvent<F>` is a conditional type over a generic `F`, which no amount of
 * narrowing inside a generic function will resolve. The mapping itself is read off
 * the same table everything else reads — one arm per terminal type, and there are
 * exactly three terminal types because Kane has exactly three terminal contracts.
 */
export function arbTerminalEvent<F extends CommandFamily>(family: F): fc.Arbitrary<TerminalEvent<F>> {
  // Widened to `string` for the same reason `kane/ndjson.ts` widens it: a
  // deferred conditional type cannot be compared against a literal.
  const terminalType = contractFor(family).terminalType as string;
  const chosen: fc.Arbitrary<KaneEvent> =
    terminalType === 'run_end'
      ? arbRunEndEvent
      : terminalType === 'testrun_done'
        ? arbTestrunDoneEvent
        : arbAssuranceDoneEvent;
  return chosen as unknown as fc.Arbitrary<TerminalEvent<F>>;
}

/**
 * Any event a line can parse to: progress, a typed non-terminal event, all three
 * terminal shapes, and a type from a release newer than this repo. Every arm is
 * reachable, because retention of an unrecognised type is a requirement and a
 * generator that only produced recognised types could not exercise it.
 */
export const arbKaneEvent: fc.Arbitrary<KaneEvent> = fc.oneof(
  { weight: 4, arbitrary: arbProgressEvent },
  { weight: 3, arbitrary: arbOtherEvent },
  { weight: 2, arbitrary: arbMemberEndEvent },
  { weight: 1, arbitrary: arbTestrunPlanEvent },
  { weight: 1, arbitrary: arbTestrunSummaryEvent },
  { weight: 1, arbitrary: arbKaneErrorEvent },
  { weight: 2, arbitrary: arbRunEndEvent },
  { weight: 2, arbitrary: arbTestrunDoneEvent },
  { weight: 2, arbitrary: arbAssuranceDoneEvent },
);

/** The type value of an event, or null when it carries none. */
function eventType(event: KaneEvent): string | null {
  const raw = (event as Record<string, unknown>)['type'];
  return typeof raw === 'string' ? raw : null;
}

/**
 * Any event **except** one that would end this family's stream. Used for stream
 * bodies, so a body line can never accidentally complete a stream that a
 * truncation property needs to be crashed.
 */
export function arbNonTerminalEvent<F extends CommandFamily>(
  family: F,
): fc.Arbitrary<KaneEvent> {
  const terminalType = contractFor(family).terminalType as string;
  return arbKaneEvent.filter((event) => eventType(event) !== terminalType);
}

// ---------------------------------------------------------------------------
// 8. NDJSON streams (design §4.3, R3.23, R3.24)
// ---------------------------------------------------------------------------

/**
 * A line before the stream begins: Kane's banners and human-readable chatter.
 * Every one of these precedes the first line starting with `{` and must be
 * skipped **silently** — diagnosing them would bury the diagnostics that matter
 * (R3.23).
 */
export const arbNoisyPrefix: fc.Arbitrary<string> = fc
  .oneof(
    {
      weight: 5,
      arbitrary: fc.constantFrom(
        'kane-cli 0.8.4',
        '',
        '   ',
        'Running flow 1 of 1…',
        '[info] recording enabled',
        'Tip: run `kane-cli evidence serve <path>` to browse the pack',
        '\u2713 skill up to date',
        '} stray closer',
        '[1, 2]',
      ),
    },
    { weight: 2, arbitrary: fc.string({ maxLength: 24 }) },
  )
  .filter((line) => !line.includes('\n') && !line.includes('\r') && !line.trimStart().startsWith('{'));

/**
 * A line that is not a Kane event: either it fails strict JSON parsing, or it
 * parses to something that is not an object. Both record one diagnostic carrying
 * the one-based line number and both leave parsing to **continue** (R3.24); the
 * second arm matters because a JSON scalar is well-formed and still not an event,
 * and admitting one would put a number in the event list typed as an event.
 */
export const arbMalformedLine: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom(
      '{',
      '{"type":}',
      '{"type" "run_end"}',
      "{'type':'run_end'}",
      '{"type":"run_end",}',
      '{"unterminated": "value',
      '{"nan": NaN}',
      '{"trailing": undefined}',
    ),
  },
  { weight: 2, arbitrary: fc.constantFrom('42', 'null', 'true', '"a string"', '[1,2,3]') },
);

/** Which shape a generated stream is. */
export type StreamShape = 'terminal-only' | 'plain' | 'noisy' | 'malformed' | 'truncated';

/** A generated NDJSON stream: exactly what `parseStream` takes, plus its provenance. */
export interface StreamLines {
  readonly family: CommandFamily;
  readonly shape: StreamShape;
  /** The lines to parse. */
  readonly lines: readonly string[];
  /** The untruncated stream this was cut from; equal to `lines` when uncut. */
  readonly full: readonly string[];
  /** How many lines were kept, or null when nothing was cut. */
  readonly cutAt: number | null;
}

interface StreamParts {
  readonly prefix: readonly string[];
  readonly body: readonly string[];
  readonly terminal: string;
  readonly shape: StreamShape;
}

/** The wire line for an event. */
function eventLine(event: KaneEvent): string {
  return JSON.stringify(event);
}

/**
 * The parts of a stream, terminal event last.
 *
 * Malformed lines are only interleaved when there is at least one event line to
 * put them after, so a malformed line can never end up *before* the first `{`
 * line, where the leading-noise rule would skip it silently instead and the
 * generator would be producing a different case from the one it claims.
 */
function streamParts<F extends CommandFamily>(family: F): fc.Arbitrary<StreamParts> {
  return fc
    .record({
      prefix: fc.array(arbNoisyPrefix, { maxLength: 2 }),
      body: fc.array(arbNonTerminalEvent(family), { maxLength: 5 }),
      malformed: fc.array(arbMalformedLine, { maxLength: 2 }),
      terminal: arbTerminalEvent(family),
      shape: fc.constantFrom<StreamShape>('plain', 'noisy', 'malformed'),
    })
    .map((seed): StreamParts => {
      const bodyLines = seed.body.map(eventLine);
      const withMalformed =
        seed.shape === 'malformed' && bodyLines.length > 0
          ? [bodyLines[0] as string, ...seed.malformed, ...bodyLines.slice(1)]
          : bodyLines;
      return {
        prefix: seed.shape === 'noisy' ? seed.prefix : [],
        body: withMalformed,
        terminal: eventLine(seed.terminal),
        shape: seed.shape,
      };
    });
}

/**
 * A stream that **reaches** its family's terminal event, so it parses as
 * complete.
 *
 * One of the twelve named cases is weighted in here: a stream whose **only** line
 * is the terminal event. That is the degenerate shape where nothing precedes the
 * verdict — no banner, no progress, no summary — and it is where an implementation
 * that looked for the terminal event only *after* something else would report
 * nothing at all.
 */
export function arbStream<F extends CommandFamily>(family: F): fc.Arbitrary<StreamLines> {
  return fc.oneof(
    {
      weight: 3,
      arbitrary: arbTerminalEvent(family).map((terminal): StreamLines => {
        const lines = [eventLine(terminal)];
        return { family, shape: 'terminal-only', lines, full: lines, cutAt: null };
      }),
    },
    {
      weight: 7,
      arbitrary: streamParts(family).map((parts): StreamLines => {
        const lines = [...parts.prefix, ...parts.body, parts.terminal];
        return { family, shape: parts.shape, lines, full: lines, cutAt: null };
      }),
    },
  );
}

/**
 * A stream truncated **at every index**, which is one of the twelve named cases
 * and the reason `terminal` exists only on the complete arm of `ParsedStream`.
 *
 * The terminal event is always the last line of `full`, and `cutAt` never reaches
 * it, so every draw is a stream whose outcome is genuinely unknown — never a
 * pass, never a failure (R3.6, R3.7). `cutAt` is weighted towards both extremes:
 * zero, which is the empty stream, and one short of the terminal event, which is
 * the sharpest case — everything arrived except the one line that says what
 * happened. `full` is carried so a property can assert over *every* cut of one
 * concrete stream rather than only over the cut it was handed.
 */
export function arbTruncatedStream<F extends CommandFamily>(
  family: F,
): fc.Arbitrary<StreamLines> {
  return streamParts(family).chain((parts) => {
    const full = [...parts.prefix, ...parts.body, parts.terminal];
    const lastCut = full.length - 1;
    return fc
      .oneof(
        { weight: 2, arbitrary: fc.constant(lastCut) },
        { weight: 1, arbitrary: fc.constant(0) },
        { weight: 5, arbitrary: fc.integer({ min: 0, max: lastCut }) },
      )
      .map((cutAt): StreamLines => ({
        family,
        shape: 'truncated',
        lines: full.slice(0, cutAt),
        full,
        cutAt,
      }));
  });
}

// ---------------------------------------------------------------------------
// 9. failure.yaml (design §6.3)
// ---------------------------------------------------------------------------

/** What shape a generated `failure.yaml` document has at its root. */
export type FailureYamlShape = 'mapping' | 'empty' | 'scalar' | 'sequence' | 'invalid';

/** A generated `failure.yaml`, and what reading it must produce. */
export interface FailureYamlCase {
  /** The file's text, ready to hand to the loader as `content`. */
  readonly text: string;
  readonly shape: FailureYamlShape;
  /** Which alias carries the winning signal, or null when none does. */
  readonly alias: TriageSignalField | null;
  /** The expected signal: trimmed and lower-cased, or null. */
  readonly signal: string | null;
  /** Whether the document carries the padded confirmed-bug code. */
  readonly withPaddedResultCode: boolean;
}

/** Classification tokens a triage note carries, in the casing a file might use. */
const TRIAGE_TOKENS: readonly string[] = [
  'product_bug',
  'Product_Bug',
  'selector',
  'assertion',
  'flaky',
  'infrastructure',
];

/**
 * A `failure.yaml`, covering **all four** accepted category aliases.
 *
 * The committed fixtures use three of them — nested `triage.category`, top-level
 * `category`, and `classification` — and the fourth, `reason`, has no fixture at
 * all, which is exactly why it has to be generated: it is the alias most likely to
 * hold a prose sentence rather than a classification token, and it is last in
 * precedence for that reason.
 *
 * Precedence is exercised rather than assumed: when a lower-precedence alias is
 * also written, the winner is still the higher one, and `alias` names it.
 */
export const arbFailureYaml: fc.Arbitrary<FailureYamlCase> = fc
  .record({
    shape: fc.oneof(
      { weight: 8, arbitrary: fc.constant<FailureYamlShape>('mapping') },
      { weight: 1, arbitrary: fc.constant<FailureYamlShape>('empty') },
      { weight: 1, arbitrary: fc.constant<FailureYamlShape>('scalar') },
      { weight: 1, arbitrary: fc.constant<FailureYamlShape>('sequence') },
      { weight: 1, arbitrary: fc.constant<FailureYamlShape>('invalid') },
    ),
    // One index into the alias precedence order, or -1 for a mapping that
    // carries no signal at all — which is a record, not a null (§14.2).
    aliasIndex: fc.oneof(
      { weight: 8, arbitrary: fc.integer({ min: 0, max: TRIAGE_SIGNAL_FIELDS.length - 1 }) },
      { weight: 1, arbitrary: fc.constant(-1) },
    ),
    token: fc.constantFrom(...TRIAGE_TOKENS),
    withDecoys: fc.boolean(),
    withPaddedResultCode: fc.boolean(),
    withSeverity: fc.boolean(),
    withNestedSeverity: fc.boolean(),
  })
  .map((seed): FailureYamlCase => {
    if (seed.shape === 'empty') {
      return { text: '', shape: 'empty', alias: null, signal: null, withPaddedResultCode: false };
    }
    if (seed.shape === 'scalar') {
      return {
        text: 'a bare note with no fields at all\n',
        shape: 'scalar',
        alias: null,
        signal: null,
        withPaddedResultCode: false,
      };
    }
    if (seed.shape === 'sequence') {
      return {
        text: '- first note\n- second note\n',
        shape: 'sequence',
        alias: null,
        signal: null,
        withPaddedResultCode: false,
      };
    }
    if (seed.shape === 'invalid') {
      return {
        text: 'triage:\n  category: [unclosed\n',
        shape: 'invalid',
        alias: null,
        signal: null,
        withPaddedResultCode: false,
      };
    }

    const alias = seed.aliasIndex < 0 ? null : (TRIAGE_SIGNAL_FIELDS[seed.aliasIndex] ?? null);
    const top: string[] = [];
    const nested: string[] = [];

    if (seed.withPaddedResultCode) {
      // Quoted, so the value stays the padded string form rather than becoming a
      // YAML integer. The coercing accessor is the only thing allowed to read it.
      top.push(`${RESULT_CODE_FIELD}: " 740"`);
    }
    if (seed.withSeverity) top.push('severity: high');
    if (seed.withNestedSeverity) nested.push('severity: medium');
    top.push('one_liner: "the subtotal does not update"');
    nested.push('confidence: 0.9');

    const write = (field: TriageSignalField, value: string): void => {
      if (field === 'triage.category') nested.push(`category: ${value}`);
      else if (field === 'reason') top.push(`reason: "${value}"`);
      else top.push(`${field}: ${value}`);
    };

    if (alias !== null) write(alias, seed.token);
    if (seed.withDecoys && seed.aliasIndex >= 0) {
      // Only ever *below* the winner in precedence order, so the label stays true.
      for (let index = seed.aliasIndex + 1; index < TRIAGE_SIGNAL_FIELDS.length; index += 1) {
        const decoy = TRIAGE_SIGNAL_FIELDS[index];
        if (decoy !== undefined) write(decoy, 'decoy_value');
      }
    }

    const lines = [...top];
    if (nested.length > 0) {
      lines.push('triage:');
      for (const entry of nested) lines.push(`  ${entry}`);
    }

    return {
      text: `${lines.join('\n')}\n`,
      shape: 'mapping',
      alias,
      signal: alias === null ? null : seed.token.toLowerCase(),
      withPaddedResultCode: seed.withPaddedResultCode,
    };
  });

// ---------------------------------------------------------------------------
// 10. The context store's source listing (design §13.2.2)
// ---------------------------------------------------------------------------

/** The four cases the committed listing fixture is required to cover. */
export type StoreListingFeature = 'exact-path' | 'digest-only' | 'retired' | 'duplicate';

/** One projected-and-unprojected pair for a listing entry. */
export interface StoreSourceEntryCase {
  readonly sourceId: string;
  readonly path: string | null;
  readonly digest: string | null;
  readonly retired: boolean;
  /** Which wire key carried the id, the path, the digest, the lifecycle marker. */
  readonly idKey: string;
  readonly pathKey: string | null;
  readonly digestKey: string | null;
  readonly lifecycleKey: string | null;
  /** The entry exactly as it sits on the wire. */
  readonly entry: Readonly<Record<string, unknown>>;
}

/** A generated `context list --type source --json` payload. */
export interface StoreSourceListingCase {
  /** The unprojected payload, which a tolerant walk has to find the array inside. */
  readonly payload: unknown;
  readonly entries: readonly StoreSourceEntryCase[];
  /** Which of the four required cases this draw contains, by construction. */
  readonly features: readonly StoreListingFeature[];
}

/** The recognisable id spellings — the store's schema is not pinned (§13.2.2). */
const ID_KEYS = ['source_id', 'id', 'sourceId'] as const;
const PATH_KEYS = ['path', 'file', 'uri', 'source_path'] as const;
const DIGEST_KEYS = ['digest', 'sha256', 'hash', 'content_hash'] as const;

function listingEntry(
  parts: Omit<StoreSourceEntryCase, 'entry'>,
): StoreSourceEntryCase {
  const entry: Record<string, unknown> = { [parts.idKey]: parts.sourceId };
  if (parts.path !== null && parts.pathKey !== null) entry[parts.pathKey] = parts.path;
  if (parts.digest !== null && parts.digestKey !== null) entry[parts.digestKey] = parts.digest;
  if (parts.lifecycleKey === 'retired') entry['retired'] = parts.retired;
  else if (parts.lifecycleKey === 'status') entry['status'] = parts.retired ? 'retired' : 'active';
  entry['title'] = 'a title nobody may match on';
  return { ...parts, entry };
}

/**
 * A source listing that reaches each of the four required cases **by
 * construction** rather than by luck: an entry matchable on its exact path, an
 * entry carrying only a digest, a retired entry, and two live entries that
 * duplicate one path — which is the fork guard of §13.2.4, the one rung where
 * answering *anything* would be a coin flip.
 *
 * The array is buried inside a plausible envelope on some draws, because the
 * projection walks the payload for any array of objects rather than assuming a
 * path into a schema nothing has pinned. Unrecognisable entries are mixed in for
 * the same reason: an entry with no id is not a source, and must be dropped
 * rather than fabricated into one.
 */
export const arbStoreSourceListing: fc.Arbitrary<StoreSourceListingCase> = fc
  .record({
    file: arbDocFile,
    otherFile: arbDocFile,
    idKey: fc.constantFrom(...ID_KEYS),
    pathKey: fc.constantFrom(...PATH_KEYS),
    digestKey: fc.constantFrom(...DIGEST_KEYS),
    lifecycleKey: fc.constantFrom<'retired' | 'status'>('retired', 'status'),
    withExactPath: fc.oneof(
      { weight: 4, arbitrary: fc.constant(true) },
      { weight: 1, arbitrary: fc.constant(false) },
    ),
    withDigestOnly: fc.oneof(
      { weight: 3, arbitrary: fc.constant(true) },
      { weight: 2, arbitrary: fc.constant(false) },
    ),
    withRetired: fc.oneof(
      { weight: 3, arbitrary: fc.constant(true) },
      { weight: 2, arbitrary: fc.constant(false) },
    ),
    withDuplicate: fc.oneof(
      { weight: 3, arbitrary: fc.constant(true) },
      { weight: 2, arbitrary: fc.constant(false) },
    ),
    withJunk: fc.boolean(),
    envelope: fc.constantFrom<'bare' | 'sources' | 'nested'>('bare', 'sources', 'nested'),
  })
  .map((seed): StoreSourceListingCase => {
    const entries: StoreSourceEntryCase[] = [];
    const features: StoreListingFeature[] = [];
    const digest = 'sha256:9e0c1f4a';

    if (seed.withExactPath) {
      entries.push(
        listingEntry({
          sourceId: 'src_7f31c0a4',
          path: seed.file,
          digest,
          retired: false,
          idKey: seed.idKey,
          pathKey: seed.pathKey,
          digestKey: seed.digestKey,
          lifecycleKey: seed.lifecycleKey,
        }),
      );
      features.push('exact-path');
    }
    if (seed.withDigestOnly) {
      entries.push(
        listingEntry({
          sourceId: 'src_b20d55e1',
          path: null,
          digest: 'sha256:2c19aa07',
          retired: false,
          idKey: seed.idKey,
          pathKey: null,
          digestKey: seed.digestKey,
          lifecycleKey: null,
        }),
      );
      features.push('digest-only');
    }
    if (seed.withRetired) {
      entries.push(
        listingEntry({
          sourceId: 'src_dead0001',
          path: seed.otherFile,
          digest: null,
          retired: true,
          idKey: seed.idKey,
          pathKey: seed.pathKey,
          digestKey: null,
          lifecycleKey: seed.lifecycleKey,
        }),
      );
      features.push('retired');
    }
    if (seed.withDuplicate) {
      // Two live entries backing one file: the fork guard's exact input.
      for (const sourceId of ['src_fork0001', 'src_fork0002']) {
        entries.push(
          listingEntry({
            sourceId,
            path: seed.file,
            digest,
            retired: false,
            idKey: seed.idKey,
            pathKey: seed.pathKey,
            digestKey: seed.digestKey,
            lifecycleKey: seed.lifecycleKey,
          }),
        );
      }
      features.push('duplicate');
    }

    const wire: unknown[] = entries.map((entry) => ({ ...entry.entry }));
    if (seed.withJunk) {
      // No recognisable id: not a source, and never to be fabricated into one.
      wire.push({ title: 'an entry with no id at all' }, 'a bare string', 7);
    }

    const payload: unknown =
      seed.envelope === 'bare'
        ? wire
        : seed.envelope === 'sources'
          ? { sources: wire, count: entries.length }
          : { type: 'done', v: 1, verb: 'list', result: { items: wire } };

    return { payload, entries, features };
  });
