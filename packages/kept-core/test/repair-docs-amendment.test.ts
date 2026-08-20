import { describe, expect, it } from 'vitest';

import {
  AMENDMENT_DIAGNOSTIC_CODES,
  AMENDMENTS_DIRECTORY_RELATIVE_PATH,
  acceptAmendment,
  amendedPromiseId,
  amendmentId,
  amendmentInterlockHash,
  amendmentPath,
  createDiagnosticSink,
  listAmendments,
  parseDocsAmendment,
  promiseId,
  proposeAmendment,
  rejectAmendment,
  serialiseAmendment,
  toSnapshotAmendment,
  type AtomicRenamer,
  type DocsAmendment,
  type StateFileSystem,
} from '../src/index.js';
import { normaliseClaim, sha256Hex } from '../src/model/ids.js';
import { SnapshotAmendmentSchema } from '../src/model/snapshot.js';

/**
 * Documentation amendments — task 14.4 (design §8.3, §8.4, R7.3, R7.4, R7.6).
 *
 * These are the specific cases; Property 19 is the universal statement. The
 * subject throughout is the real one: the never-true ten-percent-discount claim at
 * `apps/fixture/README.md` line 20, which is what stage 15.5 amends. If a
 * one-line replacement of that line is not exactly what this code does, the
 * demonstration does not exist.
 */

const REPO_ROOT = '/repo';
const README = 'apps/fixture/README.md';
const README_ABS = `${REPO_ROOT}/${README}`;

/** The eight claims, with the never-true one last — line 20 of the real file. */
const CLAIMS: readonly string[] = [
  '- The Home screen links to the Shop screen from its primary call to action.',
  '- The Shop screen lists exactly six coffees and filters them by roast level without a page reload.',
  '- The Product screen shows the price in the currency selected on the Settings screen.',
  '- The Cart screen shows a running subtotal that updates immediately when a quantity changes.',
  '- The Checkout screen refuses to submit while the email field is empty and names the offending field.',
  '- The Orders screen lists every completed order and still lists them after a full page reload.',
  '- The Settings screen keeps the selected currency after a full page reload.',
  '- The Cart screen applies a 10 percent discount automatically when the subtotal exceeds 50 dollars.',
];

/** Lines 13 to 20 carry the claims, one per line, exactly as the fixture does. */
const CLAIM_BLOCK_FIRST_LINE = 13;
const DISCOUNT_LINE = CLAIM_BLOCK_FIRST_LINE + CLAIMS.length - 1;
const DISCOUNT_CLAIM = CLAIMS[7] as string;
const REPLACEMENT = '- The Cart screen shows the order total with no automatic discounts.';
const DISCOUNT_PROMISE = promiseId(README, DISCOUNT_CLAIM);

/**
 * The fixture's own shape: twelve lines of preamble, then the eight claims on lines
 * 13 to 20. The line numbers are the point — the discount claim really is line 20,
 * and a preamble of the wrong length would let a passing test coexist with an
 * off-by-one that ruins the demonstration.
 */
function readmeContent(eol = '\n', trailingNewline = true): string {
  const lines = [
    '# Kepler Coffee',
    '',
    'A coffee subscription shop, and the fixture application KEPT verifies. Every claim in',
    'the block below is cited by exactly one designed Kane test under `tests/`, so the',
    'ledger can say whether that promise still holds.',
    '',
    'Next.js App Router, seven screens, all state in `localStorage` — no backend, no',
    'database, no `fetch`. `npm run dev` serves the shop on http://localhost:3100, which is',
    'the port every designed test navigates to.',
    '',
    '## What Kepler Coffee promises',
    '',
    ...CLAIMS,
  ];
  const body = lines.join(eol);
  return trailingNewline ? `${body}${eol}` : body;
}

interface Store {
  readonly fileSystem: StateFileSystem;
  readonly files: Map<string, string>;
  readonly writes: string[];
  readonly rename: AtomicRenamer;
}

function storeWith(seed: Record<string, string>): Store {
  const files = new Map(Object.entries(seed));
  const writes: string[] = [];
  return {
    files,
    writes,
    fileSystem: {
      readFile: (path) => files.get(path) ?? null,
      ensureDir: () => undefined,
      writeFile: (path, contents) => {
        writes.push(path);
        files.set(path, contents);
      },
    },
    rename: (from, to) => {
      const contents = files.get(from);
      if (contents === undefined) throw new Error(`no staging file at ${from}`);
      files.set(to, contents);
      files.delete(from);
    },
  };
}

function propose(store: Store, overrides: Partial<Parameters<typeof proposeAmendment>[0]> = {}) {
  return proposeAmendment({
    repoRoot: REPO_ROOT,
    promiseId: DISCOUNT_PROMISE,
    citation: { file: README, line: DISCOUNT_LINE, text: DISCOUNT_CLAIM },
    proposedText: REPLACEMENT,
    rationale:
      'Kane asserted the discount at subtotal 62.00 and observed no discount applied. The app ' +
      'implements no discount rule.',
    strategy: 'resultCode740',
    evidenceRef: 'evidence/ev_20260820T184011Z/failure.yaml',
    artifacts: { annotated: '/evidence/ev_20260820T184011Z/annotated.png' },
    at: '2026-08-20T18:41:02.118Z',
    fileSystem: store.fileSystem,
    ...overrides,
  });
}

describe('the fixture’s line 20 is exactly what this code amends', () => {
  it('cites the never-true discount claim and replaces only that line', () => {
    const store = storeWith({ [README_ABS]: readmeContent() });
    const proposed = propose(store);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    expect(proposed.amendment.citation.line).toBe(DISCOUNT_LINE);
    expect(proposed.amendment.currentText).toBe(DISCOUNT_CLAIM);

    const accepted = acceptAmendment({
      repoRoot: REPO_ROOT,
      id: proposed.amendment.id,
      at: '2026-08-20T18:45:00.000Z',
      fileSystem: store.fileSystem,
      rename: store.rename,
    });
    expect(accepted.outcome).toBe('applied');

    const before = readmeContent().split('\n');
    const after = (store.files.get(README_ABS) ?? '').split('\n');
    expect(after).toHaveLength(before.length);
    for (const [index, line] of after.entries()) {
      if (index === DISCOUNT_LINE - 1) expect(line).toBe(REPLACEMENT);
      else expect(line).toBe(before[index]);
    }
  });
});

describe('propose() writes only under .kept/', () => {
  it('stages one file and leaves the document byte-identical', () => {
    const store = storeWith({ [README_ABS]: readmeContent() });
    const sink = createDiagnosticSink();
    const proposed = propose(store, { diagnostics: sink });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;

    expect(store.writes).toEqual([amendmentPath(REPO_ROOT, proposed.amendment.id)]);
    expect(
      store.writes.every((path) =>
        path.startsWith(`${REPO_ROOT}/${AMENDMENTS_DIRECTORY_RELATIVE_PATH}/`),
      ),
    ).toBe(true);
    expect(store.files.get(README_ABS)).toBe(readmeContent());
    expect(sink.entries.map((entry) => entry.code)).toContain(
      AMENDMENT_DIAGNOSTIC_CODES.proposed,
    );
    expect(proposed.amendment.status).toBe('pending');
    expect(proposed.amendment.appliedAt).toBeNull();
  });

  it('parses under the strict snapshot amendment schema', () => {
    const store = storeWith({ [README_ABS]: readmeContent() });
    const proposed = propose(store);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    const parsed = SnapshotAmendmentSchema.parse(toSnapshotAmendment(proposed.amendment));
    expect(parsed.id).toBe(proposed.amendment.id);
    expect(Object.keys(JSON.parse(serialiseAmendment(proposed.amendment)) as object).sort()).toEqual(
      Object.keys(parsed).sort(),
    );
  });

  it('derives the id from the promise and the proposed text, so re-proposal is idempotent', () => {
    expect(amendmentId(DISCOUNT_PROMISE, REPLACEMENT)).toBe(
      `am_${sha256Hex(`${DISCOUNT_PROMISE}\n${REPLACEMENT}`).slice(0, 8)}`,
    );
    const store = storeWith({ [README_ABS]: readmeContent() });
    const first = propose(store);
    const writesAfterFirst = store.writes.length;
    const sink = createDiagnosticSink();
    const second = propose(store, { diagnostics: sink, at: '2026-09-01T00:00:00.000Z' });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.amendment.id).toBe(first.amendment.id);
    expect(second.wrote).toBe(false);
    expect(second.existed).toBe(true);
    // The original createdAt survives: the record is not reset by a second pass.
    expect(second.amendment.createdAt).toBe('2026-08-20T18:41:02.118Z');
    expect(store.writes).toHaveLength(writesAfterFirst);
    expect(sink.entries.map((entry) => entry.code)).toContain(AMENDMENT_DIAGNOSTIC_CODES.exists);
  });

  it('refuses a multi-line replacement, a missing file, a bad line and a no-op', () => {
    const store = storeWith({ [README_ABS]: readmeContent() });
    for (const [overrides, reason, code] of [
      [
        { proposedText: 'one\ntwo' },
        'multiline',
        AMENDMENT_DIAGNOSTIC_CODES.multiline,
      ],
      [
        { citation: { file: 'apps/fixture/GONE.md', line: 1, text: '' } },
        'file-missing',
        AMENDMENT_DIAGNOSTIC_CODES.fileMissing,
      ],
      [
        { citation: { file: README, line: 999, text: '' } },
        'line-out-of-range',
        AMENDMENT_DIAGNOSTIC_CODES.lineOutOfRange,
      ],
      [
        { proposedText: DISCOUNT_CLAIM },
        'unchanged',
        AMENDMENT_DIAGNOSTIC_CODES.unchanged,
      ],
    ] as const) {
      const sink = createDiagnosticSink();
      const result = propose(store, { ...overrides, diagnostics: sink });
      expect(result.ok, reason).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe(reason);
      expect(sink.entries.map((entry) => entry.code)).toContain(code);
    }
    // Nothing was written by any refusal, and the document is untouched.
    expect(store.writes).toEqual([]);
    expect(store.files.get(README_ABS)).toBe(readmeContent());
  });
});

describe('the sha256 interlock', () => {
  it('hashes the normalised claim, so the interlock and promise identity agree', () => {
    expect(amendmentInterlockHash(DISCOUNT_CLAIM)).toBe(sha256Hex(normaliseClaim(DISCOUNT_CLAIM)));
    // A bullet or an indentation change is not a claim change, so it is not stale.
    expect(amendmentInterlockHash(`  * ${DISCOUNT_CLAIM.slice(2)}  `)).toBe(
      amendmentInterlockHash(DISCOUNT_CLAIM),
    );
  });

  it('answers stale with no write when the cited line changed', () => {
    const store = storeWith({ [README_ABS]: readmeContent() });
    const proposed = propose(store);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;

    // Somebody edits the cited line after the proposal.
    const edited = readmeContent().split('\n');
    edited[DISCOUNT_LINE - 1] = '- The Cart screen applies a 25 percent discount.';
    store.files.set(README_ABS, edited.join('\n'));
    const documentBefore = store.files.get(README_ABS) ?? '';

    const sink = createDiagnosticSink();
    const accepted = acceptAmendment({
      repoRoot: REPO_ROOT,
      id: proposed.amendment.id,
      fileSystem: store.fileSystem,
      rename: store.rename,
      diagnostics: sink,
    });

    expect(accepted.outcome).toBe('stale');
    expect(accepted.applied).toBe(false);
    expect(accepted.rebuildRequired).toBe(false);
    expect(accepted.amendment?.status).toBe('stale');
    // Not one byte of the document, and no staging file either.
    expect(store.files.get(README_ABS)).toBe(documentBefore);
    expect([...store.files.keys()].some((path) => path.endsWith('.kept-tmp'))).toBe(false);
    const messages = sink.entries.filter(
      (entry) => entry.code === AMENDMENT_DIAGNOSTIC_CODES.stale,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain('cited line changed since proposal');
  });

  it('answers stale when the cited line no longer exists', () => {
    const store = storeWith({ [README_ABS]: readmeContent() });
    const proposed = propose(store);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    store.files.set(README_ABS, '# Kepler Coffee\n');

    const accepted = acceptAmendment({
      repoRoot: REPO_ROOT,
      id: proposed.amendment.id,
      fileSystem: store.fileSystem,
      rename: store.rename,
    });
    expect(accepted.outcome).toBe('stale');
    expect(store.files.get(README_ABS)).toBe('# Kepler Coffee\n');
  });
});

describe('accept() and reject()', () => {
  it('preserves CRLF endings and a missing trailing newline', () => {
    const content = readmeContent('\r\n', false);
    const store = storeWith({ [README_ABS]: content });
    const proposed = propose(store);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;

    const accepted = acceptAmendment({
      repoRoot: REPO_ROOT,
      id: proposed.amendment.id,
      fileSystem: store.fileSystem,
      rename: store.rename,
    });
    expect(accepted.outcome).toBe('applied');
    const after = store.files.get(README_ABS) ?? '';
    // Still CRLF, still no final newline, and the discount claim is the last line —
    // so the replacement carries the file's missing terminator, not an invented one.
    expect(after.endsWith('\n')).toBe(false);
    expect(after.split('\r\n')).toHaveLength(content.split('\r\n').length);
    expect(after.endsWith(`\r\n${REPLACEMENT}`)).toBe(true);
    expect(after.slice(0, -REPLACEMENT.length)).toBe(content.slice(0, -DISCOUNT_CLAIM.length));
  });

  it('names the successor promise id, because the claim text keys the id', () => {
    const store = storeWith({ [README_ABS]: readmeContent() });
    const proposed = propose(store);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    const accepted = acceptAmendment({
      repoRoot: REPO_ROOT,
      id: proposed.amendment.id,
      fileSystem: store.fileSystem,
      rename: store.rename,
    });
    expect(accepted.successorPromiseId).toBe(promiseId(README, REPLACEMENT));
    expect(accepted.successorPromiseId).not.toBe(DISCOUNT_PROMISE);
    expect(amendedPromiseId(proposed.amendment)).toBe(accepted.successorPromiseId);
    // The record keeps pointing at the promise that was red when it was proposed.
    expect(accepted.amendment?.promiseId).toBe(DISCOUNT_PROMISE);
    expect(accepted.rebuildRequired).toBe(true);
  });

  it('refuses an amendment that is not pending, and one that is not there', () => {
    const store = storeWith({ [README_ABS]: readmeContent() });
    const proposed = propose(store);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    acceptAmendment({
      repoRoot: REPO_ROOT,
      id: proposed.amendment.id,
      fileSystem: store.fileSystem,
      rename: store.rename,
    });
    const documentAfterFirst = store.files.get(README_ABS) ?? '';

    const sink = createDiagnosticSink();
    const again = acceptAmendment({
      repoRoot: REPO_ROOT,
      id: proposed.amendment.id,
      fileSystem: store.fileSystem,
      rename: store.rename,
      diagnostics: sink,
    });
    expect(again.outcome).toBe('not-pending');
    expect(store.files.get(README_ABS)).toBe(documentAfterFirst);
    expect(sink.entries.map((entry) => entry.code)).toContain(
      AMENDMENT_DIAGNOSTIC_CODES.notPending,
    );

    const missing = acceptAmendment({
      repoRoot: REPO_ROOT,
      id: 'am_deadbeef',
      fileSystem: store.fileSystem,
      rename: store.rename,
    });
    expect(missing.outcome).toBe('not-found');
  });

  it('reject() sets rejected and touches nothing else', () => {
    const store = storeWith({ [README_ABS]: readmeContent() });
    const proposed = propose(store);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    const writesBefore = store.writes.length;

    const sink = createDiagnosticSink();
    const rejected = rejectAmendment({
      repoRoot: REPO_ROOT,
      id: proposed.amendment.id,
      fileSystem: store.fileSystem,
      diagnostics: sink,
    });
    expect(rejected.outcome).toBe('rejected');
    expect(rejected.amendment?.status).toBe('rejected');
    expect(store.writes.slice(writesBefore)).toEqual([
      amendmentPath(REPO_ROOT, proposed.amendment.id),
    ]);
    expect(store.files.get(README_ABS)).toBe(readmeContent());
    expect(sink.entries.map((entry) => entry.code)).toContain(AMENDMENT_DIAGNOSTIC_CODES.rejected);

    // And a rejected amendment cannot then be accepted.
    const accepted = acceptAmendment({
      repoRoot: REPO_ROOT,
      id: proposed.amendment.id,
      fileSystem: store.fileSystem,
      rename: store.rename,
    });
    expect(accepted.outcome).toBe('not-pending');
    expect(store.files.get(README_ABS)).toBe(readmeContent());
  });
});

describe('the store', () => {
  it('round-trips canonical bytes and sorts the artefact keys', () => {
    const store = storeWith({ [README_ABS]: readmeContent() });
    const proposed = propose(store, {
      artifacts: {
        screenshot: '/evidence/ev_20260820T184011Z/step-4.png',
        annotated: '/evidence/ev_20260820T184011Z/annotated.png',
      },
    });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    const text = serialiseAmendment(proposed.amendment);
    expect(Object.keys((JSON.parse(text) as { artifacts: object }).artifacts)).toEqual([
      'annotated',
      'screenshot',
    ]);
    expect(parseDocsAmendment(text, { file: 'a.json' })).toEqual(proposed.amendment);
  });

  it('lists what is staged and skips a malformed record', () => {
    const store = storeWith({ [README_ABS]: readmeContent() });
    const proposed = propose(store);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    store.files.set(`${REPO_ROOT}/${AMENDMENTS_DIRECTORY_RELATIVE_PATH}/am_00000000.json`, '{');

    const sink = createDiagnosticSink();
    const listed = listAmendments(REPO_ROOT, {
      fileSystem: store.fileSystem,
      readDirectory: (directory) => {
        const prefix = `${directory}/`;
        return [...store.files.keys()]
          .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
          .map((path) => path.slice(prefix.length));
      },
      diagnostics: sink,
    });
    expect(listed.map((amendment) => amendment.id)).toEqual([proposed.amendment.id]);
    expect(sink.entries.map((entry) => entry.code)).toContain(
      AMENDMENT_DIAGNOSTIC_CODES.malformed,
    );
  });

  it('discards a record whose interlock is not a full sha256', () => {
    const bad: Record<string, unknown> = {
      id: 'am_12345678',
      createdAt: '2026-08-20T18:41:02.118Z',
      status: 'pending',
      promiseId: DISCOUNT_PROMISE,
      citation: { file: README, line: DISCOUNT_LINE, text: DISCOUNT_CLAIM },
      currentText: DISCOUNT_CLAIM,
      proposedText: REPLACEMENT,
      expectedSha256: 'deadbeef',
      rationale: '',
      evidenceRef: null,
      artifacts: {},
      strategy: 'resultCode740',
      appliedAt: null,
    };
    expect(parseDocsAmendment(JSON.stringify(bad))).toBeNull();
    const good: DocsAmendment = {
      ...(bad as unknown as DocsAmendment),
      expectedSha256: amendmentInterlockHash(DISCOUNT_CLAIM),
    };
    expect(parseDocsAmendment(serialiseAmendment(good))).toEqual(good);
  });
});
