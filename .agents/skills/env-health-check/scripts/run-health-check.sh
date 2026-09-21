#!/usr/bin/env bash
# env-health-check: Full environment health check wrapper.
# Calls the hook script for production checks and also validates local env config.
# Usage: bash "${CLAUDE_SKILL_DIR}/scripts/run-health-check.sh"

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
HOOK_SCRIPT="${REPO_ROOT}/.claude/hooks/env-health-check.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

ISSUES=0
WARNINGS=0

pass() { echo -e "  ${GREEN}PASS${NC}: $1"; }
fail() { echo -e "  ${RED}FAIL${NC}: $1"; ISSUES=$((ISSUES + 1)); }
warn() { echo -e "  ${YELLOW}WARN${NC}: $1"; WARNINGS=$((WARNINGS + 1)); }
section() { echo -e "\n${CYAN}=== $1 ===${NC}"; }

echo "=============================================="
echo "  SpawnForge Environment Health Check"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================================="

# ---------------------------------------------------------------------------
# 1. Local .env.local file
# ---------------------------------------------------------------------------
section "Local Environment File"

ENV_FILE="${REPO_ROOT}/web/.env.local"
if [ -f "$ENV_FILE" ]; then
  pass ".env.local exists at web/.env.local"
else
  fail ".env.local missing — run: vercel env pull web/.env.local --scope tnolan"
fi

# ---------------------------------------------------------------------------
# 2. Required environment variables
# ---------------------------------------------------------------------------
section "Required Environment Variables"

REQUIRED_VARS=(
  "DATABASE_URL"
  "CLERK_SECRET_KEY"
  "STRIPE_SECRET_KEY"
  "UPSTASH_REDIS_REST_URL"
)

if [ -f "$ENV_FILE" ]; then
  for var in "${REQUIRED_VARS[@]}"; do
    # grep the file (value may be empty string, so just check key presence)
    if grep -q "^${var}=" "$ENV_FILE" 2>/dev/null; then
      VAL=$(grep "^${var}=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
      if [ -n "$VAL" ]; then
        pass "${var} is set"
      else
        warn "${var} key present but value is empty"
      fi
    else
      fail "${var} is missing from web/.env.local"
    fi
  done
else
  warn "Skipping env var checks — web/.env.local does not exist"
fi

# Optional but important vars — warn if missing
OPTIONAL_VARS=(
  "UPSTASH_REDIS_REST_TOKEN"
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
  "STRIPE_WEBHOOK_SECRET"
  "SENTRY_DSN"
  "NEXT_PUBLIC_ENGINE_CDN_URL"
)

for var in "${OPTIONAL_VARS[@]}"; do
  if [ -f "$ENV_FILE" ] && grep -q "^${var}=" "$ENV_FILE" 2>/dev/null; then
    VAL=$(grep "^${var}=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    if [ -n "$VAL" ]; then
      pass "${var} is set (optional)"
    else
      warn "${var} key present but value is empty (optional)"
    fi
  else
    warn "${var} not set — some features may not work locally (optional)"
  fi
done

# ---------------------------------------------------------------------------
# 3. Node version check
# ---------------------------------------------------------------------------
section "Node Version"

REQUIRED_NODE_MAJOR=20
NODE_VERSION=$(node --version 2>/dev/null || echo "not-found")

if [ "$NODE_VERSION" = "not-found" ]; then
  fail "Node.js not found — install Node.js ${REQUIRED_NODE_MAJOR}.x"
else
  NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d'.' -f1)
  if [ "$NODE_MAJOR" -ge "$REQUIRED_NODE_MAJOR" ]; then
    pass "Node ${NODE_VERSION} (>= ${REQUIRED_NODE_MAJOR}.x required)"
    if [ "$NODE_MAJOR" -ge 25 ]; then
      warn "Node ${NODE_VERSION} — Node 25.x has intermittent V8 JIT segfaults. Prefer Node 20.x LTS."
    fi
  else
    fail "Node ${NODE_VERSION} is too old — upgrade to Node ${REQUIRED_NODE_MAJOR}.x or later"
  fi
fi

# ---------------------------------------------------------------------------
# 4. Production environment checks (delegates to hook script)
# ---------------------------------------------------------------------------
section "Production Environment (via hook script)"

if [ -f "$HOOK_SCRIPT" ]; then
  # Temporarily remove the stale-check guard so we always run in full mode
  # by calling the script directly (it exits 0 if recently checked)
  echo "  Running production checks via hook script..."
  # Force the hook to run by temporarily clearing the last-check timestamp
  LAST_CHECK_FILE="${REPO_ROOT}/.claude/.env-health-last-check"
  BACKUP_TIMESTAMP=""
  if [ -f "$LAST_CHECK_FILE" ]; then
    BACKUP_TIMESTAMP=$(cat "$LAST_CHECK_FILE")
    rm -f "$LAST_CHECK_FILE"
  fi

  HOOK_OUTPUT=$(bash "$HOOK_SCRIPT" 2>&1 || true)

  # Restore backup
  if [ -n "$BACKUP_TIMESTAMP" ]; then
    echo "$BACKUP_TIMESTAMP" > "$LAST_CHECK_FILE"
  fi

  if [ -n "$HOOK_OUTPUT" ]; then
    echo "  $HOOK_OUTPUT"
    if echo "$HOOK_OUTPUT" | grep -q "CRITICAL"; then
      ISSUES=$((ISSUES + 1))
    elif echo "$HOOK_OUTPUT" | grep -q "WARNING"; then
      WARNINGS=$((WARNINGS + 1))
    fi
  else
    pass "Production environment looks healthy (no warnings from hook)"
  fi
else
  warn "Hook script not found at ${HOOK_SCRIPT} — skipping production checks"
fi

# ---------------------------------------------------------------------------
# 5. Summary
# ---------------------------------------------------------------------------
echo ""
echo "=============================================="
if [ "$ISSUES" -gt 0 ]; then
  echo -e "  ${RED}RESULT: ISSUES FOUND — ${ISSUES} failure(s), ${WARNINGS} warning(s)${NC}"
  echo "  Run: vercel env pull web/.env.local --scope tnolan"
  echo "  See: .claude/skills/env-health-check/references/required-env-vars.md"
elif [ "$WARNINGS" -gt 0 ]; then
  echo -e "  ${YELLOW}RESULT: ${WARNINGS} warning(s) — review above${NC}"
else
  echo -e "  ${GREEN}RESULT: ALL CHECKS PASSED${NC}"
fi
echo "=============================================="

# Update last-check timestamp
date +%s > "${REPO_ROOT}/.claude/.env-health-last-check"

exit "$ISSUES"
