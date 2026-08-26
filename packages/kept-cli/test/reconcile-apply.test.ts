import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ChildProcessLike, ReviewCard, StateFileSystem } from '@kept/core';
import {
  HANDOFF_DIRECTORY_RELATIVE_PATH,
  HANDOFF_FILE_RELATIVE_PATH,
  KaneInvoker,
  REVIEW_CARDS_DIRECTORY_RELATIVE_PATH,
  STATE_FILE_RELATIVE_PATH,
  buildReviewCard,
  createDiagnosticSink,
  inMemorySourceCacheFileSystem,
  reviewCardPath,
  serialiseReviewCard,
} from '@kept/core';
import { describe, expect, it } from 'vitest';

import { EXIT_OK, EXIT_USAGE, parseArgv } from '../src/args.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { FIXTURE_CONFIG } from './fixture-config.js';
import { main } from '../src/main.js';
import {
  RECONCILE_DIAGNOSTIC_CODES,
  reconcileApplyArgv,
  reconcileUsageErrors,
  runReconcileApply,
} from '../src/commands/reconcile.js';
import { SNAPSHOT_COMMAND_DIAGNOSTIC_CODES } from '../src/commands/snapshot.js';

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
      config: FIXTURE_CONFIG,
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
      config: FIXTURE_CONFIG,
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
      config: FIXTURE_CONFIG,
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
      config: FIXTURE_CONFIG,
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
// The snapshot this command writes reads the injected store, not the disk
// ---------------------------------------------------------------------------

/**
 * An in-memory run must read **nothing** off the real filesystem, and until the
 * `readDirectory` seam was threaded through `runReconcileApply` it read plenty.
 *
 * The snapshot has three projections: the run log from `.kept/handoff/`, the
 * amendments from `.kept/amendments/`, and the held changes from
 * `.kept/review-cards/`. Each of them needs **two** seams: `fileSystem` for
 * the file reads and `readDirectory` for the directory listing. They are separate
 * because `StateFileSystem` reads and writes whole files by path and has no listing
 * operation at all, so a projection that starts by enumerating a directory cannot
 * get that answer from the injected filesystem. `runReconcile` and `amend` already
 * threaded both. `ReconcileApplyRequest` did not even declare the field.
 *
 * This is the call site where the omission was live, and `REPO` above is why: every
 * test in this file sets the repository root to the **real repository root**, because
 * the hook prompts and the argv assertions want the real tree. So an in-memory apply
 * listed the developer's own `.kept/handoff/`, tried to read each name it found out
 * of a map that had never held them, and reported one `snapshot-run-unreadable`
 * warning per real file: twenty-seven on the machine this was found on, none on a
 * fresh clone. Nothing failed, because every assertion in this file used `toContain`
 * on a code rather than asking what the whole diagnostic list was. The first
 * assertion that did would have been a test whose result depended on the machine it
 * ran on.
 *
 * So these two tests assert the composition rather than either half: the projections
 * come from the seeded map alone, and the diagnostic list is exactly as long as the
 * seeded map makes it.
 */
describe('an injected apply projects the seeded store and touches no real directory', () => {
  /** One held change, built through the only constructor so the fixture cannot drift. */
  function cardOf(): ReviewCard {
    const draft = buildReviewCard({
      kind: 'reconcile',
      title: 'the walked plan staged a change to the subtotal document',
      detail: 'reconcile staged the change into Kane’s own plan; nothing was applied',
      proposedChanges: [
        {
          file: 'tests/cart_subtotal_test.md',
          summary: 'ADD uc-10: cover the new claim',
          diff: '+ - The Shop screen lists eight roasts.',
        },
      ],
      context: {
        // `^p_[0-9a-f]{12}$`: the snapshot's own promise-id rule, so the card is
        // admitted by the same guard a real one goes through.
        promiseId: 'p_0f3a9c1147bd',
        createdAt: AT,
        strategy: 'resultCode740',
        // Null deliberately: a reference to a pack this snapshot does not carry is
        // cleared by `buildSnapshot`, which would make these assertions about
        // evidence curation rather than about which directory was listed.
        evidenceRef: null,
      },
    });
    if (!draft.ok) throw new Error('the fixture card could not be built');
    return draft.card;
  }

  /**
   * Run an apply over a seeded map, recording every directory the projections asked
   * about. The reader answers **only** out of the map, so a directory that exists on
   * the real disk and not in the map comes back empty: if the seam were not threaded
   * this reader would never be called at all and `listed` would be empty.
   */
  async function apply(seed: Record<string, string>): Promise<{
    readonly result: Awaited<ReturnType<typeof runReconcileApply>>;
    readonly listed: readonly string[];
    readonly files: Map<string, string>;
  }> {
    const fileSystem = inMemorySourceCacheFileSystem(seed);
    const listed: string[] = [];
    const result = await runReconcileApply({
      repoRoot: REPO,
      config: FIXTURE_CONFIG,
      invoker: stub().invoker,
      fileSystem,
      readDirectory: (path: string): readonly string[] => {
        listed.push(path);
        const prefix = path.endsWith('/') ? path : `${path}/`;
        return [...fileSystem.files.keys()]
          .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
          .map((key) => key.slice(prefix.length));
      },
      at: AT,
    });
    return { result, listed, files: fileSystem.files };
  }

  it('carries the seeded held change and the run it just wrote, and nothing else', async () => {
    const card = cardOf();
    const { result, listed, files } = await apply({
      [reviewCardPath(REPO, card.id)]: serialiseReviewCard(card),
    });

    // The seam was reached at all, which is the half that used to be missing.
    expect(listed).toContain(`${REPO}/${HANDOFF_DIRECTORY_RELATIVE_PATH}`);
    expect(listed).toContain(`${REPO}/${REVIEW_CARDS_DIRECTORY_RELATIVE_PATH}`);

    const snapshot = result.snapshot.snapshot;
    // The held change came out of the map, so the listing answered from the map.
    expect(snapshot.reviewCards.map((held) => held.id)).toEqual([card.id]);
    // The run log is exactly this run's own handoff: the one `.kept/handoff/` entry
    // the map holds. On the real directory it was however many the machine had.
    expect(snapshot.runs.map((run) => run.id)).toEqual([result.runId]);
    // Nothing seeded an amendment, and the real `.kept/amendments/` is not consulted.
    expect(snapshot.amendments).toEqual([]);
    // Every file this run wrote landed in the map rather than on disk.
    expect(files.has(`${REPO}/${HANDOFF_FILE_RELATIVE_PATH}`)).toBe(true);
  });

  it('reports the same diagnostics on a fresh clone as on a machine with a full .kept/', async () => {
    const { result } = await apply({});

    // The code that used to fire once per real handoff file. Not "fewer than
    // before": none, because no directory outside the seeded map was listed.
    const unreadable = result.diagnostics.filter(
      (entry) => entry.code === SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.runUnreadable,
    );
    expect(unreadable).toEqual([]);

    // And the whole list, by code, in order. This is the assertion the finding said
    // was impossible to write before: with the listing on real disk its length was a
    // fact about the developer's machine, so nobody could pin it. It is now a fact
    // about the seeded map, which this test owns.
    expect(result.diagnostics.map((entry) => entry.code)).toEqual([
      RECONCILE_DIAGNOSTIC_CODES.applyStarted,
      SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.recordsProjected,
      SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.written,
      RECONCILE_DIAGNOSTIC_CODES.completed,
    ]);
  });
});

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
