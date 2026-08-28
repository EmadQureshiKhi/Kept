import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The packages install and run outside this workspace (task 25.3, design §22.3,
 * R17.3, R17.5, R17.9, R17.10).
 *
 * ## Why this test exists when `packaging.test.ts` already packs
 *
 * `packaging.test.ts` reads the archive's file list. That catches a stale `dist`
 * and a polluted one, and it cannot catch the failure this file exists for: a
 * package whose *contents* are correct and whose *dependency set* is not. Inside
 * this workspace every import resolves, because Node walks up from the importing
 * file and finds the root `node_modules` that the repository installed for its own
 * apps and tooling. From the registry there is no root `node_modules` to find. The
 * two states are indistinguishable from any test that runs inside the tree.
 *
 * So the installation is the assertion, and its **location** is the whole test:
 *
 * 1. both packages are packed for real, into a temporary directory,
 * 2. both tarballs are installed into a *second* temporary directory under
 *    `os.tmpdir()`, which is outside the workspace root and carries no
 *    `node_modules` at any level above it, a fact this file measures rather than
 *    assumes, by walking every ancestor to the filesystem root,
 * 3. the installed `kept` binary is run from that directory, with a `PATH`
 *    containing one entry: a directory holding a single symlink to `node`,
 * 4. and every module the run resolves is recorded, so "no module resolves from
 *    this workspace" is a measurement of the real module graph and not an
 *    inference from where the process was started.
 *
 * ## The Kane-free directory, proved rather than assumed
 *
 * R17.10 asks for exit code 0 "in a directory containing no Kept_Config and no
 * Kane_CLI". On a machine with Kane installed, such as the author's, which carries
 * `kane-cli` 0.8.4 on `PATH`, an assertion about a missing binary is vacuous
 * unless the sandbox is shown to be what removed it. Setting `PATH` to the Node
 * bin directory would not do it: that is exactly where `kane-cli` lives under nvm.
 *
 * So {@link Harness.ambientKane} records whether `kane-cli` answers under the
 * *inherited* environment, {@link Harness.sandboxKane} records what it does under
 * the child environment, and the test asserts the pair: unreachable in the
 * sandbox, and reachable outside it whenever the machine has Kane at all. On a
 * machine without Kane the second half is annotated as unprovable rather than
 * silently skipped. `KEPT_KANE_BIN`, the environment override the invoker consults
 * ahead of `PATH`, is absent from the child environment by construction, since
 * that environment is built key by key rather than spread from `process.env`.
 *
 * ## Nothing is thrown from the hook
 *
 * Every step records its outcome and the assertions read those records. A pack
 * that fails, an install that fails and a binary that crashes on its first import
 * are each a *named* failing assertion rather than a hook that exploded, which is
 * the same reason `kept doctor` reports seven statuses instead of throwing on the
 * first thing it cannot find.
 */

/** The workspace root, resolved through symlinks so containment is comparable. */
const REPO_ROOT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));

/** The two packages that publish, by their directory under `packages/`. */
const PACKAGES = ['kept-core', 'kept-cli'] as const;
type PackageDir = (typeof PACKAGES)[number];

const packageDir = (dir: PackageDir): string => resolve(REPO_ROOT, 'packages', dir);

/** The build that fills `dist`, named in full so a failure message is actionable. */
const BUILD_COMMAND = 'npx tsc -b';

/** The compiled entry point that carries the `bin` shebang. */
const CLI_ENTRY = resolve(packageDir('kept-cli'), 'dist/index.js');

/**
 * The version both manifests and `KEPT_VERSION` carry. Written as a literal as well
 * as read from the manifest, because R17.10 is a claim about what an installer sees,
 * and two authorities that must agree cannot both drift unnoticed.
 *
 * `0.1.1` rather than `0.1.0`: the first release went out with `kept-core`'s README
 * telling installers to `npm install kept-cli` and run `npx kept init`, neither of
 * which resolves, because the CLI published as `@corgod/kept-cli`. npm serves the
 * newest version's README on the package page, so a patch release is what corrects
 * what a visitor actually reads.
 */
const EXPECTED_VERSION = '0.1.1';

/**
 * Kane's binary name and the environment override that outranks `PATH`, both
 * duplicated here rather than imported from `kept-core`.
 *
 * Deliberate. This file asserts what an *installed* package does, so importing the
 * workspace copy of the constant it is testing against would let a rename make the
 * sandbox agree with the code while disagreeing with the binary on disk.
 */
const KANE_BINARY_NAME = 'kane-cli';
const KANE_BINARY_ENV_VAR = 'KEPT_KANE_BIN';

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

/** The remedy R17.10's stranger's directory should be pointed at. */
const INIT_REMEDY = 'kept init';

// ---------------------------------------------------------------------------
// Running a child, without ever throwing
// ---------------------------------------------------------------------------

/** One child process, as data. A crash is a field, not an exception. */
interface ChildOutcome {
  readonly argv: readonly string[];
  readonly status: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Why the process could not be started at all. `ENOENT` when not found. */
  readonly spawnError: string | null;
}

interface RunOptions {
  readonly cwd?: string | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly timeoutMs?: number | undefined;
}

/**
 * `spawnSync`, with every failure turned into a field.
 *
 * `spawnSync` rather than `execFileSync`, which throws on a non-zero exit and
 * would make "the binary crashed" indistinguishable from "the test harness is
 * broken", and the crash is a result this file has to be able to report.
 */
function run(
  command: string,
  argv: readonly string[],
  options: RunOptions = {},
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
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    spawnError: error === undefined ? null : (error.code ?? error.message),
  };
}

/**
 * Turn `ERR_MODULE_NOT_FOUND` into the sentence that names the defect.
 *
 * Node's own message says which specifier failed and which file asked for it, and
 * stops there. What a reader needs is the *manifest* that should have declared it,
 * because the fix is one line in a `dependencies` block and the symptom is a stack
 * trace forty lines long. Without this, the most important failure in this file
 * reads like a broken test harness.
 */
function undeclaredDependency(outcome: ChildOutcome): string | null {
  const match = /Cannot find package '([^']+)' imported from (\S+)/.exec(outcome.stderr);
  if (match === null) return null;
  const [, specifier = '', importer = ''] = match;
  const owner = /node_modules\/(@[^/]+\/[^/]+|[^/@][^/]*)\//.exec(importer)?.[1] ?? 'the package';
  return (
    `\n\nDiagnosis: ${owner} imports '${specifier}' and no manifest in the installation ` +
    `declares it. Inside this workspace that import resolves from the root node_modules, which ` +
    `is why every other test in this repository passes. From the registry there is nothing above ` +
    `the installation to resolve it from. Fix: add '${specifier}' to ${owner}'s dependencies ` +
    `(R17.9).\nImporter: ${importer}`
  );
}

/** A one-line summary, for the message a future failure is read from. */
const describeOutcome = (outcome: ChildOutcome): string =>
  `\`${outcome.argv.join(' ')}\` exited ${String(outcome.status)}` +
  `${outcome.signal === null ? '' : ` on ${outcome.signal}`}` +
  `${outcome.spawnError === null ? '' : ` (spawn error ${outcome.spawnError})`}` +
  `${outcome.stderr.trim().length === 0 ? '' : `\nstderr:\n${outcome.stderr.trim().slice(0, 1200)}`}` +
  `${undeclaredDependency(outcome) ?? ''}`;

// ---------------------------------------------------------------------------
// Containment, measured
// ---------------------------------------------------------------------------

/** `child` is `parent` or lives under it. Both are expected to be real paths. */
function isUnder(child: string, parent: string): boolean {
  const a = resolve(child);
  const b = resolve(parent);
  return a === b || a.startsWith(`${b}${sep}`);
}

/** A directory and every ancestor of it, up to the filesystem root. */
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
// The harness
// ---------------------------------------------------------------------------

/** Everything the hook measured. Read-only, so an assertion cannot mutate it. */
interface Harness {
  readonly packDir: string;
  readonly installDir: string;
  /** The single-entry `PATH` the child runs with. Holds one symlink to `node`. */
  readonly sandboxBin: string;
  readonly sandboxNode: string;
  readonly childEnv: Readonly<Record<string, string>>;
  /** Ancestors of the install directory that carry a `node_modules`. Expected empty. */
  readonly ancestorsCarryingNodeModules: readonly string[];
  readonly pack: Readonly<Record<PackageDir, ChildOutcome>>;
  /** Absolute tarball paths, or null when the pack produced no readable filename. */
  readonly tarballs: Readonly<Record<PackageDir, string | null>>;
  readonly install: ChildOutcome | null;
  /** Whether `kane-cli` answers under the inherited environment, and what it said. */
  readonly ambientKane: { readonly reachable: boolean; readonly version: string | null };
  readonly sandboxKane: ChildOutcome;
  readonly keptBin: string;
  readonly versionRun: ChildOutcome;
  readonly bareRun: ChildOutcome;
  readonly doctorJsonRun: ChildOutcome;
  readonly doctorTextRun: ChildOutcome;
  readonly coreResolveRun: ChildOutcome;
  /** Every module URL the traced `doctor` run resolved, in resolution order. */
  readonly resolvedUrls: readonly string[];
  readonly tracedDoctorRun: ChildOutcome;
}

let harness: Harness | null = null;

/** The hook's measurements, or a legible failure if the hook never got there. */
function fixture(): Harness {
  if (harness === null) throw new Error('The install harness did not run.');
  return harness;
}

/** `npm pack --json` reports an array of one report per packed package. */
interface PackReport {
  readonly filename: string;
  readonly name: string;
  readonly version: string;
}

/** Slice the JSON array out of npm's stdout, so a stray notice cannot break the parse. */
function packFilename(outcome: ChildOutcome): string | null {
  const start = outcome.stdout.indexOf('[');
  const end = outcome.stdout.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const reports = JSON.parse(outcome.stdout.slice(start, end + 1)) as readonly PackReport[];
    const filename = reports[0]?.filename;
    return typeof filename === 'string' && filename.length > 0 ? filename : null;
  } catch {
    return null;
  }
}

/**
 * The resolve-hook pair, written into the install directory.
 *
 * `module.register` puts a resolve hook on the loader thread, so every ESM
 * specifier the installed binary resolves is appended to a log with its final URL.
 * That is what turns "no module resolves from this workspace" from a claim about
 * the process's working directory into a list of file URLs that can be checked one
 * by one. The log path is handed over through `register`'s `data`, because the
 * hook runs on its own thread and inheriting it from the environment would be one
 * more thing to be wrong about.
 */
function writeResolveTracer(installDir: string): { readonly registerPath: string; readonly logPath: string } {
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
      '      /* a log this test cannot write is this test\'s problem, not the run\'s */',
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
  // `files: ["dist"]` makes the build a precondition of packing. Build only when
  // `dist` is missing, so a green run stays as fast as it can be.
  if (!existsSync(CLI_ENTRY)) {
    run('npx', ['tsc', '-b'], { cwd: REPO_ROOT, timeoutMs: 600_000 });
  }

  // `realpathSync` on the way in, because macOS reports `/var/folders/...` for a
  // directory whose real path is `/private/var/folders/...`, and a containment
  // check between the two spellings would answer the wrong question.
  const temp = realpathSync(tmpdir());
  const packDir = mkdtempSync(join(temp, 'kept-pack-'));
  const installDir = mkdtempSync(join(temp, 'kept-install-'));

  const ancestorsCarryingNodeModules = ancestorsOf(installDir).filter((directory) =>
    existsSync(join(directory, 'node_modules')),
  );

  // One directory, one symlink, one `PATH` entry. Not the Node bin directory:
  // under nvm that is exactly where `kane-cli` is installed, so pointing `PATH`
  // at it would leave Kane reachable and make the R17.10 assertion vacuous.
  const sandboxBin = join(installDir, 'sandbox-bin');
  mkdirSync(sandboxBin, { recursive: true });
  const sandboxNode = join(sandboxBin, 'node');
  symlinkSync(process.execPath, sandboxNode);

  // Built key by key rather than spread from `process.env`, so `KEPT_KANE_BIN`,
  // `NODE_PATH` and `NODE_OPTIONS` are absent by construction rather than deleted
  // by a line somebody could remove. `HOME` points into the sandbox so nothing the
  // child reads can come from the author's home directory.
  const childEnv: Readonly<Record<string, string>> = Object.freeze({
    PATH: sandboxBin,
    HOME: installDir,
    TMPDIR: temp,
  });

  const ambient = run(KANE_BINARY_NAME, ['--version'], { timeoutMs: 30_000 });
  const ambientKane = {
    reachable: ambient.spawnError === null && ambient.status === 0,
    version: ambient.stdout.trim().length > 0 ? ambient.stdout.trim().split(/\r?\n/)[0] ?? null : null,
  };
  const sandboxKane = run(KANE_BINARY_NAME, ['--version'], {
    env: childEnv,
    timeoutMs: 30_000,
  });

  // ── Pack both packages for real. Tarballs, not `--dry-run`. ────────────────
  const pack: Record<PackageDir, ChildOutcome> = {} as Record<PackageDir, ChildOutcome>;
  const tarballs: Record<PackageDir, string | null> = {} as Record<PackageDir, string | null>;
  for (const dir of PACKAGES) {
    const outcome = run('npm', ['pack', '--pack-destination', packDir, '--json'], {
      cwd: packageDir(dir),
      timeoutMs: 300_000,
    });
    pack[dir] = outcome;
    const filename = packFilename(outcome);
    tarballs[dir] = filename === null ? null : join(packDir, filename);
  }

  // ── Install both tarballs, and nothing else. ───────────────────────────────
  //
  // Nothing else is the point. A test that added the packages' missing runtime
  // dependencies by hand would install a package the registry does not serve, and
  // would report success for the exact defect R17.9 exists to find.
  writeFileSync(
    join(installDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'kept-install-probe',
        version: '0.0.0',
        private: true,
        description: 'A stranger\u2019s directory. Nothing here but the two tarballs under test.',
      },
      null,
      2,
    )}\n`,
    { encoding: 'utf8' },
  );

  const orderedTarballs = [tarballs['kept-core'], tarballs['kept-cli']].filter(
    (path): path is string => path !== null,
  );
  const install =
    orderedTarballs.length === PACKAGES.length
      ? run(
          'npm',
          ['install', '--prefix', installDir, '--no-audit', '--no-fund', ...orderedTarballs],
          { cwd: installDir, timeoutMs: 600_000 },
        )
      : null;

  // ── Run the installed binary from the install directory. ───────────────────
  const keptBin = join(installDir, 'node_modules', '.bin', 'kept');
  const child = (argv: readonly string[], env: Readonly<Record<string, string>> = childEnv) =>
    run(keptBin, argv, { cwd: installDir, env, timeoutMs: 120_000 });

  const versionRun = child(['--version']);
  const bareRun = child([]);
  const doctorJsonRun = child(['doctor', '--json']);
  const doctorTextRun = child(['doctor']);

  const tracer = writeResolveTracer(installDir);
  const tracedDoctorRun = child(['doctor', '--json'], {
    ...childEnv,
    NODE_OPTIONS: `--import=${pathToFileURL(tracer.registerPath).href}`,
  });
  let resolvedUrls: readonly string[] = [];
  try {
    resolvedUrls = Object.freeze(
      readFileSync(tracer.logPath, { encoding: 'utf8' }).split(/\r?\n/).filter((line) => line.length > 0),
    );
  } catch {
    resolvedUrls = Object.freeze([]);
  }

  // An independent second opinion on R17.3, asked of Node's own resolver from the
  // install directory rather than read out of the trace.
  const coreResolveRun = run(
    sandboxNode,
    ['--input-type=module', '-e', "console.log(import.meta.resolve('kept-core'))"],
    { cwd: installDir, env: childEnv, timeoutMs: 60_000 },
  );

  harness = Object.freeze({
    packDir,
    installDir,
    sandboxBin,
    sandboxNode,
    childEnv,
    ancestorsCarryingNodeModules: Object.freeze(ancestorsCarryingNodeModules),
    pack: Object.freeze(pack),
    tarballs: Object.freeze(tarballs),
    install,
    ambientKane: Object.freeze(ambientKane),
    sandboxKane,
    keptBin,
    versionRun,
    bareRun,
    doctorJsonRun,
    doctorTextRun,
    coreResolveRun,
    resolvedUrls,
    tracedDoctorRun,
  });
}, 1_800_000);

afterAll(() => {
  const current = harness;
  if (current === null) return;
  // Both directories go, whatever happens to the first removal. That is what the
  // `finally` is for: a pack directory that refuses to delete must not leave a
  // node_modules tree behind in the system temporary directory.
  try {
    rmSync(current.packDir, { recursive: true, force: true });
  } finally {
    rmSync(current.installDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// What the installed archives import, read off the installed archives
// ---------------------------------------------------------------------------

/** Every `.js` file under a directory, recursively. */
function jsFilesUnder(root: string): readonly string[] {
  const found: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0) {
    const directory = queue.shift() as string;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) queue.push(path);
      else if (entry.isFile() && entry.name.endsWith('.js')) found.push(path);
    }
  }
  return found.sort();
}

/** `yaml` from `yaml/util`, `@scope/name` from `@scope/name/sub`. */
function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) return parts.slice(0, 2).join('/');
  return parts[0] ?? specifier;
}

/**
 * The four spellings a compiled module names a dependency with.
 *
 * `from 'x'` requires whitespace before the quote, which is what keeps
 * `Array.from('x')` out: a method call puts `(` there, not a space.
 */
const SPECIFIER_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bfrom\s+['"]([^'"\n]+)['"]/g,
  /^\s*import\s+['"]([^'"\n]+)['"]/gm,
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"\n]+)['"]/g,
]);

/** npm's own name grammar, so a scan cannot report `, ` as a dependency. */
const PACKAGE_NAME = /^(?:@[a-z0-9~][a-z0-9-._~]*\/)?[a-z0-9~][a-z0-9-._~]*$/;

/**
 * The bare specifiers a compiled tree imports, mapped to the file that imports
 * them.
 *
 * A text scan of the *installed* `dist`, which is the published bytes rather than
 * the source they were compiled from. `node:` prefixed builtins and relative paths
 * are not dependencies and are dropped.
 */
function importedPackages(distRoot: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const file of jsFilesUnder(distRoot)) {
    let text: string;
    try {
      text = readFileSync(file, { encoding: 'utf8' });
    } catch {
      continue;
    }
    for (const pattern of SPECIFIER_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const specifier = match[1] ?? '';
        if (specifier.length === 0) continue;
        if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
        if (specifier.startsWith('node:')) continue;
        const name = packageNameOf(specifier);
        // The name filter is what keeps a text scan honest. Without it, a `from`
        // inside a comment or a `.join(', ')` two characters from a quote arrives
        // as a dependency named `, ` and the real finding drowns in noise.
        if (!PACKAGE_NAME.test(name)) continue;
        if (!found.has(name)) found.set(name, file);
      }
    }
  }
  return found;
}

/** Node builtins a compiled file may name without the `node:` prefix. */
const BARE_BUILTINS = new Set(builtinModules);

describe('the installed archives declare everything they import (R17.9)', () => {
  it.each(PACKAGES)('packages/%s declares every package it imports', (dir) => {
    const { installDir } = fixture();
    const manifestName = dir === 'kept-core' ? 'kept-core' : '@corgod/kept-cli';
    const packageRoot = join(installDir, 'node_modules', ...manifestName.split('/'));
    expect(
      existsSync(packageRoot),
      `${manifestName} is not installed at ${packageRoot}, so its imports cannot be read.`,
    ).toBe(true);

    const manifest = JSON.parse(
      readFileSync(join(packageRoot, 'package.json'), { encoding: 'utf8' }),
    ) as { readonly dependencies?: Readonly<Record<string, string>> };
    const declared = new Set(Object.keys(manifest.dependencies ?? {}));

    const undeclared = [...importedPackages(join(packageRoot, 'dist'))]
      .filter(([name]) => !declared.has(name) && !BARE_BUILTINS.has(name))
      .map(([name, file]) => `${name} (imported by ${file.slice(packageRoot.length + 1)})`);

    expect(
      undeclared,
      `${manifestName} imports ${undeclared.length} package${
        undeclared.length === 1 ? '' : 's'
      } it does not declare: ${undeclared.join('; ')}.\n\n` +
        `This is the defect §22.3 was written to find, and it is invisible everywhere else in ` +
        `this repository: inside the workspace these imports resolve from the root ` +
        `node_modules, so every unit test, the packaging test and \`npm run check\` all pass. ` +
        `An installer has nothing above the installation to resolve them from, so the binary ` +
        `dies on its first import. Fix: declare them in packages/${dir}/package.json.`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The location is the whole test (R17.9)
// ---------------------------------------------------------------------------

describe('the install directory is somewhere the workspace cannot help (R17.9)', () => {
  it('is outside the workspace root', () => {
    const { installDir, packDir } = fixture();
    expect(
      isUnder(installDir, REPO_ROOT),
      `The install directory ${installDir} is under the workspace root ${REPO_ROOT}. Inside it, ` +
        `Node's resolution walks up and finds everything, so this whole file would pass while ` +
        `the published package was broken (§22.3).`,
    ).toBe(false);
    expect(isUnder(packDir, REPO_ROOT)).toBe(false);
  });

  it('has no node_modules at any level above it', async ({ annotate }) => {
    const { installDir, ancestorsCarryingNodeModules } = fixture();
    await annotate(
      `walked ${ancestorsOf(installDir).length} directories from ${installDir} to the ` +
        `filesystem root`,
      'notice',
    );
    expect(
      ancestorsCarryingNodeModules,
      `A node_modules directory sits above the install directory: ` +
        `${ancestorsCarryingNodeModules.join(', ')}. Node resolves upward, so an import the ` +
        `published package failed to declare would be satisfied from there and this test would ` +
        `report a package that installs cleanly (R17.9).`,
    ).toEqual([]);
  });

  it('packed both tarballs for real', () => {
    const { pack, tarballs } = fixture();
    for (const dir of PACKAGES) {
      const outcome = pack[dir];
      expect(outcome.status, `Packing packages/${dir} failed. ${describeOutcome(outcome)}`).toBe(0);
      const tarball = tarballs[dir];
      expect(tarball, `\`npm pack\` in packages/${dir} reported no filename.`).not.toBeNull();
      expect(
        tarball !== null && existsSync(tarball),
        `${tarball ?? 'the tarball'} was not written. Run \`${BUILD_COMMAND}\` and pack again.`,
      ).toBe(true);
    }
  });

  it('installed both tarballs and linked the kept binary (R17.5)', () => {
    const { install, keptBin } = fixture();
    expect(install, 'Both tarballs must exist before an install can be attempted.').not.toBeNull();
    expect(
      install?.status,
      `Installing the two tarballs failed. ${install === null ? '' : describeOutcome(install)}`,
    ).toBe(0);
    expect(
      existsSync(keptBin),
      `${keptBin} does not exist, so the installation linked no \`kept\` binary and a global ` +
        `install would link a missing file (R17.5).`,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The Kane-free directory, proved (R17.10)
// ---------------------------------------------------------------------------

describe(`\`${KANE_BINARY_NAME}\` is genuinely unreachable in the child (R17.10)`, () => {
  it('is not on the child PATH, and the machine is asked whether that means anything', async ({
    annotate,
  }) => {
    const { sandboxKane, ambientKane, sandboxBin } = fixture();
    expect(
      sandboxKane.spawnError,
      `\`${KANE_BINARY_NAME} --version\` started under the child environment, so the directory ` +
        `\`kept doctor\` is diagnosed in is not Kane-free and R17.10's claim is not being ` +
        `tested. ${describeOutcome(sandboxKane)}`,
    ).toBe('ENOENT');
    expect(sandboxKane.status).toBeNull();

    if (ambientKane.reachable) {
      await annotate(
        `${KANE_BINARY_NAME} answers ${ambientKane.version ?? 'no version'} under the inherited ` +
          `environment and ENOENT under PATH=${sandboxBin}, so the sandbox is what removed it`,
        'notice',
      );
    } else {
      await annotate(
        `${KANE_BINARY_NAME} does not answer under the inherited environment either, so this ` +
          `machine cannot demonstrate that the sandbox is what removed it. The assertion holds ` +
          `and its strength is limited by the machine, not by the test`,
        'warning',
      );
    }
  });

  it('carries no environment override that would outrank the empty PATH', () => {
    const { childEnv } = fixture();
    expect(
      Object.keys(childEnv),
      `The child environment must be built key by key so ${KANE_BINARY_ENV_VAR}, NODE_PATH and ` +
        `NODE_OPTIONS are absent by construction.`,
    ).toEqual(['PATH', 'HOME', 'TMPDIR']);
    expect(childEnv[KANE_BINARY_ENV_VAR]).toBeUndefined();
    expect(childEnv['NODE_PATH']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The installed binary runs and reports its version (R17.10)
// ---------------------------------------------------------------------------

describe('the installed binary reports its version (R17.10)', () => {
  it(`prints ${EXPECTED_VERSION} on its first line`, () => {
    const { versionRun } = fixture();
    expect(
      versionRun.status,
      `The installed binary did not run. This is the failure §22.3 exists to catch: nothing ` +
        `inside this workspace can reproduce it, because inside the workspace the import that ` +
        `failed resolves from the root node_modules.\n${describeOutcome(versionRun)}`,
    ).toBe(0);
    const firstLine = versionRun.stdout.split(/\r?\n/, 1)[0] ?? '';
    expect(
      firstLine,
      `The installed binary announced '${firstLine}'. R17.10 has it report the published ` +
        `version, and a binary that says 0.0.0 while the registry serves ${EXPECTED_VERSION} is ` +
        `the first thing a user distrusts.`,
    ).toContain(`kept ${EXPECTED_VERSION}`);
  });

  it('reports the same version both manifests declare', () => {
    const { versionRun } = fixture();
    const manifest = JSON.parse(
      readFileSync(resolve(packageDir('kept-cli'), 'package.json'), { encoding: 'utf8' }),
    ) as { readonly version: string };
    expect(manifest.version).toBe(EXPECTED_VERSION);
    expect(
      versionRun.stdout,
      `The binary reports a version the manifest does not declare, so \`kept --version\` and the ` +
        `registry would disagree the moment either moves.`,
    ).toContain(`kept ${manifest.version}`);
  });

  it('prints the same banner when invoked with no command at all', () => {
    const { bareRun } = fixture();
    expect(bareRun.status, describeOutcome(bareRun)).toBe(0);
    expect(bareRun.stdout).toContain(`kept ${EXPECTED_VERSION}`);
  });
});

// ---------------------------------------------------------------------------
// Diagnosis in a stranger's directory (R17.10)
// ---------------------------------------------------------------------------

interface DoctorCheckPayload {
  readonly id: string;
  readonly status: string;
  readonly detail: string;
  readonly remedy: string | null;
}

interface DoctorPayload {
  readonly command: string;
  readonly checks: readonly DoctorCheckPayload[];
  readonly spawns: number;
}

/** Parse the `--json` payload, sliced by its braces so a notice cannot break it. */
function doctorPayload(outcome: ChildOutcome): DoctorPayload {
  const start = outcome.stdout.indexOf('{');
  const end = outcome.stdout.lastIndexOf('}');
  expect(
    start >= 0 && end > start,
    `\`kept doctor --json\` produced no JSON object. ${describeOutcome(outcome)}`,
  ).toBe(true);
  return JSON.parse(outcome.stdout.slice(start, end + 1)) as DoctorPayload;
}

describe('diagnosis in a directory with no config, no snapshot, no corpus and no Kane (R17.10)', () => {
  it('exits 0', () => {
    const { doctorJsonRun } = fixture();
    expect(
      doctorJsonRun.status,
      `\`kept doctor\` did not exit 0 from the installation. Kane's absence is a supported state ` +
        `(R2.12) and diagnosis is the last command that should report one as a failure.\n` +
        `${describeOutcome(doctorJsonRun)}`,
    ).toBe(0);
    expect(fixture().doctorTextRun.status, describeOutcome(fixture().doctorTextRun)).toBe(0);
  });

  it('reports all seven checks as not-configured', () => {
    const { doctorJsonRun } = fixture();
    const payload = doctorPayload(doctorJsonRun);
    expect(payload.checks.map((check) => check.id)).toEqual([...DOCTOR_CHECK_IDS]);
    const misreported = payload.checks.filter((check) => check.status !== 'not-configured');
    expect(
      misreported.map((check) => `${check.id}: ${check.status} (${check.detail})`),
      `Nothing in this directory has been set up, so every check must say so. 'fail' would tell ` +
        `a first-time installer that something they configured is broken (§22.3).`,
    ).toEqual([]);
  });

  it(`names \`${INIT_REMEDY}\` as a remedy`, () => {
    const { doctorJsonRun, doctorTextRun } = fixture();
    const payload = doctorPayload(doctorJsonRun);
    const naming = payload.checks.filter((check) => (check.remedy ?? '').includes(INIT_REMEDY));
    expect(
      naming.map((check) => check.id),
      `No check named \`${INIT_REMEDY}\` as its remedy. That is the one command that moves this ` +
        `directory forward, and a diagnosis that does not name it has told the reader what is ` +
        `wrong and not what to do (R17.10).`,
    ).not.toEqual([]);
    expect(
      doctorTextRun.stdout,
      `The human-readable diagnosis must name \`${INIT_REMEDY}\` too, since that is the output an ` +
        `installer actually reads.`,
    ).toContain(INIT_REMEDY);
    for (const check of payload.checks) {
      expect(
        (check.remedy ?? '').trim().length,
        `Check '${check.id}' reported '${check.status}' with no remedy.`,
      ).toBeGreaterThan(0);
    }
  });

  it('reports the missing binary rather than spawning a second time', () => {
    const payload = doctorPayload(fixture().doctorJsonRun);
    expect(payload.spawns).toBeLessThanOrEqual(1);
    const kane = payload.checks.find((check) => check.id === 'kane-binary');
    expect(
      kane?.detail,
      `The Kane check must say the binary was not found, since the child PATH holds one entry ` +
        `and it is not Kane's.`,
    ).toContain(KANE_BINARY_NAME);
  });
});

// ---------------------------------------------------------------------------
// No module resolves from this workspace (R17.9, R17.3)
// ---------------------------------------------------------------------------

describe('no module resolves from this workspace (R17.9)', () => {
  it('recorded the module graph of a real run', () => {
    const { resolvedUrls, tracedDoctorRun } = fixture();
    expect(
      resolvedUrls.length,
      `The resolve tracer recorded nothing, so the claim about the module graph would be ` +
        `unmeasured. ${describeOutcome(tracedDoctorRun)}`,
    ).toBeGreaterThan(0);
    expect(
      resolvedUrls.some((url) => url.includes('/node_modules/@corgod/kept-cli/dist/')),
      'The trace must include the installed CLI, or it traced something other than the run.',
    ).toBe(true);
  });

  it('resolved nothing from the workspace root', async ({ annotate }) => {
    const { resolvedUrls, tracedDoctorRun } = fixture();
    const repoUrl = pathToFileURL(REPO_ROOT).href;
    const offenders = resolvedUrls.filter((url) => url.startsWith(repoUrl));
    await annotate(
      `${resolvedUrls.length} module resolutions recorded, ` +
        `${resolvedUrls.filter((url) => !url.startsWith('node:')).length} of them from disk`,
      'notice',
    );
    if (tracedDoctorRun.status !== 0) {
      // Said out loud rather than left for a reader to work out: a run that died
      // at its first unresolvable import resolved less than a healthy one would,
      // so this clause is proved over a truncated graph. It is still a real
      // measurement of what *was* resolved, and it becomes the full graph the
      // moment the run completes.
      await annotate(
        `the traced run exited ${String(tracedDoctorRun.status)}, so the module graph is ` +
          `truncated at the first import it could not resolve and this clause is proved over ` +
          `what was resolved before that point`,
        'warning',
      );
    }
    expect(
      [...new Set(offenders)],
      `The installed binary resolved modules from ${REPO_ROOT}. A dependency the workspace ` +
        `happens to provide is a dependency the registry does not, and this is the hoisting ` +
        `§22.3's last clause exists to catch.`,
    ).toEqual([]);
  });

  it('resolved every file module from inside the installation', () => {
    const { resolvedUrls, installDir } = fixture();
    const installUrl = pathToFileURL(installDir).href;
    const strays = resolvedUrls.filter(
      (url) => !url.startsWith('node:') && !url.startsWith(installUrl),
    );
    expect(
      [...new Set(strays)],
      `Modules resolved from outside the installation. Whether they came from this workspace or ` +
        `from a global root, they are not in the tarballs and an installer would not have them.`,
    ).toEqual([]);
  });

  it("resolves `kept-core` under the installation, not from this workspace (R17.3)", () => {
    const { coreResolveRun, installDir } = fixture();
    expect(
      coreResolveRun.status,
      `Node could not resolve kept-core from the installation, so \`^0.1.1\` did not produce a ` +
        `usable core. ${describeOutcome(coreResolveRun)}`,
    ).toBe(0);
    const resolvedUrl = coreResolveRun.stdout.trim();
    const resolvedPath = resolvedUrl.startsWith('file:') ? fileURLToPath(resolvedUrl) : resolvedUrl;
    expect(
      isUnder(resolvedPath, installDir),
      `kept-core resolved to ${resolvedPath}, which is not under ${installDir}. The CLI is ` +
        `reading a core the installation did not install.`,
    ).toBe(true);
    expect(
      isUnder(resolvedPath, REPO_ROOT),
      `kept-core resolved to ${resolvedPath}, inside this workspace. That is the workspace ` +
        `symlink standing in for a registry dependency (R17.3).`,
    ).toBe(false);
    /* Two segments, not three. This read `join('node_modules', '@kept', 'core')` while the
       packages were scoped, and the segments being separate arguments is why a text rename
       could not see it: the string `@kept/core` never appears in this file. The package is
       `kept-core` now, unscoped, because the name `kept` is already taken on the registry
       and npm refuses an organisation colliding with an existing package, so the `@kept`
       scope was never obtainable. */
    expect(resolvedPath).toContain(join('node_modules', 'kept-core'));
  });
});
