import type { SkillCase } from "../../src/index.js";

// Fixture: webhooks service with two cross-module repository imports buried among
// legitimate business logic. The violation is at the import section and the constructor.
// No comments hint at the problem — the skill must surface it on its own.
const FIXTURE = `Review this TypeScript service file for architectural violations before I open a PR.
The file is destined for server/src/modules/webhooks/service.ts.
List problems with file:line, severity, and a concrete fix for each.

\`\`\`typescript
// service.ts
import crypto from 'node:crypto';
import type { Container } from '../../platform/container.js';
import type { WebhookEndpoint, WebhookDelivery, WebhookDeliveryStatus } from '@devdigest/shared';
import { ExternalServiceError, ValidationError } from '../../platform/errors.js';
import { AgentsRepository } from '../agents/repository.js';     // line 6
import { SkillsRepository } from '../skills/repository.js';     // line 7
import { WebhooksRepository } from './repository.js';           // line 8

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 500;

export class WebhooksService {
  private repo: WebhooksRepository;
  private agentsRepo: AgentsRepository;
  private skillsRepo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = new WebhooksRepository(container.db);
    this.agentsRepo = new AgentsRepository(container.db);  // line 21
    this.skillsRepo = new SkillsRepository(container.db); // line 22
  }

  async register(workspaceId: string, input: { url: string; events: string[]; agent_id?: string }, createdBy?: string) {
    if (input.agent_id) {
      const agent = await this.agentsRepo.getById(workspaceId, input.agent_id);
      if (!agent) throw new ValidationError('Agent not found');
      const skills = await this.skillsRepo.linkedSkills(input.agent_id);
      if (skills.length === 0) throw new ValidationError('Agent has no linked skills');
    }
    return this.repo.insert({ workspaceId, url: input.url, events: input.events,
      agentId: input.agent_id ?? null, secret: this.generateSecret(), enabled: true,
      createdBy: createdBy ?? null });
  }

  async dispatch(workspaceId: string, event: string, payload: Record<string, unknown>) {
    const endpoints = await this.repo.listByEvent(workspaceId, event);
    await Promise.allSettled(endpoints.map((ep) => this.deliverWithRetry(ep, event, payload)));
  }

  private async deliverWithRetry(endpoint: WebhookEndpoint, event: string, payload: Record<string, unknown>) {
    let attempt = 0;
    while (attempt < MAX_RETRIES) {
      try {
        const code = await this.deliverOnce(endpoint, event, payload);
        await this.repo.recordDelivery(endpoint.id, event, payload, 'success', code);
        return;
      } catch (err) {
        attempt++;
        if (attempt >= MAX_RETRIES) {
          await this.repo.recordDelivery(endpoint.id, event, payload, 'failed');
          throw new ExternalServiceError('Webhook delivery failed', err);
        }
        await new Promise((r) => setTimeout(r, BACKOFF_BASE_MS * 2 ** attempt));
      }
    }
  }

  private async deliverOnce(endpoint: WebhookEndpoint, event: string, payload: Record<string, unknown>) {
    const body = JSON.stringify({ event, payload });
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json',
        'x-devdigest-signature': \`sha256=\${crypto.createHmac('sha256', endpoint.secret).update(body).digest('hex')}\` },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
    return res.status;
  }

  private generateSecret() { return crypto.randomBytes(24).toString('hex'); }
}
\`\`\``;

export const cases: SkillCase[] = [
  {
    name: "flags cross-module repository imports in webhooks service",
    kind: "quality",
    // Cheap gate: the offending class names must appear in the response before the judge
    // runs. Class names, NOT path fragments — models paraphrase import paths but must name
    // the classes to cite the violation (INSIGHTS 2026-07-05: grounding via path segments
    // failed on paraphrase; AgentsRepository/SkillsRepository survive it).
    grounding: ["AgentsRepository", "SkillsRepository"],
    prompt: FIXTURE,
    practices: [
      // ── Core detection (both configs should find these) ──────────────────────
      // Falsifiable: a model without any skill instruction might call this 'too many
      // responsibilities' instead of identifying it as a module-boundary violation.
      "The response identifies the import of AgentsRepository from '../agents/repository.js' (line 6) as a violation of the module-boundary rule — another module's repository must not be imported directly by a sibling service",

      "The response identifies the import of SkillsRepository from '../skills/repository.js' (line 7) as the same category of violation",

      // ── False-positive guard ──────────────────────────────────────────────────
      // Falsifiable: an over-eager reviewer might flag every Drizzle-level class including
      // WebhooksRepository, which is the module's own repository and completely correct.
      "The response does NOT flag the import of WebhooksRepository from './repository.js' (line 8) as a violation — importing your own module's repository is the correct pattern",

      // ── Remediation specificity (the discriminating practice) ─────────────────
      // Falsifiable: without §13's explicit alternatives table, a model stops at 'go through
      // the service' (too vague) and never names a port interface or @devdigest/shared.
      // With §13 the model names the correct destination (port interface, Container, or
      // @devdigest/shared) rather than a vague 'use AgentsService' redirection.
      "The response proposes a concrete alternative that avoids the direct repository import: either a port/lookup interface in @devdigest/shared (e.g. AgentLookup, SkillLookup), resolution through the Container, or promoting the validation logic to server/src/platform/ — not just 'call the service instead'",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
