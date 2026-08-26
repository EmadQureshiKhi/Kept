import type {
  AtomicRenamer,
  HandoffResultInput,
  ParsedStream,
  PromiseRecord,
  RoutedRepair,
  RunOutcome,
  StateFileSystem,
} from '@kept/core';
import {
  AMENDMENTS_DIRECTORY_RELATIVE_PATH,
  contractFor,
  createDiagnosticSink,
  createPromiseRecord,
  exitMeaning,
  handoffPaths,
  parseStream,
  promiseId,
  writeHandoff,
} from '@kept/core';
import { describe, expect, it } from 'vitest';

import { EXIT_OK } from '../src/args.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { AMEND_DIAGNOSTIC_CODES, docsLieResults, runAmend } from '../src/commands/amend.js';
import { IMPLEMENTED_COMMANDS, main } from '../src/main.js';

/**
 * `kept amend` — task 15.5 (design §8.3, §8.4, §13.1, R7.3, R7.4, R7.6).
 *
 * The core module's own suite proves the write discipline: the `.kept/` fence, the
 * sha256 interlock, the one mutated array element. What is checked here is the
 * *command surface* — that a proposal is driven by a run the guard admitted, that
 * the branch comes from the router rather than from this command, and that the one
 * thing KEPT will not do is invent the replacement sentence.
 *
 * The subject is the real one throughout: the never-true ten-percent-discount claim
 * at `apps/fixture/README.md` line 20, and its replacement from design §12.7. No
 * disk, no Kane process: the filesystem is a map and the stream is committed NDJSON
 * text parsed by the real parser.
 */

const REPO = '/repo';
const AT = '2026-08-21T04:11:07.913Z';
const README = 'apps/fixture/README.md';
const RUN_ID = '108dbb62-4f20-46ec-abbd-3b8be6c6e13c';

const DISCOUNT_CLAIM =
  '- The Cart screen applies a 10 percent discount automatically when the subtotal exceeds 50 dollars.';
const REPLACEMENT = '- The Cart screen shows the order total with no automatic discounts.';
const DISCOUNT_LINE = 20;

/** Twelve lines of preamble, then eight claims on 13 to 20. The fixture's shape. */
const README_TEXT = [
  '# Kepler Coffee',
  '',
  'A coffee subscription shop, and the fixture application KEPT verifies.',
  '',
  'Next.js App Router, seven screens, all state in `localStorage`.',
  '',
  '## What Kepler Coffee promises',
  '',
  '- one',
  '- two',
  '- three',
  '',
  '- The Home screen links to the Shop screen from its primary call to action.',
  '- The Shop screen lists exactly six coffees.',
  '- The Product screen shows the price in the selected currency.',
  '- The Cart screen shows a running subtotal.',
  '- The Checkout screen refuses to submit while the email field is empty.',
  '- The Orders screen lists every completed order.',
  '- The Settings screen keeps the selected currency after a reload.',
  DISCOUNT_CLAIM,
  '',
].join('\n');

const DISCOUNT_PROMISE = promiseId(README, DISCOUNT_CLAIM);

/** A filesystem that records every path written, so "wrote nothing" is checkable. */
function store(seed: Record<string, string> = {}): StateFileSystem & {
  readonly files: Map<string, string>;
  readonly writes: string[];
  readonly rename: AtomicRenamer;
} {
  const files = new Map(Object.entries(seed));
  const writes: string[] = [];
  return {
    files,
    writes,
    readFile: (path: string) => files.get(path) ?? null,
    ensureDir: () => undefined,
    writeFile: (path: string, contents: string) => {
      writes.push(path);
      files.set(path, contents);
    },
    rename: (from: string, to: string) => {
      const contents = files.get(from);
      if (contents === undefined) throw new Error(`no staging file at ${from}`);
      files.set(to, contents);
      files.delete(from);
    },
  };
}

function repairOf(branch: RoutedRepair['branch']): RoutedRepair {
  return {
    branch,
    strategy: 'failureYamlTriage',
    severity: null,
    category: null,
    confidence: null,
    evidenceRef: null,
    rationale:
      'No readable failure.yaml in the resolved evidence pack, so no positive evidence of a ' +
      'product fault or a test-mechanics fault exists and the claim itself is what is left in ' +
      'doubt.',
  };
}

function promiseOf(): PromiseRecord {
  return createPromiseRecord({
    claim: DISCOUNT_CLAIM,
    citation: { file: README, line: DISCOUNT_LINE, text: DISCOUNT_CLAIM },
    designedTest: { path: 'tests/cart_discount_test.md', testId: 'T-7' },
    verdict: 'red',
    providers: ['baseline'],
  });
}

/** A failing testrun that reached its terminal event — the guard admits this. */
const FAILING: readonly string[] = [
  JSON.stringify({
    type: 'testrun_plan',
    valid: true,
    members: [{ path: 'tests/cart_discount_test.md', test_id: 'T-7' }],
  }),
  JSON.stringify({
    type: 'testrun_member_end',
    path: 'tests/cart_discount_test.md',
    status: 'failed',
    result_code: 740,
    reason_code: 'assertion_error.confirmed_product_bug',
  }),
  JSON.stringify({ type: 'testrun_done', execution_id: RUN_ID, status: 'failed' }),
];

/** A stream that stopped before `testrun_done`: outcome unknown, nothing proved. */
const CRASHED: readonly string[] = FAILING.slice(0, 2);

function outcomeOf(lines: readonly string[], exitCode: number): RunOutcome<'ExecutionTestrun'> {
  const stream = parseStream(
    contractFor('ExecutionTestrun'),
    lines,
  ) as ParsedStream<'ExecutionTestrun'>;
  return { runId: RUN_ID, exitMeaning: exitMeaning('ExecutionTestrun', exitCode, false), stream };
}

/** The names in one directory of the in-memory map, so `list` can enumerate. */
function readDirectoryOf(fileSystem: { readonly files: Map<string, string> }) {
  return (path: string): readonly string[] => {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    return [...fileSystem.files.keys()]
      .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .map((key) => key.slice(prefix.length));
  };
}

/** Seed a repository whose newest run settled the discount claim as `docs-lie`. */
function repositoryWith(options: {
  readonly lines?: readonly string[];
  readonly branch?: RoutedRepair['branch'];
  readonly readme?: string | null;
} = {}) {
  const fileSystem = store(
    options.readme === null ? {} : { [`${REPO}/${README}`]: options.readme ?? README_TEXT },
  );
  const results: readonly HandoffResultInput[] = [
    {
      promise: promiseOf(),
      testId: 'T-7',
      memberStatus: 'failed',
      verdict: 'red',
      repair: repairOf(options.branch ?? 'docs-lie'),
    },
  ];
  writeHandoff({
    repoRoot: REPO,
    // The fence surfaces this fixture repository would resolve from its config
    // (§20.1). `amend` reads the handoff rather than the fence, so the exact globs
    // are immaterial here; what matters is that they are stated rather than assumed.
    fences: { allow: ['apps/fixture/lib/**'], forbid: ['tests', 'apps/fixture/README.md'] },
    runId: RUN_ID,
    run: outcomeOf(options.lines ?? FAILING, 1),
    exitCode: 1,
    durationMs: 113_402,
    results,
    command: {
      family: 'ExecutionTestrun',
      argv: ['testrun', 'run', 'tests/cart_discount_test.md', '--on-failure', 'continue'],
      invoked: true,
    },
    at: AT,
    fileSystem,
  });
  return fileSystem;
}

function amend(
  fileSystem: ReturnType<typeof store>,
  request: Partial<Parameters<typeof runAmend>[0]> = {},
) {
  return runAmend({
    repoRoot: REPO,
    config: DEFAULT_CONFIG,
    subcommand: 'propose',
    fileSystem,
    diagnostics: createDiagnosticSink(),
    at: AT,
    ...request,
  });
}

// ---------------------------------------------------------------------------

describe('kept amend propose — driven by the run, never by this command', () => {
  it('stages one amendment for the docs-lie the router settled', async () => {
    const fileSystem = repositoryWith();
    const before = fileSystem.files.get(`${REPO}/${README}`);
    const result = await amend(fileSystem, { runId: RUN_ID, text: REPLACEMENT });

    expect(result.runId).toBe(RUN_ID);
    expect(result.pending).toHaveLength(1);
    const amendment = result.amendments[0];
    expect(amendment?.status).toBe('pending');
    expect(amendment?.promiseId).toBe(DISCOUNT_PROMISE);
    expect(amendment?.citation.line).toBe(DISCOUNT_LINE);
    // `currentText` is read off the document, not copied from the citation the run
    // recorded, so the interlock is taken from what is actually on disk.
    expect(amendment?.currentText).toBe(DISCOUNT_CLAIM);
    expect(amendment?.proposedText).toBe(REPLACEMENT);
    expect(amendment?.expectedSha256).toMatch(/^[0-9a-f]{64}$/);
    // The strategy and the rationale come from the router's own answer.
    expect(amendment?.strategy).toBe('failureYamlTriage');
    expect(amendment?.rationale).toContain('docs-lie');

    // R7.4, the whole point: not one documentation byte.
    expect(fileSystem.files.get(`${REPO}/${README}`)).toBe(before);
    expect(fileSystem.writes.filter((path) => path.includes('README'))).toEqual([]);
    // Everything it did write is under `.kept/` — the amendment and the snapshot's
    // own state reads aside, the record is where §8.3 puts it.
    expect(
      fileSystem.writes.some((path) =>
        path.startsWith(`${REPO}/${AMENDMENTS_DIRECTORY_RELATIVE_PATH}`),
      ),
    ).toBe(true);
  });

  it('refuses to invent the replacement, and says what to run instead', async () => {
    const fileSystem = repositoryWith();
    const result = await amend(fileSystem, { runId: RUN_ID });

    expect(result.amendments).toEqual([]);
    expect(result.pending).toHaveLength(1);
    const codes = result.diagnostics.map((entry) => entry.code);
    expect(codes).toContain(AMEND_DIAGNOSTIC_CODES.replacementRequired);
    const message = result.diagnostics
      .filter((entry) => entry.code === AMEND_DIAGNOSTIC_CODES.replacementRequired)
      .map((entry) => entry.message)
      .join('');
    expect(message).toContain(DISCOUNT_CLAIM);
    expect(message).toContain(`--run ${RUN_ID}`);
    // Nothing at all was staged.
    expect(
      fileSystem.writes.filter((path) =>
        path.startsWith(`${REPO}/${AMENDMENTS_DIRECTORY_RELATIVE_PATH}`),
      ),
    ).toEqual([]);
  });

  it('proposes nothing for a branch the router settled as something else', async () => {
    const fileSystem = repositoryWith({ branch: 'code-break' });
    const result = await amend(fileSystem, { runId: RUN_ID, text: REPLACEMENT });

    expect(result.pending).toEqual([]);
    expect(result.amendments).toEqual([]);
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      AMEND_DIAGNOSTIC_CODES.noDocsLie,
    );
  });

  it('proposes nothing off a run the write guard did not admit', async () => {
    // The stream stopped before `testrun_done`: the outcome is unknown, so the
    // repair its results carry is not evidence that the claim is false.
    const fileSystem = repositoryWith({ lines: CRASHED });
    const result = await amend(fileSystem, { runId: RUN_ID, text: REPLACEMENT });

    expect(result.amendments).toEqual([]);
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      AMEND_DIAGNOSTIC_CODES.unproven,
    );
  });

  it('reports a run nothing was ever recorded for', async () => {
    const fileSystem = repositoryWith();
    const result = await amend(fileSystem, { runId: 'run_that_never_happened', text: REPLACEMENT });

    expect(result.amendments).toEqual([]);
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      AMEND_DIAGNOSTIC_CODES.runUnreadable,
    );
  });

  it('is idempotent: the same replacement is the same amendment', async () => {
    const fileSystem = repositoryWith();
    const first = await amend(fileSystem, { runId: RUN_ID, text: REPLACEMENT });
    const second = await amend(fileSystem, { runId: RUN_ID, text: REPLACEMENT });

    expect(second.amendments[0]?.id).toBe(first.amendments[0]?.id);
    expect(second.proposals[0]?.ok === true && second.proposals[0].existed).toBe(true);
    expect(second.proposals[0]?.ok === true && second.proposals[0].wrote).toBe(false);
  });

  it('reads the docs-lie results off the handoff, in the order the run reported them', () => {
    const fileSystem = repositoryWith();
    const text = fileSystem.files.get(handoffPaths(REPO, RUN_ID).archive) as string;
    const handoff = JSON.parse(text) as Parameters<typeof docsLieResults>[0];
    expect(docsLieResults(handoff).map((result) => result.promiseId)).toEqual([DISCOUNT_PROMISE]);
  });
});

describe('kept amend accept — the interlock, then exactly one line', () => {
  it('replaces the cited line and leaves every other byte identical', async () => {
    const fileSystem = repositoryWith();
    const staged = await amend(fileSystem, { runId: RUN_ID, text: REPLACEMENT });
    const id = staged.amendments[0]?.id as string;
    const before = (fileSystem.files.get(`${REPO}/${README}`) as string).split('\n');

    const result = await runAmend({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      subcommand: 'accept',
      id,
      fileSystem,
      rename: fileSystem.rename,
      diagnostics: createDiagnosticSink(),
      at: AT,
      // No Kane boundary: the rebuild is a state of the world KEPT reports on
      // (R2.12), and this test is about the bytes.
    });

    expect(result.accepted?.outcome).toBe('applied');
    expect(result.accepted?.applied).toBe(true);
    expect(result.rebuilt).toBe(true);
    expect(result.accepted?.successorPromiseId).not.toBeNull();
    expect(result.accepted?.successorPromiseId).not.toBe(DISCOUNT_PROMISE);

    const after = (fileSystem.files.get(`${REPO}/${README}`) as string).split('\n');
    expect(after).toHaveLength(before.length);
    expect(after[DISCOUNT_LINE - 1]).toBe(REPLACEMENT);
    for (let index = 0; index < before.length; index += 1) {
      if (index === DISCOUNT_LINE - 1) continue;
      expect(after[index]).toBe(before[index]);
    }
  });

  it('writes no documentation byte when the cited line moved under the proposal', async () => {
    const fileSystem = repositoryWith();
    const staged = await amend(fileSystem, { runId: RUN_ID, text: REPLACEMENT });
    const id = staged.amendments[0]?.id as string;

    // Somebody edited that line after KEPT read it.
    const edited = (fileSystem.files.get(`${REPO}/${README}`) as string).replace(
      DISCOUNT_CLAIM,
      '- The Cart screen applies a 15 percent discount above 50 dollars.',
    );
    fileSystem.files.set(`${REPO}/${README}`, edited);

    const result = await runAmend({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      subcommand: 'accept',
      id,
      fileSystem,
      rename: fileSystem.rename,
      diagnostics: createDiagnosticSink(),
      at: AT,
    });

    expect(result.accepted?.outcome).toBe('stale');
    expect(result.accepted?.applied).toBe(false);
    expect(result.rebuilt).toBe(false);
    expect(fileSystem.files.get(`${REPO}/${README}`)).toBe(edited);
  });

  it('names an amendment, and reports rather than guesses when none was named', async () => {
    const fileSystem = repositoryWith();
    const result = await runAmend({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      subcommand: 'accept',
      fileSystem,
      diagnostics: createDiagnosticSink(),
      at: AT,
    });
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      AMEND_DIAGNOSTIC_CODES.idRequired,
    );
    // Nothing beyond the two files the fixture's own handoff write left behind.
    expect(fileSystem.writes.filter((path) => !path.includes('/handoff'))).toEqual([]);
  });
});

describe('kept amend list, show and reject', () => {
  it('lists what is staged and writes nothing', async () => {
    const fileSystem = repositoryWith();
    await amend(fileSystem, { runId: RUN_ID, text: REPLACEMENT });
    const writesBefore = fileSystem.writes.length;

    const listed = await runAmend({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      subcommand: 'list',
      fileSystem,
      readDirectory: readDirectoryOf(fileSystem),
      diagnostics: createDiagnosticSink(),
      at: AT,
    });
    expect(listed.amendments).toHaveLength(1);
    expect(fileSystem.writes).toHaveLength(writesBefore);
  });

  it('rejects one amendment and touches no document', async () => {
    const fileSystem = repositoryWith();
    const staged = await amend(fileSystem, { runId: RUN_ID, text: REPLACEMENT });
    const before = fileSystem.files.get(`${REPO}/${README}`);

    const rejected = await runAmend({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      subcommand: 'reject',
      id: staged.amendments[0]?.id ?? null,
      fileSystem,
      diagnostics: createDiagnosticSink(),
      at: AT,
    });
    expect(rejected.rejected?.outcome).toBe('rejected');
    expect(rejected.amendments[0]?.status).toBe('rejected');
    expect(fileSystem.files.get(`${REPO}/${README}`)).toBe(before);
  });

  it('reports an unknown verb without reading or writing anything', async () => {
    const fileSystem = repositoryWith();
    const result = await runAmend({
      repoRoot: REPO,
      config: DEFAULT_CONFIG,
      subcommand: 'apply',
      fileSystem,
      diagnostics: createDiagnosticSink(),
      at: AT,
    });
    expect(result.subcommand).toBeNull();
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      AMEND_DIAGNOSTIC_CODES.unknownSubcommand,
    );
    // Nothing beyond the two files the fixture's own handoff write left behind.
    expect(fileSystem.writes.filter((path) => !path.includes('/handoff'))).toEqual([]);
  });
});

describe('the command surface (§13.1)', () => {
  it('is implemented, and exits 0 on the refusal that has no replacement', async () => {
    expect(IMPLEMENTED_COMMANDS).toContain('amend');
    const fileSystem = repositoryWith();
    const out: string[] = [];
    const exitCode = await main(['amend', 'propose', '--run', RUN_ID], {
      write: (text: string) => out.push(text),
      writeError: () => undefined,
      cwd: REPO,
      env: {},
      fileSystem,
      now: () => new Date(AT),
      kane: false,
    });
    expect(exitCode).toBe(EXIT_OK);
    expect(out.join('')).toContain('kept amend propose');
  });

  /**
   * The human summary says why `propose` staged nothing, which it used not to.
   *
   * Task 22.2's live cycle pointed `propose` at a run whose failure the router had
   * settled as `test-drift`. There was no docs-lie to amend, so nothing was staged,
   * which is correct: §8.1.1's rule is that an amendment is only ever proposed for the
   * branch the router already settled. The command reported that at `info`, and the
   * human form drops `info` on purpose so its output is not flooded, so what a reader
   * actually got was two lines, the command's own name and the repository path, and a
   * zero exit. A refusal and a success were indistinguishable.
   *
   * The fix is narrow rather than making every `info` visible: `propose` surfaces the
   * one diagnostic that explains an empty proposal, and it reuses that diagnostic's own
   * text so the summary and the payload cannot drift. This asserts the reader is told
   * three things: that nothing was staged, which branch the run actually settled, and
   * that the two facts are connected.
   */
  it('says why propose staged nothing, naming the branch the router did settle', async () => {
    const fileSystem = repositoryWith({ branch: 'test-drift' });
    const out: string[] = [];
    const errors: string[] = [];
    const exitCode = await main(
      ['amend', 'propose', '--run', RUN_ID, '--text', REPLACEMENT],
      {
        write: (text: string) => out.push(text),
        writeError: (text: string) => errors.push(text),
        cwd: REPO,
        env: {},
        fileSystem,
        now: () => new Date(AT),
        kane: false,
      },
    );
    expect(exitCode).toBe(EXIT_OK);
    const text = out.join('');
    expect(text).toContain('kept amend propose');
    expect(
      text,
      'the human summary is silent about a proposal that staged nothing, so a reader ' +
        'cannot tell a refusal from a success',
    ).toContain('outcome');
    expect(text).toContain("settled no promise as 'docs-lie'");
    expect(text, 'the branch the run did settle is not named').toContain("'test-drift'");
    // Still nothing staged, and the diagnostic stream is unchanged: this adds a line to
    // the summary and changes no behaviour.
    expect(
      fileSystem.writes.filter((path) =>
        path.startsWith(`${REPO}/${AMENDMENTS_DIRECTORY_RELATIVE_PATH}`),
      ),
    ).toEqual([]);
    expect(errors.join('')).not.toContain('amend-no-docs-lie');
  });

  it('stays silent about it when the proposal actually staged something', async () => {
    // The other half, so the line above cannot be printed unconditionally.
    const fileSystem = repositoryWith();
    const out: string[] = [];
    await main(['amend', 'propose', '--run', RUN_ID, '--text', REPLACEMENT], {
      write: (text: string) => out.push(text),
      writeError: () => undefined,
      cwd: REPO,
      env: {},
      fileSystem,
      now: () => new Date(AT),
      kane: false,
    });
    expect(out.join('')).not.toContain("settled no promise as 'docs-lie'");
  });

  it('carries --text through the parser verbatim, spaces and all', async () => {
    const fileSystem = repositoryWith();
    const out: string[] = [];
    const exitCode = await main(
      ['amend', 'propose', '--run', RUN_ID, '--text', REPLACEMENT, '--json'],
      {
        write: (text: string) => out.push(text),
        writeError: () => undefined,
        cwd: REPO,
        env: {},
        fileSystem,
        now: () => new Date(AT),
        kane: false,
      },
    );
    expect(exitCode).toBe(EXIT_OK);
    const payload = JSON.parse(out.join('')) as {
      readonly amendments: readonly { readonly proposedText: string }[];
    };
    expect(payload.amendments[0]?.proposedText).toBe(REPLACEMENT);
  });
});
