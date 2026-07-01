import { z } from 'zod';

export const ContextDocCategory = z.enum(['specs', 'docs', 'insights']);
export type ContextDocCategory = z.infer<typeof ContextDocCategory>;

export const ContextDoc = z.object({
  repo_id: z.string().uuid(),
  relative_path: z.string(),
  category: ContextDocCategory,
  agent_count: z.number().int().nonnegative(),
});
export type ContextDoc = z.infer<typeof ContextDoc>;

export const AgentContextDoc = z.object({
  agent_id: z.string().uuid(),
  repo_id: z.string().uuid(),
  relative_path: z.string(),
  order: z.number().int().nonnegative(),
});
export type AgentContextDoc = z.infer<typeof AgentContextDoc>;

export const SkillContextDoc = z.object({
  skill_id: z.string().uuid(),
  repo_id: z.string().uuid(),
  relative_path: z.string(),
});
export type SkillContextDoc = z.infer<typeof SkillContextDoc>;

export const PutContextDocsBody = z.object({
  items: z.array(
    z.object({ path: z.string().min(1), repo_id: z.string().uuid() }),
  ),
});
export type PutContextDocsBody = z.infer<typeof PutContextDocsBody>;
