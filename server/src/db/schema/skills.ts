import { pgTable, uuid, text, integer, boolean, jsonb, primaryKey, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';

export const skills = pgTable('skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull(),
  type: text('type', { enum: ['rubric', 'convention', 'security', 'custom'] }).notNull(),
  source: text('source', {
    enum: ['manual', 'imported_url', 'extracted', 'community'],
  }).notNull(),
  body: text('body').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  version: integer('version').notNull().default(1),
  evidenceFiles: jsonb('evidence_files').$type<string[]>(),
  createdAt: now(),
});

export const skillVersions = pgTable(
  'skill_versions',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    body: text('body').notNull(),
    createdAt: now(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.skillId, t.version] }) }),
);

export const skillContextDocs = pgTable(
  'skill_context_docs',
  {
    skillId: uuid('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').notNull().references(() => repos.id, { onDelete: 'cascade' }),
    relativePath: text('relative_path').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.skillId, t.repoId, t.relativePath] }),
    skillIdx: index('skill_context_docs_skill_idx').on(t.skillId),
    // Covers the ON DELETE CASCADE from repos — mirrors agent_context_docs.
    repoPathIdx: index('skill_context_docs_repo_path_idx').on(t.repoId, t.relativePath),
  }),
);
