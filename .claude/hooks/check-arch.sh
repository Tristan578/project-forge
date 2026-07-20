#!/usr/bin/env bash
# PostToolUse(Edit|Write) hook: bridge isolation check.
# Only engine/src/bridge/ may import web_sys/js_sys/wasm_bindgen.
#
# Anchored to the repo root so the result does not depend on the caller's cwd.
# Fails CLOSED (exit 2) when the tree cannot be located — a mis-pointed run must
# never report "passed" vacuously.
#
# Exit 0 = clean, exit 2 = violation or tooling error.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || REPO_ROOT=""
ENGINE_SRC="$REPO_ROOT/engine/src"

if [ -z "$REPO_ROOT" ] || [ ! -d "$ENGINE_SRC" ]; then
  echo "check-arch: cannot locate engine/src from cwd $(pwd) — refusing to pass vacuously" >&2
  exit 2
fi

MATCHES="$(grep -rnE 'web_sys|js_sys|wasm_bindgen' "$ENGINE_SRC" --exclude-dir=bridge || true)"

if [ -n "$MATCHES" ]; then
  echo "VIOLATION: browser interop found outside engine/src/bridge/ — only bridge/ may import web_sys/js_sys/wasm_bindgen." >&2
  echo "$MATCHES" >&2
  exit 2
fi

echo "Architecture check passed."
