import { z } from 'zod';
import { INJECTION_GUARD, wrapUntrusted } from '@devdigest/reviewer-core';
import type { Risk, ReviewFocusItem } from '@devdigest/shared';

/**
 * Canonicalize a file path to repo-relative POSIX form before any
 * grounding-set membership check. Applied to both the prFileSet entries and
 * the LLM-returned file_refs / review_focus.file values (Extra-CRITICAL).
 */
export function normalizePath(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

// ---------------------------------------------------------------------------
// BriefLLMSchema — raw LLM output type (module-internal; never shared).
// IMPORTANT: No .min(1) on any string field — OpenAI strict JSON schema rejects
// minLength constraints; Zod validates AFTER the call.
// ---------------------------------------------------------------------------
export const BriefLLMSchema = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: z.enum(['low', 'medium', 'high']),
  risks: z.array(
    z.object({
      kind: z.string(),
      title: z.string(),
      explanation: z.string(),
      severity: z.enum(['high', 'medium', 'low']),
      file_refs: z.array(z.string()),
    }),
  ),
  review_focus: z.array(
    z.object({
      file: z.string(),
      line: z.number().int().nullable(),
      reason: z.string(),
    }),
  ),
});
export type BriefLLMOutput = z.infer<typeof BriefLLMSchema>;

// ---------------------------------------------------------------------------
// assembleBriefMessages
// ---------------------------------------------------------------------------

export interface BriefInputs {
  intent: string;
  blastSummary: string;
  /** Plain-text serialization of file-group role + path + +N/-N stats. No hunk bodies. */
  smartDiffStats: string;
  /** Linked issue when resolved; body may be null/undefined if the issue has no description. */
  linkedIssue: { title: string; body?: string | null } | null;
  contextDocContents: string[];
}

/**
 * Build LLM messages for a PR brief generation. All five untrusted surfaces
 * are wrapped with wrapUntrusted (AC-11); system message includes INJECTION_GUARD.
 *
 * Per-source char caps (D7):
 *   intent        ≤ 3 000 chars
 *   blast summary ≤ 2 000 chars
 *   linked issue  ≤ 1 500 chars (body only)
 *   context doc   ≤ 1 500 chars each
 *   smart-diff    no cap (structured stats block; no hunk bodies)
 */
export function assembleBriefMessages(inputs: BriefInputs): { system: string; user: string } {
  const { intent, blastSummary, smartDiffStats, linkedIssue, contextDocContents } = inputs;

  const system = `You are a senior code reviewer producing a structured PR brief. ${INJECTION_GUARD}`;

  const parts: string[] = [
    `## PR Intent\n${wrapUntrusted('intent', intent.slice(0, 3_000))}`,
    `## Blast Radius Summary\n${wrapUntrusted('blast-summary', blastSummary.slice(0, 2_000))}`,
    // smart-diff contains contributor-controlled file paths — wrap even though it's structured.
    `## Changed Files (smart-diff stats)\n${wrapUntrusted('smart-diff', smartDiffStats)}`,
  ];

  if (linkedIssue) {
    const issueBody = linkedIssue.body ?? '';
    parts.push(
      `## Linked Issue\n${wrapUntrusted(
        'linked-issue',
        `${linkedIssue.title}\n\n${issueBody.slice(0, 1_500)}`,
      )}`,
    );
  }

  contextDocContents.forEach((content, i) => {
    parts.push(
      `## Context Doc ${i + 1}\n${wrapUntrusted(`context-doc-${i}`, content.slice(0, 1_500))}`,
    );
  });

  // Final instruction enumerates ALL five Brief fields — prevents models from
  // omitting fields (deepseek/OpenRouter lesson from reviewer-core INSIGHTS).
  parts.push(
    `Respond with a JSON object containing ALL five fields:\n` +
      `1. "what" — a single concise sentence describing what this PR does.\n` +
      `2. "why" — a single concise sentence describing the motivation/goal.\n` +
      `3. "risk_level" — "low", "medium", or "high" overall risk rating.\n` +
      `4. "risks" — array of objects, each with: "kind" (string), "title" (string), ` +
      `"explanation" (string), "severity" ("high"/"medium"/"low"), "file_refs" (array of file paths).\n` +
      `5. "review_focus" — array of objects, each with: "file" (string), "line" (integer or null), "reason" (string).\n` +
      `Every field is required; do not omit any.`,
  );

  return { system, user: parts.join('\n\n') };
}

// ---------------------------------------------------------------------------
// groundBrief — grounding gate (AC-6, AC-7)
// ---------------------------------------------------------------------------

/**
 * Filter LLM-returned risks and review_focus entries against the PR's actual
 * changed file set. Paths are normalized on BOTH sides before comparison
 * (Extra-CRITICAL — without this, ./src/foo.ts ≠ src/foo.ts silently drops risks).
 *
 * A risk is dropped when ALL its file_refs are outside the PR file set (i.e.
 * filteredRefs is empty). Risks with zero file_refs are also dropped.
 * droppedItems counts dropped risks + dropped focus entries.
 */
export function groundBrief(
  llmOutput: BriefLLMOutput,
  prFileSet: Set<string>,
): { risks: Risk[]; review_focus: ReviewFocusItem[]; droppedItems: number } {
  const normalizedSet = new Set([...prFileSet].map(normalizePath));
  let droppedItems = 0;

  const risks: Risk[] = [];
  for (const risk of llmOutput.risks) {
    const filteredRefs = risk.file_refs.map(normalizePath).filter((f) => normalizedSet.has(f));
    if (filteredRefs.length === 0) {
      droppedItems++;
    } else {
      risks.push({ ...risk, file_refs: filteredRefs });
    }
  }

  const review_focus: ReviewFocusItem[] = [];
  for (const entry of llmOutput.review_focus) {
    if (normalizedSet.has(normalizePath(entry.file))) {
      review_focus.push(entry);
    } else {
      droppedItems++;
    }
  }

  return { risks, review_focus, droppedItems };
}
