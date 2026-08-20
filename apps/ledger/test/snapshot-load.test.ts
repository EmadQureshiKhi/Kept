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
    expect(snapshot.promises).toHaveLength(8);
    expect(snapshot.metrics.totalPromises).toBe(8);
  });

  it('carries every promise cited to a real file and line', () => {
    for (const promise of snapshot.promises) {
      expect(promise.citation.file).toBe('apps/fixture/README.md');
      expect(promise.citation.line).toBeGreaterThanOrEqual(1);
      expect(promise.citation.text.trim()).not.toBe('');
    }
  });

  it('is degraded, and withholds the proven figure rather than reporting zero', () => {
    // Not an error state: there is no context store yet, so the assurance axis was
    // refused and the ledger says so instead of publishing a number (§10.10, R2.11).
    expect(snapshot.degraded).toBe(true);
    expect(snapshot.degradedReasons).toContain('assurance-status:refused');
    expect(snapshot.metrics.provenCoverage).toBeNull();
    expect(snapshot.metrics.designedCoverage).toBe(1);
  });

  it('has never consumed a terminal event, and does not pretend otherwise', () => {
    expect(snapshot.freshness.terminalEventAt).toBeNull();
    expect(snapshot.freshness.terminalEventType).toBeNull();
    expect(snapshot.freshness.commandFamily).toBeNull();
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
