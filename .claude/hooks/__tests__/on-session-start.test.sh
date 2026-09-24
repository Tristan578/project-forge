#!/usr/bin/env bash
# Tests for on-session-start.sh (SessionStart hook, all AI tools) — #8694.
#
# Contract under test (the steps the script actually contains):
#   1. taskboard not installed          -> "TASKBOARD NOT INSTALLED" banner, exit 1
#   2. server down, auto-start fails    -> "TASKBOARD FAILED TO START", exit 0,
#                                          and the GitHub pull is NOT attempted
#      server down, auto-start succeeds -> continues ("Server started")
#   health: board reports 0 tickets     -> "WARNING: TASKBOARD HAS 0 TICKETS"
#   3. pulls from GitHub via sync-from-github.sh (stubbed)
#   4. board status, stale / active / consistency / suggestions, exit 0
#
# HERMETICITY. The hook sources taskboard-state.sh from its own directory and
# runs sync-from-github.sh from there too, so both are stubbed in a temp dir
# next to a copy of the hook. The health check is a direct
# `curl "$TB_API/board"` in the hook body, so the stub sets TB_API to a
# sentinel that is refused locally (TCP port 9). The DX audit step only runs
# when ../tools/dx-audit.sh is executable relative to the hook; in the temp
# dir it does not exist, so that step is skipped.
#
# Run: bash .claude/hooks/__tests__/on-session-start.test.sh
set -uo pipefail

command -v python3 >/dev/null 2>&1 || { echo "python3 is required to run these tests"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "curl is required to run these tests"; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HERE/../on-session-start.sh"

pass=0
fail=0

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$HOOK" "$TMP/on-session-start.sh"

# stage <installed:0|1> <api:0|1> <autostart:0|1> <stale:yes|no> <active_id> <valid:yes|no> <consistent:yes|no>
stage() {
  local installed="$1" api="$2" autostart="$3" stale="$4" active="$5" valid="$6" consistent="$7"
  rm -f "$TMP/sync.ran"
  printf '#!/usr/bin/env bash\ntouch "%s/sync.ran"\nexit 0\n' "$TMP" > "$TMP/sync-from-github.sh"
  chmod +x "$TMP/sync-from-github.sh"
  {
    printf '#!/usr/bin/env bash\n'
    printf 'TB_API="http://127.0.0.1:9/api"\n'
    printf 'tb_check_installed() { return %s; }\n' "$installed"
    printf 'tb_api_available() { return %s; }\n' "$api"
    printf 'tb_auto_start() { return %s; }\n' "$autostart"
    printf 'tb_board_summary() { printf "BOARD SUMMARY STUB\\n"; }\n'
    if [ "$stale" = "yes" ]; then
      printf 'tb_check_stale() { printf "STALE_TICKETS_FOUND\\n  PF-1: stale one\\n"; }\n'
    else
      printf 'tb_check_stale() { printf "OK\\n"; }\n'
    fi
    printf 'tb_get_active_ticket_id() { printf "%%s" "%s"; }\n' "$active"
    if [ "$valid" = "yes" ]; then
      printf 'tb_validate_ticket() { printf "OK\\n"; }\n'
    else
      printf 'tb_validate_ticket() { printf "VALIDATION_FAILED\\n  missing acceptance criteria\\n"; }\n'
    fi
    if [ "$consistent" = "yes" ]; then
      printf 'tb_check_consistency() { printf "OK\\n"; }\n'
    else
      printf 'tb_check_consistency() { printf "CONSISTENCY_ISSUES_FOUND\\n  PF-2: no team\\n"; }\n'
    fi
    printf 'tb_suggest_work() { printf "SUGGESTIONS STUB\\n"; }\n'
  } > "$TMP/taskboard-state.sh"
}

# run_staged -> prints "<exit code>|<stdout+stderr>"
run_staged() {
  local out rc
  out="$(bash "$TMP/on-session-start.sh" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}

assert_exit() {
  local desc="$1" expected="$2" res="$3"
  if [ "${res%%|*}" = "$expected" ]; then
    pass=$((pass + 1)); printf '  ok   %s (exit %s)\n' "$desc" "$expected"
  else
    fail=$((fail + 1)); printf '  FAIL %s (expected exit %s, got %s)\n' "$desc" "$expected" "${res%%|*}"
  fi
}

assert_contains() {
  local desc="$1" needle="$2" res="$3"
  if printf '%s' "${res#*|}" | grep -qF -- "$needle"; then
    pass=$((pass + 1)); printf '  ok   %s\n' "$desc"
  else
    fail=$((fail + 1)); printf '  FAIL %s (missing: %s)\n' "$desc" "$needle"
  fi
}

assert_not_contains() {
  local desc="$1" needle="$2" res="$3"
  if printf '%s' "${res#*|}" | grep -qF -- "$needle"; then
    fail=$((fail + 1)); printf '  FAIL %s (unexpected: %s)\n' "$desc" "$needle"
  else
    pass=$((pass + 1)); printf '  ok   %s\n' "$desc"
  fi
}

assert_sync() {
  local desc="$1" expected="$2"
  local actual="no"
  [ -e "$TMP/sync.ran" ] && actual="yes"
  if [ "$actual" = "$expected" ]; then
    pass=$((pass + 1)); printf '  ok   %s\n' "$desc"
  else
    fail=$((fail + 1)); printf '  FAIL %s (sync ran: %s, expected %s)\n' "$desc" "$actual" "$expected"
  fi
}

echo "on-session-start.sh"

# --- 1. not installed: the one branch that exits non-zero ------------------
stage 1 0 0 no "" yes yes
res="$(run_staged)"
assert_exit "a missing taskboard binary fails the session start" "1" "$res"
assert_contains "the install banner is printed" "TASKBOARD NOT INSTALLED" "$res"
assert_sync "no GitHub pull is attempted without a taskboard" "no"

# --- 2. installed, server down, auto-start fails ---------------------------
stage 0 1 1 no "" yes yes
res="$(run_staged)"
assert_exit "a failed auto-start is reported and exits 0" "0" "$res"
assert_contains "the failed-start banner is printed" "TASKBOARD FAILED TO START" "$res"
assert_not_contains "the install banner is not printed when the binary exists" "TASKBOARD NOT INSTALLED" "$res"
assert_sync "no GitHub pull is attempted when the server could not start" "no"

# --- 2b. installed, server down, auto-start succeeds -> full run -----------
stage 0 1 0 no "" yes yes
res="$(run_staged)"
assert_exit "a successful auto-start continues to the full run" "0" "$res"
assert_contains "the auto-start is announced" "[TASKBOARD] Server started" "$res"
assert_contains "the board status is printed" "TASKBOARD STATUS" "$res"
assert_sync "the GitHub pull runs after a successful auto-start" "yes"

# --- happy path: installed and running, clean board ------------------------
stage 0 0 0 no "" yes yes
res="$(run_staged)"
assert_exit "the happy path exits 0" "0" "$res"
assert_contains "the empty-board health check fires when the board curl is refused" "WARNING: TASKBOARD HAS 0 TICKETS" "$res"
assert_contains "the board summary is printed" "BOARD SUMMARY STUB" "$res"
assert_contains "work suggestions are printed" "SUGGESTIONS STUB" "$res"
assert_contains "the workflow rules are printed" "PLAN BEFORE CODE" "$res"
assert_not_contains "no stale warning on a clean board" "STALE IN-PROGRESS TICKETS" "$res"
assert_not_contains "no consistency warning on a clean board" "TICKET CONSISTENCY ISSUES" "$res"
assert_not_contains "no active-ticket line without an active ticket" "Active ticket:" "$res"
assert_sync "the GitHub pull runs" "yes"

# --- stale + active-with-problems + inconsistent ---------------------------
stage 0 0 0 yes "01ACTIVE" no no
res="$(run_staged)"
assert_exit "warnings never change the exit code" "0" "$res"
assert_contains "stale tickets are called out" "STALE IN-PROGRESS TICKETS" "$res"
assert_contains "the stale entry is echoed" "PF-1: stale one" "$res"
assert_contains "the active ticket is named" "Active ticket: 01ACTIVE" "$res"
assert_contains "a failing validation is reported" "Active ticket has documentation issues" "$res"
assert_contains "the validation detail is echoed" "missing acceptance criteria" "$res"
assert_contains "consistency issues are reported" "TICKET CONSISTENCY ISSUES" "$res"
assert_contains "the consistency detail is echoed" "PF-2: no team" "$res"

echo ""
echo "passed: $pass  failed: $fail"
[ "$fail" -eq 0 ] || exit 1
