import type { BaselineDirEntry, BaselineFileSystem, StateFileSystem } from '@kept/core';
import {
  createDiagnosticSink,
  extractVerifiesTags,
  inMemoryBaselineFileSystem,
  inMemoryStateFileSystem,
  readDocumentCovers,
  readFrontmatter,
} from '@kept/core';
import { describe, expect, it } from 'vitest';

import { EXIT_OK } from '../src/args.js';
import { CONFIG_FILE_RELATIVE_PATH, DEFAULT_CONFIG } from '../src/config.js';
import {
  EXAMPLE_TEST_FILE_NAME,
  INIT_DIAGNOSTIC_CODES,
  NEXT_COMMAND,
  corpusRootFrom,
  countLines,
  detectInitCandidates,
  documentationGlobs,
  exampleTestDocument,
  runInit,
} from '../src/commands/init.js';

/**
 * `kept init` (design §21.1, R16.1 to R16.8).
 *
 * Every test here runs with no disk: the config and example writes go through an
 * in-memory `StateFileSystem` and the detection walk through an in-memory
 * `BaselineFileSystem`. What is being asserted is the four-step order, the
 * fail-closed content of the file it writes, and the two refusals: the second
 * `init` that changes nothing, and the `--force` that replaces a config but never
 * a test.
 *
 * The real `.kept/config.json` of this repository is never a subject here. Every
 * root below is a path that does not exist.
 */
const REPO = '/host';
const CONFIG_PATH = `${REPO}/${CONFIG_FILE_RELATIVE_PATH}`;

const README = ['# Kepler Coffee', '', '- The Cart screen shows a running subtotal.', ''].join(
  '\n',
);

/** A small host repository: two documents, one existing designed test. */
function hostFiles(): Record<string, string> {
  return {
    'README.md': README,
    'docs/product.md': '# Product\n\nThe Shop screen lists six coffees.\n',
    'apps/web/README.mdx': '# Web\n',
    'suite/checkout_test.md': '---\nmode: testing\n---\n\n# Checkout\n',
    'node_modules/left-pad/README.md': '# never detected\n',
    'output-run/transcript_test.md': '# never detected\n',
  };
}

function seams(seed: Readonly<Record<string, string>> = {}): {
  readonly fileSystem: ReturnType<typeof inMemoryStateFileSystem>;
  readonly baselineFileSystem: BaselineFileSystem;
  readonly sink: ReturnType<typeof createDiagnosticSink>;
} {
  return {
    fileSystem: inMemoryStateFileSystem(seed),
    baselineFileSystem: inMemoryBaselineFileSystem(hostFiles()),
    sink: createDiagnosticSink(),
  };
}

/** Every file's bytes, so a "changed nothing" claim is checked rather than asserted. */
function snapshotBytes(fileSystem: ReturnType<typeof inMemoryStateFileSystem>): string {
  return JSON.stringify([...fileSystem.files.entries()].sort());
}

// ---------------------------------------------------------------------------
// Step 3 and step 4: what a first run writes
// ---------------------------------------------------------------------------

describe('kept init, first run (R16.1, R16.5)', () => {
  it('writes the config and exactly one example, and nothing else', () => {
    const { fileSystem, baselineFileSystem, sink } = seams();
    const result = runInit({ repoRoot: REPO, fileSystem, baselineFileSystem, diagnostics: sink });

    expect(result.configWritten).toBe(true);
    expect(result.exampleWritten).toBe(true);
    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.alreadyConfigured).toBe(false);
    expect([...result.writes]).toEqual([CONFIG_PATH, `${REPO}/suite/${EXAMPLE_TEST_FILE_NAME}`]);
    expect([...fileSystem.files.keys()].sort()).toEqual(
      [CONFIG_PATH, `${REPO}/suite/${EXAMPLE_TEST_FILE_NAME}`].sort(),
    );
  });

  it('writes the fail-closed shape: no source globs and three empty fences', () => {
    const { fileSystem, baselineFileSystem, sink } = seams();
    runInit({ repoRoot: REPO, fileSystem, baselineFileSystem, diagnostics: sink });

    const text = fileSystem.files.get(CONFIG_PATH) as string;
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual({
      verdictRouter: 'resultCode740',
      memberDebug: false,
      timeouts: { hookMs: 300_000, enrichmentMs: 60_000, doctorMs: 10_000 },
      corpus: { root: 'suite' },
      subject: {
        source: [],
        docs: ['*.md', 'apps/**/*.mdx', 'docs/**/*.md'],
        baseUrl: null,
      },
      fences: {
        'code-break': { allow: [] },
        'test-drift': { allow: [] },
        'docs-lie': { allow: [] },
      },
    });
  });

  it('names kept doctor as the next command (R16.7)', () => {
    const { fileSystem, baselineFileSystem, sink } = seams();
    const result = runInit({ repoRoot: REPO, fileSystem, baselineFileSystem, diagnostics: sink });

    expect(result.nextCommand).toBe(NEXT_COMMAND);
    const next = sink.entries.filter((entry) => entry.code === INIT_DIAGNOSTIC_CODES.nextCommand);
    expect(next).toHaveLength(1);
    expect(next[0]?.message).toContain('kept doctor');
  });

  it('invokes Kane zero times and consumes zero credits (R16.6)', () => {
    const { fileSystem, baselineFileSystem, sink } = seams();
    const result = runInit({ repoRoot: REPO, fileSystem, baselineFileSystem, diagnostics: sink });

    expect(result.kaneInvocations).toBe(0);
    expect(result.credits).toBe(0);
    // The stronger statement: the request shape has no process seam at all, so
    // there is no door a future edit could open by accident.
    expect(Object.keys({ repoRoot: REPO, fileSystem, baselineFileSystem })).not.toContain(
      'invoker',
    );
  });
});

// ---------------------------------------------------------------------------
// Step 2: detection reports, and cites nothing (R16.4)
// ---------------------------------------------------------------------------

describe('kept init, detection (R16.4)', () => {
  it('reports every documentation candidate with its path and line count', () => {
    const { fileSystem, baselineFileSystem, sink } = seams();
    const result = runInit({ repoRoot: REPO, fileSystem, baselineFileSystem, diagnostics: sink });

    // Shallowest first, then lexicographic: the root README is the first detected
    // document, which is the one the scaffold's placeholder tag will cite.
    expect(result.detection.documents.map((document) => document.path)).toEqual([
      'README.md',
      'docs/product.md',
      'apps/web/README.mdx',
    ]);
    expect(result.detection.documents[0]).toEqual({ path: 'README.md', lines: 3 });

    const reported = sink.entries
      .filter((entry) => entry.code === INIT_DIAGNOSTIC_CODES.documentDetected)
      .map((entry) => entry.file);
    expect(reported).toEqual(['README.md', 'docs/product.md', 'apps/web/README.mdx']);
  });

  it('never descends into node_modules or an output- directory', () => {
    const { fileSystem, baselineFileSystem, sink } = seams();
    const result = runInit({ repoRoot: REPO, fileSystem, baselineFileSystem, diagnostics: sink });

    const paths = [
      ...result.detection.documents.map((file) => file.path),
      ...result.detection.corpusFiles.map((file) => file.path),
    ];
    expect(paths.some((path) => path.startsWith('node_modules/'))).toBe(false);
    expect(paths.some((path) => path.startsWith('output-'))).toBe(false);
  });

  it('writes no citation for any detected document: the only tag written is the scaffold placeholder', () => {
    const { fileSystem, baselineFileSystem, sink } = seams();
    runInit({ repoRoot: REPO, fileSystem, baselineFileSystem, diagnostics: sink });

    const tags = [...fileSystem.files.values()].flatMap(
      (text) => extractVerifiesTags(text.split('\n')).tags,
    );
    expect(tags).toHaveLength(1);
    expect(tags[0]?.file).toBe('README.md');
    expect(tags[0]?.line).toBe(1);
    // Line 1 of the README is its heading, which is not a promise. Chosen by
    // position, and the scaffold says so in as many words.
    expect(fileSystem.files.get(`${REPO}/suite/${EXAMPLE_TEST_FILE_NAME}`)).toContain(
      'repoint',
    );
  });

  it('counts lines with a trailing newline terminating the last line', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('a')).toBe(1);
    expect(countLines('a\n')).toBe(1);
    expect(countLines('a\nb')).toBe(2);
    expect(countLines('a\nb\n')).toBe(2);
  });

  it('derives one documentation glob per top-level directory and extension seen', () => {
    expect(
      documentationGlobs([
        { path: 'README.md', lines: 1 },
        { path: 'docs/a.md', lines: 1 },
        { path: 'docs/deep/b.md', lines: 1 },
        { path: 'apps/web/c.mdx', lines: 1 },
      ]),
    ).toEqual(['*.md', 'apps/**/*.mdx', 'docs/**/*.md']);
    expect(documentationGlobs([])).toEqual([]);
  });

  it('picks the busiest corpus directory, and refuses a corpus root of the whole tree', () => {
    expect(
      corpusRootFrom([
        { path: 'suite/a_test.md', lines: 1 },
        { path: 'tests/b_test.md', lines: 1 },
        { path: 'tests/c_test.md', lines: 1 },
      ]),
    ).toBe('tests');
    expect(corpusRootFrom([{ path: 'loose_test.md', lines: 1 }])).toBe(DEFAULT_CONFIG.corpus.root);
    expect(corpusRootFrom([])).toBe(DEFAULT_CONFIG.corpus.root);
  });
});

// ---------------------------------------------------------------------------
// Step 1: the refusal, which is the whole of idempotence (R16.2, R16.8)
// ---------------------------------------------------------------------------

describe('kept init on a configured repository (R16.2, R16.8)', () => {
  it('writes nothing, names the existing file, and exits 0', () => {
    const { baselineFileSystem, sink } = seams();
    const fileSystem = inMemoryStateFileSystem({ [CONFIG_PATH]: '{"verdictRouter":"x"}\n' });
    const before = snapshotBytes(fileSystem);

    const result = runInit({ repoRoot: REPO, fileSystem, baselineFileSystem, diagnostics: sink });

    expect(result.alreadyConfigured).toBe(true);
    expect(result.configWritten).toBe(false);
    expect(result.exampleWritten).toBe(false);
    expect(result.writes).toEqual([]);
    expect(result.exitCode).toBe(EXIT_OK);
    expect(snapshotBytes(fileSystem)).toBe(before);

    const refusal = sink.entries.find(
      (entry) => entry.code === INIT_DIAGNOSTIC_CODES.alreadyConfigured,
    );
    expect(refusal?.severity).toBe('info');
    expect(refusal?.message).toContain(CONFIG_PATH);
  });

  it('changes no byte of any file on a second run', () => {
    const { fileSystem, baselineFileSystem } = seams();
    runInit({ repoRoot: REPO, fileSystem, baselineFileSystem });
    const before = snapshotBytes(fileSystem);

    const second = runInit({ repoRoot: REPO, fileSystem, baselineFileSystem });

    expect(second.writes).toEqual([]);
    expect(snapshotBytes(fileSystem)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// --force: the config, and only the config (R16.3)
// ---------------------------------------------------------------------------

describe('kept init --force (R16.3)', () => {
  it('replaces the config, names what it replaced, and leaves the example untouched', () => {
    const { fileSystem, baselineFileSystem, sink } = seams();
    runInit({ repoRoot: REPO, fileSystem, baselineFileSystem });

    const examplePath = `${REPO}/suite/${EXAMPLE_TEST_FILE_NAME}`;
    const edited = '# I have edited this test since\n';
    fileSystem.writeFile(examplePath, edited);
    fileSystem.writeFile(CONFIG_PATH, '{"verdictRouter":"failureYamlTriage"}\n');

    const result = runInit({
      repoRoot: REPO,
      force: true,
      fileSystem,
      baselineFileSystem,
      diagnostics: sink,
    });

    expect(result.configWritten).toBe(true);
    expect(result.replacedConfigPath).toBe(CONFIG_PATH);
    expect(result.exampleWritten).toBe(false);
    expect([...result.writes]).toEqual([CONFIG_PATH]);
    expect(fileSystem.files.get(examplePath)).toBe(edited);

    const replaced = sink.entries.find(
      (entry) => entry.code === INIT_DIAGNOSTIC_CODES.configReplaced,
    );
    expect(replaced?.message).toContain(CONFIG_PATH);
    expect(
      sink.entries.some((entry) => entry.code === INIT_DIAGNOSTIC_CODES.examplePreserved),
    ).toBe(true);
  });

  it('is an ordinary first run when there is no config to replace', () => {
    const { fileSystem, baselineFileSystem } = seams();
    const result = runInit({ repoRoot: REPO, force: true, fileSystem, baselineFileSystem });

    expect(result.configWritten).toBe(true);
    expect(result.replacedConfigPath).toBeNull();
    expect(result.exampleWritten).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The scaffold itself (R16.5)
// ---------------------------------------------------------------------------

describe('the scaffolded example (R16.5)', () => {
  it('parses as a designed test: one tag, no malformed line, a readable fence', () => {
    const { fileSystem, baselineFileSystem } = seams();
    runInit({ repoRoot: REPO, fileSystem, baselineFileSystem });
    const lines = (fileSystem.files.get(`${REPO}/suite/${EXAMPLE_TEST_FILE_NAME}`) as string).split(
      '\n',
    );

    const scan = extractVerifiesTags(lines);
    expect(scan.tags).toHaveLength(1);
    // The prose deliberately avoids repeating the tag marker: a line that mentions
    // it without carrying a tag is reported as malformed, and a scaffold that warns
    // on the next build is a scaffold nobody trusts.
    expect(scan.rejected).toEqual([]);

    const frontmatter = readFrontmatter(lines);
    expect(frontmatter.present).toBe(true);
    expect(frontmatter.terminated).toBe(true);
    expect(frontmatter.testId).toBe('EXAMPLE-1');
    expect(frontmatter.unparsedLines).toEqual([]);
  });

  it('carries a covers annotation that grants nothing', () => {
    const document = exampleTestDocument({
      documents: [{ path: 'README.md', lines: 3 }],
      corpusFiles: [],
      corpusRoot: 'tests',
      docGlobs: ['*.md'],
    });
    expect(document).toContain('<!-- @covers -->');
    expect(readDocumentCovers(document.split('\n'))).toEqual([]);
  });

  it('says in as many words that the tag must be repointed first', () => {
    const document = exampleTestDocument({
      documents: [{ path: 'README.md', lines: 3 }],
      corpusFiles: [],
      corpusRoot: 'tests',
      docGlobs: ['*.md'],
    });
    expect(document).toContain('THIS FILE MEANS NOTHING UNTIL THE TWO ANNOTATIONS ABOVE ARE REPOINTED.');
  });
});

// ---------------------------------------------------------------------------
// Totality: every state of the world exits 0 and never throws
// ---------------------------------------------------------------------------

describe('kept init is total', () => {
  it('handles a repository with no markdown at all', () => {
    const fileSystem = inMemoryStateFileSystem();
    const sink = createDiagnosticSink();
    const result = runInit({
      repoRoot: REPO,
      fileSystem,
      baselineFileSystem: inMemoryBaselineFileSystem({ 'src/index.ts': 'export const a = 1;\n' }),
      diagnostics: sink,
    });

    expect(result.detection.documents).toEqual([]);
    expect(result.detection.docGlobs).toEqual([]);
    expect(result.detection.corpusRoot).toBe(DEFAULT_CONFIG.corpus.root);
    expect(result.exampleWritten).toBe(true);
    expect(result.examplePath).toBe(`${REPO}/${DEFAULT_CONFIG.corpus.root}/${EXAMPLE_TEST_FILE_NAME}`);
    expect(
      sink.entries.some((entry) => entry.code === INIT_DIAGNOSTIC_CODES.documentsAbsent),
    ).toBe(true);
    // The placeholder still cites line 1 of a plausible path, and the file says so.
    expect(fileSystem.files.get(result.examplePath)).toContain('@verifies README.md:1');
    expect(fileSystem.files.get(result.examplePath)).toContain('which this repository does not contain');
  });

  it('handles an empty repository', () => {
    const fileSystem = inMemoryStateFileSystem();
    const result = runInit({
      repoRoot: REPO,
      fileSystem,
      baselineFileSystem: inMemoryBaselineFileSystem({}),
    });
    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.configWritten).toBe(true);
  });

  it('reports rather than throws when a directory cannot be listed', () => {
    const throwing: BaselineFileSystem = {
      readDirectory(dir: string): readonly BaselineDirEntry[] {
        if (dir === '') return [{ name: 'docs', isDirectory: true, isFile: false }];
        throw new Error('EACCES');
      },
      readFile(): string | null {
        return null;
      },
    };
    const sink = createDiagnosticSink();
    const result = runInit({
      repoRoot: REPO,
      fileSystem: inMemoryStateFileSystem(),
      baselineFileSystem: throwing,
      diagnostics: sink,
    });

    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.detection.documents).toEqual([]);
    const unreadable = sink.entries.find(
      (entry) => entry.code === INIT_DIAGNOSTIC_CODES.directoryUnreadable,
    );
    expect(unreadable?.message).toContain('EACCES');
  });

  it('reports rather than throws when the filesystem refuses a write', () => {
    const readOnly: StateFileSystem = {
      readFile(): string | null {
        return null;
      },
      ensureDir(): void {
        // Nothing to do; the refusal below is the interesting part.
      },
      writeFile(): void {
        throw new Error('EROFS: read-only file system');
      },
    };
    const sink = createDiagnosticSink();
    const { baselineFileSystem } = seams();
    const result = runInit({
      repoRoot: REPO,
      fileSystem: readOnly,
      baselineFileSystem,
      diagnostics: sink,
    });

    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.configWritten).toBe(false);
    expect(result.config).toBeNull();
    expect(result.writes).toEqual([]);
    const failures = sink.entries.filter(
      (entry) => entry.code === INIT_DIAGNOSTIC_CODES.writeFailed,
    );
    expect(failures).toHaveLength(2);
    expect(failures[0]?.severity).toBe('error');
  });

  it('truncates a cyclic tree instead of hanging', () => {
    const cyclic: BaselineFileSystem = {
      readDirectory(): readonly BaselineDirEntry[] {
        return [
          { name: 'loop', isDirectory: true, isFile: false },
          { name: 'README.md', isDirectory: false, isFile: true },
        ];
      },
      readFile(): string | null {
        return '# loop\n';
      },
    };
    const sink = createDiagnosticSink();
    const detection = detectInitCandidates({ baselineFileSystem: cyclic, diagnostics: sink });

    expect(detection.documents.length).toBeGreaterThan(0);
    expect(sink.entries.some((entry) => entry.code === INIT_DIAGNOSTIC_CODES.depthCapped)).toBe(
      true,
    );
  });
});
