import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { matchesAnyGlob, matchesGlob } from 'kept-core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

/**
 * Feature: kept, Property 27: Hook file patterns partition fixture edits
 * (design §Correctness Properties, §11.1, §11.2, §11.3, R11.2, R11.3).
 *
 * *For any* repository-relative path, the code hook's patterns match it only if
 * it is a fixture source file, the docs hook's patterns match it only if it is a
 * fixture documentation file, and no path is matched by both hooks.
 *
 * **Validates: Requirements 11.2, 11.3**
 *
 * ## Why partition, and not merely validity
 *
 * A save that fired *both* hooks would start a verification and a reconciliation
 * against one edit, and the two would race to write `.kept/state.json` — which is
 * single-writer and not mergeable. So the overlap is not a cosmetic duplication;
 * it is a corrupted ledger. The design states the disjointness as holding "by
 * construction (source extensions vs `.md`)", and construction arguments are
 * exactly what a property test is for: the two pattern lists are edited by hand,
 * in two separate files, and nothing but this file would notice the day one of
 * them grew a glob that reached across.
 *
 * Three further clauses matter as much as the overlap:
 *
 *   - **Soundness against the fence.** A path the code hook matches must be inside
 *     {@link SOURCE_GLOBS}, and a path the docs hook matches must be inside
 *     {@link DOC_GLOBS}. Those two lists are read out of `.kept/config.json` —
 *     `subject.source` and `subject.docs` — which is the same file the CLI resolves
 *     `nextAction.allowedPaths`/`forbiddenPaths` from (§11.2, §20.1). They used to be
 *     `SOURCE_GLOBS` and `DOC_GLOBS` inside `handoff/handoff.ts`, and
 *     moving them into configuration is exactly the change that could have let the
 *     hooks and the fence drift apart, so this clause now compares the hook files
 *     against the config rather than against a constant: three declarations reduced
 *     to one, checked in both directions.
 *   - **Nothing outside the configured subject fires anything.** A save in
 *     `packages/` or `apps/ledger/` must not start a verification of the fixture.
 *     KEPT's own *code* is never the repair target on any branch, and it must not be
 *     the trigger either. This clause used to be spelled "outside the fixture tree",
 *     which stopped being the same statement at task 26.1: the root `README.md` is a
 *     promise source now (§23.1, R19.1), so a save in it owes a reconciliation while
 *     everything else at the repository root still owes nothing. The fence lists are
 *     the authority, and they are read from `.kept/config.json`.
 *   - **The real tree is covered.** Soundness alone is satisfiable by matching
 *     nothing at all, so the fixture is walked on disk and every source and
 *     documentation file that exists today is required to fire exactly one hook.
 *     That is the clause that fails if the pattern list ever stops reaching a real
 *     file — a silently dead trigger half, which is the failure this whole suite
 *     is a guard against.
 *
 * `matchesGlob`/`matchesAnyGlob` from `radius/radius.ts` is the repository's one
 * glob grammar — the same matcher the blast radius uses over `covers:` entries. A
 * second matcher written here could agree with itself and disagree with the
 * product, which would prove nothing.
 */

const NUM_RUNS = 500;

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** The fixture tree prefix. Everything the two hooks may watch lives under it. */
const FIXTURE_PREFIX = 'apps/fixture/';

// ---------------------------------------------------------------------------
// The two pattern sets, read from the files Kiro actually loads
// ---------------------------------------------------------------------------

/** `when.patterns` of one committed hook file. No schema re-validation here. */
function hookPatterns(slug: string): readonly string[] {
  const path = resolve(REPO_ROOT, `.kiro/hooks/${slug}.json`);
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
    when?: { patterns?: readonly string[] };
  };
  const patterns = parsed.when?.patterns;
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error(`.kiro/hooks/${slug}.json declares no when.patterns — the partition is vacuous`);
  }
  return patterns;
}

const CODE_PATTERNS = hookPatterns('kept-code-verify');
const DOCS_PATTERNS = hookPatterns('kept-docs-reconcile');

/**
 * `subject.source` and `subject.docs` from the committed `.kept/config.json`.
 *
 * Read as raw JSON rather than through `loadConfig`, deliberately: this suite lives
 * in `kept-core` and the loader lives in `@corgod/kept-cli`, so importing it would invert the
 * dependency the whole of §20 exists to respect. What matters here is the *bytes on
 * disk* the CLI will read, and a missing or empty list is a failure rather than a
 * default — a defaulted `subject.docs` of `['README.md']` would make every clause
 * below pass while describing a repository this one is not.
 */
function configuredGlobs(key: 'source' | 'docs'): readonly string[] {
  const path = resolve(REPO_ROOT, '.kept/config.json');
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
    subject?: { source?: readonly string[]; docs?: readonly string[] };
  };
  const globs = parsed.subject?.[key];
  if (!Array.isArray(globs) || globs.length === 0) {
    throw new Error(
      `.kept/config.json declares no subject.${key}, so the hook patterns have nothing ` +
        `to mirror and this property would be vacuous`,
    );
  }
  return globs;
}

const SOURCE_GLOBS = configuredGlobs('source');
const DOC_GLOBS = configuredGlobs('docs');

/** Whether the code hook fires on `path`. */
function firesCode(path: string): boolean {
  return matchesAnyGlob(CODE_PATTERNS, path);
}

/** Whether the docs hook fires on `path`. */
function firesDocs(path: string): boolean {
  return matchesAnyGlob(DOCS_PATTERNS, path);
}

/**
 * The tree a pattern watches: its `/**\/*.ext` tail removed, leaving the fence
 * glob it must belong to. `apps/fixture/README.md` has no tail and is its own
 * stem, which is how a literal file pattern joins the same check.
 */
function stemOf(pattern: string): string {
  const withoutLeaf = pattern.replace(/\/\*\*\/\*\.[A-Za-z0-9]+$/u, '/**');
  return withoutLeaf;
}

// ---------------------------------------------------------------------------
// Generators: both trees, the near-misses, and everything outside the fixture
// ---------------------------------------------------------------------------

/** One path segment that no normaliser would collapse or re-root. */
const arbSegment: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), {
    minLength: 1,
    maxLength: 8,
  })
  .map((characters) => characters.join(''));

/** Zero to three intermediate directories, so the zero-depth case is drawn too. */
const arbSubPath: fc.Arbitrary<string> = fc
  .array(arbSegment, { minLength: 0, maxLength: 3 })
  .map((segments) => (segments.length === 0 ? '' : `${segments.join('/')}/`));

/**
 * Every extension that matters: the two the hooks watch, Markdown, and four
 * neighbours that live in the same trees today or plausibly could. Drawing
 * `.md` under `lib/` and `.ts` under `docs/` is the whole point — those are the
 * near-misses where a careless `**` would cross the partition.
 */
const arbExtension: fc.Arbitrary<string> = fc.constantFrom(
  'ts',
  'tsx',
  'md',
  'css',
  'json',
  'mjs',
  'mdx',
);

/** A file inside one of the three fixture source trees. */
const arbFixtureSourcePath: fc.Arbitrary<string> = fc
  .record({
    tree: fc.constantFrom('app', 'components', 'lib'),
    sub: arbSubPath,
    name: arbSegment,
    ext: arbExtension,
  })
  .map(({ tree, sub, name, ext }) => `${FIXTURE_PREFIX}${tree}/${sub}${name}.${ext}`);

/** A file inside the fixture documentation tree, plus the README itself. */
const arbFixtureDocPath: fc.Arbitrary<string> = fc.oneof(
  fc.constant(`${FIXTURE_PREFIX}README.md`),
  fc
    .record({ sub: arbSubPath, name: arbSegment, ext: arbExtension })
    .map(({ sub, name, ext }) => `${FIXTURE_PREFIX}docs/${sub}${name}.${ext}`),
);

/** A file directly under `apps/fixture/`, outside both watched trees. */
const arbFixtureLoosePath: fc.Arbitrary<string> = fc
  .record({ name: arbSegment, ext: arbExtension })
  .map(({ name, ext }) => `${FIXTURE_PREFIX}${name}.${ext}`);

/**
 * The repository's own root README, which `subject.docs` names since task 26.1
 * (design §23.1, R19.1).
 *
 * It used to be drawn as an *outside* path, and the clause below required it to fire
 * nothing. That was right while the only promise source was the fixture and is wrong
 * now: five promises are cited to this file, so a save in it owes the same
 * reconciliation any other claim surface does. The clause it used to satisfy has been
 * restated against `subject.source` and `subject.docs` rather than against the
 * fixture prefix, which is what it was always trying to say.
 */
const arbSelfDocPath: fc.Arbitrary<string> = fc.constant('README.md');

/**
 * Paths that are neither the fixture nor a configured claim surface: KEPT's own
 * packages, the Ledger, the Kane corpus at repository root, and a `..` traversal that
 * leaves the fixture behind. None of them may fire either hook.
 */
const arbOutsidePath: fc.Arbitrary<string> = fc.oneof(
  fc.constant('package.json'),
  fc.constant('apps/fixture'),
  fc
    .record({
      root: fc.constantFrom(
        'packages/kept-core/src',
        'packages/kept-cli/src',
        'apps/ledger/lib',
        'apps/ledger/app',
        'tests',
        'scripts',
        'docs',
        'apps/fixture-two/lib',
        'apps/fixture/../ledger/lib',
      ),
      sub: arbSubPath,
      name: arbSegment,
      ext: arbExtension,
    })
    .map(({ root, sub, name, ext }) => `${root}/${sub}${name}.${ext}`),
);

/** Any path at all, with both trees, the near-misses and the outside weighted in. */
const arbAnyPath: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: arbFixtureSourcePath },
  { weight: 3, arbitrary: arbFixtureDocPath },
  { weight: 1, arbitrary: arbFixtureLoosePath },
  { weight: 1, arbitrary: arbSelfDocPath },
  { weight: 3, arbitrary: arbOutsidePath },
);

/** Every glob a hook is allowed to reach: the two configured subject surfaces. */
const SUBJECT_GLOBS: readonly string[] = [...SOURCE_GLOBS, ...DOC_GLOBS];

// ---------------------------------------------------------------------------
// The clauses
// ---------------------------------------------------------------------------

describe('Property 27: hook file patterns partition fixture edits', () => {
  it('never lets one save fire both hooks', () => {
    fc.assert(
      fc.property(arbAnyPath, (path) => {
        expect(
          firesCode(path) && firesDocs(path),
          `${path} fires both hooks — a verification and a reconciliation would race ` +
            `to write .kept/state.json`,
        ).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('fires the code hook only on fixture source, inside the code-break fence', () => {
    fc.assert(
      fc.property(arbAnyPath, (path) => {
        fc.pre(firesCode(path));
        expect(matchesAnyGlob(SOURCE_GLOBS, path), `${path} is outside the source fence`).toBe(
          true,
        );
        expect(matchesAnyGlob(DOC_GLOBS, path), `${path} is fixture documentation`).toBe(
          false,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('fires the docs hook only on fixture documentation', () => {
    fc.assert(
      fc.property(arbAnyPath, (path) => {
        fc.pre(firesDocs(path));
        expect(matchesAnyGlob(DOC_GLOBS, path), `${path} is outside the doc fence`).toBe(
          true,
        );
        expect(matchesAnyGlob(SOURCE_GLOBS, path), `${path} is fixture source`).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('fires neither hook on any path outside the configured subject', () => {
    // Stated against `subject.source` and `subject.docs` rather than against the
    // fixture prefix. Those two lists were the same thing until task 26.1 admitted
    // this repository's own README as a promise source, and the fence is the
    // authority: a hook may fire exactly where the configuration says a claim or a
    // subject source lives, and nowhere else.
    fc.assert(
      fc.property(arbAnyPath, (path) => {
        fc.pre(!matchesAnyGlob(SUBJECT_GLOBS, path));
        expect(firesCode(path), `${path} is outside the subject and must not verify it`).toBe(
          false,
        );
        expect(firesDocs(path), `${path} is outside the subject and must not reconcile it`).toBe(
          false,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('fires neither hook anywhere under KEPT\'s own trees', () => {
    // The narrower half of the clause above, kept explicit: the engine, the Ledger,
    // the corpus and the scripts are never a trigger, whatever the configuration says.
    fc.assert(
      fc.property(arbOutsidePath, (path) => {
        expect(firesCode(path), `${path} is not a subject and must not verify anything`).toBe(
          false,
        );
        expect(firesDocs(path), `${path} is not a subject and must not reconcile anything`).toBe(
          false,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('fires the docs hook on every Markdown file the doc fence covers', () => {
    fc.assert(
      fc.property(fc.oneof(arbFixtureDocPath, arbSelfDocPath), (path) => {
        fc.pre(path.endsWith('.md'));
        expect(firesDocs(path), `${path} is a claim surface but reconciles nothing`).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reconciles the root README, which is a promise source now (R19.1)', () => {
    // The one on-disk instance of the clause above, asserted by name. Five promises
    // are cited to this file; a save in it that started nothing would leave the graph
    // claiming things about a document no hook watches.
    expect(matchesAnyGlob(DOC_GLOBS, 'README.md')).toBe(true);
    expect(firesDocs('README.md')).toBe(true);
    expect(firesCode('README.md')).toBe(false);
  });
});

describe('Property 27: the hook pattern sets do not drift from the handoff fence', () => {
  it('watches exactly the trees subject.source declares', () => {
    // Derived, not re-listed: `subject.source` is what the CLI resolves
    // `nextAction.allowedPaths` from, so a hook that watched a tree the config does
    // not name would tell the agent to repair a file it is fenced out of.
    const stems = new Set(CODE_PATTERNS.map(stemOf));
    expect([...stems].sort()).toEqual([...SOURCE_GLOBS].sort());
  });

  it('watches exactly the documentation subject.docs declares', () => {
    const stems = new Set(DOCS_PATTERNS.map(stemOf));
    expect([...stems].sort()).toEqual([...DOC_GLOBS].sort());
  });

  it('keeps the two fence lists disjoint, which is what makes the hooks separable', () => {
    for (const source of SOURCE_GLOBS) {
      for (const doc of DOC_GLOBS) {
        expect(matchesGlob(source, doc.replace(/\/\*\*$/u, '/x.md'))).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The real tree: soundness is satisfiable by matching nothing, so cover it
// ---------------------------------------------------------------------------

/** Every file under `apps/fixture/`, repository-relative POSIX. Build output skipped. */
function fixtureFiles(): readonly string[] {
  const skip = new Set(['.next', 'node_modules', 'dist']);
  const root = resolve(REPO_ROOT, 'apps/fixture');
  const found: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) stack.push(resolve(current, entry.name));
      } else if (entry.isFile()) {
        found.push(relative(REPO_ROOT, resolve(current, entry.name)).split('\\').join('/'));
      }
    }
  }
  return found.sort();
}

const FIXTURE_FILES = fixtureFiles();

describe('Property 27: the partition holds over the fixture as it exists on disk', () => {
  it('found the fixture tree, so the on-disk clauses are not vacuous', () => {
    const stats = statSync(resolve(REPO_ROOT, 'apps/fixture'), { throwIfNoEntry: false });
    expect(stats?.isDirectory()).toBe(true);
    expect(FIXTURE_FILES.length).toBeGreaterThan(0);
  });

  it('fires exactly one hook on no committed fixture file twice', () => {
    for (const path of FIXTURE_FILES) {
      expect(firesCode(path) && firesDocs(path), `${path} fires both hooks`).toBe(false);
    }
  });

  it('verifies every TypeScript file inside the source fence', () => {
    const sources = FIXTURE_FILES.filter(
      (path) =>
        matchesAnyGlob(SOURCE_GLOBS, path) &&
        (path.endsWith('.ts') || path.endsWith('.tsx')),
    );
    expect(sources.length).toBeGreaterThan(0);
    for (const path of sources) {
      expect(firesCode(path), `${path} is fixture source that no hook verifies`).toBe(true);
    }
  });

  it('reconciles every Markdown file inside the doc fence', () => {
    const docs = FIXTURE_FILES.filter(
      (path) => matchesAnyGlob(DOC_GLOBS, path) && path.endsWith('.md'),
    );
    // `apps/fixture/README.md` is the whole claims block of §12.2; there is
    // always at least one.
    expect(docs).toContain(`${FIXTURE_PREFIX}README.md`);
    for (const path of docs) {
      expect(firesDocs(path), `${path} is fixture documentation that no hook reconciles`).toBe(true);
    }
  });

  it('leaves the fixture Vitest suite unwatched by both hooks', () => {
    // `apps/fixture/test/**` is Kepler Coffee's own arithmetic suite. It is not
    // the Kane corpus and it is not a promise, so a save there is nobody's
    // trigger.
    const suite = FIXTURE_FILES.filter((path) => path.startsWith(`${FIXTURE_PREFIX}test/`));
    expect(suite.length).toBeGreaterThan(0);
    for (const path of suite) {
      expect(firesCode(path) || firesDocs(path), `${path} should trigger nothing`).toBe(false);
    }
  });
});
