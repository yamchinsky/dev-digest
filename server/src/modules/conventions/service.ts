import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Container } from '../../platform/container.js';
import {
  ConfigError,
  ExternalServiceError,
  NotFoundError,
  ValidationError,
} from '../../platform/errors.js';
import { RepoRepository } from '../repos/repository.js';
import { SkillsService } from '../skills/service.js';
import {
  ConventionsRepository,
  type Convention,
  type ConventionStatus,
  type NewCandidate,
} from './repository.js';

const CONFIG_PATHS = [
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc',
  'eslint.config.js',
  'eslint.config.mjs',
  'tsconfig.json',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  'biome.json',
];

const CONFIG_TRUNCATE = 4000;
const SAMPLE_FILE_LINES = 200;
const SAMPLE_FILES_N = 12;

const Candidate = z.object({
  category: z.string().min(1).max(50),
  rule: z.string().min(5).max(200),
  description: z.string().max(1000).optional(),
  evidenceFile: z.string().min(1),
  evidenceLine: z.number().int().positive().optional(),
  evidenceSnippet: z.string().max(500).optional(),
  confidence: z.number().min(0).max(1),
});

export const CandidatesSchema = z.object({
  candidates: z.array(Candidate).max(30),
});

const SYSTEM_PROMPT = `You are a code conventions auditor. Read project configs and sample files. Output 5-20 SPECIFIC, project-local conventions. For each, provide:
- category (one of: imports, naming, errors, tests, types, comments, async, state, structure)
- rule (≤200 chars, imperative — "Use X" not "We should use X")
- description (optional, ≤1000 chars)
- evidenceFile (EXACT path from input, do not paraphrase)
- evidenceLine (1-based line number where evidence appears; OMIT if not certain)
- evidenceSnippet (1-5 lines quoted VERBATIM from the input file)
- confidence (0..1)

Rules:
- Every evidence must be quoted verbatim — do not paraphrase code.
- Do NOT invent file paths. Use only files appearing in the input.
- Skip generic best practices (e.g. "use TypeScript", "name variables clearly"). Focus on patterns SPECIFIC to this codebase.
- If you see config (eslint/tsconfig/prettier), surface the rules they enforce as project conventions.`;

export interface ExtractResult {
  runId: string;
  candidatesCount: number;
  droppedCount: number;
}

export class ConventionsService {
  private repo: ConventionsRepository;
  private repos: RepoRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
    this.repos = new RepoRepository(container.db);
  }

  async extract(workspaceId: string, repoId: string): Promise<ExtractResult> {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError(`repo ${repoId} not found`);

    const clonePath = repo.clonePath;
    if (!clonePath) throw new NotFoundError(`repo ${repoId} has no clone path`);

    const configs: Record<string, string> = {};
    for (const p of CONFIG_PATHS) {
      const raw = await readClone(clonePath, p);
      if (raw === null) continue;
      configs[p] = raw.slice(0, CONFIG_TRUNCATE);
    }

    const sampleFiles = await this.container.repoIntel.getConventionSamples(
      repoId,
      SAMPLE_FILES_N,
    );
    const samples: Array<{ path: string; content: string }> = [];
    for (const path of sampleFiles) {
      const raw = await readClone(clonePath, path);
      if (raw === null) continue;
      const content = raw.split('\n').slice(0, SAMPLE_FILE_LINES).join('\n');
      samples.push({ path, content });
    }

    if (Object.keys(configs).length === 0 && samples.length === 0) {
      throw new ValidationError('no samples available; run repo-intel first');
    }

    // Cheap analysis model that supports OpenAI-style strict json_schema via
    // OpenRouter. The default review agents use the same model for the same
    // reason — Anthropic models via OpenRouter do NOT reliably support
    // response_format strict and return 502 from the upstream shim.
    // TODO: make configurable via agent settings.
    const provider = 'openrouter' as const;
    const model = 'deepseek/deepseek-v4-flash';

    let llm;
    try {
      llm = await this.container.llm(provider);
    } catch (err) {
      if (err instanceof ConfigError) throw err;
      throw new ExternalServiceError(
        'llm-extract',
        err instanceof Error ? err.message : String(err),
      );
    }

    const userMessage = buildEvidencePack(configs, samples);

    let candidates;
    try {
      const result = await llm.completeStructured({
        model,
        schema: CandidatesSchema,
        schemaName: 'ConventionsCandidates',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.2,
        maxTokens: 4000,
        maxRetries: 1,
      });
      candidates = result.data.candidates;
    } catch (err) {
      throw new ExternalServiceError(
        'llm-extract',
        err instanceof Error ? err.message : String(err),
      );
    }

    const fileContents = new Map<string, string>();
    for (const s of samples) fileContents.set(s.path, s.content);

    const validated: NewCandidate[] = [];
    let droppedCount = 0;
    for (const c of candidates) {
      let content = fileContents.get(c.evidenceFile);
      if (content === undefined) {
        const raw = await readClone(clonePath, c.evidenceFile);
        if (raw === null) {
          droppedCount++;
          continue;
        }
        content = raw;
        fileContents.set(c.evidenceFile, content);
      }

      const lineCount = content.split('\n').length;
      if (c.evidenceLine !== undefined && c.evidenceLine > lineCount) {
        droppedCount++;
        continue;
      }

      if (c.evidenceSnippet !== undefined && c.evidenceSnippet.length > 0) {
        const haystack = content.replace(/\s+/g, ' ').trim();
        const needle = c.evidenceSnippet.replace(/\s+/g, ' ').trim();
        if (!haystack.includes(needle)) {
          droppedCount++;
          continue;
        }
      }

      validated.push({
        category: c.category,
        rule: c.rule,
        description: c.description,
        evidenceFile: c.evidenceFile,
        evidenceLine: c.evidenceLine,
        evidenceSnippet: c.evidenceSnippet,
        confidence: c.confidence,
      });
    }

    const runId = randomUUID();
    await this.repo.createCandidates(workspaceId, repoId, runId, validated);
    return { runId, candidatesCount: validated.length, droppedCount };
  }

  async list(
    workspaceId: string,
    repoId: string,
    opts: { runId?: string; status?: ConventionStatus } = {},
  ): Promise<Convention[]> {
    return this.repo.listByRepo(workspaceId, repoId, opts);
  }

  async approve(workspaceId: string, candidateId: string): Promise<Convention> {
    const row = await this.repo.updateStatus(workspaceId, candidateId, 'approved');
    if (!row) throw new NotFoundError(`convention ${candidateId} not found`);
    return row;
  }

  async reject(workspaceId: string, candidateId: string): Promise<Convention> {
    const row = await this.repo.updateStatus(workspaceId, candidateId, 'rejected');
    if (!row) throw new NotFoundError(`convention ${candidateId} not found`);
    return row;
  }

  async edit(
    workspaceId: string,
    candidateId: string,
    input: { rule: string },
  ): Promise<Convention> {
    if (input.rule.length > 200) {
      throw new ValidationError('rule must be ≤200 characters');
    }
    const row = await this.repo.updateRule(workspaceId, candidateId, input.rule);
    if (!row) throw new NotFoundError(`convention ${candidateId} not found`);
    return row;
  }

  async previewSkillFromApproved(
    workspaceId: string,
    repoId: string,
    input: { name: string; description: string; runId?: string },
  ): Promise<{ body: string; ruleCount: number; fileCount: number }> {
    const approved = await this.repo.listApproved(workspaceId, repoId, { runId: input.runId });
    if (approved.length === 0) throw new ValidationError('no approved candidates');

    const body = renderSkillBody(input.name, input.description, approved);
    const fileCount = new Set(approved.map((c) => c.evidenceFile)).size;
    return { body, ruleCount: approved.length, fileCount };
  }

  async buildSkillFromApproved(
    workspaceId: string,
    repoId: string,
    input: { name: string; description: string; runId?: string },
  ): Promise<{ skillId: string }> {
    const approved = await this.repo.listApproved(workspaceId, repoId, { runId: input.runId });
    if (approved.length === 0) throw new ValidationError('no approved candidates');

    const body = renderSkillBody(input.name, input.description, approved);
    const evidenceFiles = [...new Set(approved.map((c) => c.evidenceFile))];

    const skillsService = new SkillsService(this.container);
    const skill = await skillsService.create(
      workspaceId,
      {
        name: input.name,
        description: input.description,
        type: 'convention',
        body,
        evidenceFiles,
      },
      'extracted',
    );
    return { skillId: skill.id };
  }
}

function renderSkillBody(name: string, description: string, approved: Convention[]): string {
  const byCategory = new Map<string, Convention[]>();
  for (const c of approved) {
    const arr = byCategory.get(c.category);
    if (arr) arr.push(c);
    else byCategory.set(c.category, [c]);
  }

  const grouped: Array<{ category: string; items: Convention[]; avg: number }> = [];
  for (const [category, items] of byCategory) {
    items.sort((a, b) => b.confidence - a.confidence);
    const avg = items.reduce((s, c) => s + c.confidence, 0) / items.length;
    grouped.push({ category, items, avg });
  }
  grouped.sort((a, b) => b.avg - a.avg);

  const lines: string[] = [];
  lines.push('---');
  lines.push(`name: ${name}`);
  lines.push(`description: ${description}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${name}`);
  lines.push('');
  lines.push(description);
  for (const g of grouped) {
    lines.push('');
    lines.push(`## ${capitalize(g.category)}`);
    lines.push('');
    for (const c of g.items) {
      const rule = c.editedRule ?? c.rule;
      const ref = c.evidenceLine != null ? `${c.evidenceFile}:${c.evidenceLine}` : c.evidenceFile;
      lines.push(`- ${rule} — \`${ref}\``);
    }
  }
  return lines.join('\n');
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

async function readClone(clonePath: string, file: string): Promise<string | null> {
  return readFile(join(clonePath, file), 'utf8').catch(() => null);
}

function buildEvidencePack(
  configs: Record<string, string>,
  samples: Array<{ path: string; content: string }>,
): string {
  const parts: string[] = [];
  const configPaths = Object.keys(configs);
  if (configPaths.length > 0) {
    parts.push('# Project configs');
    for (const p of configPaths) {
      parts.push(`\n## ${p}\n${configs[p]}`);
    }
  }
  if (samples.length > 0) {
    parts.push('\n# Sample files');
    for (const s of samples) {
      parts.push(`\n## ${s.path}\n${s.content}`);
    }
  }
  return parts.join('\n');
}
