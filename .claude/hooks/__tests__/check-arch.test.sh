#!/usr/bin/env bash
# Tests for check-arch.sh — bridge isolation gate.
# Exit codes ARE the behavior: 0 = clean tree, 2 = violation or fail-closed.
set -u

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/check-arch.sh"
REPO_ROOT="$(git rev-parse --show-toplevel)"
FAILURES=0

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "SKIP-FAIL: required tool '$1' not on PATH" >&2
    exit 1
  fi
}
require git
require grep

assert_exit() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$actual" -eq "$expected" ]; then
    echo "ok   - $desc"
  else
    echo "FAIL - $desc (expected exit $expected, got $actual)"
    FAILURES=$((FAILURES + 1))
  fi
}

make_fixture_repo() {
  local dir
  dir="$(mktemp -d)"
  git -C "$dir" init -q
  echo "$dir"
}

# 1. Real repo, run from repo root: engine/src exists and is clean.
(cd "$REPO_ROOT" && bash "$HOOK" >/dev/null 2>&1)
assert_exit "clean real tree from repo root" 0 $?

# 2. Regression: run from a SUBDIRECTORY of the real repo. The original
#    relative-path bug made this pass vacuously; the fix must still find
#    engine/src via the repo root and pass because the tree is clean.
(cd "$REPO_ROOT/web" && bash "$HOOK" >/dev/null 2>&1)
assert_exit "clean real tree from subdirectory (cwd-independence)" 0 $?

# 3. Violation: web_sys outside bridge/ must exit 2.
VIOLATION_REPO="$(make_fixture_repo)"
mkdir -p "$VIOLATION_REPO/engine/src/core" "$VIOLATION_REPO/engine/src/bridge"
echo 'use web_sys::window;' > "$VIOLATION_REPO/engine/src/core/bad.rs"
(cd "$VIOLATION_REPO" && bash "$HOOK" >/dev/null 2>&1)
assert_exit "web_sys outside bridge is a violation" 2 $?

# 4. Looks-like-but-isn't: interop imports INSIDE bridge/ are allowed.
CLEAN_REPO="$(make_fixture_repo)"
mkdir -p "$CLEAN_REPO/engine/src/bridge"
echo 'use wasm_bindgen::prelude::*;' > "$CLEAN_REPO/engine/src/bridge/mod.rs"
(cd "$CLEAN_REPO" && bash "$HOOK" >/dev/null 2>&1)
assert_exit "interop inside bridge/ is allowed" 0 $?

# 5. Fail-closed: a git repo with NO engine/src must exit 2, not pass vacuously.
EMPTY_REPO="$(make_fixture_repo)"
(cd "$EMPTY_REPO" && bash "$HOOK" >/dev/null 2>&1)
assert_exit "missing engine/src fails closed" 2 $?

# 6. Fail-closed: outside any git repo entirely must exit 2.
NON_REPO="$(mktemp -d)"
(cd "$NON_REPO" && GIT_CEILING_DIRECTORIES="$NON_REPO" bash "$HOOK" >/dev/null 2>&1)
assert_exit "outside a git repo fails closed" 2 $?

# 7. js_sys is also covered by the gate, not just web_sys.
JSSYS_REPO="$(make_fixture_repo)"
mkdir -p "$JSSYS_REPO/engine/src/core"
echo 'use js_sys::Array;' > "$JSSYS_REPO/engine/src/core/bad.rs"
(cd "$JSSYS_REPO" && bash "$HOOK" >/dev/null 2>&1)
assert_exit "js_sys outside bridge is a violation" 2 $?

rm -rf "$VIOLATION_REPO" "$CLEAN_REPO" "$EMPTY_REPO" "$NON_REPO"

if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES test(s) failed"
  exit 1
fi
echo "all check-arch tests passed"
