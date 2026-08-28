import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  KANE_BINARY_ENV_VAR,
  KANE_BINARY_NAME,
  KILL_GRACE_MS,
  KaneInvoker,
  STDERR_TAIL_LINES,
  clearKaneBinaryCache,
  createDiagnosticSink,
  findKaneBinary,
  resolvedKaneBinary,
  type ChildProcessLike,
  type CollectingDiagnosticSink,
  type SpawnOptionsLike,
} from 'kept-core';

/**
 * Task 2.20 — `KaneInvoker` behaviour (design §4.7, R2.12, R11.8).
 *
 * No test in this file creates a process. The spawn function and the binary
 * resolver are both injected, so line splitting, the timeout kill escalation and
 * a missing binary are all exercised deterministically, with `PATH` untouched
 * and no Kane credit spent.
 */

const BIN = '/stub/bin/kane-cli';

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

class FakeChild {
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  /** Every signal this process was sent, in order. */
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

  emitError(error: Error): void {
    for (const listener of this.listeners.get('error') ?? []) listener(error);
  }

  asChild(): ChildProcessLike {
    return this as unknown as ChildProcessLike;
  }
}

interface Harness {
  readonly invoker: KaneInvoker;
  readonly sink: CollectingDiagnosticSink;
  readonly children: FakeChild[];
  readonly options: SpawnOptionsLike[];
}

/**
 * An invoker wired to a stub child. `drive` runs while the process is "alive",
 * so a test can push chunks and signals before the run settles.
 */
function harness(
  drive: (child: FakeChild) => void = (child) => {
    queueMicrotask(() => {
      child.emitClose(0);
    });
  },
  binary: string | null = BIN,
): Harness {
  const sink = createDiagnosticSink();
  const children: FakeChild[] = [];
  const options: SpawnOptionsLike[] = [];
  const invoker = new KaneInvoker({
    sink,
    resolveBinary: () => binary,
    spawn: (_command, _args, spawnOptions) => {
      options.push(spawnOptions);
      const child = new FakeChild();
      children.push(child);
      drive(child);
      return child.asChild();
    },
  });
  return { invoker, sink, children, options };
}

const RUN = {
  family: 'ExecutionRun',
  argv: ['run', 'log in as the demo user'],
  cwd: '/repo',
  timeoutMs: 300_000,
} as const;

afterEach(() => {
  vi.useRealTimers();
});

describe('binary resolution', () => {
  it('returns kane-not-found as data when the binary is absent (R2.12)', async () => {
    const { invoker, sink, options } = harness(undefined, null);
    const result = await invoker.invoke(RUN);

    expect(result.exitMeaning).toBe('kane-not-found');
    expect(result.resolvedBinary).toBeNull();
    expect(result.exitCode).toBeNull();
    expect(result.stdoutLines).toEqual([]);
    expect(result.timedOut).toBe(false);
    // Nothing was spawned, and nothing was thrown.
    expect(options).toHaveLength(0);
    expect(sink.has('kane-not-found')).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['kane-not-found']);
    expect(result.diagnostics[0]?.message).toContain(KANE_BINARY_NAME);
  });

  it('resolves the binary once, however many times it invokes', async () => {
    let calls = 0;
    const invoker = new KaneInvoker({
      resolveBinary: () => {
        calls += 1;
        return BIN;
      },
      spawn: () => {
        const child = new FakeChild();
        queueMicrotask(() => {
          child.emitClose(0);
        });
        return child.asChild();
      },
    });
    await invoker.invoke(RUN);
    await invoker.invoke(RUN);
    expect(invoker.binaryPath()).toBe(BIN);
    expect(calls).toBe(1);
  });

  it('caches a null resolution too, so a missing binary is looked up once', async () => {
    let calls = 0;
    const invoker = new KaneInvoker({
      resolveBinary: () => {
        calls += 1;
        return null;
      },
    });
    await invoker.invoke(RUN);
    await invoker.invoke(RUN);
    expect(calls).toBe(1);
  });

  it('honours the pinned-path environment variable before walking PATH', () => {
    const found = findKaneBinary({
      env: { [KANE_BINARY_ENV_VAR]: '/opt/kane/kane-cli', PATH: '/usr/bin' },
      isExecutable: (candidate) => candidate === '/opt/kane/kane-cli',
    });
    expect(found).toBe('/opt/kane/kane-cli');
  });

  it('reports null when the pinned path is not executable', () => {
    expect(
      findKaneBinary({
        env: { [KANE_BINARY_ENV_VAR]: '/opt/kane/kane-cli', PATH: '/usr/bin' },
        isExecutable: () => false,
      }),
    ).toBeNull();
  });

  it('walks PATH in order and returns the first executable match', () => {
    const found = findKaneBinary({
      env: { PATH: ['/a', '', '/b', '/c'].join(process.platform === 'win32' ? ';' : ':') },
      isExecutable: (candidate) => candidate === '/b/kane-cli' || candidate === '/c/kane-cli',
    });
    expect(found).toBe('/b/kane-cli');
  });

  it('reports null for an empty PATH rather than throwing', () => {
    expect(findKaneBinary({ env: {}, isExecutable: () => true })).toBeNull();
  });

  it('memoises the process-wide lookup', () => {
    clearKaneBinaryCache();
    // Filesystem-only: resolution never invokes the binary, not even for --version.
    expect(resolvedKaneBinary()).toBe(resolvedKaneBinary());
  });
});

describe('incremental line splitting', () => {
  it('joins a chunk boundary that falls mid-line', async () => {
    const seen: string[] = [];
    const { invoker } = harness((child) => {
      queueMicrotask(() => {
        child.stdout.emit('{"type":"recording_state"}\n{"ty');
        child.stdout.emit('pe":"bifurcation"}\n');
        child.emitClose(0);
      });
    });

    const result = await invoker.invoke({ ...RUN, onLine: (line) => seen.push(line) });

    expect(result.stdoutLines).toEqual([
      '{"type":"recording_state"}',
      '{"type":"bifurcation"}',
    ]);
    expect(seen).toEqual(result.stdoutLines);
  });

  it('delivers a final line that has no trailing newline', async () => {
    const { invoker } = harness((child) => {
      queueMicrotask(() => {
        child.stdout.emit('{"a":1}\n');
        child.stdout.emit('{"type":"run_end"}');
        child.emitClose(0);
      });
    });

    const result = await invoker.invoke(RUN);

    // Kane's terminal event is frequently the unterminated last line. Losing it
    // would turn every complete stream into a crashed one.
    expect(result.stdoutLines).toEqual(['{"a":1}', '{"type":"run_end"}']);
  });

  it('splits one chunk carrying many lines, and keeps empty lines', async () => {
    const { invoker } = harness((child) => {
      queueMicrotask(() => {
        child.stdout.emit('a\n\nb\n');
        child.emitClose(0);
      });
    });
    const result = await invoker.invoke(RUN);
    expect(result.stdoutLines).toEqual(['a', '', 'b']);
  });

  it('splits a stream delivered one character at a time', async () => {
    const payload = '{"one":1}\n{"two":2}\n{"three":3}';
    const { invoker } = harness((child) => {
      queueMicrotask(() => {
        for (const character of payload) child.stdout.emit(character);
        child.emitClose(0);
      });
    });
    const result = await invoker.invoke(RUN);
    expect(result.stdoutLines).toEqual(['{"one":1}', '{"two":2}', '{"three":3}']);
  });

  it('strips a carriage return so CRLF output still parses', async () => {
    const { invoker } = harness((child) => {
      queueMicrotask(() => {
        child.stdout.emit('{"a":1}\r\n{"b":2}\r');
        child.emitClose(0);
      });
    });
    const result = await invoker.invoke(RUN);
    expect(result.stdoutLines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('produces no lines for an empty stream', async () => {
    const { invoker } = harness();
    const result = await invoker.invoke(RUN);
    expect(result.stdoutLines).toEqual([]);
  });

  it('survives an onLine callback that throws, and diagnoses it once', async () => {
    const { invoker, sink } = harness((child) => {
      queueMicrotask(() => {
        child.stdout.emit('one\ntwo\n');
        child.emitClose(0);
      });
    });

    const result = await invoker.invoke({
      ...RUN,
      onLine: () => {
        throw new Error('pane exploded');
      },
    });

    expect(result.stdoutLines).toEqual(['one', 'two']);
    expect(result.exitMeaning).toBe('success');
    expect(sink.withCode('invoker-on-line')).toHaveLength(1);
  });

  it('sets utf8 on both pipes', async () => {
    const { invoker, children } = harness();
    await invoker.invoke(RUN);
    expect(children[0]?.stdout.encoding).toBe('utf8');
    expect(children[0]?.stderr.encoding).toBe('utf8');
  });
});

describe('stderr retention', () => {
  it(`keeps the last ${STDERR_TAIL_LINES} lines and forgets the rest`, async () => {
    const total = STDERR_TAIL_LINES + 12;
    const { invoker } = harness((child) => {
      queueMicrotask(() => {
        for (let i = 1; i <= total; i += 1) child.stderr.emit(`line ${i}\n`);
        child.emitClose(0);
      });
    });

    const result = await invoker.invoke(RUN);

    expect(result.stderrTail).toHaveLength(STDERR_TAIL_LINES);
    expect(result.stderrTail[0]).toBe(`line ${total - STDERR_TAIL_LINES + 1}`);
    expect(result.stderrTail.at(-1)).toBe(`line ${total}`);
  });

  it('retains the evidence hint, which appears on stderr and in no event', async () => {
    const hint = 'evidence: view locally with kane-cli evidence serve /tmp/pack';
    const { invoker } = harness((child) => {
      queueMicrotask(() => {
        child.stderr.emit(`${hint}\n[member] step 1 ok`);
        child.emitClose(0);
      });
    });

    const result = await invoker.invoke(RUN);

    expect(result.stderrTail).toContain(hint);
    // The unterminated last stderr line is flushed too.
    expect(result.stderrTail).toContain('[member] step 1 ok');
  });
});

describe('timeout: SIGTERM, then SIGKILL after the grace period (R11.8)', () => {
  it('escalates and reports killed-by-timeout', async () => {
    vi.useFakeTimers();
    const { invoker, sink, children } = harness(() => {
      // Deliberately unresponsive: no close until we say so.
    });

    const pending = invoker.invoke({ ...RUN, timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(999);
    const child = children[0];
    expect(child?.signals).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(child?.signals).toEqual(['SIGTERM']);

    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS - 1);
    expect(child?.signals).toEqual(['SIGTERM']);

    await vi.advanceTimersByTimeAsync(1);
    expect(child?.signals).toEqual(['SIGTERM', 'SIGKILL']);

    child?.emitClose(null);
    const result = await pending;

    expect(result.timedOut).toBe(true);
    expect(result.exitMeaning).toBe('killed-by-timeout');
    expect(sink.has('kane-timeout')).toBe(true);
    expect(result.diagnostics.some((d) => d.code === 'kane-timeout')).toBe(true);
  });

  it('lets our own timeout outrank whatever code the dying process reports', async () => {
    vi.useFakeTimers();
    const { invoker, children } = harness(() => {});
    const pending = invoker.invoke({ ...RUN, timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    // A wrapper can report 0 or 143 while being torn down. Neither is a success.
    children[0]?.emitClose(0);
    const result = await pending;
    expect(result.exitMeaning).toBe('killed-by-timeout');
    expect(result.exitCode).toBe(0);
  });

  it('respects an injected grace period', async () => {
    vi.useFakeTimers();
    const children: FakeChild[] = [];
    const invoker = new KaneInvoker({
      resolveBinary: () => BIN,
      killGraceMs: 10,
      spawn: () => {
        const child = new FakeChild();
        children.push(child);
        return child.asChild();
      },
    });
    const pending = invoker.invoke({ ...RUN, timeoutMs: 5 });
    await vi.advanceTimersByTimeAsync(5);
    expect(children[0]?.signals).toEqual(['SIGTERM']);
    await vi.advanceTimersByTimeAsync(10);
    expect(children[0]?.signals).toEqual(['SIGTERM', 'SIGKILL']);
    children[0]?.emitClose(null);
    await pending;
  });

  it('signals nothing when the process closes inside its budget', async () => {
    vi.useFakeTimers();
    const { invoker, children } = harness((child) => {
      queueMicrotask(() => {
        child.emitClose(0);
      });
    });
    const result = await invoker.invoke({ ...RUN, timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(children[0]?.signals).toEqual([]);
    expect(result.timedOut).toBe(false);
    expect(result.exitMeaning).toBe('success');
  });

  it('arms no timer for a non-positive or non-finite budget', async () => {
    vi.useFakeTimers();
    const { invoker, children } = harness((child) => {
      queueMicrotask(() => {
        child.emitClose(0);
      });
    });
    const result = await invoker.invoke({ ...RUN, timeoutMs: 0 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(children[0]?.signals).toEqual([]);
    expect(result.timedOut).toBe(false);
  });

  it('flushes an unterminated final line even when it is killed', async () => {
    vi.useFakeTimers();
    const { invoker, children } = harness((child) => {
      queueMicrotask(() => {
        child.stdout.emit('{"partial":true}');
      });
    });
    const pending = invoker.invoke({ ...RUN, timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100 + KILL_GRACE_MS);
    children[0]?.emitClose(null);
    const result = await pending;
    expect(result.stdoutLines).toEqual(['{"partial":true}']);
    expect(result.exitMeaning).toBe('killed-by-timeout');
  });
});

describe('every Kane behaviour is data, never a throw', () => {
  it('interprets the exit code against the declared family', async () => {
    // Assurance 3 is a resumable pause, not a timeout and never a failure.
    const paused = await harness((child) => {
      queueMicrotask(() => {
        child.emitClose(3);
      });
    }).invoker.invoke({
      family: 'Assurance',
      argv: ['cover', '--json'],
      cwd: '/repo',
      timeoutMs: 60_000,
    });
    expect(paused.exitMeaning).toBe('paused-resumable');
    expect(paused.exitCode).toBe(3);

    // Testrun 2 is a preflight rejection: nothing ran.
    const rejected = await harness((child) => {
      queueMicrotask(() => {
        child.emitClose(2);
      });
    }).invoker.invoke({
      family: 'ExecutionTestrun',
      argv: ['testrun', 'run'],
      cwd: '/repo',
      timeoutMs: 60_000,
    });
    expect(rejected.exitMeaning).toBe('preflight-rejected');

    // The same 3 under an execution family is a timeout or a cancellation.
    const cancelled = await harness((child) => {
      queueMicrotask(() => {
        child.emitClose(3);
      });
    }).invoker.invoke(RUN);
    expect(cancelled.exitMeaning).toBe('timeout-or-cancelled');
  });

  it('returns a crash, a refusal and an auth failure as ordinary results', async () => {
    for (const code of [1, 2, 70, 130, 255]) {
      const { invoker } = harness((child) => {
        queueMicrotask(() => {
          child.emitClose(code);
        });
      });
      const result = await invoker.invoke(RUN);
      expect(result.exitCode).toBe(code);
      expect(typeof result.exitMeaning).toBe('string');
    }
  });

  it('reads a spawn ENOENT as kane-not-found rather than throwing', async () => {
    const { invoker, sink } = harness((child) => {
      queueMicrotask(() => {
        child.emitError(Object.assign(new Error('spawn kane-cli ENOENT'), { code: 'ENOENT' }));
      });
    });

    const result = await invoker.invoke(RUN);

    expect(result.exitMeaning).toBe('kane-not-found');
    expect(result.exitCode).toBeNull();
    expect(sink.has('kane-not-found')).toBe(true);
  });

  it('reads any other spawn error as a non-writing interruption', async () => {
    const { invoker, sink } = harness((child) => {
      queueMicrotask(() => {
        child.emitError(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
      });
    });

    const result = await invoker.invoke(RUN);

    // Not `failure`, which would permit a verdict write on a run that produced
    // nothing. `force-interrupted` sits outside the writable set (design §4.8).
    expect(result.exitMeaning).toBe('force-interrupted');
    expect(sink.has('kane-spawn-failed')).toBe(true);
  });

  it('returns data when spawn itself throws synchronously', async () => {
    const sink = createDiagnosticSink();
    const invoker = new KaneInvoker({
      sink,
      resolveBinary: () => BIN,
      spawn: () => {
        throw Object.assign(new Error('ENOENT: bad cwd'), { code: 'ENOENT' });
      },
    });

    const result = await invoker.invoke(RUN);

    expect(result.exitMeaning).toBe('kane-not-found');
    expect(result.resolvedBinary).toBe(BIN);
    expect(sink.has('kane-spawn-failed')).toBe(true);
  });

  it('reads a signalled death as force-interrupted', async () => {
    const { invoker } = harness((child) => {
      queueMicrotask(() => {
        child.emitClose(null);
      });
    });
    const result = await invoker.invoke(RUN);
    expect(result.exitMeaning).toBe('force-interrupted');
    expect(result.timedOut).toBe(false);
  });

  it('reports a non-negative duration and echoes the spec back', async () => {
    const { invoker } = harness();
    const result = await invoker.invoke(RUN);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.spec.family).toBe('ExecutionRun');
    expect(result.spec.argv).toEqual(RUN.argv);
    expect(result.resolvedBinary).toBe(BIN);
  });

  it('measures duration from the injected clock', async () => {
    let ticks = 1_000;
    const invoker = new KaneInvoker({
      resolveBinary: () => BIN,
      now: () => {
        const value = ticks;
        ticks += 250;
        return value;
      },
      spawn: () => {
        const child = new FakeChild();
        queueMicrotask(() => {
          child.emitClose(0);
        });
        return child.asChild();
      },
    });
    const result = await invoker.invoke(RUN);
    expect(result.durationMs).toBe(250);
  });
});
