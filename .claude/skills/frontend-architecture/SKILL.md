---
name: frontend-architecture
description: "Folder structure and code organization for React + Next.js (App Router) projects. Use this skill whenever the user asks where files should live (components, hooks, utils, helpers, lib, services, constants, types), how to break a component into smaller pieces, how to organize a feature folder, where to put business logic, when to use a barrel index, or how to lay out app/ in Next.js (route groups, private folders). Trigger on phrases like 'folder structure', 'project structure', 'where should I put', 'how to organize', 'where do constants go', 'utils vs helpers', 'app router structure'. Covers organization decisions only — NOT React hook rules or render patterns (use react-best-practices) and NOT Next-specific runtime behavior (use next-best-practices)."
version: 0.1.0
---

# Frontend Architecture — folder structure & code organization

Where files should live in a React + Next.js (App Router) project. **Organization decisions only** — not hook rules (see `react-best-practices`), not RSC / runtime behavior (see `next-best-practices`).

For concrete folder-tree examples, see [examples.md](examples.md). For sources, version history, and relationship to other skills, see [README.md](README.md).

## When to use this skill

- Setting up a new React/Next.js project
- Refactoring a project that has outgrown its initial layout
- Deciding the placement of a new file (component, hook, util, constant, type)
- Reviewing a PR that adds or moves files
- Resolving "where does this go" debates with concrete decision rules

## Severity levels

Each rule is tagged for use by consuming agents:

- **CRITICAL** — Wrong choice causes deep rewrites; affects every future file
- **HIGH** — Wrong choice creates lasting maintenance friction
- **MEDIUM** — Wrong choice hurts DX but is locally fixable

---

## 1. Top-level folder structure (CRITICAL)

### Use `src/` for non-trivial apps
- Keeps app code separate from config/tooling at the repo root
- Both Vite and Next.js support `src/`; Next.js looks for `src/app` if `app/` is not at the root
- Forbidden in Next.js: `app/` at root **and** `src/app/` together

### Default top-level layout

```
src/
├── app/             # Next.js: routing only. Vite: not used
├── components/      # Shared, generic UI (Button, Card, Modal)
├── features/        # Domain-scoped modules (one folder per feature)
├── hooks/           # Shared, generic hooks (useDebounce, useMediaQuery)
├── lib/             # Wrappers around external libs (axios.ts, db.ts, auth.ts)
├── utils/           # Pure, generic, project-agnostic functions
├── types/           # Shared types (only if not feature-scoped)
└── constants/       # Cross-feature constants (routes, env keys, enums)
```

Each of these folders is **optional** — introduce it only when there are ≥2 things to put in it.

### Decision rule: when to introduce `features/`

Add `features/` once the app has **≥2 distinct domains** (e.g. "billing", "settings", "team"). Before that, a flat `components/` + `hooks/` is fine. Don't pre-create `features/` on day 1.

---

## 2. Feature-based vs layer-based vs atomic (HIGH)

| Style | When | Trade-off |
|---|---|---|
| **By type** (`components/`, `hooks/`, `utils/`) | Small apps (<30 files) | Easy start, breaks down past ~50 files |
| **Feature-based** | Default for product apps | Best balance of discoverability and scope |
| **Layer-based / FSD** | Large, multi-team apps with enforced boundaries | High ceremony; real wins only past ~500 files |
| **Atomic design** | Design systems / component libraries only | Ambiguous boundaries when applied to whole apps |

**Default: feature-based.** Atomic design belongs in a *separate* design-system package, not in your product app.

---

## 3. Co-location (HIGH)

### The rule (Kent C. Dodds)
> Place code as close to where it's relevant as possible.

### What colocates with a component
- Its tests (`X.test.tsx`)
- Its styles (`X.module.css` or Tailwind inline)
- Its private hooks (`useX.ts`)
- Its sub-components used only by it (`_components/`)
- Its constants and types used only by it

### Component file shape: barrel vs flat

```
# Barrel style
Button/
├── index.ts            # re-exports Button
├── Button.tsx
├── Button.test.tsx
└── _components/
    └── ButtonIcon.tsx

# Flat style
Button.tsx
Button.test.tsx
```

**Decision rule:**
- Barrel folder when the component has ≥2 internal files (tests + sub-components + styles)
- Flat single-file when the component is small and self-contained
- **Avoid barrel `index.ts` files inside `utils/` and `components/ui/`** — they hurt Next.js tree-shaking ([vercel/next.js#92926](https://github.com/vercel/next.js/discussions/92926))

---

## 4. Constants — where do they go (MEDIUM)

| Constant scope | Where |
|---|---|
| Used by one component, static | Module-level (top of component file, **outside** the function) |
| Used by multiple files in one feature | `features/<feature>/constants.ts` |
| Globally meaningful (routes, env keys, shared enums) | `src/constants/` |
| Depends on props/state | Inline (computed in component) |

**Never declare static constants inside the component function body** — they're re-created on every render.

---

## 5. utils vs helpers vs lib vs services (HIGH)

Pick **one convention per project** and document it. The most defensible split:

| Folder | What goes in | Example |
|---|---|---|
| `lib/` | Wrappers around external libraries; mini-packages (could be extracted as npm) | `lib/axios.ts`, `lib/db.ts`, `lib/cn.ts` |
| `utils/` | Pure, generic, **project-agnostic** functions | `utils/format-date.ts`, `utils/range.ts` |
| `services/` | Functions that **do work** (I/O, API calls, business actions) | `services/billing.ts`, `services/auth.ts` |
| `helpers/` | Avoid — overlaps with `utils/`. If used, restrict to project-specific glue |

### Decision rule for an unsure case
1. Pure, no side effects, could go in a generic npm lib → `utils/`
2. Wraps a third-party API or sets up an instance → `lib/`
3. Does I/O or has side effects → `services/`
4. Used only inside one feature → colocate there, do not promote to shared

---

## 6. Business logic — where does it live (CRITICAL)

### The rule
**Components render UI. Hooks own logic. Services do work.** Components should not contain business logic.

### Layers (modern Container / Hook / View)

```
View (presentational component)
  ↑ props
Container (wires hook + view)
  ↑ uses
Hook (logic, state, derived values)
  ↑ calls
Service / API layer (lib/, services/, or features/<f>/api/)
```

### Decision rule: where a piece of logic goes

| Logic kind | Goes in |
|---|---|
| Stateful UI behavior (toggles, debounces, form state) | Custom hook |
| Client-side server-data fetching (React Query) | Custom hook wrapping a service |
| Server-side data fetching (RSC) | `lib/` async fn or colocated with the route |
| Pure transform of input → output | `utils/` |
| Side effect (network, storage, analytics) | `services/` or `lib/` |
| Cross-feature state (auth, theme) | Context + hook in `lib/` or `providers/` |

### App Router caveat
In Next.js App Router, server-side data fetching commonly lives inside the route segment (`page.tsx`) or in `lib/` async functions. Client mutations + React Query still benefit from the hook layer.

---

## 7. Component breakdown (HIGH)

### When to split
Split a component when **any** of these is true:
- More than ~200 lines
- More than ~5–7 props
- Multiple unrelated responsibilities (data fetch + form + chart in one file)
- The same JSX structure repeats ≥3 times within the file
- Prop drilling more than 2 levels deep
- A sub-piece needs its own state

### Don't pre-split
- Don't extract a sub-component on day 1 for hypothetical reuse — wait for the second real consumer
- Three similar lines is fine; abstract on the third *real* consumer
- "Reusable" components with one consumer are premature

### Where the sub-component lives
- Used **only by parent** → `Parent/_components/Sub.tsx` (private folder)
- Used by parent **and** ≥1 sibling in the same feature → `features/<f>/_components/`
- Used across features → promote to `src/components/`

### Naming
- Component files: PascalCase (`UserCard.tsx`)
- Hook files: camelCase, always `use`-prefixed (`useUser.ts`)
- Non-component utility files: kebab-case (`format-date.ts`)
- Folders: kebab-case for non-component (`auth-flow/`), PascalCase only for component folders (`UserCard/`)

---

## 8. Next.js App Router specifics (CRITICAL for Next projects)

### Routing-only convention
Everything in `app/` is one of:
- A **route file** — `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `route.ts`, `not-found.tsx`, `template.tsx`
- A **private folder** — `_anything/` — excluded from routing
- A **route group** — `(name)/` — affects organization, NOT the URL

### Where non-route code goes

**Inside `app/`** only if it's used only by that segment:
```
app/(dashboard)/billing/
├── page.tsx
├── _components/InvoiceTable.tsx   # used only by this route
└── _hooks/useInvoices.ts
```

**Outside `app/`** if it's shared:
```
src/features/billing/    # shared by app/billing AND app/admin/billing
src/components/ui/       # generic UI used everywhere
```

### Route groups for organization
Use route groups to share a layout across pages **without** nesting in the URL:
```
app/
├── (marketing)/         # public marketing pages
│   ├── layout.tsx       # marketing layout
│   ├── page.tsx         # /
│   └── pricing/page.tsx # /pricing
└── (app)/               # authenticated app
    ├── layout.tsx       # app shell layout
    └── dashboard/page.tsx # /dashboard
```

### Server vs client component placement
- File **location** does not determine server/client — only the `"use client"` directive does
- Push `"use client"` as low in the tree as possible (leaves, not roots)
- Server components have no state, no effects, can be `async`

---

## Decision flowchart (one-page summary)

```
NEW FILE → WHAT IS IT?

├── React component
│    ├── Used by one route → app/<route>/_components/  (Next)
│    │                       features/<f>/_components/ (Vite)
│    ├── Shared in one feature → features/<f>/_components/
│    └── Used across features → src/components/
│
├── Custom hook
│    ├── Used by one feature → features/<f>/hooks/
│    └── Generic → src/hooks/
│
├── Pure function
│    ├── Project-agnostic → src/utils/
│    └── Wraps an external lib → src/lib/
│
├── Function with I/O / side effects → src/services/ or features/<f>/api/
│
├── Constant
│    ├── Used by one file → top of that file (outside the component)
│    ├── Shared in one feature → features/<f>/constants.ts
│    └── Cross-feature → src/constants/
│
└── Type / DTO
     ├── Used by one feature → features/<f>/types.ts
     └── Cross-feature → src/types/
```

---

For folder-tree examples (small Vite, mid-size Next, bulletproof-react style), see [examples.md](examples.md).
