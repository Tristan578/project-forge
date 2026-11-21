#!/usr/bin/env bash
# PostToolUse(Edit|Write) hook: bridge isolation check.
# Only engine/src/bridge/ may import web_sys/js_sys/wasm_bindgen.
#
# Delegates the actual matching to the canonical validator
# (.claude/skills/arch-validator/check_arch.py --js-interop-only) so there is
# ONE definition of "JS interop": real imports/attributes only (use web_sys,
# web_sys::, #[wasm_bindgen], ...), comment lines ignored, platform/ excluded.
# A previous grep-based version substring-matched 'wasm_bindgen' and wrongly
# blocked the recommended serde_wasm_bindgen crate in core/.
#
# Anchored to the repo root so the result does not depend on the caller's cwd.
# Fails CLOSED (exit 2) when the tree or the validator cannot be located — a
# mis-pointed run must never report "passed" vacuously.
#
# CHECK_ARCH_PY is a test-only override for the validator path; never set it
# in real hook wiring.
#
# Exit 0 = clean, exit 2 = violation or tooling error.

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATOR="${CHECK_ARCH_PY:-$HOOK_DIR/../skills/arch-validator/check_arch.py}"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || REPO_ROOT=""
ENGINE_SRC="$REPO_ROOT/engine/src"

if [ -z "$REPO_ROOT" ] || [ ! -d "$ENGINE_SRC" ]; then
  echo "check-arch: cannot locate engine/src from cwd $(pwd) — refusing to pass vacuously" >&2
  exit 2
fi

if [ ! -f "$VALIDATOR" ]; then
  echo "check-arch: canonical validator not found at $VALIDATOR — refusing to pass vacuously" >&2
  exit 2
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "check-arch: python3 not on PATH — refusing to pass vacuously" >&2
  exit 2
fi

set +e
OUTPUT="$(cd "$REPO_ROOT" && python3 "$VALIDATOR" --js-interop-only 2>&1)"
RC=$?
set -e

if [ "$RC" -eq 0 ]; then
  echo "Architecture check passed."
  exit 0
fi

if [ "$RC" -eq 1 ]; then
  echo "VIOLATION: browser interop found outside engine/src/bridge/ — only bridge/ may import web_sys/js_sys/wasm_bindgen." >&2
  echo "$OUTPUT" >&2
  exit 2
fi

echo "check-arch: validator failed unexpectedly (exit $RC) — refusing to pass vacuously" >&2
echo "$OUTPUT" >&2
exit 2
