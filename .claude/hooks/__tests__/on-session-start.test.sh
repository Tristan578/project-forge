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

# assert_no_raw_start <case> <result> — the hook's EMITTED guidance must never
# tell an operator to run the taskboard binary by hand (#9995 / #10291): a raw
# `taskboard start` lets the binary fall back to its own default database path,
# which is the divergence the runtime launcher exists to close. This is an
# occurrence check on the live output (a whole-word `taskboard start`, whatever
# precedes it), not a containment check on the hook's source, so a comment or a
# re-worded banner cannot satisfy it (lessons-learned #16). The launcher line
# `taskboard-launch.mjs start` never matches: its hyphen breaks the word.
assert_no_raw_start() {
  local desc="$1" res="$2" out="${2#*|}"
  if grep -qE '(^|[^-[:alnum:]_])taskboard start' <<<"$out"; then
    bad "$desc — emitted guidance still prescribes a raw 'taskboard start': $out"
  else
    ok "$desc"
  fi
}
readonly -f assert_no_raw_start

echo "=== on-session-start.sh tests ==="
set_dx absent

# ---- 1. not installed -> the install banner and exit 1 -----------------------
res="$(run_hook STUB_INSTALLED=0)"
expect "1. taskboard not installed prints the install banner and exits 1" \
  "$res" 1 \
  "TASKBOARD NOT INSTALLED" "MANDATORY: Install taskboard" "~TASKBOARD STATUS" "~STUB-SYNC-FROM-GITHUB-RAN"
# `go install github.com/tcarac/taskboard@latest` fails: v0.6.0 has no main
# package at the module root, and cmd/taskboard's `//go:embed web/dist` names a
# directory the module does not ship. The banner must not prescribe it, and it
# must name the TASKBOARD_BIN override the install check honours.
expect "1b. the install banner never prescribes the broken 'go install' and names TASKBOARD_BIN" \
  "$res" 1 \
  "~go install github.com/tcarac/taskboard" "https://github.com/tcarac/taskboard/releases" "TASKBOARD_BIN"

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
res="$(run_hook STUB_API_AVAILABLE=0 STUB_AUTO_START=0)"
expect "3b. server down + auto-start fails prints the FAILED TO START banner and exits 0 without the status flow" \
  "$res" 0 \
  "TASKBOARD FAILED TO START" "~TASKBOARD STATUS" "~STUB-SYNC-FROM-GITHUB-RAN"
expect "3c. the FAILED TO START banner's manual remedy is the runtime launcher" \
  "$res" 0 "node .claude/hooks/taskboard-launch.mjs start"
assert_no_raw_start "3d. the FAILED TO START banner never prescribes a raw 'taskboard start'" "$res"
# On a new machine `start` refuses (no database), so the banner must also give
# the first-run path. tb_auto_start discards the launcher's stdout, so this
# banner is the only place SessionStart can put that remedy in front of anyone.
expect "3e. the FAILED TO START banner gives the first-run 'init' and the pull that follows it" \
  "$res" 0 "node .claude/hooks/taskboard-launch.mjs init" "python3 .claude/hooks/github_project_sync.py pull"

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

# ---- 6. the REAL install check honours TASKBOARD_BIN --------------------------
# Every case above runs against a stub library. This one sources the real
# taskboard-state.sh, from a temp copy so its "../taskboard" sibling candidate
# points inside $TMP, and reads which binary tb_check_installed settled on.
# taskboard_runtime.binary() tries TASKBOARD_BIN first, so the install check
# must too, or a binary off PATH reads as "not installed" while the launcher
# would start it. The assertion is EQUALITY with the override, not success:
# another candidate on the host (PATH, /usr/local/bin) could make
# tb_check_installed succeed without the override being read at all.
#
# Precedence, not just membership: an executable is also planted at the
# library's "$_TB_PROJECT_ROOT/../taskboard/taskboard" sibling candidate
# ($TMP/taskboard/taskboard, next to $TMP/real-repo). With TASKBOARD_BIN anywhere
# but FIRST in the candidate list, that sibling wins and case 6 goes red; 6c
# proves the sibling really is a live competitor, so 6 cannot pass vacuously.
REAL_LIB_DIR="$TMP/real-repo/.claude/hooks"
mkdir -p "$REAL_LIB_DIR" "$TMP/custom-bin" "$TMP/taskboard"
cp "$HERE/../taskboard-state.sh" "$REAL_LIB_DIR/taskboard-state.sh"
printf '#!/bin/sh\nexit 0\n' > "$TMP/custom-bin/my-taskboard"
chmod +x "$TMP/custom-bin/my-taskboard"
printf '#!/bin/sh\nexit 0\n' > "$TMP/taskboard/taskboard"
chmod +x "$TMP/taskboard/taskboard"

# resolved_bin <TASKBOARD_BIN value> - prints "<tb_check_installed exit>|<TB_BIN>".
resolved_bin() {
  # shellcheck disable=SC2016  # expanded by the child bash, which sources the library first
  TASKBOARD_BIN="$1" bash -c '. "$1"; tb_check_installed; printf "%s|%s" "$?" "$TB_BIN"' _ "$REAL_LIB_DIR/taskboard-state.sh" 2>/dev/null
}
readonly -f resolved_bin

res="$(resolved_bin "$TMP/custom-bin/my-taskboard")"
if [ "$res" = "0|$TMP/custom-bin/my-taskboard" ]; then
  ok "6. tb_check_installed selects the binary TASKBOARD_BIN names, ahead of the ../taskboard sibling"
else
  bad "6. TASKBOARD_BIN=$TMP/custom-bin/my-taskboard should be selected ahead of $TMP/taskboard/taskboard, got '$res'"
fi
res="$(resolved_bin "$TMP/custom-bin/absent-taskboard")"
if [ "${res#*|}" != "$TMP/custom-bin/absent-taskboard" ]; then
  ok "6b. a TASKBOARD_BIN that names no executable is not selected"
else
  bad "6b. a missing TASKBOARD_BIN was selected anyway: '$res'"
fi
res="$(resolved_bin "")"
# The library does not normalise the path, so TB_BIN keeps the "../".
if [ "$res" = "0|$TMP/real-repo/../taskboard/taskboard" ]; then
  ok "6c. with TASKBOARD_BIN unset the planted ../taskboard sibling is selected (the precedence fixture is live)"
else
  bad "6c. the planted sibling $TMP/taskboard/taskboard should win when TASKBOARD_BIN is unset, got '$res'"
fi

echo
echo "on-session-start.test.sh: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
