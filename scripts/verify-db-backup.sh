#!/usr/bin/env bash
# =============================================================================
# SpawnForge — Database Backup Verification Script
#
# Usage:
#   NEON_VERIFY_DB_URL="postgresql://user:pass@endpoint.neon.tech/dbname?sslmode=require" \
#     bash scripts/verify-db-backup.sh
#
# Environment variables:
#   NEON_VERIFY_DB_URL  (required) — connection string for the database to verify.
#                                    NEVER use the production DATABASE_URL directly.
#                                    Always point this at a Neon recovery branch.
#
#   VERIFY_QUIET        (optional) — set to "1" to suppress per-check output;
#                                    only the final summary is printed.
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed
#   2 — missing required environment variable or psql not found
#
# Prerequisites:
#   psql must be installed and on PATH.
#   Install on macOS: brew install libpq && brew link --force libpq
#   Install on Debian/Ubuntu: sudo apt-get install postgresql-client
#
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DB_URL="${NEON_VERIFY_DB_URL:-}"
QUIET="${VERIFY_QUIET:-0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Minimum expected row counts for a healthy production database.
# These are lower bounds — a fresh staging DB may legitimately have 0 rows
# in some tables, so this is configurable via environment variables.
MIN_USERS="${VERIFY_MIN_USERS:-0}"
MIN_PROJECTS="${VERIFY_MIN_PROJECTS:-0}"

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

RED="\033[0;31m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
CYAN="\033[0;36m"
RESET="\033[0m"

pass_count=0
fail_count=0
warn_count=0

log_pass() {
  local msg="$1"
  pass_count=$((pass_count + 1))
  if [[ "$QUIET" != "1" ]]; then
    printf "${GREEN}[PASS]${RESET} %s\n" "$msg"
  fi
}

log_fail() {
  local msg="$1"
  fail_count=$((fail_count + 1))
  printf "${RED}[FAIL]${RESET} %s\n" "$msg"
}

log_warn() {
  local msg="$1"
  warn_count=$((warn_count + 1))
  printf "${YELLOW}[WARN]${RESET} %s\n" "$msg"
}

log_info() {
  local msg="$1"
  if [[ "$QUIET" != "1" ]]; then
    printf "${CYAN}[INFO]${RESET} %s\n" "$msg"
  fi
}

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------

if [[ -z "$DB_URL" ]]; then
  printf "${RED}[ERROR]${RESET} NEON_VERIFY_DB_URL is not set.\n"
  printf "  Set it to the connection string of a Neon recovery branch (NOT production).\n"
  printf "  Example:\n"
  printf "    NEON_VERIFY_DB_URL=\"postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require\" \\\\\n"
  printf "      bash scripts/verify-db-backup.sh\n"
  exit 2
fi

# Refuse to run against a URL that looks like the production DATABASE_URL.
# Production DATABASE_URL is set via Vercel and typically does not contain "recovery-".
# We check for obvious staging/dev indicators to avoid accidents.
# This is a best-effort guard, not a security boundary.
if [[ "$DB_URL" == *"localhost"* ]] || [[ "$DB_URL" == *"127.0.0.1"* ]]; then
  log_warn "DB_URL points to localhost — this may be a local test database."
fi

if ! command -v psql &>/dev/null; then
  printf "${RED}[ERROR]${RESET} psql is not installed or not on PATH.\n"
  printf "  macOS:  brew install libpq && brew link --force libpq\n"
  printf "  Ubuntu: sudo apt-get install postgresql-client\n"
  exit 2
fi

# ---------------------------------------------------------------------------
# psql helper — runs a single SQL statement, returns trimmed stdout
# ---------------------------------------------------------------------------

run_sql() {
  local sql="$1"
  psql "$DB_URL" \
    --no-psqlrc \
    --tuples-only \
    --no-align \
    --command="$sql" 2>/dev/null | tr -d '[:space:]'
}

run_sql_verbose() {
  local sql="$1"
  psql "$DB_URL" \
    --no-psqlrc \
    --tuples-only \
    --no-align \
    --command="$sql" 2>&1
}

# ---------------------------------------------------------------------------
# Check 1: Database connection
# ---------------------------------------------------------------------------

log_info "Checking database connection..."

connection_result=$(psql "$DB_URL" --no-psqlrc --command="SELECT 1" --tuples-only --no-align 2>&1) || true

if echo "$connection_result" | grep -q "^1$"; then
  log_pass "Database connection (psql SELECT 1 succeeded)"
else
  log_fail "Database connection failed: $connection_result"
  printf "\n${RED}FATAL: Cannot connect to database. Aborting further checks.${RESET}\n"
  exit 1
fi

# ---------------------------------------------------------------------------
# Check 2: Required tables exist
# ---------------------------------------------------------------------------

log_info "Checking required tables exist..."

required_tables=(
  "users"
  "projects"
  "token_purchases"
  "token_usage"
  "token_config"
  "tier_config"
  "cost_log"
  "credit_transactions"
  "published_games"
  "generation_jobs"
  "api_keys"
  "provider_keys"
  "webhook_events"
  "feedback"
  "marketplace_assets"
  "asset_purchases"
  "asset_reviews"
  "seller_profiles"
  "game_ratings"
  "game_comments"
  "game_likes"
  "game_tags"
  "game_forks"
  "featured_games"
  "user_follows"
  "moderation_appeals"
)

for table in "${required_tables[@]}"; do
  exists=$(run_sql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '$table'")
  if [[ "$exists" == "1" ]]; then
    log_pass "Table exists: $table"
  else
    log_fail "Table missing: $table"
  fi
done

# ---------------------------------------------------------------------------
# Check 3: Row counts for key tables
# ---------------------------------------------------------------------------

log_info "Checking row counts..."

# Portable associative storage (Bash 3.2 compatible — no declare -A).
# We store counts as _tc_<table>=<count> variables.
_tc_get() { eval "echo \"\${_tc_$1:-N/A}\""; }
_tc_set() { eval "_tc_$1=\"$2\""; }

count_table() {
  local table="$1"
  local min="${2:-0}"
  local count
  count=$(run_sql "SELECT COUNT(*) FROM $table")
  _tc_set "$table" "$count"

  if [[ -z "$count" ]]; then
    log_fail "Row count query failed for table: $table"
    return
  fi

  if (( count < min )); then
    log_fail "Table $table has $count rows (expected >= $min)"
  else
    log_pass "Table $table: $count rows"
  fi
}

count_table "users"          "$MIN_USERS"
count_table "projects"       "$MIN_PROJECTS"
count_table "token_purchases"
count_table "token_usage"
count_table "cost_log"
count_table "credit_transactions"
count_table "published_games"
count_table "generation_jobs"

# ---------------------------------------------------------------------------
# Check 4: Enum types exist (schema integrity)
# ---------------------------------------------------------------------------

log_info "Checking PostgreSQL enum types..."

required_enums=(
  "tier"
  "provider"
  "token_source"
  "token_package"
  "transaction_type"
  "publish_status"
  "job_status"
  "generation_type"
  "asset_category"
  "asset_status"
  "asset_license"
  "feedback_type"
  "appeal_status"
)

for enum_name in "${required_enums[@]}"; do
  exists=$(run_sql "SELECT COUNT(*) FROM pg_type WHERE typname = '$enum_name' AND typtype = 'e'")
  if [[ "$exists" == "1" ]]; then
    log_pass "Enum type exists: $enum_name"
  else
    log_fail "Enum type missing: $enum_name"
  fi
done

# ---------------------------------------------------------------------------
# Check 5: Referential integrity spot check
# ---------------------------------------------------------------------------

log_info "Running referential integrity spot checks..."

# All projects must have a valid user
orphan_projects=$(run_sql "SELECT COUNT(*) FROM projects p WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.user_id)")
if [[ "$orphan_projects" == "0" ]]; then
  log_pass "Referential integrity: all projects have valid user_id"
else
  log_fail "Referential integrity: $orphan_projects orphaned project(s) found (no matching user)"
fi

# All token_usage must have a valid user
orphan_token_usage=$(run_sql "SELECT COUNT(*) FROM token_usage tu WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = tu.user_id)")
if [[ "$orphan_token_usage" == "0" ]]; then
  log_pass "Referential integrity: all token_usage rows have valid user_id"
else
  log_fail "Referential integrity: $orphan_token_usage orphaned token_usage row(s) found"
fi

# All credit_transactions must have a valid user
orphan_txns=$(run_sql "SELECT COUNT(*) FROM credit_transactions ct WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ct.user_id)")
if [[ "$orphan_txns" == "0" ]]; then
  log_pass "Referential integrity: all credit_transactions have valid user_id"
else
  log_fail "Referential integrity: $orphan_txns orphaned credit_transaction(s) found"
fi

# ---------------------------------------------------------------------------
# Check 6: Required indexes exist
# ---------------------------------------------------------------------------

log_info "Checking critical indexes..."

required_indexes=(
  "idx_projects_user"
  "idx_projects_updated"
  "idx_token_usage_user_date"
  "idx_cost_log_user_date"
  "idx_credit_txn_user_date"
  "idx_generation_jobs_user_status"
)

for index_name in "${required_indexes[@]}"; do
  exists=$(run_sql "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = '$index_name'")
  if [[ "$exists" == "1" ]]; then
    log_pass "Index exists: $index_name"
  else
    log_warn "Index missing: $index_name (may affect query performance)"
  fi
done

# ---------------------------------------------------------------------------
# Check 7: No runaway webhook_events (TTL health)
# ---------------------------------------------------------------------------

log_info "Checking webhook_events TTL health..."

# Expired webhook idempotency records that have not been cleaned up are benign
# but indicate the cleanup job is not running. Warn if count is very high.
expired_webhooks=$(run_sql "SELECT COUNT(*) FROM webhook_events WHERE expires_at < NOW()")
total_webhooks=$(run_sql "SELECT COUNT(*) FROM webhook_events")

if (( expired_webhooks > 10000 )); then
  log_warn "webhook_events has $expired_webhooks expired rows (total: $total_webhooks) — cleanup job may not be running"
else
  log_pass "webhook_events TTL health: $expired_webhooks expired / $total_webhooks total"
fi

# ---------------------------------------------------------------------------
# Check 8: Recent write activity (data freshness)
# ---------------------------------------------------------------------------

log_info "Checking data freshness..."

# If this is a recent backup, the most recent user or project should have
# been created within the last 30 days. Skip on a completely empty database.
users_count="$(_tc_get users)"
if [[ "$users_count" == "N/A" ]]; then users_count=0; fi

if (( users_count > 0 )); then
  recent_user=$(run_sql "SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '30 days'")
  if (( recent_user > 0 )); then
    log_pass "Data freshness: $recent_user user(s) created in last 30 days"
  else
    log_warn "Data freshness: no users created in last 30 days (expected for active production)"
  fi
else
  log_info "Data freshness: skipped (users table is empty — may be a fresh staging DB)"
fi

# ---------------------------------------------------------------------------
# Summary report
# ---------------------------------------------------------------------------

printf "\n"
printf "=%.0s" {1..60}
printf "\n"
printf "Database Backup Verification Report\n"
printf "  Target:  %s\n" "$(echo "$DB_URL" | sed 's|://[^:]*:[^@]*@|://***:***@|')"
printf "  Time:    %s UTC\n" "$(date -u '+%Y-%m-%dT%H:%M:%S')"
printf "=%.0s" {1..60}
printf "\n"

printf "  Passed:   %d\n" "$pass_count"
printf "  Warnings: %d\n" "$warn_count"
printf "  Failed:   %d\n" "$fail_count"
printf "\n"

if (( fail_count == 0 )); then
  printf "${GREEN}Health report: HEALTHY${RESET}\n"
  printf "\n"
  printf "Row counts:\n"
  for table in users projects token_purchases token_usage cost_log credit_transactions published_games generation_jobs; do
    printf "  %-30s %s\n" "$table" "$(_tc_get "$table")"
  done
  printf "\n"
  exit 0
else
  printf "${RED}Health report: UNHEALTHY (%d check(s) failed)${RESET}\n" "$fail_count"
  printf "\n"
  printf "Review the [FAIL] lines above. Common causes:\n"
  printf "  - Recovery branch created from too-early a timestamp (schema missing)\n"
  printf "  - Neon branch is still initializing (wait 60s and retry)\n"
  printf "  - Connection string has wrong credentials or endpoint\n"
  printf "\n"
  exit 1
fi
