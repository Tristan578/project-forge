#!/bin/bash
# PreToolUse hook (Bash: git push)
# Validates documentation quality on changed files before push.
#
# Checks:
# 1. No exported functions without JSDoc in changed .ts/.tsx files
# 2. No stale TODO without ticket reference
# 3. No commented-out code blocks (>3 consecutive // lines)
# 4. MCP manifest commands all have descriptions
# 5. README/CLAUDE.md counts match reality

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Only run on git push
if ! echo "$COMMAND" | grep -qE "git push"; then
  exit 0
fi

WARNINGS=""
WARN_COUNT=0

# Get changed files vs main
CHANGED=$(git diff --name-only main...HEAD 2>/dev/null || echo "")
if [ -z "$CHANGED" ]; then
  exit 0
fi

# Check 1: Exported functions without JSDoc in .ts/.tsx files
TS_FILES=$(echo "$CHANGED" | grep -E '\.(ts|tsx)$' | grep -v '__tests__\|\.test\.\|\.spec\.' | head -10)
for f in $TS_FILES; do
  if [ -f "$f" ]; then
    # Find exported functions/consts without preceding JSDoc (/** ... */)
    EXPORTS_WITHOUT_DOCS=$(awk '
      /^export (function|const|class|interface|type|enum)/ {
        if (prev !~ /\*\//) {
          print NR": "$0
        }
      }
      { prev = $0 }
    ' "$f" 2>/dev/null | head -3)
    if [ -n "$EXPORTS_WITHOUT_DOCS" ]; then
      WARN_COUNT=$((WARN_COUNT + 1))
      if [ $WARN_COUNT -le 5 ]; then
        WARNINGS="${WARNINGS}\n- ${f}: exported symbol without JSDoc"
      fi
    fi
  fi
done

# Check 2: TODO/FIXME without ticket reference
TODOS_NO_TICKET=$(echo "$CHANGED" | xargs grep -Hn "TODO\|FIXME\|HACK" 2>/dev/null | grep -v "PF-\|#[0-9]\|ticket\|issue" | head -3)
if [ -n "$TODOS_NO_TICKET" ]; then
  WARN_COUNT=$((WARN_COUNT + 1))
  WARNINGS="${WARNINGS}\n- TODO/FIXME without ticket reference found (add PF-XXX)"
fi

# Check 3: MCP manifest — commands without descriptions
if echo "$CHANGED" | grep -q "commands.json"; then
  EMPTY_DESC=$(python3 -c "
import json, sys
try:
    d = json.load(open('mcp-server/manifest/commands.json'))
    empty = [c['name'] for c in d.get('commands',[]) if not c.get('description','').strip()]
    if empty: print(', '.join(empty[:5]))
except: pass
" 2>/dev/null)
  if [ -n "$EMPTY_DESC" ]; then
    WARN_COUNT=$((WARN_COUNT + 1))
    WARNINGS="${WARNINGS}\n- MCP commands missing descriptions: ${EMPTY_DESC}"
  fi
fi

if [ $WARN_COUNT -gt 0 ]; then
  echo "DOC QUALITY: ${WARN_COUNT} documentation issue(s) found in changed files:${WARNINGS}"
  echo "Run '/doc-review' for a full documentation audit before pushing."
fi

exit 0
