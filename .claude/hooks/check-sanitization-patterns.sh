#!/usr/bin/env bash
# PreToolUse hook: warn about common sanitization anti-patterns in staged/edited files.
# Fires on Edit/Write when the file imports sanitizePrompt or is in game-creation/.

set -euo pipefail

# Read the tool input to get the file path
FILE_PATH="${CLAUDE_FILE_PATH:-}"
[ -z "$FILE_PATH" ] && exit 0

# Only check files that deal with LLM sanitization
if ! grep -q 'sanitizePrompt\|sanitize\|LLM\|decomposer\|Executor' "$FILE_PATH" 2>/dev/null; then
  exit 0
fi

WARNINGS=""

# Pattern 1: .filtered without .safe check
if grep -n '\.filtered' "$FILE_PATH" 2>/dev/null | grep -v '\.safe' | grep -v '\.filtered!' | grep -qv '//'; then
  WARNINGS="${WARNINGS}\n⚠ .filtered used without .safe check — always check .safe before using .filtered"
fi

# Pattern 2: Raw LLM fallback with .slice()
if grep -n '\.slice(' "$FILE_PATH" 2>/dev/null | grep -q 'data\.\|raw\.\|LLM\|response'; then
  WARNINGS="${WARNINGS}\n⚠ .slice() on LLM output — use safe constant fallback, never raw sliced string"
fi

# Pattern 3: Unbounded object spread from LLM config
if grep -n '\.\.\.' "$FILE_PATH" 2>/dev/null | grep -qE 'config|Config|cameraConfig|worldConfig'; then
  WARNINGS="${WARNINGS}\n⚠ Spread of LLM config object — use allowlisted fields with Number.isFinite() guards"
fi

# Pattern 4: || for numeric defaults
if grep -n '|| [0-9]' "$FILE_PATH" 2>/dev/null | grep -qv '|| 0)'; then
  WARNINGS="${WARNINGS}\n⚠ || with numeric default — use ?? to preserve 0 as valid value"
fi

if [ -n "$WARNINGS" ]; then
  echo "[sanitization-check] Patterns detected in $(basename "$FILE_PATH"):"
  echo -e "$WARNINGS"
fi

exit 0
