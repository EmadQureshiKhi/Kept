/**
 * Task 14.2 — `kept evolve` and its `--mode agent` flag probe (design §8.1, §8.2,
 * §4.9, §13.1, §14.1, R5.7, R7.2, R7.7, R2.10, R2.12).
 *
 * ## The observation this suite is built on
 *
 * `maintain evolve --help` was run against the installed 0.8.4 while task 14.2 was
 * written, and {@link OBSERVED_HELP} is its output **verbatim**. It lists three
 * options and `--mode` is not among them, while `maintain reconcile --help` from the
 * same binary does list `--mode <mode>` — and a real
 * `maintain evolve --mode agent <ref>` answers `error: unknown option '--mode'` with
 * nothing run. So the degradation path of §14.1 is not a hypothetical this command
 * carries for tidiness; it is what `kept evolve` does on this machine today, and it
 * is driven here by the bytes Kane printed rather than by a paraphrase of them.
 *
 * `SUPPORTED_HELP` is the same table with `--mode <mode>` added, in `reconcile`'s own
 * wording. That is the only synthetic input in the file, it is clearly labelled as
 * the future, and it is what makes the §13.1 argv reachable so it can be asserted.
 *
 * ## Zero real Kane processes
 *
 * Two seams, both injected. The invoker gets a recording `spawn`, so every argv is
 * asserted at the process boundary; the `--help` probe is its own seam — because the
 * invoker would append the very `--mode agent` being probed for (§4.7) — and is a
 * function returning parsed help text. `clearEvolveHelpProbeCache()` runs before each
 * test, since the probe is memoised per process by design and a memo shared across
 * tests would silently make the second one assert the first one's world.
 *
 * The filesystem is `inMemoryRepairFileSystem`, so the state read, the review-card
 * writes, the handoff writes and the card listing all share one map — which is what
 * lets "the only writes are under `.kept/`" be asserted over the map's own keys
 * rather than over a temporary directory nobody inspects.
 */

import type { ChildProcessLike, KeptState, PromiseRecord } from '@kept/core';
import {
  KaneInvoker,
  REVIEW_CARDS_DIRECTORY_RELATIVE_PATH,
  STATE_FILE_RELATIVE_PATH,
  createDiagnosticSink,
  createKeptState,
  createPromiseGraph,
  createPromiseRecord,
  inMemoryRepairFileSystem,
  listReviewCards,
  serialiseState,
} from '@kept/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { EXIT_OK } from '../src/args.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { main } from '../src/main.js';
import type { EvolveHelpProbe } from '../src/commands/evolve.js';
import {
  EVOLVE_ARGV_HEAD,
  EVOLVE_DIAGNOSTIC_CODES,
  EVOLVE_HELP_ARGV,
  clearEvolveHelpProbeCache,
  evolveArgv,
  parseEvolveHelp,
  promiseForRef,
  runEvolve,
  stagedChanges,
  unprobed,
} from '../src/commands/evolve.js';

const REPO = '/repo';
const AT = '2026-08-20T18:41:02.118Z';
const README = 'apps/fixture/README.md';
const REF = 'tests/cart_subtotal_test.md';

/**
 * `kane-cli maintain evolve --help`, installed 0.8.4, copied verbatim.
 *
 * Three options, and `--mode` is not one of them.
 */
const OBSERVED_HELP = [
  'Usage: kane-cli maintain evolve [options] [ref]',
  '',
  'Re-design the parent use-case of a test/scenario/AC/use-case — unaffected items',
  'are preserved verbatim; reports the pair diff',
  '',
  'Options:',
  '  --from-stale        Evolve every use-case with stale designed entities',
  '                      (deduped, per-UC confirm)',
  '  --because <reason>  Re-design a FRESH target anyway — the reason becomes the',
  '                      change delta and lands in provenance',
  '  -h, --help          display help for command',
].join('\n');

/** The same table on the day the verb accepts the flag. The one synthetic input. */
const SUPPORTED_HELP = OBSERVED_HELP.replace(
  '  -h, --help',
  [
    '  --mode <mode>       interactive | agent | ci | override — TTY defaults to the',
    '                      in-chat card review; headless requires one',
    '  -h, --help',
  ].join('\n'),
);

const observedProbe: EvolveHelpProbe = async () => parseEvolveHelp(OBSERVED_HELP, 0);
const supportedProbe: EvolveHelpProbe = async () => parseEvolveHelp(SUPPORTED_HELP, 0);

/* ─────────────────────────── the recording process seam ───────────────────── */

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

interface Recorder {
  readonly invoker: KaneInvoker;
  /** Every argv the process seam was handed, enabler included. */
  readonly spawns: string[][];
}

/** An invoker whose spawn is recorded and whose stdout is the given NDJSON. */
function recorder(lines: readonly string[], exitCode = 0): Recorder {
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

/** An evolution that completed and staged one held change to the test corpus. */
const EVOLVE_STAGED = [
  '{"type":"review_card","v":1,"verb":"evolve","title":"step 3 selector no longer resolves",' +
    '"detail":"the cart total moved behind a new wrapper",' +
    '"proposed_changes":[{"file":"tests/cart_subtotal_test.md",' +
    '"summary":"retarget step 3","diff":"-  click .total\\n+  click .cart-total"}]}',
  '{"type":"done","v":1,"verb":"evolve","status":"complete","exit_code":0,' +
    '"message":"re-designed the parent use-case; unaffected items preserved verbatim"}',
];

/** The same stream, paused and resumable — R5.4's exit 3. */
const EVOLVE_PAUSED = [
  EVOLVE_STAGED[0] as string,
  '{"type":"done","v":1,"verb":"evolve","status":"paused","exit_code":3,' +
    '"message":"waiting on a human decision","resume":"kane-cli maintain evolve --resume"}',
];

/** A refusal: a `complete` stream with a non-accepting status (§5.3.1). */
const EVOLVE_REFUSED = [
  '{"type":"error","v":1,"verb":"evolve","message":"run `kane-cli context ingest <files>` first"}',
  '{"type":"done","v":1,"verb":"evolve","status":"refused","exit_code":2}',
];

/** A crashed stream: the terminal `done` never arrives (R5.3). */
const EVOLVE_CRASHED = [EVOLVE_STAGED[0] as string];

/* ───────────────────────── the repository under test ──────────────────────── */

function record(claim: string, line: number, test: string | null, testId: string | null): PromiseRecord {
  return createPromiseRecord({
    claim,
    citation: { file: README, line, text: claim },
    designedTest: test === null ? null : { path: test, testId },
    verdict: test === null ? 'undesigned' : 'red',
    repair:
      test === null
        ? null
        : {
            branch: 'test-drift',
            strategy: 'resultCode740',
            severity: 'major',
            category: 'selector',
            confidence: 0.8,
            evidenceRef: 'evidence/ev_2026-08-20T18-40-11Z/failure.yaml',
            rationale: 'the assertion failed with the selector unresolved',
          },
    providers: ['baseline'],
  });
}

const PRIOR: KeptState = createKeptState({
  updatedAt: '2026-08-01T00:00:00.000Z',
  graph: createPromiseGraph({
    promises: [
      record('The cart subtotal updates immediately.', 3, REF, 'T-3'),
      record('Orders persist across a reload.', 4, 'tests/orders_persist_test.md', 'T-5'),
      record('Settings are saved without a page reload.', 5, null, null),
    ],
  }),
});

function files(): ReturnType<typeof inMemoryRepairFileSystem> {
  return inMemoryRepairFileSystem({
    [`${REPO}/${STATE_FILE_RELATIVE_PATH}`]: serialiseState(PRIOR),
  });
}

/** The promise `REF` cites, resolved the way the command resolves it. */
const DRIFTED = promiseForRef(PRIOR, REF, REPO);

beforeEach(() => {
  clearEvolveHelpProbeCache();
});

/* ─────────────────────────── the probe, on its own ────────────────────────── */

describe('the --help probe reads Kane option tables', () => {
  it('finds no --mode in the table the installed 0.8.4 actually prints', () => {
    const observation = parseEvolveHelp(OBSERVED_HELP, 0);
    expect(observation.ran).toBe(true);
    expect(observation.supportsModeAgent).toBe(false);
    expect(observation.flags).toEqual(['--from-stale', '--because', '--help']);
    expect(observation.failure).toBeNull();
  });

  it('finds --mode when the table carries it', () => {
    const observation = parseEvolveHelp(SUPPORTED_HELP, 0);
    expect(observation.supportsModeAgent).toBe(true);
    expect(observation.flags).toContain('--mode');
  });

  it('treats empty output as no observation rather than as an empty table', () => {
    // The distinction is the whole point: "the table lists no flags" is evidence
    // about the flag, and "there was no table" is evidence about the probe.
    const observation = parseEvolveHelp('   \n  ', 1);
    expect(observation.ran).toBe(false);
    expect(observation.supportsModeAgent).toBe(false);
    expect(observation.failure).not.toBeNull();
  });

  it('probes the verb with no --mode of its own, so the question is not begged', () => {
    expect([...EVOLVE_HELP_ARGV]).toEqual(['maintain', 'evolve', '--help']);
    expect(EVOLVE_HELP_ARGV).not.toContain('--mode');
    expect([...EVOLVE_ARGV_HEAD]).toEqual(['maintain', 'evolve']);
  });

  it('composes the §13.1 argv without the enabler, which the invoker appends', () => {
    expect([...evolveArgv(REF)]).toEqual(['maintain', 'evolve', REF]);
    expect(evolveArgv(REF)).not.toContain('--mode');
    expect(evolveArgv(REF)).not.toContain('--agent');
  });

  it('runs once per process, however many refs are evolved', async () => {
    let probes = 0;
    const counting: EvolveHelpProbe = async () => {
      probes += 1;
      return parseEvolveHelp(OBSERVED_HELP, 0);
    };
    const fileSystem = files();
    for (const ref of [REF, 'tests/orders_persist_test.md', REF]) {
      await runEvolve({
        repoRoot: REPO,
        config: DEFAULT_CONFIG,
        ref,
        fileSystem,
        helpProbe: counting,
        at: AT,
      });
    }
    expect(probes).toBe(1);
  });
});

/* ───────────── the degradation §14.1 specifies, on the installed build ─────── */

describe('kept evolve degrades when maintain evolve carries no --mode', () => {
  it('skips the invocation entirely — no process, no credits', async () => {
    const kane = recorder(EVOLVE_STAGED);
    const result = await runEvolve({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      ref: REF,
      fileSystem: files(),
      invoker: kane.invoker,
      helpProbe: observedProbe,
      at: AT,
    });

    expect(kane.spawns).toEqual([]);
    expect(result.invoked).toBe(false);
    expect(result.argv).toEqual([]);
    expect(result.flagSupported).toBe(false);
    expect(result.degradedByFlagProbe).toBe(true);
  });

  it('records the flag-mismatch diagnostic, naming the table it read', async () => {
    const result = await runEvolve({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      ref: REF,
      fileSystem: files(),
      helpProbe: observedProbe,
      at: AT,
    });

    const mismatch = result.diagnostics.find(
      (entry) => entry.code === EVOLVE_DIAGNOSTIC_CODES.flagMismatch,
    );
    expect(mismatch).toBeDefined();
    expect(mismatch?.severity).toBe('warn');
    // The message quotes what was observed rather than asserting a conclusion.
    expect(mismatch?.message).toContain('--from-stale');
    expect(mismatch?.message).toContain('--mode');
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      EVOLVE_DIAGNOSTIC_CODES.probed,
    );
  });

  it('builds a test-drift card from the failure context alone, held and open', async () => {
    const fileSystem = files();
    const result = await runEvolve({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      ref: REF,
      fileSystem,
      helpProbe: observedProbe,
      at: AT,
    });

    expect(result.reviewCards).toHaveLength(1);
    const card = result.reviewCards[0];
    expect(card?.kind).toBe('test-drift');
    expect(card?.branch).toBe('test-drift');
    expect(card?.status).toBe('open');
    expect(card?.promiseId).toBe(DRIFTED?.id);
    expect(card?.strategy).toBe(DEFAULT_CONFIG.verdictRouter);
    // The evidence reference travels from the promise's repair annotation (R7.7).
    expect(card?.evidenceRef).toBe(DRIFTED?.repair?.evidenceRef);
    // No change was rendered, so none is claimed.
    expect(card?.proposedChanges).toEqual([]);
    expect(card?.detail).toContain('--mode');
    expect(
      result.diagnostics.map((entry) => entry.code),
    ).toContain(EVOLVE_DIAGNOSTIC_CODES.heldWithoutInvocation);
  });

  it('writes nothing outside .kept/', async () => {
    const fileSystem = files();
    await runEvolve({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      ref: REF,
      fileSystem,
      helpProbe: observedProbe,
      at: AT,
    });

    const written = [...fileSystem.files.keys()].filter(
      (path) => path !== `${REPO}/${STATE_FILE_RELATIVE_PATH}`,
    );
    expect(written.length).toBeGreaterThan(0);
    for (const path of written) {
      expect(path.startsWith(`${REPO}/.kept/`), `${path} is outside the .kept/ fence`).toBe(true);
    }
    // And the card is where `/reviews` reads it from.
    expect(listReviewCards(REPO, { fileSystem, readDirectory: fileSystem.readDirectory })).toHaveLength(
      1,
    );
  });

  it('is idempotent: the same drift twice is one card', async () => {
    const fileSystem = files();
    for (const _pass of [1, 2]) {
      await runEvolve({
        repoRoot: REPO,
        config: DEFAULT_CONFIG,
        ref: REF,
        fileSystem,
        helpProbe: observedProbe,
        at: AT,
      });
    }
    const cards = listReviewCards(REPO, {
      fileSystem,
      readDirectory: fileSystem.readDirectory,
    });
    expect(cards).toHaveLength(1);
  });

  it('writes the handoff exactly once, for a run that invoked nothing', async () => {
    const fileSystem = files();
    const result = await runEvolve({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      ref: REF,
      fileSystem,
      helpProbe: observedProbe,
      at: AT,
    });
    expect(result.handoff.handoff.command.invoked).toBe(false);
    expect(result.handoff.handoff.command.argv).toEqual([]);
    // A human ran this; no hook invokes evolve (§11.1).
    expect(result.handoff.handoff.trigger.hook).toBeNull();
    expect(fileSystem.files.has(result.handoff.paths.newest)).toBe(true);
  });
});

/* ────────────── probe failure is not evidence about the flag ───────────────── */

describe('a probe that could not run says so, and holds nothing', () => {
  it('creates no card when there is no option table to read (R2.12)', async () => {
    const fileSystem = files();
    const result = await runEvolve({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      ref: REF,
      fileSystem,
      helpProbe: async () => unprobed('kane-cli was not found on PATH'),
      at: AT,
    });

    expect(result.reviewCards).toEqual([]);
    expect(result.degradedByFlagProbe).toBe(false);
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      EVOLVE_DIAGNOSTIC_CODES.probeUnavailable,
    );
    expect(result.diagnostics.map((entry) => entry.code)).not.toContain(
      EVOLVE_DIAGNOSTIC_CODES.flagMismatch,
    );
    expect(
      [...fileSystem.files.keys()].some((path) =>
        path.includes(REVIEW_CARDS_DIRECTORY_RELATIVE_PATH),
      ),
    ).toBe(false);
  });

  it('survives a probe that throws', async () => {
    const result = await runEvolve({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      ref: REF,
      fileSystem: files(),
      helpProbe: async () => {
        throw new Error('spawn EACCES');
      },
      at: AT,
    });
    expect(result.probe?.ran).toBe(false);
    expect(result.probe?.failure).toContain('EACCES');
    expect(result.reviewCards).toEqual([]);
  });
});

/* ─────────────── the invoked path, for the build that carries the flag ─────── */

describe('kept evolve invokes and holds when the flag is there', () => {
  it('mirrors each staged item into an open test-drift card', async () => {
    const kane = recorder(EVOLVE_STAGED);
    const fileSystem = files();
    const result = await runEvolve({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      ref: REF,
      fileSystem,
      invoker: kane.invoker,
      helpProbe: supportedProbe,
      at: AT,
    });

    expect(kane.spawns).toEqual([['maintain', 'evolve', REF, '--mode', 'agent']]);
    expect(result.accepted).toBe(true);
    expect(result.reviewCards).toHaveLength(1);
    const card = result.reviewCards[0];
    expect(card?.kind).toBe('test-drift');
    expect(card?.status).toBe('open');
    expect(card?.title).toBe('step 3 selector no longer resolves');
    expect(card?.proposedChanges).toEqual([
      {
        file: 'tests/cart_subtotal_test.md',
        summary: 'retarget step 3',
        diff: '-  click .total\n+  click .cart-total',
      },
    ]);
    // Held, never applied: the designed test itself is untouched.
    expect([...fileSystem.files.keys()].some((path) => path.endsWith(REF))).toBe(false);
  });

  it('creates no card from a crashed stream (R5.3)', async () => {
    const kane = recorder(EVOLVE_CRASHED);
    const result = await runEvolve({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      ref: REF,
      fileSystem: files(),
      invoker: kane.invoker,
      helpProbe: supportedProbe,
      at: AT,
    });
    expect(result.terminalSeen).toBe(false);
    expect(result.reviewCards).toEqual([]);
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      EVOLVE_DIAGNOSTIC_CODES.outcomeUnknown,
    );
  });

  it('creates no card from a pause, and says it is resumable (R5.4)', async () => {
    const kane = recorder(EVOLVE_PAUSED, 3);
    const result = await runEvolve({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      ref: REF,
      fileSystem: files(),
      invoker: kane.invoker,
      helpProbe: supportedProbe,
      at: AT,
    });
    expect(result.paused).toBe(true);
    expect(result.reviewCards).toEqual([]);
    const paused = result.diagnostics.find(
      (entry) => entry.code === EVOLVE_DIAGNOSTIC_CODES.paused,
    );
    expect(paused?.message).toContain('resumable');
  });

  it('creates no card from a refusal, and quotes the remedy off the error event', async () => {
    const kane = recorder(EVOLVE_REFUSED, 2);
    const result = await runEvolve({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      ref: REF,
      fileSystem: files(),
      invoker: kane.invoker,
      helpProbe: supportedProbe,
      at: AT,
    });
    expect(result.accepted).toBe(false);
    expect(result.reviewCards).toEqual([]);
    // §5.3.1: a refusal's remedy travels on a separate `error` event, not the terminal.
    expect(result.message).toContain('context ingest');
  });

  it('starts no process when there is no Kane boundary at all (R2.12)', async () => {
    const result = await runEvolve({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      ref: REF,
      fileSystem: files(),
      helpProbe: supportedProbe,
      at: AT,
    });
    expect(result.invoked).toBe(false);
    expect(result.reviewCards).toEqual([]);
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      EVOLVE_DIAGNOSTIC_CODES.kaneUnavailable,
    );
  });
});

/* ─────────────────────── attribution and argument handling ─────────────────── */

describe('kept evolve attributes the drift to a promise, or refuses to guess', () => {
  it('resolves the ref by designed-test path and by test id', () => {
    expect(promiseForRef(PRIOR, REF, REPO)?.id).toBe(DRIFTED?.id);
    expect(promiseForRef(PRIOR, 'T-3', REPO)?.id).toBe(DRIFTED?.id);
    expect(promiseForRef(PRIOR, 'tests/nothing_test.md', REPO)).toBeNull();
  });

  it('creates no card for a ref no promise cites', async () => {
    const fileSystem = files();
    const result = await runEvolve({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      ref: 'tests/nothing_test.md',
      fileSystem,
      helpProbe: observedProbe,
      at: AT,
    });
    expect(result.promiseId).toBeNull();
    expect(result.reviewCards).toEqual([]);
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      EVOLVE_DIAGNOSTIC_CODES.unattributed,
    );
  });

  it('probes nothing and holds nothing when no ref was given', async () => {
    let probes = 0;
    const result = await runEvolve({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      fileSystem: files(),
      helpProbe: async () => {
        probes += 1;
        return parseEvolveHelp(OBSERVED_HELP, 0);
      },
      at: AT,
    });
    expect(probes).toBe(0);
    expect(result.probe).toBeNull();
    expect(result.reviewCards).toEqual([]);
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      EVOLVE_DIAGNOSTIC_CODES.noRef,
    );
  });

  it('reads a staged item whose fields use Kane\u2019s other spellings', () => {
    expect(stagedChanges({ files: ['tests/a_test.md'] })).toEqual([
      { file: 'tests/a_test.md', summary: '', diff: '' },
    ]);
    expect(stagedChanges({ changes: [{ path: 'tests/b_test.md', patch: '-a\n+b' }] })).toEqual([
      { file: 'tests/b_test.md', summary: '', diff: '-a\n+b' },
    ]);
    expect(stagedChanges({ type: 'review_card' })).toEqual([]);
  });
});

/* ──────────────────────────── through `main` ────────────────────────────────── */

describe('kept evolve through the dispatcher', () => {
  it('exits 0 and reports the probe in --json', async () => {
    const written: string[] = [];
    const exitCode = await main(['evolve', REF, '--json'], {
      write: (text) => written.push(text),
      writeError: () => undefined,
      cwd: REPO,
      env: {},
      fileSystem: files(),
      now: () => new Date(AT),
      kane: false,
      evolveHelpProbe: observedProbe,
    });

    expect(exitCode).toBe(EXIT_OK);
    const payload = JSON.parse(written.join('')) as Record<string, unknown>;
    expect(payload['command']).toBe('evolve');
    expect(payload['implemented']).toBe(true);
    expect(payload['invoked']).toBe(false);
    expect(payload['flagSupported']).toBe(false);
    expect(payload['degradedByFlagProbe']).toBe(true);
    expect((payload['reviewCards'] as unknown[]).length).toBe(1);
  });

  it('exits 0 on the human-readable path too, naming the probe result', async () => {
    const written: string[] = [];
    const exitCode = await main(['evolve', REF], {
      write: (text) => written.push(text),
      writeError: () => undefined,
      cwd: REPO,
      env: {},
      fileSystem: files(),
      now: () => new Date(AT),
      kane: false,
      evolveHelpProbe: observedProbe,
    });
    expect(exitCode).toBe(EXIT_OK);
    expect(written.join('')).toContain('flag probe');
    expect(written.join('')).toContain('nothing was invoked');
  });
});
