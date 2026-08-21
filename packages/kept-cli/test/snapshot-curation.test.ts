import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { PromiseRecord } from '@kept/core';
import {
  createDiagnosticSink,
  createKeptState,
  createPromiseGraph,
  createPromiseRecord,
  inMemoryStateFileSystem,
  parseSnapshot,
} from '@kept/core';
import { describe, expect, it } from 'vitest';

import { PACK_SLUG, bytesOf, realisticPack, zipOf } from '../../kept-core/test/pack-archive.js';

import { deriveEdges } from '../src/graph.js';
import { SNAPSHOT_DIAGNOSTIC_CODES } from '../src/snapshot.js';
import type { CurationFileSystem } from '../src/commands/snapshot.js';
import {
  CURATED_ARTIFACT_KINDS,
  CURATED_EVIDENCE_RELATIVE_DIR,
  MAX_CURATED_PACK_BYTES,
  SEALED_EVIDENCE_RELATIVE_DIR,
  SNAPSHOT_COMMAND_DIAGNOSTIC_CODES,
  archiveNamesFor,
  curateEvidencePacks,
  referencedPackIds,
  runSnapshot,
} from '../src/commands/snapshot.js';

/**
 * Evidence curation — `kept snapshot` copies the packs the graph references into
 * `apps/ledger/public/evidence/<packId>/` and rewrites every `publicPath` to the
 * resulting static URL (design §15.3, R13.4, R13.5).
 *
 * **Why the packs here are synthetic.** A sealed pack is a single `.evidence` zip
 * file, and `.testmuai/evidence/` is gitignored because those files are one to
 * three megabytes each — so there is no committed pack to read, and committing one
 * as a fixture would defeat the reason the directory is ignored. Instead these
 * tests **build zip archives byte by byte**, in the exact shape a real pack has:
 * the layout, entry names and nesting below were read off
 * `.testmuai/evidence/73c1df17-2589-4202-bb02-afa6d4a1cf2b.evidence` (T-3's
 * authoring execution, mapped from `tests/output-cart_subtotal/.internal/meta.json`)
 * and `20091f19-2681-44ca-bc81-81c9e0a4587d.evidence` (T-7's failing one, which is
 * where `annotated.png` actually appears). Both entry spellings are real:
 * screenshots at `tests/<slug>/steps/<n-a-b>/screenshot.jpg`, the annotated
 * capture beside it, and the categorised triage note at
 * `tests/<slug>/steps/<n-a-b>/failure.yaml`.
 *
 * Building the archive rather than committing one also means the zip reader is
 * tested against inputs a fixture could never cover: stored entries, deflated
 * entries, a directory entry, a truncated archive, and a hostile entry name.
 */

const REPO = '/repo';
const DOC = 'apps/fixture/README.md';
const AT = '2026-08-20T12:00:00.000Z';
const PACK = 'ev_20260821T0736Z';
const SLUG = PACK_SLUG;

/** A curation filesystem over a map, so nothing in this suite touches disk. */
function curationFs(
  seed: Readonly<Record<string, Uint8Array>> = {},
): CurationFileSystem & { readonly files: Map<string, Uint8Array>; readonly dirs: string[] } {
  const files = new Map<string, Uint8Array>(Object.entries(seed));
  const dirs: string[] = [];
  return {
    files,
    dirs,
    readBinary(path: string): Uint8Array | null {
      return files.get(path) ?? null;
    },
    ensureDir(path: string): void {
      dirs.push(path);
    },
    writeBinary(path: string, bytes: Uint8Array): void {
      files.set(path, bytes);
    },
  };
}

function sealedAt(name: string): string {
  return `${REPO}/${SEALED_EVIDENCE_RELATIVE_DIR}/${name}`;
}

function promise(overrides: Partial<Parameters<typeof createPromiseRecord>[0]> = {}): PromiseRecord {
  return createPromiseRecord({
    claim: 'The Cart screen applies a 10% discount over $50.',
    citation: { file: DOC, line: 20, text: '- a claim' },
    designedTest: { path: 'tests/cart_discount_test.md', testId: 'T-7' },
    verdict: 'red',
    providers: ['baseline'],
    ...overrides,
  });
}

function stateOf(promises: readonly PromiseRecord[]) {
  return createKeptState({
    updatedAt: AT,
    graph: createPromiseGraph({
      promises,
      edges: deriveEdges(promises),
      degraded: false,
      degradedReasons: [],
    }),
  });
}

/* ─────────────────────────────── the curated copy ───────────────────────────── */

describe('curating a referenced pack into the committed public directory', () => {
  it('copies only the artefacts the Ledger links, and leaves the bulk behind', () => {
    const fs = curationFs({ [sealedAt(`${PACK}.evidence`)]: realisticPack() });
    const sink = createDiagnosticSink();
    const curated = curateEvidencePacks({
      repoRoot: REPO,
      packIds: [PACK],
      fileSystem: fs,
      diagnostics: sink,
    });

    const pack = curated.evidence[0];
    expect(curated.evidence).toHaveLength(1);
    expect(pack?.id).toBe(PACK);
    expect(pack?.kind).toBe('run');
    expect(pack?.artifacts.map((artifact) => artifact.name)).toEqual([
      `${SLUG}/steps/15-4-3/failure.yaml`,
      `${SLUG}/steps/8-2-3/annotated.png`,
      `${SLUG}/steps/8-2-3/screenshot.jpg`,
      `${SLUG}/steps/9-2-4/screenshot.jpg`,
    ]);
    expect(new Set(pack?.artifacts.map((artifact) => artifact.kind))).toEqual(
      new Set(CURATED_ARTIFACT_KINDS),
    );

    // The HAR, the run log, `execution.json` and the trajectory are the bulk of a
    // real pack and nothing links them, so they are not in the repository.
    const written = [...fs.files.keys()].filter((path) =>
      path.includes(CURATED_EVIDENCE_RELATIVE_DIR),
    );
    expect(written).toHaveLength(4);
    expect(written.some((path) => path.endsWith('.har'))).toBe(false);
    expect(written.some((path) => path.includes('execution.json'))).toBe(false);
    expect(written.some((path) => path.includes('v16-trajectory'))).toBe(false);
  });

  it('writes each artefact under apps/ledger/public/evidence/<packId>/', () => {
    const fs = curationFs({ [sealedAt(`${PACK}.evidence`)]: realisticPack() });
    curateEvidencePacks({ repoRoot: REPO, packIds: [PACK], fileSystem: fs });
    expect(fs.files.has(
      `${REPO}/${CURATED_EVIDENCE_RELATIVE_DIR}/${PACK}/${SLUG}/steps/8-2-3/annotated.png`,
    )).toBe(true);
  });

  it('rewrites every publicPath to a static URL under /evidence/', () => {
    const fs = curationFs({ [sealedAt(`${PACK}.evidence`)]: realisticPack() });
    const curated = curateEvidencePacks({ repoRoot: REPO, packIds: [PACK], fileSystem: fs });
    const pack = curated.evidence[0];
    expect(pack?.publicPath).toBe(`/evidence/${PACK}/`);
    for (const artifact of pack?.artifacts ?? []) {
      expect(artifact.publicPath).toBe(`/evidence/${PACK}/${artifact.name}`);
      // No absolute filesystem path ever reaches the snapshot: that is the bug
      // the schema's own `publicPath` rule exists to catch.
      expect(artifact.publicPath.startsWith('/evidence/')).toBe(true);
      expect(artifact.publicPath).not.toContain(REPO);
    }
  });

  it('records the byte count it committed, so the cost of curating is visible', () => {
    const fs = curationFs({ [sealedAt(`${PACK}.evidence`)]: realisticPack() });
    const curated = curateEvidencePacks({ repoRoot: REPO, packIds: [PACK], fileSystem: fs });
    const summed = (curated.evidence[0]?.artifacts ?? []).reduce(
      (total, artifact) => total + (artifact.bytes ?? 0),
      0,
    );
    expect(curated.bytes).toBe(summed);
    expect(curated.bytes).toBeGreaterThan(0);
    expect(curated.bytes).toBeLessThan(MAX_CURATED_PACK_BYTES);
  });

  it('finds the archive under the bare execution id as well as the prefixed one', () => {
    // The snapshot's id rule is `^ev_…`; the file Kane seals is named for the
    // execution id with no prefix. Both spellings resolve to the same pack.
    expect(archiveNamesFor('ev_73c1df17')).toEqual([
      'ev_73c1df17',
      'ev_73c1df17.evidence',
      '73c1df17',
      '73c1df17.evidence',
    ]);
    // The case that mattered and was missing: `listArtifacts` names a pack by its
    // entry name, so a real id already ends in `.evidence` — and appending the
    // suffix again looked for `<id>.evidence.evidence`. Nothing was ever curated.
    expect(archiveNamesFor('f2cac6b7.evidence')).toEqual(['f2cac6b7.evidence']);
    expect(archiveNamesFor('ev_f2cac6b7.evidence')).toEqual([
      'ev_f2cac6b7.evidence',
      'f2cac6b7.evidence',
    ]);
    const fs = curationFs({ [sealedAt('73c1df17.evidence')]: realisticPack() });
    const curated = curateEvidencePacks({
      repoRoot: REPO,
      packIds: ['ev_73c1df17'],
      fileSystem: fs,
    });
    expect(curated.evidence[0]?.id).toBe('ev_73c1df17');
  });

  it('never writes outside the curated directory, however an entry is named', () => {
    const hostile = zipOf([
      { name: '../../../../etc/annotated.png', bytes: bytesOf('escape'), method: 0 },
      { name: '/absolute/annotated.png', bytes: bytesOf('escape'), method: 0 },
      { name: `${SLUG}/steps/1-0-1/screenshot.jpg`, bytes: bytesOf('ok'), method: 0 },
    ]);
    const fs = curationFs({ [sealedAt(`${PACK}.evidence`)]: hostile });
    const curated = curateEvidencePacks({ repoRoot: REPO, packIds: [PACK], fileSystem: fs });
    expect(curated.evidence[0]?.artifacts.map((artifact) => artifact.name)).toEqual([
      `${SLUG}/steps/1-0-1/screenshot.jpg`,
    ]);
    for (const path of fs.files.keys()) {
      if (path.includes(SEALED_EVIDENCE_RELATIVE_DIR)) continue;
      expect(path.startsWith(`${REPO}/${CURATED_EVIDENCE_RELATIVE_DIR}/`)).toBe(true);
    }
  });

  it('diagnoses a referenced pack that is not on disk, and curates nothing for it', () => {
    const sink = createDiagnosticSink();
    const curated = curateEvidencePacks({
      repoRoot: REPO,
      packIds: [PACK],
      fileSystem: curationFs(),
      diagnostics: sink,
    });
    expect(curated.evidence).toEqual([]);
    expect(sink.has(SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.evidencePackAbsent)).toBe(true);
  });

  it('diagnoses a pack holding nothing a reviewer could open', () => {
    const bulkOnly = zipOf([
      { name: `${SLUG}/logs/0-network.har`, bytes: bytesOf('har'), method: 8 },
    ]);
    const sink = createDiagnosticSink();
    const curated = curateEvidencePacks({
      repoRoot: REPO,
      packIds: [PACK],
      fileSystem: curationFs({ [sealedAt(`${PACK}.evidence`)]: bulkOnly }),
      diagnostics: sink,
    });
    expect(curated.evidence).toEqual([]);
    expect(sink.has(SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.evidencePackEmpty)).toBe(true);
  });

  it('touches no archive at all when the graph references no pack', () => {
    const fs = curationFs({ [sealedAt(`${PACK}.evidence`)]: realisticPack() });
    const before = new Set(fs.files.keys());
    const curated = curateEvidencePacks({ repoRoot: REPO, packIds: [], fileSystem: fs });
    expect(curated.evidence).toEqual([]);
    expect(curated.bytes).toBe(0);
    expect(new Set(fs.files.keys())).toEqual(before);
  });
});

/* ─────────────────────────── the command, end to end ────────────────────────── */

describe('kept snapshot publishes curated packs as plain static URLs', () => {
  it('carries the reference through, because the pack is now committed', () => {
    const record = promise({ evidencePackId: PACK });
    const sink = createDiagnosticSink();
    const result = runSnapshot({
      repoRoot: REPO,
      state: stateOf([record]),
      generatedAt: AT,
      fileSystem: inMemoryStateFileSystem(),
      curationFileSystem: curationFs({ [sealedAt(`${PACK}.evidence`)]: realisticPack() }),
      diagnostics: sink,
    });

    expect(result.valid).toBe(true);
    expect(result.written).toBe(true);
    expect(result.curatedBytes).toBeGreaterThan(0);
    expect(result.snapshot.evidence.map((pack) => pack.id)).toEqual([PACK]);
    expect(result.snapshot.promises[0]?.evidencePackId).toBe(PACK);
    // Not cleared: `buildSnapshot` clears a reference only when the pack is
    // absent from the snapshot's own evidence array.
    expect(sink.has(SNAPSHOT_DIAGNOSTIC_CODES.evidenceUnresolved)).toBe(false);
    expect(sink.has(SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.evidenceCurated)).toBe(true);
  });

  it('writes a snapshot the Ledger will accept, every artefact link static', () => {
    const result = runSnapshot({
      repoRoot: REPO,
      state: stateOf([promise({ evidencePackId: PACK })]),
      generatedAt: AT,
      fileSystem: inMemoryStateFileSystem(),
      curationFileSystem: curationFs({ [sealedAt(`${PACK}.evidence`)]: realisticPack() }),
    });
    // The schema authority, not a paraphrase of it.
    const parsed = parseSnapshot(JSON.stringify(result.snapshot));
    for (const pack of parsed.evidence) {
      for (const artifact of pack.artifacts) {
        expect(artifact.publicPath).toMatch(/^\/evidence\//);
      }
    }
  });

  it('clears the reference rather than publishing a dead link when nothing curated', () => {
    const sink = createDiagnosticSink();
    const result = runSnapshot({
      repoRoot: REPO,
      state: stateOf([promise({ evidencePackId: PACK })]),
      generatedAt: AT,
      fileSystem: inMemoryStateFileSystem(),
      curationFileSystem: curationFs(),
      diagnostics: sink,
    });
    expect(result.valid).toBe(true);
    expect(result.snapshot.evidence).toEqual([]);
    expect(result.snapshot.promises[0]?.evidencePackId).toBeNull();
    expect(sink.has(SNAPSHOT_COMMAND_DIAGNOSTIC_CODES.evidencePackAbsent)).toBe(true);
    expect(sink.has(SNAPSHOT_DIAGNOSTIC_CODES.evidenceUnresolved)).toBe(true);
  });

  it('honours an explicit evidence list, so a caller can project without curating', () => {
    const fs = curationFs({ [sealedAt(`${PACK}.evidence`)]: realisticPack() });
    const result = runSnapshot({
      repoRoot: REPO,
      state: stateOf([promise({ evidencePackId: PACK })]),
      generatedAt: AT,
      evidence: [],
      fileSystem: inMemoryStateFileSystem(),
      curationFileSystem: fs,
    });
    expect(result.curatedBytes).toBe(0);
    expect([...fs.files.keys()].some((path) => path.includes(CURATED_EVIDENCE_RELATIVE_DIR))).toBe(
      false,
    );
  });

  it('collects every pack id the graph references, including a repair reference', () => {
    const plain = promise({ evidencePackId: PACK });
    const repaired = promise({
      claim: 'another claim',
      evidencePackId: null,
      repair: {
        branch: 'docs-lie',
        strategy: 'resultCode740',
        severity: 'major',
        category: 'ui_data_defect',
        confidence: 0.95,
        evidenceRef: 'evidence/ev_other/failure.yaml',
        rationale: 'the citation is wrong',
      },
    });
    // Order follows the graph's own promise order, which is id-sorted, not the
    // order this test wrote them in — so the assertion is on the set.
    expect(new Set(referencedPackIds(stateOf([plain, repaired])))).toEqual(
      new Set([PACK, 'ev_other']),
    );
  });
});

/* ───────────────────────────────── the purity ───────────────────────────────── */

describe('kept snapshot stays a pure projection', () => {
  const SOURCE = readFileSync(
    fileURLToPath(new URL('../src/commands/snapshot.ts', import.meta.url)),
    'utf8',
  );

  it('spawns no process and names no Kane binary', () => {
    // §13.1 gives `kept snapshot` the `Kane invocation: none` row, and curation
    // does not change that: the inflate is `node:zlib`, so no unzip binary is
    // spawned and no dependency is added to the runtime budget.
    for (const forbidden of [
      'child_process',
      'spawnSync',
      'execSync',
      'KaneInvoker',
      'findKaneBinary',
    ]) {
      expect(SOURCE.includes(forbidden)).toBe(false);
    }
  });

  it('writes only under the two committed paths it is allowed to write', () => {
    const fs = curationFs({ [sealedAt(`${PACK}.evidence`)]: realisticPack() });
    const state = inMemoryStateFileSystem();
    runSnapshot({
      repoRoot: REPO,
      state: stateOf([promise({ evidencePackId: PACK })]),
      generatedAt: AT,
      fileSystem: state,
      curationFileSystem: fs,
    });
    for (const path of state.files.keys()) {
      expect(path).toBe(`${REPO}/apps/ledger/data/ledger.snapshot.json`);
    }
    for (const path of fs.files.keys()) {
      if (path.includes(SEALED_EVIDENCE_RELATIVE_DIR)) continue;
      expect(path.startsWith(`${REPO}/${CURATED_EVIDENCE_RELATIVE_DIR}/`)).toBe(true);
    }
  });
});
