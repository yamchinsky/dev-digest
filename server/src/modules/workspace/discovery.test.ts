/**
 * Hermetic unit tests for discoverContextDocs() — discovery.ts
 *
 * Pure filesystem utility: no DB, no Docker, no network. All assertions run
 * against a real temp directory created and cleaned up per test.
 *
 * Scenarios covered:
 *   D1 — discovers .md files directly in specs/, docs/, insights/
 *   D2 — discovers .md files in subdirectories under specs/ docs/ insights/
 *   D3 — discovers docs nested deeper (specs/sub/deep/file.md)
 *   D4 — skips non-.md files (e.g. .txt, .ts) even under the right directory
 *   D5 — skips .md files outside specs/docs/insights segments (README.md, src/code.md)
 *   D6 — derives correct category from the first matching segment
 *   D7 — handles a segment nested under an unrelated prefix (src/docs/guide.md → docs)
 *   D8 — null clonePath → empty array, no exception (AC-2)
 *   D9 — non-existent clonePath → empty array, no exception (AC-2)
 *   D10 — multiple repos in one call; results are tagged with the correct repoId
 *   D11 — repo with null clonePath mixed with a valid repo → only valid repo results
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { discoverContextDocs } from './discovery.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function mkTmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'discovery-test-'));
}

async function writeFile(base: string, relPath: string, content = 'test'): Promise<void> {
  const full = path.join(base, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('discoverContextDocs', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
  });

  async function mkRepo(): Promise<string> {
    const dir = await mkTmp();
    tempDirs.push(dir);
    return dir;
  }

  // D1 — files directly inside the category directories
  it('D1: discovers .md files directly in specs/, docs/, insights/', async () => {
    const dir = await mkRepo();
    await writeFile(dir, 'specs/api.md', '# API');
    await writeFile(dir, 'docs/guide.md', '# Guide');
    await writeFile(dir, 'insights/notes.md', '# Notes');

    const result = await discoverContextDocs([{ repoId: 'r1', clonePath: dir }]);
    const paths = result.map((r) => r.relativePath).sort();

    expect(paths).toContain('specs/api.md');
    expect(paths).toContain('docs/guide.md');
    expect(paths).toContain('insights/notes.md');
    expect(paths).toHaveLength(3);
  });

  // D2 — files in subdirectories under the category directories
  it('D2: discovers .md files in subdirectories under category directories', async () => {
    const dir = await mkRepo();
    await writeFile(dir, 'docs/architecture/overview.md', '# Arch');
    await writeFile(dir, 'specs/endpoints/auth.md', '# Auth');

    const result = await discoverContextDocs([{ repoId: 'r1', clonePath: dir }]);
    const paths = result.map((r) => r.relativePath).sort();

    expect(paths).toContain('docs/architecture/overview.md');
    expect(paths).toContain('specs/endpoints/auth.md');
  });

  // D3 — deeply nested paths
  it('D3: discovers .md files nested multiple levels deep', async () => {
    const dir = await mkRepo();
    await writeFile(dir, 'specs/sub/deep/file.md', '# Deep');

    const result = await discoverContextDocs([{ repoId: 'r1', clonePath: dir }]);
    expect(result.map((r) => r.relativePath)).toContain('specs/sub/deep/file.md');
  });

  // D4 — non-.md files should be excluded
  it('D4: skips non-.md files even under the right directory', async () => {
    const dir = await mkRepo();
    await writeFile(dir, 'specs/api.ts', 'export {}');
    await writeFile(dir, 'docs/guide.txt', 'text');
    await writeFile(dir, 'specs/api.md', '# API'); // only this should match

    const result = await discoverContextDocs([{ repoId: 'r1', clonePath: dir }]);
    expect(result).toHaveLength(1);
    expect(result[0]!.relativePath).toBe('specs/api.md');
  });

  // D5 — files outside the category directories should be excluded
  it('D5: skips .md files outside specs/docs/insights segments', async () => {
    const dir = await mkRepo();
    await writeFile(dir, 'README.md', '# Root');
    await writeFile(dir, 'src/code.md', '# Code');
    await writeFile(dir, 'src/components/api.md', '# API');
    await writeFile(dir, 'specs/valid.md', '# Valid'); // only this matches

    const result = await discoverContextDocs([{ repoId: 'r1', clonePath: dir }]);
    const paths = result.map((r) => r.relativePath);

    expect(paths).toContain('specs/valid.md');
    expect(paths).not.toContain('README.md');
    expect(paths).not.toContain('src/code.md');
    expect(paths).not.toContain('src/components/api.md');
  });

  // D6 — correct category derivation
  it('D6: derives correct category from the first matching path segment', async () => {
    const dir = await mkRepo();
    await writeFile(dir, 'specs/a.md', 'a');
    await writeFile(dir, 'docs/b.md', 'b');
    await writeFile(dir, 'insights/c.md', 'c');

    const result = await discoverContextDocs([{ repoId: 'r1', clonePath: dir }]);
    const byPath = new Map(result.map((r) => [r.relativePath, r]));

    expect(byPath.get('specs/a.md')?.category).toBe('specs');
    expect(byPath.get('docs/b.md')?.category).toBe('docs');
    expect(byPath.get('insights/c.md')?.category).toBe('insights');
  });

  // D7 — category from a segment nested under an unrelated prefix
  it('D7: derives category correctly when docs/insights/specs appear after an unrelated prefix', async () => {
    const dir = await mkRepo();
    await writeFile(dir, 'src/docs/architecture.md', '# Arch');
    await writeFile(dir, 'packages/lib/insights/perf.md', '# Perf');

    const result = await discoverContextDocs([{ repoId: 'r1', clonePath: dir }]);
    const byPath = new Map(result.map((r) => [r.relativePath, r]));

    expect(byPath.get('src/docs/architecture.md')?.category).toBe('docs');
    expect(byPath.get('packages/lib/insights/perf.md')?.category).toBe('insights');
  });

  // D8 — null clonePath → empty array, no exception (AC-2)
  it('D8: returns empty array when clonePath is null — no exception', async () => {
    const result = await discoverContextDocs([{ repoId: 'r1', clonePath: null }]);
    expect(result).toEqual([]);
  });

  // D9 — non-existent clonePath → empty array, no exception (AC-2)
  it('D9: returns empty array when clonePath does not exist on disk — no exception', async () => {
    const result = await discoverContextDocs([
      { repoId: 'r1', clonePath: '/this/path/does/not/exist/xyz123' },
    ]);
    expect(result).toEqual([]);
  });

  // D10 — multiple repos in one call
  it('D10: handles multiple repos and tags each result with the correct repoId', async () => {
    const dir1 = await mkRepo();
    const dir2 = await mkRepo();

    await writeFile(dir1, 'specs/a.md', 'a');
    await writeFile(dir2, 'docs/b.md', 'b');

    const result = await discoverContextDocs([
      { repoId: 'repo-1', clonePath: dir1 },
      { repoId: 'repo-2', clonePath: dir2 },
    ]);

    const forRepo1 = result.filter((r) => r.repoId === 'repo-1');
    const forRepo2 = result.filter((r) => r.repoId === 'repo-2');

    expect(forRepo1).toHaveLength(1);
    expect(forRepo1[0]!.relativePath).toBe('specs/a.md');
    expect(forRepo2).toHaveLength(1);
    expect(forRepo2[0]!.relativePath).toBe('docs/b.md');
  });

  // D11 — mixed null and valid repos
  it('D11: skips null clonePath entries, still returns results for valid repos', async () => {
    const dir = await mkRepo();
    await writeFile(dir, 'insights/notes.md', 'notes');

    const result = await discoverContextDocs([
      { repoId: 'null-repo', clonePath: null },
      { repoId: 'valid-repo', clonePath: dir },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.repoId).toBe('valid-repo');
    expect(result[0]!.relativePath).toBe('insights/notes.md');
  });
});
