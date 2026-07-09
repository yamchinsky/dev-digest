import { stringify } from 'yaml';
import type { Agent, Skill } from '@devdigest/shared';
import { AgentManifest } from '@devdigest/shared';

/**
 * Generate a YAML manifest for an agent.
 *
 * The shape matches AgentManifest (read by the CI runner). `post_as` is
 * intentionally excluded — that policy lives in the workflow env, not here.
 *
 * Skills are serialised as their name-slugs (kebab-case), which the runner
 * resolves to `.devdigest/skills/<slug>.md`.
 *
 * The manifest is validated with `AgentManifest.parse` before serialisation
 * so any drift between the schema and this builder is caught at generation
 * time rather than at runner startup.
 */
export function generateManifestYaml(agent: Agent, skills: Skill[]): string {
  const slugify = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  const raw = {
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.system_prompt,
    skills: skills.filter((s) => s.enabled).map((s) => slugify(s.name)),
    strategy: agent.strategy,
    ci_fail_on: agent.ci_fail_on,
    // post_as is EXCLUDED — AC-18 requirement
  };

  // Validate before serialising so schema drift is caught early.
  const parsed = AgentManifest.parse(raw);

  return stringify(parsed, { lineWidth: 0 });
}

/**
 * Compute the filename slug for an agent (used in the manifest path and skills dir).
 */
export function agentSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
