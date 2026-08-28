import type {
  BaselineFileSystem,
  PlainInvocationResult,
  PlainInvocationSpec,
  StateFileSystem,
} from 'kept-core';
import {
  createKeptState,
  createPromiseGraph,
  inMemoryBaselineFileSystem,
  inMemoryStateFileSystem,
} from 'kept-core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  CONFIG_FILE_RELATIVE_PATH,
  DEFAULT_CONFIG,
  REPAIR_BRANCH_NAMES,
  joinPath,
  type KeptConfig,
  type RepairBranchName,
} from '../src/config.js';
import { SNAPSHOT_FILE_RELATIVE_PATH, buildSnapshot } from '../src/snapshot.js';
import {
  DOCTOR_CHECK_IDS,
  DOCTOR_STATUSES,
  DOCTOR_VERSION_ARGV,
  runDoctor,
  type DoctorInvoker,
  type DoctorProbeOutcome,
  type DoctorUrlProbe,
} from '../src/commands/doctor.js';

/**
 * Feature: kept, Property 34: Diagnosis is total, bounded and exits zero (design
 * §Correctness Properties, §21.2, §20.4, R18.1, R18.2, R18.8, R18.9, R18.10).
 *
 * *For any* repository state, including one with no configuration, no snapshot, no
 * corpus and no Kane binary on the path, diagnosis reports a determinate result for
 * every check, names a remedy for each check that did not pass, spawns Kane at most
 * once, and exits with process exit code 0.
 *
 * ## How the four clauses are encoded, and why each generator reaches where it does
 *
 * **Determinate for every check** is membership, twice over: the reported ids are
 * exactly {@link DOCTOR_CHECK_IDS} in exactly that order, and every status is one of
 * {@link DOCTOR_STATUSES}. Both halves matter. A command that answered six checks
 * and silently dropped the seventh would satisfy "every reported status is valid"
 * and fail the property this asserts, which is that a *reader* gets seven answers
 * whatever the repository looks like. The ordering clause is what makes the
 * §21.2 table something a stranger can follow while the command runs.
 *
 * **A remedy on every non-pass** is R18.9 and is the clause with teeth. It is
 * asserted as a non-empty string rather than merely non-null, because an empty
 * remedy is a remedy-shaped absence: the field is populated, the reader learns
 * nothing, and the type says everything is fine.
 *
 * **At most one spawn** is R18.2 and is counted rather than reasoned about. The
 * invoker is a stub that increments on every call and the property asserts the
 * counter, so the seven checks could be reordered, a new one added, or the
 * context-store check rewritten to ask Kane, and this test would fail rather than
 * keep passing on the strength of a comment. The count is also asserted against
 * `result.spawns`, so the field a caller reads cannot drift from what happened.
 *
 * **Exit code 0** is R18.8. It is a literal type on {@link DoctorResult.exitCode},
 * so this assertion cannot fail while the code compiles, which is the point of
 * writing it that way, and is still worth generating, because the clause the design
 * states is about *behaviour over repository states* and a future refactor that
 * widened the field would be caught here rather than at the call site.
 *
 * ## The state space
 *
 * The generator crosses the presence of a config file, whether that config parses,
 * whether it names a corpus root and a base URL, how many `*_test.md` documents the
 * corpus holds and whether their tags are well-formed, whether the snapshot is
 * absent, valid or corrupt, whether `.context/` is there, whether the fences grant
 * anything and whether what they grant collides with the claims, and five states of
 * the Kane boundary including absent, timed out, crashed and never supplied at all.
 * That is deliberately more than the plausible combinations: the repository state
 * this command exists for is the one nobody anticipated, and a generator that only
 * produced sensible repositories would be testing the cases that were already easy.
 *
 * Every seam is injected, so the whole property runs with no disk, no network and no
 * process, which is also what makes it honest about the spawn count, since a real
 * `KaneInvoker` would answer `kane-not-found` on this machine and the bound would
 * hold for the wrong reason.
 *
 * **Validates: Requirements 18.1, 18.2, 18.8, 18.9, 18.10**
 */

const NUM_RUNS = 200;
const REPO = '/repo';
const AT = '2026-08-20T12:00:00.000Z';

// ---------------------------------------------------------------------------
// The generated repository
// ---------------------------------------------------------------------------

/** How the Kane boundary behaves for one generated repository. */
type KaneState = 'absent' | 'healthy' | 'no-version' | 'timeout' | 'crashed' | 'no-boundary';

const KANE_STATES: readonly KaneState[] = Object.freeze([
  'absent',
  'healthy',
  'no-version',
  'timeout',
  'crashed',
  'no-boundary',
]);

/** What the snapshot file looks like, if it is there at all. */
type SnapshotState = 'absent' | 'valid' | 'corrupt';

/** What the corpus directory holds. */
type CorpusState = 'absent' | 'empty' | 'untagged' | 'tagged';

/** What the config file on disk looks like. */
type ConfigFileState = 'absent' | 'not-json' | 'wrong-shape' | 'partial' | 'complete';

interface RepositoryState {
  readonly configFile: ConfigFileState;
  readonly corpus: CorpusState;
  readonly corpusRoot: string;
  readonly baseUrl: string | null;
  readonly snapshot: SnapshotState;
  readonly contextStore: boolean;
  readonly allow: readonly string[];
  readonly kane: KaneState;
  readonly reachable: boolean;
  readonly probeThrows: boolean;
  readonly router: KeptConfig['verdictRouter'];
}

const arbState: fc.Arbitrary<RepositoryState> = fc.record({
  configFile: fc.constantFrom<ConfigFileState>(
    'absent',
    'not-json',
    'wrong-shape',
    'partial',
    'complete',
  ),
  corpus: fc.constantFrom<CorpusState>('absent', 'empty', 'untagged', 'tagged'),
  // Including the awkward spellings a hand-edited config can carry.
  corpusRoot: fc.constantFrom('corpus', 'corpus/', './corpus', 'suite/designed'),
  baseUrl: fc.constantFrom<string | null>(
    null,
    'http://127.0.0.1:3100',
    'http://127.0.0.1:65535',
    'not a url at all',
  ),
  snapshot: fc.constantFrom<SnapshotState>('absent', 'valid', 'corrupt'),
  contextStore: fc.boolean(),
  // `**` and the parent traversal are §20.3's own worked examples of an allow set
  // that reaches the claim it just failed, so the fence check has a real finding to
  // report rather than only the empty default.
  allow: fc.constantFrom<readonly string[]>(
    [],
    ['src/**'],
    ['**'],
    ['../**'],
    ['corpus/**'],
    ['README.md'],
    ['src/**', '**/*'],
  ),
  kane: fc.constantFrom<KaneState>(...KANE_STATES),
  reachable: fc.boolean(),
  probeThrows: fc.boolean(),
  router: fc.constantFrom<KeptConfig['verdictRouter']>('resultCode740', 'failureYamlTriage'),
});

// ---------------------------------------------------------------------------
// Turning one generated state into seams
// ---------------------------------------------------------------------------

function fencesFrom(allow: readonly string[]): KeptConfig['fences'] {
  const entries = REPAIR_BRANCH_NAMES.map(
    (branch: RepairBranchName) => [branch, { allow }] as const,
  );
  return Object.fromEntries(entries) as KeptConfig['fences'];
}

function configFrom(state: RepositoryState): KeptConfig {
  return {
    verdictRouter: state.router,
    memberDebug: false,
    timeouts: { hookMs: 300_000, enrichmentMs: 60_000, doctorMs: 7_000 },
    corpus: { root: state.corpusRoot },
    subject: { source: ['src/**'], docs: ['README.md'], baseUrl: state.baseUrl },
    fences: fencesFrom(state.allow),
  };
}

/** The bytes of the config file, or null when the repository has none. */
function configFileText(state: RepositoryState): string | null {
  switch (state.configFile) {
    case 'absent':
      return null;
    case 'not-json':
      return '{ "verdictRouter": "resultCode740",';
    case 'wrong-shape':
      return '["resultCode740"]';
    case 'partial':
      // Every optional key omitted, so §20.4's defaults are announced and applied.
      return JSON.stringify({ timeouts: { hookMs: 300_000, enrichmentMs: 60_000 } });
    case 'complete':
      return JSON.stringify(configFrom(state));
  }
}

function validSnapshotText(): string {
  return buildSnapshot({
    state: createKeptState({ updatedAt: AT, graph: createPromiseGraph({ promises: [] }) }),
    generatedAt: AT,
  }).text;
}

function snapshotText(state: RepositoryState): string | null {
  switch (state.snapshot) {
    case 'absent':
      return null;
    case 'valid':
      return validSnapshotText();
    case 'corrupt':
      return '{"schemaVersion":1,"promises":';
  }
}

/** The generated repository, as a `StateFileSystem` that records what it wrote. */
function fileSystemFrom(state: RepositoryState): StateFileSystem & { readonly written: string[] } {
  const seed: Record<string, string> = {};
  const config = configFileText(state);
  if (config !== null) seed[joinPath(REPO, CONFIG_FILE_RELATIVE_PATH)] = config;
  const snapshot = snapshotText(state);
  if (snapshot !== null) seed[joinPath(REPO, SNAPSHOT_FILE_RELATIVE_PATH)] = snapshot;

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

/** The generated working tree: the corpus, and the `.context/` store or not. */
function treeFrom(state: RepositoryState): BaselineFileSystem {
  const files: Record<string, string> = {};
  // Normalised the way the command normalises it, so the generated awkward
  // spellings of the root land in the directory the walk will actually list.
  const root = state.corpusRoot.replace(/^\.\//, '').replace(/\/+$/, '');
  if (state.corpus === 'empty') files[`${root}/notes.md`] = 'no designed tests here';
  if (state.corpus === 'untagged') files[`${root}/a_test.md`] = '@verifies README.md';
  if (state.corpus === 'tagged') {
    files[`${root}/a_test.md`] = '<!-- @verifies README.md:1 the claim -->';
    files[`${root}/nested/b_test.md`] = '<!-- @verifies README.md:2 another -->';
  }
  if (state.contextStore) files['.context/commits/000001-abc.json'] = '{}';
  return inMemoryBaselineFileSystem(files);
}

/** A counting Kane boundary, or none at all. */
function invokerFrom(
  state: RepositoryState,
): { readonly invoker: DoctorInvoker | undefined; readonly calls: PlainInvocationSpec[] } {
  const calls: PlainInvocationSpec[] = [];
  if (state.kane === 'no-boundary') return { invoker: undefined, calls };

  const invoker: DoctorInvoker = {
    async invokePlain(spec: PlainInvocationSpec): Promise<PlainInvocationResult> {
      calls.push(spec);
      if (state.kane === 'crashed') throw new Error('spawn ENOENT');
      const base = {
        spec,
        effectiveArgv: spec.argv,
        timedOut: false,
        stderrTail: [] as readonly string[],
        diagnostics: [],
      };
      if (state.kane === 'absent') {
        return {
          ...base,
          stdoutLines: [],
          exitCode: null,
          exitMeaning: 'kane-not-found',
          durationMs: 0,
          resolvedBinary: null,
        };
      }
      if (state.kane === 'timeout') {
        return {
          ...base,
          timedOut: true,
          stdoutLines: [],
          exitCode: null,
          exitMeaning: 'killed-by-timeout',
          durationMs: spec.timeoutMs,
          resolvedBinary: '/usr/local/bin/kane-cli',
        };
      }
      if (state.kane === 'no-version') {
        return {
          ...base,
          stdoutLines: ['', '   '],
          exitCode: 2,
          exitMeaning: 'failure',
          durationMs: 4,
          resolvedBinary: '/usr/local/bin/kane-cli',
        };
      }
      return {
        ...base,
        stdoutLines: ['kane-cli 0.8.4'],
        exitCode: 0,
        exitMeaning: 'success',
        durationMs: 4,
        resolvedBinary: '/usr/local/bin/kane-cli',
      };
    },
  };
  return { invoker, calls };
}

/** A probe that counts, so "one GET at most, and none when null" is observable. */
function probeFrom(
  state: RepositoryState,
): DoctorUrlProbe & { readonly calls: { url: string; timeoutMs: number }[] } {
  const calls: { url: string; timeoutMs: number }[] = [];
  const probe = async (url: string, timeoutMs: number): Promise<DoctorProbeOutcome> => {
    calls.push({ url, timeoutMs });
    if (state.probeThrows) throw new Error('ECONNRESET');
    return state.reachable
      ? { reachable: true, status: 200, error: null, durationMs: 2 }
      : { reachable: false, status: null, error: 'ECONNREFUSED', durationMs: 2 };
  };
  return Object.assign(probe, { calls });
}

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

describe('Feature: kept, Property 34: Diagnosis is total, bounded and exits zero', () => {
  it('answers all seven checks with a remedy on each non-pass, one spawn at most, and exit 0', async () => {
    await fc.assert(
      fc.asyncProperty(arbState, async (state) => {
        const fileSystem = fileSystemFrom(state);
        const { invoker, calls } = invokerFrom(state);
        const probe = probeFrom(state);

        const result = await runDoctor({
          repoRoot: REPO,
          config: configFrom(state),
          invoker,
          fileSystem,
          tree: treeFrom(state),
          probeUrl: probe,
          at: AT,
        });

        // ── Determinate for every check ────────────────────────────────────
        expect(result.checks.map((entry) => entry.id)).toEqual([...DOCTOR_CHECK_IDS]);
        for (const entry of result.checks) {
          expect(DOCTOR_STATUSES).toContain(entry.status);
          expect(entry.detail.trim().length).toBeGreaterThan(0);
          expect(entry.title.trim().length).toBeGreaterThan(0);
        }

        // ── A remedy on every non-pass, and none on a pass (R18.9) ─────────
        for (const entry of result.checks) {
          if (entry.status === 'pass') {
            expect(entry.remedy, `${entry.id} passed and carries a remedy`).toBeNull();
            continue;
          }
          expect(entry.remedy, `${entry.id} did not pass and carries no remedy`).not.toBeNull();
          expect((entry.remedy ?? '').trim().length).toBeGreaterThan(0);
        }

        // ── At most one spawn (R18.2) ──────────────────────────────────────
        expect(calls.length).toBeLessThanOrEqual(1);
        expect(result.spawns).toBeLessThanOrEqual(1);
        // And when one happened it was the version probe on the configured budget,
        // so the bound is not being met by spawning something else instead.
        for (const call of calls) {
          expect(call.argv).toEqual([...DOCTOR_VERSION_ARGV]);
          expect(call.timeoutMs).toBe(7_000);
          expect(call.cwd).toBe(REPO);
        }

        // ── Exit code 0, for this repository state (R18.8) ─────────────────
        expect(result.exitCode).toBe(0);

        // ── Only the handoff is written (R18.10) ───────────────────────────
        expect([...fileSystem.written].sort()).toEqual(
          [result.handoff.paths.newest, result.handoff.paths.archive].sort(),
        );

        // ── The base URL is probed once, or not at all when it is null ─────
        expect(probe.calls.length).toBe(state.baseUrl === null ? 0 : 1);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reaches every generated state, so no clause above is vacuous', async () => {
    // A property whose generator never produced a passing check would satisfy the
    // remedy clause trivially, and a generator that never produced a *failing* one
    // would satisfy it by having nothing to check. Both are ruled out by counting.
    const seen = new Map<string, number>();
    await fc.assert(
      fc.asyncProperty(arbState, async (state) => {
        const { invoker } = invokerFrom(state);
        const result = await runDoctor({
          repoRoot: REPO,
          config: configFrom(state),
          invoker,
          fileSystem: fileSystemFrom(state),
          tree: treeFrom(state),
          probeUrl: probeFrom(state),
          at: AT,
        });
        for (const entry of result.checks) {
          const key = `${entry.id}:${entry.status}`;
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
      }),
      { numRuns: NUM_RUNS },
    );

    // Every check reached a pass and a non-pass somewhere in the run, except the
    // context-store check, which has no `fail` arm to reach: the filesystem can say
    // a store is there or is not, and a store that is there but unusable is not a
    // fact `.context/`'s presence can report (§21.2 row 6).
    for (const id of DOCTOR_CHECK_IDS) {
      const passes = seen.get(`${id}:pass`) ?? 0;
      const notConfigured = seen.get(`${id}:not-configured`) ?? 0;
      const fails = seen.get(`${id}:fail`) ?? 0;
      expect(passes, `${id} never passed`).toBeGreaterThan(0);
      expect(notConfigured + fails, `${id} never failed to pass`).toBeGreaterThan(0);
    }
    expect(seen.get('kane-binary:fail') ?? 0).toBeGreaterThan(0);
    expect(seen.get('fences:fail') ?? 0).toBeGreaterThan(0);
    expect(seen.get('corpus:fail') ?? 0).toBeGreaterThan(0);
    expect(seen.get('snapshot:fail') ?? 0).toBeGreaterThan(0);
  });

  it('exits 0 and answers all seven with no configuration, no snapshot, no corpus and no Kane', async () => {
    // The named case of the property statement, pinned outside the generator so it
    // is asserted on every run rather than only when the shrinker happens there.
    const fileSystem = fileSystemFrom({
      configFile: 'absent',
      corpus: 'absent',
      corpusRoot: 'corpus',
      baseUrl: null,
      snapshot: 'absent',
      contextStore: false,
      allow: [],
      kane: 'absent',
      reachable: false,
      probeThrows: false,
      router: DEFAULT_CONFIG.verdictRouter,
    });
    const result = await runDoctor({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      invoker: {
        async invokePlain(spec: PlainInvocationSpec): Promise<PlainInvocationResult> {
          return {
            spec,
            effectiveArgv: spec.argv,
            stdoutLines: [],
            exitCode: null,
            exitMeaning: 'kane-not-found',
            timedOut: false,
            durationMs: 0,
            stderrTail: [],
            resolvedBinary: null,
            diagnostics: [],
          };
        },
      },
      fileSystem,
      tree: inMemoryBaselineFileSystem({}),
      probeUrl: async (): Promise<DoctorProbeOutcome> => {
        throw new Error('nothing should be probed');
      },
      at: AT,
    });

    expect(result.exitCode).toBe(0);
    expect(result.checks).toHaveLength(DOCTOR_CHECK_IDS.length);
    expect(result.checks.every((entry) => entry.status !== 'pass')).toBe(true);
    expect(result.checks.every((entry) => (entry.remedy ?? '').length > 0)).toBe(true);
    expect(result.spawns).toBe(1);
    expect(fileSystem.written).toHaveLength(2);
  });
});
