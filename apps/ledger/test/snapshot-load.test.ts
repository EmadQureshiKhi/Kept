/**
 * Build-time snapshot loading — task 9.1, R8.6, R8.8.
 *
 * Three claims, in the order they matter:
 *
 * 1. The committed snapshot loads, and what it loads is the honest current state
 *    of the repository — degraded, with the proven figure withheld rather than
 *    reported as zero.
 * 2. An invalid snapshot throws with the offending **field path** in the message,
 *    which is the whole of R8.8. Every cross-field rule of §9.1 is exercised
 *    through the same funnel the build uses, `loadSnapshot`, rather than through
 *    the schema directly — a wrapper that swallowed a path would pass a
 *    schema-level test and fail the requirement.
 * 3. Nothing under `apps/ledger/lib` can start a subprocess (R8.6). Asserted by
 *    reading the source rather than by trusting the review, and through the shared
 *    scan helper so there is one file walker in this suite and not two.
 */

import { describe, expect, it } from 'vitest';

import raw from '../data/ledger.snapshot.json' with { type: 'json' };
import { SNAPSHOT_PATH, loadSnapshot, snapshot } from '../lib/snapshot.js';
import { REPO_ROOT, scanLedger } from './_scan.js';

/** A structurally-typed deep clone, so a mutation cannot reach the real import. */
function clone(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
}

/** The message `loadSnapshot` threw for a document, or a failure if it did not. */
function messageFor(document: unknown): string {
  try {
    loadSnapshot(document);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('loadSnapshot accepted a document it should have rejected.');
}

describe('the committed snapshot', () => {
  it('validates at import time', () => {
    expect(snapshot.schemaVersion).toBe(1);
    // Thirteen since task 26.1: the fixture's eight claims plus the five this
    // repository's own root README makes about itself (design §23.1, R19.1).
    expect(snapshot.promises).toHaveLength(13);
    expect(snapshot.metrics.totalPromises).toBe(13);
  });

  it('carries every promise cited to a real file and line', () => {
    // Two cited documents rather than one, and the Ledger has to render both. The
    // set is asserted rather than a single path, because a promise cited to a third
    // file would mean the graph grew a source nothing configured.
    const cited = new Set(snapshot.promises.map((promise) => promise.citation.file));
    expect([...cited].sort()).toEqual(['README.md', 'apps/fixture/README.md']);
    for (const promise of snapshot.promises) {
      expect(promise.citation.line).toBeGreaterThanOrEqual(1);
      expect(promise.citation.text.trim()).not.toBe('');
    }
  });

  it('either reports a proven figure or names a reason for withholding it', () => {
    // Whether the assurance axis was delivered moves with Kane, so the *invariant* is
    // asserted rather than the state. It ran both ways in this repository's history:
    // degraded with `assurance-status:refused` while `cover --json` refused on a
    // replay pack, and clean once §5.3.0 moved the axes to `cover gaps`. What R2.11
    // requires either way is that a withheld figure comes with a reason and a
    // reported one comes with none.
    expect(snapshot.metrics.provenCoverage === null).toBe(snapshot.degraded);
    if (snapshot.degraded) {
      expect(snapshot.degradedReasons.length).toBeGreaterThan(0);
      // R9.13: the coverage axes are withheld with the figure, never zeroed.
      expect(snapshot.coverageAxes ?? null).toBeNull();
    } else {
      expect(snapshot.degradedReasons).toEqual([]);
      expect(snapshot.metrics.provenCoverage).toBeGreaterThan(0);
    }
    expect(snapshot.metrics.designedCoverage).toBe(1);
  });

  it('carries the freshness triple of the replay that verified it', () => {
    // The whole-suite replay of 15.3 consumed a real `testrun_done`, so all three
    // parts of the triple are present or none are — a half-filled triple is what
    // §9.1's cross-field rule rejects.
    expect(snapshot.freshness.terminalEventType).toBe('testrun_done');
    expect(snapshot.freshness.commandFamily).toBe('ExecutionTestrun');
    expect(Number.isFinite(Date.parse(snapshot.freshness.terminalEventAt ?? ''))).toBe(true);
  });

  it('is idempotent under a second load', () => {
    expect(loadSnapshot(raw)).toStrictEqual(snapshot);
  });
});

describe('an invalid snapshot fails the build by field path', () => {
  it('names the file in every rejection', () => {
    const broken = clone();
    delete broken['metrics'];
    expect(messageFor(broken)).toContain(SNAPSHOT_PATH);
  });

  it('rejects a document that is not an object', () => {
    expect(messageFor('nonsense')).toContain(SNAPSHOT_PATH);
    expect(messageFor(null)).toContain(SNAPSHOT_PATH);
  });

  it('names a missing top-level field', () => {
    const broken = clone();
    delete broken['freshness'];
    expect(messageFor(broken)).toContain('freshness');
  });

  it('names a count that disagrees with the promise array', () => {
    const broken = clone();
    (broken['metrics'] as Record<string, unknown>)['totalPromises'] = 7;
    const message = messageFor(broken);
    expect(message).toContain('metrics.totalPromises');
  });

  it('names a coverage figure that claims knowledge the run did not earn', () => {
    const broken = clone();
    // `provenCoverage` must be null while degraded (§9.1) — a number here is the
    // exact dishonesty the schema exists to refuse.
    (broken['metrics'] as Record<string, unknown>)['provenCoverage'] = 1;
    expect(messageFor(broken)).toContain('metrics.provenCoverage');
  });

  it('names a promise field whose value is out of range', () => {
    const broken = clone();
    const promises = broken['promises'] as Record<string, unknown>[];
    const first = promises[0];
    expect(first).toBeDefined();
    (first as Record<string, unknown>)['citation'] = {
      file: 'apps/fixture/README.md',
      line: 0,
      text: 'a citation to line zero cannot exist',
    };
    expect(messageFor(broken)).toContain('promises[0].citation.line');
  });

  it('names a dangling edge endpoint', () => {
    const broken = clone();
    const edges = broken['edges'] as Record<string, unknown>[];
    const first = edges[0];
    expect(first).toBeDefined();
    (first as Record<string, unknown>)['to'] = 'p_000000000000';
    expect(messageFor(broken)).toContain('edges[0].to');
  });

  it('names an unresolvable evidence reference', () => {
    const broken = clone();
    const promises = broken['promises'] as Record<string, unknown>[];
    const first = promises[0];
    expect(first).toBeDefined();
    (first as Record<string, unknown>)['evidencePackId'] = 'ev_missing';
    expect(messageFor(broken)).toContain('promises[0].evidencePackId');
  });
});

describe('the read-only guarantee at the loading seam (R8.6)', () => {
  it('starts no subprocess anywhere in the ledger source', () => {
    const offenders = scanLedger(['.ts', '.tsx']).filter(
      (file) =>
        !file.path.endsWith('snapshot-load.test.ts') &&
        (/from\s+['"]node:child_process['"]/.test(file.text) ||
          /require\(\s*['"]child_process['"]\s*\)/.test(file.text) ||
          /\bspawnSync\s*\(/.test(file.text) ||
          /\bexecFile\s*\(/.test(file.text)),
    );
    expect(offenders.map((file) => file.path)).toStrictEqual([]);
  });

  it('reads its data from the committed snapshot and not from the filesystem', () => {
    const loader = scanLedger(['.ts']).find((file) => file.path.endsWith('lib/snapshot.ts'));
    expect(loader).toBeDefined();
    expect(loader?.text).toContain("../data/ledger.snapshot.json' with { type: 'json' }");
    expect(loader?.text).not.toMatch(/from\s+['"]node:fs['"]/);
    expect(REPO_ROOT).not.toBe('');
  });
});
