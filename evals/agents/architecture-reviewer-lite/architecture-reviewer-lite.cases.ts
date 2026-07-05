import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { AgentCase } from "../../src/index.js";

// Fixtures live in the strict-variant's directory — the lite variant shares the same inputs
// so the two agents are evaluated on identical tasks. Only the expected practices differ.
const __dir = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) =>
  readFileSync(resolve(__dir, "../architecture-reviewer/fixtures", name), "utf8");

const REVIEW_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("checkout-service.diff")}`;

const REVIEWER_CORE_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("reviewer-core-gate.diff")}`;

// This is the discriminating case for the strict-vs-lite A/B: the strict variant requires
// the agent to emit the exact documented rule identifier (e.g. `reviewer-core-zero-io`) for
// every finding. The lite variant only requires correct detection and structured output —
// citation of the specific identifier is no longer a required practice. Both variants should
// find the same violations; only the identifier-citation practice is absent here.
const BENIGN_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("benign-refactor.diff")}`;

// These cases are the LITE variant of architecture-reviewer.cases.ts.
// Removed practice (vs. strict): "names the specific documented rule identifier per finding".
// All other detection, severity, verbatim-quote, and PASS/FAIL verdict practices are kept
// at threshold 1.0 so the lite agent is still rigorous — it is only relaxed on citation style.
export const cases: AgentCase[] = [
  {
    name: "flags both violations in the checkout diff with severity and verbatim evidence",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "flags the domain file (checkout.ts) importing a type from 'fastify' as a violation of the inward-only dependency rule between Domain and Presentation layers",
      "flags the `new PgCheckoutRepository()` call inside service.ts as a violation of DI discipline (concrete adapters/repositories must be constructed only in the composition root / container)",
      "assigns a severity (critical/high/medium/low/info) to each finding",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "ends with an explicit PASS/FAIL gate verdict based on whether any critical or high findings exist",
    ],
    // Strict variant has 6 practices (adds rule-identifier citation). Lite has 5.
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate an architecture finding for the out-of-scope security-shaped change",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "does not invent an architecture-contract violation for the optional `reply?: FastifyReply` parameter beyond the inward-only-dependencies import issue itself (no runtime bug/security finding fabricated as an architecture rule)",
      "stays scoped to structural/layering/DI findings and does not comment on naming, style, or test coverage",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "detects the reviewer-core violations without requiring the documented rule identifier",
    kind: "quality",
    prompt: REVIEWER_CORE_PROMPT,
    practices: [
      "flags the `import { readFileSync } from 'node:fs'` added to reviewer-core/src/pipeline/run.ts as a violation (reviewer-core must do no I/O except the injected LLMProvider)",
      "flags that runPipeline now returns `deduped` directly, skipping the mandatory `groundFindings()` gate before emitting findings",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "ends with an explicit PASS/FAIL gate verdict based on whether any critical or high findings exist",
    ],
    // Strict variant has 6 practices (adds two rule-identifier citations). Lite has 4.
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate a documented-rule violation for a benign rename",
    kind: "quality",
    prompt: BENIGN_PROMPT,
    practices: [
      "reports no violations for the benign rename (or records only `info`-level, non-blocking observations) — it does not invent a critical/high/medium finding",
      "does not fabricate a documented-rule violation where the diff violates none of the checked rules",
      "the final gate verdict is PASS",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
];
