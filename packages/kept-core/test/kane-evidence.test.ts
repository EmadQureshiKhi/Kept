import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ARTIFACT_KINDS,
  classifyArtifact,
  createDiagnosticSink,
  isSyncConflictCopy,
  listArtifacts,
  resolveEvidenceDir,
  type ArtifactKind,
  type CollectingDiagnosticSink,
} from '@kept/core';

/**
 * Unit tests for `kane/evidence.ts` (design §4.6, R3.19, R4.13, R6.11).
 *
 * Every path assertion is built with `join`, never with a hand-written string, so
 * the suite states the *structure* of the answer rather than one host's spelling
 * of it. Trees are real temporary directories: the module's job is to read disk
 * correctly, and an all-in-memory suite would prove only that the walk matches
 * the fake.
 */

let root: string;
let sink: CollectingDiagnosticSink;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kept-evidence-'));
  sink = createDiagnosticSink();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Create a pack directory with the given files, then stamp its mtime. */
function seedPack(
  evidenceDir: string,
  id: string,
  files: readonly string[],
  mtime: Date,
): string {
  const dir = join(evidenceDir, id);
  mkdirSync(dir, { recursive: true });
  for (const file of files) {
    const target = join(dir, ...file.split('/'));
    mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(target, `contents of ${file}`);
  }
  utimesSync(dir, mtime, mtime);
  return dir;
}

describe('resolveEvidenceDir — the location comes from the family', () => {
  it('resolves ExecutionRun to <session_dir>/evidence', () => {
    const sessionDir = join(root, 'sessions', 's-1');
    expect(resolveEvidenceDir({ family: 'ExecutionRun', sessionDir, cwd: root })).toBe(
      join(sessionDir, 'evidence'),
    );
    expect(sink.size).toBe(0);
  });

  it('resolves ExecutionTestrun to <cwd>/.testmuai/evidence, session_dir irrelevant', () => {
    const expected = join(root, '.testmuai', 'evidence');
    expect(resolveEvidenceDir({ family: 'ExecutionTestrun', cwd: root })).toBe(expected);
    expect(
      resolveEvidenceDir({ family: 'ExecutionTestrun', cwd: root, sessionDir: join(root, 'x') }),
    ).toBe(expected);
  });

  it('resolves Assurance to null, and says nothing about it', () => {
    // A `cover` run seals no pack; a diagnostic on every one would be noise.
    expect(resolveEvidenceDir({ family: 'Assurance', cwd: root, diagnostics: sink })).toBeNull();
    expect(
      resolveEvidenceDir({ family: 'Assurance', cwd: root, sessionDir: root, diagnostics: sink }),
    ).toBeNull();
    expect(sink.size).toBe(0);
  });

  it('answers null and diagnoses when session_dir is absent from run_end', () => {
    for (const sessionDir of [undefined, null, '', '   '] as const) {
      const answer = resolveEvidenceDir({
        family: 'ExecutionRun',
        sessionDir,
        cwd: root,
        diagnostics: sink,
      });
      expect(answer).toBeNull();
    }
    expect(sink.withCode('evidence-session-dir-absent')).toHaveLength(4);
    expect(sink.hasSeverity('warn')).toBe(true);
  });

  it('returns absolute paths, resolving a relative session_dir against cwd', () => {
    const answer = resolveEvidenceDir({
      family: 'ExecutionRun',
      sessionDir: join('.kane', 'sessions', 's-2'),
      cwd: root,
    });
    expect(answer).toBe(join(root, '.kane', 'sessions', 's-2', 'evidence'));
    expect(answer?.startsWith(sep)).toBe(true);
  });

  it('refuses to substitute process.cwd() for a missing or relative cwd', () => {
    // A confident wrong absolute path is worse than no path: R6.11 forbids
    // fabricating an evidence reference.
    for (const cwd of ['', '   ', 'relative/cwd']) {
      expect(resolveEvidenceDir({ family: 'ExecutionTestrun', cwd, diagnostics: sink })).toBeNull();
      expect(
        resolveEvidenceDir({
          family: 'ExecutionRun',
          sessionDir: join('.kane', 'sessions', 's-3'),
          cwd,
          diagnostics: sink,
        }),
      ).toBeNull();
    }
    expect(sink.withCode('evidence-cwd-unusable')).toHaveLength(6);
    expect(sink.hasSeverity('error')).toBe(true);
  });
});

describe('classifyArtifact — unknown files are listed, never dropped', () => {
  it('classifies each documented artefact shape', () => {
    const expected: readonly [string, ArtifactKind][] = [
      ['annotated.png', 'annotated'],
      ['step-4.png', 'screenshot'],
      ['shot.jpeg', 'screenshot'],
      ['network.har', 'har'],
      ['console-step-2.ndjson', 'console'],
      ['run.log', 'log'],
      ['failure.yaml', 'failure-yaml'],
      ['failure.yml', 'failure-yaml'],
      ['FAILURE.YAML', 'failure-yaml'],
      ['steps/step-1.png', 'screenshot'],
    ];
    for (const [name, kind] of expected) expect(classifyArtifact(name)).toBe(kind);
  });

  it('classifies anything unrecognised as other rather than discarding it', () => {
    for (const name of ['manifest.tar.zst', 'notes', 'trace.zip', 'meta.yaml', 'events.ndjson']) {
      expect(classifyArtifact(name)).toBe('other');
    }
    expect(ARTIFACT_KINDS).toContain('other');
  });
});

describe('listArtifacts — the newest pack, whole', () => {
  it('reports the resolved dir with no pack when the directory does not exist', () => {
    // `.testmuai/evidence` is gitignored and regenerated, so absence is routine.
    const listing = listArtifacts({ family: 'ExecutionTestrun', cwd: root, diagnostics: sink });
    expect(listing.dir).toBe(join(root, '.testmuai', 'evidence'));
    expect(listing.pack).toBeNull();
    expect(listing.packIds).toEqual([]);
    expect(sink.has('evidence-dir-unreadable')).toBe(true);
  });

  it('reports no pack for a family that seals none', () => {
    const listing = listArtifacts({ family: 'Assurance', cwd: root, diagnostics: sink });
    expect(listing).toEqual({ dir: null, pack: null, packIds: [] });
  });

  it('reports an empty pack as a pack with no artefacts', () => {
    const evidenceDir = join(root, '.testmuai', 'evidence');
    seedPack(evidenceDir, 'ev_20260820T100000Z', [], new Date(1_700_000_000_000));

    const listing = listArtifacts({ family: 'ExecutionTestrun', cwd: root, diagnostics: sink });
    expect(listing.pack?.id).toBe('ev_20260820T100000Z');
    expect(listing.pack?.artifacts).toEqual([]);
    expect(listing.pack?.sealedAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('diagnoses an evidence directory that exists but holds nothing', () => {
    mkdirSync(join(root, '.testmuai', 'evidence'), { recursive: true });
    const listing = listArtifacts({ family: 'ExecutionTestrun', cwd: root, diagnostics: sink });
    expect(listing.pack).toBeNull();
    expect(sink.has('evidence-pack-absent')).toBe(true);
  });

  it('picks the newest pack by directory mtime, not by name order', () => {
    const evidenceDir = join(root, 'sessions', 's-1', 'evidence');
    // Name order and mtime order deliberately disagree: `ev_a` sorts first but
    // sealed last, so a name-based implementation fails this test.
    seedPack(evidenceDir, 'ev_c', ['run.log'], new Date(1_700_000_000_000));
    seedPack(evidenceDir, 'ev_b', ['run.log'], new Date(1_700_000_500_000));
    seedPack(evidenceDir, 'ev_a', ['annotated.png'], new Date(1_700_001_000_000));

    const listing = listArtifacts({
      family: 'ExecutionRun',
      sessionDir: join(root, 'sessions', 's-1'),
      cwd: root,
      diagnostics: sink,
    });
    expect(listing.dir).toBe(evidenceDir);
    expect(listing.pack?.id).toBe('ev_a');
    expect(listing.pack?.artifacts.map((a) => a.kind)).toEqual(['annotated']);
    expect(listing.packIds).toEqual(['ev_a', 'ev_b', 'ev_c']);
  });

  it('lists one file of every kind, including an unrecognised one', () => {
    const evidenceDir = join(root, '.testmuai', 'evidence');
    seedPack(
      evidenceDir,
      'ev_20260820T184011Z',
      [
        'annotated.png',
        'steps/step-4.png',
        'network.har',
        'console-step-1.ndjson',
        'run.log',
        'failure.yaml',
        'manifest.tar.zst',
      ],
      new Date(1_700_002_000_000),
    );

    const listing = listArtifacts({ family: 'ExecutionTestrun', cwd: root, diagnostics: sink });
    const pack = listing.pack;
    expect(pack).not.toBeNull();
    expect(pack?.dir).toBe(join(evidenceDir, 'ev_20260820T184011Z'));

    const byKind = new Map((pack?.artifacts ?? []).map((a) => [a.kind, a]));
    for (const kind of ARTIFACT_KINDS) expect(byKind.has(kind)).toBe(true);
    expect(byKind.get('other')?.name).toBe('manifest.tar.zst');
    expect(byKind.get('screenshot')?.name).toBe('steps/step-4.png');
    expect(pack?.artifacts).toHaveLength(7);

    for (const artifact of pack?.artifacts ?? []) {
      expect(artifact.path.endsWith(artifact.name.split('/').join(sep))).toBe(true);
      expect(artifact.bytes).toBeGreaterThan(0);
      expect(artifact.modifiedAt).not.toBeNull();
    }
    expect(sink.hasSeverity('error')).toBe(false);
  });

  it('treats a directory of loose files as the pack itself', () => {
    // The shape a `testrun` suite pack can take directly under
    // `<cwd>/.testmuai/evidence/`. Reporting "no evidence" for files that exist
    // would be the dishonesty this module exists to prevent.
    const evidenceDir = join(root, '.testmuai', 'evidence');
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(join(evidenceDir, 'failure.yaml'), 'category: functional\n');

    const listing = listArtifacts({ family: 'ExecutionTestrun', cwd: root, diagnostics: sink });
    expect(listing.pack?.id).toBe('evidence');
    expect(listing.pack?.artifacts.map((a) => a.kind)).toEqual(['failure-yaml']);
    expect(sink.has('evidence-pack-absent')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// What Kane actually seals, and what a sync client leaves behind
// ---------------------------------------------------------------------------

/** Write a sealed pack: a single `<id>.evidence` file, which is what Kane writes. */
function seedArchive(evidenceDir: string, id: string, mtime: Date): string {
  mkdirSync(evidenceDir, { recursive: true });
  const path = join(evidenceDir, `${id}.evidence`);
  // Real packs are zips of two to eleven megabytes; the bytes are irrelevant here
  // because this module never inflates one — that is `kane/packArchive.ts`.
  writeFileSync(path, 'PK\u0003\u0004 sealed pack bytes');
  utimesSync(path, mtime, mtime);
  return path;
}

describe('listArtifacts resolves the pack Kane sealed (§4.6, R4.13)', () => {
  const evidenceDir = () => join(root, '.testmuai', 'evidence');

  it('finds a sealed .evidence archive, which is a file and not a directory', () => {
    // The defect this closes: a resolver that considered only directories could
    // never see a pack, because `testrun run` writes one archive file. The only
    // directories under `.testmuai/evidence/` are extractions and conflict copies,
    // so every evidence reference the snapshot published was a dead link.
    seedArchive(evidenceDir(), 'defd438c', new Date('2026-08-21T13:18:00Z'));
    const listing = listArtifacts({ family: 'ExecutionTestrun', cwd: root, diagnostics: sink });

    expect(listing.pack?.id).toBe('defd438c.evidence');
    expect(listing.pack?.dir).toBe(join(evidenceDir(), 'defd438c.evidence'));
    expect(listing.pack?.archive).toBe(true);
    // Its members are inside the zip, and this module does not inflate. Naming
    // paths into an archive it had not read would be fabricating them (R6.11).
    expect(listing.pack?.artifacts).toEqual([]);
  });

  it('ignores an iCloud sync conflict copy, and resolves the pack it shadows', () => {
    // Measured on this repository: iCloud Drive resolves a write collision by
    // keeping both sides and appending an ordinal. The copy sorts *newest* because
    // the sync wrote it last, so newest-wins selected `<uuid> 2.evidence` — an id no
    // archive Kane wrote is named after, which cleared every reference downstream.
    seedArchive(evidenceDir(), 'defd438c', new Date('2026-08-21T13:18:00Z'));
    seedPack(evidenceDir(), 'defd438c 2.evidence', ['run.yaml'], new Date('2026-08-21T13:25:00Z'));

    const listing = listArtifacts({ family: 'ExecutionTestrun', cwd: root, diagnostics: sink });

    expect(listing.pack?.id).toBe('defd438c.evidence');
    expect(listing.packIds).toEqual(['defd438c.evidence']);
    const noted = sink.withCode('evidence-pack-conflict-copy');
    expect(noted).toHaveLength(1);
    expect(noted[0]?.message).toContain('defd438c 2.evidence');
    expect(noted[0]?.severity).toBe('info');
  });

  it('names conflict copies by shape, at every ordinal and with or without a suffix', () => {
    for (const name of ['pack 2.evidence', 'pack 3.evidence', 'pack 10', 'a b 2.evidence']) {
      expect(isSyncConflictCopy(name), name).toBe(true);
    }
    for (const name of [
      'defd438c-8f4d-4768-87c8-3cff627a2443.evidence',
      'ev_20260820T184011Z',
      'pack2.evidence',
      'pack-2.evidence',
      'v1.2.evidence',
    ]) {
      expect(isSyncConflictCopy(name), name).toBe(false);
    }
  });

  it('prefers this run own pack over whatever sealed last', () => {
    // Without the execution id, a run's evidence reference points at whatever
    // happened to seal most recently — which on a machine that has run the suite
    // several times is another run's pack. `testrun_done` carries `execution_id`
    // and Kane names the archive after it, so the right answer is available.
    seedArchive(evidenceDir(), 'mine', new Date('2026-08-21T13:00:00Z'));
    seedArchive(evidenceDir(), 'someone-elses', new Date('2026-08-21T13:30:00Z'));

    const newest = listArtifacts({ family: 'ExecutionTestrun', cwd: root, diagnostics: sink });
    expect(newest.pack?.id).toBe('someone-elses.evidence');

    const own = listArtifacts({
      family: 'ExecutionTestrun',
      cwd: root,
      executionId: 'mine',
      diagnostics: sink,
    });
    expect(own.pack?.id).toBe('mine.evidence');
    expect(sink.withCode('evidence-pack-not-this-run')).toHaveLength(0);
  });

  it('falls back to the newest pack and says so when this run sealed none', () => {
    seedArchive(evidenceDir(), 'somebody-else', new Date('2026-08-21T13:30:00Z'));
    const listing = listArtifacts({
      family: 'ExecutionTestrun',
      cwd: root,
      executionId: 'never-sealed',
      diagnostics: sink,
    });
    expect(listing.pack?.id).toBe('somebody-else.evidence');
    const warned = sink.withCode('evidence-pack-not-this-run');
    expect(warned).toHaveLength(1);
    expect(warned[0]?.message).toContain('never-sealed');
    expect(warned[0]?.severity).toBe('warn');
  });

  it('prefers the archive over an extraction of the same age', () => {
    // A directory beside an archive of the same name is an extraction of it. The
    // archive is the thing Kane wrote, so it wins the tie.
    const stamp = new Date('2026-08-21T13:18:00Z');
    seedArchive(evidenceDir(), 'both', stamp);
    seedPack(evidenceDir(), 'both', ['run.yaml'], stamp);
    const listing = listArtifacts({ family: 'ExecutionTestrun', cwd: root, diagnostics: sink });
    expect(listing.pack?.archive).toBe(true);
    expect(listing.pack?.id).toBe('both.evidence');
  });

  it('still reads an extracted pack directory, and reports it as not an archive', () => {
    // The older shape, and the one every in-memory fixture in this suite uses. It
    // keeps working: reading evidence that exists on disk beats reporting none.
    seedPack(evidenceDir(), 'ev_20260820T184011Z', ['failure.yaml', 'steps/step-3.png'],
      new Date('2026-08-20T18:40:40Z'));
    const listing = listArtifacts({ family: 'ExecutionTestrun', cwd: root, diagnostics: sink });
    expect(listing.pack?.archive).toBe(false);
    expect(listing.pack?.artifacts.map((a) => a.name)).toEqual([
      'failure.yaml',
      'steps/step-3.png',
    ]);
  });
});
