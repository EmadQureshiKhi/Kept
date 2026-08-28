/**
 * The documentation an installer sees, and the procedure that ships it (task 25.5,
 * design §22.4, R17.11, R17.12).
 *
 * ## Why this file exists
 *
 * Task 25.5 asked for three documents: a README for each package and
 * `docs/publish.md`. All three were written, all three said the right things, and
 * **nothing asserted any of them**, which an audit of the task plan caught. Every
 * other documentation deliverable in this plan carries assertions; these did not, so
 * they were the one place in the repository where a claim could rot without anything
 * going red. That is the exact failure mode KEPT was built to detect, and leaving it
 * inside KEPT was not defensible.
 *
 * The audit was immediately vindicated. `docs/publish.md` still carried a section
 * headed "Currently red, and blocking", naming the undeclared `yaml` and `zod`
 * dependencies of `kept-core` and instructing the reader to fix them before
 * publishing. They had been fixed. The document was telling whoever next performed a
 * release to stop and repair something that was already repaired, and to distrust two
 * suites that were passing. {@link namesNoCurrentlyFailingTest} is why that cannot
 * happen again.
 *
 * ## What is asserted, and what is deliberately not
 *
 * These are prose documents, so the temptation is to assert their sentences, and that
 * produces a test that fails on every rewording and teaches its reader to update the
 * expectation without reading the change. So the assertions here are only ever about
 * **the things that can silently disagree with the tree**:
 *
 *   1. **A stated fact against its authority.** Each README states a Node floor and an
 *      install command; the manifest owns both. `publish.md` states a version; the two
 *      manifests own it. A version bumped in the manifests and not in the procedure is
 *      the single most likely drift here, because the procedure's own first step is
 *      bumping versions.
 *   2. **A named path against the filesystem.** The procedure tells a reader to run
 *      specific test files and to pack specific workspaces. A renamed test file turns
 *      that into a command that fails with `No test files found`, which reads like the
 *      repository is broken rather than the document being stale.
 *   3. **An ordering that matters.** Core is published before CLI, because `@corgod/kept-cli`
 *      depends on `kept-core` by a registry range. Reversed, there is a window in
 *      which anybody installing the CLI cannot resolve its dependency. That is a fact
 *      about the world, not a preference about prose.
 *   4. **A claim about the suite's current state.** A document may record that a test
 *      was once red, in the past tense, and this one should: the finding is the most
 *      valuable paragraph in it. What it may not do is say a test is red now, because
 *      a procedure that tells its reader to stop is a procedure nobody can finish.
 *
 * Not asserted: wording, headings, tone, the tarball byte counts (owned and measured
 * by `packaging.test.ts`, which annotates them on every run), or the presence of any
 * particular sentence. A document that must match a fixture is a document nobody
 * improves.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function read(relative: string): string {
  return readFileSync(new URL(relative, new URL(REPO_ROOT, 'file:')), 'utf8');
}

function exists(relative: string): boolean {
  try {
    readFileSync(new URL(relative, new URL(REPO_ROOT, 'file:')));
    return true;
  } catch {
    return false;
  }
}

interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly engines?: { readonly node?: string };
  readonly dependencies?: Readonly<Record<string, string>>;
}

/** The two published packages, each with the manifest that owns its stated facts. */
const PACKAGES = ['kept-core', 'kept-cli'].map((directory) => {
  const manifest = JSON.parse(read(`packages/${directory}/package.json`)) as Manifest;
  return {
    directory,
    manifest,
    readmePath: `packages/${directory}/README.md`,
    readme: read(`packages/${directory}/README.md`),
  };
});

const PUBLISH_DOC = 'docs/publish.md';
const PUBLISH = read(PUBLISH_DOC);

/* ───────────────────── the README an npm page actually shows ──────────────────── */

describe('each published package documents itself for an installer (R17.11)', () => {
  it('scans both packages, so this suite cannot pass by finding neither', () => {
    expect(PACKAGES.map((entry) => entry.manifest.name)).toEqual(['kept-core', '@corgod/kept-cli']);
    for (const entry of PACKAGES) expect(entry.readme.length).toBeGreaterThan(400);
  });

  for (const entry of PACKAGES) {
    describe(entry.manifest.name, () => {
      it('is titled with the name npm will publish it under', () => {
        // npm renders the README on the package page whatever `files` says, so a README
        // titled after the wrong package is the first thing an installer misreads.
        expect(entry.readme.split('\n')[0]).toBe(`# ${entry.manifest.name}`);
      });

      it('states an install command naming itself', () => {
        expect(
          entry.readme,
          `${entry.readmePath} gives an install command that does not name ${entry.manifest.name}`,
        ).toMatch(new RegExp(`npm install (?:-g )?${entry.manifest.name.replace('/', '\\/')}\\b`));
      });

      it('states the Node floor its own manifest enforces', () => {
        // `engines.node` is what npm warns on, so a README stating a different floor
        // sends somebody to install a version their own package will complain about.
        const declared = entry.manifest.engines?.node ?? '';
        const floor = /(\d+\.\d+\.\d+)/.exec(declared)?.[1];
        expect(floor, `${entry.directory} declares no parseable engines.node`).toBeDefined();
        expect(
          entry.readme,
          `${entry.readmePath} does not state the Node ${floor ?? '?'} floor that ` +
            `${entry.directory}/package.json declares as ${declared}`,
        ).toContain(`Node ${floor ?? ''} or newer`);
      });

      it('names both prerequisites KEPT cannot supply', () => {
        // Neither is bundled and neither can be: Kane is what bills, and a real browser
        // is why no hosted service can earn a verdict on somebody's behalf. An installer
        // who learns this after installing learns it from a failure.
        expect(entry.readme, `${entry.readmePath} does not name the Kane CLI prerequisite`).toMatch(
          /Kane CLI on your `PATH`/,
        );
        expect(entry.readme, `${entry.readmePath} does not name the browser prerequisite`).toMatch(
          /local Chrome/,
        );
      });

      it('names `kept init` as the first step', () => {
        expect(
          entry.readme,
          `${entry.readmePath} does not tell an installer what to run first`,
        ).toMatch(/kept init/);
      });

      it('claims no capability the package does not have', () => {
        // `kept-core` spawns nothing and writes nothing on its own, which is what makes
        // it safe to depend on. A README promising it verifies anything would be selling
        // the CLI's behaviour under the library's name.
        if (entry.manifest.name !== 'kept-core') return;
        expect(entry.readme).toMatch(/spawns nothing on its own and writes nothing on its own/);
      });
    });
  }
});

/* ──────────────────────── the procedure, against the tree ─────────────────────── */

describe('the publish procedure is walkable as written (R17.12, §22.4)', () => {
  it('states the version both manifests actually carry', () => {
    const versions = new Set(PACKAGES.map((entry) => entry.manifest.version));
    expect(versions.size, 'the two manifests disagree about the version').toBe(1);
    const version = [...versions][0] ?? '';
    expect(
      PUBLISH,
      `${PUBLISH_DOC} does not state ${version}, which is the version both manifests carry. ` +
        `The procedure's own first step is bumping the version, so a stale figure here is ` +
        `read as the target rather than as a leftover.`,
    ).toContain(version);
  });

  it('states the dependency range the CLI manifest actually declares', () => {
    const cli = PACKAGES.find((entry) => entry.manifest.name === '@corgod/kept-cli');
    const core = PACKAGES.find((entry) => entry.manifest.name === 'kept-core');
    const range = cli?.manifest.dependencies?.['kept-core'] ?? '';
    expect(range, '@corgod/kept-cli does not depend on kept-core at all').not.toBe('');
    expect(
      PUBLISH,
      `${PUBLISH_DOC} does not state the range ${range} that @corgod/kept-cli declares on kept-core`,
    ).toContain(`\`${range}\``);
    // The floor has to admit the core version being published, or step 6 publishes a CLI
    // whose dependency resolves to something older than the core it was built against.
    expect(range.replace(/^[^\d]*/, '')).toBe(core?.manifest.version);
  });

  it('publishes core before cli, because the dependency has to resolve', () => {
    const core = PUBLISH.indexOf('npm publish --workspace kept-core');
    const cli = PUBLISH.indexOf('npm publish --workspace @corgod/kept-cli');
    expect(core, `${PUBLISH_DOC} gives no publish command for kept-core`).toBeGreaterThan(-1);
    expect(cli, `${PUBLISH_DOC} gives no publish command for @corgod/kept-cli`).toBeGreaterThan(-1);
    expect(
      core,
      `${PUBLISH_DOC} publishes @corgod/kept-cli before kept-core, which leaves a window in which ` +
        `anybody installing the CLI cannot resolve its dependency`,
    ).toBeLessThan(cli);
  });

  it('names both workspaces by the names npm resolves', () => {
    for (const entry of PACKAGES) {
      expect(PUBLISH, `${PUBLISH_DOC} never packs ${entry.manifest.name}`).toContain(
        `npm pack --dry-run --json --workspace ${entry.manifest.name}`,
      );
    }
  });

  it('names only test files that exist', () => {
    // A renamed test file turns a documented command into `No test files found`, which
    // reads like a broken repository rather than a stale document.
    const named = [...PUBLISH.matchAll(/(packages\/[\w-]+\/test\/[\w.-]+\.test\.tsx?)/g)].map(
      (match) => match[1] ?? '',
    );
    expect(named.length, `${PUBLISH_DOC} names no test file, so this guard checks nothing`)
      .toBeGreaterThan(2);
    const missing = [...new Set(named)].filter((path) => !exists(path));
    expect(missing, `${PUBLISH_DOC} names test files that no longer exist`).toEqual([]);
  });

  it('names the interpreter directive the CLI manifest depends on', () => {
    // `bin` points at a file Node has to be able to exec. The missing shebang is the
    // failure that turns a global install into `Permission denied`, and it is the one
    // failure no other suite in this repository would see, because every other suite
    // imports the module instead of running the file.
    const cli = PACKAGES.find((entry) => entry.manifest.name === '@corgod/kept-cli');
    expect(cli?.manifest.version).toBeDefined();
    expect(PUBLISH).toContain('#!/usr/bin/env node');
    expect(PUBLISH).toMatch(/Permission denied/);
  });

  it('records the seven numbered steps in order', () => {
    const headings = [...PUBLISH.matchAll(/^### (\d+)\. /gm)].map((match) => Number(match[1]));
    expect(headings, `${PUBLISH_DOC} no longer carries a numbered procedure`).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it('names no test as currently failing', () => {
    /* The assertion this file was written for. `docs/publish.md` carried a section headed
       "Currently red, and blocking", naming a defect that had already been fixed, and
       instructing whoever next published to stop and repair it. A release procedure that
       tells its reader to halt on a condition that has passed is worse than no procedure:
       it spends their time and it teaches them to disbelieve the document.

       Past tense is allowed and is wanted. "It was red once, and here is what it found"
       is the most valuable paragraph in that file. The present tense is what is refused. */
    const offending = PUBLISH.split('\n')
      .map((line, index) => ({ line, at: index + 1 }))
      .filter(({ line }) => /currently red|currently failing|is red now|still red/i.test(line));
    expect(
      offending.map(({ at, line }) => `${PUBLISH_DOC}:${at} ${line.trim()}`),
      `${PUBLISH_DOC} says a test is failing right now. Either it is, and the suite should ` +
        `be red rather than the document, or it is not, and the procedure is telling its ` +
        `reader to stop for no reason. Record the finding in the past tense instead.`,
    ).toEqual([]);
  });
});
