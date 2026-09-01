#!/usr/bin/env bash
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../install-playwright-ci.sh"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
BASH_BIN="$(command -v bash)"
FAILURES=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAILURES=$((FAILURES + 1)); }
assert_eq() {
  local description="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then pass "$description"; else
    fail "$description (expected '$expected', got '$actual')"
  fi
}

STUB="$TMP/bin"
mkdir -p "$STUB"
cat > "$STUB/npx" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$PWD|$*" >> "$PLAYWRIGHT_TEST_LOG"
STUB
chmod +x "$STUB/npx"
cat > "$STUB/timeout" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$PLAYWRIGHT_TIMEOUT_LOG"
while [[ "${1:-}" == --* ]]; do
  case "$1" in --signal=*|--kill-after=*) shift ;; *) exit 97 ;; esac
done
shift
count=0
if [ -f "$PLAYWRIGHT_TEST_COUNT" ]; then count="$(cat "$PLAYWRIGHT_TEST_COUNT")"; fi
count=$((count + 1))
printf '%s' "$count" > "$PLAYWRIGHT_TEST_COUNT"
if [ "$count" -le "${PLAYWRIGHT_TEST_FAILS:-0}" ]; then exit "${PLAYWRIGHT_TEST_EXIT:-124}"; fi
"$@"
STUB
chmod +x "$STUB/timeout"
printf '#!/usr/bin/env bash\nexit 0\n' > "$STUB/sleep"
chmod +x "$STUB/sleep"

run_case() {
  local mode="$1" fails="$2" final_exit="${3:-124}"
  : > "$TMP/log"
  : > "$TMP/timeout-log"
  rm -f "$TMP/count"
  PLAYWRIGHT_TEST_LOG="$TMP/log" PLAYWRIGHT_TEST_COUNT="$TMP/count" \
    PLAYWRIGHT_TIMEOUT_LOG="$TMP/timeout-log" \
    PLAYWRIGHT_TEST_FAILS="$fails" PLAYWRIGHT_TEST_EXIT="$final_exit" \
    PATH="$STUB:$PATH" bash "$SCRIPT" "$mode" >"$TMP/out" 2>"$TMP/err"
}

run_case browsers 1
assert_eq "a transient timeout is retried and then succeeds" "0" "$?"
assert_eq "browser mode invokes npx from web" \
  "$REPO_ROOT/web|playwright install --with-deps chromium" "$(cat "$TMP/log")"
assert_eq "two bounded attempts were made" "2" "$(cat "$TMP/count")"
assert_eq "each attempt has a five-minute command timeout" \
  "--signal=TERM --kill-after=15s 300s npx playwright install --with-deps chromium" \
  "$(head -1 "$TMP/timeout-log")"

run_case deps 0
assert_eq "cache-hit dependency mode succeeds" "0" "$?"
assert_eq "dependency mode uses install-deps" \
  "$REPO_ROOT/web|playwright install-deps chromium" "$(cat "$TMP/log")"

: > "$TMP/log"
: > "$TMP/timeout-log"
rm -f "$TMP/count"
(
  cd "$REPO_ROOT/scripts" || exit 98
  PLAYWRIGHT_TEST_LOG="$TMP/log" PLAYWRIGHT_TEST_COUNT="$TMP/count" \
    PLAYWRIGHT_TIMEOUT_LOG="$TMP/timeout-log" PLAYWRIGHT_TEST_FAILS=0 \
    PATH="$STUB:$PATH" bash install-playwright-ci.sh browsers \
    >"$TMP/out" 2>"$TMP/err"
)
assert_eq "filename-only invocation from scripts resolves the repository root" "0" "$?"
assert_eq "filename-only invocation still runs npx from web" \
  "$REPO_ROOT/web|playwright install --with-deps chromium" "$(cat "$TMP/log")"

set +e
run_case browsers 2 124
rc=$?
set -e
assert_eq "two timeouts propagate exit 124" "124" "$rc"
assert_eq "a permanent hang is attempted exactly twice" "2" "$(cat "$TMP/count")"

set +e
PATH="$STUB:$PATH" bash "$SCRIPT" invalid >"$TMP/out" 2>"$TMP/err"
rc=$?
set -e
assert_eq "an unsupported mode fails closed" "2" "$rc"

mkdir "$TMP/no-timeout"
cp "$STUB/npx" "$TMP/no-timeout/npx"
set +e
PATH="$TMP/no-timeout" "$BASH_BIN" "$SCRIPT" browsers >"$TMP/out" 2>"$TMP/err"
rc=$?
set -e
assert_eq "a missing timeout dependency fails closed" "2" "$rc"
if grep -q "'timeout' is required" "$TMP/err"; then
  pass "the missing dependency is named"
else
  fail "the missing timeout diagnostic is absent"
fi

CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
QG_YML="$REPO_ROOT/.github/workflows/quality-gates.yml"
assert_eq "all four browser-install steps use the retry helper" "4" \
  "$(( $(grep -c 'bash ../scripts/install-playwright-ci.sh browsers' "$CI_YML") + $(grep -c 'bash ../scripts/install-playwright-ci.sh browsers' "$QG_YML") ))"
assert_eq "all three cache-hit dependency steps use the retry helper" "3" \
  "$(grep -c 'bash ../scripts/install-playwright-ci.sh deps' "$CI_YML")"
assert_eq "all seven install steps have an outer 12-minute timeout" "7" \
  "$(( $(grep -c 'timeout-minutes: 12' "$CI_YML") + $(grep -c 'timeout-minutes: 12' "$QG_YML") ))"

if [ "$FAILURES" -ne 0 ]; then echo "$FAILURES test(s) failed." >&2; exit 1; fi
echo "All install-playwright-ci tests passed."
