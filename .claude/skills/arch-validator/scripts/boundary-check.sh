#!/usr/bin/env bash
# boundary-check.sh — Verify Bevy engine bridge isolation
# Checks that engine/src/core/ has NO web_sys/js_sys/wasm_bindgen imports
# Also verifies bridge/ does not reach into core/ via disallowed patterns
# Exit 0: clean
# Exit 2: violations found (blocking)

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo ".")"
cd "$REPO_ROOT"

ENGINE_CORE="${REPO_ROOT}/engine/src/core"
ENGINE_BRIDGE="${REPO_ROOT}/engine/src/bridge"

violations=()

# ---- Check 1: core/ must not import web browser crates ----
if [[ -d "$ENGINE_CORE" ]]; then
  while IFS= read -r file; do
    while IFS= read -r line_num_and_content; do
      line_num="${line_num_and_content%%:*}"
      content="${line_num_and_content#*:}"
      violations+=("BRIDGE ISOLATION: $file:$line_num — browser dep in core/: $content")
    done < <(grep -nE 'use web_sys|use js_sys|use wasm_bindgen|extern crate web_sys|extern crate js_sys|extern crate wasm_bindgen' "$file" 2>/dev/null || true)
  done < <(find "$ENGINE_CORE" -name "*.rs" -type f)
fi

# ---- Check 2: bridge/ must not use pub(super) to reach into non-bridge engine modules ----
# (Bridge is allowed to import core/ — that's expected. Just check for the reverse.)
# Look for any use statements in core/ that import from bridge/
if [[ -d "$ENGINE_CORE" ]]; then
  while IFS= read -r file; do
    while IFS= read -r line_num_and_content; do
      line_num="${line_num_and_content%%:*}"
      content="${line_num_and_content#*:}"
      violations+=("REVERSE DEP: $file:$line_num — core/ importing from bridge/ (not allowed): $content")
    done < <(grep -nE 'use (crate::)?bridge::' "$file" 2>/dev/null || true)
  done < <(find "$ENGINE_CORE" -name "*.rs" -type f)
fi

# ---- Check 3: core/ must not use unsafe without a safety comment ----
if [[ -d "$ENGINE_CORE" ]]; then
  while IFS= read -r file; do
    in_block=0
    line_num=0
    while IFS= read -r line; do
      line_num=$((line_num + 1))
      if echo "$line" | grep -qE '^\s*//\s*SAFETY:'; then
        in_block=1
      fi
      if echo "$line" | grep -qE '^\s*unsafe\s*\{'; then
        if [[ $in_block -eq 0 ]]; then
          violations+=("UNSAFE: $file:$line_num — unsafe block without preceding // SAFETY: comment")
        fi
        in_block=0
      elif ! echo "$line" | grep -qE '^\s*$|^\s*//'; then
        in_block=0
      fi
    done < "$file"
  done < <(find "$ENGINE_CORE" -name "*.rs" -type f)
fi

# ---- Report ----
if [[ ${#violations[@]} -gt 0 ]]; then
  echo "Architecture boundary violations found:"
  echo ""
  for v in "${violations[@]}"; do
    echo "  [VIOLATION] $v"
  done
  echo ""
  echo "Rules:"
  echo "  - engine/src/core/ is pure Rust — zero browser deps allowed"
  echo "  - engine/src/core/ must not import from engine/src/bridge/"
  echo "  - unsafe blocks in core/ require a // SAFETY: comment immediately above"
  exit 2
fi

echo "Architecture boundary check PASSED — bridge isolation maintained."
exit 0
