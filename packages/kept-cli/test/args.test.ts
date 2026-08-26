import { describe, expect, it } from 'vitest';

import {
  BOOLEAN_FLAGS,
  EXIT_OK,
  EXIT_USAGE,
  KEPT_COMMANDS,
  MUTUALLY_EXCLUSIVE_FLAGS,
  VARIADIC_FLAGS,
  exitCodeFor,
  isKeptCommand,
  parseArgv,
  readList,
  readString,
} from '../src/args.js';

/**
 * Unit tests for the hand-rolled argument parser (design §13.1, §13.2.3).
 *
 * The two facts worth nailing down are the four common flags and the single
 * usage-error rule. Everything else the parser does — carrying an unknown flag
 * rather than rejecting it, treating an unknown command as a note — exists to keep
 * the exit code a statement about whether KEPT worked (§14.2), so those are
 * asserted as *zero* exits rather than as messages.
 */
describe('the command table', () => {
  it('carries the ten commands of design §13.1', () => {
    // `init` joined the table with task 24.1. It is deliberately *first*: it is the
    // only command that runs before a repository has a config, so it is the one a
    // stranger reads first in the usage text (§21.1, R16.7).
    expect([...KEPT_COMMANDS]).toEqual([
      'init',
      'build',
      'verify',
      'reconcile',
      'evolve',
      'amend',
      'snapshot',
      'handoff',
      'doctor',
      'watch',
    ]);
  });

  it('recognises exactly those ten', () => {
    for (const command of KEPT_COMMANDS) expect(isKeptCommand(command)).toBe(true);
    expect(isKeptCommand('publish')).toBe(false);
    expect(isKeptCommand('')).toBe(false);
    expect(isKeptCommand('BUILD')).toBe(false);
  });
});

describe('the four common flags', () => {
  it('defaults --repo to the working directory and everything else to off', () => {
    const parsed = parseArgv(['build']);
    expect(parsed.command).toBe('build');
    expect(parsed.options).toEqual({ repo: '.', json: false, router: null, memberDebug: false });
  });

  it('reads a space-separated value', () => {
    const parsed = parseArgv(['build', '--repo', '/tmp/kept', '--router', 'failureYamlTriage']);
    expect(parsed.options.repo).toBe('/tmp/kept');
    expect(parsed.options.router).toBe('failureYamlTriage');
  });

  it('reads an =-attached value', () => {
    const parsed = parseArgv(['build', '--repo=/tmp/kept', '--router=resultCode740']);
    expect(parsed.options.repo).toBe('/tmp/kept');
    expect(parsed.options.router).toBe('resultCode740');
  });

  it('reads the two booleans by presence alone', () => {
    const parsed = parseArgv(['snapshot', '--json', '--member-debug']);
    expect(parsed.options.json).toBe(true);
    expect(parsed.options.memberDebug).toBe(true);
  });

  it('ignores an attached value on a boolean rather than inverting it', () => {
    // `--json=false` is not a spelling this CLI accepts, and reading it as "off"
    // would make a typo silently change the output format.
    expect(parseArgv(['build', '--json=false']).options.json).toBe(true);
  });

  it('does not treat a following flag as a missing value', () => {
    const parsed = parseArgv(['build', '--repo', '--json']);
    expect(parsed.options.repo).toBe('.');
    expect(parsed.options.json).toBe(true);
    expect(parsed.notes.map((note) => note.code)).toContain('missing-value');
  });
});

describe('commands, subcommands and positionals', () => {
  it('reads a subcommand word', () => {
    const parsed = parseArgv(['reconcile', 'apply', '.kept/plan.json']);
    expect(parsed.command).toBe('reconcile');
    expect(parsed.subcommand).toBe('apply');
    expect(parsed.positionals).toEqual(['.kept/plan.json']);
  });

  it('reads a bare positional as the subcommand slot for a one-argument command', () => {
    const parsed = parseArgv(['evolve', 'tests/cart_test.md']);
    expect(parsed.command).toBe('evolve');
    expect(parsed.subcommand).toBe('tests/cart_test.md');
  });

  it('notes an unknown command without making it an error', () => {
    const parsed = parseArgv(['publish', '--json']);
    expect(parsed.command).toBeNull();
    expect(parsed.notes.map((note) => note.code)).toContain('unknown-command');
    expect(exitCodeFor(parsed)).toBe(EXIT_OK);
  });

  it('treats an empty argv as a help request', () => {
    const parsed = parseArgv([]);
    expect(parsed.command).toBeNull();
    expect(parsed.help).toBe(true);
    expect(exitCodeFor(parsed)).toBe(EXIT_OK);
  });

  it('accepts -h and --help', () => {
    expect(parseArgv(['build', '-h']).help).toBe(true);
    expect(parseArgv(['build', '--help']).help).toBe(true);
    expect(parseArgv(['build']).help).toBe(false);
  });

  it('stops parsing flags after a bare --', () => {
    const parsed = parseArgv(['amend', 'accept', '--', '--json']);
    expect(parsed.options.json).toBe(false);
    expect(parsed.positionals).toEqual(['--json']);
  });
});

describe('the variadic --changed flag', () => {
  it('consumes every following non-flag word', () => {
    const parsed = parseArgv([
      'verify',
      '--changed',
      'apps/fixture/lib/cart.ts',
      'apps/fixture/lib/currency.ts',
      '--json',
    ]);
    expect(readList(parsed.flags, 'changed')).toEqual([
      'apps/fixture/lib/cart.ts',
      'apps/fixture/lib/currency.ts',
    ]);
    expect(parsed.options.json).toBe(true);
  });

  it('answers an empty list when it was not given', () => {
    expect(readList(parseArgv(['verify', '--all']).flags, 'changed')).toEqual([]);
  });

  it('answers an empty list when it was given with no paths', () => {
    expect(readList(parseArgv(['verify', '--changed']).flags, 'changed')).toEqual([]);
  });
});

describe('the single usage error (§13.2.3)', () => {
  it('declares exactly the --plan/--apply pair', () => {
    expect(MUTUALLY_EXCLUSIVE_FLAGS.map((pair) => [...pair])).toEqual([['plan', 'apply']]);
  });

  it('rejects --plan with --apply and exits 2', () => {
    const parsed = parseArgv(['reconcile', '--plan', '--apply']);
    expect(parsed.usageErrors).toHaveLength(1);
    expect(parsed.usageErrors[0]).toContain('--plan and --apply are mutually exclusive');
    expect(exitCodeFor(parsed)).toBe(EXIT_USAGE);
  });

  it('accepts either flag alone', () => {
    expect(exitCodeFor(parseArgv(['reconcile', '--plan']))).toBe(EXIT_OK);
    expect(exitCodeFor(parseArgv(['reconcile', 'apply', '--apply']))).toBe(EXIT_OK);
  });

  it('is the only non-zero exit — an unknown flag is not one', () => {
    const parsed = parseArgv(['build', '--turbo', 'yes']);
    expect(readString(parsed.flags, 'turbo')).toBe('yes');
    expect(parsed.notes.map((note) => note.code)).toContain('unknown-flag');
    expect(exitCodeFor(parsed)).toBe(EXIT_OK);
  });
});

describe('the flag vocabularies', () => {
  it('lists the booleans and the one variadic without overlap', () => {
    expect(BOOLEAN_FLAGS).toContain('json');
    expect(BOOLEAN_FLAGS).toContain('member-debug');
    expect([...VARIADIC_FLAGS]).toEqual(['changed']);
    for (const name of VARIADIC_FLAGS) expect(BOOLEAN_FLAGS).not.toContain(name);
  });

  it('reads a variadic flag through readString as null, not as a joined string', () => {
    const parsed = parseArgv(['verify', '--changed', 'a.ts', 'b.ts']);
    expect(readString(parsed.flags, 'changed')).toBeNull();
  });
});
