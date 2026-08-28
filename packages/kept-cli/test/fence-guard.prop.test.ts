import { createDiagnosticSink, inMemoryStateFileSystem, matchesGlob } from 'kept-core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  CONFIG_DIAGNOSTIC_CODES,
  CONFIG_FILE_RELATIVE_PATH,
  PACKAGE_ROOT_GLOB,
  derivedForbidden,
  fenceFindings,
  loadConfig,
  type KeptConfig,
} from '../src/config.js';

/**
 * Feature: kept, Property 31: Repair fences never permit editing the claim's own
 * source (design §Correctness Properties, §20.3, R15.7, R15.8, R7.7, R7.8).
 *
 * *For any* configuration, the resolved `code-break` allowed set intersects
 * neither the configured documentation globs nor the configured corpus root; every
 * glob the granted row would have allowed appears in the forbidden set when
 * autonomy is withheld; and a configuration whose `code-break` allowed set does
 * intersect either one is refused at load time with a diagnostic naming the
 * intersecting glob and an allowed set that permits nothing.
 *
 * ## What this property is actually about
 *
 * One sentence in a config file. `"fences": { "code-break": { "allow": ["**"] } }`
 * authorises an agent to rewrite the claim it just failed, and a promise turned
 * green that way is not kept, it is redefined. While the fence table was source
 * code that sentence was unwritable. Now that it is configuration, the only thing
 * standing between a user and it is this guard, which makes this the highest-value
 * property in the extension.
 *
 * ## Why the assertion does not go through the intersection algorithm
 *
 * The load-time decision is made by a glob-versus-glob search. If that search has
 * a blind spot, a property that asked it "did you find anything" would agree with
 * the bug. So the invariant is checked the way an agent would actually check it:
 * concrete paths under the drawn corpus root and concrete paths the drawn
 * documentation globs match, tested against every surviving allow glob with
 * {@link matchesGlob}, the repository's one glob grammar (§3.18). A resolved fence
 * that matches any of those paths fails this property whether or not the guard
 * thought it was safe.
 *
 * The adversarial set is the one §20.3 names: the two spellings of "everything",
 * a parent traversal reaching the corpus root, one leaving the repository root, an
 * allow glob whose prefix is a documentation glob's prefix, and the corpus root
 * spelled with and without a trailing glob.
 *
 * No process, no disk, no Kane: the config is a JSON string in an in-memory
 * filesystem, and the guard is a pure decision over it.
 *
 * **Validates: Requirements 15.7, 15.8, 7.7, 7.8**
 */

/** Design §Testing Strategy floor is 100 runs; stated so it cannot regress. */
const NUM_RUNS = 300;

const ROOT = '/repo';
const CONFIG_PATH = `${ROOT}/${CONFIG_FILE_RELATIVE_PATH}`;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** A corpus root a host repository might plausibly use. */
const CORPUS_ROOTS: readonly string[] = ['tests', 'suite', 'spec', 'qa/corpus'];

/**
 * A documentation glob paired with paths it matches.
 *
 * The paths are authored beside the glob rather than derived from it, so the
 * property's witnesses do not come from the same code the property is checking.
 */
const DOCS_CASES: readonly { readonly glob: string; readonly paths: readonly string[] }[] = [
  { glob: 'README.md', paths: ['README.md'] },
  { glob: 'docs/**/*.md', paths: ['docs/product.md', 'docs/guides/checkout.md'] },
  { glob: 'documentation/*.md', paths: ['documentation/intro.md'] },
  { glob: '*.md', paths: ['README.md', 'CHANGELOG.md'] },
  { glob: 'apps/site/README.md', paths: ['apps/site/README.md'] },
];

/** Source globs that reach product code and nothing else. */
const SAFE_SOURCE_GLOBS: readonly string[] = [
  'src/**',
  'src/**/*.ts',
  'lib/**/*.ts',
  'app/components/**/*.tsx',
];

/** One drawn configuration document, plus the paths its claims live at. */
interface ConfigCase {
  readonly document: Record<string, unknown>;
  readonly corpusRoot: string;
  readonly docsGlobs: readonly string[];
  readonly sourceGlobs: readonly string[];
  readonly allow: readonly string[];
  /** Concrete paths that are a claim or a test: nothing may ever write these. */
  readonly claimPaths: readonly string[];
  /** True when the drawn allow set was built to reach a claim. */
  readonly adversarial: boolean;
}

const arbConfigCase: fc.Arbitrary<ConfigCase> = fc
  .record({
    corpusRoot: fc.constantFrom(...CORPUS_ROOTS),
    docs: fc.uniqueArray(fc.constantFrom(...DOCS_CASES), {
      minLength: 1,
      maxLength: 3,
      selector: (entry) => entry.glob,
    }),
    sourceGlobs: fc.uniqueArray(fc.constantFrom(...SAFE_SOURCE_GLOBS), {
      minLength: 1,
      maxLength: 3,
    }),
    doctorMs: fc.integer({ min: 1, max: 60_000 }),
  })
  .chain(({ corpusRoot, docs, sourceGlobs, doctorMs }) => {
    const docsGlobs = docs.map((entry) => entry.glob);
    // Every spelling of "this fence can reach a claim" the design calls out, drawn
    // against the corpus root and the documentation globs of this same case.
    const adversarialGlobs: readonly string[] = [
      '**',
      '**/*',
      corpusRoot,
      `${corpusRoot}/**`,
      `${corpusRoot}/**/*_test.md`,
      `src/../${corpusRoot}/**`,
      `../elsewhere/${corpusRoot}/**`,
      ...docsGlobs,
      ...docsGlobs.map((glob) => `${glob.split('/')[0] as string}/**`),
      ...docs.flatMap((entry) => entry.paths),
    ];
    return fc
      .record({
        safe: fc.uniqueArray(fc.constantFrom(...sourceGlobs, ...SAFE_SOURCE_GLOBS), {
          maxLength: 3,
        }),
        adversarial: fc.uniqueArray(fc.constantFrom(...adversarialGlobs), { maxLength: 2 }),
        // Half the runs stay honest, so the "leaves a safe fence alone" direction
        // is quantified over rather than assumed.
        poison: fc.boolean(),
      })
      .map(({ safe, adversarial, poison }): ConfigCase => {
        const allow = poison ? [...safe, ...adversarial] : safe;
        return {
          corpusRoot,
          docsGlobs,
          sourceGlobs,
          allow,
          adversarial: poison && adversarial.length > 0,
          claimPaths: [
            corpusRoot,
            `${corpusRoot}/checkout_test.md`,
            `${corpusRoot}/nested/orders_persist_test.md`,
            ...docs.flatMap((entry) => entry.paths),
          ],
          document: {
            verdictRouter: 'resultCode740',
            memberDebug: false,
            timeouts: { hookMs: 300_000, enrichmentMs: 60_000, doctorMs },
            corpus: { root: corpusRoot },
            subject: { source: sourceGlobs, docs: docsGlobs, baseUrl: null },
            fences: {
              'code-break': { allow },
              'test-drift': { allow: [] },
              'docs-lie': { allow: [] },
            },
          },
        };
      });
  });

function load(document: unknown) {
  const fileSystem = inMemoryStateFileSystem({ [CONFIG_PATH]: JSON.stringify(document) });
  const sink = createDiagnosticSink();
  const result = loadConfig({ repoRoot: ROOT, fileSystem, diagnostics: sink });
  return { ...result, sink };
}

/** Every claim path any surviving allow glob can reach. Empty is the invariant. */
function reachableClaims(config: KeptConfig, claimPaths: readonly string[]): readonly string[] {
  const reached: string[] = [];
  for (const path of claimPaths) {
    for (const glob of config.fences['code-break'].allow) {
      if (matchesGlob(glob, path)) reached.push(`${glob} -> ${path}`);
    }
  }
  return reached;
}

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

describe("Feature: kept, Property 31: Repair fences never permit editing the claim's own source", () => {
  it('resolves a code-break fence that reaches neither the documentation nor the corpus', () => {
    fc.assert(
      fc.property(arbConfigCase, (drawn) => {
        const { config } = load(drawn.document);

        // The invariant, checked against concrete paths rather than against the
        // guard's own answer: no surviving allow glob matches a test document, the
        // corpus directory itself, or anything a documentation glob matches.
        expect(reachableClaims(config, drawn.claimPaths)).toEqual([]);

        // And the guard agrees with itself: a resolved config never has an
        // outstanding `code-break` finding, whatever the file asked for.
        expect(fenceFindings(config).filter((finding) => finding.branch === 'code-break')).toEqual(
          [],
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('refuses a fence that tries to intersect, naming the glob and permitting nothing', () => {
    fc.assert(
      fc.property(arbConfigCase, (drawn) => {
        fc.pre(drawn.adversarial);
        const { config, loaded, sink } = load(drawn.document);

        // Fail closed. The branch keeps its verdict and loses its write autonomy,
        // which is what "rejected" means in a module that never throws.
        expect(config.fences['code-break'].allow).toEqual([]);
        expect(loaded).toBe(false);

        const errors = sink.withCode(CONFIG_DIAGNOSTIC_CODES.fenceIntersectsClaims);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.every((diagnostic) => diagnostic.severity === 'error')).toBe(true);
        // The diagnostic names an intersecting glob the file actually contained
        // (R15.8). A message that named a glob nobody wrote would be unactionable.
        expect(
          errors.some((diagnostic) =>
            drawn.allow.some((glob) => diagnostic.message.includes(glob)),
          ),
        ).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('leaves an honest fence intact, so the refusal is not the only outcome reached', () => {
    fc.assert(
      fc.property(arbConfigCase, (drawn) => {
        fc.pre(!drawn.adversarial);
        const { config, loaded, sink } = load(drawn.document);

        expect(config.fences['code-break'].allow).toEqual(drawn.allow);
        expect(loaded).toBe(true);
        expect(sink.has(CONFIG_DIAGNOSTIC_CODES.fenceIntersectsClaims)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('catches `**` and `**/*` every single time, whatever the rest of the file says', () => {
    fc.assert(
      fc.property(
        arbConfigCase,
        fc.constantFrom('**', '**/*'),
        fc.array(fc.constantFrom(...SAFE_SOURCE_GLOBS), { maxLength: 3 }),
        (drawn, everything, alongside) => {
          const document = {
            ...drawn.document,
            fences: {
              'code-break': { allow: [...alongside, everything] },
              'test-drift': { allow: [] },
              'docs-lie': { allow: [] },
            },
          };
          const { config, loaded, sink } = load(document);

          expect(config.fences['code-break'].allow).toEqual([]);
          expect(loaded).toBe(false);
          expect(
            sink
              .withCode(CONFIG_DIAGNOSTIC_CODES.fenceIntersectsClaims)
              .some((diagnostic) => diagnostic.message.includes(everything)),
          ).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('forbids every glob the granted row would have allowed, once autonomy is withheld', () => {
    fc.assert(
      fc.property(arbConfigCase, (drawn) => {
        const { config } = load(drawn.document);
        const forbidden = derivedForbidden(config, 'code-break');

        // The corpus, the documentation and both package roots are forbidden to
        // every branch, always. None of the three is configurable away.
        expect(forbidden).toContain(config.corpus.root);
        for (const glob of config.subject.docs) expect(forbidden).toContain(glob);
        expect(forbidden).toContain(PACKAGE_ROOT_GLOB);

        // And the clause that makes a withheld fence honest: a branch holding no
        // autonomy is forbidden every source glob the granted row would have
        // handed it, so the withheld row is not merely a shorter allowed list.
        if (config.fences['code-break'].allow.length === 0) {
          for (const glob of config.subject.source) expect(forbidden).toContain(glob);
        } else {
          for (const glob of config.fences['code-break'].allow) {
            expect(forbidden).not.toContain(glob);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reaches both outcomes, so no clause above is quantifying over nothing', () => {
    const seen = { refused: 0, intact: 0 };
    fc.assert(
      fc.property(arbConfigCase, (drawn) => {
        const { config } = load(drawn.document);
        if (drawn.allow.length > 0 && config.fences['code-break'].allow.length === 0) {
          seen.refused += 1;
        }
        if (config.fences['code-break'].allow.length > 0) seen.intact += 1;
      }),
      { numRuns: NUM_RUNS },
    );
    expect(seen.refused).toBeGreaterThan(0);
    expect(seen.intact).toBeGreaterThan(0);
  });
});
