/**
 * The citation admission gate (design §3.3, R1.3, R1.4, R1.5).
 *
 * **A promise cannot enter the graph without a citation that resolves to a real
 * line in a real file.** That sentence is the whole reason this module exists.
 * The Ledger claims "every promise is cited to a file and line", and
 * {@link admitPromise} is the only thing that makes the claim true rather than
 * aspirational: it is the *single funnel* into the graph, so there is exactly one
 * place where a candidate can become a `PromiseRecord`, and exactly one place to
 * read to know what the graph guarantees.
 *
 * Three rejections, each carrying what a reviewer needs to fix it:
 *
 * - `no-citation` — names the **supplying provider** (R1.5), because a claim that
 *   arrived without provenance is a bug in whichever provider produced it, and
 *   the reviewer's first question is which one.
 * - `line-out-of-range` — carries the **requested line and the actual line
 *   count** (R1.4). "Line 41 of a 12-line file" is actionable; "bad citation" is
 *   not.
 * - `file-missing` — the cited file could not be read at all, or its path is not
 *   one this gate is willing to read (see path safety below).
 *
 * On admission, `citation.text` is **overwritten with the line read from disk**
 * (R1.3). Not the provider's copy of it: a provider may have paraphrased,
 * trimmed, or gone stale since it scanned. Disk is the authority, and overwriting
 * is what makes it impossible for the graph to carry a citation text that
 * disagrees with the file it points at.
 *
 * This is the first module in the model that touches a filesystem, and it does so
 * only through {@link CitationSource}, injected. The property suite generates
 * whole documents in memory; one unit test proves the same code path against real
 * files in a temporary directory. Adversity is always a `Diagnostic`, never a
 * throw (design §14.2) — a stale citation in a README is a state of the world,
 * and the build must survive it and say so.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import {
  createDiagnosticSink,
  type Diagnostic,
  type DiagnosticSink,
} from '../diagnostics.js';

import { toPosix } from './ids.js';
import {
  createPromiseGraph,
  createPromiseRecord,
  type Citation,
  type DesignedTest,
  type PromiseGraph,
  type PromiseRecord,
  type ProviderName,
  type RepairAnnotation,
  type Verdict,
  type VerdictSource,
} from './promise.js';

/** Why a candidate was refused. Exactly three reasons (design §3.3). */
export type AdmissionRejectionReason = 'no-citation' | 'line-out-of-range' | 'file-missing';

/** The rejection vocabulary, so tests enumerate rather than hand-list. */
export const ADMISSION_REJECTION_REASONS: readonly AdmissionRejectionReason[] = Object.freeze([
  'no-citation',
  'line-out-of-range',
  'file-missing',
]);

/**
 * Diagnostic codes this gate reports. Stable strings: the Ledger's `/runs` page
 * and the property suite both key off them.
 *
 * There are four codes for three reasons, because `citation-path-unsafe` and
 * `citation-file-missing` are the same *reason* (the file will not be read) but
 * very different *problems* — one is a suspicious path, the other an absent file
 * — and a reviewer needs to be told which.
 */
export const ADMISSION_DIAGNOSTIC_CODES = Object.freeze({
  /** No citation at all. Names the supplying provider (R1.5). */
  noCitation: 'citation-absent',
  /** Requested line beyond the end of the file, or not a positive integer (R1.4). */
  lineOutOfRange: 'citation-line-out-of-range',
  /** Cited file unreadable or absent. */
  fileMissing: 'citation-file-missing',
  /** Cited path is absolute, empty, or escapes the repository root. */
  pathUnsafe: 'citation-path-unsafe',
} as const);

/** Every code above, for tests and for the Ledger's filter list. */
export const ADMISSION_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(ADMISSION_DIAGNOSTIC_CODES),
);

/**
 * A promise before the gate: what a provider supplies (design §5.1's
 * `ProviderResult.candidates`).
 *
 * Two things are deliberately shaped this way. `citation` is `Citation | null`
 * rather than optional, because "supplied without a citation" is a state R1.5
 * names explicitly and a dropped key would make it indistinguishable from a
 * forgotten field. `provider` is **singular**: a candidate comes from exactly one
 * provider, which is what lets the `no-citation` diagnostic name it. Two
 * providers converging on one promise is a *merge* (§5.4), performed on records
 * after admission, and that is where the plural `providers` list comes from.
 *
 * There is no `id`: the id is derived by {@link createPromiseRecord} from the
 * citation file and the claim, so no candidate can assert an identity that
 * disagrees with its own citation.
 */
export interface PromiseCandidate {
  /** Raw claim text as found; normalised by the record factory. */
  readonly claim: string;
  /** Where the claim is made, or explicit null when the provider had none. */
  readonly citation: Citation | null;
  /** The one provider that supplied this candidate. */
  readonly provider: ProviderName;
  readonly designedTest?: DesignedTest | null;
  readonly verdict?: Verdict;
  readonly verdictSource?: VerdictSource | null;
  readonly repair?: RepairAnnotation | null;
  readonly evidencePackId?: string | null;
  readonly credits?: number | null;
}

/** An accepted candidate: a record whose citation text came from disk. */
export interface AdmissionAccepted {
  readonly ok: true;
  readonly promise: PromiseRecord;
}

/** A candidate that arrived with no citation (R1.5). */
export interface AdmissionNoCitation {
  readonly ok: false;
  readonly reason: 'no-citation';
  /** Named in the diagnostic message too; carried structurally for callers. */
  readonly provider: ProviderName;
  readonly diagnostic: Diagnostic;
}

/** A citation pointing past the end of its file, or at a non-positive line (R1.4). */
export interface AdmissionLineOutOfRange {
  readonly ok: false;
  readonly reason: 'line-out-of-range';
  readonly provider: ProviderName;
  /** Repository-relative POSIX path, as normalised. */
  readonly file: string;
  /** Exactly what the candidate asked for, unaltered — including 0 or 1.5. */
  readonly requestedLine: number;
  /** How many lines the file actually has. */
  readonly lineCount: number;
  readonly diagnostic: Diagnostic;
}

/** A citation whose file could not be read, or whose path is not safe to read. */
export interface AdmissionFileMissing {
  readonly ok: false;
  readonly reason: 'file-missing';
  readonly provider: ProviderName;
  readonly file: string;
  readonly diagnostic: Diagnostic;
}

/** Any refusal. Discriminated on `reason`. */
export type AdmissionRejected =
  | AdmissionNoCitation
  | AdmissionLineOutOfRange
  | AdmissionFileMissing;

/**
 * The gate's answer (design §3.3). Discriminated on `ok`, and the rejected side
 * again on `reason`, so a caller that forgets a case is a compile error.
 */
export type Admission = AdmissionAccepted | AdmissionRejected;

/**
 * The cited-document reader, injected.
 *
 * `read` takes a **repository-relative** path and returns the file's full
 * contents, or `null` when it cannot be read for any reason. Returning null
 * rather than throwing keeps `file-missing` on the data path; an implementation
 * that throws anyway is caught at the call site and treated identically.
 *
 * Injecting the whole document rather than a line means the gate owns line
 * splitting, so the one-based / no-phantom-final-line rules are implemented once
 * and are what the property suite exercises.
 */
export interface CitationSource {
  read(file: string): string | null;
}

/**
 * Read cited files from a real repository, resolving every path against
 * `repoRoot` and nothing else. `process.cwd()` is never consulted: a build
 * invoked from a subdirectory must resolve `apps/fixture/README.md` the same way.
 */
export function nodeCitationSource(repoRoot: string): CitationSource {
  const root = resolve(repoRoot);
  return {
    read(file: string): string | null {
      try {
        return readFileSync(join(root, file), { encoding: 'utf8' });
      } catch {
        return null;
      }
    },
  };
}

/**
 * Read cited files out of a map of path → contents. This is what makes Property 2
 * possible over generated documents with no disk anywhere, and it is the same
 * code path production uses — only `read` differs.
 */
export function inMemoryCitationSource(
  documents: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): CitationSource {
  const map =
    documents instanceof Map
      ? new Map(documents)
      : new Map(Object.entries(documents as Readonly<Record<string, string>>));
  const normalised = new Map<string, string>();
  for (const [file, contents] of map) normalised.set(toPosix(file), contents);
  return {
    read(file: string): string | null {
      return normalised.get(toPosix(file)) ?? null;
    },
  };
}

/** A leading byte-order mark is an encoding artefact, not content. */
const BOM = '\ufeff';

/**
 * Split a document into its lines, the way the gate counts them.
 *
 * Three rules, each of which is a requirement rather than a nicety:
 *
 * 1. **`split('\n')`**, as design §3.3 fixes it.
 * 2. **No phantom final line.** A file ending in `\n` yields a trailing empty
 *    element that is an artefact of the terminator, not a line anybody can cite;
 *    it is dropped when it is the last element and empty. So a three-line file
 *    ending in a newline has three lines, and line 4 is out of range. This is the
 *    classic off-by-one, and it is asserted directly. An empty file is zero
 *    lines by the same rule, so citing line 1 of it is out of range — which is
 *    the honest answer. A file ending in a *blank* line followed by a newline
 *    (`"a\n\n"`) keeps that blank line: only one trailing element is dropped.
 * 3. **A trailing `\r` is removed.** This is the one place the "no trimming" rule
 *    is qualified, and narrowly: in a CRLF file the terminator is `\r\n`, so the
 *    `\r` left behind by `split('\n')` is part of the *terminator*, not of the
 *    line. Keeping it would put a stray carriage return into `citation.text` and
 *    therefore into the committed snapshot, making the same repository serialise
 *    differently depending on which line endings it was checked out with — and
 *    `ledger.snapshot.json` has to be byte-stable (§9.1). Nothing else is
 *    trimmed: leading indentation, trailing spaces and tabs, and a line
 *    consisting only of whitespace all survive exactly as written.
 *
 * Total over every string, including the empty one. Never throws.
 */
export function splitLines(content: string): readonly string[] {
  if (typeof content !== 'string') return [];
  const text = content.startsWith(BOM) ? content.slice(BOM.length) : content;
  const parts = text.split('\n');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

/** How many citable lines a document has. See {@link splitLines}. */
export function lineCount(content: string): number {
  return splitLines(content).length;
}

/**
 * Read a one-based line, or `null` when it does not exist.
 *
 * One-based: line 1 is `splitLines(content)[0]`. Line 0 and negative lines do not
 * exist, and neither does a fractional one — a citation is a position in a file,
 * and 1.5 is not a position.
 */
export function citedLine(content: string, line: number): string | null {
  if (!Number.isInteger(line) || line < 1) return null;
  const lines = splitLines(content);
  return line <= lines.length ? (lines[line - 1] as string) : null;
}

/**
 * Whether a cited path is one this gate is willing to read.
 *
 * `toPosix` deliberately does not police paths — a pure id function that silently
 * rewrote a bad path would hide the problem — so path safety lands here, where it
 * can be diagnosed. A citation is by definition *repository-relative* (R1.3), so
 * three shapes are refused:
 *
 * - **empty**, after normalisation: there is no file to read.
 * - **absolute**, POSIX (`/etc/passwd`), UNC (`//host/share`) or Windows
 *   (`C:/…`): an absolute path in a committed snapshot is a path that means
 *   something different on every machine, and reading it lets a citation reach
 *   outside the repository entirely.
 * - **escaping the root** via `..`, at any depth: `apps/../../secrets` leaves the
 *   tree. A `..` that stays inside (`apps/fixture/../README.md`) is fine and
 *   resolves normally.
 *
 * This is a refusal to read, not an accusation, so it is reported as
 * `citation-path-unsafe` and rejected as `file-missing` — the gate keeps exactly
 * the three reasons design §3.3 fixes.
 */
export function isCitationPathSafe(file: string): boolean {
  const posix = toPosix(file);
  if (posix.length === 0) return false;
  if (posix.startsWith('/') || /^[A-Za-z]:/.test(posix) || isAbsolute(posix)) return false;
  let depth = 0;
  for (const segment of posix.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      depth -= 1;
      if (depth < 0) return false;
      continue;
    }
    depth += 1;
  }
  return true;
}

/** Quote a claim for a diagnostic message, clipped so a run log stays readable. */
function quoteClaim(claim: string): string {
  const single = typeof claim === 'string' ? claim.replace(/\s+/g, ' ').trim() : '';
  if (single.length === 0) return '(empty claim)';
  return single.length <= 80 ? `"${single}"` : `"${single.slice(0, 77)}…"`;
}

/** What {@link admitPromise} needs: a candidate, somewhere to read, somewhere to report. */
export interface AdmissionRequest {
  readonly candidate: PromiseCandidate;
  /**
   * Where cited documents are read from. Omit only when `repoRoot` is given;
   * supplying neither is a programming error, because a gate with nothing to read
   * would reject every candidate as `file-missing` and look like a broken
   * repository.
   */
  readonly source?: CitationSource;
  /** Convenience: build a {@link nodeCitationSource} over this root. */
  readonly repoRoot?: string;
  /** Where rejections are recorded. Omit and the gate keeps its own private sink. */
  readonly diagnostics?: DiagnosticSink;
}

function resolveSource(request: {
  readonly source?: CitationSource;
  readonly repoRoot?: string;
}): CitationSource {
  if (request.source !== undefined) return request.source;
  if (typeof request.repoRoot === 'string' && request.repoRoot.length > 0) {
    return nodeCitationSource(request.repoRoot);
  }
  throw new TypeError('admitPromise requires either a CitationSource or a repoRoot');
}

/**
 * The single funnel into the graph.
 *
 * Every promise in every graph this system builds passed through here, and
 * nothing else constructs a graph-bound `PromiseRecord`. On acceptance the
 * returned record's `citation.text` is the line as read, so the graph's citations
 * and the repository agree by construction.
 *
 * Exactly one diagnostic is reported per rejection, and none on acceptance — so
 * the count of diagnostics carrying an admission code *is* the count of refused
 * candidates, which is what Property 2 leans on.
 */
export function admitPromise(request: AdmissionRequest): Admission {
  const { candidate } = request;
  const sink = request.diagnostics ?? createDiagnosticSink();
  const provider = candidate.provider;
  const citation = candidate.citation;

  // R1.5 — no citation. The provider is named because a promise that arrived
  // without provenance is a defect in whichever provider produced it.
  if (citation === null || citation === undefined) {
    return {
      ok: false,
      reason: 'no-citation',
      provider,
      diagnostic: sink.report({
        code: ADMISSION_DIAGNOSTIC_CODES.noCitation,
        severity: 'error',
        message:
          `The ${provider} provider supplied a promise with no citation, so it is excluded ` +
          `from the graph. Claim: ${quoteClaim(candidate.claim)}.`,
        file: null,
        line: null,
      }),
    };
  }

  const file = toPosix(citation.file);

  if (!isCitationPathSafe(citation.file)) {
    return {
      ok: false,
      reason: 'file-missing',
      provider,
      file,
      diagnostic: sink.report({
        code: ADMISSION_DIAGNOSTIC_CODES.pathUnsafe,
        severity: 'error',
        message:
          `The ${provider} provider cited ${file.length === 0 ? '(empty path)' : file}, which is ` +
          `not a repository-relative path, so the promise is excluded from the graph. ` +
          `Claim: ${quoteClaim(candidate.claim)}.`,
        file: file.length === 0 ? null : file,
        line: null,
      }),
    };
  }

  const source = resolveSource(request);
  let contents: string | null;
  try {
    contents = source.read(file);
  } catch {
    // A reader that throws is treated exactly as a reader that returned null:
    // the state of the world, not a programming error (design §14.2).
    contents = null;
  }

  if (contents === null) {
    return {
      ok: false,
      reason: 'file-missing',
      provider,
      file,
      diagnostic: sink.report({
        code: ADMISSION_DIAGNOSTIC_CODES.fileMissing,
        severity: 'error',
        message:
          `The ${provider} provider cited ${file}, which could not be read, so the promise is ` +
          `excluded from the graph. Claim: ${quoteClaim(candidate.claim)}.`,
        file,
        line: null,
      }),
    };
  }

  const total = lineCount(contents);
  const text = citedLine(contents, citation.line);

  // R1.4 — the requested line and the actual count both travel with the
  // rejection, because "line 41 of a 12-line file" is what a reviewer can act on.
  if (text === null) {
    return {
      ok: false,
      reason: 'line-out-of-range',
      provider,
      file,
      requestedLine: citation.line,
      lineCount: total,
      diagnostic: sink.report({
        code: ADMISSION_DIAGNOSTIC_CODES.lineOutOfRange,
        severity: 'error',
        message:
          `The ${provider} provider cited ${file}:${citation.line}, but that file has ` +
          `${total} line${total === 1 ? '' : 's'}, so the promise is excluded from the graph. ` +
          `Claim: ${quoteClaim(candidate.claim)}.`,
        file,
        line: null,
      }),
    };
  }

  // R1.3 — disk is the authority. The provider's `citation.text` is discarded,
  // whatever it said.
  //
  // `claim` is *not* rewritten from disk, and that is deliberate: the promise id
  // is keyed on the claim (§3.2), so rewriting it here would silently re-key a
  // promise and orphan its verdict and evidence — the one failure Property 1
  // exists to prevent. In practice the two agree anyway, because the baseline
  // provider takes the claim from the cited line (§5.2) and the enrichment
  // provider overlays axes on ids rather than inventing claims (§5.3). What the
  // gate guarantees is that `citation.text` is the file's own words; a claim that
  // has drifted from them is a documentation amendment (§10.3), not a rejection.
  return {
    ok: true,
    promise: createPromiseRecord({
      claim: candidate.claim,
      citation: { file, line: citation.line, text },
      designedTest: candidate.designedTest ?? null,
      verdict: candidate.verdict,
      verdictSource: candidate.verdictSource ?? null,
      repair: candidate.repair ?? null,
      evidencePackId: candidate.evidencePackId ?? null,
      providers: [provider],
      credits: candidate.credits ?? null,
    }),
  };
}

/** What {@link admitPromises} needs: many candidates, and the same two channels. */
export interface AdmissionBatchRequest {
  readonly candidates: readonly PromiseCandidate[];
  readonly source?: CitationSource;
  readonly repoRoot?: string;
  readonly diagnostics?: DiagnosticSink;
  /** Passed through to the graph — the enrichment axis was discarded (R2.8). */
  readonly degraded?: boolean;
  readonly degradedReasons?: readonly string[];
}

/** The batch answer: the graph, and the per-candidate verdicts that produced it. */
export interface AdmissionBatch {
  /** Built from `admitted` and nothing else. */
  readonly graph: PromiseGraph;
  /** One entry per input candidate, in input order. */
  readonly admissions: readonly Admission[];
  /** Exactly the promises in `graph.promises`, in first-admitted order. */
  readonly admitted: readonly PromiseRecord[];
  /** Every refusal, in input order. */
  readonly rejected: readonly AdmissionRejected[];
}

/**
 * Run the gate over a batch and build the graph from the survivors.
 *
 * This is the shape of the guarantee: `graph.promises` is a function of
 * `admitted`, `admitted` is a function of what the gate accepted, and there is no
 * other parameter — so no mixture of resolvable and unresolvable candidates can
 * put an unresolvable one in the graph.
 *
 * Candidates that derive the same id collapse to the first admitted one. That is
 * *not* the provider merge of §5.4 — merging picks field-by-field across
 * providers and belongs upstream of here; this is only the graph's own
 * "identifiers are unique" rule (R1.1) holding regardless of what it is handed.
 *
 * Diagnostics reported during admission are attached to the graph, so a snapshot
 * written from it carries the reason every excluded claim was excluded.
 */
export function admitPromises(request: AdmissionBatchRequest): AdmissionBatch {
  const sink = request.diagnostics ?? createDiagnosticSink();
  const source = resolveSource(request);
  const admissions: Admission[] = [];
  const rejected: AdmissionRejected[] = [];
  const admitted: PromiseRecord[] = [];
  const reported: Diagnostic[] = [];
  const seen = new Set<string>();

  for (const candidate of request.candidates) {
    const admission = admitPromise({ candidate, source, diagnostics: sink });
    admissions.push(admission);
    if (!admission.ok) {
      rejected.push(admission);
      reported.push(admission.diagnostic);
      continue;
    }
    if (seen.has(admission.promise.id)) continue;
    seen.add(admission.promise.id);
    admitted.push(admission.promise);
  }

  return {
    graph: createPromiseGraph({
      promises: admitted,
      degraded: request.degraded ?? false,
      degradedReasons: request.degradedReasons ?? [],
      diagnostics: reported,
    }),
    admissions,
    admitted,
    rejected,
  };
}
