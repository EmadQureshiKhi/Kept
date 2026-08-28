/**
 * The sealed-pack zip reader (design §4.6, §15.3, R6.7, R13.4).
 *
 * These assertions moved here with the reader itself: it was written for
 * `kept snapshot`'s evidence curation and now has a second caller in
 * `kane/packTriage.ts`, which reads the triage note that decides a repair branch.
 * A format reader with two callers — one of them routing logic — belongs beside
 * the evidence resolver, and its tests belong with it.
 *
 * The archives are built byte by byte (`./pack-archive.ts`), because sealed packs
 * are gitignored megabytes and a fixture could not cover a truncated archive, an
 * unsupported method or a directory entry anyway.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PackFormatError, readPackEntries } from 'kept-core';
import { describe, expect, it } from 'vitest';

import { PACK_SLUG, bytesOf, concat, realisticPack, zipOf } from './pack-archive.js';

function textOf(bytes: Uint8Array | undefined): string {
  return Buffer.from(bytes ?? new Uint8Array()).toString('utf8');
}

describe('reading a sealed pack, which is a zip file and not a directory', () => {
  it('reads stored and deflated entries alike, and skips directory entries', () => {
    const entries = readPackEntries(realisticPack());
    expect(entries.map((entry) => entry.name)).not.toContain(`${PACK_SLUG}/steps/`);
    const shot = entries.find((entry) => entry.name.endsWith('9-2-4/screenshot.jpg'));
    const annotated = entries.find((entry) => entry.name.endsWith('annotated.png'));
    expect(textOf(shot?.bytes)).toBe('step-9-shot');
    expect(textOf(annotated?.bytes)).toBe('annotated-capture');
  });

  it('refuses anything that is not an archive, by name rather than half-read', () => {
    expect(() => readPackEntries(bytesOf('this is a png, not a zip'))).toThrow(
      /not a zip archive/,
    );
    expect(() => readPackEntries(bytesOf('this is a png, not a zip'))).toThrow(PackFormatError);
  });

  it('refuses a truncated archive rather than publishing a corrupt artefact', () => {
    const whole = realisticPack();
    // Keep the end record so the directory is found, then cut the data out from
    // under it: the failure must be diagnosed, not decoded into garbage.
    const cut = concat([whole.subarray(0, 8), whole.subarray(64)]);
    expect(() => readPackEntries(cut)).toThrow();
  });

  it('refuses a compression method it cannot decode, naming the entry', () => {
    // Method six is implode: real zip, not something `node:zlib` reads.
    const archive = zipOf([{ name: 'run.yaml', bytes: bytesOf('x'), method: 0 }]);
    // Flip the central directory's method field to six. The directory sits
    // immediately after the single local record, and the field is at offset ten.
    const localLength = 30 + 'run.yaml'.length + 1;
    archive[localLength + 10] = 6;
    expect(() => readPackEntries(archive)).toThrow(/compression method 6/);
  });
});

describe('the selector, which is what makes reading one note out of a pack cheap', () => {
  it('inflates only the entries asked for, and still walks the whole directory', () => {
    const entries = readPackEntries(realisticPack(), {
      select: (name) => name.endsWith('failure.yaml'),
    });
    expect(entries.map((entry) => entry.name)).toEqual([
      `${PACK_SLUG}/steps/15-4-3/failure.yaml`,
    ]);
    expect(textOf(entries[0]?.bytes)).toContain('application_issue/ui_data_defect');
  });

  it('selecting nothing is an empty answer, not a failure', () => {
    expect(readPackEntries(realisticPack(), { select: () => false })).toEqual([]);
  });

  it('still refuses a corrupt archive even when nothing is selected', () => {
    // The integrity of the archive is checked whatever is wanted from it: a
    // selective read that quietly succeeded on a broken pack would report "no
    // triage note" for a pack that has one.
    expect(() =>
      readPackEntries(bytesOf('not a zip at all'), { select: () => false }),
    ).toThrow(PackFormatError);
  });
});

describe('the reader against real Kane bytes, when this machine has any', () => {
  /**
   * The one assertion that cannot be committed as a fixture.
   *
   * `.testmuai/evidence/` is gitignored — the packs are megabytes each — so on a
   * clone there is nothing here to read and this test says so rather than passing
   * quietly on a synthetic input it has already covered above. On the machine that
   * authored the corpus it reads a genuine sealed pack and proves the reader
   * against Kane's own bytes, which is the only place the archive's real
   * compression, entry order and nesting are exercised.
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
    expect(entries.some((entry) => /\/steps\/[^/]+\/screenshot\.jpg$/.test(entry.name))).toBe(
      true,
    );
  });

  it.skipIf(archives.length === 0)('reads one note out of a real pack without inflating it all', () => {
    const path = archives[archives.length - 1] ?? '';
    const bytes = readFileSync(path);
    const whole = readPackEntries(bytes);
    const selected = readPackEntries(bytes, { select: (name) => name.endsWith('run.yaml') });
    expect(selected.length).toBeLessThanOrEqual(whole.length);
    expect(selected.every((entry) => entry.name.endsWith('run.yaml'))).toBe(true);
  });
});
