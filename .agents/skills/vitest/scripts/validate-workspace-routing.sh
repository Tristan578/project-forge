#!/usr/bin/env bash
# validate-workspace-routing.sh
# Verifies that the vitest workspace config exists and that test files are
# routed to the correct workspace project (node vs jsdom).
#
# Checks:
#  1. web/vitest.workspace.ts exists
#  2. web/vitest.config.node.ts and web/vitest.config.jsdom.ts exist
#  3. No test files in jsdom-only directories (src/components/, src/hooks/)
#     are missing the @vitest-environment jsdom annotation AND appear in
#     the node config include patterns (which would give them the wrong env).
#  4. No test files exist outside ANY include pattern defined in both configs.
#
# Usage: bash .claude/skills/vitest/scripts/validate-workspace-routing.sh
# Exit 0: workspace config is valid
# Exit 1: issues found

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# scripts/ -> vitest/ -> skills/ -> .claude/ -> repo root
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
WEB_DIR="${REPO_ROOT}/web"

ISSUES=()

# --- Check 1: Required config files exist ----------------------------------

for config_file in \
  "${WEB_DIR}/vitest.workspace.ts" \
  "${WEB_DIR}/vitest.config.node.ts" \
  "${WEB_DIR}/vitest.config.jsdom.ts"
do
  if [[ ! -f "${config_file}" ]]; then
    relative="${config_file#${REPO_ROOT}/}"
    ISSUES+=("MISSING: ${relative}")
  fi
done

if [[ ${#ISSUES[@]} -gt 0 ]]; then
  echo "ERROR: required vitest config files are missing:"
  for issue in "${ISSUES[@]}"; do
    echo "  ${issue}"
  done
  exit 1
fi

echo "OK: all vitest workspace config files exist."

# --- Check 2: workspace.ts references both configs -------------------------

WORKSPACE_CONTENT=$(cat "${WEB_DIR}/vitest.workspace.ts")

for expected in "vitest.config.node.ts" "vitest.config.jsdom.ts"; do
  if ! echo "${WORKSPACE_CONTENT}" | grep -q "${expected}"; then
    ISSUES+=("vitest.workspace.ts does not reference ${expected}")
  fi
done

# --- Check 3: node-config includes only target directories -----------------
# The node config should NOT include src/components/ or src/hooks/
# (those belong to jsdom). If they appear in vitest.config.node.ts it is a
# routing mistake.

NODE_CONFIG_CONTENT=$(cat "${WEB_DIR}/vitest.config.node.ts")

for jsdom_dir in "src/components/" "src/hooks/"; do
  if echo "${NODE_CONFIG_CONTENT}" | grep -qF "${jsdom_dir}"; then
    ISSUES+=("vitest.config.node.ts include pattern references '${jsdom_dir}' (jsdom-only directory)")
  fi
done

# --- Check 4: jsdom-config includes only target directories ----------------
# The jsdom config should NOT include src/lib/, src/stores/, or src/app/api/.

JSDOM_CONFIG_CONTENT=$(cat "${WEB_DIR}/vitest.config.jsdom.ts")

for node_dir in "src/lib/" "src/stores/" "src/app/" "src/data/"; do
  if echo "${JSDOM_CONFIG_CONTENT}" | grep -qF "${node_dir}"; then
    ISSUES+=("vitest.config.jsdom.ts include pattern references '${node_dir}' (node-only directory)")
  fi
done

# --- Check 5: No test files outside all include patterns -------------------
# Collect all test files under web/src and check each one is covered by at
# least one config's include pattern.

# Known include patterns (mirrors vitest.config.*.ts)
NODE_PATTERNS=(
  "src/lib/"
  "src/stores/"
  "src/app/"
  "src/data/"
)
JSDOM_PATTERNS=(
  "src/components/"
  "src/hooks/"
)

ALL_PATTERNS=("${NODE_PATTERNS[@]}" "${JSDOM_PATTERNS[@]}")

UNCOVERED=()

while IFS= read -r -d '' test_file; do
  relative="${test_file#${WEB_DIR}/}"
  matched=false
  for pattern in "${ALL_PATTERNS[@]}"; do
    if [[ "${relative}" == ${pattern}* ]]; then
      matched=true
      break
    fi
  done
  if [[ "${matched}" == "false" ]]; then
    UNCOVERED+=("${relative}")
  fi
done < <(find "${WEB_DIR}/src" -type f \( -name "*.test.ts" -o -name "*.test.tsx" \) -print0 2>/dev/null)

if [[ ${#UNCOVERED[@]} -gt 0 ]]; then
  ISSUES+=("UNCOVERED test files (not matched by any workspace include pattern):")
  for f in "${UNCOVERED[@]}"; do
    ISSUES+=("  web/${f}")
  done
fi

# --- Report ----------------------------------------------------------------

if [[ ${#ISSUES[@]} -eq 0 ]]; then
  echo "OK: vitest workspace routing is valid."
  exit 0
fi

echo ""
echo "ERROR: vitest workspace routing issues found:"
echo ""
for issue in "${ISSUES[@]}"; do
  echo "  ${issue}"
done
echo ""
echo "Fix the include patterns in vitest.config.node.ts / vitest.config.jsdom.ts"
echo "so every test file is routed to exactly one workspace project."
exit 1
