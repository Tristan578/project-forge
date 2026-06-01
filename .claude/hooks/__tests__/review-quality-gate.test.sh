#!/usr/bin/env bash
# Tests for review-quality-gate.sh (Stop-event verdict gate).
#
# Contract under test:
#   exit 0  — non-reviewer agent, OR a reviewer whose output has a PASS verdict,
#             OR a FAIL verdict that carries both a file reference and an
#             actionable verb. Malformed/non-JSON stdin fails safe to exit 0.
#   exit 2  — a reviewer whose output lacks any verdict, OR a FAIL verdict
#             missing a file reference, OR a FAIL verdict missing an actionable
#             verb.
#
# Unlike the SubagentStop sibling (reject-incomplete-review.test.sh), this gate
# sees the reviewer's COMPLETE output, so it enforces the stricter shape.
#
# Run: bash .claude/hooks/__tests__/review-quality-gate.test.sh
set -uo pipefail

command -v jq >/dev/null 2>&1 || { echo "jq is required to run these tests"; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HERE/../review-quality-gate.sh"

pass=0
fail=0

# run_hook <agent_type> <output> -> echoes the hook's exit code.
run_hook() {
  local agent_type="$1" output="$2"
  jq -nc --arg t "$agent_type" --arg o "$output" '{agent_type:$t, output:$o}' \
    | bash "$HOOK" >/dev/null 2>&1
  echo $?
}

# run_hook_raw <raw_stdin> -> echoes the hook's exit code (malformed-input path).
run_hook_raw() {
  printf '%s' "$1" | bash "$HOOK" >/dev/null 2>&1
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

FAIL_COMPLETE="VERDICT: FAIL — fix the missing await on the rateLimitPublicRoute() call in web/src/lib/api/foo.ts line 12."
FAIL_NO_FILEREF="VERDICT: FAIL — add the missing guard before the deduction, it is required for correctness here."
FAIL_NO_VERB="VERDICT: FAIL — the regression lives in web/src/lib/api/foo.ts and remains entirely unresolved as written."

echo "review-quality-gate.sh"

# --- Verdict present / non-reviewer ---
assert_exit "non-reviewer agent is ignored"               0 "$(run_hook "builder" "no verdict at all here")"
assert_exit "reviewer PASS verdict accepted"              0 "$(run_hook "security-reviewer" "Everything checks out. VERDICT: PASS")"
assert_exit "guardian PASS verdict accepted"              0 "$(run_hook "dx-guardian" "Docs are accurate. VERDICT: PASS")"

# --- Missing verdict blocks ---
assert_exit "reviewer with no verdict blocks"             2 "$(run_hook "security-reviewer" "I looked at the diff and it seems mostly fine overall.")"

# --- FAIL must be actionable (file ref + verb) ---
assert_exit "FAIL with file ref and verb accepted"        0 "$(run_hook "code-architect-reviewer" "$FAIL_COMPLETE")"
assert_exit "FAIL missing a file reference blocks"        2 "$(run_hook "security-reviewer" "$FAIL_NO_FILEREF")"
assert_exit "FAIL missing an actionable verb blocks"      2 "$(run_hook "security-reviewer" "$FAIL_NO_VERB")"
assert_exit "guardian FAIL with file ref and verb ok"     0 "$(run_hook "docs-guardian" "VERDICT: FAIL — update the table in .claude/rules/agent-operations.md")"

# --- FAIL citing only a config/workflow file is actionable (CI/infra/Rust reviews).
# Use a *gated* agent type (matches reviewer|guardian) so the file-ref branch runs;
# infra-devops/test-writer/architect are not matched by this gate and exit early. ---
assert_exit "FAIL citing only a .yml file accepted"       0 "$(run_hook "security-reviewer" "VERDICT: FAIL — fix the download-artifact version in .github/workflows/ci.yml to match the upload step.")"
assert_exit "FAIL citing only a .yaml file accepted"      0 "$(run_hook "security-reviewer" "VERDICT: FAIL — update the cache key in .github/actions/setup/action.yaml so it invalidates correctly.")"
assert_exit "FAIL citing only a .toml file accepted"      0 "$(run_hook "docs-guardian" "VERDICT: FAIL — fix the wasm-bindgen pin in engine/Cargo.toml to restore the lockfile match.")"

# --- Fail-safe on malformed / non-JSON input (never propagate a jq error code) ---
assert_exit "non-JSON stdin fails safe"                   0 "$(run_hook_raw 'not valid json {{{')"
assert_exit "empty stdin fails safe"                      0 "$(run_hook_raw '')"

echo ""
echo "passed: $pass  failed: $fail"
[ "$fail" -eq 0 ]
