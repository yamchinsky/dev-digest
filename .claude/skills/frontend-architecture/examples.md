# Folder-tree examples

Concrete layouts referenced from [SKILL.md](SKILL.md). Three sizes, three philosophies.

---

## A. Small Vite React app (~20 files, <30 components)

Use this until you have ≥2 distinct domains. Flat, no `features/`, no `lib/` yet.

```
my-app/
├── public/
├── src/
│   ├── components/
│   │   ├── ui/                  # Generic UI (Button, Card, Modal)
│   │   │   ├── Button.tsx
│   │   │   └── Card.tsx
│   │   ├── Header.tsx
│   │   └── Footer.tsx
│   ├── hooks/
│   │   └── useDebounce.ts
│   ├── utils/
│   │   └── format-date.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### Decisions encoded
- No `features/` — single domain
- No `lib/` — no third-party wrappers yet
- No `services/` — fetch logic lives in components or hooks (until it's worth extracting)
- No `constants/` — module-level constants inside the files that need them
- `components/ui/` separated from app-level components

### When to graduate from this layout
- ≥2 distinct domains → add `features/`
- Recurring third-party setup (axios, supabase) → add `lib/`
- ≥3 cross-feature constants (routes, env keys) → add `constants/`

---

## B. Mid-size Next.js App Router app (~100-200 files, 3-6 features)

Production app, App Router. Hybrid: `app/` for routing only, `features/` for domain code, shared infrastructure in `lib/`, `utils/`, `components/`.

```
my-app/
├── public/
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # root layout
│   │   ├── page.tsx                   # /
│   │   ├── (marketing)/               # route group (no URL effect)
│   │   │   ├── layout.tsx             # marketing layout
│   │   │   ├── pricing/page.tsx       # /pricing
│   │   │   └── about/page.tsx         # /about
│   │   ├── (app)/                     # authenticated app
│   │   │   ├── layout.tsx             # app shell
│   │   │   ├── dashboard/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── _components/       # private — used only here
│   │   │   │   │   └── StatsCard.tsx
│   │   │   │   └── _hooks/
│   │   │   │       └── useStats.ts
│   │   │   └── billing/
│   │   │       ├── page.tsx
│   │   │       └── _components/
│   │   │           └── InvoiceTable.tsx
│   │   └── api/
│   │       └── webhooks/stripe/route.ts
│   │
│   ├── features/
│   │   ├── billing/                   # cross-route domain code
│   │   │   ├── _components/Invoice.tsx
│   │   │   ├── hooks/useBilling.ts
│   │   │   ├── api/                   # client mutations + queries
│   │   │   │   └── invoices.ts
│   │   │   ├── constants.ts
│   │   │   └── types.ts
│   │   └── auth/
│   │       ├── _components/SignInForm.tsx
│   │       └── hooks/useAuth.ts
│   │
│   ├── components/
│   │   └── ui/                        # generic UI library (shadcn-style)
│   │       ├── button.tsx
│   │       ├── card.tsx
│   │       └── dialog.tsx
│   │
│   ├── hooks/                         # generic, cross-feature
│   │   ├── useDebounce.ts
│   │   └── useMediaQuery.ts
│   │
│   ├── lib/                           # wrappers around external libs
│   │   ├── db.ts                      # drizzle/prisma setup
│   │   ├── auth.ts                    # auth provider setup
│   │   ├── stripe.ts
│   │   └── cn.ts                      # className helper
│   │
│   ├── utils/                         # pure, generic
│   │   ├── format-currency.ts
│   │   └── format-date.ts
│   │
│   ├── services/                      # I/O / side-effectful, server-side
│   │   └── billing.ts                 # server actions, API callers
│   │
│   ├── constants/                     # cross-feature
│   │   ├── routes.ts
│   │   └── env.ts
│   │
│   └── types/                         # cross-feature
│       └── api.ts
│
├── next.config.ts
├── package.json
└── tsconfig.json
```

### Decisions encoded
- `app/` contains routing files + private `_components/` and `_hooks/` for things used by exactly one segment
- Cross-route domain code lives in `features/<feature>/`
- Generic UI (shadcn-style) lives in `components/ui/`
- `lib/` for third-party setup, `utils/` for pure helpers, `services/` for I/O
- Route groups `(marketing)` and `(app)` share layouts without nesting URLs
- Constants split: per-feature in `features/<f>/constants.ts`, cross-feature in `src/constants/`

### What does NOT go where
- A Stripe webhook handler does NOT go in `features/billing/` — it goes under `app/api/webhooks/stripe/route.ts` (Next.js convention)
- A pure `format-currency` does NOT go in `lib/` — it goes in `utils/` (no third-party dep)
- Drizzle DB setup does NOT go in `services/` — it goes in `lib/db.ts` (it's a wrapper)
- A billing query function called from a hook does NOT go in `utils/` — it goes in `features/billing/api/` or `services/billing.ts`

---

## C. Large feature-based React app (bulletproof-react style)

For large product apps where strict boundaries matter. Source: [bulletproof-react/docs/project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md).

```
src/
├── app/                          # application-level setup
│   ├── routes/                   # route definitions
│   ├── App.tsx
│   ├── provider.tsx              # global providers (Query, Theme, Auth)
│   └── router.tsx
│
├── assets/                       # static assets imported into code
│
├── components/                   # shared, reusable across the whole app
│   ├── ui/                       # base design-system primitives
│   └── layout/                   # layout primitives (Page, Section)
│
├── config/                       # global config (env vars, paths)
│   └── env.ts
│
├── features/                     # ★ the core — one folder per domain
│   ├── discussions/
│   │   ├── api/                  # query/mutation hooks + raw fetchers
│   │   ├── components/           # feature-specific components
│   │   ├── hooks/                # feature-specific hooks
│   │   ├── stores/               # feature-specific local state
│   │   ├── types/
│   │   ├── utils/
│   │   └── index.ts              # ★ public API of the feature (barrel)
│   ├── auth/
│   └── users/
│
├── hooks/                        # shared, cross-feature hooks
│
├── lib/                          # configured third-party libs
│   ├── axios.ts
│   ├── react-query.ts
│   └── auth.ts
│
├── stores/                       # global state (cross-feature)
│
├── testing/                      # test setup, mocks, fixtures
│
├── types/                        # shared types (Entity, ApiResponse)
│
└── utils/                        # shared utility functions
```

### Decisions encoded
- Every `feature/<name>/` is a black box: outsiders import only via `feature/<name>/index.ts`
- Enforced by ESLint `import/no-restricted-paths`:
  - `features/*` can import from `components/`, `hooks/`, `lib/`, `utils/`, `types/`
  - `components/`, `hooks/`, `utils/` CANNOT import from `features/*`
  - One feature CANNOT import from another feature's internals — only from its `index.ts`
- This breaks if features need to share data — see bulletproof-react docs for the escape hatch

### When this is overkill
- Solo project or team <3 engineers
- App has <3 features
- You don't have a real reason to enforce hard boundaries

---

## Quick comparison

| | Small Vite (A) | Mid Next App Router (B) | bulletproof-react (C) |
|---|---|---|---|
| `features/` | ❌ | ✅ peer | ✅ peer + enforced boundaries |
| `app/` | n/a | ✅ Next routing | ✅ App setup folder |
| `lib/` | ❌ | ✅ | ✅ |
| `services/` | ❌ | ✅ for server I/O | inside feature `api/` |
| Barrel exports | ❌ | ❌ (avoid for tree-shaking) | ✅ for feature public APIs |
| Boundary enforcement | n/a | manual | ESLint `import/no-restricted-paths` |
| When to use | <30 files | 100-300 files, product app | 500+ files, multi-team |
