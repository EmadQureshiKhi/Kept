/**
 * The sealed pack's triage note, attributed by identifier (design §4.6, §6.2,
 * §6.3, R4.13, R6.7, R6.11).
 *
 * What is being pinned here is a **decision**, not just a reader. The note that
 * decides a repair branch sits at `tests/<slug>/steps/<n-a-b>/failure.yaml`, the
 * slug comes from the test document's *title*, and inferring a member's identity
 * from a name is what §7.1 and §4.6 forbid. The pack states the identity itself —
 * `tests/<slug>/result.yaml` carries `external_id.test_id`, the same UUID
 * `testrun_member_end` reports — so attribution is a UUID match and everything
 * ambiguous is attributed to nobody. These tests assert both halves: the match
 * works, and each way of being ambiguous refuses.
 */

import {
  SEALED_TRIAGE_DIAGNOSTIC_CODES,
  createDiagnosticSink,
  createFailureContext,
  readSealedPackTriage,
  sealedNoteFor,
  selectRouter,
  testIdFromResultManifest,
  type SealedPackFileSystem,
} from 'kept-core';
import { describe, expect, it } from 'vitest';

import { bytesOf, zipOf } from './pack-archive.js';

const DIR = '/repo/.testmuai/evidence';
const EXECUTION = '0944d075-8dab-4683-a59f-96e51308697c';
const SUBTOTAL_TEST_ID = '1c4fff07-a0da-495b-8471-26d45b4a1441';
const DISCOUNT_TEST_ID = '4be09740-bce4-483f-ad83-9e6cc24bd421';

/** A per-test manifest in the shape a real pack has. */
function manifest(slug: string, testId: string | null): string {
  return [
    `evidence: '0.1'`,
    `test: ${slug}`,
    `status: broken`,
    `external_id:`,
    `  execution_id: ${EXECUTION}`,
    ...(testId === null ? [] : [`  test_id: ${testId}`]),
    `  session_name: cart`,
  ].join('\n');
}

/** A per-step note in the shape Kane really writes one. */
function note(category: string, confidence: string): string {
  return [
    `step: 5-3`,
    `status: broken`,
    `title: Cart summary totals stay at $18.00 while line total is $36.00`,
    `triage:`,
    `  status: triaged`,
    `  rca:`,
    `    root_cause: The cart summary is using the wrong amount.`,
    `    category: ${category}`,
    `    confidence: ${confidence}`,
    `  severity: major`,
  ].join('\n');
}

/** Both members failed, and the pack names each by its own test id. */
function twoMemberPack(): Uint8Array {
  return zipOf([
    {
      name: 'tests/cart-subtotal-d5ba3490/result.yaml',
      bytes: bytesOf(manifest('cart-subtotal-d5ba3490', SUBTOTAL_TEST_ID)),
      method: 8,
    },
    {
      name: 'tests/cart-subtotal-d5ba3490/steps/18-5-3/failure.yaml',
      bytes: bytesOf(note('application_issue/ui_data_defect', '0.96')),
      method: 8,
    },
    {
      name: 'tests/cart-discount-27eaa1da/result.yaml',
      bytes: bytesOf(manifest('cart-discount-27eaa1da', DISCOUNT_TEST_ID)),
      method: 8,
    },
    {
      name: 'tests/cart-discount-27eaa1da/steps/14-3-5/failure.yaml',
      bytes: bytesOf(note('test_issue/selector_not_found', '0.71')),
      method: 8,
    },
    { name: 'failure.yaml', bytes: bytesOf('totals:\n  failures: 2\n'), method: 8 },
    { name: 'run.yaml', bytes: bytesOf(`run_id: ${EXECUTION}\n`), method: 8 },
  ]);
}

/** A sealed-pack filesystem over a map, so nothing here touches disk. */
function packFs(files: Readonly<Record<string, Uint8Array>>): SealedPackFileSystem {
  const at = new Map(Object.entries(files));
  return {
    readDirectory(dir: string) {
      if (dir !== DIR) throw new Error(`no such directory ${dir}`);
      return [...at.keys()].map((path) => ({
        name: path.slice(dir.length + 1),
        isDirectory: false,
        isFile: true,
      }));
    },
    stat(path: string) {
      const bytes = at.get(path);
      if (bytes === undefined) return null;
      return { mtimeMs: 1, bytes: bytes.length, isDirectory: false };
    },
    readBinary(path: string) {
      return at.get(path) ?? null;
    },
  };
}

describe('attributing a sealed triage note to a member', () => {
  it('ties each note to the member id the pack itself declares', () => {
    const sink = createDiagnosticSink();
    const pack = readSealedPackTriage({
      evidenceDir: DIR,
      executionId: EXECUTION,
      fs: packFs({ [`${DIR}/${EXECUTION}.evidence`]: twoMemberPack() }),
      diagnostics: sink,
    });

    expect(pack).not.toBeNull();
    expect(pack?.archivePath).toBe(`${DIR}/${EXECUTION}.evidence`);
    expect([...(pack?.notes.keys() ?? [])].sort()).toEqual(
      [SUBTOTAL_TEST_ID, DISCOUNT_TEST_ID].sort(),
    );
    // Each member gets *its own* note, which is the whole point: one note per
    // pack would hand both members the same branch.
    expect(pack?.notes.get(SUBTOTAL_TEST_ID)?.entryName).toBe(
      'tests/cart-subtotal-d5ba3490/steps/18-5-3/failure.yaml',
    );
    expect(pack?.notes.get(SUBTOTAL_TEST_ID)?.content).toContain('application_issue');
    expect(pack?.notes.get(DISCOUNT_TEST_ID)?.content).toContain('selector_not_found');
    expect(sink.entries.map((entry) => entry.code)).toContain(
      SEALED_TRIAGE_DIAGNOSTIC_CODES.read,
    );
  });

  it('does not read a pack sealed by another run, even a newer one', () => {
    const sink = createDiagnosticSink();
    const pack = readSealedPackTriage({
      evidenceDir: DIR,
      executionId: EXECUTION,
      fs: packFs({ [`${DIR}/dbef2b96-eee0-4ae0-9c1b-6519acbd13f8.evidence`]: twoMemberPack() }),
      diagnostics: sink,
    });

    // A previous extraction or a parallel agent's run is exactly how a member
    // gets handed another member's judgement. The id filters the listing; no
    // path is composed from it.
    expect(pack).toBeNull();
    expect(sink.entries.map((entry) => entry.code)).toContain(
      SEALED_TRIAGE_DIAGNOSTIC_CODES.archiveAbsent,
    );
  });

  it('attributes nothing from a test directory whose manifest names no member', () => {
    const sink = createDiagnosticSink();
    const archive = zipOf([
      {
        name: 'tests/cart-subtotal-d5ba3490/result.yaml',
        bytes: bytesOf(manifest('cart-subtotal-d5ba3490', null)),
        method: 8,
      },
      {
        name: 'tests/cart-subtotal-d5ba3490/steps/18-5-3/failure.yaml',
        bytes: bytesOf(note('application_issue/ui_data_defect', '0.96')),
        method: 8,
      },
    ]);
    const pack = readSealedPackTriage({
      evidenceDir: DIR,
      executionId: EXECUTION,
      fs: packFs({ [`${DIR}/${EXECUTION}.evidence`]: archive }),
      diagnostics: sink,
    });

    expect(pack).toBeNull();
    expect(sink.entries.map((entry) => entry.code)).toContain(
      SEALED_TRIAGE_DIAGNOSTIC_CODES.unattributed,
    );
  });

  it('drops a member id two directories both claim', () => {
    const archive = zipOf([
      {
        name: 'tests/cart-subtotal-d5ba3490/result.yaml',
        bytes: bytesOf(manifest('cart-subtotal-d5ba3490', SUBTOTAL_TEST_ID)),
        method: 8,
      },
      {
        name: 'tests/cart-subtotal-d5ba3490/steps/18-5-3/failure.yaml',
        bytes: bytesOf(note('application_issue/ui_data_defect', '0.96')),
        method: 8,
      },
      {
        name: 'tests/cart-subtotal-duplicate/result.yaml',
        bytes: bytesOf(manifest('cart-subtotal-duplicate', SUBTOTAL_TEST_ID)),
        method: 8,
      },
      {
        name: 'tests/cart-subtotal-duplicate/steps/2-1-1/failure.yaml',
        bytes: bytesOf(note('test_issue/timeout', '0.5')),
        method: 8,
      },
    ]);
    const pack = readSealedPackTriage({
      evidenceDir: DIR,
      executionId: EXECUTION,
      fs: packFs({ [`${DIR}/${EXECUTION}.evidence`]: archive }),
    });

    // Ambiguity is refused whole: picking either directory would be a guess, and
    // a guess here authorises a source patch.
    expect(pack).toBeNull();
  });

  it('is null, not a throw, for an archive that is not a readable pack', () => {
    const sink = createDiagnosticSink();
    const pack = readSealedPackTriage({
      evidenceDir: DIR,
      executionId: EXECUTION,
      fs: packFs({ [`${DIR}/${EXECUTION}.evidence`]: bytesOf('truncated nonsense') }),
      diagnostics: sink,
    });

    expect(pack).toBeNull();
    expect(sink.entries.map((entry) => entry.code)).toContain(
      SEALED_TRIAGE_DIAGNOSTIC_CODES.archiveUnreadable,
    );
  });

  it('answers null for an absent directory and for a member with no test id', () => {
    expect(readSealedPackTriage({ evidenceDir: null, executionId: EXECUTION })).toBeNull();
    expect(
      readSealedPackTriage({
        evidenceDir: DIR,
        executionId: EXECUTION,
        fs: packFs({}),
      }),
    ).toBeNull();
    expect(sealedNoteFor(null, SUBTOTAL_TEST_ID)).toBeNull();

    const pack = readSealedPackTriage({
      evidenceDir: DIR,
      executionId: EXECUTION,
      fs: packFs({ [`${DIR}/${EXECUTION}.evidence`]: twoMemberPack() }),
    });
    expect(sealedNoteFor(pack, null)).toBeNull();
    expect(sealedNoteFor(pack, 'a-test-id-no-member-has')).toBeNull();
  });

  it('reads the member id out of a manifest, and nothing out of a broken one', () => {
    expect(testIdFromResultManifest(manifest('slug', SUBTOTAL_TEST_ID))).toBe(SUBTOTAL_TEST_ID);
    expect(testIdFromResultManifest(manifest('slug', null))).toBeNull();
    expect(testIdFromResultManifest('external_id: not-a-mapping')).toBeNull();
    expect(testIdFromResultManifest('key: [unterminated')).toBeNull();
    expect(testIdFromResultManifest('')).toBeNull();
  });
});

describe('the branch the sealed note actually produces', () => {
  /** The member event as it really arrives: path, test id, status, and nothing else. */
  const memberEvent = {
    type: 'testrun_member_end',
    path: '/repo/tests/cart_subtotal_test.md',
    test_id: SUBTOTAL_TEST_ID,
    status: 'failed',
    duration_s: 27.8,
  };

  function routeWith(category: string) {
    const pack = readSealedPackTriage({
      evidenceDir: DIR,
      executionId: EXECUTION,
      fs: packFs({
        [`${DIR}/${EXECUTION}.evidence`]: zipOf([
          {
            name: 'tests/cart-subtotal-d5ba3490/result.yaml',
            bytes: bytesOf(manifest('cart-subtotal-d5ba3490', SUBTOTAL_TEST_ID)),
            method: 8,
          },
          {
            name: 'tests/cart-subtotal-d5ba3490/steps/18-5-3/failure.yaml',
            bytes: bytesOf(note(category, '0.96')),
            method: 8,
          },
        ]),
      }),
    });
    return selectRouter({ verdictRouter: 'resultCode740' }).route(
      createFailureContext({
        family: 'ExecutionTestrun',
        terminal: memberEvent,
        memberStatus: 'failed',
        promiseId: 'p_8d965c2fae07',
        repoRoot: '/repo',
        sealedTriage: sealedNoteFor(pack, SUBTOTAL_TEST_ID),
      }),
    );
  }

  it('routes code-break on Kane own product-fault family, with its grading carried', () => {
    const routed = routeWith('application_issue/ui_data_defect');
    // The measured gap: this exact note, on this exact member event, answered
    // `docs-lie` before — the note was inside a zip nothing opened, its category
    // was one level deeper than the alias list read, and the family was not in
    // the product-fault set.
    expect(routed.branch).toBe('code-break');
    expect(routed.category).toBe('application_issue/ui_data_defect');
    expect(routed.severity).toBe('major');
    expect(routed.confidence).toBe(0.96);
    // The reference is the archive Kane sealed, repository-relative and real.
    expect(routed.evidenceRef).toBe(`.testmuai/evidence/${EXECUTION}.evidence`);
    expect(routed.rationale).toContain('application_issue');
  });

  it('still routes test-drift and docs-lie from the same seam', () => {
    expect(routeWith('test_issue/selector_not_found').branch).toBe('test-drift');
    expect(routeWith('assertion').branch).toBe('docs-lie');
    expect(routeWith('something_nobody_has_seen').branch).toBe('docs-lie');
  });

  it('routes the residue when the pack attributed nothing to this member', () => {
    const routed = selectRouter({ verdictRouter: 'resultCode740' }).route(
      createFailureContext({
        family: 'ExecutionTestrun',
        terminal: memberEvent,
        memberStatus: 'failed',
        promiseId: 'p_8d965c2fae07',
        repoRoot: '/repo',
        sealedTriage: null,
      }),
    );
    expect(routed.branch).toBe('docs-lie');
  });
});
