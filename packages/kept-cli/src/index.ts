#!/usr/bin/env node
/**
 * `kept-cli` entry point. `bin/kept` at the repository root resolves to the
 * compiled form of this file (design §13.1).
 *
 * Deliberately thin. Everything the CLI does lives in {@link main}, which takes
 * argv and an I/O seam and returns an exit code, so the command surface can be
 * asserted with no child process anywhere. This file is the only place in the
 * package that touches the real `process`, and its whole job is to hand `main`
 * the real world and hand the shell the code it returned.
 *
 * The `catch` is not a degradation path. Every state of the world — a missing
 * `kane-cli`, a `cover` that refused, a corrupt state file, an unreadable
 * `*_test.md` — is reported as a diagnostic by the module that met it and exits 0
 * (§14.2). So an exception reaching here means KEPT itself is broken, which is the
 * one thing a non-zero exit is *for*: it prints the stack rather than swallowing
 * it, because a silent CLI that exits 1 is the hardest possible thing to debug
 * from inside an editor hook.
 */
import { main } from './main.js';

/** Exit code for an unhandled exception: KEPT is broken, not the product (§14.2). */
const EXIT_INTERNAL_ERROR = 1;

try {
  const code = await main(process.argv.slice(2), {
    write: (text: string): void => {
      process.stdout.write(text);
    },
    writeError: (text: string): void => {
      process.stderr.write(text);
    },
    cwd: process.cwd(),
    env: process.env,
  });
  process.exitCode = code;
} catch (error) {
  process.stderr.write(
    [
      'kept: the CLI itself failed, which is a bug in kept rather than a state of the',
      '  world — every Kane outcome and every unreadable file is reported as data and',
      '  exits 0 (design §14.2). Please include the trace below in the report.',
      '',
      error instanceof Error ? (error.stack ?? error.message) : String(error),
      '',
    ].join('\n'),
  );
  process.exitCode = EXIT_INTERNAL_ERROR;
}
