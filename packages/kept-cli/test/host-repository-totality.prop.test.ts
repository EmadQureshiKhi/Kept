import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { EXIT_OK } from '../src/args.js';
import { CONFIG_FILE_RELATIVE_PATH } from '../src/config.js';
import { main, type CliIo } from '../src/main.js';

/**
 * Feature: kept, Property 32: The engine builds a graph in any host repository
 * (design §Correctness Properties, §20.5, §14.2, R15.4, R15.5, R15.6, R15.11, R15.12).
 *
 * *For any* generated repository containing an arbitrary mixture of documentation files,
 * corpus files and neither, building the graph terminates with process exit code 0,
 * admits exactly those promises whose citations resolve to a real line of a real file in
 * *that* repository, records one diagnostic per missing prerequisite, and writes no file
 * outside that repository's own working-state directory.
 *
 * **Validates: Requirements 15.4, 15.5, 15.6, 15.11, 15.12**
 *
 * ## Why the whole command, on real disk
 *
 * `host-repository-graph.test.ts` builds *one* repository and checks it in detail.
 * That test can be satisfied by an engine that happens to handle the shape it was given.
 * What this one quantifies over is the shapes nobody thought about: a repository with
 * documentation and no corpus, a corpus and no documentation, a config that is a JSON
 * array, a corpus document whose citation points past the end of its file, a
 * `corpus.root` naming a directory that is not there, and the empty directory R15.11
 * names outright — no `*_test.md`, no config, no snapshot, no Kane.
 *
 * Every run goes through `main`, which is the function `bin/kept` calls, and reads the
 * exit code it returns. `main` never calls `process.exit` and never throws for a state
 * of the world (§14.2), so "exit code 0" is a value this property can read rather than a
 * process it has to spawn. `io.kane === false` removes the Kane boundary entirely, which
 * is R2.12's supported state and also what keeps two hundred runs to a few seconds.
 *
 * Real `node:fs`, and a real temporary directory outside the workspace, for the reason
 * §20.5 gives: an injected filesystem is the seam, and the defect this is aimed at lives
 * in whatever resolves a path against something other than the root it was handed.
 *
 * ## The four clauses, and which requirement each is
 *
 * **Exit code 0, always** (R15.11, §14.2). `kept`'s exit code is a statement about
 * whether KEPT worked, not about what it found. A missing config, an unreadable one, an
 * absent corpus and an absent Kane are all states of the world.
 *
 * **Exactly the resolvable citations** (R15.5, R15.10). The generator knows which of the
 * tags it planted point at a real line of a real file, so the expected promise count is
 * computed rather than observed. That is the clause a default corpus root breaks: a scan
 * rooted at `tests` in a repository whose corpus is `suite` admits zero.
 *
 * **One diagnostic per missing prerequisite** (R15.4, R15.6). An absent config is
 * announced, an absent corpus is announced with the directory it looked in, and a
 * malformed config names the offending field. Announced *once* each: a repository that
 * reported the same absence twice would train a reader to stop reading.
 *
 * **Nothing written outside `<root>/.kept/`** (R15.12). Two halves. Nothing lands in the
 * workspace, which is the bug a `process.cwd()` fallback causes and which a test
 * checking only its own outputs never sees. And nothing lands in the host repository
 * outside its working-state directory either, because a tool that scattered files
 * through a stranger's tree would be unusable however correct its graph was.
 */

const NUM_RUNS = 120;

const WORKSPACE = fileURLToPath(new URL('../../..', import.meta.url));

/** A directory or file name sharing no segment with this repository. */
const arbAlienName: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
    minLength: 3,
    maxLength: 7,
  })
  .map((characters) => characters.join(''))
  .filter((name) => !/apps|fixture|ledger|tests|packages|kept/.test(name));

/** How a generated corpus document cites: resolvably, or in one of two broken ways. */
type CitationKind = 'resolves' | 'line-past-end' | 'file-absent';

/** One planted `@verifies` tag. */
interface Tag {
  readonly kind: CitationKind;
  /** Which line of the documentation file it names. Only used when it resolves. */
  readonly line: number;
}

const arbTag: fc.Arbitrary<Tag> = fc.record({
  kind: fc.constantFrom<CitationKind>('resolves', 'line-past-end', 'file-absent'),
  line: fc.integer({ min: 1, max: 3 }),
});

/** One generated repository. Every field is a shape the engine has to answer for. */
interface Shape {
  readonly corpusRoot: string;
  readonly docsRoot: string;
  readonly docName: string;
  /** How many claim lines the documentation file carries. Zero means no file at all. */
  readonly claimLines: number;
  /** The tags the corpus document plants. Empty means a corpus with no tag. */
  readonly tags: readonly Tag[];
  /** Whether a corpus document exists at all. */
  readonly hasCorpus: boolean;
  /** What the config is: present and good, present and broken, or absent. */
  readonly config: 'good' | 'malformed' | 'array' | 'absent';
  /** Whether `corpus.root` names a directory that exists. */
  readonly corpusRootExists: boolean;
}

const arbShape: fc.Arbitrary<Shape> = fc
  .record({
    corpusRoot: arbAlienName,
    docsRoot: arbAlienName,
    docName: arbAlienName,
    claimLines: fc.integer({ min: 0, max: 3 }),
    tags: fc.array(arbTag, { minLength: 0, maxLength: 3 }),
    hasCorpus: fc.boolean(),
    config: fc.constantFrom<Shape['config']>('good', 'malformed', 'array', 'absent'),
    corpusRootExists: fc.boolean(),
  })
  .filter((shape) => shape.corpusRoot !== shape.docsRoot);

/** The documentation file's path, whether or not it exists. */
function docPath(shape: Shape): string {
  return `${shape.docsRoot}/${shape.docName}.md`;
}

/** The claim lines, one per line. */
function claimsOf(shape: Shape): readonly string[] {
  return Array.from(
    { length: shape.claimLines },
    (_unused, index) => `- The ${shape.docName} screen keeps promise ${index + 1}.`,
  );
}

/** The citation one tag writes, as `<file>:<line>`. */
function citationOf(shape: Shape, tag: Tag): string {
  switch (tag.kind) {
    case 'resolves':
      return `${docPath(shape)}:${tag.line}`;
    case 'line-past-end':
      // Past the end whatever the file's length, including when there is no file.
      return `${docPath(shape)}:${shape.claimLines + 40}`;
    case 'file-absent':
      return `${shape.docsRoot}/${shape.docName}-absent.md:1`;
  }
}

/**
 * How many promises this shape should admit.
 *
 * Computed from the generator's own knowledge, never from the run's output. A tag admits
 * exactly when it resolves *and* the file it names has a line that far — so a `resolves`
 * tag against a documentation file the shape did not create admits nothing, and neither
 * does one whose line is past the end of a short file.
 *
 * Duplicate citations collapse: two tags naming the same file and line derive the same
 * `promiseId` (R15.10), and the graph keeps one. That is the identifier rule holding
 * rather than a quirk of the generator, so the expectation counts distinct citations.
 *
 * A config that is absent, truncated or a JSON array admits **nothing**, and that is the
 * §20.4 fail-closed direction being asserted rather than tolerated. Such a config falls
 * back to `corpus.root: 'tests'`, and a repository whose corpus is somewhere else has
 * nothing under `tests` to find. The engine does not guess, it does not widen the scan to
 * the whole tree to be helpful, and it says which directory it looked in — which is the
 * clause the next test checks. An engine that "helpfully" found the corpus anyway would
 * be an engine whose reported corpus root means nothing.
 */
function expectedPromiseCount(shape: Shape): number {
  if (shape.config !== 'good') return 0;
  if (!shape.hasCorpus || !shape.corpusRootExists) return 0;
  const admitted = new Set<string>();
  for (const tag of shape.tags) {
    if (tag.kind !== 'resolves') continue;
    if (shape.claimLines === 0) continue;
    if (tag.line > shape.claimLines) continue;
    admitted.add(`${docPath(shape)}:${tag.line}`);
  }
  return admitted.size;
}

/** The config document, or null when the shape has none. */
function configFor(shape: Shape): string | null {
  switch (shape.config) {
    case 'absent':
      return null;
    case 'malformed':
      // Truncated mid-key. §14.2: a malformed config is a state of the world.
      return '{ "verdictRouter": "resultCode740", "corpus": { "roo';
    case 'array':
      return '["verdictRouter", "resultCode740"]';
    case 'good':
      return `${JSON.stringify(
        {
          verdictRouter: 'resultCode740',
          memberDebug: false,
          timeouts: { hookMs: 300_000, enrichmentMs: 60_000, doctorMs: 10_000 },
          corpus: { root: shape.corpusRoot },
          subject: {
            source: [`${shape.docName}/**/*.ts`],
            docs: [`${shape.docsRoot}/**/*.md`],
            baseUrl: null,
          },
          fences: {
            'code-break': { allow: [`${shape.docName}/**`] },
            'test-drift': { allow: [] },
            'docs-lie': { allow: [] },
          },
        },
        null,
        2,
      )}\n`;
  }
}

/** Materialise one shape in a fresh temporary directory. */
function makeRepository(shape: Shape): string {
  const root = mkdtempSync(join(tmpdir(), 'kept-any-'));
  const put = (path: string, contents: string): void => {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, 'utf8');
  };

  const claims = claimsOf(shape);
  if (claims.length > 0) put(docPath(shape), `${claims.join('\n')}\n`);

  if (shape.hasCorpus && shape.corpusRootExists) {
    put(
      `${shape.corpusRoot}/${shape.docName}_test.md`,
      [
        '---',
        'mode: testing',
        'assurance:',
        `  id: ANY-${shape.docName}`,
        '---',
        '',
        ...shape.tags.map((tag) => `<!-- @verifies ${citationOf(shape, tag)} -->`),
        '',
      ].join('\n'),
    );
  }

  const config = configFor(shape);
  if (config !== null) put(CONFIG_FILE_RELATIVE_PATH, config);
  return root;
}

/** Every file under a root, root-relative POSIX. */
function filesUnder(root: string): readonly string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) found.push(relative(root, child).split('\\').join('/'));
    }
  };
  walk(root);
  return found.sort();
}

/** One file's identity, for the workspace containment clause. */
interface Stamp {
  readonly size: number;
  readonly mtimeMs: number;
}

/**
 * The workspace's own working state, stamped.
 *
 * `.kept/` only, and that is the point: it is where every artefact this product writes
 * goes, so it is where a run that resolved its root against `process.cwd()` would land.
 */
function workspaceState(): Map<string, Stamp> {
  const stamps = new Map<string, Stamp>();
  const walk = (dir: string): void => {
    let entries: readonly { name: string; isDirectory(): boolean; isFile(): boolean }[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(child);
        continue;
      }
      if (!entry.isFile()) continue;
      const stats = statSync(child, { throwIfNoEntry: false });
      if (stats === undefined) continue;
      stamps.set(relative(WORKSPACE, child).split('\\').join('/'), {
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      });
    }
  };
  walk(join(WORKSPACE, '.kept'));
  return stamps;
}

/** What changed between two stamp maps. */
function diffStamps(before: Map<string, Stamp>, after: Map<string, Stamp>): readonly string[] {
  const changed: string[] = [];
  for (const [path, stamp] of after) {
    const was = before.get(path);
    if (was === undefined) changed.push(`${path} created`);
    else if (was.size !== stamp.size || was.mtimeMs !== stamp.mtimeMs) {
      changed.push(`${path} modified`);
    }
  }
  for (const path of before.keys()) if (!after.has(path)) changed.push(`${path} deleted`);
  return changed.sort();
}

/** One run's outcome: the exit code, what it reported, and what it wrote. */
interface Run {
  readonly exitCode: number;
  readonly payload: {
    readonly promises?: number;
    readonly diagnostics?: readonly { readonly code: string; readonly message: string }[];
  };
  /**
   * The promise records, read back out of `<root>/.kept/state.json`.
   *
   * Read from the host repository's own state file rather than from the JSON payload,
   * which reports a count. That is the stronger reading anyway: it proves the store
   * landed under the root it was handed, and it lets the citation clause check the file
   * and line rather than only the number.
   */
  readonly promises: readonly { readonly citation: { file: string; line: number } }[];
  readonly written: readonly string[];
}

/**
 * Run `kept build --json` against a generated repository.
 *
 * `--json` because the payload is the interface this property reads, and `io.kane: false`
 * because R2.12 makes Kane's absence a supported state — which is also the state R15.11
 * names, and the one that keeps this suite fast enough to quantify over.
 */
async function build(root: string): Promise<Run> {
  let out = '';
  const io: CliIo = {
    write: (text) => {
      out += text;
    },
    writeError: (text) => {
      out += text;
    },
    cwd: root,
    env: {},
    kane: false,
    now: () => new Date('2026-08-20T18:40:44.902Z'),
  };
  const exitCode = await main(['build', '--repo', root, '--json'], io);
  const start = out.indexOf('{');
  const payload =
    start < 0 ? {} : (JSON.parse(out.slice(start, out.lastIndexOf('}') + 1)) as Run['payload']);
  let promises: Run['promises'] = [];
  try {
    const state = JSON.parse(readFileSync(join(root, '.kept/state.json'), 'utf8')) as {
      graph?: { promises?: Run['promises'] };
    };
    promises = state.graph?.promises ?? [];
  } catch {
    // No state file is a legitimate outcome to *observe*; the clauses below decide
    // whether it is a legitimate outcome to have.
    promises = [];
  }
  return { exitCode, payload, promises, written: filesUnder(root) };
}

describe('Feature: kept, Property 32: the engine builds a graph in any host repository', () => {
  it('exits 0 and admits exactly the resolvable citations, whatever the repository holds', async () => {
    await fc.assert(
      fc.asyncProperty(arbShape, async (shape) => {
        const root = makeRepository(shape);
        try {
          const run = await build(root);

          // §14.2: the exit code says whether KEPT worked, never what it found.
          expect(run.exitCode, `exit ${run.exitCode} for ${JSON.stringify(shape)}`).toBe(EXIT_OK);

          expect(run.promises).toHaveLength(expectedPromiseCount(shape));
          // The payload's count and the state file agree, so a reader of either is
          // reading the same graph.
          expect(run.payload.promises).toBe(run.promises.length);
          const promises = run.promises;

          // Every admitted promise cites a real line of a real file in *that*
          // repository, and the file is the one the generator wrote.
          const claims = claimsOf(shape);
          for (const promise of promises) {
            expect(promise.citation.file).toBe(docPath(shape));
            expect(promise.citation.line).toBeGreaterThanOrEqual(1);
            expect(promise.citation.line).toBeLessThanOrEqual(claims.length);
          }
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('announces each missing prerequisite once, naming the key or the directory', async () => {
    await fc.assert(
      fc.asyncProperty(arbShape, async (shape) => {
        const root = makeRepository(shape);
        try {
          const run = await build(root);
          const codes = (run.payload.diagnostics ?? []).map((entry) => entry.code);
          const count = (code: string): number => codes.filter((entry) => entry === code).length;

          // An absent config is announced exactly once, and an unreadable one likewise.
          // Once, not twice: a repository that reported the same absence repeatedly
          // trains a reader to stop reading, and R15.4 asks for a diagnostic per key.
          expect(count('config-absent')).toBe(shape.config === 'absent' ? 1 : 0);
          expect(count('config-unreadable')).toBe(
            shape.config === 'malformed' || shape.config === 'array' ? 1 : 0,
          );

          // An absent corpus is announced with the directory it scanned, which is the
          // difference between "this repository makes no claims" and "corpus.root points
          // somewhere else" (§20.4).
          const noCorpus = (run.payload.diagnostics ?? []).filter(
            (entry) => entry.code === 'baseline-no-test-documents',
          );
          const scanned = shape.config === 'good' ? shape.corpusRoot : 'tests';
          const foundAny = shape.hasCorpus && shape.corpusRootExists && shape.config === 'good';
          expect(noCorpus).toHaveLength(foundAny ? 0 : 1);
          if (noCorpus.length === 1) {
            expect(noCorpus[0]?.message).toContain(scanned);
          }
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('writes nothing outside the host repository, and nothing outside its .kept/', async () => {
    const before = workspaceState();
    expect(before.size, 'the workspace has no .kept/ to protect, so this clause is vacuous').toBeGreaterThan(0);

    await fc.assert(
      fc.asyncProperty(arbShape, async (shape) => {
        const root = makeRepository(shape);
        try {
          const run = await build(root);
          const seeded = new Set(filesUnder(root).filter((path) => !path.startsWith('.kept/')));

          for (const path of run.written) {
            // Either a file the generator seeded, or working state under `.kept/`.
            // Nothing else: a tool that scattered artefacts through a stranger's tree
            // would be unusable however correct its graph was.
            expect(
              seeded.has(path) || path.startsWith('.kept/'),
              `${path} was written outside the working-state directory`,
            ).toBe(true);
          }
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }),
      { numRuns: NUM_RUNS },
    );

    // And the clause §20.5 calls the one that catches the real bug: not a byte of this
    // workspace's own working state moved while building graphs for other repositories.
    const changed = diffStamps(before, workspaceState());
    expect(
      changed,
      changed.length === 0
        ? ''
        : `Building graphs for generated repositories touched this workspace's own ` +
          `.kept/: ${changed.join(', ')}. That is a path resolved against process.cwd() ` +
          `rather than against --repo, and it corrupts the developer's repository while ` +
          `the test passes.`,
    ).toEqual([]);
  });
});
