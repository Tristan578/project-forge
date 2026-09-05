#!/bin/bash
# Post-edit hook: Run eslint on changed TypeScript files under web/
# Skips tsc --noEmit (too slow for per-edit — use the full validation suite instead)

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.command // empty' 2>/dev/null)

# Only run for TypeScript/JavaScript files
if [[ "$FILE_PATH" != *.ts ]] && [[ "$FILE_PATH" != *.tsx ]] && [[ "$FILE_PATH" != *.js ]] && [[ "$FILE_PATH" != *.jsx ]]; then
  exit 0
fi

# Skip test files, coverage, node_modules, generated files
if [[ "$FILE_PATH" == *".test."* ]] || [[ "$FILE_PATH" == *"/coverage/"* ]] || [[ "$FILE_PATH" == *"node_modules"* ]]; then
  exit 0
fi

# Use git to find project root
PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$PROJECT_DIR" ]; then
  exit 0
fi

# Only lint files under web/ (the eslint config is web-specific)
if [[ "$FILE_PATH" != *"/web/"* ]]; then
  exit 0
fi

cd "$PROJECT_DIR/web" || exit 0

# Run eslint only on the changed file (fast, ~2-3s)
npx eslint --max-warnings 0 "$FILE_PATH" 2>&1 | tail -5
