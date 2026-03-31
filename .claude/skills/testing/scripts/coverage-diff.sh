#!/usr/bin/env bash
# coverage-diff.sh — Compare coverage before/after changes on affected files
# Usage: bash scripts/coverage-diff.sh [base-branch]
# Outputs: coverage delta summary (statements, branches, functions, lines)
# Exit 0: informational (coverage improvement or neutral)
# Exit 2: coverage regression detected

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
cd "$REPO_ROOT"

BASE="${1:-main}"
WEB_DIR="${REPO_ROOT}/web"
COVERAGE_DIR="${WEB_DIR}/.coverage-diff"

rm -rf "$COVERAGE_DIR"
mkdir -p "${COVERAGE_DIR}/before" "${COVERAGE_DIR}/after"

# Find affected test files
changed_tests=()
while IFS= read -r f; do
  [[ -n "$f" && -f "$f" ]] && changed_tests+=("$f")
done < <(git diff --name-only "${BASE}...HEAD" | grep -E '\.test\.(ts|tsx)$' || true)

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
    if [[ -f "$candidate" ]] && [[ ! " ${changed_tests[*]} " =~ " $candidate " ]]; then
      changed_tests+=("$candidate")
    fi
  done
done < <(git diff --name-only "${BASE}...HEAD" | grep -E '\.(ts|tsx)$' | grep -v '\.test\.' || true)

if [[ ${#changed_tests[@]} -eq 0 ]]; then
  echo "No affected test files found. No coverage diff to report."
  exit 0
fi

echo "Affected test files (${#changed_tests[@]}):"
for f in "${changed_tests[@]}"; do echo "  $f"; done
echo ""

cd "$WEB_DIR"

# Run coverage on current branch (after)
echo "Running coverage on current branch..."
npx vitest run --coverage --coverage.reporter=json-summary --coverage.reportsDirectory="${COVERAGE_DIR}/after" \
  "${changed_tests[@]}" 2>&1 | tail -30 || true

# Get baseline coverage from base branch
echo ""
echo "Checking out ${BASE} to get baseline coverage..."
git stash push -m "coverage-diff-stash" --include-untracked 2>/dev/null || true
git checkout "${BASE}" 2>/dev/null || { echo "Cannot checkout ${BASE} — skipping baseline comparison"; git stash pop 2>/dev/null || true; exit 0; }

echo "Running coverage on ${BASE}..."
npx vitest run --coverage --coverage.reporter=json-summary --coverage.reportsDirectory="${COVERAGE_DIR}/before" \
  "${changed_tests[@]}" 2>&1 | tail -30 || true

# Return to current state
git checkout - 2>/dev/null || true
git stash pop 2>/dev/null || true

cd "$REPO_ROOT"

# Parse and compare (summary.json from v8 provider)
parse_summary() {
  local dir="$1"
  local field="$2"
  if [[ -f "${dir}/coverage-summary.json" ]]; then
    node -e "const s = require('${dir}/coverage-summary.json'); console.log(s.total?.${field}?.pct ?? 'N/A');" 2>/dev/null || echo "N/A"
  else
    echo "N/A"
  fi
}

echo ""
echo "Coverage Delta:"
echo "  Metric       Before       After        Delta"
echo "  ------------ ------------ ------------ ------"

regression=0
for metric in statements branches functions lines; do
  before="$(parse_summary "${COVERAGE_DIR}/before" "$metric")"
  after="$(parse_summary "${COVERAGE_DIR}/after" "$metric")"
  if [[ "$before" != "N/A" && "$after" != "N/A" ]]; then
    delta="$(node -e "console.log((${after} - ${before}).toFixed(2))" 2>/dev/null || echo "?")"
    symbol="="
    if (( $(echo "$delta > 0" | bc -l 2>/dev/null || echo 0) )); then symbol="+"; fi
    if (( $(echo "$delta < 0" | bc -l 2>/dev/null || echo 0) )); then symbol="-"; regression=1; fi
    printf "  %-12s %-12s %-12s %s%s%%\n" "$metric" "${before}%" "${after}%" "$symbol" "$delta"
  else
    printf "  %-12s %-12s %-12s (unavailable)\n" "$metric" "$before" "$after"
  fi
done

rm -rf "$COVERAGE_DIR"

if [[ $regression -eq 1 ]]; then
  echo ""
  echo "Coverage regression detected. Add tests to maintain or improve coverage."
  exit 2
fi

echo ""
echo "Coverage diff complete — no regressions."
exit 0
