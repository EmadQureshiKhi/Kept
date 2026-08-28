/**
 * The sealed-pack reader: enough of the zip format to open one `.evidence` file,
 * and no more (design §4.6, §15.3, R6.7, R13.4).
 *
 * ## Why this lives in the core package
 *
 * A sealed pack is a **single `.evidence` zip file**, not a directory —
 * `kane/evidence.ts` walks a pack *directory* and therefore resolves nothing
 * inside one. The reader below was written for `kept snapshot`, which curates the
 * artefacts a judge clicks, and it now has a second caller with a much sharper
 * need: `kane/packTriage.ts` reads the **triage note** out of the archive, and
 * that note decides the repair branch. Two callers, one of them core routing
 * logic, so the reader belongs beside the evidence resolver rather than inside a
 * CLI command; `@corgod/kept-cli`'s command imports it from here rather than keeping a
 * second copy, because two zip readers is how one of them quietly stops matching
 * the format.
 *
 * ## What it does and does not read
 *
 * Kane's packs are ordinary single-disk archives whose entries are stored
 * (method zero) or deflated (method eight), so `node:zlib`'s raw inflate is the
 * whole decompressor — **no dependency is added and no `unzip` is spawned**,
 * which is why the runtime budget is unchanged by evidence handling.
 *
 * A zip64 archive, an unsupported compression method, a bad signature or a
 * truncated file is refused **by name** through {@link PackFormatError} rather
 * than half-read. That refusal is the point: a pack decoded into garbage would
 * look like evidence until a judge clicked it, and a triage note decoded into
 * garbage would route a repair.
 */

import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** A zip comment is at most this long, so the end record is within the tail. */
const MAX_EOCD_SEARCH = 0xffff + 22;
const ZIP64_SENTINEL_32 = 0xffffffff;
const ZIP64_SENTINEL_16 = 0xffff;
/** Stored: the entry's bytes are its data. */
const METHOD_STORED = 0;
/** Deflated: raw inflate, which `node:zlib` already has. */
const METHOD_DEFLATED = 8;

/** One file recovered from a sealed pack. */
export interface PackEntry {
  /** Path inside the archive, POSIX separators. */
  readonly name: string;
  readonly bytes: Uint8Array;
}

/**
 * Thrown for an input this reader will not decode. Callers turn it into a
 * diagnostic; nothing in KEPT lets it escape to a user (design §14.2).
 */
export class PackFormatError extends Error {}

/** {@link readPackEntries} options. */
export interface ReadPackOptions {
  /**
   * Which entries to decompress, by name.
   *
   * The central directory is always walked in full — the archive's integrity is
   * checked whatever is wanted from it — but only selected entries are inflated.
   * That matters for the triage read: a pack is one to ten megabytes of HARs,
   * console streams and agent trajectories, and the note that decides a repair
   * branch is a few hundred bytes. Omit it and every entry is returned, which is
   * what the curation step wants.
   */
  readonly select?: ((name: string) => boolean) | undefined;
}

function readU16(bytes: Uint8Array, at: number): number {
  const a = bytes[at];
  const b = bytes[at + 1];
  if (a === undefined || b === undefined) throw new PackFormatError('archive ends mid-field');
  return a | (b << 8);
}

function readU32(bytes: Uint8Array, at: number): number {
  const a = bytes[at];
  const b = bytes[at + 1];
  const c = bytes[at + 2];
  const d = bytes[at + 3];
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw new PackFormatError('archive ends mid-field');
  }
  return (a | (b << 8) | (c << 16) | (d << 24)) >>> 0;
}

/** Locate the end-of-central-directory record by scanning the tail backwards. */
function findEndRecord(bytes: Uint8Array): number {
  const floor = Math.max(0, bytes.length - MAX_EOCD_SEARCH);
  for (let at = bytes.length - 22; at >= floor; at -= 1) {
    if (readU32(bytes, at) === EOCD_SIGNATURE) return at;
  }
  throw new PackFormatError('no end-of-central-directory record: this is not a zip archive');
}

/**
 * The entries of a sealed pack, decompressed, in central-directory order.
 *
 * Exported because the unit suite builds archives byte by byte and asserts this
 * reader against them, which is the only way to test a format reader without a
 * fixture nobody can regenerate — sealed packs are gitignored, being megabytes
 * each.
 */
export function readPackEntries(
  bytes: Uint8Array,
  options: ReadPackOptions = {},
): readonly PackEntry[] {
  const end = findEndRecord(bytes);
  const entryCount = readU16(bytes, end + 10);
  const directoryOffset = readU32(bytes, end + 16);
  if (entryCount === ZIP64_SENTINEL_16 || directoryOffset === ZIP64_SENTINEL_32) {
    throw new PackFormatError('zip64 archive: not supported, and no pack this size is curated');
  }

  const decoder = new TextDecoder();
  const entries: PackEntry[] = [];
  let cursor = directoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(bytes, cursor) !== CENTRAL_SIGNATURE) {
      throw new PackFormatError(`central directory entry ${index} has the wrong signature`);
    }
    const method = readU16(bytes, cursor + 10);
    const compressedSize = readU32(bytes, cursor + 20);
    const nameLength = readU16(bytes, cursor + 28);
    const extraLength = readU16(bytes, cursor + 30);
    const commentLength = readU16(bytes, cursor + 32);
    const localOffset = readU32(bytes, cursor + 42);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;

    // A directory entry carries no data and needs none: a caller that writes
    // these out creates whatever directories the surviving names imply.
    if (name.endsWith('/')) continue;
    if (options.select !== undefined && !options.select(name)) continue;

    if (readU32(bytes, localOffset) !== LOCAL_SIGNATURE) {
      throw new PackFormatError(`local header for ${name} has the wrong signature`);
    }
    const localNameLength = readU16(bytes, localOffset + 26);
    const localExtraLength = readU16(bytes, localOffset + 28);
    const dataAt = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataAt, dataAt + compressedSize);
    if (raw.length < compressedSize) {
      throw new PackFormatError(`${name} is truncated: the archive ends inside its data`);
    }

    if (method === METHOD_STORED) {
      entries.push({ name, bytes: raw });
    } else if (method === METHOD_DEFLATED) {
      entries.push({ name, bytes: inflateRawSync(raw) });
    } else {
      throw new PackFormatError(`${name} uses compression method ${method}, which is not read`);
    }
  }

  return entries;
}
