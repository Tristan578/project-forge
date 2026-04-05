#!/usr/bin/env bash
# PostToolUse hook: warn when a route.ts is created/edited without a test file.
# Fires on Edit|Write. Reads the tool input file path from TOOL_INPUT.

set -euo pipefail

# Extract the file path from the tool input environment variable
FILE_PATH="${TOOL_INPUT_file_path:-}"

# Only care about route.ts files (not test files themselves)
if [[ "$FILE_PATH" != *"/route.ts" ]] || [[ "$FILE_PATH" == *"__tests__"* ]]; then
    exit 0
fi

# Derive expected test location
ROUTE_DIR=$(dirname "$FILE_PATH")
TEST_FILE="$ROUTE_DIR/__tests__/route.test.ts"

if [[ ! -f "$TEST_FILE" ]]; then
    echo "WARNING: Route file edited without a corresponding test."
    echo "  Route: $FILE_PATH"
    echo "  Expected test: $TEST_FILE"
    echo ""
    echo "  Boy scout rule: every route.ts must have a __tests__/route.test.ts."
    echo "  Create the test file before pushing."
fi

exit 0
