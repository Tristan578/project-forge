#!/usr/bin/env bash
# Tests for on-prompt-submit.sh (UserPromptSubmit hook, all AI tools) — #8694.
#
# Contract under test:
#   exit 0 ALWAYS — the hook warns and instructs, it never blocks a prompt.
#   - taskboard unreachable       -> "[TASKBOARD] Server not reachable"
#   - board reports 0 tickets     -> "[TASKBOARD WARNING] Board has 0 tickets"
#   - stale in-progress tickets   -> "[TASKBOARD] Stale in-progress tickets detected"
#   - an active ticket            -> "[TASKBOARD] Active ticket: PF-<n> ..." and
#                                    NO dev-intent block, whatever the prompt says
#   - no active ticket + a prompt that reads as development work with no
#     "safe" word -> the "[TASKBOARD] NO ACTIVE TICKET" instruction block,
#     carrying the project and team ids, and the prompt summary
#   - no active ticket + a prompt with a safe word (explain/how/...) -> no block
#
# HERMETICITY. The hook sources taskboard-state.sh from its own directory, so
# it is copied into a temp dir next to a FULL-REPLACEMENT stub that defines
# every tb_* function it calls as a plain bash function. The board-count
# health check is a direct `curl "$TB_API/board"` in the hook body — not a
# function — so the stub sets TB_API to a sentinel that is guaranteed to be
# refused locally (TCP port 9, discard) and never a live taskboard.
#
# Run: bash .claude/hooks/__tests__/on-prompt-submit.test.sh
set -uo pipefail

command -v python3 >/dev/null 2>&1 || { echo "python3 is required to run these tests (the hook's dev-intent classifier)"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "curl is required to run these tests"; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HERE/../on-prompt-submit.sh"

pass=0
fail=0

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$HOOK" "$TMP/on-prompt-submit.sh"

# stage <api_available:0|1> <stale:yes|no> <active_id> -> writes the stub
# taskboard-state.sh the hook will source. Arguments are exit codes/values
# for the functions the hook calls.
stage() {
  local api="$1" stale="$2" active="$3"
  {
    printf '#!/usr/bin/env bash\n'
    # Unreachable on any box: port 9 (discard) is refused, so the health
    # check's curl fails fast and BOARD_COUNT falls back to 0.
    printf 'TB_API="http://127.0.0.1:9/api"\n'
    printf 'tb_api_available() { return %s; }\n' "$api"
    if [ "$stale" = "yes" ]; then
      printf 'tb_check_stale() { printf "STALE_TICKETS_FOUND\\n  PF-1: stale one\\n"; }\n'
    else
      printf 'tb_check_stale() { printf "OK\\n"; }\n'
    fi
    printf 'tb_get_active_ticket_id() { printf "%%s" "%s"; }\n' "$active"
    printf 'tb_get_ticket() { printf "{\\"title\\":\\"Ship it\\",\\"status\\":\\"in_progress\\",\\"number\\":42}"; }\n'
    printf 'tb_get_project_id() { printf "proj_stub"; }\n'
    printf 'tb_get_team_id() { printf "team_stub"; }\n'
  } > "$TMP/taskboard-state.sh"
}

# run_hook <prompt> -> prints "<exit code>|<stdout+stderr>"
run_hook() {
  local out rc
  out="$(printf '%s' "$1" | bash "$TMP/on-prompt-submit.sh" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}

assert_exit0() {
  local desc="$1" res="$2"
  if [ "${res%%|*}" = "0" ]; then
    pass=$((pass + 1)); printf '  ok   %s (exit 0)\n' "$desc"
  else
    fail=$((fail + 1)); printf '  FAIL %s (expected exit 0, got %s)\n' "$desc" "${res%%|*}"
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

echo "on-prompt-submit.sh"

# --- taskboard unreachable -------------------------------------------------
stage 1 no ""
res="$(run_hook "implement the login form")"
assert_exit0 "unreachable taskboard never blocks the prompt" "$res"
assert_contains "unreachable taskboard is announced" "[TASKBOARD] Server not reachable" "$res"
assert_not_contains "unreachable taskboard skips the dev-intent gate" "NO ACTIVE TICKET" "$res"

# --- reachable, empty board, no active ticket, non-dev prompt ---------------
stage 0 no ""
res="$(run_hook "explain how the credit system works")"
assert_exit0 "a safe query exits 0" "$res"
assert_contains "an empty board (health-check curl refused) is warned about" "[TASKBOARD WARNING] Board has 0 tickets" "$res"
assert_not_contains "a prompt with safe words (explain/how) is not treated as dev work" "NO ACTIVE TICKET" "$res"

# --- reachable, no active ticket, dev-intent prompt --------------------------
stage 0 no ""
res="$(run_hook "implement a new payment retry function")"
assert_exit0 "dev intent without a ticket still exits 0 (warns, never blocks)" "$res"
assert_contains "dev intent without a ticket prints the ticket instruction block" "[TASKBOARD] NO ACTIVE TICKET" "$res"
assert_contains "the block is wrapped for the AI" "<user-prompt-submit-hook>" "$res"
assert_contains "the block carries the project id from the stub" '"projectId": "proj_stub"' "$res"
assert_contains "the block carries the team id from the stub" '"teamId": "team_stub"' "$res"
assert_contains "the block echoes the user's request" "implement a new payment retry function" "$res"

# --- stale tickets are reported ---------------------------------------------
stage 0 yes ""
res="$(run_hook "explain the board")"
assert_contains "stale in-progress tickets are listed" "[TASKBOARD] Stale in-progress tickets detected" "$res"
assert_contains "the stale entries themselves are echoed" "PF-1: stale one" "$res"

# --- an active ticket short-circuits the dev-intent gate ---------------------
stage 0 no "01ACTIVE"
res="$(run_hook "implement the login form")"
assert_exit0 "an active ticket exits 0" "$res"
assert_contains "the active ticket is announced with its number, title and status" '[TASKBOARD] Active ticket: PF-42 "Ship it" (status: in_progress)' "$res"
assert_not_contains "an active ticket suppresses the dev-intent block even for a dev prompt" "NO ACTIVE TICKET" "$res"

echo ""
echo "passed: $pass  failed: $fail"
[ "$fail" -eq 0 ] || exit 1
