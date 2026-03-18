#!/bin/bash
# Pre-push quality gate — runs lint, TypeScript, and targeted tests
# for files changed in the current branch before allowing a push.
#
# This hook is triggered by Claude Code's PreToolUse hook on Bash
# commands that contain "git push". It catches the most common
# agent-produced regressions before they reach CI.
#
# Exit 0 = allow push, Exit 2 = block push with reason

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Only gate git push commands
if ! echo "$COMMAND" | grep -qE 'git push'; then
  exit 0
fi

PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$PROJECT_DIR" ]; then
  exit 0
fi

WEB_DIR="$PROJECT_DIR/web"
if [ ! -d "$WEB_DIR" ]; then
  exit 0
fi

cd "$WEB_DIR"

# Determine which files changed vs main
CHANGED_FILES=$(git diff --name-only origin/main...HEAD 2>/dev/null || echo "")

if [ -z "$CHANGED_FILES" ]; then
  exit 0
fi

ERRORS=""

# 1. TypeScript check (fast, catches type errors from merge conflicts)
if echo "$CHANGED_FILES" | grep -qE '\.(ts|tsx)$'; then
  if ! npx tsc --noEmit 2>&1 | tail -5; then
    ERRORS="${ERRORS}TypeScript errors found. "
  fi
fi

# 2. ESLint on changed files only (fast, ~2-3s per file)
TS_FILES=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx)$' | grep '^web/' | sed 's|^web/||' || true)
if [ -n "$TS_FILES" ]; then
  # shellcheck disable=SC2086
  if ! npx eslint --max-warnings 0 $TS_FILES 2>&1 | tail -5; then
    ERRORS="${ERRORS}ESLint warnings/errors found. "
  fi
fi

# 3. Run panelRegistry structural test (catches #1 agent bug)
if echo "$CHANGED_FILES" | grep -qE 'panelRegistry|WorkspaceProvider'; then
  if ! npx vitest run src/lib/workspace/__tests__/panelRegistry.test.ts 2>&1 | tail -5; then
    ERRORS="${ERRORS}panelRegistry structural test failed. "
  fi
fi

# 4. Run targeted tests for changed test files
TEST_FILES=$(echo "$CHANGED_FILES" | grep -E '\.test\.(ts|tsx)$' | grep '^web/' | sed 's|^web/||' || true)
if [ -n "$TEST_FILES" ]; then
  # shellcheck disable=SC2086
  if ! npx vitest run $TEST_FILES 2>&1 | tail -10; then
    ERRORS="${ERRORS}Test failures in changed files. "
  fi
fi

if [ -n "$ERRORS" ]; then
  echo "${ERRORS}" >&2
  exit 2
fi

exit 0
