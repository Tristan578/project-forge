#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$HERE/../.."

failures=0

check_workflow() {
  local file="$1"
  local group="$2"

  if grep -qF "  group: $group-\${{ github.ref }}" "$ROOT/.github/workflows/$file" \
    && grep -qF '  cancel-in-progress: true' "$ROOT/.github/workflows/$file"; then
    printf 'PASS: %s cancels superseded PR runs\n' "$file"
  else
    printf 'FAIL: %s is missing its ref-scoped cancellation guard\n' "$file" >&2
    failures=$((failures + 1))
  fi
}

check_workflow changeset-check.yml changeset-check
check_workflow pr-workitem-check.yml pr-workitem-check
check_workflow doc-check.yml doc-check
check_workflow changeset-gate-tests.yml changeset-gate-tests
check_workflow engine-cdn-test.yml engine-cdn-test

if grep -qF 'edited' "$ROOT/.github/workflows/pr-workitem-check.yml"; then
  printf 'FAIL: pr-workitem-check.yml still reruns when PR descriptions are edited\n' >&2
  failures=$((failures + 1))
else
  printf 'PASS: PR description edits do not rerun the work-item gate\n'
fi

if [ "$failures" -ne 0 ]; then
  exit 1
fi
