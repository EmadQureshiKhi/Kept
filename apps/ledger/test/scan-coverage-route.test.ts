/**
 * The shared scan reads `/coverage` — design §10.4.4, §10.7, and the five suites that
 * consume `_scan.ts`.
 *
 * `_scan.ts`'s skip list named `coverage` as tool output, which it is in most
 * repositories. Then task 9.8 shipped `apps/ledger/app/coverage/` as a **route**, and
 * from that commit the contrast, token-parity, forbidden-palette, typography and motion
 * scans all quietly stopped reading a page they are responsible for. Five enforcement
 * tests with a blind spot over shipped code is worse than any single violation they
 * hunt, because a guard that checks nothing reports green — the same failure mode
 * `_scan.ts` already refuses in three other places by throwing on a zero-file walk.
 *
 * So this file is the standing assertion that the hole stays closed, in both directions:
 *
 *   1. the route's files are in what the walk returns, for code and for components;
 *   2. a directory named `coverage` that genuinely *is* tool output is still skipped,
 *      which is why the fix matches on the path rather than dropping the name outright.
 *
 * Both halves are guarded on `existsSync`. A later rename of the route must fail as a
 * *rename* — a clear "this path no longer exists, point the guard at the new one" —
 * rather than as five scans that pass while reading one page fewer. That is the whole
 * lesson of the bug this file exists because of.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CODE_EXTENSIONS,
  REPO_ROOT,
  SKIP_DIRECTORY_PATHS,
  componentFiles,
  isSkippedDirectory,
  scanLedger,
} from './_scan.js';

/** The route the skip list used to hide, file by file. */
const COVERAGE_ROUTE_FILES = [
  'apps/ledger/app/coverage/page.tsx',
  'apps/ledger/app/coverage/PromiseRow.tsx',
] as const;

const COVERAGE_ROUTE_DIRECTORY = 'apps/ledger/app/coverage';

/** Where a coverage reporter writing inside the scan root would land. */
const COVERAGE_OUTPUT_DIRECTORY = 'apps/ledger/coverage';

function exists(repoRelative: string): boolean {
  return existsSync(resolve(REPO_ROOT, repoRelative));
}

describe('the shared scan reads the /coverage route', () => {
  it('finds the route directory where this guard expects it', () => {
    expect(
      exists(COVERAGE_ROUTE_DIRECTORY),
      `${COVERAGE_ROUTE_DIRECTORY} does not exist. If the route moved, point this guard ` +
        `at its new path — the five scans in this directory read the tree through ` +
        `_scan.ts, and a stale path here is how they go back to skipping a page.`,
    ).toBe(true);
  });

  it('returns every file of the route from the code walk', () => {
    const scanned = new Set(scanLedger(CODE_EXTENSIONS).map((file) => file.path));
    for (const path of COVERAGE_ROUTE_FILES) {
      if (!exists(path)) continue;
      expect(
        scanned.has(path),
        `${path} exists and the walk did not return it, so the forbidden-palette, ` +
          `typography and motion scans are not reading it`,
      ).toBe(true);
    }
  });

  it('returns the route from the component walk, which is where §10.7 is enforced', () => {
    const components = new Set(componentFiles().map((file) => file.path));
    for (const path of COVERAGE_ROUTE_FILES) {
      if (!exists(path) || !path.endsWith('.tsx')) continue;
      expect(
        components.has(path),
        `${path} is a component and componentFiles() did not return it, so the ` +
          `mono-as-texture rule of §10.7 is not applied to it`,
      ).toBe(true);
    }
  });

  it('reads the route, not merely a directory with the same name', () => {
    const scanned = scanLedger(CODE_EXTENSIONS).filter((file) =>
      file.path.startsWith(`${COVERAGE_ROUTE_DIRECTORY}/`),
    );
    expect(scanned.length, 'the walk descended into the route and found nothing in it').toBeGreaterThan(
      0,
    );
    /* and what it read is the page's own source, not an artefact that happens to sit there */
    expect(scanned.some((file) => file.text.includes('export default'))).toBe(true);
  });
});

describe('a coverage directory that really is tool output is still skipped', () => {
  it('skips it by path, which is what lets the route keep the name', () => {
    expect(SKIP_DIRECTORY_PATHS.has(COVERAGE_OUTPUT_DIRECTORY)).toBe(true);
    expect(isSkippedDirectory(resolve(REPO_ROOT, COVERAGE_OUTPUT_DIRECTORY))).toBe(true);
    expect(
      isSkippedDirectory(resolve(REPO_ROOT, COVERAGE_ROUTE_DIRECTORY)),
      'the route is skipped again; the whole point of the path-based rule is that it is not',
    ).toBe(false);
  });

  it('still skips build output and vendored code by name, wherever it sits', () => {
    for (const name of ['node_modules', 'dist', '.next', 'out', '.git']) {
      expect(isSkippedDirectory(resolve(REPO_ROOT, 'apps/ledger', name))).toBe(true);
      expect(isSkippedDirectory(resolve(REPO_ROOT, 'apps/ledger/app', name))).toBe(true);
    }
  });

  it('descends into every other directory of the app tree', () => {
    for (const path of ['apps/ledger/app', 'apps/ledger/app/runs', 'apps/ledger/components']) {
      expect(isSkippedDirectory(resolve(REPO_ROOT, path)), `${path} is being skipped`).toBe(false);
    }
  });
});
