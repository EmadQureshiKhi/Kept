import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The tarball is the deliverable, not the manifest (task 25.2, design §22.1, §22.2,
 * §22.4, R17.1, R17.3, R17.4, R17.5, R17.7).
 *
 * Two claims are asserted here, and they fail for different reasons.
 *
 * 1. **The manifests can publish.** `private: true` refuses to publish at all, two
 *    versions that disagree let a CLI resolve an older core than the one it was
 *    built against, and `"@kept/core": "0.0.0"` resolves today only because npm
 *    workspaces symlinks it. From the registry that literal is not a version anyone
 *    can install, so the range is asserted to be a real semver range whose floor is
 *    the core version in this tree.
 * 2. **The archive contains what the archive should contain.** `files: ["dist"]`
 *    means the contents are decided by a build step that runs before packing, so
 *    manifest inspection cannot detect a stale or polluted `dist`. The check packs
 *    for real (`npm pack --dry-run --json`, which reports the file list without
 *    writing a tarball) and reads the list: compiled output present, declarations
 *    present, and nothing matching a test file, a fixture tree, an evidence pack or
 *    a recording directory.
 *
 * The `kept` binary's interpreter directive is checked on line one, because that is
 * the failure that turns a global install into `Permission denied` on a machine
 * that is not the author's — and it is invisible to every other test in this
 * repository, all of which import the module rather than exec the file.
 *
 * The measured packed size and entry count of each package are carried in the
 * assertion messages and emitted on success, against a ceiling well above today's
 * figures. §22.4 wants a future publish that suddenly ships four megabytes to be
 * visible rather than discovered by an installer.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The two packages that publish, by their directory under `packages/`. */
const PACKAGES = ['kept-core', 'kept-cli'] as const;
type PackageDir = (typeof PACKAGES)[number];

const packageDir = (dir: PackageDir): string => resolve(REPO_ROOT, 'packages', dir);

/** The build that fills `dist`, named in full so a skip message is actionable. */
const BUILD_COMMAND = 'npx tsc -b';

/** The compiled entry point that carries the `bin` shebang. */
const CLI_ENTRY = resolve(packageDir('kept-cli'), 'dist/index.js');

/**
 * Four megabytes, the regression §22.4 names. Today's packages are two orders of
 * magnitude under it; the ceiling exists so a `files` mistake that starts shipping
 * `node_modules` or a recording directory fails here rather than on the registry.
 */
const SIZE_CEILING_BYTES = 4 * 1024 * 1024;

/**
 * Nothing packed may match any of these. `.test.` catches both `*.test.ts` and a
 * compiled `*.test.js`; the others are the fixture trees, evidence packs and
 * `output-*` recording directories this repository writes during verification.
 */
const FORBIDDEN: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'a test file', pattern: /\.test\./ },
  { label: 'a test fixture', pattern: /test\/fixtures\// },
  { label: 'an evidence pack', pattern: /\.evidence\// },
  { label: 'a recording directory', pattern: /output-/ },
];

interface PackedFile {
  readonly path: string;
  readonly size: number;
}

interface PackReport {
  readonly name: string;
  readonly version: string;
  readonly filename: string;
  /** Packed (gzipped) bytes, which is what an installer downloads. */
  readonly size: number;
  readonly unpackedSize: number;
  readonly entryCount: number;
  readonly files: readonly PackedFile[];
}

interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly private?: boolean;
  readonly license?: string;
  readonly engines?: Readonly<Record<string, string>>;
  readonly repository?: unknown;
  readonly keywords?: readonly string[];
  readonly description?: string;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
}

const readManifest = (dir: PackageDir | '.'): Manifest => {
  const path = dir === '.' ? resolve(REPO_ROOT, 'package.json') : resolve(packageDir(dir), 'package.json');
  return JSON.parse(readFileSync(path, { encoding: 'utf8' })) as Manifest;
};

const ROOT = readManifest('.');
const CORE = readManifest('kept-core');
const CLI = readManifest('kept-cli');

/**
 * `npm pack --dry-run --json` reports the archive without writing it. The shape on
 * npm 10 is an array of one report per packed package, each carrying `size`,
 * `unpackedSize`, `entryCount` and a `files` array of `{ path, size, mode }`.
 * stderr carries npm's human-readable listing and notices and is discarded; the
 * JSON is sliced out of stdout by its brackets so a stray notice on stdout cannot
 * break the parse.
 */
const pack = (dir: PackageDir): PackReport => {
  const stdout = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: packageDir(dir),
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const start = stdout.indexOf('[');
  const end = stdout.lastIndexOf(']');
  expect(
    start >= 0 && end > start,
    `\`npm pack --dry-run --json\` in packages/${dir} produced no JSON array. ` +
      `Received: ${stdout.slice(0, 400)}`,
  ).toBe(true);
  const reports = JSON.parse(stdout.slice(start, end + 1)) as PackReport[];
  expect(
    reports.length,
    `\`npm pack --dry-run --json\` in packages/${dir} reported ${reports.length} packages, expected 1.`,
  ).toBe(1);
  const report = reports[0] as PackReport;
  expect(
    Array.isArray(report.files),
    `\`npm pack --dry-run --json\` in packages/${dir} reported no file list, so the archive ` +
      `contents cannot be asserted. Keys present: ${Object.keys(report).join(', ')}.`,
  ).toBe(true);
  return report;
};

const REPORTS = new Map<PackageDir, PackReport>();

const reportFor = (dir: PackageDir): PackReport => {
  const report = REPORTS.get(dir);
  if (report === undefined) throw new Error(`No pack report for packages/${dir}.`);
  return report;
};

/** Human-readable kilobytes, for the messages a future regression is read from. */
const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} kB`;

const summarise = (report: PackReport): string =>
  `${report.filename}: ${report.entryCount} entries, ${kb(report.size)} packed, ` +
  `${kb(report.unpackedSize)} unpacked`;

beforeAll(() => {
  // `files: ["dist"]` makes the build a precondition of packing, not an
  // independent step. Build only when `dist` is missing, so a green run stays fast.
  if (!existsSync(CLI_ENTRY)) {
    execFileSync('npx', ['tsc', '-b'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 600_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  for (const dir of PACKAGES) REPORTS.set(dir, pack(dir));
  for (const dir of PACKAGES) console.info(`packaging: ${summarise(reportFor(dir))}`);
}, 900_000);

describe('the manifests can publish (R17.1, R17.7)', () => {
  it('carries no private flag on either package', () => {
    for (const manifest of [CORE, CLI]) {
      expect(
        manifest.private,
        `${manifest.name} declares private, which refuses to publish at all (R17.1).`,
      ).not.toBe(true);
    }
  });

  it('declares the same version on both packages', () => {
    expect(
      CLI.version,
      `@kept/cli is ${CLI.version} while @kept/core is ${CORE.version}. Bump both together, ` +
        `or an install resolves a core the CLI was never built against (R17.7).`,
    ).toBe(CORE.version);
    expect(CORE.version).not.toBe('0.0.0');
  });

  it('states the repository license and node floor on both packages', () => {
    for (const manifest of [CORE, CLI]) {
      expect(manifest.license, `${manifest.name} must state the repository license.`).toBe(
        ROOT.license,
      );
      expect(manifest.engines?.node, `${manifest.name} must state the repository node floor.`).toBe(
        ROOT.engines?.node,
      );
    }
  });

  it('runs a fresh compile before publishing (R17.8)', () => {
    for (const manifest of [CORE, CLI]) {
      expect(
        manifest.scripts?.prepublishOnly,
        `${manifest.name} must compile on the publish path, or a stale dist publishes silently.`,
      ).toBe('tsc -b');
    }
  });
});

describe("the CLI's core dependency resolves from the registry (R17.3)", () => {
  const range = CLI.dependencies?.['@kept/core'];

  it('is declared at all', () => {
    expect(range, '@kept/cli must depend on @kept/core.').toBeTypeOf('string');
  });

  it('is not the bare literal 0.0.0, which resolves only through the workspace symlink', () => {
    expect(
      range,
      `@kept/cli depends on @kept/core@0.0.0. That resolves in this workspace and nowhere else: ` +
        `from the registry an installer receives a CLI whose core import fails (R17.3).`,
    ).not.toBe('0.0.0');
  });

  it('is a registry-resolvable semver range whose floor is the published core version', () => {
    // Local protocols resolve from disk and never from the registry, so any of them
    // is the same defect as `0.0.0` wearing a different hat.
    for (const protocol of ['workspace:', 'file:', 'link:', 'portal:', '*']) {
      expect(
        range?.startsWith(protocol),
        `@kept/cli's @kept/core range '${range ?? ''}' uses '${protocol}', which does not ` +
          `resolve from the public registry.`,
      ).toBe(false);
    }
    const parsed = /^(\^|~|>=)?(\d+)\.(\d+)\.(\d+)$/.exec(range ?? '');
    expect(
      parsed,
      `@kept/cli's @kept/core range '${range ?? ''}' is not a plain semver range. Expected ` +
        `something like '^${CORE.version}'.`,
    ).not.toBeNull();
    const floor = (parsed ?? [])[0]?.replace(/^[\^~>=]+/, '');
    expect(
      floor,
      `@kept/cli's @kept/core range '${range ?? ''}' has floor '${floor ?? ''}', which is not ` +
        `the ${CORE.version} this tree builds. The range must admit the core being published.`,
    ).toBe(CORE.version);
  });
});

describe.each(PACKAGES)('the packed archive of packages/%s (R17.4)', (dir) => {
  it('reports the package it claims to be, at the manifest version', () => {
    const report = reportFor(dir);
    const manifest = readManifest(dir);
    expect(report.name).toBe(manifest.name);
    expect(report.version).toBe(manifest.version);
    expect(report.entryCount).toBe(report.files.length);
  });

  it('contains compiled output and its type declarations under dist', () => {
    const paths = reportFor(dir).files.map((file) => file.path);
    const js = paths.filter((path) => path.startsWith('dist/') && path.endsWith('.js'));
    const declarations = paths.filter(
      (path) => path.startsWith('dist/') && path.endsWith('.d.ts'),
    );
    expect(
      js.length,
      `packages/${dir} packs no dist/*.js. Run \`${BUILD_COMMAND}\` — the archive is the build ` +
        `output, not the source.`,
    ).toBeGreaterThan(0);
    expect(
      declarations.length,
      `packages/${dir} packs no dist/*.d.ts, so a TypeScript consumer installs an untyped package.`,
    ).toBeGreaterThan(0);
  });

  it('contains no test file, fixture, evidence pack or recording directory', () => {
    const paths = reportFor(dir).files.map((file) => file.path);
    for (const { label, pattern } of FORBIDDEN) {
      const offenders = paths.filter((path) => pattern.test(path));
      expect(
        offenders,
        `packages/${dir} packs ${label}: ${offenders.join(', ')}. Only compiled output belongs ` +
          `in the archive (R17.4).`,
      ).toEqual([]);
    }
  });

  it('stays far under the four-megabyte regression, and records what it measured', async ({
    annotate,
  }) => {
    const report = reportFor(dir);
    // The measurement is attached to the test rather than logged, because the
    // default reporter hides console output from passing tests and §22.4 wants the
    // figure visible on a green run — that is the whole point of recording it.
    await annotate(`measured ${summarise(report)}`, 'notice');
    expect(
      report.size,
      `${summarise(report)} — over the ${kb(SIZE_CEILING_BYTES)} ceiling of design §22.4. ` +
        `Something is being packed that should not be; read the file list above.`,
    ).toBeLessThan(SIZE_CEILING_BYTES);
    // A zero-byte archive would satisfy the ceiling and ship nothing.
    expect(report.size, `${summarise(report)} — the archive is empty.`).toBeGreaterThan(0);
  });
});

describe('the kept binary is executable where it is installed (R17.5)', () => {
  it('is declared as the bin and is packed', () => {
    const manifest = readManifest('kept-cli') as Manifest & {
      readonly bin?: Readonly<Record<string, string>>;
    };
    expect(manifest.bin?.kept).toBe('dist/index.js');
    expect(
      reportFor('kept-cli').files.map((file) => file.path),
      'The kept bin target is not in the archive, so a global install links a missing file.',
    ).toContain('dist/index.js');
  });

  it('carries an interpreter directive on its first line', () => {
    expect(
      existsSync(CLI_ENTRY),
      `${CLI_ENTRY} does not exist. Run \`${BUILD_COMMAND}\` from the repository root.`,
    ).toBe(true);
    const firstLine = readFileSync(CLI_ENTRY, { encoding: 'utf8' }).split(/\r?\n/, 1)[0] ?? '';
    expect(
      firstLine.startsWith('#!'),
      `dist/index.js line one is '${firstLine.slice(0, 60)}'. Without an interpreter directive a ` +
        `global install fails with 'Permission denied' on any machine whose shell does not ` +
        `guess node (R17.5).`,
    ).toBe(true);
  });
});
