import type {
  BaselineFileSystem,
  CollectingDiagnosticSink,
  PlainInvocationResult,
  PlainInvocationSpec,
  StateFileSystem,
} from '@kept/core';
import {
  KANE_BINARY_NAME,
  createDiagnosticSink,
  createKeptState,
  createPromiseGraph,
  inMemoryBaselineFileSystem,
  inMemoryStateFileSystem,
} from '@kept/core';
import { describe, expect, it } from 'vitest';

import {
  CONFIG_FILE_RELATIVE_PATH,
  DEFAULT_CONFIG,
  joinPath,
  type FenceFinding,
  type KeptConfig,
} from '../src/config.js';
import { SNAPSHOT_FILE_RELATIVE_PATH, buildSnapshot } from '../src/snapshot.js';
import {
  CONTEXT_STORE_RELATIVE_PATH,
  DEFAULT_DOCTOR_TIMEOUT_MS,
  DOCTOR_CHECK_IDS,
  DOCTOR_STATUSES,
  DOCTOR_VERSION_ARGV,
  SUBJECT_PROBE_TIMEOUT_MS,
  readVersion,
  runDoctor,
  type DoctorCheckId,
  type DoctorInvoker,
  type DoctorProbeOutcome,
  type DoctorResult,
  type DoctorUrlProbe,
} from '../src/commands/doctor.js';

/**
 * `kept doctor`: seven checks, one spawn, a remedy each, exit zero either way
 * (design §21.2, R18.1 through R18.10, R2.12).
 *
 * Every test here runs with no disk, no network and no Kane process: the config
 * and snapshot reads, the corpus walk, the `.context/` probe, the reachability GET
 * and the child process are all injected. What is being asserted is not that each
 * check can pass, since a diagnosis whose only tested path is the happy one is a
 * diagnosis nobody will trust when it matters, but that the *empty* repository, the
 * one a stranger has after `npm install` and nothing else, produces seven
 * determinate answers, seven remedies, one spawn at most, and exit code 0.
 */
const REPO = '/repo';
const AT = '2026-08-20T12:00:00.000Z';

// ---------------------------------------------------------------------------
// The seams
// ---------------------------------------------------------------------------

/**
 * A Kane boundary that counts. The counter is the whole point: R18.2 is a bound on
 * behaviour, so it is asserted by observation rather than by reading the source.
 */
function countingInvoker(
  answer: Partial<PlainInvocationResult> = {},
): DoctorInvoker & { readonly calls: PlainInvocationSpec[] } {
  const calls: PlainInvocationSpec[] = [];
  return {
    calls,
    async invokePlain(spec: PlainInvocationSpec): Promise<PlainInvocationResult> {
      calls.push(spec);
      return {
        spec,
        effectiveArgv: spec.argv,
        stdoutLines: ['kane-cli 0.8.4'],
        exitCode: 0,
        exitMeaning: 'success',
        timedOut: false,
        durationMs: 12,
        stderrTail: [],
        resolvedBinary: '/usr/local/bin/kane-cli',
        diagnostics: [],
        ...answer,
      };
    },
  };
}

/** A boundary that reports what a machine with no Kane installed reports (R2.12). */
function absentKaneInvoker(): DoctorInvoker & { readonly calls: PlainInvocationSpec[] } {
  return countingInvoker({
    stdoutLines: [],
    exitCode: null,
    exitMeaning: 'kane-not-found',
    resolvedBinary: null,
    durationMs: 0,
  });
}

/** A probe that records its arguments and answers whatever the test asked for. */
function recordingProbe(
  outcome: Partial<DoctorProbeOutcome> = {},
): DoctorUrlProbe & { readonly calls: { url: string; timeoutMs: number }[] } {
  const calls: { url: string; timeoutMs: number }[] = [];
  const probe = async (url: string, timeoutMs: number): Promise<DoctorProbeOutcome> => {
    calls.push({ url, timeoutMs });
    return { reachable: true, status: 200, error: null, durationMs: 3, ...outcome };
  };
  return Object.assign(probe, { calls });
}

/** A `StateFileSystem` that records every write, so R18.10 can be asserted. */
function recordingFileSystem(
  seed: Readonly<Record<string, string>> = {},
): StateFileSystem & { readonly written: string[] } {
  const inner = inMemoryStateFileSystem(seed);
  const written: string[] = [];
  return {
    written,
    readFile: (path) => inner.readFile(path),
    ensureDir: (path) => inner.ensureDir(path),
    writeFile: (path, contents) => {
      written.push(path);
      inner.writeFile(path, contents);
    },
  };
}

/** A tree that throws for everything: no corpus directory, no `.context/`. */
const EMPTY_TREE: BaselineFileSystem = inMemoryBaselineFileSystem({});

/** A config with the §20.1 keys overridden for one test. */
function configWith(extra: Partial<KeptConfig> = {}): KeptConfig {
  return { ...DEFAULT_CONFIG, ...extra };
}

/** A fence set granting one branch one glob, so check 7 has something to check. */
function fencesAllowing(allow: readonly string[]): KeptConfig['fences'] {
  return {
    'code-break': { allow },
    'test-drift': { allow: [] },
    'docs-lie': { allow: [] },
  };
}

/**
 * A fully authored config: every key stated, so the loader applies no default and
 * every derived check has something the repository actually chose to report on.
 *
 * `code-break` is granted `src/**`, which reaches neither the corpus root nor the
 * one documentation glob, so check 7 can pass rather than reporting the empty
 * allow set §20.4 defaults to.
 */
const HEALTHY_CONFIG: KeptConfig = {
  verdictRouter: 'resultCode740',
  memberDebug: false,
  timeouts: { hookMs: 300_000, enrichmentMs: 60_000, doctorMs: 10_000 },
  corpus: { root: 'corpus' },
  subject: { source: ['src/**'], docs: ['README.md'], baseUrl: 'http://127.0.0.1:3100' },
  fences: fencesAllowing(['src/**']),
};

/** A snapshot the parser accepts, built the way `kept snapshot` builds it. */
function validSnapshotText(): string {
  return buildSnapshot({
    state: createKeptState({ updatedAt: AT, graph: createPromiseGraph({ promises: [] }) }),
    generatedAt: AT,
  }).text;
}

interface RunOptions {
  readonly config?: KeptConfig;
  readonly invoker?: DoctorInvoker | undefined;
  readonly fileSystem?: StateFileSystem;
  readonly tree?: BaselineFileSystem;
  readonly probeUrl?: DoctorUrlProbe;
  readonly fences?: (config: KeptConfig) => readonly FenceFinding[];
  readonly sink?: CollectingDiagnosticSink;
}

/** Run the command with everything injected: no disk, no network, no process. */
async function run(options: RunOptions = {}): Promise<DoctorResult> {
  return await runDoctor({
    repoRoot: REPO,
    config: options.config ?? configWith(),
    invoker: options.invoker,
    fileSystem: options.fileSystem ?? recordingFileSystem(),
    tree: options.tree ?? EMPTY_TREE,
    probeUrl: options.probeUrl ?? recordingProbe(),
    ...(options.fences === undefined ? {} : { fences: options.fences }),
    diagnostics: options.sink ?? createDiagnosticSink(),
    at: AT,
  });
}

/** One check by id, so a test names what it is asserting about. */
function check(result: DoctorResult, id: DoctorCheckId) {
  const found = result.checks.find((entry) => entry.id === id);
  expect(found, `no check reported for ${id}`).toBeDefined();
  return found as NonNullable<typeof found>;
}

// ---------------------------------------------------------------------------
// Totality: seven determinate checks, every one with a remedy when it fails
// ---------------------------------------------------------------------------

describe('the diagnosis is total over the seven checks of §21.2', () => {
  it('reports every check in the design table, in the design order', async () => {
    const result = await run();
    expect(result.checks.map((entry) => entry.id)).toEqual([...DOCTOR_CHECK_IDS]);
    expect(result.checks.map((entry) => entry.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('gives every check one of exactly three statuses, and a non-empty detail', async () => {
    const result = await run();
    for (const entry of result.checks) {
      expect(DOCTOR_STATUSES).toContain(entry.status);
      expect(entry.detail.length).toBeGreaterThan(0);
      expect(entry.title.length).toBeGreaterThan(0);
    }
  });

  it('names a remedy for every check that did not pass, and none for the ones that did (R18.9)', async () => {
    // The empty repository, which is the state this command exists for: no config,
    // no snapshot, no corpus, no `.context/`, no Kane.
    const result = await run({ invoker: absentKaneInvoker() });
    for (const entry of result.checks) {
      if (entry.status === 'pass') {
        expect(entry.remedy, `${entry.id} passed but carries a remedy`).toBeNull();
        continue;
      }
      expect(entry.remedy, `${entry.id} did not pass and carries no remedy`).not.toBeNull();
      expect((entry.remedy ?? '').length).toBeGreaterThan(0);
    }
    // And this state really is the one being described, so the clause above is not
    // vacuous over a table that happened to pass.
    expect(result.checks.filter((entry) => entry.status === 'pass')).toHaveLength(0);
  });

  it("reports a stranger's untouched directory as not-configured throughout, naming `kept init`", async () => {
    // §22.1's assertion, held here rather than only in the packaging test: no
    // config, no snapshot, no corpus, no `.context/`, no Kane. Nothing about that
    // repository is broken. Nothing about it exists yet, so nothing reads `fail`.
    const result = await run({ invoker: absentKaneInvoker() });
    expect(result.checks.map((entry) => entry.status)).toEqual(
      Array(DOCTOR_CHECK_IDS.length).fill('not-configured'),
    );
    expect(result.exitCode).toBe(0);
    expect(
      result.checks.filter((entry) => (entry.remedy ?? '').includes('kept init')).length,
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// R18.8: exit code 0 for every repository state
// ---------------------------------------------------------------------------

describe('the exit code is 0 for every repository state (R18.8, R2.12)', () => {
  it('exits 0 with no Kane binary on PATH, naming the verified release', async () => {
    const result = await run({ invoker: absentKaneInvoker() });
    expect(result.exitCode).toBe(0);
    // An absent binary is a machine nobody has set up, not a Kane that broke.
    expect(check(result, 'kane-binary').status).toBe('not-configured');
    expect(check(result, 'kane-binary').remedy).toContain('0.8.4');
    expect(result.kane.present).toBe(false);
  });

  it('exits 0 with no Kane process boundary at all, having spawned nothing', async () => {
    const result = await run({ invoker: undefined });
    expect(result.exitCode).toBe(0);
    expect(result.spawns).toBe(0);
    expect(check(result, 'kane-binary').status).toBe('not-configured');
  });

  it('exits 0 when every read, every probe and the spawn itself throws', async () => {
    const hostileTree: BaselineFileSystem = {
      readDirectory(): never {
        throw new Error('EIO');
      },
      readFile(): never {
        throw new Error('EIO');
      },
    };
    const unreadable = recordingFileSystem();
    const hostileFs: StateFileSystem = {
      readFile(path) {
        // The handoff's own existence probe has to be answerable, or there is no
        // repository state left to diagnose, only a disk that is gone.
        if (path.includes('handoff')) return unreadable.readFile(path);
        throw new Error('EIO');
      },
      ensureDir: (path) => unreadable.ensureDir(path),
      writeFile: (path, contents) => unreadable.writeFile(path, contents),
    };
    const result = await run({
      tree: hostileTree,
      fileSystem: hostileFs,
      config: configWith({ subject: { source: [], docs: [], baseUrl: 'http://127.0.0.1:1' } }),
      probeUrl: async (): Promise<DoctorProbeOutcome> => {
        throw new Error('ECONNREFUSED');
      },
      invoker: {
        async invokePlain(): Promise<PlainInvocationResult> {
          throw new Error('spawn blew up');
        },
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.checks).toHaveLength(DOCTOR_CHECK_IDS.length);
    expect(check(result, 'subject-reachable').status).toBe('fail');
    // A spawn that threw is a spawn that did not report, so nothing was observed.
    expect(result.spawns).toBe(0);
    expect(unreadable.written).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// R18.2: at most one Kane spawn
// ---------------------------------------------------------------------------

describe('at most one Kane spawn (R18.2)', () => {
  it('spawns exactly once, for the version probe, and never again', async () => {
    const invoker = countingInvoker();
    const result = await run({
      invoker,
      // Every other check has something to look at, so none of them is skipped
      // into a cheap answer: a corpus, a `.context/` store, a snapshot, a config
      // and a base URL are all present.
      tree: inMemoryBaselineFileSystem({
        'corpus/a_test.md': '<!-- @verifies README.md:1 -->',
        [`${CONTEXT_STORE_RELATIVE_PATH}/commits/000001.json`]: '{}',
      }),
      config: HEALTHY_CONFIG,
      fileSystem: recordingFileSystem({
        [joinPath(REPO, CONFIG_FILE_RELATIVE_PATH)]: JSON.stringify(HEALTHY_CONFIG),
        [joinPath(REPO, SNAPSHOT_FILE_RELATIVE_PATH)]: validSnapshotText(),
      }),
    });

    expect(invoker.calls).toHaveLength(1);
    expect(result.spawns).toBe(1);
    // And every check found what it was looking for, so the single spawn is not an
    // artefact of six checks having given up early.
    expect(result.checks.map((entry) => entry.status)).toEqual(
      Array(DOCTOR_CHECK_IDS.length).fill('pass'),
    );
  });

  it('issues `--version` on the doctorMs budget, from the repository root', async () => {
    const invoker = countingInvoker();
    await run({ invoker, config: configWith({ timeouts: { ...DEFAULT_CONFIG.timeouts, doctorMs: 4321 } }) });
    const spec = invoker.calls[0];
    expect(spec?.argv).toEqual([...DOCTOR_VERSION_ARGV]);
    expect(spec?.cwd).toBe(REPO);
    expect(spec?.timeoutMs).toBe(4321);
  });

  it('falls back to a ten-second budget when the config carries no doctorMs (§20.4)', async () => {
    const invoker = countingInvoker();
    await run({ invoker });
    expect(invoker.calls[0]?.timeoutMs).toBe(DEFAULT_DOCTOR_TIMEOUT_MS);
  });

  it('answers the context-store check from the filesystem, not from Kane', async () => {
    const invoker = countingInvoker();
    const result = await run({
      invoker,
      tree: inMemoryBaselineFileSystem({
        [`${CONTEXT_STORE_RELATIVE_PATH}/commits/000001.json`]: '{}',
      }),
    });
    expect(check(result, 'context-store').status).toBe('pass');
    // The store was found, and it cost no second process.
    expect(invoker.calls).toHaveLength(1);
    expect(invoker.calls[0]?.argv).toEqual([...DOCTOR_VERSION_ARGV]);
  });

  it('reports an absent store with the two-command ingest remedy verbatim', async () => {
    const result = await run({ invoker: countingInvoker() });
    const entry = check(result, 'context-store');
    expect(entry.status).toBe('not-configured');
    expect(entry.remedy).toContain(`${KANE_BINARY_NAME} context ingest <files> --mode ci`);
    expect(entry.remedy).toContain(`${KANE_BINARY_NAME} context extract`);
  });
});

// ---------------------------------------------------------------------------
// R18.10: the handoff, and nothing else
// ---------------------------------------------------------------------------

describe('the handoff is the only file written (R18.10)', () => {
  it('writes the newest handoff and its immutable copy, and no other path', async () => {
    const fileSystem = recordingFileSystem();
    const result = await run({ fileSystem, invoker: countingInvoker() });
    expect([...fileSystem.written].sort()).toEqual(
      [result.handoff.paths.newest, result.handoff.paths.archive].sort(),
    );
  });

  it('records the probe as a family-less command, so no verdict can move from here', async () => {
    const result = await run({ invoker: countingInvoker() });
    expect(result.handoff.handoff.command.family).toBeNull();
    expect(result.handoff.handoff.command.invoked).toBe(true);
    expect(result.handoff.handoff.command.argv).toEqual([...DOCTOR_VERSION_ARGV]);
    expect(result.handoff.handoff.results).toEqual([]);
  });

  it('writes the handoff even when nothing was invoked', async () => {
    const fileSystem = recordingFileSystem();
    const result = await run({ fileSystem, invoker: undefined });
    expect(fileSystem.written).toHaveLength(2);
    expect(result.handoff.handoff.command.invoked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Check 1: the binary, its path and its version (R18.1)
// ---------------------------------------------------------------------------

describe('check 1 reports the binary, its resolved path and its version (R18.1)', () => {
  it('passes with the resolved path and the reported version', async () => {
    const result = await run({ invoker: countingInvoker() });
    expect(result.kane.resolvedBinary).toBe('/usr/local/bin/kane-cli');
    expect(result.kane.version).toBe('kane-cli 0.8.4');
    expect(check(result, 'kane-binary').status).toBe('pass');
    expect(check(result, 'kane-binary').detail).toContain('/usr/local/bin/kane-cli');
  });

  it('fails a timeout by naming the budget rather than the binary', async () => {
    const result = await run({
      invoker: countingInvoker({
        timedOut: true,
        exitCode: null,
        exitMeaning: 'killed-by-timeout',
        stdoutLines: [],
      }),
    });
    const entry = check(result, 'kane-binary');
    expect(entry.status).toBe('fail');
    expect(entry.remedy).toContain('timeouts.doctorMs');
  });

  it('fails a binary that answered with no version at all', async () => {
    const result = await run({ invoker: countingInvoker({ stdoutLines: ['', '   '], exitCode: 2 }) });
    expect(check(result, 'kane-binary').status).toBe('fail');
    expect(result.kane.version).toBeNull();
  });

  it('skips an update advisory printed ahead of the version (R3.23)', () => {
    expect(readVersion(['Update available: 0.8.4 → 0.8.5', 'kane-cli 0.8.4'])).toBe('kane-cli 0.8.4');
    expect(readVersion(['', 'no digits here', '1.2.3'])).toBe('1.2.3');
    expect(readVersion([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Check 2: configuration (R18.3)
// ---------------------------------------------------------------------------

describe('check 2 reports whether the config parses and which router is selected (R18.3)', () => {
  it('reports an absent config as not-configured, naming `kept init`', async () => {
    const result = await run();
    const entry = check(result, 'configuration');
    expect(entry.status).toBe('not-configured');
    expect(entry.remedy).toContain('kept init');
    expect(entry.detail).toContain(DEFAULT_CONFIG.verdictRouter);
  });

  it('passes a config that parses, naming the selected router', async () => {
    const result = await run({
      fileSystem: recordingFileSystem({
        [joinPath(REPO, CONFIG_FILE_RELATIVE_PATH)]: JSON.stringify(DEFAULT_CONFIG),
      }),
      config: configWith({ verdictRouter: 'failureYamlTriage' }),
    });
    const entry = check(result, 'configuration');
    expect(entry.status).toBe('pass');
    expect(entry.detail).toContain('failureYamlTriage');
  });

  it('fails a config that is present and malformed, quoting the offending field', async () => {
    const result = await run({
      fileSystem: recordingFileSystem({
        [joinPath(REPO, CONFIG_FILE_RELATIVE_PATH)]: JSON.stringify({
          verdictRouter: 'resultCode740',
          memberDebug: false,
          timeouts: { hookMs: '5 minutes', enrichmentMs: 60_000 },
        }),
      }),
    });
    const entry = check(result, 'configuration');
    expect(entry.status).toBe('fail');
    expect(entry.remedy).toContain('hookMs');
  });
});

// ---------------------------------------------------------------------------
// Check 3: the corpus and its tags (R18.7)
// ---------------------------------------------------------------------------

describe('check 3 counts `*_test.md` files and their `@verifies` tags (R18.7)', () => {
  /** A config file on disk, so the corpus root in play was chosen rather than defaulted. */
  function configured(): StateFileSystem & { readonly written: string[] } {
    return recordingFileSystem({
      [joinPath(REPO, CONFIG_FILE_RELATIVE_PATH)]: JSON.stringify(HEALTHY_CONFIG),
    });
  }

  it('reports the root, the file count and the tag count', async () => {
    const result = await run({
      config: HEALTHY_CONFIG,
      fileSystem: configured(),
      tree: inMemoryBaselineFileSystem({
        'corpus/a_test.md': '<!-- @verifies README.md:1 -->\n<!-- @verifies README.md:2 -->',
        'corpus/nested/b_test.md': '<!-- @verifies README.md:3 -->',
        'corpus/notes.md': 'not a test document',
        'corpus/node_modules/c_test.md': '<!-- @verifies README.md:9 -->',
        'elsewhere/d_test.md': '<!-- @verifies README.md:4 -->',
      }),
    });
    expect(result.corpus.root).toBe('corpus');
    // `node_modules` is not descended into and `elsewhere/` is outside the root.
    expect(result.corpus.files).toEqual(['corpus/a_test.md', 'corpus/nested/b_test.md']);
    expect(result.corpus.verifiesTags).toBe(3);
    expect(check(result, 'corpus').status).toBe('pass');
  });

  it('reports a defaulted root as not-configured, naming the directory it scanned', async () => {
    // No config file, so §20.4's default is in force. Whether that directory
    // happens to exist is beside the point: nothing chose it.
    const result = await run({ tree: inMemoryBaselineFileSystem({}) });
    const entry = check(result, 'corpus');
    expect(entry.status).toBe('not-configured');
    expect(entry.detail).toContain(DEFAULT_CONFIG.corpus.root);
    expect(entry.remedy).toContain('kept init');
  });

  it('separates a configured root that cannot be listed from one that is empty', async () => {
    const missing = await run({ config: HEALTHY_CONFIG, fileSystem: configured() });
    expect(check(missing, 'corpus').status).toBe('fail');
    expect(check(missing, 'corpus').detail).toContain('could not be listed');

    const empty = await run({
      config: HEALTHY_CONFIG,
      fileSystem: configured(),
      tree: inMemoryBaselineFileSystem({ 'corpus/readme.md': 'nothing designed here' }),
    });
    expect(check(empty, 'corpus').status).toBe('fail');
    expect(check(empty, 'corpus').detail).toContain('no `*_test.md`');
    expect(check(empty, 'corpus').remedy).toContain('kept init');
  });

  it('fails documents that carry no well-formed tag, quoting the grammar', async () => {
    const result = await run({
      config: HEALTHY_CONFIG,
      fileSystem: configured(),
      tree: inMemoryBaselineFileSystem({ 'corpus/a_test.md': '@verifies README.md' }),
    });
    const entry = check(result, 'corpus');
    expect(entry.status).toBe('fail');
    expect(result.corpus.files).toHaveLength(1);
    expect(result.corpus.verifiesTags).toBe(0);
    expect(entry.remedy).toContain('@verifies <path>:<line>');
  });
});

// ---------------------------------------------------------------------------
// Check 4: the snapshot (R18.4)
// ---------------------------------------------------------------------------

describe('check 4 reports snapshot presence and schema validity (R18.4)', () => {
  it('passes a snapshot the parser accepts', async () => {
    const result = await run({
      fileSystem: recordingFileSystem({
        [joinPath(REPO, SNAPSHOT_FILE_RELATIVE_PATH)]: validSnapshotText(),
      }),
    });
    expect(result.snapshot.present).toBe(true);
    expect(result.snapshot.valid).toBe(true);
    expect(check(result, 'snapshot').status).toBe('pass');
  });

  it('reports an absent snapshot as not-configured, naming the two commands that build one', async () => {
    const result = await run();
    expect(check(result, 'snapshot').status).toBe('not-configured');
    expect(check(result, 'snapshot').remedy).toBe('Run `kept build && kept snapshot`');
    expect(result.snapshot.present).toBe(false);
  });

  it('fails a snapshot present but refused, carrying the parser message', async () => {
    const result = await run({
      fileSystem: recordingFileSystem({
        [joinPath(REPO, SNAPSHOT_FILE_RELATIVE_PATH)]: '{"schemaVersion":1,',
      }),
    });
    expect(check(result, 'snapshot').status).toBe('fail');
    expect(result.snapshot.present).toBe(true);
    expect(result.snapshot.error).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Check 5: subject reachability (R18.5)
// ---------------------------------------------------------------------------

describe('check 5 probes the base URL once, or nothing at all (R18.5, §20.4)', () => {
  it('probes nothing when the base URL is null, and says so', async () => {
    const probe = recordingProbe();
    const result = await run({ probeUrl: probe });
    expect(probe.calls).toEqual([]);
    expect(result.subject.probed).toBe(false);
    expect(check(result, 'subject-reachable').status).toBe('not-configured');
  });

  it('issues one GET on a two-second budget when a base URL is configured', async () => {
    const probe = recordingProbe();
    const result = await run({
      probeUrl: probe,
      config: configWith({ subject: { source: [], docs: [], baseUrl: 'http://127.0.0.1:3100' } }),
    });
    expect(probe.calls).toEqual([{ url: 'http://127.0.0.1:3100', timeoutMs: SUBJECT_PROBE_TIMEOUT_MS }]);
    expect(check(result, 'subject-reachable').status).toBe('pass');
  });

  it('counts an HTTP error status as reachable, because something answered', async () => {
    const result = await run({
      probeUrl: recordingProbe({ reachable: true, status: 500 }),
      config: configWith({ subject: { source: [], docs: [], baseUrl: 'http://127.0.0.1:3100' } }),
    });
    expect(check(result, 'subject-reachable').status).toBe('pass');
    expect(result.subject.status).toBe(500);
  });

  it('fails an unreachable URL, naming the URL in the remedy', async () => {
    const result = await run({
      probeUrl: recordingProbe({ reachable: false, status: null, error: 'ECONNREFUSED' }),
      config: configWith({ subject: { source: [], docs: [], baseUrl: 'http://127.0.0.1:3100' } }),
    });
    const entry = check(result, 'subject-reachable');
    expect(entry.status).toBe('fail');
    expect(entry.detail).toContain('ECONNREFUSED');
    expect(entry.remedy).toContain('http://127.0.0.1:3100');
  });
});

// ---------------------------------------------------------------------------
// Check 7: the fences, reported even when they pass (§20.3)
// ---------------------------------------------------------------------------

describe('check 7 reports the fence intersection guard even when it passes (§20.3)', () => {
  it('passes with a stated detail rather than silently', async () => {
    // The default reader is the loader's own `fenceFindings`, so this asserts the
    // real guard rather than a stub agreeing with itself.
    const result = await run({ config: HEALTHY_CONFIG });
    const entry = check(result, 'fences');
    expect(entry.status).toBe('pass');
    expect(entry.detail).toContain('1 allow glob');
    expect(result.fences.available).toBe(true);
    expect(result.fences.findings).toEqual([]);
  });

  it('fails an allow glob that reaches the claims, naming the intersection', async () => {
    // `**` is §20.3's own worked example of the configuration that would authorise
    // an agent to rewrite the claim it just failed.
    const result = await run({
      config: configWith({ ...HEALTHY_CONFIG, fences: fencesAllowing(['**']) }),
    });
    const entry = check(result, 'fences');
    expect(entry.status).toBe('fail');
    expect(entry.detail).toContain('code-break');
    expect(entry.detail).toContain('**');
    expect(entry.remedy).not.toBeNull();
    expect(result.fences.findings.length).toBeGreaterThan(0);
  });

  it('reports an empty allow set as not-configured rather than as a pass', async () => {
    // "Nobody granted anything, so nothing collided" and "your fences are safe"
    // are different facts, and §20.4's default is the first.
    const result = await run();
    const entry = check(result, 'fences');
    expect(entry.status).toBe('not-configured');
    expect(result.fences.declaredGlobs).toBe(0);
    expect(entry.remedy).toContain('fences.code-break.allow');
  });

  it('reports a guard that could not be evaluated as not-configured', async () => {
    const result = await run({
      fences: () => {
        throw new Error('the guard blew up');
      },
    });
    const entry = check(result, 'fences');
    expect(entry.status).toBe('not-configured');
    expect(result.fences.available).toBe(false);
    expect(entry.detail).toContain('could not be evaluated');
  });
});

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

describe('the run diagnostics carry the whole table', () => {
  it('reports one diagnostic per check, plus the start and completion notes', async () => {
    const sink = createDiagnosticSink();
    const result = await run({ sink, invoker: countingInvoker() });
    const perCheck = result.diagnostics.filter((entry) => entry.code === 'doctor-check');
    expect(perCheck).toHaveLength(DOCTOR_CHECK_IDS.length);
    expect(result.diagnostics.some((entry) => entry.code === 'doctor-started')).toBe(true);
    expect(result.diagnostics.some((entry) => entry.code === 'doctor-completed')).toBe(true);
  });

  it('carries every remedy into the handoff, so an agent never parses stdout', async () => {
    const result = await run({ invoker: absentKaneInvoker() });
    const text = result.handoff.contents;
    for (const entry of result.checks) {
      if (entry.remedy === null) continue;
      expect(
        result.diagnostics.some((diagnostic) => diagnostic.message.includes(entry.remedy ?? '')),
        `${entry.id}'s remedy is missing from the diagnostics`,
      ).toBe(true);
    }
    expect(text.length).toBeGreaterThan(0);
  });
});
