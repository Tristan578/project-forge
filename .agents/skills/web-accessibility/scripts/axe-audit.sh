#!/usr/bin/env bash
# axe-audit.sh — Run axe-core accessibility audit on a URL
# Usage: bash scripts/axe-audit.sh [URL]
# Default URL: http://localhost:3000
# Requires: npx @axe-core/cli

set -euo pipefail

URL="${1:-http://localhost:3000}"

echo "Running axe-core audit on: $URL"
echo ""

if ! command -v npx &> /dev/null; then
  echo "ERROR: npx not found. Install Node.js first."
  exit 1
fi

# Run axe-core CLI
npx @axe-core/cli "$URL" --exit || {
  EXIT_CODE=$?
  echo ""
  echo "Accessibility violations found (exit code $EXIT_CODE)."
  echo "Fix all violations before shipping."
  exit $EXIT_CODE
}

echo ""
echo "No accessibility violations found."
