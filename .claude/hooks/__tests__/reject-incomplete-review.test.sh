#!/usr/bin/env bash
# Tests for reject-incomplete-review.sh (SubagentStop verdict gate).
#
# Contract under test (hardened):
#   exit 2  ONLY when a reviewer/guardian subagent emits a SUBSTANTIVE review
#           body that genuinely lacks a PASS/FAIL verdict.
#   exit 0  in every other case — including the loop-bug trigger where a
#           background subagent returns only a short terse "tail" (e.g.
#           "Hook validated. End.") that never contained the verdict.
#
# Run: bash .claude/hooks/__tests__/reject-incomplete-review.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HERE/../reject-incomplete-review.sh"

pass=0
fail=0

# run_hook <agent_type> <output> -> echoes the hook's exit code
run_hook() {
  local agent_type="$1" output="$2"
  jq -nc --arg t "$agent_type" --arg o "$output" '{agent_type:$t, output:$o}' \
    | bash "$HOOK" >/dev/null 2>&1
  echo $?
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

# A long error dump (>200 chars) that is not a review at all.
TRACEBACK_DUMP="Traceback (most recent call last):
  File \"agent_runtime.py\", line 412, in dispatch
    result = await self._run_review(ctx)
  File \"agent_runtime.py\", line 388, in _run_review
    raise RuntimeError('model stream closed before completion')
RuntimeError: model stream closed before completion — the review never produced any findings."

echo "reject-incomplete-review.sh"

# --- Preserved behavior ---
assert_exit "non-reviewer agent is ignored"                 0 "$(run_hook "builder" "anything at all here")"
assert_exit "reviewer with PASS verdict accepted"           0 "$(run_hook "security-reviewer" "VERDICT: PASS — all checks clean.")"
assert_exit "reviewer with FAIL verdict accepted"           0 "$(run_hook "code-architect-reviewer" "VERDICT: FAIL — see issue in foo.ts")"
assert_exit "guardian with PASS verdict accepted"           0 "$(run_hook "dx-guardian" "Looks good. PASS.")"

# --- The genuine loop-block case (must still fire) ---
assert_exit "substantive review missing a verdict blocks"   2 "$(run_hook "security-reviewer" "$SUBSTANTIVE_NO_VERDICT")"

# --- Hardening: unverifiable output must NOT loop-block ---
assert_exit "empty output is unverifiable"                  0 "$(run_hook "security-reviewer" "")"
assert_exit "whitespace-only output is unverifiable"        0 "$(run_hook "security-reviewer" "   $(printf '\n\t')  ")"
assert_exit "terse subagent tail is unverifiable"           0 "$(run_hook "security-reviewer" "Hook validated. End.")"
assert_exit "short acknowledgement is unverifiable"         0 "$(run_hook "test-writer-reviewer" "Acknowledged.")"
assert_exit "long error dump is not a review"               0 "$(run_hook "security-reviewer" "$TRACEBACK_DUMP")"

echo ""
echo "passed: $pass  failed: $fail"
[ "$fail" -eq 0 ]
