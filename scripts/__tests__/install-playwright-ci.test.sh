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
readonly -f pass
fail() { echo "FAIL - $1"; FAILURES=$((FAILURES + 1)); }
readonly -f fail
assert_eq() {
  local description="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then pass "$description"; else
    fail "$description (expected '$expected', got '$actual')"
  fi
}
readonly -f assert_eq
assert_grep() {
  local description="$1" pattern="$2" file="$3"
  if grep -qF -- "$pattern" "$file"; then pass "$description"; else
    fail "$description (no '$pattern' in $(basename "$file"))"
  fi
}
readonly -f assert_grep

# THE STUBS. Every external the script consults is replaced on PATH, so no case
# depends on the host: whether it has apt, fuser, sudo, root, or a real
# /var/lib/dpkg/lock-frontend held by someone.
#
# Time is a FAKE CLOCK in a file. `date +%s` reads it; `sleep N` advances it by
# N; a hanging attempt advances it by its own timeout. That is what lets the
# budget arithmetic be asserted in seconds rather than measured in minutes.
#
# The dpkg lock holder is SIMULATED from two numbers: it exists once
# DPKG_TEST_HOLD_AFTER attempts have run (1 = the orphan a timed-out attempt
# leaves behind; 0 = something already holding it at boot) and it exits when
# the clock reaches DPKG_TEST_HOLD_UNTIL. `fuser` reports it, and `timeout`
# records any attempt STARTED while it is alive -- the event this script must
# never cause -- and fails that attempt the way apt does: after waiting out its
# 180s lock timeout, with exit 100.
STUB="$TMP/bin"
mkdir -p "$STUB"
cat > "$STUB/clock.sh" <<'STUB'
clock_get() { cat "$FAKE_CLOCK"; }
clock_add() { printf '%s' "$(( $(clock_get) + $1 ))" > "$FAKE_CLOCK"; }
attempts_so_far() { if [ -f "$PLAYWRIGHT_TEST_COUNT" ]; then cat "$PLAYWRIGHT_TEST_COUNT"; else echo 0; fi; }
lock_held() {
  [ "$(attempts_so_far)" -ge "${DPKG_TEST_HOLD_AFTER:-0}" ] && [ "$(clock_get)" -lt "${DPKG_TEST_HOLD_UNTIL:-0}" ]
}
STUB
cat > "$STUB/date" <<'STUB'
#!/usr/bin/env bash
[ "${1:-}" = "+%s" ] || exit 97
cat "$FAKE_CLOCK"
STUB
cat > "$STUB/sleep" <<'STUB'
#!/usr/bin/env bash
. "$(dirname "$0")/clock.sh"
printf '%s\n' "$*" >> "$PLAYWRIGHT_SLEEP_LOG"
clock_add "$1"
STUB
cat > "$STUB/npx" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$PWD|$*" >> "$PLAYWRIGHT_TEST_LOG"
STUB
cat > "$STUB/timeout" <<'STUB'
#!/usr/bin/env bash
. "$(dirname "$0")/clock.sh"
printf '%s\n' "$*" >> "$PLAYWRIGHT_TIMEOUT_LOG"
while [[ "${1:-}" == --* ]]; do
  case "$1" in --signal=*|--kill-after=*) shift ;; *) exit 97 ;; esac
done
limit="${1%s}"
shift
if lock_held; then
  printf 'attempt %s started at %s while the lock was held\n' \
    "$(( $(attempts_so_far) + 1 ))" "$(clock_get)" >> "$DPKG_TEST_FIGHT_LOG"
  printf '%s' "$(( $(attempts_so_far) + 1 ))" > "$PLAYWRIGHT_TEST_COUNT"
  wait_s=180
  if [ "$limit" -lt "$wait_s" ]; then wait_s=$limit; fi
  clock_add "$wait_s"
  exit 100
fi
count=$(( $(attempts_so_far) + 1 ))
printf '%s' "$count" > "$PLAYWRIGHT_TEST_COUNT"
if [ "$count" -le "${PLAYWRIGHT_TEST_FAILS:-0}" ]; then
  code="${PLAYWRIGHT_TEST_EXIT:-124}"
  if [ "$code" -eq 124 ]; then clock_add "$limit"; else clock_add "${PLAYWRIGHT_TEST_FAIL_SECONDS:-1}"; fi
  exit "$code"
fi
"$@"
STUB
cat > "$STUB/fuser" <<'STUB'
#!/usr/bin/env bash
. "$(dirname "$0")/clock.sh"
printf '%s\n' "$*" >> "$DPKG_TEST_FUSER_LOG"
if lock_held; then
  printf ' 2614'
  printf '%s: F\n' "$1" >&2
  exit 0
fi
exit 1
STUB
cat > "$STUB/sudo" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DPKG_TEST_SUDO_LOG"
if [ "${DPKG_TEST_SUDO_DENY:-0}" = "1" ]; then exit 1; fi
if [ "${1:-}" = "-n" ]; then shift; fi
"$@"
STUB
cat > "$STUB/id" <<'STUB'
#!/usr/bin/env bash
[ "${1:-}" = "-u" ] || exit 97
printf '%s\n' "${DPKG_TEST_UID:-1000}"
STUB
cat > "$STUB/ps" <<'STUB'
#!/usr/bin/env bash
printf 'apt-get\n'
STUB
chmod +x "$STUB/date" "$STUB/sleep" "$STUB/npx" "$STUB/timeout" "$STUB/fuser" \
  "$STUB/sudo" "$STUB/id" "$STUB/ps"

# The lock files the probe inspects must EXIST for it to run at all (a host
# with none is not an apt host). Point the script at fixtures, never the host's.
mkdir -p "$TMP/dpkg"
: > "$TMP/dpkg/lock-frontend"
: > "$TMP/dpkg/lock"
export DPKG_LOCK_FILES="$TMP/dpkg/lock-frontend $TMP/dpkg/lock"
# ...and keep every case off the host's /etc/apt (the default would write a
# file there, via sudo, on the CI runner that executes this suite).
export APT_CONF_DIR="$TMP/not-an-apt-host"
export FAKE_CLOCK="$TMP/clock"
export PLAYWRIGHT_TEST_LOG="$TMP/log"
export PLAYWRIGHT_TEST_COUNT="$TMP/count"
export PLAYWRIGHT_TIMEOUT_LOG="$TMP/timeout-log"
export PLAYWRIGHT_SLEEP_LOG="$TMP/sleep-log"
export DPKG_TEST_FIGHT_LOG="$TMP/fight-log"
export DPKG_TEST_FUSER_LOG="$TMP/fuser-log"
export DPKG_TEST_SUDO_LOG="$TMP/sudo-log"

reset_fixtures() {
  printf '0' > "$FAKE_CLOCK"
  : > "$TMP/log"
  : > "$TMP/timeout-log"
  : > "$TMP/sleep-log"
  : > "$TMP/fight-log"
  : > "$TMP/fuser-log"
  : > "$TMP/sudo-log"
  rm -f "$TMP/count"
}
readonly -f reset_fixtures

# Prefix assignments on a run_case call (PLAYWRIGHT_INSTALL_BUDGET_SECONDS=...,
# DPKG_TEST_HOLD_UNTIL=..., PLAYWRIGHT_TEST_FAIL_SECONDS=...) reach the script
# and the stubs through the environment.
run_case() {
  local mode="$1" fails="$2" final_exit="${3:-124}"
  shift 3 2>/dev/null || shift $#
  reset_fixtures
  PLAYWRIGHT_TEST_FAILS="$fails" PLAYWRIGHT_TEST_EXIT="$final_exit" \
    PATH="$STUB:$PATH" bash "$SCRIPT" "$mode" "$@" >"$TMP/out" 2>"$TMP/err"
}
readonly -f run_case

clock() { cat "$FAKE_CLOCK"; }
readonly -f clock
sleeps() { tr '\n' ' ' < "$TMP/sleep-log" | sed 's/ *$//'; }
readonly -f sleeps
# The Nth attempt's timeout as passed to `timeout`, e.g. "300s".
attempt_timeout() { sed -n "${1}p" "$TMP/timeout-log" | awk '{print $3}'; }
readonly -f attempt_timeout

# --- the contract the workflows call -----------------------------------------

run_case browsers 1 124
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

reset_fixtures
(
  cd "$REPO_ROOT/scripts" || exit 98
  PLAYWRIGHT_TEST_FAILS=0 PATH="$STUB:$PATH" bash install-playwright-ci.sh browsers \
    >"$TMP/out" 2>"$TMP/err"
)
assert_eq "filename-only invocation from scripts resolves the repository root" "0" "$?"
assert_eq "filename-only invocation still runs npx from web" \
  "$REPO_ROOT/web|playwright install --with-deps chromium" "$(cat "$TMP/log")"

run_case browsers 0 124 chromium firefox webkit
assert_eq "an explicit browser list installs exactly those engines (#9610)" \
  "$REPO_ROOT/web|playwright install --with-deps chromium firefox webkit" "$(cat "$TMP/log")"
run_case deps 0 124 chromium firefox webkit
assert_eq "dependency mode honours the same browser list" \
  "$REPO_ROOT/web|playwright install-deps chromium firefox webkit" "$(cat "$TMP/log")"

# --- retries and the budget --------------------------------------------------

# The fast failure shape: apt exits 100 in about a second when it loses the
# lock race. Attempts are cheap here, so it gets all five with escalating
# backoff (#9675).
PLAYWRIGHT_TEST_FAIL_SECONDS=1 run_case browsers 5 100
assert_eq "an unrecoverable fast failure propagates its exit code" "100" "$?"
assert_eq "an unrecoverable fast failure is attempted five times" "5" "$(cat "$TMP/count")"
assert_eq "the backoff escalates between attempts" "15 30 60 90" "$(sleeps)"
assert_grep "the final error counts the attempts that actually ran" \
  "failed after 5 of 5 attempts" "$TMP/err"

# The slow shape: every attempt hangs to its timeout. With the default 660s
# budget the first burns 300s, and the second is still worth starting
# (300 + 15 + 120 <= 660) but is CAPPED to the 345s that remain, which the
# 300s attempt timeout already is. Then 615 + 30 + 120 > 660 ends it. A
# genuine hang therefore ends inside the budget, by construction, without the
# suite setting one -- this case exercises the script's own default.
run_case browsers 5 124
assert_eq "an unrecoverable hang propagates exit 124" "124" "$?"
assert_eq "a hang under the default budget gets two attempts" "2" "$(cat "$TMP/count")"
assert_eq "a hang under the default budget sleeps one backoff" "15" "$(sleeps)"
if [ "$(clock)" -le 660 ]; then
  pass "a hang under the default budget ends inside it ($(clock)s <= 660s)"
else
  fail "a hang under the default budget ran to $(clock)s, past 660s"
fi
assert_grep "the final error reports two attempts, not the maximum" \
  "failed after 2 of 5 attempts" "$TMP/err"

# CAPPING, the property that makes the budget a bound. At 500 the second round
# fits (300 + 15 + 120 <= 500), and its attempt is given the 185s that remain,
# not a fresh 300s that would end at 615.
PLAYWRIGHT_INSTALL_BUDGET_SECONDS=500 run_case browsers 5 124
assert_eq "a capped run still propagates exit 124" "124" "$?"
assert_eq "the first attempt gets the full attempt timeout" "300s" "$(attempt_timeout 1)"
assert_eq "a retry is capped to what is left of the budget" "185s" "$(attempt_timeout 2)"
assert_eq "a capped run ends exactly at its budget" "500" "$(clock)"

# The look-ahead's boundary, from both sides. A round needs its backoff PLUS
# a 120s minimum attempt: 300 + 15 + 120 = 435. At 435 it fits exactly, and
# the retry is capped to 120s; at 434 it does not, so nothing sleeps.
PLAYWRIGHT_INSTALL_BUDGET_SECONDS=435 run_case browsers 5 124
assert_eq "a round that exactly fits its backoff and minimum attempt runs" "2" "$(cat "$TMP/count")"
assert_eq "that round's attempt is capped to the minimum" "120s" "$(attempt_timeout 2)"
PLAYWRIGHT_INSTALL_BUDGET_SECONDS=434 run_case browsers 5 124
assert_eq "a round one second short of fitting is not started" "1" "$(cat "$TMP/count")"
assert_eq "a round one second short of fitting sleeps not at all" "" "$(sleeps)"
assert_grep "the look-ahead names the backoff and the minimum attempt it declined" \
  "a further 15s backoff plus a 120s minimum attempt would overrun it" "$TMP/out"

# ...and it must read the ESCALATING backoff of the round it is about to run.
# Fast failures put the clock at 15 + 30 = 45 after two rounds; at 200 the
# third round needs 45 + 60 + 120 = 225 and is refused. A look-ahead that
# hardcoded the first backoff would see 45 + 15 + 120 = 180 and keep going.
PLAYWRIGHT_TEST_FAIL_SECONDS=0 PLAYWRIGHT_INSTALL_BUDGET_SECONDS=200 run_case browsers 5 100
assert_eq "the look-ahead uses each round's own backoff" "3" "$(cat "$TMP/count")"
assert_eq "the rounds it did run slept their own escalating backoffs" "15 30" "$(sleeps)"

# A budget below one minimum attempt still makes the FIRST attempt (at the
# minimum) and nothing more.
PLAYWRIGHT_INSTALL_BUDGET_SECONDS=0 run_case browsers 5 124
assert_eq "an exhausted retry budget still propagates exit 124" "124" "$?"
assert_eq "an exhausted retry budget stops after the first attempt" "1" "$(cat "$TMP/count")"
assert_eq "an exhausted retry budget runs that attempt at the minimum" "120s" "$(attempt_timeout 1)"
assert_eq "an exhausted retry budget sleeps not at all" "" "$(sleeps)"
assert_grep "budget exhaustion is reported distinctly from a retry" \
  "exhausted its 0s retry budget" "$TMP/out"

# --- the held dpkg lock (#9665; recurred 2026-10-01, #10315) -----------------

# THE INCIDENT. Attempt 1 hangs to its 300s timeout and leaves a root apt-get
# holding the lock until t=520. The old loop backed off 15s and started a
# second apt-get at t=315, which waited out apt's 180s lock timeout and died
# with exit 100 at t=495. Now the script sees the holder, skips the backoff,
# waits for it to exit, and only then starts attempt 2 -- capped to the 140s
# left of the 660s budget, which is plenty for an install the orphan finished.
DPKG_TEST_HOLD_AFTER=1 DPKG_TEST_HOLD_UNTIL=520 run_case browsers 1 124
assert_eq "an orphaned apt-get is waited out and the retry succeeds" "0" "$?"
assert_eq "no attempt is started while the dpkg lock is held" "" "$(cat "$TMP/fight-log")"
assert_eq "waiting for the holder took exactly two attempts" "2" "$(cat "$TMP/count")"
assert_eq "the retry starts once the holder has exited, capped to the rest of the budget" \
  "140s" "$(attempt_timeout 2)"
assert_eq "waiting for the holder replaces the backoff (polls only)" \
  "" "$(grep -vx '5' "$TMP/sleep-log" | tr '\n' ' ' | sed 's/ *$//')"
assert_grep "the holder is named in the log" "held by PID 2614 (apt-get)" "$TMP/out"
assert_grep "the release is reported" "the dpkg lock was released after" "$TMP/out"
# Vacuity guard: the cases above prove nothing unless the probe really ran.
if [ -s "$TMP/fuser-log" ]; then pass "the lock probe ran (fuser was consulted)"; else
  fail "the lock probe never ran, so the no-fight assertions above are vacuous"
fi
assert_grep "off root the probe runs under sudo -n (a non-root fuser cannot see a root holder)" \
  "-n fuser" "$TMP/sudo-log"

# A holder that outlives the budget is waited for up to the point where one
# minimum attempt still fits (660 - 120 = 540), then reported -- never fought.
DPKG_TEST_HOLD_AFTER=1 DPKG_TEST_HOLD_UNTIL=99999 run_case browsers 1 124
rc=$?
if [ "$rc" -ne 0 ]; then pass "a holder that outlives the budget fails the install (exit $rc)"; else
  fail "a holder that outlives the budget reported success"
fi
assert_eq "a holder that outlives the budget is never fought" "" "$(cat "$TMP/fight-log")"
assert_eq "a holder that outlives the budget gets no second attempt" "1" "$(cat "$TMP/count")"
assert_eq "the wait stops where one minimum attempt would still fit" "540" "$(clock)"
assert_grep "the error names the holder it gave up on" \
  "still held by PID 2614 (apt-get)" "$TMP/err"
assert_grep "the final error counts one attempt" "failed after 1 of 5 attempts" "$TMP/err"

# A holder already there at boot (the unattended-upgrades timer) is waited for
# BEFORE attempt 1, so that wait does not eat the attempt's own timeout.
DPKG_TEST_HOLD_AFTER=0 DPKG_TEST_HOLD_UNTIL=60 run_case browsers 0
assert_eq "a boot-time holder is waited out and the install succeeds" "0" "$?"
assert_eq "a boot-time holder is never fought" "" "$(cat "$TMP/fight-log")"
assert_eq "a boot-time holder costs no attempt" "1" "$(cat "$TMP/count")"
assert_eq "the first attempt still gets its full timeout after a boot-time wait" \
  "300s" "$(attempt_timeout 1)"

# On root the probe needs no sudo.
DPKG_TEST_UID=0 DPKG_TEST_HOLD_AFTER=0 DPKG_TEST_HOLD_UNTIL=10 run_case deps 0
assert_eq "as root the install succeeds after the wait" "0" "$?"
assert_eq "as root the probe calls fuser without sudo" "" "$(cat "$TMP/sudo-log")"
if [ -s "$TMP/fuser-log" ]; then pass "as root the probe still ran"; else
  fail "as root the probe never ran"
fi

# A host where the holder cannot be seen (no root, no passwordless sudo) says
# so and proceeds; apt's own lock timeout is the fallback there.
DPKG_TEST_SUDO_DENY=1 run_case deps 0
assert_eq "an unreadable lock holder does not block the install" "0" "$?"
assert_grep "an unreadable lock holder is reported, not silently treated as free" \
  "cannot see the dpkg lock holder" "$TMP/out"
assert_eq "an unreadable lock holder means fuser is never consulted" "" "$(cat "$TMP/fuser-log")"

# A host with none of the lock files is not an apt host: nothing to probe.
DPKG_LOCK_FILES="$TMP/dpkg/absent-frontend $TMP/dpkg/absent-lock" run_case deps 0
assert_eq "a host without dpkg lock files still installs" "0" "$?"
assert_eq "a host without dpkg lock files is not probed" "" "$(cat "$TMP/fuser-log")"

# --- argument and dependency handling ---------------------------------------

PATH="$STUB:$PATH" bash "$SCRIPT" invalid >"$TMP/out" 2>"$TMP/err"
rc=$?
assert_eq "an unsupported mode fails closed" "2" "$rc"

mkdir "$TMP/no-timeout"
cp "$STUB/npx" "$TMP/no-timeout/npx"
PATH="$TMP/no-timeout" "$BASH_BIN" "$SCRIPT" browsers >"$TMP/out" 2>"$TMP/err"
rc=$?
assert_eq "a missing timeout dependency fails closed" "2" "$rc"
assert_grep "the missing dependency is named" "'timeout' is required" "$TMP/err"

# --- apt's own lock wait (the backstop) --------------------------------------

# apt-get exits 100 the instant the lock is held unless told to wait, and the
# probe above cannot see every holder (no sudo, or one that appears between
# the probe and apt taking the lock). Both branches are driven, because a
# helper that silently no-ops on a non-apt host would read as configured.
APT_DIR="$TMP/apt.conf.d"
mkdir -p "$APT_DIR"
APT_CONF_DIR="$APT_DIR" APT_LOCK_TIMEOUT_SECONDS=180 run_case deps 0
assert_eq "apt is told to wait for the dpkg lock rather than exit 100" \
  'DPkg::Lock::Timeout "180";' "$(cat "$APT_DIR/99-spawnforge-lock-timeout" 2>/dev/null)"
assert_grep "the lock-wait configuration is reported in the log" \
  "wait up to 180s for the dpkg lock" "$TMP/out"

APT_CONF_DIR="$TMP/definitely-not-here" run_case deps 0
assert_eq "a non-apt host still installs" "0" "$?"
assert_grep "a non-apt host says the lock-wait config was skipped" \
  "skipping apt lock-wait config" "$TMP/out"

# --- workflow wiring ---------------------------------------------------------

CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
QG_YML="$REPO_ROOT/.github/workflows/quality-gates.yml"
CD_YML="$REPO_ROOT/.github/workflows/cd.yml"
assert_eq "all eight browser-install steps use the retry helper" "8" \
  "$(( $(grep -c 'scripts/install-playwright-ci.sh browsers' "$CI_YML") + $(grep -c 'scripts/install-playwright-ci.sh browsers' "$QG_YML") + $(grep -c 'scripts/install-playwright-ci.sh browsers' "$CD_YML") ))"
# Every workflow that installs Playwright is summed here, quality-gates.yml
# included. Leaving it out of this sum is what let the editor-boot cache-hit
# step keep calling `npx playwright install-deps` bare while the suite reported
# full coverage (#9570 review).
assert_eq "all seven cache-hit dependency steps use the retry helper" "7" \
  "$(( $(grep -c 'scripts/install-playwright-ci.sh deps' "$CI_YML") + $(grep -c 'scripts/install-playwright-ci.sh deps' "$QG_YML") + $(grep -c 'scripts/install-playwright-ci.sh deps' "$CD_YML") ))"

# Every install step's budget must END before its own step timeout, or the
# runner kills the step and replaces this script's diagnostic with a bare
# "step timed out". The pairing is DERIVED, not restated: each step that runs
# the helper is cut out of its workflow with its timeout-minutes and any
# PLAYWRIGHT_INSTALL_BUDGET_SECONDS it sets, and the default budget is read
# from the script. A step block ends at the next line indented no deeper than
# its own `- ` (the next step, or the next job).
# shellcheck disable=SC2016 # the $ is the script's literal text, matched not expanded
DEFAULT_BUDGET="$(sed -n 's/^TOTAL_BUDGET_SECONDS="\${PLAYWRIGHT_INSTALL_BUDGET_SECONDS:-\([0-9][0-9]*\)}"$/\1/p' "$SCRIPT")"
if [ -n "$DEFAULT_BUDGET" ]; then pass "the script's default budget was derived ($DEFAULT_BUDGET s)"; else
  fail "could not derive the script's default budget from its TOTAL_BUDGET_SECONDS line"
fi
install_steps() {
  awk -v f="$1" '
    function flush() {
      if (in_step && uses) print f ":" start "\t" (tmo == "" ? "none" : tmo) "\t" (budget == "" ? "default" : budget)
      in_step = 0; uses = 0; tmo = ""; budget = ""
    }
    {
      match($0, /^ */); ind = RLENGTH
      if ($0 ~ /^ *- /) { flush(); in_step = 1; dash = ind; start = NR }
      else if (in_step && $0 !~ /^ *$/ && $0 !~ /^ *#/ && ind <= dash) { flush() }
      if (!in_step) next
      if ($0 ~ /scripts\/install-playwright-ci\.sh (browsers|deps)/) uses = 1
      if ($0 ~ /^ *timeout-minutes: *[0-9]+ *$/) { t = $0; sub(/^ *timeout-minutes: */, "", t); sub(/ *$/, "", t); tmo = t }
      if ($0 ~ /^ *PLAYWRIGHT_INSTALL_BUDGET_SECONDS:/) { b = $0; sub(/^ *PLAYWRIGHT_INSTALL_BUDGET_SECONDS: */, "", b); gsub(/[^0-9]/, "", b); budget = b }
    }
    END { flush() }
  ' "$1"
}
readonly -f install_steps
{ install_steps "$CI_YML"; install_steps "$QG_YML"; install_steps "$CD_YML"; } > "$TMP/steps"
# Vacuity guard: the derivation must find every step counted above.
assert_eq "the step derivation found all fifteen install steps" "15" "$(wc -l < "$TMP/steps" | tr -d ' ')"
bad_steps=0
while IFS=$'\t' read -r where minutes budget; do
  if [ "$budget" = "default" ]; then budget="$DEFAULT_BUDGET"; fi
  if [ "$minutes" = "none" ] || [ -z "$budget" ]; then
    fail "$where: install step has no timeout-minutes or no derivable budget"
    bad_steps=$((bad_steps + 1))
    continue
  fi
  # budget + timeout's 15s SIGKILL grace + 30s for the step's own startup.
  if [ $((budget + 15 + 30)) -gt $((minutes * 60)) ]; then
    fail "$where: a ${budget}s budget plus 45s of grace overruns timeout-minutes: $minutes"
    bad_steps=$((bad_steps + 1))
  fi
done < "$TMP/steps"
if [ "$bad_steps" -eq 0 ]; then pass "every install step's budget fits inside its own step timeout"; fi
# The cross-browser job's larger budget is the fix for 2026-10-01; pin that it
# is still applied to both of its install steps.
assert_eq "both cross-browser install steps carry the 1020s budget" "2" \
  "$(awk -F'\t' '$3 == "1020"' "$TMP/steps" | wc -l | tr -d ' ')"

# The lock fixtures are TEST seams: pointed at an empty path in a workflow, the
# probe would see no lock files and never wait, and the apt-conf seam would
# drop apt's own lock wait. Neither may be set by any workflow or action.
seam_dirs=("$REPO_ROOT/.github/workflows")
if [ -d "$REPO_ROOT/.github/actions" ]; then seam_dirs+=("$REPO_ROOT/.github/actions"); fi
if [ ! -d "${seam_dirs[0]}" ]; then
  fail "no .github/workflows to scan for the lock-probe test seams"
else
  seam_hits="$(grep -rnE '(^|[^A-Za-z_])(DPKG_LOCK_FILES|APT_CONF_DIR)([^A-Za-z_]|$)' "${seam_dirs[@]}" \
    | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#')"
  assert_eq "no workflow or action wires the lock-probe test seams" "" "$seam_hits"
fi

if [ "$FAILURES" -ne 0 ]; then echo "$FAILURES test(s) failed." >&2; exit 1; fi
echo "All install-playwright-ci tests passed."
