import type { StateFileSystem } from '@kept/core';
import { STATE_FILE_RELATIVE_PATH, inMemoryStateFileSystem, parseSnapshot } from '@kept/core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
    // `init` (task 24.1) and `doctor` (task 24.3) joined the list together, because
    // they are the two halves of one thing: the surface a stranger meets before this
    // repository has a config, a corpus or a snapshot (§21, A18).
    //
    // `watch` (task 21.8) is the loopback accept listener of §8.5. It is on this list
    // because the command runs and reports; with no `NEXT_PUBLIC_KEPT_LOCAL=1` in the
    // environment it binds nothing, which is the path every test in this file takes.
    expect([...IMPLEMENTED_COMMANDS]).toEqual([
      'init',
      'build',
      'snapshot',
      'verify',
      'reconcile',
      'evolve',
      'amend',
      'doctor',
      'watch',
      // `handoff` was the last one outstanding. It was advertised in the help text,
      // dispatched nowhere, and its pending entry pointed at task 12.11, which is a
      // completed test about hook schemas. Every piece it needed was already in
      // `handoff/handoff.ts`, so implementing it was cheaper than the three false
      // claims a reader could act on.
      'handoff',
    ]);
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
    /**
     * Driven through `kept doctor` rather than `kept handoff`.
     *
     * It used to use `handoff`, for the accidental reason that `handoff` was the one
     * unimplemented command and `reportPending`'s payload happened to carry a `router`
     * field. `handoff` is implemented now, and it reads a file rather than routing
     * anything, so a `router` key in its output would have been noise kept alive only to
     * satisfy this test.
     *
     * `doctor` is the honest vehicle and a better one: its second check reports the
     * router **in force for this invocation**, and its own source comment explains that
     * reporting the file's value instead would tell a reader the run used a router it did
     * not use. So this now asserts the override where the override is actually observable.
     */
    function routerOf(out: readonly string[]): string {
      const payload = JSON.parse(out.join('')) as {
        readonly checks: readonly { readonly id: string; readonly detail: string }[];
      };
      const check = payload.checks.find((entry) => entry.id === 'configuration');
      expect(check, 'kept doctor no longer reports a configuration check').toBeDefined();
      const named = /'([A-Za-z0-9]+)' router/.exec(check?.detail ?? '');
      expect(named, `no router named in: ${check?.detail ?? '(none)'}`).not.toBeNull();
      return named?.[1] ?? '';
    }

    const config = JSON.stringify({
      verdictRouter: 'resultCode740',
      memberDebug: false,
      timeouts: { hookMs: 300_000, enrichmentMs: 60_000 },
    });

    const io = harness({ [`${REPO}/${CONFIG_FILE_RELATIVE_PATH}`]: config });
    expect(await io.run(['doctor', '--router', 'failureYamlTriage', '--json'])).toBe(EXIT_OK);
    expect(routerOf(io.out)).toBe('failureYamlTriage');

    // An unknown name is warned about and the configured one stands, rather than the
    // run proceeding on a router nothing implements.
    const bad = harness({ [`${REPO}/${CONFIG_FILE_RELATIVE_PATH}`]: config });
    expect(await bad.run(['doctor', '--router', 'magic', '--json'])).toBe(EXIT_OK);
    expect(routerOf(bad.out)).toBe('resultCode740');
  });

  it('resolves --repo relative to the working directory', async () => {
    const io = harness();
    expect(await io.run(['snapshot', '--repo', 'nested'])).toBe(EXIT_OK);
    expect(
      io.fileSystem.readFile(`${REPO}/nested/${SNAPSHOT_FILE_RELATIVE_PATH}`),
    ).not.toBeNull();
  });
});

/**
 * `kept handoff` (design §13.1, R11.4, R11.7).
 *
 * The last command in the help text that did not dispatch. It was advertised, absent, and
 * pointed anyone who ran it at task 12.11, a completed test about hook schemas, so the
 * three claims a reader could act on were all false at once. These assertions are the ones
 * whose absence let that stand: that it dispatches at all, that both spellings of the path
 * are reachable, that a repository with no handoff is an ordinary state rather than an
 * error, and that the printed bytes are the file rather than a summary of it.
 */
describe('kept handoff prints the record an agent acts on', () => {
  /**
   * A real handoff, re-idded.
   *
   * Read from `docs/kane/loop/green-57591bff.handoff.json`, which a live verification
   * actually wrote, rather than hand-built. A hand-built one was tried first and did not
   * satisfy `parseHandoff`, which is exactly the right outcome: a fixture that passes a
   * validator the real writer's output would fail proves nothing about the command, and
   * the temptation would then have been to loosen the validator.
   */
  const REAL_HANDOFF = readFileSync(
    fileURLToPath(new URL('../../../docs/kane/loop/green-57591bff.handoff.json', import.meta.url)),
    'utf8',
  );

  function handoffJson(runId: string): string {
    const parsed = JSON.parse(REAL_HANDOFF) as Record<string, unknown>;
    return `${JSON.stringify({ ...parsed, runId }, null, 2)}\n`;
  }

  it('is dispatched rather than reported as pending', async () => {
    const io = harness({ [`${REPO}/.kept/handoff.json`]: handoffJson('run-newest') });
    expect(await io.run(['handoff', '--json'])).toBe(EXIT_OK);
    const payload = JSON.parse(io.out.join('')) as Record<string, unknown>;
    expect(payload['command']).toBe('handoff');
    // The claim that used to be false.
    expect(payload['implemented']).toBe(true);
    expect((payload['handoff'] as Record<string, unknown>)['runId']).toBe('run-newest');
  });

  it('reads the newest handoff with no argument and the archive with --run', async () => {
    const io = harness({
      [`${REPO}/.kept/handoff.json`]: handoffJson('run-newest'),
      [`${REPO}/.kept/handoff/run-older.json`]: handoffJson('run-older'),
    });

    expect(await io.run(['handoff', '--json'])).toBe(EXIT_OK);
    const newest = JSON.parse(io.out.join('')) as Record<string, unknown>;
    expect((newest['handoff'] as Record<string, unknown>)['runId']).toBe('run-newest');
    expect(newest['path']).toBe(`${REPO}/.kept/handoff.json`);

    const archived = harness({
      [`${REPO}/.kept/handoff.json`]: handoffJson('run-newest'),
      [`${REPO}/.kept/handoff/run-older.json`]: handoffJson('run-older'),
    });
    expect(await archived.run(['handoff', '--run', 'run-older', '--json'])).toBe(EXIT_OK);
    const older = JSON.parse(archived.out.join('')) as Record<string, unknown>;
    // R11.7: the per-run copy is immutable, so asking for a run must never answer
    // with the newest one, which is the mistake that would make the flag useless.
    expect((older['handoff'] as Record<string, unknown>)['runId']).toBe('run-older');
    expect(older['runId']).toBe('run-older');
  });

  it('prints the file itself, not a summary of it', async () => {
    const text = handoffJson('run-newest');
    const io = harness({ [`${REPO}/.kept/handoff.json`]: text });
    expect(await io.run(['handoff'])).toBe(EXIT_OK);
    // An agent needs the fence and the instruction exactly as written; a paraphrase
    // would be a second, lossier spelling of a contract that already has one.
    const printed = io.out.join('');
    expect(JSON.parse(printed)).toEqual(JSON.parse(text));
    expect(printed).toContain('"forbiddenPaths"');
    expect(printed).toContain('"instruction"');
  });

  it('treats an absent handoff as an ordinary state and still exits 0', async () => {
    const io = harness();
    expect(await io.run(['handoff'])).toBe(EXIT_OK);
    const printed = io.out.join('');
    expect(printed).toContain('no handoff exists at');
    expect(printed).toContain('ordinary state rather than a failure');
    // Named rather than crashed, and the remedy is the command that makes one.
    expect(printed).toContain('kept verify');
  });

  it('says so rather than throwing when the file is not a handoff', async () => {
    const io = harness({ [`${REPO}/.kept/handoff.json`]: '{ "schemaVersion": 99 }\n' });
    expect(await io.run(['handoff', '--json'])).toBe(EXIT_OK);
    const payload = JSON.parse(io.out.join('')) as Record<string, unknown>;
    expect(payload['handoff']).toBeNull();
    expect(
      (payload['diagnostics'] as readonly { readonly code: string }[]).map((d) => d.code),
    ).toContain('handoff-absent');
  });

  it('spawns nothing and writes nothing, so a hook prompt can quote it', async () => {
    // A handoff records a run that already happened. A command that re-ran anything to
    // show it would turn the two agent hooks' read into a side effect.
    const before = handoffJson('run-newest');
    const io = harness({ [`${REPO}/.kept/handoff.json`]: before });
    expect(await io.run(['handoff'])).toBe(EXIT_OK);
    expect(io.fileSystem.readFile(`${REPO}/.kept/handoff.json`)).toBe(before);
    expect(io.fileSystem.readFile(`${REPO}/${STATE_FILE_RELATIVE_PATH}`)).toBeNull();
    expect(io.fileSystem.readFile(`${REPO}/${SNAPSHOT_FILE_RELATIVE_PATH}`)).toBeNull();
  });
});
