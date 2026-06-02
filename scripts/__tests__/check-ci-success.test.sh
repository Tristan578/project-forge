#!/usr/bin/env bash
# Unit tests for scripts/check-ci-success.sh — the CI Success aggregate verifier.
#
# WHY THIS SCRIPT IS TESTED
# -------------------------
# `ci-success` is THE required status check on `main`. Its verify step decides
# whether a PR may merge. It has two jobs:
#   1. Fail if any required gate ended in `failure` or `cancelled`. A path-gated
#      gate that was LEGITIMATELY skipped (its trigger output was false) is fine.
#   2. Anti-tamper: a self-defending gate must NOT be `skipped` while its OWN
#      trigger fired. `ci-success` tolerates legitimate skips, so without this a
#      single `if: false` slipped onto `lockfile-sync-tests` (in a PR that — by
#      editing ci.yml — necessarily sets needs-ci=true) would silently disable
#      the lockfile gate's self-tests while every required check stayed green.
#
# These cases pin both behaviours. The verifier reads $NEEDS_JSON (the
# toJSON(needs) the ci-success job passes in); we synthesise that JSON per case
# with jq so the branching/exit-code contract is exercised hermetically.
set -uo pipefail

command -v jq >/dev/null 2>&1 || { echo "jq is required for these tests"; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../check-ci-success.sh"
FAILURES=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$SCRIPT" ] || { echo "verifier script not found: $SCRIPT"; exit 1; }

# Build a toJSON(needs)-shaped object. Args:
#   $1 needs-ci   $2 needs-deps   $3 lockfile-sync.result
#   $4 lockfile-sync-tests.result   $5 quality-gates.result (default success)
mk() {
  local nci="$1" ndeps="$2" ls="$3" lst="$4" qg="${5:-success}"
  jq -nc \
    --arg nci "$nci" --arg ndeps "$ndeps" --arg ls "$ls" --arg lst "$lst" --arg qg "$qg" '
    {
      "ci-gate":             { result: "success", outputs: { "needs-ci": $nci, "needs-deps": $ndeps, "needs-any-code": "true" } },
      "quality-gates":       { result: $qg },
      "lockfile-sync":       { result: $ls },
      "lockfile-sync-tests": { result: $lst },
      "build-nextjs":        { result: "success" }
    }'
}

# Run the verifier with a given NEEDS_JSON; echo "<exit>|<output>".
run_verify() {
  local needs="$1" out rc
  out="$(NEEDS_JSON="$needs" bash "$SCRIPT" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}

echo "=== check-ci-success.sh tests ==="

# --- 1. All gates success → exit 0 -------------------------------------------
res="$(run_verify "$(mk true true success success success)")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "all gates success passes (exit 0)"; else fail "all-success should exit 0, got $rc"; fi

# --- 2. A gate failed → exit 1 + names the failure ---------------------------
res="$(run_verify "$(mk true true success success failure)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "a failed gate fails (exit 1)"; else fail "failed gate should exit 1, got $rc"; fi
if echo "$out" | grep -qi "failed or were cancelled"; then pass "failure is reported"; else fail "failure message missing"; fi
if echo "$out" | grep -q "quality-gates"; then pass "the failing gate is named"; else fail "failing gate not named"; fi

# --- 3. A gate cancelled → exit 1 --------------------------------------------
res="$(run_verify "$(mk true true success success cancelled)")"
rc="${res%%|*}"
if [ "$rc" = "1" ]; then pass "a cancelled gate fails (exit 1)"; else fail "cancelled gate should exit 1, got $rc"; fi

# --- 4. Legitimate skips (triggers false) → exit 0 ---------------------------
# needs-ci=false and needs-deps=false, so BOTH self-defending gates skipping is
# correct path-filter behaviour and must NOT trip the anti-tamper check.
res="$(run_verify "$(mk false false skipped skipped success)")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "legitimately skipped gates pass (exit 0)"; else fail "legit skip should exit 0, got $rc"; fi

# --- 5. TAMPER: lockfile-sync-tests skipped while needs-ci=true → exit 1 ------
# This is the `if: false` unwiring vector: a ci.yml edit sets needs-ci=true, so
# the self-tests SHOULD run; a skip here is tampering, not a legitimate filter.
res="$(run_verify "$(mk true true success skipped success)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "tests skipped while needs-ci=true fails (exit 1)"; else fail "tamper (tests) should exit 1, got $rc"; fi
if echo "$out" | grep -qi "unwiring"; then pass "tamper is flagged as a possible unwiring"; else fail "tamper message missing"; fi
if echo "$out" | grep -q "lockfile-sync-tests"; then pass "the unwired gate is named"; else fail "unwired gate not named"; fi

# --- 6. TAMPER: lockfile-sync skipped while needs-deps=true → exit 1 ----------
res="$(run_verify "$(mk true true skipped success success)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "gate skipped while needs-deps=true fails (exit 1)"; else fail "tamper (gate) should exit 1, got $rc"; fi
if echo "$out" | grep -q "lockfile-sync (" || echo "$out" | grep -qE "lockfile-sync \("; then pass "the unwired deps gate is named"; else fail "unwired deps gate not named"; fi

# --- 7. Mixed legitimate skip: needs-deps=false (gate legit-skips) but --------
#        needs-ci=true (tests must run, and do) → exit 0
res="$(run_verify "$(mk true false skipped success success)")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "deps gate legit-skips while tests run passes (exit 0)"; else fail "mixed legit skip should exit 0, got $rc"; fi

# --- 8. Empty NEEDS_JSON → exit 1 (fail safe) --------------------------------
res="$(run_verify "")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "empty NEEDS_JSON fails (exit 1)"; else fail "empty input should exit 1, got $rc"; fi
if echo "$out" | grep -qi "empty"; then pass "empty input has a clear message"; else fail "empty-input message missing"; fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
