/**
 * `lib/diff.ts` — design §10.9, §2.2, R7.5.
 *
 * The alignment is the whole value of this module, so it is asserted as an alignment
 * rather than as a row count. Three things would each look like a working diff from a
 * distance and each destroy the surface it feeds:
 *
 * 1. **A naive walk instead of an LCS.** Two texts of unequal length would report every
 *    line after the first change as changed, painting a whole README red for one amended
 *    bullet. The insertion and deletion cases below fail on that, because they require
 *    the surrounding lines to survive as context.
 * 2. **Gutter numbers derived from row position.** A deletion and the addition replacing
 *    it are the *same* line of the document from two sides, and numbering them 1 and 2
 *    would print a number the file contradicts — on the one page whose credibility rests
 *    on being checkable against the file.
 * 3. **Any trimming at all.** A document's leading space is part of its bytes, and
 *    `\r` survives an amendment write (§8.4 step 5). A diff that tidied either could not
 *    be checked against the file it quotes.
 *
 * No DOM anywhere: the module is pure, so these are arithmetic assertions and the module
 * stays in the root program's no-DOM `lib` (see its header).
 */

import { describe, expect, it } from 'vitest';

import {
  DIFF_KIND_WORDS,
  DIFF_MARKERS,
  MAX_DIFF_LINES,
  diffCounts,
  diffLines,
  parseUnifiedDiff,
  unifiedText,
  type DiffRow,
} from '../lib/diff.js';

/** `kind:text` per row, the compact spelling every assertion below reads. */
function shape(rows: readonly DiffRow[]): string[] {
  return rows.map((row) => `${row.kind}:${row.text}`);
}

/** `before/after` per row, so the gutter pairing is legible in a failure. */
function gutters(rows: readonly DiffRow[]): string[] {
  return rows.map((row) => `${row.beforeLine ?? '-'}/${row.afterLine ?? '-'}`);
}

const CLAIM =
  '- The Cart screen applies a 10 percent discount automatically when the subtotal ' +
  'exceeds 50 dollars.';
const REPLACEMENT = '- The Cart screen shows the order total with no automatic discounts.';

describe('diffLines aligns two texts', () => {
  it('reports identical texts as all context', () => {
    const rows = diffLines('one\ntwo', 'one\ntwo');
    expect(shape(rows)).toEqual(['ctx:one', 'ctx:two']);
    expect(diffCounts(rows)).toEqual({ ctx: 2, del: 0, add: 0 });
  });

  it('reports the single-line amendment of §8.3 as one deletion and one addition', () => {
    const rows = diffLines(CLAIM, REPLACEMENT, { firstLine: 20 });
    expect(shape(rows)).toEqual([`del:${CLAIM}`, `add:${REPLACEMENT}`]);
    // Both sides are line 20 of the document, because it is one line seen twice.
    expect(gutters(rows)).toEqual(['20/-', '-/20']);
  });

  it('puts the deletion before the addition, so a replacement reads in order', () => {
    const rows = diffLines('was', 'now');
    expect(rows[0]?.kind).toBe('del');
    expect(rows[1]?.kind).toBe('add');
  });

  it('keeps unchanged lines as context around an insertion', () => {
    const rows = diffLines('a\nb\nc', 'a\nb\nnew\nc');
    expect(shape(rows)).toEqual(['ctx:a', 'ctx:b', 'add:new', 'ctx:c']);
    // The trailing `c` is line 3 before and line 4 after — the whole point of an LCS.
    expect(gutters(rows)).toEqual(['1/1', '2/2', '-/3', '3/4']);
  });

  it('keeps unchanged lines as context around a deletion', () => {
    const rows = diffLines('a\ngone\nb', 'a\nb');
    expect(shape(rows)).toEqual(['ctx:a', 'del:gone', 'ctx:b']);
    expect(gutters(rows)).toEqual(['1/1', '2/-', '3/2']);
  });

  it('finds the longest common subsequence, not merely a common prefix', () => {
    const rows = diffLines('a\nb\nc\nd\ne', 'a\nx\nc\ny\ne');
    // `a`, `c` and `e` survive as context; only the two changed lines move.
    expect(shape(rows)).toEqual(['ctx:a', 'del:b', 'add:x', 'ctx:c', 'del:d', 'add:y', 'ctx:e']);
    expect(diffCounts(rows)).toEqual({ ctx: 3, del: 2, add: 2 });
  });

  it('handles an empty side in each direction', () => {
    expect(shape(diffLines('', 'added'))).toEqual(['del:', 'add:added']);
    expect(shape(diffLines('removed', ''))).toEqual(['del:removed', 'add:']);
    expect(shape(diffLines('', ''))).toEqual(['ctx:']);
  });

  it('numbers from firstLine on both sides', () => {
    const rows = diffLines('a\nb', 'a\nb', { firstLine: 41 });
    expect(gutters(rows)).toEqual(['41/41', '42/42']);
  });

  it('preserves every byte: leading space, trailing space and a carriage return', () => {
    const before = '  indented  ';
    const after = 'plain\r';
    const rows = diffLines(before, after);
    expect(rows[0]?.text).toBe(before);
    expect(rows[1]?.text).toBe(after);
  });

  it('treats a trailing newline as a final empty line on both sides', () => {
    const rows = diffLines('one\n', 'one\n');
    expect(shape(rows)).toEqual(['ctx:one', 'ctx:']);
  });

  it('reports one wholesale replacement above the LCS bound', () => {
    const long = Array.from({ length: MAX_DIFF_LINES + 1 }, (_value, index) => `l${index}`).join(
      '\n',
    );
    const rows = diffLines(long, 'one line');
    // No alignment was attempted, and the rows say so: every before line, then every
    // after line. Nothing is silently dropped and nothing pretends to be context.
    expect(diffCounts(rows)).toEqual({ ctx: 0, del: MAX_DIFF_LINES + 1, add: 1 });
  });

  it('stays within the bound for a diff at exactly the cap', () => {
    const lines = Array.from({ length: MAX_DIFF_LINES }, (_value, index) => `l${index}`);
    const changed = [...lines];
    changed[100] = 'changed';
    const rows = diffLines(lines.join('\n'), changed.join('\n'));
    expect(diffCounts(rows)).toEqual({ ctx: MAX_DIFF_LINES - 1, del: 1, add: 1 });
  });

  it('is a pure function of its inputs', () => {
    expect(diffLines('a\nb', 'a\nc')).toEqual(diffLines('a\nb', 'a\nc'));
  });
});

describe('parseUnifiedDiff reads a patch Kane already rendered', () => {
  it('reads markers into kinds and numbers each side independently', () => {
    const rows = parseUnifiedDiff(' context\n-was\n+now\n more');
    expect(shape(rows)).toEqual(['ctx:context', 'del:was', 'add:now', 'ctx:more']);
    expect(gutters(rows)).toEqual(['1/1', '2/-', '-/2', '3/3']);
  });

  it('drops hunk and file headers rather than rendering them as document lines', () => {
    const rows = parseUnifiedDiff(
      ['--- a/tests/cart_subtotal_test.md', '+++ b/tests/cart_subtotal_test.md', '@@ -3,4 +3,4 @@', '-a', '+b'].join(
        '\n',
      ),
    );
    expect(shape(rows)).toEqual(['del:a', 'add:b']);
  });

  it('reads an unprefixed line as context, which is how summaries arrive', () => {
    expect(shape(parseUnifiedDiff('bare'))).toEqual(['ctx:bare']);
  });

  it('reads an empty patch as one empty context row', () => {
    const rows = parseUnifiedDiff('');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toBe('');
  });

  it('round-trips through unifiedText for the shapes a card carries', () => {
    const rows = diffLines('a\nb\nc', 'a\nx\nc');
    expect(shape(parseUnifiedDiff(unifiedText(rows)))).toEqual(shape(rows));
  });
});

describe('the vocabulary a row is rendered with', () => {
  it('names each kind in words, so colour is never the only channel (R10.5)', () => {
    expect(DIFF_KIND_WORDS).toEqual({ ctx: 'unchanged', del: 'removed', add: 'added' });
  });

  it('marks deletions and additions with the two glyphs a diff is read by', () => {
    expect(DIFF_MARKERS.del).toBe('-');
    expect(DIFF_MARKERS.add).toBe('+');
    // Context takes a non-breaking space so the grid cell keeps its width.
    expect(DIFF_MARKERS.ctx.trim()).toBe('');
  });
});
