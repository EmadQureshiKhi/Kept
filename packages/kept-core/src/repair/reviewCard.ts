/**
 * Review cards — the held-change artefact (design §8.1, §8.2, R5.7, R7.2, R7.7).
 *
 * `.kept/review-cards/<id>.json`. One card per change that `maintain reconcile`
 * or `maintain evolve` produced, and **nothing is ever applied**.
 *
 * ## This module mirrors Kane; it does not reimplement it
 *
 * The temptation on the `test-drift` branch is to build a holding mechanism on
 * top of Kane: read the proposed change, decide whether to apply it, keep a
 * queue. That would be a second source of truth about what is pending, and the
 * two would drift the first time a human walked Kane's own stored plan.
 *
 * Kane already holds. `maintain reconcile --plan` previews: the head move lands
 * and everything else is **staged** into Kane's own plan, which is exactly the
 * "hold every change, apply none automatically" semantic R5.7 asks for
 * (`@corgod/kept-cli/src/commands/reconcile.ts` says the same thing from the other side).
 * So this module's whole job is projection: each `review_card` event the stream
 * carried becomes one card under `.kept/`, verbatim where Kane gave text and
 * with a documented fallback where it did not. There is no apply path here — not
 * a guarded one, not a flagged one, none — and {@link writeReviewCard} refuses
 * any destination outside `.kept/` by construction rather than by discipline.
 *
 * ## The branch is derived, not passed
 *
 * §8.1 pairs exactly one branch with the review-card artefact, and
 * {@link REVIEW_CARD_BRANCH} is *read off* `BRANCH_FENCES` rather than restated
 * here. A caller cannot hand this module `docs-lie` and get a card whose fence
 * says `propose`/`amendment`, because no caller supplies a branch at all. That
 * is what makes Property 20 hold structurally: every card this module can
 * produce carries a branch whose autonomy is `hold` and whose artefact is
 * `review-card`, and its status is `open` — the vocabulary has no "applied".
 *
 * `kind` is a different question from `branch` and both are carried, because they
 * answer different things. `kind` records *which command produced the card* —
 * `reconcile` or `test-drift` (evolve) — and a reviewer sorting `/reviews` wants
 * that. `branch` records *what class of repair it is*, and for both commands the
 * answer is the same: a held change to the designed-test corpus.
 *
 * ## The card is the snapshot's own shape
 *
 * {@link ReviewCard} is field-for-field `SnapshotReviewCard` from
 * `model/snapshot.ts`. Deliberately: `kept snapshot` projects these files, that
 * schema is strict, and a translation layer between the on-disk card and the
 * projected one would be one more place to get a field name wrong. So the
 * projection is the identity function, and the zod schema is the guard on both
 * ends. The consequence is that the card carries no `schemaVersion` and no `raw`
 * copy of Kane's event — the staged event itself stays on `ReconcileDoc.staged`
 * and in the run's handoff, which is where a reviewer chasing provenance looks.
 *
 * ## Ids are content-derived, so re-mirroring is idempotent
 *
 * `rc_` plus eight hex of the promise id, the kind and the canonical proposed
 * changes. Saving the same README twice inside a minute re-stages the same items
 * and must not accumulate duplicate cards, exactly as re-proposing an amendment
 * must not (§8.3). A card that already exists on disk is **left as it was** —
 * its `createdAt` and its `status` are a human's record, and a second mirror pass
 * has no business resetting a card somebody already dismissed.
 */

import { readdirSync } from 'node:fs';

import {
  createDiagnosticSink,
  type Diagnostic,
  type DiagnosticDraft,
  type DiagnosticSink,
} from '../diagnostics.js';
import { BRANCH_FENCES } from '../handoff/handoff.js';
import { isCitationPathSafe } from '../model/admission.js';
import { isPromiseId, sha256Hex, toPosix } from '../model/ids.js';
import type { RepairBranch, RepairStrategy } from '../model/promise.js';
import { REPAIR_BRANCHES, isRepairStrategy } from '../model/promise.js';
import {
  REVIEW_CARD_KINDS,
  REVIEW_CARD_STATUSES,
  type SnapshotReviewCard,
} from '../model/snapshot.js';
import {
  inMemoryStateFileSystem,
  nodeStateFileSystem,
  type StateFileSystem,
} from '../state.js';

/** Where the cards live. Gitignored: regenerable state, reviewable format. */
export const REVIEW_CARDS_DIRECTORY_RELATIVE_PATH = '.kept/review-cards';

/** The only directory the repair surfaces write into, other than an accepted doc. */
export const KEPT_DIRECTORY_NAME = '.kept';

/** `rc_` plus eight hex, matching the design's own example (§8.2). */
export const REVIEW_CARD_ID_PREFIX = 'rc_';

/** Eight hex characters of the content hash. Wide enough for a repository's cards. */
export const REVIEW_CARD_ID_HASH_LENGTH = 8;

/**
 * Which repair branches §8.1 pairs with the review-card artefact, read off the
 * fence table rather than restated. A fourth branch, or a change to the table,
 * moves this list with it instead of leaving a stale copy behind.
 */
export const REVIEW_CARD_BRANCHES: readonly RepairBranch[] = Object.freeze(
  REPAIR_BRANCHES.filter((branch) => BRANCH_FENCES[branch].artefact === 'review-card'),
);

/**
 * The one branch every card carries.
 *
 * Both commands that produce cards propose a held change to the designed-test
 * corpus, which is `test-drift` in §8.1's vocabulary — and §8.1 pairs that branch
 * with this artefact. Derived from {@link REVIEW_CARD_BRANCHES} so it cannot
 * disagree with the fence table; the fallback is unreachable while that table
 * names exactly one such branch, and exists so a table edit is a test failure
 * rather than a crash.
 */
export const REVIEW_CARD_BRANCH: RepairBranch = REVIEW_CARD_BRANCHES[0] ?? 'test-drift';

/** The status a freshly mirrored card carries. There is no "applied" (R5.7). */
export const REVIEW_CARD_OPEN_STATUS = 'open' as const;

/** Diagnostic codes this module reports. Stable strings; the Ledger keys off them. */
export const REVIEW_CARD_DIAGNOSTIC_CODES = Object.freeze({
  /** A card was written under `.kept/review-cards/`. */
  written: 'review-card-written',
  /** The card already existed and was left exactly as it was (idempotence). */
  exists: 'review-card-exists',
  /** The card could not be written. Nothing was applied either way. */
  writeFailed: 'review-card-write-failed',
  /** A destination outside `.kept/` was refused before any write (R7.4's spirit). */
  writeRefused: 'review-card-write-refused',
  /** A staged item named no promise, so no schema-valid card could be built. */
  unattributed: 'review-card-unattributed',
  /** The stream crashed, paused or refused, so no card was created (R5.3, R5.4). */
  outcomeUnproven: 'review-card-outcome-unproven',
  /** One proposed change was dropped: its path was not repository-relative. */
  changeDropped: 'review-card-change-dropped',
  /** A card file could not be read. Treated as absent. */
  unreadable: 'review-card-unreadable',
  /** A card file parsed but is not the shape this version writes. Discarded. */
  malformed: 'review-card-malformed',
} as const);

/** Every code above, so a test can enumerate them and the Ledger can filter. */
export const REVIEW_CARD_DIAGNOSTIC_CODE_VALUES: readonly string[] = Object.freeze(
  Object.values(REVIEW_CARD_DIAGNOSTIC_CODES),
);

/** Which command produced a card (§8.2). Provenance, not repair class. */
export type ReviewCardKind = (typeof REVIEW_CARD_KINDS)[number];

/** A card's lifecycle (§8.2). Open, or dismissed by a human. Never applied. */
export type ReviewCardStatus = (typeof REVIEW_CARD_STATUSES)[number];

/** One proposed change, held. `diff` may be empty when Kane rendered none. */
export interface ProposedChange {
  /** Repository-relative POSIX path. Never absolute. */
  readonly file: string;
  readonly summary: string;
  readonly diff: string;
}

/**
 * A held change (§8.2). Field-for-field `SnapshotReviewCard`, so the snapshot
 * projection is the identity function — see the module header.
 */
export interface ReviewCard {
  readonly id: string;
  readonly createdAt: string;
  readonly kind: ReviewCardKind;
  readonly promiseId: string;
  readonly branch: RepairBranch;
  readonly title: string;
  readonly detail: string;
  readonly proposedChanges: readonly ProposedChange[];
  readonly evidenceRef: string | null;
  readonly strategy: RepairStrategy;
  readonly status: ReviewCardStatus;
}

/**
 * The card is the snapshot's review card, and that is asserted rather than
 * asserted-in-prose: `repair-review-card.test.ts` runs every produced card
 * through `SnapshotReviewCardSchema` — which is a strict object, so an extra or
 * missing field fails — and checks the serialised key list against it. A zod
 * parse is the honest check here, because the schema carries refinements (the id
 * pattern, the timestamp rule, the non-empty title) that no structural type can.
 *
 * The one thing this projection does is loosen the `readonly` on the change list,
 * because `buildSnapshot` takes `readonly SnapshotReviewCard[]` whose elements
 * carry a mutable array. Nothing is copied but the list, and no field is renamed
 * — which is the property that keeps the two shapes honest.
 */
export function toSnapshotReviewCard(card: ReviewCard): SnapshotReviewCard {
  return { ...card, proposedChanges: card.proposedChanges.map((change) => ({ ...change })) };
}

// ---------------------------------------------------------------------------
// The repair store, and the fence around it
// ---------------------------------------------------------------------------

/** Join a repository root and a repository-relative directory. */
export function repairDirectoryOf(repoRoot: string, relativeDirectory: string): string {
  const root = repoRoot.endsWith('/') ? repoRoot.slice(0, -1) : repoRoot;
  return `${root}/${relativeDirectory}`;
}

/**
 * The `.kept/` fence: answer the path when it is under `<repoRoot>/.kept/`, and
 * `null` otherwise.
 *
 * Every write in `src/repair/` passes through here except the one accepted
 * documentation edit, which is why a proposal and a review card cannot touch a
 * documentation byte even if a caller composed a path that pointed at one. It is
 * checked segment-wise rather than by prefix string, so `.keptx/` is refused and a
 * `..` that climbs back out of the fence is refused too — `.kept/../README.md` is
 * not a path under `.kept/`, however it is spelled.
 *
 * Stated here rather than beside the line surgery because this is the module that
 * owns the repair *store*: where held artefacts live, and what may be written
 * there. `lineEdit.ts` owns the other half — how one line becomes another.
 */
export function keptWritePath(repoRoot: string, absolutePath: string): string | null {
  const root = normalisePath(repoRoot);
  const target = normalisePath(absolutePath);
  if (root.length === 0 || target.length === 0) return null;
  const prefix = root.endsWith('/') ? root : `${root}/`;
  if (!target.startsWith(prefix)) return null;
  const segments = target.slice(prefix.length).split('/');
  if (segments[0] !== KEPT_DIRECTORY_NAME) return null;
  // `.kept` itself is the directory, not a file in it. A write needs a name.
  if (segments.length < 2) return null;
  let depth = 0;
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.') return null;
    if (segment === '..') {
      depth -= 1;
      if (depth < 1) return null;
      continue;
    }
    depth += 1;
  }
  return absolutePath;
}

/** Whether a path is inside the `.kept/` fence. */
export function isKeptWritePath(repoRoot: string, absolutePath: string): boolean {
  return keptWritePath(repoRoot, absolutePath) !== null;
}

function normalisePath(path: string): string {
  return typeof path === 'string' ? path.replace(/\\/g, '/').replace(/\/{2,}/g, '/') : '';
}

/** Absolute path of the review-card directory under a repository root. */
export function reviewCardsDirectory(repoRoot: string): string {
  return repairDirectoryOf(repoRoot, REVIEW_CARDS_DIRECTORY_RELATIVE_PATH);
}

/** Absolute path of one card. */
export function reviewCardPath(repoRoot: string, id: string): string {
  return `${reviewCardsDirectory(repoRoot)}/${id}.json`;
}

/** Canonical bytes: the design's field order, two-space indent, one newline. */
export function serialiseReviewCard(card: ReviewCard): string {
  return `${JSON.stringify(
    {
      id: card.id,
      createdAt: card.createdAt,
      kind: card.kind,
      promiseId: card.promiseId,
      branch: card.branch,
      title: card.title,
      detail: card.detail,
      proposedChanges: card.proposedChanges.map((change) => ({
        file: change.file,
        summary: change.summary,
        diff: change.diff,
      })),
      evidenceRef: card.evidenceRef,
      strategy: card.strategy,
      status: card.status,
    },
    null,
    2,
  )}\n`;
}

/** Structural guard for one proposed change read back off disk. */
export function isProposedChange(value: unknown): value is ProposedChange {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const file = candidate['file'];
  if (typeof file !== 'string' || file.length === 0) return false;
  const summary = candidate['summary'];
  if (typeof summary !== 'string' || summary.length === 0) return false;
  return typeof candidate['diff'] === 'string';
}

/**
 * Structural guard for a card read back off disk.
 *
 * Strict about the fields the strict snapshot schema is strict about, because a
 * card that would fail `parseSnapshot` is a card that fails the Ledger build
 * (R8.8) — and failing here, with a diagnostic naming the file, is the cheaper
 * of the two places to find out.
 */
export function isReviewCard(value: unknown): value is ReviewCard {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const id = candidate['id'];
  if (typeof id !== 'string' || !isReviewCardId(id)) return false;
  const createdAt = candidate['createdAt'];
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) return false;
  if (!(REVIEW_CARD_KINDS as readonly string[]).includes(candidate['kind'] as string)) return false;
  if (!isPromiseId(candidate['promiseId'])) return false;
  if (!(REPAIR_BRANCHES as readonly string[]).includes(candidate['branch'] as string)) return false;
  const title = candidate['title'];
  if (typeof title !== 'string' || title.length === 0) return false;
  if (typeof candidate['detail'] !== 'string') return false;
  const changes = candidate['proposedChanges'];
  if (!Array.isArray(changes) || !changes.every((change) => isProposedChange(change))) return false;
  const evidenceRef = candidate['evidenceRef'];
  if (evidenceRef !== null && (typeof evidenceRef !== 'string' || evidenceRef.length === 0)) {
    return false;
  }
  if (!isRepairStrategy(candidate['strategy'])) return false;
  return (REVIEW_CARD_STATUSES as readonly string[]).includes(candidate['status'] as string);
}

/** Whether a string is a well-formed card id. */
export function isReviewCardId(value: unknown): value is string {
  return typeof value === 'string' && /^rc_[A-Za-z0-9._-]+$/.test(value);
}

/**
 * Derive a card id from its content (§8.3's idempotence rule, applied here).
 *
 * Keyed on the promise, the kind and the canonical proposed changes — not on the
 * title, the detail or the clock, because Kane rephrasing a summary between two
 * saves is the same held change and must not become a second card.
 */
export function reviewCardId(
  promiseId: string,
  kind: ReviewCardKind,
  proposedChanges: readonly ProposedChange[],
): string {
  const key = [
    promiseId,
    kind,
    ...proposedChanges.map((change) => `${change.file}\u0000${change.summary}\u0000${change.diff}`),
  ].join('\n');
  return (
    REVIEW_CARD_ID_PREFIX + sha256Hex(key).slice(0, REVIEW_CARD_ID_HASH_LENGTH)
  );
}

/** Parse a card, answering null rather than throwing (the `cache.ts` idiom). */
export function parseReviewCard(
  text: string,
  options: { readonly file?: string; readonly diagnostics?: DiagnosticSink } = {},
): ReviewCard | null {
  const report = (draft: DiagnosticDraft): void => {
    options.diagnostics?.report(draft);
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    report({
      code: REVIEW_CARD_DIAGNOSTIC_CODES.malformed,
      severity: 'warn',
      message:
        `${options.file ?? 'a review card'} is not valid JSON (${describe(cause)}), so it is ` +
        `discarded rather than projected into the snapshot.`,
      file: options.file ?? null,
    });
    return null;
  }
  if (!isReviewCard(parsed)) {
    report({
      code: REVIEW_CARD_DIAGNOSTIC_CODES.malformed,
      severity: 'warn',
      message:
        `${options.file ?? 'a review card'} is not the shape this version writes, so it is ` +
        `discarded: a card the strict snapshot schema would reject fails the Ledger build, and ` +
        `finding out here names the file.`,
      file: options.file ?? null,
    });
    return null;
  }
  return parsed;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// ---------------------------------------------------------------------------
// Building a card
// ---------------------------------------------------------------------------

/** What every card needs beyond its own text. */
export interface ReviewCardContext {
  /** The promise the held change is about. Must be a `p_` id (§9.1). */
  readonly promiseId: string;
  /** ISO 8601. A string, never a `Date` — the snapshot round-trips through JSON. */
  readonly createdAt: string;
  /** Which router settled the branch. Carried so `/reviews` can name it. */
  readonly strategy: RepairStrategy;
  /** Repo-relative reference into a committed pack, or null. */
  readonly evidenceRef?: string | null;
  /** Where refusals are recorded. A card is never silently dropped. */
  readonly diagnostics?: DiagnosticSink;
}

/** A card, or the reason no schema-valid card could be built. */
export type ReviewCardDraft =
  | { readonly ok: true; readonly card: ReviewCard }
  | { readonly ok: false; readonly reason: 'unattributed' };

/** Normalise and filter proposed changes, diagnosing every dropped one. */
function admitChanges(
  raw: readonly ProposedChange[],
  report: (draft: DiagnosticDraft) => void,
): readonly ProposedChange[] {
  const admitted: ProposedChange[] = [];
  for (const change of raw) {
    const file = toPosix(change.file);
    if (file.length === 0 || !isCitationPathSafe(file)) {
      report({
        code: REVIEW_CARD_DIAGNOSTIC_CODES.changeDropped,
        severity: 'warn',
        message:
          `A proposed change naming '${change.file}' was dropped from the review card: a held ` +
          `change has to name a repository-relative path, and an absolute or escaping one means ` +
          `something different on every machine that reads the snapshot.`,
        file: null,
      });
      continue;
    }
    const summary =
      change.summary.trim().length > 0 ? change.summary : `a held change to ${file}`;
    admitted.push({ file, summary, diff: change.diff });
  }
  return Object.freeze(admitted);
}

/**
 * Build one card. Pure, total, and the only construction site.
 *
 * The single way this answers "no card" is an unattributed change: the snapshot
 * requires a `p_` promise id and inventing one would put a card in the Ledger
 * pointing at a promise that does not exist. Refusing, with a diagnostic, is the
 * honest answer — and it still applies nothing, which is the invariant that
 * matters (R5.7).
 */
export function buildReviewCard(input: {
  readonly kind: ReviewCardKind;
  readonly title: string;
  readonly detail?: string;
  readonly proposedChanges?: readonly ProposedChange[];
  readonly context: ReviewCardContext;
}): ReviewCardDraft {
  const context = input.context;
  const report = (draft: DiagnosticDraft): void => {
    context.diagnostics?.report(draft);
  };

  if (!isPromiseId(context.promiseId)) {
    report({
      code: REVIEW_CARD_DIAGNOSTIC_CODES.unattributed,
      severity: 'warn',
      message:
        `A held change from ${input.kind} named no promise this graph carries, so no review card ` +
        `was created: a card has to point at a real promise id, and inventing one would put a ` +
        `dead link in the Ledger. Nothing was applied.`,
      file: null,
    });
    return { ok: false, reason: 'unattributed' };
  }

  const changes = admitChanges(input.proposedChanges ?? [], report);
  const title =
    input.title.trim().length > 0
      ? input.title
      : `${input.kind} proposed ${changes.length} held change${changes.length === 1 ? '' : 's'}`;

  return {
    ok: true,
    card: {
      id: reviewCardId(context.promiseId, input.kind, changes),
      createdAt: context.createdAt,
      kind: input.kind,
      promiseId: context.promiseId,
      branch: REVIEW_CARD_BRANCH,
      title,
      detail: input.detail ?? '',
      proposedChanges: changes,
      evidenceRef: context.evidenceRef ?? null,
      strategy: context.strategy,
      status: REVIEW_CARD_OPEN_STATUS,
    },
  };
}

// ---------------------------------------------------------------------------
// Mirroring Kane's staged items
// ---------------------------------------------------------------------------

/** Field spellings a staged item might use for its one-line summary. */
const TITLE_KEYS: readonly string[] = ['title', 'summary', 'one_liner', 'message', 'name'];

/** Field spellings for the longer prose. */
const DETAIL_KEYS: readonly string[] = ['detail', 'details', 'description', 'body', 'rationale'];

/** Field spellings for the list of changes. */
const CHANGE_LIST_KEYS: readonly string[] = ['proposed_changes', 'proposedChanges', 'changes', 'files'];

/** Field spellings for one change's path. */
const CHANGE_FILE_KEYS: readonly string[] = ['file', 'path', 'target', 'file_path'];

/** Field spellings for one change's summary. */
const CHANGE_SUMMARY_KEYS: readonly string[] = ['summary', 'title', 'description', 'reason'];

/** Field spellings for one change's rendered diff. */
const CHANGE_DIFF_KEYS: readonly string[] = ['diff', 'patch', 'unified_diff'];

/** Field spellings for a promise id Kane echoed back. */
const PROMISE_ID_KEYS: readonly string[] = ['promise_id', 'promiseId'];

/** The first non-empty string among the given keys, or null. */
function firstString(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
}

/** Read one change out of an unknown record, tolerantly. */
function changeFrom(value: unknown): ProposedChange | null {
  if (typeof value === 'string') {
    // A bare path is a legitimate spelling of "this file changed, no diff rendered".
    return value.trim().length === 0 ? null : { file: value, summary: '', diff: '' };
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const file = firstString(record, CHANGE_FILE_KEYS);
  if (file === null) return null;
  return {
    file,
    summary: firstString(record, CHANGE_SUMMARY_KEYS) ?? '',
    diff: firstString(record, CHANGE_DIFF_KEYS) ?? '',
  };
}

/** Read the change list out of a staged item, tolerantly. */
function changesFrom(item: Record<string, unknown>): readonly ProposedChange[] {
  for (const key of CHANGE_LIST_KEYS) {
    const value = item[key];
    if (!Array.isArray(value)) continue;
    const changes: ProposedChange[] = [];
    for (const entry of value) {
      const change = changeFrom(entry);
      if (change !== null) changes.push(change);
    }
    return Object.freeze(changes);
  }
  const single = changeFrom(item);
  return single === null ? Object.freeze([]) : Object.freeze([single]);
}

/**
 * Mirror one of Kane's staged items into a card (§8.2, R5.7).
 *
 * Kane's own field spellings are read tolerantly, in the same spirit as
 * `context/listing.ts` projecting a store listing: an item whose summary lives
 * under `one_liner` rather than `title` is the same held change, and refusing it
 * over a key name would silently lose a staged item. What is *not* tolerated is
 * an unattributed item or an absolute path, both of which would produce a card
 * the snapshot schema rejects.
 *
 * The item's own `promise_id`, when it carries one, wins over the context's —
 * Kane knows which claim it staged a change for better than the caller's guess
 * does. Anything unrecognised stays on the staged event itself, which the run's
 * handoff carries verbatim; this file adds no `raw` field, because the card is
 * the snapshot's strict shape and nothing else.
 */
export function reviewCardFromStagedItem(
  item: Record<string, unknown>,
  context: ReviewCardContext,
): ReviewCardDraft {
  const echoed = firstString(item, PROMISE_ID_KEYS);
  const promiseId = echoed !== null && isPromiseId(echoed) ? echoed : context.promiseId;
  const changes = changesFrom(item);
  const title =
    firstString(item, TITLE_KEYS) ??
    (changes.length > 0
      ? `reconcile staged a held change to ${changes[0]?.file ?? 'the corpus'}`
      : '');
  return buildReviewCard({
    kind: 'reconcile',
    title,
    detail: firstString(item, DETAIL_KEYS) ?? '',
    proposedChanges: changes,
    context: { ...context, promiseId },
  });
}

/**
 * Mirror every staged item of one reconciliation.
 *
 * Deduplicated by id, because two saves inside a minute stage the same items and
 * the ids are content-derived. Items that could not be attributed are counted
 * rather than silently skipped — the count is what a reviewer needs to know that
 * Kane staged more than `/reviews` is showing.
 */
export function reviewCardsFromStagedItems(
  staged: readonly Record<string, unknown>[],
  context: ReviewCardContext,
): { readonly cards: readonly ReviewCard[]; readonly unattributed: number } {
  const byId = new Map<string, ReviewCard>();
  let unattributed = 0;
  for (const item of staged) {
    const draft = reviewCardFromStagedItem(item, context);
    if (!draft.ok) {
      unattributed += 1;
      continue;
    }
    if (!byId.has(draft.card.id)) byId.set(draft.card.id, draft.card);
  }
  return {
    cards: Object.freeze([...byId.values()].sort((left, right) => compareIds(left.id, right.id))),
    unattributed,
  };
}

/**
 * What {@link mirrorReconcileStagedChanges} did.
 *
 * `mirrored` is false for every reconciliation whose terminal `done` did not
 * arrive with an accepting status, and `cards` is empty in that case — see the
 * function's own note for why that is a requirement rather than caution.
 */
export interface MirroredHeldChanges {
  readonly cards: readonly ReviewCard[];
  /** Staged items that named no promise, counted rather than lost. */
  readonly unattributed: number;
  /** Whether the outcome admitted mirroring at all. */
  readonly mirrored: boolean;
}

/**
 * Mirror one reconciliation's staged items, **gated on the outcome** (R5.3, R5.4).
 *
 * The gate is the requirement, not a precaution. R5.3: a reconciliation stream
 * that ends without its `done` event is a crashed stream, and KEPT "SHALL create
 * no Review_Card from that stream". R5.4: a `done` reporting `paused` with exit
 * three leaves everything unchanged. A refusal is a `complete` stream with a
 * non-accepting status and is the same story. In all three cases the items on the
 * stream are whatever arrived before the outcome was known, and a card built from
 * them would tell a reviewer that Kane staged a change it may never have finished
 * staging.
 *
 * `accepted` is supplied rather than re-derived: `kept reconcile` already computes
 * it from the terminal event through `normaliseAssuranceStatus` and
 * `ACCEPTED_ASSURANCE_STATUS`, and a second copy of that rule here is exactly how
 * the two would come to disagree. What this function guarantees is that there is
 * **no way to reach a card without passing the flag**, which is the half a caller
 * cannot forget.
 *
 * Evolve's degradation path deliberately does not come through here: task 14.2
 * builds a `test-drift` card from the failure context alone when the flag probe
 * says `maintain evolve` cannot be invoked, and that card records a failure rather
 * than a staged change. {@link testDriftReviewCard} is its constructor.
 */
export function mirrorReconcileStagedChanges(request: {
  /** Whether the terminal `done` arrived with an accepting status. */
  readonly accepted: boolean;
  /** The `review_card` events the stream carried, verbatim. */
  readonly staged: readonly Record<string, unknown>[];
  readonly context: ReviewCardContext;
  /** How the run ended, for the diagnostic. `crashed`, `paused`, `refused`, … */
  readonly outcome?: string | null | undefined;
}): MirroredHeldChanges {
  if (!request.accepted) {
    if (request.staged.length > 0) {
      request.context.diagnostics?.report({
        code: REVIEW_CARD_DIAGNOSTIC_CODES.outcomeUnproven,
        severity: 'info',
        message:
          `${request.staged.length} staged item${request.staged.length === 1 ? '' : 's'} arrived ` +
          `before the reconciliation ended ${request.outcome ?? 'without an accepting done event'}` +
          `, so no review card was created from that stream. What Kane staged is not known to be ` +
          `what Kane finished staging, and nothing was applied either way.`,
        file: null,
      });
    }
    return { cards: Object.freeze([]), unattributed: 0, mirrored: false };
  }
  const mirrored = reviewCardsFromStagedItems(request.staged, request.context);
  return { cards: mirrored.cards, unattributed: mirrored.unattributed, mirrored: true };
}

/**
 * A `test-drift` card built from the failure context alone — what `kept evolve`
 * writes when it could not invoke `maintain evolve` at all (task 14.2's flag
 * probe). The held-change discipline is identical: `status: 'open'`, nothing
 * applied, and the card records that no proposed change was rendered rather
 * than pretending one was.
 */
export function testDriftReviewCard(input: {
  readonly title: string;
  readonly detail?: string;
  readonly proposedChanges?: readonly ProposedChange[];
  readonly context: ReviewCardContext;
}): ReviewCardDraft {
  return buildReviewCard({
    kind: 'test-drift',
    title: input.title,
    ...(input.detail === undefined ? {} : { detail: input.detail }),
    ...(input.proposedChanges === undefined
      ? {}
      : { proposedChanges: input.proposedChanges }),
    context: input.context,
  });
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Persistence — under `.kept/`, and nowhere else
// ---------------------------------------------------------------------------

/**
 * How the card store lists a directory. Its own tiny seam rather than a widening
 * of {@link StateFileSystem}, following the precedent `context/cache.ts` set with
 * `SourceMtimeReader` and `reconcile.ts` with `ReconcileFileProbe`: `state.ts`
 * and `handoff.ts` share that filesystem and neither has any use for a listing.
 */
export type RepairDirectoryReader = (absoluteDirectory: string) => readonly string[];

/** What {@link writeReviewCard} did. */
export interface WriteReviewCardResult {
  readonly card: ReviewCard;
  readonly path: string;
  /** Whether bytes were written by this call. */
  readonly wrote: boolean;
  /** Whether the card was already on disk and left exactly as it was. */
  readonly existed: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

/** {@link writeReviewCard}'s input. Every seam has a production default. */
export interface WriteReviewCardRequest {
  readonly repoRoot: string;
  readonly card: ReviewCard;
  readonly fileSystem?: StateFileSystem | undefined;
  readonly diagnostics?: DiagnosticSink | undefined;
}

/**
 * Write one card, and only under `.kept/`.
 *
 * The destination is checked with {@link keptWritePath} before anything is
 * opened, so this function *cannot* write a documentation file, a test file or a
 * source file even if a caller composed a path that pointed at one. That is the
 * same structural guarantee `docsAmendment.propose()` gives, and it is why
 * Property 20's "no write outside `.kept/`" clause is a fact about the code
 * rather than an observation about one run.
 *
 * An existing card is left alone: its `status` may already be `dismissed` by a
 * human, and a mirror pass has no business resetting that.
 */
export function writeReviewCard(request: WriteReviewCardRequest): WriteReviewCardResult {
  const sink = request.diagnostics ?? createDiagnosticSink();
  const fileSystem = request.fileSystem ?? nodeStateFileSystem();
  const card = request.card;
  const path = reviewCardPath(request.repoRoot, card.id);
  const relative = `${REVIEW_CARDS_DIRECTORY_RELATIVE_PATH}/${card.id}.json`;
  const diagnostics: Diagnostic[] = [];

  // Two gates, and both are about the destination rather than the content. A card
  // id is a hash by construction, so an id carrying a separator or a traversal did
  // not come from `reviewCardId` — and a path composed from one is a path this
  // module refuses to open, whether or not it happens to stay inside the fence.
  const destination = isReviewCardId(card.id) ? keptWritePath(request.repoRoot, path) : null;
  if (destination === null) {
    diagnostics.push(
      sink.report({
        code: REVIEW_CARD_DIAGNOSTIC_CODES.writeRefused,
        severity: 'error',
        message:
          `A review card would have been written to '${path}', which is not a well-formed card ` +
          `path under .kept/. Refused before opening anything: held changes are recorded, never ` +
          `applied, so this module has no path that can write outside .kept/.`,
        file: null,
      }),
    );
    return { card, path, wrote: false, existed: false, diagnostics: Object.freeze(diagnostics) };
  }

  let existing: string | null;
  try {
    existing = fileSystem.readFile(path);
  } catch {
    existing = null;
  }
  if (existing !== null) {
    diagnostics.push(
      sink.report({
        code: REVIEW_CARD_DIAGNOSTIC_CODES.exists,
        severity: 'info',
        message:
          `${relative} already exists and was left exactly as it was. Card ids are derived from ` +
          `their content, so re-staging the same change is the same card — and its status may ` +
          `already have been dismissed by a human.`,
        file: relative,
      }),
    );
    const parsed = parseReviewCard(existing, { file: relative, diagnostics: sink });
    return {
      card: parsed ?? card,
      path,
      wrote: false,
      existed: true,
      diagnostics: Object.freeze(diagnostics),
    };
  }

  try {
    fileSystem.ensureDir(reviewCardsDirectory(request.repoRoot));
    fileSystem.writeFile(path, serialiseReviewCard(card));
  } catch (cause) {
    diagnostics.push(
      sink.report({
        code: REVIEW_CARD_DIAGNOSTIC_CODES.writeFailed,
        severity: 'warn',
        message:
          `${relative} could not be written (${describe(cause)}). The change is still held — ` +
          `nothing was applied — but the Ledger will not show it until the card lands.`,
        file: relative,
      }),
    );
    return { card, path, wrote: false, existed: false, diagnostics: Object.freeze(diagnostics) };
  }

  diagnostics.push(
    sink.report({
      code: REVIEW_CARD_DIAGNOSTIC_CODES.written,
      severity: 'info',
      message:
        `${relative} holds a ${card.kind} change to ${card.proposedChanges.length} file` +
        `${card.proposedChanges.length === 1 ? '' : 's'} for promise ${card.promiseId}. ` +
        `Nothing was applied: a human decides.`,
      file: relative,
    }),
  );
  return { card, path, wrote: true, existed: false, diagnostics: Object.freeze(diagnostics) };
}

/** Read one card off disk, or null when it is absent, unreadable or malformed. */
export function readReviewCard(
  repoRoot: string,
  id: string,
  options: {
    readonly fileSystem?: StateFileSystem | undefined;
    readonly diagnostics?: DiagnosticSink | undefined;
  } = {},
): ReviewCard | null {
  const fileSystem = options.fileSystem ?? nodeStateFileSystem();
  const path = reviewCardPath(repoRoot, id);
  const relative = `${REVIEW_CARDS_DIRECTORY_RELATIVE_PATH}/${id}.json`;
  let text: string | null;
  try {
    text = fileSystem.readFile(path);
  } catch (cause) {
    options.diagnostics?.report({
      code: REVIEW_CARD_DIAGNOSTIC_CODES.unreadable,
      severity: 'warn',
      message: `${relative} could not be read (${describe(cause)}), so it is treated as absent.`,
      file: relative,
    });
    return null;
  }
  if (text === null) return null;
  const parsedOptions =
    options.diagnostics === undefined
      ? { file: relative }
      : { file: relative, diagnostics: options.diagnostics };
  return parseReviewCard(text, parsedOptions);
}

/**
 * Every card in the store, sorted by id.
 *
 * This is the seam `kept snapshot` fills its `reviewCards` field from and
 * `/reviews` renders (task 14.6). Unreadable and malformed cards are diagnosed
 * and skipped rather than thrown, because one bad file must not take the
 * snapshot build down over regenerable state.
 */
export function listReviewCards(
  repoRoot: string,
  options: {
    readonly fileSystem?: StateFileSystem | undefined;
    readonly readDirectory?: RepairDirectoryReader | undefined;
    readonly diagnostics?: DiagnosticSink | undefined;
  } = {},
): readonly ReviewCard[] {
  const readDirectory = options.readDirectory ?? nodeRepairDirectoryReader;
  const directory = reviewCardsDirectory(repoRoot);
  let names: readonly string[];
  try {
    names = readDirectory(directory);
  } catch {
    names = [];
  }
  const cards: ReviewCard[] = [];
  for (const name of [...names].sort()) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -'.json'.length);
    if (!isReviewCardId(id)) continue;
    const card = readReviewCard(repoRoot, id, options);
    if (card !== null) cards.push(card);
  }
  return Object.freeze(cards.sort((left, right) => compareIds(left.id, right.id)));
}

/**
 * The production directory reader. An absent or unreadable directory is an empty
 * list, never a throw: a repository that has never produced a card is the normal
 * state, not an error.
 */
export const nodeRepairDirectoryReader: RepairDirectoryReader = (absoluteDirectory) => {
  try {
    return readdirSync(absoluteDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
};

/**
 * An in-memory card store, for tests and for the CLI's own dry runs. `files` is
 * {@link inMemoryStateFileSystem}'s map, so one stub serves the state, the
 * handoff, the source cache and this store — and `readDirectory` derives its
 * listing from that same map rather than keeping a second index of it.
 */
export function inMemoryRepairFileSystem(
  seed: Readonly<Record<string, string>> = {},
): StateFileSystem & {
  readonly files: Map<string, string>;
  readonly readDirectory: RepairDirectoryReader;
} {
  const base = inMemoryStateFileSystem(seed);
  return {
    ...base,
    readDirectory: (absoluteDirectory: string): readonly string[] => {
      const prefix = absoluteDirectory.endsWith('/')
        ? absoluteDirectory
        : `${absoluteDirectory}/`;
      const names: string[] = [];
      for (const path of base.files.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        if (rest.length === 0 || rest.includes('/')) continue;
        names.push(rest);
      }
      return names.sort();
    },
  };
}
