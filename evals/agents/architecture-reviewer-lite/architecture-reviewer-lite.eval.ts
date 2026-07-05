import { describeAgent, runAgentCases } from "../../src/index.js";
// Uses lite-specific cases: same fixtures as the strict variant, same threshold (1.0),
// but without the "cite the exact documented rule identifier per finding" practice.
// Run both evals and compare with `pnpm eval:delta` to isolate the impact of relaxing citation.
import { cases } from "./architecture-reviewer-lite.cases.js";

describeAgent("architecture-reviewer-lite", () => runAgentCases("architecture-reviewer-lite", cases));
