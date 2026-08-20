/**
 * The `failure.yaml` loader (design §6.3, R6.7).
 *
 * `failure.yaml` is the triage note Kane seals inside an evidence pack. It is
 * the **fallback** triage source, not the primary one: a confirmed bug carries
 * an inline `verdict` object on the terminal event, and that object is richer
 * structured triage delivered in the stream itself (design §6.2, A6,
 * docs/kane/command-surface.md). So this module exists for the case where no
 * such object arrived, and for the `failureYamlTriage` router that ships as a
 * working fallback regardless of the verdict spike's outcome (R6.13).
 *
 * Two boundaries this module deliberately does **not** cross:
 *
 * 1. **It never derives a path.** Evidence-pack locations come from the command
 *    family, never from an event field (design §4.6, A12), and `kane/evidence.ts`
 *    already owns that derivation. {@link loadFailureYamlFromEvidence} composes
 *    with `listArtifacts` and picks the artefact `classifyArtifact` already
 *    classified as `failure-yaml`; nothing here re-spells `evidence/` or
 *    `.testmuai/`.
 * 2. **It never routes.** Choosing a `RepairBranch` from the signal, and the
 *    ordering that lets a selector signal outrank the assertion band, is task
 *    11.4's job. This module reports the signal and which field it came from,
 *    and stops. In particular it applies no precedence between the signal and
 *    the coerced code — it surfaces both so the router can order them.
 *
 * Adversity is data, never an exception (design §14.2, R2.3). An absent file, an
 * unreadable one, invalid YAML, or a document whose alias graph refuses to
 * expand all answer `null` plus a diagnostic that quotes the real reason. The
 * parsed document is arbitrary untrusted YAML — a scalar, a sequence and an
 * empty document are all shapes a real file can take — so every field is read as
 * possibly-absent and possibly the wrong type, and no schema is validated that
 * this code cannot actually know.
 */

import { readFileSync, statSync } from 'node:fs';

import { parseDocument } from 'yaml';

import type { DiagnosticSink } from '../diagnostics.js';

import { resultCode } from './coerce.js';
import {
  listArtifacts,
  type EvidenceArtifact,
  type EvidencePack,
  type ListArtifactsRequest,
} from './evidence.js';

/** The file names `classifyArtifact` files as kind `failure-yaml`. */
export const FAILURE_YAML_FILENAMES: readonly string[] = ['failure.yaml', 'failure.yml'];

/**
 * The category-ish fields of design §6.3, in precedence order.
 *
 * The order is the design's own and is not an implementation detail: the nested
 * `triage.category` is Kane's structured placement and wins, the two top-level
 * spellings follow, and `reason` is last because it is the most likely to hold
 * a prose sentence rather than a classification token. First field that yields a
 * non-empty string wins; the rest are not consulted.
 *
 * Each of the three parseable committed fixtures uses a *different* one of these
 * (`test/fixtures/README.md`), so the alias handling is exercised by real files
 * rather than only by generated ones. `reason` has no fixture and is covered by
 * a generated case in task 11.4.
 */
export const TRIAGE_SIGNAL_FIELDS = ['triage.category', 'category', 'classification', 'reason'] as const;

/** Which field a signal was read from. */
export type TriageSignalField = (typeof TRIAGE_SIGNAL_FIELDS)[number];

/** The nested mapping the first alias reads through. */
const TRIAGE_MAPPING_FIELD = 'triage';

/**
 * A loaded `failure.yaml`.
 *
 * `document` is the raw materialised YAML and is typed `unknown` on purpose:
 * callers that want a field must go through the normalised members below or
 * narrow it themselves. `fields` is the top-level mapping's own properties, or
 * an empty record when the root was not a mapping — never a guess at what a
 * scalar or a sequence "meant".
 */
export interface FailureYaml {
  /** Absolute path read, or null when content was supplied directly. */
  readonly path: string | null;
  /** The materialised YAML: a mapping, a sequence, a scalar, or null. */
  readonly document: unknown;
  /** Top-level own properties when the root is a mapping, else `{}`. */
  readonly fields: Readonly<Record<string, unknown>>;
  /** Whether the root of the document is a plain mapping. */
  readonly isMapping: boolean;
  /** The category-ish signal, trimmed and lower-cased, or null. */
  readonly signal: string | null;
  /** Which of {@link TRIAGE_SIGNAL_FIELDS} `signal` came from, or null. */
  readonly signalField: TriageSignalField | null;
  /** `result_code`, through the one coercing accessor (R3.11, R3.12). */
  readonly resultCode: number | null;
  /** `triage.severity` or top-level `severity`, trimmed, or null. */
  readonly severity: string | null;
  /** `triage.confidence` or top-level `confidence` as a finite number, or null. */
  readonly confidence: number | null;
  /** `triage.one_liner` or top-level `one_liner`, trimmed, or null. */
  readonly oneLiner: string | null;
}

/**
 * The file read, injected — a sealed Kane pack is not a test dependency.
 *
 * Contract: return the file's text, or `null` when the file does not exist. Any
 * other failure may throw; the loader catches it and records it as adversity.
 */
export interface FailureYamlFileSystem {
  readFile(path: string): string | null;
}

/** The production read: `node:fs`, absence answered as null rather than thrown. */
export const nodeFailureYamlFileSystem: FailureYamlFileSystem = {
  readFile(path: string): string | null {
    const stats = statSync(path, { throwIfNoEntry: false });
    if (stats === undefined || !stats.isFile()) return null;
    return readFileSync(path, 'utf8');
  },
};

/** {@link loadFailureYaml} input. Supply `content` or `path`, or both. */
export interface LoadFailureYamlRequest {
  /**
   * Absolute path to the file. Used to read it, and recorded on every
   * diagnostic so a reviewer sees which file was blamed.
   */
  readonly path?: string | null;
  /**
   * The file's text, already in hand. Takes precedence over `path`, which then
   * only labels the diagnostics. This is what lets the suites and the task 11.4
   * generators exercise the parser with no filesystem at all.
   */
  readonly content?: string | null;
  /** The read, injected. Defaults to {@link nodeFailureYamlFileSystem}. */
  readonly fs?: FailureYamlFileSystem;
  /** Where adversity is recorded. Omit to load silently. */
  readonly diagnostics?: DiagnosticSink;
}

/**
 * Parser options.
 *
 * `maxAliasCount` is the resource-exhaustion guard: an alias graph that expands
 * exponentially — the classic YAML bomb — is refused rather than materialised.
 * The package's own default already refuses one, and it is written out here so
 * the guard is visible at the call site instead of inherited silently. The
 * refusal arrives as a throw from materialisation, not as a parse error, which
 * is why the two are caught separately below.
 *
 * `logLevel: 'silent'` stops the package writing to the console: a warning about
 * an untrusted file belongs in the diagnostic channel the rest of KEPT reads,
 * not in the CLI's stdout (design §14).
 *
 * Duplicate keys are left at the package default, which is to reject them. A
 * file carrying two `category` keys has an ambiguous signal, and routing on
 * whichever one the parser happened to keep would be a confident guess about a
 * value nobody can recover.
 */
const PARSE_OPTIONS = {
  prettyErrors: true,
  maxAliasCount: 100,
  logLevel: 'silent',
} as const;

/** Own-property read that is safe on anything, arrays and functions included. */
function readField(source: unknown, field: string): unknown {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return undefined;
  return Object.prototype.hasOwnProperty.call(source, field)
    ? (source as Record<string, unknown>)[field]
    : undefined;
}

/** A trimmed non-empty string, or null. Numbers and booleans are not text. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * A finite number, or null. Strings are accepted because YAML quoting makes
 * `confidence: "0.9"` as ordinary as `confidence: 0.9`, and booleans are not,
 * because `Number(true)` is `1` and a flag is not a confidence.
 */
function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Whether a materialised value is a plain mapping rather than a sequence. */
function isMappingValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read one alias, given the root mapping and the nested `triage` mapping. */
function readSignalField(
  field: TriageSignalField,
  fields: Record<string, unknown>,
  triage: unknown,
): string | null {
  return field === 'triage.category'
    ? text(readField(triage, 'category'))
    : text(readField(fields, field));
}

/** First alias that yields a non-empty string, lower-cased. */
function resolveSignal(
  fields: Record<string, unknown>,
  triage: unknown,
): { readonly signal: string | null; readonly signalField: TriageSignalField | null } {
  for (const field of TRIAGE_SIGNAL_FIELDS) {
    const value = readSignalField(field, fields, triage);
    if (value !== null) return { signal: value.toLowerCase(), signalField: field };
  }
  return { signal: null, signalField: null };
}

/** `triage.<field>` preferred, top-level accepted — the shape both fixtures use. */
function nestedFirst(fields: Record<string, unknown>, triage: unknown, field: string): unknown {
  const nested = readField(triage, field);
  return nested === undefined ? readField(fields, field) : nested;
}

function describeCause(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const firstLine = message.split('\n')[0] ?? '';
  return firstLine.trim().length === 0 ? 'no reason reported' : firstLine.trim();
}

/**
 * Load and normalise a `failure.yaml`.
 *
 * Returns `null` for a file that could not be turned into a document at all —
 * absent, unreadable, invalid YAML, or an alias graph refused as a resource
 * exhaustion attempt. Every one of those is diagnosed, and the invalid-YAML
 * diagnostic quotes the parser's own message and one-based line, because a
 * reviewer needs the actual reason rather than the word "failed".
 *
 * A document that parsed but says nothing useful is **not** null: an empty
 * document, a bare scalar and a sequence at the root all return a record with
 * `fields: {}` and `signal: null`, each with its own diagnostic. The distinction
 * is worth keeping — "there was no readable triage note" and "the note parsed
 * and carried no signal" are different facts about a run, even though task
 * 11.4's router defaults both to the same branch.
 *
 * Never throws for the state of the world.
 */
export function loadFailureYaml(request: LoadFailureYamlRequest): FailureYaml | null {
  const sink = request.diagnostics;
  const path = typeof request.path === 'string' && request.path.trim().length > 0
    ? request.path
    : null;

  const raw = readSource(request, path, sink);
  if (raw === null) return null;
  // A byte-order mark ahead of the first key is stripped once, here, so a
  // supplied string and a file read behave identically.
  const source = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

  const parsed = parse(source, path, sink);
  if (!parsed.ok) return null;
  const document = parsed.document;

  if (document === null) {
    sink?.report({
      code: 'failure-yaml-empty',
      severity: 'info',
      message: 'failure.yaml parsed to an empty document, so it carries no triage signal.',
      file: path,
    });
  } else if (!isMappingValue(document)) {
    sink?.report({
      code: 'failure-yaml-not-a-mapping',
      severity: 'warn',
      message:
        `failure.yaml parsed to a ${Array.isArray(document) ? 'sequence' : typeof document} ` +
        `at the root rather than a mapping; no field is read from it.`,
      file: path,
    });
  }

  const fields: Record<string, unknown> = isMappingValue(document) ? { ...document } : {};
  const triage = readField(fields, TRIAGE_MAPPING_FIELD);
  const { signal, signalField } = resolveSignal(fields, triage);

  if (signal === null && isMappingValue(document)) {
    sink?.report({
      code: 'failure-yaml-no-signal',
      severity: 'info',
      message:
        `failure.yaml carried none of the accepted triage fields ` +
        `(${TRIAGE_SIGNAL_FIELDS.join(', ')}).`,
      file: path,
    });
  }

  return {
    path,
    document,
    fields,
    isMapping: isMappingValue(document),
    signal,
    signalField,
    // The single permitted reader of the field, so `"740"` and `740` in a
    // hand-sealed pack normalise identically (design §4.4, R6.8).
    resultCode: resultCode(fields) ?? resultCode(triage),
    severity: text(nestedFirst(fields, triage, 'severity')),
    confidence: finiteNumber(nestedFirst(fields, triage, 'confidence')),
    oneLiner: text(nestedFirst(fields, triage, 'one_liner')),
  };
}

/**
 * Parse outcome. A discriminated result rather than a sentinel value, because
 * `null` is a legitimate document (an empty file) and must stay distinguishable
 * from "this never became a document at all".
 */
type ParseOutcome = { readonly ok: true; readonly document: unknown } | { readonly ok: false };

/** Get the text: supplied content wins, else the injected read. */
function readSource(
  request: LoadFailureYamlRequest,
  path: string | null,
  sink: DiagnosticSink | undefined,
): string | null {
  if (typeof request.content === 'string') return request.content;

  if (path === null) {
    sink?.report({
      code: 'failure-yaml-absent',
      severity: 'warn',
      message:
        'No failure.yaml path or content was supplied, so no triage note can be read. ' +
        'No path is guessed.',
      file: null,
    });
    return null;
  }

  const fs = request.fs ?? nodeFailureYamlFileSystem;
  let content: string | null;
  try {
    content = fs.readFile(path);
  } catch (cause) {
    sink?.report({
      code: 'failure-yaml-unreadable',
      severity: 'warn',
      message: `Could not read ${path}: ${describeCause(cause)}`,
      file: path,
    });
    return null;
  }

  if (content === null) {
    sink?.report({
      code: 'failure-yaml-absent',
      severity: 'warn',
      message: `No failure.yaml at ${path}.`,
      file: path,
    });
    return null;
  }
  return content;
}

/** Parse to a materialised value. */
function parse(
  source: string,
  path: string | null,
  sink: DiagnosticSink | undefined,
): ParseOutcome {
  let document: unknown;
  try {
    const doc = parseDocument(source, PARSE_OPTIONS);

    const failure = doc.errors[0];
    if (failure !== undefined) {
      sink?.report({
        code: 'failure-yaml-unparseable',
        severity: 'warn',
        message:
          `failure.yaml is not valid YAML: ${describeCause(failure)} ` +
          `(${doc.errors.length} parser error${doc.errors.length === 1 ? '' : 's'}).`,
        file: path,
        line: failure.linePos?.[0]?.line ?? null,
      });
      return { ok: false };
    }

    for (const warning of doc.warnings) {
      sink?.report({
        code: 'failure-yaml-warning',
        severity: 'info',
        message: `failure.yaml parsed with a warning: ${describeCause(warning)}`,
        file: path,
        line: warning.linePos?.[0]?.line ?? null,
      });
    }

    // Alias expansion happens here, so both the `maxAliasCount` refusal and an
    // alias with no anchor throw from this call rather than from parsing.
    document = doc.toJS();
  } catch (cause) {
    sink?.report({
      code: 'failure-yaml-unmaterialised',
      severity: 'warn',
      message:
        `failure.yaml parsed but could not be materialised: ${describeCause(cause)}. ` +
        `The document is treated as absent.`,
      file: path,
    });
    return { ok: false };
  }
  return { ok: true, document };
}

/**
 * The `failure.yaml` artefact of a pack, or null.
 *
 * Reads the classification `kane/evidence.ts` already made rather than matching
 * file names a second time. A pack holding more than one — a nested copy under a
 * sub-directory, say — resolves to the one at the pack root, then to the
 * shallowest, then to the first in the pack's own name order. Deterministic, and
 * never a fabricated path (R6.11).
 */
export function findFailureYamlArtifact(pack: EvidencePack | null): EvidenceArtifact | null {
  if (pack === null) return null;
  const candidates = pack.artifacts.filter((artifact) => artifact.kind === 'failure-yaml');
  const ranked = [...candidates].sort(
    (a, b) => a.name.split('/').length - b.name.split('/').length,
  );
  return ranked[0] ?? null;
}

/** {@link loadFailureYamlFromEvidence} input: the listing's, plus the file read. */
export interface LoadFromEvidenceRequest extends ListArtifactsRequest {
  /** The `failure.yaml` read, injected. Defaults to the `node:fs` one. */
  readonly yaml?: FailureYamlFileSystem;
}

/**
 * Resolve the newest pack for a command family and load its `failure.yaml`.
 *
 * The whole point of the composition: the caller passes `{ family, sessionDir,
 * cwd }` — never an event field — and `listArtifacts` derives the location.
 * Returns null when the family seals no pack, when no pack exists, when the pack
 * holds no `failure.yaml`, or when the file is there and unusable. Every one of
 * those is diagnosed by whichever module observed it.
 */
export function loadFailureYamlFromEvidence(request: LoadFromEvidenceRequest): FailureYaml | null {
  const listing = listArtifacts(request);
  const artifact = findFailureYamlArtifact(listing.pack);
  if (artifact === null) {
    request.diagnostics?.report({
      code: 'failure-yaml-absent',
      severity: 'warn',
      message:
        listing.pack === null
          ? 'No evidence pack was resolved, so there is no failure.yaml to read.'
          : `Evidence pack ${listing.pack.id} holds no failure.yaml.`,
      file: listing.pack?.dir ?? listing.dir,
    });
    return null;
  }
  return loadFailureYaml({
    path: artifact.path,
    fs: request.yaml,
    diagnostics: request.diagnostics,
  });
}
