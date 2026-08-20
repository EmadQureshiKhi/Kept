import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ARTIFACT_KINDS,
  classifyArtifact,
  createDiagnosticSink,
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
