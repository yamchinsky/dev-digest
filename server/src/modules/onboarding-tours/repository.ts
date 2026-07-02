import { eq, and } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as schema from '../../db/schema.js';

/**
 * onboarding-tours data-access layer.
 *
 * Reads and writes the `onboarding_tours` table. The semantic key is
 * `(repo_id, workspace_id)` — backed by a unique index — so getTour
 * may return null when no tour has been generated yet.
 */
export class OnboardingTourRepository {
  constructor(private db: Db) {}

  async getTour(repoId: string, workspaceId: string) {
    const rows = await this.db
      .select()
      .from(schema.onboardingTours)
      .where(
        and(
          eq(schema.onboardingTours.repoId, repoId),
          eq(schema.onboardingTours.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertTour(data: {
    repoId: string;
    workspaceId: string;
    sections: unknown;
    readingPath: unknown;
    generatedAt: Date;
    filesIndexed: number;
    indexStatusAtGeneration: 'full' | 'partial' | 'degraded' | 'failed';
  }) {
    const rows = await this.db
      .insert(schema.onboardingTours)
      .values({ ...data })
      .onConflictDoUpdate({
        target: [schema.onboardingTours.repoId, schema.onboardingTours.workspaceId],
        set: {
          sections: data.sections,
          readingPath: data.readingPath,
          generatedAt: data.generatedAt,
          filesIndexed: data.filesIndexed,
          indexStatusAtGeneration: data.indexStatusAtGeneration,
        },
      })
      .returning();
    return rows[0]!;
  }
}
