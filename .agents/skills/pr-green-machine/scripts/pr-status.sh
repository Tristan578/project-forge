#!/usr/bin/env bash
# Fail-closed PR readiness status. The PowerShell auditor owns readiness policy.
set -euo pipefail

PR_NUMBER="${1:-}"
if [ -z "$PR_NUMBER" ]; then
  echo "Usage: bash pr-status.sh <pr-number>" >&2
  exit 2
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
exec pwsh -NoProfile -File "$REPO_ROOT/scripts/audit-pr-readiness.ps1" -PullRequest "$PR_NUMBER"
