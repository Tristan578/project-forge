#!/bin/bash
# Post-edit hook: Run lint + type check on changed TypeScript files
# This catches regressions immediately after edits

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.command // empty' 2>/dev/null)

# Only run for TypeScript/JavaScript files
if [[ "$FILE_PATH" != *.ts ]] && [[ "$FILE_PATH" != *.tsx ]] && [[ "$FILE_PATH" != *.js ]] && [[ "$FILE_PATH" != *.jsx ]]; then
  exit 0
fi

# Skip test files and generated files
if [[ "$FILE_PATH" == *".test."* ]] || [[ "$FILE_PATH" == *"/coverage/"* ]] || [[ "$FILE_PATH" == *"node_modules"* ]]; then
  exit 0
fi

# Use git to find project root (works cross-platform)
PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$PROJECT_DIR" ]; then
  exit 0
fi
cd "$PROJECT_DIR/web" || exit 0

# Run lint only on the changed file (fast)
npx eslint --max-warnings 0 "$FILE_PATH" 2>&1 | tail -5

# Run TypeScript check (checks full project, slower but catches cross-file issues)
npx tsc --noEmit 2>&1 | tail -10
