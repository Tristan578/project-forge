#!/usr/bin/env bash
# ratchet-coverage.sh — Coverage threshold auto-ratchet
#
# Reads the coverage-summary.json produced by vitest --coverage and bumps
# thresholds in web/vitest.config.ts if actual coverage exceeds them.
#
# Usage:
#   bash .claude/skills/testing/scripts/ratchet-coverage.sh [coverage-dir]
#
# Arguments:
#   coverage-dir   Path to coverage output dir (default: web/coverage)
#
# Exit codes:
#   0  Thresholds unchanged or bumped successfully
#   1  Coverage summary not found
#   2  jq not available
#
# On CI (GITHUB_ACTIONS=true), thresholds are only updated on main branch.
# On PRs, current vs threshold is reported informally without modification.

set -euo pipefail

COVERAGE_DIR="${1:-web/coverage}"
SUMMARY_FILE="${COVERAGE_DIR}/coverage-summary.json"
CONFIG_FILE="web/vitest.config.ts"

# Determine project root (script may be called from any directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../../../" && pwd)"

SUMMARY_PATH="${PROJECT_ROOT}/${SUMMARY_FILE}"
CONFIG_PATH="${PROJECT_ROOT}/${CONFIG_FILE}"

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
if ! command -v jq &>/dev/null; then
  echo "::warning::jq is not installed — coverage ratchet skipped"
  exit 2
fi

if [[ ! -f "${SUMMARY_PATH}" ]]; then
  echo "::warning::Coverage summary not found at ${SUMMARY_PATH} — ratchet skipped"
  exit 1
fi

# ---------------------------------------------------------------------------
# Read actual coverage percentages from summary
# ---------------------------------------------------------------------------
read_pct() {
  local metric="$1"
  jq -r ".total.${metric}.pct // 0" "${SUMMARY_PATH}"
}

ACTUAL_STATEMENTS=$(read_pct "statements")
ACTUAL_BRANCHES=$(read_pct "branches")
ACTUAL_FUNCTIONS=$(read_pct "functions")
ACTUAL_LINES=$(read_pct "lines")

# ---------------------------------------------------------------------------
# Read current thresholds from vitest.config.ts
# ---------------------------------------------------------------------------
read_threshold() {
  local metric="$1"
  # Use sed instead of grep -P (BSD grep on macOS lacks PCRE support)
  grep "${metric}:" "${CONFIG_PATH}" | head -1 | sed -E 's/.*'"${metric}"':[[:space:]]*([0-9]+).*/\1/'
}

THRESHOLD_STATEMENTS=$(read_threshold "statements")
THRESHOLD_BRANCHES=$(read_threshold "branches")
THRESHOLD_FUNCTIONS=$(read_threshold "functions")
THRESHOLD_LINES=$(read_threshold "lines")

echo "=== Coverage Ratchet Report ==="
echo ""
echo "Metric         Actual   Threshold   Delta"
echo "-------------- -------- ----------- -----"
printf "statements     %6.1f%%  %9s%%  %+.1f%%\n" \
  "${ACTUAL_STATEMENTS}" "${THRESHOLD_STATEMENTS}" \
  "$(echo "${ACTUAL_STATEMENTS} - ${THRESHOLD_STATEMENTS}" | bc)"
printf "branches       %6.1f%%  %9s%%  %+.1f%%\n" \
  "${ACTUAL_BRANCHES}" "${THRESHOLD_BRANCHES}" \
  "$(echo "${ACTUAL_BRANCHES} - ${THRESHOLD_BRANCHES}" | bc)"
printf "functions      %6.1f%%  %9s%%  %+.1f%%\n" \
  "${ACTUAL_FUNCTIONS}" "${THRESHOLD_FUNCTIONS}" \
  "$(echo "${ACTUAL_FUNCTIONS} - ${THRESHOLD_FUNCTIONS}" | bc)"
printf "lines          %6.1f%%  %9s%%  %+.1f%%\n" \
  "${ACTUAL_LINES}" "${THRESHOLD_LINES}" \
  "$(echo "${ACTUAL_LINES} - ${THRESHOLD_LINES}" | bc)"
echo ""

# ---------------------------------------------------------------------------
# Only bump thresholds on main branch (or when not in CI)
# ---------------------------------------------------------------------------
IS_MAIN=false
if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  if [[ "${GITHUB_REF:-}" == "refs/heads/main" ]]; then
    IS_MAIN=true
  fi
else
  # Local: always allow bumping
  IS_MAIN=true
fi

if [[ "${IS_MAIN}" == "false" ]]; then
  echo "ℹ PR mode — thresholds not modified (run on main to ratchet)"
  exit 0
fi

# ---------------------------------------------------------------------------
# Compute new thresholds (floor to nearest integer, never decrease)
# ---------------------------------------------------------------------------
new_threshold() {
  local actual="$1"
  local current="$2"
  # Floor actual to integer
  local floored
  floored=$(echo "${actual}" | awk '{print int($1)}')
  # Take max of current and floored
  if [[ "${floored}" -gt "${current}" ]]; then
    echo "${floored}"
  else
    echo "${current}"
  fi
}

NEW_STATEMENTS=$(new_threshold "${ACTUAL_STATEMENTS}" "${THRESHOLD_STATEMENTS}")
NEW_BRANCHES=$(new_threshold "${ACTUAL_BRANCHES}" "${THRESHOLD_BRANCHES}")
NEW_FUNCTIONS=$(new_threshold "${ACTUAL_FUNCTIONS}" "${THRESHOLD_FUNCTIONS}")
NEW_LINES=$(new_threshold "${ACTUAL_LINES}" "${THRESHOLD_LINES}")

# Check if any threshold changed
CHANGED=false
if [[ "${NEW_STATEMENTS}" != "${THRESHOLD_STATEMENTS}" ]] || \
   [[ "${NEW_BRANCHES}" != "${THRESHOLD_BRANCHES}" ]] || \
   [[ "${NEW_FUNCTIONS}" != "${THRESHOLD_FUNCTIONS}" ]] || \
   [[ "${NEW_LINES}" != "${THRESHOLD_LINES}" ]]; then
  CHANGED=true
fi

if [[ "${CHANGED}" == "false" ]]; then
  echo "Thresholds unchanged — no ratchet needed."
  exit 0
fi

echo "Bumping thresholds:"
echo "  statements: ${THRESHOLD_STATEMENTS} -> ${NEW_STATEMENTS}"
echo "  branches:   ${THRESHOLD_BRANCHES} -> ${NEW_BRANCHES}"
echo "  functions:  ${THRESHOLD_FUNCTIONS} -> ${NEW_FUNCTIONS}"
echo "  lines:      ${THRESHOLD_LINES} -> ${NEW_LINES}"
echo ""

# ---------------------------------------------------------------------------
# Update vitest.config.ts in-place using sed
# (replaces first occurrence of each metric in the thresholds block)
# ---------------------------------------------------------------------------
update_threshold() {
  local metric="$1"
  local new_val="$2"
  # Replace: `  statements: 55,` → `  statements: NEW,`
  # Uses a portable sed pattern that works on both GNU and BSD sed
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s/\(${metric}:\s*\)[0-9]\+/\1${new_val}/" "${CONFIG_PATH}"
  else
    sed -i "s/\(${metric}:\s*\)[0-9]\+/\1${new_val}/" "${CONFIG_PATH}"
  fi
}

update_threshold "statements" "${NEW_STATEMENTS}"
update_threshold "branches" "${NEW_BRANCHES}"
update_threshold "functions" "${NEW_FUNCTIONS}"
update_threshold "lines" "${NEW_LINES}"

echo "vitest.config.ts updated."
echo ""
echo "::notice::Coverage ratchet bumped thresholds: statements=${NEW_STATEMENTS}, branches=${NEW_BRANCHES}, functions=${NEW_FUNCTIONS}, lines=${NEW_LINES}"
