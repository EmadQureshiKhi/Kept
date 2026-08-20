/**
 * Diagnostics — the reporting channel every other module uses instead of
 * throwing (design §14, R2.3, R3.24).
 *
 * The rule the rest of the codebase depends on: a module that meets adversity
 * — an unreadable `*_test.md`, a malformed NDJSON line, an absent `kane-cli` —
 * records a `Diagnostic` and keeps going. Exceptions are reserved for
 * programming errors, never for the state of the world. That is what keeps the
 * CLI's exit code a statement about KEPT rather than about the product
 * (design §14.2).
 *
 * `Diagnostic` is deliberately the *wire* shape: the snapshot contract of
 * design §9.1 carries `diagnostics: Array<{ code, severity, message, file,
 * line, at }>` verbatim, and requires that `parse(serialise(x))` deep-equals
 * `x`. So this record stays plain JSON — no `Date` values, no branding symbol,
 * nothing that survives a round trip as a lie. Shape is instead guaranteed at
 * the single construction site below: `DiagnosticSink.report()` is the only
 * exported way to obtain one, every field is `readonly`, and none is optional,
 * so a hand-rolled literal is a compile error the moment a field is forgotten.
 */

/** Severity vocabulary, fixed by the snapshot contract (design §9.1). */
export type DiagnosticSeverity = 'info' | 'warn' | 'error';

/** The severities, weakest first. Exported so tests can enumerate them. */
export const DIAGNOSTIC_SEVERITIES: readonly DiagnosticSeverity[] = ['info', 'warn', 'error'];

/**
 * One recorded observation. Serialises straight into
 * `LedgerSnapshot.diagnostics` (design §9.1).
 */
export interface Diagnostic {
  /** Stable machine code, e.g. `ndjson-parse`, `reconcile-source-unresolved`. */
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  /** Human-readable, non-empty; safe to render in the Ledger's `/runs` page. */
  readonly message: string;
  /** Repository-relative POSIX path this concerns, or null. */
  readonly file: string | null;
  /** One-based line number this concerns, or null. */
  readonly line: number | null;
  /** ISO 8601 instant the diagnostic was recorded. Always a string. */
  readonly at: string;
}

/**
 * What a call site supplies. `code`, `severity` and `message` are mandatory —
 * severity is a judgement only the reporting module can make, so it is never
 * defaulted. `file` and `line` default to null. `at` is not accepted: the sink
 * stamps it, so no module can misreport when something happened.
 */
export interface DiagnosticDraft {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly file?: string | null;
  readonly line?: number | null;
}

/** Injected clock, so tests get deterministic `at` values. */
export type DiagnosticClock = () => Date;

/**
 * The channel. Every module that can fail takes one of these.
 *
 * `report` returns the record it stored, because many results in this design
 * embed the diagnostic they also recorded — e.g. `Admission` (§3.3) and
 * `SourceResolution` (§13.2.2) both carry `{ ok: false, reason, diagnostic }`.
 * One call, both jobs, no second construction path.
 *
 * Implementations never throw for reported content.
 */
export interface DiagnosticSink {
  report(draft: DiagnosticDraft): Diagnostic;
}

/**
 * A sink that keeps what it is told, in report order. This is the production
 * implementation as well as the test one — a build or a run collects into one
 * of these and hands `entries` to the snapshot writer.
 */
export interface CollectingDiagnosticSink extends DiagnosticSink {
  /** Everything reported so far, in order. A copy; mutating it changes nothing. */
  readonly entries: readonly Diagnostic[];
  /** How many diagnostics have been reported. */
  readonly size: number;
  /** Reported diagnostics carrying `code`, in order. */
  withCode(code: string): readonly Diagnostic[];
  /** Whether any diagnostic carries `code`. */
  has(code: string): boolean;
  /** Whether any diagnostic carries `severity`. */
  hasSeverity(severity: DiagnosticSeverity): boolean;
  /** Forget everything. Used between fixtures, never mid-run. */
  clear(): void;
}

/** Normalise a `file` field: trimmed, POSIX separators, empty becomes null. */
function normaliseFile(file: string | null | undefined): string | null {
  if (typeof file !== 'string') return null;
  const posix = file.replace(/\\/g, '/').trim();
  return posix.length === 0 ? null : posix;
}

/**
 * Normalise a `line` field. Line numbers in this system are one-based
 * (design §3.1), so anything that is not a positive integer is dropped to null
 * rather than recorded as a number a reader would trust.
 */
function normaliseLine(line: number | null | undefined): number | null {
  if (typeof line !== 'number') return null;
  if (!Number.isInteger(line) || line < 1) return null;
  return line;
}

/** Read the clock defensively — a broken clock must not take the process down. */
function stamp(clock: DiagnosticClock): string {
  let value: Date;
  try {
    value = clock();
  } catch {
    value = new Date();
  }
  const ms = value instanceof Date ? value.getTime() : Number.NaN;
  return new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString();
}

/**
 * Build the record. Private on purpose: `DiagnosticSink.report()` is the only
 * exported path to a `Diagnostic`, so every diagnostic in the system is
 * normalised and time-stamped identically.
 */
function makeDiagnostic(draft: DiagnosticDraft, clock: DiagnosticClock): Diagnostic {
  const code = typeof draft.code === 'string' ? draft.code.trim() : '';
  if (code.length === 0) {
    // A missing code is a programming error, not a state of the world: codes are
    // literals at every call site, and the Ledger keys off them. Design §4.6
    // sets the precedent that programming errors throw at development time.
    throw new TypeError('Diagnostic requires a non-empty code');
  }
  const rawMessage = typeof draft.message === 'string' ? draft.message.trim() : '';
  // Messages interpolate runtime data, so an empty one can happen on a real
  // degradation path. Falling back to the code keeps the record readable
  // without turning a reporting call into the failure it was reporting.
  const message = rawMessage.length === 0 ? code : rawMessage;
  return {
    code,
    severity: draft.severity,
    message,
    file: normaliseFile(draft.file),
    line: normaliseLine(draft.line),
    at: stamp(clock),
  };
}

/** Create a collecting sink. Pass `clock` to make `at` deterministic in tests. */
export function createDiagnosticSink(
  options: { readonly clock?: DiagnosticClock } = {},
): CollectingDiagnosticSink {
  const clock: DiagnosticClock = options.clock ?? ((): Date => new Date());
  const collected: Diagnostic[] = [];

  return {
    report(draft: DiagnosticDraft): Diagnostic {
      const diagnostic = makeDiagnostic(draft, clock);
      collected.push(diagnostic);
      return diagnostic;
    },
    get entries(): readonly Diagnostic[] {
      return [...collected];
    },
    get size(): number {
      return collected.length;
    },
    withCode(code: string): readonly Diagnostic[] {
      return collected.filter((d) => d.code === code);
    },
    has(code: string): boolean {
      return collected.some((d) => d.code === code);
    },
    hasSeverity(severity: DiagnosticSeverity): boolean {
      return collected.some((d) => d.severity === severity);
    },
    clear(): void {
      collected.length = 0;
    },
  };
}

/**
 * Structural guard for boundary paths — reading a snapshot back off disk, or
 * accepting diagnostics from a JSON payload. Type-level guarantees stop at the
 * process edge; this is where they are re-established.
 */
export function isDiagnostic(value: unknown): value is Diagnostic {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['code'] !== 'string' || candidate['code'].length === 0) return false;
  if (!DIAGNOSTIC_SEVERITIES.includes(candidate['severity'] as DiagnosticSeverity)) return false;
  if (typeof candidate['message'] !== 'string' || candidate['message'].length === 0) return false;
  const file = candidate['file'];
  if (file !== null && typeof file !== 'string') return false;
  const line = candidate['line'];
  if (line !== null && (typeof line !== 'number' || !Number.isInteger(line) || line < 1)) return false;
  const at = candidate['at'];
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return false;
  return true;
}
