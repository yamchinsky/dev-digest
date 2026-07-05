import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, doublePrecision, uniqueIndex } from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';

// ============================================================ Eval / Conformance / Compose

export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    inputDiff: text('input_diff'),
    inputFiles: jsonb('input_files'),
    inputMeta: jsonb('input_meta'),
    expectedOutput: jsonb('expected_output'),
    notes: text('notes'),
  },
  (t) => ({
    uniqWorkspaceOwnerName: uniqueIndex('eval_cases_workspace_owner_name_uidx').on(
      t.workspaceId,
      t.ownerId,
      t.name,
    ),
  }),
);

export const evalRunBatches = pgTable('eval_run_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  status: text('status', { enum: ['running', 'done', 'failed'] }).notNull().default('running'),
  agentVersion: integer('agent_version'),
  systemPrompt: text('system_prompt').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  strategy: text('strategy').notNull().default('auto'),
  skillBodies: jsonb('skill_bodies').$type<string[]>(),
  casesTotal: integer('cases_total').notNull(),
  casesPassed: integer('cases_passed'),
  recall: doublePrecision('recall'),
  precision: doublePrecision('precision'),
  citationAccuracy: doublePrecision('citation_accuracy'),
  costUsd: doublePrecision('cost_usd'),
  durationMs: integer('duration_ms'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export const evalRuns = pgTable('eval_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id')
    .notNull()
    .references(() => evalCases.id, { onDelete: 'cascade' }),
  batchId: uuid('batch_id').references(() => evalRunBatches.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  actualOutput: jsonb('actual_output'),
  pass: boolean('pass'),
  recall: doublePrecision('recall'),
  precision: doublePrecision('precision'),
  citationAccuracy: doublePrecision('citation_accuracy'),
  durationMs: integer('duration_ms'),
  costUsd: doublePrecision('cost_usd'),
});

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
