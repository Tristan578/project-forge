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
cat > "$STUB/sleep" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$PLAYWRIGHT_SLEEP_LOG"
exit 0
STUB
chmod +x "$STUB/sleep"

run_case() {
  local mode="$1" fails="$2" final_exit="${3:-124}"
  : > "$TMP/log"
  : > "$TMP/timeout-log"
  : > "$TMP/sleep-log"
  rm -f "$TMP/count"
  PLAYWRIGHT_TEST_LOG="$TMP/log" PLAYWRIGHT_TEST_COUNT="$TMP/count" \
    PLAYWRIGHT_TIMEOUT_LOG="$TMP/timeout-log" \
    PLAYWRIGHT_SLEEP_LOG="$TMP/sleep-log" \
    PLAYWRIGHT_TEST_FAILS="$fails" PLAYWRIGHT_TEST_EXIT="$final_exit" \
    PLAYWRIGHT_INSTALL_BUDGET_SECONDS="${PLAYWRIGHT_INSTALL_BUDGET_SECONDS:-600}" \
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

: > "$TMP/log"
: > "$TMP/timeout-log"
rm -f "$TMP/count"
PLAYWRIGHT_TEST_LOG="$TMP/log" PLAYWRIGHT_TEST_COUNT="$TMP/count" \
  PLAYWRIGHT_TIMEOUT_LOG="$TMP/timeout-log" PLAYWRIGHT_TEST_FAILS=0 \
  PATH="$STUB:$PATH" bash "$SCRIPT" browsers chromium firefox webkit >"$TMP/out" 2>"$TMP/err"
assert_eq "an explicit browser list installs exactly those engines (#9610)" \
  "$REPO_ROOT/web|playwright install --with-deps chromium firefox webkit" "$(cat "$TMP/log")"
: > "$TMP/log"
rm -f "$TMP/count"
PLAYWRIGHT_TEST_LOG="$TMP/log" PLAYWRIGHT_TEST_COUNT="$TMP/count" \
  PLAYWRIGHT_TIMEOUT_LOG="$TMP/timeout-log" PLAYWRIGHT_TEST_FAILS=0 \
  PATH="$STUB:$PATH" bash "$SCRIPT" deps chromium firefox webkit >"$TMP/out" 2>"$TMP/err"
assert_eq "dependency mode honours the same browser list" \
  "$REPO_ROOT/web|playwright install-deps chromium firefox webkit" "$(cat "$TMP/log")"

set +e
run_case browsers 5 124
rc=$?
set -e
assert_eq "an unrecoverable failure propagates exit 124" "124" "$rc"
# Five, not two: a lost dpkg-frontend lock fails in seconds, so attempts are
# cheap in exactly the case that needs more of them (#9675). The wall-clock
# budget asserted below is what keeps a genuine hang bounded.
assert_eq "an unrecoverable failure is attempted five times" "5" "$(cat "$TMP/count")"
assert_eq "the backoff escalates between attempts" "15 30 60 90" \
  "$(tr '\n' ' ' < "$TMP/sleep-log" | sed 's/ *$//')"

# The budget, not the attempt count, is what bounds a genuine hang — each of its
# attempts burns the full 300s, so five of them would outlast the workflow's
# outer `timeout-minutes: 12` and replace this script's diagnostic with a bare
# "step timed out". Driving the budget to zero proves the check is load-bearing:
# without it this case would run all five attempts like the one above.
set +e
PLAYWRIGHT_INSTALL_BUDGET_SECONDS=0 run_case browsers 5 124
rc=$?
set -e
assert_eq "an exhausted retry budget still propagates exit 124" "124" "$rc"
assert_eq "an exhausted retry budget stops after the first attempt" "1" \
  "$(cat "$TMP/count")"
assert_eq "an exhausted retry budget sleeps not at all" "" "$(cat "$TMP/sleep-log")"
if grep -q "exhausted its 0s retry budget" "$TMP/out"; then
  pass "budget exhaustion is reported distinctly from a retry"
else
  fail "budget exhaustion is not reported distinctly from a retry"
fi

# The budget must be spent as a LOOK-AHEAD -- "would another full-length
# attempt overrun it" -- not as "have we overrun it already". The zero case
# above cannot tell those two apart: 0 >= 0 and 0 + 300 >= 0 both break. 299
# can. Under the look-ahead the first failure ends the loop (0 + 300 >= 299);
# under an after-the-fact check it does not (elapsed is ~0, and 0 >= 299 is
# false), so all five attempts run. That difference is the whole defect: three
# fast apt-lock failures leave elapsed well under the budget, and the two 300s
# hangs that may follow then run to ~810s -- past the outer `timeout-minutes:
# 12` this budget exists to stay inside.
set +e
PLAYWRIGHT_INSTALL_BUDGET_SECONDS=299 run_case browsers 5 124
rc=$?
set -e
assert_eq "a budget below one attempt still propagates exit 124" "124" "$rc"
assert_eq "a budget below one attempt stops before the second attempt" "1" \
  "$(cat "$TMP/count")"
assert_eq "a budget below one attempt sleeps not at all" "" "$(cat "$TMP/sleep-log")"
if grep -q "would overrun it" "$TMP/out"; then
  pass "the look-ahead names the round it declined to start"
else
  fail "the look-ahead does not name the round it declined to start"
fi

# The look-ahead must count the BACKOFF too, because the sleep happens after
# the check and before the attempt the check gates. 310 separates the two: an
# attempt-only look-ahead sees 0 + 300 < 310 and runs all five, while the
# backoff-inclusive one sees 0 + 15 + 300 >= 310 and stops at the first. The
# gap that discriminator stands for is reachable in CI -- three instant lock
# failures then a 254s one leave elapsed at 359, which clears an attempt-only
# look-ahead against the 660s budget, after which the 90s backoff and a 300s
# hang land at 764s, past the outer `timeout-minutes: 12`.
set +e
PLAYWRIGHT_INSTALL_BUDGET_SECONDS=310 run_case browsers 5 124
rc=$?
set -e
assert_eq "a budget that cannot fit backoff plus an attempt propagates exit 124" \
  "124" "$rc"
assert_eq "the look-ahead counts the backoff, not just the attempt" "1" \
  "$(cat "$TMP/count")"
assert_eq "a budget that cannot fit backoff plus an attempt sleeps not at all" \
  "" "$(cat "$TMP/sleep-log")"
if grep -q "a further 15s backoff plus a 300s attempt would overrun it" "$TMP/out"; then
  pass "the warning names both the backoff and the attempt it declined"
else
  fail "the warning does not name both the backoff and the attempt it declined"
fi

# ...and it must read the ESCALATING backoff for the round it is about to run,
# not a constant. At 340 the first two rounds fit (0 + 15 + 300 and
# 0 + 30 + 300) and the third does not (0 + 60 + 300 >= 340), so the loop stops
# after three attempts having slept 15 then 30. A look-ahead hardcoding the
# first backoff would clear all five rounds at 315 < 340.
set +e
PLAYWRIGHT_INSTALL_BUDGET_SECONDS=340 run_case browsers 5 124
rc=$?
set -e
assert_eq "an escalating-backoff budget still propagates exit 124" "124" "$rc"
assert_eq "the look-ahead uses each round's own backoff" "3" "$(cat "$TMP/count")"
assert_eq "the rounds it did run slept their own escalating backoffs" "15 30" \
  "$(tr '\n' ' ' < "$TMP/sleep-log" | sed 's/ *$//')"

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
CD_YML="$REPO_ROOT/.github/workflows/cd.yml"
assert_eq "all seven browser-install steps use the retry helper" "7" \
  "$(( $(grep -c 'scripts/install-playwright-ci.sh browsers' "$CI_YML") + $(grep -c 'scripts/install-playwright-ci.sh browsers' "$QG_YML") + $(grep -c 'scripts/install-playwright-ci.sh browsers' "$CD_YML") ))"
# Every workflow that installs Playwright is summed here, quality-gates.yml
# included. Leaving it out of this sum is what let the editor-boot cache-hit
# step keep calling `npx playwright install-deps` bare while the suite reported
# full coverage (#9570 review).
assert_eq "all six cache-hit dependency steps use the retry helper" "6" \
  "$(( $(grep -c 'scripts/install-playwright-ci.sh deps' "$CI_YML") + $(grep -c 'scripts/install-playwright-ci.sh deps' "$QG_YML") + $(grep -c 'scripts/install-playwright-ci.sh deps' "$CD_YML") ))"
assert_eq "all thirteen install steps have an outer 12-minute timeout" "13" \
  "$(( $(grep -c 'timeout-minutes: 12' "$CI_YML") + $(grep -c 'timeout-minutes: 12' "$QG_YML") + $(grep -c 'timeout-minutes: 12' "$CD_YML") ))"

if [ "$FAILURES" -ne 0 ]; then echo "$FAILURES test(s) failed." >&2; exit 1; fi
echo "All install-playwright-ci tests passed."
