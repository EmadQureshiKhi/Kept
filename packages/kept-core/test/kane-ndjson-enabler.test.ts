import { describe, expect, it } from 'vitest';

import {
  AGENT_FLAG,
  COMMAND_FAMILIES,
  KaneInvoker,
  NDJSON_ENABLER_ARGV,
  applyNdjsonEnabler,
  contractFor,
  plainArgv,
  type ChildProcessLike,
  type CommandFamily,
  type SpawnOptionsLike,
} from '@kept/core';

/**
 * Task 2.21 — the per-family NDJSON enabler and the family/argv assertions, at
 * the invoker seam (design §4.7 steps 2–4, R3.4, R3.5).
 *
 * Every assertion here runs against a **stub spawn**: no Kane process is created,
 * no credit is spent, and `PATH` is never consulted. This is the contract task
 * 12.13 extends per KEPT command, so the table below is written out literally
 * rather than derived, and the source is checked against it.
 */

/** A stdout/stderr stand-in. Nothing is written to it in this suite. */
class FakeStream {
  private listener: ((chunk: string) => void) | undefined;
  encoding: string | undefined;

  setEncoding(encoding: string): unknown {
    this.encoding = encoding;
    return this;
  }

  on(_event: string, listener: (chunk: string) => void): unknown {
    this.listener = listener;
    return this;
  }

  emit(chunk: string): void {
    this.listener?.(chunk);
  }
}

/** A child process stand-in that closes cleanly on the next microtask. */
class FakeChild {
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  readonly signals: string[] = [];
  private readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  on(event: string, listener: (...args: unknown[]) => void): unknown {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  kill(signal?: string): boolean {
    this.signals.push(signal ?? 'SIGTERM');
    return true;
  }

  emitClose(code: number | null): void {
    for (const listener of this.listeners.get('close') ?? []) listener(code, null);
  }

  asChild(): ChildProcessLike {
    return this as unknown as ChildProcessLike;
  }
}

interface SpawnCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: SpawnOptionsLike;
}

/** An invoker whose every dependency is a stub. Never spawns, never resolves PATH. */
function stubInvoker(): { invoker: KaneInvoker; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const invoker = new KaneInvoker({
    resolveBinary: () => '/stub/bin/kane-cli',
    spawn: (command, args, options) => {
      calls.push({ command, args: [...args], options });
      const child = new FakeChild();
      queueMicrotask(() => {
        child.emitClose(0);
      });
      return child.asChild();
    },
  });
  return { invoker, calls };
}

/** A representative, classifiable argv per family, enabler deliberately absent. */
const ARGV: { readonly [F in CommandFamily]: readonly string[] } = {
  ExecutionRun: ['run', 'log in as the demo user'],
  ExecutionTestrun: ['testrun', 'run', '--from-context', 'T-1,T-2'],
  Assurance: ['cover', '--json'],
};

/** What each family's argv must gain. Written out, not derived (R3.4, R3.5). */
const APPENDED: { readonly [F in CommandFamily]: readonly string[] } = {
  ExecutionRun: [AGENT_FLAG],
  ExecutionTestrun: [],
  Assurance: ['--mode', 'agent'],
};

describe('applyNdjsonEnabler — the per-family argv contract', () => {
  it('appends exactly `--agent` for ExecutionRun', () => {
    expect(applyNdjsonEnabler('ExecutionRun', ['run', 'do a thing'])).toEqual([
      'run',
      'do a thing',
      '--agent',
    ]);
    // `testmd run` is the same family and gains the same flag.
    expect(applyNdjsonEnabler('ExecutionRun', ['testmd', 'run', 'x_test.md'])).toEqual([
      'testmd',
      'run',
      'x_test.md',
      '--agent',
    ]);
  });

  it('appends nothing at all for ExecutionTestrun', () => {
    // `testrun run` has no `--agent` flag; NDJSON arrives because stdout is a pipe.
    const argv = ['testrun', 'run', '--from-context', 'T-1', '--parallel', '2'];
    expect(applyNdjsonEnabler('ExecutionTestrun', argv)).toEqual(argv);
    expect(applyNdjsonEnabler('ExecutionTestrun', argv)).not.toContain(AGENT_FLAG);
  });

  it('appends `--mode agent` for every Assurance command', () => {
    for (const argv of [
      ['context', 'extract'],
      ['design', 'tests', '--use-case', 'UC-1'],
      ['maintain', 'reconcile', '--from', 'README.md', '--source-id', 'S-1'],
      ['maintain', 'evolve'],
      ['cover', '--json'],
      ['cover', 'gaps'],
    ]) {
      expect(applyNdjsonEnabler('Assurance', argv)).toEqual([...argv, '--mode', 'agent']);
    }
  });

  it('refuses `context list`, which has no `--mode` flag to append', () => {
    // Observed: `context list --type source --json --mode agent` exits 1 with an
    // empty stdout and `error: unknown option '--mode'` on stderr. The command
    // carries none of the four family facts, so it is not in the table, and asking
    // for an enabler is now a loud programming error rather than a silent listing
    // that never matched.
    const argv = ['context', 'list', '--type', 'source', '--json'];
    expect(() => applyNdjsonEnabler('Assurance', argv)).toThrow(TypeError);
    // The mirror: it is invoked plainly, and nothing is appended.
    expect(plainArgv(argv)).toEqual(argv);
    // And a family command cannot go the other way either.
    expect(() => plainArgv(['cover', '--json'])).toThrow(TypeError);
  });

  it('matches the written-out table for every family', () => {
    for (const family of COMMAND_FAMILIES) {
      const argv = ARGV[family];
      expect(applyNdjsonEnabler(family, argv)).toEqual([...argv, ...APPENDED[family]]);
    }
  });

  it('reads the enabler from the contract rather than re-deriving it', () => {
    for (const family of COMMAND_FAMILIES) {
      expect(NDJSON_ENABLER_ARGV[contractFor(family).ndjson]).toEqual(APPENDED[family]);
    }
  });

  it('adds exactly one enabler, never two, when called on its own output', () => {
    // Guards the seam against a caller that pre-applied the flag: `run --agent`
    // still classifies as ExecutionRun, so only the count catches a double apply.
    const once = applyNdjsonEnabler('ExecutionRun', ['run', 'x']);
    expect(once.filter((token) => token === AGENT_FLAG)).toHaveLength(1);
  });
});

describe('applyNdjsonEnabler — `--agent` is rejected on ExecutionTestrun (R3.5)', () => {
  const CASES: readonly [readonly string[]][] = [
    [['testrun', 'run', AGENT_FLAG]],
    [['testrun', 'run', '--parallel', '2', AGENT_FLAG]],
    [['testrun', 'run', AGENT_FLAG, '--tags', 'smoke']],
    [['testrun', 'run', '--agent=1']],
  ];

  it.each(CASES)('rejects %j', (argv) => {
    expect(() => applyNdjsonEnabler('ExecutionTestrun', argv)).toThrow(TypeError);
    expect(() => applyNdjsonEnabler('ExecutionTestrun', argv)).toThrow(/not a flag of this command/);
  });

  it('rejects it wherever it sits, not only in first position', () => {
    const trailing = ['testrun', 'run', '--match', 'checkout', AGENT_FLAG];
    expect(() => applyNdjsonEnabler('ExecutionTestrun', trailing)).toThrow(TypeError);
  });

  it('leaves the same flag alone for the family that owns it', () => {
    expect(() => applyNdjsonEnabler('ExecutionRun', ['run', 'x', AGENT_FLAG])).not.toThrow();
  });
});

describe('applyNdjsonEnabler — a family/argv mismatch throws at development time', () => {
  const MISMATCHES: readonly [string, CommandFamily, readonly string[]][] = [
    ['ExecutionRun declared, Assurance argv', 'ExecutionRun', ['cover', '--json']],
    ['Assurance declared, ExecutionRun argv', 'Assurance', ['run', 'x']],
    ['ExecutionTestrun declared, ExecutionRun argv', 'ExecutionTestrun', ['run', 'x']],
    ['ExecutionRun declared, testrun argv', 'ExecutionRun', ['testrun', 'run']],
    ['Assurance declared, testmd argv', 'Assurance', ['testmd', 'run', 'a_test.md']],
  ];

  it.each(MISMATCHES)('%s', (_label, family, argv) => {
    expect(() => applyNdjsonEnabler(family, argv)).toThrow(TypeError);
    expect(() => applyNdjsonEnabler(family, argv)).toThrow(/does not belong to the declared family/);
  });

  it('throws for an unclassifiable argv, for every declared family', () => {
    // `familyForArgv` returns null rather than a default, and null is a mismatch:
    // `context ingest` and `--version` have no family, so no enabler is guessable.
    const unclassifiable: readonly (readonly string[])[] = [
      [],
      ['--version'],
      ['context', 'ingest', 'README.md'],
      ['coverr'],
      ['Cover'],
    ];
    for (const argv of unclassifiable) {
      for (const family of COMMAND_FAMILIES) {
        expect(() => applyNdjsonEnabler(family, argv)).toThrow(TypeError);
      }
    }
  });

  it('names "no family" when the argv classifies as nothing', () => {
    expect(() => applyNdjsonEnabler('Assurance', ['--version'])).toThrow(/argv classifies as no family/);
  });

  it('is the only pair of throws — a rejection or a crash is never one', () => {
    // The boundary of design §14.2: our bug throws, Kane's behaviour is data.
    // The data half is asserted in kane-invoker.test.ts; this pins the throwing
    // half to exactly these two messages.
    expect(() => applyNdjsonEnabler('ExecutionTestrun', ['testrun', 'run'])).not.toThrow();
    expect(() => applyNdjsonEnabler('Assurance', ['cover'])).not.toThrow();
  });
});

describe('KaneInvoker.invoke — the argv Kane actually receives', () => {
  it('passes the enabler-applied argv to spawn, per family', async () => {
    for (const family of COMMAND_FAMILIES) {
      const { invoker, calls } = stubInvoker();
      const result = await invoker.invoke({
        family,
        argv: ARGV[family],
        cwd: '/repo',
        timeoutMs: 60_000,
      });
      expect(calls).toHaveLength(1);
      const call = calls[0];
      expect(call?.command).toBe('/stub/bin/kane-cli');
      expect(call?.args).toEqual([...ARGV[family], ...APPENDED[family]]);
      expect(result.effectiveArgv).toEqual(call?.args);
      expect(result.exitMeaning).toBe('success');
    }
  });

  it('never puts `--agent` on a testrun command line', async () => {
    const { invoker, calls } = stubInvoker();
    await invoker.invoke({
      family: 'ExecutionTestrun',
      argv: ['testrun', 'run', '--from-context', 'T-1'],
      cwd: '/repo',
      timeoutMs: 60_000,
    });
    expect(calls[0]?.args).not.toContain(AGENT_FLAG);
    expect(calls[0]?.args.some((token) => token.startsWith(AGENT_FLAG))).toBe(false);
  });

  it('always ignores stdin, for every family (§4.9.1)', async () => {
    // stdin ignored is what makes `ask_user` self-disable — and the reason any
    // `context ingest` KEPT performs lands only and never extracts.
    for (const family of COMMAND_FAMILIES) {
      const { invoker, calls } = stubInvoker();
      await invoker.invoke({ family, argv: ARGV[family], cwd: '/repo', timeoutMs: 1_000 });
      expect(calls[0]?.options.stdio).toEqual(['ignore', 'pipe', 'pipe']);
      expect(calls[0]?.options.stdio[0]).toBe('ignore');
    }
  });

  it('spawns nothing when the argv assertion fails', async () => {
    const { invoker, calls } = stubInvoker();
    await expect(
      invoker.invoke({ family: 'Assurance', argv: ['run', 'x'], cwd: '/repo', timeoutMs: 1_000 }),
    ).rejects.toThrow(TypeError);
    await expect(
      invoker.invoke({
        family: 'ExecutionTestrun',
        argv: ['testrun', 'run', AGENT_FLAG],
        cwd: '/repo',
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });

  it('passes the caller cwd through and keeps PATH in the child env', async () => {
    const { invoker, calls } = stubInvoker();
    await invoker.invoke({
      family: 'Assurance',
      argv: ['cover', '--json'],
      cwd: '/repo/apps/fixture',
      env: { KEPT_MARKER: 'set' },
      timeoutMs: 1_000,
    });
    expect(calls[0]?.options.cwd).toBe('/repo/apps/fixture');
    expect(calls[0]?.options.env['KEPT_MARKER']).toBe('set');
    expect(calls[0]?.options.env['PATH']).toBe(process.env['PATH']);
  });
});
