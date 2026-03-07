#!/usr/bin/env bash
# test-all.sh — Run all Vitest unit tests by directory.
#
# Running 263+ test files in a single vitest invocation causes the process
# to hang due to accumulated open handles in jsdom/Zustand across forked
# workers (known vitest+jsdom issue, see vitest#3077).
#
# This script runs each top-level test directory as a separate vitest
# invocation.  Each run is given a per-directory timeout; if vitest hangs
# after printing results (open handles), the process is force-killed so
# the next directory can proceed.
set -uo pipefail
cd "$(dirname "$0")/.."

DIR_TIMEOUT=${DIR_TIMEOUT:-60}
FAILED=0
DIRS=(
  src/app/
  src/components/
  src/hooks/
  src/lib/
  src/stores/
)

echo "=== SpawnForge Unit Tests (per-directory, ${DIR_TIMEOUT}s timeout) ==="
echo ""

for dir in "${DIRS[@]}"; do
  if [ -z "$(find "$dir" -name '*.test.ts' -o -name '*.test.tsx' 2>/dev/null)" ]; then
    continue
  fi

  echo "--- $dir ---"
  OUTFILE=$(mktemp)

  npx vitest run "$dir" --reporter=dot > "$OUTFILE" 2>&1 &
  PID=$!
  EXIT_CODE=0

  ELAPSED=0
  while kill -0 "$PID" 2>/dev/null && [ $ELAPSED -lt $DIR_TIMEOUT ]; do
    sleep 1
    ELAPSED=$((ELAPSED + 1))
  done

  if kill -0 "$PID" 2>/dev/null; then
    # Vitest completed tests but hangs due to open handles — force kill
    kill "$PID" 2>/dev/null
    wait "$PID" 2>/dev/null || true
  else
    wait "$PID" 2>/dev/null
    EXIT_CODE=$?
  fi

  # Show summary lines (last 5 lines contain Test Files / Tests / Duration)
  tail -5 "$OUTFILE" | col -b 2>/dev/null || tail -5 "$OUTFILE"

  # Check vitest exit code AND look for "X failed" in the summary line
  # (ignore stderr messages like "Failed to fetch" which are expected test output)
  if [ $EXIT_CODE -ne 0 ] || grep -qE '[0-9]+ failed' "$OUTFILE" 2>/dev/null; then
    echo "  ✗ FAILURES in $dir"
    FAILED=1
  else
    echo "  ✓ $dir passed"
  fi

  rm -f "$OUTFILE"
  # Kill any leftover vitest forks from this invocation
  pkill -f "vitest" 2>/dev/null || true
  sleep 1
  echo ""
done

echo "=== Done ==="
if [ $FAILED -ne 0 ]; then
  echo "Some test directories had failures — see above."
  exit 1
fi
echo "All directories passed!"
exit 0
