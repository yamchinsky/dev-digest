#!/usr/bin/env bash
#
# DevDigest L06 verification — Eval pipeline.
#
#   bash scripts/verify-l06.sh
#
# Runs, in order:
#   1. server typecheck        (pnpm -C server exec tsc --noEmit)
#   2. client typecheck        (pnpm -C client exec tsc --noEmit)
#   3. reviewer-core build     (cd reviewer-core && npm run build)
#   4. scoring unit tests      (pnpm -C server exec vitest run src/modules/eval/scoring.test.ts)
#   5. server eval IT tests    (eval.it.test.ts + seed-eval-cases.it.test.ts)
#   6. client eval tests       (EvalsTab + eval-cases + FindingCard)
#
# Exits 0 only when all steps pass. set -euo pipefail propagates any failure.
# The *.it.test.ts files self-skip when Docker is unavailable (vitest exits 0
# on skipped suites), so step 5 is safe on Docker-less machines.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✗ FAILED: %s\033[0m\n' "$*" >&2; exit 1; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
# Spec existence check
# ---------------------------------------------------------------------------
test -f specs/eval-pipeline.md || fail "specs/eval-pipeline.md not found"
test -f specs/SPEC-04-2026-07-eval-pipeline.md || fail "SPEC-04 file not found"

# ---------------------------------------------------------------------------
# Step 1 — server typecheck
# ---------------------------------------------------------------------------
log "Step 1/6 — server typecheck"
pnpm -C server exec tsc --noEmit || fail "server typecheck"
ok "server typecheck passed"

# ---------------------------------------------------------------------------
# Step 2 — client typecheck
# ---------------------------------------------------------------------------
log "Step 2/6 — client typecheck"
pnpm -C client exec tsc --noEmit || fail "client typecheck"
ok "client typecheck passed"

# ---------------------------------------------------------------------------
# Step 3 — reviewer-core build (= typecheck; uses npm, not pnpm)
# ---------------------------------------------------------------------------
log "Step 3/6 — reviewer-core build"
(cd reviewer-core && npm run build) || fail "reviewer-core build"
ok "reviewer-core build passed"

# ---------------------------------------------------------------------------
# Step 4 — scoring unit tests (hermetic, no Docker required)
# ---------------------------------------------------------------------------
log "Step 4/6 — scoring unit tests"
pnpm -C server exec vitest run \
  src/modules/eval/scoring.test.ts \
  || fail "scoring unit tests"
ok "scoring unit tests passed"

# ---------------------------------------------------------------------------
# Step 5 — server eval IT tests (testcontainers; self-skip without Docker)
# vitest exits 0 when suites are skipped, so this step is safe on Docker-less
# machines; on machines with Docker the IT tests run in full.
# ---------------------------------------------------------------------------
log "Step 5/6 — server eval IT tests"
pnpm -C server exec vitest run \
  src/modules/eval/eval.it.test.ts \
  src/db/seed-eval-cases.it.test.ts \
  || fail "server eval IT tests"
ok "server eval IT tests passed"

# ---------------------------------------------------------------------------
# Step 6 — client eval tests (EvalsTab + eval-cases + FindingCard)
# Paths with [id] are single-quoted so the shell does not glob-expand them.
# ---------------------------------------------------------------------------
log "Step 6/6 — client eval tests"
pnpm -C client exec vitest run \
  'src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab' \
  'src/app/agents/[id]/eval-cases' \
  'src/app/repos/[repoId]/pulls/[number]/_components/FindingCard' \
  'src/app/eval-dashboard' \
  'src/components/evals' \
  'src/lib/hooks/evals.test.ts' \
  || fail "client eval tests"
ok "client eval tests passed"

# ---------------------------------------------------------------------------
# All steps green
# ---------------------------------------------------------------------------
printf '\n\033[1;32m✔ All L06 checks passed.\033[0m\n'
