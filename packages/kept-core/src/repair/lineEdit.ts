/**
 * The surgical write (design §8.4, R7.4, R7.6).
 *
 * One question, answered at the level of bytes: how is a single line of a
 * document replaced without disturbing any other byte in the file?
 *
 * ## Terminators are per line, not per file
 *
 * §8.4 asks for a write that preserves "the original trailing-newline state and
 * the original line endings". The obvious implementation — sniff a dominant line
 * ending, split on it, join with it — gets the common cases right and quietly
 * rewrites a mixed-ending file from end to end. A repository checked out on
 * Windows and edited by two different tools has mixed endings more often than
 * anyone would like, and an amendment that reported "one line changed" while
 * touching every line in the file would be the exact overstatement this product
 * exists not to make.
 *
 * So {@link splitDocument} keeps each line's **own** terminator beside it, and
 * {@link joinDocument} concatenates them back. Three facts follow for free:
 *
 * - `joinDocument(splitDocument(text)) === text` for every string. Not for the
 *   shapes we thought of — for every string.
 * - Replacing one line's text leaves every other byte identical, including each
 *   other line's terminator, whatever it was.
 * - Trailing-newline state is preserved because it is not a separate fact: the
 *   last line's terminator is `''` when the file did not end in a newline, and
 *   that terminator is carried like any other. A CRLF file stays CRLF; a file with
 *   no final newline does not gain one.
 *
 * A leading byte-order mark is kept as a prefix rather than as content, matching
 * `model/admission.ts`, so the mark survives a write and never becomes part of a
 * line's text.
 *
 * ## Line numbering agrees with the admission gate, by derivation
 *
 * A citation's line number is one-based and counted by `splitLines` in
 * `model/admission.ts`: split on `\n`, drop the phantom final element a trailing
 * terminator produces, treat a trailing `\r` as part of the terminator. This
 * module counts the same lines — a three-line file ending in a newline has three
 * lines and line four does not exist — and the test suite asserts the two agree
 * over generated documents rather than trusting that two hand-written splitters
 * stayed in step. A lone `\r` is content, not a terminator: `split('\n')` is the
 * rule, so an old-Mac file is one long line.
 *
 * ## The one function here that writes outside `.kept/`
 *
 * {@link applyLineEdit} is it, and it is called from exactly one place in the
 * package — `acceptAmendment`, past the sha256 interlock. Everything above it is
 * pure and returns bytes. That is what makes "a proposal writes nothing outside
 * `.kept/`" a property of the code rather than of one execution: `propose()` and
 * `reject()` have no reachable path to this function at all.
 */

import { renameSync } from 'node:fs';

/** The two line terminators a checkout can carry. A lone `\r` is content. */
export type LineEnding = '\n' | '\r\n';

/** Both terminators, so a test can enumerate them. */
export const LINE_ENDINGS: readonly LineEnding[] = Object.freeze(['\n', '\r\n']);

/** A leading byte-order mark is an encoding artefact, not content. */
export const BYTE_ORDER_MARK = '\ufeff';

/** The suffix `accept()` writes before renaming over the original (§8.4 step 5). */
export const TEMP_FILE_SUFFIX = '.kept-tmp';

/**
 * One line and the terminator that ended it. `terminator` is `''` for a final
 * line with no newline after it — which is how a missing trailing newline is
 * represented, rather than as a separate flag a join could forget to consult.
 */
export interface DocumentLine {
  readonly text: string;
  readonly terminator: '' | LineEnding;
}

/** A document, split so that it can be rejoined byte for byte. */
export interface DocumentModel {
  /** The byte-order mark, or the empty string. Re-emitted verbatim. */
  readonly bom: string;
  readonly lines: readonly DocumentLine[];
}

/**
 * Split a document into lines with their own terminators.
 *
 * Total over every string, including the empty one. Never throws. The counting
 * rules are `model/admission.ts`'s: the phantom final element a trailing
 * terminator leaves behind is not a line, and a trailing `\r` belongs to the
 * terminator.
 */
export function splitDocument(content: string): DocumentModel {
  if (typeof content !== 'string') return { bom: '', lines: Object.freeze([]) };
  const bom = content.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK : '';
  const body = bom.length === 0 ? content : content.slice(bom.length);
  const lines: DocumentLine[] = [];
  let start = 0;
  while (start < body.length) {
    const cut = body.indexOf('\n', start);
    if (cut < 0) {
      lines.push({ text: body.slice(start), terminator: '' });
      break;
    }
    const raw = body.slice(start, cut);
    const carriage = raw.endsWith('\r');
    lines.push({
      text: carriage ? raw.slice(0, -1) : raw,
      terminator: carriage ? '\r\n' : '\n',
    });
    start = cut + 1;
  }
  return { bom, lines: Object.freeze(lines) };
}

/** Reassemble a document. Inverse of {@link splitDocument} for every input. */
export function joinDocument(model: DocumentModel): string {
  let out = model.bom;
  for (const line of model.lines) out += line.text + line.terminator;
  return out;
}

/** How many citable lines a document has, counted as the admission gate counts. */
export function documentLineCount(content: string): number {
  return splitDocument(content).lines.length;
}

/**
 * Whether the document ends in a newline. Derived from the last line's
 * terminator, so it cannot disagree with what a join will produce. An empty
 * document has no last line and therefore no trailing newline.
 */
export function hasTrailingNewline(model: DocumentModel): boolean {
  const last = model.lines[model.lines.length - 1];
  return last !== undefined && last.terminator !== '';
}

/**
 * The terminator most lines use, for a diagnostic that wants to name it. Never
 * used to *write* anything — a replaced line keeps its own terminator, which is
 * the whole point of the per-line model.
 */
export function dominantLineEnding(model: DocumentModel): LineEnding {
  let crlf = 0;
  let lf = 0;
  for (const line of model.lines) {
    if (line.terminator === '\r\n') crlf += 1;
    else if (line.terminator === '\n') lf += 1;
  }
  return crlf > lf ? '\r\n' : '\n';
}

/** Why a line edit was refused. Every one of them means nothing was written. */
export type LineEditRefusal = 'invalid-line' | 'line-out-of-range' | 'text-contains-newline';

/** The result of replacing one line: new bytes, or a reason and no bytes. */
export type LineEditResult =
  | {
      readonly ok: true;
      /** The whole document after the edit. Exactly one line's text differs. */
      readonly content: string;
      /** The line as it was, verbatim. */
      readonly previous: string;
      /** The terminator that line kept. */
      readonly terminator: '' | LineEnding;
    }
  | { readonly ok: false; readonly reason: LineEditRefusal };

/**
 * Replace exactly one line's text (§8.4 step 4).
 *
 * Pure: it returns bytes and writes nothing. A replacement containing a line
 * terminator is **refused** rather than accommodated, because inserting one would
 * turn one line into two — every citation below it would shift, and "edits exactly
 * one line" would stop being true of the file even though it was true of the array
 * operation. That refusal is a first-class outcome, not an assertion.
 */
export function replaceLine(content: string, line: number, text: string): LineEditResult {
  if (!Number.isInteger(line) || line < 1) return { ok: false, reason: 'invalid-line' };
  if (typeof text !== 'string' || text.includes('\n') || text.includes('\r')) {
    return { ok: false, reason: 'text-contains-newline' };
  }
  const model = splitDocument(content);
  const target = model.lines[line - 1];
  if (target === undefined) return { ok: false, reason: 'line-out-of-range' };

  // Exactly one array element is replaced, on a copy. Every other element — its
  // text and its terminator both — is carried through untouched.
  const lines = [...model.lines];
  lines[line - 1] = { text, terminator: target.terminator };
  return {
    ok: true,
    content: joinDocument({ bom: model.bom, lines }),
    previous: target.text,
    terminator: target.terminator,
  };
}

// ---------------------------------------------------------------------------
// Putting it on disk
// ---------------------------------------------------------------------------

/**
 * How a temporary file is renamed over its original. Its own one-line seam rather
 * than a widening of `StateFileSystem`, which `state.ts`, `handoff.ts` and
 * `context/cache.ts` all share and none of which has any use for a rename —
 * exactly the precedent `SourceMtimeReader` and `ReconcileFileProbe` set.
 */
export type AtomicRenamer = (fromPath: string, toPath: string) => void;

/**
 * The production renamer. `rename(2)` is atomic within a filesystem, which is what
 * makes §8.4 step 5 safe: a reader of the documentation file sees either every
 * byte of the old version or every byte of the new one, never a half-written
 * document. Errors propagate to {@link applyLineEdit}, which turns them into a
 * refusal rather than a throw.
 */
export const nodeAtomicRenamer: AtomicRenamer = (fromPath, toPath) => {
  renameSync(fromPath, toPath);
};

/** The temporary path a document is staged at before the rename. */
export function tempPathFor(absolutePath: string): string {
  return `${absolutePath}${TEMP_FILE_SUFFIX}`;
}

/** The minimal write surface {@link applyLineEdit} needs. `StateFileSystem` fits. */
export interface LineEditFileSystem {
  readFile(path: string): string | null;
  writeFile(path: string, contents: string): void;
}

/** Why an apply was refused. */
export type ApplyLineEditRefusal = LineEditRefusal | 'file-missing' | 'write-failed';

/** What {@link applyLineEdit} did. */
export type ApplyLineEditResult =
  | {
      readonly ok: true;
      /** The document's bytes after the rename. */
      readonly content: string;
      readonly previous: string;
      /** The staging path that was renamed away. Nothing is left behind. */
      readonly tempPath: string;
    }
  | { readonly ok: false; readonly reason: ApplyLineEditRefusal; readonly detail: string };

/**
 * Write one replaced line to disk, atomically (§8.4 steps 4 and 5).
 *
 * The **only** function in `src/repair/` that writes outside `.kept/`, reachable
 * from exactly one caller: `acceptAmendment`, past the sha256 interlock. Every
 * byte is computed before anything is written, so a refused replacement does not
 * even create a staging file.
 *
 * A failed rename leaves the staging file where it is rather than deleting it. The
 * original is untouched, which is what matters, and the staged bytes are the one
 * piece of evidence a human debugging a read-only checkout actually wants.
 */
export function applyLineEdit(request: {
  readonly absolutePath: string;
  readonly line: number;
  readonly text: string;
  readonly fileSystem: LineEditFileSystem;
  readonly rename: AtomicRenamer;
}): ApplyLineEditResult {
  let current: string | null;
  try {
    current = request.fileSystem.readFile(request.absolutePath);
  } catch (cause) {
    return { ok: false, reason: 'file-missing', detail: describe(cause) };
  }
  if (current === null) {
    return {
      ok: false,
      reason: 'file-missing',
      detail: `${request.absolutePath} could not be read`,
    };
  }

  const edited = replaceLine(current, request.line, request.text);
  if (!edited.ok) {
    return { ok: false, reason: edited.reason, detail: `line ${request.line}` };
  }

  const tempPath = tempPathFor(request.absolutePath);
  try {
    request.fileSystem.writeFile(tempPath, edited.content);
    request.rename(tempPath, request.absolutePath);
  } catch (cause) {
    return { ok: false, reason: 'write-failed', detail: describe(cause) };
  }

  return { ok: true, content: edited.content, previous: edited.previous, tempPath };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
