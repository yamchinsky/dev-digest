/**
 * Integration test — T5: seedEvalCases idempotency + diff correctness.
 *
 * Requires Docker (testcontainers Postgres). Skips cleanly when Docker is absent.
 *
 * Assertions:
 *  1. After two calls to seedEvalCases() exactly five eval_cases rows exist
 *     for the General Reviewer owner (idempotency via onConflictDoNothing).
 *  2. Every seeded row has a non-empty inputDiff.
 *  3. Every inputDiff parses via parseUnifiedDiff with at least one file and
 *     at least one non-empty hunk (structural correctness).
 *  4. For each of the three must_find cases the expectedOutput start_line /
 *     end_line range intersects the new-side line numbers of the corresponding
 *     file's first hunk — i.e. the expectation points at real new-side lines
 *     (grounding-gate self-validation).
 *  5. All expectedOutput values parse successfully against the EvalExpectation
 *     Zod schema (contract correctness).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../test/helpers/pg.js';
import { seed } from './seed.js';
import { seedEvalCases } from './seed-eval-cases.js';
import * as t from './schema.js';
import { parseUnifiedDiff } from '../adapters/git/diff-parser.js';
import { EvalExpectation } from '../vendor/shared/index.js';

// ---------------------------------------------------------------------------
// Docker gate
// ---------------------------------------------------------------------------

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[seed-eval-cases.it] Docker not available — skipping testcontainers integration tests.');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true if any number in `lineNumbers` falls within [start, end]. */
function intersectsRange(lineNumbers: number[], start: number, end: number): boolean {
  return lineNumbers.some((n) => n >= start && n <= end);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

d('seedEvalCases', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    // seed() must run first to create the default workspace + General Reviewer
    await seed(pg.handle.db);
    // call seedEvalCases TWICE — second call must be a no-op (onConflictDoNothing)
    await seedEvalCases(pg.handle.db);
    await seedEvalCases(pg.handle.db);
  }, 120_000); // testcontainers can be slow on first pull

  afterAll(async () => {
    await pg?.stop();
  });

  it('inserts exactly five eval_cases rows for the General Reviewer and each has a non-empty inputDiff', async () => {
    const db = pg.handle.db;

    // Resolve General Reviewer agent
    const [ws] = await db.select().from(t.workspaces);
    expect(ws, 'default workspace must exist after seed()').toBeDefined();

    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, ws!.id), eq(t.agents.name, 'General Reviewer')));
    expect(agent, 'General Reviewer agent must exist after seed()').toBeDefined();

    const rows = await db
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.ownerId, agent!.id));

    // Exactly five rows — no duplicates from the second seedEvalCases() call
    expect(rows).toHaveLength(5);

    for (const row of rows) {
      expect(row.inputDiff, `case '${row.name}' must have a non-empty inputDiff`).toBeTruthy();
    }
  });

  it('all inputDiffs parse via parseUnifiedDiff with at least one file and one non-empty hunk', async () => {
    const db = pg.handle.db;

    const [ws] = await db.select().from(t.workspaces);
    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, ws!.id), eq(t.agents.name, 'General Reviewer')));

    const rows = await db
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.ownerId, agent!.id));

    for (const row of rows) {
      const parsed = parseUnifiedDiff(row.inputDiff as string);

      expect(
        parsed.files.length,
        `case '${row.name}': expected at least one file in parsed diff`,
      ).toBeGreaterThan(0);

      for (const file of parsed.files) {
        expect(
          file.hunks.length,
          `case '${row.name}', file '${file.path}': expected at least one hunk`,
        ).toBeGreaterThan(0);

        for (const hunk of file.hunks) {
          expect(
            hunk.newLineNumbers.length,
            `case '${row.name}', file '${file.path}': hunk must have newLineNumbers`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it('all expectedOutput values satisfy the EvalExpectation Zod schema', async () => {
    const db = pg.handle.db;

    const [ws] = await db.select().from(t.workspaces);
    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, ws!.id), eq(t.agents.name, 'General Reviewer')));

    const rows = await db
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.ownerId, agent!.id));

    for (const row of rows) {
      const result = EvalExpectation.safeParse(row.expectedOutput);
      expect(
        result.success,
        `case '${row.name}': expectedOutput failed EvalExpectation schema: ${
          result.success ? '' : JSON.stringify(result.error.issues)
        }`,
      ).toBe(true);
    }
  });

  it('must_find expectations intersect the new-side line numbers of their diff hunks', async () => {
    const db = pg.handle.db;

    const [ws] = await db.select().from(t.workspaces);
    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, ws!.id), eq(t.agents.name, 'General Reviewer')));

    const rows = await db
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.ownerId, agent!.id));

    const mustFindCases = rows.filter((r) => {
      const exp = EvalExpectation.safeParse(r.expectedOutput);
      return exp.success && exp.data.type === 'must_find';
    });

    // We seeded exactly three must_find cases
    expect(mustFindCases).toHaveLength(3);

    for (const row of mustFindCases) {
      const exp = EvalExpectation.parse(row.expectedOutput);
      const parsed = parseUnifiedDiff(row.inputDiff as string);

      // Find the file matching the expectation
      const matchedFile = parsed.files.find((f) => f.path === exp.file);
      expect(
        matchedFile,
        `case '${row.name}': expected file '${exp.file}' not found in parsed diff; ` +
          `files found: ${parsed.files.map((f) => f.path).join(', ')}`,
      ).toBeDefined();

      // Collect all new-side line numbers from all hunks of the matched file
      const allNewLineNumbers = matchedFile!.hunks.flatMap((h) => h.newLineNumbers);

      // The expectation range must intersect the hunk's new-side line numbers.
      // This ensures start_line/end_line point at real new-side lines (including
      // the added lines), so the citation-grounding gate can validate findings.
      expect(
        intersectsRange(allNewLineNumbers, exp.start_line, exp.end_line),
        `case '${row.name}': expectation range [${exp.start_line}, ${exp.end_line}] ` +
          `does not intersect new-side lines [${allNewLineNumbers.join(', ')}] ` +
          `for file '${exp.file}'`,
      ).toBe(true);
    }
  });
});
