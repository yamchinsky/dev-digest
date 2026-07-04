# plan-verifier — worked example

This file shows a complete plan-verifier run against a small sample plan.
Load this when you need a concrete reference for what the coverage matrix
should look like.

---

## Sample plan: `docs/plans/add-webhook-endpoint.md` (excerpt)

```markdown
## Requirements

| ID | Requirement | Acceptance criteria (measurable) |
|----|-------------|----------------------------------|
| R1 | Webhook route exists | `POST /workspaces/:workspaceId/webhooks` route registered in `server/src/modules/webhooks/routes.ts`; Zod `body` schema with `url: z.string().url()` and `events: z.array(z.string()).min(1)` declared on the route; handler calls `getContext` first. |
| R2 | Webhook stored in DB | `webhooks` table exists in `server/src/db/schema/webhooks.ts` with columns `id`, `workspaceId`, `url`, `events` (text array), `createdAt`. Migration file present under `server/src/db/migrations/`. |
| R3 | Service validates ownership | `WebhookService.create()` throws `NotFoundError` when workspace is not found; `ValidationError` when URL is already registered for the workspace. |
| R4 | Client hook exists | `useCreateWebhook` hook exported from `client/src/lib/hooks/webhooks.ts`; uses `useMutation` from TanStack Query; calls `apiFetch`. |

## Tasks

### T1 — Backend · covers: R1, R2, R3
- **Owned paths**: `server/src/modules/webhooks/routes.ts`,
  `server/src/modules/webhooks/service.ts`,
  `server/src/modules/webhooks/repository.ts`,
  `server/src/db/schema/webhooks.ts`,
  `server/src/db/migrations/0042_add_webhooks.sql`
- **Acceptance**: route responds 201 on valid body; 422 on missing url;
  404 when workspace absent; 409 when url duplicate.

### T2 — UI · covers: R4
- **Owned paths**: `client/src/lib/hooks/webhooks.ts`
- **Acceptance**: `useCreateWebhook` exported; mutation calls POST endpoint.
```

---

## Verifier run

### Step 1 — Parse the plan

Requirements extracted:

| Req ID | Sub-criteria |
|--------|-------------|
| R1-a | Route `POST /workspaces/:workspaceId/webhooks` in `routes.ts` |
| R1-b | Zod body schema: `url: z.string().url()`, `events: z.array(z.string()).min(1)` |
| R1-c | Handler calls `getContext` first |
| R2-a | `webhooks` table in `server/src/db/schema/webhooks.ts` with required columns |
| R2-b | Migration file in `server/src/db/migrations/` |
| R3-a | `WebhookService.create()` throws `NotFoundError` when workspace absent |
| R3-b | `WebhookService.create()` throws `ValidationError` when URL duplicate |
| R4-a | `useCreateWebhook` exported from `client/src/lib/hooks/webhooks.ts` |
| R4-b | Uses `useMutation` from TanStack Query |
| R4-c | Calls `apiFetch` |

### Step 2 — Evidence search

**R1-a:** Route registration
```
Grep("POST.*webhooks", "server/src/modules/webhooks/routes.ts")
→ routes.ts:14:  app.post('/workspaces/:workspaceId/webhooks', { schema: … }, handler)
```
Evidence: `server/src/modules/webhooks/routes.ts:14`

**R1-b:** Zod body schema
```
Read("server/src/modules/webhooks/routes.ts", lines 5–25)
→ body: z.object({ url: z.string().url(), events: z.array(z.string()).min(1) })
```
Evidence: `server/src/modules/webhooks/routes.ts:8-9`

**R1-c:** `getContext` in handler
```
Grep("getContext", "server/src/modules/webhooks/routes.ts")
→ routes.ts:18:  const { workspaceId, userId } = await getContext(app.container, req);
```
Evidence: `server/src/modules/webhooks/routes.ts:18`

**R2-a:** Schema table
```
Read("server/src/db/schema/webhooks.ts")
→ export const webhooks = pgTable('webhooks', {
     id: uuid('id').primaryKey(),
     workspaceId: uuid('workspace_id').notNull(),
     url: text('url').notNull(),
     events: text('events').array().notNull(),
     createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
   });
```
All five required columns present.
Evidence: `server/src/db/schema/webhooks.ts:3-9`

**R2-b:** Migration file
```
Glob("server/src/db/migrations/*webhooks*")
→ server/src/db/migrations/0042_add_webhooks.sql
```
Evidence: `server/src/db/migrations/0042_add_webhooks.sql` (file exists)

**R3-a:** NotFoundError on missing workspace
```
Grep("NotFoundError", "server/src/modules/webhooks/service.ts")
→ service.ts:22:  throw new NotFoundError(`Workspace ${workspaceId} not found`);
```
Evidence: `server/src/modules/webhooks/service.ts:22`

**R3-b:** ValidationError on duplicate URL
```
Grep("ValidationError", "server/src/modules/webhooks/service.ts")
→ (0 results)
Grep("409\|duplicate\|already", "server/src/modules/webhooks/service.ts")
→ service.ts:31:  reply.status(409).send({ error: 'URL already registered' });
```
Found duplicate check but implemented as `reply.status(409).send(…)` rather than
throwing `ValidationError`. The acceptance criterion requires a `ValidationError`
throw; the ad-hoc `reply.send` bypasses the `AppError` envelope. Status: PARTIAL.

**R4-a:** Hook export
```
Grep("export.*useCreateWebhook", "client/src/lib/hooks/webhooks.ts")
→ hooks/webhooks.ts:18:  export function useCreateWebhook() {
```
Evidence: `client/src/lib/hooks/webhooks.ts:18`

**R4-b:** `useMutation`
```
Grep("useMutation", "client/src/lib/hooks/webhooks.ts")
→ hooks/webhooks.ts:19:  return useMutation({
```
Evidence: `client/src/lib/hooks/webhooks.ts:19`

**R4-c:** `apiFetch`
```
Grep("apiFetch", "client/src/lib/hooks/webhooks.ts")
→ hooks/webhooks.ts:20:    mutationFn: (body) => apiFetch('/workspaces/…', { method: 'POST', body }),
```
Evidence: `client/src/lib/hooks/webhooks.ts:20`

---

## Coverage matrix output

```
# Plan coverage: add-webhook-endpoint

**Plan file:** `docs/plans/add-webhook-endpoint.md`
**Verdict:** GAPS FOUND (1 partial, 0 missing)

## Coverage matrix

| Req ID | Criterion (abbreviated)               | Status  | Evidence |
|--------|---------------------------------------|---------|----------|
| R1-a   | POST route registered in routes.ts    | COVERED | `server/src/modules/webhooks/routes.ts:14` — `app.post('/workspaces/:workspaceId/webhooks', …)` |
| R1-b   | Zod body schema url + events          | COVERED | `server/src/modules/webhooks/routes.ts:8-9` — `z.string().url()`, `z.array(z.string()).min(1)` |
| R1-c   | Handler calls getContext first        | COVERED | `server/src/modules/webhooks/routes.ts:18` — `await getContext(app.container, req)` |
| R2-a   | webhooks table with 5 required cols   | COVERED | `server/src/db/schema/webhooks.ts:3-9` — all columns present |
| R2-b   | Migration file present                | COVERED | `server/src/db/migrations/0042_add_webhooks.sql` (file exists) |
| R3-a   | NotFoundError on missing workspace    | COVERED | `server/src/modules/webhooks/service.ts:22` — `throw new NotFoundError(…)` |
| R3-b   | ValidationError on duplicate URL      | PARTIAL | `service.ts:31` has duplicate check but uses `reply.status(409).send(…)` instead of `throw new ValidationError(…)` |
| R4-a   | useCreateWebhook exported             | COVERED | `client/src/lib/hooks/webhooks.ts:18` — `export function useCreateWebhook()` |
| R4-b   | Uses useMutation                      | COVERED | `client/src/lib/hooks/webhooks.ts:19` — `return useMutation({…})` |
| R4-c   | Calls apiFetch                        | COVERED | `client/src/lib/hooks/webhooks.ts:20` — `apiFetch('/workspaces/…', …)` |

## Gaps (PARTIAL / MISSING)

### R3-b — ValidationError when URL already registered
Status: PARTIAL
Found: `server/src/modules/webhooks/service.ts:31` — duplicate URL check present.
Missing: The acceptance criterion requires `throw new ValidationError(…)`.
The current implementation calls `reply.status(409).send({ error: … })` directly,
which bypasses the AppError envelope. The check logic exists but the error type
does not match.
Note: This is a coverage gap, not a quality observation — report to pr-self-review
for the AppError violation; report to the implementer if a re-run is needed.
```

---

## Key lessons from this example

- **Break compound criteria into sub-rows.** R1 had three independent
  verifiable items (route path, Zod schema, `getContext` call); they were
  split into R1-a / R1-b / R1-c so each can have an independent status.
- **Quote the exact line.** Evidence is `path:line — <quoted fragment>`,
  not just a filename.
- **PARTIAL is not MISSING.** R3-b found the check but the type differed
  from the criterion. The sub-criteria for "throws ValidationError" is not
  satisfied, but the sub-criteria for "detects duplicate URL" is. That is
  PARTIAL.
- **Coverage ≠ quality.** The ad-hoc `reply.send` on line 31 is an AppError
  violation — that is a `pr-self-review` finding, not a coverage finding.
  The verifier notes it but does not flag it as a code quality issue itself.
- **File existence as evidence.** For R2-b (migration file), `Glob` returning
  the filename is sufficient evidence. No need to read the file contents.
