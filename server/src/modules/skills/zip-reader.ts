import { inflateRawSync } from 'node:zlib';

/**
 * Tiny ZIP reader for skill imports. Uses only `node:zlib` (no new dependency
 * — server/package.json is skip-worktree and not the right place to add deps).
 *
 * Supports STORE (method 0) and DEFLATE (method 8), which together cover
 * essentially every zip created by zip(1), 7z, Finder, or `zipfile` in Python.
 * We parse the End-of-Central-Directory record, walk the central directory, and
 * decompress entries one by one — applying size/count limits as we go so a
 * malicious archive can't blow memory.
 *
 * Out of scope: zip64 (>4GB archives), encrypted zips, multi-disk archives —
 * skill imports are small markdown collections, not artifacts.
 */

export interface ZipEntry {
  /** Path as stored in the archive (slashes preserved). */
  name: string;
  /** Decompressed bytes. Empty if the entry is a directory. */
  data: Buffer;
}

export interface ZipReadOptions {
  /** Max number of central-directory entries to consider. */
  maxEntries: number;
  /** Max decompressed size for a single entry, in bytes. */
  maxEntrySize: number;
  /** Max total decompressed size across all kept entries, in bytes. */
  maxTotalSize: number;
}

export class ZipReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipReadError';
  }
}

const SIG_EOCD = 0x06054b50;
const SIG_CD = 0x02014b50;
const SIG_LFH = 0x04034b50;

const MAX_EOCD_SCAN = 65_536 + 22; // EOCD lives in the last 64KB + its own 22 bytes

interface Eocd {
  cdSize: number;
  cdOffset: number;
  totalEntries: number;
}

function findEocd(buf: Buffer): Eocd {
  const minStart = Math.max(0, buf.length - MAX_EOCD_SCAN);
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      return {
        totalEntries: buf.readUInt16LE(i + 10),
        cdSize: buf.readUInt32LE(i + 12),
        cdOffset: buf.readUInt32LE(i + 16),
      };
    }
  }
  throw new ZipReadError('not a zip (no end-of-central-directory record)');
}

/** Read the named entry's bytes by locating its local file header from `cdOffset`. */
function extractEntry(buf: Buffer, cdEntryOffset: number, maxEntrySize: number): ZipEntry {
  // Central-directory entry fields we need.
  const method = buf.readUInt16LE(cdEntryOffset + 10);
  const compressedSize = buf.readUInt32LE(cdEntryOffset + 20);
  const uncompressedSize = buf.readUInt32LE(cdEntryOffset + 24);
  const nameLen = buf.readUInt16LE(cdEntryOffset + 28);
  const extraLen = buf.readUInt16LE(cdEntryOffset + 30);
  const commentLen = buf.readUInt16LE(cdEntryOffset + 32);
  const localHeaderOffset = buf.readUInt32LE(cdEntryOffset + 42);
  const name = buf.toString('utf8', cdEntryOffset + 46, cdEntryOffset + 46 + nameLen);

  if (uncompressedSize > maxEntrySize) {
    throw new ZipReadError(`entry "${name}" exceeds size limit (${uncompressedSize} > ${maxEntrySize})`);
  }

  // Walk to the local file header to read its variable-length name+extra (only
  // these fields are authoritative for where the file data actually starts —
  // the CD copies are unreliable when an archiver rewrites them).
  if (buf.readUInt32LE(localHeaderOffset) !== SIG_LFH) {
    throw new ZipReadError(`corrupt local file header for "${name}"`);
  }
  const lfhNameLen = buf.readUInt16LE(localHeaderOffset + 26);
  const lfhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;

  // Directory entry — zero compressed size + trailing slash. Skip the data read.
  if (name.endsWith('/') && compressedSize === 0) {
    return { name, data: Buffer.alloc(0) };
  }

  if (dataStart + compressedSize > buf.length) {
    throw new ZipReadError(`truncated data for "${name}"`);
  }

  const compressed = buf.subarray(dataStart, dataStart + compressedSize);
  let data: Buffer;
  if (method === 0) {
    data = Buffer.from(compressed); // STORE
  } else if (method === 8) {
    data = inflateRawSync(compressed); // DEFLATE
  } else {
    throw new ZipReadError(`unsupported compression method ${method} for "${name}"`);
  }

  if (data.length > maxEntrySize) {
    // Defensive: the CD claimed a smaller uncompressed size than the actual
    // inflated output (zip-bomb shape). Reject.
    throw new ZipReadError(`entry "${name}" inflates beyond size limit`);
  }

  void commentLen;
  void extraLen;
  return { name, data };
}

export function readZip(buf: Buffer, options: ZipReadOptions): ZipEntry[] {
  const { maxEntries, maxEntrySize, maxTotalSize } = options;
  const eocd = findEocd(buf);

  if (eocd.totalEntries > maxEntries) {
    throw new ZipReadError(`archive has too many entries (${eocd.totalEntries} > ${maxEntries})`);
  }

  let offset = eocd.cdOffset;
  const end = eocd.cdOffset + eocd.cdSize;
  const entries: ZipEntry[] = [];
  let totalSize = 0;

  while (offset < end) {
    if (buf.readUInt32LE(offset) !== SIG_CD) {
      throw new ZipReadError('corrupt central directory');
    }
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);

    const entry = extractEntry(buf, offset, maxEntrySize);
    if (entry.data.length > 0) {
      totalSize += entry.data.length;
      if (totalSize > maxTotalSize) {
        throw new ZipReadError(`archive exceeds total size limit (${totalSize} > ${maxTotalSize})`);
      }
      entries.push(entry);
    }

    offset += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}
