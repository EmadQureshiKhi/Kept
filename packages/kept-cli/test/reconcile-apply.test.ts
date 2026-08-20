import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ChildProcessLike, StateFileSystem } from '@kept/core';
import {
  HANDOFF_FILE_RELATIVE_PATH,
  KaneInvoker,
  STATE_FILE_RELATIVE_PATH,
  createDiagnosticSink,
  inMemorySourceCacheFileSystem,
} from '@kept/core';
import { describe, expect, it } from 'vitest';

import { EXIT_OK, EXIT_USAGE, parseArgv } from '../src/args.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { main } from '../src/main.js';
import {
  RECONCILE_DIAGNOSTIC_CODES,
  reconcileApplyArgv,
  reconcileUsageErrors,
  runReconcileApply,
} from '../src/commands/reconcile.js';

/**
 * Task 12.7 — `kept reconcile apply [planPath]`, and the mutually-exclusive-flag
 * rejection (design §13.2.3, §14.1's last row, R5.7, R2.10).
 *
 * Two properties carry this command, and they pull in opposite directions.
 *
 * **It is human-only.** `--plan` stages and `--apply` walks what was staged, so
 * an apply mutates the suite — which is a decision no hook may take. So the
 * command is absent from both hook prompts, the docs prompt forbids it by name,
 * and the handoff it writes carries `trigger.hook: null`, the field §11.2 uses to
 * say a human ran the CLI.
 *
 * **And it is the one place `kept` exits non-zero.** `--plan` together with
 * `--apply` is a usage error rejected before any spawn, with a usage message and
 * exit 2. Everything else in the product exits 0, including this command when
 * Kane refuses, pauses, crashes or is missing entirely (§14.2).
 *
 * The rejection has two spellings and both are checked here: the flag pair, which
 * the parser's own `MUTUALLY_EXCLUSIVE_FLAGS` table catches before dispatch, and
 * `kept reconcile apply --plan`, where `--apply` arrived as a *subcommand word*
 * and is invisible to a table that reads `flags`.
 */
const REPO = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/+$/, '');
const AT = '2026-08-20T18:41:02.118Z';
const STATE_PATH = `${REPO}/${STATE_FILE_RELATIVE_PATH}`;
const HANDOFF_PATH = `${REPO}/${HANDOFF_FILE_RELATIVE_PATH}`;
const HOOKS = new URL('../../../.kiro/hooks/', import.meta.url);

/** A plan walk that completed, in the Assurance envelope's shape. */
const APPLY_DONE = [
  '{"step":"maintain.reconcile","status":"running","remark":"walking the stored plan"}',
  '{"type":"done","v":1,"verb":"reconcile","status":"complete","exit_code":0,' +
    '"message":"1 change applied from the stored plan"}',
];

class FakeStream {
  private listener: ((chunk: string) => void) | undefined;
  setEncoding(): unknown {
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
  private readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  on(event: string, listener: (...args: unknown[]) => void): unknown {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }
  kill(): boolean {
    return true;
  }
  close(code: number | null): void {
    for (const listener of this.listeners.get('close') ?? []) listener(code, null);
  }
  asChild(): ChildProcessLike {
    return this as unknown as ChildProcessLike;
  }
}

interface Stub {
  readonly invoker: KaneInvoker;
  readonly spawns: string[][];
}

function stub(lines: readonly string[] = APPLY_DONE, exitCode: number | null = 0): Stub {
  const spawns: string[][] = [];
  const invoker = new KaneInvoker({
    sink: createDiagnosticSink(),
    resolveBinary: () => '/stub/bin/kane-cli',
    spawn: (_command, args) => {
      spawns.push([...args]);
      const child = new FakeChild();
      queueMicrotask(() => {
        for (const line of lines) child.stdout.emit(`${line}\n`);
        child.close(exitCode);
      });
      return child.asChild();
    },
  });
  return { invoker, spawns };
}

function files(): StateFileSystem & { readonly files: Map<string, string> } {
  return inMemorySourceCacheFileSystem({});
}

// ---------------------------------------------------------------------------
// The argv (§13.2.3, §13.1)
// ---------------------------------------------------------------------------

describe('the argv kept reconcile apply issues (§13.2.3, §13.1)', () => {
  it('is maintain reconcile --apply, bare, with --mode agent appended', async () => {
    const kane = stub();
    const result = await runReconcileApply({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      invoker: kane.invoker,
      fileSystem: files(),
      at: AT,
    });

    expect(result.argv).toEqual(['maintain', 'reconcile', '--apply', '--mode', 'agent']);
    expect(kane.spawns).toEqual([['maintain', 'reconcile', '--apply', '--mode', 'agent']]);
    // The flag that would mean the opposite intention is structurally absent.
    for (const argv of kane.spawns) expect(argv).not.toContain('--plan');
    expect(result.status).toBe('complete');
  });

  it('carries a plan path when one was named', async () => {
    const kane = stub();
    const result = await runReconcileApply({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      planPath: '.kept/plans/rp_7c1e04a9.json',
      invoker: kane.invoker,
      fileSystem: files(),
      at: AT,
    });

    expect(result.argv).toEqual([
      'maintain',
      'reconcile',
      '--apply',
      '.kept/plans/rp_7c1e04a9.json',
      '--mode',
      'agent',
    ]);
    expect(result.planPath).toBe('.kept/plans/rp_7c1e04a9.json');
  });

  it('composes --apply and never --plan, at either arity', () => {
    expect(reconcileApplyArgv(null)).toEqual(['maintain', 'reconcile', '--apply']);
    expect(reconcileApplyArgv('p.json')).toEqual([
      'maintain',
      'reconcile',
      '--apply',
      'p.json',
    ]);
    expect(reconcileApplyArgv(null)).not.toContain('--plan');
    expect(reconcileApplyArgv('p.json')).not.toContain('--plan');
  });
});

// ---------------------------------------------------------------------------
// Human-only (§13.2.3, §11.1, §11.2)
// ---------------------------------------------------------------------------

describe('the command is human-only', () => {
  it('writes a handoff whose trigger names no hook', async () => {
    const kane = stub();
    const fileSystem = files();
    const result = await runReconcileApply({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      invoker: kane.invoker,
      fileSystem,
      at: AT,
    });

    // `hook: null` is §11.2's way of saying a human ran the CLI.
    expect(result.handoff.handoff.trigger.hook).toBeNull();
    expect(result.handoff.handoff.command.invoked).toBe(true);
    expect(result.handoff.handoff.nextAction.branch).toBeNull();
    expect(fileSystem.files.has(HANDOFF_PATH)).toBe(true);
  });

  it('is absent from both hook prompts, and the docs prompt forbids it by name', () => {
    const prompts = ['kept-code-verify.json', 'kept-docs-reconcile.json'].map((name) => {
      const raw = JSON.parse(readFileSync(new URL(name, HOOKS), 'utf8')) as {
        readonly then?: { readonly prompt?: unknown };
      };
      const prompt = then_(raw);
      expect(typeof prompt).toBe('string');
      return prompt;
    });

    for (const prompt of prompts) {
      // Neither prompt hands `--apply` to anything.
      expect(prompt).not.toContain('--apply');
    }
    // And the docs prompt names the command only to forbid it.
    expect(prompts[1]).toContain('Never run `kept reconcile apply`');
    expect(prompts[0]).not.toContain('reconcile apply');
  });

  it('reports honestly when there is no Kane boundary at all (R2.12)', async () => {
    const result = await runReconcileApply({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      fileSystem: files(),
      at: AT,
    });

    expect(result.invoked).toBe(false);
    expect(result.argv).toEqual([]);
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      RECONCILE_DIAGNOSTIC_CODES.kaneUnavailable,
    );
  });
});

/** The prompt of a hook file, read without trusting its shape. */
function then_(raw: { readonly then?: { readonly prompt?: unknown } }): string {
  const prompt = raw.then?.prompt;
  return typeof prompt === 'string' ? prompt : '';
}

// ---------------------------------------------------------------------------
// The one non-zero exit in the product (§13.2.3, §14.1's last row)
// ---------------------------------------------------------------------------

interface Cli {
  readonly exitCode: number;
  readonly err: string;
  readonly spawns: readonly string[][];
  readonly files: Map<string, string>;
}

async function cli(argv: readonly string[]): Promise<Cli> {
  const kane = stub();
  const fileSystem = files();
  const err: string[] = [];
  const exitCode = await main(argv, {
    write: () => undefined,
    writeError: (text) => {
      err.push(text);
    },
    cwd: REPO,
    env: {},
    fileSystem,
    now: () => new Date(AT),
    invoker: kane.invoker,
  });
  return { exitCode, err: err.join(''), spawns: kane.spawns, files: fileSystem.files };
}

describe('--plan with --apply is rejected before any spawn (§13.2.3)', () => {
  it('exits 2 for the flag pair, with a usage message and no process', async () => {
    const run = await cli(['reconcile', '--plan', '--apply']);

    expect(run.exitCode).toBe(EXIT_USAGE);
    expect(run.err).toContain('mutually exclusive');
    expect(run.err).toContain('Usage: kept <command> [options]');
    // Nothing ran and nothing was written: not a state file, not a handoff.
    expect(run.spawns).toEqual([]);
    expect(run.files.has(STATE_PATH)).toBe(false);
    expect(run.files.has(HANDOFF_PATH)).toBe(false);
  });

  it('exits 2 for the subcommand spelling the flag table cannot see', async () => {
    // `apply` arrived as a subcommand word, so `flags` carries only `plan` — and
    // Kane's argv would still have carried both.
    const parsed = parseArgv(['reconcile', 'apply', '--plan']);
    expect(parsed.usageErrors).toEqual([]);
    expect(reconcileUsageErrors(parsed)).toHaveLength(1);

    const run = await cli(['reconcile', 'apply', '--plan']);
    expect(run.exitCode).toBe(EXIT_USAGE);
    expect(run.err).toContain('mutually exclusive');
    expect(run.spawns).toEqual([]);
  });

  it('reports one message per offending pair, never two for one pair', () => {
    const parsed = parseArgv(['reconcile', 'apply', '--plan', '--apply']);
    // Both spellings at once. The pair is still one usage error.
    expect(reconcileUsageErrors(parsed)).toHaveLength(1);
  });

  it('accepts either intention alone, and exits 0', async () => {
    expect(reconcileUsageErrors(parseArgv(['reconcile', '--changed', 'a.md', '--plan']))).toEqual(
      [],
    );
    expect(reconcileUsageErrors(parseArgv(['reconcile', 'apply']))).toEqual([]);

    const applied = await cli(['reconcile', 'apply']);
    expect(applied.exitCode).toBe(EXIT_OK);
    expect(applied.spawns).toEqual([['maintain', 'reconcile', '--apply', '--mode', 'agent']]);
  });

  it('exits 0 when the walk is refused, paused or crashed — Kane’s outcome is data', async () => {
    for (const [lines, code] of [
      [['{"type":"done","v":1,"verb":"reconcile","status":"refused","exit_code":2}'], 2],
      [['{"type":"done","v":1,"verb":"reconcile","status":"paused","exit_code":3}'], 3],
      [['{"step":"maintain.reconcile","status":"running"}'], 0],
    ] as const) {
      const kane = stub(lines, code);
      const exitCode = await main(['reconcile', 'apply'], {
        write: () => undefined,
        writeError: () => undefined,
        cwd: REPO,
        env: {},
        fileSystem: files(),
        now: () => new Date(AT),
        invoker: kane.invoker,
      });
      expect(exitCode).toBe(EXIT_OK);
    }
  });
});
