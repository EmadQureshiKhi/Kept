/**
 * Zip archives, built byte by byte — the shared input for every sealed-pack test.
 *
 * **Why nothing here is a fixture.** A sealed pack is a single `.evidence` zip file
 * and `.testmuai/evidence/` is gitignored, because the packs are one to ten
 * megabytes each; committing one to test a format reader would defeat the reason
 * the directory is ignored. So these builders assemble real single-disk archives in
 * the exact shape Kane's packs have — the layout, entry names and nesting below
 * were read off `.testmuai/evidence/0944d075-8dab-4683-a59f-96e51308697c.evidence`
 * (the red run of `docs/kane/loop/`) and
 * `20091f19-2681-44ca-bc81-81c9e0a4587d.evidence` (where `annotated.png` appears).
 *
 * Building rather than committing also reaches inputs a fixture never could:
 * stored entries, deflated entries, a directory entry, a truncated archive, and a
 * hostile entry name.
 *
 * Deliberately hand-rolled. The point of the reader under test is that it needs no
 * unzip dependency, and a test that reached for one to build its input would be
 * asserting the dependency's agreement with itself.
 */

import { deflateRawSync } from 'node:zlib';

/** One planned archive member. */
export interface PlannedEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
  /** Stored or deflated — Kane's packs use both. */
  readonly method: 0 | 8;
}

export function bytesOf(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'utf8'));
}

export function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff]);
}

export function u32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A single-disk zip archive holding exactly the planned entries. */
export function zipOf(planned: readonly PlannedEntry[]): Uint8Array {
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

/** The slug of the pack's one test directory, as Kane spells one. */
export const PACK_SLUG = 'tests/cart-discount-27eaa1da';

/** A pack in the real shape: two curated kinds, and bulk that must not be copied. */
export function realisticPack(): Uint8Array {
  return zipOf([
    { name: `${PACK_SLUG}/steps/`, bytes: new Uint8Array(0), method: 0 },
    {
      name: `${PACK_SLUG}/steps/8-2-3/annotated.png`,
      bytes: bytesOf('annotated-capture'),
      method: 8,
    },
    {
      name: `${PACK_SLUG}/steps/8-2-3/screenshot.jpg`,
      bytes: bytesOf('step-8-shot'),
      method: 8,
    },
    { name: `${PACK_SLUG}/steps/9-2-4/screenshot.jpg`, bytes: bytesOf('step-9-shot'), method: 0 },
    {
      name: `${PACK_SLUG}/steps/15-4-3/failure.yaml`,
      bytes: bytesOf('triage:\n  rca:\n    category: application_issue/ui_data_defect\n'),
      method: 8,
    },
    { name: `${PACK_SLUG}/logs/0-network.har`, bytes: bytesOf('x'.repeat(4096)), method: 8 },
    { name: `${PACK_SLUG}/logs/0-run.log`, bytes: bytesOf('runner noise'), method: 8 },
    { name: `${PACK_SLUG}/auteur/execution.json`, bytes: bytesOf('{"big":true}'), method: 8 },
    { name: `${PACK_SLUG}/v16-trajectory/0-run_summary.json`, bytes: bytesOf('{}'), method: 8 },
    { name: 'run.yaml', bytes: bytesOf('broken: 1\nfailed: 0\n'), method: 8 },
  ]);
}
