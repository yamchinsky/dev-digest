#!/usr/bin/env bash
#
# DevDigest L03 verification — Intent layer + Smart Diff.
#
#   bash scripts/verify-l03.sh
#
# Runs, in order:
#   1. server typecheck   (pnpm -C server exec tsc --noEmit)
#   2. client typecheck   (pnpm -C client exec tsc --noEmit)
#   3. reviewer-core build (cd reviewer-core && npm run build)
#   4. server L03 tests   (intent + smart-diff, hermetic + testcontainers)
#   5. client L03 tests   (IntentCard + SmartDiffViewer)
#
# Exits 0 only when all steps pass. set -euo pipefail propagates any failure.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✗ FAILED: %s\033[0m\n' "$*" >&2; exit 1; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
# Step 1 — server typecheck
# ---------------------------------------------------------------------------
log "Step 1/5 — server typecheck"
pnpm -C server exec tsc --noEmit || fail "server typecheck"
ok "server typecheck passed"

# ---------------------------------------------------------------------------
# Step 2 — client typecheck
# ---------------------------------------------------------------------------
log "Step 2/5 — client typecheck"
pnpm -C client exec tsc --noEmit || fail "client typecheck"
ok "client typecheck passed"

# ---------------------------------------------------------------------------
# Step 3 — reviewer-core build (= typecheck; uses npm, not pnpm)
# ---------------------------------------------------------------------------
log "Step 3/5 — reviewer-core build"
(cd reviewer-core && npm run build) || fail "reviewer-core build"
ok "reviewer-core build passed"

# ---------------------------------------------------------------------------
# Step 4 — server L03 tests (hermetic + testcontainers)
# The *.it.test.ts files self-skip when Docker is unavailable, so this step
# is safe on Docker-less machines; on machines with Docker the IT tests run.
# ---------------------------------------------------------------------------
log "Step 4/5 — server L03 tests (intent + smart-diff)"
pnpm -C server exec vitest run \
  src/modules/reviews/intent.test.ts \
  src/modules/reviews/smart-diff.test.ts \
  src/modules/reviews/intent.it.test.ts \
  src/modules/reviews/smart-diff.it.test.ts \
  || fail "server L03 tests"
ok "server L03 tests passed"

# ---------------------------------------------------------------------------
# Step 5 — client L03 tests (IntentCard + SmartDiffViewer)
# ---------------------------------------------------------------------------
log "Step 5/5 — client L03 tests (IntentCard + SmartDiffViewer)"
pnpm -C client exec vitest run \
  'src/app/repos/[repoId]/pulls/[number]/_components/IntentCard' \
  'src/components/diff-viewer/SmartDiffViewer' \
  || fail "client L03 tests"
ok "client L03 tests passed"

# ---------------------------------------------------------------------------
# All steps green
# ---------------------------------------------------------------------------
printf '\n\033[1;32m✔ All L03 checks passed.\033[0m\n'
