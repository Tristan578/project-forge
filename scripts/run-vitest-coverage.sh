#!/usr/bin/env bash
# Local/nightly-safe wrapper for the full web coverage run. The 600-second
# budget is coupled to the coverage invocations in quality-gates.yml and cd.yml;
# update all three together.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

command -v timeout >/dev/null 2>&1 || {
  echo "run-vitest-coverage: 'timeout' not on PATH" >&2
  exit 2
}
command -v npx >/dev/null 2>&1 || {
  echo "run-vitest-coverage: 'npx' not on PATH" >&2
  exit 2
}

cd "$REPO_ROOT/web" || {
  echo "run-vitest-coverage: web directory not found" >&2
  exit 2
}

OUTPUT_FILE="$(mktemp)" || {
  echo "run-vitest-coverage: could not create output file" >&2
  exit 2
}
trap 'rm -f "$OUTPUT_FILE"' EXIT

timeout 600 npx vitest run --coverage 2>&1 | tee "$OUTPUT_FILE"
EXIT_CODE=${PIPESTATUS[0]}
bash "$SCRIPT_DIR/check-vitest-exit.sh" "$EXIT_CODE" "$OUTPUT_FILE" --coverage
