#!/usr/bin/env bash
# Show the diff between the current schema.ts and what the last migration captures.
#
# This script helps identify schema changes that have not yet been committed to
# a migration file. It runs `drizzle-kit check` which compares the schema
# against the live database or the last generated SQL.
#
# Usage:
#   bash scripts/schema-diff.sh
#
# Prerequisites:
#   - DATABASE_URL in environment (or .env.local)
#   - npm dependencies installed in web/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
WEB_DIR="$REPO_ROOT/web"

if [[ ! -f "$WEB_DIR/package.json" ]]; then
  echo "ERROR: web/package.json not found — is REPO_ROOT correct? ($REPO_ROOT)" >&2
  exit 1
fi

# Load .env.local if present and DATABASE_URL not already set
if [[ -z "${DATABASE_URL:-}" && -f "$WEB_DIR/.env.local" ]]; then
  # shellcheck disable=SC1091
  set -a && source "$WEB_DIR/.env.local" && set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "WARNING: DATABASE_URL is not set. drizzle-kit check may fail." >&2
  echo "Run: vercel env pull  to populate .env.local" >&2
fi

echo "Running drizzle-kit check against current schema..."
echo ""

cd "$WEB_DIR"
npx drizzle-kit check 2>&1 || {
  EXIT=$?
  echo ""
  echo "drizzle-kit check exited with code $EXIT."
  echo ""
  echo "If you see schema differences, generate a migration with:"
  echo "  cd web && npm run db:generate"
  echo ""
  echo "For dev-only schema sync (no migration file):"
  echo "  cd web && npm run db:push"
  exit $EXIT
}

echo ""
echo "Schema is in sync with the last migration."
