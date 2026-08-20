/**
 * The line-level diff — design §10.9, §2.2, R7.5.
 *
 * A hand-rolled unified diff over lines, and the smallest thing that can honestly
 * render a documentation amendment. §10.9 sizes it at roughly sixty lines and an LCS
 * over at most two hundred lines, and both numbers are the design being specific
 * rather than approximate:
 *
 * - **No Shiki, and no highlighter of any kind.** The dependency budget of §2.2 is
 *   closed at nine packages and asserted by `test/animejs-import-scan.test.ts`, so a
 *   highlighter is not a decision this file gets to make. It also would not help: the
 *   docs-lie diff is a sentence of English prose, and there is no grammar in
 *   `The Cart screen applies a 10 percent discount automatically.` for a highlighter
 *   to colour. Shiki is recorded as a droppable upgrade (§18), not a gap.
 * - **LCS, not a naive line-by-line walk.** A naive comparison of two texts of
 *   unequal length reports every line after the first change as changed, which for a
 *   README with one amended bullet would paint the rest of the file red. The LCS keeps
 *   the unchanged lines as context, which is the whole reason a reader trusts the two
 *   lines that did change.
 * - **The cap is a real bound, not a guard.** The table is O(before × after) in memory,
 *   and 200×200 is forty thousand small integers — instant. Above that this file stops
 *   computing an alignment and reports the two texts as one replacement, which is
 *   honest about what it did rather than quietly spending a second on a table nobody
 *   asked for. An amendment cites **one line** (§8.3), so the cap is never approached
 *   on the path this exists for; it bounds the review-card diffs Kane renders, which
 *   have no size contract at all.
 *
 * Pure, total, and deliberately DOM-free. The root `tsconfig.json` type-checks
 * `apps/ledger/lib/**` with **no DOM lib**, so a module that touched the document
 * would have to be a `.tsx` and leave that program — `lib/motion.tsx` is the one
 * module that genuinely has to. This one does not, so it stays where the arithmetic
 * can be proven in a Node test and shared verbatim with the browser.
 *
 * The gutter numbers are part of the row rather than something `DiffView` counts.
 * §10.9 asks for `--text-200` gutter line numbers, and a component that derived them
 * by counting rendered rows would number a deletion and the addition replacing it as
 * two different lines of the same file. Carrying both sides' numbers on the row makes
 * the deletion's number belong to the *before* text and the addition's to the *after*,
 * which is what a unified diff means and what lets a reader open the file at that
 * line and see the quoted bytes.
 */

/** What one row of a rendered diff is. §10.9's three kinds, and no fourth. */
export type DiffRowKind = 'ctx' | 'del' | 'add';

/** One row: its kind, its bytes, and its line number on each side. */
export interface DiffRow {
  readonly kind: DiffRowKind;
  /** The line, verbatim. Never trimmed — leading space is part of a document. */
  readonly text: string;
  /** 1-based line in the *before* text, or null for an addition. */
  readonly beforeLine: number | null;
  /** 1-based line in the *after* text, or null for a deletion. */
  readonly afterLine: number | null;
}

/** The LCS bound of §10.9. Above it, the two texts are reported as one replacement. */
export const MAX_DIFF_LINES = 200;

/** The marker each kind carries, so the row reads as a diff with colour removed. */
export const DIFF_MARKERS: Readonly<Record<DiffRowKind, string>> = {
  ctx: '\u00A0',
  del: '-',
  add: '+',
};

/** How each kind is named to a screen reader, since a marker glyph is not a word. */
export const DIFF_KIND_WORDS: Readonly<Record<DiffRowKind, string>> = {
  ctx: 'unchanged',
  del: 'removed',
  add: 'added',
};

/** Options for {@link diffLines}. */
export interface DiffOptions {
  /**
   * The line number the first line of both texts sits at.
   *
   * An amendment quotes one line out of the middle of a document, so numbering it
   * `1` would print a number that is wrong in the one place the product's
   * credibility rests on being checkable. `/amendments` passes `citation.line`.
   */
  readonly firstLine?: number;
}

/**
 * The unified diff of two texts, line by line.
 *
 * Splitting on `\n` and nothing else is deliberate: the amendment machinery
 * preserves the original line endings on write (§8.4 step 5), so a `\r` that is in
 * the file is in the line, and stripping it here would render bytes the file does
 * not contain. A trailing newline therefore yields a final empty line on both
 * sides, which the LCS pairs as context and the reader never notices.
 */
export function diffLines(
  before: string,
  after: string,
  options: DiffOptions = {},
): readonly DiffRow[] {
  const first = options.firstLine ?? 1;
  const a = before.split('\n');
  const b = after.split('\n');

  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return Object.freeze([
      ...a.map((text, index) => row('del', text, first + index, null)),
      ...b.map((text, index) => row('add', text, null, first + index)),
    ]);
  }

  // Suffix LCS lengths: table[i][j] is the LCS of a[i…] and b[j…]. Built backwards
  // so the forward walk below can choose by lookahead and emit rows in file order.
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const current = table[i] as number[];
      const next = table[i + 1] as number[];
      current[j] =
        a[i] === b[j]
          ? (next[j + 1] as number) + 1
          : Math.max(next[j] as number, current[j + 1] as number);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push(row('ctx', a[i] as string, first + i, first + j));
      i += 1;
      j += 1;
      continue;
    }
    // Ties go to the deletion, so a replaced line reads `-` then `+` — the order a
    // reader expects, and the order that makes the before/after gutter pair legible.
    const keepDeleting = (table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0);
    if (keepDeleting) {
      rows.push(row('del', a[i] as string, first + i, null));
      i += 1;
    } else {
      rows.push(row('add', b[j] as string, null, first + j));
      j += 1;
    }
  }
  while (i < a.length) {
    rows.push(row('del', a[i] as string, first + i, null));
    i += 1;
  }
  while (j < b.length) {
    rows.push(row('add', b[j] as string, null, first + j));
    j += 1;
  }
  return Object.freeze(rows);
}

function row(
  kind: DiffRowKind,
  text: string,
  beforeLine: number | null,
  afterLine: number | null,
): DiffRow {
  return { kind, text, beforeLine, afterLine };
}

/** How many rows of each kind a diff carries. For headings and for assertions. */
export function diffCounts(rows: readonly DiffRow[]): Readonly<Record<DiffRowKind, number>> {
  return {
    ctx: rows.filter((entry) => entry.kind === 'ctx').length,
    del: rows.filter((entry) => entry.kind === 'del').length,
    add: rows.filter((entry) => entry.kind === 'add').length,
  };
}

/**
 * The unified-diff text of a set of rows.
 *
 * Not used to render — `DiffView` renders the rows — but it makes a row list
 * inspectable as one value in a test failure message, and it is the inverse
 * {@link parseUnifiedDiff} is checked against.
 */
export function unifiedText(rows: readonly DiffRow[]): string {
  return rows.map((entry) => `${DIFF_MARKERS[entry.kind].trim()}${entry.text}`).join('\n');
}

/**
 * Rows out of a unified diff **Kane already rendered**.
 *
 * A review card carries `proposedChanges[].diff` as a finished string (§8.2), not as a
 * before/after pair, so `/reviews` has nothing to run the LCS over — the alignment was
 * decided by whoever produced the patch. Reading it back into rows lets one component
 * render both surfaces, which is why `DiffView` takes rows rather than two texts.
 *
 * Hunk headers (`@@`), file headers (`---`, `+++`) and everything else that is not a
 * `+`, `-` or space-prefixed body line are dropped rather than rendered as context: a
 * `@@ -3,7 +3,7 @@` shown as an unchanged line of the document would be the ledger
 * quoting something the document does not contain. Their numbers are not trusted
 * either; the gutter counts from `firstLine`, because a header KEPT did not compute is
 * a number KEPT cannot vouch for.
 */
export function parseUnifiedDiff(diff: string, options: DiffOptions = {}): readonly DiffRow[] {
  const first = options.firstLine ?? 1;
  const rows: DiffRow[] = [];
  let beforeAt = first;
  let afterAt = first;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue;
    if (line.startsWith('+')) {
      rows.push(row('add', line.slice(1), null, afterAt));
      afterAt += 1;
    } else if (line.startsWith('-')) {
      rows.push(row('del', line.slice(1), beforeAt, null));
      beforeAt += 1;
    } else {
      const text = line.startsWith(' ') ? line.slice(1) : line;
      rows.push(row('ctx', text, beforeAt, afterAt));
      beforeAt += 1;
      afterAt += 1;
    }
  }
  return Object.freeze(rows);
}
