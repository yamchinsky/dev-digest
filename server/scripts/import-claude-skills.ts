import 'dotenv/config';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { eq, and } from 'drizzle-orm';
import { createDb } from '../src/db/client.js';
import * as t from '../src/db/schema.js';
import { SkillsService } from '../src/modules/skills/service.js';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { DEFAULT_WORKSPACE_NAME } from '../src/db/seed.js';

/**
 * Bulk-import every Claude Code skill from `.claude/skills/<name>/SKILL.md`
 * into the DevDigest workspace as Skill rows. Idempotent: skips any skill
 * whose `name` already exists.
 *
 * The CC skill format is `--- YAML ---\n<markdown body>`. We parse the
 * frontmatter (name, description) and store the body verbatim — the agent
 * sees exactly the same instructions a Claude Code session would.
 *
 * Run:  cd server && pnpm tsx scripts/import-claude-skills.ts [path]
 *       default path is `<repo root>/.claude/skills`.
 */

interface ParsedSkill {
  name: string;
  description: string;
  body: string;
}

/** Minimal frontmatter reader. Tolerates missing fields; falls back to dir name
 *  for `name` and "" for `description`. We don't pull in js-yaml — the spec
 *  here is tiny: `key: value` or `key: "quoted value"` on one line each. */
function parseFrontmatter(raw: string, dirName: string): ParsedSkill {
  if (!raw.startsWith('---')) {
    return { name: dirName, description: '', body: raw };
  }
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { name: dirName, description: '', body: raw };
  const head = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');

  let name = dirName;
  let description = '';
  for (const line of head.split(/\r?\n/)) {
    const m = /^(\w+)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1]!;
    let value = m[2]!.trim();
    // Unwrap quoted values.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === 'name' && value) name = value;
    if (key === 'description' && value) description = value;
  }
  return { name, description, body };
}

async function main() {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const defaultPath = path.join(repoRoot, '.claude/skills');
  const skillsDir = process.argv[2] ?? defaultPath;

  try {
    if (!statSync(skillsDir).isDirectory()) throw new Error('not a directory');
  } catch {
    console.error(`✗ skills dir not found: ${skillsDir}`);
    process.exit(1);
  }

  const config = loadConfig();
  const { db, close } = createDb(config.databaseUrl);
  try {
    const [ws] = await db
      .select()
      .from(t.workspaces)
      .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
    if (!ws) {
      console.error('✗ default workspace not found — run `pnpm db:seed` first.');
      process.exit(1);
    }
    const workspaceId = ws.id;

    const container = new Container(config, db);
    const service = new SkillsService(container);

    const dirs = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    let created = 0;
    let skipped = 0;
    for (const dirName of dirs) {
      const file = path.join(skillsDir, dirName, 'SKILL.md');
      let raw: string;
      try {
        raw = readFileSync(file, 'utf8');
      } catch {
        console.log(`  ~  ${dirName} — no SKILL.md, skipping`);
        continue;
      }
      const parsed = parseFrontmatter(raw, dirName);

      const [existing] = await db
        .select()
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, parsed.name)));
      if (existing) {
        console.log(`  =  ${parsed.name} — already exists, skipped`);
        skipped++;
        continue;
      }

      await service.create(
        workspaceId,
        {
          name: parsed.name,
          description: parsed.description || parsed.name,
          // Bulk-imported skills land as `custom` — the user can re-classify
          // in the editor. We don't try to guess from the body.
          type: 'custom',
          body: parsed.body,
        },
        'extracted',
      );
      console.log(`  +  ${parsed.name}`);
      created++;
    }

    console.log(`\n✓ ${created} created, ${skipped} skipped (already present)`);
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error('✗ import failed:', err);
  process.exit(1);
});
