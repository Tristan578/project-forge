#!/usr/bin/env bash
# check-test-coverage.sh — Verify changed .ts/.tsx source files have corresponding test files
# Usage: bash scripts/check-test-coverage.sh [base-branch]
# Exit 0: all covered or informational
# Exit 2: uncovered source files found (blocking)

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
cd "$REPO_ROOT"

BASE="${1:-main}"

covered=()
uncovered=()

while IFS= read -r file; do
  # Only check non-test TypeScript source files
  if [[ "$file" != *.test.ts && "$file" != *.test.tsx && "$file" != *.spec.ts && "$file" != *.spec.tsx ]]; then
    if [[ "$file" == *.ts || "$file" == *.tsx ]]; then
      # Derive test file paths to check
      dir="$(dirname "$file")"
      base="$(basename "$file")"
      name="${base%.*}"
      ext="${base##*.}"

      test_paths=(
        "${dir}/__tests__/${name}.test.${ext}"
        "${dir}/__tests__/${name}.test.ts"
        "${dir}/${name}.test.${ext}"
        "${dir}/${name}.test.ts"
      )

      found=0
      for test_path in "${test_paths[@]}"; do
        if [[ -f "$test_path" ]]; then
          found=1
          break
        fi
      done

      if [[ $found -eq 1 ]]; then
        covered+=("$file")
      else
        uncovered+=("$file")
      fi
    fi
  fi
done < <(git diff --name-only "${BASE}...HEAD")

echo "Test coverage check vs ${BASE}:"
echo ""

if [[ ${#covered[@]} -gt 0 ]]; then
  echo "Covered (${#covered[@]}):"
  for f in "${covered[@]}"; do
    echo "  [OK] $f"
  done
  echo ""
fi

if [[ ${#uncovered[@]} -gt 0 ]]; then
  echo "UNCOVERED (${#uncovered[@]}) — no test file found:"
  for f in "${uncovered[@]}"; do
    echo "  [MISSING] $f"
  done
  echo ""
  echo "Every changed source file must have a corresponding test file."
  echo "Expected locations: __tests__/<name>.test.ts or co-located <name>.test.ts"
  exit 2
fi

echo "All changed source files have corresponding test files."
exit 0
