/**
 * `kept amend propose | list | show | accept | reject` — the docs-lie surface
 * (design §8.1, §8.3, §8.4, §13.1, R7.3, R7.4, R7.5, R7.6).
 *
 * The third repair branch, and the one the loop cannot perform for itself. A
 * `code-break` is repaired by the agent and re-verified on save; a `test-drift` is
 * held as a review card; a `docs-lie` says *the documentation claims something the
 * product never did*, and the only honest response to that is to show a human the
 * sentence, the replacement, and the evidence, and wait.
 *
 * ## `propose` is driven by a run, and the replacement comes from the caller
 *
 * `kept amend propose --run <runId>` reads the persisted handoff for that run
 * (R11.7), selects the results the router settled as `docs-lie`, and stages an
 * amendment for each. Everything the amendment carries about *why* comes from the
 * run: the promise id, the citation, the router's rationale verbatim, the strategy
 * that settled it, and the evidence reference. Nothing is re-derived here, and
 * nothing is re-routed — this command cannot turn a `code-break` into a docs
 * amendment, because it only ever reads a branch the router already wrote.
 *
 * The one thing it does **not** invent is the replacement sentence. There is no
 * mechanical rewrite of an English claim that is both correct and honest, and a
 * generated one would be exactly the failure this product exists not to commit: a
 * system that rewrites documentation until its own tests agree with it. So the
 * replacement arrives as `--text`, and without it the command reports the pending
 * decision — the claim, the branch, the rationale, the command to complete — and
 * stages nothing. That is a refusal with an exit code of zero, like every other
 * state of the world (§14.2).
 *
 * ## What each verb may write
 *
 * | verb | writes |
 * |---|---|
 * | `propose` | `.kept/amendments/<id>.json`, then the snapshot |
 * | `list`, `show` | nothing |
 * | `accept` | **one line** of the cited document, the record, then a rebuild and the snapshot |
 * | `reject` | one field of the record |
 *
 * The write discipline itself is not implemented here. `proposeAmendment` and
 * `acceptAmendment` in `@kept/core` own it — the `.kept/` fence, the sha256
 * interlock, the single mutated array element, the atomic rename — and Property 19
 * asserts it against a write-recording filesystem. This file is the command
 * surface: it resolves what to propose, and it discharges the one obligation core
 * reports and cannot honour itself, which is `AcceptResult.rebuildRequired` — an
 * accepted amendment retires one promise and creates another, so the graph and the
 * snapshot are stale the instant the line changes (§8.4 step 7, R7.6).
 */

import type {
  AcceptResult,
  AtomicRenamer,
  CollectingDiagnosticSink,
  Diagnostic,
  DocsAmendment,
  HandoffFile,
  HandoffResult,
  KaneInvoker,
  ProposeResult,
  RejectResult,
  StateFileSystem,
} from '@kept/core';
import {
  acceptAmendment,
  createDiagnosticSink,
  handoffPaths,
  listAmendments,
  nodeStateFileSystem,
  parseHandoff,
  proposeAmendment,
  readAmendment,
  readNewestHandoff,
  rejectAmendment,
} from '@kept/core';

import type { KeptConfig } from '../config.js';
import { runBuild } from './build.js';
import type { SnapshotResult } from './snapshot.js';
import { runSnapshot } from './snapshot.js';

/** The verbs §13.1 gives the command. */
export const AMEND_SUBCOMMANDS: readonly string[] = Object.freeze([
  'propose',
  'list',
  'show',
  'accept',
  'reject',
]);

/** One verb. */
export type AmendSubcommand = 'propose' | 'list' | 'show' | 'accept' | 'reject';

/** Is this word one of the five? */
export function isAmendSubcommand(word: string | null): word is AmendSubcommand {
  return word !== null && AMEND_SUBCOMMANDS.includes(word);
}

/** Diagnostic codes this command reports. Stable; the Ledger keys off them. */
export const AMEND_DIAGNOSTIC_CODES = Object.freeze({
  /** No verb, or a word that is not one of the five. Nothing was written. */
  unknownSubcommand: 'amend-unknown-subcommand',
  /** `show`, `accept` and `reject` each name an amendment; none was given. */
  idRequired: 'amend-id-required',
  /** The run named by `--run` has no readable handoff, so there is nothing to read. */
  runUnreadable: 'amend-run-unreadable',
  /** The run proved nothing — the write guard refused it — so it authorises nothing. */
  unproven: 'amend-run-unproven',
  /** The run is readable and settled no promise as `docs-lie`. */
  noDocsLie: 'amend-no-docs-lie',
  /** A `docs-lie` was found and no replacement sentence was supplied. */
  replacementRequired: 'amend-replacement-required',
  /** One `--text` and several claims to spend it on. Nothing was staged. */
  replacementAmbiguous: 'amend-replacement-ambiguous',
  /** The rebuild §8.4 step 7 requires, after a line was changed. */
  rebuilt: 'amend-rebuilt',
} as const);

/** The codes as a list, so a test can enumerate them. */
export const AMEND_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(AMEND_DIAGNOSTIC_CODES),
);

/** {@link runAmend}'s input. Every seam has a production default. */
export interface AmendRequest {
  readonly repoRoot: string;
  readonly config: KeptConfig;
  /** The verb. `null` and anything unrecognised is reported, never guessed. */
  readonly subcommand: string | null;
  /** `<id>`, for `show`, `accept` and `reject`. */
  readonly id?: string | null | undefined;
  /** `--run <id>`, for `propose`. Absent means the newest handoff. */
  readonly runId?: string | null | undefined;
  /** `--text <replacement>`, the one thing this command will not invent. */
  readonly text?: string | null | undefined;
  /** The Kane boundary the rebuild after `accept` uses. Absent is supported. */
  readonly invoker?: KaneInvoker | undefined;
  readonly fileSystem?: StateFileSystem | undefined;
  /**
   * The `.kept/amendments/` listing `list` enumerates, and the same listing the
   * snapshot's three projections enumerate after `propose`, `accept` and `reject`
   * write one. Defaults to `node:fs`.
   *
   * It reaches `runSnapshot` as well as `listAmendments` because a directory
   * listing is a seam `StateFileSystem` does not cover: that interface reads files
   * by path, and the runs, amendments and held-change projections each start by
   * enumerating a directory. A caller that injected `fileSystem` here and not this
   * got a snapshot whose reads were in the seeded map and whose listings were on
   * real disk, which is not an isolated run however much it looks like one.
   */
  readonly readDirectory?: ((path: string) => readonly string[]) | undefined;
  /** The atomic rename `accept` finishes with (§8.4 step 5). Defaults to `rename(2)`. */
  readonly rename?: AtomicRenamer | undefined;
  readonly diagnostics?: CollectingDiagnosticSink | undefined;
  /** ISO 8601 written into `createdAt` / `appliedAt`. Defaults to now. */
  readonly at?: string | undefined;
}

/** What {@link runAmend} did. */
export interface AmendResult {
  readonly subcommand: AmendSubcommand | null;
  /** The run `propose` read, when it read one. */
  readonly runId: string | null;
  /** Every amendment the verb produced or named, in id order. */
  readonly amendments: readonly DocsAmendment[];
  /** `propose`'s outcome per docs-lie result, in the order the run reported them. */
  readonly proposals: readonly ProposeResult[];
  /** The docs-lie results the run settled, whether or not one was staged. */
  readonly pending: readonly HandoffResult[];
  readonly accepted: AcceptResult | null;
  readonly rejected: RejectResult | null;
  /** Written by `propose` and by `accept`; null when nothing could change it. */
  readonly snapshot: SnapshotResult | null;
  /** True when `accept` changed a line and the graph was rebuilt (§8.4 step 7). */
  readonly rebuilt: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

/** The docs-lie results one handoff settled, in the order the run reported them. */
export function docsLieResults(handoff: HandoffFile): readonly HandoffResult[] {
  return Object.freeze(
    handoff.results.filter((result) => result.repair?.branch === 'docs-lie'),
  );
}

/** Read one run's handoff: the archive when named, the newest otherwise (R11.7). */
function readRun(
  repoRoot: string,
  runId: string | null,
  fileSystem: StateFileSystem,
): HandoffFile | null {
  if (runId === null) return readNewestHandoff(repoRoot, fileSystem);
  let text: string | null;
  try {
    text = fileSystem.readFile(handoffPaths(repoRoot, runId).archive);
  } catch {
    text = null;
  }
  return text === null ? null : parseHandoff(text);
}

/**
 * Run one verb.
 *
 * Never throws for a state of the world: an unknown verb, a run that was never
 * recorded, a run that settled nothing as `docs-lie`, an amendment id nothing is
 * staged under, a document that moved under a proposal. Each is a diagnostic and a
 * zero exit, and each of them wrote nothing.
 */
export async function runAmend(request: AmendRequest): Promise<AmendResult> {
  const sink = request.diagnostics ?? createDiagnosticSink();
  const fileSystem = request.fileSystem ?? nodeStateFileSystem();
  const at = request.at ?? new Date().toISOString();
  const id = request.id ?? null;

  const empty = (subcommand: AmendSubcommand | null): AmendResult => ({
    subcommand,
    runId: null,
    amendments: Object.freeze([]),
    proposals: Object.freeze([]),
    pending: Object.freeze([]),
    accepted: null,
    rejected: null,
    snapshot: null,
    rebuilt: false,
    diagnostics: sink.entries,
  });

  if (!isAmendSubcommand(request.subcommand)) {
    sink.report({
      code: AMEND_DIAGNOSTIC_CODES.unknownSubcommand,
      severity: 'warn',
      message:
        `kept amend takes one of ${AMEND_SUBCOMMANDS.join(', ')}; ` +
        `${request.subcommand === null ? 'none was given' : `'${request.subcommand}' is not one`}` +
        `. Nothing was read and nothing was written.`,
    });
    return empty(null);
  }
  const subcommand: AmendSubcommand = request.subcommand;

  // ── list, show: read-only, and they say so by writing nothing at all. ──────
  if (subcommand === 'list') {
    const amendments = listAmendments(request.repoRoot, {
      fileSystem,
      diagnostics: sink,
      ...(request.readDirectory === undefined ? {} : { readDirectory: request.readDirectory }),
    });
    return { ...empty(subcommand), amendments, diagnostics: sink.entries };
  }

  if (subcommand === 'show' || subcommand === 'accept' || subcommand === 'reject') {
    if (id === null) {
      sink.report({
        code: AMEND_DIAGNOSTIC_CODES.idRequired,
        severity: 'warn',
        message:
          `kept amend ${subcommand} names one amendment: \`kept amend ${subcommand} <id>\`. ` +
          `No id was given, so nothing was read and nothing was written.`,
      });
      return empty(subcommand);
    }
  }

  if (subcommand === 'show') {
    const amendment = readAmendment(request.repoRoot, id as string, {
      fileSystem,
      diagnostics: sink,
    });
    return {
      ...empty(subcommand),
      amendments: amendment === null ? Object.freeze([]) : Object.freeze([amendment]),
      diagnostics: sink.entries,
    };
  }

  if (subcommand === 'reject') {
    const rejected = rejectAmendment({
      repoRoot: request.repoRoot,
      id: id as string,
      fileSystem,
      diagnostics: sink,
    });
    // A rejection changes what `/amendments` shows, and nothing else — no document
    // moved, so there is nothing to rebuild.
    const snapshot = runSnapshot({
      repoRoot: request.repoRoot,
      fileSystem,
      generatedAt: at,
      diagnostics: sink,
      ...(request.readDirectory === undefined ? {} : { readDirectory: request.readDirectory }),
    });
    return {
      ...empty(subcommand),
      amendments:
        rejected.amendment === null ? Object.freeze([]) : Object.freeze([rejected.amendment]),
      rejected,
      snapshot,
      diagnostics: sink.entries,
    };
  }

  if (subcommand === 'accept') {
    const accepted = acceptAmendment({
      repoRoot: request.repoRoot,
      id: id as string,
      at,
      fileSystem,
      diagnostics: sink,
      ...(request.rename === undefined ? {} : { rename: request.rename }),
    });

    // §8.4 step 7, and the only reason this command is `async`. Core reports the
    // obligation and refuses to reach for a dependency it must not have; honouring
    // it is what keeps the graph from carrying a claim nobody makes any more.
    let rebuilt = false;
    if (accepted.rebuildRequired) {
      const build = await runBuild({
        repoRoot: request.repoRoot,
        config: request.config,
        fileSystem,
        diagnostics: sink,
        at,
        ...(request.invoker === undefined ? {} : { invoker: request.invoker }),
      });
      rebuilt = true;
      sink.report({
        code: AMEND_DIAGNOSTIC_CODES.rebuilt,
        severity: 'info',
        message:
          `${accepted.amendment?.citation.file}:${accepted.amendment?.citation.line} was ` +
          `amended, so the graph was rebuilt: ${build.state.graph.promises.length} promise(s). ` +
          `The amended claim keys on a new promise id ` +
          `(${accepted.successorPromiseId ?? 'unresolved'}) and carries no verdict, because ` +
          `carrying the old one across would assert that Kane proved a sentence it never saw.`,
      });
    }

    const snapshot = runSnapshot({
      repoRoot: request.repoRoot,
      fileSystem,
      generatedAt: at,
      diagnostics: sink,
      ...(request.readDirectory === undefined ? {} : { readDirectory: request.readDirectory }),
    });

    return {
      ...empty(subcommand),
      amendments:
        accepted.amendment === null ? Object.freeze([]) : Object.freeze([accepted.amendment]),
      accepted,
      snapshot,
      rebuilt,
      diagnostics: sink.entries,
    };
  }

  // ── propose ───────────────────────────────────────────────────────────────
  const handoff = readRun(request.repoRoot, request.runId ?? null, fileSystem);
  if (handoff === null) {
    sink.report({
      code: AMEND_DIAGNOSTIC_CODES.runUnreadable,
      severity: 'warn',
      message:
        `No handoff is recorded for ` +
        `${request.runId === null || request.runId === undefined ? 'the newest run' : `run '${request.runId}'`}` +
        `, so there is no routed failure to propose an amendment from. Nothing was written.`,
    });
    return empty(subcommand);
  }

  // The same gate `nextAction` is behind (§11.2): a run the write guard did not
  // admit proved nothing, so the repairs its results happen to carry are not
  // evidence of anything. Proposing a documentation change off a crashed stream or
  // a preflight rejection would be asserting a claim is false because KEPT failed
  // to find out whether it was true.
  if (!handoff.outcome.verdictsPermitted) {
    sink.report({
      code: AMEND_DIAGNOSTIC_CODES.unproven,
      severity: 'warn',
      message:
        `Run ${handoff.runId} was not admitted by the verdict write guard ` +
        `(exit meaning '${handoff.outcome.exitMeaning ?? 'none'}'` +
        `${handoff.outcome.terminalSeen ? '' : `, no ${handoff.outcome.terminalEventType ?? 'terminal'} event`}` +
        `), so it proved nothing and no amendment was staged. A documentation claim is not ` +
        `false because a run failed to find out whether it was true.`,
    });
    return { ...empty(subcommand), runId: handoff.runId, diagnostics: sink.entries };
  }

  const pending = docsLieResults(handoff);
  if (pending.length === 0) {
    sink.report({
      code: AMEND_DIAGNOSTIC_CODES.noDocsLie,
      severity: 'info',
      message:
        `Run ${handoff.runId} settled no promise as 'docs-lie' — ` +
        `${handoff.nextAction.branch === null
          ? 'it carries no repair branch at all'
          : `its branch is '${handoff.nextAction.branch}'`}` +
        `. Nothing was staged: an amendment is only ever proposed for a branch the router ` +
        `already settled.`,
    });
    return { ...empty(subcommand), runId: handoff.runId, diagnostics: sink.entries };
  }

  const text = request.text ?? null;
  if (text === null || text.length === 0) {
    for (const result of pending) {
      sink.report({
        code: AMEND_DIAGNOSTIC_CODES.replacementRequired,
        severity: 'warn',
        message:
          `${result.citation.file}:${result.citation.line} claims "${result.citation.text}" and ` +
          `run ${handoff.runId} settled that as 'docs-lie'${
            result.repair === null ? '' : ` — ${result.repair.rationale}`
          } No replacement sentence was given, and KEPT does not write one: a system that ` +
          `generated documentation prose until its own tests agreed with it would be asserting ` +
          `what it cannot observe. Supply the replacement and nothing else changes: ` +
          `\`kept amend propose --run ${handoff.runId} --text '<the sentence>'\`.`,
        file: result.citation.file,
        line: result.citation.line,
      });
    }
    return { ...empty(subcommand), runId: handoff.runId, pending, diagnostics: sink.entries };
  }

  if (pending.length > 1) {
    sink.report({
      code: AMEND_DIAGNOSTIC_CODES.replacementAmbiguous,
      severity: 'warn',
      message:
        `Run ${handoff.runId} settled ${pending.length} claims as 'docs-lie' ` +
        `(${pending.map((result) => `${result.citation.file}:${result.citation.line}`).join(', ')})` +
        ` and one --text was given. One sentence cannot replace ${pending.length} different ` +
        `claims, so nothing was staged: propose them one run at a time, or one narrower ` +
        `verification at a time.`,
    });
    return { ...empty(subcommand), runId: handoff.runId, pending, diagnostics: sink.entries };
  }

  const target = pending[0] as HandoffResult;
  const proposal = proposeAmendment({
    repoRoot: request.repoRoot,
    promiseId: target.promiseId,
    citation: target.citation,
    proposedText: text,
    // The router's own words, quoted rather than paraphrased: the amendment has to
    // say why a human is being asked, and this is the only place that knows.
    rationale:
      `Run ${handoff.runId} reported ${target.memberStatus ?? 'a failure'} for ` +
      `${target.designedTest ?? 'the designed test'} and the ` +
      `${target.repair?.strategy ?? 'verdict'} router settled it as docs-lie. ` +
      `${target.repair?.rationale ?? ''}`.trim(),
    strategy: target.repair?.strategy ?? 'resultCode740',
    evidenceRef: target.repair?.evidenceRef ?? null,
    at,
    fileSystem,
    diagnostics: sink,
  });

  const snapshot = runSnapshot({
    repoRoot: request.repoRoot,
    fileSystem,
    generatedAt: at,
    diagnostics: sink,
    ...(request.readDirectory === undefined ? {} : { readDirectory: request.readDirectory }),
  });

  return {
    ...empty(subcommand),
    runId: handoff.runId,
    amendments: proposal.ok ? Object.freeze([proposal.amendment]) : Object.freeze([]),
    proposals: Object.freeze([proposal]),
    pending,
    snapshot,
    diagnostics: sink.entries,
  };
}
