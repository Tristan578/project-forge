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
require python3

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

# 8. Looks-like-but-isn't: serde_wasm_bindgen is the RECOMMENDED crate for
#    core/ serialization — a bare 'wasm_bindgen' substring match wrongly
#    flags it. Must be allowed.
SERDE_REPO="$(make_fixture_repo)"
mkdir -p "$SERDE_REPO/engine/src/core"
printf 'use serde_wasm_bindgen::to_value;\nfn f() { let _ = serde_wasm_bindgen::from_value::<u8>(v); }\n' \
  > "$SERDE_REPO/engine/src/core/ok.rs"
(cd "$SERDE_REPO" && bash "$HOOK" >/dev/null 2>&1)
assert_exit "serde_wasm_bindgen in core/ is allowed" 0 $?

# 9. Comment lines mentioning interop crates are not imports. Must be allowed.
COMMENT_REPO="$(make_fixture_repo)"
mkdir -p "$COMMENT_REPO/engine/src/core"
printf '// Only bridge/ may import web_sys or wasm_bindgen.\n/* js_sys too */\n' \
  > "$COMMENT_REPO/engine/src/core/ok.rs"
(cd "$COMMENT_REPO" && bash "$HOOK" >/dev/null 2>&1)
assert_exit "comment mentions of interop crates are allowed" 0 $?

# 10. platform/ is excluded by the canonical validator; the hook must agree.
PLATFORM_REPO="$(make_fixture_repo)"
mkdir -p "$PLATFORM_REPO/engine/src/platform"
echo 'use web_sys::window;' > "$PLATFORM_REPO/engine/src/platform/shim.rs"
(cd "$PLATFORM_REPO" && bash "$HOOK" >/dev/null 2>&1)
assert_exit "web_sys inside platform/ is allowed" 0 $?

# 11. The #[wasm_bindgen] attribute form is a violation, not just 'use' lines.
ATTR_REPO="$(make_fixture_repo)"
mkdir -p "$ATTR_REPO/engine/src/core"
printf '#[wasm_bindgen]\npub fn exported() {}\n' > "$ATTR_REPO/engine/src/core/bad.rs"
(cd "$ATTR_REPO" && bash "$HOOK" >/dev/null 2>&1)
assert_exit "#[wasm_bindgen] attribute outside bridge is a violation" 2 $?

# 12. Inline path usage (web_sys::window()) without a 'use' is a violation.
PATHUSE_REPO="$(make_fixture_repo)"
mkdir -p "$PATHUSE_REPO/engine/src/core"
echo 'fn f() { let _ = web_sys::window(); }' > "$PATHUSE_REPO/engine/src/core/bad.rs"
(cd "$PATHUSE_REPO" && bash "$HOOK" >/dev/null 2>&1)
assert_exit "inline web_sys:: path usage outside bridge is a violation" 2 $?

# 13. Fail-closed: if the canonical validator cannot be found, the hook must
#    exit 2, never pass vacuously. CHECK_ARCH_PY is a test-only override.
MISSING_REPO="$(make_fixture_repo)"
mkdir -p "$MISSING_REPO/engine/src/core"
(cd "$MISSING_REPO" && CHECK_ARCH_PY="$MISSING_REPO/nope.py" bash "$HOOK" >/dev/null 2>&1)
assert_exit "missing canonical validator fails closed" 2 $?

rm -rf "$VIOLATION_REPO" "$CLEAN_REPO" "$EMPTY_REPO" "$NON_REPO" \
  "$SERDE_REPO" "$COMMENT_REPO" "$PLATFORM_REPO" "$ATTR_REPO" "$PATHUSE_REPO" "$MISSING_REPO"

if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES test(s) failed"
  exit 1
fi
echo "all check-arch tests passed"
