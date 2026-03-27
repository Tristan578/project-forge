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
# Retries once on Node 25.x JIT segfaults (exit codes 139/134/136 or
# 'libnode' appearing in output, which indicates a V8 JIT crash).
if echo "$CHANGED_FILES" | grep -qE '\.(ts|tsx)$'; then
  TSC_BIN="$WEB_DIR/node_modules/.bin/tsc"
  if [ ! -x "$TSC_BIN" ]; then exit 0; fi

  run_tsc() {
    TSC_OUTPUT=$(set +e; "$TSC_BIN" --noEmit 2>&1; echo "___TSC_RC___:$?") || true
    TSC_EXIT=$(echo "$TSC_OUTPUT" | grep -o '___TSC_RC___:[0-9]*' | cut -d: -f2)
    TSC_OUTPUT=$(echo "$TSC_OUTPUT" | grep -v '___TSC_RC___:')
  }

  is_jit_segfault() {
    local exit_code="$1"
    local output="$2"
    # Signal exits: 139=SIGSEGV, 134=SIGABRT, 136=SIGFPE
    if [ "$exit_code" = "139" ] || [ "$exit_code" = "134" ] || [ "$exit_code" = "136" ]; then
      return 0
    fi
    # libnode in the output indicates a Node runtime crash (V8 JIT)
    if echo "$output" | grep -q 'libnode'; then
      return 0
    fi
    return 1
  }

  run_tsc
  if is_jit_segfault "$TSC_EXIT" "$TSC_OUTPUT"; then
    echo "[pre-push] WARNING: tsc crashed (Node JIT segfault, likely Node 25.x V8 bug). Retrying once..." >&2
    run_tsc
  fi

  if is_jit_segfault "$TSC_EXIT" "$TSC_OUTPUT"; then
    echo "[pre-push] WARNING: tsc crashed twice (signal exit / libnode). Allowing push — CI (Node 20) will catch real errors." >&2
  elif [ "$TSC_EXIT" != "0" ] && [ -n "$TSC_EXIT" ]; then
    echo "$TSC_OUTPUT" | tail -10 >&2
    ERRORS="${ERRORS}TypeScript errors found. "
  fi
fi

# 2. ESLint on changed files only (fast, ~2-3s per file)
# Filter to files that actually exist on disk (excludes deleted files in the diff)
TS_FILES_RAW=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx)$' | grep '^web/' | sed 's|^web/||' || true)
TS_FILES=""
while IFS= read -r f; do
  [ -n "$f" ] && [ -f "$WEB_DIR/$f" ] && TS_FILES="${TS_FILES} ${f}"
done <<< "$TS_FILES_RAW"
TS_FILES=$(echo "$TS_FILES" | xargs)
if [ -n "$TS_FILES" ]; then
  # shellcheck disable=SC2086
  ESLINT_BIN="$WEB_DIR/node_modules/.bin/eslint"
  if [ ! -x "$ESLINT_BIN" ]; then exit 0; fi
  LINT_OUTPUT=$("$ESLINT_BIN" --max-warnings 0 $TS_FILES 2>&1) || {
    echo "$LINT_OUTPUT" | tail -10 >&2
    ERRORS="${ERRORS}ESLint warnings/errors found. "
  }
fi

# 3. Run panelRegistry structural test (catches #1 agent bug)
if echo "$CHANGED_FILES" | grep -qE 'panelRegistry|WorkspaceProvider'; then
  VITEST_BIN="$WEB_DIR/node_modules/.bin/vitest"
  if [ ! -x "$VITEST_BIN" ]; then exit 0; fi
  TEST_OUTPUT=$("$VITEST_BIN" run src/lib/workspace/__tests__/panelRegistry.test.ts 2>&1) || {
    echo "$TEST_OUTPUT" | tail -10 >&2
    ERRORS="${ERRORS}panelRegistry structural test failed. "
  }
fi

if [ -n "$ERRORS" ]; then
  echo "${ERRORS}" >&2
  exit 2
fi

exit 0
