# pr-self-review — examples

Three worked examples: diff → bucket dispatch → final report. The verdict
column shows the expected outcome.

## Example 1 — backend critical (BLOCK)

### Diff

```diff
--- a/reviewer-core/src/llm/openrouter.ts
+++ b/reviewer-core/src/llm/openrouter.ts
@@ -10,6 +10,8 @@ export class OpenRouterProvider {
   constructor(opts: { apiKey: string }) {
     this.apiKey = opts.apiKey;
+    // hack: fall back to env when caller forgets
+    if (!this.apiKey) this.apiKey = process.env.OPENROUTER_API_KEY ?? "";
   }
```

### Bucket routing

- `reviewer-core/src/**/*.ts` → **Review engine** bucket.

### Subagent output (valid)

```json
{
  "bucket": "review-engine",
  "consulted_skills": ["onion-architecture", "typescript-expert", "claude-api"],
  "files_reviewed": ["reviewer-core/src/llm/openrouter.ts"],
  "files_skipped_budget": [],
  "findings": [
    {
      "severity": "CRITICAL",
      "rule": "onion-architecture/no-process-env-in-engine",
      "file": "reviewer-core/src/llm/openrouter.ts",
      "lines": [13, 14],
      "summary": "`reviewer-core` is the pure review engine and must not read process.env. Env access belongs to the composition root in `server/src/platform/container.ts`.",
      "evidence_snippet": "  // hack: fall back to env when caller forgets\n  if (!this.apiKey) this.apiKey = process.env.OPENROUTER_API_KEY ?? \"\";",
      "suggested_fix": "Drop the fallback. Throw `ConfigError` from the engine when `opts.apiKey` is empty. Let the server-side `Container` resolve the key from `SecretsProvider`.",
      "ci_would_catch": false,
      "insights_md_match": "reviewer-core/INSIGHTS.md#engine-purity"
    }
  ]
}
```

### Final report

```
# PR self-review — feat/openrouter-fallback → main

**Verdict:** BLOCK — 1 critical
**Diff:** 1 file, base=aaed7e9, head=<head>

## Critical (1)
### `onion-architecture/no-process-env-in-engine` · `reviewer-core/src/llm/openrouter.ts:13-14`
`reviewer-core` is the pure review engine and must not read process.env. …
```ts
  // hack: fall back to env when caller forgets
  if (!this.apiKey) this.apiKey = process.env.OPENROUTER_API_KEY ?? "";
```
**Fix:** Drop the fallback. Throw `ConfigError` from the engine when …
> Matches INSIGHTS.md: reviewer-core/INSIGHTS.md#engine-purity

---
consulted: onion-architecture@0.1.0, typescript-expert@0.1.0, claude-api@0.1.0
duration: 38s · cached: false
```

`exit 2`.

## Example 2 — UI HIGH, not blocking (PASS)

### Diff

```diff
--- a/client/src/_components/PullList/PullList.tsx
+++ b/client/src/_components/PullList/PullList.tsx
@@ -8,8 +8,12 @@ export function PullList({ pulls }: { pulls: Pull[] }) {
-  const open = pulls.filter((p) => p.state === "open");
+  const [open, setOpen] = useState<Pull[]>([]);
+  useEffect(() => {
+    setOpen(pulls.filter((p) => p.state === "open"));
+  }, [pulls]);
```

### Subagent output

```json
{
  "bucket": "ui-components",
  "consulted_skills": ["react-best-practices", "next-best-practices", "frontend-architecture", "security", "typescript-expert"],
  "files_reviewed": ["client/src/_components/PullList/PullList.tsx"],
  "files_skipped_budget": [],
  "findings": [
    {
      "severity": "HIGH",
      "rule": "react-best-practices/no-useeffect-for-derived-state",
      "file": "client/src/_components/PullList/PullList.tsx",
      "lines": [8, 12],
      "summary": "`open` is fully derivable from `pulls`. Mirroring it into state via useEffect causes an extra render and stale-state bugs when `pulls` changes mid-render.",
      "evidence_snippet": "  const [open, setOpen] = useState<Pull[]>([]);\n  useEffect(() => {\n    setOpen(pulls.filter((p) => p.state === \"open\"));\n  }, [pulls]);",
      "suggested_fix": "Replace lines 8–12 with `const open = useMemo(() => pulls.filter((p) => p.state === \"open\"), [pulls]);` or, for a cheap filter, just `const open = pulls.filter(...);` inline.",
      "ci_would_catch": false
    }
  ]
}
```

### Final report

```
# PR self-review — feat/pull-list-tweak → main

**Verdict:** PASS — 1 high, 0 medium, 0 low
**Diff:** 1 file

## High (1)
### `react-best-practices/no-useeffect-for-derived-state` · client/src/_components/PullList/PullList.tsx:8-12
…
```

`exit 0`. PR creation allowed; the high is informational.

Under `/pr-self-review --strict` the same finding would change verdict to
`BLOCK — 1 high` with `exit 2`.

## Example 3 — Cross-bucket: route without schema (BLOCK)

### Diff

```diff
--- a/server/src/modules/reports/routes.ts
+++ b/server/src/modules/reports/routes.ts
@@ -12,6 +12,11 @@ export const routes: FastifyPluginAsync = async (app) => {
+  app.post("/reports", async (req, reply) => {
+    const body = req.body as { repoId: string; window: string };
+    const out = await app.container.reports.generate(body);
+    return out;
+  });
```

### Per-bucket subagent (backend modules)

Reports a HIGH on `fastify-best-practices/missing-route-schema` — handler
treats `req.body` as `any` via `as` cast.

### Cross-bucket pass (Step 6)

Spots: new `app.post(...)` in `routes.ts` with no zod schema for `body`.

```json
{
  "severity": "CRITICAL",
  "rule": "pr-self-review/route-without-schema",
  "file": "server/src/modules/reports/routes.ts",
  "lines": [12, 16],
  "summary": "Route handler casts `req.body` with `as`. Per server/AGENTS.md, validation MUST happen at the edge via fastify-type-provider-zod, otherwise invalid input becomes a 500 instead of a 422.",
  "evidence_snippet": "app.post(\"/reports\", async (req, reply) => {\n  const body = req.body as { repoId: string; window: string };\n  …\n});",
  "suggested_fix": "Add `{ schema: { body: z.object({ repoId: z.string().uuid(), window: z.enum([\"7d\",\"30d\"]) }) } }` as the second arg of `app.post`, then drop the `as` cast and use `req.body` directly.",
  "ci_would_catch": false,
  "insights_md_match": "server/INSIGHTS.md#validation-at-the-edge"
}
```

### Final report

```
**Verdict:** BLOCK — 1 critical, 1 high
```

`exit 2`. Hook on `gh pr create` blocks the command.

## Example 4 — Inline suppress (PASS)

Same as Example 1, but the developer adds a marker:

```diff
+  // pr-self-review: allow CRITICAL onion-architecture/no-process-env-in-engine — reason: temporary bootstrap path until container DI lands in lesson L04
+  if (!this.apiKey) this.apiKey = process.env.OPENROUTER_API_KEY ?? "";
```

Aggregator sets `suppressed_by: "inline"`. Verdict = `PASS`, but the finding
still appears in the report under a "Suppressed" section with the reason
text, so a human reviewer can sanity-check the escape later.

If the developer forgets `— reason: ...`, a separate
`pr-self-review/suppress-without-reason` `LOW` finding is added and the
original CRITICAL is **not** suppressed → BLOCK.
