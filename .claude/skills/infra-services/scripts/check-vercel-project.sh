#!/usr/bin/env bash
# check-vercel-project.sh — Show deployment details for a Vercel project
# Usage: bash "${CLAUDE_SKILL_DIR}/scripts/check-vercel-project.sh" [project-name]
# Default project: spawnforge
# Exit 0 always (informational)

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
cd "${REPO_ROOT}"

PROJECT="${1:-spawnforge}"

if ! command -v vercel >/dev/null 2>&1; then
  echo "ERROR: vercel CLI not installed. Run: npm i -g vercel"
  exit 0
fi

echo "=== Vercel Project: ${PROJECT} (scope: tnolan) ==="
echo ""

# List recent deployments for context
echo "--- Recent Deployments ---"
vercel ls --scope tnolan 2>/dev/null | grep -i "${PROJECT}" | head -10 || echo "No deployments found or not authenticated."

echo ""
echo "--- Project Inspect ---"
# Run inspect from the correct directory if we're in a project subdirectory
if [ -d "${REPO_ROOT}/web" ]; then
  cd "${REPO_ROOT}/web"
fi

vercel inspect --scope tnolan 2>/dev/null || echo "Could not inspect project. Ensure you are authenticated: vercel login --scope tnolan"

echo ""
echo "--- Environment Variables ---"
vercel env ls --scope tnolan 2>/dev/null | head -20 || echo "Could not list env vars."

exit 0
