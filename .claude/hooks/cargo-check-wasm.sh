#!/usr/bin/env bash
# PostToolUse(Edit|Write) hook for the rust-engine agent.
# After editing a .rs file in engine/, runs cargo check --target wasm32-unknown-unknown.
# Informational only — exits 0 always. Build errors are surfaced as additionalContext.

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

# Only fire on Rust source files
if [[ "$FILE_PATH" != *.rs ]]; then
  exit 0
fi

# Only fire on engine/ files
if ! echo "$FILE_PATH" | grep -qE '/engine/'; then
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
ENGINE_DIR="$REPO_ROOT/engine"

if [ ! -d "$ENGINE_DIR" ]; then
  echo "[cargo-check-wasm] engine/ directory not found at $ENGINE_DIR — skipping." >&2
  exit 0
fi

echo "[cargo-check-wasm] Running cargo check --target wasm32-unknown-unknown on $FILE_PATH..." >&2

OUTPUT=$(cd "$ENGINE_DIR" && cargo check --target wasm32-unknown-unknown --message-format=short 2>&1 || true)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ] || echo "$OUTPUT" | grep -qE '^error'; then
  echo "CARGO CHECK FAILED for $FILE_PATH:"
  echo ""
  echo "$OUTPUT" | grep -E '^(error|warning)' | head -20
  echo ""
  echo "Fix the above errors before this change can be compiled to WASM."
else
  echo "[cargo-check-wasm] PASSED — no errors in $FILE_PATH" >&2
fi

exit 0
