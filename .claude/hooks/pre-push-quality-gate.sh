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

# Skip quality gate for force-pushes of non-current branches (e.g. rebased PR branches).
# The tsc check runs against current node_modules which may not match the pushed branch's deps.
if echo "$COMMAND" | grep -qE '\-\-force|\-\-force-with-lease'; then
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
  TSC_OUTPUT=$(npx tsc --noEmit 2>&1) || {
    echo "$TSC_OUTPUT" | tail -10 >&2
    ERRORS="${ERRORS}TypeScript errors found. "
  }
fi

# 2. ESLint on changed files only (fast, ~2-3s per file)
TS_FILES=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx)$' | grep '^web/' | sed 's|^web/||' || true)
if [ -n "$TS_FILES" ]; then
  # shellcheck disable=SC2086
  LINT_OUTPUT=$(npx eslint --max-warnings 0 $TS_FILES 2>&1) || {
    echo "$LINT_OUTPUT" | tail -10 >&2
    ERRORS="${ERRORS}ESLint warnings/errors found. "
  }
fi

# 3. Run panelRegistry structural test (catches #1 agent bug)
if echo "$CHANGED_FILES" | grep -qE 'panelRegistry|WorkspaceProvider'; then
  TEST_OUTPUT=$(npx vitest run src/lib/workspace/__tests__/panelRegistry.test.ts 2>&1) || {
    echo "$TEST_OUTPUT" | tail -10 >&2
    ERRORS="${ERRORS}panelRegistry structural test failed. "
  }
fi

if [ -n "$ERRORS" ]; then
  echo "${ERRORS}" >&2
  exit 2
fi

exit 0
