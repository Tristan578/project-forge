#!/usr/bin/env bash
# ratchet-coverage.sh
# Reads vitest coverage output and bumps thresholds in vitest.config.node.ts
# when actual coverage exceeds threshold by more than 1 full percentage point.
#
# Usage: bash .claude/skills/testing/scripts/ratchet-coverage.sh
# Exit 0: success (ratchet applied or not needed)
# Exit 1: coverage-summary.json not found

set -euo pipefail

COVERAGE_JSON="web/coverage/coverage-summary.json"
VITEST_CONFIG="web/vitest.config.node.ts"

# Resolve paths relative to repo root (script may be called from anywhere)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

COVERAGE_JSON="${REPO_ROOT}/${COVERAGE_JSON}"
VITEST_CONFIG="${REPO_ROOT}/${VITEST_CONFIG}"

if [[ ! -f "${COVERAGE_JSON}" ]]; then
  echo "ERROR: no coverage JSON found at ${COVERAGE_JSON}"
  echo "Run 'cd web && npx vitest run --coverage' first."
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not installed."
  exit 1
fi

# Read current percentages from coverage-summary.json
STMT_PCT=$(jq '.total.statements.pct' "${COVERAGE_JSON}")
BRANCH_PCT=$(jq '.total.branches.pct' "${COVERAGE_JSON}")
FUNC_PCT=$(jq '.total.functions.pct' "${COVERAGE_JSON}")
LINE_PCT=$(jq '.total.lines.pct' "${COVERAGE_JSON}")

echo "Current coverage:"
echo "  statements: ${STMT_PCT}%"
echo "  branches:   ${BRANCH_PCT}%"
echo "  functions:  ${FUNC_PCT}%"
echo "  lines:      ${LINE_PCT}%"

# Read current thresholds from vitest.config.node.ts using grep + sed
read_threshold() {
  local key="$1"
  grep -E "^\s+${key}:" "${VITEST_CONFIG}" | sed -E 's/.*:\s*([0-9]+).*/\1/'
}

STMT_THRESH=$(read_threshold "statements")
BRANCH_THRESH=$(read_threshold "branches")
FUNC_THRESH=$(read_threshold "functions")
LINE_THRESH=$(read_threshold "lines")

echo ""
echo "Current thresholds:"
echo "  statements: ${STMT_THRESH}"
echo "  branches:   ${BRANCH_THRESH}"
echo "  functions:  ${FUNC_THRESH}"
echo "  lines:      ${LINE_THRESH}"

RATCHETED=false

# Compare and ratchet a single metric.
# Args: $1=label $2=current_pct $3=current_threshold $4=config_key
ratchet_metric() {
  local label="$1"
  local current_pct="$2"
  local threshold="$3"
  local config_key="$4"

  # Floor the current percentage to a whole integer
  local floored
  floored=$(echo "${current_pct}" | awk '{printf "%d", int($1)}')

  # Gap = floored_current - threshold
  local gap=$(( floored - threshold ))

  if (( gap > 1 )); then
    echo ""
    echo "RATCHET ${label}: ${threshold} -> ${floored}  (coverage ${current_pct}%, gap ${gap}pp)"
    # Replace the threshold line in the config file
    sed -i.bak -E "s/(^\s+${config_key}:\s*)[0-9]+/\1${floored}/" "${VITEST_CONFIG}"
    RATCHETED=true
  fi
}

ratchet_metric "statements" "${STMT_PCT}" "${STMT_THRESH}" "statements"
ratchet_metric "branches"   "${BRANCH_PCT}" "${BRANCH_THRESH}" "branches"
ratchet_metric "functions"  "${FUNC_PCT}" "${FUNC_THRESH}" "functions"
ratchet_metric "lines"      "${LINE_PCT}" "${LINE_THRESH}" "lines"

# Remove backup files created by sed -i.bak
rm -f "${VITEST_CONFIG}.bak"

if [[ "${RATCHETED}" == "false" ]]; then
  echo ""
  echo "No ratchet needed — all gaps <= 1 percentage point."
fi

exit 0
