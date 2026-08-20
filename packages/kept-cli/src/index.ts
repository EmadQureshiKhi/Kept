#!/usr/bin/env node
/**
 * `@kept/cli` entry point. `bin/kept` at the repository root resolves to the
 * compiled form of this file (design §13.1).
 *
 * This is the skeleton: the hand-rolled argument parser (no commander, no
 * yargs) and the command table of design §13.1 — `build`, `verify`,
 * `reconcile`, `evolve`, `amend`, `snapshot`, `handoff`, `doctor`, `watch` —
 * land in task 3.18. Until then the entry point reports honestly rather than
 * pretending to accept a command it cannot run.
 *
 * The import below is deliberate: it keeps the `@kept/cli` → `@kept/core`
 * project reference exercised from the first commit, so a broken build graph
 * fails at `tsc -b` rather than at the first real command.
 */
import { KEPT_CORE_PACKAGE } from '@kept/core';

const argv: readonly string[] = process.argv.slice(2);

process.stderr.write(
  [
    'kept: no commands are implemented yet (design §13.1 lands in task 3.18).',
    `  invoked with: ${argv.length > 0 ? argv.join(' ') : '(no arguments)'}`,
    `  core library:  ${KEPT_CORE_PACKAGE}`,
    '',
  ].join('\n'),
);

// Non-zero: the CLI is present but cannot yet do the work it was asked for.
// Once §13.1 is implemented, Kane's outcomes become data and every command
// exits 0 except the mutually-exclusive-flag usage error (R2.10, §13.2.3).
process.exit(1);
