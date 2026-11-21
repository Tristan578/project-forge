#!/usr/bin/env bash
# ratchet-coverage.sh — Coverage threshold auto-ratchet
#
# Reads the coverage-summary.json produced by vitest --coverage and bumps
# thresholds in web/vitest.config.ts if actual coverage exceeds them, keeping
# web/vitest.config.node.ts in lockstep (never decreased; skipped with a
# warning if the node config is missing).
#
# Usage:
#   bash .claude/skills/testing/scripts/ratchet-coverage.sh [coverage-dir]
#
# Arguments:
#   coverage-dir   Path to coverage output dir (default: web/coverage)
#
# Exit codes:
#   0  Thresholds unchanged or bumped successfully
#   0  Coverage summary not found (graceful skip)
#   2  jq not available
#
# On CI (GITHUB_ACTIONS=true), thresholds are only updated on main branch.
# On PRs, current vs threshold is reported informally without modification.

set -euo pipefail

COVERAGE_DIR="${1:-web/coverage}"
SUMMARY_FILE="${COVERAGE_DIR}/coverage-summary.json"
CONFIG_FILE="web/vitest.config.ts"
# The node-project config documents that its thresholds must match
# vitest.config.ts — the ratchet keeps both in lockstep (PF-996 / #8934).
NODE_CONFIG_FILE="web/vitest.config.node.ts"

# Determine project root (script may be called from any directory).
# RATCHET_PROJECT_ROOT is a test-only seam (never set in CI/workflows —
# scripts/__tests__/ratchet-coverage.test.sh asserts that) so the suite can
# point the script at fixture configs instead of the real tree.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${RATCHET_PROJECT_ROOT:-$(cd "${SCRIPT_DIR}/../../../../" && pwd)}"

SUMMARY_PATH="${PROJECT_ROOT}/${SUMMARY_FILE}"
CONFIG_PATH="${PROJECT_ROOT}/${CONFIG_FILE}"
NODE_CONFIG_PATH="${PROJECT_ROOT}/${NODE_CONFIG_FILE}"

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
if ! command -v jq &>/dev/null; then
  echo "::warning::jq is not installed — coverage ratchet skipped"
  exit 2
fi

if [[ ! -f "${SUMMARY_PATH}" ]]; then
  echo "::warning::Coverage summary not found at ${SUMMARY_PATH} — ratchet skipped"
  exit 0
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
  local config="${2:-${CONFIG_PATH}}"
  # Use sed instead of grep -P (BSD grep on macOS lacks PCRE support)
  grep "${metric}:" "${config}" | head -1 | sed -E 's/.*'"${metric}"':[[:space:]]*([0-9]+).*/\1/'
}

THRESHOLD_STATEMENTS=$(read_threshold "statements")
THRESHOLD_BRANCHES=$(read_threshold "branches")
THRESHOLD_FUNCTIONS=$(read_threshold "functions")
THRESHOLD_LINES=$(read_threshold "lines")

# Node-project config thresholds (kept in lockstep — PF-996 / #8934). If the
# file is ever absent, warn and fall back to main-config-only behavior.
HAS_NODE_CONFIG=true
if [[ ! -f "${NODE_CONFIG_PATH}" ]]; then
  echo "::warning::${NODE_CONFIG_FILE} not found — node-config lockstep skipped"
  HAS_NODE_CONFIG=false
fi

NODE_THRESHOLD_STATEMENTS="${THRESHOLD_STATEMENTS}"
NODE_THRESHOLD_BRANCHES="${THRESHOLD_BRANCHES}"
NODE_THRESHOLD_FUNCTIONS="${THRESHOLD_FUNCTIONS}"
NODE_THRESHOLD_LINES="${THRESHOLD_LINES}"
if [[ "${HAS_NODE_CONFIG}" == "true" ]]; then
  NODE_THRESHOLD_STATEMENTS=$(read_threshold "statements" "${NODE_CONFIG_PATH}")
  NODE_THRESHOLD_BRANCHES=$(read_threshold "branches" "${NODE_CONFIG_PATH}")
  NODE_THRESHOLD_FUNCTIONS=$(read_threshold "functions" "${NODE_CONFIG_PATH}")
  NODE_THRESHOLD_LINES=$(read_threshold "lines" "${NODE_CONFIG_PATH}")
fi

# delta <actual> <threshold> — actual minus threshold, one decimal place.
#
# awk, not bc: bc is NOT installed by default on Git-for-Windows, on Alpine, or
# on slim CI images, and it was invoked here without a fallback, so the whole
# report died with "bc: command not found" before printing a single metric.
# LC_ALL=C pins the decimal separator so a comma-locale runner cannot turn
# "1.4" into "1,4" and break the caller's %+.1f.
delta() { LC_ALL=C awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1f", a - b }'; }

echo "=== Coverage Ratchet Report ==="
echo ""
echo "Metric         Actual   Threshold   Delta"
echo "-------------- -------- ----------- -----"
printf "statements     %6.1f%%  %9s%%  %+.1f%%\n" \
  "${ACTUAL_STATEMENTS}" "${THRESHOLD_STATEMENTS}" \
  "$(delta "${ACTUAL_STATEMENTS}" "${THRESHOLD_STATEMENTS}")"
printf "branches       %6.1f%%  %9s%%  %+.1f%%\n" \
  "${ACTUAL_BRANCHES}" "${THRESHOLD_BRANCHES}" \
  "$(delta "${ACTUAL_BRANCHES}" "${THRESHOLD_BRANCHES}")"
printf "functions      %6.1f%%  %9s%%  %+.1f%%\n" \
  "${ACTUAL_FUNCTIONS}" "${THRESHOLD_FUNCTIONS}" \
  "$(delta "${ACTUAL_FUNCTIONS}" "${THRESHOLD_FUNCTIONS}")"
printf "lines          %6.1f%%  %9s%%  %+.1f%%\n" \
  "${ACTUAL_LINES}" "${THRESHOLD_LINES}" \
  "$(delta "${ACTUAL_LINES}" "${THRESHOLD_LINES}")"
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
# Compute new thresholds (floor to nearest integer, subtract a margin, never
# decrease)
# ---------------------------------------------------------------------------
# RATCHET_MARGIN_POINTS — the ratchet must never adopt a threshold flush
# against the measurement that produced it. The old rule floored the actual
# percentage and adopted it directly: a 78.4% run set the threshold to
# exactly 78, so the very next merge only had to lose 0.41 of a point to fail
# the gate outright — which is exactly what happened (Quality Gates run
# 33815188404: functions coverage measured 77.99% against a threshold of
# 78%). A gate with zero margin is a coin flip, not a wall.
#
# Subtracting a fixed integer number of points after flooring guarantees real
# headroom: coverage has to fall by MORE than the margin below the adopted
# threshold's measurement before a future run can trip the gate on rounding
# noise alone, rather than by a fraction of a point. An integer point value
# (not a percentage of the measurement) keeps the guarantee easy to state and
# to verify by inspection, and matches how the thresholds themselves are
# expressed (whole percentage points in vitest.config.ts).
readonly RATCHET_MARGIN_POINTS=1

new_threshold() {
  local actual="$1"
  local current="$2"
  # Floor actual to integer, then pull back by the margin so the adopted
  # value sits strictly below what was actually measured.
  local floored target
  floored=$(echo "${actual}" | awk '{print int($1)}')
  target=$((floored - RATCHET_MARGIN_POINTS))
  # Never ratchet down: only adopt the margin-adjusted target when it beats
  # the current threshold. A target that doesn't clear the margin (e.g. actual
  # only just above current) leaves the existing threshold untouched instead
  # of bumping it flush against the measurement.
  if [[ "${target}" -gt "${current}" ]]; then
    echo "${target}"
  else
    echo "${current}"
  fi
}

NEW_STATEMENTS=$(new_threshold "${ACTUAL_STATEMENTS}" "${THRESHOLD_STATEMENTS}")
NEW_BRANCHES=$(new_threshold "${ACTUAL_BRANCHES}" "${THRESHOLD_BRANCHES}")
NEW_FUNCTIONS=$(new_threshold "${ACTUAL_FUNCTIONS}" "${THRESHOLD_FUNCTIONS}")
NEW_LINES=$(new_threshold "${ACTUAL_LINES}" "${THRESHOLD_LINES}")

# The node config must end up matching the main config's final values, but a
# node threshold is never DECREASED (never-ratchet-down applies per file).
node_target() {
  local main_new="$1"
  local node_current="$2"
  if [[ "${main_new}" -gt "${node_current}" ]]; then
    echo "${main_new}"
  else
    echo "${node_current}"
  fi
}

NODE_NEW_STATEMENTS=$(node_target "${NEW_STATEMENTS}" "${NODE_THRESHOLD_STATEMENTS}")
NODE_NEW_BRANCHES=$(node_target "${NEW_BRANCHES}" "${NODE_THRESHOLD_BRANCHES}")
NODE_NEW_FUNCTIONS=$(node_target "${NEW_FUNCTIONS}" "${NODE_THRESHOLD_FUNCTIONS}")
NODE_NEW_LINES=$(node_target "${NEW_LINES}" "${NODE_THRESHOLD_LINES}")

# Check if either config needs a rewrite. Node-only drift (the #8934 case:
# main already current, node lagging) MUST still trigger a ratchet.
CHANGED=false
if [[ "${NEW_STATEMENTS}" != "${THRESHOLD_STATEMENTS}" ]] || \
   [[ "${NEW_BRANCHES}" != "${THRESHOLD_BRANCHES}" ]] || \
   [[ "${NEW_FUNCTIONS}" != "${THRESHOLD_FUNCTIONS}" ]] || \
   [[ "${NEW_LINES}" != "${THRESHOLD_LINES}" ]]; then
  CHANGED=true
fi

NODE_CHANGED=false
if [[ "${HAS_NODE_CONFIG}" == "true" ]]; then
  if [[ "${NODE_NEW_STATEMENTS}" != "${NODE_THRESHOLD_STATEMENTS}" ]] || \
     [[ "${NODE_NEW_BRANCHES}" != "${NODE_THRESHOLD_BRANCHES}" ]] || \
     [[ "${NODE_NEW_FUNCTIONS}" != "${NODE_THRESHOLD_FUNCTIONS}" ]] || \
     [[ "${NODE_NEW_LINES}" != "${NODE_THRESHOLD_LINES}" ]]; then
    NODE_CHANGED=true
  fi
fi

if [[ "${CHANGED}" == "false" && "${NODE_CHANGED}" == "false" ]]; then
  echo "Thresholds unchanged — no ratchet needed."
  exit 0
fi

if [[ "${CHANGED}" == "true" ]]; then
  echo "Bumping thresholds (${CONFIG_FILE}):"
  echo "  statements: ${THRESHOLD_STATEMENTS} -> ${NEW_STATEMENTS}"
  echo "  branches:   ${THRESHOLD_BRANCHES} -> ${NEW_BRANCHES}"
  echo "  functions:  ${THRESHOLD_FUNCTIONS} -> ${NEW_FUNCTIONS}"
  echo "  lines:      ${THRESHOLD_LINES} -> ${NEW_LINES}"
fi
if [[ "${NODE_CHANGED}" == "true" ]]; then
  echo "Syncing node-config thresholds (${NODE_CONFIG_FILE}):"
  echo "  statements: ${NODE_THRESHOLD_STATEMENTS} -> ${NODE_NEW_STATEMENTS}"
  echo "  branches:   ${NODE_THRESHOLD_BRANCHES} -> ${NODE_NEW_BRANCHES}"
  echo "  functions:  ${NODE_THRESHOLD_FUNCTIONS} -> ${NODE_NEW_FUNCTIONS}"
  echo "  lines:      ${NODE_THRESHOLD_LINES} -> ${NODE_NEW_LINES}"
fi
echo ""

# ---------------------------------------------------------------------------
# Update the config file(s) in-place using sed
# (replaces first occurrence of each metric in the thresholds block)
# ---------------------------------------------------------------------------
update_threshold() {
  local metric="$1"
  local new_val="$2"
  local config="$3"
  # Replace: `  statements: 55,` → `  statements: NEW,`
  # Uses POSIX patterns — \s and \+ are GNU extensions that fail on macOS BSD sed
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s/\(${metric}:[[:space:]]*\)[0-9][0-9]*/\1${new_val}/" "${config}"
  else
    sed -i "s/\(${metric}:[[:space:]]*\)[0-9][0-9]*/\1${new_val}/" "${config}"
  fi
}

if [[ "${CHANGED}" == "true" ]]; then
  update_threshold "statements" "${NEW_STATEMENTS}" "${CONFIG_PATH}"
  update_threshold "branches" "${NEW_BRANCHES}" "${CONFIG_PATH}"
  update_threshold "functions" "${NEW_FUNCTIONS}" "${CONFIG_PATH}"
  update_threshold "lines" "${NEW_LINES}" "${CONFIG_PATH}"
  echo "${CONFIG_FILE} updated."
fi

if [[ "${NODE_CHANGED}" == "true" ]]; then
  update_threshold "statements" "${NODE_NEW_STATEMENTS}" "${NODE_CONFIG_PATH}"
  update_threshold "branches" "${NODE_NEW_BRANCHES}" "${NODE_CONFIG_PATH}"
  update_threshold "functions" "${NODE_NEW_FUNCTIONS}" "${NODE_CONFIG_PATH}"
  update_threshold "lines" "${NODE_NEW_LINES}" "${NODE_CONFIG_PATH}"
  echo "${NODE_CONFIG_FILE} synced."
fi

echo ""
if [[ "${CHANGED}" == "true" ]]; then
  echo "::notice::Coverage ratchet bumped ${CONFIG_FILE} thresholds: statements=${NEW_STATEMENTS}, branches=${NEW_BRANCHES}, functions=${NEW_FUNCTIONS}, lines=${NEW_LINES}"
fi
if [[ "${NODE_CHANGED}" == "true" ]]; then
  echo "::notice::Coverage ratchet synced ${NODE_CONFIG_FILE} thresholds: statements=${NODE_NEW_STATEMENTS}, branches=${NODE_NEW_BRANCHES}, functions=${NODE_NEW_FUNCTIONS}, lines=${NODE_NEW_LINES}"
fi
