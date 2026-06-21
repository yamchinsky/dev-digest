import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { previewImport, ImportError } from '../src/modules/skills/import.js';
import { readZip, ZipReadError } from '../src/modules/skills/zip-reader.js';
import {
  MAX_SKILL_BODY_BYTES,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_ENTRY_BYTES,
  MAX_ZIP_TOTAL_BYTES,
} from '../src/modules/skills/constants.js';

/**
 * Skill import — unit tests over the markdown parser and zip-reader. The DB
 * side is covered by the routes integration test; here we exercise the
 * preview shape and the safety limits without booting Postgres.
 */

/** Build a minimal valid ZIP (STORE method) with one entry. Just enough format
 *  to test the reader's central-directory walk on a tiny, deterministic input. */
function buildStoreZip(entries: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const centralEntries: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = entry.data;
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0, 6); // flags
    lfh.writeUInt16LE(0, 8); // method = STORE
    lfh.writeUInt16LE(0, 10); // time
    lfh.writeUInt16LE(0, 12); // date
    lfh.writeUInt32LE(0, 14); // crc32 (skip; reader does not check)
    lfh.writeUInt32LE(data.length, 18); // compressed size
    lfh.writeUInt32LE(data.length, 22); // uncompressed size
    lfh.writeUInt16LE(name.length, 26); // name len
    lfh.writeUInt16LE(0, 28); // extra len
    parts.push(lfh, name, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10); // method = STORE
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(0, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk
    cd.writeUInt16LE(0, 36); // internal
    cd.writeUInt32LE(0, 38); // external
    cd.writeUInt32LE(offset, 42); // local header offset
    centralEntries.push(cd, name);

    offset += lfh.length + name.length + data.length;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of centralEntries) cdSize += c.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, ...centralEntries, eocd]);
}

describe('previewImport — markdown', () => {
  it('extracts name from first H1 and description from first paragraph', () => {
    const body = `# pr-quality-rubric\n\nFlags missing tests and weak assertions.\n\n## Rules\n- thing`;
    const [item] = previewImport({ filename: 'pr.md', buffer: Buffer.from(body, 'utf8') });
    expect(item.name).toBe('pr-quality-rubric');
    expect(item.description).toBe('Flags missing tests and weak assertions.');
    expect(item.type).toBe('rubric'); // inferred from "rubric" keyword in name
    expect(item.filename).toBe('pr.md');
  });

  it('falls back to filename slug when there is no H1', () => {
    const body = 'No heading here, just text.';
    const [item] = previewImport({ filename: 'My Cool Skill.md', buffer: Buffer.from(body, 'utf8') });
    expect(item.name).toBe('my-cool-skill');
    expect(item.description).toBe('');
  });

  it('strips a BOM at the start of the body', () => {
    const body = '﻿# bom-skill\n\nDesc';
    const [item] = previewImport({ filename: 'bom.md', buffer: Buffer.from(body, 'utf8') });
    expect(item.name).toBe('bom-skill');
    expect(item.body.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('rejects bodies above the per-skill size limit', () => {
    const giant = Buffer.alloc(MAX_SKILL_BODY_BYTES + 1, 'a');
    expect(() => previewImport({ filename: 'big.md', buffer: giant })).toThrow(ImportError);
  });

  it('rejects unsupported file types', () => {
    expect(() => previewImport({ filename: 'thing.pdf', buffer: Buffer.alloc(10) })).toThrow(
      /unsupported file type/i,
    );
  });
});

describe('previewImport — zip', () => {
  it('reads STORE-method entries from a hand-built zip', () => {
    const zip = buildStoreZip([
      { name: 'a.md', data: Buffer.from('# Alpha\nFirst', 'utf8') },
      { name: 'b.md', data: Buffer.from('# Beta\nSecond', 'utf8') },
    ]);
    const items = previewImport({ filename: 'two.zip', buffer: zip });
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.name).sort()).toEqual(['Alpha', 'Beta']);
  });

  it('filters out non-markdown entries and __MACOSX/ noise', () => {
    const zip = buildStoreZip([
      { name: '__MACOSX/._meta', data: Buffer.from('binary', 'utf8') },
      { name: 'README.md', data: Buffer.from('# Doc', 'utf8') },
      { name: '.hidden.md', data: Buffer.from('# hidden', 'utf8') },
      { name: 'logo.png', data: Buffer.from('binary', 'utf8') },
    ]);
    const items = previewImport({ filename: 'mix.zip', buffer: zip });
    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe('Doc');
  });

  it('errors when an entry exceeds maxEntrySize', () => {
    const tooBig = Buffer.alloc(MAX_ZIP_ENTRY_BYTES + 1, 'x');
    const zip = buildStoreZip([{ name: 'big.md', data: tooBig }]);
    expect(() => previewImport({ filename: 'too.zip', buffer: zip })).toThrow(ImportError);
  });

  it('errors when total uncompressed size exceeds maxTotalSize', () => {
    // Each entry must stay under maxEntrySize, but together overflow maxTotalSize.
    const per = Math.floor((MAX_ZIP_TOTAL_BYTES / 6) + 1); // ~175KB ea; 6 × ~175KB ≈ 1.05MB
    const chunk = Buffer.alloc(per, 'x');
    expect(per).toBeLessThan(MAX_ZIP_ENTRY_BYTES);
    const zip = buildStoreZip(
      Array.from({ length: 6 }, (_, i) => ({ name: `e${i}.md`, data: chunk })),
    );
    expect(() => previewImport({ filename: 'many.zip', buffer: zip })).toThrow(/total size/i);
  });

  it('errors when there are too many entries', () => {
    const zip = buildStoreZip(
      Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, i) => ({
        name: `e${i}.md`,
        data: Buffer.from('# x'),
      })),
    );
    expect(() => previewImport({ filename: 'huge.zip', buffer: zip })).toThrow(/too many entries/i);
  });

  it('errors when there are no markdown files in the archive', () => {
    const zip = buildStoreZip([{ name: 'a.png', data: Buffer.from('img') }]);
    expect(() => previewImport({ filename: 'empty.zip', buffer: zip })).toThrow(/no markdown/i);
  });

  it('readZip rejects bytes that are not a zip', () => {
    expect(() =>
      readZip(Buffer.from('not-a-zip'), {
        maxEntries: MAX_ZIP_ENTRIES,
        maxEntrySize: MAX_ZIP_ENTRY_BYTES,
        maxTotalSize: MAX_ZIP_TOTAL_BYTES,
      }),
    ).toThrow(ZipReadError);
  });
});

describe('readZip — DEFLATE entries', () => {
  it('decodes a DEFLATE entry written by node:zlib', () => {
    const raw = Buffer.from('# deflated\nbody text', 'utf8');
    const deflated = deflateRawSync(raw);

    // Build a minimal zip whose single entry uses method=8 (DEFLATE).
    const name = Buffer.from('d.md', 'utf8');
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(8, 8); // DEFLATE
    lfh.writeUInt32LE(0, 14);
    lfh.writeUInt32LE(deflated.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(name.length, 26);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10); // DEFLATE
    cd.writeUInt32LE(deflated.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(0, 42);

    const fileBlob = Buffer.concat([lfh, name, deflated]);
    const cdBlob = Buffer.concat([cd, name]);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cdBlob.length, 12);
    eocd.writeUInt32LE(fileBlob.length, 16);

    const zip = Buffer.concat([fileBlob, cdBlob, eocd]);
    const entries = readZip(zip, {
      maxEntries: MAX_ZIP_ENTRIES,
      maxEntrySize: MAX_ZIP_ENTRY_BYTES,
      maxTotalSize: MAX_ZIP_TOTAL_BYTES,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.data.toString('utf8')).toBe(raw.toString('utf8'));
  });
});
