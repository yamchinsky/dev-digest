import type { SkillCase } from "../../src/index.js";

// Inline fixture — skillTask provides no tools, so all data the model needs must be in the prompt.
// Three violations map 1:1 to named CRITICAL rules; the labels (A/B/C) are load-bearing —
// practices reference them so the judge can find verbatim evidence without ambiguity.
const FIXTURE = `Review this TypeScript code for Zod best-practice violations. For each violation, name the specific rule it breaks, quote the offending code, and show a corrected version.

\`\`\`typescript
import { z } from 'zod'

// Schema for incoming webhook events
const webhookSchema = z.object({
  event: z.string(),
  payload: z.any(),          // (A)
})

// Route handler — receives untrusted HTTP request bodies
export async function POST(req: Request): Promise<Response> {
  const body = await req.json()
  const validated = webhookSchema.parse(body)   // (B)
  return Response.json({ ok: true, event: validated.event })
}

// Load persisted user preferences from localStorage
export function loadUserPreferences(): { theme: string; locale: string } {
  const raw = localStorage.getItem('user-prefs')
  const prefs = JSON.parse(raw ?? '{}')          // (C)
  return { theme: prefs.theme, locale: prefs.locale }
}
\`\`\``;

export const cases: SkillCase[] = [
  {
    name: "flags z.any(), bare parse(), and unvalidated JSON.parse as CRITICAL rule violations",
    kind: "quality",
    prompt: FIXTURE,
    // Cheap gate: both must appear before the judge runs.
    // "z.unknown()" is the exact fix for (A); "safeParse" is the exact fix for (B).
    grounding: ["z.unknown()", "safeParse"],
    practices: [
      // Rule: schema-use-unknown-not-any (CRITICAL)
      // Falsifiable: without this rule, a model treats z.any() as a style preference, not a type-safety violation.
      "The response flags line (A) — `payload: z.any()` — as a type-safety violation and recommends replacing it with `z.unknown()`, quoting the literal `z.any()` field from the snippet as evidence",

      // Rule: parse-use-safeparse (CRITICAL)
      // Falsifiable: without this rule, a model suggests try/catch around parse() rather than switching to safeParse().
      "The response flags line (B) — `webhookSchema.parse(body)` — as unsafe for request body validation and recommends `safeParse()` as the replacement, showing or describing the `result.success` check required to handle the failure branch without throwing",

      // Rule: parse-never-trust-json (CRITICAL)
      // Falsifiable: without this rule, a model adds a TypeScript type assertion instead of a Zod schema wrapper.
      "The response flags line (C) — `JSON.parse(raw ?? '{}')` — as unvalidated external JSON and recommends passing the parsed value through a Zod schema before accessing `prefs.theme` or `prefs.locale`",

      // Depth check for schema-use-unknown-not-any implication.
      // Falsifiable: without the 'forces type narrowing before use' content in the reference file,
      // a model stops at the keyword swap and does not explain the call-site consequence.
      "The response explains that replacing `z.any()` with `z.unknown()` is not a drop-in keyword swap — callers must narrow the `unknown` type (e.g. with a type guard or conditional check) before accessing properties on `payload`",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
];
