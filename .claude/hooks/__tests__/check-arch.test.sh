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
readonly -f require
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
readonly -f assert_exit

make_fixture_repo() {
  local dir
  dir="$(mktemp -d)"
  git -C "$dir" init -q
  echo "$dir"
}
readonly -f make_fixture_repo

assert_grep() {
  local desc="$1" pattern="$2" file="$3"
  if grep -q -- "$pattern" "$file"; then
    echo "ok   - $desc"
  else
    echo "FAIL - $desc (no line matched '$pattern')"
    FAILURES=$((FAILURES + 1))
  fi
}
readonly -f assert_grep

assert_no_grep() {
  local desc="$1" pattern="$2" file="$3"
  if grep -q -- "$pattern" "$file"; then
    echo "FAIL - $desc (a line matched '$pattern')"
    FAILURES=$((FAILURES + 1))
  else
    echo "ok   - $desc"
  fi
}
readonly -f assert_no_grep

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

# 14-20. The canonical validator ITSELF, run directly rather than through the
#    hook. The hook's fail-closed guard (cases 5, 6, 13) is bash; the Python
#    had none. A direct `python3 check_arch.py --strict` from engine/ walked a
#    relative "engine/src" that did not exist, found zero files, and printed
#    "Architecture Check Passed. (7 rules, 0 violations)" with exit 0 -- the
#    verdict a commit on #10399 quoted as evidence while the root-level run
#    reported 134 violations. The validator now exits 2 (the code the hook
#    already maps to "refusing to pass vacuously") when a tree it scans is not
#    under the cwd or holds no source files. Exit codes are asserted exactly:
#    2 is "could not scan", never 1 ("violations") and never 0.
VALIDATOR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../skills/arch-validator" && pwd)/check_arch.py"
PYTHON="$(command -v python3 || command -v python)"
VALIDATOR_OUT="$(mktemp -d)"

# 14. The finding's exact wrong cwd: engine/, one level below the root.
(cd "$REPO_ROOT/engine" && "$PYTHON" "$VALIDATOR" --strict \
  >"$VALIDATOR_OUT/stdout" 2>"$VALIDATOR_OUT/stderr")
assert_exit "validator --strict from engine/ (wrong cwd) exits 2" 2 $?
assert_grep "validator from engine/ says why on stderr" \
  "refusing to pass vacuously" "$VALIDATOR_OUT/stderr"
assert_no_grep "validator from engine/ prints no pass line" \
  "Architecture Check Passed" "$VALIDATOR_OUT/stdout"

# 15. A tree with engine/src but no web/src: the full run would walk an empty
#     relative web/src for rules 3, 6 and 7, so it must refuse.
RUST_ONLY="$(make_fixture_repo)"
mkdir -p "$RUST_ONLY/engine/src/core"
echo 'pub fn ok() {}' > "$RUST_ONLY/engine/src/core/ok.rs"
(cd "$RUST_ONLY" && "$PYTHON" "$VALIDATOR" --strict >/dev/null 2>&1)
assert_exit "validator --strict without web/src exits 2" 2 $?

# 16. Looks-like-but-isn't: --js-interop-only reads engine/src alone, so the
#     same tree is complete for it. The hook fixtures above have no web/src,
#     so requiring it in this mode would turn cases 4, 8, 9 and 10 red.
(cd "$RUST_ONLY" && "$PYTHON" "$VALIDATOR" --js-interop-only >/dev/null 2>&1)
assert_exit "validator --js-interop-only without web/src exits 0" 0 $?

# 17. engine/src exists but holds no Rust: zero files scanned is not a pass.
EMPTY_SRC="$(make_fixture_repo)"
mkdir -p "$EMPTY_SRC/engine/src/core"
echo 'not rust' > "$EMPTY_SRC/engine/src/core/README.md"
(cd "$EMPTY_SRC" && "$PYTHON" "$VALIDATOR" --js-interop-only >/dev/null 2>&1)
assert_exit "validator --js-interop-only over an engine/src with no .rs exits 2" 2 $?

# 18. Nothing at all under the cwd, both modes.
BARE_DIR="$(mktemp -d)"
(cd "$BARE_DIR" && "$PYTHON" "$VALIDATOR" --strict >/dev/null 2>&1)
assert_exit "validator --strict from an empty directory exits 2" 2 $?
(cd "$BARE_DIR" && "$PYTHON" "$VALIDATOR" --js-interop-only >/dev/null 2>&1)
assert_exit "validator --js-interop-only from an empty directory exits 2" 2 $?

# 19. Positive control: a complete, clean tree passes with the pass line, so
#     the guard admits what it should.
COMPLETE="$(make_fixture_repo)"
mkdir -p "$COMPLETE/engine/src/core" "$COMPLETE/web/src"
echo 'pub fn ok() {}' > "$COMPLETE/engine/src/core/ok.rs"
echo 'export const ok = 1;' > "$COMPLETE/web/src/ok.ts"
(cd "$COMPLETE" && "$PYTHON" "$VALIDATOR" --strict >"$VALIDATOR_OUT/complete" 2>&1)
assert_exit "validator --strict over a complete clean tree exits 0" 0 $?
assert_grep "validator over a complete clean tree prints the pass line" \
  "Architecture Check Passed" "$VALIDATOR_OUT/complete"

# 20. Positive control for the rules themselves: an 801-line Rust file in the
#     same tree is a rule-2 violation, so --strict exits 1 -- proving the run
#     scanned the fixture rather than clearing the guard and nothing else.
yes '// filler' | head -n 801 > "$COMPLETE/engine/src/core/big.rs"
(cd "$COMPLETE" && "$PYTHON" "$VALIDATOR" --strict >"$VALIDATOR_OUT/big" 2>&1)
assert_exit "validator --strict over an 801-line Rust file exits 1" 1 $?
assert_grep "validator names the oversized file" "big.rs" "$VALIDATOR_OUT/big"

rm -rf "$VIOLATION_REPO" "$CLEAN_REPO" "$EMPTY_REPO" "$NON_REPO" \
  "$SERDE_REPO" "$COMMENT_REPO" "$PLATFORM_REPO" "$ATTR_REPO" "$PATHUSE_REPO" "$MISSING_REPO" \
  "$RUST_ONLY" "$EMPTY_SRC" "$BARE_DIR" "$COMPLETE" "$VALIDATOR_OUT"

if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES test(s) failed"
  exit 1
fi
echo "all check-arch tests passed"
