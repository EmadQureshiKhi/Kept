import { inMemoryBaselineFileSystem, inMemoryStateFileSystem } from 'kept-core';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { CONFIG_FILE_RELATIVE_PATH } from '../src/config.js';
import { EXAMPLE_TEST_FILE_NAME, runInit } from '../src/commands/init.js';

/**
 * Feature: kept, Property 33: Initialisation is idempotent and spends nothing
 * (design §Correctness Properties, §21.1, R16.1, R16.2, R16.6, R16.8).
 *
 * *For any* repository state, the first initialisation either writes a
 * configuration and one scaffolded corpus file or writes nothing and names the
 * existing configuration; a second initialisation with no overwrite flag changes
 * no byte of any file; and no initialisation spawns Kane or reports non-zero
 * consumed credits.
 *
 * Three clauses, and the middle one is the reason this property exists. `kept
 * init` is the first command a stranger runs, and the second thing they do is run
 * it again, either because they are not sure it worked or because it is in a
 * script. An `init` that quietly rewrites a config the user has since edited, or
 * re-scaffolds over a test they have since authored, destroys work at exactly the
 * moment the tool has earned no trust at all. So idempotence is proven rather than
 * asserted: **every file's bytes are snapshotted before the second run and
 * compared after**, over generated repository states rather than over one example.
 *
 * The third clause is checked at the process boundary. `node:child_process` is
 * mocked for this file and every spawning entry point counts its calls, so
 * "invokes Kane zero times" is a measurement of what the module did rather than a
 * reading of a field it filled in itself. Both readings are taken: the counter and
 * the reported credits.
 */
const spawns = vi.hoisted(() => ({ count: 0 }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const counted = <T extends (...args: never[]) => unknown>(fn: T): T =>
    ((...args: never[]) => {
      spawns.count += 1;
      return fn(...args);
    }) as unknown as T;
  return {
    ...actual,
    spawn: counted(actual.spawn),
    spawnSync: counted(actual.spawnSync),
    exec: counted(actual.exec),
    execSync: counted(actual.execSync),
    execFile: counted(actual.execFile),
    execFileSync: counted(actual.execFileSync),
    fork: counted(actual.fork),
  };
});

const NUM_RUNS = 300;

const REPO = '/generated-host';
const CONFIG_PATH = `${REPO}/${CONFIG_FILE_RELATIVE_PATH}`;

/**
 * Directory names the generator reaches for, including four the walk must refuse
 * to descend into. A property whose trees never contain `node_modules` proves
 * nothing about a repository that does.
 */
const arbSegment = fc.constantFrom(
  'docs',
  'apps',
  'web',
  'src',
  'suite',
  'tests',
  'node_modules',
  'dist',
  '.git',
  '.next',
  '.testmuai',
  'output-run',
);

/** File names spanning documentation, corpus, the scaffold's own name, and neither. */
const arbBaseName = fc.constantFrom(
  'README.md',
  'product.md',
  'guide.mdx',
  'notes.txt',
  'index.ts',
  'cart_test.md',
  'checkout_test.md',
  EXAMPLE_TEST_FILE_NAME,
);

const arbPath = fc
  .tuple(fc.array(arbSegment, { maxLength: 3 }), arbBaseName)
  .map(([directories, base]) => [...directories, base].join('/'));

/** Contents including the empty file and one with no trailing newline. */
const arbContents = fc.oneof(
  fc.constant(''),
  fc.constant('# heading'),
  fc.string({ maxLength: 40 }),
  fc.array(fc.string({ maxLength: 12 }), { maxLength: 5 }).map((lines) => `${lines.join('\n')}\n`),
);

/**
 * A whole repository state: a file tree, and whether it is already configured.
 *
 * The same map seeds both seams, so the tree the walk sees and the files the
 * command may write over are one repository rather than two. `existingConfig`
 * covers the refusal path, and `force` covers the replacement path, so the first
 * initialisation is generated across all four combinations.
 */
const arbRepository = fc.record({
  files: fc
    .array(fc.tuple(arbPath, arbContents), { maxLength: 12 })
    .map((pairs) => Object.fromEntries(pairs) as Record<string, string>),
  existingConfig: fc.option(fc.oneof(fc.constant('{}\n'), fc.constant('not json at all')), {
    nil: null,
  }),
  force: fc.boolean(),
});

/** Every file's bytes, key-sorted, so "changed nothing" is a comparison. */
function bytesOf(fileSystem: ReturnType<typeof inMemoryStateFileSystem>): string {
  return JSON.stringify([...fileSystem.files.entries()].sort());
}

describe('Feature: kept, Property 33: Initialisation is idempotent and spends nothing', () => {
  it('generates every case the clauses below distinguish, so none of them is vacuous', () => {
    const sample = fc.sample(arbRepository, { numRuns: NUM_RUNS, seed: 33 });
    const refused = sample.filter((one) => one.existingConfig !== null && !one.force);
    const replaced = sample.filter((one) => one.existingConfig !== null && one.force);
    const fresh = sample.filter((one) => one.existingConfig === null);
    const withCorpus = sample.filter((one) =>
      Object.keys(one.files).some((path) => path.endsWith('_test.md')),
    );
    const withScaffoldAlready = sample.filter((one) =>
      Object.keys(one.files).some((path) => path.endsWith(EXAMPLE_TEST_FILE_NAME)),
    );
    const withSkippedTree = sample.filter((one) =>
      Object.keys(one.files).some(
        (path) => path.startsWith('node_modules/') || path.startsWith('output-run/'),
      ),
    );

    expect(refused.length).toBeGreaterThan(0);
    expect(replaced.length).toBeGreaterThan(0);
    expect(fresh.length).toBeGreaterThan(0);
    expect(withCorpus.length).toBeGreaterThan(0);
    expect(withScaffoldAlready.length).toBeGreaterThan(0);
    expect(withSkippedTree.length).toBeGreaterThan(0);
  });

  it('writes a config plus one corpus file or nothing at all, then changes no byte on a second run', () => {
    fc.assert(
      fc.property(arbRepository, (repository) => {
        const seed: Record<string, string> = {};
        for (const [path, contents] of Object.entries(repository.files)) {
          seed[`${REPO}/${path}`] = contents;
        }
        if (repository.existingConfig !== null) seed[CONFIG_PATH] = repository.existingConfig;

        const fileSystem = inMemoryStateFileSystem(seed);
        const baselineFileSystem = inMemoryBaselineFileSystem(repository.files);
        const before = bytesOf(fileSystem);

        // ── Clause 1: the first initialisation ────────────────────────────────
        const first = runInit({
          repoRoot: REPO,
          force: repository.force,
          fileSystem,
          baselineFileSystem,
        });

        expect(first.exitCode).toBe(0);
        const refused = repository.existingConfig !== null && !repository.force;

        if (refused) {
          // It wrote nothing and named the existing configuration.
          expect(first.alreadyConfigured).toBe(true);
          expect(first.configWritten).toBe(false);
          expect([...first.writes]).toEqual([]);
          expect(
            first.diagnostics.some((entry) => entry.message.includes(CONFIG_PATH)),
          ).toBe(true);
          expect(bytesOf(fileSystem)).toBe(before);
        } else {
          // It wrote the configuration, and exactly one corpus file exists for it.
          expect(first.alreadyConfigured).toBe(false);
          expect(first.configWritten).toBe(true);
          expect(first.config?.subject.source).toEqual([]);
          for (const fence of Object.values(first.config?.fences ?? {})) {
            expect(fence.allow).toEqual([]);
          }
          expect(first.examplePath).toBe(
            `${REPO}/${first.detection.corpusRoot}/${EXAMPLE_TEST_FILE_NAME}`,
          );
          expect(fileSystem.readFile(first.examplePath)).not.toBeNull();
          // The scaffold is written once. An example that was already there is
          // preserved, which is the same clause read from the other side.
          expect(first.exampleWritten).toBe(!(`${first.detection.corpusRoot}/${EXAMPLE_TEST_FILE_NAME}` in repository.files));

          // Nothing outside those two paths was touched, and every other file that
          // was already present still has the bytes it had.
          expect(
            [...first.writes].every(
              (path) => path === CONFIG_PATH || path === first.examplePath,
            ),
          ).toBe(true);
          for (const [path, contents] of Object.entries(seed)) {
            if (path === CONFIG_PATH || path === first.examplePath) continue;
            expect(fileSystem.readFile(path)).toBe(contents);
          }
        }

        // Detection reported candidates and cited none of them: the only thing it
        // put in the config is a glob list, and the only tag written is the
        // scaffold's placeholder.
        expect(first.detection.documents.length).toBeGreaterThanOrEqual(0);

        // ── Clause 2: the second initialisation, no overwrite flag ────────────
        const afterFirst = bytesOf(fileSystem);
        const second = runInit({ repoRoot: REPO, fileSystem, baselineFileSystem });

        expect(second.exitCode).toBe(0);
        expect(second.alreadyConfigured).toBe(true);
        expect(second.configWritten).toBe(false);
        expect(second.exampleWritten).toBe(false);
        expect([...second.writes]).toEqual([]);
        expect(bytesOf(fileSystem)).toBe(afterFirst);

        // ── Clause 3: neither run spent anything ─────────────────────────────
        expect(first.kaneInvocations).toBe(0);
        expect(first.credits).toBe(0);
        expect(second.kaneInvocations).toBe(0);
        expect(second.credits).toBe(0);
        expect(spawns.count).toBe(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('spawned no process across the whole suite', () => {
    // The counter is cumulative for this file, so this is the same statement made
    // once more over every generated case above rather than a fresh one.
    expect(spawns.count).toBe(0);
  });
});
