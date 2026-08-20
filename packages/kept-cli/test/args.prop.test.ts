import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  BOOLEAN_FLAGS,
  EXIT_OK,
  EXIT_USAGE,
  KEPT_COMMANDS,
  VARIADIC_FLAGS,
  exitCodeFor,
  parseArgv,
} from '../src/args.js';

/**
 * Property tests for the argument parser.
 *
 * Two properties, and both are about the exit-code policy rather than about
 * parsing convenience, because that policy is the load-bearing part: design §14.2
 * makes the CLI's exit code a statement about whether KEPT worked, and §14.1's
 * last row makes mutually exclusive flags the only non-zero case in the product. A
 * parser that exits 2 on a stray argument would take a save hook down every time
 * somebody mistyped a path.
 *
 * These are not numbered design properties — the design's twenty-nine properties
 * are all about the model, the parser and the router. They are local invariants of
 * this module, generated over the same 500-case budget the rest of the suite uses.
 */
const NUM_RUNS = 500;

/** Any argv token at all: flags, values, empty strings, dashes, unicode. */
const arbToken = fc.oneof(
  fc.constantFrom(...KEPT_COMMANDS),
  fc.constantFrom(...BOOLEAN_FLAGS.map((name) => `--${name}`)),
  fc.constantFrom(...VARIADIC_FLAGS.map((name) => `--${name}`)),
  fc.constantFrom('--repo', '--router', '--', '-h', '-', '', '--', '--=', '--repo=', 'apply'),
  fc.string(),
  fc.string().map((text) => `--${text}`),
  fc.string().map((text) => `--${text}=value`),
);

const arbArgv = fc.array(arbToken, { maxLength: 12 });

describe('parsing is total', () => {
  it('never throws, and always answers a well-formed parse', () => {
    fc.assert(
      fc.property(arbArgv, (argv) => {
        const parsed = parseArgv(argv);
        expect(parsed.argv).toEqual(argv);
        // A command is either one from the table or null; never an arbitrary word.
        if (parsed.command !== null) expect(KEPT_COMMANDS).toContain(parsed.command);
        // The four common options are always fully populated.
        expect(typeof parsed.options.repo).toBe('string');
        expect(parsed.options.repo.length).toBeGreaterThan(0);
        expect(typeof parsed.options.json).toBe('boolean');
        expect(typeof parsed.options.memberDebug).toBe('boolean');
        expect(parsed.options.router === null || typeof parsed.options.router === 'string').toBe(
          true,
        );
        // Help is implied by the absence of a command, so it can never be false
        // while the command is null — that combination would leave `main` with a
        // command to dispatch and nothing to dispatch it to.
        if (parsed.command === null) expect(parsed.help).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('the exit code is 2 exactly when mutually exclusive flags were given', () => {
  it('holds over arbitrary argv', () => {
    fc.assert(
      fc.property(arbArgv, (argv) => {
        const parsed = parseArgv(argv);
        const bothPresent = parsed.flags.has('plan') && parsed.flags.has('apply');
        expect(exitCodeFor(parsed)).toBe(bothPresent ? EXIT_USAGE : EXIT_OK);
        expect(parsed.usageErrors.length > 0).toBe(bothPresent);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is unaffected by where in the argv the two flags appear', () => {
    fc.assert(
      fc.property(arbArgv, arbArgv, arbArgv, (head, middle, tail) => {
        const argv = [...head, '--plan', ...middle, '--apply', ...tail];
        // A `--` in the head closes flag parsing, which is a different argv and
        // not a counterexample to the rule under test.
        fc.pre(!head.includes('--') && !middle.includes('--'));
        expect(exitCodeFor(parseArgv(argv))).toBe(EXIT_USAGE);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('a boolean flag is set by presence and never by its value', () => {
  it('holds for every declared boolean', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...BOOLEAN_FLAGS),
        fc.option(fc.string(), { nil: undefined }),
        (name, attached) => {
          const token = attached === undefined ? `--${name}` : `--${name}=${attached}`;
          const parsed = parseArgv(['build', token]);
          expect(parsed.flags.get(name)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
