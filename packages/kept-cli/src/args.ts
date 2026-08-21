/**
 * The hand-rolled argument parser (design §13.1).
 *
 * No commander, no yargs. The runtime dependency budget of design §2.2 is closed
 * at nine packages and an argument parser is not one of them — which is not a
 * hardship, because what §13.1 actually needs is small and *specific*, and a
 * general-purpose parser would have to be configured into exactly this shape
 * anyway:
 *
 * - a command, optionally followed by a subcommand word (`reconcile apply`,
 *   `amend accept <id>`);
 * - four flags common to every command — `--repo`, `--json`, `--router`,
 *   `--member-debug`;
 * - per-command flags, some boolean, one variadic (`--changed <p…>`);
 * - and one rule with teeth: **`--plan` together with `--apply` is a usage
 *   error** (§13.2.3), the single case in the whole product where `kept` exits
 *   non-zero.
 *
 * That last rule is why this module reports {@link ParsedArgv.usageErrors} as a
 * list rather than throwing. §14.2 is explicit that the CLI's exit code reports
 * whether *KEPT* worked and never whether the product passed, so everything else
 * a caller can get wrong — an unknown command, an unknown flag, a `--router`
 * naming a router that does not exist — comes back as a *note* on the parse and
 * leaves the exit code at zero. A hook that starts failing because somebody
 * typo'd a flag name is a hook somebody disables.
 *
 * Parsing is deliberately total: every argv, including the empty one, produces a
 * `ParsedArgv`. There is no throwing path.
 */

/** The command table of design §13.1, in table order. */
export const KEPT_COMMANDS = Object.freeze([
  'build',
  'verify',
  'reconcile',
  'evolve',
  'amend',
  'snapshot',
  'handoff',
  'doctor',
  'watch',
] as const);

/** One command name from the table. */
export type KeptCommand = (typeof KEPT_COMMANDS)[number];

/** Is this word a command in the table? */
export function isKeptCommand(word: string): word is KeptCommand {
  return (KEPT_COMMANDS as readonly string[]).includes(word);
}

/**
 * Flags that take no value. Everything else that appears as `--name` consumes
 * the following argument, so an unknown value-taking flag still parses rather
 * than swallowing the next flag as a positional.
 */
export const BOOLEAN_FLAGS: readonly string[] = Object.freeze([
  'all',
  'apply',
  'dry-run',
  'help',
  'json',
  'member-debug',
  'plan',
]);

/** Flags that consume every following non-flag word. `--changed <p…>` (§13.1). */
export const VARIADIC_FLAGS: readonly string[] = Object.freeze(['changed']);

/**
 * Mutually exclusive flag pairs — the one usage-error rule (§13.2.3).
 *
 * `--plan` stages and `--apply` walks what was staged, so an argv carrying both
 * describes two incompatible intentions and `kept` rejects it *before* spawning:
 * the invalid argv never reaches Kane. Stated as a table rather than an `if` so
 * that a second pair, if one is ever needed, is a row and not a new code path.
 */
export const MUTUALLY_EXCLUSIVE_FLAGS: readonly (readonly [string, string])[] = Object.freeze([
  Object.freeze(['plan', 'apply'] as const),
]);

/** A parsed flag value. `true` for a boolean, a list for a variadic flag. */
export type FlagValue = true | string | readonly string[];

/** The four flags common to every command (design §13.1). */
export interface CommonOptions {
  /** `--repo <root>`, verbatim as given; the caller resolves it. Default `'.'`. */
  readonly repo: string;
  /** `--json` — machine-readable stdout. */
  readonly json: boolean;
  /** `--router <name>` — overrides `.kept/config.json` for one invocation. */
  readonly router: string | null;
  /** `--member-debug` — `KANE_TESTRUN_MEMBER_DEBUG=1` for the invocation (R4.12). */
  readonly memberDebug: boolean;
}

/** One note the parse recorded. Not an error: the exit code stays zero. */
export interface ArgvNote {
  readonly code: 'unknown-command' | 'unknown-flag' | 'missing-value' | 'no-command';
  readonly message: string;
}

/** Everything one argv said. Total: every input produces one of these. */
export interface ParsedArgv {
  /** The command, or null when none was given or the word is not in the table. */
  readonly command: KeptCommand | null;
  /** The word after the command when it is not a flag (`apply`, `propose`, …). */
  readonly subcommand: string | null;
  /** Remaining non-flag words, in order, subcommand excluded. */
  readonly positionals: readonly string[];
  /** Every flag seen, by name without the leading dashes. */
  readonly flags: ReadonlyMap<string, FlagValue>;
  readonly options: CommonOptions;
  /** `--help` or `-h`, or an argv with no command at all. */
  readonly help: boolean;
  /**
   * Mutually exclusive flags, one message per offending pair. **Empty on every
   * other input**, including an unknown command — see {@link ArgvNote}.
   */
  readonly usageErrors: readonly string[];
  /** Everything else worth saying about the parse. Never affects the exit code. */
  readonly notes: readonly ArgvNote[];
  /** The argv as given, so a `--json` payload can echo it back. */
  readonly argv: readonly string[];
}

/** `kept` worked. Every command's exit code except the one below (§14.2). */
export const EXIT_OK = 0;

/** The sole usage error: mutually exclusive flags (§13.2.3, §14.1 last row). */
export const EXIT_USAGE = 2;

/** Split `--name=value` into its halves; `null` when there is no `=`. */
function splitAssignment(token: string): readonly [string, string] | null {
  const cut = token.indexOf('=');
  if (cut < 0) return null;
  return [token.slice(2, cut), token.slice(cut + 1)];
}

/**
 * Parse an argv tail (`process.argv.slice(2)`).
 *
 * The loop is one pass with three token shapes: `--` ends flag parsing, a
 * `--name` token is a flag, anything else is a positional. Short options exist
 * only for `-h`, because §13.1 declares no others and inventing them would make
 * `kept -r` mean something in this repository and nothing in the design.
 */
export function parseArgv(argv: readonly string[]): ParsedArgv {
  const flags = new Map<string, FlagValue>();
  const positionals: string[] = [];
  const notes: ArgvNote[] = [];
  let flagsClosed = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;

    if (flagsClosed || (!token.startsWith('--') && token !== '-h')) {
      positionals.push(token);
      continue;
    }
    if (token === '--') {
      flagsClosed = true;
      continue;
    }
    if (token === '-h') {
      flags.set('help', true);
      continue;
    }

    const assignment = splitAssignment(token);
    const name = assignment === null ? token.slice(2) : assignment[0];
    if (name.length === 0) continue;

    if (BOOLEAN_FLAGS.includes(name)) {
      // `--json=false` is not a spelling this CLI accepts; the presence of the
      // flag is the whole signal, so an attached value is ignored rather than
      // silently inverted.
      flags.set(name, true);
      continue;
    }
    if (assignment !== null) {
      flags.set(name, assignment[1]);
      if (!isKnownValueFlag(name)) notes.push(unknownFlag(name));
      continue;
    }
    if (VARIADIC_FLAGS.includes(name)) {
      const values: string[] = [];
      while (index + 1 < argv.length) {
        const next = argv[index + 1];
        if (next === undefined || next.startsWith('-')) break;
        values.push(next);
        index += 1;
      }
      flags.set(name, values);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      notes.push({
        code: 'missing-value',
        message: `--${name} expects a value; none was given, so it was ignored`,
      });
      continue;
    }
    index += 1;
    flags.set(name, value);
    if (!isKnownValueFlag(name)) notes.push(unknownFlag(name));
  }

  const first = positionals[0];
  let command: KeptCommand | null = null;
  const rest: string[] = [];
  if (first === undefined) {
    notes.push({ code: 'no-command', message: 'no command was given' });
  } else if (isKeptCommand(first)) {
    command = first;
    rest.push(...positionals.slice(1));
  } else {
    notes.push({
      code: 'unknown-command',
      message:
        `'${first}' is not a kept command; expected one of ` +
        `${KEPT_COMMANDS.join(', ')}`,
    });
    rest.push(...positionals.slice(1));
  }

  const usageErrors: string[] = [];
  for (const [left, right] of MUTUALLY_EXCLUSIVE_FLAGS) {
    if (flags.has(left) && flags.has(right)) {
      usageErrors.push(
        `--${left} and --${right} are mutually exclusive: one stages changes and the other ` +
          `walks what was staged, so no invocation can mean both`,
      );
    }
  }

  const subcommand = rest[0] !== undefined && !rest[0].startsWith('-') ? rest[0] : null;

  return {
    command,
    subcommand,
    positionals: subcommand === null ? rest : rest.slice(1),
    flags,
    options: {
      repo: readString(flags, 'repo') ?? '.',
      json: flags.has('json'),
      router: readString(flags, 'router'),
      memberDebug: flags.has('member-debug'),
    },
    help: flags.has('help') || command === null,
    usageErrors,
    notes,
    argv: [...argv],
  };
}

/**
 * Flags §13.1 declares that take a value. An unrecognised one still parses —
 * this list only decides whether the parse says so.
 */
function isKnownValueFlag(name: string): boolean {
  return (
    name === 'repo' ||
    name === 'router' ||
    name === 'run' ||
    // `kept amend propose --text '<sentence>'` — the replacement KEPT will not
    // invent for itself (§8.3, R7.3). A value flag, and never a boolean, so a
    // sentence beginning with a dash is still refused rather than half-parsed.
    name === 'text' ||
    name === 'from' ||
    name === 'source-id' ||
    VARIADIC_FLAGS.includes(name)
  );
}

function unknownFlag(name: string): ArgvNote {
  return {
    code: 'unknown-flag',
    message: `--${name} is not a flag kept declares; it was parsed and carried, not rejected`,
  };
}

/** A flag's value as a single string, or null when absent or variadic. */
export function readString(
  flags: ReadonlyMap<string, FlagValue>,
  name: string,
): string | null {
  const value = flags.get(name);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** A variadic flag's values, or the empty list when absent. */
export function readList(
  flags: ReadonlyMap<string, FlagValue>,
  name: string,
): readonly string[] {
  const value = flags.get(name);
  if (Array.isArray(value)) return value;
  return typeof value === 'string' ? [value] : [];
}

/**
 * The exit code one parse deserves: {@link EXIT_USAGE} when mutually exclusive
 * flags were given, {@link EXIT_OK} otherwise — for every other outcome,
 * including a command that has not been implemented yet (§14.2).
 */
export function exitCodeFor(parsed: ParsedArgv): number {
  return parsed.usageErrors.length > 0 ? EXIT_USAGE : EXIT_OK;
}
