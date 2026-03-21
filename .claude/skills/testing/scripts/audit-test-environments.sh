#!/usr/bin/env bash
# audit-test-environments.sh
# Scans test files in node-environment directories and reports any that import
# @testing-library/* or react-dom without the // @vitest-environment jsdom annotation.
#
# Files in src/lib/, src/stores/, src/app/api/ run in the node environment by
# default (vitest.config.node.ts). If a test in those directories imports
# @testing-library/* or react-dom it requires jsdom and MUST have:
#   // @vitest-environment jsdom
# at the top of the file.
#
# Usage: bash .claude/skills/testing/scripts/audit-test-environments.sh
# Exit 0: no issues found
# Exit 1: mismatches detected

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# scripts/ -> testing/ -> skills/ -> .claude/ -> repo root
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
WEB_DIR="${REPO_ROOT}/web/src"

# Directories that default to node environment
NODE_DIRS=(
  "${WEB_DIR}/lib"
  "${WEB_DIR}/stores"
  "${WEB_DIR}/app/api"
)

ISSUES=()

for dir in "${NODE_DIRS[@]}"; do
  if [[ ! -d "${dir}" ]]; then
    continue
  fi

  # Find all test files in this directory tree
  while IFS= read -r -d '' test_file; do
    # Check whether the file imports @testing-library or react-dom
    if grep -qE "from ['\"](@testing-library/|react-dom)" "${test_file}"; then
      # Check whether it has the jsdom annotation on any of the first 5 lines
      if ! head -5 "${test_file}" | grep -q '@vitest-environment jsdom'; then
        # Strip the repo root prefix for cleaner output
        relative="${test_file#${REPO_ROOT}/}"
        ISSUES+=("${relative}")
      fi
    fi
  done < <(find "${dir}" -type f \( -name "*.test.ts" -o -name "*.test.tsx" \) -print0 2>/dev/null)
done

if [[ ${#ISSUES[@]} -eq 0 ]]; then
  echo "OK: all node-environment test files are correctly annotated."
  exit 0
fi

echo "ERROR: the following test files import jsdom-only packages but are missing"
echo "  // @vitest-environment jsdom"
echo "at the top of the file:"
echo ""
for f in "${ISSUES[@]}"; do
  echo "  ${f}"
done
echo ""
echo "Add '// @vitest-environment jsdom' as the very first line of each file listed above."
exit 1
