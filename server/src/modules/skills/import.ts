import type { ImportPreviewItem, SkillType } from '@devdigest/shared';
import { readZip, ZipReadError } from './zip-reader.js';
import {
  MAX_SKILL_BODY_BYTES,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_ENTRY_BYTES,
  MAX_ZIP_TOTAL_BYTES,
} from './constants.js';

/**
 * Skill import — turn an uploaded `.md` or `.zip` into a preview list, without
 * touching the DB. The route hands previewed items back to the client; only
 * after the user accepts the trust warning does the commit endpoint persist
 * them. We never run, eval, or expand anything from an imported file —
 * skill bodies are inert markdown that the LLM later reads as rules.
 */

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

const MD_EXTENSIONS = ['.md', '.markdown', '.txt'];

function basenameNoExt(filename: string): string {
  const base = filename.replace(/\\/g, '/').split('/').pop() ?? filename;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function hasMarkdownExt(filename: string): boolean {
  const lower = filename.toLowerCase();
  return MD_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Slugify a name into a stable, lowercase, dash-separated identifier. We don't
 * use this as a DB key (uuid handles that), only as the *display name* fallback
 * when the markdown lacks an `# H1`.
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'imported-skill';
}

/**
 * Pull a skill's `name` and `description` from the markdown body:
 *   - name        = the first `# H1` line if present, else slug(filename).
 *   - description = the first non-empty paragraph after the H1, trimmed.
 *
 * If no description can be derived, returns ''. The route's commit step lets
 * the client fill it in before saving — better than fabricating one.
 */
function parseFrontMatter(body: string, filename: string): { name: string; description: string } {
  const lines = body.split(/\r?\n/);
  let name = '';
  let descLines: string[] = [];
  let stage: 'before-h1' | 'collecting-desc' | 'done' = 'before-h1';

  for (const line of lines) {
    if (stage === 'before-h1') {
      const m = /^#\s+(.+?)\s*$/.exec(line);
      if (m) {
        name = m[1]!.trim();
        stage = 'collecting-desc';
      }
      continue;
    }
    if (stage === 'collecting-desc') {
      if (line.trim() === '') {
        if (descLines.length === 0) continue; // skip leading blank lines
        stage = 'done';
        break;
      }
      if (/^#{1,6}\s/.test(line)) {
        // Second heading — paragraph is over (and we never started one).
        break;
      }
      descLines.push(line.trim());
    }
  }

  if (!name) name = slugify(basenameNoExt(filename));
  return { name, description: descLines.join(' ').slice(0, 2000) };
}

/**
 * Infer a skill type from the markdown body / filename. Defaults to 'custom';
 * the user is expected to fix the type in the import preview before commit.
 * Lightweight keyword sniffing only — not a classifier.
 */
function inferType(body: string, filename: string): SkillType {
  const hay = (filename + '\n' + body.slice(0, 1024)).toLowerCase();
  if (/security|cve|injection|auth|secret/.test(hay)) return 'security';
  if (/convention|style|naming|formatting/.test(hay)) return 'convention';
  if (/rubric|checklist|grading/.test(hay)) return 'rubric';
  return 'custom';
}

function buildItem(filename: string | null, body: string): ImportPreviewItem {
  const displayFilename = filename ?? 'skill.md';
  const { name, description } = parseFrontMatter(body, displayFilename);
  return {
    filename,
    name,
    description,
    type: inferType(body, displayFilename),
    body,
  };
}

export interface ImportInput {
  filename: string;
  buffer: Buffer;
}

/**
 * Parse a single .md upload into a one-item preview.
 * Strips a UTF-8 BOM if present — some editors save them by default and zod
 * `.min(1)` would still pass, but markdown renderers don't strip them either.
 */
export function previewMarkdown(input: ImportInput): ImportPreviewItem[] {
  if (input.buffer.length > MAX_SKILL_BODY_BYTES) {
    throw new ImportError(`markdown body exceeds size limit (${input.buffer.length} > ${MAX_SKILL_BODY_BYTES})`);
  }
  let body = input.buffer.toString('utf8');
  if (body.charCodeAt(0) === 0xfeff) body = body.slice(1);
  return [buildItem(input.filename, body)];
}

/** Decompress the zip, drop anything that isn't a markdown text file, parse each. */
export function previewZip(input: ImportInput): ImportPreviewItem[] {
  let entries;
  try {
    entries = readZip(input.buffer, {
      maxEntries: MAX_ZIP_ENTRIES,
      maxEntrySize: MAX_ZIP_ENTRY_BYTES,
      maxTotalSize: MAX_ZIP_TOTAL_BYTES,
    });
  } catch (err) {
    if (err instanceof ZipReadError) throw new ImportError(`invalid archive: ${err.message}`);
    throw err;
  }

  const items: ImportPreviewItem[] = [];
  for (const entry of entries) {
    // Skip macOS resource forks / hidden files / nested directories' index files.
    if (entry.name.includes('__MACOSX/')) continue;
    const base = entry.name.split('/').pop() ?? '';
    if (base.startsWith('.')) continue;
    if (!hasMarkdownExt(entry.name)) continue;

    let text = entry.data.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    items.push(buildItem(entry.name, text));
  }

  if (items.length === 0) {
    throw new ImportError('no markdown files found in archive');
  }
  return items;
}

/** Route entrypoint: dispatch on filename extension. */
export function previewImport(input: ImportInput): ImportPreviewItem[] {
  const lower = input.filename.toLowerCase();
  if (lower.endsWith('.zip')) return previewZip(input);
  if (hasMarkdownExt(lower)) return previewMarkdown(input);
  throw new ImportError(`unsupported file type for "${input.filename}" — expected .md, .markdown, .txt, or .zip`);
}
