/**
 * Documentation amendments — the third repair branch (design §8.1, §8.3, §8.4,
 * R7.3, R7.4, R7.6).
 *
 * When a promise goes red, one of three things is wrong: the product, the test,
 * or the documentation. This file is the third branch, and it is the one nothing
 * else in this category has. Everything about it is arranged around two
 * properties, because a product that got either of them wrong would be worse than
 * having no third branch at all.
 *
 * ## One: nothing outside `.kept/` is written until a human accepts
 *
 * {@link proposeAmendment} produces a record carrying the current text, the
 * proposed replacement, the interlock hash, the rationale and the evidence — and
 * writes it to `.kept/amendments/<id>.json`. It does not touch the documentation.
 * Not behind a flag, not on a "safe" subset of edits, not ever. A system that
 * silently rewrote a README so its own tests would pass is precisely the
 * dishonesty this ledger exists to prevent, and it would be indefensible.
 *
 * The guarantee is structural rather than careful. Every write in this module goes
 * through `keptWritePath` from `lineEdit.ts`, which answers `null` for any
 * destination outside `.kept/`; the single function in `src/repair/` that can
 * write elsewhere is `applyLineEdit`, and it is called from exactly one place in
 * this file — inside {@link acceptAmendment}, after the interlock has matched.
 * {@link rejectAmendment} writes one field of one JSON file and touches nothing
 * else.
 *
 * ## Two: the interlock, and exactly one line
 *
 * `expectedSha256` is taken at proposal time. {@link acceptAmendment} re-reads the
 * file, re-hashes the cited line, and on a mismatch answers `stale`: the
 * amendment's status becomes `stale`, a diagnostic says why, **no documentation
 * byte is written**, and the process exits zero. The document moved under the
 * proposal — somebody edited that line after KEPT read it — and applying a
 * replacement derived from text that is no longer there would clobber a human's
 * edit. Refusing is the whole value of the interlock.
 *
 * On a match, exactly one array element is replaced, the result is written to
 * `<file>.kept-tmp`, and that file is renamed over the original. Every other byte
 * is identical afterwards, including each other line's own terminator and the
 * file's trailing-newline state — `lineEdit.ts` explains how, and Property 19
 * asserts byte-level equality rather than line counts.
 *
 * ## What the hash is taken over, and a design note
 *
 * §8.3's annotation calls `expectedSha256` "sha256 of currentText"; §8.4 step 3
 * spells the comparison as `sha256(normaliseClaim(lines[line-1]))`. Those differ
 * whenever the cited line carries a bullet, indentation or a trailing space, so
 * one of them had to be chosen. **§8.4 wins**, and both sides now hash
 * `normaliseClaim(text)`: it is the operative algorithm, it is the one written as
 * an executable step, and it produces the better behaviour. A whitespace reflow or
 * a bullet changing from `-` to `*` does not invalidate a pending amendment,
 * because it does not change the claim — and, more importantly, `normaliseClaim`
 * is exactly the key `promiseId` is built from, so the interlock goes stale
 * precisely when the promise identity would have moved. Two facts that ought to
 * coincide, made to coincide. {@link amendmentInterlockHash} is the single site
 * that hashes, so the two ends cannot drift.
 *
 * ## What accepting does to the promise's identity
 *
 * `promiseId(citationFile, rawClaim)` is keyed on the file plus the **normalised
 * claim** and never on the line number, so changing the claim text changes the id.
 * An accepted amendment therefore does not repair a red promise — it **retires**
 * one and creates another. After the rebuild, `p_old` is gone from the graph and
 * `p_new` is in it, cited at the same file and line, designed by the same
 * `*_test.md` (a `@verifies` tag cites `file:line`, not text), and carrying no
 * verdict yet because no run has ever proved the new claim.
 *
 * That is the honest reading and it is deliberately not smoothed over. Carrying
 * the old verdict onto the new id would assert that Kane proved a sentence it
 * never saw. So: the amendment keeps `promiseId` pointing at the promise that was
 * red when it was proposed — a historical record, never rewritten — and
 * {@link amendedPromiseId} names the successor, which {@link AcceptResult} returns
 * as `successorPromiseId` so `/amendments` can link both ends of the change. The
 * red promise disappearing from the metric rail is not a bug in the count; it is
 * the count telling the truth about a claim nobody makes any more.
 */

import type { Diagnostic, DiagnosticDraft, DiagnosticSink } from '../diagnostics.js';
import { createDiagnosticSink } from '../diagnostics.js';
import { normaliseClaim, isPromiseId, promiseId, sha256Hex, toPosix } from '../model/ids.js';
import type { Citation, RepairStrategy } from '../model/promise.js';
import { isRepairStrategy } from '../model/promise.js';
import { AMENDMENT_STATUSES, type SnapshotAmendment } from '../model/snapshot.js';
import { nodeStateFileSystem, type StateFileSystem } from '../state.js';

import {
  applyLineEdit,
  nodeAtomicRenamer,
  splitDocument,
  tempPathFor,
  type AtomicRenamer,
} from './lineEdit.js';
import {
  keptWritePath,
  nodeRepairDirectoryReader,
  repairDirectoryOf,
  type RepairDirectoryReader,
} from './reviewCard.js';

/** Where amendments live. Gitignored: regenerable, and reviewable anyway. */
export const AMENDMENTS_DIRECTORY_RELATIVE_PATH = '.kept/amendments';

/** `am_` plus eight hex, matching the design's own example (§8.3). */
export const AMENDMENT_ID_PREFIX = 'am_';

/** Eight hex characters of the content hash (§8.3). */
export const AMENDMENT_ID_HASH_LENGTH = 8;

/** Diagnostic codes this module reports. Stable strings; the Ledger keys off them. */
export const AMENDMENT_DIAGNOSTIC_CODES = Object.freeze({
  /** An amendment was staged under `.kept/amendments/`. No document was touched. */
  proposed: 'amendment-proposed',
  /** The same amendment was already staged and was left exactly as it was. */
  exists: 'amendment-exists',
  /** The cited file could not be read, so there is nothing to amend. */
  fileMissing: 'amendment-file-missing',
  /** The cited line does not exist in the cited file. */
  lineOutOfRange: 'amendment-line-out-of-range',
  /** The proposal equals the current text, so there is nothing to propose. */
  unchanged: 'amendment-unchanged',
  /** A replacement carrying a line terminator would edit more than one line. */
  multiline: 'amendment-replacement-multiline',
  /** The amendment file could not be written. Nothing else happened either. */
  writeFailed: 'amendment-write-failed',
  /** A destination outside `.kept/` was refused before anything was opened. */
  writeRefused: 'amendment-write-refused',
  /** No amendment with that id is staged. */
  notFound: 'amendment-not-found',
  /** The file parsed but is not the shape this version writes. Discarded. */
  malformed: 'amendment-malformed',
  /** Accept or reject was asked of an amendment that is not pending. */
  notPending: 'amendment-not-pending',
  /** The interlock: the cited line changed since the proposal (§8.4 step 3). */
  stale: 'amendment-stale',
  /** The one line was replaced and the file renamed into place (§8.4 step 5). */
  applied: 'amendment-applied',
  /** The edit landed but the record could not be updated. Says so loudly. */
  recordFailed: 'amendment-record-write-failed',
  /** A human declined. Nothing else was touched (§8.4). */
  rejected: 'amendment-rejected',
} as const);

/** Every code above, so a test can enumerate them and the Ledger can filter. */
export const AMENDMENT_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(AMENDMENT_DIAGNOSTIC_CODES),
);

/** The amendment lifecycle (§8.3). `stale` is the interlock's answer. */
export type AmendmentStatus = (typeof AMENDMENT_STATUSES)[number];

/**
 * A proposed documentation edit (§8.3). Field-for-field `SnapshotAmendment`, for
 * the same reason a review card is `SnapshotReviewCard`: `kept snapshot` copies
 * these files through, that schema is strict, and a translation layer would be one
 * more place to get a field name wrong.
 */
export interface DocsAmendment {
  readonly id: string;
  readonly createdAt: string;
  readonly status: AmendmentStatus;
  readonly promiseId: string;
  readonly citation: Citation;
  /** The cited line as it was when the amendment was proposed, verbatim. */
  readonly currentText: string;
  /** The replacement. Never contains a line terminator. */
  readonly proposedText: string;
  /** `sha256(normaliseClaim(currentText))` — the interlock. See the header. */
  readonly expectedSha256: string;
  readonly rationale: string;
  readonly evidenceRef: string | null;
  /** Artefact label to public `/evidence/…` path. Sorted by key on the way out. */
  readonly artifacts: Readonly<Record<string, string>>;
  readonly strategy: RepairStrategy;
  readonly appliedAt: string | null;
}

/**
 * The amendment as `buildSnapshot` takes it. The shape is identical field for
 * field; this copies the artefact map so a caller cannot hand the snapshot a
 * frozen object it means to sort in place. `repair-docs-amendment.test.ts` runs a
 * produced amendment through the strict `SnapshotAmendmentSchema`, which is the
 * check that actually has teeth — it carries the id pattern and the 64-hex
 * interlock rule no structural type can express.
 */
export function toSnapshotAmendment(amendment: DocsAmendment): SnapshotAmendment {
  return { ...amendment, artifacts: { ...amendment.artifacts } };
}

/** Absolute path of the amendment directory under a repository root. */
export function amendmentsDirectory(repoRoot: string): string {
  return repairDirectoryOf(repoRoot, AMENDMENTS_DIRECTORY_RELATIVE_PATH);
}

/** Absolute path of one amendment. */
export function amendmentPath(repoRoot: string, id: string): string {
  return `${amendmentsDirectory(repoRoot)}/${id}.json`;
}

/**
 * `am_` plus eight hex of the promise id and the proposed text (§8.3).
 *
 * Idempotent by construction: proposing the same replacement for the same promise
 * twice is one amendment, so a hook that fires on every save cannot accumulate
 * duplicates. Deliberately *not* keyed on the current text — a whitespace reflow
 * of the cited line is the same proposal, and re-keying on it would produce a
 * second amendment that says exactly what the first one says.
 */
export function amendmentId(promiseIdentifier: string, proposedText: string): string {
  const key = `${promiseIdentifier}\n${proposedText}`;
  return AMENDMENT_ID_PREFIX + sha256Hex(key).slice(0, AMENDMENT_ID_HASH_LENGTH);
}

/**
 * The interlock hash — the one site that hashes, so the proposal and the
 * acceptance cannot disagree about what is being compared (§8.4 step 3).
 */
export function amendmentInterlockHash(text: string): string {
  return sha256Hex(normaliseClaim(text));
}

/**
 * The id the amended claim will key on after the rebuild.
 *
 * Accepting changes the claim text, and promise identity is file plus normalised
 * claim, so the amended claim is a **different promise**. See the module header
 * for why that is the honest answer rather than a defect to paper over.
 */
export function amendedPromiseId(amendment: DocsAmendment): string {
  return promiseId(amendment.citation.file, amendment.proposedText);
}

/** Whether a string is a well-formed amendment id. */
export function isAmendmentId(value: unknown): value is string {
  return typeof value === 'string' && /^am_[0-9a-f]{8}$/.test(value);
}

/** Canonical bytes: the design's field order, artefact keys sorted, one newline. */
export function serialiseAmendment(amendment: DocsAmendment): string {
  const artifacts: Record<string, string> = {};
  for (const key of Object.keys(amendment.artifacts).sort()) {
    const value = amendment.artifacts[key];
    if (value !== undefined) artifacts[key] = value;
  }
  return `${JSON.stringify(
    {
      id: amendment.id,
      createdAt: amendment.createdAt,
      status: amendment.status,
      promiseId: amendment.promiseId,
      citation: {
        file: amendment.citation.file,
        line: amendment.citation.line,
        text: amendment.citation.text,
      },
      currentText: amendment.currentText,
      proposedText: amendment.proposedText,
      expectedSha256: amendment.expectedSha256,
      rationale: amendment.rationale,
      evidenceRef: amendment.evidenceRef,
      artifacts,
      strategy: amendment.strategy,
      appliedAt: amendment.appliedAt,
    },
    null,
    2,
  )}\n`;
}

/** Structural guard for an amendment read back off disk. */
export function isDocsAmendment(value: unknown): value is DocsAmendment {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!isAmendmentId(candidate['id'])) return false;
  const createdAt = candidate['createdAt'];
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) return false;
  if (!(AMENDMENT_STATUSES as readonly string[]).includes(candidate['status'] as string)) {
    return false;
  }
  if (!isPromiseId(candidate['promiseId'])) return false;
  const citation = candidate['citation'];
  if (typeof citation !== 'object' || citation === null) return false;
  const cited = citation as Record<string, unknown>;
  const file = cited['file'];
  if (typeof file !== 'string' || file.length === 0) return false;
  const line = cited['line'];
  if (!Number.isInteger(line) || (line as number) < 1) return false;
  if (typeof cited['text'] !== 'string') return false;
  if (typeof candidate['currentText'] !== 'string') return false;
  if (typeof candidate['proposedText'] !== 'string') return false;
  const digest = candidate['expectedSha256'];
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) return false;
  if (typeof candidate['rationale'] !== 'string') return false;
  const evidenceRef = candidate['evidenceRef'];
  if (evidenceRef !== null && (typeof evidenceRef !== 'string' || evidenceRef.length === 0)) {
    return false;
  }
  const artifacts = candidate['artifacts'];
  if (typeof artifacts !== 'object' || artifacts === null || Array.isArray(artifacts)) return false;
  if (!Object.values(artifacts as Record<string, unknown>).every((v) => typeof v === 'string')) {
    return false;
  }
  if (!isRepairStrategy(candidate['strategy'])) return false;
  const appliedAt = candidate['appliedAt'];
  return appliedAt === null || (typeof appliedAt === 'string' && !Number.isNaN(Date.parse(appliedAt)));
}

/** Parse an amendment, answering null rather than throwing (the `cache.ts` idiom). */
export function parseDocsAmendment(
  text: string,
  options: { readonly file?: string; readonly diagnostics?: DiagnosticSink } = {},
): DocsAmendment | null {
  const report = (draft: DiagnosticDraft): void => {
    options.diagnostics?.report(draft);
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    report({
      code: AMENDMENT_DIAGNOSTIC_CODES.malformed,
      severity: 'warn',
      message:
        `${options.file ?? 'an amendment'} is not valid JSON (${describe(cause)}), so it is ` +
        `discarded. Nothing is applied from a record this version cannot read.`,
      file: options.file ?? null,
    });
    return null;
  }
  if (!isDocsAmendment(parsed)) {
    report({
      code: AMENDMENT_DIAGNOSTIC_CODES.malformed,
      severity: 'warn',
      message:
        `${options.file ?? 'an amendment'} is not the shape this version writes, so it is ` +
        `discarded rather than acted on: an interlock we cannot read is an interlock we cannot ` +
        `honour, and applying an edit past one would be the failure it exists to prevent.`,
      file: options.file ?? null,
    });
    return null;
  }
  return parsed;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function relativeAmendmentPath(id: string): string {
  return `${AMENDMENTS_DIRECTORY_RELATIVE_PATH}/${id}.json`;
}

function absoluteDocumentPath(repoRoot: string, file: string): string {
  const root = repoRoot.endsWith('/') ? repoRoot.slice(0, -1) : repoRoot;
  return `${root}/${toPosix(file)}`;
}

// ---------------------------------------------------------------------------
// Persistence — always under `.kept/`
// ---------------------------------------------------------------------------

/** Write an amendment record, refusing any destination outside `.kept/`. */
function writeAmendmentRecord(
  repoRoot: string,
  amendment: DocsAmendment,
  fileSystem: StateFileSystem,
  report: (draft: DiagnosticDraft) => Diagnostic,
): Diagnostic | null {
  const path = amendmentPath(repoRoot, amendment.id);
  if (keptWritePath(repoRoot, path) === null) {
    return report({
      code: AMENDMENT_DIAGNOSTIC_CODES.writeRefused,
      severity: 'error',
      message:
        `An amendment would have been written to '${path}', which is not under .kept/. Refused ` +
        `before opening anything: a proposal writes no documentation byte, so this module has no ` +
        `path that can write outside .kept/.`,
      file: null,
    });
  }
  try {
    fileSystem.ensureDir(amendmentsDirectory(repoRoot));
    fileSystem.writeFile(path, serialiseAmendment(amendment));
    return null;
  } catch (cause) {
    return report({
      code: AMENDMENT_DIAGNOSTIC_CODES.writeFailed,
      severity: 'warn',
      message:
        `${relativeAmendmentPath(amendment.id)} could not be written (${describe(cause)}).`,
      file: relativeAmendmentPath(amendment.id),
    });
  }
}

/** Read one amendment off disk, or null when absent, unreadable or malformed. */
export function readAmendment(
  repoRoot: string,
  id: string,
  options: {
    readonly fileSystem?: StateFileSystem | undefined;
    readonly diagnostics?: DiagnosticSink | undefined;
  } = {},
): DocsAmendment | null {
  const fileSystem = options.fileSystem ?? nodeStateFileSystem();
  let text: string | null;
  try {
    text = fileSystem.readFile(amendmentPath(repoRoot, id));
  } catch {
    text = null;
  }
  if (text === null) return null;
  const parseOptions =
    options.diagnostics === undefined
      ? { file: relativeAmendmentPath(id) }
      : { file: relativeAmendmentPath(id), diagnostics: options.diagnostics };
  return parseDocsAmendment(text, parseOptions);
}

/**
 * Every amendment in the store, sorted by id.
 *
 * The seam `kept snapshot` fills its `amendments` field from, `kept amend list`
 * enumerates and `/amendments` renders (task 14.6). One unreadable file is
 * skipped with a diagnostic rather than taking the snapshot build down.
 */
export function listAmendments(
  repoRoot: string,
  options: {
    readonly fileSystem?: StateFileSystem | undefined;
    readonly readDirectory?: RepairDirectoryReader | undefined;
    readonly diagnostics?: DiagnosticSink | undefined;
  } = {},
): readonly DocsAmendment[] {
  const readDirectory = options.readDirectory ?? nodeRepairDirectoryReader;
  let names: readonly string[];
  try {
    names = readDirectory(amendmentsDirectory(repoRoot));
  } catch {
    names = [];
  }
  const amendments: DocsAmendment[] = [];
  for (const name of [...names].sort()) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -'.json'.length);
    if (!isAmendmentId(id)) continue;
    const amendment = readAmendment(repoRoot, id, options);
    if (amendment !== null) amendments.push(amendment);
  }
  return Object.freeze(
    amendments.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
  );
}

// ---------------------------------------------------------------------------
// propose() — writes only under `.kept/` (R7.4)
// ---------------------------------------------------------------------------

/** Why a proposal was refused. Every one of them wrote nothing at all. */
export type ProposeRefusal =
  | 'file-missing'
  | 'line-out-of-range'
  | 'unchanged'
  | 'multiline'
  | 'unattributed'
  | 'write-failed';

/** What {@link proposeAmendment} did. */
export type ProposeResult =
  | {
      readonly ok: true;
      readonly amendment: DocsAmendment;
      readonly path: string;
      /** Whether bytes were written by this call. */
      readonly wrote: boolean;
      /** Whether the amendment was already staged and was left as it was. */
      readonly existed: boolean;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly ok: false;
      readonly reason: ProposeRefusal;
      readonly diagnostics: readonly Diagnostic[];
    };

/** {@link proposeAmendment}'s input. Every seam has a production default. */
export interface ProposeAmendmentRequest {
  /** Absolute repository root. `.kept/amendments/` sits under it. */
  readonly repoRoot: string;
  /** The promise as it is now — red, and cited at the line to be amended. */
  readonly promiseId: string;
  /** Where the claim is made. `line` is one-based (R1.3). */
  readonly citation: Citation;
  /** The replacement sentence. A line terminator in it is refused. */
  readonly proposedText: string;
  /** Why. Kane's own observation, quoted rather than paraphrased. */
  readonly rationale: string;
  /** Which router settled the branch. */
  readonly strategy: RepairStrategy;
  /** Repo-relative reference into a committed pack, or null. */
  readonly evidenceRef?: string | null | undefined;
  /** Artefact label to public `/evidence/…` path. */
  readonly artifacts?: Readonly<Record<string, string>> | undefined;
  /** ISO 8601. Defaults to now. */
  readonly at?: string | undefined;
  /** Document reads and `.kept/` writes. Defaults to `node:fs`. */
  readonly fileSystem?: StateFileSystem | undefined;
  readonly diagnostics?: DiagnosticSink | undefined;
}

/**
 * Stage an amendment (§8.3, R7.3, R7.4).
 *
 * Reads the cited line so `currentText` and the interlock are taken from what is
 * actually on disk rather than from a citation recorded minutes ago, then writes
 * **one** file under `.kept/amendments/`. No documentation byte is written by any
 * path through this function, including its failure paths.
 */
export function proposeAmendment(request: ProposeAmendmentRequest): ProposeResult {
  const sink = request.diagnostics ?? createDiagnosticSink();
  const fileSystem = request.fileSystem ?? nodeStateFileSystem();
  const diagnostics: Diagnostic[] = [];
  const report = (draft: DiagnosticDraft): Diagnostic => {
    const entry = sink.report(draft);
    diagnostics.push(entry);
    return entry;
  };
  const file = toPosix(request.citation.file);
  const at = request.at ?? new Date().toISOString();

  if (!isPromiseId(request.promiseId)) {
    report({
      code: AMENDMENT_DIAGNOSTIC_CODES.notFound,
      severity: 'warn',
      message:
        `An amendment was requested for '${request.promiseId}', which is not a promise id this ` +
        `graph could carry, so nothing was staged.`,
      file,
    });
    return { ok: false, reason: 'unattributed', diagnostics: Object.freeze(diagnostics) };
  }

  if (request.proposedText.includes('\n') || request.proposedText.includes('\r')) {
    report({
      code: AMENDMENT_DIAGNOSTIC_CODES.multiline,
      severity: 'warn',
      message:
        `The proposed replacement for ${file}:${request.citation.line} carries a line ` +
        `terminator. An amendment edits exactly one line, so a replacement that would split it ` +
        `into two is refused: every citation below it would shift.`,
      file,
      line: request.citation.line,
    });
    return { ok: false, reason: 'multiline', diagnostics: Object.freeze(diagnostics) };
  }

  let content: string | null;
  try {
    content = fileSystem.readFile(absoluteDocumentPath(request.repoRoot, file));
  } catch {
    content = null;
  }
  if (content === null) {
    report({
      code: AMENDMENT_DIAGNOSTIC_CODES.fileMissing,
      severity: 'warn',
      message: `${file} could not be read, so there is no current text to amend.`,
      file,
    });
    return { ok: false, reason: 'file-missing', diagnostics: Object.freeze(diagnostics) };
  }

  const lines = splitDocument(content).lines;
  const target = lines[request.citation.line - 1];
  if (target === undefined) {
    report({
      code: AMENDMENT_DIAGNOSTIC_CODES.lineOutOfRange,
      severity: 'warn',
      message:
        `${file} has ${lines.length} line${lines.length === 1 ? '' : 's'}, so line ` +
        `${request.citation.line} does not exist and no amendment was staged.`,
      file,
      line: request.citation.line,
    });
    return { ok: false, reason: 'line-out-of-range', diagnostics: Object.freeze(diagnostics) };
  }

  const currentText = target.text;
  if (normaliseClaim(currentText) === normaliseClaim(request.proposedText)) {
    report({
      code: AMENDMENT_DIAGNOSTIC_CODES.unchanged,
      severity: 'info',
      message:
        `The proposed replacement for ${file}:${request.citation.line} makes the same claim as ` +
        `the line already there, so there is nothing to propose.`,
      file,
      line: request.citation.line,
    });
    return { ok: false, reason: 'unchanged', diagnostics: Object.freeze(diagnostics) };
  }

  const id = amendmentId(request.promiseId, request.proposedText);
  const amendment: DocsAmendment = {
    id,
    createdAt: at,
    status: 'pending',
    promiseId: request.promiseId,
    citation: { file, line: request.citation.line, text: currentText },
    currentText,
    proposedText: request.proposedText,
    expectedSha256: amendmentInterlockHash(currentText),
    rationale: request.rationale,
    evidenceRef: request.evidenceRef ?? null,
    artifacts: Object.freeze({ ...(request.artifacts ?? {}) }),
    strategy: request.strategy,
    appliedAt: null,
  };

  const existing = readAmendment(request.repoRoot, id, { fileSystem, diagnostics: sink });
  if (existing !== null) {
    report({
      code: AMENDMENT_DIAGNOSTIC_CODES.exists,
      severity: 'info',
      message:
        `${relativeAmendmentPath(id)} is already staged with status '${existing.status}' and was ` +
        `left exactly as it was. The id is derived from the promise and the proposed text, so ` +
        `re-proposing the same replacement is the same amendment — and a human may already have ` +
        `decided about it.`,
      file: relativeAmendmentPath(id),
    });
    return {
      ok: true,
      amendment: existing,
      path: amendmentPath(request.repoRoot, id),
      wrote: false,
      existed: true,
      diagnostics: Object.freeze(diagnostics),
    };
  }

  const failure = writeAmendmentRecord(request.repoRoot, amendment, fileSystem, report);
  if (failure !== null) {
    return { ok: false, reason: 'write-failed', diagnostics: Object.freeze(diagnostics) };
  }

  report({
    code: AMENDMENT_DIAGNOSTIC_CODES.proposed,
    severity: 'info',
    message:
      `${relativeAmendmentPath(id)} proposes replacing ${file}:${request.citation.line}. No ` +
      `documentation byte was written: run \`kept amend accept ${id}\` to apply it, and the ` +
      `interlock refuses if that line has changed in the meantime.`,
    file: relativeAmendmentPath(id),
  });

  return {
    ok: true,
    amendment,
    path: amendmentPath(request.repoRoot, id),
    wrote: true,
    existed: false,
    diagnostics: Object.freeze(diagnostics),
  };
}

// ---------------------------------------------------------------------------
// accept() — the interlock, then exactly one line (§8.4)
// ---------------------------------------------------------------------------

/** How an acceptance ended. Every outcome is data; the CLI still exits zero. */
export type AcceptOutcome = 'applied' | 'stale' | 'not-pending' | 'not-found' | 'refused';

/** What {@link acceptAmendment} did. */
export interface AcceptResult {
  readonly outcome: AcceptOutcome;
  /** The amendment as it now stands, or null when none was found. */
  readonly amendment: DocsAmendment | null;
  /** Whether a documentation byte was written. False for every non-`applied`. */
  readonly applied: boolean;
  /** Whether the record on disk now reflects the outcome. */
  readonly recorded: boolean;
  /** The amended document's bytes, when it was written. */
  readonly content: string | null;
  /**
   * The id the amended claim keys on after the rebuild. Present on `applied`,
   * because an accepted amendment retires one promise and creates another — see
   * the module header.
   */
  readonly successorPromiseId: string | null;
  /**
   * Whether the caller must rebuild the graph and rewrite the snapshot (§8.4
   * step 7, R7.6). True exactly when a document was written. `runBuild` and
   * `runSnapshot` live in `@corgod/kept-cli`, so core reports the obligation rather than
   * discharging it: `kept amend accept` is the one place that can honour it.
   */
  readonly rebuildRequired: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

/** {@link acceptAmendment}'s input. Every seam has a production default. */
export interface AcceptAmendmentRequest {
  readonly repoRoot: string;
  /** The amendment id, as `kept amend accept <id>` received it. */
  readonly id: string;
  /** ISO 8601 written into `appliedAt`. Defaults to now. */
  readonly at?: string | undefined;
  /** Document and record reads and writes. Defaults to `node:fs`. */
  readonly fileSystem?: StateFileSystem | undefined;
  /** The atomic rename of §8.4 step 5. Defaults to `rename(2)`. */
  readonly rename?: AtomicRenamer | undefined;
  readonly diagnostics?: DiagnosticSink | undefined;
}

/**
 * Accept an amendment — the seven steps of §8.4, in order.
 *
 * The interlock is the reason this function exists in the shape it does. On a
 * mismatch it records `stale`, reports why, and writes **no** documentation byte;
 * the caller exits zero, because a document that moved under a proposal is a
 * state of the world and not a failure of KEPT (§14.2).
 */
export function acceptAmendment(request: AcceptAmendmentRequest): AcceptResult {
  const sink = request.diagnostics ?? createDiagnosticSink();
  const fileSystem = request.fileSystem ?? nodeStateFileSystem();
  const rename = request.rename ?? nodeAtomicRenamer;
  const at = request.at ?? new Date().toISOString();
  const diagnostics: Diagnostic[] = [];
  const report = (draft: DiagnosticDraft): Diagnostic => {
    const entry = sink.report(draft);
    diagnostics.push(entry);
    return entry;
  };

  const refuse = (
    outcome: AcceptOutcome,
    amendment: DocsAmendment | null,
    recorded: boolean,
  ): AcceptResult => ({
    outcome,
    amendment,
    applied: false,
    recorded,
    content: null,
    successorPromiseId: null,
    rebuildRequired: false,
    diagnostics: Object.freeze(diagnostics),
  });

  // ── Step 1. Load, and refuse anything that is not pending. ────────────────
  const amendment = readAmendment(request.repoRoot, request.id, {
    fileSystem,
    diagnostics: sink,
  });
  if (amendment === null) {
    report({
      code: AMENDMENT_DIAGNOSTIC_CODES.notFound,
      severity: 'warn',
      message: `No amendment '${request.id}' is staged, so nothing was applied.`,
      file: relativeAmendmentPath(request.id),
    });
    return refuse('not-found', null, false);
  }
  if (amendment.status !== 'pending') {
    report({
      code: AMENDMENT_DIAGNOSTIC_CODES.notPending,
      severity: 'warn',
      message:
        `Amendment ${amendment.id} is '${amendment.status}', not 'pending', so it was not ` +
        `applied. An accepted amendment is already in the file and a rejected one was declined; ` +
        `re-applying either would edit a document nobody asked to change.`,
      file: relativeAmendmentPath(amendment.id),
    });
    return refuse('not-pending', amendment, true);
  }

  // ── Steps 2 and 3. Re-read, and the interlock. ────────────────────────────
  const file = amendment.citation.file;
  const absolute = absoluteDocumentPath(request.repoRoot, file);
  let content: string | null;
  try {
    content = fileSystem.readFile(absolute);
  } catch {
    content = null;
  }

  /**
   * The interlock's answer (§8.4 step 3). `code` defaults to the staleness code
   * and is overridden for the two shapes that are not literally a changed line —
   * an unreadable file and a line that no longer exists — because reporting those
   * as "the line changed" would send a reader looking for an edit nobody made.
   * The *outcome* is `stale` for all three: the proposal no longer describes the
   * document, and the only safe answer is to write nothing.
   */
  const stale = (detail: string, code: string = AMENDMENT_DIAGNOSTIC_CODES.stale): AcceptResult => {
    const marked: DocsAmendment = { ...amendment, status: 'stale' };
    const failure = writeAmendmentRecord(request.repoRoot, marked, fileSystem, report);
    report({
      code,
      severity: 'warn',
      message:
        `amendment stale: ${detail}. No byte of ${file} was ` +
        `written. The document moved under the proposal, so applying it would clobber somebody's ` +
        `edit; re-run \`kept amend propose\` against the current text instead.`,
      file,
      line: amendment.citation.line,
    });
    return {
      outcome: 'stale',
      amendment: marked,
      applied: false,
      recorded: failure === null,
      content: null,
      successorPromiseId: null,
      rebuildRequired: false,
      diagnostics: Object.freeze(diagnostics),
    };
  };

  if (content === null) {
    return stale(`${file} could not be read`, AMENDMENT_DIAGNOSTIC_CODES.fileMissing);
  }

  const lines = splitDocument(content).lines;
  const target = lines[amendment.citation.line - 1];
  if (target === undefined) {
    return stale(
      `${file} now has ${lines.length} line${lines.length === 1 ? '' : 's'}, so line ` +
        `${amendment.citation.line} no longer exists`,
      AMENDMENT_DIAGNOSTIC_CODES.lineOutOfRange,
    );
  }
  const observed = amendmentInterlockHash(target.text);
  if (observed !== amendment.expectedSha256) {
    return stale(
      `cited line changed since proposal — line ${amendment.citation.line} of ${file} hashes to ` +
        `${observed.slice(0, 12)}…, not the ${amendment.expectedSha256.slice(0, 12)}… recorded ` +
        `when the amendment was proposed`,
    );
  }

  // ── Steps 4 and 5. Exactly one element, then a rename. ────────────────────
  const edit = applyLineEdit({
    absolutePath: absolute,
    line: amendment.citation.line,
    text: amendment.proposedText,
    fileSystem,
    rename,
  });
  if (!edit.ok) {
    report({
      code: AMENDMENT_DIAGNOSTIC_CODES.writeFailed,
      severity: 'error',
      message:
        `${file} was not amended (${edit.reason}: ${edit.detail}). The interlock matched, so the ` +
        `amendment is still pending and can be accepted again once the write path is available. ` +
        `The staging file is ${tempPathFor(file)} if it was created.`,
      file,
      line: amendment.citation.line,
    });
    return refuse('refused', amendment, true);
  }

  // ── Step 6. Record the acceptance. ────────────────────────────────────────
  const applied: DocsAmendment = { ...amendment, status: 'accepted', appliedAt: at };
  const recordFailure = writeAmendmentRecord(request.repoRoot, applied, fileSystem, report);
  if (recordFailure !== null) {
    report({
      code: AMENDMENT_DIAGNOSTIC_CODES.recordFailed,
      severity: 'error',
      message:
        `${file}:${amendment.citation.line} was amended but ${relativeAmendmentPath(amendment.id)} ` +
        `could not be updated, so the record still reads 'pending' while the document does not. ` +
        `Accepting again is a no-op: the interlock will answer stale, because the line it hashed ` +
        `is the line that was just replaced.`,
      file: relativeAmendmentPath(amendment.id),
    });
  }

  const successorPromiseId = amendedPromiseId(applied);
  report({
    code: AMENDMENT_DIAGNOSTIC_CODES.applied,
    severity: 'info',
    message:
      `${file}:${amendment.citation.line} now reads the amended claim; every other byte of the ` +
      `file is unchanged. Promise identity is the file plus the normalised claim, so ${
        amendment.promiseId
      } retires and ${successorPromiseId} takes its place with no verdict yet — rebuild the graph ` +
      `and rewrite the snapshot to see it.`,
    file,
    line: amendment.citation.line,
  });

  return {
    outcome: 'applied',
    amendment: applied,
    applied: true,
    recorded: recordFailure === null,
    content: edit.content,
    successorPromiseId,
    rebuildRequired: true,
    diagnostics: Object.freeze(diagnostics),
  };
}

// ---------------------------------------------------------------------------
// reject() — one field, nothing else (§8.4)
// ---------------------------------------------------------------------------

/** What {@link rejectAmendment} did. */
export interface RejectResult {
  readonly outcome: 'rejected' | 'not-pending' | 'not-found' | 'refused';
  readonly amendment: DocsAmendment | null;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Decline an amendment. Sets `rejected` and **touches nothing else** (§8.4) — one
 * field of one file under `.kept/`. The proposal stays on disk with its rationale
 * and its evidence, because "a human looked at this and said no" is a fact worth
 * keeping.
 */
export function rejectAmendment(request: {
  readonly repoRoot: string;
  readonly id: string;
  readonly fileSystem?: StateFileSystem | undefined;
  readonly diagnostics?: DiagnosticSink | undefined;
}): RejectResult {
  const sink = request.diagnostics ?? createDiagnosticSink();
  const fileSystem = request.fileSystem ?? nodeStateFileSystem();
  const diagnostics: Diagnostic[] = [];
  const report = (draft: DiagnosticDraft): Diagnostic => {
    const entry = sink.report(draft);
    diagnostics.push(entry);
    return entry;
  };

  const amendment = readAmendment(request.repoRoot, request.id, {
    fileSystem,
    diagnostics: sink,
  });
  if (amendment === null) {
    report({
      code: AMENDMENT_DIAGNOSTIC_CODES.notFound,
      severity: 'warn',
      message: `No amendment '${request.id}' is staged, so nothing was rejected.`,
      file: relativeAmendmentPath(request.id),
    });
    return { outcome: 'not-found', amendment: null, diagnostics: Object.freeze(diagnostics) };
  }
  if (amendment.status !== 'pending') {
    report({
      code: AMENDMENT_DIAGNOSTIC_CODES.notPending,
      severity: 'warn',
      message:
        `Amendment ${amendment.id} is '${amendment.status}', not 'pending', so it was left ` +
        `exactly as it was.`,
      file: relativeAmendmentPath(amendment.id),
    });
    return { outcome: 'not-pending', amendment, diagnostics: Object.freeze(diagnostics) };
  }

  const rejected: DocsAmendment = { ...amendment, status: 'rejected' };
  const failure = writeAmendmentRecord(request.repoRoot, rejected, fileSystem, report);
  if (failure !== null) {
    return { outcome: 'refused', amendment, diagnostics: Object.freeze(diagnostics) };
  }
  report({
    code: AMENDMENT_DIAGNOSTIC_CODES.rejected,
    severity: 'info',
    message:
      `Amendment ${amendment.id} was rejected. ${amendment.citation.file} was not touched, and ` +
      `neither was anything else: the proposal stays on disk with its rationale and its evidence.`,
    file: relativeAmendmentPath(amendment.id),
  });
  return { outcome: 'rejected', amendment: rejected, diagnostics: Object.freeze(diagnostics) };
}
