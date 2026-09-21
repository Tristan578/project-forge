#!/usr/bin/env bash
# Verify that every schema.ts change has a corresponding migration file.
#
# If schema.ts has been modified relative to the last commit AND no new migration
# file exists in web/src/lib/db/migrations/, this script exits with code 1.
#
# This is intentionally a lightweight static check — it does NOT connect to the
# database. For a full live diff, use schema-diff.sh instead.
#
# Usage:
#   bash scripts/migration-validate.sh
#   bash scripts/migration-validate.sh --staged   # check staged changes only

set -euo pipefail

STAGED_ONLY="${1:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
SCHEMA_FILE="$REPO_ROOT/web/src/lib/db/schema.ts"
MIGRATIONS_DIR="$REPO_ROOT/web/src/lib/db/migrations"

# Detect if schema.ts has been modified
if [[ "$STAGED_ONLY" == "--staged" ]]; then
  SCHEMA_CHANGED=$(git -C "$REPO_ROOT" diff --cached --name-only -- "web/src/lib/db/schema.ts" 2>/dev/null || true)
else
  SCHEMA_CHANGED=$(git -C "$REPO_ROOT" diff HEAD --name-only -- "web/src/lib/db/schema.ts" 2>/dev/null || true)
fi

if [[ -z "$SCHEMA_CHANGED" ]]; then
  echo "schema.ts has not been modified — no migration check needed."
  exit 0
fi

echo "schema.ts has been modified."

# Check whether a new migration file was added in the same changeset
if [[ "$STAGED_ONLY" == "--staged" ]]; then
  NEW_MIGRATIONS=$(git -C "$REPO_ROOT" diff --cached --name-only -- "web/src/lib/db/migrations/" 2>/dev/null || true)
else
  NEW_MIGRATIONS=$(git -C "$REPO_ROOT" diff HEAD --name-only -- "web/src/lib/db/migrations/" 2>/dev/null || true)
fi

if [[ -n "$NEW_MIGRATIONS" ]]; then
  echo "Migration file(s) found alongside schema.ts change:"
  echo "$NEW_MIGRATIONS"
  echo ""
  echo "PASSED: schema change is accompanied by a migration."
  exit 0
fi

# No migration found — check if the migrations directory even exists
if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo ""
  echo "WARNING: $MIGRATIONS_DIR does not exist yet."
  echo "If this is the first migration, run:"
  echo "  cd web && npm run db:generate"
  echo ""
  echo "FAILED: schema.ts changed but no migration file found." >&2
  exit 1
fi

echo ""
echo "FAILED: schema.ts was modified but no new migration file was found." >&2
echo "" >&2
echo "To generate a migration:" >&2
echo "  cd web && npm run db:generate" >&2
echo "" >&2
echo "To apply in dev (no migration file):" >&2
echo "  cd web && npm run db:push" >&2
echo "" >&2
echo "See CLAUDE.md gotcha: 'Schema changes need migrations'" >&2
exit 1
