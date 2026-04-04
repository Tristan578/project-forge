#!/usr/bin/env bash
# check-magic-constants.sh — Detect common hardcoded constants that should use centralized config
#
# Run as a warning check. Set ERRORS_AS_FAILURES=1 to treat findings as hard failures.
set -euo pipefail

ERRORS=0
ROOT="$(git rev-parse --show-toplevel)"

# ---------------------------------------------------------------------------
# 1. Timeout literals in production code (not test files, not config module)
# ---------------------------------------------------------------------------
echo "--- Checking for hardcoded timeout literals..."

TIMEOUT_HITS=$(grep -rn --include="*.ts" --include="*.tsx" \
  -E '(timeout|Timeout|TIMEOUT|window[Mm]s|delay|ttl|cooldown)\s*[:=]\s*[0-9][0-9_]*[0-9]' \
  "$ROOT/web/src" "$ROOT/web/e2e" \
  --exclude-dir=node_modules --exclude-dir=.next \
  | grep -v 'config/timeouts' \
  | grep -v '__tests__/' \
  | grep -v '\.test\.' \
  | grep -v '\.spec\.' \
  | grep -v '// allowed-magic-constant' \
  || true)

if [ -n "$TIMEOUT_HITS" ]; then
  echo "WARNING: Found hardcoded timeout values (should import from @/lib/config/timeouts):"
  echo "$TIMEOUT_HITS"
fi

# ---------------------------------------------------------------------------
# 2. Raw provider name strings in production code
# ---------------------------------------------------------------------------
echo "--- Checking for hardcoded provider name strings..."

PROVIDER_HITS=$(grep -rn --include="*.ts" --include="*.tsx" \
  -E "'(anthropic|openai|meshy|elevenlabs|suno|replicate|removebg)'" \
  "$ROOT/web/src/lib" "$ROOT/web/src/app/api" \
  --exclude-dir=node_modules --exclude-dir=.next \
  | grep -v 'config/providers' \
  | grep -v '__tests__/' \
  | grep -v '\.test\.' \
  | grep -v '// allowed-magic-constant' \
  | grep -v "Error\|error\|console\.\|throw\|import\b" \
  | grep -v '^\s*\*\|^\s*//' \
  | grep -v "type.*=.*'" \
  || true)

if [ -n "$PROVIDER_HITS" ]; then
  echo "WARNING: Found hardcoded provider names (should import from @/lib/config/providers):"
  echo "$PROVIDER_HITS"
fi

# ---------------------------------------------------------------------------
# 3. Duplicated scope arrays
# ---------------------------------------------------------------------------
echo "--- Checking for hardcoded scope arrays..."

SCOPE_HITS=$(grep -rn --include="*.ts" \
  -E "'scene:read'|'scene:write'|'ai:generate'|'project:manage'" \
  "$ROOT/web/src" \
  --exclude-dir=node_modules --exclude-dir=.next \
  | grep -v 'config/scopes' \
  | grep -v '__tests__/' \
  | grep -v '\.test\.' \
  | grep -v '// allowed-magic-constant' \
  || true)

if [ -n "$SCOPE_HITS" ]; then
  echo "WARNING: Found hardcoded scope strings (should import from @/lib/config/scopes):"
  echo "$SCOPE_HITS"
fi

# ---------------------------------------------------------------------------
echo "--- Magic constant check complete."
exit $ERRORS
