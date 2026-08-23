/**
 * `kept init`, one command that sets a host repository up and spends nothing
 * (design §21.1, R16.1 to R16.8).
 *
 * Four steps, in the design's order, stopping at the first that cannot proceed:
 *
 * 1. **Refuse if configured.** `.kept/config.json` present and `--force` absent:
 *    write nothing, name the existing path, exit 0 (R16.2). Not an error. Running
 *    `init` twice is a reasonable thing to do, and the second run's whole job is
 *    to say so, which is also what makes R16.8's byte-for-byte idempotence a
 *    consequence of the control flow rather than a promise to be careful.
 * 2. **Detect.** One depth-capped, skip-set walk for documentation candidates
 *    (`*.md`, `*.mdx`) and for an existing corpus (`*_test.md`), reporting every
 *    candidate with its path and its line count.
 * 3. **Write the config**, fail-closed.
 * 4. **Scaffold exactly one** `<corpus.root>/example_test.md`.
 *
 * Then the next command, which is `kept doctor` (R16.7).
 *
 * ## Two things this command deliberately does not do
 *
 * **It writes no citation for anything it detected** (R16.4). Detection reports;
 * it does not decide. Which sentences in a document are promises is the user's
 * judgement, and a tool that guesses produces a graph full of claims nobody meant
 * to make, every one of which then has to be argued out of the ledger by hand.
 *
 * **It leaves `subject.source` and all three fence allow-lists empty** (§20.4).
 * That is not an unfinished config: an empty allow-list is a closed fence, so an
 * unconfigured KEPT reports what it cannot do rather than authorising a repair
 * against a tree it was never told about. A helpfully populated `src/**` would be
 * a guess with write permission attached.
 *
 * ## No Kane boundary exists here (R16.6)
 *
 * There is no `invoker` seam on {@link InitRequest}, no import of the invocation
 * layer, and no process spawn anywhere below. That is the strongest available
 * form of "invokes Kane zero times and consumes zero credits": not a counter that
 * happens to read zero, but an absent door.
 *
 * ## The config shape
 *
 * The written file is a `KeptConfig` and is typed as one, so the writer and the
 * loader cannot disagree about the shape: every value that has a fail-closed
 * default comes from `DEFAULT_CONFIG` rather than being retyped here, and the
 * three fence keys come from `REPAIR_BRANCH_NAMES`. What this command decides is
 * only the two fields detection can answer, `corpus.root` and `subject.docs`,
 * and it leaves every other field at the default §20.4 already chose.
 */

import type {
  BaselineFileSystem,
  CollectingDiagnosticSink,
  Diagnostic,
  DiagnosticSink,
  StateFileSystem,
} from '@kept/core';
import {
  MAX_SCAN_DEPTH,
  createDiagnosticSink,
  isSkippedDirectoryName,
  isTestDocumentName,
  nodeBaselineFileSystem,
  nodeStateFileSystem,
} from '@kept/core';

import { EXIT_OK } from '../args.js';
import {
  CONFIG_FILE_RELATIVE_PATH,
  DEFAULT_CONFIG,
  REPAIR_BRANCH_NAMES,
  joinPath,
  type KeptConfig,
  type KeptFence,
  type RepairBranchName,
} from '../config.js';

/* `DEFAULT_CORPUS_ROOT` used to be declared here as the literal `tests`, beside the
   identical literal in `DEFAULT_CONFIG.corpus.root`. That is two homes for one
   documented default (§20.4, R15.2), and the day they disagreed `init` would scaffold
   the example into one directory while the loader scanned the other — a repository
   reporting zero promises with a perfectly valid config on disk. Every site below
   reads `DEFAULT_CONFIG.corpus.root`, which is the single home §20.4's table names. */

/** The one file step 4 scaffolds. Exactly one, ever. */
export const EXAMPLE_TEST_FILE_NAME = 'example_test.md';

/** The command `init` names as the next one to run (R16.7). */
export const NEXT_COMMAND = 'kept doctor';

/** Diagnostic codes this command reports. Stable; the Ledger keys off them. */
export const INIT_DIAGNOSTIC_CODES = Object.freeze({
  /** A config exists and `--force` was absent, so nothing was written (R16.2). */
  alreadyConfigured: 'init-already-configured',
  /** One detected documentation candidate, with its line count (R16.4). */
  documentDetected: 'init-document-detected',
  /** One detected `*_test.md`, with its line count. */
  corpusDetected: 'init-corpus-detected',
  /** No `*.md` or `*.mdx` anywhere, so the scaffold's tag cites nothing real. */
  documentsAbsent: 'init-documents-absent',
  /** `corpus.root` fell back to `DEFAULT_CONFIG.corpus.root`. */
  corpusRootDefaulted: 'init-corpus-root-defaulted',
  configWritten: 'init-config-written',
  /** `--force` replaced an existing config, naming it (R16.3). */
  configReplaced: 'init-config-replaced',
  exampleScaffolded: 'init-example-scaffolded',
  /** The example already existed, so it was left exactly as it was (R16.3). */
  examplePreserved: 'init-example-preserved',
  /** A write threw. Reported, never rethrown. */
  writeFailed: 'init-write-failed',
  /** A directory could not be listed. The rest of the walk continues. */
  directoryUnreadable: 'init-directory-unreadable',
  /** The walk hit {@link MAX_SCAN_DEPTH} and stopped descending. */
  depthCapped: 'init-depth-capped',
  nextCommand: 'init-next-command',
} as const);

/** The codes as a list, so a test can enumerate them. */
export const INIT_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(INIT_DIAGNOSTIC_CODES),
);

/* ──────────────────────────────── detection ────────────────────────────────── */

/** One file the walk found, with the line count R16.4 asks it to report. */
export interface DetectedFile {
  /** Repository-relative POSIX path. */
  readonly path: string;
  /** Lines of text, a trailing newline not counted as a line of its own. */
  readonly lines: number;
}

/** What one walk of a repository saw. No citation is derived from any of it. */
export interface InitDetection {
  /** Every `*.md` / `*.mdx` that is not a corpus file, shallowest first. */
  readonly documents: readonly DetectedFile[];
  /** Every `*_test.md`, shallowest first. */
  readonly corpusFiles: readonly DetectedFile[];
  /** What `corpus.root` will say. */
  readonly corpusRoot: string;
  /** What `subject.docs` will say. Sorted, deduplicated, possibly empty. */
  readonly docGlobs: readonly string[];
}

/** {@link detectInitCandidates}'s input. */
export interface DetectInitRequest {
  /** The `*.md` walk. Defaults to `nodeBaselineFileSystem(repoRoot)`. */
  readonly baselineFileSystem: BaselineFileSystem;
  readonly diagnostics?: DiagnosticSink | undefined;
}

/**
 * Lines of text in a document.
 *
 * A trailing newline terminates the last line rather than starting a new one, so
 * a three-line file reads as three whether or not it ends cleanly. Reported to
 * the user as a size, and used for nothing else: no line count decides anything.
 */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return body.split('\n').length;
}

/** Whether a file name is documentation this command would report as a candidate. */
export function isDocumentationName(name: string): boolean {
  if (isTestDocumentName(name)) return false;
  return name.endsWith('.md') || name.endsWith('.mdx');
}

/** Directory depth, so the walk's output can be ordered root-outward. */
function depthOf(path: string): number {
  return path.split('/').length - 1;
}

/** The directory part of a repository-relative path; `''` for a root-level file. */
function directoryOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

/**
 * Shallowest first, then lexicographic.
 *
 * Ordering is load-bearing exactly once: step 4 points the scaffold's tag at "the
 * first detected document", and a root `README.md` is a far better first guess at
 * a promise source than whichever file a directory listing happened to yield
 * first. Making the order a property of the paths rather than of the filesystem
 * also makes the same repository produce the same scaffold twice.
 */
function byDepthThenPath(left: DetectedFile, right: DetectedFile): number {
  const depth = depthOf(left.path) - depthOf(right.path);
  if (depth !== 0) return depth;
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

/**
 * The `subject.docs` globs for a set of detected documents.
 *
 * One glob per top-level directory that holds documentation, per extension that
 * was actually seen: root-level files give `*.md`, everything else gives
 * `<top>/**\/*.md`. Collapsing to the top segment keeps the list readable on a
 * monorepo, and emitting `*.mdx` only where an `.mdx` file exists keeps the config
 * a description of the repository rather than a wish about it.
 */
export function documentationGlobs(documents: readonly DetectedFile[]): readonly string[] {
  const globs = new Set<string>();
  for (const document of documents) {
    const extension = document.path.endsWith('.mdx') ? 'mdx' : 'md';
    const top = document.path.includes('/') ? (document.path.split('/')[0] as string) : '';
    globs.add(top === '' ? `*.${extension}` : `${top}/**/*.${extension}`);
  }
  return Object.freeze([...globs].sort());
}

/**
 * Where the corpus lives, from what was found.
 *
 * The directory holding the most `*_test.md` files wins, ties going to the
 * shallowest and then to the lexicographically smaller, because the busiest test
 * directory is the one a new example belongs in. Two cases fall back to
 * `DEFAULT_CONFIG.corpus.root`: no corpus at all, and a corpus that sits at the
 * repository root. The second is the one worth naming, because `corpus.root: ""`
 * would make the corpus glob match the entire repository, and every fence derived
 * from it would then be arguing about the whole tree.
 */
export function corpusRootFrom(corpusFiles: readonly DetectedFile[]): string {
  const counts = new Map<string, number>();
  for (const file of corpusFiles) {
    const directory = directoryOf(file.path);
    counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [directory, count] of [...counts.entries()].sort((left, right) =>
    left[0] < right[0] ? -1 : 1,
  )) {
    if (
      best === null ||
      count > bestCount ||
      (count === bestCount && depthOf(directory) < depthOf(best))
    ) {
      best = directory;
      bestCount = count;
    }
  }
  return best === null || best === '' ? DEFAULT_CONFIG.corpus.root : best;
}

/**
 * Walk the repository once and report what it holds.
 *
 * Total. A directory that cannot be listed is diagnosed and skipped, a cyclic
 * injected tree truncates at {@link MAX_SCAN_DEPTH} rather than hanging, and a
 * repository with nothing in it answers empty lists and the default corpus root.
 * The skip set is `isSkippedDirectoryName` and not a second list of its own, so
 * `node_modules`, `.git`, `dist`, `.next`, `.testmuai` and `output-*` mean the
 * same thing here as they do to the baseline scan.
 */
export function detectInitCandidates(request: DetectInitRequest): InitDetection {
  const fs = request.baselineFileSystem;
  const sink = request.diagnostics;
  const documents: DetectedFile[] = [];
  const corpusFiles: DetectedFile[] = [];
  const queue: { readonly dir: string; readonly depth: number }[] = [{ dir: '', depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift() as { readonly dir: string; readonly depth: number };
    let entries: readonly { readonly name: string; readonly isDirectory: boolean; readonly isFile: boolean }[];
    try {
      entries = fs.readDirectory(current.dir);
    } catch (cause) {
      sink?.report({
        code: INIT_DIAGNOSTIC_CODES.directoryUnreadable,
        severity: 'warn',
        message:
          `${current.dir === '' ? 'the repository root' : current.dir} could not be listed (` +
          `${cause instanceof Error ? cause.message : String(cause)}), so nothing under it was ` +
          `detected. The rest of the walk is unaffected.`,
        file: current.dir === '' ? null : current.dir,
      });
      continue;
    }

    for (const entry of [...entries].sort((left, right) => (left.name < right.name ? -1 : 1))) {
      const path = current.dir === '' ? entry.name : `${current.dir}/${entry.name}`;
      if (entry.isDirectory) {
        if (isSkippedDirectoryName(entry.name)) continue;
        if (current.depth + 1 > MAX_SCAN_DEPTH) {
          sink?.report({
            code: INIT_DIAGNOSTIC_CODES.depthCapped,
            severity: 'warn',
            message:
              `Stopped descending at ${path}: the walk is capped at ${MAX_SCAN_DEPTH} directory ` +
              `levels, so a cyclic tree truncates instead of hanging.`,
            file: path,
          });
          continue;
        }
        queue.push({ dir: path, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile) continue;
      const isCorpus = isTestDocumentName(entry.name);
      if (!isCorpus && !isDocumentationName(entry.name)) continue;
      let lines = 0;
      try {
        lines = countLines(fs.readFile(path) ?? '');
      } catch {
        // An unreadable candidate is still a candidate: the path is what the user
        // is being told about, and the line count is decoration on it.
        lines = 0;
      }
      (isCorpus ? corpusFiles : documents).push({ path, lines });
    }
  }

  documents.sort(byDepthThenPath);
  corpusFiles.sort(byDepthThenPath);

  for (const document of documents) {
    sink?.report({
      code: INIT_DIAGNOSTIC_CODES.documentDetected,
      severity: 'info',
      message:
        `Candidate promise source: ${document.path} (${document.lines} line` +
        `${document.lines === 1 ? '' : 's'}). No citation was written for it, because deciding ` +
        `which of its sentences are promises is your judgement and not this command's.`,
      file: document.path,
    });
  }
  for (const file of corpusFiles) {
    sink?.report({
      code: INIT_DIAGNOSTIC_CODES.corpusDetected,
      severity: 'info',
      message:
        `Existing designed test: ${file.path} (${file.lines} line` +
        `${file.lines === 1 ? '' : 's'})`,
      file: file.path,
    });
  }

  const corpusRoot = corpusRootFrom(corpusFiles);
  // Two distinguishable fallbacks, and the user is told which one happened: an
  // empty repository, or a corpus sitting loose at the root.
  const detectedDirectories = new Set(corpusFiles.map((file) => directoryOf(file.path)));
  if (!detectedDirectories.has(corpusRoot)) {
    sink?.report({
      code: INIT_DIAGNOSTIC_CODES.corpusRootDefaulted,
      severity: 'info',
      message:
        `corpus.root is '${corpusRoot}', because ` +
        (corpusFiles.length === 0
          ? 'no *_test.md file exists yet'
          : 'every *_test.md file detected sits at the repository root, and a corpus root of "" ' +
            'would make the corpus glob match the whole tree'),
      file: CONFIG_FILE_RELATIVE_PATH,
    });
  }

  return Object.freeze({
    documents: Object.freeze(documents),
    corpusFiles: Object.freeze(corpusFiles),
    corpusRoot,
    docGlobs: documentationGlobs(documents),
  });
}

/* ──────────────────────────── the written artefacts ────────────────────────── */

/**
 * The fail-closed config for one detection (§21.1 step 3, §20.4).
 *
 * Detection decides two fields. Every other value is `DEFAULT_CONFIG`'s, so the
 * file this command writes and the file the loader would fall back to differ in
 * exactly the two places the repository was actually inspected.
 */
export function initConfigFor(detection: InitDetection): KeptConfig {
  const closed: KeptFence = { allow: [] };
  const fences = Object.fromEntries(
    REPAIR_BRANCH_NAMES.map((branch) => [branch, closed]),
  ) as Record<RepairBranchName, KeptFence>;
  return {
    verdictRouter: DEFAULT_CONFIG.verdictRouter,
    memberDebug: DEFAULT_CONFIG.memberDebug,
    timeouts: {
      hookMs: DEFAULT_CONFIG.timeouts.hookMs,
      enrichmentMs: DEFAULT_CONFIG.timeouts.enrichmentMs,
      doctorMs: DEFAULT_CONFIG.timeouts.doctorMs,
    },
    corpus: { root: detection.corpusRoot },
    subject: {
      // Empty, and not a guess at `src/**`. §20.4: the `code-break` fence's
      // forbidden set is derived from what the subject *is*, so a source glob
      // invented here is a repair permission invented here.
      source: [],
      docs: [...detection.docGlobs],
      baseUrl: null,
    },
    // Three closed fences. An empty allow-list refuses every repair path, which is
    // the state an unconfigured repository should be in.
    fences,
  };
}

/** The config as bytes: two-space JSON, one trailing newline, stable key order. */
export function serialiseInitConfig(config: KeptConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * The scaffolded example (§21.1 step 4, R16.5).
 *
 * Three things it carries, and one it deliberately avoids.
 *
 * It carries a **frontmatter fence using only keys `kane-cli` accepts**, namely `mode`,
 * `tags` and `assurance`, because a root key outside that closed set makes the whole
 * document unrunnable with `unknown config key` before a browser starts. `url` is
 * left out rather than pointed at a guessed port, for the same reason
 * `subject.baseUrl` is written as null.
 *
 * It carries **one `@verifies` tag** citing line 1 of the first detected document,
 * and an **empty covers annotation**. Empty because the covers list is what aims a
 * repair at source, and `subject.source` is empty by design: a scaffold that
 * shipped `src/**` would hand a repair branch write access to a tree nobody has
 * confirmed exists. The reader is told to fill both in.
 *
 * And it avoids **spelling the tag marker a second time**. The explanatory comment
 * says "the verifies tag above" rather than repeating the literal marker, because
 * the baseline scan reports every line that mentions the marker without carrying a
 * well-formed tag as malformed, so a chattier comment would make `kept init`
 * produce a file that warns on the very next `kept build`.
 */
export function exampleTestDocument(detection: InitDetection): string {
  const first = detection.documents[0]?.path ?? null;
  const cited = first ?? 'README.md';
  return [
    '---',
    'mode: testing',
    'tags: [example, scaffold]',
    'assurance:',
    '  id: EXAMPLE-1',
    '---',
    '',
    '# Example designed test, scaffolded by kept init',
    '',
    `<!-- @verifies ${cited}:1 repoint this at the sentence you actually mean -->`,
    '<!-- @covers -->',
    '',
    '<!--',
    '  THIS FILE MEANS NOTHING UNTIL THE TWO ANNOTATIONS ABOVE ARE REPOINTED.',
    '',
    `  The verifies tag above cites line 1 of ${cited}${
      first === null
        ? ', which this repository does not contain: no .md or .mdx file was detected'
        : ', which is the first documentation file that was detected'
    }.`,
    '  That line was chosen because it is first, not because it states a promise.',
    '  kept init writes no citation of its own: which sentences in your documentation',
    '  are promises is your judgement, and a tool that guesses fills the ledger with',
    '  claims nobody meant to make. Point the tag at the line that states the claim',
    '  this test proves, and rewrite the steps below to prove it.',
    '',
    '  The covers list above is empty on purpose. It names the source paths this test',
    '  exercises, and it is what allows an automated repair to touch them, so nothing',
    '  is filled in until you fill it in. The same goes for subject.source and',
    '  subject.baseUrl in .kept/config.json.',
    '',
    '  Then run: kept doctor',
    '-->',
    '',
    '## Step 1: replace this step',
    '',
    'Navigate to the screen that shows the behaviour your claim describes.',
    '',
    '## Step 2: assert the claim',
    '',
    'Assert the observable value the cited line promises.',
    '',
  ].join('\n');
}

/* ──────────────────────────────── the command ──────────────────────────────── */

/** {@link runInit}'s input. Every seam has a production default. */
export interface InitRequest {
  /** Absolute repository root. `process.cwd()` is never substituted downstream. */
  readonly repoRoot: string;
  /** `--force`: replace the config, and only the config (R16.3). */
  readonly force?: boolean | undefined;
  /** Config and example reads and writes. Defaults to the `node:fs` implementation. */
  readonly fileSystem?: StateFileSystem | undefined;
  /** The detection walk. Defaults to `nodeBaselineFileSystem(repoRoot)`. */
  readonly baselineFileSystem?: BaselineFileSystem | undefined;
  /** Where every step reports. */
  readonly diagnostics?: CollectingDiagnosticSink | undefined;
}

/** What {@link runInit} did. */
export interface InitResult {
  /** Absolute path of `.kept/config.json`, written or not. */
  readonly configPath: string;
  /** True when the config's bytes were written. */
  readonly configWritten: boolean;
  /** The config as written, or null when nothing was written. */
  readonly config: KeptConfig | null;
  /** The path `--force` replaced, or null when there was nothing to replace. */
  readonly replacedConfigPath: string | null;
  /** True when step 1 refused: a config existed and `--force` was absent (R16.2). */
  readonly alreadyConfigured: boolean;
  /** Absolute path of the scaffolded example, written or not. */
  readonly examplePath: string;
  /** True when the example's bytes were written. False when it already existed. */
  readonly exampleWritten: boolean;
  /** Everything the walk saw. No citation was derived from any of it (R16.4). */
  readonly detection: InitDetection;
  /** Absolute paths written, in write order. Empty on the refusal path (R16.8). */
  readonly writes: readonly string[];
  /** The command to run next (R16.7). Always {@link NEXT_COMMAND}. */
  readonly nextCommand: string;
  /** Kane invocations. Typed as the literal `0`: there is no boundary to spawn. */
  readonly kaneInvocations: 0;
  /** Credits consumed. Typed as the literal `0`, for the same reason (R16.6). */
  readonly credits: 0;
  /** Always {@link EXIT_OK}. `init` has no failing exit (§14.2, R16.2). */
  readonly exitCode: number;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Run the initialisation.
 *
 * Never throws for any state of the world: an empty repository, a repository with
 * no Markdown at all, a config that already exists, a cyclic injected tree, an
 * unlistable directory, a read-only filesystem. Every one of those is a diagnostic
 * and an exit code of zero.
 */
export function runInit(request: InitRequest): InitResult {
  const sink = request.diagnostics ?? createDiagnosticSink();
  const fileSystem = request.fileSystem ?? nodeStateFileSystem();
  const configPath = joinPath(request.repoRoot, CONFIG_FILE_RELATIVE_PATH);
  const force = request.force === true;
  const writes: string[] = [];

  // ── 1. Refuse if configured (R16.2, R16.8). ────────────────────────────────
  // Read before anything else and return before anything else, so idempotence is
  // a property of the control flow: on the second run there is no code path
  // downstream of here that could touch a byte.
  const existing = readOrNull(fileSystem, configPath);
  if (existing !== null && !force) {
    sink.report({
      code: INIT_DIAGNOSTIC_CODES.alreadyConfigured,
      severity: 'info',
      message:
        `${CONFIG_FILE_RELATIVE_PATH} already exists at ${configPath}, so nothing was written ` +
        `and nothing was changed. This is not an error: run \`kept init --force\` to replace the ` +
        `configuration, or \`${NEXT_COMMAND}\` to check what this repository still needs.`,
      file: CONFIG_FILE_RELATIVE_PATH,
    });
    sink.report({
      code: INIT_DIAGNOSTIC_CODES.nextCommand,
      severity: 'info',
      message: `Next: ${NEXT_COMMAND}`,
    });
    return {
      configPath,
      configWritten: false,
      config: null,
      replacedConfigPath: null,
      alreadyConfigured: true,
      examplePath: joinPath(request.repoRoot, `${DEFAULT_CONFIG.corpus.root}/${EXAMPLE_TEST_FILE_NAME}`),
      exampleWritten: false,
      detection: EMPTY_DETECTION,
      writes: Object.freeze([]),
      nextCommand: NEXT_COMMAND,
      kaneInvocations: 0,
      credits: 0,
      exitCode: EXIT_OK,
      diagnostics: sink.entries,
    };
  }

  // ── 2. Detect. Reports every candidate, cites none of them (R16.4). ────────
  const detection = detectInitCandidates({
    baselineFileSystem: request.baselineFileSystem ?? nodeBaselineFileSystem(request.repoRoot),
    diagnostics: sink,
  });
  if (detection.documents.length === 0) {
    sink.report({
      code: INIT_DIAGNOSTIC_CODES.documentsAbsent,
      severity: 'info',
      message:
        `No .md or .mdx file was detected, so subject.docs is empty and the scaffolded example ` +
        `cites a file that does not exist yet. Nothing is wrong: KEPT verifies claims that are ` +
        `written down, and there is nothing written down here yet.`,
      file: CONFIG_FILE_RELATIVE_PATH,
    });
  }

  // ── 3. Write the config, fail-closed (§20.4). ─────────────────────────────
  const config = initConfigFor(detection);
  const configWritten = write(fileSystem, configPath, serialiseInitConfig(config), sink);
  if (configWritten) {
    writes.push(configPath);
    if (existing !== null) {
      sink.report({
        code: INIT_DIAGNOSTIC_CODES.configReplaced,
        severity: 'info',
        message:
          `--force replaced the configuration at ${configPath}. The scaffolded example was not ` +
          `replaced: overwriting a test you may have edited is a different and worse operation ` +
          `than overwriting a config this command wrote.`,
        file: CONFIG_FILE_RELATIVE_PATH,
      });
    } else {
      sink.report({
        code: INIT_DIAGNOSTIC_CODES.configWritten,
        severity: 'info',
        message:
          `Wrote ${configPath}: router '${config.verdictRouter}', corpus.root ` +
          `'${config.corpus.root}', subject.docs ` +
          `${config.subject.docs.length === 0 ? '[]' : `[${config.subject.docs.join(', ')}]`}. ` +
          `subject.source and all three fence allow-lists are empty, which closes every repair ` +
          `path until you open one deliberately.`,
        file: CONFIG_FILE_RELATIVE_PATH,
      });
    }
  }

  // ── 4. Scaffold exactly one example, and never a second (R16.5, R16.3). ────
  const exampleRelative = `${detection.corpusRoot}/${EXAMPLE_TEST_FILE_NAME}`;
  const examplePath = joinPath(request.repoRoot, exampleRelative);
  let exampleWritten = false;
  if (readOrNull(fileSystem, examplePath) !== null) {
    sink.report({
      code: INIT_DIAGNOSTIC_CODES.examplePreserved,
      severity: 'info',
      message:
        `${exampleRelative} already exists, so it was left byte-for-byte as it is. A scaffold is ` +
        `written once; after that the file is yours.`,
      file: exampleRelative,
    });
  } else {
    exampleWritten = write(fileSystem, examplePath, exampleTestDocument(detection), sink);
    if (exampleWritten) {
      writes.push(examplePath);
      sink.report({
        code: INIT_DIAGNOSTIC_CODES.exampleScaffolded,
        severity: 'info',
        message:
          `Scaffolded ${exampleRelative}, citing line 1 of ` +
          `${detection.documents[0]?.path ?? 'README.md'}. That citation is a placeholder chosen ` +
          `by position, not by meaning: repoint it before the file means anything.`,
        file: exampleRelative,
      });
    }
  }

  sink.report({
    code: INIT_DIAGNOSTIC_CODES.nextCommand,
    severity: 'info',
    message:
      `Next: ${NEXT_COMMAND}. It reports what this repository has and what it is still missing, ` +
      `on a bounded budget, without spending anything.`,
  });

  return {
    configPath,
    configWritten,
    config: configWritten ? config : null,
    replacedConfigPath: configWritten && existing !== null ? configPath : null,
    alreadyConfigured: false,
    examplePath,
    exampleWritten,
    detection,
    writes: Object.freeze([...writes]),
    nextCommand: NEXT_COMMAND,
    kaneInvocations: 0,
    credits: 0,
    exitCode: EXIT_OK,
    diagnostics: sink.entries,
  };
}

/** The detection reported on the refusal path: nothing was walked, so nothing is claimed. */
const EMPTY_DETECTION: InitDetection = Object.freeze({
  documents: Object.freeze([]) as readonly DetectedFile[],
  corpusFiles: Object.freeze([]) as readonly DetectedFile[],
  corpusRoot: DEFAULT_CONFIG.corpus.root,
  docGlobs: Object.freeze([]) as readonly string[],
});

/** A read that treats a throwing filesystem the same as an absent file. */
function readOrNull(fileSystem: StateFileSystem, path: string): string | null {
  try {
    return fileSystem.readFile(path);
  } catch {
    return null;
  }
}

/**
 * Write one file, reporting rather than throwing when the filesystem refuses.
 *
 * A read-only checkout is a state of the world, not a programming error, and
 * §14.2 keeps `kept`'s exit code a statement about whether KEPT worked. The
 * honest outcome here is a printed `error` naming the path, an exit code of zero,
 * and a result that says the file was not written.
 */
function write(
  fileSystem: StateFileSystem,
  path: string,
  contents: string,
  sink: DiagnosticSink,
): boolean {
  const cut = path.lastIndexOf('/');
  try {
    if (cut > 0) fileSystem.ensureDir(path.slice(0, cut));
    fileSystem.writeFile(path, contents);
    return true;
  } catch (cause) {
    sink.report({
      code: INIT_DIAGNOSTIC_CODES.writeFailed,
      severity: 'error',
      message:
        `${path} could not be written (${cause instanceof Error ? cause.message : String(cause)}), ` +
        `so it was left as it was. Nothing else was changed.`,
      file: null,
    });
    return false;
  }
}
