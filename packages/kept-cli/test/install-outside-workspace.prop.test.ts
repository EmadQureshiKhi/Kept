import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Feature: kept, Property 35: The packed tarball is installable and self-sufficient
 * (design §Correctness Properties, §22.2, §22.3, R17.3, R17.4, R17.5, R17.9, R17.10).
 *
 * *For any* packed tarball of either package, the archive contains the compiled
 * output and its declarations and contains no test file, no fixture, no evidence
 * pack and no recording directory; and installing both tarballs into a directory
 * outside the workspace yields a `kept` binary that reports its version and
 * completes diagnosis with exit code 0 without resolving a single module from this
 * workspace.
 *
 * ## The instrument, chosen deliberately, and where generation earns its keep
 *
 * "*For any* packed tarball" quantifies over two tarballs. There is no third, and
 * there will not be one until a third package publishes. A `fast-check` property
 * whose generator produced *those two values* would be a loop wearing a
 * quantifier: 100 runs, two distinct inputs, no counterexample the exhaustive
 * assertion would have missed. The install half is worse still: one installation,
 * measured once, because it costs two packs and an install to observe.
 *
 * So this file splits the clause where its own quantifier actually changes shape.
 *
 * **Exhaustive, over the real artefacts.** Both archives' entry lists, both
 * manifests, the shebang on the packed binary, and one real installation outside
 * the workspace, run with Kane off the path. These are facts about two specific
 * objects and they are asserted directly. Sampling them would weaken them.
 *
 * **Generated, over the space of things that must not ship.** This is the half
 * with a real input space, and it is the half `packaging.test.ts` leaves open:
 * that file checks four fixed regexes, so it detects `foo.test.js` and
 * `test/fixtures/x`, and it would not detect `dist/lib/__fixtures__/seed.json`,
 * `dist/nested/output-2026-01/stream.ndjson`, a `node_modules` tree packed by a
 * `files` mistake, or a `.kept/state.json` swept in with the build output. The
 * property below generates path *shapes* across eight categories of forbidden
 * artefact, at generated depths with generated segment names, and asserts that no
 * entry of either real archive has any of those shapes.
 *
 * **The generator is checked before it is trusted.** Every generated path is first
 * asserted to be recognised by its own category's detector. Without that step a
 * detector with a broken pattern would report "no offenders" on both archives and
 * the property would pass by finding nothing because it can see nothing, which is
 * exact failure mode that makes a green property test worthless. So each run proves
 * the detector has teeth on a fresh positive, and only then applies it to the real
 * file lists.
 *
 * **And the denylist is closed with an allowlist.** A denylist can only ever
 * enumerate what somebody thought of. The exhaustive half therefore also asserts
 * the complement: every packed entry is `package.json`, one of the files npm always
 * includes, or a `.js`, `.js.map`, `.d.ts` or `.d.ts.map` under `dist/`. Anything a
 * generator failed to imagine fails there instead.
 *
 * ## Where the install clauses are proved
 *
 * R17.9 and R17.10 are asserted here against a real installation in
 * `os.tmpdir()`, outside the workspace root, with no `node_modules` above it and a
 * `PATH` holding one symlink to `node`. `install-outside-workspace.test.ts` is the
 * fuller account of that installation: the ambient-versus-sandbox Kane proof, the
 * traced module graph, the seven check statuses. This file repeats the load-bearing
 * ones because Property 35 states them, and a property that cited a sibling file
 * for half its clause would not be checking that half.
 */

/** The workspace root, resolved through symlinks so containment is comparable. */
const REPO_ROOT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));

const PACKAGES = ['kept-core', 'kept-cli'] as const;
type PackageDir = (typeof PACKAGES)[number];

const packageDir = (dir: PackageDir): string => resolve(REPO_ROOT, 'packages', dir);

/** The compiled entry point that carries the `bin` shebang. */
const CLI_ENTRY = resolve(packageDir('kept-cli'), 'dist/index.js');

/** The version task 25.1 set on both manifests and on `KEPT_VERSION`. */
const EXPECTED_VERSION = '0.1.0';

/** Kane's binary name, duplicated rather than imported. See the sibling file. */
const KANE_BINARY_NAME = 'kane-cli';

/** The seven checks §21.2 lists, in the design's order. */
const DOCTOR_CHECK_IDS = [
  'kane-binary',
  'configuration',
  'corpus',
  'snapshot',
  'subject-reachable',
  'context-store',
  'fences',
] as const;

/** Extensions a compiled artefact may carry. Nothing else belongs under `dist/`. */
const COMPILED_EXTENSIONS = ['.js', '.js.map', '.d.ts', '.d.ts.map'] as const;

/** The files npm includes whatever `files` says, so their presence is not a defect. */
const ALWAYS_PACKED = /^(?:package\.json|readme|licence|license|changelog|notice)(?:\.[a-z]+)?$/i;

// ---------------------------------------------------------------------------
// Running a child, without ever throwing
// ---------------------------------------------------------------------------

interface ChildOutcome {
  readonly argv: readonly string[];
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly spawnError: string | null;
}

function run(
  command: string,
  argv: readonly string[],
  options: {
    readonly cwd?: string | undefined;
    readonly env?: Readonly<Record<string, string>> | undefined;
    readonly timeoutMs?: number | undefined;
  } = {},
): ChildOutcome {
  const result = spawnSync(command, [...argv], {
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 300_000,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: { ...options.env } }),
  });
  const error = result.error as (Error & { readonly code?: string }) | undefined;
  return {
    argv: [command, ...argv],
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    spawnError: error === undefined ? null : (error.code ?? error.message),
  };
}

/** Name the undeclared dependency when a run died at import time. */
function undeclaredDependency(outcome: ChildOutcome): string | null {
  const match = /Cannot find package '([^']+)' imported from (\S+)/.exec(outcome.stderr);
  if (match === null) return null;
  const [, specifier = '', importer = ''] = match;
  const owner = /node_modules\/(@[^/]+\/[^/]+|[^/@][^/]*)\//.exec(importer)?.[1] ?? 'the package';
  return (
    `\n\nDiagnosis: ${owner} imports '${specifier}' and nothing in the installation declares it. ` +
    `Inside this workspace that import resolves from the root node_modules; from the registry ` +
    `there is nothing above the installation to resolve it from. Fix: declare '${specifier}' in ` +
    `${owner}'s dependencies (R17.9).`
  );
}

const describeOutcome = (outcome: ChildOutcome): string =>
  `\`${outcome.argv.join(' ')}\` exited ${String(outcome.status)}` +
  `${outcome.spawnError === null ? '' : ` (spawn error ${outcome.spawnError})`}` +
  `${outcome.stderr.trim().length === 0 ? '' : `\nstderr:\n${outcome.stderr.trim().slice(0, 1200)}`}` +
  `${undeclaredDependency(outcome) ?? ''}`;

function isUnder(child: string, parent: string): boolean {
  const a = resolve(child);
  const b = resolve(parent);
  return a === b || a.startsWith(`${b}${sep}`);
}

function ancestorsOf(directory: string): readonly string[] {
  const chain: string[] = [];
  let current = resolve(directory);
  for (;;) {
    chain.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return chain;
}

// ---------------------------------------------------------------------------
// The eight categories of artefact that must never be in an archive (R17.4)
// ---------------------------------------------------------------------------

/** Characters a generated path segment is built from. */
const SEGMENT_CHARS = ['a', 'b', 'c', 'k', 'n', 't', '1', '2', '-', '_'] as const;

const segmentArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...SEGMENT_CHARS), { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(''));

/** Zero to three leading directories, so nesting is generated rather than fixed. */
const dirsArb: fc.Arbitrary<string> = fc
  .array(segmentArb, { minLength: 0, maxLength: 3 })
  .map((parts) => (parts.length === 0 ? '' : `${parts.join('/')}/`));

/** A generated prefix, sometimes inside `dist/`, because that is where a leak hides. */
const prefixArb: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom('', 'dist/', 'dist/'), dirsArb)
  .map(([root, dirs]) => `${root}${dirs}`);

/**
 * One kind of thing that must not be in a published archive.
 *
 * `matches` is the detector, applied to real archive entries. `arbitrary`
 * generates fresh paths of that shape, which are used twice: to check the detector
 * recognises its own category, and to check the real lists do not contain that
 * literal path.
 */
interface ForbiddenCategory {
  readonly label: string;
  /** Why §22.2 forbids it, so a failure explains itself. */
  readonly because: string;
  readonly matches: (entry: string) => boolean;
  readonly arbitrary: fc.Arbitrary<string>;
}

const hasSegment = (entry: string, predicate: (segment: string) => boolean): boolean =>
  entry.split('/').some(predicate);

const CATEGORIES: readonly ForbiddenCategory[] = Object.freeze([
  {
    label: 'a test file',
    because: 'a consumer installs a package to run it, not to run its author\u2019s suite',
    matches: (entry) => /\.(?:test|spec)\./.test(entry),
    arbitrary: fc
      .tuple(prefixArb, segmentArb, fc.constantFrom('test', 'spec'), fc.constantFrom(...COMPILED_EXTENSIONS, '.ts'))
      .map(([prefix, name, kind, extension]) => `${prefix}${name}.${kind}${extension}`),
  },
  {
    label: 'a test fixture',
    because: 'fixtures are inputs to a suite that is not being shipped',
    matches: (entry) =>
      hasSegment(entry, (segment) =>
        ['test', 'tests', '__tests__', 'fixture', 'fixtures', '__fixtures__'].includes(segment),
      ),
    arbitrary: fc
      .tuple(
        prefixArb,
        fc.constantFrom('test', 'tests', '__tests__', 'fixtures', '__fixtures__'),
        dirsArb,
        segmentArb,
      )
      .map(([prefix, holder, dirs, name]) => `${prefix}${holder}/${dirs}${name}.json`),
  },
  {
    label: 'an evidence pack',
    because: 'a sealed pack is megabytes of HARs and console streams from one run',
    matches: (entry) => /\.evidence(?:\/|$)/.test(entry),
    arbitrary: fc
      .tuple(prefixArb, segmentArb, fc.constantFrom('', 'triage.yaml', 'har/network.har'))
      .map(([prefix, name, inner]) => `${prefix}${name}.evidence${inner === '' ? '' : `/${inner}`}`),
  },
  {
    label: 'a recording directory',
    because: 'an `output-*` tree is one verification run\u2019s scratch space',
    matches: (entry) => hasSegment(entry, (segment) => segment.startsWith('output-')),
    arbitrary: fc
      .tuple(prefixArb, segmentArb, dirsArb, segmentArb)
      .map(([prefix, stamp, dirs, name]) => `${prefix}output-${stamp}/${dirs}${name}.ndjson`),
  },
  {
    label: 'uncompiled TypeScript source',
    because:
      'the archive is the build output; shipping `.ts` alongside it gives a consumer two sources of truth',
    matches: (entry) => entry.endsWith('.ts') && !entry.endsWith('.d.ts'),
    arbitrary: fc
      .tuple(fc.constantFrom('', 'src/', 'dist/'), dirsArb, segmentArb)
      .map(([root, dirs, name]) => `${root}${dirs}${name}.ts`),
  },
  {
    label: 'a nested dependency tree',
    because: 'a packed `node_modules` is the four-megabyte regression §22.4 names',
    matches: (entry) => hasSegment(entry, (segment) => segment === 'node_modules'),
    arbitrary: fc
      .tuple(prefixArb, segmentArb, segmentArb)
      .map(([prefix, dependency, name]) => `${prefix}node_modules/${dependency}/${name}.js`),
  },
  {
    label: 'repository state',
    because:
      '`.kept/` and `.context/` belong to the repository being verified, never to the tool verifying it',
    matches: (entry) => hasSegment(entry, (segment) => ['.kept', '.context', '.git'].includes(segment)),
    arbitrary: fc
      .tuple(prefixArb, fc.constantFrom('.kept', '.context', '.git'), dirsArb, segmentArb)
      .map(([prefix, store, dirs, name]) => `${prefix}${store}/${dirs}${name}.json`),
  },
  {
    label: 'local build or tooling state',
    because: 'a `tsbuildinfo` or a local `.npmrc` is machine state, and an `.env` is a secret',
    matches: (entry) =>
      hasSegment(entry, (segment) =>
        /^(?:tsconfig[^/]*\.json|.*\.tsbuildinfo|\.npmrc|\.env(?:\..+)?|vitest\.config\.[cm]?[jt]s)$/.test(
          segment,
        ),
      ),
    arbitrary: fc
      .tuple(
        prefixArb,
        fc.constantFrom(
          'tsconfig.json',
          'tsconfig.tsbuildinfo',
          '.npmrc',
          '.env',
          '.env.local',
          'vitest.config.ts',
        ),
      )
      .map(([prefix, name]) => `${prefix}${name}`),
  },
]);

/** One generated forbidden path, carried with the category that generated it. */
const forbiddenArb: fc.Arbitrary<{
  readonly category: ForbiddenCategory;
  readonly path: string;
}> = fc.oneof(
  ...CATEGORIES.map((category) => category.arbitrary.map((path) => ({ category, path }))),
);

// ---------------------------------------------------------------------------
// The harness: two real archives and one real installation
// ---------------------------------------------------------------------------

interface PackedFile {
  readonly path: string;
  readonly size: number;
}

interface PackReport {
  readonly name: string;
  readonly version: string;
  readonly filename: string;
  readonly size: number;
  readonly entryCount: number;
  readonly files: readonly PackedFile[];
}

interface Harness {
  readonly packDir: string;
  readonly installDir: string;
  readonly reports: Readonly<Record<PackageDir, PackReport | null>>;
  readonly tarballs: Readonly<Record<PackageDir, string | null>>;
  readonly install: ChildOutcome | null;
  readonly sandboxKane: ChildOutcome;
  readonly versionRun: ChildOutcome;
  readonly doctorRun: ChildOutcome;
  readonly resolvedUrls: readonly string[];
  readonly ancestorsCarryingNodeModules: readonly string[];
}

let harness: Harness | null = null;

function fixture(): Harness {
  if (harness === null) throw new Error('The pack-and-install harness did not run.');
  return harness;
}

function reportFor(dir: PackageDir): PackReport {
  const report = fixture().reports[dir];
  if (report === null) throw new Error(`packages/${dir} produced no pack report.`);
  return report;
}

const entriesOf = (dir: PackageDir): readonly string[] =>
  reportFor(dir).files.map((file) => file.path);

/**
 * `npm pack --json`, writing a real tarball and reporting its file list at the
 * same time. One pack serves both halves of the property.
 */
function pack(dir: PackageDir, packDir: string): { readonly report: PackReport | null; readonly outcome: ChildOutcome } {
  const outcome = run('npm', ['pack', '--pack-destination', packDir, '--json'], {
    cwd: packageDir(dir),
    timeoutMs: 300_000,
  });
  const start = outcome.stdout.indexOf('[');
  const end = outcome.stdout.lastIndexOf(']');
  if (start < 0 || end <= start) return { report: null, outcome };
  try {
    const reports = JSON.parse(outcome.stdout.slice(start, end + 1)) as readonly PackReport[];
    const report = reports[0];
    return { report: report === undefined || !Array.isArray(report.files) ? null : report, outcome };
  } catch {
    return { report: null, outcome };
  }
}

/** The resolve tracer, so "no module from this workspace" is a measurement. */
function writeResolveTracer(installDir: string): {
  readonly registerPath: string;
  readonly logPath: string;
} {
  const directory = join(installDir, 'resolve-trace');
  mkdirSync(directory, { recursive: true });
  const logPath = join(directory, 'resolved.log');
  writeFileSync(
    join(directory, 'hooks.mjs'),
    [
      'import { appendFileSync } from "node:fs";',
      '',
      'let logPath = null;',
      '',
      'export function initialize(data) {',
      '  logPath = data.logPath;',
      '}',
      '',
      'export async function resolve(specifier, context, nextResolve) {',
      '  const result = await nextResolve(specifier, context);',
      '  if (logPath !== null) {',
      '    try {',
      '      appendFileSync(logPath, `${result.url}\\n`);',
      '    } catch {',
      '      /* nothing */',
      '    }',
      '  }',
      '  return result;',
      '}',
      '',
    ].join('\n'),
    { encoding: 'utf8' },
  );
  const registerPath = join(directory, 'register.mjs');
  writeFileSync(
    registerPath,
    [
      'import { register } from "node:module";',
      '',
      'register(new URL("./hooks.mjs", import.meta.url), {',
      `  data: { logPath: ${JSON.stringify(logPath)} },`,
      '});',
      '',
    ].join('\n'),
    { encoding: 'utf8' },
  );
  return { registerPath, logPath };
}

beforeAll(() => {
  if (!existsSync(CLI_ENTRY)) {
    run('npx', ['tsc', '-b'], { cwd: REPO_ROOT, timeoutMs: 600_000 });
  }

  const temp = realpathSync(tmpdir());
  const packDir = mkdtempSync(join(temp, 'kept-p35-pack-'));
  const installDir = mkdtempSync(join(temp, 'kept-p35-install-'));
  const ancestorsCarryingNodeModules = ancestorsOf(installDir).filter((directory) =>
    existsSync(join(directory, 'node_modules')),
  );

  const reports: Record<PackageDir, PackReport | null> = {} as Record<PackageDir, PackReport | null>;
  const tarballs: Record<PackageDir, string | null> = {} as Record<PackageDir, string | null>;
  for (const dir of PACKAGES) {
    const { report } = pack(dir, packDir);
    reports[dir] = report;
    tarballs[dir] = report === null ? null : join(packDir, report.filename);
  }

  // One `PATH` entry, holding one symlink to `node`. Not the Node bin directory,
  // which under nvm is exactly where `kane-cli` lives.
  const sandboxBin = join(installDir, 'sandbox-bin');
  mkdirSync(sandboxBin, { recursive: true });
  symlinkSync(process.execPath, join(sandboxBin, 'node'));
  const childEnv: Readonly<Record<string, string>> = Object.freeze({
    PATH: sandboxBin,
    HOME: installDir,
    TMPDIR: temp,
  });
  const sandboxKane = run(KANE_BINARY_NAME, ['--version'], { env: childEnv, timeoutMs: 30_000 });

  writeFileSync(
    join(installDir, 'package.json'),
    `${JSON.stringify({ name: 'kept-p35-probe', version: '0.0.0', private: true }, null, 2)}\n`,
    { encoding: 'utf8' },
  );

  // Only the two tarballs. Adding their missing runtime dependencies by hand would
  // install a package the registry does not serve.
  const ordered = [tarballs['kept-core'], tarballs['kept-cli']].filter(
    (path): path is string => path !== null,
  );
  const install =
    ordered.length === PACKAGES.length
      ? run('npm', ['install', '--prefix', installDir, '--no-audit', '--no-fund', ...ordered], {
          cwd: installDir,
          timeoutMs: 600_000,
        })
      : null;

  const keptBin = join(installDir, 'node_modules', '.bin', 'kept');
  const tracer = writeResolveTracer(installDir);
  const versionRun = run(keptBin, ['--version'], {
    cwd: installDir,
    env: childEnv,
    timeoutMs: 120_000,
  });
  const doctorRun = run(keptBin, ['doctor', '--json'], {
    cwd: installDir,
    env: { ...childEnv, NODE_OPTIONS: `--import=${pathToFileURL(tracer.registerPath).href}` },
    timeoutMs: 120_000,
  });
  let resolvedUrls: readonly string[] = [];
  try {
    resolvedUrls = Object.freeze(
      readFileSync(tracer.logPath, { encoding: 'utf8' })
        .split(/\r?\n/)
        .filter((line) => line.length > 0),
    );
  } catch {
    resolvedUrls = Object.freeze([]);
  }

  harness = Object.freeze({
    packDir,
    installDir,
    reports: Object.freeze(reports),
    tarballs: Object.freeze(tarballs),
    install,
    sandboxKane,
    versionRun,
    doctorRun,
    resolvedUrls,
    ancestorsCarryingNodeModules: Object.freeze(ancestorsCarryingNodeModules),
  });
}, 1_800_000);

afterAll(() => {
  const current = harness;
  if (current === null) return;
  try {
    rmSync(current.packDir, { recursive: true, force: true });
  } finally {
    rmSync(current.installDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Clause one, generated: nothing forbidden is in either archive (R17.4)
// ---------------------------------------------------------------------------

describe('Feature: kept, Property 35: The packed tarball is installable and self-sufficient', () => {
  it('packs no artefact of any forbidden shape, over generated path shapes (R17.4)', () => {
    const lists = PACKAGES.map((dir) => [dir, entriesOf(dir)] as const);
    fc.assert(
      fc.property(forbiddenArb, ({ category, path }) => {
        // Step one: the detector recognises its own generated positive. Without
        // this, a detector with a broken pattern reports no offenders on both
        // archives and the property passes by being unable to see anything.
        expect(
          category.matches(path),
          `The detector for ${category.label} does not recognise '${path}', which its own ` +
            `generator produced. The property would then pass vacuously on both archives.`,
        ).toBe(true);

        // Step two: no entry of either real archive has that shape.
        for (const [dir, entries] of lists) {
          expect(
            entries,
            `packages/${dir} packs '${path}' verbatim, which is ${category.label}.`,
          ).not.toContain(path);
          const offenders = entries.filter((entry) => category.matches(entry));
          expect(
            offenders,
            `packages/${dir} packs ${category.label}: ${offenders.join(', ')}. ` +
              `${category.because} (R17.4).`,
          ).toEqual([]);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('packs only compiled output and the files npm always includes (R17.4)', () => {
    for (const dir of PACKAGES) {
      const strays = entriesOf(dir).filter((entry) => {
        if (!entry.includes('/')) return !ALWAYS_PACKED.test(entry);
        if (!entry.startsWith('dist/')) return true;
        return !COMPILED_EXTENSIONS.some((extension) => entry.endsWith(extension));
      });
      expect(
        strays,
        `packages/${dir} packs ${strays.length} entr${strays.length === 1 ? 'y' : 'ies'} that is ` +
          `neither compiled output under dist/ nor a file npm always includes: ` +
          `${strays.join(', ')}. This is the allowlist that closes the generated denylist: ` +
          `anything nobody thought to forbid fails here (R17.4).`,
      ).toEqual([]);
    }
  });

  it('packs compiled output and its declarations for both packages (R17.4)', async ({
    annotate,
  }) => {
    for (const dir of PACKAGES) {
      const entries = entriesOf(dir);
      const js = entries.filter((entry) => entry.startsWith('dist/') && entry.endsWith('.js'));
      const declarations = entries.filter(
        (entry) => entry.startsWith('dist/') && entry.endsWith('.d.ts'),
      );
      await annotate(
        `packages/${dir}: ${entries.length} entries, ${js.length} modules, ` +
          `${declarations.length} declaration files`,
        'notice',
      );
      expect(js.length, `packages/${dir} packs no dist/*.js.`).toBeGreaterThan(0);
      expect(
        declarations.length,
        `packages/${dir} packs no dist/*.d.ts, so a TypeScript consumer installs an untyped package.`,
      ).toBeGreaterThan(0);
    }
  });

  // ------------------------------------------------------------------------
  // Clause one, continued: the binary is usable where it lands (R17.5)
  // ------------------------------------------------------------------------

  it('exposes the kept binary with an interpreter directive on line one (R17.5)', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(packageDir('kept-cli'), 'package.json'), { encoding: 'utf8' }),
    ) as { readonly bin?: Readonly<Record<string, string>> };
    const target = manifest.bin?.kept;
    expect(target, '@kept/cli must declare a `kept` bin.').toBeTypeOf('string');
    expect(
      entriesOf('kept-cli'),
      `The kept bin target ${target ?? ''} is not in the archive, so an install links a missing file.`,
    ).toContain(target);
    const firstLine = readFileSync(CLI_ENTRY, { encoding: 'utf8' }).split(/\r?\n/, 1)[0] ?? '';
    expect(
      firstLine.startsWith('#!'),
      `dist/index.js line one is '${firstLine.slice(0, 60)}'. Without an interpreter directive a ` +
        `global install fails with 'Permission denied' (R17.5).`,
    ).toBe(true);
  });

  it("declares a core dependency that resolves from the registry (R17.3)", () => {
    const cli = JSON.parse(
      readFileSync(resolve(packageDir('kept-cli'), 'package.json'), { encoding: 'utf8' }),
    ) as { readonly dependencies?: Readonly<Record<string, string>> };
    const range = cli.dependencies?.['@kept/core'] ?? '';
    for (const protocol of ['workspace:', 'file:', 'link:', 'portal:', '*', '0.0.0']) {
      expect(
        range === protocol || range.startsWith(protocol),
        `@kept/cli's @kept/core range '${range}' uses '${protocol}', which resolves inside this ` +
          `workspace and nowhere else (R17.3).`,
      ).toBe(false);
    }
    expect(range).toMatch(/^[\^~]?\d+\.\d+\.\d+$/);
    expect(range).toContain(reportFor('kept-core').version);
  });

  // ------------------------------------------------------------------------
  // Clause two, exhaustive: one installation, outside the workspace
  // ------------------------------------------------------------------------

  it('installs both tarballs outside the workspace, with no node_modules above (R17.9)', () => {
    const { installDir, ancestorsCarryingNodeModules, install } = fixture();
    expect(
      isUnder(installDir, REPO_ROOT),
      `${installDir} is under ${REPO_ROOT}. Inside the workspace Node resolves upward and finds ` +
        `everything, so this clause would pass while the published package was broken (§22.3).`,
    ).toBe(false);
    expect(
      ancestorsCarryingNodeModules,
      `A node_modules directory sits above the installation: ` +
        `${ancestorsCarryingNodeModules.join(', ')}.`,
    ).toEqual([]);
    expect(install, 'Both tarballs must exist before an install can be attempted.').not.toBeNull();
    expect(
      install?.status,
      `The install failed. ${install === null ? '' : describeOutcome(install)}`,
    ).toBe(0);
  });

  it(`runs ${KANE_BINARY_NAME}-free, which is the state R17.10 diagnoses in`, () => {
    const { sandboxKane } = fixture();
    expect(
      sandboxKane.spawnError,
      `\`${KANE_BINARY_NAME} --version\` started under the child environment, so the diagnosis is ` +
        `not being made in a Kane-free directory and R17.10's claim is untested.`,
    ).toBe('ENOENT');
  });

  it(`reports version ${EXPECTED_VERSION} from the installation (R17.10)`, () => {
    const { versionRun } = fixture();
    expect(
      versionRun.status,
      `The installed binary did not run.\n${describeOutcome(versionRun)}`,
    ).toBe(0);
    expect(versionRun.stdout.split(/\r?\n/, 1)[0] ?? '').toContain(`kept ${EXPECTED_VERSION}`);
  });

  it('completes diagnosis with exit code 0 and a remedy on every check (R17.10)', () => {
    const { doctorRun } = fixture();
    expect(
      doctorRun.status,
      `\`kept doctor\` did not exit 0 from the installation.\n${describeOutcome(doctorRun)}`,
    ).toBe(0);
    const start = doctorRun.stdout.indexOf('{');
    const end = doctorRun.stdout.lastIndexOf('}');
    expect(start >= 0 && end > start, `No JSON payload. ${describeOutcome(doctorRun)}`).toBe(true);
    const payload = JSON.parse(doctorRun.stdout.slice(start, end + 1)) as {
      readonly checks: readonly {
        readonly id: string;
        readonly status: string;
        readonly remedy: string | null;
      }[];
    };
    expect(payload.checks.map((check) => check.id)).toEqual([...DOCTOR_CHECK_IDS]);
    expect(
      payload.checks.filter((check) => check.status !== 'not-configured').map((check) => check.id),
      'Nothing in that directory has been set up, so every check must report not-configured.',
    ).toEqual([]);
    for (const check of payload.checks) {
      expect(
        (check.remedy ?? '').trim().length,
        `Check '${check.id}' reported '${check.status}' with no remedy.`,
      ).toBeGreaterThan(0);
    }
    expect(
      payload.checks.some((check) => (check.remedy ?? '').includes('kept init')),
      'No check named `kept init`, which is the one command that moves that directory forward.',
    ).toBe(true);
  });

  it('resolves not one module from this workspace (R17.9)', () => {
    const { resolvedUrls, installDir, doctorRun } = fixture();
    expect(
      resolvedUrls.length,
      `The resolve tracer recorded nothing, so this clause would be unmeasured. ` +
        `${describeOutcome(doctorRun)}`,
    ).toBeGreaterThan(0);
    const repoUrl = pathToFileURL(REPO_ROOT).href;
    const installUrl = pathToFileURL(installDir).href;
    expect(
      [...new Set(resolvedUrls.filter((url) => url.startsWith(repoUrl)))],
      `The installed binary resolved modules from ${REPO_ROOT}. A dependency the workspace ` +
        `happens to provide is one the registry does not (§22.3).`,
    ).toEqual([]);
    expect(
      [
        ...new Set(
          resolvedUrls.filter((url) => !url.startsWith('node:') && !url.startsWith(installUrl)),
        ),
      ],
      'Modules resolved from outside the installation, so they are not in the tarballs.',
    ).toEqual([]);
  });
});
