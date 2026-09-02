#!/usr/bin/env bash
# Hermetic tests for the bounded local coverage wrapper. No real Vitest process
# is launched: timeout and npx are controlled through a PATH-prepended seam.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$HERE/../run-vitest-coverage.sh"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
PACKAGE_JSON="$REPO_ROOT/web/package.json"
FAILURES=0
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

make_stubs() {
  local dir="$1"
  mkdir -p "$dir"
  cat >"$dir/timeout" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >"${COVERAGE_ARGS_FILE:?}"
shift
"$@"
EOF
  cat >"$dir/npx" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$PWD" >"${COVERAGE_CWD_FILE:?}"
printf '%s\n' "${NODE_OPTIONS-<unset>}" >"${COVERAGE_NODE_OPTIONS_FILE:?}"
printf '%s\n' "${COVERAGE_OUTPUT:-}"
exit "${COVERAGE_EXIT:-0}"
EOF
  chmod +x "$dir/timeout" "$dir/npx"
}

run_fixture() {
  local name="$1" output="$2" code="$3"
  local fixture="$TEST_ROOT/$name"
  make_stubs "$fixture/bin"
  mkdir -p "$fixture/tmp" "$fixture/caller"
  (
    cd "$fixture/caller" || exit 1
    TMPDIR="$fixture/tmp" COVERAGE_ARGS_FILE="$fixture/args" \
      COVERAGE_CWD_FILE="$fixture/cwd" COVERAGE_OUTPUT="$output" \
      COVERAGE_NODE_OPTIONS_FILE="$fixture/node_options" \
      COVERAGE_EXIT="$code" PATH="$fixture/bin:$PATH" bash "$RUNNER"
  ) 2>&1
}

echo "=== run-vitest-coverage.sh tests ==="

passing=$' Test Files  10 passed\n Coverage report from v8'
if out="$(run_fixture passing "$passing" 124)"; then
  pass "timeout after a completed passing coverage run is accepted"
else
  fail "completed passing timeout exited non-zero: $out"
fi
if [ "$(cat "$TEST_ROOT/passing/cwd")" = "$REPO_ROOT/web" ]; then
  pass "runner resolves web directory from an arbitrary cwd"
else
  fail "runner used the wrong working directory"
fi
if [ "$(cat "$TEST_ROOT/passing/args")" = "600 npx vitest run --coverage" ]; then
  pass "runner uses the exact bounded Vitest command"
else
  fail "runner arguments drifted: $(cat "$TEST_ROOT/passing/args")"
fi
# The flag has to reach the Vitest process, not merely appear in the script, and
# it has to arrive as an environment variable so the pinned argv above is
# untouched. Asserting on what the child actually saw is the only form of this
# check that can fail.
if [ "$(cat "$TEST_ROOT/passing/node_options")" = "--no-experimental-webstorage" ]; then
  pass "runner exports NODE_OPTIONS to the Vitest process"
else
  fail "NODE_OPTIONS reached Vitest as: $(cat "$TEST_ROOT/passing/node_options")"
fi
if find "$TEST_ROOT/passing/tmp" -type f -print -quit | grep -q .; then
  fail "temporary output file survived runner exit"
else
  pass "temporary output file is removed on exit"
fi

if grep -qF '"pretest:coverage": "npm run build:ui"' "$PACKAGE_JSON"; then
  pass "full coverage command builds the UI workspace first"
else
  fail "full coverage command lacks its build:ui pre-hook"
fi
if grep -qF '"pretest:coverage:changed": "npm run build:ui"' "$PACKAGE_JSON"; then
  pass "changed coverage command builds the UI workspace first"
else
  fail "changed coverage command lacks its build:ui pre-hook"
fi

threshold='ERROR: Coverage for statements (50%) does not meet global threshold (75%)'
if out="$(run_fixture threshold "$threshold" 1)"; then
  fail "coverage-threshold failure was swallowed: $out"
else
  rc=$?
  if [ "$rc" -eq 1 ]; then
    pass "coverage-threshold failure propagates"
  else
    fail "coverage-threshold failure returned status $rc"
  fi
fi

missing="$TEST_ROOT/missing"
mkdir -p "$missing/bin"
cat >"$missing/bin/npx" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$missing/bin/npx"
# Preserve the shell and basic utilities but deliberately hide timeout by
# invoking through a minimal PATH populated with only the commands used before
# the dependency guard.
shell_bin="$(command -v bash)"
command_path="$(command -v dirname)"
ln -s "$command_path" "$missing/bin/dirname" 2>/dev/null \
  || cp "$command_path" "$missing/bin/dirname"
set +e
out="$(PATH="$missing/bin" "$shell_bin" "$RUNNER" 2>&1)"
rc=$?
set -e
if [ "$rc" -eq 2 ] && grep -q "'timeout' not on PATH" <<<"$out"; then
  pass "missing timeout fails closed with an actionable diagnostic"
else
  fail "missing timeout returned rc=$rc: $out"
fi

if [ "$FAILURES" -ne 0 ]; then
  echo "FAILED: $FAILURES assertion(s)"
  exit 1
fi
echo "All run-vitest-coverage tests passed."
