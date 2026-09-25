#!/usr/bin/env bash
# Tests for .claude/hooks/on-prompt-submit.sh — the UserPromptSubmit hook every
# AI-tool config wires (#8694). It enforces ticket-first development by
# warning, never blocking: every path exits 0.
#
# Hermetic: the hook is copied into a temp dir beside a FULL-REPLACEMENT stub
# taskboard-state.sh, so `source "$SCRIPT_DIR/taskboard-state.sh"` loads canned
# functions driven by STUB_* environment variables and never touches curl, gh
# or the network. The one call the stub cannot intercept is the hook body's own
# `curl "$TB_API/board"` health probe; the stub therefore sets TB_API to a
# sentinel that is refused locally (port 0), so BOARD_COUNT resolves to 0
# deterministically rather than depending on whether a taskboard happens to be
# listening on localhost:3010. The dev-intent regex runs in a local python3,
# which is in-bounds.
set -uo pipefail
command -v python3 >/dev/null 2>&1 || { echo "FAIL python3 is required to run this suite (the hook's dev-intent detector is python)"; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HERE/../on-prompt-submit.sh"
[ -f "$HOOK" ] || { echo "FAIL hook not found: $HOOK"; exit 1; }

pass=0
fail=0
ok()  { echo "  PASS: $1"; pass=$((pass + 1)); }
readonly -f ok
bad() { echo "  FAIL: $1"; fail=$((fail + 1)); }
readonly -f bad

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$HOOK" "$TMP/on-prompt-submit.sh"

# The stub. Every function the hook calls, driven by:
#   STUB_API_AVAILABLE  1 = tb_api_available succeeds (default 1)
#   STUB_STALE          text tb_check_stale prints (default empty)
#   STUB_ACTIVE_ID      what tb_get_active_ticket_id prints (default empty)
#   STUB_TICKET_JSON    what tb_get_ticket prints (default empty)
cat > "$TMP/taskboard-state.sh" <<'STUB'
# full-replacement stub of taskboard-state.sh for on-prompt-submit.test.sh
TB_API="http://127.0.0.1:0/api"
tb_api_available() { [ "${STUB_API_AVAILABLE:-1}" = "1" ]; }
tb_check_stale() { printf '%s' "${STUB_STALE:-}"; }
tb_get_active_ticket_id() { printf '%s' "${STUB_ACTIVE_ID:-}"; }
tb_get_ticket() { printf '%s' "${STUB_TICKET_JSON:-}"; }
tb_get_project_id() { echo "STUB-PROJECT-ID"; }
tb_get_team_id() { echo "STUB-TEAM-ID"; }
STUB

# run_hook <prompt> [VAR=value ...] — feed the prompt on stdin with the given
# stub settings; prints "<exit>|<output>".
run_hook() {
  local prompt="$1" out rc
  shift
  out="$(printf '%s' "$prompt" | env "$@" bash "$TMP/on-prompt-submit.sh" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}
readonly -f run_hook

# expect <case> <result> <want-exit> <must-contain>... — assert the exit code
# and every needle; a needle prefixed with "~" must be ABSENT (the hooks print
# "!!" banners of their own, so "!" cannot be the marker).
expect() {
  local desc="$1" res="$2" want="$3"; shift 3
  local rc="${res%%|*}" out="${res#*|}" needle good=1
  if [ "$rc" != "$want" ]; then
    bad "$desc — expected exit $want, got $rc: $out"
    return
  fi
  for needle in "$@"; do
    case "$needle" in
      "~"*) if grep -qF -- "${needle#\~}" <<<"$out"; then bad "$desc — output must not contain '${needle#\~}': $out"; good=0; fi ;;
      *)  if ! grep -qF -- "$needle" <<<"$out"; then bad "$desc — output lacks '$needle': $out"; good=0; fi ;;
    esac
  done
  [ "$good" -eq 1 ] && ok "$desc"
}
readonly -f expect

echo "=== on-prompt-submit.sh tests ==="

# ---- 1. server unreachable: warn, exit 0, nothing else runs ------------------
expect "1. unreachable API warns 'Server not reachable' and exits 0" \
  "$(run_hook "implement the login form" STUB_API_AVAILABLE=0)" 0 \
  "[TASKBOARD] Server not reachable" "~NO ACTIVE TICKET" "~Board has 0 tickets"

# ---- 2. board health: the direct curl fails locally -> 0-ticket warning ------
expect "2. with the API up, the health probe against the sentinel TB_API reports 0 tickets" \
  "$(run_hook "hello" STUB_API_AVAILABLE=1)" 0 \
  "[TASKBOARD WARNING] Board has 0 tickets"

# ---- 3. stale in-progress tickets are listed ---------------------------------
expect "3. stale in-progress tickets are surfaced with their lines" \
  "$(run_hook "hello" STUB_STALE=$'STALE_TICKETS_FOUND\n  PF-1 old ticket (14 days)')" 0 \
  "[TASKBOARD] Stale in-progress tickets detected:" "  PF-1 old ticket (14 days)"
expect "3b. no stale block when tb_check_stale reports nothing" \
  "$(run_hook "hello")" 0 "~Stale in-progress"

# ---- 4. an active ticket short-circuits the dev-intent gate ------------------
expect "4. an active ticket prints its context and skips dev-intent detection even for a dev prompt" \
  "$(run_hook "implement the login form" STUB_ACTIVE_ID=T1 STUB_TICKET_JSON='{"title":"Login form","status":"in_progress","number":42}')" 0 \
  '[TASKBOARD] Active ticket: PF-42 "Login form" (status: in_progress)' "~NO ACTIVE TICKET"
expect "4b. an active id whose ticket cannot be fetched still exits 0 without the dev-intent block" \
  "$(run_hook "implement the login form" STUB_ACTIVE_ID=T1 STUB_TICKET_JSON=)" 0 \
  "~Active ticket:" "~NO ACTIVE TICKET"

# ---- 5. no ticket + dev intent -> the NO ACTIVE TICKET block, still exit 0 ---
res="$(run_hook "implement a new payment retry function")"
expect "5. a dev-intent prompt with no active ticket prints the NO ACTIVE TICKET block and exits 0" \
  "$res" 0 \
  "<user-prompt-submit-hook>" "[TASKBOARD] NO ACTIVE TICKET" "</user-prompt-submit-hook>" \
  '"projectId": "STUB-PROJECT-ID"' '"teamId": "STUB-TEAM-ID"' \
  "User's request context: implement a new payment retry function"

# ---- 6. safe-pattern words suppress the gate ---------------------------------
expect "6. an explanatory prompt (explain/how) is not flagged" \
  "$(run_hook "explain how the credit system works")" 0 "~NO ACTIVE TICKET"
expect "6b. a dev verb next to a safe word (show me how to fix) is not flagged" \
  "$(run_hook "show me how to fix the build")" 0 "~NO ACTIVE TICKET"
expect "6c. a slash command is not flagged" \
  "$(run_hook "/kanban create a ticket for the build fix")" 0 "~NO ACTIVE TICKET"
expect "6d. a prompt with no dev keyword is not flagged" \
  "$(run_hook "good morning")" 0 "~NO ACTIVE TICKET"

# ---- 7. the prompt summary is capped and never shell-expanded ----------------
long="$(printf 'implement %0250d' 0)"
res="$(run_hook "$long")"
summary="$(sed -n "s/^User's request context: //p" <<<"${res#*|}")"
if [ "${res%%|*}" -eq 0 ] && [ "${#summary}" -eq 200 ]; then
  ok "7. the request context is truncated to 200 characters"
else
  bad "7. expected a 200-char summary, got ${#summary} chars (exit ${res%%|*})"
fi
# shellcheck disable=SC2016  # the single quotes are the point: the hook must print these bytes unexpanded
expect "7b. shell metacharacters in the prompt are printed literally, not expanded" \
  "$(run_hook 'implement $(echo INJECTED) and `echo BACKTICK` now')" 0 \
  'implement $(echo INJECTED) and `echo BACKTICK` now' "~INJECTED and"

echo
echo "on-prompt-submit.test.sh: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
