/**
 * Identifier derivation — the stability rule (design §3.2, R1.2, Property 1).
 *
 * One decision governs this file: **a promise identifier is keyed on the
 * citation file path plus the normalised claim text, and on nothing else.** Not
 * the line number, not the ordering of claims within the file, not the
 * surrounding document, not the provider that supplied it, not the time.
 *
 * The reason is the ledger's memory. A promise carries its verdict, its
 * evidence pack, its repair annotation and its freshness stamp under its id.
 * Insert a paragraph above a claim in the README and the claim moves down a
 * line; reorder two sections and the claims swap positions. If the id moved with
 * it, every rebuild would orphan the history of a promise that never changed —
 * the graph would silently forget what it had proven, and the one thing KEPT
 * sells is that it does not forget. Conversely, editing the words of a claim, or
 * moving the claim to a different file, *is* a different promise: it must get a
 * different id so it starts undesigned rather than inheriting proof it never
 * earned.
 *
 * Everything here is a pure function of its arguments. `node:crypto`'s SHA-256
 * is unseeded, unsalted and locale-independent, and no map iteration order, no
 * clock and no random source is read, so the same inputs produce the same id in
 * a different process, on a different machine, a year later. That is what makes
 * "stable across rebuilds" a fact about the code rather than a hope.
 */

import { createHash } from 'node:crypto';

/**
 * Graph node id prefixes (design §3.1). Prefixed by type so the Ledger can lane
 * `edges` without a lookup: documents, promises, designed tests, evidence packs.
 */
export const NODE_ID_PREFIXES = Object.freeze({
  /** Document node — one per cited file. */
  document: 'd_',
  /** Promise node. Matches the snapshot's `^p_[0-9a-f]{12}$` (design §9.1). */
  promise: 'p_',
  /** Designed-test node — one per `*_test.md`. */
  designedTest: 't_',
  /** Evidence-pack node, suffixed with a stamp rather than a hash. */
  evidence: 'ev_',
} as const);

/** Hash width, in hex characters. 12 hex is 48 bits (design §3.2). */
export const ID_HASH_LENGTH = 12;

/** `^p_[0-9a-f]{12}$` and friends, built once from the prefix table. */
const HASH_ID_PATTERN = new RegExp(`^[0-9a-f]{${ID_HASH_LENGTH}}$`);

/**
 * Characters kept verbatim in an evidence id. Evidence ids are `ev_<stamp>`
 * rather than `ev_<hash>` because the stamp is human-readable in a committed
 * pack path (`/evidence/ev_20260820T184011Z/`) and reviewers navigate by it.
 */
const EVIDENCE_STAMP_ALLOWED = /[^A-Za-z0-9._-]+/g;

/**
 * The same rule without the `g` flag, for `test()`. A global regex carries
 * `lastIndex` between calls, so testing with one makes a pure-looking guard
 * answer differently on the second call with the same input.
 */
const EVIDENCE_STAMP_ILLEGAL = /[^A-Za-z0-9._-]/;

/**
 * SHA-256 of a UTF-8 string, lowercase hex. Exported because the same primitive
 * is the staleness interlock for a documentation amendment (design §10.3 keeps
 * `expectedSha256` of the cited line), and one hashing site beats two.
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Normalise a repository-relative path into the form the graph keys on.
 *
 * - Backslashes become `/`, so a Windows-authored `@verifies` tag and a
 *   POSIX-authored one name the same document.
 * - Surrounding whitespace is trimmed: a stray space in a hand-written tag is a
 *   typing artefact, not a different file.
 * - Repeated separators collapse and leading `./` segments are dropped, so
 *   `./apps//fixture/README.md` keys the same as `apps/fixture/README.md`.
 * - A trailing separator is dropped, except from the single-character path `/`.
 * - Case is **preserved**. `README.md` and `readme.md` are two different files
 *   on the filesystems this repo is developed and built on, and folding case
 *   would merge two genuinely distinct citations.
 *
 * It does not reject absolute paths or `..` segments. That is the citation
 * admission gate's job (§3.3, task 3.3), which can report a diagnostic; a pure
 * id function silently rewriting a bad path would hide the problem.
 */
export function toPosix(file: string): string {
  if (typeof file !== 'string') return '';
  const slashed = file.replace(/\\/g, '/').trim();
  const collapsed = slashed.replace(/\/{2,}/g, '/');
  const withoutDotSegments = collapsed.replace(/^(?:\.\/)+/, '');
  if (withoutDotSegments.length <= 1) return withoutDotSegments;
  return withoutDotSegments.replace(/\/+$/, '');
}

/**
 * Rebase an absolute path onto the repository root, so it keys the graph.
 *
 * The graph keys every document on a **repository-relative** POSIX path, and so
 * does every `covers:` glob and every `designedTest.path`. Kane, however, reports
 * absolute paths: both `testrun_plan.members[].path` and
 * `testrun_member_end.path` arrive as `/Users/…/KEPT/tests/home_cta_test.md`
 * against a repository whose graph says `tests/home_cta_test.md`. Comparing the
 * two forms directly matches nothing, which reads as "no promise is designed by
 * this member" — a silent empty radius rather than an error.
 *
 * So this is the one conversion on the boundary. A path already relative is
 * returned unchanged, which keeps it idempotent and keeps a fixture written in
 * either form working. A path under a *different* root is left absolute rather
 * than being forced to fit: a member outside the repository is a fact worth
 * seeing, not something to rewrite.
 */
export function toRepoRelative(file: string, repoRoot?: string | undefined): string {
  const path = toPosix(file);
  if (repoRoot === undefined) return path;
  const root = toPosix(repoRoot).replace(/\/+$/, '');
  if (root.length === 0) return path;
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

/** Zero-width and invisible formatting characters JS `\s` does not cover. */
const ZERO_WIDTH = /[\u200b\u200c\u200d\u2060]/g;

const LEADING_WHITESPACE = /^\s+/;
/** `>` blockquote markers, however many are nested. */
const BLOCKQUOTE_MARKER = /^>+/;
/** ATX heading markers, `#` to `######`, only when a space follows. */
const HEADING_MARKER = /^#{1,6}(?=\s)/;
/** `-`, `*`, `+` bullets, only when whitespace follows. */
const BULLET_MARKER = /^[-*+](?=\s)/;
/** `1.` / `1)` ordered-list numbering, only when whitespace follows. */
const ORDERED_MARKER = /^\d{1,9}[.)](?=\s)/;
/** GitHub task-list checkbox, after a bullet has already been removed. */
const CHECKBOX_MARKER = /^\[[ xX]\](?=\s|$)/;

/** In stripping order; at most one marker is removed per pass. */
const LEADING_MARKERS: readonly RegExp[] = [
  BLOCKQUOTE_MARKER,
  HEADING_MARKER,
  ORDERED_MARKER,
  BULLET_MARKER,
  CHECKBOX_MARKER,
];

/**
 * Peel leading markdown structure off a cited line: `> - [ ] 1. claim` and
 * `## claim` both reduce to `claim`. Bounded, and terminates as soon as a pass
 * removes nothing, so it is linear in the marker run and cannot spin.
 */
function stripLeadingDecoration(input: string): string {
  let text = input;
  for (let pass = 0; pass < 32; pass += 1) {
    const before = text;
    text = text.replace(LEADING_WHITESPACE, '');
    for (const marker of LEADING_MARKERS) {
      const stripped = text.replace(marker, '');
      if (stripped !== text) {
        text = stripped;
        break;
      }
    }
    if (text === before) break;
  }
  return text;
}

/**
 * Reduce a raw cited line to the claim the graph keys on.
 *
 * Every decision below is deliberate, because each one either widens or narrows
 * what counts as "the same promise", and both mistakes are expensive: too wide
 * merges two distinct claims into one id, too narrow orphans a promise's history
 * on a cosmetic edit.
 *
 * 1. **Unicode: normalised to NFC.** `é` written as one code point and as `e` +
 *    U+0301 render identically and are the same claim to every reader; editors
 *    and paste buffers disagree about which they emit. NFC is the form the web
 *    and most editors already prefer, and `String#normalize` is driven by the
 *    Unicode data tables rather than by any locale, so it stays deterministic
 *    across processes.
 * 2. **Zero-width characters removed.** U+200B–U+200D and U+2060 are invisible;
 *    a claim that gained one from a copy-paste is not a new claim. U+FEFF is
 *    already whitespace to JS `\s` and collapses in step 4.
 * 3. **Leading markdown structure removed** — blockquote `>`, ATX heading `#`,
 *    bullets `-`/`*`/`+`, ordered `1.`/`1)`, task checkbox `[ ]`/`[x]`, in any
 *    nesting. These express *where* the claim sits in the document, and moving a
 *    claim between a bullet list and a heading, or renumbering the list above it,
 *    is the same class of edit as moving it to a different line. A marker is only
 *    stripped when whitespace follows it, which is the discriminator that keeps
 *    `3.5x faster checkout` intact: `3.` there is the value being claimed, not
 *    numbering. (This is a deliberate deviation from the single character-class
 *    regex sketched in design §3.2, which would have eaten the leading digits of
 *    any claim that opens with a number and merged `3.5x faster` with
 *    `9.9x faster` into one id. Same intent, no collision.)
 * 4. **Internal whitespace collapsed to one space, then trimmed.** This is what
 *    makes the id survive a reflow: rewrapping a paragraph, converting tabs to
 *    spaces, and CRLF against LF all change the whitespace and nothing else. A
 *    line read from a CRLF file keeps a trailing `\r` after `split('\n')`; the
 *    collapse plus trim removes it, so a repository checked out with either
 *    ending derives identical ids. A file with no trailing newline needs no
 *    special handling — the claim is the same characters either way. A cited line
 *    that is **only whitespace** normalises to the empty string, which is a
 *    legitimate (if useless) claim: it gets an id like anything else, and it is
 *    the admission gate's business (§3.3) whether an empty claim is worth
 *    admitting. Nothing here throws.
 * 5. **Case preserved.** Rewriting `Cart updates` to `cart updates` is an edit to
 *    the words of the claim, and the words are the promise. Folding case would
 *    also merge two claims that a careful author distinguished.
 * 6. **Punctuation and inline markdown preserved.** `**subtotal** updates` and
 *    `subtotal updates` stay two different claims. Stripping `*`, `_` and
 *    backticks inside the text would be guessing at emphasis versus literal
 *    asterisks, and a wrong guess merges distinct claims — the failure direction
 *    that loses data. Trailing punctuation is likewise kept: dropping a full stop
 *    would make `Checkout is fast.` and `Checkout is fast` one promise, which
 *    they may well be, but not at the cost of a normaliser that guesses.
 *
 * Total over every string, including the empty one. Never throws.
 */
export function normaliseClaim(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) return '';
  const unicode = raw.normalize('NFC').replace(ZERO_WIDTH, '');
  return stripLeadingDecoration(unicode).replace(/\s+/g, ' ').trim();
}

/**
 * The promise identifier: `p_` plus 48 bits of SHA-256 over the citation file
 * and the normalised claim (design §3.2, R1.2).
 *
 * The key is `${toPosix(file)}\n${normaliseClaim(claim)}`. That encoding is
 * unambiguous even though it joins two free-text fields with a delimiter,
 * because {@link normaliseClaim} collapses all whitespace and therefore can
 * never return a string containing a newline: the *last* newline in the key
 * always separates the path from the claim, so no pair of distinct inputs can
 * forge another pair's key.
 *
 * The line number is deliberately absent. So is any notion of position,
 * ordering, or which document node the claim was discovered under.
 *
 * Collision risk at 48 bits over the few dozen promises this system holds is not
 * worth guarding (design §3.2), and the merge path treats a collision as a
 * same-promise merge, which is the safe direction — two promises briefly sharing
 * a verdict, rather than a promise losing its history.
 */
export function promiseId(citationFile: string, rawClaim: string): string {
  const key = `${toPosix(citationFile)}\n${normaliseClaim(rawClaim)}`;
  return NODE_ID_PREFIXES.promise + sha256Hex(key).slice(0, ID_HASH_LENGTH);
}

/**
 * Document node id: `d_` plus 48 bits over the normalised path. One node per
 * cited file, lane 0 of the Ledger graph (design §9.1 `documents`).
 */
export function documentId(file: string): string {
  return NODE_ID_PREFIXES.document + sha256Hex(toPosix(file)).slice(0, ID_HASH_LENGTH);
}

/**
 * Designed-test node id: `t_` plus 48 bits over the normalised `*_test.md` path.
 *
 * Keyed on the path, never on Kane's `test_id`: design §3.4 makes frontmatter
 * `test_id` a cache and `testrun_plan.members[].test_id` the authority, so a
 * plan that renumbers `T-3` to `T-4` must not re-key the node.
 */
export function designedTestId(path: string): string {
  return NODE_ID_PREFIXES.designedTest + sha256Hex(toPosix(path)).slice(0, ID_HASH_LENGTH);
}

/**
 * Evidence-pack node id: `ev_` plus a stamp, not a hash, so a reviewer reading
 * `/evidence/ev_20260820T184011Z/` in the committed tree can find it.
 *
 * A stamp already carrying the prefix is accepted as-is, which is what makes
 * this idempotent when the caller passes a directory name Kane produced.
 * Characters outside `[A-Za-z0-9._-]` become `-`, so the id is path-safe on
 * every platform and safe in a URL.
 */
export function evidenceId(stamp: string): string {
  const raw = typeof stamp === 'string' ? stamp.trim() : '';
  const withoutPrefix = raw.startsWith(NODE_ID_PREFIXES.evidence)
    ? raw.slice(NODE_ID_PREFIXES.evidence.length)
    : raw;
  const safe = withoutPrefix.replace(EVIDENCE_STAMP_ALLOWED, '-').replace(/-{2,}/g, '-');
  return NODE_ID_PREFIXES.evidence + safe;
}

function isHashId(value: unknown, prefix: string): boolean {
  return (
    typeof value === 'string' &&
    value.startsWith(prefix) &&
    HASH_ID_PATTERN.test(value.slice(prefix.length))
  );
}

/** Boundary guard: `^p_[0-9a-f]{12}$`, the snapshot's promise-id rule (§9.1). */
export function isPromiseId(value: unknown): value is string {
  return isHashId(value, NODE_ID_PREFIXES.promise);
}

/** Boundary guard: `^d_[0-9a-f]{12}$`. */
export function isDocumentId(value: unknown): value is string {
  return isHashId(value, NODE_ID_PREFIXES.document);
}

/** Boundary guard: `^t_[0-9a-f]{12}$`. */
export function isDesignedTestId(value: unknown): value is string {
  return isHashId(value, NODE_ID_PREFIXES.designedTest);
}

/** Boundary guard: `^ev_` plus a non-empty path-safe stamp. */
export function isEvidenceId(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith(NODE_ID_PREFIXES.evidence)) return false;
  const stamp = value.slice(NODE_ID_PREFIXES.evidence.length);
  return stamp.length > 0 && !EVIDENCE_STAMP_ILLEGAL.test(stamp);
}

/**
 * Whether a value is any graph node id. Used by the snapshot's edge-endpoint
 * rule (§9.1) to reject an edge naming something that is not a node at all.
 */
export function isNodeId(value: unknown): value is string {
  return (
    isPromiseId(value) || isDocumentId(value) || isDesignedTestId(value) || isEvidenceId(value)
  );
}
