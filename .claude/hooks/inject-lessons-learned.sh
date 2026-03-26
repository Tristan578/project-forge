#!/bin/bash
# PreToolUse hook (Edit|Write|Bash): inject relevant anti-patterns from lessons
# learned into the agent's context BEFORE any code modification.
#
# This is the CRITICAL enforcement mechanism: every agent — orchestrator or
# subagent — sees relevant anti-patterns before modifying code or running
# commands that touch files.
#
# DESIGN: Uses keyword matching against file paths and bash commands, NOT
# hardcoded lesson numbers. When new lessons are added, they're automatically
# picked up if their title/prevention text contains matching keywords.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

# Extract target: file_path for Edit/Write, command for Bash
if [ "$TOOL_NAME" = "Bash" ]; then
  TARGET=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  TARGET=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
fi

if [ -z "$TARGET" ]; then
  exit 0
fi

LESSONS="$HOME/.claude/projects/-Users-tristannolan-project-forge/memory/project_lessons_learned.md"

if [ ! -f "$LESSONS" ]; then
  exit 0
fi

# Build keyword list based on what's being touched
KEYWORDS=""

# --- File path patterns ---

# GitHub Actions / CI / CD workflows
if echo "$TARGET" | grep -qiE "\.github/workflows/|ci\.yml|cd\.yml|quality-gates"; then
  KEYWORDS="$KEYWORDS|artifact|download-artifact|upload-artifact|permissions|startup_failure|workflow|contents.write|reusable"
fi

# API routes
if echo "$TARGET" | grep -qiE "app/api/|route\.ts"; then
  KEYWORDS="$KEYWORDS|rateLimit|await|refund|captureException|try.catch"
fi

# Generate routes
if echo "$TARGET" | grep -qiE "api/generate/"; then
  KEYWORDS="$KEYWORDS|refund|maxDuration|token"
fi

# React components
if echo "$TARGET" | grep -qiE "components/.*\.tsx$"; then
  KEYWORDS="$KEYWORDS|panelRegistry|useRef|Date\.now|Math\.random|eslint-disable|setState"
fi

# Store slices
if echo "$TARGET" | grep -qiE "stores/|slices/"; then
  KEYWORDS="$KEYWORDS|nullish|NaN|Number\("
fi

# Chat handlers
if echo "$TARGET" | grep -qiE "chat/handlers/"; then
  KEYWORDS="$KEYWORDS|forge\.|parseArgs|executor"
fi

# Engine Rust files
if echo "$TARGET" | grep -qiE "engine/src/"; then
  KEYWORDS="$KEYWORDS|ParamSet|B0001|B0002|spawn_from_snapshot|EntitySnapshot|wasm_bindgen|bridge"
fi

# Panel registry specifically
if echo "$TARGET" | grep -qiE "panelRegistry"; then
  KEYWORDS="$KEYWORDS|panelRegistry|PANEL_COMPONENTS|closing"
fi

# Token/billing
if echo "$TARGET" | grep -qiE "tokens/|billing|pricing|credit"; then
  KEYWORDS="$KEYWORDS|refund|addon|monthly|transaction|atomic"
fi

# Export pipeline
if echo "$TARGET" | grep -qiE "export/"; then
  KEYWORDS="$KEYWORDS|injection|sanitize|bgColor|script.tag|loop.guard"
fi

# Test files
if echo "$TARGET" | grep -qiE "\.test\.|\.spec\."; then
  KEYWORDS="$KEYWORDS|vi\.mock|resetModules|restoreAllMocks|dynamic.import"
fi

# Scripting / forge API
if echo "$TARGET" | grep -qiE "scripting/|forgeTypes"; then
  KEYWORDS="$KEYWORDS|forge\.|namespace|property.vs.function"
fi

# Next.js layouts
if echo "$TARGET" | grep -qiE "layout\.tsx$"; then
  KEYWORDS="$KEYWORDS|force-dynamic|ClerkProvider"
fi

# PR creation commands
if echo "$TARGET" | grep -qiE "gh pr create|gh pr "; then
  KEYWORDS="$KEYWORDS|Closes|issue.number|sync-push"
fi

# Git operations
if echo "$TARGET" | grep -qiE "git (checkout|revert|reset|cherry-pick)"; then
  KEYWORDS="$KEYWORDS|artifact|permissions|version|@v4|@v8"
fi

# --- Bash command patterns ---
if [ "$TOOL_NAME" = "Bash" ]; then
  # Git checkout of workflow files
  if echo "$TARGET" | grep -qiE "checkout.*\.github|checkout.*workflow"; then
    KEYWORDS="$KEYWORDS|artifact|download-artifact|upload-artifact|permissions|startup_failure|contents.write|@v4|@v8"
  fi
  # Any git revert/reset that could reintroduce old bugs
  if echo "$TARGET" | grep -qiE "git (revert|reset|cherry-pick)"; then
    KEYWORDS="$KEYWORDS|artifact|permissions|startup_failure|panelRegistry"
  fi
fi

# If nothing matched, inject the universal top lessons
if [ -z "$KEYWORDS" ]; then
  KEYWORDS="panelRegistry|rateLimit|nullish|refund|await"
fi

# Strip leading pipe
KEYWORDS="${KEYWORDS#|}"

# Search lessons file for matching anti-patterns using keywords
# Extract each ### N. block and check if it matches any keyword
WARNINGS=""
CURRENT_TITLE=""
CURRENT_PREVENT=""
CURRENT_BLOCK=""
MATCH_COUNT=0
MAX_MATCHES=8  # Cap to avoid overwhelming context

while IFS= read -r line; do
  if echo "$line" | grep -qE "^### [0-9]+\. "; then
    # Process previous block if it exists
    if [ -n "$CURRENT_TITLE" ] && [ -n "$CURRENT_BLOCK" ]; then
      # Check if any keyword matches in the block text
      IFS='|' read -ra KW_ARRAY <<< "$KEYWORDS"
      for kw in "${KW_ARRAY[@]}"; do
        kw=$(echo "$kw" | tr -d ' ')
        [ -z "$kw" ] && continue
        if echo "$CURRENT_BLOCK" | grep -qiE "$kw" 2>/dev/null; then
          if [ $MATCH_COUNT -lt $MAX_MATCHES ]; then
            PREVENT_SHORT="$CURRENT_PREVENT"
            if [ ${#PREVENT_SHORT} -gt 200 ]; then
              PREVENT_SHORT="${PREVENT_SHORT:0:200}..."
            fi
            WARNINGS="${WARNINGS}
- ${CURRENT_TITLE}: ${PREVENT_SHORT}"
            MATCH_COUNT=$((MATCH_COUNT + 1))
          fi
          break  # One match per lesson is enough
        fi
      done
    fi
    # Start new block
    CURRENT_TITLE="${line#\#\#\# }"
    CURRENT_BLOCK="$line"
    CURRENT_PREVENT=""
  else
    CURRENT_BLOCK="${CURRENT_BLOCK} ${line}"
    if echo "$line" | grep -qE "^\*\*Prevention:\*\*"; then
      CURRENT_PREVENT="${line#\*\*Prevention:\*\* }"
    fi
  fi
done < "$LESSONS"

# Process last block
if [ -n "$CURRENT_TITLE" ] && [ -n "$CURRENT_BLOCK" ]; then
  IFS='|' read -ra KW_ARRAY <<< "$KEYWORDS"
  for kw in "${KW_ARRAY[@]}"; do
    kw=$(echo "$kw" | tr -d ' ')
    [ -z "$kw" ] && continue
    if echo "$CURRENT_BLOCK" | grep -qiE "$kw" 2>/dev/null; then
      if [ $MATCH_COUNT -lt $MAX_MATCHES ]; then
        PREVENT_SHORT="$CURRENT_PREVENT"
        if [ ${#PREVENT_SHORT} -gt 200 ]; then
          PREVENT_SHORT="${PREVENT_SHORT:0:200}..."
        fi
        WARNINGS="${WARNINGS}
- ${CURRENT_TITLE}: ${PREVENT_SHORT}"
      fi
      break
    fi
  done
fi

if [ -n "$WARNINGS" ]; then
  echo "MANDATORY — Lessons learned relevant to this operation. Violating these has caused real bugs:${WARNINGS}"
fi

exit 0
