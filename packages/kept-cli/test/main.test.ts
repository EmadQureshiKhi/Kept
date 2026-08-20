import type { StateFileSystem } from '@kept/core';
import { STATE_FILE_RELATIVE_PATH, inMemoryStateFileSystem, parseSnapshot } from '@kept/core';
import { describe, expect, it } from 'vitest';

import { EXIT_OK, EXIT_USAGE, KEPT_COMMANDS } from '../src/args.js';
import { CONFIG_FILE_RELATIVE_PATH } from '../src/config.js';
import { IMPLEMENTED_COMMANDS, USAGE, main } from '../src/main.js';
import { SNAPSHOT_FILE_RELATIVE_PATH } from '../src/snapshot.js';

/**
 * The dispatcher (design §13.1, §13.2.3, §14.2).
 *
 * `main` takes argv and an I/O seam and returns an exit code, so the whole command
 * surface is asserted here with no child process, no temporary directory and no
 * `process.exit`. The one thing worth over-testing is the exit code: it is the
 * value the save hooks read, and §14.2 makes it a statement about whether KEPT
 * worked rather than about whether the product passed.
 */
const REPO = '/repo';

interface Harness {
  readonly out: string[];
  readonly err: string[];
  readonly env: Record<string, string | undefined>;
  readonly fileSystem: StateFileSystem;
  run(argv: readonly string[]): Promise<number>;
}

function harness(seed: Readonly<Record<string, string>> = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const env: Record<string, string | undefined> = {};
  const fileSystem = inMemoryStateFileSystem(seed);
  return {
    out,
    err,
    env,
    fileSystem,
    run: (argv) =>
      main(argv, {
        write: (text) => {
          out.push(text);
        },
        writeError: (text) => {
          err.push(text);
        },
        cwd: REPO,
        env,
        fileSystem,
        now: () => new Date('2026-08-20T12:00:00.000Z'),
        // No Kane boundary: R2.12 is a supported state of the world and it keeps
        // this suite from ever reaching a real binary.
        kane: false,
      }),
  };
}

describe('help and usage', () => {
  it('prints the usage text and exits 0 for an empty argv', async () => {
    const io = harness();
    expect(await io.run([])).toBe(EXIT_OK);
    expect(io.out.join('')).toContain('Usage: kept <command> [options]');
  });

  it('names every command of the §13.1 table in the usage text', () => {
    for (const command of KEPT_COMMANDS) expect(USAGE).toContain(command);
  });

  it('names which commands this build implements', () => {
    expect([...IMPLEMENTED_COMMANDS]).toEqual(['build', 'snapshot', 'verify', 'reconcile']);
    for (const command of IMPLEMENTED_COMMANDS) expect(USAGE).toContain(command);
  });

  it('exits 0 for --help on a real command', async () => {
    const io = harness();
    expect(await io.run(['build', '--help'])).toBe(EXIT_OK);
  });
});

describe('the exit-code policy (§14.2)', () => {
  it('exits 2 for --plan with --apply, before anything runs', async () => {
    const io = harness();
    expect(await io.run(['reconcile', '--plan', '--apply'])).toBe(EXIT_USAGE);
    expect(io.err.join('')).toContain('mutually exclusive');
    // Nothing was written: no state file, no snapshot.
    expect(io.fileSystem.readFile(`${REPO}/${STATE_FILE_RELATIVE_PATH}`)).toBeNull();
    expect(io.fileSystem.readFile(`${REPO}/${SNAPSHOT_FILE_RELATIVE_PATH}`)).toBeNull();
  });

  it('exits 0 for an unknown command', async () => {
    const io = harness();
    expect(await io.run(['publish'])).toBe(EXIT_OK);
  });

  it('exits 0 for an unknown flag', async () => {
    const io = harness();
    expect(await io.run(['snapshot', '--turbo'])).toBe(EXIT_OK);
  });

  it('exits 0 for a command that is specified but not yet implemented', async () => {
    const io = harness();
    for (const command of KEPT_COMMANDS) {
      if (IMPLEMENTED_COMMANDS.includes(command)) continue;
      expect(await io.run([command])).toBe(EXIT_OK);
    }
  });

  it('exits 0 for a degraded build — Kane absent is data, not a failure (R2.12)', async () => {
    const io = harness();
    expect(await io.run(['build'])).toBe(EXIT_OK);
    expect(io.out.join('')).toContain('degraded     true');
  });
});

describe('kept build through main', () => {
  it('writes the state file under the resolved --repo root', async () => {
    const io = harness();
    expect(await io.run(['build', '--repo', REPO])).toBe(EXIT_OK);
    expect(io.fileSystem.readFile(`${REPO}/${STATE_FILE_RELATIVE_PATH}`)).not.toBeNull();
  });

  it('emits a JSON payload on stdout under --json, with no diagnostics on stderr', async () => {
    const io = harness();
    expect(await io.run(['build', '--json'])).toBe(EXIT_OK);
    const payload = JSON.parse(io.out.join('')) as Record<string, unknown>;
    expect(payload['command']).toBe('build');
    expect(payload['implemented']).toBe(true);
    expect(payload['degraded']).toBe(true);
    expect(Array.isArray(payload['diagnostics'])).toBe(true);
    expect(io.err.join('')).toBe('');
  });
});

describe('kept snapshot through main', () => {
  it('writes a schema-valid snapshot even with no state file at all', async () => {
    const io = harness();
    expect(await io.run(['snapshot'])).toBe(EXIT_OK);
    const text = io.fileSystem.readFile(`${REPO}/${SNAPSHOT_FILE_RELATIVE_PATH}`);
    expect(text).not.toBeNull();
    const snapshot = parseSnapshot(text as string);
    expect(snapshot.generatedAt).toBe('2026-08-20T12:00:00.000Z');
    expect(snapshot.promises).toEqual([]);
  });

  it('reports both coverage figures as n/a for an empty ledger', async () => {
    const io = harness();
    await io.run(['snapshot']);
    expect(io.out.join('')).toContain('designed     n/a');
    expect(io.out.join('')).toContain('proven       n/a');
  });

  it('runs after build and carries what build produced', async () => {
    const io = harness();
    await io.run(['build']);
    await io.run(['snapshot']);
    const text = io.fileSystem.readFile(`${REPO}/${SNAPSHOT_FILE_RELATIVE_PATH}`);
    const snapshot = parseSnapshot(text as string);
    // No `*_test.md` files on the injected filesystem, so the honest answer is an
    // empty ledger that is degraded because the enrichment axis was absent.
    expect(snapshot.degraded).toBe(true);
    expect(snapshot.metrics.totalPromises).toBe(0);
  });
});

describe('the common flags reach the commands', () => {
  it('sets KANE_TESTRUN_MEMBER_DEBUG=1 for --member-debug and nothing otherwise (R4.12)', async () => {
    const off = harness();
    await off.run(['snapshot']);
    expect(off.env['KANE_TESTRUN_MEMBER_DEBUG']).toBeUndefined();

    const on = harness();
    await on.run(['snapshot', '--member-debug']);
    expect(on.env['KANE_TESTRUN_MEMBER_DEBUG']).toBe('1');
  });

  it('honours --router for one invocation and warns on an unknown one', async () => {
    const io = harness({
      [`${REPO}/${CONFIG_FILE_RELATIVE_PATH}`]: JSON.stringify({
        verdictRouter: 'resultCode740',
        memberDebug: false,
        timeouts: { hookMs: 300_000, enrichmentMs: 60_000 },
      }),
    });
    expect(await io.run(['handoff', '--router', 'failureYamlTriage', '--json'])).toBe(EXIT_OK);
    const payload = JSON.parse(io.out.join('')) as Record<string, unknown>;
    expect(payload['router']).toBe('failureYamlTriage');

    const bad = harness();
    expect(await bad.run(['handoff', '--router', 'magic', '--json'])).toBe(EXIT_OK);
    const badPayload = JSON.parse(bad.out.join('')) as Record<string, unknown>;
    expect(badPayload['router']).toBe('resultCode740');
  });

  it('resolves --repo relative to the working directory', async () => {
    const io = harness();
    expect(await io.run(['snapshot', '--repo', 'nested'])).toBe(EXIT_OK);
    expect(
      io.fileSystem.readFile(`${REPO}/nested/${SNAPSHOT_FILE_RELATIVE_PATH}`),
    ).not.toBeNull();
  });
});
