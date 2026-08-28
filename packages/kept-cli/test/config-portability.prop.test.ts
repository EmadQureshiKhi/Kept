import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildBaselineOnlyGraph,
  createDiagnosticSink,
  inMemoryBaselineFileSystem,
  inMemoryStateFileSystem,
  matchesAnyGlob,
  newestTestDocument,
  inMemoryPlanFileSystem,
} from 'kept-core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  CONFIG_FILE_RELATIVE_PATH,
  PACKAGE_ROOT_GLOB,
  REPAIR_BRANCH_NAMES,
  derivedForbidden,
  handoffFenceSurfaces,
  loadConfig,
} from '../src/config.js';
import { filterChangedDocs } from '../src/commands/reconcile.js';

/**
 * Feature: kept, Property 30: Configuration is the only source of repository-specific
 * values (design §Correctness Properties, §20.1, §20.2, §20.4, R15.1, R15.2, R15.3,
 * R15.9).
 *
 * *For any* generated configuration naming a corpus root, subject globs, a base URL and
 * fence sets that share no path segment with this repository, the built graph reads
 * every one of those values from the configuration and none from a default that names
 * this repository; and *for any* executable source file under `packages/kept-core/src`
 * or `packages/kept-cli/src`, that file contains no fixture path literal, no fixture
 * port literal and no corpus root literal.
 *
 * **Validates: Requirements 15.1, 15.2, 15.3, 15.9**
 *
 * ## Why this is a property and not four unit tests
 *
 * `config-portability.test.ts` already asserts that one host configuration resolves.
 * One configuration is exactly what a literal survives: `corpus.root: 'suite'` reads
 * back as `'suite'` whether the provider scans `suite` or scans everything and happens
 * to find the same file. What a generator adds is *disagreement*. Every run here draws
 * a corpus root, a documentation tree and a source tree that share no path segment with
 * this repository or with each other, seeds a `*_test.md` under the generated root and
 * a claim under the generated docs tree, and then requires the promise to come back
 * cited to the generated path with the generated line's verbatim text. A default that
 * named `tests` would find nothing on almost every draw; a scan that ignored the
 * configured root would find the decoy this generator plants outside it.
 *
 * The decoy is the clause worth stating twice. Each run seeds a second `*_test.md`
 * **outside** the configured corpus root, carrying a well-formed `@verifies` tag that
 * would resolve. If the scan root were ignored, that document would contribute a
 * promise, and the promise count would be two instead of one. So this property
 * distinguishes "read the config" from "found the right answer anyway", which is the
 * only distinction that matters for portability.
 *
 * ## The second clause is the scan, quantified
 *
 * `no-repository-literals.test.ts` is the guard §20.2 asks for and it enumerates the
 * two source trees exhaustively. The clause here is *for any* file, drawn from the same
 * trees, and it is deliberately a duplicate: R15.2 is a claim about the packages and
 * R15.3 is a claim about the repository containing a scan, and Property 30 validates
 * both. Reading the files here rather than importing the scan's internals keeps the two
 * independent, so a bug in the scan's comment stripper cannot make both clauses green.
 *
 * ## What "shares no path segment" is checked against
 *
 * Every segment this repository actually uses, read off its own committed
 * configuration and its own tree: `apps`, `fixture`, `ledger`, `tests`, `packages`,
 * `kept-core`, `kept-cli`. The one exception is {@link PACKAGE_ROOT_GLOB}, which §20.1
 * puts in the derived forbidden set of every branch on purpose and is a fact about the
 * engine rather than about this repository. It is excluded by name and nowhere else, so
 * the exclusion cannot quietly grow.
 */

const NUM_RUNS = 200;

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const HOST_ROOT = '/host';
const CONFIG_PATH = `${HOST_ROOT}/${CONFIG_FILE_RELATIVE_PATH}`;

/** Path segments that would betray a value having come from this repository. */
const THIS_REPOSITORY_SEGMENTS: readonly string[] = Object.freeze([
  'apps',
  'fixture',
  'ledger',
  'tests',
  'packages',
  'kept-core',
  'kept-cli',
]);

/** A directory name that is not one of this repository's, and needs no normalising. */
const arbAlienSegment: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')), {
    minLength: 3,
    maxLength: 9,
  })
  .map((characters) => characters.join(''))
  .filter(
    (segment) =>
      /^[a-z0-9]/.test(segment) &&
      /[a-z0-9]$/.test(segment) &&
      !THIS_REPOSITORY_SEGMENTS.some((known) => segment.includes(known)) &&
      // The digits too, for the same reason the port generator excludes them: a
      // directory called `a3100b` would put the substring into every glob built from
      // it, and the clause below reads that as a leak. Segments carry digits, so this
      // is reachable rather than theoretical.
      !segment.includes(FIXTURE_PORT_DIGITS),
  );

/**
 * The fixture's port, as the digits a leak would show up as.
 *
 * The clause below asserts that no resolved value *contains* `3100`, because that is
 * what a leak looks like: the substring turning up inside a glob or an origin the
 * configuration was supposed to be the only source of.
 */
const FIXTURE_PORT_DIGITS = '3100';

/**
 * A port that cannot be mistaken for the fixture's, so a leaked `3100` is visible.
 *
 * **Filtered on the digits rather than on the value, which is what it used to do and
 * why this suite flaked.** `port !== 3100` admits `31005` and `43100`, and there are
 * fifteen such ports in the range; the assertion forbids the substring, so roughly one
 * full-suite run in twenty went red on a generated value that had leaked nothing. The
 * generator was weaker than the property, and the honest fix is to strengthen the
 * generator: a port whose digits contain the fixture's is not a counterexample to
 * anything, it is a case the property cannot express an opinion about.
 */
const arbAlienPort: fc.Arbitrary<number> = fc
  .integer({ min: 1024, max: 65_535 })
  .filter((port) => !String(port).includes(FIXTURE_PORT_DIGITS));

/** One generated host repository's shape: three disjoint trees and an origin. */
interface HostShape {
  readonly corpusRoot: string;
  readonly docsRoot: string;
  readonly sourceRoot: string;
  readonly host: string;
  readonly port: number;
  readonly claimLine: number;
}

const arbHostShape: fc.Arbitrary<HostShape> = fc
  .record({
    corpusRoot: arbAlienSegment,
    docsRoot: arbAlienSegment,
    sourceRoot: arbAlienSegment,
    host: arbAlienSegment,
    port: arbAlienPort,
    // Three claims, one per line, and the citation names one of them. Which one is
    // drawn because "the first line" is the answer a broken reader gives by accident.
    claimLine: fc.integer({ min: 1, max: 3 }),
  })
  .filter(
    ({ corpusRoot, docsRoot, sourceRoot }) =>
      corpusRoot !== docsRoot && docsRoot !== sourceRoot && corpusRoot !== sourceRoot,
  );

/** The three claims a generated documentation file carries, one per line. */
function claimsFor(shape: HostShape): readonly string[] {
  return [
    `- The ${shape.host} screen shows a running total.`,
    `- The ${shape.host} screen applies a discount above the threshold.`,
    `- The ${shape.host} screen keeps an order after a reload.`,
  ];
}

/** The configuration document a generated host repository commits. */
function configDocumentFor(shape: HostShape): unknown {
  return {
    verdictRouter: 'resultCode740',
    memberDebug: false,
    timeouts: { hookMs: 300_000, enrichmentMs: 60_000, doctorMs: 10_000 },
    corpus: { root: shape.corpusRoot },
    subject: {
      source: [`${shape.sourceRoot}/**/*.ts`],
      docs: [`${shape.docsRoot}/**/*.md`],
      baseUrl: `http://${shape.host}.example:${shape.port}`,
    },
    fences: {
      'code-break': { allow: [`${shape.sourceRoot}/**`] },
      'test-drift': { allow: [] },
      'docs-lie': { allow: [] },
    },
  };
}

/** Load a generated configuration the way `main.ts` loads the real one. */
function loadHost(shape: HostShape) {
  const fileSystem = inMemoryStateFileSystem({
    [CONFIG_PATH]: JSON.stringify(configDocumentFor(shape)),
  });
  const sink = createDiagnosticSink();
  return { ...loadConfig({ repoRoot: HOST_ROOT, fileSystem, diagnostics: sink }), sink };
}

/**
 * The generated tree, plus one decoy corpus document outside the configured root.
 *
 * The decoy is what makes the admitted-count clause mean something: it is well formed
 * and its citation resolves, so a scan that ignored `corpus.root` would admit it.
 */
function treeFor(shape: HostShape): Record<string, string> {
  const claims = claimsFor(shape);
  const docPath = `${shape.docsRoot}/product.md`;
  return {
    [docPath]: `${claims.join('\n')}\n`,
    [`${shape.corpusRoot}/checkout_test.md`]: [
      '---',
      'mode: testing',
      'assurance:',
      '  id: HOST-1',
      '---',
      '',
      `<!-- @verifies ${docPath}:${shape.claimLine} -->`,
      `<!-- @covers ${shape.sourceRoot}/** -->`,
      '',
      '## Step 1',
      '',
      'Do the thing the claim describes.',
      '',
    ].join('\n'),
    // The decoy: a second designed test, outside the corpus root, citing line 1.
    [`elsewhere/decoy_test.md`]: [
      '---',
      'assurance:',
      '  id: DECOY-1',
      '---',
      '',
      `<!-- @verifies ${docPath}:1 -->`,
      '',
    ].join('\n'),
    [`${shape.sourceRoot}/checkout.ts`]: 'export const total = 0;\n',
  };
}

// ---------------------------------------------------------------------------
// Clause 1: every repository-specific value comes back from the configuration
// ---------------------------------------------------------------------------

describe('Feature: kept, Property 30: the configuration is the only source of repository facts', () => {
  it('reads the corpus root, both glob sets and the base URL from the file', () => {
    fc.assert(
      fc.property(arbHostShape, (shape) => {
        const { config, loaded } = loadHost(shape);
        expect(loaded).toBe(true);
        expect(config.corpus.root).toBe(shape.corpusRoot);
        expect(config.subject.docs).toEqual([`${shape.docsRoot}/**/*.md`]);
        expect(config.subject.source).toEqual([`${shape.sourceRoot}/**/*.ts`]);
        expect(config.subject.baseUrl).toBe(`http://${shape.host}.example:${shape.port}`);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('resolves no value carrying a path segment of this repository', () => {
    fc.assert(
      fc.property(arbHostShape, (shape) => {
        const { config } = loadHost(shape);
        const resolved = [
          config.corpus.root,
          ...config.subject.docs,
          ...config.subject.source,
          config.subject.baseUrl ?? '',
          ...REPAIR_BRANCH_NAMES.flatMap((branch) => [
            ...config.fences[branch].allow,
            // `packages/**` is §20.1's own entry on every derived forbidden set: a
            // fact about the engine, not about this repository. Excluded by name here
            // and nowhere else.
            ...derivedForbidden(config, branch).filter((glob) => glob !== PACKAGE_ROOT_GLOB),
          ]),
        ];
        for (const value of resolved) {
          for (const segment of THIS_REPOSITORY_SEGMENTS) {
            expect(
              value.includes(segment),
              `resolved value '${value}' carries this repository's '${segment}' segment`,
            ).toBe(false);
          }
        }
        // And no leaked port, on any of them. The generator excludes these digits from
        // both the port and every segment, so the only way they reach a resolved value
        // is this repository's own `3100` having been baked in somewhere.
        expect(resolved.join(' ')).not.toContain(FIXTURE_PORT_DIGITS);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('builds a graph whose one promise cites the generated line verbatim', async () => {
    await fc.assert(
      fc.asyncProperty(arbHostShape, async (shape) => {
        const { config } = loadHost(shape);
        const tree = treeFor(shape);
        const fs = inMemoryBaselineFileSystem(tree);
        const sink = createDiagnosticSink();

        const { result, batch } = await buildBaselineOnlyGraph({
          repoRoot: HOST_ROOT,
          corpusRoot: config.corpus.root,
          fs,
          citations: { read: (path: string) => tree[path] ?? null },
          diagnostics: sink,
        });

        // The configured root, and only it: the decoy outside it contributes nothing.
        expect(result.files).toEqual([`${shape.corpusRoot}/checkout_test.md`]);
        expect(batch.admitted).toHaveLength(1);

        const promise = batch.admitted[0];
        const claims = claimsFor(shape);
        expect(promise?.citation.file).toBe(`${shape.docsRoot}/product.md`);
        expect(promise?.citation.line).toBe(shape.claimLine);
        // Verbatim, read off the generated file rather than off the tag.
        expect(promise?.citation.text).toBe(claims[shape.claimLine - 1]);
        expect(promise?.designedTest?.path).toBe(`${shape.corpusRoot}/checkout_test.md`);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('fences a code-break repair into the generated source tree and nothing else', () => {
    fc.assert(
      fc.property(arbHostShape, (shape) => {
        const { config } = loadHost(shape);
        const surfaces = handoffFenceSurfaces(config);

        expect(surfaces.allow).toEqual([`${shape.sourceRoot}/**`]);
        // The corpus root and the documentation are both named on the other side, and
        // the source file the covers glob points at is reachable while neither the
        // claim nor the test is.
        expect(surfaces.forbid).toContain(shape.corpusRoot);
        expect(surfaces.forbid).toContain(`${shape.docsRoot}/**/*.md`);
        expect(matchesAnyGlob(surfaces.allow, `${shape.sourceRoot}/checkout.ts`)).toBe(true);
        expect(matchesAnyGlob(surfaces.allow, `${shape.docsRoot}/product.md`)).toBe(false);
        expect(
          matchesAnyGlob(surfaces.allow, `${shape.corpusRoot}/checkout_test.md`),
        ).toBe(false);
        expect(matchesAnyGlob(surfaces.forbid, `${shape.corpusRoot}/checkout_test.md`)).toBe(
          true,
        );
        expect(matchesAnyGlob(surfaces.forbid, `${shape.docsRoot}/product.md`)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('filters a documentation save and walks a plan refresh against the same file', () => {
    fc.assert(
      fc.property(arbHostShape, (shape) => {
        const { config } = loadHost(shape);

        // `kept reconcile --changed` selects by `subject.docs`, not by a constant.
        const filtered = filterChangedDocs(
          [`${shape.docsRoot}/product.md`, `${shape.sourceRoot}/checkout.ts`],
          config.subject.docs,
          HOST_ROOT,
        );
        expect(filtered.docs).toEqual([`${shape.docsRoot}/product.md`]);
        expect(filtered.outOfScope).toEqual([`${shape.sourceRoot}/checkout.ts`]);

        // And the plan's staleness walk looks under the configured corpus root. The
        // decoy is newer; a walk rooted anywhere else would report it and refresh on
        // the wrong evidence.
        const planFs = inMemoryPlanFileSystem({
          [`${shape.corpusRoot}/checkout_test.md`]: { text: '---\n---\n', mtimeMs: 10 },
          'elsewhere/decoy_test.md': { text: '---\n---\n', mtimeMs: 99 },
        });
        expect(newestTestDocument(planFs, config.corpus.root)).toEqual({
          path: `${shape.corpusRoot}/checkout_test.md`,
          mtimeMs: 10,
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Clause 2: no executable source file carries one of the three literals
// ---------------------------------------------------------------------------

const SCAN_ROOTS = ['packages/kept-core/src', 'packages/kept-cli/src'] as const;
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', '.next', 'coverage']);

/** Every shipped TypeScript file, repository-relative POSIX. */
function shippedSourceFiles(): readonly string[] {
  const found: string[] = [];
  for (const root of SCAN_ROOTS) {
    const absoluteRoot = resolve(REPO_ROOT, root);
    const stats = statSync(absoluteRoot, { throwIfNoEntry: false });
    if (stats === undefined || !stats.isDirectory()) {
      throw new Error(`${root} does not exist, so this clause would be vacuous`);
    }
    const stack: string[] = [absoluteRoot];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const child = resolve(current, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRECTORIES.has(entry.name)) stack.push(child);
        } else if (entry.isFile() && /\.(ts|tsx|mts|cts)$/.test(entry.name)) {
          found.push(relative(REPO_ROOT, child).split('\\').join('/'));
        }
      }
    }
  }
  return found.sort();
}

const SHIPPED = shippedSourceFiles();

/**
 * Comments removed, so the clause is about executable code.
 *
 * Written independently of `no-repository-literals.test.ts` on purpose: two guards that
 * shared a stripper would fail together, and this clause exists partly to keep that one
 * honest. Deliberately cruder — it does not defend against `/*` inside a string, which
 * would make it *stricter* rather than looser, and a false positive here is a failing
 * test somebody reads.
 */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => {
      const quote = /['"`]/.exec(line);
      const comment = line.indexOf('//');
      if (comment < 0) return line;
      if (quote !== null && quote.index < comment) return line;
      return line.slice(0, comment);
    })
    .join('\n');
}

/** The one permitted corpus-root literal: §20.4's documented default (§20.2). */
const CORPUS_ROOT_DEFAULT_HOME = 'packages/kept-cli/src/config.ts';

/**
 * The one file whose `tests/` literal is not a corpus root at all.
 *
 * `PACK_TESTS_PREFIX` is a path *inside a Kane sealed pack archive* — Kane lays a pack
 * out as `tests/<slug>/result.yaml`, and that layout is Kane 0.8.4's to decide, not a
 * host repository's. Making it configurable would let a config change what KEPT believes
 * another tool's archive format to be. Named here rather than pattern-matched away,
 * because the scan of §20.2 records the same allowance for the same reason and a reader
 * comparing the two should find one sentence, not two mechanisms.
 */
const KANE_PACK_LAYOUT = 'packages/kept-core/src/kane/packTriage.ts';

describe('Feature: kept, Property 30: no shipped source file names this repository', () => {
  it('found files under both published trees, so the clause is not vacuous', () => {
    expect(SHIPPED.length).toBeGreaterThan(20);
    for (const root of SCAN_ROOTS) {
      expect(SHIPPED.some((path) => path.startsWith(`${root}/`))).toBe(true);
    }
  });

  it('carries no fixture path literal in any drawn file', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SHIPPED), (path) => {
        const code = codeOf(readFileSync(resolve(REPO_ROOT, path), 'utf8'));
        expect(code.includes('apps/fixture'), `${path} names the fixture in code`).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('carries no fixture port literal in any drawn file', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SHIPPED), (path) => {
        const code = codeOf(readFileSync(resolve(REPO_ROOT, path), 'utf8'));
        expect(/(?<![\w.])3_?100(?![\w.])/.test(code), `${path} spells 3100`).toBe(false);
        expect(/localhost:\d/.test(code), `${path} spells a localhost port`).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('carries no corpus root literal outside the one documented home', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SHIPPED), (path) => {
        fc.pre(path !== CORPUS_ROOT_DEFAULT_HOME && path !== KANE_PACK_LAYOUT);
        const code = codeOf(readFileSync(resolve(REPO_ROOT, path), 'utf8'));
        // A path-shaped `tests` literal: quoted, and either carrying a slash or
        // assigned to a name that says it is a location. `['design', 'tests']` in
        // `kane/family.ts` is neither, which is why it is not a finding and not an
        // exemption.
        expect(/['"`]tests\//.test(code), `${path} spells a tests/ path`).toBe(false);
        expect(
          /(root|dir|directory|path|corpus)\s*[:=]\s*['"`]tests['"`]/i.test(code),
          `${path} assigns 'tests' to a location`,
        ).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('keeps the documented default in exactly one file, and it is that one', () => {
    // The single home §20.4 names. Asserted positively, because "the literal is gone"
    // and "the default is nowhere" are different states and only one of them is right.
    const homes = SHIPPED.filter((path) => {
      const code = codeOf(readFileSync(resolve(REPO_ROOT, path), 'utf8'));
      return /(root|dir|directory|path|corpus)\s*[:=]\s*['"`]tests['"`]/i.test(code);
    });
    expect(homes).toEqual([CORPUS_ROOT_DEFAULT_HOME]);
  });
});
