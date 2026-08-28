import { createDiagnosticSink, inMemoryStateFileSystem, matchesGlob } from 'kept-core';
import { describe, expect, it } from 'vitest';

import {
  CONFIG_DIAGNOSTIC_CODES,
  CONFIG_FILE_RELATIVE_PATH,
  DEFAULT_CONFIG,
  PACKAGE_ROOT_GLOB,
  REPAIR_BRANCH_NAMES,
  applyOverrides,
  derivedForbidden,
  fenceFindings,
  loadConfig,
} from '../src/config.js';

/**
 * The portability half of `.kept/config.json` (design §20.1, §20.3, §20.4, R15.1,
 * R15.4, R15.6, R15.7, R15.8).
 *
 * Two things are under test and they pull in opposite directions.
 *
 * **Every repository-specific value is now a key, and every omitted key is
 * announced.** The point of the announcement is the case where nothing looks
 * wrong: a config with no `corpus.root` scans `tests` and reports what it found
 * there, and if that was not the right directory the only thing standing between
 * the user and "your repository makes no claims" is a diagnostic naming the
 * directory it looked in.
 *
 * **The one key that is dangerous is refused rather than defaulted.** A
 * `code-break` allow set that can reach the corpus or the documentation lets a red
 * promise be turned green by rewriting the claim, so it is emptied at load time.
 * That refusal is asserted here as behaviour of `loadConfig`, not of a helper: the
 * caller that matters is the one that never calls the helper.
 */
const ROOT = '/repo';
const CONFIG_PATH = `${ROOT}/${CONFIG_FILE_RELATIVE_PATH}`;

function load(document: unknown) {
  const fileSystem = inMemoryStateFileSystem({ [CONFIG_PATH]: JSON.stringify(document) });
  const sink = createDiagnosticSink();
  const result = loadConfig({ repoRoot: ROOT, fileSystem, diagnostics: sink });
  return { ...result, sink };
}

/** The messages of one code, so an assertion can name the field it wanted. */
function messages(sink: ReturnType<typeof createDiagnosticSink>, code: string): readonly string[] {
  return sink.withCode(code).map((diagnostic) => diagnostic.message);
}

describe('the portability keys resolve, and every applied default says so (R15.1, R15.4)', () => {
  it('reads a host repository that shares no path with this one', () => {
    const { config, loaded } = load({
      verdictRouter: 'resultCode740',
      memberDebug: false,
      timeouts: { hookMs: 300_000, enrichmentMs: 60_000, doctorMs: 5_000 },
      corpus: { root: 'suite' },
      subject: {
        source: ['src/**/*.ts'],
        docs: ['docs/**/*.md'],
        baseUrl: 'http://localhost:4321',
      },
      fences: {
        'code-break': { allow: ['src/**'] },
        'test-drift': { allow: [] },
        'docs-lie': { allow: [] },
      },
    });

    expect(loaded).toBe(true);
    expect(config.corpus.root).toBe('suite');
    expect(config.subject.source).toEqual(['src/**/*.ts']);
    expect(config.subject.docs).toEqual(['docs/**/*.md']);
    expect(config.subject.baseUrl).toBe('http://localhost:4321');
    expect(config.timeouts.doctorMs).toBe(5_000);
    expect(config.fences['code-break'].allow).toEqual(['src/**']);
  });

  it('applies the fail-closed default of §20.4 for every optional key, naming each', () => {
    const { config, loaded, sink } = load({
      verdictRouter: 'resultCode740',
      memberDebug: false,
      timeouts: { hookMs: 300_000, enrichmentMs: 60_000 },
    });

    // An omitted key is a repository that has not said yet, so the file still
    // means what it says.
    expect(loaded).toBe(true);
    expect(config.corpus.root).toBe('tests');
    expect(config.subject.source).toEqual([]);
    expect(config.subject.docs).toEqual(['README.md']);
    expect(config.subject.baseUrl).toBeNull();
    expect(config.timeouts.doctorMs).toBe(10_000);
    for (const branch of REPAIR_BRANCH_NAMES) {
      expect(config.fences[branch].allow).toEqual([]);
    }

    const applied = messages(sink, CONFIG_DIAGNOSTIC_CODES.defaultApplied);
    for (const key of [
      'corpus.root',
      'subject.source',
      'subject.docs',
      'subject.baseUrl',
      'timeouts.doctorMs',
      'fences.code-break.allow',
      'fences.test-drift.allow',
      'fences.docs-lie.allow',
    ]) {
      expect(
        applied.some((message) => message.includes(key)),
        `no default-applied diagnostic named ${key}`,
      ).toBe(true);
    }
    // The value, not only the key: "tests" is the whole content of the warning.
    expect(applied.some((message) => message.includes("'tests'"))).toBe(true);
    expect(applied.every((message) => message.includes(CONFIG_FILE_RELATIVE_PATH))).toBe(true);
  });

  it('resolves an absent allow set and an explicit [] identically, and reports them apart', () => {
    const absent = load({ fences: { 'code-break': {} } });
    const explicit = load({ fences: { 'code-break': { allow: [] } } });

    expect(absent.config.fences['code-break']).toEqual(explicit.config.fences['code-break']);
    expect(absent.config.fences['code-break'].allow).toEqual([]);

    const named = (result: typeof absent): boolean =>
      messages(result.sink, CONFIG_DIAGNOSTIC_CODES.defaultApplied).some((message) =>
        message.includes('fences.code-break.allow'),
      );
    // "I forgot to configure this branch" and "this branch may write nothing" have
    // opposite meanings and identical spellings, so the diagnostic is the only
    // place they can be told apart (§20.1).
    expect(named(absent)).toBe(true);
    expect(named(explicit)).toBe(false);
  });

  it('names the offending field path and the expected type on a schema violation (R15.6)', () => {
    const { config, loaded, sink } = load({
      timeouts: { hookMs: 300_000, enrichmentMs: 60_000, doctorMs: '10s' },
      corpus: { root: 12 },
      subject: { source: 'src/**', docs: ['docs/a.md', 7], baseUrl: 'not-a-url' },
      fences: { 'code-break': { allow: 'apps/**' } },
    });

    expect(loaded).toBe(false);
    const named = messages(sink, CONFIG_DIAGNOSTIC_CODES.fieldInvalid);
    for (const path of [
      'timeouts.doctorMs',
      'corpus.root',
      'subject.source',
      'subject.docs[]',
      'subject.baseUrl',
      'fences.code-break.allow',
    ]) {
      expect(
        named.some((message) => message.includes(path)),
        `no field-invalid diagnostic named ${path}`,
      ).toBe(true);
    }
    // Each falls back alone: the one usable docs entry survives its bad neighbour.
    expect(config.subject.docs).toEqual(['docs/a.md']);
    expect(config.corpus.root).toBe(DEFAULT_CONFIG.corpus.root);
    expect(config.subject.baseUrl).toBeNull();
    expect(config.timeouts.doctorMs).toBe(DEFAULT_CONFIG.timeouts.doctorMs);
    expect(config.fences['code-break'].allow).toEqual([]);
  });

  it('accepts an explicit null baseUrl without calling it an omission', () => {
    const { config, sink } = load({ subject: { baseUrl: null } });
    expect(config.subject.baseUrl).toBeNull();
    expect(
      messages(sink, CONFIG_DIAGNOSTIC_CODES.defaultApplied).some((message) =>
        message.includes('subject.baseUrl'),
      ),
    ).toBe(false);
  });

  it('carries every portability key through a per-invocation override', () => {
    const { config } = load({
      corpus: { root: 'suite' },
      subject: { source: ['src/**'], docs: ['docs/**'], baseUrl: 'https://example.test' },
      fences: { 'code-break': { allow: ['src/**'] } },
    });
    const overridden = applyOverrides(config, { router: 'failureYamlTriage', memberDebug: true });

    expect(overridden.verdictRouter).toBe('failureYamlTriage');
    expect(overridden.corpus).toEqual(config.corpus);
    expect(overridden.subject).toEqual(config.subject);
    // No flag widens a fence. There is no `--allow`, and there will not be one.
    expect(overridden.fences).toEqual(config.fences);
  });
});

describe('`forbid` is not a key a user may spell (§20.1)', () => {
  it('rejects it as an unknown field and derives the set anyway', () => {
    const { config, loaded, sink } = load({
      corpus: { root: 'suite' },
      subject: { source: ['src/**', 'lib/**'], docs: ['docs/**/*.md'] },
      fences: {
        'code-break': { allow: ['src/**'], forbid: ['docs/**/*.md'] },
      },
    });

    expect(loaded).toBe(false);
    expect(sink.has(CONFIG_DIAGNOSTIC_CODES.fenceForbidRejected)).toBe(true);
    expect(
      messages(sink, CONFIG_DIAGNOSTIC_CODES.fenceForbidRejected).some((message) =>
        message.includes('fences.code-break.forbid'),
      ),
    ).toBe(true);

    // The allow set beside it still reads, because the file is not thrown away.
    expect(config.fences['code-break'].allow).toEqual(['src/**']);

    // And the forbidden set is the derived one: the corpus, the documentation,
    // both package roots, and the source glob this branch was not granted. A
    // hand-written list of one entry could not have covered any of that.
    const forbidden = derivedForbidden(config, 'code-break');
    expect(forbidden).toContain('suite');
    expect(forbidden).toContain('docs/**/*.md');
    expect(forbidden).toContain(PACKAGE_ROOT_GLOB);
    expect(forbidden).toContain('lib/**');
    expect(forbidden).not.toContain('src/**');
  });

  it('forbids every source glob on a branch that was granted none', () => {
    const { config } = load({
      corpus: { root: 'suite' },
      subject: { source: ['src/**', 'lib/**'], docs: ['docs/**/*.md'] },
    });
    for (const branch of REPAIR_BRANCH_NAMES) {
      const forbidden = derivedForbidden(config, branch);
      // `suite` and `suite/**` both, because `matchesGlob` treats a bare directory as
      // a literal path: a forbidden set carrying only `suite` names the directory and
      // none of the `*_test.md` files in it, and the files are the reason the corpus
      // is forbidden at all.
      expect(forbidden).toEqual([
        'suite',
        'suite/**',
        'docs/**/*.md',
        PACKAGE_ROOT_GLOB,
        'src/**',
        'lib/**',
      ]);
    }
  });

  it('reports any other unknown key in a fence rather than ignoring it silently', () => {
    const { sink } = load({ fences: { 'docs-lie': { allow: [], autonomy: 'full' } } });
    expect(
      messages(sink, CONFIG_DIAGNOSTIC_CODES.fieldInvalid).some((message) =>
        message.includes('fences.docs-lie.autonomy'),
      ),
    ).toBe(true);
  });
});

describe('the fence intersection guard refuses at load time (§20.3, R15.7, R15.8)', () => {
  // The two Kane budgets and the router are spelled out so `loaded` is a statement
  // about the fence alone: §13.1 has always warned when either budget is missing.
  const CLAIM_CONFIG = {
    verdictRouter: 'resultCode740',
    memberDebug: false,
    timeouts: { hookMs: 300_000, enrichmentMs: 60_000 },
    corpus: { root: 'suite' },
    subject: { source: ['src/**/*.ts'], docs: ['docs/**/*.md', 'README.md'] },
  };

  /** Every spelling of "this fence can reach a claim" the design calls out. */
  const reaching: readonly { readonly glob: string; readonly why: string }[] = [
    { glob: '**', why: 'the everything glob of §20.3' },
    { glob: '**/*', why: 'the same thing, spelled the other way' },
    { glob: 'suite/**', why: 'the corpus root itself' },
    { glob: 'suite', why: 'the corpus directory, with no trailing glob' },
    { glob: 'suite/checkout_test.md', why: 'one test document' },
    { glob: 'docs/**/*.md', why: 'a documentation glob, verbatim' },
    { glob: 'docs/product.md', why: 'one document under a documentation glob' },
    { glob: 'README.md', why: 'the default documentation file' },
    { glob: '*.md', why: 'a wildcard whose prefix is a documentation glob prefix' },
    { glob: 'docs/**', why: 'a prefix relationship, the allow glob being wider' },
    { glob: 'src/../suite/**', why: 'a parent traversal reaching the corpus root' },
    { glob: '../repo/suite/**', why: 'a traversal that leaves the repository root' },
  ];

  for (const { glob, why } of reaching) {
    it(`empties code-break and reports an error for '${glob}': ${why}`, () => {
      const { config, loaded, sink } = load({
        ...CLAIM_CONFIG,
        fences: { 'code-break': { allow: [glob, 'src/**/*.ts'] } },
      });

      // The refusal. Not an exception, not an abandoned load: an empty allow set,
      // so the branch keeps its verdict and loses its write autonomy.
      expect(config.fences['code-break'].allow).toEqual([]);
      expect(loaded).toBe(false);

      const errors = sink.withCode(CONFIG_DIAGNOSTIC_CODES.fenceIntersectsClaims);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.every((diagnostic) => diagnostic.severity === 'error')).toBe(true);
      // The rejection names the intersecting glob (R15.8).
      expect(errors.some((diagnostic) => diagnostic.message.includes(glob))).toBe(true);
    });
  }

  it('leaves a fence that reaches only source alone', () => {
    const { config, loaded, sink } = load({
      ...CLAIM_CONFIG,
      fences: { 'code-break': { allow: ['src/**/*.ts', 'src/lib/**'] } },
    });

    expect(loaded).toBe(true);
    expect(config.fences['code-break'].allow).toEqual(['src/**/*.ts', 'src/lib/**']);
    expect(sink.has(CONFIG_DIAGNOSTIC_CODES.fenceIntersectsClaims)).toBe(false);
    expect(fenceFindings(config)).toEqual([]);
  });

  it('backs every finding with a path the repository matcher agrees on', () => {
    const { config } = load({
      ...CLAIM_CONFIG,
      fences: { 'test-drift': { allow: ['suite/**', 'docs/**/*.md'] } },
    });
    const findings = fenceFindings(config);
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      // The claim surface a finding names is one the matcher confirms: a corpus
      // finding is checked against `<root>/**` because a directory reaches
      // everything beneath it.
      const claim = finding.kind === 'corpus' ? `${finding.collidesWith}/**` : finding.collidesWith;
      const witnesses = ['suite/checkout_test.md', 'suite', 'docs/product.md', 'README.md'];
      expect(
        witnesses.some(
          (path) => matchesGlob(finding.allowGlob, path) && matchesGlob(claim, path),
        ),
      ).toBe(true);
    }
  });

  it('reports the other two branches without disarming them', () => {
    // `test-drift`'s whole job is editing the corpus, so a finding there is
    // information. Only `code-break` is enforced, because only `code-break` is the
    // branch that would be turning a red promise green by rewriting its claim.
    const { config, loaded, sink } = load({
      ...CLAIM_CONFIG,
      fences: { 'test-drift': { allow: ['suite/**'] } },
    });

    expect(config.fences['test-drift'].allow).toEqual(['suite/**']);
    expect(loaded).toBe(true);
    expect(sink.has(CONFIG_DIAGNOSTIC_CODES.fenceIntersectsClaims)).toBe(false);
    expect(fenceFindings(config)).toEqual([
      { branch: 'test-drift', allowGlob: 'suite/**', collidesWith: 'suite', kind: 'corpus' },
    ]);
  });

  it('finds nothing in the built-in defaults, which is why they are the quiet ones', () => {
    expect(fenceFindings(DEFAULT_CONFIG)).toEqual([]);
  });

  it('cannot be made slow by a pathological glob', () => {
    const started = Date.now();
    const { config } = load({
      ...CLAIM_CONFIG,
      fences: { 'code-break': { allow: [`${'*a'.repeat(24)}/**`] } },
    });
    // A guard a config file can make hang is a guard a config file can switch off.
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(config.fences['code-break'].allow.length).toBeLessThanOrEqual(1);
  });
});
