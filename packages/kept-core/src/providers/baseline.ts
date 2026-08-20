/**
 * The baseline promise provider — the floor under the whole system
 * (design §5.2, §5.5, R2.2, R2.3, R2.4).
 *
 * One sentence governs every line of this file: **`collect` resolves `ok: true`
 * for every repository state.** Not "usually", not "for well-formed
 * repositories" — for a missing root, an unreadable directory, a file named
 * `x_test.md` holding compiled bytes, frontmatter truncated mid-key, a tag
 * pointing at line zero of a file that does not exist, and a repository with no
 * `*_test.md` files at all. R2.4 states it unconditionally, so the type here is
 * the literal `true` and the compiler enforces it: {@link BaselineResult} cannot
 * be constructed with a failure.
 *
 * That is architectural rather than defensive. Assumption A2 makes the enrichment
 * axis optional — Kane can be absent, refuse, pause, time out or crash, and the
 * ledger still renders because baseline produced every promise, every citation
 * and every designed-test binding (§5.5). If baseline could fail, `kept build`
 * could fail, and a ledger that cannot build has nothing to show. So this module
 * never sets `degraded` either: that flag belongs exclusively to the enrichment
 * axis (§5.4 step 5), and a baseline-only graph is a *complete* graph missing one
 * axis, not a damaged one.
 *
 * The obvious way to get that wrong is to make "never fails" mean "silently finds
 * nothing". Three things stop it:
 *
 * 1. **A repository with no `*_test.md` files is distinguishable from one where
 *    every `*_test.md` was unreadable.** The first answers `files: []` plus a
 *    single `info` diagnostic saying zero test documents were found; the second
 *    answers `files` naming all of them, `skipped` equal to `files`, and one
 *    `warn` diagnostic per file naming that file (R2.3). Both answer zero
 *    candidates, and no caller has to guess which happened.
 * 2. **Every skip is named.** A file this provider could not read is listed in
 *    `skipped` *and* carries a diagnostic whose `file` field is that path.
 * 3. **A tag whose cited file or line does not resolve still becomes a
 *    candidate**, so the admission gate refuses it with `file-missing` or
 *    `line-out-of-range` and a reviewer is told (R1.4). Dropping it here would
 *    lose the claim and the complaint together.
 *
 * Reading is split deliberately. Directory traversal and `*_test.md` reads go
 * through {@link BaselineFileSystem}; **cited files are read through the
 * admission gate's own `CitationSource`** and never through this module's
 * filesystem. There is one place in the system that resolves a citation against
 * disk (§3.3), and the same source instance is used for the claim text and for
 * admission, so the two can never disagree.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  createDiagnosticSink,
  type Diagnostic,
  type DiagnosticSink,
} from '../diagnostics.js';
import {
  admitPromises,
  nodeCitationSource,
  type AdmissionBatch,
  type CitationSource,
  type PromiseCandidate,
} from '../model/admission.js';
import { toPosix } from '../model/ids.js';
import type { ProviderName } from '../model/promise.js';

import {
  NO_PROVIDER_AXES,
  type PromiseAdapter,
  type ProviderContext,
  type ProviderResult,
} from './adapter.js';

/** This provider's name in `ProviderName` terms. */
export const BASELINE_PROVIDER_NAME: ProviderName = 'baseline';

/**
 * The suffix that makes a file a test document. `**\/*_test.md` in glob terms,
 * matched by suffix because there is no glob dependency — the runtime budget of
 * design §2.2 is closed and `micromatch` is not in it.
 *
 * Case-sensitive, because the pattern in R2.2 is, and because a repository that
 * relies on `A_TEST.MD` matching would behave differently on a case-insensitive
 * filesystem than in CI.
 */
export const TEST_DOCUMENT_SUFFIX = '_test.md';

/**
 * Directories never descended into (design §5.2). Matched by exact name at any
 * depth, the way `node_modules` has to be.
 */
export const SKIPPED_DIRECTORY_NAMES: readonly string[] = Object.freeze([
  'node_modules',
  '.git',
  '.next',
  'dist',
  '.testmuai',
]);

/**
 * Directory-name prefixes never descended into — the `output-*` of §5.2.
 *
 * This one is load-bearing rather than housekeeping. An `output-` directory holds committed
 * Kane recordings, and a recording can perfectly well contain a file matching
 * `*_test.md`. Scanning it would mint promises out of a transcript of a previous
 * run, cited to files inside that transcript, and the ledger would start
 * claiming things about its own archive.
 */
export const SKIPPED_DIRECTORY_PREFIXES: readonly string[] = Object.freeze(['output-']);

/**
 * How deep the scan descends before it stops and says so.
 *
 * The `node:fs` implementation below reports a symlink as neither a file nor a
 * directory, so it is simply not followed and a symlink loop cannot form. The cap
 * is insurance for an injected filesystem that *does* present a cycle: the answer
 * to a cyclic tree is a truncated scan plus a diagnostic, never a hang. The
 * property suite injects exactly such a filesystem.
 */
export const MAX_SCAN_DEPTH = 16;

/**
 * How many *content* lines inside the `---` fence the frontmatter reader will
 * read (design §5.2). The closing fence may sit on the line immediately after
 * the twentieth of them and is still found; a twenty-first content line is not.
 *
 * Past the bound the reader stops, reports `baseline-frontmatter-unterminated`,
 * and returns no frontmatter at all — and then **the whole document is scanned
 * for tags**, fence lines included. That last part matters: an unterminated fence
 * means the reader cannot tell where the body starts, and losing a real
 * `@verifies` tag to a mistyped delimiter would be exactly the silent
 * under-reporting this module exists to avoid.
 */
export const FRONTMATTER_MAX_LINES = 20;

/** The frontmatter fence. Compared after trailing whitespace is removed. */
export const FRONTMATTER_FENCE = '---';

/**
 * The tag grammar (design §5.2, R2.2):
 *
 *     @verifies\s+(?<file>[^\s:]+):(?<line>\d+)
 *
 * `[^\s:]+` for the path means a colon cannot appear in it, so
 * `@verifies a:b.md:12` matches nothing and is reported as malformed rather than
 * being silently read as some other file. **Trailing free text is ignored**,
 * which is what lets a tag live inside a comment and read as prose:
 * `<!-- @verifies apps/fixture/README.md:16 the subtotal claim -->` yields
 * `apps/fixture/README.md` and line 16, and the words after it are dropped.
 *
 * Built fresh at every use: a `g`-flagged regex carries `lastIndex` between
 * calls, and a shared one would skip tags depending on what was scanned before.
 */
export const VERIFIES_TAG_SOURCE = '@verifies\\s+(?<file>[^\\s:]+):(?<line>\\d+)';

/** The bare marker, used only to notice a line that meant to carry a tag. */
const VERIFIES_MARKER = '@verifies';

/**
 * Diagnostic codes this provider reports. Stable strings — the Ledger's `/runs`
 * page and the property suite both key off them.
 *
 * Note what is *not* here: nothing about a cited file being absent or a cited
 * line being out of range. Those are the admission gate's diagnostics (§3.3), and
 * duplicating them would double-report every stale citation.
 */
export const BASELINE_DIAGNOSTIC_CODES = Object.freeze({
  /** Zero `*_test.md` files exist. Informational: a legitimate repository state. */
  noTestDocuments: 'baseline-no-test-documents',
  /** A directory could not be listed. The scan continues elsewhere. */
  directoryUnreadable: 'baseline-directory-unreadable',
  /** The depth cap stopped a descent. Only a cyclic tree should reach this. */
  depthCapped: 'baseline-scan-depth-capped',
  /** A `*_test.md` could not be read at all; skipped, named (R2.3). */
  documentUnreadable: 'baseline-document-unreadable',
  /** A `*_test.md` does not decode as text; skipped, named (R2.3). */
  documentNotText: 'baseline-document-not-text',
  /** The `---` fence never closed within the bound. Tags are still scanned. */
  frontmatterUnterminated: 'baseline-frontmatter-unterminated',
  /** A frontmatter line matched no supported form. Tags are still scanned. */
  frontmatterLineUnparsed: 'baseline-frontmatter-line-unparsed',
  /** A line says `@verifies` but carries no well-formed tag. */
  tagMalformed: 'baseline-verifies-tag-malformed',
  /** A tag parsed but names a line no citation can have. */
  tagLineInvalid: 'baseline-verifies-line-invalid',
  /** Should be unreachable. Present because R2.4 admits no exceptions. */
  unexpected: 'baseline-unexpected',
} as const);

/** Every code above, for tests and for the Ledger's filter list. */
export const BASELINE_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(BASELINE_DIAGNOSTIC_CODES),
);

/** One directory entry, as much of `Dirent` as this module needs. */
export interface BaselineDirEntry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
}

/**
 * The filesystem, injected — so the property suite exercises this exact code
 * path over generated trees with no disk anywhere.
 *
 * Paths are **repository-relative POSIX**, with `''` meaning the root, and the
 * implementation resolves them against a root it was built with. That follows
 * `nodeCitationSource(repoRoot)` (§3.3) rather than the absolute-path shape of
 * `EvidenceFileSystem`, and for a reason specific to this module: every path this
 * provider emits — in `candidates`, in `designedTest.path`, in every diagnostic —
 * is repository-relative, so a traversal that dealt in absolute paths would have
 * to relativise on the way out and that conversion is the kind of thing that goes
 * wrong once and is wrong forever in a committed snapshot. Method names are the
 * existing ones: `readDirectory` from `EvidenceFileSystem`, `readFile` from
 * `FailureYamlFileSystem`.
 *
 * Implementations may throw. Every call site treats a throw as adversity.
 */
export interface BaselineFileSystem {
  /** List a repository-relative directory; `''` is the root. */
  readDirectory(dir: string): readonly BaselineDirEntry[];
  /** Read a repository-relative file as UTF-8, or null when it cannot be read. */
  readFile(file: string): string | null;
}

/**
 * The production filesystem, rooted at `repoRoot`. Nothing outside the root is
 * ever listed or read, and `process.cwd()` is never consulted — a build invoked
 * from a subdirectory must scan the same tree.
 *
 * A symlink is neither `isDirectory` nor `isFile` here, so it is not descended
 * into and not read. That is the same treatment `EvidenceFileSystem` gives, and
 * it makes a symlink loop impossible rather than merely bounded.
 */
export function nodeBaselineFileSystem(repoRoot: string): BaselineFileSystem {
  const root = resolve(repoRoot);
  const absolute = (relativePath: string): string =>
    relativePath === '' ? root : join(root, relativePath);
  return {
    readDirectory(dir: string): readonly BaselineDirEntry[] {
      return readdirSync(absolute(dir), { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
      }));
    },
    readFile(file: string): string | null {
      const path = absolute(file);
      const stats = statSync(path, { throwIfNoEntry: false });
      if (stats === undefined || !stats.isFile()) return null;
      return readFileSync(path, { encoding: 'utf8' });
    },
  };
}

/**
 * Build a {@link BaselineFileSystem} over a map of repository-relative path →
 * contents. The directory tree is derived from the keys, so a test states the
 * files it wants and nothing else.
 *
 * The counterpart of `inMemoryCitationSource` (§3.3), and used the same way: the
 * property suite generates a whole repository and hands it in.
 */
export function inMemoryBaselineFileSystem(
  files: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): BaselineFileSystem {
  const entries =
    files instanceof Map
      ? [...files.entries()]
      : Object.entries(files as Readonly<Record<string, string>>);

  const contents = new Map<string, string>();
  /** dir → child name → whether that child is a directory. */
  const children = new Map<string, Map<string, boolean>>();

  const childrenOf = (dir: string): Map<string, boolean> => {
    const existing = children.get(dir);
    if (existing !== undefined) return existing;
    const created = new Map<string, boolean>();
    children.set(dir, created);
    return created;
  };
  childrenOf('');

  for (const [rawPath, text] of entries) {
    const path = toPosix(rawPath);
    if (path.length === 0) continue;
    contents.set(path, text);
    const segments = path.split('/').filter((segment) => segment.length > 0);
    let dir = '';
    for (let index = 0; index < segments.length; index += 1) {
      const name = segments[index] as string;
      const isDirectory = index < segments.length - 1;
      childrenOf(dir).set(name, isDirectory);
      dir = dir === '' ? name : `${dir}/${name}`;
      if (isDirectory) childrenOf(dir);
    }
  }

  return {
    readDirectory(dir: string): readonly BaselineDirEntry[] {
      const normalised = toPosix(dir);
      const found = children.get(normalised);
      if (found === undefined) {
        throw new Error(`ENOENT: no such directory ${normalised === '' ? '(root)' : normalised}`);
      }
      return [...found.entries()].map(([name, isDirectory]) => ({
        name,
        isDirectory,
        isFile: !isDirectory,
      }));
    },
    readFile(file: string): string | null {
      return contents.get(toPosix(file)) ?? null;
    },
  };
}

/** Whether a file name is a test document. */
export function isTestDocumentName(name: string): boolean {
  return typeof name === 'string' && name.endsWith(TEST_DOCUMENT_SUFFIX);
}

/** Whether a directory name is one the scan refuses to descend into. */
export function isSkippedDirectoryName(name: string): boolean {
  if (typeof name !== 'string') return false;
  if (SKIPPED_DIRECTORY_NAMES.includes(name)) return true;
  return SKIPPED_DIRECTORY_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * What the hand-rolled frontmatter reader understood.
 *
 * `testId` is read from `test_id` and is a **cache, not the authority**: design
 * §3.4 makes `testrun_plan.members[].test_id` authoritative, and the designed-test
 * node id is keyed on the document path (`designedTestId(path)`), never on this
 * value. So a stale or absent `test_id` in a document's frontmatter costs a
 * lookup hint and nothing else.
 */
export interface Frontmatter {
  /** Whether the document opened with a `---` fence at all. */
  readonly present: boolean;
  /** Whether that fence closed within {@link FRONTMATTER_MAX_LINES}. */
  readonly terminated: boolean;
  /** `test_id`, or null when absent or empty. A cache; see above. */
  readonly testId: string | null;
  /** `tags`, from either the inline-array or the `- item` list form. */
  readonly tags: readonly string[];
  /** `covers`, same two forms. */
  readonly covers: readonly string[];
  /**
   * How many document lines the block occupies, both fences included. Zero when
   * no fence opened, and zero when the fence never closed — in that case the
   * whole document is the body.
   */
  readonly lineSpan: number;
  /** One-based document line numbers that matched none of the supported forms. */
  readonly unparsedLines: readonly number[];
}

const EMPTY_FRONTMATTER: Frontmatter = Object.freeze({
  present: false,
  terminated: false,
  testId: null,
  tags: Object.freeze([]) as readonly string[],
  covers: Object.freeze([]) as readonly string[],
  lineSpan: 0,
  unparsedLines: Object.freeze([]) as readonly number[],
});

/** `key: value` — keys are conservative, so prose is never mistaken for a key. */
const KEY_VALUE = /^(?<key>[A-Za-z_][A-Za-z0-9_.-]*)\s*:\s*(?<value>.*)$/;

/** `- item` inside a list started by a bare `key:`. */
const LIST_ITEM = /^-\s+(?<item>.*)$/;

/** Strip one matching pair of surrounding quotes, if present. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' || first === "'") && first === last) return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** `[a, b]` → `['a', 'b']`. An empty `[]` is an empty list, not a one-item one. */
function parseInlineList(value: string): readonly string[] {
  const inner = value.slice(1, -1).trim();
  if (inner.length === 0) return [];
  return inner
    .split(',')
    .map((item) => unquote(item))
    .filter((item) => item.length > 0);
}

/**
 * The hand-rolled frontmatter reader (design §5.2).
 *
 * Hand-rolled and bounded on purpose. `yaml@2.9.0` is installed, but it is in the
 * budget for `failure.yaml` — a document Kane writes — and pointing a full YAML
 * parser at a hand-typed fence buys anchors, aliases and type coercion nobody
 * asked for, along with a parse that can fail in ways this provider is forbidden
 * to fail in. Four forms are supported, and that is the whole grammar:
 * `key: value`, `key: [a, b]`, a bare `key:` followed by `- item` lines, and
 * comments or blank lines, which are ignored.
 *
 * Total over every input. A line matching nothing is recorded in `unparsedLines`
 * and skipped; an unclosed fence answers {@link EMPTY_FRONTMATTER} with
 * `present: true`.
 */
export function readFrontmatter(lines: readonly string[]): Frontmatter {
  const first = lines[0];
  if (first === undefined || first.replace(/\s+$/, '') !== FRONTMATTER_FENCE) {
    return EMPTY_FRONTMATTER;
  }

  const scalars = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const unparsedLines: number[] = [];
  let pendingListKey: string | null = null;
  let terminated = false;
  let lineSpan = 0;

  // The bound is on *content* lines, so the closing fence may sit on the line
  // immediately after the twentieth of them and still be found.
  for (let offset = 1; offset <= FRONTMATTER_MAX_LINES + 1; offset += 1) {
    const raw = lines[offset];
    if (raw === undefined) break;
    const line = raw.replace(/\s+$/, '');
    if (line === FRONTMATTER_FENCE) {
      terminated = true;
      lineSpan = offset + 1;
      break;
    }
    if (offset > FRONTMATTER_MAX_LINES) break;

    const body = line.trim();
    if (body.length === 0 || body.startsWith('#')) continue;

    const item = LIST_ITEM.exec(body);
    if (item !== null && pendingListKey !== null) {
      const value = unquote(item.groups?.['item'] ?? '');
      if (value.length > 0) (lists.get(pendingListKey) as string[]).push(value);
      continue;
    }

    const pair = KEY_VALUE.exec(body);
    if (pair === null) {
      unparsedLines.push(offset + 1);
      continue;
    }

    const key = (pair.groups?.['key'] ?? '').toLowerCase();
    const value = (pair.groups?.['value'] ?? '').trim();
    pendingListKey = null;
    if (value.length === 0) {
      pendingListKey = key;
      if (!lists.has(key)) lists.set(key, []);
      continue;
    }
    if (value.startsWith('[') && value.endsWith(']')) {
      lists.set(key, [...parseInlineList(value)]);
      continue;
    }
    scalars.set(key, unquote(value));
  }

  if (!terminated) {
    return { ...EMPTY_FRONTMATTER, present: true, unparsedLines };
  }

  const testId = scalars.get('test_id') ?? '';
  return {
    present: true,
    terminated: true,
    testId: testId.length === 0 ? null : testId,
    tags: lists.get('tags') ?? (scalars.has('tags') ? [scalars.get('tags') as string] : []),
    covers: lists.get('covers') ?? (scalars.has('covers') ? [scalars.get('covers') as string] : []),
    lineSpan,
    unparsedLines,
  };
}

/** One accepted `@verifies` tag. */
export interface VerifiesTag {
  /** The cited file, POSIX-normalised. Never contains a colon (see the grammar). */
  readonly file: string;
  /** The cited one-based line. Always a positive safe integer. */
  readonly line: number;
  /** One-based line of the `*_test.md` the tag was written on, for diagnostics. */
  readonly at: number;
  /** Free text after the tag, kept only as a fallback claim. Never a citation. */
  readonly trailing: string;
}

/** A line that meant to carry a tag but does not, or names an impossible line. */
export interface RejectedTag {
  readonly at: number;
  readonly reason: 'malformed' | 'line-invalid';
  /** The offending text, clipped for a run log. */
  readonly text: string;
}

/** What {@link extractVerifiesTags} found. */
export interface VerifiesScan {
  readonly tags: readonly VerifiesTag[];
  readonly rejected: readonly RejectedTag[];
}

function clip(text: string, limit = 120): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length <= limit ? single : `${single.slice(0, limit - 1)}…`;
}

/**
 * Extract every well-formed tag from `lines`, whose first element is document
 * line `firstLine`.
 *
 * Accepted: any number of tags on one line; a tag anywhere in the line, inside a
 * comment or a list item or a table cell; free text after it, which is dropped;
 * leading zeros on the line number.
 *
 * Rejected, each with a `RejectedTag` and a diagnostic at the call site:
 *
 * - no colon (`@verifies README.md 12`), a non-numeric line (`README.md:abc`), a
 *   colon inside the path (`a:b.md:12`), or a bare `@verifies` — all
 *   `malformed`, reported once per line that says `@verifies` and yields no tag;
 * - line `0`, or a number too large to be an exact integer — `line-invalid`. A
 *   citation is a position in a file and zero is not one, so no candidate is
 *   minted; the alternative, forwarding it to the gate to be refused as
 *   out-of-range, would report a file's length as the reason a typo failed.
 *
 * Total. Never throws.
 */
export function extractVerifiesTags(lines: readonly string[], firstLine = 1): VerifiesScan {
  const tags: VerifiesTag[] = [];
  const rejected: RejectedTag[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || !line.includes(VERIFIES_MARKER)) continue;
    const at = firstLine + index;
    const pattern = new RegExp(VERIFIES_TAG_SOURCE, 'g');
    let accepted = 0;
    let match = pattern.exec(line);
    while (match !== null) {
      const file = match.groups?.['file'];
      const digits = match.groups?.['line'];
      if (file !== undefined && digits !== undefined) {
        const cited = Number.parseInt(digits, 10);
        if (Number.isSafeInteger(cited) && cited >= 1) {
          accepted += 1;
          tags.push({
            file: toPosix(file),
            line: cited,
            at,
            trailing: line.slice(match.index + match[0].length).trim(),
          });
        } else {
          rejected.push({ at, reason: 'line-invalid', text: clip(`${file}:${digits}`) });
        }
      }
      match = pattern.exec(line);
    }
    if (accepted === 0 && rejected.every((entry) => entry.at !== at)) {
      rejected.push({ at, reason: 'malformed', text: clip(line) });
    }
  }

  return { tags, rejected };
}

/**
 * Whether a `*_test.md` read as UTF-8 is not text after all, and so cannot be
 * parsed (R2.3).
 *
 * `readFileSync(…, 'utf8')` does not throw on compiled bytes: it substitutes
 * U+FFFD and hands back a plausible-looking string. Without this check a binary
 * file named `x_test.md` would be scanned for tags, find none, and be reported as
 * a document with nothing to say — indistinguishable from an honest one. Two
 * signals, both cheap and both conclusive enough: a NUL character, which no text
 * document contains, or replacement characters at a density prose does not reach.
 *
 * Costs a diagnostic and a skip. Never a throw.
 */
export function isUndecodableDocument(content: string): boolean {
  if (typeof content !== 'string') return true;
  if (content.includes('\u0000')) return true;
  let replacements = 0;
  for (const character of content) if (character === '\ufffd') replacements += 1;
  return replacements >= 3 && replacements * 20 >= content.length;
}

/** Split for scanning. `\r\n` and `\n` both terminate; no phantom final line. */
function documentLines(content: string): readonly string[] {
  const text = content.startsWith('\ufeff') ? content.slice(1) : content;
  const parts = text.split('\n');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

/** What {@link collectBaseline} answers, on top of the shared provider result. */
export interface BaselineResult extends ProviderResult {
  readonly provider: 'baseline';
  /**
   * Always `true`, as a type. R2.4 admits no failing repository state, so a
   * failure here is not expressible rather than merely unlikely.
   */
  readonly ok: true;
  /** Always null. Degradation is the enrichment axis's business alone (§5.4). */
  readonly degradedReason: null;
  /** Every `*_test.md` found, repository-relative POSIX, sorted. */
  readonly files: readonly string[];
  /** The subset of `files` that could not be read or decoded, in `files` order. */
  readonly skipped: readonly string[];
  /** Well-formed `@verifies` tags accepted. Equals `candidates.length`. */
  readonly tagCount: number;
}

/** {@link collectBaseline}'s input: the shared context plus this module's seams. */
export interface BaselineContext extends ProviderContext {
  /** Directory listing and `*_test.md` reads. Defaults to the `node:fs` one. */
  readonly fs?: BaselineFileSystem | undefined;
  /**
   * Cited-document reads, shared with the admission gate. Defaults to
   * `nodeCitationSource(repoRoot)`. Passing the *same* instance to
   * {@link collectBaseline} and to `admitPromises` is what guarantees the claim
   * text and the admitted citation text came from the same bytes.
   */
  readonly citations?: CitationSource | undefined;
}

/** A sink that also hands back what it recorded, so the result can carry it. */
function recording(sink: DiagnosticSink, into: Diagnostic[]): DiagnosticSink {
  return {
    report(draft): Diagnostic {
      const diagnostic = sink.report(draft);
      into.push(diagnostic);
      return diagnostic;
    },
  };
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Depth-capped, skip-set traversal for `*_test.md`. Never throws. */
function scanTestDocuments(fs: BaselineFileSystem, sink: DiagnosticSink): readonly string[] {
  const found: string[] = [];
  const queue: { readonly dir: string; readonly depth: number }[] = [{ dir: '', depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;

    let entries: readonly BaselineDirEntry[];
    try {
      entries = fs.readDirectory(current.dir);
    } catch (cause) {
      sink.report({
        code: BASELINE_DIAGNOSTIC_CODES.directoryUnreadable,
        severity: 'warn',
        message:
          `Could not list ${current.dir === '' ? 'the repository root' : current.dir} while ` +
          `scanning for ${TEST_DOCUMENT_SUFFIX} documents, so nothing under it was scanned: ` +
          `${describeCause(cause)}.`,
        file: current.dir === '' ? null : current.dir,
      });
      continue;
    }

    for (const entry of entries) {
      const path = current.dir === '' ? entry.name : `${current.dir}/${entry.name}`;
      if (entry.isDirectory) {
        if (isSkippedDirectoryName(entry.name)) continue;
        if (current.depth + 1 > MAX_SCAN_DEPTH) {
          sink.report({
            code: BASELINE_DIAGNOSTIC_CODES.depthCapped,
            severity: 'warn',
            message:
              `Stopped descending at ${path}: the scan is capped at ${MAX_SCAN_DEPTH} ` +
              `directory levels, so a cyclic tree truncates instead of hanging.`,
            file: path,
          });
          continue;
        }
        queue.push({ dir: path, depth: current.depth + 1 });
        continue;
      }
      if (entry.isFile && isTestDocumentName(entry.name)) found.push(path);
    }
  }

  return found.sort();
}

/** Everything one document contributes. */
interface DocumentScan {
  readonly candidates: readonly PromiseCandidate[];
  /** True when the document could not be read or decoded at all (R2.3). */
  readonly skipped: boolean;
}

function scanDocument(
  path: string,
  fs: BaselineFileSystem,
  citations: CitationSource,
  sink: DiagnosticSink,
): DocumentScan {
  let content: string | null;
  try {
    content = fs.readFile(path);
  } catch (cause) {
    sink.report({
      code: BASELINE_DIAGNOSTIC_CODES.documentUnreadable,
      severity: 'warn',
      message: `Skipped ${path}: it could not be read (${describeCause(cause)}). Scanning continues.`,
      file: path,
    });
    return { candidates: [], skipped: true };
  }

  if (content === null) {
    sink.report({
      code: BASELINE_DIAGNOSTIC_CODES.documentUnreadable,
      severity: 'warn',
      message: `Skipped ${path}: it could not be read. Scanning continues.`,
      file: path,
    });
    return { candidates: [], skipped: true };
  }

  if (isUndecodableDocument(content)) {
    sink.report({
      code: BASELINE_DIAGNOSTIC_CODES.documentNotText,
      severity: 'warn',
      message:
        `Skipped ${path}: it does not decode as UTF-8 text, so it cannot be parsed for ` +
        `${VERIFIES_MARKER} tags. Scanning continues.`,
      file: path,
    });
    return { candidates: [], skipped: true };
  }

  const lines = documentLines(content);
  const frontmatter = readFrontmatter(lines);

  if (frontmatter.present && !frontmatter.terminated) {
    sink.report({
      code: BASELINE_DIAGNOSTIC_CODES.frontmatterUnterminated,
      severity: 'warn',
      message:
        `The frontmatter block in ${path} did not close within ${FRONTMATTER_MAX_LINES} lines, ` +
        `so no frontmatter was read from it. The whole document was still scanned for ` +
        `${VERIFIES_MARKER} tags.`,
      file: path,
      line: 1,
    });
  }
  for (const at of frontmatter.unparsedLines) {
    sink.report({
      code: BASELINE_DIAGNOSTIC_CODES.frontmatterLineUnparsed,
      severity: 'info',
      message:
        `Ignored frontmatter line ${at} of ${path}: it is not \`key: value\`, ` +
        `\`key: [a, b]\`, or a \`- item\` list entry.`,
      file: path,
      line: at,
    });
  }

  // An unterminated fence means the body's start is unknown, so the whole
  // document is scanned rather than risk dropping a real tag.
  const bodyStart = frontmatter.terminated ? frontmatter.lineSpan : 0;
  const scan = extractVerifiesTags(lines.slice(bodyStart), bodyStart + 1);

  for (const rejection of scan.rejected) {
    const malformed = rejection.reason === 'malformed';
    sink.report({
      code: malformed
        ? BASELINE_DIAGNOSTIC_CODES.tagMalformed
        : BASELINE_DIAGNOSTIC_CODES.tagLineInvalid,
      severity: 'warn',
      message: malformed
        ? `${path}:${rejection.at} mentions ${VERIFIES_MARKER} but carries no tag of the form ` +
          `\`${VERIFIES_MARKER} <file>:<line>\`, so no promise was derived from it: ` +
          `${rejection.text}`
        : `${path}:${rejection.at} cites ${rejection.text}, which is not a one-based line ` +
          `number, so no promise was derived from it.`,
      file: path,
      line: rejection.at,
    });
  }

  const designedTest = { path, testId: frontmatter.testId };
  const candidates: PromiseCandidate[] = scan.tags.map((tag) => {
    // The claim is the cited line as read through the gate's own source, so the
    // promise id is keyed on the words in the file rather than on the words in
    // the tag (§3.2). When the citation does not resolve, the candidate is still
    // emitted: the gate refuses it and says why (R1.4, R1.5), and losing the
    // claim here would lose the complaint with it.
    let claim: string | null = null;
    try {
      const cited = citations.read(tag.file);
      if (cited !== null) claim = citedLineOf(cited, tag.line);
    } catch {
      claim = null;
    }
    return {
      claim: claim ?? (tag.trailing.length > 0 ? tag.trailing : `${tag.file}:${tag.line}`),
      citation: { file: tag.file, line: tag.line, text: claim ?? '' },
      provider: BASELINE_PROVIDER_NAME,
      designedTest,
      verdictSource: null,
      repair: null,
      evidencePackId: null,
      credits: null,
    };
  });

  return { candidates, skipped: false };
}

/**
 * The cited line, by the gate's own splitting rules. Duplicated in one small
 * function rather than imported as `citedLine` because this module must not
 * become a second authority on citation resolution — the value read here is only
 * ever a *claim*, and the citation text on the admitted record is overwritten
 * from disk by the gate regardless of what this returns (§3.3, R1.3).
 */
function citedLineOf(content: string, line: number): string | null {
  const lines = documentLines(content);
  return line >= 1 && line <= lines.length ? (lines[line - 1] as string) : null;
}

/**
 * Scan the repository for `*_test.md` documents and derive one candidate per
 * well-formed `@verifies` tag (R2.2).
 *
 * Resolves `ok: true` for every repository state (R2.4). The outermost `catch`
 * should be unreachable — every inner path is already wrapped — and exists
 * because R2.4 is unconditional: a programming error in this module must still
 * leave `kept build` able to render a ledger, loudly, with an `error` diagnostic
 * rather than an exception.
 */
export async function collectBaseline(context: BaselineContext): Promise<BaselineResult> {
  const reported: Diagnostic[] = [];
  const sink = recording(context.diagnostics ?? createDiagnosticSink(), reported);

  try {
    const fs = context.fs ?? nodeBaselineFileSystem(context.repoRoot);
    const citations = context.citations ?? nodeCitationSource(context.repoRoot);

    const files = scanTestDocuments(fs, sink);

    if (files.length === 0) {
      // Not a failure and not a degradation: a repository with no test documents
      // has no promises yet, and the metrics layer renders that as `n/a` rather
      // than dividing (R9.3). Recorded so it is distinguishable from a scan that
      // found documents and could read none of them.
      sink.report({
        code: BASELINE_DIAGNOSTIC_CODES.noTestDocuments,
        severity: 'info',
        message:
          `No ${TEST_DOCUMENT_SUFFIX} documents were found under the repository root, so the ` +
          `baseline provider derived no promises. This is a valid repository state.`,
        file: null,
      });
      return {
        provider: 'baseline',
        candidates: [],
        axes: NO_PROVIDER_AXES,
        ok: true,
        degradedReason: null,
        diagnostics: reported,
        files: [],
        skipped: [],
        tagCount: 0,
      };
    }

    const candidates: PromiseCandidate[] = [];
    const skipped: string[] = [];
    for (const path of files) {
      try {
        const scan = scanDocument(path, fs, citations, sink);
        if (scan.skipped) skipped.push(path);
        candidates.push(...scan.candidates);
      } catch (cause) {
        // One hostile document cannot stop the scan (R2.3).
        skipped.push(path);
        sink.report({
          code: BASELINE_DIAGNOSTIC_CODES.documentUnreadable,
          severity: 'warn',
          message: `Skipped ${path}: it could not be parsed (${describeCause(cause)}). Scanning continues.`,
          file: path,
        });
      }
    }

    return {
      provider: 'baseline',
      candidates,
      axes: NO_PROVIDER_AXES,
      ok: true,
      degradedReason: null,
      diagnostics: reported,
      files,
      skipped,
      tagCount: candidates.length,
    };
  } catch (cause) {
    sink.report({
      code: BASELINE_DIAGNOSTIC_CODES.unexpected,
      severity: 'error',
      message:
        `The baseline provider hit an unexpected error and derived no promises ` +
        `(${describeCause(cause)}). It still reports success, because R2.4 requires the ` +
        `baseline scan to complete for every repository state; this diagnostic is the bug ` +
        `report.`,
      file: null,
    });
    return {
      provider: 'baseline',
      candidates: [],
      axes: NO_PROVIDER_AXES,
      ok: true,
      degradedReason: null,
      diagnostics: reported,
      files: [],
      skipped: [],
      tagCount: 0,
    };
  }
}

/** The provider, as the shared interface sees it (R2.1). */
export const baselineProvider: PromiseAdapter = Object.freeze({
  name: BASELINE_PROVIDER_NAME,
  collect: (context: ProviderContext): Promise<ProviderResult> => collectBaseline(context),
});

/** {@link buildBaselineOnlyGraph}'s answer: the scan, and what the gate made of it. */
export interface BaselineOnlyGraph {
  readonly result: BaselineResult;
  readonly batch: AdmissionBatch;
}

/**
 * Scan, then funnel every candidate through the admission gate — the
 * baseline-only build of §5.5 (R2.12).
 *
 * This is the path taken when there is no Kane in the environment at all: the
 * graph has all its nodes and all its citations, and `degraded` is left `false`
 * here because *this provider* did not degrade. Whether the graph as a whole is
 * degraded is `!enrichment.ok`, decided by the merge of §5.4, which supersedes
 * this function whenever an enrichment result exists.
 *
 * One `CitationSource` is used for the claim text and for admission, so the
 * admitted `citation.text` and the derived claim came from the same read.
 */
export async function buildBaselineOnlyGraph(
  context: BaselineContext,
): Promise<BaselineOnlyGraph> {
  const sink = context.diagnostics ?? createDiagnosticSink();
  const citations = context.citations ?? nodeCitationSource(context.repoRoot);
  const result = await collectBaseline({ ...context, citations, diagnostics: sink });
  const batch = admitPromises({
    candidates: result.candidates,
    source: citations,
    diagnostics: sink,
    degraded: false,
    degradedReasons: [],
  });
  return { result, batch };
}
