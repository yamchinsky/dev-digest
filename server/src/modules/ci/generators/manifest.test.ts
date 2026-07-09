/**
 * Hermetic unit tests for manifest.ts — generateManifestYaml.
 *
 * No DB, no Docker, no network. Covers:
 *   AC-18 — generated manifest round-trips through AgentManifest.safeParse
 *            with no errors and all fields matching the source agent.
 *   AC-18 — `post_as` is absent from the serialised manifest.
 */
import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import type { Agent, Skill } from '@devdigest/shared';
import { generateManifestYaml } from './manifest.js';

// Minimal Agent fixture (all required fields, defaults for optional ones)
const testAgent: Agent = {
  id: 'a1b2c3d4-0000-0000-0000-000000000001',
  name: 'Security Reviewer',
  description: 'Reviews PRs for security issues',
  provider: 'openrouter',
  model: 'deepseek/deepseek-chat',
  system_prompt: 'You are a security-focused code reviewer.',
  output_schema: null,
  enabled: true,
  version: 1,
  strategy: 'auto',
  ci_fail_on: 'critical',
  repo_intel: true,
};

const testSkills: Skill[] = [
  {
    id: 's1',
    name: 'OWASP Top 10',
    description: 'Check for OWASP vulnerabilities',
    type: 'security',
    source: 'manual',
    body: '# OWASP Top 10\nCheck for injection, XSS, etc.',
    enabled: true,
    version: 1,
  },
  {
    id: 's2',
    name: 'SQL Injection',
    description: 'Detect SQL injection risks',
    type: 'security',
    source: 'manual',
    body: '# SQL Injection\nLook for raw SQL.',
    enabled: true,
    version: 1,
  },
  {
    id: 's3-disabled',
    name: 'Disabled Skill',
    description: 'This skill is disabled',
    type: 'custom',
    source: 'manual',
    body: 'disabled',
    enabled: false,
    version: 1,
  },
];

describe('generateManifestYaml', () => {
  it('produces parseable YAML', () => {
    const yaml = generateManifestYaml(testAgent, testSkills);
    expect(() => parse(yaml)).not.toThrow();
  });

  it('AC-18: round-trips through AgentManifest.safeParse without errors', () => {
    const yaml = generateManifestYaml(testAgent, testSkills);
    const raw = parse(yaml);
    const result = AgentManifest.safeParse(raw);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBe(testAgent.name);
    expect(result.data.provider).toBe(testAgent.provider);
    expect(result.data.model).toBe(testAgent.model);
    expect(result.data.system_prompt).toBe(testAgent.system_prompt);
    expect(result.data.strategy).toBe(testAgent.strategy);
    expect(result.data.ci_fail_on).toBe(testAgent.ci_fail_on);
  });

  it('AC-18: post_as is absent from the generated manifest', () => {
    const yaml = generateManifestYaml(testAgent, testSkills);
    const raw = parse(yaml);
    expect(raw).not.toHaveProperty('post_as');
    expect(yaml).not.toContain('post_as');
  });

  it('skills list contains only enabled skills as slugs', () => {
    const yaml = generateManifestYaml(testAgent, testSkills);
    const raw = parse(yaml);
    const result = AgentManifest.safeParse(raw);
    expect(result.success).toBe(true);
    if (!result.success) return;
    // 2 enabled skills; 1 disabled skill excluded
    expect(result.data.skills).toHaveLength(2);
    expect(result.data.skills).toContain('owasp-top-10');
    expect(result.data.skills).toContain('sql-injection');
    expect(result.data.skills).not.toContain('disabled-skill');
  });

  it('agent with no skills produces skills: []', () => {
    const yaml = generateManifestYaml(testAgent, []);
    const raw = parse(yaml);
    const result = AgentManifest.safeParse(raw);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.skills).toEqual([]);
  });

  it('ci_fail_on defaults are preserved', () => {
    const agentWithDifferentFailOn: Agent = { ...testAgent, ci_fail_on: 'warning' };
    const yaml = generateManifestYaml(agentWithDifferentFailOn, []);
    const raw = parse(yaml);
    expect(raw.ci_fail_on).toBe('warning');
  });
});
