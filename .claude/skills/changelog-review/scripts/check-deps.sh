#!/usr/bin/env bash
# check-deps.sh — Compare installed JS dependency versions vs. npm latest
# Usage: bash "${CLAUDE_SKILL_DIR}/scripts/check-deps.sh"
# Exit 0 always (informational)

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
PKG_JSON="${REPO_ROOT}/web/package.json"

if [ ! -f "${PKG_JSON}" ]; then
  echo "ERROR: web/package.json not found at ${PKG_JSON}"
  exit 0
fi

echo "=== Dependency Version Check ==="
echo "Source: ${PKG_JSON}"
echo ""

# Key packages to track (space-separated list)
TRACKED_PACKAGES="next ai @clerk/nextjs stripe drizzle-orm @neondatabase/serverless @upstash/redis zod zustand @playwright/test vitest typescript tailwindcss @sentry/nextjs posthog-js"

printf "%-40s %-20s %-20s %s\n" "PACKAGE" "INSTALLED" "LATEST" "STATUS"
printf "%-40s %-20s %-20s %s\n" "----------------------------------------" "--------------------" "--------------------" "------"

for PKG in ${TRACKED_PACKAGES}; do
  # Get installed version from package.json (deps or devDeps)
  INSTALLED=$(node -e "
const pkg = require('${PKG_JSON}');
const all = {...(pkg.dependencies||{}), ...(pkg.devDependencies||{})};
const v = all['${PKG}'];
console.log(v || '');
" 2>/dev/null || echo "")

  if [ -z "${INSTALLED}" ]; then
    printf "%-40s %-20s %-20s %s\n" "${PKG}" "(not in package.json)" "-" "SKIP"
    continue
  fi

  # Get latest from npm registry (with timeout)
  LATEST=$(npm view "${PKG}" version 2>/dev/null || echo "?")
  if [ "${LATEST}" = "?" ] || [ -z "${LATEST}" ]; then
    printf "%-40s %-20s %-20s %s\n" "${PKG}" "${INSTALLED}" "(npm unavailable)" "SKIP"
    continue
  fi

  # Compare: strip leading ^ ~ = from installed spec to get the installed range base
  INSTALLED_CLEAN="${INSTALLED#^}"
  INSTALLED_CLEAN="${INSTALLED_CLEAN#~}"
  INSTALLED_CLEAN="${INSTALLED_CLEAN#=}"

  # Determine status using Python for semver comparison
  STATUS=$(python3 -c "
installed = '${INSTALLED_CLEAN}'.split('-')[0]  # strip pre-release suffix
latest = '${LATEST}'.split('-')[0]

def parse(v):
    parts = v.strip().lstrip('v').split('.')
    try:
        return tuple(int(p) for p in parts[:3])
    except:
        return (0, 0, 0)

i = parse(installed)
l = parse(latest)

if i == l:
    print('current')
elif l[0] > i[0]:
    print('MAJOR UPDATE')
elif l[1] > i[1] or (l[0] == i[0] and l[1] >= i[1] and l[2] > i[2]):
    print('minor update')
else:
    print('current')
" 2>/dev/null || echo "?")

  printf "%-40s %-20s %-20s %s\n" "${PKG}" "${INSTALLED}" "${LATEST}" "${STATUS}"
done

echo ""
echo "--- Notes ---"
echo "  'stripe' is pinned at ^20.4.1 — v21 has breaking changes (see references/version-pins.md)"
echo "  'wasm-bindgen' Rust dep is pinned at =0.2.108 — cannot upgrade without full WASM rebuild"
echo "  'next' upgrades may require E2E test updates for hydration dialog selectors"
echo ""
echo "MAJOR UPDATEs require audit before upgrading."
echo "Run /changelog-review for detailed breaking change analysis."
exit 0
