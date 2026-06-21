import { pgTable, uuid, text, integer, real, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';

export const conventions = pgTable(
  'conventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').notNull(),
    category: text('category').notNull(),
    rule: text('rule').notNull(),
    description: text('description'),
    evidenceFile: text('evidence_file').notNull(),
    evidenceLine: integer('evidence_line'),
    evidenceSnippet: text('evidence_snippet'),
    confidence: real('confidence').notNull(),
    status: text('status', { enum: ['pending', 'approved', 'rejected'] })
      .notNull()
      .default('pending'),
    editedRule: text('edited_rule'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    repoRunIdx: index('conventions_repo_run_idx').on(t.repoId, t.runId),
    repoStatusIdx: index('conventions_repo_status_idx').on(t.repoId, t.status),
    statusChk: check(
      'conventions_status_chk',
      sql`${t.status} IN ('pending', 'approved', 'rejected')`,
    ),
  }),
);
