/**
 * Per-family process exit-code interpretation (design §4.5, A14, R3.14, R3.15,
 * R4.11, R11.9–R11.11).
 *
 * Kane 0.8.4 does not have one exit-code vocabulary. It has one per command
 * family, and the collision is on code **3**:
 *
 * | code | ExecutionRun | ExecutionTestrun | Assurance |
 * |---|---|---|---|
 * | 0 | success | success | success |
 * | 2 | failure | **preflight-rejected** | failure |
 * | 3 | timeout-or-cancelled | timeout-or-cancelled | **paused-resumable** |
 * | 130 | force-interrupted | force-interrupted | force-interrupted |
 * | 127 | kane-not-found | kane-not-found | kane-not-found |
 * | any other non-zero | failure | failure | failure |
 * | `null` (signalled) | force-interrupted | force-interrupted | force-interrupted |
 * | killed by our timeout | killed-by-timeout | killed-by-timeout | killed-by-timeout |
 *
 * Reading an Assurance exit 3 as a failure is the single most damaging mistake
 * available in this codebase: a paused, resumable assurance run would overwrite
 * good verdicts in the ledger with red ones, and the pause would be
 * unrecoverable because the prior state is gone. So the meaning of exit 3 is not
 * re-derived here — it is read from `contractFor(family).exit3`, the same single
 * encoding `kane/family.ts` hands every other consumer.
 *
 * The function is **total** over `number | null` — every signed integer,
 * negatives, non-integers, `NaN`, and `null` — and never throws. An exit code is
 * a fact reported by another operating-system process, so no value of it is a
 * programming error, and design §14.2 reserves exceptions for those.
 *
 * The process exit code and the terminal event's `result_code` are two different
 * values and are never merged (R3.14). `kane/coerce.ts` owns `result_code`; this
 * file owns the process exit code; both travel to the snapshot separately. The
 * verified refusal envelope of design §5.3.1 is the case that proves the point —
 * `cover` with no context store emits `{"status":"refused","exit_code":2}` in the
 * event *and* exits 2 as a process, two independent facts that happen to agree.
 */

import { contractFor, type CommandFamily } from './family.js';

/**
 * What a Kane process's exit meant. Closed vocabulary; design §4.5 fixes the
 * eight members, and §9.1 serialises them verbatim into `ledger.snapshot.json`,
 * so adding a member is a snapshot-schema change and not a local edit.
 */
export type ExitMeaning =
  | 'success'
  | 'failure'
  | 'timeout-or-cancelled'
  | 'paused-resumable'
  | 'force-interrupted'
  | 'preflight-rejected'
  | 'kane-not-found'
  | 'killed-by-timeout';

/** The vocabulary, in design-table order. Lets tests enumerate exhaustively. */
export const EXIT_MEANINGS: readonly ExitMeaning[] = Object.freeze([
  'success',
  'failure',
  'timeout-or-cancelled',
  'paused-resumable',
  'force-interrupted',
  'preflight-rejected',
  'kane-not-found',
  'killed-by-timeout',
]);

/**
 * The exact meanings under which a verdict may be overwritten (design §4.8,
 * §14.2). Exported so that `mayWriteVerdicts()` in `state.ts` (task 3.16) reads
 * the set from here instead of restating two string literals, and so that
 * Property 12 can assert the set by name: a later member added to
 * {@link ExitMeaning} cannot silently join the writable side, because the
 * property pins both the membership and the size of this set. `ReadonlySet` is
 * the compile-time fence; that assertion is the runtime one, since freezing a
 * `Set` seals its properties and not its entries.
 *
 * Everything else — a pause, a preflight rejection, a timeout of either origin,
 * a force-interrupt, a missing binary — preserves prior verdicts and freshness
 * by construction (R3.7, R4.10, R4.11, R5.3, R5.4, R11.8–R11.11).
 */
export const WRITE_PERMITTING_EXIT_MEANINGS: ReadonlySet<ExitMeaning> = Object.freeze(
  new Set<ExitMeaning>(['success', 'failure']),
) as ReadonlySet<ExitMeaning>;

/**
 * Named codes, so no magic number appears in the branch table below.
 *
 * `EXIT_PREFLIGHT_REJECTED` is 2 only for `ExecutionTestrun`: `testrun run`
 * exits 2 when `testrun_plan.valid` is false and nothing ran at all (R4.11). The
 * same 2 from `run` or from an Assurance command is an ordinary failure — for
 * Assurance it is the verified refusal envelope, whose *reason* lives in
 * `done.status`, not in the exit code (design §5.3.1).
 */
export const EXIT_SUCCESS = 0;
export const EXIT_PREFLIGHT_REJECTED = 2;
export const EXIT_PAUSED_OR_TIMEOUT = 3;
export const EXIT_FORCE_INTERRUPTED = 130;
/** POSIX "command not found"; the spawn-level twin of a step-1 `ENOENT`. */
export const EXIT_KANE_NOT_FOUND = 127;

/**
 * Interpret a Kane process's exit against its command family.
 *
 * @param family the family of the command that was invoked. Required, not
 *   inferred: the same integer means different things per family, so an
 *   interpretation without a declared family cannot be written.
 * @param code the process exit code, or `null` when the process was terminated
 *   by a signal rather than exiting (Node reports `code: null, signal: <sig>`).
 * @param killed whether *our own* timeout killed it — the invoker sets this when
 *   its timer fired and it sent SIGTERM then SIGKILL (design §4.7 step 6).
 * @returns exactly one {@link ExitMeaning}. Total; never `undefined`, never a
 *   throw, for any input.
 *
 * ### Precedence, decided deliberately
 *
 * **1. `killed` outranks every code.** A killed process still carries a code —
 * usually `null`, sometimes a wrapper's 143 or 130 — so the two inputs overlap
 * and one has to win. `killed` wins because it is the one fact KEPT knows from
 * its own side rather than infers from Kane's: our timer fired and we sent the
 * signal. The code that comes back is then an artefact of how the process
 * happened to die under that signal, and reporting it would hide the actionable
 * cause ("the 300 s hook budget elapsed", R11.8) behind a generic interruption.
 *
 * **2. `killed` also outranks 127.** A `killed` process cannot mean "binary
 * absent": the invoker resolves `kane-cli` on `PATH` *before* spawning and
 * returns `kane-not-found` immediately when it is missing (design §4.7 step 1),
 * with no process to kill and `killed` false by construction. So a `killed`
 * process that reports 127 is a shell wrapper's exit status under termination,
 * not a missing binary, and the timeout is the true cause. This ordering is also
 * the safe one to get wrong in either direction: both meanings sit outside
 * {@link WRITE_PERMITTING_EXIT_MEANINGS}, so the choice changes which diagnostic
 * a reviewer reads on `/runs` and can never change a verdict.
 *
 * **3. `null` reads as `force-interrupted`, not as `failure`.** A `null` code
 * means the process was signalled. That is exactly what 130 already encodes —
 * the shell's `128 + SIGINT` — so a signal death maps to the same meaning rather
 * than inventing a ninth one. The alternative, `failure`, is
 * write-*permitting*: an out-of-memory or SIGSEGV kill would then be allowed to
 * move verdicts on the strength of whatever happened to be flushed to stdout
 * before the process died. Keeping signalled deaths outside the writable set
 * means a run that never reached its terminal event cannot rewrite the ledger,
 * whatever the stream parser saw.
 *
 * Only `0` is success. Every other code that is not named above — negative,
 * out-of-range, non-integer, `NaN` — falls through to `failure`, matching the
 * design table's "any other non-zero". No arithmetic is performed on the code,
 * so a hostile value cannot be rounded or truncated into a named meaning.
 */
export function exitMeaning(
  family: CommandFamily,
  code: number | null,
  killed: boolean,
): ExitMeaning {
  // Precedence 1 and 2: our own timeout is the cause, whatever the code says.
  if (killed === true) return 'killed-by-timeout';

  // Precedence 3: signalled rather than exited.
  if (code === null || code === undefined) return 'force-interrupted';

  if (code === EXIT_SUCCESS) return 'success';

  if (code === EXIT_KANE_NOT_FOUND) return 'kane-not-found';

  if (code === EXIT_FORCE_INTERRUPTED) return 'force-interrupted';

  // The one code whose meaning is family-dependent. Read from the contract, so
  // the fact stays encoded exactly once (`kane/family.ts`).
  if (code === EXIT_PAUSED_OR_TIMEOUT) return contractFor(family).exit3;

  // The other family-dependent code, and the reason it is not in the contract:
  // 2 is a *rejection* only for `testrun run`, where `testrun_plan.valid` is
  // false and no member executed (R4.11). Elsewhere 2 is a plain failure.
  if (code === EXIT_PREFLIGHT_REJECTED && family === 'ExecutionTestrun') {
    return 'preflight-rejected';
  }

  return 'failure';
}

/**
 * Interpret the exit of a Kane command that belongs to **no** family — the plain
 * commands that emit ordinary output instead of one of the three event streams
 * (design §4.1, §13.2.2).
 *
 * `context list --json` is the one KEPT invokes. Observed on 0.8.4: it prints one
 * JSON object per line and exits `0`, and in a directory with no store it prints
 * `error: no context store here (run `kane-cli context ingest <files>` first)`
 * on **stdout** and exits `2`. There is no terminal event, no `--mode` flag and
 * no `done`, so there is no contract to read a family-dependent code against.
 *
 * Which is exactly why this is a separate function rather than
 * {@link exitMeaning} with a defaulted family. The two codes {@link exitMeaning}
 * reads from a family are `3` and `2`, and both would be *invented* here: a plain
 * listing has no pause to resume and no preflight to reject. So `3` and `2` are
 * ordinary failures, and nothing pretends to know more than the process said.
 *
 * Total over `number | null`; never throws. `killed` outranks every code, for the
 * reason given on {@link exitMeaning}.
 */
export function plainExitMeaning(code: number | null, killed: boolean): ExitMeaning {
  if (killed === true) return 'killed-by-timeout';
  if (code === null || code === undefined) return 'force-interrupted';
  if (code === EXIT_SUCCESS) return 'success';
  if (code === EXIT_KANE_NOT_FOUND) return 'kane-not-found';
  if (code === EXIT_FORCE_INTERRUPTED) return 'force-interrupted';
  return 'failure';
}

/**
 * May a run with this exit meaning move verdicts? The exit-code half of
 * `mayWriteVerdicts()` (design §4.8); the stream half — `kind === 'complete'` —
 * is applied alongside it in `state.ts`, because a proven outcome needs both.
 */
export function permitsVerdictWrite(meaning: ExitMeaning): boolean {
  return WRITE_PERMITTING_EXIT_MEANINGS.has(meaning);
}

/** Boundary guard for a value read back from a snapshot or a handoff file. */
export function isExitMeaning(value: unknown): value is ExitMeaning {
  return typeof value === 'string' && (EXIT_MEANINGS as readonly string[]).includes(value);
}
