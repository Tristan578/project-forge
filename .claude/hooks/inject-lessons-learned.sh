#!/bin/bash
# PreToolUse hook (Edit|Write): inject relevant anti-patterns from lessons learned
# into the agent's context based on the file being edited.
#
# This ensures EVERY agent — subagent or orchestrator — sees the critical patterns
# before modifying code, regardless of whether they read the rules files.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null)"
LESSONS="$HOME/.claude/projects/-Users-tristannolan-project-forge/memory/project_lessons_learned.md"

if [ ! -f "$LESSONS" ]; then
  exit 0
fi

# Build a list of relevant anti-pattern numbers based on file path patterns
RELEVANT=""

# GitHub Actions workflows
if echo "$FILE_PATH" | grep -qE "\.github/workflows/"; then
  RELEVANT="$RELEVANT|29|30|31|32"
fi

# API routes
if echo "$FILE_PATH" | grep -qE "app/api/"; then
  RELEVANT="$RELEVANT|2|15|16|19|29"
fi

# Generate routes specifically
if echo "$FILE_PATH" | grep -qE "api/generate/"; then
  RELEVANT="$RELEVANT|15|16"
fi

# React components
if echo "$FILE_PATH" | grep -qE "components/.*\.tsx$"; then
  RELEVANT="$RELEVANT|1|3|4|5|17|31|34"
fi

# Store slices
if echo "$FILE_PATH" | grep -qE "stores/|slices/"; then
  RELEVANT="$RELEVANT|3|10"
fi

# Chat handlers
if echo "$FILE_PATH" | grep -qE "chat/handlers/"; then
  RELEVANT="$RELEVANT|9|10|28|39"
fi

# Engine Rust files
if echo "$FILE_PATH" | grep -qE "engine/src/"; then
  RELEVANT="$RELEVANT|6|7|8|11|12|13|14|21|32"
fi

# Panel registry
if echo "$FILE_PATH" | grep -qE "panelRegistry"; then
  RELEVANT="$RELEVANT|1"
fi

# Token/billing
if echo "$FILE_PATH" | grep -qE "tokens/|billing|pricing"; then
  RELEVANT="$RELEVANT|16|20|41"
fi

# Export pipeline
if echo "$FILE_PATH" | grep -qE "export/"; then
  RELEVANT="$RELEVANT|42|43"
fi

# Test files
if echo "$FILE_PATH" | grep -qE "\.test\.|\.spec\."; then
  RELEVANT="$RELEVANT|24|25|33"
fi

# Scripting / forge API
if echo "$FILE_PATH" | grep -qE "scripting/|forgeTypes"; then
  RELEVANT="$RELEVANT|28|32"
fi

# Next.js layouts
if echo "$FILE_PATH" | grep -qE "layout\.tsx$"; then
  RELEVANT="$RELEVANT|40"
fi

# If no specific patterns matched, inject the top 5 most common
if [ -z "$RELEVANT" ]; then
  RELEVANT="|1|2|3|15|16"
fi

# Strip leading pipe and deduplicate
RELEVANT="${RELEVANT#|}"
RELEVANT=$(echo "$RELEVANT" | tr '|' '\n' | sort -u | tr '\n' '|')
RELEVANT="${RELEVANT%|}"

# Extract title + prevention for each matching anti-pattern
WARNINGS=""
IFS='|' read -ra NUMS <<< "$RELEVANT"
for num in "${NUMS[@]}"; do
  num=$(echo "$num" | tr -d ' ')
  [ -z "$num" ] && continue

  # Find the title line for this number
  TITLE=$(grep -m1 "^### ${num}\. " "$LESSONS" 2>/dev/null)
  [ -z "$TITLE" ] && continue
  TITLE="${TITLE#\#\#\# }"

  # Find the Prevention line after this title (within the next 8 lines)
  PREVENT=$(grep -A8 "^### ${num}\. " "$LESSONS" 2>/dev/null | grep -m1 "^\*\*Prevention:\*\*" 2>/dev/null)
  PREVENT="${PREVENT#\*\*Prevention:\*\* }"

  # Truncate prevention to keep output concise
  if [ ${#PREVENT} -gt 120 ]; then
    PREVENT="${PREVENT:0:120}..."
  fi

  WARNINGS="${WARNINGS}
- ${TITLE}: ${PREVENT}"
done

if [ -n "$WARNINGS" ]; then
  echo "LESSONS LEARNED — anti-patterns relevant to this file:${WARNINGS}"
fi

exit 0
