import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LedgerSnapshot } from '@kept/core';
import { SNAPSHOT_SCHEMA_VERSION, parseSnapshot, splitLines } from '@kept/core';
import { describe, expect, it } from 'vitest';

import { SNAPSHOT_FILE_RELATIVE_PATH } from '../src/snapshot.js';

/**
 * The committed snapshot, asserted as an artefact (task 5.6, design §9.1, §9.3,
 * §12.2, R1.3, R2.2, R2.11, R4.14).
 *
 * `apps/ledger/data/ledger.snapshot.json` is the only build output this
 * repository commits, and the whole judge story rests on it: the deployed Ledger
 * reads these bytes and needs no Kane, no Chrome, no credentials and no network.
 * Stage 9 builds the Ledger *from this file*, so if it is wrong, every page is
 * wrong and no unit test elsewhere notices — `snapshot.test.ts` proves the
 * assembler is correct over synthetic states, which is a different claim from "the
 * file in the tree is the honest projection of the real fixture".
 *
 * So this suite reads the committed file off disk and reads
 * `apps/fixture/README.md` off disk beside it, and requires the two to agree line
 * by line. Three things are checked, in the order they can go wrong:
 *
 * 1. **The file is a valid snapshot.** `parseSnapshot` is the schema authority
 *    (§9.1) and runs all five cross-field rules, so a snapshot whose counts,
 *    coverage nullability, evidence references, edge endpoints or freshness
 *    triple disagree with itself fails at import time, naming the path.
 * 2. **Eight promises, each cited verbatim.** Every `citation.text` must be
 *    `readFileSync` of the README split one-based — not a paraphrase, not a stale
 *    copy, not a trimmed one. That is R1.3's whole content, and the admission gate
 *    overwrites the text from disk precisely so this can be asserted rather than
 *    hoped for. The claims block is eight lines, one claim per line, so the cited
 *    line numbers must be eight distinct consecutive lines.
 * 3. **The degradation is the honest one.** At this stage there is no `.context/`
 *    store, so `cover --json` refuses, the enrichment axis is discarded, and the
 *    file must say so: `degraded: true`, a reason of `assurance-status:refused`,
 *    and `provenCoverage` **withheld as null** rather than reported as zero
 *    (R2.11). A snapshot claiming 0% proven would be a claim about the fixture; a
 *    snapshot claiming `null` is a claim about KEPT's knowledge, and only the
 *    second one is true.
 *
 * ## What is deliberately not asserted
 *
 * Byte-identity across rebuilds. `generatedAt` and each diagnostic's `at` are
 * instants by design (§9.1), so two runs of `kept build && kept snapshot` differ
 * in exactly those three fields and in nothing else — which is what re-running the
 * build to produce this file confirmed. Everything a reader could act on is
 * reproducible; the timestamps are not, and pinning them would only pin the clock.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The one cited document, repository-relative POSIX, as every citation is. */
const README = 'apps/fixture/README.md';

/** The eight claim lines of §12.2, one claim per line. */
const CLAIM_LINES = [13, 14, 15, 16, 17, 18, 19, 20] as const;

/**
 * The designed corpus by `test_id` (§3.4). The map is fixed by the fixture
 * register, so a renamed id here would desynchronise every committed NDJSON
 * fixture as well as this file.
 */
const EXPECTED_DESIGNED_TESTS: Readonly<Record<string, string>> = Object.freeze({
  'T-1': 'tests/shop_filter_test.md',
  'T-2': 'tests/home_cta_test.md',
  'T-3': 'tests/cart_subtotal_test.md',
  'T-4': 'tests/checkout_validation_test.md',
  'T-5': 'tests/orders_persist_test.md',
  'T-6': 'tests/settings_currency_test.md',
  'T-7': 'tests/cart_discount_test.md',
  'T-8': 'tests/product_currency_test.md',
});

/** The refusal this stage expects, verbatim from the enrichment vocabulary (§5.3). */
const EXPECTED_DEGRADED_REASON = 'assurance-status:refused';

const readRepoFile = (file: string): string =>
  readFileSync(resolve(REPO_ROOT, file), { encoding: 'utf8' });

/**
 * The committed bytes, through the schema. Parsed once at module scope so a file
 * that does not satisfy §9.1 fails the suite at import with the offending path,
 * which is the same message `kept snapshot` would have printed.
 */
const SNAPSHOT: LedgerSnapshot = parseSnapshot(readRepoFile(SNAPSHOT_FILE_RELATIVE_PATH));

/** The cited document, split exactly as the admission gate splits it. */
const README_LINES = splitLines(readRepoFile(README));

describe('the committed snapshot — schema and provenance', () => {
  it('is a valid snapshot at the current schema version', () => {
    expect(SNAPSHOT.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(SNAPSHOT.generator.kept).toBe('0.0.0');
    expect(Number.isFinite(Date.parse(SNAPSHOT.generatedAt))).toBe(true);
  });

  it('declares the fixture README as its one cited document', () => {
    expect(SNAPSHOT.documents).toHaveLength(1);
    expect(SNAPSHOT.documents[0]?.file).toBe(README);
    expect(SNAPSHOT.documents[0]?.claimCount).toBe(CLAIM_LINES.length);
  });
});

describe('the committed snapshot — eight promises, cited verbatim', () => {
  it('carries exactly eight promises', () => {
    expect(SNAPSHOT.promises).toHaveLength(CLAIM_LINES.length);
    expect(SNAPSHOT.metrics.totalPromises).toBe(CLAIM_LINES.length);
  });

  it('cites one distinct line of the README claims block per promise', () => {
    const lines = SNAPSHOT.promises.map((promise) => promise.citation.line).sort((a, b) => a - b);
    expect(lines).toEqual([...CLAIM_LINES]);
    for (const promise of SNAPSHOT.promises) {
      expect(promise.citation.file).toBe(README);
    }
  });

  it('quotes each cited line verbatim, and the claim is that line', () => {
    for (const promise of SNAPSHOT.promises) {
      const line = README_LINES[promise.citation.line - 1];
      expect(
        line,
        `${README} has no line ${promise.citation.line}, yet promise ${promise.id} cites it.`,
      ).toBeDefined();
      expect(
        promise.citation.text,
        `Promise ${promise.id} quotes text that is not ${README}:${promise.citation.line} ` +
          `verbatim. Disk is the authority on a citation (R1.3).`,
      ).toBe(line);
      // The claim is the line with its list marker removed and nothing else, so a
      // reworded README can never leave a stale claim behind a correct citation.
      expect(line).toBe(`- ${promise.claim}`);
    }
  });

  it('binds all eight designed tests, one per promise', () => {
    const bound = new Map<string, string>();
    for (const promise of SNAPSHOT.promises) {
      const designed = promise.designedTest;
      expect(designed, `Promise ${promise.id} has no designed test.`).not.toBeNull();
      if (designed === null) continue;
      expect(designed.testId).not.toBeNull();
      if (designed.testId !== null) bound.set(designed.testId, designed.path);
    }
    expect(Object.fromEntries([...bound.entries()].sort())).toEqual(EXPECTED_DESIGNED_TESTS);
  });

  it('joins every promise to its document and its designed test', () => {
    const kinds = SNAPSHOT.edges.map((edge) => edge.kind);
    expect(kinds.filter((kind) => kind === 'cites')).toHaveLength(CLAIM_LINES.length);
    expect(kinds.filter((kind) => kind === 'designed')).toHaveLength(CLAIM_LINES.length);
    expect(SNAPSHOT.edges).toHaveLength(2 * CLAIM_LINES.length);

    const documentId = SNAPSHOT.documents[0]?.id;
    for (const promise of SNAPSHOT.promises) {
      expect(
        SNAPSHOT.edges.some(
          (edge) => edge.kind === 'cites' && edge.from === documentId && edge.to === promise.id,
        ),
        `No cites edge reaches promise ${promise.id}.`,
      ).toBe(true);
    }
  });
});

describe('the committed snapshot — the honest degraded state', () => {
  it('records the assurance refusal as the reason the axis was discarded', () => {
    expect(SNAPSHOT.degraded).toBe(true);
    expect(SNAPSHOT.degradedReasons).toContain(EXPECTED_DEGRADED_REASON);
    expect(
      SNAPSHOT.diagnostics.some(
        (diagnostic) => diagnostic.message.includes('refused') && diagnostic.severity === 'warn',
      ),
      'No diagnostic explains the refusal, so /runs would show a degraded chip with no reason.',
    ).toBe(true);
  });

  it('withholds the proven figure rather than reporting zero', () => {
    expect(SNAPSHOT.metrics.designedCount).toBe(CLAIM_LINES.length);
    expect(SNAPSHOT.metrics.designedCoverage).toBe(1);
    expect(SNAPSHOT.metrics.undesignedCount).toBe(0);
    expect(SNAPSHOT.metrics.provenCount).toBe(0);
    expect(
      SNAPSHOT.metrics.provenCoverage,
      'provenCoverage must be null while degraded: a zero would claim the fixture was ' +
        'measured and found unproven, when in fact it was never measured (R2.11).',
    ).toBeNull();
  });

  it('claims no verdict, no evidence and no run it has not earned', () => {
    expect(SNAPSHOT.metrics.staleCount).toBe(CLAIM_LINES.length);
    expect(SNAPSHOT.metrics.redCount).toBe(0);
    for (const promise of SNAPSHOT.promises) {
      expect(promise.verdict).toBe('stale');
      expect(promise.verdictSource).toBeNull();
      expect(promise.repair).toBeNull();
      expect(promise.evidencePackId).toBeNull();
      expect(promise.credits).toBeNull();
      expect(promise.providers).toEqual(['baseline']);
    }
    expect(SNAPSHOT.freshness).toEqual({
      commandFamily: null,
      terminalEventAt: null,
      terminalEventType: null,
    });
    expect(SNAPSHOT.evidence).toEqual([]);
    expect(SNAPSHOT.runs).toEqual([]);
    expect(SNAPSHOT.reviewCards).toEqual([]);
    expect(SNAPSHOT.amendments).toEqual([]);
  });
});
