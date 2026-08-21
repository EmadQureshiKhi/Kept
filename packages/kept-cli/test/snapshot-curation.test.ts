import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

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
  readPackEntries,
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
const SLUG = 'tests/cart-discount-27eaa1da';

/* ───────────────────────── a zip archive, byte by byte ───────────────────────── */

interface PlannedEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
  /** 0 = stored, 8 = deflate. Kane's packs use both. */
  readonly method: 0 | 8;
}

function bytesOf(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'utf8'));
}

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * A single-disk zip archive holding exactly the planned entries.
 *
 * Deliberately hand-rolled: the point of the reader under test is that it needs
 * no unzip dependency, and a test that reached for one to build its input would
 * be asserting the dependency's agreement with itself.
 */
function zipOf(planned: readonly PlannedEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of planned) {
    const name = bytesOf(entry.name);
    const payload =
      entry.method === 8 ? new Uint8Array(deflateRawSync(entry.bytes)) : entry.bytes;
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(entry.method),
      u16(0),
      u16(0),
      u32(0),
      u32(payload.length),
      u32(entry.bytes.length),
      u16(name.length),
      u16(0),
      name,
      payload,
    ]);
    locals.push(local);
    centrals.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(entry.method),
        u16(0),
        u16(0),
        u32(0),
        u32(payload.length),
        u32(entry.bytes.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.length;
  }

  const directory = concat(centrals);
  return concat([
    concat(locals),
    directory,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(planned.length),
    u16(planned.length),
    u32(directory.length),
    u32(offset),
    u16(0),
  ]);
}

/** A pack in the real shape: two curated kinds, and bulk that must not be copied. */
function realisticPack(): Uint8Array {
  return zipOf([
    { name: `${SLUG}/steps/`, bytes: new Uint8Array(0), method: 0 },
    { name: `${SLUG}/steps/8-2-3/annotated.png`, bytes: bytesOf('annotated-capture'), method: 8 },
    { name: `${SLUG}/steps/8-2-3/screenshot.jpg`, bytes: bytesOf('step-8-shot'), method: 8 },
    { name: `${SLUG}/steps/9-2-4/screenshot.jpg`, bytes: bytesOf('step-9-shot'), method: 0 },
    {
      name: `${SLUG}/steps/15-4-3/failure.yaml`,
      bytes: bytesOf('triage:\n  rca:\n    category: application_issue/ui_data_defect\n'),
      method: 8,
    },
    { name: `${SLUG}/logs/0-network.har`, bytes: bytesOf('x'.repeat(4096)), method: 8 },
    { name: `${SLUG}/logs/0-run.log`, bytes: bytesOf('runner noise'), method: 8 },
    { name: `${SLUG}/auteur/execution.json`, bytes: bytesOf('{"big":true}'), method: 8 },
    { name: `${SLUG}/v16-trajectory/0-run_summary.json`, bytes: bytesOf('{}'), method: 8 },
    { name: 'run.yaml', bytes: bytesOf('broken: 1\nfailed: 0\n'), method: 8 },
  ]);
}

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

/* ──────────────────────────────── the zip reader ─────────────────────────────── */

describe('reading a sealed pack, which is a zip file and not a directory', () => {
  it('reads stored and deflated entries alike, and skips directory entries', () => {
    const entries = readPackEntries(realisticPack());
    expect(entries.map((entry) => entry.name)).not.toContain(`${SLUG}/steps/`);
    const shot = entries.find((entry) => entry.name.endsWith('9-2-4/screenshot.jpg'));
    const annotated = entries.find((entry) => entry.name.endsWith('annotated.png'));
    expect(Buffer.from(shot?.bytes ?? new Uint8Array()).toString('utf8')).toBe('step-9-shot');
    expect(Buffer.from(annotated?.bytes ?? new Uint8Array()).toString('utf8')).toBe(
      'annotated-capture',
    );
  });

  it('refuses anything that is not an archive, by name rather than half-read', () => {
    expect(() => readPackEntries(bytesOf('this is a png, not a zip'))).toThrow(
      /not a zip archive/,
    );
  });

  it('refuses a truncated archive rather than publishing a corrupt artefact', () => {
    const whole = realisticPack();
    // Keep the end record so the directory is found, then cut the data out from
    // under it: the failure must be diagnosed, not decoded into garbage.
    const cut = concat([whole.subarray(0, 8), whole.subarray(64)]);
    expect(() => readPackEntries(cut)).toThrow();
  });
});

describe('the reader against real Kane bytes, when this machine has any', () => {
  /**
   * The one assertion that cannot be committed as a fixture.
   *
   * `.testmuai/evidence/` is gitignored — the packs are one to three megabytes
   * each — so on a clone there is nothing here to read and this test says so
   * rather than passing quietly on a synthetic input it has already covered
   * above. On the machine that authored the corpus it reads a genuine sealed pack
   * and proves the reader against Kane's own bytes, which is the only place the
   * archive's real compression, entry order and nesting are exercised.
   */
  const sealedDir = fileURLToPath(new URL('../../../.testmuai/evidence/', import.meta.url));
  let archives: string[] = [];
  try {
    archives = readdirSync(sealedDir)
      .filter((name) => name.endsWith('.evidence'))
      .map((name) => `${sealedDir}${name}`)
      .filter((path) => statSync(path).isFile())
      .sort();
  } catch {
    archives = [];
  }

  it.skipIf(archives.length === 0)('reads a sealed pack and finds curatable artefacts', () => {
    const path = archives[0] ?? '';
    const entries = readPackEntries(readFileSync(path));
    expect(entries.length).toBeGreaterThan(0);
    // Every real pack carries a root `run.yaml` and per-step screenshots.
    expect(entries.some((entry) => entry.name === 'run.yaml')).toBe(true);
    expect(entries.some((entry) => /\/steps\/[^/]+\/screenshot\.jpg$/.test(entry.name))).toBe(true);
  });
});

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
    expect(archiveNamesFor('ev_73c1df17')).toEqual(['ev_73c1df17.evidence', '73c1df17.evidence']);
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
