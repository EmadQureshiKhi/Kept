/**
 * The three Kane command-family contracts (design §4.1, A10, A14, R3.2).
 *
 * Kane 0.8.4 does **not** have one terminal-event contract. It has three, and
 * both of the paths KEPT actually depends on are the two that are *not*
 * `run_end`:
 *
 * | family             | terminal        | NDJSON enabled by      | exit 3            |
 * |--------------------|-----------------|------------------------|-------------------|
 * | `ExecutionRun`     | `run_end`       | `--agent`              | timeout/cancelled |
 * | `ExecutionTestrun` | `testrun_done`  | piped stdout, no flag  | timeout/cancelled |
 * | `Assurance`        | `done`          | `--mode agent`         | paused-resumable  |
 *
 * A parser built solely on `run_end` reports nothing on blast-radius
 * verification (`testrun run`) and nothing on the ledger's data source
 * (`cover`) — silently, because both streams simply never carry the event it is
 * waiting for. So the four family-dependent facts (terminal type, NDJSON
 * enabler, meaning of exit code 3, evidence-pack location) are encoded exactly
 * once, in the `CONTRACTS` table below, and every consumer reads them from a
 * contract rather than re-deriving them.
 *
 * `FamilyContract` has **no public constructor**: it carries a module-private
 * brand, so `contractFor(family)` is the only way to obtain one and a
 * structural object literal is a compile error wherever a contract is expected
 * (design §4.2). Since `parseStream(contract, lines)` is the only parse entry
 * point, parsing without a declared family cannot be written.
 *
 * Branding is safe here in a way it is deliberately not safe for `Diagnostic`:
 * contracts are runtime-only lookups that are never serialised into
 * `ledger.snapshot.json`, so nothing branded can leak into the snapshot and
 * break the round-trip requirement of design §9.1.
 */

/** The three families. Exhaustive — Kane has no fourth terminal contract. */
export type CommandFamily = 'ExecutionRun' | 'ExecutionTestrun' | 'Assurance';

/** The families, in table order. Lets tests and property generators enumerate. */
export const COMMAND_FAMILIES: readonly CommandFamily[] = [
  'ExecutionRun',
  'ExecutionTestrun',
  'Assurance',
];

/**
 * The terminal event type of a family, indexed *by* the family so that
 * `contractFor('ExecutionRun').terminalType` narrows to the literal `'run_end'`
 * rather than to a three-way union. Downstream typing (`TerminalEvent<F>` in
 * `kane/events.ts`, `ParsedStream<F>` in `kane/ndjson.ts`) depends on that
 * narrowing.
 */
export type TerminalType<F extends CommandFamily> = F extends 'ExecutionRun'
  ? 'run_end'
  : F extends 'ExecutionTestrun'
    ? 'testrun_done'
    : 'done';

/**
 * How NDJSON is turned on for a family. `piped-stdout` is not a flag: `testrun
 * run` has no `--agent` flag at all, it emits NDJSON whenever stdout is a pipe
 * (R3.5), and passing `--agent` to it is an error the invoker asserts against.
 */
export type NdjsonEnabler = 'agent-flag' | 'piped-stdout' | 'mode-agent';

/**
 * What process exit code 3 means for a family (A14). Getting this wrong in the
 * `Assurance` direction is the one mistake that corrupts ledger state: a paused,
 * resumable run read as a failure would overwrite good verdicts.
 */
export type Exit3Meaning = 'timeout-or-cancelled' | 'paused-resumable';

/**
 * Where a sealed evidence pack for a family lives. Never read from an event —
 * no terminal event carries an evidence path (design §4.6, R3.19).
 */
export type EvidenceLocation = 'session-dir' | 'cwd-testmuai' | 'none';

/**
 * Module-private brand. Not exported, so no code outside this file can name it,
 * and therefore no object literal outside this file can satisfy
 * `FamilyContract`. Type-level only — it is never present at runtime and never
 * serialised.
 */
declare const CONTRACT_BRAND: unique symbol;

/**
 * One family's contract. Obtained only from {@link contractFor}.
 *
 * Every field is `readonly` and the returned objects are frozen, because a
 * single shared table is handed to every call site in the process.
 */
export interface FamilyContract<F extends CommandFamily> {
  /** @internal Seals the type. Absent at runtime; never serialised. */
  readonly [CONTRACT_BRAND]: F;
  readonly family: F;
  /** The one event type that ends a stream of this family (R3.2). */
  readonly terminalType: TerminalType<F>;
  /** What the invoker must do to get NDJSON out of this family (R3.4, R3.5). */
  readonly ndjson: NdjsonEnabler;
  /** What process exit code 3 means for this family. A14. */
  readonly exit3: Exit3Meaning;
  /** Where a sealed evidence pack for this family lives. */
  readonly evidence: EvidenceLocation;
  /** The argv verb sequences that belong to this family, longest last. */
  readonly commands: readonly (readonly string[])[];
}

/** The contract minus its brand — what the table below actually writes. */
type ContractFacts<F extends CommandFamily> = Omit<FamilyContract<F>, typeof CONTRACT_BRAND>;

/**
 * The single construction site. Deep-freezes and applies the brand; the cast is
 * the one place in the codebase that fabricates a contract, which is precisely
 * why it lives behind a non-exported function.
 */
function seal<F extends CommandFamily>(facts: ContractFacts<F>): FamilyContract<F> {
  const commands = facts.commands.map((command) => Object.freeze([...command]));
  return Object.freeze({
    ...facts,
    commands: Object.freeze(commands),
  }) as unknown as FamilyContract<F>;
}

/** The table. Every family-dependent fact is written here exactly once. */
const CONTRACTS: { readonly [F in CommandFamily]: FamilyContract<F> } = {
  ExecutionRun: seal<'ExecutionRun'>({
    family: 'ExecutionRun',
    terminalType: 'run_end',
    ndjson: 'agent-flag',
    exit3: 'timeout-or-cancelled',
    evidence: 'session-dir',
    commands: [['run'], ['testmd', 'run']],
  }),
  ExecutionTestrun: seal<'ExecutionTestrun'>({
    family: 'ExecutionTestrun',
    terminalType: 'testrun_done',
    ndjson: 'piped-stdout',
    exit3: 'timeout-or-cancelled',
    evidence: 'cwd-testmuai',
    commands: [['testrun', 'run']],
  }),
  Assurance: seal<'Assurance'>({
    family: 'Assurance',
    terminalType: 'done',
    ndjson: 'mode-agent',
    exit3: 'paused-resumable',
    evidence: 'none',
    // `context list` is here on the strength of design §13.2: the source-id
    // listing is invoked as `context list --type source --json`, Assurance
    // family, invoker appends `--mode agent`, gated on the terminal `done`.
    // `maintain evolve` is here on A10's grouping plus R7.2's explicit
    // `--mode agent` requirement; the invoker probes its `--help` once per
    // process and degrades to a review card if the flag is refused.
    commands: [
      ['context', 'extract'],
      ['context', 'list'],
      ['design', 'tests'],
      ['maintain', 'reconcile'],
      ['maintain', 'evolve'],
      ['cover'],
      ['cover', 'gaps'],
    ],
  }),
};

/** Boundary guard: is this string one of the three families? */
export function isCommandFamily(value: unknown): value is CommandFamily {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CONTRACTS, value);
}

/**
 * The only way to obtain a {@link FamilyContract}. Total over `CommandFamily`.
 *
 * Throws `TypeError` for a value outside the vocabulary, which is unreachable
 * without a cast: an unknown family is a programming error, not a state of the
 * world, and design §14.2 reserves exceptions for exactly that.
 */
export function contractFor<F extends CommandFamily>(family: F): FamilyContract<F> {
  if (!isCommandFamily(family)) {
    throw new TypeError(`Unknown Kane command family: ${String(family)}`);
  }
  return CONTRACTS[family];
}

/** Flattened argv index, longest verb sequence first. */
const ARGV_INDEX: readonly { readonly command: readonly string[]; readonly family: CommandFamily }[] =
  COMMAND_FAMILIES.flatMap((family) =>
    contractFor(family).commands.map((command) => ({ command, family })),
  ).sort((a, b) => b.command.length - a.command.length);

/** Binary names tolerated as a leading argv token, so `kane-cli run` classifies. */
const BINARY_BASENAMES: readonly string[] = ['kane-cli', 'kane'];

function isBinaryToken(token: string): boolean {
  const base = token.split(/[\\/]/).pop() ?? token;
  return BINARY_BASENAMES.includes(base.replace(/\.(?:js|mjs|cjs|exe)$/, ''));
}

/**
 * The leading positional tokens of an argv — the verb sequence and nothing else.
 *
 * Scanning stops at the first flag, so a flag *value* can never be mistaken for
 * a verb: `testrun run --match run` classifies on `['testrun','run']`, and the
 * stray `run` in the regex is never considered. That matters because `run` is a
 * command of a different family.
 */
function verbTokens(argv: readonly string[]): string[] {
  const tokens: string[] = [];
  for (const raw of argv) {
    if (typeof raw !== 'string') break;
    const token = raw.trim();
    if (token.length === 0) continue;
    if (token.startsWith('-')) break;
    tokens.push(token);
  }
  const first = tokens[0];
  if (first !== undefined && isBinaryToken(first)) tokens.shift();
  return tokens;
}

/**
 * Reverse lookup: which family does this argv belong to?
 *
 * Used by `KaneInvoker` to reject a family/argv mismatch (design §4.7 step 2)
 * and by the per-command argv assertion suite (task 12.13).
 *
 * Multi-word verbs resolve before single-word ones because {@link ARGV_INDEX}
 * is ordered longest-first, so `cover gaps` never falls through to `cover`.
 *
 * Returns `null` — never a default family — for an argv it cannot classify:
 * `[]`, `--version` (`kept doctor`), `context ingest`, `evidence serve`,
 * `generate`, or a misspelled verb. A default would be the worst possible
 * answer here, because the invoker compares this result against the declared
 * family and a wrong-but-plausible family would parse a stream against the
 * wrong terminal event — exactly the silent-nothing failure the three-contract
 * model exists to prevent. `null` makes the mismatch loud: the invoker treats it
 * as the programming error it is. Matching is case-sensitive; Kane's verbs are
 * lower-case and a wrong-case argv is a mistake, not a synonym.
 */
export function familyForArgv(argv: readonly string[]): CommandFamily | null {
  if (!Array.isArray(argv)) return null;
  const tokens = verbTokens(argv);
  if (tokens.length === 0) return null;
  for (const entry of ARGV_INDEX) {
    if (entry.command.length > tokens.length) continue;
    if (entry.command.every((verb, i) => tokens[i] === verb)) return entry.family;
  }
  return null;
}
