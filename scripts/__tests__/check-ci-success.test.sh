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

# Build a toJSON(needs)-shaped object mirroring the REAL ci-success `needs:` list
# (all 14 jobs — see ci.yml), so a failure on ANY required gate is exercised, not
# just the handful that used to be in the fixture. Jobs not parameterised default
# to success. Args:
#   $1 needs-ci   $2 needs-deps   $3 lockfile-sync.result
#   $4 lockfile-sync-tests.result   $5 quality-gates.result (default success)
#   $6 hook-tests.result (default success) — stands in for the other required
#      gates so a case can fail a job that is neither lockfile job nor quality-gates.
#   $7 needs-agentic (default true)   $8 agentic-sync.result (default success)
#   $9 needs-onboarding (default true)
#   $10 taskboard-onboarding-guard.result (default success)
#   $11 needs-codex (default true)   $12 codex-config-guard.result (default success)
#   $13 needs-ghaw (default true)    $14 ghaw-lock-sync.result (default success)
mk() {
  local nci="$1" ndeps="$2" ls="$3" lst="$4" qg="${5:-success}" ht="${6:-success}" nagentic="${7:-true}" as="${8:-success}" nonboarding="${9:-true}" tog="${10:-success}" ncodex="${11:-true}" ccg="${12:-success}" nghaw="${13:-true}" glr="${14:-success}"
  jq -nc \
    --arg nci "$nci" --arg ndeps "$ndeps" --arg ls "$ls" --arg lst "$lst" \
    --arg qg "$qg" --arg ht "$ht" --arg nagentic "$nagentic" --arg as "$as" \
    --arg nonboarding "$nonboarding" --arg tog "$tog" --arg ncodex "$ncodex" --arg ccg "$ccg" \
    --arg nghaw "$nghaw" --arg glr "$glr" '
    {
      "ci-gate":              { result: "success", outputs: { "needs-ci": $nci, "needs-deps": $ndeps, "needs-agentic": $nagentic, "needs-onboarding": $nonboarding, "needs-codex": $ncodex, "needs-ghaw": $nghaw, "needs-any-code": "true" } },
      "quality-gates":        { result: $qg },
      "command-parity":       { result: "success" },
      "build-nextjs":         { result: "success" },
      "docs-internal-gate":   { result: "success" },
      "design-internal-gate": { result: "success" },
      "hook-tests":           { result: $ht },
      "lockfile-sync":        { result: $ls },
      "lockfile-sync-tests":  { result: $lst },
      "agentic-sync":         { result: $as },
      "taskboard-onboarding-guard": { result: $tog },
      "codex-config-guard":   { result: $ccg },
      "ghaw-lock-sync":       { result: $glr },
      "test-e2e-ui":          { result: "success" }
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

# --- 4. Legitimate skips (ALL triggers false) → exit 0 -----------------------
# needs-ci=false, needs-deps=false, needs-agentic=false, needs-onboarding=false,
# needs-codex=false, needs-ghaw=false — so ALL SIX self-defending gates
# (lockfile-sync, lockfile-sync-tests, agentic-sync, taskboard-onboarding-guard,
# codex-config-guard, ghaw-lock-sync) skipping is correct path-filter behaviour
# and must NOT trip the anti-tamper check. This is the clean baseline: a PR that
# touches none of the guarded surfaces.
res="$(run_verify "$(mk false false skipped skipped success success false skipped false skipped false skipped false skipped)")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "all six gates legitimately skipped pass (exit 0)"; else fail "legit skip should exit 0, got $rc"; fi

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
if echo "$out" | grep -q "lockfile-sync ("; then pass "the unwired deps gate is named"; else fail "unwired deps gate not named"; fi

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

# --- 9. Malformed (non-empty) NEEDS_JSON → exit 1 (fail safe) -----------------
# A non-empty but invalid JSON blob must NOT silently pass. The script has no
# `set -e`, so a jq error inside $(...) is swallowed: `failed` and the
# anti-tamper queries both come back empty and the verifier would fall through
# to the success echo (exit 0) — inverting the fail-safe. Validate JSON up front.
res="$(run_verify '{"malformed":')"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "malformed NEEDS_JSON fails (exit 1)"; else fail "malformed input should exit 1, got $rc"; fi
if echo "$out" | grep -qi "valid JSON"; then pass "malformed input has a clear message"; else fail "malformed-input message missing"; fi

# --- 10. Garbage (non-JSON) NEEDS_JSON → exit 1 (fail safe) ------------------
res="$(run_verify 'not json at all')"
rc="${res%%|*}"
if [ "$rc" = "1" ]; then pass "non-JSON NEEDS_JSON fails (exit 1)"; else fail "non-JSON input should exit 1, got $rc"; fi

# --- 11. A required gate OTHER than quality-gates / the lockfile jobs fails ---
# Guards against the verifier only noticing failures on the handful of jobs the
# fixture used to model. hook-tests is one of the 10 real ci-success needs; a
# failure there must be caught and named like any other.
res="$(run_verify "$(mk true true success success success failure)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "an unrelated required gate failing fails (exit 1)"; else fail "hook-tests failure should exit 1, got $rc"; fi
if echo "$out" | grep -q "hook-tests"; then pass "the failing unrelated gate is named"; else fail "failing unrelated gate not named"; fi

# --- 12. TAMPER: agentic-sync skipped while needs-agentic=true → exit 1 -------
# The agentic-config drift gate is self-defending too: a ci.yml / instruction-file
# edit sets needs-agentic=true, so the gate SHOULD run; a skip is an unwiring signal.
res="$(run_verify "$(mk true true success success success success true skipped)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "agentic-sync skipped while needs-agentic=true fails (exit 1)"; else fail "tamper (agentic) should exit 1, got $rc"; fi
if echo "$out" | grep -qi "unwiring"; then pass "agentic tamper is flagged as a possible unwiring"; else fail "agentic tamper message missing"; fi
if echo "$out" | grep -q "agentic-sync ("; then pass "the unwired agentic gate is named"; else fail "unwired agentic gate not named"; fi

# --- 13. agentic-sync legit-skips (needs-agentic=false) → exit 0 -------------
res="$(run_verify "$(mk true true success success success success false skipped)")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "agentic-sync legit-skip passes (exit 0)"; else fail "agentic legit skip should exit 0, got $rc"; fi

# --- 14. agentic-sync FAILED while triggered → exit 1 (hard-failure path) -----
res="$(run_verify "$(mk true true success success success success true failure)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "agentic-sync failure fails (exit 1)"; else fail "agentic failure should exit 1, got $rc"; fi
if echo "$out" | grep -q "agentic-sync"; then pass "the failing agentic gate is named"; else fail "failing agentic gate not named"; fi

# --- 15. TAMPER via the SECOND trigger arm: lockfile-sync-tests skipped while --
#        needs-agentic=true and needs-ci=false → exit 1.
# The self-tests job fires on `needs-ci || needs-agentic` (ci.yml). A PR touching
# ONLY agentic files (needs-ci=false, needs-agentic=true) that slips `if: false`
# onto lockfile-sync-tests would skip it while needs-ci is false — so guarding
# only the needs-ci arm leaves this single-line vector open. The anti-tamper must
# treat EITHER trigger firing as "the job had to run."
# needs-codex is held FALSE (ccg legit-skips) so the codex arm cannot mask a
# dropped needs-agentic arm — this case must fail PURELY on the agentic mapping.
res="$(run_verify "$(mk false false skipped skipped success success true success false success false skipped)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "tests skipped while needs-agentic=true (needs-ci=false) fails (exit 1)"; else fail "tamper (tests via agentic arm) should exit 1, got $rc"; fi
if echo "$out" | grep -q "lockfile-sync-tests"; then pass "the unwired gate is named (agentic arm)"; else fail "unwired gate not named (agentic arm)"; fi

# --- 16. TAMPER via the FIRST trigger arm in ISOLATION: lockfile-sync-tests ----
#        skipped while needs-ci=true and needs-agentic=FALSE → exit 1.
# Mirror of case 15 for the other arm. Without it, EVERY tamper fixture that hits
# lockfile-sync-tests also has needs-agentic=true (mk's default), so the needs-ci
# argument could be silently dropped from check_triggered "lockfile-sync-tests"
# and the whole suite would stay green — leaving the ci.yml-edit unwiring vector
# (a scripts/ or ci.yml PR sets needs-ci=true, touches no agentic file) untested.
# Both arms must be independently load-bearing.
# needs-codex is held FALSE (ccg legit-skips) so the codex arm cannot mask a
# dropped needs-ci arm — this case must fail PURELY on the needs-ci mapping.
res="$(run_verify "$(mk true true success skipped success success false success false success false skipped)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "tests skipped while needs-ci=true (needs-agentic=false) fails (exit 1)"; else fail "tamper (tests via ci arm) should exit 1, got $rc"; fi
if echo "$out" | grep -q "lockfile-sync-tests"; then pass "the unwired gate is named (ci arm)"; else fail "unwired gate not named (ci arm)"; fi

# --- 17. TAMPER: taskboard-onboarding-guard skipped while needs-onboarding=true -
# The onboarding-hygiene tripwire is self-defending too: a PR that edits an
# onboarding surface (README/CONTRIBUTING/provider rules/...) sets
# needs-onboarding=true, so the guard SHOULD run; an `if: false` skip is an
# unwiring signal that would let a reintroduced dead ULID / forbidden `--db`
# command slip past while every required check stayed green.
res="$(run_verify "$(mk true true success success success success true success true skipped)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "onboarding guard skipped while needs-onboarding=true fails (exit 1)"; else fail "tamper (onboarding) should exit 1, got $rc"; fi
if echo "$out" | grep -qi "unwiring"; then pass "onboarding tamper is flagged as a possible unwiring"; else fail "onboarding tamper message missing"; fi
if echo "$out" | grep -q "taskboard-onboarding-guard ("; then pass "the unwired onboarding gate is named"; else fail "unwired onboarding gate not named"; fi

# --- 18. onboarding guard legit-skips (needs-onboarding=false) → exit 0 --------
res="$(run_verify "$(mk true true success success success success true success false skipped)")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "onboarding guard legit-skip passes (exit 0)"; else fail "onboarding legit skip should exit 0, got $rc"; fi

# --- 19. onboarding guard FAILED while triggered → exit 1 (hard-failure path) --
res="$(run_verify "$(mk true true success success success success true success true failure)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "onboarding guard failure fails (exit 1)"; else fail "onboarding failure should exit 1, got $rc"; fi
if echo "$out" | grep -q "taskboard-onboarding-guard"; then pass "the failing onboarding gate is named"; else fail "failing onboarding gate not named"; fi

# --- 20. TAMPER via the THIRD trigger arm: lockfile-sync-tests skipped while ---
#        ONLY needs-onboarding=true (needs-ci=false, needs-agentic=false) → exit 1.
# The self-defense suite also re-runs on onboarding-surface edits, so its `if:`
# fires on `needs-ci || needs-agentic || needs-onboarding`. A PR touching ONLY an
# onboarding doc (needs-onboarding=true, the other two false) that slips
# `if: false` onto lockfile-sync-tests would skip it while needs-ci/needs-agentic
# are false — so the anti-tamper map must treat the onboarding arm as load-bearing
# too. lockfile-sync + agentic-sync legit-skip here (their triggers are false), so
# the ONLY tamper is the skipped self-tests job.
# needs-codex is held FALSE (ccg legit-skips) so the codex arm cannot mask a
# dropped needs-onboarding arm — this case must fail PURELY on the onboarding map.
res="$(run_verify "$(mk false false skipped skipped success success false success true success false skipped)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "tests skipped while needs-onboarding=true (others false) fails (exit 1)"; else fail "tamper (tests via onboarding arm) should exit 1, got $rc"; fi
if echo "$out" | grep -q "lockfile-sync-tests"; then pass "the unwired gate is named (onboarding arm)"; else fail "unwired gate not named (onboarding arm)"; fi

# --- 21. ISOLATED onboarding-guard tamper: guard skipped while ONLY -----------
#        needs-onboarding=true → exit 1, naming the guard (mirrors cases 15/16/20 for
#        the onboarding arm). lockfile-sync-tests=success here (it ran because the
#        onboarding arm fired), so the guard skip is the sole tamper — proving the
#        guard's needs-onboarding mapping is independently load-bearing even when
#        no other trigger is set.
# needs-codex is held FALSE (ccg legit-skips) so the codex arm cannot mask the
# onboarding tamper — this case must fail PURELY on the onboarding-guard map,
# matching the isolation discipline of cases 15/16/20.
res="$(run_verify "$(mk false false skipped success success success false skipped true skipped false skipped)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "guard skipped while ONLY needs-onboarding=true fails (exit 1)"; else fail "isolated onboarding tamper should exit 1, got $rc"; fi
if echo "$out" | grep -q "taskboard-onboarding-guard ("; then pass "the unwired onboarding gate is named (isolated arm)"; else fail "unwired onboarding gate not named (isolated arm)"; fi

# --- 22. TAMPER: codex-config-guard skipped while needs-codex=true → exit 1 ----
# The Codex config-safety tripwire is self-defending too: a PR that edits
# .codex/config.toml or the guard/test scripts sets needs-codex=true, so the gate
# SHOULD run; an `if: false` skip is an unwiring signal that would let a permissive
# committed Codex profile (approval_policy="never" + network_access=true) slip past
# while every required check stayed green.
res="$(run_verify "$(mk true true success success success success true success true success true skipped)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "codex guard skipped while needs-codex=true fails (exit 1)"; else fail "tamper (codex) should exit 1, got $rc"; fi
if echo "$out" | grep -qi "unwiring"; then pass "codex tamper is flagged as a possible unwiring"; else fail "codex tamper message missing"; fi
if echo "$out" | grep -q "codex-config-guard ("; then pass "the unwired codex gate is named"; else fail "unwired codex gate not named"; fi

# --- 23. codex-config-guard legit-skips (needs-codex=false) → exit 0 -----------
res="$(run_verify "$(mk true true success success success success true success true success false skipped)")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "codex guard legit-skip passes (exit 0)"; else fail "codex legit skip should exit 0, got $rc"; fi

# --- 24. codex-config-guard FAILED while triggered → exit 1 (hard-failure path) -
res="$(run_verify "$(mk true true success success success success true success true success true failure)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "codex guard failure fails (exit 1)"; else fail "codex failure should exit 1, got $rc"; fi
if echo "$out" | grep -q "codex-config-guard"; then pass "the failing codex gate is named"; else fail "failing codex gate not named"; fi

# --- 25. TAMPER via the needs-codex arm in ISOLATION: lockfile-sync-tests -----
#        skipped while ONLY needs-codex=true (needs-ci=false, needs-agentic=false,
#        needs-onboarding=false, needs-ghaw=false) → exit 1, naming the self-tests job.
# The CI Self-Defense Tests job RUNS the Codex guard's own suite
# (check-codex-config-safety.test.sh), so lockfile-sync-tests must re-run whenever
# needs-codex fires. Relying on the implicit subset invariant (every needs-codex
# path ALSO sets needs-ci or needs-onboarding) is fragile: narrow those filters
# later and a .codex/config.toml-only PR could set needs-codex alone, silently
# skipping the Codex self-test while every required check stayed green. The
# needs-codex arm of check_triggered "lockfile-sync-tests" makes that an explicit,
# enforced unwiring signal. Every other gate legit-skips (its trigger is false) and
# codex-config-guard ran (needs-codex=true, success) — needs-ghaw is held FALSE so
# the separate ghaw-lock-sync gate cannot raise a competing tamper — leaving the
# skipped self-tests job as the SOLE tamper, which proves the needs-codex arm is
# independently load-bearing.
res="$(run_verify "$(mk false false skipped skipped success success false skipped false skipped true success false skipped)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "tests skipped while ONLY needs-codex=true fails (exit 1)"; else fail "tamper (tests via codex arm) should exit 1, got $rc"; fi
if echo "$out" | grep -q "lockfile-sync-tests"; then pass "the unwired gate is named (codex arm)"; else fail "unwired gate not named (codex arm)"; fi

# --- 26. TAMPER: ghaw-lock-sync skipped while needs-ghaw=true → exit 1 ---------
# The gh-aw lock-drift gate is self-defending too: a PR that edits a
# .github/workflows/*.md source, a *.lock.yml, a .github/aw/ action pin, or the
# guard/test scripts sets needs-ghaw=true, so the gate SHOULD run; an `if: false`
# skip is an unwiring signal that would let a stale compiled .lock.yml (the
# workflow GitHub actually runs diverging from its source) slip past while every
# required check stayed green. All other gates pass/run here, so the skipped
# ghaw-lock-sync is the sole tamper. Final two mk args: needs-ghaw=true, result=skipped.
res="$(run_verify "$(mk true true success success success success true success true success true success true skipped)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "ghaw gate skipped while needs-ghaw=true fails (exit 1)"; else fail "tamper (ghaw) should exit 1, got $rc"; fi
if echo "$out" | grep -qi "unwiring"; then pass "ghaw tamper is flagged as a possible unwiring"; else fail "ghaw tamper message missing"; fi
if echo "$out" | grep -q "ghaw-lock-sync ("; then pass "the unwired ghaw gate is named"; else fail "unwired ghaw gate not named"; fi

# --- 27. ghaw-lock-sync legit-skips (needs-ghaw=false) → exit 0 ----------------
res="$(run_verify "$(mk true true success success success success true success true success true success false skipped)")"
rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "ghaw gate legit-skip passes (exit 0)"; else fail "ghaw legit skip should exit 0, got $rc"; fi

# --- 28. ghaw-lock-sync FAILED while triggered → exit 1 (hard-failure path) -----
res="$(run_verify "$(mk true true success success success success true success true success true success true failure)")"
rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "ghaw gate failure fails (exit 1)"; else fail "ghaw failure should exit 1, got $rc"; fi
if echo "$out" | grep -q "ghaw-lock-sync"; then pass "the failing ghaw gate is named"; else fail "failing ghaw gate not named"; fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
