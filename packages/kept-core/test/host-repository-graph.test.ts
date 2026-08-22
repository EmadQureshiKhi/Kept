import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildBaselineOnlyGraph,
  collectTestCoverage,
  computeBlastRadius,
  matchesAnyGlob,
  nodeBaselineFileSystem,
  nodeCitationSource,
  createDiagnosticSink,
  fenceFor,
  writeHandoff,
} from '@kept/core';
import { describe, expect, it } from 'vitest';

/**
 * The host-repository integration test (design §20.5, R15.10, R15.11, R15.12,
 * Property 32).
 *
 * The portability claim cannot be tested from inside this repository, and that is not a
 * stylistic preference. Every path this repository uses **resolves whether or not it was
 * read from configuration**: a fence table hard-coding `apps/fixture/lib/**` and a fence
 * table reading `subject.source` produce identical results here, because here the two
 * agree. So the test builds a repository somewhere else.
 *
 * ```
 * <tmp>/
 *   docs/product.md        three claims, one per line
 *   suite/checkout_test.md one @verifies docs/product.md:2, covers src/**
 *   src/checkout.ts
 *   .kept/config.json      corpus.root "suite", subject.docs ["docs/**​/*.md"],
 *                          subject.source ["src/**​/*.ts"], baseUrl null
 * ```
 *
 * Nothing in that tree shares a path segment with this one: not `apps`, not `fixture`,
 * not `tests`, not `packages`. The corpus is `suite`. The documentation is `docs`. If
 * anything in the engine still named this repository, the graph would come back empty
 * and the fence would come back pointing at a tree that does not exist.
 *
 * ## Real disk, and outside the workspace
 *
 * `node:os` `tmpdir()`, `mkdtempSync`, and `rmSync` in a `finally`. Not an in-memory
 * filesystem, deliberately: an injected filesystem is the *seam*, and the bug §20.5 is
 * aimed at lives in the code that resolves an absolute path against something. Give the
 * production `node:fs` implementations a root and the question becomes whether they
 * honour it.
 *
 * ## The clause that catches the real bug
 *
 * **Zero files written outside the temporary directory.** A path resolved against
 * `process.cwd()` instead of against `--repo` writes into the *developer's* repository
 * while the test passes, and a test that only checks its own outputs never notices —
 * it would find its promise, assert its fence, and go green while having just rewritten
 * `.kept/state.json` in the workspace it was launched from.
 *
 * So this suite fingerprints the workspace before and after: every file under `.kept/`,
 * the repository root's own listing, and the corpus and fixture trees, by path, size and
 * modification time. Then it does something that genuinely writes — `writeHandoff`
 * against the temporary root, which lands two files — and requires the fingerprint to be
 * byte-identical afterwards and both written files to be inside `<tmp>`.
 *
 * ## On "the other two claims"
 *
 * §20.5 asks for "two unadmitted claims reported as candidates rather than as
 * promises". A claim nobody cites produces no candidate at all, so the corpus document
 * here carries three `@verifies` tags: the one that resolves, one citing a line past the
 * end of `product.md`, and one citing a file that does not exist. Those two are
 * candidates the gate refuses with a reason, which is the distinction the requirement is
 * about — a refusal that is *recorded* rather than a claim that silently vanishes. The
 * two uncited claim lines are asserted separately to have produced nothing, because
 * "nothing cited it" and "something cited it and was refused" are different facts and
 * §20.5 wants both.
 */

const WORKSPACE = fileURLToPath(new URL('../../..', import.meta.url));

/** The three claims, one per line. Line 2 is the one the corpus cites. */
const CLAIMS: readonly string[] = Object.freeze([
  '- The basket screen shows a running total that updates when a quantity changes.',
  '- The basket screen applies a ten percent discount above the free-delivery threshold.',
  '- The basket screen keeps a placed order after a reload.',
]);

/** The cited line, one-based, and the only one that yields a promise. */
const CITED_LINE = 2;

const CONFIG_DOCUMENT = {
  verdictRouter: 'resultCode740',
  memberDebug: false,
  timeouts: { hookMs: 300_000, enrichmentMs: 60_000, doctorMs: 10_000 },
  corpus: { root: 'suite' },
  subject: {
    source: ['src/**/*.ts'],
    docs: ['docs/**/*.md'],
    baseUrl: null,
  },
  fences: {
    'code-break': { allow: ['src/**'] },
    'test-drift': { allow: [] },
    'docs-lie': { allow: [] },
  },
} as const;

/** The corpus document: one resolvable citation and two the gate must refuse. */
const CHECKOUT_TEST = [
  '---',
  'mode: testing',
  'tags: [basket]',
  'assurance:',
  '  id: HOST-1',
  '---',
  '',
  '# The basket keeps its promises',
  '',
  `<!-- @verifies docs/product.md:${CITED_LINE} the discount claim -->`,
  '<!-- @verifies docs/product.md:99 a line this document does not have -->',
  '<!-- @verifies docs/absent.md:1 a file this repository does not have -->',
  '<!-- @covers src/** -->',
  '',
  '## Step 1',
  '',
  'Open the basket and read the total.',
  '',
].join('\n');

/** The tree of §20.5, as repository-relative paths and contents. */
const TREE: Readonly<Record<string, string>> = Object.freeze({
  'docs/product.md': `${CLAIMS.join('\n')}\n`,
  'suite/checkout_test.md': CHECKOUT_TEST,
  'src/checkout.ts': 'export function total(): number {\n  return 0;\n}\n',
  '.kept/config.json': `${JSON.stringify(CONFIG_DOCUMENT, null, 2)}\n`,
});

/** One file's identity for fingerprinting: size and modification time. */
interface Stamp {
  readonly size: number;
  readonly mtimeMs: number;
}

/**
 * Every file under `root`, to `maxDepth`, stamped.
 *
 * Depth-capped and skip-listed, because fingerprinting the whole workspace would walk
 * `node_modules` and `.next` and take longer than the test. What it must cover is
 * everywhere a mis-rooted write would plausibly land: `.kept/`, the repository root
 * itself, the corpus and the fixture.
 */
function fingerprint(root: string, maxDepth: number, base: string = WORKSPACE): Map<string, Stamp> {
  const stamps = new Map<string, Stamp>();
  const skip = new Set(['node_modules', '.git', '.next', 'dist', 'coverage', '.turbo']);
  const walk = (dir: string, depth: number): void => {
    let entries: readonly { name: string; isDirectory(): boolean; isFile(): boolean }[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name) || depth >= maxDepth) continue;
        walk(child, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const stats = statSync(child, { throwIfNoEntry: false });
      if (stats === undefined) continue;
      stamps.set(relative(base, child).split('\\').join('/'), {
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      });
    }
  };
  walk(root, 0);
  return stamps;
}

/**
 * What changed between two fingerprints, in words.
 *
 * Used for the workspace, where the answer must be empty, *and* for the temporary
 * repository, where it must not be. Running the same comparison over both is what keeps
 * the containment clause from being satisfied by a detector that never detects anything.
 */
function diffStamps(before: Map<string, Stamp>, after: Map<string, Stamp>): readonly string[] {
  const changed: string[] = [];
  for (const [path, stamp] of after) {
    const was = before.get(path);
    if (was === undefined) {
      changed.push(`${path} was created`);
      continue;
    }
    if (was.size !== stamp.size || was.mtimeMs !== stamp.mtimeMs) {
      changed.push(`${path} was modified`);
    }
  }
  for (const path of before.keys()) {
    if (!after.has(path)) changed.push(`${path} was deleted`);
  }
  return changed.sort();
}

/**
 * The workspace surfaces a mis-rooted write would land in.
 *
 * `.kept/` first and deepest, because that is where every artefact this product writes
 * goes: `state.json`, `handoff.json`, `plan.json`, `handoff/`, `review-cards/`.
 */
function workspaceFingerprint(): Map<string, Stamp> {
  const merged = new Map<string, Stamp>();
  for (const [directory, depth] of [
    ['.kept', 6],
    ['.', 0],
    ['tests', 2],
    ['apps/fixture', 2],
    ['docs', 1],
    ['src', 2],
    ['suite', 2],
  ] as const) {
    for (const [path, stamp] of fingerprint(resolve(WORKSPACE, directory), depth)) {
      merged.set(path, stamp);
    }
  }
  return merged;
}

/** Write the §20.5 tree into a fresh temporary directory outside the workspace. */
function makeHostRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'kept-host-'));
  for (const [path, contents] of Object.entries(TREE)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, 'utf8');
  }
  return root;
}

/** Every file under a temporary root, root-relative POSIX. */
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

/** The config as the host repository committed it, read back from its own disk. */
function readHostConfig(root: string): typeof CONFIG_DOCUMENT {
  return JSON.parse(readFileSync(join(root, '.kept/config.json'), 'utf8')) as typeof CONFIG_DOCUMENT;
}

describe('the engine builds a graph in a repository that shares no path with this one (§20.5)', () => {
  it('admits one promise, refuses two candidates, fences into src/** and writes nothing here', async () => {
    // The fingerprint is taken *before* the temporary tree exists, so nothing in it
    // can be confused with a write the run performed.
    const before = workspaceFingerprint();
    expect(before.size).toBeGreaterThan(0);
    // The containment clause is only as good as what the fingerprint covers, so the
    // three files a mis-rooted write would actually clobber are named. `.kept/state.json`
    // is the single-writer verdict store; `.kept/handoff.json` is the loop's contract;
    // `.kept/config.json` is the one committed file under `.kept/`. If a future change
    // moved them, this assertion fails rather than the guard quietly going blind.
    for (const path of ['.kept/state.json', '.kept/handoff.json', '.kept/config.json']) {
      expect(
        before.has(path),
        `${path} is not in the fingerprint, so a write that landed on it would go unnoticed`,
      ).toBe(true);
    }

    const root = makeHostRepository();
    try {
      expect(root.startsWith(WORKSPACE)).toBe(false);

      // Taken before anything runs, so the self-check below compares like with like.
      const tmpBefore = fingerprint(root, 6, root);

      const config = readHostConfig(root);
      // The config on that disk names none of this repository's paths. Asserted rather
      // than assumed, because every clause below is only meaningful if it holds.
      const spelled = JSON.stringify(config);
      for (const segment of ['apps', 'fixture', 'ledger', 'tests', 'packages', '3100']) {
        expect(spelled, `the host config names '${segment}'`).not.toContain(segment);
      }
      expect(config.subject.baseUrl).toBeNull();

      // ── The graph, built the way `kept build` builds it ──────────────────────
      //
      // The same `buildBaselineOnlyGraph`, the same production `node:fs` seams, and one
      // `CitationSource` shared between the scan and the gate so the claim text and the
      // admitted citation text came from the same read (§5.2).
      const sink = createDiagnosticSink();
      const citations = nodeCitationSource(root);
      const { result, batch } = await buildBaselineOnlyGraph({
        repoRoot: root,
        corpusRoot: config.corpus.root,
        fs: nodeBaselineFileSystem(root),
        citations,
        diagnostics: sink,
      });

      // The scan looked under `suite`, which is the only place this repository's corpus
      // is. A default of `tests` would have found nothing at all.
      expect(result.files).toEqual(['suite/checkout_test.md']);
      expect(result.tagCount).toBe(3);

      // ── One admitted promise, citing docs/product.md:2 verbatim ──────────────
      expect(batch.admitted).toHaveLength(1);
      const promise = batch.admitted[0];
      expect(promise?.citation.file).toBe('docs/product.md');
      expect(promise?.citation.line).toBe(CITED_LINE);
      expect(promise?.citation.text).toBe(CLAIMS[CITED_LINE - 1]);
      // Read off that repository's own file, not off the tag's trailing words.
      expect(promise?.citation.text).toContain('ten percent discount');
      expect(promise?.designedTest?.path).toBe('suite/checkout_test.md');
      expect(promise?.designedTest?.testId).toBe('HOST-1');
      expect(batch.graph.promises).toHaveLength(1);

      // ── The other two are candidates the gate refused, with reasons ──────────
      expect(batch.rejected).toHaveLength(2);
      // Each refusal names the file it could not resolve and says which of §3.3's two
      // reasons it was, which is what "reported as a candidate" means: recorded with a
      // cause, rather than dropped.
      const refusals = batch.rejected
        .map((rejection) =>
          rejection.reason === 'no-citation' ? 'no-citation' : `${rejection.reason} ${rejection.file}`,
        )
        .sort();
      expect(refusals).toEqual(['file-missing docs/absent.md', 'line-out-of-range docs/product.md']);
      const outOfRange = batch.rejected.find((rejection) => rejection.reason === 'line-out-of-range');
      expect(outOfRange?.reason === 'line-out-of-range' ? outOfRange.requestedLine : null).toBe(99);
      expect(outOfRange?.reason === 'line-out-of-range' ? outOfRange.lineCount : null).toBe(
        CLAIMS.length,
      );
      for (const rejection of batch.rejected) {
        expect(rejection.diagnostic.message.length).toBeGreaterThan(0);
      }
      // Candidates, and not promises: three tags in, one record out.
      expect(batch.admissions).toHaveLength(3);
      expect(batch.admissions.filter((admission) => admission.ok)).toHaveLength(1);
      expect(batch.graph.promises.some((record) => record.citation.line === 99)).toBe(false);
      expect(
        batch.graph.promises.some((record) => record.citation.file === 'docs/absent.md'),
      ).toBe(false);
      // And the two claim lines nothing cited produced nothing at all, which is a
      // different fact from a recorded refusal.
      for (const line of [1, 3]) {
        expect(
          batch.graph.promises.some((record) => record.citation.line === line),
          `line ${line} of docs/product.md was never cited and must yield no promise`,
        ).toBe(false);
      }

      // ── The blast radius for src/checkout.ts names the one member ────────────
      const covers = collectTestCoverage({
        source: nodeBaselineFileSystem(root),
        paths: result.files,
        sink,
      });
      expect(covers).toEqual([{ path: 'suite/checkout_test.md', covers: ['src/**'] }]);

      const radius = computeBlastRadius({
        changed: [join(root, 'src/checkout.ts')],
        graph: batch.graph,
        // Kane's plan, with the one member and its identifier. The radius derives an
        // identifier from here and nowhere else (R4.3, R4.4).
        plan: {
          valid: true,
          capturedAt: '2026-08-20T18:40:44.902Z',
          members: [{ path: 'suite/checkout_test.md', testId: 'HOST-1', tags: [], failure: null }],
        },
        covers,
        repoRoot: root,
        sink,
      });

      expect(radius.coveringTests).toEqual(['suite/checkout_test.md']);
      expect(radius.testIds).toEqual(['HOST-1']);
      expect(radius.promiseIds).toEqual([promise?.id]);
      expect(radius.unmatchedPaths).toEqual([]);
      expect(radius.skippedNoTestId).toEqual([]);

      // ── The code-break fence resolves to src/**, with suite and docs forbidden ─
      //
      // Composed the way the CLI composes it: the branch's allow set from the config,
      // and the derived forbidden set. Spelled out here rather than importing
      // `handoffFenceSurfaces` because that helper lives in `kept-cli` and this suite
      // is in `kept-core` — the dependency runs one way, which is the whole reason the
      // fence globs are parameters in the first place.
      const surfaces = {
        allow: config.fences['code-break'].allow,
        forbid: [config.corpus.root, `${config.corpus.root}/**`, ...config.subject.docs, 'packages/**'],
      };
      const fence = fenceFor('code-break', surfaces);
      expect(fence.allowedPaths).toEqual(['src/**']);
      expect(fence.forbiddenPaths).toContain('suite');
      expect(fence.forbiddenPaths).toContain('docs/**/*.md');
      expect(fence.autonomy).toBe('apply');
      // And the fence actually behaves: the source file is writable, the claim and the
      // test are not. Checked with the repository's own matcher, the way an agent would.
      expect(matchesAnyGlob(fence.allowedPaths, 'src/checkout.ts')).toBe(true);
      expect(matchesAnyGlob(fence.allowedPaths, 'docs/product.md')).toBe(false);
      expect(matchesAnyGlob(fence.allowedPaths, 'suite/checkout_test.md')).toBe(false);
      expect(matchesAnyGlob(fence.forbiddenPaths, 'docs/product.md')).toBe(true);
      expect(matchesAnyGlob(fence.forbiddenPaths, 'suite/checkout_test.md')).toBe(true);

      // ── Now write something, and prove it landed in <tmp> ────────────────────
      //
      // The graph build is read-only, so on its own it cannot fail the containment
      // clause. `writeHandoff` is the command surface that actually puts bytes on disk,
      // and it takes a root — which is exactly the parameter a `process.cwd()` fallback
      // would ignore.
      const written = writeHandoff({
        repoRoot: root,
        fences: surfaces,
        runId: 'host_run_1',
        at: '2026-08-20T18:40:44.902Z',
        trigger: { hook: null, event: null, paths: [] },
        command: { family: null, argv: [], invoked: false },
        diagnostics: [],
      });
      for (const path of [written.paths.newest, written.paths.archive]) {
        expect(path.startsWith(root), `${path} was written outside the host repository`).toBe(
          true,
        );
      }
      const landed = filesUnder(root);
      expect(landed).toContain('.kept/handoff.json');
      // Nothing appeared that the tree did not put there and the handoff did not write.
      for (const path of landed) {
        expect(
          path in TREE || path.startsWith('.kept/handoff'),
          `${path} is neither part of the generated tree nor a handoff`,
        ).toBe(true);
      }

      // ── Zero files written outside <tmp>. The clause §20.5 exists for. ───────
      //
      // Run the *same* comparison over the temporary tree first, where the answer must
      // be non-empty: a containment check that reports nothing because it can detect
      // nothing would pass this suite while the bug it exists for went straight through.
      const tmpAfter = fingerprint(root, 6, root);
      expect(diffStamps(tmpBefore, tmpAfter)).toContain('.kept/handoff.json was created');

      const after = workspaceFingerprint();
      const changed = diffStamps(before, after);
      expect(
        changed,
        changed.length === 0
          ? ''
          : `The run touched ${changed.length} file(s) inside this workspace while ` +
            `building a graph for ${root}. That is the defect §20.5 exists to catch: a ` +
            `path resolved against process.cwd() rather than against the repository root ` +
            `writes into the developer's own repository while the test goes green. ` +
            `Touched:\n${changed.join('\n')}`,
      ).toEqual([]);
    } finally {
      // Real disk, so it is really removed — on the assertion path and on the throw.
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports one diagnostic per missing prerequisite in an empty host repository (R15.11)', async () => {
    const before = workspaceFingerprint();
    const root = mkdtempSync(join(tmpdir(), 'kept-empty-'));
    try {
      // No config, no corpus, no snapshot, no Kane. Every one of those is a supported
      // state, and the totality discipline of §5.2 says the scan still completes.
      const sink = createDiagnosticSink();
      const { result, batch } = await buildBaselineOnlyGraph({
        repoRoot: root,
        fs: nodeBaselineFileSystem(root),
        citations: nodeCitationSource(root),
        diagnostics: sink,
      });

      expect(result.ok).toBe(true);
      expect(result.files).toEqual([]);
      expect(batch.admitted).toEqual([]);
      // And it says where it looked, which is the difference between "your repository
      // makes no claims" and "the corpus root points somewhere else" (§20.4).
      const absent = sink.entries.filter((entry) => entry.code === 'baseline-no-test-documents');
      expect(absent).toHaveLength(1);
      expect(absent[0]?.message).toContain('the repository root');

      // Still nothing written anywhere, in this repository or in that one.
      expect(filesUnder(root)).toEqual([]);
      expect(diffStamps(before, workspaceFingerprint())).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
