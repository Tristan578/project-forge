#!/usr/bin/env bash
# Tests for .claude/hooks/on-session-start.sh — the SessionStart hook every
# AI-tool config wires (#8694): install check, auto-start, board health,
# GitHub pull, board status, stale/active/consistency reports, workflow rules,
# and the non-blocking DX audit.
#
# Hermetic: the hook is copied into a temp "hooks" dir beside a
# FULL-REPLACEMENT stub taskboard-state.sh (canned functions driven by STUB_*
# variables), a stub sync-from-github.sh, and a sibling "tools/dx-audit.sh"
# stub, so nothing reaches curl, gh, git or the network. The hook body's own
# `curl "$TB_API/board"` health probe is not interceptable by function stubs;
# the stub sets TB_API to a locally-refused sentinel (port 0) so HEALTH_COUNT
# is 0 deterministically.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HERE/../on-session-start.sh"
[ -f "$HOOK" ] || { echo "FAIL hook not found: $HOOK"; exit 1; }

pass=0
fail=0
ok()  { echo "  PASS: $1"; pass=$((pass + 1)); }
readonly -f ok
bad() { echo "  FAIL: $1"; fail=$((fail + 1)); }
readonly -f bad

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/hooks" "$TMP/tools"
cp "$HOOK" "$TMP/hooks/on-session-start.sh"
printf '#!/usr/bin/env bash\necho "STUB-SYNC-FROM-GITHUB-RAN"\n' > "$TMP/hooks/sync-from-github.sh"
chmod +x "$TMP/hooks/sync-from-github.sh"

# The stub. Driven by:
#   STUB_INSTALLED     1 = tb_check_installed succeeds (default 1)
#   STUB_API_AVAILABLE 1 = tb_api_available succeeds (default 1)
#   STUB_AUTO_START    1 = tb_auto_start succeeds (default 1)
#   STUB_STALE / STUB_ACTIVE_ID / STUB_VALIDATE / STUB_CONSISTENCY  printed text
cat > "$TMP/hooks/taskboard-state.sh" <<'STUB'
# full-replacement stub of taskboard-state.sh for on-session-start.test.sh
TB_API="http://127.0.0.1:0/api"
tb_check_installed() { [ "${STUB_INSTALLED:-1}" = "1" ]; }
tb_api_available() { [ "${STUB_API_AVAILABLE:-1}" = "1" ]; }
tb_auto_start() { echo "STUB-AUTO-START-CALLED"; [ "${STUB_AUTO_START:-1}" = "1" ]; }
tb_board_summary() { echo "STUB-BOARD-SUMMARY"; }
tb_check_stale() { printf '%s' "${STUB_STALE:-}"; }
tb_get_active_ticket_id() { printf '%s' "${STUB_ACTIVE_ID:-}"; }
tb_validate_ticket() { printf '%s' "${STUB_VALIDATE:-}"; }
tb_check_consistency() { printf '%s' "${STUB_CONSISTENCY:-}"; }
tb_suggest_work() { echo "STUB-SUGGEST-WORK"; }
STUB

# set_dx <exit-code|absent> — install (or remove) the sibling tools/dx-audit.sh
# stub the hook probes at "$SCRIPT_DIR/../tools/dx-audit.sh".
set_dx() {
  if [ "$1" = absent ]; then
    rm -f "$TMP/tools/dx-audit.sh"
  else
    printf '#!/usr/bin/env bash\nexit %s\n' "$1" > "$TMP/tools/dx-audit.sh"
    chmod +x "$TMP/tools/dx-audit.sh"
  fi
}
readonly -f set_dx

# run_hook [VAR=value ...] — prints "<exit>|<output>".
run_hook() {
  local out rc
  out="$(env "$@" bash "$TMP/hooks/on-session-start.sh" </dev/null 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}
readonly -f run_hook

# expect <case> <result> <want-exit> <needle>... — a needle prefixed "~" must be
# absent (the hook prints "!!" banners of its own, so "!" cannot be the marker).
expect() {
  local desc="$1" res="$2" want="$3"; shift 3
  local rc="${res%%|*}" out="${res#*|}" needle good=1
  if [ "$rc" != "$want" ]; then
    bad "$desc — expected exit $want, got $rc: $out"
    return
  fi
  for needle in "$@"; do
    case "$needle" in
      "~"*) if grep -qF -- "${needle#\~}" <<<"$out"; then bad "$desc — output must not contain '${needle#\~}'"; good=0; fi ;;
      *)  if ! grep -qF -- "$needle" <<<"$out"; then bad "$desc — output lacks '$needle': $out"; good=0; fi ;;
    esac
  done
  [ "$good" -eq 1 ] && ok "$desc"
}
readonly -f expect

echo "=== on-session-start.sh tests ==="
set_dx absent

# ---- 1. not installed -> the install banner and exit 1 -----------------------
expect "1. taskboard not installed prints the install banner and exits 1" \
  "$(run_hook STUB_INSTALLED=0)" 1 \
  "TASKBOARD NOT INSTALLED" "MANDATORY: Install taskboard" "~TASKBOARD STATUS" "~STUB-SYNC-FROM-GITHUB-RAN"

# ---- 2. installed and running -> the whole status flow, exit 0 ---------------
res="$(run_hook)"
expect "2. installed + running proceeds past the install branch" "$res" 0 "~TASKBOARD NOT INSTALLED" "~Server not running"
expect "2b. the GitHub pull step runs the sibling sync-from-github.sh" "$res" 0 "STUB-SYNC-FROM-GITHUB-RAN"
expect "2c. board status and work suggestions come from the taskboard library" "$res" 0 \
  "TASKBOARD STATUS" "STUB-BOARD-SUMMARY" "STUB-SUGGEST-WORK" "WORKFLOW RULES" "PLAN BEFORE CODE"
expect "2d. the health probe against the sentinel TB_API reports an empty board" "$res" 0 "WARNING: TASKBOARD HAS 0 TICKETS"
expect "2e. no DX line when tools/dx-audit.sh is absent" "$res" 0 "~DX AUDIT"

# ---- 3. not running: auto-start succeeds / fails -----------------------------
expect "3. server down + auto-start succeeds continues to the status flow" \
  "$(run_hook STUB_API_AVAILABLE=0 STUB_AUTO_START=1)" 0 \
  "Server not running" "STUB-AUTO-START-CALLED" "Server started on http://localhost:3010" "TASKBOARD STATUS"
expect "3b. server down + auto-start fails prints the FAILED TO START banner and exits 0 without the status flow" \
  "$(run_hook STUB_API_AVAILABLE=0 STUB_AUTO_START=0)" 0 \
  "TASKBOARD FAILED TO START" "~TASKBOARD STATUS" "~STUB-SYNC-FROM-GITHUB-RAN"

# ---- 4. stale, active-with-issues, consistency reports -----------------------
expect "4. stale in-progress tickets are reported with an ACTION REQUIRED line" \
  "$(run_hook STUB_STALE=$'STALE_TICKETS_FOUND\n  PF-7 stale one')" 0 \
  "!! STALE IN-PROGRESS TICKETS:" "  PF-7 stale one" "ACTION REQUIRED"
expect "4b. an active ticket is shown, and its validation problems listed" \
  "$(run_hook STUB_ACTIVE_ID=T9 STUB_VALIDATE=$'VALIDATION_FAILED\n  missing acceptance criteria')" 0 \
  "Active ticket: T9" "!! Active ticket has documentation issues:" "  missing acceptance criteria"
expect "4c. an active ticket that validates prints no issues block" \
  "$(run_hook STUB_ACTIVE_ID=T9 STUB_VALIDATE=OK)" 0 "Active ticket: T9" "~documentation issues"
expect "4d. consistency issues are reported" \
  "$(run_hook STUB_CONSISTENCY=$'CONSISTENCY_ISSUES_FOUND\n  PF-3 has no subtasks')" 0 \
  "!! TICKET CONSISTENCY ISSUES (open tickets):" "  PF-3 has no subtasks"
expect "4e. none of the report blocks appear when the library reports nothing" \
  "$(run_hook)" 0 "~STALE IN-PROGRESS" "~Active ticket:" "~CONSISTENCY ISSUES"

# ---- 5. the DX audit is advisory: a failure adds one line, never the exit ----
set_dx 1
expect "5. a failing tools/dx-audit.sh adds the DX AUDIT line and the hook still exits 0" \
  "$(run_hook)" 0 "!! DX AUDIT found issues"
set_dx 0
expect "5b. a passing tools/dx-audit.sh adds nothing" "$(run_hook)" 0 "~DX AUDIT"
set_dx absent

echo
echo "on-session-start.test.sh: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
