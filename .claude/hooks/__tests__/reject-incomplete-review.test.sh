#!/usr/bin/env bash
# Tests for reject-incomplete-review.sh (SubagentStop verdict gate).
#
# Contract under test (hardened):
#   exit 2  ONLY when a reviewer/guardian subagent emits a SUBSTANTIVE review
#           body (>= 200 trimmed chars) that genuinely lacks a PASS/FAIL verdict.
#   exit 0  in every other case — a clear verdict, a non-reviewer agent, empty /
#           whitespace-only output, a JSON error object, a short terse "tail"
#           (e.g. "Hook validated. End."), or unparseable input.
#
# The exit-0 cases are the loop-bug fix: a background subagent's SubagentStop
# `.output` is only a short tail, never the full review it already returned to
# the orchestrator, so treating its missing verdict as a failure looped forever.
#
# Run: bash .claude/hooks/__tests__/reject-incomplete-review.test.sh
set -uo pipefail

command -v jq >/dev/null 2>&1 || { echo "jq is required to run these tests"; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HERE/../reject-incomplete-review.sh"

pass=0
fail=0

# run_hook <agent_type> <output> -> echoes the hook's exit code.
# Builds a well-formed JSON payload via jq so arbitrary content is safe.
run_hook() {
  local agent_type="$1" output="$2"
  jq -nc --arg t "$agent_type" --arg o "$output" '{agent_type:$t, output:$o}' \
    | bash "$HOOK" >/dev/null 2>&1
  echo $?
}

# run_hook_raw <raw_stdin> -> echoes the hook's exit code, piping bytes verbatim
# (used to feed malformed / non-JSON input).
run_hook_raw() {
  printf '%s' "$1" | bash "$HOOK" >/dev/null 2>&1
  echo $?
}

# repeat_char <char> <count> -> a string of <count> copies of <char>.
repeat_char() {
  printf '%*s' "$2" '' | tr ' ' "$1"
}

assert_exit() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    pass=$((pass + 1))
    printf '  ok   %s (exit %s)\n' "$desc" "$actual"
  else
    fail=$((fail + 1))
    printf '  FAIL %s (expected exit %s, got %s)\n' "$desc" "$expected" "$actual"
  fi
}

# A genuine, substantive review body that omits a verdict (>200 chars, no
# PASS/FAIL). Deliberately avoids the words pass/fail to keep intent unambiguous.
SUBSTANTIVE_NO_VERDICT="The in-flight dedup block in web/src/lib/api/responseCache.ts reuses a single \
shared promise across joiners. On rejection the joiners re-check the cache and otherwise run their own \
attempt, which looks correct. The identity-guarded cleanup at the end of the function only removes the \
entry it registered, so a sibling joiner's live entry is preserved across concurrent settles."

# A JSON error object the platform might place in `.output` (>200 chars, no
# verdict). Starts with '{' — never the shape of a real review body.
JSON_ERROR_OBJECT='{"error":"model_stream_closed","detail":"the subagent stream closed before the \
security review of web/src/lib/auth/api-auth.ts produced any findings or a verdict, so nothing \
meaningful was returned by the run and the orchestrator should treat the output as unverifiable here"}'

# A >200-char body that mentions PASSED / FAILED (past tense) but issues no bare
# PASS/FAIL verdict. Word boundaries must keep this from satisfying the gate.
PASSED_FAILED_NO_VERDICT="The migration PASSED through three of its stages and exactly one integration \
check FAILED to run on the first attempt, but the reviewer never recorded a formal determination about \
the change to web/src/lib/api/responseCache.ts and left no overall conclusion of any kind here today."

# A >200-char body whose only verdict token is lowercase 'pass' (case-insensitive
# match must accept it).
LOWERCASE_VERDICT="After reviewing the change to web/src/lib/api/responseCache.ts and walking every \
branch of the in-flight dedup path together with the identity-guarded cleanup at the tail of the \
function, my overall determination for this particular submission is pass and there is nothing more."

echo "reject-incomplete-review.sh"

# --- Preserved behavior: verdict present / non-reviewer ---
assert_exit "non-reviewer agent is ignored"                 0 "$(run_hook "builder" "$SUBSTANTIVE_NO_VERDICT")"
assert_exit "reviewer with PASS verdict accepted"           0 "$(run_hook "security-reviewer" "VERDICT: PASS — all checks clean.")"
assert_exit "reviewer with FAIL verdict accepted"           0 "$(run_hook "code-architect-reviewer" "VERDICT: FAIL — see issue in foo.ts")"
assert_exit "guardian with PASS verdict accepted"           0 "$(run_hook "dx-guardian" "Looks good. PASS.")"
assert_exit "guardian with FAIL verdict accepted"           0 "$(run_hook "docs-guardian" "VERDICT: FAIL — fix the table in x.md")"
assert_exit "lowercase 'pass' verdict accepted"             0 "$(run_hook "security-reviewer" "$LOWERCASE_VERDICT")"

# --- The genuine loop-block case (must still fire) ---
assert_exit "substantive review missing a verdict blocks"   2 "$(run_hook "security-reviewer" "$SUBSTANTIVE_NO_VERDICT")"
assert_exit "PASSED/FAILED prose is not a verdict (blocks)" 2 "$(run_hook "security-reviewer" "$PASSED_FAILED_NO_VERDICT")"
# The gate matches reviewer|guardian — pin the block path for a *guardian* type too,
# so a regression narrowing the match to only '-reviewer' is caught.
assert_exit "guardian substantive review missing verdict blocks" 2 "$(run_hook "docs-guardian" "$SUBSTANTIVE_NO_VERDICT")"

# --- Threshold boundary (MIN_REVIEW_CHARS = 200) ---
assert_exit "199 chars no verdict is unverifiable"          0 "$(run_hook "security-reviewer" "$(repeat_char x 199)")"
assert_exit "200 chars no verdict is substantive (blocks)"  2 "$(run_hook "security-reviewer" "$(repeat_char x 200)")"
assert_exit "201 chars no verdict is substantive (blocks)"  2 "$(run_hook "security-reviewer" "$(repeat_char x 201)")"

# --- Hardening: unverifiable output must NOT loop-block ---
assert_exit "empty output is unverifiable"                  0 "$(run_hook "security-reviewer" "")"
assert_exit "whitespace-only output is unverifiable"        0 "$(run_hook "security-reviewer" "   $(printf '\n\t')  ")"
assert_exit "terse subagent tail is unverifiable"           0 "$(run_hook "security-reviewer" "Hook validated. End.")"
assert_exit "short acknowledgement is unverifiable"         0 "$(run_hook "test-writer-reviewer" "Acknowledged.")"
assert_exit "JSON error object is not a review"             0 "$(run_hook "security-reviewer" "$JSON_ERROR_OBJECT")"

# --- Fail-safe on malformed / non-JSON input (never exit 2, never undefined) ---
assert_exit "non-JSON stdin fails safe"                     0 "$(run_hook_raw 'not valid json {{{')"
assert_exit "empty stdin fails safe"                        0 "$(run_hook_raw '')"

echo ""
echo "passed: $pass  failed: $fail"
[ "$fail" -eq 0 ]
