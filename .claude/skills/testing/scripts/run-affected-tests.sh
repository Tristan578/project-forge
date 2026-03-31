#!/usr/bin/env bash
# run-affected-tests.sh — Run vitest only for files changed vs main
# Usage: bash scripts/run-affected-tests.sh [base-branch]
# Exit 0: tests pass or no test files changed
# Exit 1: test failures

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
cd "$REPO_ROOT"

BASE="${1:-main}"

# Find changed test files directly
changed_tests="$(git diff --name-only "${BASE}...HEAD" | grep -E '\.test\.(ts|tsx)$' || true)"

# For changed source files, look for corresponding test files
changed_sources="$(git diff --name-only "${BASE}...HEAD" | grep -E '\.(ts|tsx)$' | grep -v '\.test\.' || true)"

test_files_to_run=()

# Add directly changed test files
while IFS= read -r f; do
  [[ -n "$f" && -f "$f" ]] && test_files_to_run+=("$f")
done <<< "$changed_tests"

# Add test files corresponding to changed source files
while IFS= read -r f; do
  if [[ -z "$f" ]]; then continue; fi
  dir="$(dirname "$f")"
  base="$(basename "$f")"
  name="${base%.*}"
  ext="${base##*.}"

  for candidate in \
    "${dir}/__tests__/${name}.test.${ext}" \
    "${dir}/__tests__/${name}.test.ts" \
    "${dir}/${name}.test.${ext}" \
    "${dir}/${name}.test.ts"; do
    if [[ -f "$candidate" ]] && [[ ! " ${test_files_to_run[*]} " =~ " $candidate " ]]; then
      test_files_to_run+=("$candidate")
    fi
  done
done <<< "$changed_sources"

if [[ ${#test_files_to_run[@]} -eq 0 ]]; then
  echo "No test files affected by changes vs ${BASE}."
  exit 0
fi

echo "Running ${#test_files_to_run[@]} affected test file(s):"
for f in "${test_files_to_run[@]}"; do
  echo "  $f"
done
echo ""

cd "${REPO_ROOT}/web"
npx vitest run "${test_files_to_run[@]}"
